# -*- coding: utf-8 -*-
"""feed_drops and the feed_tag column (audit 2026-10-29, T18).

Nothing recorded what the API feed filtered out, so a wrongly dropped in-lane job
could only be found by searching Upwork by hand. Pinned here, running the REAL
functions lifted out of api/main.py (that file is never imported by tests) on a
scratch SQLite file; the live upwork_jobs.db is never opened:

  * _record_feed_drops: one row per posting (upsert), postings already stored as
    jobs are skipped, rows older than 7 days are deleted, more than SQLite's bound-
    variable limit is fine, and it never raises;
  * GET /feed-drops: the last 24 h grouped by reason, "text" groups (where an
    in-lane miss would be) before the "policy" floors, each row with its Upwork link;
  * jobs.feed_tag: the startup migration adds it to an existing database without
    losing rows, and the model, the serializer and the insert path carry it.

Run: .venv\\Scripts\\python tests\\test_feed_drops.py
"""
import ast
import re
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import Query                                   # noqa: E402
from sqlalchemy import create_engine                        # noqa: E402
from sqlalchemy.orm import Session                          # noqa: E402
from db import Base, FeedDrop, Job                          # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
WANT_FUNCS = {"_record_feed_drops", "feed_drops", "_ensure_job_columns"}
WANT_VARS = {"_FEED_DROP_RETENTION_DAYS", "_FEED_DROP_POLICY"}
nodes = []
for n in tree.body:
    if isinstance(n, ast.FunctionDef) and n.name in WANT_FUNCS:
        n.decorator_list = []
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT_VARS for t in n.targets):
        nodes.append(n)
got = {getattr(n, "name", None) or n.targets[0].id for n in nodes}
if got != (WANT_FUNCS | WANT_VARS):
    print(f"FAIL  could not lift the feed_drops code from api/main.py (missing {sorted((WANT_FUNCS | WANT_VARS) - got)})")
    sys.exit(1)

tmp = Path(tempfile.mkdtemp(prefix="fs_feed_drops_"))
def make_engine(name):
    eng = create_engine(f"sqlite:///{tmp / name}")
    Base.metadata.create_all(eng)
    return eng

engine = make_engine("scratch.db")
ns = {"Session": Session, "engine": engine, "Job": Job, "FeedDrop": FeedDrop, "datetime": datetime, "timedelta": timedelta,
      "timezone": timezone, "Query": Query}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_feed_drops", "exec"), ns)
record, view, ensure_cols = ns["_record_feed_drops"], ns["feed_drops"], ns["_ensure_job_columns"]
def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)
def drop(uid, title="Some job", reason="no-keyword-in-text", posted="2026-11-09T08:00:00Z"):
    return {"upwork_job_id": uid, "title": title, "reason": reason, "posted_date": posted}
def rows():
    with Session(engine) as s:
        return {r.upwork_job_id: r for r in s.query(FeedDrop).all()}

# ── recording ───────────────────────────────────────────────────────────────
record([drop("~1", "Google Page indexing Task"), drop("~2", "Writer for blog", "stopword:writer"), drop("~3", "Cheap gig", "hourly<25")])
r = rows()
check(set(r) == {"~1", "~2", "~3"} and r["~2"].reason == "stopword:writer" and r["~1"].title == "Google Page indexing Task" and r["~1"].posted_date == "2026-11-09T08:00:00Z",
      "every dropped row is recorded with title, reason and posted date")
first_seen = r["~1"].fetched_at
check(first_seen is not None and abs((utcnow() - first_seen).total_seconds()) < 60, "fetched_at is stamped (UTC)")

import time; time.sleep(1.1)
record([drop("~1", "Google Page indexing Task (edited)", "stopword:writer")])
r = rows()
check(len(r) == 3 and r["~1"].reason == "stopword:writer" and r["~1"].fetched_at > first_seen and r["~1"].title.endswith("(edited)"),
      "the same posting fetched again is ONE row, with the newest reason, title and fetched_at")

