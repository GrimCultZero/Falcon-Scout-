# -*- coding: utf-8 -*-
"""Replay the auto Digit Bomb matcher on stored jobs (audit 2026-10-29, T22). READ-ONLY, no model call.

Reads recent jobs from upwork_jobs.db (opened read-only), pipes them to tools/digit_bomb_replay.mjs,
which runs the same matcher the generator uses, and prints how many would fire plus examples, so the
threshold in frontend/src/lib/digitBombConfig.js can be checked against real postings.

Usage:  python tools/digit_bomb_replay.py [--days 7] [--examples N|all] [--previous id,id,...] [--source api]
"""
import argparse
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--examples", default="5", help="N, or all")
    ap.add_argument("--previous", default="", help="comma-separated job ids that fired before, to see which stopped")
    ap.add_argument("--source", default=None, help="only this jobs.source (default: all)")
    a = ap.parse_args()
    since = (datetime.now(timezone.utc) - timedelta(days=a.days)).strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(f"file:{ROOT / 'upwork_jobs.db'}?mode=ro", uri=True)
    q = ("SELECT id, title, description_full, description_snippet, raw_message, client_country, job_classification_json "
         "FROM jobs WHERE captured_at >= ?" + (" AND source = ?" if a.source else ""))
    rows = con.execute(q, (since, a.source) if a.source else (since,)).fetchall()
    con.close()
    keys = ["id", "title", "description_full", "description_snippet", "raw_message", "client_country", "job_classification_json"]
    jobs = [dict(zip(keys, r)) for r in rows]
    r = subprocess.run(["node", str(ROOT / "tools" / "digit_bomb_replay.mjs"), str(a.examples), a.previous], input=json.dumps(jobs),
                       capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT))
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(r.stdout + r.stderr)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
