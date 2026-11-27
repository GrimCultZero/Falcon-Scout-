"""The chain writer (METRO_PLAN.md Phase 3, rebuilt in P3b on 27 Nov 2026 in DevScout's WAVE shape): one lead per call through /claude.

CODE plans, the model writes, CODE enforces and checks (decision "Chain shape", 27 Nov, supersedes "touches = distinct hooks"):
  * the account: a company is one account; only its primary contact gets a wave (accounts.py), the others are held;
  * the ANGLE: one per agency, chosen by code from the hooks (the code-derived service gap and the client niche first) and carried
    through the whole wave; only 2-3 real facts in the WHOLE wave: F1 in the hook email, F2 in the approach, F3 as the close's
    anchor. The other messages add an argument (what it usually means, the approach, a practical tip), never a new recited fact.
    The ledger marks those 2-3 hooks used by their touches, so the next wave (60-90 days later, Phase 6) needs NEW facts;
  * the WAVE (DevScout wave-3e-v1 / wave-4e-v1, writing.wave_steps): connected on LinkedIn = LinkedIn intro + 3-4 emails + a LinkedIn
    pointer to the email; not connected = the same wave by email only; invited and not accepted = the email wave now and the
    LinkedIn intro only after the acceptance (`ensure_intro`). 3 emails when the angle has 2-3 usable facts, 4 when 4+;
  * the LinkedIn intro and the pointer are BUILT by code (writing.build_intro / build_pointer); the model writes the emails only;
  * the human voice is made true by code after the reply (writing.apply_rules), then the checks run (chaincheck.py + writing.lint_wave);
    a failing wave shows "Do not send as is";
  * the case link: matched by code on the agency's client NICHE and the SERVICE we pitch (cases.best_match), or picked by hand
    ("Change case"), and attached by code under the approach email; the model only refers to it in a few words.
English only. Nothing here sends anything: Phase 4/5 send, only after Approve (or "Send anyway", with its date).
"""
from __future__ import annotations

import json
import re
import threading
from typing import Callable

from sqlalchemy.orm import Session

from . import accounts, aiclient, cases, chaincheck, writing
from . import evidence as evm
from . import hooks as hk
from .db import MetroCampaign, MetroCaseLink, MetroCompany, MetroHook, MetroLead, MetroTouch, get_engine, get_setting, utcnow
from .emailfinder import email_sendable

FOUR_EMAILS_FROM = 4          # usable facts for a 4-email wave (3 emails with 2-3)
WAVE_VERSION = 2              # P3b: the wave shape (P3's chains were version 1)

# What a message may say about IT Force (Oleh, 27 Nov). Its numbers are the only numbers a message may carry besides the hooks'.
ITFORCE_FACTS = ("IT Force: Google Ads, SEO and web development, working since 2015. For agencies we're the behind-the-scenes "
                 "(white-label) Google Ads and SEO team: the work goes out under the agency's name and we never contact their "
                 "client. A European time zone, so a North American agency gets the work done overnight. We already work behind "
                 "a few agencies (say only that, vaguely). Never say where the team is from.")
ITFORCE_FACTS_NICHE = ("IT Force: Google Ads, SEO and web development, working since 2015, for businesses like theirs. A free "
                       "mini-audit is the offer. Never say where the team is from.")
ITFORCE_NUMBERS = {"2015"}

# The order in which a hook kind makes a good angle fact (the service gap and the client niche first, Oleh 27 Nov).
KIND_RANK = ["service_gap", "clients_niche", "case_study", "services", "partner_badge", "geography", "agency_age", "team_size",
             "runs_ads", "hiring", "reviews", "public_voice", "founder_background",
             "site_tracking", "site_booking", "site_pages", "site_content", "site_speed"]
NO_FACT_KINDS = {"role"}       # the intro says the role; it is not a fact to recite
# A hook that is their positioning line in their own words ("They position themselves as ...") is never a fact to recite: the
# scratch run of 27 Nov wrote closes that read it back to them. It still informs the angle (what they sell).
POSITIONING = re.compile(r"\bposition(?:s|ing)?\s+(?:themselves|itself)\b|\bpositioning\b|\btagline\b|\bdescribes? (?:themselves|itself)\b|"
                         r"\b(?:calls?|brands?) (?:themselves|itself)\b|'[^']{12,}'|\"[^\"]{12,}\"|“[^”]{12,}”", re.I)
