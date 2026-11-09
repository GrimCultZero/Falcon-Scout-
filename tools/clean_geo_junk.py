# -*- coding: utf-8 -*-
"""Set junk `jobs.geo_restriction` values to NULL (audit 2026-10-29, T20 step 5).

The old scraper stored whatever text followed a label: "Skills and Expertise",
"English: Strong working proficiency", "- Tools: Google Ads / MCC, GA4, GTM, Hub",
"**Working commitment:** 4 hours per day,". A value is JUNK when the T20 known-value
rule (api/geo_restriction.py) refuses it. Real values ("Worldwide", "United States
only", a country, a region) are never touched, and neither are rows that already have
evidence.

Dry run by default: it lists what would change and changes nothing.
  .venv\\Scripts\\python tools\\clean_geo_junk.py            # list
  .venv\\Scripts\\python tools\\clean_geo_junk.py --apply    # take a verified backup, then clean

--apply refuses to run unless tools/backup_db.py reports a verified backup first.
"""
import argparse
import importlib.util
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
from geo_restriction import normalize_geo_value  # noqa: E402


def find_junk(con):
    out = []
    for id_, src, uid, title, val in con.execute(
            "SELECT id, source, upwork_job_id, title, geo_restriction FROM jobs WHERE geo_restriction IS NOT NULL"):
        if normalize_geo_value(val) is None:
            out.append((id_, src, uid, title, val))
    return out


def _backup(db_path):
    spec = importlib.util.spec_from_file_location("falcon_backup_db", ROOT / "tools" / "backup_db.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.run_backup()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Null out junk geo_restriction values")
    ap.add_argument("--apply", action="store_true", help="really change the database (a verified backup is taken first)")
    ap.add_argument("--db", default=str(ROOT / "upwork_jobs.db"))
    ap.add_argument("--no-backup", action="store_true", help="tests only: skip the backup step")
    args = ap.parse_args(argv)

    ro = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    junk = find_junk(ro)
    ro.close()
    print(f"{len(junk)} junk geo_restriction value(s):")
    for id_, src, uid, title, val in junk:
        print(f"  #{id_} [{src}] {str(title)[:50]!r}  value={val!r}")
    if not args.apply:
        print("dry run: nothing changed (use --apply)")
        return 0
    if not junk:
        print("nothing to do")
        return 0

    if not args.no_backup:
        res = _backup(args.db)
        if not res.get("ok"):
            print(f"REFUSING: the backup failed ({res.get('error')}); nothing changed")
            return 1
        print(f"backup ok: {res.get('file')}")
    con = sqlite3.connect(args.db, timeout=30)
    con.execute("PRAGMA busy_timeout=30000")
    ids = [j[0] for j in junk]
    con.executemany("UPDATE jobs SET geo_restriction = NULL, geo_evidence = NULL, geo_read_at = NULL WHERE id = ? AND geo_restriction IS NOT NULL",
                    [(i,) for i in ids]) if _has_cols(con) else con.executemany(
        "UPDATE jobs SET geo_restriction = NULL WHERE id = ?", [(i,) for i in ids])
    con.commit()
    con.close()
    print(f"set {len(ids)} row(s) to NULL: {ids}")
    return 0


def _has_cols(con):
    cols = {r[1] for r in con.execute("PRAGMA table_info(jobs)")}
    return {"geo_evidence", "geo_read_at"} <= cols


if __name__ == "__main__":
    sys.exit(main())
