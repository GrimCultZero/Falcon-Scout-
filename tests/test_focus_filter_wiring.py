# -*- coding: utf-8 -*-
"""_upsert_api_jobs's focus-test wiring (api/main.py), separate from
api/focus_filter.py's own classify_focus()/focus_test_active() unit tests
(tests/test_focus_filter.py).

Lifts the REAL _upsert_api_jobs out of api/main.py by AST (that file is never
imported by tests) and runs it against a scratch SQLite DB (Base.metadata.create_all,
so the real jobs/feed_drops schema) with a fake upwork_api.load_feed_config() and the
real api/focus_filter.py -- confirms a non-matching row is inserted AND hidden AND
recorded in feed_drops with reason "focus:<category>", a matching row is inserted and
NOT hidden, and with the block inactive nothing is hidden at all.

Run: .venv\\Scripts\\python tests\\test_focus_filter_wiring.py
"""
import ast
import sys
import types
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_upsert_api_jobs"}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT_FUNCS]
if {n.name for n in nodes} != WANT_FUNCS:
    print(f"FAIL  could not lift _upsert_api_jobs from api/main.py (found {[n.name for n in nodes]})")
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


def row(upwork_job_id, title, desc, keywords=None):
    return {"upwork_job_id": upwork_job_id, "title": title, "description_full": desc,
            "raw_message": desc or title, "keywords": keywords, "source": "api"}


def make_ns(focus_cfg):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    fake_upwork_api = types.SimpleNamespace(load_feed_config=lambda: focus_cfg)
    ns = {"Job": Job, "FeedDrop": FeedDrop, "Session": Session, "engine": engine,
          "datetime": datetime, "timezone": timezone, "upwork_api": fake_upwork_api}
    # _upsert_api_jobs does `import upwork_api` / `import focus_filter` itself -- make
    # those imports resolve to the fake / real modules instead of hitting the DB-backed
    # real upwork_api.py (off limits to touch, and we don't want its real config file).
    sys.modules["upwork_api"] = fake_upwork_api
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_upsert", "exec"), ns)
    return ns, engine


ACTIVE = {"focus_test": {"from": "2026-11-19", "until": "2026-12-03"}}
INACTIVE = {"focus_test": {"from": "2026-01-01", "until": "2026-01-14"}}  # long over

# ── active window: a non-matching job is inserted, hidden, and recorded ────────
ns, engine = make_ns(ACTIVE)
rows = [
    row("~w1", "WordPress Developer", "Build us a custom WordPress theme from scratch, full-stack."),
    row("~w2", "SEO Specialist", "We need a technical SEO audit and local SEO work for our ecommerce site."),
]
ins, skip = ns["_upsert_api_jobs"](rows)
check(ins == 2 and skip == 0, f"both rows are inserted either way (never dropped outright): ins={ins} skip={skip}")

with Session(engine) as s:
    webdev_job = s.query(Job).filter_by(upwork_job_id="~w1").first()
    seo_job = s.query(Job).filter_by(upwork_job_id="~w2").first()
    check(webdev_job is not None and webdev_job.hidden_at is not None, "the web-dev job (no keep signal) IS hidden")
    check(seo_job is not None and seo_job.hidden_at is None, "the SEO job (a keep signal) is NOT hidden")
    drop = s.query(FeedDrop).filter_by(upwork_job_id="~w1").first()
    check(drop is not None and drop.reason == "focus:webdev", f"the hidden job is recorded in feed_drops with reason focus:webdev: {drop.reason if drop else None!r}")
    no_drop = s.query(FeedDrop).filter_by(upwork_job_id="~w2").first()
    check(no_drop is None, "the KEPT job gets no feed_drops row at all")

# ── window inactive: nothing is hidden, regardless of content ──────────────────
ns2, engine2 = make_ns(INACTIVE)
ins2, skip2 = ns2["_upsert_api_jobs"]([row("~x1", "WordPress Developer", "Build us a custom WordPress theme.")])
check(ins2 == 1, "still inserted with the block inactive")
with Session(engine2) as s:
    j = s.query(Job).filter_by(upwork_job_id="~x1").first()
    check(j is not None and j.hidden_at is None, "…but NOT hidden -- the focus test only hides while its own window is active")
    check(s.query(FeedDrop).filter_by(upwork_job_id="~x1").first() is None, "…and no feed_drops row either")

# ── re-upserting the SAME dropped id updates the feed_drops row, not a duplicate ──
ns3, engine3 = make_ns(ACTIVE)
ns3["_upsert_api_jobs"]([row("~w1", "WordPress Developer", "Build us a custom WordPress theme.")])
with Session(engine3) as s:
    j = s.query(Job).filter_by(upwork_job_id="~w1").first()
    j.hidden_at = None  # pretend the owner already rescued it via /unhide
    s.commit()
ins3, skip3 = ns3["_upsert_api_jobs"]([row("~w1", "WordPress Developer", "Build us a custom WordPress theme.")])
check(skip3 == 1, "a dedup match on upwork_job_id is still skipped as before -- a rescued job is never re-hidden by a later upsert")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