# Words in a services / case hook that mean they already sell paid search (or might: "paid advertising" can be social)
SELLS_PAID_SEARCH = re.compile(r"google ads|\bppc\b|pay[- ]per[- ]click|paid search|search engine marketing|\bsem\b|performance max|\bpmax\b|"
                               r"adwords|paid advertising|digital advertising|paid media", re.I)


def track_of(lead: MetroLead) -> tuple[str, str | None]:
    """(track, waiting reason or None). linkedin_first = the connected wave (intro + emails + pointer); email_first = by email."""
    if lead.invite_status == "connected":
        if email_sendable(lead):
            return "linkedin_first", None
        return "linkedin_first", "the LinkedIn intro can go now; the emails wait for an email address"
    if email_sendable(lead):
        return "email_first", None
    if lead.invite_status == "invited":
        return "email_first", "needs an email address (none found yet); the LinkedIn intro goes after the acceptance"
    return "email_first", "needs an email address (none found yet) or a LinkedIn connection"


def plan(lead: MetroLead, n_facts: int) -> dict:
    """The touches (step, job, channel, day ...) of this lead's wave. Pure."""
    track, waiting = track_of(lead)
    four = n_facts >= FOUR_EMAILS_FROM
    steps = writing.wave_steps(linkedin=track == "linkedin_first", four=four)
    approach = next(s["step"] for s in steps if s["job"] == "approach")
    return {"track": track, "waiting": waiting, "four": four, "steps": steps, "case_step": approach, "version": WAVE_VERSION,
            "intro_on_accept": lead.invite_status == "invited"}


def available_hooks(s: Session, lead: MetroLead, segment: str) -> list[MetroHook]:
    """The hooks this lead's wave may use: its ledger hooks not used by any touch (a touch of THIS lead's draft is freed before
    rewriting), and for agency campaigns not of a kind refused for agencies."""
    out = []
    for h in hk.hooks_query(s, lead).order_by(MetroHook.scope.asc(), MetroHook.id).all():
        if h.used_touch_id is not None:
            t = s.get(MetroTouch, h.used_touch_id)
            mine_draft = t is not None and t.lead_id == lead.id and t.status == "draft" and t.approved_at is None and t.send_anyway_at is None
            if not mine_draft:
                continue
        if segment == "agency" and hk.agency_hook_refusal(h.fact, h.kind, [p.strip() for p in (h.source_field or "").split(",")]):
            continue
        out.append(h)
    return out


def usable_facts(hooks_: list[MetroHook]) -> list[MetroHook]:
    """Hooks a message may recite, best first: no vanity numbers about the person, no bare role; company facts before person facts."""
    out = [h for h in hooks_ if (hk.resolve_kind(h.kind, [p.strip() for p in (h.source_field or "").split(",")]) or "") not in NO_FACT_KINDS
           and not writing.VANITY.search(h.fact or "") and not POSITIONING.search(h.fact or "")]

    def rank(h):
        k = hk.resolve_kind(h.kind, [p.strip() for p in (h.source_field or "").split(",")]) or ""
        return (KIND_RANK.index(k) if k in KIND_RANK else len(KIND_RANK), 0 if (h.scope or "person") == "company" else 1, h.id)
    return sorted(out, key=rank)


def pick_facts(hooks_: list[MetroHook]) -> list[MetroHook]:
    """F1, F2, F3: the angle fact, then a second fact of another kind (the client niche when F1 is the gap), then the close's anchor."""
    facts = usable_facts(hooks_)
    if not facts:
        return []
    kind = lambda h: hk.resolve_kind(h.kind, [p.strip() for p in (h.source_field or "").split(",")]) or ""  # noqa: E731
    f1 = facts[0]
    rest = [h for h in facts if h.id != f1.id]
    f2 = next((h for h in rest if kind(h) != kind(f1)), rest[0] if rest else None)
    picked = [f1] + ([f2] if f2 else [])
    rest = [h for h in facts if h.id not in {x.id for x in picked}]
    f3 = next((h for h in rest if kind(h) not in {kind(x) for x in picked}), rest[0] if rest else None)
    return picked + ([f3] if f3 else [])


def _scan(company: MetroCompany | None) -> dict:
    if company is None or not company.website_scan_json:
        return {}
    try:
        d = json.loads(company.website_scan_json)
        return d if isinstance(d, dict) and d.get("ok") else {}
    except ValueError:
        return {}