with Session(engine) as s:
    s.add(Job(title="Kept already", upwork_job_id="~stored", raw_message="x", source="api"))
    s.commit()
record([drop("~stored", "Kept already", "posted>72h")])
check("~stored" not in rows(), "a posting already stored as a job is not recorded (a kept job that ages out is not a miss)")

record([{"title": "no id at all", "reason": "x"}, drop("", "empty id"), drop(None, "none id")])
check(len(rows()) == 3, "rows without an id are ignored")
record(None)
record([])
record([{"upwork_job_id": "~9"}])
check("~9" in rows() and rows()["~9"].reason == "?", "a row with no reason is still recorded (reason '?'), not a crash")

# retention: 7 days
with Session(engine) as s:
    s.add(FeedDrop(upwork_job_id="~old", title="Eight days ago", reason="no-keyword-in-text", fetched_at=utcnow() - timedelta(days=8)))
    s.add(FeedDrop(upwork_job_id="~edge", title="Six days ago", reason="no-keyword-in-text", fetched_at=utcnow() - timedelta(days=6)))
    s.commit()
record([drop("~4")])
r = rows()
check("~old" not in r and "~edge" in r, "rows older than 7 days are deleted on the next record, 6-day-old rows stay")

# more rows than SQLite's bound-variable limit in one fetch
big = [drop(f"~big{i}", f"Job {i}") for i in range(1200)]
record(big)
check(sum(1 for k in rows() if k.startswith("~big")) == 1200, "1,200 dropped rows in one fetch are all recorded (chunked lookups)")
record(big)
check(sum(1 for k in rows() if k.startswith("~big")) == 1200, "…and recording them again adds no duplicates")

# never raises
class Boom:
    def __init__(self, *a, **k):
        raise RuntimeError("database is locked")
ns["Session"] = Boom
try:
    record([drop("~z")])
    check(True, "a database error while recording does not raise (it must never fail a fetch)")
except Exception as e:                                       # noqa: BLE001
    check(False, f"recording raised: {e}")
ns["Session"] = Session

# ── the 24 h view ───────────────────────────────────────────────────────────
engine2 = make_engine("view.db")
ns["engine"] = engine2
def put(uid, title, reason, hours_ago):
    with Session(engine2) as s:
        s.add(FeedDrop(upwork_job_id=uid, title=title, reason=reason, posted_date=None, fetched_at=utcnow() - timedelta(hours=hours_ago)))
        s.commit()
put("~a1", "Google Page indexing Task", "no-keyword-in-text", 1)
put("~a2", "Some design job", "no-keyword-in-text", 2)
put("~a3", "Python developer", "no-keyword-in-text", 3)
put("~b1", "Meta Ads Specialist", "stopword:meta ads", 1)
put("~b2", "Facebook Ads Manager", "stopword:facebook", 2)
put("~b3", "Another Meta job", "stopword:meta ads", 4)
put("~c1", "Cheap hourly", "hourly<25", 1)
put("~c2", "Cheap fixed", "fixed<100", 1)
put("~c3", "Unverified client", "unverified-payment", 1)
put("~c4", "Old posting", "posted>72h", 1)
put("~c5", "India job", "country:india", 1)
put("~old", "Yesterday and a bit", "no-keyword-in-text", 30)
v = view(hours=24, per_group=200)
reasons = [g["reason"] for g in v["groups"]]
check(v["total"] == 11 and v["hours"] == 24 and v["retention_days"] == 7, f"24 h window: 11 rows, the 30-hour-old one is out (total {v['total']})")
check(reasons[0] == "no-keyword-in-text" and v["groups"][0]["count"] == 3, "the no-keyword group comes FIRST (that is where an in-lane miss would be)")
check(reasons[1:3] == ["stopword:meta ads", "stopword:facebook"], f"then the stop-word groups, biggest first ({reasons[1:3]})")
check({g["kind"] for g in v["groups"][:3]} == {"text"} and {g["kind"] for g in v["groups"][3:]} == {"policy"} and len(v["groups"]) == 8,
      "rate, payment, age and country groups are 'policy' and come last")
