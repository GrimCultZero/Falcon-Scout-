# -*- coding: utf-8 -*-
"""Backfill proposals.analysis_json from jobs.last_analysis_json (audit 2026-10-29, T9).

Record-only. A proposal gets a snapshot ONLY if it has none AND its job's last analysis
was saved BEFORE the proposal was submitted (a contemporaneous one). Everything else stays
NULL: an analysis made after sending says nothing about the decision to send.

DRY RUN by default (prints what it would do, writes nothing). `--apply` writes, and
refuses to run unless a database backup newer than --max-backup-age-min (default 60)
exists in the backup folder (python tools/backup_db.py --min-age 0).

Usage:  python tools/backfill_analysis_snapshots.py [--apply]
"""
import argparse
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tools"))
import calibration  # noqa: E402


class _Job:                                             # the two fields snapshot_text reads
    def __init__(self, raw, at):
        self.last_analysis_json, self.last_analysis_at = raw, at


def plan(con):
    rows = con.execute(
        "SELECT p.id, p.submitted_at, j.last_analysis_json, j.last_analysis_at, p.analysis_json "
        "FROM proposals p JOIN jobs j ON j.id = p.job_id").fetchall()
    todo = []
    skipped = {"already set": 0, "no analysis": 0, "no submitted_at": 0,
               "analysis not before submission": 0, "unreadable analysis": 0}
    for pid, sub, raw, at, existing in rows:
        if existing:
            skipped["already set"] += 1
        elif not raw:
            skipped["no analysis"] += 1
        elif not sub:
            skipped["no submitted_at"] += 1
        else:
            text = calibration.snapshot_text(_Job(raw, at), sub)
            if text:
                todo.append((pid, text))
            else:
                a, s = calibration._naive_utc(at), calibration._naive_utc(sub)
                skipped["unreadable analysis" if (a and s and a < s) else "analysis not before submission"] += 1
    return todo, skipped, len(rows)


def newest_backup_age_min(backup_dir):
    files = sorted(Path(backup_dir).glob("upwork_jobs-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    return None if not files else (time.time() - files[0].stat().st_mtime) / 60


def main(argv=None, db=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--max-backup-age-min", type=int, default=60)
    ap.add_argument("--backup-dir")
    a = ap.parse_args(argv)
    db = Path(db or ROOT / "upwork_jobs.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    todo, skipped, total = plan(con)
    con.close()
    print(f"proposals: {total}   would snapshot: {len(todo)}   skipped: {sum(skipped.values())}")
    for k, v in skipped.items():
        print(f"  skipped - {k}: {v}")
    if not a.apply:
        print("DRY RUN: nothing written. Re-run with --apply after backing up the database.")
        return 0
    import backup_db
    bdir = a.backup_dir or backup_db.backup_dir()
    age = newest_backup_age_min(bdir)
    if age is None or age > a.max_backup_age_min:
        print(f"REFUSED: no database backup newer than {a.max_backup_age_min} min in {bdir} "
              f"(run: python tools/backup_db.py --min-age 0).")
        return 1
    con = sqlite3.connect(db)
    with con:
        for pid, text in todo:
            con.execute("UPDATE proposals SET analysis_json = ? WHERE id = ? AND analysis_json IS NULL", (text, pid))
    con.close()
    print(f"APPLIED: {len(todo)} snapshots written (backup {age:.0f} min old).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