def angle_of(company: MetroCompany | None, lead: MetroLead, facts: list[MetroHook], segment: str,
             all_hooks: list[MetroHook] | None = None) -> dict:
    """The ONE angle of the wave, by code: what they sell (and the gap we fill), whom they serve, what we pitch. The gap is the
    scan's (service pages and headings) unless a services / case hook names paid search or SEO (scratch run, 27 Nov: Baal & Spots
    lists "Search engine marketing" and publishes a 4x ROAS case, so "no paid search" was wrong)."""
    scan = _scan(company)
    fams = evm.service_families([str(x) for x in scan.get("services") or []])
    have_ppc, have_seo = "paid search / Google Ads" in fams, "SEO" in fams
    sells_text = " | ".join(h.fact or "" for h in (all_hooks or facts) if (h.kind or "") in ("services", "case_study", "partner_badge", "runs_ads"))
    if SELLS_PAID_SEARCH.search(sells_text):
        have_ppc = True
    if re.search(r"\bseo\b|search engine optimi", sells_text, re.I):
        have_seo = True
    gap = evm.service_gap(scan) if scan else None
    if len(scan.get("services") or []) >= 3 and not have_ppc:
        service, services = "Google Ads", {"ppc"}
    elif len(scan.get("services") or []) >= 3 and not have_seo and have_ppc:
        service, services = "SEO", {"seo"}
    else:
        service, services = "Google Ads and SEO", {"ppc", "seo"}
    niche_hooks = [h.fact for h in facts if (h.kind or "") == "clients_niche"]
    niches = list((scan.get("niches") or {}).keys()) if isinstance(scan.get("niches"), dict) else []
    for n in cases.niches_in_text(*niche_hooks, " ".join(str(x) for x in scan.get("industries") or []), company.industry if company else ""):
        if n not in niches:
            niches.append(n)
    niches = [n for n in niches if n in cases.NICHE_TAGS]
    niche = niches[0] if niches else None
    name = (company.name if company else None) or lead.company_name or "they"
    sells = writing.business_phrase(fams)
    if segment != "agency":
        text = f"{name} could use more from Google Ads and SEO for its own business; we offer a free mini-audit."
    else:
        if service == "Google Ads and SEO":
            text = (f"{name} already sells {sells}" + (f" to clients in {niche}" if niche else "")
                    + "; we can be extra Google Ads and SEO capacity behind them, as their behind-the-scenes team, under their name.")
        else:
            text = (f"{name} sells {sells} but no {'paid search' if service == 'Google Ads' else 'SEO'}"
                    + (f" and serves clients in {niche}" if niche else "")
                    + f"; we can add {service} for those clients as their behind-the-scenes team, under their name.")
    return {"text": text, "gap": gap, "service": service, "services": sorted(services), "niche": niche, "niches": niches[:4],
            "families": fams, "sells": sells}


def _brief(campaign) -> dict:
    try:
        return json.loads(campaign.brief_json) if campaign.brief_json else {}
    except ValueError:
        return {}


def _leadins(facts: list[MetroHook], seed: int) -> list[str]:
    """One observation lead-in per fact, picked by the kind of fact, never the same word twice in the wave."""
    used, out = set(), []
    for i, h in enumerate(facts):
        k = hk.resolve_kind(h.kind, [p.strip() for p in (h.source_field or "").split(",")]) or "services"
        pool = writing.LEADINS["followup"] if i == 2 else writing.LEADINS.get(k, writing.LEADINS["services"])
        pickd = next((x for j in range(len(pool)) for x in [writing.pick(pool, seed, j)] if x.split(" ")[0] not in used), pool[0])
        used.add(pickd.split(" ")[0])
        out.append(pickd)
    return out


PROMPT = """You write ONE wave of short outreach emails from {sender} at IT Force to one person.

ABOUT IT FORCE (the only claims you may make about us): {itforce}
CAMPAIGN: {segment_line}
THE OFFER (in the approach email only, never with a price): {offer}
DO NOT CLAIM: {do_not_claim}

THE PERSON: {first} ({full}), {title} at {company}.
THE ANGLE (chosen by code; carry it through every email, never a second angle): {angle}
THEIR CLIENTS, for the tip: {niche}
FACTS (the ONLY facts about them you may state, each exactly once, in the email named; say it in your own words):
{facts}
THE WAVE (fixed by code; write exactly these emails, in this order; the LinkedIn intro and the LinkedIn pointer are built by
code, do not write them):
{jobs}
{case_line}

{style}

Answer with JSON only:
{{"angle_check": {{"verdict": "ok", "note": "one line: does any fact contradict the angle? (verdict ok | flag)"}},
  "touches": [{{"job": "hook", "subject": "...", "body": "Hi {first},\\n\\n...\\n\\n{sender}"}}, {{"job": "approach", "subject": null, "body": "..."}}]}}"""


