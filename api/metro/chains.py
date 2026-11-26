"""The chain writer (METRO_PLAN.md Phase 3, steps 3-5): one lead per call through /claude.

CODE plans, the model writes, CODE checks:
  * the account: a company is one account; only its primary contact gets a chain (accounts.py), the others are held;
  * the hooks: the lead's unused ledger hooks (its company's, shared, and its own); for an agency campaign the kinds refused
    for agencies are left out before the model sees them;
  * the shape (locked decision "Chain shape"): touches = number of distinct hooks, cap 6; under 2 hooks = the base chain of 3
    from the campaign brief;
  * the channel order (locked decision "Channel order", 24 Nov): connected on LinkedIn = LinkedIn first (up to 3 messages from
    Artem) then email with the unused hooks; not connected = email first. A lead with no sendable address that is invited
    gets the LinkedIn-first plan, waiting for the acceptance; a lead with neither gets the email plan, waiting for an address;
  * the case link: chosen by code (cases.best_case) and appended by code to ONE touch; the model only refers to it in words;
  * the checks (chaincheck.py); a failing chain shows "Do not send as is". The ledger marks a hook used by the touch that
    carries it, so no other touch (of this lead or a colleague) can use it again.
English only. Nothing here sends anything: Phase 4/5 send, only after Approve (or "Send anyway", with its date).
"""
from __future__ import annotations

import json
import re
import threading
from typing import Callable

from sqlalchemy.orm import Session

from . import accounts, aiclient, cases, chaincheck
from . import hooks as hk
from .db import MetroCampaign, MetroCaseLink, MetroCompany, MetroHook, MetroLead, MetroTouch, get_engine, get_setting, utcnow
from .emailfinder import email_sendable

MAX_TOUCHES = 6
LINKEDIN_FIRST_MAX = 3
BASE_CHAIN = 3
LI_DAYS = [0, 3, 8]
EMAIL_DAYS = [0, 3, 7, 12, 18, 25]
EMAIL_AFTER_LINKEDIN = 5          # the email track starts this many days after the last LinkedIn message

# What a message may say about IT Force. Its numbers are the only numbers a message may carry besides the hooks' own.
ITFORCE_FACTS = ("IT Force is a Google Ads / PPC, SEO and web development team from Ukraine, working since 2015. For agencies it "
                 "delivers white-label: the work goes out under the agency's brand and IT Force never contacts the agency's client. "
                 "The team works in a European time zone, so a US or Canadian agency gets work done overnight and in its morning.")
ITFORCE_NUMBERS = {"2015"}


def track_of(lead: MetroLead) -> tuple[str, str | None]:
    """(track, waiting reason or None)."""
    if lead.invite_status == "connected":
        return "linkedin_first", None
    if email_sendable(lead):
        return "email_first", None
    if lead.invite_status == "invited":
        return "linkedin_first", "waits for the LinkedIn acceptance (no sendable email address yet)"
    return "email_first", "needs an email address (none found yet) or a LinkedIn connection"


def plan(lead: MetroLead, n_hooks: int) -> dict:
    """The steps (channel, day) of this lead's chain. Pure."""
    track, waiting = track_of(lead)
    base = n_hooks < 2
    n = BASE_CHAIN if base else min(n_hooks, MAX_TOUCHES)
    steps = []
    if track == "linkedin_first":
        li = min(LINKEDIN_FIRST_MAX, n)
        for i in range(li):
            steps.append({"step": i + 1, "channel": "linkedin", "day": LI_DAYS[i]})
        start = LI_DAYS[li - 1] + EMAIL_AFTER_LINKEDIN
        for j in range(n - li):
            steps.append({"step": li + j + 1, "channel": "email", "day": start + EMAIL_DAYS[j]})
    else:
        for j in range(n):
            steps.append({"step": j + 1, "channel": "email", "day": EMAIL_DAYS[j]})
    # the case link goes on one touch: the second one (an email if the chain has one after step 1)
    later_email = next((s["step"] for s in steps if s["channel"] == "email" and s["step"] > 1), None)
    case_step = later_email or (2 if len(steps) >= 2 else 1)
    return {"track": track, "waiting": waiting, "base": base, "steps": steps, "case_step": case_step}