g0 = v["groups"][0]["rows"]
check(g0[0]["upwork_job_id"] == "~a1" and g0[0]["url"] == "https://www.upwork.com/jobs/~a1" and g0[0]["title"] == "Google Page indexing Task", "each row carries its Upwork link; newest first")
check(view(hours=72, per_group=200)["total"] == 12, "a longer window (72 h) includes the older row")
capped = view(hours=24, per_group=1)
check(capped["groups"][0]["count"] == 3 and len(capped["groups"][0]["rows"]) == 1, "per_group caps the rows listed but still reports the true count")
check(view(hours=1, per_group=200)["total"] >= 0, "a 1 h window works")
ns["engine"] = make_engine("empty.db")
check(view(hours=24, per_group=200) == {"hours": 24, "retention_days": 7, "total": 0, "groups": []}, "no drops -> an empty, well-formed answer")

# ── jobs.feed_tag ───────────────────────────────────────────────────────────
check("feed_tag" in {c.name for c in Job.__table__.columns}, "the Job model has feed_tag")
eng3 = make_engine("tagged.db")
with Session(eng3) as s:
    s.add(Job(title="GA4 setup", upwork_job_id="~t1", raw_message="x", source="api", feed_tag="tracking"))
    s.add(Job(title="Google Ads", upwork_job_id="~t2", raw_message="x", source="api"))
    s.commit()
    got_tags = {j.upwork_job_id: j.feed_tag for j in s.query(Job)}
check(got_tags == {"~t1": "tracking", "~t2": None}, "feed_tag is stored; rows without a tag stay NULL")
ins = dict(upwork_job_id="~t3", title="x", raw_message="x", source="api", feed_tag="gbp")
with Session(eng3) as s:
    s.add(Job(**ins)); s.commit()
check(True, "Job(**row) accepts the feed_tag key the fetch adds to kept rows (the insert path)")

# the startup migration on a database from before T18
old = tmp / "old.db"
eng_old = create_engine(f"sqlite:///{old}")
Base.metadata.create_all(eng_old)
con = sqlite3.connect(old)
con.execute("INSERT INTO jobs (title, upwork_job_id, raw_message, source, enrich_attempts) VALUES ('Old job', '~o1', 'x', 'api', 0)")
con.execute("DROP TABLE feed_drops")
con.execute("ALTER TABLE jobs DROP COLUMN feed_tag")
con.commit()
cols_before = {r[1] for r in con.execute("PRAGMA table_info(jobs)")}
con.close()
check("feed_tag" not in cols_before, "(setup) the scratch database has the pre-T18 jobs schema and no feed_drops table")
ns["engine"] = create_engine(f"sqlite:///{old}")
ensure_cols()
Base.metadata.create_all(ns["engine"])          # what main.py does at import, before the migration
con = sqlite3.connect(old)
cols = {r[1] for r in con.execute("PRAGMA table_info(jobs)")}
rows_after = con.execute("SELECT title, feed_tag FROM jobs").fetchall()
tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
con.close()
check("feed_tag" in cols and rows_after == [("Old job", None)], "the migration adds jobs.feed_tag and keeps the existing row (feed_tag NULL)")
check("feed_drops" in tables, "create_all makes the feed_drops table on an existing database")
ensure_cols()
check(True, "…and running the migration twice is harmless")

# ── wiring in the shipped files ─────────────────────────────────────────────
check(src.count("upwork_api = _feed_api()") == 3, "the three fetch paths (background loop, /api-fetch, /api-fetch/catchup) install the drop recorder")
check('"feed_tag": getattr(j, "feed_tag", None)' in src, "the job serializer sends feed_tag to the feed")
check('@app.get("/feed-drops")' in src, "GET /feed-drops exists")
db_src = (ROOT / "db.py").read_text(encoding="utf-8")
check(re.search(r"class FeedDrop\(Base\)", db_src) and 'upwork_job_id = Column(String, nullable=False, unique=True, index=True)' in db_src, "db.FeedDrop: one row per posting (unique upwork_job_id)")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