def build_prompt(s: Session, lead: MetroLead, campaign: MetroCampaign, ctx: dict) -> str:
    brief = _brief(campaign)
    seg = ctx["segment"]
    sender = ctx["sender"]
    facts_txt = []
    for i, (h, lead_in) in enumerate(zip(ctx["facts"], ctx["leadins"])):
        where = ["the hook email", "the approach email", "the close (one short clause as its anchor)"][i]
        if i == 2 and not ctx["plan"]["four"]:
            continue
        facts_txt.append(f"F{i + 1} ({h.kind or 'fact'}): {h.fact}  ->  {where}, opened with \"{lead_in} ...\"")
    if len(ctx["facts"]) < 2:
        facts_txt.append("(no second fact: the approach opens on the angle in new words instead, with no new fact)")
    jobs = []
    for st in ctx["plan"]["steps"]:
        if st["job"] in ("intro", "pointer"):
            continue
        job = writing.WAVE_JOBS[st["job"]].replace("{niche}", ctx["angle"]["niche"] or "the clients they serve")
        job = job.replace("{case}", "The case link is attached by code under this email: refer to it in a few plain words "
                          "(\"here's a similar project of ours\"), by its title only." if ctx["case"] else "No case is attached: do not mention one.")
        name = "value" if st["job"] in ("value", "value4") else st["job"]
        jobs.append(f"  {name} ({'reply in the same thread, NO subject' if st.get('reply') else 'NEW thread, write a subject'}): {job}")
    case_line = ""
    if ctx["case"]:
        case_line = (f"CASE (attached by code under the approach email): \"{ctx['case']['title']}\". Never say for whom or how it was "
                     f"delivered and never quote its numbers.")
    seg_line = ("agency: we would be their behind-the-scenes Google Ads and SEO team for THEIR clients, under their name. Never "
                "audit their own website." if seg == "agency" else
                "niche: a direct client who could hire IT Force for their own Google Ads, SEO or website.")
    return PROMPT.format(
        sender=sender, itforce=brief.get("about_us") or (ITFORCE_FACTS if seg == "agency" else ITFORCE_FACTS_NICHE), segment_line=seg_line,
        offer=campaign.offer or ("send us one client you're struggling to deliver for and we'll scope it, or start with a free pilot audit"
                                 if seg == "agency" else "a free mini-audit"),
        do_not_claim="; ".join(str(x) for x in brief.get("do_not_claim") or []) or "none",
        first=ctx["first"] or "there", full=lead.full_name or "", title=lead.title or "", company=ctx["company"],
        angle=ctx["angle"]["text"], niche=ctx["angle"]["niche"] or "not known: give a tip that fits the clients an agency like theirs usually serves",
        facts="\n".join(facts_txt) or "(none)", jobs="\n".join(jobs), case_line=case_line, style=writing.style_rules_text(sender))


def wave_context(s: Session, lead: MetroLead, campaign: MetroCampaign) -> dict:
    """Everything the wave is built from (reads only)."""
    seg = hk.segment_of(campaign)
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    hooks_ = available_hooks(s, lead, seg)
    facts = pick_facts(hooks_)
    p = plan(lead, len(usable_facts(hooks_)))
    if not p["four"]:
        facts = facts[:2]
    angle = angle_of(company, lead, facts, seg, all_hooks=hooks_)
    case = None
    if lead.case_choice_id:
        c = s.get(MetroCaseLink, lead.case_choice_id)
        case = cases.case_dict(c) if c else None
    if case is None:
        case = cases.best_match(s, angle["niches"], set(angle["services"]))
    seed = lead.id or 0
    company_name = (company.name if company else None) or lead.company_name or ""
    first = lead.first_name or (lead.full_name or "").split(" ")[0]
    scan = _scan(company)
    taglines = [x for x in (scan.get("title"), scan.get("meta_description"), scan.get("h1")) if x]
    return {"segment": seg, "company_obj": company, "company": company_name, "first": first, "hooks": hooks_, "facts": facts,
            "leadins": _leadins(facts, seed), "plan": p, "angle": angle, "case": case, "seed": seed, "taglines": taglines,
            "sender": str(get_setting(s, "sender_name", "Artem") or "Artem")}


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


def _jobs_of(notes: dict) -> dict[int, dict]:
    return {int(x["step"]): x for x in (notes.get("plan") or {}).get("steps", [])}