def available_hooks(s: Session, lead: MetroLead, segment: str) -> list[MetroHook]:
    """The hooks this lead's chain may use: its ledger hooks not used by any touch (a touch of THIS lead's draft is freed before
    rewriting), and for agency campaigns not of a kind refused for agencies."""
    out = []
    for h in hk.hooks_query(s, lead).order_by(MetroHook.scope.asc(), MetroHook.id).all():
        if h.used_touch_id is not None:
            continue
        if segment == "agency" and hk.agency_hook_refusal(h.fact, h.kind, [p.strip() for p in (h.source_field or "").split(",")]):
            continue
        out.append(h)
    return out


STYLE = """Write like a real person, short and specific:
- English only. Plain text. No "I hope this finds you well", no "I wanted to reach out", no buzzwords (leverage, seamless, synergy,
  unlock, elevate, robust, cutting-edge ...), no em or en dashes (use a comma or a full stop), no exclamation marks.
- Never a price, a rate, a fee or a currency. Never a URL or a domain (a case link is added under your text by code).
- No placeholders: use the real first name given. No "decision makers" or other labels for the reader.
- Contractions are fine (I'm, we're, don't). Capital "I".
- A LinkedIn message is under 300 characters, no subject, a first-name greeting.
- An email has a short subject (lowercase is fine, no "Re:") and a body under 120 words, signed with the sender's first name only.
- Each touch opens with its OWN hook (one fact about them, phrased naturally, never "I noticed that your site ..."), ties it in one
  sentence to why IT Force writes, and ends with ONE easy question or a soft line. Never ask for a call or a meeting length.
- Later touches never repeat an earlier touch's fact or question. Numbers only from the hooks or from the IT Force facts.
- Never guess about them ("I'd guess", "probably", "I imagine", "you must"): say only what the hooks say.
- Never these words: {banned}."""

PROMPT = """You write a short outreach chain from {sender} at IT Force to one person.

ABOUT IT FORCE (the only claims you may make about us): {itforce}
CAMPAIGN: {segment_line}
WHO WE WRITE TO AND THEIR PAINS: {brief}
THE OFFER (mention it in at most two touches, never with a price): {offer}
DO NOT CLAIM: {do_not_claim}

THE PERSON: {first} ({full}), {title} at {company}.
{summary}
HOOKS (true facts about them; every touch uses the hook ids given for it, and no other touch uses the same hook):
{hooks}

THE PLAN (fixed by code; write exactly these touches, in this order, on these channels):
{steps}
{case_line}
{style}

Answer with JSON only:
{{"touches": [{{"step": 1, "channel": "linkedin", "subject": null, "body": "...", "hooks": ["H1"]}}],
  "summary": "one sentence: why this person and this angle"}}"""


def _hook_line(h: MetroHook, key: str) -> str:
    who = "company" if (h.scope or "person") == "company" else "person"
    return f"{key} ({who}, {h.kind or 'fact'}): {h.fact}"


def _steps_text(p: dict, assign: dict[int, list[str]]) -> str:
    out = []
    for st in p["steps"]:
        what = "LinkedIn message" if st["channel"] == "linkedin" else "email"
        hs = assign.get(st["step"]) or []
        uses = f"uses {', '.join(hs)}" if hs else "uses no hook: build it on the campaign's pains and the offer"
        first = " (the first message after they accepted the invite: thank them for connecting, no pitch beyond one line)" \
            if st["channel"] == "linkedin" and st["step"] == 1 else ""
        out.append(f"step {st['step']}: {what}, day {st['day']}, {uses}{first}")
    return "\n".join(out)


def assign_hooks(p: dict, keys: list[str]) -> dict[int, list[str]]:
    """Which hooks each step uses: one distinct hook per step, in the order given (strongest first); spare hooks (more hooks
    than steps) are added to the first steps as a second fact. Base chains: the one hook (if any) on step 1."""
    steps = [s["step"] for s in p["steps"]]
    out: dict[int, list[str]] = {s: [] for s in steps}
    for i, k in enumerate(keys):
        if i < len(steps):
            out[steps[i]].append(k)
        else:
            break
    return out


