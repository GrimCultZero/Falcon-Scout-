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
import traceback
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


# The source mtime (newest_source_mtime()) at the time of the LAST failed build, or None
# if the last attempt (if any) succeeded. A broken build (a syntax error, say) would
# otherwise be retried every --rebuild-check-interval forever on the exact same unchanged
# source, for no reason -- the first attempt already said everything the tenth would.
_last_failed_mtime = None


def start_preview(port: int, reload: bool) -> subprocess.Popen:
    # `reload` is accepted (and unused) only so this matches the signature
    # Watchdog expects of `start` -- the frontend has no reload mode.
    return subprocess.Popen([NPM, "run", "preview"], cwd=str(FRONTEND_DIR))


# Task 5.1 finding (owner, 2026-11-23): the ROOT CAUSE this task was looking
# for. `vite preview` on this machine binds the IPv6 loopback ONLY
# ("[::1]:5180 LISTENING" in netstat, nothing on 127.0.0.1 at all) -- but both
# checks below were hardcoded to IPv4 127.0.0.1. Confirmed live: a fresh
# socket connect to 127.0.0.1:5180 sat in SYN_SENT (never completing) while
# curl to "localhost:5180" (which resolves ::1 first on this machine) got a
# clean 200. That means the watchdog's OWN health check believed a perfectly
# healthy preview server was DOWN, restarted it on a fail-threshold timer
# forever, and the new process could then collide with the old one still
# tearing down -- a crash loop with a real, external symptom (port already in
# use) but an INTERNAL, self-inflicted cause. Fixed by trying 127.0.0.1 first,
# then ::1 -- whichever interface vite actually bound, this now sees it.
_LOOPBACK_HOSTS = ("127.0.0.1", "::1")


def port_listening(port: int, host: "str | None" = None, timeout: float = 2.0) -> bool:
    hosts = (host,) if host else _LOOPBACK_HOSTS
    for h in hosts:
        try:
            with socket.create_connection((h, port), timeout=timeout):
                return True
        except OSError:
            continue
    return False


def page_ok(port: int, timeout: float = 5.0) -> bool:
    for h in _LOOPBACK_HOSTS:
        url = f"http://[{h}]:{port}/" if ":" in h else f"http://{h}:{port}/"
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                if r.status == 200:
                    return True
        except Exception:
            continue
    return False


def rebuild_if_stale(wd: Watchdog) -> None:
    """Called periodically while the watchdog runs. A failed build is logged and
    changes nothing - the old dist/ keeps being served by the still-running
    preview process - and is NOT retried again until something newer than the
    source that failed shows up (see _last_failed_mtime). A successful build
    restarts ONLY the preview process this script spawned, so the new build is
    actually served."""
    global _last_failed_mtime
    if not build_is_stale():
        _last_failed_mtime = None  # caught up (however that happened) - clear any memory of a past failure
        return

    current_mtime = newest_source_mtime()
    if _last_failed_mtime is not None and current_mtime is not None and current_mtime <= _last_failed_mtime:
        return  # already tried and failed on exactly this source state; stay quiet until something newer appears

    if build():
        _last_failed_mtime = None
        log("frontend watchdog: rebuild succeeded -- restarting the preview server to serve it")
        Watchdog._stop(wd.proc)
        wd.start()
    else:
        _last_failed_mtime = current_mtime


def another_instance_is_serving(port: int) -> bool:
    """True when something is already listening on `port` AND actually
    serving the page -- i.e. a healthy instance (this script's or another
    one's) already owns it. Task 5.3: the concrete, observed cause of a
    frontend_watchdog.py crash loop -- a second instance's own preview
    process can never bind an already-used port, so its Watchdog "restarts"
    it forever."""
    return port_listening(port) and page_ok(port)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5180)
    parser.add_argument("--check-interval", type=float, default=10.0)
    parser.add_argument("--fail-threshold", type=int, default=3)
    parser.add_argument("--rebuild-check-interval", type=float, default=60.0,
                         help="how often to re-check whether a rebuild is needed while running")
    parser.add_argument("--heartbeat-interval", type=float, default=300.0,
                         help="how often to log an 'alive' line while running (Task 5.3)")
    parser.add_argument("--skip-build", action="store_true", help="serve the existing dist/ as-is, even if stale")
    args = parser.parse_args()

    # Task 5.3 (owner, 2026-11-23): a concrete, OBSERVED cause of the
    # "silent death" this task investigates -- two frontend_watchdog.py
    # instances alive at once (e.g. a leftover one from an earlier session,
    # or a second falconscout.bat launch) fight over :5180: the second
    # instance's own preview process can never bind the port, so the
    # Watchdog's own tick() loop "restarts" it every check_interval forever,
    # in a crash loop that can eventually take BOTH instances down. If
    # something is already listening on this port AND actually serving the
    # page, assume it's a healthy instance (ours or another one) and exit
    # cleanly rather than starting a competing preview process.
    if another_instance_is_serving(args.port):
        log(f"frontend watchdog: port {args.port} is already listening and serving — "
            f"another instance is alive. Exiting without starting a second one.")
        return

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
    next_heartbeat = time.monotonic() + args.heartbeat_interval
    try:
        while True:
            time.sleep(wd.check_interval)
            wd.tick()
            if time.monotonic() >= next_rebuild_check:
                next_rebuild_check = time.monotonic() + args.rebuild_check_interval
                rebuild_if_stale(wd)
            # Task 5.3: a heartbeat every 5 min (default) so the log can show
            # exactly when the silence started, instead of nothing at all
            # between a restart line and whatever killed the process.
            if time.monotonic() >= next_heartbeat:
                next_heartbeat = time.monotonic() + args.heartbeat_interval
                listening = port_listening(args.port)
                log(f"frontend watchdog: alive, vite pid {wd.proc.pid}, :{args.port} listening {'yes' if listening else 'no'}")
    except KeyboardInterrupt:
        log("frontend watchdog: KeyboardInterrupt, stopping the preview server")
        Watchdog._stop(wd.proc)
    except Exception:
        # Task 5.3: the main loop had NO handler for anything but
        # KeyboardInterrupt before this -- any other exception (a bug in
        # rebuild_if_stale/build(), a transient OSError from port_listening,
        # etc.) propagated uncaught and silently ended the process with
        # nothing written to the log at all. Log the full traceback with a
        # timestamp, stop the child cleanly, then re-raise so the process
        # still exits with a non-zero code -- run_frontend_watchdog_forever.bat
        # (Task 5.3) is the outer loop that notices the exit and starts a
        # fresh instance a few seconds later.
        log(f"frontend watchdog: FATAL — unhandled exception in the main loop, exiting:\n{traceback.format_exc()}")
        try:
            Watchdog._stop(wd.proc)
        except Exception:
            pass
        raise


if __name__ == "__main__":
    main()