def recheck(s: Session, lead: MetroLead, campaign: MetroCampaign) -> dict:
    """Run the checks again over the stored wave (after an edit, or when the panel opens) and store the results."""
    touches = s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle,
                                         MetroTouch.status != "cancelled").order_by(MetroTouch.step).all()
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    brief = _brief(campaign)
    jobs = _jobs_of(notes)
    seg = hk.segment_of(campaign)
    first = lead.first_name or (lead.full_name or "").split(" ")[0]
    sender = str(get_setting(s, "sender_name", "Artem") or "Artem")
    tl = [{"step": t.step, "channel": t.channel, "subject": t.subject, "body": _model_text(t), "hook_ids": json.loads(t.hook_ids_json or "[]"),
           "job": (jobs.get(t.step) or {}).get("job"), "reply": bool((jobs.get(t.step) or {}).get("reply")),
           "day": t.day, "after_step": (jobs.get(t.step) or {}).get("after_step"), "leadin": (jobs.get(t.step) or {}).get("leadin"),
           "company": lead.company_name} for t in touches]
    hook_steps = [x["step"] for x in tl if x["job"] == "hook"] if notes.get("plan", {}).get("version") == WAVE_VERSION else None
    res = chaincheck.check_chain(tl, lead_first=first, hooks=ledger_view(s, lead), other_leads_used=used_by_others(s, lead), segment=seg,
                                 allowed_numbers=ITFORCE_NUMBERS | set(notes.get("allowed_numbers") or []),
                                 plan_channels=[x["channel"] for x in sorted(jobs.values(), key=lambda x: x["step"])] if jobs else None,
                                 do_not_claim=[str(x) for x in brief.get("do_not_claim") or []],
                                 base_chain=bool((notes.get("plan") or {}).get("base")), require_hook_steps=hook_steps)
    if notes.get("plan", {}).get("version") == WAVE_VERSION:
        niche_words = [notes.get("niche") or "", notes.get("service") or ""] + [w for n in [notes.get("niche") or ""] for w in cases.NICHE_TAGS.get(n, [])]
        lint = writing.lint_wave(tl, names=[first, lead.last_name or "", lead.company_name or "", sender], tagline_texts=notes.get("taglines") or [],
                                 sender=sender, keep_words=niche_words)
        for x in res["touches"]:
            seen = {f["text"] for f in x["flags"]}
            for f in lint["by_step"].get(x["step"], []):
                if f["text"] not in seen:
                    x["flags"].append(f)
                    seen.add(f["text"])
            x["ok"] = not x["flags"]
        res["flags"] = res["flags"] + lint["chain"]
        if notes.get("angle_flag"):
            res["flags"].append({"rule": "angle", "text": f"the model says a fact may contradict the angle: {notes['angle_flag']}"})
        for m in notes.get("missing_steps") or []:
            res["flags"].append({"rule": "missing", "text": f"the model left out step {m}"})
        res["ok"] = not res["flags"] and all(x["ok"] for x in res["touches"])
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
    """DevScout's contractions on prose (writing.humanize), never inside quotes or URLs."""
    return writing.humanize(text)


def clean_text(text: str) -> str:
    t = str(text or "").replace("\r\n", "\n").strip()
    t = re.sub(r"[ \t]+\n", "\n", t)
    return humanize(t)


def clear_chain(s: Session, lead: MetroLead) -> int:
    """Remove the lead's DRAFT touches (not approved, not sent) and free their hooks."""
    n = hk._clear_drafts(s, [lead.id])
    lead.chain_approved_at = None
    return n


def _subject_of(steps: list[dict], got: dict, job: str) -> str | None:
    t = got.get(job) or {}
    return str(t.get("subject") or "").strip() or None


