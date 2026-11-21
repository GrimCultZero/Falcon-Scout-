# -*- coding: utf-8 -*-
"""Ground-truth check against Upwork (Task 0.6, owner 2026-11-20/21). ONE-OFF,
MANUAL -- not scheduled, not imported by the app. Calls api.upwork_api's
EXISTING search_jobs() (the same function and auth the live feed already uses)
for each of a fixed set of search terms, newest-first, and reconciles every
returned job id against the DB (same logic as tools/where_is_job.py).

Does NOT modify api/upwork_api.py or the fetch pipeline. Read-only against
Upwork (a marketplace search, same as any browse) and against the DB
(mode=ro). Never writes anything.

Safety limits, all hard-coded, none configurable from the command line:
  - at most 3 pages per term, 10 terms  => at most 30 requests this run.
  - a 3-second pause between every request (more conservative than the live
    feed's own un-paced catch-up fetch, which has no inter-request delay at all).
  - stops the ENTIRE run immediately on any auth error, HTTP 429, or anything
    that looks like a captcha/challenge page -- no retries, ever.
  - only reads the last 24 hours of postings per term (RECENCY sort, so this
    stops paging a term as soon as a page's oldest row is already > 24h old).

Run: .venv\\Scripts\\python tools\\upwork_ground_truth.py
"""
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import upwork_api  # noqa: E402
import focus_filter as ff  # noqa: E402

TERMS = [
    "Google Ads", "SEO", "technical SEO", "local SEO", "GEO",
    "AI search optimization", "AEO", "PPC", "Performance Max",
    "Merchant Center", "Google Analytics 4",
]
MAX_PAGES_PER_TERM = 3
PER_PAGE = 20
REQUEST_PAUSE_SEC = 3.0
CUTOFF = datetime.now(timezone.utc) - timedelta(hours=24)

_AUTH_ERROR_RE = re.compile(r"\b401\b|\b403\b|unauthoriz|invalid.?token|invalid.?grant", re.I)
_RATE_LIMIT_RE = re.compile(r"\b429\b|too many requests|rate.?limit", re.I)
_CHALLENGE_RE = re.compile(r"captcha|challenge|are you a human|verify you.?re human", re.I)


def _posted_dt(row):
    s = row.get("posted_date")
    if not s:
        return None
    try:
        norm = s if (s.endswith("Z") or "+" in s) else s + "Z"
        return datetime.fromisoformat(norm.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _hard_stop(exc_or_text):
    text = str(exc_or_text)
    if _AUTH_ERROR_RE.search(text):
        return "AUTH ERROR"
    if _RATE_LIMIT_RE.search(text):
        return "RATE LIMITED (429)"
    if _CHALLENGE_RE.search(text):
        return "CHALLENGE/CAPTCHA"
    return None


def main():
    con = sqlite3.connect(f"file:{ROOT / 'upwork_jobs.db'}?mode=ro", uri=True)
    total_requests = 0
    overall_found = overall_in_db = 0
    not_in_db_all = []

    for term in TERMS:
        found_this_term = []
        offset = 0
        for page in range(MAX_PAGES_PER_TERM):
            total_requests += 1
            try:
                rows, total_count = upwork_api.search_jobs(term, PER_PAGE, str(offset))
            except Exception as e:
                stop = _hard_stop(e)
                print(f"[{term}] page {page} request FAILED: {e}")
                if stop:
                    print(f"\nHARD STOP: {stop}. Aborting the entire run immediately, no retries.")
                    con.close()
                    return
                break  # a non-hard-stop error: skip this term, keep going with the next
            time.sleep(REQUEST_PAUSE_SEC)
            if not rows:
                break
            for r in rows:
                pd = _posted_dt(r)
                if pd is not None and pd < CUTOFF:
                    continue
                found_this_term.append(r)
            last_dt = _posted_dt(rows[-1])
            if last_dt is not None and last_dt < CUTOFF:
                break
            offset += PER_PAGE
            if total_requests >= 40:
                print("\nSafety limit reached (40 requests total this run) -- stopping.")
                break
        if total_requests >= 40:
            break

        print(f"\n{'='*90}\nTERM: {term!r}  -- {len(found_this_term)} posting(s) in the last 24h")
        print(f"{'='*90}")
        in_db = not_in_db = 0
        for r in found_this_term:
            uid = r.get("upwork_job_id")
            row = con.execute(
                "SELECT id, title, hidden_at FROM jobs WHERE upwork_job_id = ? OR upwork_job_id = ?",
                (uid, "~" + (uid or "").lstrip("~")),
            ).fetchone()
            if row:
                in_db += 1
                status = "HIDDEN-by-focus" if row[2] else "SHOWN"
                drop = con.execute("SELECT reason FROM feed_drops WHERE upwork_job_id = ?", (uid,)).fetchone()
                if row[2] and drop:
                    status = f"HIDDEN ({drop[0]})"
                print(f"  IN DB   #{row[0]:6d}  {status:28s}  {r.get('title','')[:65]}")
            else:
                not_in_db += 1
                drop = con.execute("SELECT reason FROM feed_drops WHERE upwork_job_id = ?", (uid,)).fetchone()
                reason = f"dropped: {drop[0]}" if drop else "NOT IN DB AT ALL"
                not_in_db_all.append({
                    "term": term, "upwork_job_id": uid, "title": r.get("title"),
                    "budget": r.get("hourly_rate_min") or r.get("fixed_budget") or r.get("hourly_rate_max"),
                    "country": r.get("client_country"), "posted_date": r.get("posted_date"),
                    "reason": reason,
                })
                print(f"  MISSING {reason:28s}  -- {r.get('title','')[:65]}")
        print(f"  -> {in_db} in DB, {not_in_db} missing, of {len(found_this_term)} found on Upwork")
        overall_found += len(found_this_term)
        overall_in_db += in_db

    print(f"\n{'='*90}\nTOTAL: {overall_found} postings found across all terms (24h, deduped per term only, "
          f"not globally); {overall_in_db} in DB ({(overall_in_db/overall_found*100) if overall_found else 0:.1f}% recall by this measure).")
    print(f"Total requests made this run: {total_requests}")

    print(f"\n{'='*90}\nEvery 'NOT IN DB AT ALL' posting (not just dropped-before-insertion), full detail:\n{'='*90}")
    never_seen = [x for x in not_in_db_all if x["reason"] == "NOT IN DB AT ALL"]
    for x in never_seen:
        print(f"  term={x['term']:10s}  id={x['upwork_job_id']}  budget={x['budget']}  country={x['country']}  posted={x['posted_date']}  -- {x['title']}")
    if not never_seen:
        print("  (none -- every posting Upwork returned that wasn't already in the DB was at least FETCHED and dropped by a named rule)")

    con.close()


if __name__ == "__main__":
    main()
