"""Progress of every long Metro action (METRO_TASK.md F2, item 2). The BACKEND owns it: a run is registered here when it
starts and the front end only draws what `GET /metro/progress` says, so a reloaded tab shows a run that is still going.

A run has: kind (import, enrich, score, rescore, deep, hooks, email-import ...), a label, a total (0 = not known: the bar is
indeterminate and shows elapsed time), done / failed counts, the current item and step ("Rank Media Agency" / "website scan"),
a stop callback when an abort exists, and a one-line result at the end ("Enriched 20 - 17 domains found, 3 not found").

In memory on purpose: the durable state of every action is its own data (snapshots, queued jobs, leads). A backend restart
forgets finished runs and any run that was going died with the process anyway.

`poll` runs for work that finishes elsewhere (the deep readings: the extension returns jobs one by one): the run's counts are
computed from the database every time somebody looks, and the run closes by itself when every job is in.
"""
from __future__ import annotations

import threading
import time
import uuid
from contextlib import contextmanager
from typing import Callable

KEEP_FINISHED = 30
KEEP_SECONDS = 6 * 3600

_lock = threading.RLock()
_runs: dict[str, dict] = {}
_stops: dict[str, Callable[[], None]] = {}
_polls: dict[str, Callable[[], dict]] = {}


def _now() -> float:
    return time.time()


def start(kind: str, label: str, *, total: int = 0, campaign_id: int | None = None, stop: Callable[[], None] | None = None,
          poll: Callable[[], dict] | None = None, detail: str = "", by_click: bool = False, queue_id: int | None = None) -> str:
    """`by_click`: a run Oleh started with a button (P3b #9: its "done" shows on the Falcon Scout side too); `queue_id`: its
    durable queue in metro_runs (runqueue.py), when it can be resumed after a restart."""
    rid = uuid.uuid4().hex[:12]
    with _lock:
        _runs[rid] = {"id": rid, "kind": kind, "label": label, "campaign_id": campaign_id, "status": "running",
                      "total": max(0, int(total or 0)), "done": 0, "failed": 0, "current": None, "step": None, "detail": detail,
                      "started_at": _now(), "finished_at": None, "result": None, "can_stop": stop is not None, "stopping": False,
                      "by_click": bool(by_click), "queue_id": queue_id}
        if stop is not None:
            _stops[rid] = stop
        if poll is not None:
            _polls[rid] = poll
        _trim()
    return rid


def update(rid: str, **kw) -> None:
    with _lock:
        r = _runs.get(rid)
        if r is None or r["status"] != "running":
            return
        for k in ("total", "done", "failed", "current", "step", "detail", "label", "queue_id"):
            if k in kw:
                r[k] = kw[k]


def bump(rid: str, *, done: int = 0, failed: int = 0) -> None:
    with _lock:
        r = _runs.get(rid)
        if r is not None and r["status"] == "running":
            r["done"] += done
            r["failed"] += failed


def finish(rid: str, result: str = "", status: str = "done") -> None:
    """status: done | stopped | failed."""
    with _lock:
        r = _runs.get(rid)
        if r is None or r["status"] != "running":
            return
        r["status"], r["result"], r["finished_at"], r["can_stop"] = status, result, _now(), False
        r["current"], r["step"] = None, None
        _stops.pop(rid, None)
        _polls.pop(rid, None)


def request_stop(rid: str) -> bool:
    with _lock:
        r, cb = _runs.get(rid), _stops.get(rid)
        if r is None or r["status"] != "running" or cb is None:
            return False
        r["stopping"] = True
    try:
        cb()
    except Exception:
        return False
    return True


@contextmanager
def track(kind: str, label: str, *, total: int = 0, campaign_id: int | None = None, detail: str = "", by_click: bool = True):
    """A run for a synchronous action. The body sets `t["result"]` for the one-line result; an exception ends it as failed."""
    rid = start(kind, label, total=total, campaign_id=campaign_id, detail=detail, by_click=by_click)
    box = {"id": rid, "result": ""}
    try:
        yield box
    except BaseException as e:
        finish(rid, f"Failed: {str(e)[:160] or type(e).__name__}", "failed")
        raise
    else:
        finish(rid, box.get("result") or "Done")


def _apply_poll(rid: str, r: dict) -> None:
    fn = _polls.get(rid)
    if fn is None or r["status"] != "running":
        return
    try:
        p = fn() or {}
    except Exception:
        return
    for k in ("total", "done", "failed", "detail", "current"):
        if k in p:
            r[k] = p[k]
    if p.get("finished"):
        r["status"], r["result"], r["finished_at"] = "done", p.get("result") or "Done", _now()
        _polls.pop(rid, None)
        _stops.pop(rid, None)


def _trim() -> None:
    now = _now()
    fin = [r for r in _runs.values() if r["status"] != "running"]
    fin.sort(key=lambda r: r["finished_at"] or 0, reverse=True)
    for i, r in enumerate(fin):
        if i >= KEEP_FINISHED or (r["finished_at"] and now - r["finished_at"] > KEEP_SECONDS):
            _runs.pop(r["id"], None)


def snapshot(campaign_id: int | None = None) -> dict:
    """Running runs first (newest first), then the recently finished. `server_now` lets the page measure elapsed time
    without trusting its own clock."""
    with _lock:
        for rid, r in list(_runs.items()):
            _apply_poll(rid, r)
        _trim()
        runs = [dict(r) for r in _runs.values() if campaign_id is None or r["campaign_id"] in (None, campaign_id)]
    runs.sort(key=lambda r: (r["status"] != "running", -(r["started_at"] or 0)))
    now = _now()
    for r in runs:
        end = r["finished_at"] or now
        r["elapsed_s"] = round(end - r["started_at"], 1)
        if r["status"] == "running" and r["total"] and r["done"] >= 2 and r["done"] < r["total"]:
            r["eta_s"] = round(r["elapsed_s"] / r["done"] * (r["total"] - r["done"]))
        else:
            r["eta_s"] = None
    return {"runs": runs, "running": sum(1 for r in runs if r["status"] == "running"), "server_now": now}


def reset() -> None:
    """Tests only."""
    with _lock:
        _runs.clear()
        _stops.clear()
        _polls.clear()
