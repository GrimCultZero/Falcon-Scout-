# -*- coding: utf-8 -*-
"""Dashboard period cards: a later stage must not deduct from an earlier one.

Owner, 2026-10-11: proposal 318 flipped viewed -> replied when the Sinking Birdies
reply was finally picked up, and week 41's VIEWED dropped 13 -> 12 while REPLIES
went 0 -> 1. "let's not do that - leave views as they are and just add a reply."

A proposal that was replied to WAS viewed; the client read it before answering.
So each stage counts everything that REACHED it. 'positive' already worked that
way (_POS counts interviewing and hired, not just replied) — 'viewed' did not.

This pins the counting rule against the real source in api/main.py rather than a
copy, so the test fails if someone reverts the expression.

Run: .venv\\Scripts\\python tests\\test_dashboard_stages.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "api" / "main.py").read_text(encoding="utf-8")

bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


# ── the rule, as the source defines it ───────────────────────────────────────
assert_(
    re.search(r"_POS\s*=\s*\{\"replied\", \"interviewing\", \"hired\"\}", SRC) is not None,
    "_POS is still replied/interviewing/hired",
)
assert_(
    re.search(r"_REACHED_VIEWED\s*=\s*_POS\s*\|\s*\{\"viewed\"\}", SRC) is not None,
    "_REACHED_VIEWED is _POS plus 'viewed' — every stage at or beyond a view",
)
assert_(
    re.search(r"if p\.status in _REACHED_VIEWED:\s*\n\s*viewed_c \+= 1", SRC) is not None,
    "the period cards count views by REACHED, not by current status",
)
assert_(
    re.search(r"if p\.status == \"viewed\":\s*\n\s*viewed_c \+= 1", SRC) is None,
    "…and the old current-status-only count is gone",
)
assert_(
    re.search(r"if p\.status in _POS:\s*\n\s*pos \+= 1", SRC) is not None,
    "replies still count replied/interviewing/hired",
)

# The stacked trend chart is DELIBERATELY exclusive — its segments must sum to
# the total, so there a reply genuinely does move out of 'viewed'. Guard that it
# was not "fixed" along with the cards.
trend = SRC[SRC.index("weekly = defaultdict("):SRC.index("trend = [{\"week\"")]
assert_(
    'if p.status == "viewed":' in trend and "_REACHED_VIEWED" not in trend,
    "the weekly trend chart keeps its exclusive 'viewed' (stacked segments must not double-count)",
)

# ── the behaviour, on the real shape of the data ─────────────────────────────
POS = {"replied", "interviewing", "hired"}
REACHED = POS | {"viewed"}


def counts(statuses):
    return (
        len(statuses),
        sum(1 for s in statuses if s in REACHED),
        sum(1 for s in statuses if s in POS),
    )

# Week 41 as it actually stood: 33 submitted, 12 still 'viewed', 1 'replied'.
week41 = ["viewed"] * 12 + ["replied"] + ["sent"] * 20
sub, viewed, pos = counts(week41)
assert_(sub == 33, "week 41: 33 submitted")
assert_(viewed == 13, "week 41: 13 viewed — the replied one still counts as viewed")
assert_(pos == 1, "week 41: 1 reply")
assert_(round(100 * pos / sub) == 3, "week 41: reply rate still 3% (replies/submitted, untouched)")

# Promotion must never reduce an earlier stage.
before = counts(["viewed", "viewed", "sent"])
after = counts(["viewed", "replied", "sent"])
assert_(after[1] == before[1], "viewed -> replied leaves the view count unchanged")
assert_(after[2] == before[2] + 1, "…and adds exactly one reply")

deeper = counts(["viewed", "hired", "sent"])
assert_(deeper[1] == before[1], "a jump to hired still counts as viewed")
assert_(deeper[2] == 1, "…and as a reply")

# Statuses that carry no view evidence must not inflate the count.
assert_(counts(["ghosted", "sent", "expired"])[1] == 0, "ghosted/sent/expired are not views")
assert_(counts(["invited"])[1] == 0, "'invited' stays its own metric, not folded into views")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
