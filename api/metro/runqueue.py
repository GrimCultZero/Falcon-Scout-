"""Long runs that survive a backend restart (P3b, Minor fixes list #4b, 27 Nov 2026).

What happened: Oleh started falconscout.bat a second time while a hooks run was at 3 of 8 companies; the backend restarted and the
run died with it (the progress board lives in memory, by design). Now every long run (enrich and "Retry domain", hooks, chains)
keeps its queue in `metro_runs`: the items it was given and the ones it finished. When the backend starts again, a run that was
still `running` becomes `interrupted`, the strip shows it ("stopped by a backend restart at 3 of 8") with a Resume button, and
Resume starts the same run on the items that are LEFT: a finished item is never redone. Nothing resumes by itself: a run spends
model calls and site visits, so the person who started it decides (DevScout's auto-continue asks too).

The rows hold ids only (no lead data). One short transaction per write, never held across a model call or a fetch.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.orm import Session

from .db import MetroBase, get_engine, utcnow

RESUMABLE = ("enrich", "hooks", "chains")


class MetroRun(MetroBase):
    """One long run's queue: the items it was given and the ones it finished (ids only)."""
    __tablename__ = "metro_runs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String, nullable=False, index=True)           # enrich | hooks | chains
    campaign_id = Column(Integer, nullable=True, index=True)
    label = Column(String, nullable=True)
    items_json = Column(Text, nullable=False, default="[]")     # enrich: company ids; hooks: [[company key, [lead ids]]]; chains: lead ids
    done_json = Column(Text, nullable=False, default="[]")      # the item keys that are finished (done or failed: never redone)
    params_json = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="running", index=True)   # running | done | stopped | failed | interrupted | resumed | dismissed
    progress_id = Column(String, nullable=True)
    result = Column(String, nullable=True)
    started_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    finished_at = Column(DateTime, nullable=True)


def item_key(item) -> str:
    return str(item[0]) if isinstance(item, (list, tuple)) else str(item)


def begin(kind: str, campaign_id: int | None, items: list, *, label: str = "", params: dict | None = None,
          progress_id: str | None = None) -> int:
    with Session(get_engine()) as s:
        r = MetroRun(kind=kind, campaign_id=campaign_id, label=label, items_json=json.dumps(items), done_json="[]",
                     params_json=json.dumps(params or {}), status="running", progress_id=progress_id)
        s.add(r)
        s.commit()
        return r.id


def item_done(qid: int | None, item) -> None:
    if not qid:
        return
    with Session(get_engine()) as s:
        r = s.get(MetroRun, qid)
        if r is None:
            return
        done = json.loads(r.done_json or "[]")
        k = item_key(item)
        if k not in done:
            done.append(k)
            r.done_json = json.dumps(done)
            s.commit()


def end(qid: int | None, status: str, result: str = "") -> None:
    if not qid:
        return
    with Session(get_engine()) as s:
        r = s.get(MetroRun, qid)
        if r is None or r.status != "running":
            return
        r.status, r.result, r.finished_at = status, (result or "")[:300], utcnow()
        s.commit()


def remaining(r: MetroRun) -> list:
    done = set(json.loads(r.done_json or "[]"))
    return [it for it in json.loads(r.items_json or "[]") if item_key(it) not in done]


def mark_interrupted(eng) -> int:
    """At start-up: a run still `running` in the table died with the previous backend process."""
    with Session(eng) as s:
        n = 0
        for r in s.query(MetroRun).filter(MetroRun.status == "running").all():
            r.status = "interrupted"
            left = len(remaining(r))
            total = len(json.loads(r.items_json or "[]"))
            r.result = f"Stopped by a backend restart at {total - left} of {total}; Resume continues with the {left} left"
            r.finished_at = utcnow()
            n += 1
        s.commit()
    return n


def interrupted(campaign_id: int | None = None) -> list[dict]:
    """The runs the strip offers to resume, shaped like progress runs (status "interrupted", can_resume)."""
    with Session(get_engine()) as s:
        q = s.query(MetroRun).filter(MetroRun.status == "interrupted")
        if campaign_id is not None:
            q = q.filter((MetroRun.campaign_id == campaign_id) | (MetroRun.campaign_id.is_(None)))
        out = []
        for r in q.order_by(MetroRun.id.desc()).limit(10).all():
            total = len(json.loads(r.items_json or "[]"))
            left = len(remaining(r))
            ts = (r.finished_at or r.started_at or utcnow()).replace(tzinfo=timezone.utc).timestamp()
            out.append({"id": f"q{r.id}", "queue_id": r.id, "kind": r.kind, "label": r.label or r.kind, "campaign_id": r.campaign_id,
                        "status": "interrupted", "total": total, "done": total - left, "failed": 0, "current": None, "step": None,
                        "detail": "", "started_at": ts, "finished_at": ts, "result": r.result, "can_stop": False, "stopping": False,
                        "can_resume": left > 0, "by_click": True, "attention": True})
        return out


def resume(qid: int) -> dict:
    """Start the run again on the items it did not finish. The old row becomes `resumed`."""
    with Session(get_engine()) as s:
        r = s.get(MetroRun, qid)
        if r is None:
            return {"started": False, "reason": "no such run"}
        if r.status != "interrupted":
            return {"started": False, "reason": f"this run is {r.status}, not interrupted"}
        left, kind, cid = remaining(r), r.kind, r.campaign_id
        params = json.loads(r.params_json or "{}")
        if not left:
            r.status = "done"
            s.commit()
            return {"started": False, "reason": "nothing is left to do: every item was finished"}
    if kind == "enrich":
        from . import enrich
        res = enrich.start_run(cid, None, company_ids=[int(x) for x in left], use_ai=params.get("use_ai", True))
    elif kind == "hooks":
        from . import hooks
        res = hooks.start_hooks_run(cid, [int(i) for _k, ids in left for i in ids])
    elif kind == "chains":
        from . import chains
        res = chains.start_chains_run(cid, [int(x) for x in left])
    else:
        return {"started": False, "reason": f"a {kind} run cannot be resumed"}
    if res.get("started"):
        with Session(get_engine()) as s:
            r = s.get(MetroRun, qid)
            r.status = "resumed"
            s.commit()
    return res


def dismiss(qid: int) -> bool:
    with Session(get_engine()) as s:
        r = s.get(MetroRun, qid)
        if r is None or r.status != "interrupted":
            return False
        r.status = "dismissed"
        s.commit()
        return True


def _now() -> datetime:
    return datetime.now(timezone.utc)