def _brief(campaign) -> dict:
    try:
        return json.loads(campaign.brief_json) if campaign.brief_json else {}
    except ValueError:
        return {}


def build_prompt(s: Session, lead: MetroLead, campaign: MetroCampaign, hooks_: list[MetroHook], p: dict, case: dict | None) -> tuple[str, dict]:
    brief = _brief(campaign)
    keys = {f"H{i}": h for i, h in enumerate(hooks_, 1)}
    order = list(keys)
    assign = assign_hooks(p, order)
    notes = json.loads(lead.score_notes_json or "{}")
    sender = str(get_setting(s, "sender_name", "Artem") or "Artem")
    seg = hk.segment_of(campaign)
    segment_line = ("agency: a white-label partner pitch to a marketing agency owner (we deliver Google Ads and SEO for THEIR clients, "
                    "under their brand). Never audit their own website." if seg == "agency" else
                    "niche: a direct client who could hire IT Force for their own Google Ads, SEO or website.")
    case_line = ""
    if case:
        case_line = (f"CASE: step {p['case_step']} carries a link to an IT Force case that code adds under your text: \"{case['title']}\" "
                     f"(client industry: {', '.join(case['industry_tags']) or 'n/a'}; services: {', '.join(case['service_tags']) or 'n/a'}). "
                     f"In that step refer to it in a few plain words (for example \"here's a similar project of ours\"), without numbers. "
                     f"Describe it by its title only: never say for whom or how it was delivered (not \"for an agency partner\").")
    prompt = PROMPT.format(
        sender=sender, itforce=brief.get("about_us") or ITFORCE_FACTS, segment_line=segment_line,
        brief=json.dumps({k: brief.get(k) for k in ("who", "pains") if brief.get(k)}, ensure_ascii=False) or "none",
        offer=campaign.offer or "none", do_not_claim="; ".join(str(x) for x in brief.get("do_not_claim") or []) or "none",
        first=lead.first_name or (lead.full_name or "").split(" ")[0] or "there", full=lead.full_name or "", title=lead.title or "",
        company=lead.company_name or "", summary=(f"ANGLE: {notes['angle']}" if notes.get("angle") else ""),
        hooks="\n".join(_hook_line(h, k) for k, h in keys.items()) or "(none: write the base chain from the pains and the offer)",
        steps=_steps_text(p, assign), case_line=case_line,
        style=STYLE.replace("{banned}", ", ".join(sorted({b for b in chaincheck.BANNED if len(b) > 3 and b != "—"}))))
    return prompt, {"keys": {k: h.id for k, h in keys.items()}, "assign": assign}


def ledger_view(s: Session, lead: MetroLead) -> dict[int, dict]:
    return {h.id: {"fact": h.fact, "kind": h.kind, "paths": [p.strip() for p in (h.source_field or "").split(",")]}
            for h in hk.hooks_query(s, lead).all()}


def used_by_others(s: Session, lead: MetroLead) -> set[int]:
    """Hooks of this lead's ledger held by a touch of ANOTHER lead (a colleague at the same company)."""
    out = set()
    for h in hk.hooks_query(s, lead).filter(MetroHook.used_touch_id.isnot(None)).all():
        t = s.get(MetroTouch, h.used_touch_id)
        if t is not None and t.lead_id != lead.id:
            out.add(h.id)
    return out


