"""Checks a chain must pass before it may be approved (METRO_PLAN.md Phase 3, step 4). In CODE, not only in the prompt.

Per touch (the text as it will be sent, minus the case link code attached):
  * no price or currency, no URL or domain written by the model, no unfilled placeholder ({first_name}, [Company], XXX ...);
  * no em or en dash, no exclamation mark, no lowercase "i" as a word, no phrase on the banned list (DevScout's writing rules
    plus the Phase 3 list), nothing on the campaign's do-not-claim list, English only;
  * LinkedIn: under 300 characters; email: a subject, a body under 120 words;
  * the greeting names the lead's own first name (when it names anyone);
  * every hook it cites exists in the lead's ledger, is not used by another touch, is not a hook kind refused for the segment
    (agency campaigns: no audit of their own site); every number in the text is in a hook it cites or in IT Force's own facts.
Per chain: at least one touch; no hook used twice; the channels follow the planned order.

A failing chain shows "Do not send as is"; "Send anyway" records its date on the touch (the Hard rule: checks in code).
"""
from __future__ import annotations

import re

from .hooks import PRICE_RX, URL_RX, agency_hook_refusal

# A number standing on its own: "since 2015", "25 ads", "4.8". Not the digit inside a word ("B2B", "H1", "GA4").
NUM_RX = re.compile(r"(?<![A-Za-z\d])\d[\d,.]*(?![A-Za-z\d])")

LINKEDIN_MAX_CHARS = 300
EMAIL_MAX_WORDS = 120
SUBJECT_MAX_CHARS = 70

BANNED = [
    # DevScout writingRules.js BANNED
    "i hope this finds you well", "i wanted to reach out", "i came across your profile", "i help companies like yours", "quick question",
    "just checking in", "just following up", "circling back", "touching base", "bumping this", "did you get a chance", "did you see my message",
    "nothing to answer here", "no need to reply", "no need to answer", "no reply is fine", "sorry to bother",
    "resonat", "genuinely", "quietly", "leverage", "seamless", "game-changer", "game changer", "unlock", "in today's landscape",
    "covers a lot of ground", "is rarely simple", "looking forward to networking", "let's connect and grow", "no worries either way",
    "decision makers", "decision-makers",
    # Phase 3 (Oleh 26 Nov: human, short, specific; no buzzwords)
    "hope you're well", "hope you are well", "hope you're doing well", "hope all is well", "i trust this", "reaching out",
    "synergy", "synergies", "cutting-edge", "cutting edge", "best-in-class", "world-class", "state-of-the-art", "revolutioniz",
    "supercharge", "skyrocket", "turbocharge", "next level", "next-level", "elevate your", "empower", "robust", "holistic",
    "delve", "fast-paced", "ever-evolving", "in today's", "dive deep", "deep dive", "win-win", "paradigm", "disrupt",
    "low-hanging fruit", "move the needle", "at the end of the day", "i'd love to pick your brain", "kindly", "as per",
    "please find attached", "don't hesitate", "do not hesitate", "feel free to", "excited to", "thrilled",
]
# Guesses about THEM written as if known (the Hard rule: an assumed fact is never written as a fact).
GUESSES = ["i'd guess", "i guess", "likely", "i assume", "i imagine", "i bet", "probably", "must be struggling", "you must", "i suspect",
           "chances are", "i'm sure you"]
CALL_ASKS = ["short call", "quick call", "15 minutes", "15-minute", "hop on a call", "jump on a call", "book a time", "calendar link",
             "calendly", "schedule a call", "a quick chat"]
PLACEHOLDER = re.compile(r"\{\{|\}\}|\{\s*[A-Za-z_ ]{2,30}\s*\}|\[\s*(?:first ?name|last ?name|name|company|company name|your name|link|url|"
                         r"case|title|role|city|industry|agency|recipient)[^\]]{0,20}\]|<\s*(?:first ?name|name|company|link)[^>]{0,20}>|"
                         r"\bXXX+\b|\bTBD\b|\bTODO\b|\bINSERT\b|lorem ipsum|\bN/A\b", re.I)
DASHES = re.compile(r"[—–‒―]|\s--\s")
NON_ENGLISH = re.compile(r"[Ѐ-ӿ֐-׿؀-ۿऀ-ॿ぀-ヿ一-鿿가-힯]")
GREETING = re.compile(r"^\s*(?:hi|hello|hey|dear|good (?:morning|afternoon))\s+([A-Z][A-Za-z'\-]+)", re.I)


def _flag(rule: str, text: str) -> dict:
    return {"rule": rule, "text": text}


