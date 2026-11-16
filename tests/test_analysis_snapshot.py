# -*- coding: utf-8 -*-
"""Analyser calibration, record-only (audit 2026-10-29, T9).

The analyser gives hints and never gates the generator. Pinned here:
  * a proposal gets a snapshot of the job's analysis only when that analysis was saved BEFORE
    it was submitted; it is written on create AND update of /proposal-submitted, only when
    empty, and never overwritten once set;
  * the backfill: dry-run by default and writes nothing; --apply refuses without a fresh DB
    backup; it writes only contemporaneous rows and leaves the rest NULL;
  * the card's numbers: reply rate (first_reply_at or replied/interviewing/hired), open rate
    (the Dashboard period-card definition: declined and ghosted are NOT opened), regimes split
    at 2026-11-12 and never pooled, no rate under n = 10, "low sample" under n = 30;
  * NOTHING that builds a letter reads proposals.analysis_json (static scan).
The live upwork_jobs.db is never opened.

Run: python tests/test_analysis_snapshot.py
"""
import ast
import importlib.util
import json
import re
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tools"))

from fastapi import HTTPException                               # noqa: E402
from sqlalchemy import create_engine                            # noqa: E402
from sqlalchemy.orm import Session                              # noqa: E402
import calibration as cal                                       # noqa: E402
from db import Base, Job, Proposal                              # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

def snap(verdict="APPLY", score=8, at="2026-11-01T10:00:00"):
    return {"verdict": verdict, "score": score, "summary": "s", "reasons": [], "flags": [], "model": "m", "snapshot_analysis_at": at}

class J:  # what snapshot_text reads
    def __init__(self, raw, at):
        self.last_analysis_json, self.last_analysis_at = raw, at

# ── snapshot_text: only a contemporaneous analysis ───────────────────────────
T0 = datetime(2026, 11, 1, 12, 0, 0)
raw = json.dumps({"verdict": "APPLY", "score": 8, "ran_at": "x"})
ok = cal.snapshot_text(J(raw, T0 - timedelta(hours=2)), T0)
check(ok is not None and json.loads(ok)["verdict"] == "APPLY" and json.loads(ok)["snapshot_analysis_at"] == (T0 - timedelta(hours=2)).isoformat(),
      "an analysis saved before the submission is snapshotted, stamped with the server's analysis time")
check(cal.snapshot_text(J(raw, T0 + timedelta(minutes=1)), T0) is None, "an analysis saved AFTER the submission is not snapshotted")
check(cal.snapshot_text(J(raw, T0), T0) is None, "an analysis at the same instant is not 'before'")
check(cal.snapshot_text(J(None, T0 - timedelta(hours=1)), T0) is None and cal.snapshot_text(J(raw, None), T0) is None, "no analysis, or an undated one: nothing")
check(cal.snapshot_text(J("not json", T0 - timedelta(hours=1)), T0) is None and cal.snapshot_text(J("[1]", T0 - timedelta(hours=1)), T0) is None, "unreadable analysis: nothing")
check(cal.snapshot_text(J(raw, T0 - timedelta(hours=1)), "2026-11-01T12:00:00Z") is not None, "an ISO 'Z' submission time (as the extension sends it) compares correctly")

# ── the real /proposal-submitted handler, on a scratch DB ────────────────────
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
fn = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "record_proposal_submitted"]
fn[0].decorator_list = []
engine = create_engine(f"sqlite:///{Path(tempfile.mkdtemp(prefix='fs_snap_')) / 'scratch.db'}")
Base.metadata.create_all(engine)
ns = {"Session": Session, "engine": engine, "Job": Job, "Proposal": Proposal, "HTTPException": HTTPException, "datetime": datetime,
      "timezone": timezone, "_calibration": cal, "_is_invite_response": lambda t: False, "_serialize_proposal": lambda p: {"id": p.id},
      "_snapshot_job": lambda j: "{}"}
exec(compile(ast.Module(body=fn, type_ignores=[]), "main_submitted", "exec"), ns)
submit = ns["record_proposal_submitted"]

def add_job(raw_json, at):
    with Session(engine) as s:
        j = Job(title="t", raw_message="x", source="api", last_analysis_json=raw_json, last_analysis_at=at)
        s.add(j); s.commit()
        return j.id
def body(jid, when):
    return {"job_id": jid, "bid_amount": "10", "bid_currency": "USD", "submitted_at": when.strftime("%Y-%m-%dT%H:%M:%SZ")}
def snap_of(jid):
    with Session(engine) as s:
        return s.query(Proposal).filter_by(job_id=jid).first().analysis_json

