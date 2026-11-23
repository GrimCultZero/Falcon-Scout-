# -*- coding: utf-8 -*-
"""tools/upwork_ground_truth.py (Task 0.6, owner 2026-11-20/21): the one-off,
manual ground-truth check against Upwork. Never imported by the app, never
scheduled, and this test never calls the network -- it only exercises the
pure safety-critical helpers (the hard-stop classifier and the posted-date
parser) so a future edit to the error-matching regexes can't silently stop
catching an auth/rate-limit/captcha condition.

Run: .venv\\Scripts\\python tests\\test_upwork_ground_truth.py
"""
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

spec = importlib.util.spec_from_file_location("upwork_ground_truth", ROOT / "tools" / "upwork_ground_truth.py")
ugt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ugt)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


# ── the hard-stop classifier: every real-world error shape it must catch ───
check(ugt._hard_stop("GraphQL HTTP 401: invalid_token") == "AUTH ERROR", "HTTP 401 / invalid_token is an auth error")
check(ugt._hard_stop("GraphQL HTTP 403: Forbidden") == "AUTH ERROR", "HTTP 403 is an auth error")
check(ugt._hard_stop("invalid_grant: token expired") == "AUTH ERROR", '"invalid_grant" is an auth error')
check(ugt._hard_stop("GraphQL HTTP 429: Too Many Requests") == "RATE LIMITED (429)", "HTTP 429 is a rate-limit stop")
check(ugt._hard_stop("rate limit exceeded, try again later") == "RATE LIMITED (429)", '"rate limit" text alone is a rate-limit stop')
check(ugt._hard_stop("Please complete the CAPTCHA to continue") == "CHALLENGE/CAPTCHA", "a CAPTCHA page is a challenge stop")
check(ugt._hard_stop("Are you a human? Verify you're human to proceed.") == "CHALLENGE/CAPTCHA", "a human-verification page is a challenge stop")
check(ugt._hard_stop("GraphQL non-JSON response: HTTP 500 — <html>Server Error</html>") is None, "a plain 500/server error is NOT a hard stop (skip this term, keep going)")
check(ugt._hard_stop("connection timed out") is None, "a network timeout is NOT a hard stop")

# ── safety limits are exactly what the task specified, not silently loosened ──
check(ugt.MAX_PAGES_PER_TERM == 3, "at most 3 pages per term")
check(len(ugt.TERMS) == 11, "exactly the 11 named search terms from the task, no more")
check(ugt.REQUEST_PAUSE_SEC >= 2.0, "a real pause between requests (never request-after-request with no delay)")

# ── posted-date parsing (same shapes real Upwork rows use) ─────────────────
d = ugt._posted_dt({"posted_date": "2026-11-20T22:27:01+0000"})
check(d == datetime(2026, 11, 20, 22, 27, 1, tzinfo=timezone.utc), "a +0000-offset posted_date parses correctly")
d2 = ugt._posted_dt({"posted_date": "2026-11-20T22:27:01Z"})
check(d2 == datetime(2026, 11, 20, 22, 27, 1, tzinfo=timezone.utc), "a Z-suffixed posted_date parses the same way")
check(ugt._posted_dt({}) is None, "a missing posted_date returns None, not a crash")
check(ugt._posted_dt({"posted_date": "not-a-date"}) is None, "an unparseable posted_date returns None, not a crash")

# ── argument parsing (2026-11-24, Task 10.5): `--help` once ran the whole check and
# spent 24 live Upwork requests. Parsing must come first and must never touch the network.
import contextlib, io
_calls = []
_real_search = ugt.upwork_api.search_jobs
ugt.upwork_api.search_jobs = lambda *a, **k: (_calls.append(a), ([], 0))[1]
try:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            ugt.main(["--help"])
        check(False, "--help exits instead of running")
    except SystemExit as e:
        check(e.code == 0 and "--dry-run" in buf.getvalue(), "--help prints usage and exits 0")
    check(_calls == [], "--help sent ZERO requests")

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ugt.main(["--dry-run"])
    check(_calls == [], "--dry-run sent ZERO requests")
    check("DRY RUN" in buf.getvalue() and "Request cap this run: 21" in buf.getvalue(), "--dry-run prints the plan with the default cap of 21")

    try:
        with contextlib.redirect_stderr(io.StringIO()):
            ugt.main(["--bogus"])
        check(False, "an unknown flag is rejected")
    except SystemExit as e:
        check(e.code == 2 and _calls == [], "an unknown flag is rejected before any request")
finally:
    ugt.upwork_api.search_jobs = _real_search

check(ugt.request_cap(999) == ugt.ABSOLUTE_MAX_REQUESTS == 40, "--max-requests can never exceed the absolute ceiling of 40")
check(ugt.request_cap(5) == 5 and ugt.request_cap(0) == 1 and ugt.request_cap(-3) == 1, "--max-requests below 1 is clamped to 1")
check(ugt.DEFAULT_MAX_REQUESTS == 21, "the default cap is the 21 requests Task 11 allows")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
