"""
Migration: adds is_invited / auto_captured to the proposals table.

Run from project root:
  .\\.venv\\Scripts\\python add_invited_columns.py

Why (2026-10-11): "invited" was a value of proposals.status, so it lost every
race — _STATUS_RANK puts invited (3) below replied (2) and promotion never
downgrades, so an invited client answering erased the fact that they had
invited. The dashboard read "0 invited" across all 324 proposals while an invite
sat in the inbox. Being invited is not a funnel stage; it is how the engagement
began, and it is true forever once true. It now lives in its own column.

Safe to re-run: existing columns are skipped. Any row whose status is still
'invited' is backfilled to is_invited = 1 before anything else can overwrite it.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "upwork_jobs.db"

NEW_COLUMNS = [
    ("is_invited",    "BOOLEAN NOT NULL DEFAULT 0"),
    ("auto_captured", "BOOLEAN NOT NULL DEFAULT 0"),
]


def main():
    if not DB_PATH.exists():
        raise SystemExit(f"No database at {DB_PATH} - nothing to migrate.")

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    existing = {r[1] for r in cur.execute("PRAGMA table_info(proposals)")}

    added = []
    for name, decl in NEW_COLUMNS:
        if name in existing:
            print(f"  = {name} already present, skipping")
            continue
        cur.execute(f"ALTER TABLE proposals ADD COLUMN {name} {decl}")
        added.append(name)
        print(f"  + {name} added")

    if "is_invited" in added:
        n = cur.execute(
            "UPDATE proposals SET is_invited = 1 WHERE status = 'invited'"
        ).rowcount
        print(f"  * backfilled is_invited from status='invited': {n} row(s)")
        # Anything invited that has since progressed cannot be recovered — the
        # old status was overwritten in place and no transition history exists.
        # Say so rather than leave the number looking authoritative.
        print("    (invites that already progressed to replied/hired are NOT")
        print("     recoverable - the status was overwritten with no history)")

    cur.execute("CREATE INDEX IF NOT EXISTS ix_proposals_is_invited ON proposals (is_invited)")
    con.commit()

    cols = {r[1] for r in cur.execute("PRAGMA table_info(proposals)")}
    ok = all(name in cols for name, _ in NEW_COLUMNS)
    print(f"\n{'OK' if ok else 'FAILED'} - proposals now has: is_invited={('is_invited' in cols)}, "
          f"auto_captured={('auto_captured' in cols)}")
    con.close()


if __name__ == "__main__":
    main()
