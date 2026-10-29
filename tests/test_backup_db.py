# -*- coding: utf-8 -*-
"""Off-folder database backup (audit 2026-10-29, T1).

upwork_jobs.db is the only copy of the business -- knowledge base, proposals and
their outcomes, telemetry -- and had no backup outside the repo folder. This pins
the guarantees that make tools/backup_db.py trustworthy, each against a throwaway
database in a temp folder (the real DB and the real backup folder are never used):

  * the snapshot is taken with sqlite's backup API, so rows still sitting in the
    WAL file are included -- a raw file copy would silently miss them;
  * a backup is a single self-contained file, verified before it is accepted;
  * a failed backup is reported, leaves no debris and NEVER triggers retention;
  * retention keeps the last 14 backup-days and 8 older weeks, never the newest
    file's absence, and never touches anything that is not one of our own files;
  * the status that drives the red header chip reads stale/failed/missing right.

Run: .venv\\Scripts\\python tests\\test_backup_db.py
"""
import importlib.util
import json
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location("backup_db", ROOT / "tools" / "backup_db.py")
bk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bk)

bad = 0


def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


def make_source(path, rows=500):
    """A WAL-mode DB whose rows are deliberately left UNcheckpointed: the writer
    connection stays open, so they live in the -wal file, not the main file."""
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    for t in bk.COUNT_TABLES:
        conn.execute(f"CREATE TABLE {t} (id INTEGER PRIMARY KEY, v TEXT)")
    conn.executemany("INSERT INTO jobs (v) VALUES (?)", [(f"row {i}",) for i in range(rows)])
    conn.executemany("INSERT INTO proposals (v) VALUES (?)", [(f"p {i}",) for i in range(40)])
    conn.commit()
    return conn  # caller keeps it open


def touch(directory, when):
    p = Path(directory) / f"upwork_jobs-{when:%Y%m%d-%H%M}.db"
    p.write_bytes(b"x")
    return p