def write_chain(s: Session, lead: MetroLead, campaign: MetroCampaign, *, ask: Callable[..., str] | None = None) -> dict:
    """Write ONE lead's wave: plan, angle and facts by code, one model call for the emails, intro and pointer built, the voice
    enforced, the checks run. Never touches an approved or sent touch."""
    ask = ask or aiclient.ask
    if lead.status != "new" or lead.stopped_reason:
        return {"lead_id": lead.id, "written": False, "reason": f"not usable ({lead.stopped_reason or lead.status})"}
    accounts.assign(s, [lead])
    if lead.account_role == "held":
        s.commit()
        return {"lead_id": lead.id, "written": False, "reason": "held: same company as the primary contact", "primary_lead_id": lead.primary_lead_id}
    if s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.status.in_(("scheduled", "sent", "unconfirmed"))).count():
        s.commit()
        return {"lead_id": lead.id, "written": False, "reason": "its chain is already sending"}
    if lead.chain_approved_at is not None:
        s.commit()
        return {"lead_id": lead.id, "written": False, "reason": "its chain is approved (unapprove it to write it again)"}
    ctx = wave_context(s, lead, campaign)
    if not ctx["facts"]:
        old = json.loads(lead.chain_json or "{}").get("plan", {}).get("version") if lead.chain_json else None
        removed = clear_chain(s, lead) if lead.chain_written_at and old != WAVE_VERSION else 0
        s.commit()
        return {"lead_id": lead.id, "written": False, "reason": "no usable hooks for one angle (write hooks first)"
                + (f"; its old P3 draft ({removed} touches) was removed" if removed else "")}
    prompt = build_prompt(s, lead, campaign, ctx)
    s.commit()                                   # P3b #3: no transaction stays open across the model call
    data = aiclient.parse_json(ask(prompt, model=aiclient.SONNET, max_tokens=6000, kind="metro_chain"))
    if not isinstance(data, dict) or not isinstance(data.get("touches"), list):
        raise aiclient.AIError("unexpected answer shape")
    got: dict[str, dict] = {}
    for t in data["touches"]:
        if isinstance(t, dict) and t.get("job"):
            j = str(t["job"]).strip().lower()
            got.setdefault("value" if j in ("value", "value4", "tip") else j, t)
    p, seg, first, company = ctx["plan"], ctx["segment"], ctx["first"], ctx["company"]
    steps = p["steps"]
    # the emails, as the model wrote them, then the deterministic rules
    fact_of = {"hook": 0, "approach": 1, "close": 2}
    leadin_of = {"hook": ctx["leadins"][0] if ctx["leadins"] else None,
                 "approach": ctx["leadins"][1] if len(ctx["leadins"]) > 1 else None}
    items, missing = [], []
    for st in steps:
        if st["channel"] != "email":
            continue
        key = "value" if st["job"] in ("value", "value4") else st["job"]
        t = got.get(key)
        if t is None:
            missing.append(st["step"])
            continue
        items.append({"step": st["step"], "job": st["job"], "channel": "email", "reply": st.get("reply"), "leadin": leadin_of.get(key),
                      "subject": None if st.get("reply") else (str(t.get("subject") or "").strip() or None), "body": str(t.get("body") or "")})
    proper = writing.proper_words(*(h.fact for h in ctx["facts"])) | {company, *company.split(" "), first} - {""}
    case_title = ctx["case"]["title"] if ctx["case"] else None
    items = writing.apply_rules(items, first=first, company=company, seed=ctx["seed"], sender=ctx["sender"],
                                protect_extra=[case_title] if case_title else [], proper=proper)
    by_step = {x["step"]: x for x in items}
    # intro and pointer: BUILT by code
    value = next((x for x in items if x["job"] in ("value", "value4")), None)
    notes_issues = []
    for st in steps:
        if st["job"] == "intro":
            b = writing.build_intro(first=first, title=lead.title, company=company, families=ctx["angle"]["families"], seed=ctx["seed"], segment=seg)
            if b["text"]:
                by_step[st["step"]] = {"step": st["step"], "job": "intro", "channel": "linkedin", "subject": None, "body": b["text"]}
            else:
                missing.append(st["step"])
                notes_issues.append(f"the intro could not be built (no {', '.join(b['missing'])})")
        elif st["job"] == "pointer":
            b = writing.build_pointer(first=first, subject=value["subject"] if value else None, company=company, seed=ctx["seed"])
            by_step[st["step"]] = {"step": st["step"], "job": "pointer", "channel": "linkedin", "subject": None, "body": b["text"]}
            if b["generic"]:
                notes_issues.append("the pointer's topic is generic (the value email has no usable subject)")
    # store: the old draft goes only now, after the model answered (an error above leaves the old draft as it was)
    clear_chain(s, lead)
    s.flush()
    # _clear_drafts frees the hooks with a bulk UPDATE the session does not see, and SQLite reuses the deleted touch ids: without
    # this, a hook whose old and new touch share an id looks unchanged and stays NULL (the ledger loses the fact; found in P3b)
    s.expire_all()
    now = utcnow()
    for st in steps:
        x = by_step.get(st["step"])
        if x is None:
            continue
        st["leadin"] = x.get("leadin")
        fi = fact_of.get(st["job"])
        hook_ids = [ctx["facts"][fi].id] if fi is not None and fi < len(ctx["facts"]) and not (st["job"] == "close" and not p["four"]) else []
        attach = ctx["case"] if st["step"] == p["case_step"] else None
        body = x["body"]
        row = MetroTouch(lead_id=lead.id, cycle=lead.current_cycle, step=st["step"], channel=st["channel"], subject=x.get("subject"),
                         body=_with_case(body, st["channel"], attach), model_body=body, day=st["day"], status="draft",
                         hook_ids_json=json.dumps(hook_ids), case_link_id=attach["id"] if attach else None)
        s.add(row)
        s.flush()
        for hid in hook_ids:                       # the ledger: this touch holds this fact now
            h = s.get(MetroHook, hid)
            if h is not None:
                h.used_touch_id = row.id
    ac = data.get("angle_check") if isinstance(data.get("angle_check"), dict) else {}
    angle_flag = str(ac.get("note") or "")[:200] if str(ac.get("verdict") or "").lower() == "flag" else None
    lead.chain_track = p["track"]
    lead.chain_written_at = now
    lead.chain_approved_at = None
    lead.chain_json = json.dumps({"plan": p, "angle": ctx["angle"]["text"], "niche": ctx["angle"]["niche"], "service": ctx["angle"]["service"],
                                  "facts": [{"id": h.id, "kind": h.kind, "fact": h.fact} for h in ctx["facts"]],
                                  "case": ctx["case"], "case_by_hand": bool(lead.case_choice_id and ctx["case"]),
                                  "case_note": None if ctx["case"] else "no IT Force case matches their client niche and the service: pick one with Change case",
                                  "missing_steps": missing, "hooks_offered": len(ctx["hooks"]), "angle_flag": angle_flag,
                                  "issues": notes_issues, "taglines": ctx["taglines"],
                                  "written_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}, ensure_ascii=False)
    s.flush()
    res = recheck(s, lead, campaign)
    s.commit()
    return {"lead_id": lead.id, "written": True, "touches": len([x for x in steps if x["step"] in by_step]), "ok": res["ok"],
            "track": p["track"], "waiting": p["waiting"], "emails": 4 if p["four"] else 3}


def ensure_intro(s: Session, lead: MetroLead) -> bool:
    """Invited and not accepted when the wave was written: once the person ACCEPTS, the LinkedIn intro (built by code, no model
    call) joins the wave as step 0, "on acceptance". Never while the wave is sending; a chain that was approved needs a new
    Approve (the intro is a new message). True when it added one."""
    if lead.invite_status != "connected" or not lead.chain_json:
        return False
    notes = json.loads(lead.chain_json or "{}")
    p = notes.get("plan") or {}
    if p.get("version") != WAVE_VERSION or not p.get("intro_on_accept"):
        return False
    ts = s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle, MetroTouch.status != "cancelled").all()
    if any(t.channel == "linkedin" for t in ts) or any(t.status in ("scheduled", "sent", "unconfirmed") for t in ts):
        return False
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    first = lead.first_name or (lead.full_name or "").split(" ")[0]
    fams = evm.service_families([str(x) for x in _scan(company).get("services") or []])
    camp = s.get(MetroCampaign, lead.campaign_id) if lead.campaign_id else None
    b = writing.build_intro(first=first, title=lead.title, company=(company.name if company else lead.company_name) or "", families=fams,
                            seed=lead.id or 0, segment=hk.segment_of(camp) if camp else "agency")
    if not b["text"]:
        return False
    s.add(MetroTouch(lead_id=lead.id, cycle=lead.current_cycle, step=0, channel="linkedin", body=b["text"], model_body=b["text"], day=None,
                     status="draft", hook_ids_json="[]"))
    p["steps"] = [{"step": 0, "job": "intro", "channel": "linkedin", "day": None, "on_accept": True}] + [x for x in p.get("steps", []) if x.get("step") != 0]
    p["intro_on_accept"] = False
    notes["plan"] = p
    lead.chain_json = json.dumps(notes, ensure_ascii=False)
    lead.chain_approved_at = None
    s.flush()
    if camp is not None:
        recheck(s, lead, camp)
    return True


def set_case(s: Session, lead: MetroLead, case_id: int | None) -> dict:
    """"Change case": the chosen case goes under the approach email now (a draft only) and is kept for later rewrites.
    case_id None = back to the automatic match."""
    if case_id is not None and s.get(MetroCaseLink, case_id) is None:
        raise ValueError("no such case")
    lead.case_choice_id = case_id
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    jobs = _jobs_of(notes)
    approach = next((t for t in s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle,
                                                           MetroTouch.status == "draft").all()
                     if (jobs.get(t.step) or {}).get("job") == "approach"), None)
    case = None
    if case_id is not None:
        case = cases.case_dict(s.get(MetroCaseLink, case_id))
    elif notes:
        camp = s.get(MetroCampaign, lead.campaign_id)
        ctx_case = wave_context(s, lead, camp)["case"] if camp is not None else None
        case = ctx_case
    if approach is not None:
        if approach.approved_at is not None:
            raise ValueError("the approach email is approved: unapprove the chain to change its case")
        text = _model_text(approach)
        approach.body = _with_case(text, approach.channel, case)
        approach.case_link_id = case["id"] if case else None
        notes["case"] = case
        notes["case_by_hand"] = case_id is not None
        notes["case_note"] = None if case else "no IT Force case matches their client niche and the service: pick one with Change case"
        lead.chain_json = json.dumps(notes, ensure_ascii=False)
    s.commit()
    return {"case": case, "attached": approach is not None}


