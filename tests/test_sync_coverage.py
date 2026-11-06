# -*- coding: utf-8 -*-
"""Proposals sync coverage, backend half (audit 2026-10-29, T5).

The extension (5.16) fixes the cause of the lost rows: it used to read the row's
AGE line ("last week") as its title. This pins what the backend does about it:

  * sync_runs records header_count (what Upwork says exists, "Submitted proposals
    (94)") and coverage = rows_scraped / header_count -- also for runs sent by an
    older extension, whose heading text is inside scroll.pager.section.headText;
  * the startup migration adds the two columns to an existing sync_runs table
    without losing rows;
  * a scraped "title" that is only an age can never pick a proposal. The title
    fallback is a fuzzy ilike('%...%'), so "last week" matched any job whose title
    merely contained those words, and a viewed flag then landed on the wrong one;
  * /sync-runs reports the new columns.

It runs the REAL functions lifted out of api/main.py (that file is never imported
by tests) against a scratch SQLite file; the live upwork_jobs.db is never opened.

Run: .venv\\Scripts\\python tests\\test_sync_coverage.py
"""
import ast
import json as _json_mod
import re
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import HTTPException                       # noqa: E402
from sqlalchemy import create_engine, or_               # noqa: E402
from sqlalchemy.orm import Session                      # noqa: E402
from db import Base, Job, Proposal, SyncRun             # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_clean_scraped_title", "_sync_header_count", "_sync_coverage", "proposal_status_sync",
              "list_sync_runs", "_ensure_job_columns"}
WANT_VARS = {"_REL_TIME_TITLE_RE", "_HEADER_COUNT_RE"}
nodes = []
for n in tree.body:
    if isinstance(n, ast.FunctionDef) and n.name in WANT_FUNCS:
        n.decorator_list = []                            # drop @app.post -- there is no app here
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT_VARS for t in n.targets):
        nodes.append(n)
got = {getattr(n, "name", None) or n.targets[0].id for n in nodes}
if got != (WANT_FUNCS | WANT_VARS):
    print(f"FAIL  could not lift the sync helpers from api/main.py (missing {sorted((WANT_FUNCS | WANT_VARS) - got)})")
    sys.exit(1)

tmpdir = Path(tempfile.mkdtemp(prefix="fs_sync_cov_"))
engine = create_engine(f"sqlite:///{tmpdir / 'scratch.db'}")
Base.metadata.create_all(engine)

# typing names used in annotations of the lifted functions
from typing import Optional                              # noqa: E402
from fastapi import Query                                # noqa: E402
ns = {"re": re, "_json_mod": _json_mod, "Session": Session, "engine": engine, "Job": Job, "Proposal": Proposal,
      "SyncRun": SyncRun, "or_": or_, "datetime": datetime, "timezone": timezone, "HTTPException": HTTPException,
      "Optional": Optional, "Query": Query,
      # the promotion path calls nothing else from main.py
      }
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_helpers", "exec"), ns)
clean_title, header_count, coverage = ns["_clean_scraped_title"], ns["_sync_header_count"], ns["_sync_coverage"]
sync, list_runs, ensure_cols = ns["proposal_status_sync"], ns["list_sync_runs"], ns["_ensure_job_columns"]

# ── the title guard ─────────────────────────────────────────────────────────
for t in ("last week", "last month", "Last Week", "  last   month ", "2 quarters ago", "4 days ago", "yesterday",
          "just now", "an hour ago", "about 3 weeks ago", "this year", ""):
    check(clean_title(t) == "", f'"{t}" is not a title -> ""')
for t in ("SEO Audit and Website Optimization", "Google Ads for the last week of the month sale",
          "Fix tracking broken a year ago", "Last Mile Delivery Google Ads", None):
    check(clean_title(t) == ((t or "").strip()), f'"{t}" is a real title and is kept')
check(clean_title("  Multi   space\ttitle ") == "Multi space title", "whitespace is collapsed")

