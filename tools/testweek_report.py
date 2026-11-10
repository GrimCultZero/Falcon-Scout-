# -*- coding: utf-8 -*-
"""Test-week report (owner-approved test week 2026-11-10 .. 2026-11-17). READ-ONLY.

For each test tag (test:unverified, test:low-hourly, test:low-fixed) it counts the jobs the
loosened rules let into the feed and what happened to them, next to the NORMAL feed (jobs
captured in the same window with no test tag), so "did the rules cost me money?" has an answer:

  shown    jobs carrying the tag
  opened   jobs Artem engaged with in the app. The app does not record plain opens, so this
           is the closest real signal: analysed, starred, or has a proposal
  applied  jobs with a proposal
  replied  proposals that got a client reply (replied, interviewing, hired, or first_reply_at set)
  hired    proposals with status hired

It also prints how many pure web-development / design jobs the week hid (feed_drops reason
testweek:webdev) and a sample of titles, so a wrong hide is visible.

The database is opened with mode=ro and nothing is written.

  .venv\\Scripts\\python tools\\testweek_report.py [--db path] [--from 2026-11-10] [--until 2026-11-17]
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
TAGS = ("test:unverified", "test:low-hourly", "test:low-fixed")
REPLIED = ("replied", "interviewing", "hired")


def _rows(con, start, until):
    """Every job captured in the window with what happened to it."""
    q = """
    SELECT j.id, j.title, j.feed_tag, j.last_analysis_at IS NOT NULL AS analysed, j.starred_at IS NOT NULL AS starred,
           (SELECT COUNT(*) FROM proposals p WHERE p.job_id = j.id) AS n_prop,
           (SELECT COUNT(*) FROM proposals p WHERE p.job_id = j.id AND (p.status IN ('replied','interviewing','hired') OR p.first_reply_at IS NOT NULL)) AS n_reply,
           (SELECT COUNT(*) FROM proposals p WHERE p.job_id = j.id AND p.status = 'hired') AS n_hired
    FROM jobs j
    WHERE j.source = 'api' AND date(j.captured_at) >= date(?) AND date(j.captured_at) <= date(?)
    """
    return con.execute(q, (start, until)).fetchall()


def _summ(rows):
    n = len(rows)
    opened = sum(1 for r in rows if r[3] or r[4] or r[5])
    applied = sum(1 for r in rows if r[5])
    replied = sum(1 for r in rows if r[6])
    hired = sum(1 for r in rows if r[7])
    return {"shown": n, "opened": opened, "applied": applied, "replied": replied, "hired": hired}


def build_report(con, start, until):
    rows = _rows(con, start, until)
    by_tag = {}
    for t in TAGS:
        by_tag[t] = _summ([r for r in rows if t in str(r[2] or "").split(",")])
    any_test = [r for r in rows if any(t in str(r[2] or "").split(",") for t in TAGS)]
    normal = [r for r in rows if not any(t in str(r[2] or "").split(",") for t in TAGS)]
    hidden = []
    try:
        hidden = con.execute("SELECT title FROM feed_drops WHERE reason = 'testweek:webdev' AND date(fetched_at) >= date(?) AND date(fetched_at) <= date(?) ORDER BY fetched_at DESC",
                             (start, until)).fetchall()
    except sqlite3.OperationalError:
        pass                                           # no feed_drops table yet
    return {"window": {"from": start, "until": until}, "tags": by_tag, "all_test_rows": _summ(any_test), "normal_feed": _summ(normal),
            "webdev_hidden": {"count": len(hidden), "sample": [h[0] for h in hidden[:25]]}}


def render(rep):
    def pct(a, b):
        return f"{100 * a / b:4.1f}%" if b else "  n/a"
    lines = [f"TEST WEEK REPORT  {rep['window']['from']} .. {rep['window']['until']}   (read-only)",
             "  'opened' = analysed, starred or has a proposal (the app does not record plain opens)", "",
             f"  {'':22}{'shown':>7}{'opened':>8}{'applied':>9}{'replied':>9}{'hired':>7}   applied/shown  replied/applied"]
    def line(name, s):
        return (f"  {name:22}{s['shown']:>7}{s['opened']:>8}{s['applied']:>9}{s['replied']:>9}{s['hired']:>7}"
                f"   {pct(s['applied'], s['shown']):>12}  {pct(s['replied'], s['applied']):>14}")
    for t in TAGS:
        lines.append(line(t, rep["tags"][t]))
    lines.append(line("ALL TEST TAGS", rep["all_test_rows"]))
    lines.append(line("normal feed (untagged)", rep["normal_feed"]))
    w = rep["webdev_hidden"]
    lines += ["", f"  Pure web-dev / design jobs hidden by the test (feed_drops 'testweek:webdev'): {w['count']}"]
    for t in w["sample"][:12]:
        lines.append(f"      {t}")
    return "\n".join(lines)


def main(argv=None):
    cfg = {}
    try:
        cfg = (json.loads((ROOT / "feed_config.json").read_text(encoding="utf-8")).get("test_week") or {})
    except (OSError, ValueError):
        pass
    ap = argparse.ArgumentParser(description="Read-only test-week report")
    ap.add_argument("--db", default=str(ROOT / "upwork_jobs.db"))
    ap.add_argument("--from", dest="start", default=cfg.get("from") or "2026-11-10")
    ap.add_argument("--until", default=cfg.get("until") or "2026-11-17")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    rep = build_report(con, a.start, a.until)
    con.close()
    print(json.dumps(rep, indent=2, ensure_ascii=False) if a.json else render(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