def recheck(s: Session, lead: MetroLead, campaign: MetroCampaign) -> dict:
    """Run the checks again over the stored chain (after an edit) and store the results on the touches and the lead."""
    touches = s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle,
                                         MetroTouch.status != "cancelled").order_by(MetroTouch.step).all()
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    brief = _brief(campaign)
    tl = [{"step": t.step, "channel": t.channel, "subject": t.subject, "body": _model_text(t),
           "hook_ids": json.loads(t.hook_ids_json or "[]")} for t in touches]
    res = chaincheck.check_chain(tl, lead_first=lead.first_name or (lead.full_name or "").split(" ")[0], hooks=ledger_view(s, lead),
                                 other_leads_used=used_by_others(s, lead), segment=hk.segment_of(campaign),
                                 allowed_numbers=ITFORCE_NUMBERS | set(notes.get("allowed_numbers") or []),
                                 plan_channels=[x["channel"] for x in (notes.get("plan") or {}).get("steps", [])] or None,
                                 do_not_claim=[str(x) for x in brief.get("do_not_claim") or []], base_chain=bool((notes.get("plan") or {}).get("base")))
    by_step = {x["step"]: x for x in res["touches"]}
    for t in touches:
        r = by_step.get(t.step) or {"ok": False, "flags": []}
        t.checks_json = json.dumps(r["flags"], ensure_ascii=False)
        t.checks_passed = bool(r["ok"])
    notes["chain_flags"] = res["flags"]
    notes["ok"] = res["ok"]
    lead.chain_json = json.dumps(notes, ensure_ascii=False)
    return res


CASE_MARK = "\n\n"


def _model_text(t: MetroTouch) -> str:
    """The text the checks read: the body without the case line code appended (which carries the one allowed URL)."""
    body = t.body or ""
    if t.case_link_id:
        tail = body.rfind(CASE_MARK)
        if tail != -1 and "https://itforce.ua/" in body[tail:]:
            return body[:tail]
    return body


def _with_case(body: str, channel: str, case: dict | None) -> str:
    if not case:
        return body
    line = case["url"] if channel == "linkedin" else f"{case['title']}: {case['url']}"
    return body.rstrip() + CASE_MARK + line


def humanize(text: str) -> str:
    """DevScout's contractions on prose (writingRules.humanize), never inside quotes."""
    pairs = [(r"\bdoes not\b", "doesn't"), (r"\bdo not\b", "don't"), (r"\bDo not\b", "Don't"), (r"\bis not\b", "isn't"),
             (r"\bI am\b", "I'm"), (r"\bwe are\b", "we're"), (r"\bWe are\b", "We're"), (r"\byou are\b", "you're"),
             (r"\bYou are\b", "You're"), (r"\bI will\b", "I'll"), (r"\bthat is\b", "that's"), (r"\bThat is\b", "That's")]
    parts = re.split(r'("[^"\n]*")', text or "")
    for i in range(0, len(parts), 2):
        for a, b in pairs:
            parts[i] = re.sub(a, b, parts[i])
    return "".join(parts)


def clean_text(text: str) -> str:
    t = str(text or "").replace("\r\n", "\n").strip()
    t = re.sub(r"[ \t]+\n", "\n", t)
    return humanize(t)


def clear_chain(s: Session, lead: MetroLead) -> int:
    """Remove the lead's DRAFT touches (not approved, not sent) and free their hooks."""
    n = hk._clear_drafts(s, [lead.id])
    lead.chain_approved_at = None
    return n


