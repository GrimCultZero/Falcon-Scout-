# -*- coding: utf-8 -*-
"""The job feed never lists a 'room' job.

Owner, 2026-10-15, "why I see this in the feed": the messages sync files each
old conversation it finds under a Job with source='room' and captured_at = the
day it was found, so threads from March-August showed as fresh 1d jobs marked
REPLIED. Eight had been hidden by hand; seven more were still in the feed.

Run: .venv\\Scripts\\python tests\\test_feed_excludes_rooms.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
feed = src[src.index("def list_jobs("):]
feed = feed[:feed.index("\n@app.")]
room_filter = 'stmt = stmt.where(or_(Job.source.is_(None), Job.source != "room"))'
assert_(room_filter in feed, "list_jobs drops source='room' jobs")
assert_(feed.index(room_filter) < feed.index('if filter_type == "hidden"'),
        "...before the hidden split, so the Hidden tab does not list them either")
assert_('if source != "room":' in feed, "...unless rooms are asked for explicitly")
assert_("Job.source.is_(None)" in feed.split(room_filter)[0] + room_filter,
        "legacy rows with no source stay in the feed")

latest = src[src.index('@app.get("/jobs/latest-captured")'):]
latest = latest[:latest.index("\n@app.")]
assert_('Job.source != "room"' in latest, "'Feed is live' does not count a found conversation as a new job")

# The capture really does tag its jobs 'room' - otherwise the filter catches nothing.
cap = src[src.index("def _auto_capture_from_room"):src.index("def _resolve_room_evidence")]
assert_('source="room"' in cap, "auto-captured jobs are created with source='room'")

print(f"\n{'ALL PASS' if not bad else f'{bad} FAILED'}")
sys.exit(1 if bad else 0)
