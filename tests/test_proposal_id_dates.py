# -*- coding: utf-8 -*-
"""A proposal found in the inbox is dated from its Upwork id, not from today.

Owner, 2026-10-13: the dashboard showed Week 42 with 7 submitted, 5 viewed and
4 replies; Upwork showed 3 submitted and none viewed. Four of the seven were
rooms the messages sync found on 2026-10-12 and auto-captured with no submit
time, so the dashboard filed them under the capture time - one proposal from
May, three from December, January and September, all counted as this week's
submissions, views and replies.

Upwork proposal ids are Twitter-style snowflakes, (id >> 22) ms after
2010-11-04T01:42:54.657Z. The pairs below are real (id, recorded submit time)
rows from the database.

Run: .venv\\Scripts\\python tests\\test_proposal_id_dates.py
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


import importlib.util
spec = importlib.util.spec_from_file_location("falcon_api", ROOT / "api" / "main.py")
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except Exception as e:                                   # pragma: no cover
    print(f"FAIL  could not import api/main.py: {e}")
    sys.exit(1)

_upwork_id_time = mod._upwork_id_time
UTC = timezone.utc

# Real pairs: (upwork_proposal_id, submitted_at as recorded at submit, UTC).
KNOWN = [
    ("2092980736614457345", datetime(2026, 8, 27, 14, 21, 4, tzinfo=UTC)),
    ("2109673536021803009", datetime(2026, 10, 12, 15, 52, 18, tzinfo=UTC)),
    ("2109981031246929921", datetime(2026, 10, 13, 12, 14, 12, tzinfo=UTC)),
]
for pid, submitted in KNOWN:
    t = _upwork_id_time(pid)
    gap = abs((t - submitted).total_seconds()) if t else None
    assert_(t is not None and gap < 60, f"id {pid} dates to {t} - within a minute of the recorded submit ({gap}s)")

# The four rooms that inflated Week 42 - each dates to its own, older week.
for pid, before in [("2053914797344526337", datetime(2026, 6, 1, tzinfo=UTC)),
                    ("2007934206755913630", datetime(2026, 2, 1, tzinfo=UTC)),
                    ("2003736626759994457", datetime(2026, 1, 1, tzinfo=UTC)),
                    ("2098290312171580430", datetime(2026, 9, 20, tzinfo=UTC))]:
    t = _upwork_id_time(pid)
    assert_(t is not None and t < before and t < datetime(2026, 10, 12, tzinfo=UTC),
            f"old room {pid} dates to {t:%Y-%m-%d}, not to the week it was found")

# Not an id: nothing rather than a wrong date.
for bad_id in (None, "", "abc", "12345", "~0221077537482866153"):
    assert_(_upwork_id_time(bad_id) is None, f"{bad_id!r} -> None")

# The capture path sets it (a static check: _auto_capture_from_room needs a session).
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
body = src[src.index("def _auto_capture_from_room"):src.index("def _resolve_room_evidence")]
assert_("submitted_at=_upwork_id_time(upw_id)" in body, "auto-capture stamps submitted_at from the id")
assert_(src.index("def _upwork_id_time") < src.index("def _auto_capture_from_room"),
        "helper defined before its user (a reload mid-save must not 500)")

print(f"\n{'ALL PASS' if not bad else f'{bad} FAILED'}")
sys.exit(1 if bad else 0)
