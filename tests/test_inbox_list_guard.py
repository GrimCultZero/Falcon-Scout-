# -*- coding: utf-8 -*-
"""A "client message" that is really the inbox list is never a reply.

2026-09-30 18:38 UTC a sync visit read a room panel that had taken in the
sidebar, and proposals 234 and 248 stored the whole conversation list (other
clients' names, "You: ..." previews, a Meet link) as the client's reply; the
generator then quoted it as "client replied: ...". `_looks_like_inbox_list`
keeps such text out of client_reply_text and out of the outcome reading.

Lifted out of api/main.py via `ast` (main.py is never imported).
Run:  python tests/test_inbox_list_guard.py
"""
import ast
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
WANT = {"_INBOX_LIST_LINE_RE", "_INBOX_LIST_DATE_RE", "_looks_like_inbox_list"}
nodes = [n for n in tree.body
         if (isinstance(n, ast.FunctionDef) and n.name in WANT)
         or (isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT for t in n.targets))]
if {getattr(n, "name", None) or n.targets[0].id for n in nodes} != WANT:
    print("FAIL  could not lift the inbox-list guard from api/main.py")
    sys.exit(1)
ns = {"_re_mod": re}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_helpers", "exec"), ns)
guard = ns["_looks_like_inbox_list"]

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

# The shape stored on 30 Sep (names made up).
sidebar = ("Google Ads PPC Specialist for a Recycling Company\n"
           "You: Hi, checking in to ask if you had time to go over my audit findings? Thx\n"
           "Jane Doe, Doe Racking\nGoogle Ads Attribution Audit\n"
           "You: thank you for letting me know, Jane, all the best!\n"
           "John Roe, Roe Hosting Ltd\nMonday\nPPC Specialist (Google Ads) – Part-Time\n"
           "John: PPC https://meet.google.com/abc-defg-hij\n"
           "Acme Llc\n9/22/26\nWeb fixes\nAcme Llc approved the milestone")
check(guard(sidebar), 'the inbox list read as one message is recognised ("You: …" previews, row dates)')
check(guard("John Roe, Roe Hosting Ltd\nMonday\nPPC Specialist\nAcme Llc\n9/22/26\nWeb fixes"),
      "…also by its row dates alone (two bare weekday / M/D/YY lines)")

decline = ("Hi Artem\nThank you so much for your interest in the attribution audit project.\n"
           "We've selected another candidate for this project, but we sincerely appreciate the time and effort you put into your application.\n"
           "Best regards,")
check(not guard(decline), "a real client message (Sofia's decline, shape) is a message")
check(not guard("Can we start Monday? Also, what would you need from us — admin access to GA4?"),
      "a weekday inside a sentence is not a list row date")
check(not guard("Thanks, see you Monday.\nWe'll share access then."), "one weekday line with words around it is fine")

# wired where the sync reads client messages
check(re.search(r'and not _looks_like_inbox_list\(str\(m\.get\("text"\) or ""\)\)\]', src) is not None,
      "messages_status_sync drops such texts from _client_texts (no reply text, no outcome)")
check(src.index("def _looks_like_inbox_list") < src.index("def messages_status_sync"),
      "the helper is defined above the endpoint that uses it")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
