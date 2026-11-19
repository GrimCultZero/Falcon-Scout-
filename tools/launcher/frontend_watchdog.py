"""
Serves the frontend as a production build (`vite preview`) instead of the dev
server, for daily use. Rebuilds first (`npm run build`) when frontend/src (or
vite.config.js / index.html / package.json) is newer than frontend/dist, or
dist is missing; otherwise serves the existing build as-is. Then, while
running, re-checks the same staleness condition every `--rebuild-check-interval`
seconds (default 60s) - an edit made AFTER this script started is picked up
without needing a restart. A failed rebuild never takes the site down: the
error is logged and the existing dist/ keeps being served unchanged.
falconscout-dev.bat still runs `npm run dev` directly - this script is only
for the daily, non-reloading launcher.

Reuses backend_watchdog.Watchdog for the health-check restart loop: if the
port is listening but the page stops answering for `--fail-threshold`
consecutive checks `--check-interval` seconds apart, ONLY the process this
script itself spawned is restarted - same log file shape, same
never-touch-another-process guarantee as the backend watchdog. A successful
rebuild restarts the preview server the same way (stop the old process this
script spawned, start a new one), so it serves the new build.

Usage: .venv\\Scripts\\python tools\\launcher\\frontend_watchdog.py [--skip-build]
"""
import argparse
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend_watchdog import Watchdog  # noqa: E402  (same restart-loop logic as the backend)

ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = ROOT / "frontend"
SRC_DIR = FRONTEND_DIR / "src"
DIST_DIR = FRONTEND_DIR / "dist"
# Root-level files outside src/ whose change also means the build is stale
# (e.g. a proxy route added to vite.config.js, or a new script tag in index.html).
WATCHED_ROOT_FILES = ["vite.config.js", "index.html", "package.json"]
LOG_PATH = ROOT / "logs" / "frontend_watchdog.log"
NPM = shutil.which("npm") or "npm"


def log(msg: str) -> None:
    LOG_PATH.parent.mkdir(exist_ok=True)
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def newest_mtime(path: Path):
    """The newest mtime of any file under `path`, or None if it has no files."""
    if not path.exists():
        return None
    newest = None
    for p in path.rglob("*"):
        if p.is_file():
            m = p.stat().st_mtime
            if newest is None or m > newest:
                newest = m
    return newest


def newest_source_mtime():
    """The newest mtime across frontend/src/ and WATCHED_ROOT_FILES, or None if none exist."""
    candidates = []
    src_mtime = newest_mtime(SRC_DIR)
    if src_mtime is not None:
        candidates.append(src_mtime)
    for name in WATCHED_ROOT_FILES:
        p = FRONTEND_DIR / name
        if p.exists():
            candidates.append(p.stat().st_mtime)
    return max(candidates) if candidates else None


def build_is_stale() -> bool:
    dist_mtime = newest_mtime(DIST_DIR)
    if dist_mtime is None:
        return True  # no build yet
    src_mtime = newest_source_mtime()
    if src_mtime is None:
        return False  # nothing to build from (shouldn't happen) - don't loop forever
    return src_mtime > dist_mtime


def build() -> bool:
    log("frontend watchdog: frontend/src (or vite.config.js / index.html / package.json) is newer than "
        "frontend/dist (or dist is missing) -- building")
    r = subprocess.run([NPM, "run", "build"], cwd=str(FRONTEND_DIR))
    if r.returncode != 0:
        log(f"frontend watchdog: build FAILED with exit code {r.returncode} -- serving the existing dist/ as-is")
        return False
    log("frontend watchdog: build finished")
    return True


def start_preview(port: int, reload: bool) -> subprocess.Popen:
    # `reload` is accepted (and unused) only so this matches the signature
    # Watchdog expects of `start` -- the frontend has no reload mode.
    return subprocess.Popen([NPM, "run", "preview"], cwd=str(FRONTEND_DIR))


def port_listening(port: int, host: str = "127.0.0.1", timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def page_ok(port: int, timeout: float = 5.0) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def rebuild_if_stale(wd: Watchdog) -> None:
    """Called periodically while the watchdog runs. A failed build is logged and
    changes nothing - the old dist/ keeps being served by the still-running
    preview process. A successful build restarts ONLY the preview process this
    script spawned, so the new build is actually served."""
    if not build_is_stale():
        return
    if build():
        log("frontend watchdog: rebuild succeeded -- restarting the preview server to serve it")
        Watchdog._stop(wd.proc)
        wd.start()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5180)
    parser.add_argument("--check-interval", type=float, default=10.0)
    parser.add_argument("--fail-threshold", type=int, default=3)
    parser.add_argument("--rebuild-check-interval", type=float, default=60.0,
                         help="how often to re-check whether a rebuild is needed while running")
    parser.add_argument("--skip-build", action="store_true", help="serve the existing dist/ as-is, even if stale")
    args = parser.parse_args()

    if not args.skip_build and build_is_stale():
        build()

    wd = Watchdog(
        port=args.port,
        reload=False,
        check_interval=args.check_interval,
        fail_threshold=args.fail_threshold,
        start=start_preview,
        is_port_listening=port_listening,
        is_health_ok=page_ok,
        logger=log,
    )
    wd.start()
    next_rebuild_check = time.monotonic() + args.rebuild_check_interval
    try:
        while True:
            time.sleep(wd.check_interval)
            wd.tick()
            if time.monotonic() >= next_rebuild_check:
                next_rebuild_check = time.monotonic() + args.rebuild_check_interval
                rebuild_if_stale(wd)
    except KeyboardInterrupt:
        log("frontend watchdog: KeyboardInterrupt, stopping the preview server")
        Watchdog._stop(wd.proc)


if __name__ == "__main__":
    main()