def write_chain(s: Session, lead: MetroLead, campaign: MetroCampaign, *, ask: Callable[..., str] | None = None) -> dict:
    ask = ask or aiclient.ask
    if lead.status != "new" or lead.stopped_reason:
        return {"lead_id": lead.id, "written": False, "reason": f"not usable ({lead.stopped_reason or lead.status})"}
    accounts.assign(s, [lead])
    if lead.account_role == "held":
        s.commit()
        return {"lead_id": lead.id, "written": False, "reason": "held: same company as the primary contact", "primary_lead_id": lead.primary_lead_id}
    if s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.status.in_(("scheduled", "sent", "unconfirmed"))).count():
        return {"lead_id": lead.id, "written": False, "reason": "its chain is already sending"}
    if lead.chain_approved_at is not None:
        return {"lead_id": lead.id, "written": False, "reason": "its chain is approved (unapprove it to write it again)"}
    seg = hk.segment_of(campaign)
    clear_chain(s, lead)
    s.flush()
    hooks_ = available_hooks(s, lead, seg)
    p = plan(lead, len(hooks_))
    notes = json.loads(lead.score_notes_json or "{}")
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    fallback = [company.industry] if company is not None and company.industry else []
    case = cases.best_case(s, notes.get("case_tag"), segment=seg, fallback_tags=fallback)
    prompt, meta = build_prompt(s, lead, campaign, hooks_, p, case)
    data = aiclient.parse_json(ask(prompt, model=aiclient.SONNET, max_tokens=6000, kind="metro_chain"))
    if not isinstance(data, dict) or not isinstance(data.get("touches"), list):
        raise aiclient.AIError("unexpected answer shape")
    got = {}
    for t in data["touches"]:
        if isinstance(t, dict):
            try:
                got.setdefault(int(t.get("step")), t)
            except (TypeError, ValueError):
                continue
    missing = []
    now = utcnow()
    for st in p["steps"]:
        t = got.get(st["step"])
        if t is None:
            missing.append(st["step"])
            continue
        keys = [str(k) for k in (t.get("hooks") or []) if str(k) in meta["keys"]]
        unknown = [str(k) for k in (t.get("hooks") or []) if str(k) not in meta["keys"]]
        hook_ids = [meta["keys"][k] for k in keys]
        body = clean_text(t.get("body"))
        subject = clean_text(t.get("subject")) if st["channel"] == "email" and t.get("subject") else None
        attach = case if st["step"] == p["case_step"] else None
        row = MetroTouch(lead_id=lead.id, cycle=lead.current_cycle, step=st["step"], channel=st["channel"], subject=subject,
                         body=_with_case(body, st["channel"], attach), model_body=body, day=st["day"], status="draft",
                         hook_ids_json=json.dumps(hook_ids + ([-1] if unknown else [])) if unknown else json.dumps(hook_ids),
                         case_link_id=attach["id"] if attach else None)
        s.add(row)
        s.flush()
        for hid in hook_ids:                       # the ledger: this touch holds these hooks now
            h = s.get(MetroHook, hid)
            if h is not None and h.used_touch_id is None:
                h.used_touch_id = row.id
    lead.chain_track = p["track"]
    lead.chain_written_at = now
    lead.chain_approved_at = None
    lead.chain_json = json.dumps({"plan": p, "summary": str(data.get("summary") or "")[:300] or None,
                                  "case": case, "missing_steps": missing, "hooks_offered": len(hooks_),
                                  "written_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}, ensure_ascii=False)
    s.flush()
    res = recheck(s, lead, campaign)
    if missing:
        notes2 = json.loads(lead.chain_json)
        notes2["chain_flags"] = notes2.get("chain_flags", []) + [{"rule": "missing", "text": f"the model left out step(s) {', '.join(map(str, missing))}"}]
        notes2["ok"] = False
        lead.chain_json = json.dumps(notes2, ensure_ascii=False)
    s.commit()
    return {"lead_id": lead.id, "written": True, "touches": len(p["steps"]) - len(missing), "ok": res["ok"] and not missing,
            "track": p["track"], "waiting": p["waiting"]}


# ───────────────────────── review: edit, approve, send anyway ─────────────────────────

def edit_touch(s: Session, touch: MetroTouch, *, body: str | None = None, subject: str | None = None) -> dict:
    """A person's edit. The case line stays code's (it is put back under the edited text); approvals of the chain are cleared."""
    lead = s.get(MetroLead, touch.lead_id)
    if touch.status != "draft":
        raise ValueError(f"this touch is {touch.status}; only a draft can be edited")
    if body is not None:
        case = None
        if touch.case_link_id:
            c = s.get(MetroCaseLink, touch.case_link_id)
            case = cases.case_dict(c) if c else None
        touch.body = _with_case(str(body).replace("\r\n", "\n").strip(), touch.channel, case)
    if subject is not None and touch.channel == "email":
        touch.subject = str(subject).strip() or None
    touch.edited_at = utcnow()
    for t in s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.status == "draft").all():
        t.approved_at = None
        t.send_anyway_at = None
    lead.chain_approved_at = None
    camp = s.get(MetroCampaign, lead.campaign_id)
    res = recheck(s, lead, camp)
    s.commit()
    return res


def approve(s: Session, lead: MetroLead, *, send_anyway: bool = False) -> dict:
    """Approve a chain. A chain whose checks fail can only be approved with `send_anyway`, which records its date on every
    failing touch (the Hard rule: the person decides, the record shows it)."""
    camp = s.get(MetroCampaign, lead.campaign_id)
    res = recheck(s, lead, camp)
    touches = s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.status == "draft").all()
    if not touches:
        raise ValueError("no chain to approve")
    if not res["ok"] and not send_anyway:
        raise ValueError("the chain fails its checks: fix it, or use Send anyway")
    now = utcnow()
    for t in touches:
        t.approved_at = now
        if not t.checks_passed:
            t.send_anyway_at = now
    lead.chain_approved_at = now
    notes = json.loads(lead.chain_json or "{}")
    notes["approved"] = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "send_anyway": bool(send_anyway and not res["ok"])}
    lead.chain_json = json.dumps(notes, ensure_ascii=False)
    s.commit()
    return {"approved": True, "send_anyway": bool(send_anyway and not res["ok"])}