def case_options(s: Session, lead: MetroLead) -> dict:
    """The "Change case" picker: the cases matching the agency's client niche and the service first, then all the others."""
    camp = s.get(MetroCampaign, lead.campaign_id) if lead.campaign_id else None
    seg = hk.segment_of(camp) if camp else "agency"
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    facts = pick_facts(available_hooks(s, lead, seg) + [h for h in hk.hooks_query(s, lead).all() if h.used_touch_id is not None])
    angle = angle_of(company, lead, facts, seg, all_hooks=list(hk.hooks_query(s, lead).all()))
    ranked = cases.match_cases(s, angle["niches"], set(angle["services"]))
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    cur = (notes.get("case") or {}).get("id")
    return {"niches": angle["niches"], "service": angle["service"], "current_id": cur, "by_hand": bool(lead.case_choice_id),
            "matching": [r for r in ranked if r["niche_match"] and r["service_match"]],
            "others": [r for r in ranked if not (r["niche_match"] and r["service_match"])]}


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
        raise ValueError("the chain fails its checks (Do not send as is): fix it, or use Send anyway")
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
        return {"state": "issues", "label": f"Do not send as is ({len(ts)} touches)", "touches": len(ts)}
    return {"state": "written", "label": f"written {len(ts)} touches", "touches": len(ts)}


