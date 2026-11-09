# -*- coding: utf-8 -*-
"""The cover-letter chat sees Artem's audit samples, in full.

Owner, 2026-11-02, job 21630: asked "do you have a content of my SEO audit
cases?", the chat answered no. KB #419 (the lemoos.com and mon-lumiere.com audit
samples) was the last entry of the "Notes & Manual Entries" section, which
started at char 42,591 of a 44,094-char KB bundle cut at 40,000 - none of it was
sent - and it was capped at 700 chars even when it fitted.

This lifts the bundle code out of /chat in api/main.py and runs it on synthetic
entries shaped like the live KB.

Run: .venv\\Scripts\\python tests\\test_chat_kb_samples.py
"""
import re
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace as E

ROOT = Path(__file__).resolve().parent.parent
bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
chat = src[src.index("async def chat(request: dict):"):]
body = chat[chat.index("    # Partition by intent"):chat.index("    # ── Build job context")]


def bundle(entries, provider):
    for e in entries:
        if not hasattr(e, "is_core"):
            e.is_core = e.type == "case_study"   # the chat now picks its case studies by this flag
    ns = {"kb_entries": entries, "_re": re, "_get_ai_provider": lambda: provider}
    exec(textwrap.dedent(body), ns)
    return ns["kb_text"]


SEO = "WORK SAMPLE: Technical SEO Audit - lemoos.com (Bridal E-commerce, EN/DE, Webflow)\n" + "finding. " * 650 + "END-OF-SEO-SAMPLE"
PPC = "Google Ads audit walkthrough. " + "check. " * 450 + "END-OF-PPC-SAMPLE"
entries = (
    [E(type="rule", title=f"Rule {i}", content="rule text " * 70, tags=None, id=i) for i in range(34)]  # ~24k, like the live 34 rules
    + [E(type="manual", title="Artem PPC SEO Client Case Studies Results Overview", content="Derma Solution " * 400, tags=None, id=1)]
    + [E(type="case_study", title=f"Case {i}", content="case " * 300, tags=None, id=100 + i) for i in range(8)]
    + [E(type="sent_proposal", title=f"Letter {i}", content="letter " * 200, tags=None, id=200 + i) for i in range(8)]
    + [E(type="note", title=f"Note {i}", content="note " * 300, tags=None, id=300 + i) for i in range(3)]
    + [E(type="manual", title="Upwork Prompt Gemini + template examples", content="template " * 900, tags=None, id=396)]
    + [E(type="manual", title="Google Ads audit Example 1", content=PPC, tags=None, id=6)]
    + [E(type="manual", title="two technical SEO website audit examples that Artem attaches to cover letter",
         content=SEO, tags="SEO technical audits samples", id=419)]
    + [E(type="scraped", title="IT Force", content="scraped " * 3000, tags=None, id=500)]
)

for provider in ("cli", "api"):
    kb = bundle(entries, provider)
    assert_("END-OF-SEO-SAMPLE" in kb, f"[{provider}] the technical SEO audit sample reaches the chat whole")
    assert_("END-OF-PPC-SAMPLE" in kb, f"[{provider}] the Google Ads audit sample reaches the chat whole")
    # Unprotected sections (the case studies, from the 2026-11-05 roster change on) may be
    # cut away by the ceiling in API mode with this much synthetic text, so compare with
    # whichever of them is still there.
    later = [kb.find(h) for h in ("# Approved Case Study Roster", "# Approved Case Studies") if kb.find(h) != -1]
    assert_(kb.index("# Audit Samples Artem Attaches") < min(later or [len(kb)]),
            f"[{provider}] the samples come straight after the rules, ahead of anything the cap can cut")
    assert_(kb.count("lemoos.com") == 1, f"[{provider}] #419 is not also repeated in the notes section")
    assert_("Rule 34." in kb, f"[{provider}] every rule survives")

# The case-study roster (2026-11-05) is protected like the rules and samples, so the ceiling
# can rise to hold it; with no roster entry, API mode still holds the 40k ceiling.
no_roster = [e for e in entries if "Results Overview" not in e.title]
assert_(len(bundle(no_roster, "api")) <= 40000 + 60, "API mode still holds the 40k ceiling (rate limit)")
assert_("scraped scraped" in bundle(entries, "cli") and len(bundle(entries, "cli")) > 40000,
        "CLI mode has the larger ceiling, so the lower sections are no longer cut at 40k")

# A KB whose rules alone pass the ceiling still keeps every rule and the samples.
huge = [E(type="rule", title=f"Rule {i}", content="long rule " * 500, tags=None, id=i) for i in range(10)] + entries[-2:-1]
kb = bundle(huge, "api")
assert_("Rule 10." in kb and "END-OF-SEO-SAMPLE" in kb, "the ceiling never cuts inside the rules or the samples")

print(f"\n{'ALL PASS' if not bad else f'{bad} FAILED'}")
sys.exit(1 if bad else 0)