def unapprove(s: Session, lead: MetroLead) -> dict:
    for t in s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.status == "draft").all():
        t.approved_at = None
        t.send_anyway_at = None
    lead.chain_approved_at = None
    s.commit()
    return {"approved": False}


def chain_status(s: Session, lead: MetroLead, touches: list[MetroTouch] | None = None) -> dict:
    """The Chain cell: not written / written N touches / issues / approved / sending step X / held / stopped."""
    if lead.stopped_reason:
        return {"state": "stopped", "label": "stopped: " + lead.stopped_reason}
    if lead.account_role == "held":
        return {"state": "held", "label": "held: same company", "primary_lead_id": lead.primary_lead_id}
    ts = touches if touches is not None else s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle,
                                                                        MetroTouch.status != "cancelled").order_by(MetroTouch.step).all()
    if not ts:
        return {"state": "none", "label": "not written"}
    sent = [t for t in ts if t.status in ("sent", "scheduled", "unconfirmed")]
    if sent:
        return {"state": "sending", "label": f"sending step {max(t.step for t in sent)}"}
    if lead.chain_approved_at:
        anyway = any(t.send_anyway_at for t in ts)
        return {"state": "approved", "label": "approved" + (" (send anyway)" if anyway else ""), "touches": len(ts)}
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    if not all(t.checks_passed for t in ts) or notes.get("chain_flags"):
        return {"state": "issues", "label": f"issues ({len(ts)} touches)", "touches": len(ts)}
    return {"state": "written", "label": f"written {len(ts)} touches", "touches": len(ts)}


def touch_dict(s: Session, t: MetroTouch, ledger: dict[int, dict]) -> dict:
    ids = json.loads(t.hook_ids_json or "[]")
    case = None
    if t.case_link_id:
        c = s.get(MetroCaseLink, t.case_link_id)
        case = cases.case_dict(c) if c else None
    return {"id": t.id, "step": t.step, "channel": t.channel, "day": t.day, "subject": t.subject, "body": t.body,
            "text": _model_text(t), "hook_ids": ids, "hooks": [ledger[i]["fact"] for i in ids if i in ledger],
            "checks": json.loads(t.checks_json or "[]"), "checks_passed": bool(t.checks_passed), "status": t.status,
            "approved_at": t.approved_at.isoformat() if t.approved_at else None,
            "send_anyway_at": t.send_anyway_at.isoformat() if t.send_anyway_at else None,
            "edited": t.edited_at is not None, "case": case}


def chain_view(s: Session, lead: MetroLead) -> dict:
    ts = s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle,
                                    MetroTouch.status != "cancelled").order_by(MetroTouch.step).all()
    ledger = ledger_view(s, lead)
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    return {"status": chain_status(s, lead, ts), "track": lead.chain_track, "notes": notes,
            "touches": [touch_dict(s, t, ledger) for t in ts]}


