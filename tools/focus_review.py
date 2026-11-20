# -*- coding: utf-8 -*-
"""Focus-test review sample (SEO/GEO/Google Ads focus test, owner 2026-11-19..2026-12-03). READ-ONLY.

Prints the N (default 20) hidden-by-focus jobs from the last D days (default 3) that
look MOST worth a second look: a weak mention of any keep-adjacent keyword, a real
hourly/fixed budget, or real client spend -- so the owner can tell whether the strict
filter (api/focus_filter.py) is being too aggressive without reading every hidden job.

This uses a LOOSER heuristic word list than focus_filter.py's strict KEEP_PATTERNS on
purpose: a job scoring high here was still correctly hidden by the strict rules (if it
had matched a KEEP pattern it would never have been hidden at all) -- it just carries
enough adjacent signal that a human glance is worth it. False positives here cost
nothing (one more job to skim); this never changes what the focus test hides.

The database is opened read-only (mode=ro) and nothing is written.

  .venv\\Scripts\\python tools\\focus_review.py [--db path] [--days 3] [--top 20]
"""
import argparse
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import focus_filter as ff  # noqa: E402

# Deliberately broader than focus_filter.py's strict KEEP_PATTERNS -- bare "geo" and
# "marketing manager" etc. count here even though the strict classifier would not
# treat them as a keep signal on their own. This list only decides what gets FLAGGED
# for a human to re-check, never what gets hidden.
WEAK_SIGNAL_RE = re.compile(
    r"\bseo\b|search engine|\bgeo\b|\baeo\b|ai search|chatgpt|\bllm\b|google ads|\bppc\b|paid search|"
    r"performance\s*max|google shopping|merchant center|\bga4\b|google analytics|tag manager|"
    r"search console|\blooker\b|digital marketing|marketing manager|online marketing|"
    r"organic traffic|website traffic|conversion rate|\branking\b|visibility|\bserp\b|backlink",
    re.I,
)


def _spend_amount(client_spend):
    if not client_spend:
        return None
    try:
        return float(str(client_spend).lstrip("$").replace(",", "").split()[0])
    except (ValueError, IndexError):
        return None


def _score(title, desc, hourly_min, hourly_max, fixed_budget, client_spend):
    """(score, weak_hit_count). Higher score = more worth a second look."""
    blob = f"{title or ''} {desc or ''}"
    weak_hits = len(set(m.lower() for m in WEAK_SIGNAL_RE.findall(blob)))
    score = weak_hits * 10
    if hourly_max and hourly_max >= 25:
        score += 3
    if fixed_budget:
        score += 3
    spend = _spend_amount(client_spend)
    if spend is not None:
        score += 4 if spend >= 1000 else (2 if spend > 0 else 0)
    return score, weak_hits


def build_sample(con, since_iso, top_n):
    """Every job currently hidden by the focus test, captured since `since_iso`,
    scored and sorted highest-first; (sample, total_considered)."""
    rows = con.execute(
        """
        SELECT j.id, j.title, j.url, j.description_full, j.description_snippet,
               j.hourly_rate_min, j.hourly_rate_max, j.fixed_budget, j.client_spend,
               j.captured_at, fd.reason
        FROM jobs j
        JOIN feed_drops fd ON fd.upwork_job_id = j.upwork_job_id
        WHERE j.hidden_at IS NOT NULL AND fd.reason LIKE 'focus:%' AND j.captured_at >= ?
        """,
        (since_iso,),
    ).fetchall()
    scored = []
    for (jid, title, url, desc_full, desc_snip, hmin, hmax, fixed, spend, captured_at, reason) in rows:
        desc = desc_full or desc_snip or ""
        score, weak_hits = _score(title, desc, hmin, hmax, fixed, spend)
        scored.append({
            "id": jid, "title": title, "url": url, "reason": reason,
            "rate": (f"${hmin or '?'}-${hmax or '?'}/hr" if (hmin or hmax) else (fixed or "-")),
            "client_spend": spend or "-", "captured_at": captured_at,
            "score": score, "weak_hits": weak_hits,
        })
    scored.sort(key=lambda x: -x["score"])  # highest score first; stable, so ties keep their query order
    return scored[:top_n], len(rows)


def build_marketing_no_signal(con, since_iso):
    """Jobs hidden with NO keep signal at all (reason "focus:no-signal") whose TITLE
    itself reads as a marketing/ads role -- these stay hidden, per the owner's
    2026-11-20 decision (a marketing-titled job with zero matched keyword is still
    off-lane), but are worth a glance since the title alone suggests fit. Owner
    example: #24860 "E-commerce Marketing Manager"."""
    rows = con.execute(
        """
        SELECT j.id, j.title, j.url, j.fixed_budget, j.client_spend,
               j.hourly_rate_min, j.hourly_rate_max, j.captured_at
        FROM jobs j
        JOIN feed_drops fd ON fd.upwork_job_id = j.upwork_job_id
        WHERE j.hidden_at IS NOT NULL AND fd.reason = 'focus:no-signal' AND j.captured_at >= ?
        """,
        (since_iso,),
    ).fetchall()
    out = []
    for (jid, title, url, fixed, spend, hmin, hmax, captured_at) in rows:
        title = title or ""
        if ff.MARKETING_TITLE_RE.search(title) and not ff.NON_MARKETING_ROLE_RE.search(title):
            out.append({
                "id": jid, "title": title, "url": url,
                "rate": (f"${hmin or '?'}-${hmax or '?'}/hr" if (hmin or hmax) else (fixed or "-")),
                "client_spend": spend or "-", "captured_at": captured_at,
            })
    return out


def render(sample, total, days):
    lines = [f"FOCUS-TEST REVIEW SAMPLE  (read-only, last {days} day(s))  -- {len(sample)} of {total} hidden-by-focus jobs shown", ""]
    if not sample:
        lines.append("Nothing hidden by the focus test in this window.")
        return "\n".join(lines)
    for i, j in enumerate(sample, 1):
        lines.append(f"{i:2}. [{j['score']:3} pts, {j['weak_hits']} weak signal(s)]  {j['title']}  (job #{j['id']})")
        lines.append(f"      reason: {j['reason']}  |  rate: {j['rate']}  |  client spend: {j['client_spend']}  |  captured: {j['captured_at']}")
        if j["url"]:
            lines.append(f"      {j['url']}")
        lines.append("")
    lines.append("Rescue a wrongly hidden job: POST /jobs/{id}/unhide, or click it in the app's Hidden tab.")
    return "\n".join(lines)


def render_marketing_no_signal(rows, days):
    lines = ["", "=" * 70,
             f"MARKETING-TITLED JOBS, NO SIGNAL AT ALL  (read-only, last {days} day(s))  -- "
             f"{len(rows)} shown (stay hidden; title alone suggests a look)",
             "=" * 70, ""]
    if not rows:
        lines.append("None in this window.")
        return "\n".join(lines)
    for i, j in enumerate(rows, 1):
        lines.append(f"{i:2}. {j['title']}  (job #{j['id']})")
        lines.append(f"      rate: {j['rate']}  |  client spend: {j['client_spend']}  |  captured: {j['captured_at']}")
        if j["url"]:
            lines.append(f"      {j['url']}")
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "upwork_jobs.db"))
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--top", type=int, default=20)
    args = ap.parse_args()

    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        sample, total = build_sample(con, since, args.top)
        marketing_no_signal = build_marketing_no_signal(con, since)
    finally:
        con.close()
    print(render(sample, total, args.days))
    print(render_marketing_no_signal(marketing_no_signal, args.days))


if __name__ == "__main__":
    main()
