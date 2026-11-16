# -*- coding: utf-8 -*-
"""Backfill the T12 bid snapshots on proposals from the jobs table (audit 2026-10-29). RECORD-ONLY.

Fills ONLY empty fields, and only with what was known BEFORE the proposal was submitted:
  * the boost ladder + its capture time: only where jobs.boost_bids_captured_at < proposals.submitted_at, else NULL;
  * the applicants band AND the client's spend band: only where jobs.enriched_at < proposals.submitted_at, else NULL;
  * the connects bid and whether the title says "audit" (they do not change with time).
A proposal with no submitted_at gets only those two. Nothing is overwritten.

DRY RUN by default (prints what it would do, writes nothing). `--apply` refuses unless a database backup newer than
--max-backup-age-min (default 60) exists (python tools/backup_db.py --min-age 0).

Usage:  python tools/backfill_bid_signals.py [--apply]
"""
import argparse
import sqlite3
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tools"))
import bid_signals  # noqa: E402

FIELDS = ("boost_ladder_json", "boost_ladder_at", "applicants_band", "connects_bid", "client_spend_band", "title_has_audit")


def plan(con):
    con.row_factory = sqlite3.Row
    have = {r[1] for r in con.execute("PRAGMA table_info(proposals)")}
    # before the backend has restarted and added the columns, treat them as empty (a dry run still tells the truth)
    rows = con.execute(
        "SELECT p.id AS pid, p.submitted_at, p.bid_amount, p.bid_currency, "
        + ", ".join((f"p.{f}" if f in have else "NULL") + f" AS p_{f}" for f in FIELDS) + ", "
        "j.title, j.boost_bids_json, j.boost_bids_captured_at, j.enriched_at, j.proposals, j.client_spend, j.client_total_spent_detail "
        "FROM proposals p JOIN jobs j ON j.id = p.job_id").fetchall()
    todo, counts = [], {f: 0 for f in FIELDS}
    for r in rows:
        job = SimpleNamespace(title=r["title"], boost_bids_json=r["boost_bids_json"], boost_bids_captured_at=r["boost_bids_captured_at"],
                              enriched_at=r["enriched_at"], proposals=r["proposals"], client_spend=r["client_spend"],
                              client_total_spent_detail=r["client_total_spent_detail"])
        prop = SimpleNamespace(bid_amount=r["bid_amount"], bid_currency=r["bid_currency"])
        sets = {f: v for f, v in bid_signals.snapshot_values(job, prop, r["submitted_at"]).items() if r[f"p_{f}"] is None}
        if sets:
            todo.append((r["pid"], sets))
            for f in sets:
                counts[f] += 1
    return todo, counts, len(rows)


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
    todo, counts, total = plan(con)
    con.close()
    print(f"proposals: {total}   proposals that would get at least one field: {len(todo)}")
    for f, n in counts.items():
        print(f"  {f}: {n}")
    if not a.apply:
        print("DRY RUN: nothing written. Re-run with --apply after backing up the database.")
        return 0
    import backup_db
    bdir = a.backup_dir or backup_db.backup_dir()
    age = newest_backup_age_min(bdir)
    if age is None or age > a.max_backup_age_min:
        print(f"REFUSED: no database backup newer than {a.max_backup_age_min} min in {bdir} (run: python tools/backup_db.py --min-age 0).")
        return 1
    con = sqlite3.connect(db)
    have = {r[1] for r in con.execute("PRAGMA table_info(proposals)")}
    missing = [f for f in FIELDS if f not in have]
    if missing:
        print(f"REFUSED: proposals has no column(s) {missing}. Restart the backend once (it adds them), then run this again.")
        con.close()
        return 1
    with con:
        for pid, sets in todo:
            for f, v in sets.items():
                con.execute(f"UPDATE proposals SET {f} = ? WHERE id = ? AND {f} IS NULL", (v, pid))
    con.close()
    print(f"APPLIED to {len(todo)} proposals (backup {age:.0f} min old).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
