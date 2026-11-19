# -*- coding: utf-8 -*-
"""Launcher watchdog for the production frontend (tools/launcher/frontend_watchdog.py).

Covers the one thing unique to this script -- the stale-build check -- against a real
scratch directory tree (real mtimes, no faking). The restart-loop logic itself is
backend_watchdog.Watchdog, already covered by test_backend_watchdog.py.

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

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


tmp = Path(tempfile.mkdtemp(prefix="fs_frontend_watchdog_"))
try:
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

finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