j1 = add_job(raw, T0 - timedelta(hours=2))
submit(body(j1, T0))
check(snap_of(j1) and json.loads(snap_of(j1))["verdict"] == "APPLY", "create path: a new proposal gets the snapshot")
# the job is analysed again later (different verdict); the update path must not overwrite
with Session(engine) as s:
    j = s.get(Job, j1); j.last_analysis_json = json.dumps({"verdict": "SKIP", "score": 1}); j.last_analysis_at = T0 - timedelta(minutes=5); s.commit()
submit(body(j1, T0 + timedelta(hours=1)))
check(json.loads(snap_of(j1))["verdict"] == "APPLY", "update path: a snapshot that is already set is never overwritten")

j2 = add_job(raw, T0 - timedelta(hours=2))
with Session(engine) as s:                                    # a placeholder row with no snapshot (older flow)
    s.add(Proposal(job_id=j2, sent_text="x", status="sent", sent_at=T0, status_updated_at=T0)); s.commit()
submit(body(j2, T0))
check(snap_of(j2) and json.loads(snap_of(j2))["verdict"] == "APPLY", "update path: an EMPTY snapshot is filled")

j3 = add_job(raw, T0 + timedelta(hours=3))                    # analysed after sending
submit(body(j3, T0))
check(snap_of(j3) is None, "an analysis made after the submission leaves the proposal NULL")
j4 = add_job(None, None)
submit(body(j4, T0))
check(snap_of(j4) is None, "a job that was never analysed leaves the proposal NULL")

# ── the card's numbers ───────────────────────────────────────────────────────
def P(verdict, score, status, at="2026-11-01T10:00:00", reply=None):
    return {"analysis_json": json.dumps(snap(verdict, score, at)), "status": status, "first_reply_at": reply}
rows = ([P("APPLY", 8, "replied")] * 4 + [P("APPLY", 8, "viewed")] * 3 + [P("APPLY", 8, "sent")] * 3          # 10: 4 replied, 7 opened
        + [P("SKIP", 2, "ghosted")] * 9                                                                       # 9: under n=10
        + [P("APPLY", 8, "replied", at="2026-11-13T10:00:00")] * 2)                                           # the later regime
res = cal.calibrate(rows)
by = {r["regime"]: r for r in res["regimes"]}
check(set(by) == {"before", "after"} and by["before"]["n"] == 19 and by["after"]["n"] == 2, "every row is split by regime (before / after 2026-11-12), never pooled")
a = [c for c in by["before"]["by_verdict"] if c["key"] == "APPLY"][0]
check(a["n"] == 10 and a["replied"] == 4 and a["reply_rate"] == 40.0 and a["opened"] == 7 and a["open_rate"] == 70.0, "reply rate 4/10, open rate 7/10 (replied counts as opened)")
s_ = [c for c in by["before"]["by_verdict"] if c["key"] == "SKIP"][0]
check(s_["n"] == 9 and s_["reply_rate"] is None and s_["open_rate"] is None, "n=9: no rate is given")
check(a["low_sample"] is True and by["after"]["total"]["low_sample"] is True, "n < 30 is marked low sample")
big = cal.calibrate([P("APPLY", 8, "replied")] * 30 + [P("APPLY", 8, "sent")] * 30)["regimes"][0]["total"]
check(big["n"] == 60 and big["low_sample"] is False and big["reply_rate"] == 50.0, "n >= 30 is not low sample")
check(by["after"]["total"]["reply_rate"] is None, "the 2-row regime shows n, not a percentage")
d = cal.calibrate([P("APPLY", 8, "declined")] * 10 + [P("APPLY", 8, "ghosted")] * 10)["regimes"][0]["total"]
check(d["opened"] == 0 and d["replied"] == 0, "declined and ghosted are not counted as opened (no real view signal)")
d2 = cal.calibrate([P("APPLY", 8, "declined", reply="2026-11-02T00:00:00")] * 10)["regimes"][0]["total"]
check(d2["replied"] == 10 and d2["opened"] == 0, "a declined proposal counts as a reply only when the client's message was recorded, still not as opened")
check({c["key"] for c in by["before"]["by_band"]} == {"7-8", "0-3"}, "score bands: 8 -> 7-8, 2 -> 0-3")
check(cal.band_of(3) == "0-3" and cal.band_of(4) == "4-6" and cal.band_of(6.5) == "4-6" and cal.band_of(9) == "9-10" and cal.band_of(10) == "9-10" and cal.band_of("x") == "unscored", "band edges")
und = cal.calibrate([{"analysis_json": json.dumps({"verdict": "APPLY", "score": 5}), "status": "sent", "first_reply_at": None}])
check([r["regime"] for r in und["regimes"]] == ["undated"], "a snapshot with no analysis date goes to its own 'undated' group, not into a regime")
check("among jobs you applied to" in res["caption"] and "not a gate" in res["caption"] and "Declined" in res["declined_note"], "the caption and the declined note say what they must")
check(cal.calibrate([])["regimes"] == [], "no snapshots -> no groups")

