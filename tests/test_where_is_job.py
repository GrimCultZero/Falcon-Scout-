# -*- coding: utf-8 -*-
"""tools/where_is_job.py: single-job feed diagnostic (Task 0.5c, owner
2026-11-20/21). Read-only; tested against a scratch SQLite DB (jobs,
feed_drops, proposals) built with the real jobs.py schema's relevant columns.
Never opens the live DB.

Run: .venv\\Scripts\\python tests\\test_where_is_job.py
"""
import importlib.util
import io
import sqlite3
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location("where_is_job", ROOT / "tools" / "where_is_job.py")
wij = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wij)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


tmp = Path(tempfile.mkdtemp(prefix="fs_where_is_job_")) / "x.db"
con = sqlite3.connect(tmp)
con.executescript("""
CREATE TABLE jobs (
    id INTEGER PRIMARY KEY, upwork_job_id TEXT, title TEXT, url TEXT, source TEXT,
    description_full TEXT, description_snippet TEXT, raw_message TEXT, keywords TEXT,
    captured_at TEXT, hidden_at TEXT, starred_at TEXT
);
CREATE TABLE feed_drops (id INTEGER PRIMARY KEY, upwork_job_id TEXT, reason TEXT, title TEXT, posted_date TEXT, fetched_at TEXT);
CREATE TABLE proposals (id INTEGER PRIMARY KEY, job_id INTEGER);
""")
con.execute(
    "INSERT INTO jobs (id, upwork_job_id, title, url, source, description_full, keywords, captured_at, hidden_at, starred_at) "
    "VALUES (1, '021aaaa1111111111', 'Technical SEO Audit', 'https://www.upwork.com/jobs/~021aaaa1111111111', 'api', "
    "'We need a technical SEO audit of our site.', NULL, '2026-11-20 10:00:00', NULL, NULL)"
)
con.execute(
    "INSERT INTO jobs (id, upwork_job_id, title, url, source, description_full, keywords, captured_at, hidden_at, starred_at) "
    "VALUES (2, '022bbbb2222222222', 'Shopify Website Design', 'https://www.upwork.com/jobs/~022bbbb2222222222', 'api', "
    "'We need a designer for our Shopify theme.', NULL, '2026-11-20 10:05:00', '2026-11-20 10:05:01', NULL)"
)
con.execute("INSERT INTO feed_drops (upwork_job_id, reason, title, posted_date, fetched_at) VALUES ('022bbbb2222222222', 'focus:webdev', 'Shopify Website Design', '2026-11-20', '2026-11-20 10:05:01')")
# a posting fetched and dropped BEFORE insertion (never made it into jobs at all)
con.execute("INSERT INTO feed_drops (upwork_job_id, reason, title, posted_date, fetched_at) VALUES ('023cccc3333333333', 'country:india', 'SEO Specialist (India)', '2026-11-19', '2026-11-19 09:00:00')")
# a starred job, protected
con.execute(
    "INSERT INTO jobs (id, upwork_job_id, title, url, source, description_full, keywords, captured_at, hidden_at, starred_at) "
    "VALUES (3, '024dddd4444444444', 'PPC Manager Needed', 'https://www.upwork.com/jobs/~024dddd4444444444', 'api', 'Manage our PPC campaigns.', NULL, '2026-11-20 11:00:00', NULL, '2026-11-20 11:30:00')"
)
con.execute("INSERT INTO proposals (id, job_id) VALUES (1, 3)")
con.commit()
con.close()


def run(query, db=tmp):
    out = io.StringIO()
    old_argv = sys.argv
    sys.argv = ["where_is_job.py", query, "--db", str(db)]
    try:
        with redirect_stdout(out):
            wij.main()
    finally:
        sys.argv = old_argv
    return out.getvalue()


# ── 1. a SHOWN job, found by internal id ────────────────────────────────────
out = run("1")
check("SHOWN" in out and "Technical SEO Audit" in out, "a shown job is reported SHOWN, by internal id")
check("KEEP" in out and "seo" in out, "today's focus filter re-classification is shown (KEEP, seo)")

# ── 2. a HIDDEN job, found by full URL, with its drop reason ────────────────
out = run("https://www.upwork.com/jobs/~022bbbb2222222222")
check("HIDDEN" in out and "Shopify Website Design" in out, "a hidden job is found by its full Upwork URL")
check("focus:webdev" in out, "the hide reason (feed_drops) is reported")
check("HIDE" in out and "category=webdev" in out, "today's filter agrees it would still hide this one")

# ── 3. a starred + proposal job, found by bare Upwork id (no ~) ─────────────
out = run("024dddd4444444444")
check("STARRED" in out and "HAS PROPOSAL" in out, "a starred job with a proposal reports both, found by bare id (no leading ~)")

# ── 4. fetched and dropped BEFORE insertion -- never in jobs at all ─────────
out = run("~023cccc3333333333")
check("NOT in jobs table, but it WAS fetched and dropped" in out, "a job dropped before insertion is reported as such, not as missing entirely")
check("country:india" in out and "SEO Specialist (India)" in out, "the drop reason and title are shown")

# ── 5. truly unknown job -- not in the DB at all ────────────────────────────
out = run("~099999999999999999")
check("NOT IN THE DB AT ALL" in out, "a job with no trace anywhere gets the clear 'not in DB at all' answer")

# ── 6. query parsing ─────────────────────────────────────────────────────────
check(wij._parse_query("24733") == (24733, None), "a bare integer is read as an internal id")
check(wij._parse_query("~021aaaa1111111111") == (None, "~021aaaa1111111111"), "a ~-prefixed id is read as an Upwork id")
check(wij._parse_query("021aaaa1111111111") == (None, "~021aaaa1111111111"), "a bare hex id (no ~) is normalized to ~021aaaa1111111111")
check(wij._parse_query("https://www.upwork.com/jobs/~021aaaa1111111111?x=1") == (None, "~021aaaa1111111111"), "the Upwork id is extracted out of a full URL with a query string")
check(wij._parse_query("not a job id") == (None, None), "garbage input parses to nothing, not a false match")

import shutil
shutil.rmtree(tmp.parent, ignore_errors=True)

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
