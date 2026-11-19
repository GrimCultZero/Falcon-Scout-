"""
Serves the frontend as a production build (`vite preview`) instead of the dev
server, for daily use. Rebuilds first (`npm run build`) when frontend/src is
newer than frontend/dist, or dist is missing; otherwise serves the existing
build as-is. falconscout-dev.bat still runs `npm run dev` directly - this is
only for the daily, non-reloading launcher.

Reuses backend_watchdog.Watchdog for the restart loop: if the port is
listening but the page stops answering for `--fail-threshold` consecutive
checks `--check-interval` seconds apart, ONLY the process this script itself
spawned is restarted - same log file shape, same never-touch-another-process
guarantee as the backend watchdog.

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


def build_is_stale() -> bool:
    dist_mtime = newest_mtime(DIST_DIR)
    if dist_mtime is None:
        return True  # no build yet
    src_mtime = newest_mtime(SRC_DIR)
    if src_mtime is None:
        return False  # nothing to build from (shouldn't happen) - don't loop forever
    return src_mtime > dist_mtime


def build() -> bool:
    log("frontend watchdog: frontend/src is newer than frontend/dist (or dist is missing) -- building")
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5180)
    parser.add_argument("--check-interval", type=float, default=10.0)
    parser.add_argument("--fail-threshold", type=int, default=3)
    parser.add_argument("--skip-build", action="store_true", help="serve the existing dist/ as-is, even if stale")
    args = parser.parse_args()

    if not args.skip_build and build_is_stale():
        build()

    Watchdog(
        port=args.port,
        reload=False,
        check_interval=args.check_interval,
        fail_threshold=args.fail_threshold,
        start=start_preview,
        is_port_listening=port_listening,
        is_health_ok=page_ok,
        logger=log,
    ).run_forever()


if __name__ == "__main__":
    main()
