# -*- coding: utf-8 -*-
"""Launcher watchdog (tools/launcher/backend_watchdog.py) restart logic.

Fake start/port_listening/health_ok/sleep so no real process or socket is ever
touched -- this only exercises the decision logic (when to restart, when not to,
and that it only ever signals the PID it itself started).

Run: .venv\\Scripts\\python tests\\test_backend_watchdog.py
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "launcher"))
from backend_watchdog import Watchdog  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


class FakeProc:
    _next_pid = 1000

    def __init__(self):
        self.pid = FakeProc._next_pid
        FakeProc._next_pid += 1
        self.terminated = False
        self.killed = False
        self.returncode = None

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9


def make_watchdog(port_sequence, health_sequence, started_procs):
    def fake_start(port, reload):
        p = FakeProc()
        started_procs.append(p)
        return p

    port_iter = iter(port_sequence)
    health_iter = iter(health_sequence)

    return Watchdog(
        port=8000, reload=False, check_interval=0, fail_threshold=3,
        start=fake_start,
        is_port_listening=lambda port: next(port_iter, True),
        is_health_ok=lambda port: next(health_iter, True),
        sleep=lambda s: None,
        logger=lambda msg: None,
    )


# ── healthy ticks never restart ─────────────────────────────────────────────
started = []
wd = make_watchdog(port_sequence=[True] * 10, health_sequence=[True] * 10, started_procs=started)
wd.start()
for _ in range(5):
    wd.tick()
check(len(started) == 1, "healthy /health checks never spawn a second backend")
check(wd.consecutive_fails == 0, "consecutive_fails stays at 0 while healthy")

# ── port not listening yet (starting up) is never counted as a failure ──────
started = []
wd = make_watchdog(port_sequence=[False, False, False], health_sequence=[], started_procs=started)
wd.start()
for _ in range(3):
    wd.tick()
check(len(started) == 1, "port not listening yet is treated as 'still starting', not a failure")
check(wd.consecutive_fails == 0, "consecutive_fails is not incremented while the port is not listening")

# ── 3 consecutive failed /health checks while the port IS listening -> restart
started = []
wd = make_watchdog(port_sequence=[True] * 10, health_sequence=[False, False, False], started_procs=started)
first = wd.start()
restarted = [wd.tick() for _ in range(3)]
check(restarted == [False, False, True], "restart fires exactly on the 3rd consecutive failed check, not before")
check(len(started) == 2, "exactly one new backend was spawned")
check(first.terminated, "the OLD backend's own PID was terminated")
check(not first.killed, "terminate() was tried before kill() (graceful first)")

# ── a single failed check, then a healthy one, never restarts ───────────────
started = []
wd = make_watchdog(port_sequence=[True] * 10, health_sequence=[False, True, False, False], started_procs=started)
wd.start()
results = [wd.tick() for _ in range(4)]
check(results == [False, False, False, False], "a healthy check in between resets the counter -- no restart")
check(wd.consecutive_fails == 2, "counter reflects the 2 failures since the last healthy check (reset once in between)")
check(len(started) == 1, "no restart happened across an isolated failure")

# ── the backend process exiting on its own is restarted immediately ────────
started = []
wd = make_watchdog(port_sequence=[], health_sequence=[], started_procs=started)
first = wd.start()
first.returncode = 1  # simulate the child process having exited
check(wd.tick() is True, "a dead child process is restarted on the very next tick")
check(len(started) == 2, "exactly one replacement backend was spawned")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