# ── the backfill tool ────────────────────────────────────────────────────────
spec = importlib.util.spec_from_file_location("backfill", ROOT / "tools" / "backfill_analysis_snapshots.py")
bf = importlib.util.module_from_spec(spec); spec.loader.exec_module(bf)
tdb = Path(tempfile.mkdtemp(prefix="fs_bf_")) / "x.db"
e2 = create_engine(f"sqlite:///{tdb}"); Base.metadata.create_all(e2)
with Session(e2) as s:
    def mk(raw_json, at, sub, existing=None):
        j = Job(title="t", raw_message="x", source="api", last_analysis_json=raw_json, last_analysis_at=at); s.add(j); s.flush()
        s.add(Proposal(job_id=j.id, sent_text="x", status="sent", sent_at=T0, status_updated_at=T0, submitted_at=sub, analysis_json=existing)); s.flush()
    mk(raw, T0 - timedelta(hours=1), T0)                 # contemporaneous -> written
    mk(raw, T0 + timedelta(hours=1), T0)                 # analysed after sending -> NULL
    mk(None, None, T0)                                   # never analysed -> NULL
    mk(raw, T0 - timedelta(hours=1), T0, existing='{"keep":1}')   # already set -> untouched
    s.commit()
def rows_now():
    c = sqlite3.connect(tdb); r = [x[0] for x in c.execute("SELECT analysis_json FROM proposals ORDER BY id")]; c.close(); return r
before = rows_now()
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    rc = bf.main([], db=tdb)
check(rc == 0 and rows_now() == before and "would snapshot: 1" in buf.getvalue() and "DRY RUN" in buf.getvalue(), "default run is a DRY RUN: it reports 1 and writes nothing")
empty = Path(tempfile.mkdtemp(prefix="fs_nobk_"))
with contextlib.redirect_stdout(buf):
    rc = bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
check(rc == 1 and rows_now() == before, "--apply REFUSES without a recent backup and writes nothing")
(empty / "upwork_jobs-20260101-0000.db").write_bytes(b"x")
old = time.time() - 7200
import os; os.utime(empty / "upwork_jobs-20260101-0000.db", (old, old))
with contextlib.redirect_stdout(buf):
    rc = bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
check(rc == 1 and rows_now() == before, "--apply REFUSES when the newest backup is older than the limit")
(empty / "upwork_jobs-20260102-0000.db").write_bytes(b"x")
with contextlib.redirect_stdout(buf):
    rc = bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
after = rows_now()
check(rc == 0 and after[0] and json.loads(after[0])["verdict"] == "APPLY" and after[1] is None and after[2] is None and after[3] == '{"keep":1}',
      "--apply with a fresh backup writes only the contemporaneous row; later/none stay NULL; an existing snapshot is untouched")
with contextlib.redirect_stdout(buf):
    bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
check(rows_now() == after, "running it again changes nothing (idempotent)")

# ── the generator never reads proposals.analysis_json ───────────────────────
tree = ast.parse(src)
allowed = {"create_proposal", "record_proposal_submitted", "_serialize_proposal", "calibration_card", "_ensure_job_columns"}   # save, display, card, schema migration
users = set()
for f in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
    for n in ast.walk(f):
        if (isinstance(n, ast.Attribute) and n.attr == "analysis_json") or (isinstance(n, ast.Constant) and n.value == "analysis_json") \
                or (isinstance(n, ast.keyword) and n.arg == "analysis_json"):
            users.add(f.name)
check(users <= allowed, f"in api/main.py only save / display / card code touches proposals.analysis_json (found: {sorted(users)})")
others = [p.name for p in (ROOT / "api").glob("*.py") if p.name not in ("main.py", "calibration.py") and re.search(r"(?<!last_)analysis_json", p.read_text(encoding="utf-8"))]
check(not others and not re.search(r"(?<!last_)analysis_json", (ROOT / "cli-bridge.js").read_text(encoding="utf-8")), f"no other backend module or the CLI bridge reads it (found: {others})")
fe = ROOT / "frontend" / "src"
hits = sorted(str(p.relative_to(fe)).replace("\\", "/") for p in list(fe.rglob("*.js")) + list(fe.rglob("*.jsx"))
              if re.search(r"(?<!last_)analysis_json", p.read_text(encoding="utf-8")))
check(hits == ["components/Outcomes.jsx"], f"in the frontend only the Outcomes display shows it; the generator (JobDetail.jsx, lib/*) does not (found: {hits})")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
