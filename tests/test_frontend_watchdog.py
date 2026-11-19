# -*- coding: utf-8 -*-
"""Launcher watchdog for the production frontend (tools/launcher/frontend_watchdog.py).

Covers the two things unique to this script:
  * the stale-build check (frontend/src AND vite.config.js/index.html/package.json
    vs. dist/), against a real scratch directory tree (real mtimes, no faking);
  * rebuild_if_stale()'s orchestration (rebuild, then restart on success, log and
    leave the running server alone on failure), with build()/build_is_stale() faked
    so no real npm process ever runs.
The health-check restart loop itself is backend_watchdog.Watchdog, already covered
by test_backend_watchdog.py; rebuild_if_stale reuses its real Watchdog.start/_stop.

Run: .venv\\Scripts\\python tests\\test_frontend_watchdog.py
"""
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "launcher"))
import frontend_watchdog as fw  # noqa: E402
from backend_watchdog import Watchdog  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


# ── build_is_stale() against a real scratch tree ────────────────────────────
tmp = Path(tempfile.mkdtemp(prefix="fs_frontend_watchdog_"))
try:
    fw.FRONTEND_DIR = tmp
    src = tmp / "src"
    dist = tmp / "dist"
    src.mkdir()

    fw.SRC_DIR, fw.DIST_DIR = src, dist
    (src / "App.jsx").write_text("x", encoding="utf-8")
    check(fw.build_is_stale() is True, "no dist/ at all -> stale (needs a first build)")

    dist.mkdir()
    (dist / "index.html").write_text("x", encoding="utf-8")
    time.sleep(0.05)
    check(fw.build_is_stale() is False, "dist/ built AFTER the current src/ -> not stale")

    time.sleep(0.05)
    (src / "App.jsx").write_text("y", encoding="utf-8")
    check(fw.build_is_stale() is True, "src/ touched again AFTER the build -> stale")

    # a build that touches dist/ again catches it back up
    time.sleep(0.05)
    (dist / "index.html").write_text("y", encoding="utf-8")
    check(fw.build_is_stale() is False, "rebuilding (dist/ touched again) clears the staleness")

    # an empty src/ (shouldn't happen, but must not build forever)
    shutil.rmtree(src)
    src.mkdir()
    check(fw.build_is_stale() is False, "src/ exists but has no files -> nothing to build from, not stale")
    (src / "App.jsx").write_text("z", encoding="utf-8")  # restore for the sections below

    # vite.config.js / index.html / package.json: each on its own makes it stale, even
    # with src/ unchanged (dist/ is already caught up with src/ from above)
    for name in fw.WATCHED_ROOT_FILES:
        time.sleep(0.05)
        (tmp / name).write_text("x", encoding="utf-8")
        check(fw.build_is_stale() is True, f"{name} touched AFTER the build -> stale even though src/ didn't change")
        time.sleep(0.05)
        (dist / "index.html").write_text(name, encoding="utf-8")  # rebuild catches it up again
        check(fw.build_is_stale() is False, f"…and a rebuild after touching {name} clears it")

finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ── rebuild_if_stale(): orchestration, with build()/build_is_stale() faked ──
class FakeProc:
    _next_pid = 2000

    def __init__(self):
        self.pid = FakeProc._next_pid
        FakeProc._next_pid += 1
        self.terminated = False
        self.returncode = None

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.returncode = -9


def make_wd(started):
    def fake_start(port, reload):
        p = FakeProc()
        started.append(p)
        return p
    return Watchdog(port=5180, reload=False, check_interval=0, fail_threshold=3,
                     start=fake_start, is_port_listening=lambda p: True,
                     is_health_ok=lambda p: True, sleep=lambda s: None, logger=lambda m: None)


fw.log = lambda m: None  # rebuild_if_stale logs via the module-level log(), not wd's own logger

started = []
wd = make_wd(started)
first = wd.start()
fw.build_is_stale = lambda: False
fw.build = lambda: (_ for _ in ()).throw(AssertionError("build() must not run when nothing is stale"))
fw.rebuild_if_stale(wd)
check(len(started) == 1 and not first.terminated, "not stale -> build() is never called, nothing restarts")

started = []
wd = make_wd(started)
first = wd.start()
fw.build_is_stale = lambda: True
fw.build = lambda: True  # rebuild succeeds
fw.rebuild_if_stale(wd)
check(len(started) == 2, "stale + successful rebuild -> the preview server is restarted")
check(first.terminated, "…the OLD preview process (this script's own child) was stopped")
check(wd.proc is not first and wd.proc.pid != first.pid, "…and the new process is a different one")

started = []
wd = make_wd(started)
first = wd.start()
fw.build_is_stale = lambda: True
fw.build = lambda: False  # rebuild fails
fw.rebuild_if_stale(wd)
check(len(started) == 1, "stale + FAILED rebuild -> no restart is attempted")
check(not first.terminated, "…the still-running preview process (serving the old dist/) is left alone")
check(wd.proc is first, "…wd still points at the same (old) process")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