def check_touch(touch: dict, *, lead_first: str | None, hooks: dict[int, dict], used_elsewhere: set[int], segment: str,
                allowed_numbers: set[str], do_not_claim: list[str] | None = None) -> list[dict]:
    """Flags for one touch: {channel, subject, body (model text, no case link), hook_ids}. `hooks` = the lead's ledger
    {id: {fact, kind, paths}}; `used_elsewhere` = hook ids another touch (this chain or another lead) already uses."""
    flags: list[dict] = []
    body = str(touch.get("body") or "")
    subject = str(touch.get("subject") or "")
    full = f"{subject}\n{body}" if subject else body
    low = full.replace("’", "'").lower()
    if not body.strip():
        return [_flag("empty", "the message is empty")]
    if PRICE_RX.search(full):
        flags.append(_flag("price", f"mentions a price or rate ({PRICE_RX.search(full).group(0)})"))
    if URL_RX.search(full):
        flags.append(_flag("url", f"a URL or domain written in the text ({URL_RX.search(full).group(0)}); the case link is added by code"))
    m = PLACEHOLDER.search(full)
    if m:
        flags.append(_flag("placeholder", f"an unfilled placeholder ({m.group(0)})"))
    if DASHES.search(full):
        flags.append(_flag("dash", "an em or en dash"))
    if "!" in full:
        flags.append(_flag("exclamation", "an exclamation mark"))
    if re.search(r"(?<![A-Za-z'])i(?![A-Za-z'])", full):
        flags.append(_flag("lowercase_i", 'a lowercase "i"'))
    for b in BANNED:
        if b in low:
            flags.append(_flag("banned", f'banned phrase "{b}"'))
    for b in GUESSES:
        if b in low:
            flags.append(_flag("guess", f'a guess about them ("{b}"): say only what the hooks say'))
    for b in CALL_ASKS:
        if b in low:
            flags.append(_flag("call_ask", f'asks for a call ("{b}"); end with a soft line instead'))
    for b in do_not_claim or []:
        if b and b.lower() in low:
            flags.append(_flag("do_not_claim", f"the campaign's do-not-claim list: {b}"))
    if NON_ENGLISH.search(full):
        flags.append(_flag("language", "text that is not English"))
    g = GREETING.match(body)
    if g and lead_first and g.group(1).lower() != lead_first.strip().lower():
        flags.append(_flag("name", f'greets "{g.group(1)}" but the lead is {lead_first}'))
    if touch.get("channel") == "linkedin":
        if len(body) > LINKEDIN_MAX_CHARS:
            flags.append(_flag("length", f"{len(body)} characters, a LinkedIn message stays under {LINKEDIN_MAX_CHARS}"))
        if subject:
            flags.append(_flag("subject", "a LinkedIn message has no subject"))
    else:
        words = len(re.findall(r"\b[\w'’-]+\b", body))
        if words > EMAIL_MAX_WORDS:
            flags.append(_flag("length", f"{words} words, an email body stays under {EMAIL_MAX_WORDS}"))
        if not subject.strip():
            flags.append(_flag("subject", "an email needs a subject"))
        elif len(subject) > SUBJECT_MAX_CHARS or subject.lower().startswith(("re:", "fwd:", "fw:")):
            flags.append(_flag("subject", "the subject is too long or pretends to be a reply"))
    ids = [int(x) for x in touch.get("hook_ids") or []]
    have_nums = set(allowed_numbers)
    for hid in ids:
        h = hooks.get(hid)
        if h is None:
            flags.append(_flag("hook_missing", "cites a hook that is not in this lead's ledger" if hid < 0 else
                               f"uses hook {hid}, which is not in this lead's ledger"))
            continue
        if hid in used_elsewhere:
            flags.append(_flag("hook_reused", f"hook {hid} is already used by another touch"))
        if segment == "agency":
            why = agency_hook_refusal(h.get("fact", ""), h.get("kind"), h.get("paths") or [])
            if why:
                flags.append(_flag("agency_kind", f"hook {hid}: {why}"))
        for n in NUM_RX.findall(h.get("fact", "")):
            have_nums.add(re.sub(r"[^\d]", "", n))
            have_nums.add(re.sub(r"[^\d]", "", re.split(r"\.(?=\d)", n)[0]))     # "since 2021.06" lets a message say "since 2021"
    for n in {re.sub(r"[^\d]", "", x) for x in NUM_RX.findall(full)}:
        if n and n not in have_nums:
            flags.append(_flag("number", f"the number {n} is in no hook this touch uses"))
    return flags


def check_chain(touches: list[dict], *, lead_first: str | None, hooks: dict[int, dict], other_leads_used: set[int], segment: str,
                allowed_numbers: set[str], plan_channels: list[str] | None = None, do_not_claim: list[str] | None = None,
                base_chain: bool = False) -> dict:
    """{"ok", "touches": [{"step", "ok", "flags"}], "flags": [chain-level]}."""
    out, chain_flags, seen = [], [], {}
    if not touches:
        chain_flags.append(_flag("empty", "no touch was written"))
    for t in touches:
        for hid in t.get("hook_ids") or []:
            seen.setdefault(int(hid), []).append(t.get("step"))
    for hid, steps in seen.items():
        if len(steps) > 1:
            chain_flags.append(_flag("hook_reused", f"hook {hid} is used by steps {', '.join(str(s) for s in steps)}"))
    for t in touches:
        mine = {int(h) for h in t.get("hook_ids") or []}
        # reuse inside this chain is one chain-level flag (above); a hook another LEAD's touch holds is flagged on the touch
        f = check_touch(t, lead_first=lead_first, hooks=hooks, used_elsewhere=set(other_leads_used),
                        segment=segment, allowed_numbers=allowed_numbers, do_not_claim=do_not_claim)
        if not base_chain and not mine and t.get("step") == 1:
            f.append(_flag("no_hook", "the first touch uses no hook"))
        out.append({"step": t.get("step"), "ok": not f, "flags": f})
    if plan_channels is not None and [t.get("channel") for t in touches] != plan_channels:
        chain_flags.append(_flag("order", "the channels do not follow the planned order"))
    ok = not chain_flags and all(x["ok"] for x in out)
    return {"ok": ok, "touches": out, "flags": chain_flags}
