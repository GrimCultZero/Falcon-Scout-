# -*- coding: utf-8 -*-
"""T7 pre-merge review: proposals.is_invited / auto_captured wired into the
backend's own startup migration (api/main.py's _ensure_job_columns), not just
the standalone add_invited_columns.py script.

Lifts the REAL _ensure_job_columns out of api/main.py by AST (that file is never
imported by tests) and runs it against a scratch SQLite DB built to look like a
pre-T7 database: jobs/kb_entries/proposals tables exist, with only the columns
that predate is_invited/auto_captured, and one proposals row still sitting at
status='invited' (the exact case the backfill exists for).

Run: .venv\\Scripts\\python tests\\test_invited_migration.py
"""
import ast
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_ensure_job_columns"}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT_FUNCS]
if {n.name for n in nodes} != WANT_FUNCS:
    print(f"FAIL  could not lift _ensure_job_columns from api/main.py (found {[n.name for n in nodes]})")
    sys.exit(1)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


tmp = Path(tempfile.mkdtemp(prefix="fs_invited_migration_"))
db_path = tmp / "scratch.db"
try:
    # A minimal pre-T7 schema: just enough of jobs/kb_entries/proposals for
    # _ensure_job_columns to run without erroring on an unrelated missing table,
    # and a proposals table that predates is_invited/auto_captured entirely.
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE jobs (id INTEGER PRIMARY KEY, captured_at DATETIME);
        CREATE TABLE kb_entries (id INTEGER PRIMARY KEY);
        CREATE TABLE proposals (
            id INTEGER PRIMARY KEY,
            job_id INTEGER,
            status TEXT
        );
    """)
    con.execute("INSERT INTO proposals (id, job_id, status) VALUES (1, 100, 'invited')")
    con.execute("INSERT INTO proposals (id, job_id, status) VALUES (2, 101, 'sent')")
    con.execute("INSERT INTO proposals (id, job_id, status) VALUES (3, 102, 'replied')")
    con.commit()
    con.close()

    cols_before = {r[1] for r in sqlite3.connect(db_path).execute("PRAGMA table_info(proposals)")}
    check("is_invited" not in cols_before and "auto_captured" not in cols_before,
          "sanity: the scratch DB starts WITHOUT is_invited / auto_captured")

    from sqlalchemy import create_engine
    ns = {"engine": create_engine(f"sqlite:///{db_path}")}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_ensure_columns", "exec"), ns)
    ns["_ensure_job_columns"]()

    con = sqlite3.connect(db_path)
    cols_after = {r[1] for r in con.execute("PRAGMA table_info(proposals)")}
    check("is_invited" in cols_after, "is_invited exists after _ensure_job_columns() runs")
    check("auto_captured" in cols_after, "auto_captured exists after _ensure_job_columns() runs")

    rows = {r[0]: r[1] for r in con.execute("SELECT id, is_invited FROM proposals ORDER BY id")}
    check(rows == {1: 1, 2: 0, 3: 0}, f"only the row that was still status='invited' is backfilled to is_invited=1: {rows}")

    auto = {r[0] for r in con.execute("SELECT id FROM proposals WHERE auto_captured = 1")}
    check(auto == set(), "auto_captured defaults to 0 for every existing row -- nothing is retroactively marked auto-captured")

    idx = {r[1] for r in con.execute("PRAGMA index_list(proposals)")}
    check("ix_proposals_is_invited" in idx, "the index from the standalone script is created too")

    # idempotent: running it again must not error or change anything
    ns["_ensure_job_columns"]()
    cols_again = {r[1] for r in con.execute("PRAGMA table_info(proposals)")}
    rows_again = {r[0]: r[1] for r in con.execute("SELECT id, is_invited FROM proposals ORDER BY id")}
    check(cols_again == cols_after and rows_again == rows, "running it a second time is a no-op (safe to re-run on every backend startup)")
    con.close()
finally:
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
