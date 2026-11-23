# -*- coding: utf-8 -*-
"""Task 9.2/9.6 (owner, 2026-11-24): one bad row must never cost the other rows in
the same cycle. Before this fix, _upsert_api_jobs built the WHOLE batch inside one
shared session.commit() -- a single row that failed to bind (e.g. a list value in a
String column) raised on that one shared commit, losing every other job in the
cycle too, and the caller (_api_feed_loop) counted the whole cycle as a failure.

Lifts the REAL _upsert_api_jobs (and its helper _coerce_row_for_insert) out of
api/main.py by AST, same pattern as test_focus_filter_wiring.py, and runs it
against a real scratch SQLite DB with a row that still carries a raw list value
(simulating a mapping bug upwork_api.py's own normalization did NOT catch -- the
second, independent line of defense this task asks for).

Run: .venv\\Scripts\\python tests\\test_api_feed_insert_isolation.py
"""
import ast
import json as _json_mod
import sys
import types
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_upsert_api_jobs", "_coerce_row_for_insert"}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT_FUNCS]
if {n.name for n in nodes} != WANT_FUNCS:
    print(f"FAIL  could not lift {sorted(WANT_FUNCS)} from api/main.py (found {[n.name for n in nodes]})")
    sys.exit(1)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

from datetime import datetime, timezone  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from db import Base, Job, FeedDrop  # noqa: E402


def make_ns():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    fake_upwork_api = types.SimpleNamespace(load_feed_config=lambda: {"focus_test": None})
    ns = {"Job": Job, "FeedDrop": FeedDrop, "Session": Session, "engine": engine,
          "datetime": datetime, "timezone": timezone, "upwork_api": fake_upwork_api,
          "_json_mod": _json_mod}
    sys.modules["upwork_api"] = fake_upwork_api
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_upsert_isolation", "exec"), ns)
    return ns, engine


# ── 9.6: one of three rows has a raw list value that upwork_api.py's own
# normalization did NOT catch -- a defense-in-depth check, not the primary fix.
# The other two must still save; the bad one is coerced to a string and saved too
# (NOT lost), and the cycle still reports success (inserted=3, no exception raised).
ns, engine = make_ns()
rows = [
    {"upwork_job_id": "~a1", "title": "Google Ads Specialist", "description_full": "seo",
     "raw_message": "seo", "source": "api"},
    {"upwork_job_id": "~a2", "title": "SEO Audit Needed", "description_full": "seo",
     "raw_message": "seo", "source": "api",
     "geo_restriction": ["Poland", "Romania", "Ukraine"]},  # the bad row: still a raw list
    {"upwork_job_id": "~a3", "title": "PPC Expert", "description_full": "ppc",
     "raw_message": "ppc", "source": "api"},
]
ins, skip, errs = ns["_upsert_api_jobs"](rows)
check(ins == 3 and skip == 0, f"all three rows are inserted, including the bad one (ins={ins} skip={skip})")
check(errs == 0, f"the bad row was coerced to a string and saved cleanly -- NOT an insert-error (errs={errs})")
with Session(engine) as s:
    a2 = s.query(Job).filter_by(upwork_job_id="~a2").first()
    check(a2 is not None and a2.geo_restriction == "Poland, Romania, Ukraine",
          f"the list was coerced to a plain joined string before insert: {a2.geo_restriction if a2 else None!r}")
    check(s.query(Job).filter_by(upwork_job_id="~a1").first() is not None
          and s.query(Job).filter_by(upwork_job_id="~a3").first() is not None,
          "the other two rows (no bad field at all) were never at risk and are both present")

# ── a row that fails for a DIFFERENT, uncoercible reason is isolated too: logged,
# recorded in feed_drops as an insert-error, and does not take the other rows down.
ns2, engine2 = make_ns()
rows2 = [
    {"upwork_job_id": "~b1", "title": "Google Ads Specialist", "description_full": "seo",
     "raw_message": "seo", "source": "api"},
    # raw_message is NOT NULL in the schema; omitting it is a genuine, uncoercible failure.
    {"upwork_job_id": "~b2", "title": "Broken Row", "description_full": "seo", "source": "api"},
    {"upwork_job_id": "~b3", "title": "PPC Expert", "description_full": "ppc",
     "raw_message": "ppc", "source": "api"},
]
ins2, skip2, errs2 = ns2["_upsert_api_jobs"](rows2)
check(ins2 == 2 and errs2 == 1, f"the two good rows are inserted, the one genuinely-bad row is isolated as an insert-error (ins={ins2} errs={errs2})")
with Session(engine2) as s:
    check(s.query(Job).filter_by(upwork_job_id="~b1").first() is not None
          and s.query(Job).filter_by(upwork_job_id="~b3").first() is not None,
          "both good rows survived even though a different row in the SAME cycle failed")
    check(s.query(Job).filter_by(upwork_job_id="~b2").first() is None, "the genuinely-bad row itself was not inserted")
    drop = s.query(FeedDrop).filter_by(upwork_job_id="~b2").first()
    check(drop is not None and drop.reason.startswith("insert-error:"),
          f"the bad row is recorded in feed_drops with reason starting 'insert-error:': {drop.reason if drop else None!r}")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