# ───────────────────────── a batch (background; one at a time) ─────────────────────────

class ChainsRun:
    lock = threading.Lock()
    state: dict = {"running": False}
    stop_flag = threading.Event()


def stop_chains() -> None:
    ChainsRun.stop_flag.set()


def targets(s: Session, campaign: MetroCampaign, lead_ids: list[int]) -> dict:
    """Which of these leads get a chain: usable leads, one primary per company (decided here). Returns the primaries to write
    and the held colleagues."""
    leads = [l for l in s.query(MetroLead).filter(MetroLead.id.in_(lead_ids)).all() if l.status == "new" and not l.stopped_reason] if lead_ids else []
    groups = accounts.assign(s, leads)
    primaries, held = [], []
    for l in leads:
        if l.account_role == "primary":
            primaries.append(l.id)
        else:
            held.append(l.id)
    # a primary that is not among the given leads (the person ticked a colleague): it gets the chain, never the colleague
    for _cid, ordered in groups.items():
        if ordered and ordered[0].id not in primaries and any(x.id in lead_ids for x in ordered):
            primaries.append(ordered[0].id)
    s.commit()
    return {"primaries": list(dict.fromkeys(primaries)), "held": held}


def start_chains_run(campaign_id: int, lead_ids: list[int], *, ask=None, background: bool = True) -> dict:
    from . import progress
    with Session(get_engine()) as s:
        camp = s.get(MetroCampaign, campaign_id)
        tg = targets(s, camp, lead_ids)
    ids = tg["primaries"]
    if not ids:
        return {"started": False, "reason": "no lead to write for (every one is held, stopped or not usable)", "held": len(tg["held"])}
    with ChainsRun.lock:
        if ChainsRun.state.get("running"):
            return {"started": False, "reason": "a run is already going"}
        ChainsRun.stop_flag.clear()
        rid = progress.start("chains", "Writing chains", total=len(ids), campaign_id=campaign_id, stop=stop_chains)
        ChainsRun.state = {"running": True, "campaign_id": campaign_id, "total": len(ids), "done": 0, "failed": 0, "ok": 0,
                           "issues": 0, "skipped": 0, "held": len(tg["held"]), "log": [], "progress_id": rid}

    def work():
        st = ChainsRun.state
        try:
            for lid in ids:
                if ChainsRun.stop_flag.is_set():
                    st["stopped"] = True
                    break
                with Session(get_engine()) as s:
                    lead, camp = s.get(MetroLead, lid), s.get(MetroCampaign, campaign_id)
                    progress.update(rid, current=" - ".join(x for x in (lead.full_name, lead.company_name) if x) or str(lid), step="writing the chain")
                    try:
                        r = write_chain(s, lead, camp, ask=ask)
                        if not r.get("written"):
                            st["skipped"] += 1
                        elif r.get("ok"):
                            st["ok"] += 1
                        else:
                            st["issues"] += 1
                    except Exception as e:
                        s.rollback()
                        st["failed"] += 1
                        st["log"] = (st["log"] + [{"lead_id": lid, "error": f"{type(e).__name__}: {e}"[:200]}])[-20:]
                st["done"] += 1
                progress.update(rid, done=st["done"], failed=st["failed"])
        finally:
            st["running"] = False
            from . import lines as _lines
            progress.finish(rid, _lines.line(f"Chains for {_lines.plural(st['done'], 'lead')}" + (" (stopped)" if st.get("stopped") else ""),
                                             _lines.part(st["ok"], "ready to review", "ready to review"),
                                             _lines.part(st["issues"], "with issues", "with issues"),
                                             _lines.part(st["held"], "colleague held", "colleagues held", "(same company)"),
                                             _lines.part(st["skipped"], "skipped", "skipped"),
                                             _lines.part(st["failed"], "failed", "failed")),
                            "stopped" if st.get("stopped") else "done")

    if background:
        threading.Thread(target=work, name="metro-chains", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(ids), "held": len(tg["held"]), "progress_id": rid}