# ── header count and coverage ───────────────────────────────────────────────
check(header_count({"header_count": 94}) == 94, "header_count from the 5.16 payload")
check(header_count({"header_count": "94"}) == 94, "…as a string too")
check(header_count({"header_count": 0}) is None and header_count({"header_count": -3}) is None and header_count({"header_count": None}) is None,
      "0, negative and missing are 'unknown', never a divide-by-zero")
check(header_count({"scroll": {"pager": {"headerCount": 91}}}) == 91, "from scroll.pager.headerCount")
old_run_554 = {"scroll": {"pager": {"section": {"headText": "Submitted proposals  (90)"}}}}
check(header_count(old_run_554) == 90, "from an OLD extension's heading text (run 554's payload shape) -> 90")
check(header_count({"scroll": {"pager": {"section": {"headText": "Active proposals  (13)"}}}}) is None, "the Active heading is not read")
check(header_count({"scroll": "garbage"}) is None and header_count({}) is None, "malformed or empty payloads -> None")
check(coverage(19, 90) == 0.2111 and coverage(94, 94) == 1.0 and coverage(81, 94) == 0.8617, "coverage = rows / header, 4 places (19/90, 94/94, 81/94)")
check(coverage(5, None) is None and coverage(5, 0) is None, "no header count -> no coverage")

# ── the endpoint, end to end, on the scratch DB ─────────────────────────────
def add_job_and_proposal(session, title, job_hex, status="sent", pid=None):
    job = Job(title=title, upwork_job_id=job_hex, raw_message="x")
    session.add(job); session.flush()
    p = Proposal(job_id=job.id, sent_text="letter", status=status, upwork_proposal_id=pid)
    session.add(p); session.commit()
    return p.id

with Session(engine) as s:
    decoy = add_job_and_proposal(s, "Google Ads fix we needed last week of campaign", "~aaaa1111aaaa1111aaaa", "sent")
    real = add_job_and_proposal(s, "SEO Audit for Florist", "~bbbb2222bbbb2222bbbb", "sent", pid="2061000000000000001")

def status_of(pid):
    with Session(engine) as s:
        return s.get(Proposal, pid).status

# 1. Old extension (<= 5.15): the row's "title" is "last week". Before the guard this
#    matched the decoy by substring and a viewed flag promoted the wrong proposal.
r = sync({"rows": [{"job_title": "last week", "viewed": True, "upwork_job_id": None, "upwork_proposal_id": None}],
          "scroll": old_run_554["scroll"]})
check(status_of(decoy) == "sent" and r["updated"] == 0 and r["not_matched_count"] == 1,
      "a row titled 'last week' (extension 5.15) matches nothing: the lookalike job stays 'sent'")
check(r["header_count"] == 90 and r["coverage"] == round(1 / 90, 4) and r["sync_run_logged"] is True,
      f"…and the run still records header_count 90 and coverage from the old payload ({r['header_count']}, {r['coverage']})")

# 2. A 5.16 payload: link title + proposal id, header_count sent explicitly.
rows = [{"job_title": "SEO Audit for Florist", "viewed": True, "upwork_proposal_id": "2061000000000000001", "upwork_job_id": None}]
r = sync({"rows": rows, "header_count": 4, "scroll": {"pager": {"headerCount": 4}}})
check(status_of(real) == "viewed" and r["updated"] == 1 and r["newly_viewed"] == 1, "a proper row still matches by proposal id and is promoted")
check(r["header_count"] == 4 and r["coverage"] == 0.25, f"header_count 4, coverage 0.25 (1 row of 4) in the response ({r['header_count']}, {r['coverage']})")

# 3. The stored run rows carry the columns; the listing shows them.
with Session(engine) as s:
    runs = s.query(SyncRun).order_by(SyncRun.id).all()
