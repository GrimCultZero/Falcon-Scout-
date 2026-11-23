# -*- coding: utf-8 -*-
"""_api_feed_loop's own health tracking and outbound-call timeouts (api/main.py).

Task: add an api_feed item to /health (last successful fetch, last error, consecutive
failures) and timeouts on the feed loop's own outbound calls, so a hung fetch can't
silently stall the loop (API_FEED_NOT_FETCHING.md's 2026-11-17 incident: "only the
'loop started' line and nothing after it for 30+ minutes" -- a single httpx-level
timeout inside api/upwork_api.py was not enough to bound a WHOLE pass across every
keyword). Explicitly does NOT touch api/upwork_api.py, the feed/filter logic, or
ports 27183/27184 -- this is a second, OUTER deadline around the feed loop's calls,
plus bookkeeping, both entirely in api/main.py.

The real _api_feed_loop is lifted out of api/main.py by AST (that file is never
imported by tests) and driven for a couple of iterations with real asyncio, a real
background thread (via run_in_executor) that genuinely blocks past the test's own
(tiny) timeout -- a real asyncio.TimeoutError, not a simulated one -- and a patched
asyncio.sleep so the loop's real 20s startup delay / 300s backoff / per-cycle wait
don't make this test slow. Restored afterward.

Run: .venv\\Scripts\\python tests\\test_api_feed_health.py
"""
import ast
import asyncio
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_api_feed_loop"}
WANT_VARS = {"_API_FEED_STATE", "_CATCHUP_GAP_HOURS", "_CATCHUP_MIN_INTERVAL_SEC",
             "_FEED_PASS_TIMEOUT_SEC", "_FEED_DEEP_PASS_TIMEOUT_SEC"}
nodes = []
for n in tree.body:
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in WANT_FUNCS:
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT_VARS for t in n.targets):
        nodes.append(n)
got = {getattr(n, "name", None) or n.targets[0].id for n in nodes}
if got != (WANT_FUNCS | WANT_VARS):
    print(f"FAIL  could not lift _api_feed_loop from api/main.py (found {sorted(got)})")
    sys.exit(1)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


class FakeUpworkApi:
    """Stands in for `import upwork_api` inside _api_feed_loop (_feed_api())."""
    def __init__(self, fetch_fn):
        self._fetch_fn = fetch_fn
        self.calls = 0

    def load_feed_config(self):
        return {"auto_fetch_minutes": 5}

    def is_connected(self):
        return True

    def fetch_and_filter(self, cfg):
        self.calls += 1
        return self._fetch_fn()

    def fetch_and_filter_deep(self, cfg, on_keyword=None):
        self.calls += 1
        return self._fetch_fn()


async def run_a_few_ticks(ns, fake_api, ticks=2, seed_state=None):
    """Starts the real loop as a task, lets it run `ticks` fast-sleep cycles, then
    cancels it cleanly (the loop itself catches CancelledError and breaks)."""
    # NOTE: exec() below re-runs the module-level _FEED_PASS_TIMEOUT_SEC = 300 (etc.)
    # assignments lifted alongside the function -- any override of those must be set
    # AFTER exec(), or exec() just clobbers it right back to the real 300/900. The
    # function itself still reads them correctly at CALL time (a plain global lookup),
    # since exec() only runs them once, right now, not every time _api_feed_loop runs.
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_feed_loop", "exec"), ns)
    ns["_feed_api"] = lambda: fake_api
    ns["_feed_gap_hours"] = lambda: 0.0  # no deep/catch-up pass in these tests
    ns["_upsert_api_jobs"] = lambda rows: (0, 0, 0)  # Task 9.2: (inserted, skipped, insert_errors)
    ns["_FEED_PASS_TIMEOUT_SEC"] = 0.05
    ns["_FEED_DEEP_PASS_TIMEOUT_SEC"] = 0.05
    if seed_state:
        ns["_API_FEED_STATE"].update(seed_state)
    loop_fn = ns["_api_feed_loop"]

    task = asyncio.ensure_future(loop_fn())
    for _ in range(ticks):
        await asyncio.sleep(0.03)  # patched -- see below
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def make_ns():
    # _API_FEED_STATE here is just the exec() namespace's starting point -- the lifted
    # module-level assignment (the real initial value) overwrites it when exec() runs;
    # run_a_few_ticks reads ns["_API_FEED_STATE"] back out afterward either way, so the
    # net effect is the same as starting fresh, just not visible until after exec().
    return {"asyncio": asyncio, "datetime": datetime, "timezone": timezone}


async def main():
    # The loop's own 20s startup delay / 300s backoff / per-cycle sleep would make every
    # test take minutes; clamp every real asyncio.sleep to at most 20ms for this process
    # only (restored at the end) -- it still really awaits and yields control, just fast.
    real_sleep = asyncio.sleep
    async def fast_sleep(seconds):
        await real_sleep(min(seconds, 0.02))
    asyncio.sleep = fast_sleep
    try:
        # ── a fetch that genuinely blocks past the (tiny) outer timeout ──────────
        ns = make_ns()
        def hangs():
            time.sleep(0.3)  # real, in a thread -- longer than _FEED_PASS_TIMEOUT_SEC (0.05s)
            return [], {}
        fake = FakeUpworkApi(hangs)
        # Enough real wall-clock time for the outer wait_for(timeout=0.05s) to actually
        # fire (on top of the loop's own clamped-to-20ms startup delay) before cancelling.
        await run_a_few_ticks(ns, fake, ticks=15)
        st = ns["_API_FEED_STATE"]
        check(st["consecutive_failures"] >= 1, f"a fetch that hangs past the outer timeout is counted as a failure (state: {st})")
        check(st["last_error"] is not None and "timed out" in st["last_error"], f"...with a clear 'timed out' message, not a bare exception repr: {st['last_error']!r}")
        check(st["last_success_at"] is None, "…and last_success_at stays None -- nothing actually succeeded")

        # ── a fetch that raises outright (not a hang) ────────────────────────────
        ns = make_ns()
        def raises():
            raise ConnectionError("ECONNRESET")
        fake = FakeUpworkApi(raises)
        await run_a_few_ticks(ns, fake, ticks=2)
        st = ns["_API_FEED_STATE"]
        check(st["consecutive_failures"] >= 1 and "ECONNRESET" in st["last_error"], f"a raised exception is also recorded, with its real message: {st}")

        # ── a healthy fetch clears any prior failure memory and records success ──
        ns = make_ns()
        def succeeds():
            return [], {"kept": 0}
        fake = FakeUpworkApi(succeeds)
        await run_a_few_ticks(ns, fake, ticks=2, seed_state={"consecutive_failures": 2})  # pretend it had been failing
        st = ns["_API_FEED_STATE"]
        check(st["consecutive_failures"] == 0, "a successful pass resets consecutive_failures to 0, even after prior failures")
        check(st["last_success_at"] is not None, "…and records when it succeeded")
        check(fake.calls >= 1, "the fetch was actually called at least once (sanity: the fake is wired in)")
    finally:
        asyncio.sleep = real_sleep


asyncio.run(main())
print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