tmp = Path(tempfile.mkdtemp(prefix="fs_backup_test_"))
try:
    # ── 1. the snapshot is WAL-safe, verified, and one clean file ───────────
    src = tmp / "live.db"
    writer = make_source(src, rows=500)
    dest = tmp / "dest"
    now = datetime(2026, 10, 29, 12, 0)

    raw = tmp / "rawcopy.db"
    shutil.copy(src, raw)                      # what a naive backup would do
    try:
        rc = sqlite3.connect(str(raw)).execute("SELECT count(*) FROM jobs").fetchone()[0]
    except sqlite3.DatabaseError:
        rc = 0
    check(rc < 500, f"premise: a raw file copy of a WAL database misses rows ({rc}/500 visible) -- this is why we don't use one")

    res = bk.run_backup(now=now, dest=dest, src=src)
    check(res["ok"] and not res["skipped"], "run_backup reports ok")
    check(bk.NAME_RE.match(res["file"] or "") is not None, f"named upwork_jobs-YYYYMMDD-HHMM.db -> {res['file']}")
    check(res["counts"].get("jobs") == 500, f"the backup holds all 500 rows, including the ones still in the WAL (got {res['counts'].get('jobs')})")
    check(res["counts"].get("proposals") == 40, "…and the other tables")
    got = sqlite3.connect(f"file:{dest / res['file']}?mode=ro", uri=True)
    check(got.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "integrity_check on the copy is ok")
    check(got.execute("PRAGMA journal_mode").fetchone()[0] == "delete",
          "the copy is not in WAL mode, so opening it creates no -wal/-shm files")
    got.close()
    names = sorted(p.name for p in dest.iterdir())
    check(names == sorted([res["file"], bk.STATUS_FILE]),
          f"the folder holds exactly the backup and its status file, no .partial or sidecar debris -> {names}")
    check(json.loads((dest / bk.STATUS_FILE).read_text())["ok"] is True, "status file records the success")

    # ── 2. not one file per --reload restart ────────────────────────────────
    again = bk.run_backup(now=now + timedelta(minutes=30), min_age_hours=6, dest=dest, src=src)
    check(again["skipped"] and again["ok"], "a second call 30 minutes later is skipped when min_age_hours=6")
    check(len([p for p in dest.iterdir() if bk.NAME_RE.match(p.name)]) == 1, "…and no second file was written")
    later = bk.run_backup(now=now + timedelta(hours=7), min_age_hours=6, dest=dest, src=src)
    check(later["ok"] and not later["skipped"], "7 hours later it does take a new backup")

    # ── 3. failure: reported, no debris, retention does NOT run ─────────────
    fdest = tmp / "faildest"
    fdest.mkdir()
    for d in range(30):
        touch(fdest, now - timedelta(days=d))          # 30 days of history, past the 14-day keep
    before = sorted(p.name for p in fdest.iterdir())
    fail = bk.run_backup(now=now, dest=fdest, src=tmp / "does_not_exist.db")
    check(fail["ok"] is False and "not found" in (fail["error"] or ""), f"missing source is reported -> {fail['error']}")
    after = sorted(p.name for p in fdest.iterdir() if p.name != bk.STATUS_FILE)
    check(after == before, "a failed backup deleted nothing (retention does not run after a failure)")
    check(not list(fdest.glob("*.partial*")), "…and left no .partial file")
    check(json.loads((fdest / bk.STATUS_FILE).read_text())["ok"] is False, "the failure is recorded in the status file")
    st = bk.backup_status(fdest, now=now)
    check(st["ok"] is False and st["last_error"], "backup_status then reports not-ok with the error")

    corrupt = tmp / "corrupt.db"
    corrupt.write_bytes(b"this is not a sqlite database" * 100)
    ok, msg, _ = bk.verify_backup(corrupt)
    check(ok is False, f"verify_backup rejects a corrupt file -> {msg[:50]}")

    # ── 4. retention ────────────────────────────────────────────────────────
    rdest = tmp / "retention"
    rdest.mkdir()
    rnow = datetime(2026, 10, 29, 23, 0)
    made = []
    for d in range(0, 30):                              # 30 days, two backups each day
        for hh in (8, 20):
            made.append(touch(rdest, (rnow - timedelta(days=d)).replace(hour=hh, minute=0)))
    for d in range(30, 120):                            # then ~13 weeks, one a day
        made.append(touch(rdest, (rnow - timedelta(days=d)).replace(hour=3, minute=0)))
    keep_pre = rdest / "pre-T1-upwork_jobs-20260101-0000.db"; keep_pre.write_bytes(b"x")
    keep_txt = rdest / "notes.txt"; keep_txt.write_text("keep me")
    (rdest / "legacy").mkdir()
    keep_leg = rdest / "legacy" / "upwork_jobs-20200101-0000.db"; keep_leg.write_bytes(b"x")
    (rdest / bk.STATUS_FILE).write_text("{}")

    deleted = bk.apply_retention(rdest)
    left = sorted(p.name for p in rdest.iterdir() if bk.NAME_RE.match(p.name))

    # independent expectation
    days = {}
    for p in made:
        ts = bk._stamp(p.name)
        days.setdefault(ts.date(), []).append(ts)
    newest_days = sorted(days, reverse=True)[:14]
    exp = {max(days[d]) for d in newest_days}
    cutoff = newest_days[-1]
    weeks = {}
    for d, tss in days.items():
        if d < cutoff:
            weeks.setdefault(max(tss).isocalendar()[:2], []).append(max(tss))
    for wk in sorted(weeks, reverse=True)[:8]:
        exp.add(max(weeks[wk]))
    exp_names = sorted(f"upwork_jobs-{t:%Y%m%d-%H%M}.db" for t in exp)
    check(left == exp_names, f"kept exactly the newest file of 14 days + 8 older weeks ({len(left)} files; expected {len(exp_names)})")
    check(len(left) == 22, "…which is 14 daily + 8 weekly = 22")
    check(f"upwork_jobs-{rnow:%Y%m%d}-2000.db" in left, "the newest file is kept")
    check(keep_pre.exists() and keep_txt.exists() and keep_leg.exists() and (rdest / bk.STATUS_FILE).exists(),
          "pre-* snapshots, other files, legacy/ and the status file are never touched")
    check(len(deleted) == len(made) - 22, f"deleted exactly the surplus ({len(deleted)})")

    gdest = tmp / "gap"
    gdest.mkdir()
    old = [touch(gdest, datetime(2026, 8, 1, 10, 0)), touch(gdest, datetime(2026, 8, 2, 10, 0)), touch(gdest, datetime(2026, 8, 3, 10, 0))]
    bk.apply_retention(gdest)
    check(all(p.exists() for p in old), "three old backups with nothing newer are all kept: a month switched off cannot age out the last good copies")

    # ── 5. status for the header chip ───────────────────────────────────────
    sdest = tmp / "status"
    sdest.mkdir()
    snow = datetime(2026, 10, 29, 12, 0)
    touch(sdest, snow - timedelta(hours=3))
    s = bk.backup_status(sdest, now=snow)
    check(s["ok"] and not s["stale"] and s["age_hours"] == 3.0, f"3 h old -> ok, not stale ({s['age_hours']} h)")
    touch(sdest, snow - timedelta(hours=1)).unlink()
    for p in list(sdest.iterdir()):
        p.unlink()
    touch(sdest, snow - timedelta(hours=72))
    s = bk.backup_status(sdest, now=snow)
    check(s["stale"] and s["ok"] and s["age_hours"] == 72.0, "72 h old -> stale (the chip goes red)")
    for p in list(sdest.iterdir()):
        p.unlink()
    touch(sdest, snow - timedelta(hours=48))
    check(not bk.backup_status(sdest, now=snow)["stale"], "exactly 48 h is still fine; over 48 h is stale")
    empty = tmp / "empty"; empty.mkdir()
    s = bk.backup_status(empty, now=snow)
    check(s["stale"] and not s["ok"] and s["last_backup_at"] is None, "an empty folder -> stale and not ok")
    s = bk.backup_status(tmp / "nowhere", now=snow)
    check(s["stale"] and not s["ok"] and s["dir_exists"] is False, "a folder that does not exist -> stale, not ok, dir_exists False")

    # ── 6. configuration ────────────────────────────────────────────────────
    check(bk.backup_dir(environ={"BACKUP_DIR": r"D:\Safe\Backups"}, env_file=tmp / "none.env") == Path(r"D:\Safe\Backups"),
          "BACKUP_DIR from the environment")
    envf = tmp / "x.env"
    envf.write_text('FOO=1\nBACKUP_DIR="C:\\Users\\me\\Dropbox\\FalconScoutBackups"\n', encoding="utf-8")
    check(bk.backup_dir(environ={}, env_file=envf) == Path(r"C:\Users\me\Dropbox\FalconScoutBackups"),
          "BACKUP_DIR from .env, quotes stripped, backslashes kept literally")
    check(bk.backup_dir(environ={}, env_file=tmp / "missing.env") == Path.home() / "FalconScoutBackups",
          "no setting -> %USERPROFILE%\\FalconScoutBackups")
    check(bk.source_db(environ={"DATABASE_URL": "sqlite:///upwork_jobs.db"}, env_file=tmp / "m.env") == ROOT / "upwork_jobs.db",
          "DATABASE_URL sqlite:///upwork_jobs.db resolves to the repo's DB")

    # ── 7. wiring: scheduled, exposed, proxied, mounted, never a raw copy ───
    tool_src = (ROOT / "tools" / "backup_db.py").read_text(encoding="utf-8")
    check("shutil" not in tool_src and ".backup(" in tool_src, "the tool uses Connection.backup() and never shutil (no raw file copy)")
    main_src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    check("asyncio.create_task(_backup_loop())" in main_src, "the backend starts the backup loop at startup")
    check('@app.get("/backup-status")' in main_src, "GET /backup-status exists")
    check("run_in_executor" in main_src[main_src.index("async def _backup_loop"):main_src.index('@app.get("/backup-status")')],
          "the backup runs in a threadpool, never on the event loop")
    check("'/backup-status'" in (ROOT / "frontend" / "vite.config.js").read_text(encoding="utf-8"),
          "the Vite dev proxy forwards /backup-status (otherwise the chip would fetch a 404)")
    app_src = (ROOT / "frontend" / "src" / "App.jsx").read_text(encoding="utf-8")
    check("<BackupChip />" in app_src and "import BackupChip" in app_src, "the chip is mounted in the header")
finally:
    try:
        writer.close()
    except Exception:
        pass
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