check(len(runs) == 2 and runs[0].header_count == 90 and runs[0].coverage == round(1 / 90, 4) and runs[1].header_count == 4 and runs[1].coverage == 0.25,
      "sync_runs rows store header_count and coverage")
listing = list_runs(limit=10, leg="proposals-list")
check(listing["runs"][0]["header_count"] == 4 and listing["runs"][0]["coverage"] == 0.25 and "header_count" in listing["runs"][1],
      "/sync-runs lists header_count and coverage")

# 4. A run with no rows (failure report) has nothing to measure.
r = sync({"rows": [], "scroll": {"failed": True, "stage": "x"}, "header_count": 94})
check(r["header_count"] is None and r["coverage"] is None, "an empty/failed report records no header count or coverage")

# 5. Garbage in the rows list must not break the run record.
r = sync({"rows": [None, "x", {"job_title": ""}], "header_count": 10})
check(r["sync_run_logged"] is True and r["scanned"] == 3, "non-dict rows are skipped and the run is still logged")

# ── the startup migration on an OLD sync_runs table ─────────────────────────
# Built from the real schema, then the two new columns are dropped: that is exactly
# what the live database looked like before T5.
def make_db(name):
    path = tmpdir / name
    eng = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(eng)
    eng.dispose()
    return path

old_db = make_db("old.db")
con = sqlite3.connect(old_db)
con.execute("ALTER TABLE sync_runs DROP COLUMN header_count")
con.execute("ALTER TABLE sync_runs DROP COLUMN coverage")
con.execute("INSERT INTO sync_runs (ts, leg, rows_scraped, matched, not_matched, newly_viewed, scroll_json) "
            "VALUES ('2026-10-29 11:09:00', 'proposals-list', 19, 18, 1, 0, "
            "'{\"pager\": {\"section\": {\"headText\": \"Submitted proposals  (90)\"}}}')")
con.commit()
before_cols = {r[1] for r in con.execute("PRAGMA table_info(sync_runs)")}
con.close()
check("header_count" not in before_cols and "coverage" not in before_cols, "(setup) the scratch database has the pre-T5 sync_runs schema")

ns["engine"] = create_engine(f"sqlite:///{old_db}")
ensure_cols()
con = sqlite3.connect(old_db)
cols = {r[1] for r in con.execute("PRAGMA table_info(sync_runs)")}
row = con.execute("SELECT rows_scraped, header_count, coverage, scroll_json FROM sync_runs").fetchone()
con.close()
check({"header_count", "coverage"} <= cols, "the migration adds header_count and coverage to an existing sync_runs table")
check(row[0] == 19 and row[1] is None and row[2] is None and "(90)" in row[3], "…and keeps the old row as it was (header_count NULL: the past is not rewritten)")
ensure_cols()
con = sqlite3.connect(old_db)
n = con.execute("SELECT COUNT(*) FROM sync_runs").fetchone()[0]
con.close()
check(n == 1, "…and running it twice is harmless")

# After migrating, the model can read and write the old table.
with Session(ns["engine"]) as s2:
    s2.add(SyncRun(leg="proposals-list", rows_scraped=94, header_count=94, coverage=1.0)); s2.commit()
    check(s2.query(SyncRun).count() == 2, "the ORM writes the migrated table")

# A database with no sync_runs table at all must not crash the migration
# (create_all makes the table, complete, on that path).
bare = make_db("bare.db")
con = sqlite3.connect(bare)
con.execute("DROP TABLE sync_runs")
con.commit(); con.close()
ns["engine"] = create_engine(f"sqlite:///{bare}")
try:
    ensure_cols()
    check(True, "a database without a sync_runs table does not crash the migration")
except Exception as e:                                   # noqa: BLE001
    check(False, f"a database without a sync_runs table crashed the migration: {e}")

# the model and the migration agree on the columns
model_cols = {c.name for c in SyncRun.__table__.columns}
check({"header_count", "coverage"} <= model_cols, "db.SyncRun declares both columns")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
