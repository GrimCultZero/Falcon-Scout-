"""
Scratch backend + scratch frontend for BROWSER CHECKS. The only way a check may touch a running Metro page.

Why this exists (F5, 25 Nov 2026): the F4 browser check wrote 3 test leads, 3 companies and 2 import rows into the
LIVE database although the handoff said "a copy". The page was served on :5180 and Vite's proxy sends /metro/ to
:8000 (the live backend), so every click that went through that page reached the live file, whatever scratch
backend was also running. Nothing stopped it.

What this launcher does instead:
  1. It REFUSES to start unless the database it was given is a copy: an existing SQLite file that is not the repo's
     live file (same file by path, by hard link or by symlink), not inside the repo folder, and not the file
     DATABASE_URL in .env points at. `--copy-live` makes such a copy itself (SQLite backup API, safe while the live
     app runs) under the system temp folder.
  2. It starts the backend on its own port (never :8000) with DATABASE_URL pointing at the copy, with NONE of the
     background loops (Upwork feed, prune, backup, ghost sweep, CLI bridge start), so a check cannot spend an
     Upwork API call or race the live app for the token file.
  3. It starts its own Vite dev server on its own port (never :5180) whose proxy target is the scratch backend
     (FALCON_BACKEND_URL), so the page cannot reach :8000 at all.
  4. api/main.py loads `.env` with override=True and `.env` names the LIVE database, so an environment variable alone does not
     work: the launcher wraps dotenv's loader so DATABASE_URL stays the copy, proves that BEFORE importing the app, and after the
     import verifies that both database layers (Falcon Scout's and Metro's) resolved to the approved copy.

Usage:
  .venv\\Scripts\\python tools\\scratch_check.py --copy-live
  .venv\\Scripts\\python tools\\scratch_check.py --db D:\\scratch\\copy.db
  .venv\\Scripts\\python tools\\scratch_check.py --check-only --db <path>     (run the guard, start nothing)

Never import api.main from a shell against the live DB: its import runs the startup prune. This file imports it only
after the guard has passed.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIVE_DB = ROOT / "upwork_jobs.db"
LIVE_BACKEND_PORT = 8000
LIVE_FRONTEND_PORT = 5180
DEFAULT_BACKEND_PORT = 8001
DEFAULT_FRONTEND_PORT = 5190


class ScratchRefused(Exception):
    """The scratch launcher will not start on this database."""


def _sqlite_path_from_url(url: str) -> Path | None:
    prefix = "sqlite:///"
    if url and url.startswith(prefix):
        return Path(url[len(prefix):])
    return None


def _dotenv_database_path() -> Path | None:
    """The file DATABASE_URL in .env points at (the live app's), if the .env sets one."""
    env = ROOT / ".env"
    if not env.is_file():
        return None
    for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            return _sqlite_path_from_url(line.split("=", 1)[1].strip().strip('"').strip("'"))
    return None


def _same_file(a: Path, b: Path) -> bool:
    try:
        if a.exists() and b.exists() and os.path.samefile(a, b):
            return True
    except OSError:
        pass
    try:
        return os.path.normcase(str(a.resolve())) == os.path.normcase(str(b.resolve()))
    except OSError:
        return False


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def assert_scratch_db(path, root: Path = ROOT, live: Path | None = None, extra_live: list | None = None) -> Path:
    """Return the resolved path when it is a scratch COPY; raise ScratchRefused otherwise.

    Refuses: no path; a sqlite URL that is not a plain file; a missing file (a scratch run must not create an empty
    database that then looks fine); a directory; the live file (same path, hard link, symlink, or the `-wal` / `-shm`
    sibling of it); a file inside the repo folder; the file .env's DATABASE_URL names.
    """
    live = Path(live) if live is not None else (root / "upwork_jobs.db")
    if path is None or not str(path).strip():
        raise ScratchRefused("no database path was given; a scratch run needs a COPY (use --copy-live or --db <file>)")
    raw = str(path).strip()
    from_url = _sqlite_path_from_url(raw)
    if raw.startswith("sqlite:") and from_url is None:
        raise ScratchRefused(f"'{raw}' is not a plain sqlite file URL")
    p = from_url if from_url is not None else Path(raw)
    if str(p) in (":memory:", ""):
        raise ScratchRefused("an in-memory database cannot be a scratch copy")
    if not p.exists():
        raise ScratchRefused(f"{p} does not exist; a scratch run must start from a copy that already has the data (--copy-live)")
    if not p.is_file():
        raise ScratchRefused(f"{p} is not a file")
    candidates = [live, Path(str(live) + "-wal"), Path(str(live) + "-shm"), Path(str(live) + "-journal")]
    candidates += [Path(x) for x in (extra_live or [])]
    dotenv_db = _dotenv_database_path()
    if dotenv_db is not None:
        candidates.append(dotenv_db if dotenv_db.is_absolute() else root / dotenv_db)
    for c in candidates:
        if _same_file(p, c):
            raise ScratchRefused(f"{p} is the LIVE database file ({c.name}); a scratch run must use a copy")
    if _inside(p, root):
        raise ScratchRefused(f"{p} is inside the repo folder; put the copy outside it (the system temp folder, for example)")
    return p.resolve()


def make_live_copy(dest_dir: Path | None = None, live: Path = LIVE_DB) -> Path:
    """Copy the live database with SQLite's backup API (consistent even while the live backend writes). The live file is
    opened read-only."""
    if not live.is_file():
        raise ScratchRefused(f"the live database {live} was not found")
    dest_dir = Path(dest_dir) if dest_dir else Path(tempfile.gettempdir()) / "falcon-scratch" / time.strftime("%Y%m%d-%H%M%S")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "upwork_jobs_copy.db"
    src = sqlite3.connect(f"file:{live.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(str(dest))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return dest


def check_ports(backend_port: int, frontend_port: int) -> None:
    if backend_port == LIVE_BACKEND_PORT:
        raise ScratchRefused(f"port {LIVE_BACKEND_PORT} is the live backend; pick another backend port")
    if frontend_port == LIVE_FRONTEND_PORT:
        raise ScratchRefused(f"port {LIVE_FRONTEND_PORT} is the live frontend; pick another frontend port")
    if backend_port == frontend_port:
        raise ScratchRefused("the backend and the frontend need different ports")


def _npm() -> str:
    return "npm.cmd" if sys.platform == "win32" else "npm"


def _verify_after_import(db: Path) -> None:
    """After api.main is imported: both layers must point at the approved copy, and the loops must be gone."""
    import api.main as main_mod                                    # noqa: E402
    from api.metro import db as metro_db                           # noqa: E402
    for label, url in (("Falcon Scout engine", str(main_mod.engine.url)), ("Metro engine", _metro_url(metro_db))):
        got = _sqlite_path_from_url(url.replace("\\", "/")) or Path(url.split("///", 1)[-1])
        if not _same_file(Path(str(got)), db):
            raise ScratchRefused(f"{label} resolved to {got}, not the approved copy {db}; refusing to serve")


def _pin_database_url(url: str) -> None:
    """api/main.py calls load_dotenv(.env, override=True) at import, and .env names the LIVE database, so an environment variable
    alone is overwritten: a "scratch" backend started that way serves the live file (found on 26 Nov 2026, F5: this launcher's own
    first run did exactly that and its import ran the live startup prune on 108 old job postings). The fix: wrap dotenv's loader so
    DATABASE_URL is put back after every call, and PROVE it before api.main is imported: load the real .env through the wrapper
    and refuse unless DATABASE_URL still names the copy. Nothing of the app is imported by this check."""
    import dotenv
    import dotenv.main
    real = dotenv.load_dotenv

    def pinned(*a, **k):
        r = real(*a, **k)
        os.environ["DATABASE_URL"] = url
        return r

    dotenv.load_dotenv = pinned
    dotenv.main.load_dotenv = pinned
    pinned(ROOT / ".env", override=True)               # exactly what api/main.py does at import
    if os.environ.get("DATABASE_URL") != url:
        raise ScratchRefused("could not pin DATABASE_URL against .env; refusing to import the app")


def _go_offline(db: Path) -> None:
    """Stand-ins for everything that would leave this machine: a company's own domain answers with a small agency page, any other
    host does not answer (so name patterns find nothing), PageSpeed answers 42, the AI lookup finds nothing. Pacing is set to 0 in
    the COPY so a run takes seconds."""
    import re
    from api.metro import aiclient, pagespeed, webscan
    conn = sqlite3.connect(str(db))
    known = {r[0].lower() for r in conn.execute("select domain from metro_companies where domain is not null")}
    page = ("<html><head><title>{h}</title><meta name=\"description\" content=\"Google Ads, SEO and web design agency\"></head><body><h1>{h}</h1>"
            "<p>We run Google Ads (PPC) and SEO for clinics and law firms. White label partner programme. Our team of 12.</p>"
            "<a href=\"/services/ppc\">PPC</a> <a href=\"/services/seo\">SEO</a> <a href=\"/services/web\">Web</a></body></html>")

    def fetch(url, *a, **k):
        host = re.sub(r"^https?://(www\.)?", "", str(url)).split("/")[0].lower()
        return (200, url, page.format(h=host)) if host in known else (0, url, "")

    webscan.http_fetcher = lambda *a, **k: fetch
    pagespeed.http_json_getter = lambda *a, **k: (lambda url: (200, {"lighthouseResult": {"categories": {"performance": {"score": 0.42}}, "audits": {}, "finalUrl": url}}))
    aiclient.ask = lambda *a, **k: '{"domain": null, "reason": "offline scratch run"}'
    conn.execute("insert or replace into metro_settings(key, value_json) values ('pace_seconds', '{\"web\": 0, \"pagespeed\": 0}')")
    conn.commit()
    conn.close()
    print("offline: no site is visited, no model is asked, pacing 0")


def _metro_url(metro_db) -> str:
    return metro_db._database_url()


def run(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Scratch backend + frontend for browser checks (copy of the DB only).")
    ap.add_argument("--db", help="a COPY of the database (a file outside the repo, not the live one)")
    ap.add_argument("--copy-live", action="store_true", help="copy the live database to the temp folder and use that")
    ap.add_argument("--backend-port", type=int, default=DEFAULT_BACKEND_PORT)
    ap.add_argument("--frontend-port", type=int, default=DEFAULT_FRONTEND_PORT)
    ap.add_argument("--check-only", action="store_true", help="run the guard, start nothing")
    ap.add_argument("--no-frontend", action="store_true", help="backend only")
    ap.add_argument("--offline", action="store_true",
                    help="no real site is visited and no model is asked: website fetches, PageSpeed and the AI lookup are stand-ins, pacing is 0")
    args = ap.parse_args(argv)

    try:
        check_ports(args.backend_port, args.frontend_port)
        if args.copy_live and args.db:
            raise ScratchRefused("give --copy-live or --db, not both")
        db_arg = args.db
        if args.copy_live:
            if args.check_only:
                raise ScratchRefused("--check-only does not copy; give --db <file> to test a path")
            db_arg = str(make_live_copy())
        db = assert_scratch_db(db_arg)
    except ScratchRefused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
    print(f"scratch database: {db}")
    if args.check_only:
        print("guard passed (--check-only: nothing started)")
        return 0

    # Everything below runs only on an approved copy.
    url = f"sqlite:///{db.as_posix()}"
    os.environ["DATABASE_URL"] = url
    os.environ["FALCON_SCRATCH"] = "1"
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(ROOT / "api"))
    try:
        _pin_database_url(url)
        import api.main as main_mod                                # first import of the app: the guard has passed and DATABASE_URL is pinned
        _verify_after_import(db)
    except ScratchRefused as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
    main_mod.app.router.on_startup.clear()                         # no feed / prune / backup / ghost-sweep / bridge loops
    if args.offline:
        _go_offline(db)

    frontend = None
    if not args.no_frontend:
        fenv = dict(os.environ, FALCON_BACKEND_URL=f"http://localhost:{args.backend_port}")
        frontend = subprocess.Popen([_npm(), "run", "dev", "--", "--port", str(args.frontend_port)],
                                    cwd=str(ROOT / "frontend"), env=fenv)
        print(f"scratch frontend: http://localhost:{args.frontend_port}  ->  scratch backend :{args.backend_port}  (never :{LIVE_BACKEND_PORT})")
    try:
        import uvicorn
        if sys.platform == "win32":
            import asyncio
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        uvicorn.run(main_mod.app, host="127.0.0.1", port=args.backend_port)
    finally:
        if frontend is not None and frontend.poll() is None:
            frontend.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(run())
