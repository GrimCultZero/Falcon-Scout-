# -*- coding: utf-8 -*-
"""Weekly feed coverage check (audit 2026-10-29, T18 step 4).

Compares what the feed STORED over the last 48 h with a deep Upwork API pull across
a WIDER term list than the feed searches, and reports the postings the filter
dropped that look in-lane. This keeps the 2026-10-29 coverage audit (done by hand in
a browser, 884 postings, 37 search terms) from being a one-off.

  .venv\\Scripts\\python tools\\feed_coverage.py            # print the report
  .venv\\Scripts\\python tools\\feed_coverage.py --hours 72 --json report.json

It makes read-only Upwork API searches with the app's own connection (about 30 terms
x up to 8 pages), so run it by hand or from a weekly task, not in a loop. The report
buckets every posting from the last N hours:

  in feed            stored as a job (what the feed delivered)
  dropped (floors)   rate / payment / age / country: the owner's own rules, correct
  dropped (words)    no feed keyword, or a title stop word
  SUSPECT MISSES     dropped for words, but the TITLE has a lane word or "google near
                     ads": check these by eye, they are where the keyword list leaks
  passes, not stored the filter would keep it but the feed never fetched it (the API's
                     search ranking differs from web search; mostly off-lane)

Pure analysis (analyse) is separate from the network pull (pull), so a test can feed
it canned rows.
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import upwork_api  # noqa: E402

# The 2026-10-29 audit's terms, wider than the feed's own keyword list.
WIDER_TERMS = [
    "google ads", "seo", "ppc", "adwords", "sem", "paid search", "pmax", "performance max", "google shopping",
    "merchant center", "local seo", "technical seo", "ecommerce seo", "shopify seo", "wordpress seo", "seo audit",
    "link building", "backlink", "geo", "aeo", "ai search", "ga4", "google analytics", "tag manager",
    "conversion tracking", "google business profile", "keyword research", "youtube ads", "digital marketing",
]

_POLICY = ("hourly<", "fixed<", "unverified-payment", "posted>", "country:")


def _posted(row):
    return upwork_api._posted_dt(row)


def pull(terms=None, hours=48, per_page=20, max_pages=8, search=None):
    """Deep, recency-sorted pull for each term, stopping at the window's edge.
    `search` defaults to upwork_api.search_jobs (a stub in tests)."""
    search = search or upwork_api.search_jobs
    cutoff = datetime.now(timezone.utc).timestamp() - hours * 3600
    seen = {}
    for term in (terms or WIDER_TERMS):
        offset = 0
        for _ in range(max_pages):
            try:
                rows, _total = search(term, per_page, str(offset))
            except Exception as e:                                        # one bad term must not end the run
                print(f"[coverage] {term!r} page {offset} failed: {e}", file=sys.stderr)
                break
            if not rows:
                break
            for r in rows:
                uid = r.get("upwork_job_id")
                if uid and uid not in seen:
                    seen[uid] = r
            last = _posted(rows[-1])
            if last is not None and last.timestamp() < cutoff:
                break
            offset += per_page
    out = []
    for r in seen.values():
        dt = _posted(r)
        if dt is None or dt.timestamp() >= cutoff:
            out.append(r)
    return out


def looks_in_lane(row):
    """A TITLE with a lane word, or Google within 6 words of ads/campaigns/search/...
    Deliberately loose: this finds candidates for a human to look at."""
    title = (row.get("title") or "").lower()
    return bool(upwork_api._LANE_RE.search(title) or upwork_api._google_near_ads(title))


def analyse(rows, cfg, stored_ids):
    stored_ids = set(stored_ids or [])
    rep = {"fetched": len(rows), "in_feed": [], "passes_not_stored": [], "dropped_floors": {}, "dropped_words": {}, "suspect_misses": []}
    for r in rows:
        reason = upwork_api._row_passes(r, cfg)
        uid = r.get("upwork_job_id")
        item = {"upwork_job_id": uid, "title": r.get("title"), "reason": reason, "posted_date": r.get("posted_date")}
        if reason is None:
            (rep["in_feed"] if uid in stored_ids else rep["passes_not_stored"]).append(item)
        elif reason.startswith(_POLICY):
            rep["dropped_floors"].setdefault(reason, []).append(item)
        else:
            rep["dropped_words"].setdefault(reason, []).append(item)
            if reason == "no-keyword-in-text" and looks_in_lane(r):
                rep["suspect_misses"].append(item)
    return rep


def stored_job_ids(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return {r[0] for r in con.execute("SELECT upwork_job_id FROM jobs WHERE upwork_job_id IS NOT NULL")}
    finally:
        con.close()


def render(rep, hours):
    n = lambda d: sum(len(v) for v in d.values())
    lines = [f"Feed coverage, last {hours} h: {rep['fetched']} postings fetched across {len(WIDER_TERMS)} terms",
             f"  in feed:              {len(rep['in_feed'])}",
             f"  dropped (floors):     {n(rep['dropped_floors'])}   (rates, payment, age, country: your own rules)",
             f"  dropped (words):      {n(rep['dropped_words'])}",
             f"  passes, not stored:   {len(rep['passes_not_stored'])}   (the API's ranking differs from web search)",
             f"  SUSPECT MISSES:       {len(rep['suspect_misses'])}   <- dropped for words but the title looks in-lane"]
    for it in rep["suspect_misses"]:
        lines.append(f"      {it['title']}   https://www.upwork.com/jobs/{it['upwork_job_id']}")
    if not rep["suspect_misses"]:
        lines.append("      none")
    lines.append("  words-dropped by reason: " + (", ".join(f"{k} {len(v)}" for k, v in sorted(rep["dropped_words"].items(), key=lambda kv: -len(kv[1]))) or "none"))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Weekly feed coverage check")
    ap.add_argument("--hours", type=int, default=48)
    ap.add_argument("--json", help="also write the full report to this file")
    ap.add_argument("--db", default=str(ROOT / "upwork_jobs.db"))
    args = ap.parse_args(argv)
    if not upwork_api.is_connected():
        print("The Upwork API is not connected, so nothing can be pulled. Connect it in Feed settings first.")
        return 2
    cfg = upwork_api.load_feed_config()
    rows = pull(hours=args.hours)
    rep = analyse(rows, cfg, stored_job_ids(args.db))
    print(render(rep, args.hours))
    if args.json:
        Path(args.json).write_text(json.dumps(rep, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
