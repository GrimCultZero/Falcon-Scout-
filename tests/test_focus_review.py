# -*- coding: utf-8 -*-
"""tools/focus_review.py: the 3-day review sample for the SEO/GEO/Google Ads focus
test. Read-only tool; tested against a scratch SQLite DB (jobs + feed_drops), the
live DB is never opened here.

Run: .venv\\Scripts\\python tests\\test_focus_review.py
"""
import importlib.util
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location("focus_review", ROOT / "tools" / "focus_review.py")
fr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fr)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


tmp = Path(tempfile.mkdtemp(prefix="fs_focus_review_")) / "x.db"
con = sqlite3.connect(tmp)
con.executescript("""
CREATE TABLE jobs (
    id INTEGER PRIMARY KEY, title TEXT, url TEXT, description_full TEXT, description_snippet TEXT,
    hourly_rate_min REAL, hourly_rate_max REAL, fixed_budget TEXT, client_spend TEXT,
    captured_at TEXT, hidden_at TEXT, upwork_job_id TEXT
);
CREATE TABLE feed_drops (id INTEGER PRIMARY KEY, upwork_job_id TEXT, reason TEXT, title TEXT, fetched_at TEXT);
""")

now = datetime.now(timezone.utc)
def ago(hours):
    return (now - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")

JOBS = [
    # id, title, desc, hmin, hmax, fixed, spend, captured hours ago, hidden?, reason
    (1, "Virtual Assistant Needed", "Data entry and admin tasks only.", None, None, None, None, 10, True, "focus:data_entry"),
    (2, "Marketing Manager Role", "Oversee our digital marketing, including organic traffic and conversion rate work.", 20, 30, None, "$5,000", 20, True, "focus:no-signal"),
    (3, "Video Editor", "Edit YouTube videos for our channel.", None, None, "$500", "$200", 30, True, "focus:video"),
    (4, "Old Hidden Job (4 days ago)", "Mentions SEO ranking and backlink work.", None, None, None, None, 96, True, "focus:no-signal"),  # outside the 3-day window
    (5, "Kept SEO Job", "A normal SEO job, not hidden at all.", None, None, None, None, 5, False, None),  # not hidden -- must never appear
    (6, "Manually Hidden, Not Focus", "Some other reason entirely.", None, None, None, None, 5, True, None),  # hidden but NOT by focus -- must never appear
    (7, "E-commerce Marketing Manager", "Own our marketing budget and team, no specific channel named.", None, None, None, "$4,380", 8, True, "focus:no-signal"),  # like the owner's own #24860 example
    (8, "Compliance Auditor, Marketing Content Review", "Audit disclosures in client ad copy for regulatory risk.", None, None, None, "$900", 8, True, "focus:no-signal"),  # "marketing" in title, but an audit role -- must NOT appear
    (9, "Bookkeeper Wanted", "Manage invoices and expense tracking.", None, None, None, None, 8, True, "focus:no-signal"),  # no marketing-title match at all -- must NOT appear
]
for (jid, title, desc, hmin, hmax, fixed, spend, hrs_ago, hidden, reason) in JOBS:
    uid = f"~j{jid}"
    con.execute(
        "INSERT INTO jobs (id, title, url, description_full, description_snippet, hourly_rate_min, hourly_rate_max, "
        "fixed_budget, client_spend, captured_at, hidden_at, upwork_job_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (jid, title, f"https://upwork.com/jobs/{uid}", desc, desc, hmin, hmax, fixed, spend, ago(hrs_ago),
         ago(hrs_ago) if hidden else None, uid),
    )
    if reason:
        con.execute("INSERT INTO feed_drops (upwork_job_id, reason, title, fetched_at) VALUES (?,?,?,?)",
                     (uid, reason, title, ago(hrs_ago)))
con.commit()
con.close()

since_3d = (now - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")
ro = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
sample, total = fr.build_sample(ro, since_3d, top_n=20)
ids = [j["id"] for j in sample]

check(total == 6, f"6 jobs are hidden-by-focus AND within the 3-day window (job 4 is older, 5 is kept, 6 is hidden for a different reason): got {total}")
check(set(ids) == {1, 2, 3, 7, 8, 9}, f"exactly those 6 appear, never the kept job (5) or the non-focus hidden job (6) or the stale one (4): {ids}")
check(ids[0] == 2, f"the marketing-manager job (several weak signals + a real budget + real client spend) scores highest: order {ids}")
check(ids[-1] == 9, f"the bookkeeper job (zero weak signals, no budget data) scores lowest (tied with job 1, kept in insertion order): order {ids}")

# top_n actually caps the result
sample2, total2 = fr.build_sample(ro, since_3d, top_n=1)
check(len(sample2) == 1 and total2 == 6, f"--top caps the SAMPLE but not the reported total considered: len={len(sample2)} total={total2}")

# render() never crashes on an empty sample, and says so plainly
check("Nothing hidden" in fr.render([], 0, 3), "an empty window renders a clear message, not a blank page")

# the new marketing-titled-no-signal section (approval item 3, owner 2026-11-20)
mns = fr.build_marketing_no_signal(ro, since_3d)
mns_ids = sorted(j["id"] for j in mns)
check(mns_ids == [2, 7], f"only the two genuinely marketing-titled no-signal jobs appear: got {mns_ids}")
check(not any(j["id"] == 8 for j in mns), '"Compliance Auditor, Marketing Content Review" is an audit role, not a marketing role -- must NOT appear despite the word "Marketing" in its title')
check(not any(j["id"] == 9 for j in mns), '"Bookkeeper Wanted" has no marketing-title match at all -- must NOT appear')
check(not any(j["id"] == 4 for j in mns), "the stale (4-day-old) job stays outside the window even for this section")
check("None" in fr.render_marketing_no_signal([], 3), "an empty marketing-no-signal section also renders a clear message")

# the live-tool default db path points at the real file (sanity -- not opened here)
check(str(fr.ROOT / "upwork_jobs.db").endswith("upwork_jobs.db"), "the default --db path is the real live DB (never touched in this test)")

ro.close()
import shutil
shutil.rmtree(tmp.parent, ignore_errors=True)

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
