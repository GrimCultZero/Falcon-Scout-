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
WANT = {"_HIRE_SIGNALS", "_INTERVIEW_SIGNALS", "_DECLINE_SIGNALS", "_OUTCOME_FROM", "_signal_from_client_messages"}
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

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
