# -*- coding: utf-8 -*-
"""Inbox sync: when a found reply is dated (2026-09-30).

A reply the inbox sync only discovers late used to be stamped with the sync
time, and Outcomes sorts by that stamp ("reply seen"). On 2026-09-30 a July
Galactic Fed reply, found when a mis-scrolled sync read old conversations,
topped the list as if it were new. `_reply_seen_at` dates it by the
conversation's last activity instead (sent by the extension, v5.2+).

The helpers are lifted out of api/main.py via `ast`, like
tests/test_room_evidence.py, so this can't drift and main.py is never imported.

Run:  python tests/test_reply_dates.py
"""
import ast
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
WANT = {"_reply_seen_at", "_as_utc"}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in WANT]
if {n.name for n in nodes} != WANT:
    print("FAIL  could not lift _reply_seen_at / _as_utc from api/main.py")
    sys.exit(1)
ns = {"datetime": datetime, "timezone": timezone}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_helpers", "exec"), ns)
_reply_seen_at, _as_utc = ns["_reply_seen_at"], ns["_as_utc"]

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

now = datetime(2026, 9, 30, 7, 8, 20, tzinfo=timezone.utc)
july = "2026-07-15T09:00:00.000Z"
check(_reply_seen_at({"last_activity_at": july}, now) == datetime(2026, 7, 15, 9, 0, tzinfo=timezone.utc),
      "a July conversation found today is dated July, not today")
check(_reply_seen_at({}, now) == now, "no last_activity_at (older extension): the sync time, as before")
check(_reply_seen_at({"last_activity_at": "2026-10-02T00:00:00Z"}, now) == now, "a future date is never used")
check(_reply_seen_at({"last_activity_at": "not a date"}, now) == now, "an unparsable one neither")
check(_reply_seen_at({"last_activity_at": "2026-09-29T16:57:00"}, now) == datetime(2026, 9, 29, 16, 57, tzinfo=timezone.utc),
      "a naive ISO string is read as UTC")
check(_as_utc(datetime(2026, 9, 30, 7, 8)) == datetime(2026, 9, 30, 7, 8, tzinfo=timezone.utc), "_as_utc: naive DB values become UTC")
check(_as_utc(None) is None, "_as_utc(None) is None")

# the re-date rule in messages_status_sync, restated: move back only when the
# stored stamp is more than a day AFTER the conversation's last activity
def redate(cur, seen):
    return seen < now and cur is not None and seen < cur - timedelta(days=1)
check(redate(now, _reply_seen_at({"last_activity_at": july}, now)), "proposal 80 (stamped today, conversation from July) is re-dated")
check(not redate(datetime(2026, 9, 29, 17, 0, tzinfo=timezone.utc), _reply_seen_at({"last_activity_at": "2026-09-29T16:57:00Z"}, now)),
      "a reply recorded the same day is left alone")
check("elif proposal.status == \"replied\" and match_via in _EXACT_MATCH_PATHS:" in src and "_seen < _cur - timedelta(days=1)" in src,
      "messages_status_sync applies that rule, exact matches only")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
