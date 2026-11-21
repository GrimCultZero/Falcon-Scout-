# -*- coding: utf-8 -*-
"""_prune_jobs retention bugfix (Task 0b.8a, 2026-11-21).

Found while investigating the owner's "Hidden by focus: 35" vs. the Task 0
report's "678 hidden" discrepancy: _prune_jobs()'s "keep" subquery only
selected `hidden_at IS NULL` rows, so EVERY hidden job with no proposal and
not starred was a deletion candidate on the next prune run (startup, or every
6h) -- not just un-hidden, DELETED from the jobs table outright. This is why
the 669 jobs Task 0.4 retroactively hid on 2026-11-21 vanished from the live
DB within hours: feed_drops still had all their "focus:<category>" rows
(a separate table, never pruned), but jobs.hidden_at count collapsed from
678 to 10.

Runs the REAL _prune_jobs lifted out of api/main.py (that file is never
imported by tests) against a scratch SQLite file; the live upwork_jobs.db is
never opened, never written to.

Run: .venv\\Scripts\\python tests\\test_prune_jobs.py
"""
import ast
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine                     # noqa: E402
from sqlalchemy.orm import Session                        # noqa: E402
from db import Base, Job, Proposal, FeedDrop                # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_prune_jobs"}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT_FUNCS]
got = {n.name for n in nodes}
if got != WANT_FUNCS:
    print(f"FAIL  could not lift _prune_jobs from api/main.py (missing {sorted(WANT_FUNCS - got)})")
    sys.exit(1)

tmpdir = Path(tempfile.mkdtemp(prefix="fs_prune_"))
engine = create_engine(f"sqlite:///{tmpdir / 'scratch.db'}")
Base.metadata.create_all(engine)

ns = {"engine": engine, "print": print, "_JOB_RETAIN_RECENT": 2000, "_JOB_PRUNE_FOCUS_HIDDEN_AGE_DAYS": 45}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_helpers", "exec"), ns)
prune_jobs = ns["_prune_jobs"]

NOW = datetime.now(timezone.utc).replace(tzinfo=None)
OLD = NOW - timedelta(days=30)


def seed(**rows):
    with Session(engine) as session:
        for key, kw in rows.items():
            base = {"upwork_job_id": f"~{key}", "title": key, "raw_message": "x", "captured_at": OLD}
            base.update(kw)
            session.add(Job(**base))
        session.commit()


seed(
    hidden_no_proposal=dict(hidden_at=OLD),                               # the exact shape of the 669 Task 0.4 jobs
    hidden_recent=dict(hidden_at=NOW),
    starred_old=dict(starred_at=OLD),
    plain_old=dict(),                                                     # genuinely prunable: old, untouched, not hidden
)

deleted = prune_jobs(keep_recent=0)  # keep_recent=0: nothing is "recent", isolates the hidden/starred/proposal protections

with Session(engine) as session:
    remaining = {j.upwork_job_id[1:] for j in session.query(Job).all()}

check("hidden_no_proposal" in remaining, "a hidden job with no proposal and not starred survives pruning (the 0b.8a bug)")
check("hidden_recent" in remaining, "a recently-hidden job survives pruning")
check("starred_old" in remaining, "a starred job still survives pruning (unchanged behavior)")
check("plain_old" not in remaining, "a plain old, never-touched, never-hidden job is still pruned (unchanged behavior)")
check(deleted == 1, f"exactly the one prunable row was deleted (got {deleted})")

# a job with a proposal is never pruned even if old, hidden, and unstarred together
with Session(engine) as session:
    j = session.query(Job).filter_by(upwork_job_id="~hidden_no_proposal").first()
    session.add(Proposal(job_id=j.id, sent_text="x", status="sent", submitted_at=OLD))
    session.commit()
deleted2 = prune_jobs(keep_recent=0)
with Session(engine) as session:
    still_there = session.query(Job).filter_by(upwork_job_id="~hidden_no_proposal").first() is not None
check(still_there and deleted2 == 0, "a job with a proposal row is protected regardless of hidden/starred state")

# ── D1 (owner, 2026-11-21): focus-hidden jobs age out after 45 days ──────────
VERY_OLD = NOW - timedelta(days=46)
JUST_OLD = NOW - timedelta(days=44)

seed(
    focus_hidden_old=dict(hidden_at=VERY_OLD),       # focus-hidden, past the 45-day limit -> prunable
    focus_hidden_young=dict(hidden_at=JUST_OLD),      # focus-hidden, still inside the limit -> protected
    manually_hidden_old=dict(hidden_at=VERY_OLD),     # hidden, past the limit, but NOT by the focus test -> protected forever
    focus_hidden_old_starred=dict(hidden_at=VERY_OLD, starred_at=VERY_OLD),  # focus-hidden + starred -> protected regardless of age
)
with Session(engine) as session:
    session.add(FeedDrop(upwork_job_id="~focus_hidden_old", title="x", reason="focus:no-signal"))
    session.add(FeedDrop(upwork_job_id="~focus_hidden_young", title="x", reason="focus:webdev"))
    session.add(FeedDrop(upwork_job_id="~focus_hidden_old_starred", title="x", reason="focus:design"))
    # manually_hidden_old has NO feed_drops "focus:*" row -- a real manual hide leaves none.
    session.commit()

deleted3 = prune_jobs(keep_recent=0)
with Session(engine) as session:
    remaining3 = {j.upwork_job_id[1:] for j in session.query(Job).all()}

check("focus_hidden_old" not in remaining3, "D1: a focus-hidden job past the 45-day limit, no proposal, not starred, IS pruned")
check("focus_hidden_young" in remaining3, "D1: a focus-hidden job still within 45 days survives")
check("manually_hidden_old" in remaining3, "D1: a MANUALLY hidden job (no focus:* feed_drops row) survives past 45 days -- only starring/a proposal ages it out, same as before")
check("focus_hidden_old_starred" in remaining3, "D1: a focus-hidden job past 45 days but STARRED still survives")
check(deleted3 == 1, f"D1: exactly the one aged-out focus-hidden row was deleted (got {deleted3})")

print()
print("all pass" if bad == 0 else f"{bad} FAILURES")
sys.exit(1 if bad else 0)
