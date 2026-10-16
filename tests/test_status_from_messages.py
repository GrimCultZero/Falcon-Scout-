# -*- coding: utf-8 -*-
"""Outcomes read from the client's own messages (inbox sync, extension 5.3).

Sofia Toro's decline ("We've selected another candidate", 29 Sep 2026) went
unrecorded: the sync only saw inbox previews. Rooms that moved are now opened
again and their messages sent along; `_signal_from_client_messages` reads the
client's, newest first, with the capture's own phrase lists.

Lifted out of api/main.py via `ast` (main.py is never imported).
Run:  python tests/test_status_from_messages.py
"""
import ast
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
WANT = {"_HIRE_SIGNALS", "_HIRE_CONTRACT_SIGNALS", "_INTERVIEW_SIGNALS", "_DECLINE_SIGNALS",
        "_OUTCOME_FROM", "_signal_from_client_messages"}
nodes = []
for n in tree.body:
    if isinstance(n, ast.FunctionDef) and n.name in WANT:
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT for t in n.targets):
        nodes.append(n)
if {getattr(n, "name", None) or n.targets[0].id for n in nodes} != WANT:
    print("FAIL  could not lift the outcome helpers from api/main.py")
    sys.exit(1)
ns = {"_re_mod": re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_helpers", "exec"), ns)
sig, FROM = ns["_signal_from_client_messages"], ns["_OUTCOME_FROM"]

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

questions = ("Hi! Thank you for your proposal. Before selecting the finalists, could you please answer "
             "these three brief questions?")
decline = ("Hi Artem\nThank you so much for your interest in the Google Ads, GA4, GTM, HubSpot & CallRail "
           "Attribution Audit project at Speedrack West.\nWe've selected another candidate for this project, "
           "but we sincerely appreciate the time and effort you put into your application.\nBest regards,")
check(sig([questions, decline]) == "declined", "Sofia Toro: her questions, then the decline -> declined")
check(sig([questions]) is None, "questions alone are not an outcome (the sync already marks it replied)")
check(sig(["Can we schedule a call on Friday?", decline]) == "declined", "a later decline beats an earlier interview invite")
check(sig([decline, "Actually - could we schedule a call tomorrow?"]) == "interviewing", "a later interview beats an earlier decline")
check(sig([]) is None and sig(["", "   "]) is None, "no client text: None")
check("replied" in FROM["declined"] and "hired" not in FROM["declined"] and "withdrawn" not in FROM["declined"],
      "a decline can replace 'replied', never a hire or a withdrawal")
check("declined" not in FROM["interviewing"], "an interview invite never reopens a declined proposal")
check("_client_texts and match_via in _EXACT_MATCH_PATHS" in src,
      "messages_status_sync applies them on exact matches only")
check('m.get("from") == "client"' in src, "…and reads only messages attributed to the client")

# ── a hire needs a contract, not a sentence (owner, 2026-10-16) ──────────────
# The dashboard showed "1 HIRED" for week 42 off this one line, mid-message,
# from a client who was deciding whether to CONTINUE. Nothing in that capture's
# 11,660 characters held a contract artifact.
sinking_birdies = (
    "Hi Artem,\n"
    "Yes, I've had a look through it - thank you for taking the time to audit the account.\n"
    "The main reason I hired you was to try to identify and fix the products receiving zero "
    "impressions.\n"
    "If you feel this is something you can realistically get to the bottom of, I'd be happy to "
    "continue working with you on it. If not, no problem at all, I'd just rather be clear on the "
    "scope before we go further."
)
check(sig([sinking_birdies]) is None,
      "proposal 318: 'the main reason I hired you' is a client's prose, not a hire")
check(sig(["We hired you last spring and it went well — want to do it again?"]) is None,
      "…nor is any other past-tense mention of hiring")
check(sig(["Active contract", "View contract"]) == "hired",
      "a contract artifact still reads as hired")
check(sig(["View offer $1,200"]) == "hired", "…as does an offer card")
check(sig(["Rate: $45/hr   Limit: 20 hrs/week"]) == "hired", "…and a rate card")
check(not any(rx.search("the main reason I hired you") for rx in ns["_HIRE_SIGNALS"]),
      "the prose patterns are gone from the capture path too, not just this one")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
