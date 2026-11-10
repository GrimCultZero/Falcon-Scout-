# -*- coding: utf-8 -*-
"""The weekly feed coverage check (audit 2026-10-29, T18 step 4): tools/feed_coverage.py.

Offline: Upwork is a stub, the database is a scratch file. Pinned: the report buckets
every posting correctly, a dropped posting with an in-lane TITLE is a SUSPECT MISS (the
exact shapes the 2026-10-29 audit found by hand), the owner's floors are not suspects,
the pull stops at the window's edge and survives a failing term.

Run: .venv\\Scripts\\python tests\\test_feed_coverage.py
"""
import importlib.util
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import upwork_api                                            # noqa: E402

spec = importlib.util.spec_from_file_location("feed_coverage", ROOT / "tools" / "feed_coverage.py")
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

CFG = {**upwork_api.load_feed_config(), "test_week": None}  # the base rules; the owner's test week (feed_config test_week) is tested in test_test_week.py
now = datetime.now(timezone.utc)
def iso(hours_ago):
    return (now - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
def row(uid, title, desc="Please see the details below.", hours_ago=3, **kw):
    return {"upwork_job_id": uid, "title": title, "description_full": desc, "payment_verified": True, "posted_date": iso(hours_ago), **kw}

# ── analyse ─────────────────────────────────────────────────────────────────
rows = [
    row("~in", "Google Ads Specialist"),                                              # passes, stored
    row("~new", "SEO Backlink Specialist"),                                           # passes, never stored
    row("~miss1", "Marketing Specialist for Instagram and Google Campaigns Expert"),  # google near campaigns: passes via the proximity rule
    row("~miss2", "Paid Ads Specialist Needed for Two Upcoming Campaigns"),           # no Google in the title: a known gap
    row("~miss3", "Semrush report for a few companies", "Need a report."),            # 'sem' is not a whole word here
    row("~lane", "SEM specialist wanted", "Need a person."),                          # no feed keyword, SEM is a lane word -> suspect
    row("~off", "Python developer", "django"),                                        # off-lane, dropped for words, not a suspect
    row("~stop", "Facebook Ads Manager", "google ads"),                               # stop word
    row("~low", "Google Ads Specialist for Plumbing", hourly_rate_max=10),            # floor
    row("~old", "Google Ads Specialist for Roofing", hours_ago=200),                  # age floor
]
rep = fc.analyse(rows, CFG, {"~in"})
ids = lambda items: {i["upwork_job_id"] for i in items}
check(ids(rep["in_feed"]) == {"~in"}, "a passing posting that is stored is 'in feed' (and only that one)")
check({"~new", "~miss1"} <= ids(rep["passes_not_stored"]), "'Instagram and Google Campaigns' now passes (proximity) but was never stored")
check({"~miss2", "~miss3"} <= ids(sum(rep["dropped_words"].values(), [])) and not ({"~miss2", "~miss3"} & ids(rep["suspect_misses"])), "known limits, not suspects: no Google in the title ('Paid Ads Specialist'), 'Semrush' is not the word SEM")
check("~new" in ids(rep["passes_not_stored"]), "a passing posting the feed never stored is 'passes, not stored'")
check(set(rep["dropped_floors"]) == {"hourly<25", "posted>72h"} and ids(rep["dropped_floors"]["hourly<25"]) == {"~low"}, "rate and age drops are the floors, not words")
check(any(r.startswith("stopword:") for r in rep["dropped_words"]) and "~stop" in ids(sum(rep["dropped_words"].values(), [])), "a stop-word drop is a words drop")
sus = ids(rep["suspect_misses"])
check("~lane" in sus, "a words-dropped posting whose TITLE has a lane word ('SEM') is a SUSPECT MISS")
check("~off" not in sus and "~stop" not in sus and "~low" not in sus, "off-lane, stop-word and floor drops are not suspects")
check(rep["fetched"] == len(rows) and sum(len(v) for v in rep["dropped_words"].values()) + sum(len(v) for v in rep["dropped_floors"].values()) + len(rep["in_feed"]) + len(rep["passes_not_stored"]) == len(rows),
      "every fetched posting lands in exactly one bucket")

# the audit's own examples, against the T18 rules: these used to be suspects, now they pass
aud = fc.analyse([row("~1", "Google and Instagram Ads Expert"), row("~2", "GEO/AEO Optimization Specialist"), row("~3", "Google Page indexing Task"),
                  row("~4", "Usercentrics + GTM + Google Consent Mode v2")], CFG, set())
check(len(aud["suspect_misses"]) == 0 and len(aud["passes_not_stored"]) == 4, "the five-shape leak from the 2026-10-29 audit is no longer reported as a miss")
old_cfg = {**CFG, "keywords": [k for k in CFG["keywords"] if k not in ("google tag manager", "ga4", "google analytics", "conversion tracking", "consent mode", "search console", "indexing", "aeo", "geo", "ai search", "llm seo", "local citation", "citation building", "guest post", "youtube ads", "google business profile", "gbp")], "google_proximity": False}
aud_old = fc.analyse([row("~1", "Google and Instagram Ads Expert"), row("~2", "GEO/AEO Optimization Specialist")], old_cfg, set())
check(len(aud_old["suspect_misses"]) == 2, "…and WOULD have been reported under the old rules (the check catches this kind of leak)")

text = fc.render(rep, 48)
check("SUSPECT MISSES" in text and "SEM specialist wanted" in text and "https://www.upwork.com/jobs/~lane" in text, "the printed report lists each suspect with its Upwork link")

# ── pull ────────────────────────────────────────────────────────────────────
calls = []
def fake_search(term, first, after):
    calls.append((term, after))
    if term == "boom":
        raise RuntimeError("rate limited")
    pages = {"0": [row(f"~{term}-a", "Google Ads A", hours_ago=2), row(f"~{term}-b", "Google Ads B", hours_ago=20)],
             "20": [row(f"~{term}-c", "Google Ads C", hours_ago=40), row(f"~{term}-d", "Google Ads D", hours_ago=60)],
             "40": [row(f"~{term}-e", "Google Ads E", hours_ago=80)]}
    return pages.get(after, []), 99
got = fc.pull(terms=["seo", "boom", "ppc"], hours=48, per_page=20, max_pages=8, search=fake_search)
gotids = {r["upwork_job_id"] for r in got}
check({"~seo-a", "~seo-b", "~seo-c", "~ppc-a"} <= gotids and "~seo-d" not in gotids and "~seo-e" not in gotids, "the pull keeps what is inside the 48 h window and drops what is older")
check(("seo", "40") not in calls, "paging stops once a page reaches past the window (no page 3 for 'seo')")
check(not any(i.startswith("~boom") for i in gotids) and "~ppc-a" in gotids, "a term that fails does not end the run")
check(len({r["upwork_job_id"] for r in got}) == len(got), "postings are de-duplicated across terms")
check(len(fc.WIDER_TERMS) >= 25 and "youtube ads" in fc.WIDER_TERMS and "google business profile" in fc.WIDER_TERMS, "the wider term list covers the audit's terms")

# ── stored ids, read-only ───────────────────────────────────────────────────
tmp = Path(tempfile.mkdtemp(prefix="fs_cov_")) / "x.db"
con = sqlite3.connect(tmp)
con.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, upwork_job_id TEXT)")
con.executemany("INSERT INTO jobs (upwork_job_id) VALUES (?)", [("~a",), ("~b",), (None,)])
con.commit(); con.close()
check(fc.stored_job_ids(tmp) == {"~a", "~b"}, "stored ids are read from the database (read-only), NULLs ignored")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
