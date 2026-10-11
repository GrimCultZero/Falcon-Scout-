# -*- coding: utf-8 -*-
"""Auto-capture: a room carrying an Upwork proposal id we have never seen.

Owner, 2026-10-11: the dashboard said "0 invited" while an invite from Idan
Tohami sat in his inbox. Three compounding causes, all real:

  1. an invite never reaches the job feed — the client invites directly, so no
     Job row is created here and no Proposal with it;
  2. the proposals-list scrape reads only "Submitted proposals", while an invite
     under discussion sits in "Active proposals";
  3. 'invited' was a STATUS, ranked below 'replied', and promotion never
     downgrades — so the moment an invited client answered, the invite was
     erased. It read 0 across all 324 proposals.

(3) is fixed by the is_invited column. This covers (1) and (2): the room walk
already produced room_proposal_ids ['2107843103927426592'] and the title "AEO
Expert for Backlink Building" for Idan's room, so the sync can create the row
from evidence it already had.

Run: .venv\\Scripts\\python tests\\test_auto_capture_invites.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


# Import the helpers without starting the app.
import importlib.util
spec = importlib.util.spec_from_file_location("falcon_api", ROOT / "api" / "main.py")
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except Exception as e:                                   # pragma: no cover
    print(f"FAIL  could not import api/main.py: {e}")
    sys.exit(1)

_room_job_title = mod._room_job_title
_looks_like_invite = mod._looks_like_invite

# ── the real room header, verbatim from messages_sync_debug.json ─────────────
idan_row = {
    "job_title": "AEO Expert for Backlink Building",
    "room_proposal_ids": ["2107843103927426592"],
    "room_titles": ["Notifications", "Opportunities", "More options",
                    "AEO Expert for Backlink Building"],
    "recent_messages": [
        {"from": "client", "text": "Hello!\nWe are a creative agency just starting out with SEO/AEO and need "
                                   "some assistance.\nI'd like to invite you to review the job I've posted. "
                                   "Please submit a proposal if you're available and interested.\nIdan T."},
        {"from": "artem", "text": "Thanks for the invite. I have 12 years in technical SEO..."},
        {"from": "client", "text": "Thanks, we will get back to you"},
    ],
    "last_from_client": True,
}

assert_(_room_job_title(idan_row) == "AEO Expert for Backlink Building",
        "the real job title is picked out of the room header")
assert_(_looks_like_invite(idan_row), "Idan's opening message reads as an invite")

# ── title extraction ─────────────────────────────────────────────────────────
assert_(_room_job_title({"room_titles": ["Notifications", "Opportunities", "More options"]}) == "",
        "a header with nothing but nav chrome yields no title")
assert_(_room_job_title({"room_titles": ["More call options", "Wednesday, Sep 23", "Artem Yatsuk"]}) == "",
        "dates and Artem's own name are not job titles")
assert_(_room_job_title({"room_titles": [], "job_title": "Sinking Birdies"}, "Sinking Birdies") == "Sinking Birdies",
        "falls back to the row's job_title when the room header gave nothing")
assert_(_room_job_title({"room_titles": []}, "SB") == "",
        "…but not to something too short to identify anything")

# ── invite detection ─────────────────────────────────────────────────────────
artem_first = {"recent_messages": [
    {"from": "artem", "text": "Thanks for the invite. I have 12 years in technical SEO."},
    {"from": "client", "text": "Thanks, we will get back to you"},
]}
assert_(not _looks_like_invite(artem_first),
        "Artem's own letter mentioning 'the invite' is NOT an invite — he spoke first")

later_invite = {"recent_messages": [
    {"from": "artem", "text": "Here is my proposal for the Shopping campaign fix."},
    {"from": "client", "text": "Thanks for applying, I'd like to invite you to interview."},
]}
assert_(not _looks_like_invite(later_invite),
        "an interview invite later in a thread is not an invite to apply")

ordinary = {"recent_messages": [
    {"from": "client", "text": "Hi Artem, thanks again — I'd like to move forward with you on this."},
]}
assert_(not _looks_like_invite(ordinary), "an ordinary client opener is not an invite")

for phrase in ("You have been invited to apply to this job.",
               "I sent you an invitation to my job post.",
               "We'd like to invite you to submit a proposal."):
    assert_(_looks_like_invite({"recent_messages": [{"from": "client", "text": phrase}]}),
            f"recognised: {phrase[:46]}…")

assert_(not _looks_like_invite({"recent_messages": []}), "no messages: not an invite")
assert_(not _looks_like_invite({}), "no thread at all: not an invite")

# ── the creation gate, as the source defines it ──────────────────────────────
SRC = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
assert_(re.search(r"ids = \[.*row\.get\(\"room_proposal_ids\"\)", SRC) is not None
        and "if len(ids) != 1:" in SRC,
        "creation requires exactly ONE Upwork proposal id — never a fuzzy match")
assert_('filter_by(upwork_proposal_id=upw_id).first() is not None' in SRC,
        "…and never duplicates a proposal we already hold under that id")
assert_("auto_captured=True" in SRC and "is_invited=invited" in SRC,
        "created rows are flagged auto_captured and carry the invite flag")
assert_('if getattr(p, "is_invited", False):' in SRC,
        "the dashboard counts the is_invited FLAG, not a status")
assert_(re.search(r'if p\.status == "invited":\s*\n\s*invited_c \+= 1', SRC) is None,
        "…and the old status-based invited count is gone")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
