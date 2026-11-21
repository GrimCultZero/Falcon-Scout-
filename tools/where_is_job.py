# -*- coding: utf-8 -*-
"""Where is this job? A single-job diagnostic for the feed (Task 0.5c, owner
2026-11-20/21). Takes a job id, an Upwork job id ("~01abc..."), or a full
Upwork job URL, and reports:
  - whether it's in the DB at all (by internal id or Upwork job id)
  - if yes: shown / hidden / starred / applied (has a proposal), the hide
    reason if any (feed_drops), and what today's focus filter would say about
    it (keep/hide, matched phrase)
  - if no: whether it was ever FETCHED and DROPPED before insertion
    (feed_drops keyed by upwork_job_id, recorded even for a row _row_passes
    rejected) -- or a clear "not in the DB at all" when there's no trace
    anywhere.

Read-only; never writes. Defaults to the live DB (this is a status lookup,
not an analysis run) but --db lets you point it at a scratch copy.

Run:  .venv\\Scripts\\python tools\\where_is_job.py <job id | ~0abc... | URL>
      .venv\\Scripts\\python tools\\where_is_job.py 24733
      .venv\\Scripts\\python tools\\where_is_job.py ~021a2b3c4d5e6f7890
      .venv\\Scripts\\python tools\\where_is_job.py "https://www.upwork.com/jobs/~021a2b3c4d5e6f7890"
"""
import argparse
import re
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import focus_filter as ff  # noqa: E402

_UPWORK_ID_RE = re.compile(r"~[0-9a-f]{10,}", re.I)


def _parse_query(raw: str):
    """Returns (internal_id_or_None, upwork_id_or_None)."""
    raw = (raw or "").strip()
    m = _UPWORK_ID_RE.search(raw)
    if m:
        return None, m.group(0)
    if raw.lstrip("~").isdigit() and raw.startswith("~"):
        return None, raw
    if raw.isdigit():
        return int(raw), None
    # bare hex without the ~, e.g. pasted without the tilde
    if re.fullmatch(r"[0-9a-f]{10,}", raw, re.I):
        return None, "~" + raw
    return None, None


def _find_job(con, internal_id, upwork_id):
    if internal_id is not None:
        row = con.execute("SELECT * FROM jobs WHERE id = ?", (internal_id,)).fetchone()
        if row:
            return row
    if upwork_id:
        clean = upwork_id.lstrip("~")
        row = con.execute(
            "SELECT * FROM jobs WHERE upwork_job_id = ? OR upwork_job_id = ?",
            (clean, "~" + clean),
        ).fetchone()
        if row:
            return row
    return None


def _cols(con):
    return [d[0] for d in con.execute("SELECT * FROM jobs LIMIT 0").description]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query", help="internal job id, Upwork job id (~0abc...), or a job URL")
    ap.add_argument("--db", default=str(ROOT / "upwork_jobs.db"))
    args = ap.parse_args()

    internal_id, upwork_id = _parse_query(args.query)
    if internal_id is None and upwork_id is None:
        print(f"Could not parse a job id or Upwork id out of: {args.query!r}")
        sys.exit(1)

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    row = _find_job(con, internal_id, upwork_id)
    if row is None:
        print(f"Query: {args.query}")
        if internal_id is not None:
            print(f"  No job with internal id {internal_id}.")
        if upwork_id:
            drop = con.execute(
                "SELECT reason, fetched_at, title, posted_date FROM feed_drops WHERE upwork_job_id = ? OR upwork_job_id = ?",
                (upwork_id.lstrip("~"), upwork_id),
            ).fetchone()
            if drop:
                print(f"  NOT in jobs table, but it WAS fetched and dropped before insertion:")
                print(f"    reason: {drop['reason']}")
                print(f"    title: {drop['title']}")
                print(f"    posted_date: {drop['posted_date']}")
                print(f"    last seen (fetched_at): {drop['fetched_at']}")
            else:
                print(f"  Upwork id {upwork_id}: NOT IN THE DB AT ALL (no jobs row, no feed_drops row). "
                      f"Never fetched, or fetched and inserted then later deleted (jobs are pruned, not feed_drops rows older than 7 days).")
        con.close()
        return

    print(f"Query: {args.query}")
    print(f"  internal id:    {row['id']}")
    print(f"  upwork_job_id:  {row['upwork_job_id']}")
    print(f"  title:          {row['title']}")
    print(f"  source:         {row['source']}")
    print(f"  captured_at:    {row['captured_at']}")
    status_bits = []
    status_bits.append("HIDDEN" if row["hidden_at"] else "SHOWN")
    if row["starred_at"]:
        status_bits.append("STARRED")
    n_props = con.execute("SELECT COUNT(*) FROM proposals WHERE job_id = ?", (row["id"],)).fetchone()[0]
    if n_props:
        status_bits.append(f"HAS PROPOSAL ({n_props})")
    print(f"  status:         {' / '.join(status_bits)}")

    if row["hidden_at"]:
        drop = con.execute(
            "SELECT reason, fetched_at FROM feed_drops WHERE upwork_job_id = ? OR upwork_job_id = ?",
            (row["upwork_job_id"] or "", (row["upwork_job_id"] or "").lstrip("~")),
        ).fetchone()
        if drop:
            print(f"  hidden reason:  {drop['reason']}  (recorded {drop['fetched_at']})")
        else:
            print(f"  hidden reason:  hidden_at is set but no feed_drops row found -- likely hidden manually (the Hide button), not by a rule.")

    if row["source"] == "api":
        desc = row["description_full"] or row["description_snippet"] or row["raw_message"] or ""
        keep, cat = ff.classify_focus(row["title"], desc, row["keywords"])
        blob = " ".join(p for p in (row["title"] or "", desc, row["keywords"] or "") if p)
        matched = None
        for pat in list(ff.STRONG_PATTERNS.values()) + list(ff.WEAK_PATTERNS.values()):
            m = pat.search(blob)
            if m:
                matched = m.group(0)
                break
        print(f"  focus filter (today's code): {'KEEP' if keep else 'HIDE'}  category={cat}" + (f"  matched={matched!r}" if matched else ""))
    else:
        print(f"  focus filter: n/a (source={row['source']!r}, the focus test only applies to source='api' jobs)")

    con.close()


if __name__ == "__main__":
    main()
