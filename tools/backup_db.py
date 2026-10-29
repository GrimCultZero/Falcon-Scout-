"""Daily, verified backup of upwork_jobs.db to a folder OUTSIDE the repo.

Why this exists (audit 2026-10-29, finding P0): the database is the only copy of
the business -- ~800 KB entries, 400+ proposals with outcomes, telemetry -- and it
lived next to the code with no off-machine copy. The five `upwork_jobs.db.bak-*`
files beside it were the only history, and they sat in the same folder.

How it works
  * sqlite3.Connection.backup(), never a file copy. The app runs the DB in WAL
    mode, so a raw copy of upwork_jobs.db misses whatever is still in the -wal
    file; the backup API takes a consistent snapshot while the app keeps writing.
  * The copy is written to `<name>.partial`, opened, checked with
    PRAGMA integrity_check, and only then renamed into place. A half-written or
    corrupt file can therefore never be mistaken for a good backup.
  * Retention keeps the newest file of each of the last 14 DAYS THAT HAVE A
    BACKUP, plus the newest file of each of the 8 weeks before those. Counting
    days-with-backups instead of calendar days means a month with the app switched
    off can never age out the last good copies. The single newest file is never
    deleted, and only files named upwork_jobs-YYYYMMDD-HHMM.db are ever touched:
    `pre-*` snapshots, the `legacy/` folder and the status file are left alone.
  * Retention does not run after a failed backup.

Where it writes: BACKUP_DIR from .env (or the environment), else
%USERPROFILE%\\FalconScoutBackups. Point it at a Dropbox/OneDrive-synced folder
to get an off-machine copy.

CLI:   python tools/backup_db.py [--min-age HOURS] [--status]
Exit:  0 = backup ok (or skipped as recent), 1 = failed.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NAME_RE = re.compile(r"^upwork_jobs-(\d{8})-(\d{4})\.db$")
STATUS_FILE = "backup_status.json"
KEEP_DAILY = 14
KEEP_WEEKLY = 8
STALE_HOURS = 48
COUNT_TABLES = ("jobs", "proposals", "kb_entries", "token_usage", "rule_violations", "sync_runs")


# ── configuration ────────────────────────────────────────────────────────────
def _read_env_file(env_file=None):
    """KEY=VALUE pairs from .env, without a python-dotenv dependency. Values are
    taken literally (a Windows path keeps its backslashes). Returns {}."""
    path = Path(env_file) if env_file else ROOT / ".env"
    out = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
                val = val[1:-1]
            out[key.strip()] = val
    except OSError:
        pass
    return out


def backup_dir(environ=None, env_file=None):
    """BACKUP_DIR (environment first, then .env), else ~/FalconScoutBackups."""
    environ = os.environ if environ is None else environ
    val = environ.get("BACKUP_DIR") or _read_env_file(env_file).get("BACKUP_DIR")
    if val:
        return Path(os.path.expandvars(val)).expanduser()
    return Path.home() / "FalconScoutBackups"


def source_db(environ=None, env_file=None):
    """The live database file, from DATABASE_URL (sqlite:///relative.db)."""
    environ = os.environ if environ is None else environ
    url = environ.get("DATABASE_URL") or _read_env_file(env_file).get("DATABASE_URL") or ""
    if url.startswith("sqlite:///"):
        p = Path(url[len("sqlite:///"):])
        return p if p.is_absolute() else ROOT / p
    return ROOT / "upwork_jobs.db"


# ── listing ──────────────────────────────────────────────────────────────────
def _stamp(name):
    m = NAME_RE.match(name)
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M") if m else None


def list_backups(directory):
    """[(datetime, Path)] for our own backup files only, newest first."""
    d = Path(directory)
    if not d.is_dir():
        return []
    found = []
    for p in d.iterdir():
        ts = _stamp(p.name)
        if ts and p.is_file():
            found.append((ts, p))
    found.sort(key=lambda x: x[0], reverse=True)
    return found


# ── verification ─────────────────────────────────────────────────────────────
def verify_backup(path):
    """(ok, message, counts). Opens the copy read-only and runs integrity_check."""
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            res = conn.execute("PRAGMA integrity_check").fetchone()
            if not res or res[0] != "ok":
                return False, f"integrity_check: {res[0] if res else 'no result'}", {}
            counts = {}
            for t in COUNT_TABLES:
                try:
                    counts[t] = conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
                except sqlite3.DatabaseError:
                    counts[t] = None
            return True, "ok", counts
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        return False, f"cannot open: {exc}", {}


# ── retention ────────────────────────────────────────────────────────────────
def apply_retention(directory, keep_daily=KEEP_DAILY, keep_weekly=KEEP_WEEKLY):
    """Delete backups outside the keep set. Returns the list of deleted names."""
    files = list_backups(directory)          # newest first
    if not files:
        return []
    keep = {files[0][1]}                     # the newest is never deleted

    # newest file of each of the most recent N days that have a backup
    seen_days, daily_kept_days = set(), []
    for ts, p in files:
        day = ts.date()
        if day in seen_days:
            continue
        seen_days.add(day)
        if len(daily_kept_days) < keep_daily:
            daily_kept_days.append(day)
            keep.add(p)

    # then the newest file of each of the most recent N older weeks
    cutoff = daily_kept_days[-1] if daily_kept_days else None
    seen_weeks = set()
    for ts, p in files:
        if cutoff is not None and ts.date() >= cutoff:
            continue                         # already covered by the daily set
        wk = ts.isocalendar()[:2]
        if wk in seen_weeks:
            continue
        if len(seen_weeks) < keep_weekly:
            seen_weeks.add(wk)
            keep.add(p)

    deleted = []
    for ts, p in files:
        if p not in keep:
            try:
                p.unlink()
                deleted.append(p.name)
            except OSError:
                pass
    return deleted


# ── the backup ───────────────────────────────────────────────────────────────
def _write_status(directory, payload):
    try:
        (Path(directory) / STATUS_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        pass


def run_backup(now=None, min_age_hours=None, dest=None, src=None):
    """Take one verified backup. Returns a result dict (never raises).

    min_age_hours: skip when a good backup newer than this already exists, so the
    backend restarting under --reload doesn't produce a 45 MB file per restart.
    """
    now = now or datetime.now()
    dest = Path(dest) if dest else backup_dir()
    src = Path(src) if src else source_db()
    result = {"ok": False, "skipped": False, "file": None, "size_bytes": None,
              "error": None, "deleted": [], "counts": {}, "at": now.isoformat(timespec="seconds"),
              "dir": str(dest)}

    try:
        if min_age_hours is not None:
            existing = list_backups(dest)
            if existing:
                age_h = (now - existing[0][0]).total_seconds() / 3600
                if age_h < min_age_hours:
                    result.update(ok=True, skipped=True, file=existing[0][1].name,
                                  size_bytes=existing[0][1].stat().st_size)
                    return result

        if not src.is_file():
            raise FileNotFoundError(f"source database not found: {src}")
        dest.mkdir(parents=True, exist_ok=True)

        final = dest / f"upwork_jobs-{now:%Y%m%d-%H%M}.db"
        partial = dest / (final.name + ".partial")
        if partial.exists():
            partial.unlink()

        s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
        t = sqlite3.connect(str(partial))
        try:
            s.backup(t)
            # The snapshot inherits the source's WAL mode. Left that way, merely
            # opening the backup would spawn -wal/-shm files beside it (they did,
            # in the first test run). Convert it so a backup is ONE file.
            t.execute("PRAGMA journal_mode=DELETE")
        finally:
            t.close()
            s.close()

        ok, msg, counts = verify_backup(partial)
        for suffix in ("-wal", "-shm"):      # belt and braces: no orphans under the temp name
            Path(str(partial) + suffix).unlink(missing_ok=True)
        if not ok:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"backup failed verification ({msg}); discarded")

        os.replace(partial, final)
        result.update(ok=True, file=final.name, size_bytes=final.stat().st_size, counts=counts)
        result["deleted"] = apply_retention(dest)
    except Exception as exc:                 # report, never crash the caller
        result.update(ok=False, error=f"{type(exc).__name__}: {exc}")

    if not result["skipped"]:
        _write_status(dest, {k: result[k] for k in ("ok", "error", "file", "size_bytes", "counts", "at")})
    return result


# ── status ───────────────────────────────────────────────────────────────────
def backup_status(directory=None, now=None, stale_hours=STALE_HOURS):
    """What the UI chip and /backup-status report.

    ok     = the newest backup exists and the last attempt did not fail
    stale  = no backup at all, or the newest is older than stale_hours
    The chip is red when `stale` or not `ok`.
    """
    now = now or datetime.now()
    d = Path(directory) if directory else backup_dir()
    files = list_backups(d)
    last_attempt = {}
    try:
        last_attempt = json.loads((d / STATUS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass

    status = {"dir": str(d), "dir_exists": d.is_dir(), "last_backup_at": None, "age_hours": None,
              "size_bytes": None, "file": None, "backups_kept": len(files),
              "last_error": last_attempt.get("error") if last_attempt.get("ok") is False else None}
    if files:
        ts, p = files[0]
        status.update(last_backup_at=ts.isoformat(timespec="minutes"), file=p.name,
                      age_hours=round((now - ts).total_seconds() / 3600, 1),
                      size_bytes=p.stat().st_size)
    status["stale"] = (not files) or status["age_hours"] > stale_hours
    status["ok"] = bool(files) and status["last_error"] is None
    return status


def main(argv=None):
    ap = argparse.ArgumentParser(description="Verified backup of upwork_jobs.db")
    ap.add_argument("--min-age", type=float, default=None, help="skip if a backup newer than this many hours exists")
    ap.add_argument("--status", action="store_true", help="print status and exit")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    if args.status:
        print(json.dumps(backup_status(), indent=2))
        return 0
    res = run_backup(min_age_hours=args.min_age)
    print(json.dumps(res, indent=2))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