def touch_dict(s: Session, t: MetroTouch, ledger: dict[int, dict], jobs: dict[int, dict] | None = None) -> dict:
    ids = json.loads(t.hook_ids_json or "[]")
    job = (jobs or {}).get(t.step) or {}
    case = None
    if t.case_link_id:
        c = s.get(MetroCaseLink, t.case_link_id)
        case = cases.case_dict(c) if c else None
    return {"id": t.id, "step": t.step, "channel": t.channel, "day": t.day, "subject": t.subject, "body": t.body,
            "text": _model_text(t), "hook_ids": ids, "hooks": [ledger[i]["fact"] for i in ids if i in ledger],
            "checks": json.loads(t.checks_json or "[]"), "checks_passed": bool(t.checks_passed), "status": t.status,
            "approved_at": t.approved_at.isoformat() if t.approved_at else None,
            "send_anyway_at": t.send_anyway_at.isoformat() if t.send_anyway_at else None,
            "edited": t.edited_at is not None, "case": case, "job": job.get("job"), "reply": bool(job.get("reply")),
            "after_step": job.get("after_step"), "working_days_after": job.get("working_days_after"), "on_accept": bool(job.get("on_accept"))}


def chain_view(s: Session, lead: MetroLead) -> dict:
    ts = s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle,
                                    MetroTouch.status != "cancelled").order_by(MetroTouch.step).all()
    ledger = ledger_view(s, lead)
    notes = json.loads(lead.chain_json or "{}") if lead.chain_json else {}
    jobs = _jobs_of(notes)
    notes.pop("taglines", None)
    return {"status": chain_status(s, lead, ts), "track": lead.chain_track, "notes": notes,
            "touches": [touch_dict(s, t, ledger, jobs) for t in ts]}


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
        rid = progress.start("chains", "Writing chains", total=len(ids), campaign_id=campaign_id, stop=stop_chains, by_click=True)
        from . import runqueue
        qid = runqueue.begin("chains", campaign_id, ids, label="Writing chains", progress_id=rid)
        progress.update(rid, queue_id=qid)
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
                runqueue.item_done(qid, lid)
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
            runqueue.end(qid, "stopped" if st.get("stopped") else "done")

    if background:
        threading.Thread(target=work, name="metro-chains", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(ids), "held": len(tg["held"]), "progress_id": rid}
