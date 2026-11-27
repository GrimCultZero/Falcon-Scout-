"""Hooks: facts about a lead's company, or about the person, that a message may use (METRO_PLAN.md Phase 2 step 7, Phase 3).

A hook is stated only when a stored field supports it, with that field's date (SEEN). The model never sees the web; it sees
numbered EVIDENCE (evidence.py: company items E1.., each person's items P1.1..) and answers with hooks that cite them. Then
CODE decides which hooks survive:

  * every hook cites at least one evidence item that exists (a person hook may cite the company's items and ITS OWN person's);
  * every number in the fact appears in the cited evidence (no invented figure, no computed one);
  * no URL, no price or currency, no hedge word, no claim about us; one sentence of reasonable length; not a duplicate;
  * its KIND is one of KINDS and allowed for the campaign's segment. For agency campaigns the "audit of their own site" kinds
    (tags, pixels, call tracking, booking, service / location pages, blog freshness, speed) are refused, by the kind, by the
    fields it cites and by its words (Phase 3, the hook review of 26 Nov). The kind code infers from the cited fields wins
    over a friendlier label the model gives.

Phase 3: hooks are per COMPANY, written ONCE and shared by every lead of that company (scope `company`, lead_id NULL), and
per PERSON from the person's own data (scope `person`). One model call per company covers the company and the leads asked
for. What survives goes to the ledger (`metro_hooks`). Hooks used by a touch that is approved or sent stay; unused ones are
replaced, and a draft chain that used them is cleared (it was written from the old hooks).
"""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime
from typing import Callable

from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import aiclient
from . import evidence as evm
from .db import MetroCampaign, MetroCaseLink, MetroCompany, MetroHook, MetroLead, MetroTouch, get_engine, utcnow

HEDGES = re.compile(r"\b(probably|likely|maybe|perhaps|might|may be|seems?|appears?|presumably|i assume|i guess|could be|"
                    r"suggests? that|i noticed that you|i saw that you)\b", re.I)
# A conclusion the evidence does not state (26 Nov run: "hiring a paid search specialist, so paid search demand is growing").
INFERENCE = re.compile(r",?\s+so (?:they|their|it|its|the|paid|demand|there)\b|\bwhich (?:means|suggests|shows|indicates)\b|"
                       r"\bindicat(?:es|ing) that\b|\bimplies\b|\bthey must\b|\bthey clearly\b|\bso they are\b", re.I)
GENDERED = re.compile(r"\b(he|she|his|her|hers|him|himself|herself)\b", re.I)
URL_RX = re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ca|us|uk|de|ai|ua|eu|pl|fr|es|it|nl|au|biz|info|me|app|dev|"
                    r"agency|digital|marketing|studio|media|tech)\b", re.I)
PRICE_RX = re.compile(r"[$€£]|\b(usd|eur|gbp|cad|dollars?|euros?|pounds?|per hour|/hr|an hour|\bprice[sd]?|pricing|\bcosts?\b|\bfees?\b|\brate of|retainers?)\b", re.I)
NUM_RX = re.compile(r"\d[\d,.]*")
MAX_EVIDENCE = 60
MAX_HOOKS = 8               # per company
MAX_PERSON_HOOKS = 3        # per person

# The kinds of hook, and the segments each is allowed for. "agency" = white-label partner campaigns, "niche" = direct clients.
KINDS = {
    "service_gap":       ("What they sell and the gap IT Force fills (they sell SEO / web / social and name no paid search, or the reverse)", ("agency", "niche")),
    "services":          ("What they sell, their positioning in their own words", ("agency", "niche")),
    "clients_niche":     ("Who their clients are: a niche or business model (local services, e-commerce, B2B, medical ...), industries served, client logos", ("agency", "niche")),
    "case_study":        ("A case study or a result they publish", ("agency", "niche")),
    "partner_badge":     ("Partner badges and platforms (Google Partner, HubSpot Platinum, Shopify, Meta ...)", ("agency", "niche")),
    "geography":         ("Where they are and whom they serve (one city, nationwide, Canada / Quebec); the time-zone fit", ("agency", "niche")),
    "runs_ads":          ("They run Google ads themselves (Ads Transparency count)", ("agency", "niche")),
    "hiring":            ("They are hiring a PPC / SEO / paid-media person (careers page or LinkedIn hiring badge)", ("agency", "niche")),
    "team_size":         ("Team size, or the founder doing the delivery", ("agency", "niche")),
    "agency_age":        ("How long they have been in business (founded year)", ("agency", "niche")),
    "founder_background": ("The person's own background, from their LinkedIn summary, skills or headline", ("agency", "niche")),
    "public_voice":      ("A podcast, awards, publications or a following they have built", ("agency", "niche")),
    "reviews":           ("Their Google Business Profile rating and reviews", ("agency", "niche")),
    "role":              ("The person's role at the company", ("agency", "niche")),
    # the audit of THEIR OWN site: direct clients only (we sell agencies delivery capacity, not fixes to their site)
    "site_tracking":     ("A tag, pixel or call tracking visible or not in the page source", ("niche",)),
    "site_booking":      ("A booking tool or form on the site", ("niche",)),
    "site_pages":        ("Service or location pages on the site", ("niche",)),
    "site_content":      ("The blog and how fresh it is", ("niche",)),
    "site_speed":        ("The site's PageSpeed score or load time", ("niche",)),
}
AGENCY_FORBIDDEN = {k for k, (_d, segs) in KINDS.items() if "agency" not in segs}
# Kinds that are true only when a specific field says so (26 Nov run: "They have a careers page, so they are recruiting").
KIND_NEEDS = {
    "hiring": ("website.careers.ppc_seo_roles", "person.badge_hiring", "linkedin_company.hiring", "linkedin_company.jobs"),
    "runs_ads": ("ads.",),
    "reviews": ("gbp.",),
}
LEGACY_KINDS = {"speed": "site_speed", "tracking": "site_tracking", "content": "site_content", "site": "site_pages", "ads": "runs_ads",
                "reviews": "reviews", "team": "team_size", "role": "role", "growth": "services"}
# Words that make a hook an audit of the agency's own site, whatever kind it carries.
AGENCY_AUDIT_TEXT = re.compile(r"\b(page source|pixel|call tracking|tracking (?:tag|code)|google ads tag|tag manager|insight tag|ga4|analytics tag|"
                               r"booking (?:tool|form|widget|call-to-action)|location pages?|service pages?|newest (?:blog )?post|blog post|"
                               r"stale|outdated|dated posts?|page ?speed|mobile score|loads? slow(?:ly)?|slow (?:site|website|pages?)|site speed|"
                               r"conversion tracking)\b", re.I)


def kind_from_paths(paths: list[str]) -> str | None:
    """The kind the cited fields make a hook, when they decide it (the audit kinds, ads, reviews). None = the label decides."""
    for p in paths:
        if p.startswith("pagespeed"):
            return "site_speed"
        if p.startswith("website.signals"):
            return "site_tracking"
        if p.startswith("website.booking"):
            return "site_booking"
        if p.startswith(("website.service_pages", "website.location_pages")):
            return "site_pages"
        if p.startswith("website.blog"):
            return "site_content"
    return None


def resolve_kind(label, paths: list[str]) -> str | None:
    lab = str(label or "").strip().lower()
    lab = LEGACY_KINDS.get(lab, lab)
    forced = kind_from_paths(paths)
    if forced:
        return forced
    if lab in KINDS:
        return lab
    if any(p.startswith("ads.") for p in paths):
        return "runs_ads"
    if any(p.startswith("gbp.") for p in paths):
        return "reviews"
    return None


def _nums(text: str) -> set[str]:
    return {re.sub(r"[^\d]", "", m) for m in NUM_RX.findall(str(text)) if re.sub(r"[^\d]", "", m)}


def verify_hook(h: dict, evidence: dict[str, dict], forbidden: list[str] | None = None, segment: str | None = None) -> tuple[bool, str]:
    """(ok, why not). Pure: the code-side check that decides whether a model-written hook may be stored. `segment` (agency /
    niche) also enforces the kinds; without it only the content rules run (Phase 2 behaviour)."""
    fact = str(h.get("fact") or "").strip()
    cited = h.get("evidence")
    if not fact or len(fact) < 12 or len(fact) > 260:
        return False, "fact is empty, too short or too long"
    if not isinstance(cited, list) or not cited:
        return False, "cites no evidence"
    items = []
    for c in cited:
        it = evidence.get(str(c))
        if it is None:
            return False, f"cites {c}, which does not exist"
        items.append(it)
    for bad in forbidden or []:
        if bad and bad.lower() in fact.lower():
            return False, f"touches the campaign's do-not-claim list ({bad})"
    if URL_RX.search(fact):
        return False, "contains a URL or domain"
    if PRICE_RX.search(fact):
        return False, "mentions a price or currency"
    if HEDGES.search(fact):
        return False, "hedged or assumed wording"
    if INFERENCE.search(fact):
        return False, "draws a conclusion the evidence does not state"
    if GENDERED.search(fact):
        return False, "uses he / she; a hook says they / their"
    if re.search(r"\b(we|our|i|my)\b", fact, re.I) and re.search(r"\b(we|i) (?:can|will|offer|do)\b", fact, re.I):
        return False, "makes a claim about us instead of stating a fact about them"
    if fact.count(". ") >= 1 and not fact.endswith("."):
        return False, "more than one sentence"
    have = set()
    for it in items:
        have |= _nums(it["value"]) | _nums(it["at"] or "")
    for n in _nums(fact):
        if n not in have:
            return False, f"the number {n} is not in the cited evidence"
    if segment:
        paths = [it["path"] for it in items]
        kind = resolve_kind(h.get("kind"), paths)
        if kind is None:
            return False, f"its kind ({h.get('kind') or 'none'}) is not one of the hook kinds"
        if segment not in KINDS[kind][1]:
            return False, f"a {kind} hook is not allowed for {segment} campaigns (an audit of their own site)"
        need = KIND_NEEDS.get(kind)
        if need and not any(p.startswith(need) for p in paths):
            return False, f"a {kind} hook must rest on {' or '.join(need)} (it cites {', '.join(paths)})"
        if segment == "agency":
            if any(evm.is_agency_skipped(p) for p in paths):
                return False, "cites an audit field of their own site, not allowed for agency campaigns"
            if AGENCY_AUDIT_TEXT.search(fact):
                return False, "reads as an audit of their own site, not allowed for agency campaigns"
        h["kind"] = kind
    return True, ""


def agency_hook_refusal(fact: str, kind: str | None, paths: list[str]) -> str | None:
    """Why an already stored hook may not be used in an agency message (the chain checks call it), or None."""
    k = resolve_kind(kind, paths)
    if k in AGENCY_FORBIDDEN:
        return f"{k} hooks are not used for agency campaigns"
    if any(evm.is_agency_skipped(p) for p in paths):
        return "cites an audit field of their own site"
    if AGENCY_AUDIT_TEXT.search(fact or ""):
        return "reads as an audit of their own site"
    return None


def segment_of(campaign) -> str:
    return "agency" if getattr(campaign, "type", None) == "agency" else "niche"


def case_tags_for(s: Session, campaign) -> list[str]:
    """The tags a case may be matched by: the industry categories of the imported IT Force case pages, else the campaign's own."""
    brief = json.loads(campaign.brief_json) if getattr(campaign, "brief_json", None) else {}
    own = [str(t) for t in (brief.get("case_tags") or [])]
    if own:
        return own
    tags = set()
    for (it,) in s.query(MetroCaseLink.industry_tags).all():
        for t in (it or "").split(","):
            if t.strip():
                tags.add(t.strip())
    return sorted(tags)


AGENCY_BRIEF = """These are AGENCIES we want as white-label partners: we would deliver Google Ads / PPC and SEO work for THEIR clients,
under their brand. A good hook shows we looked at THEIR business: what they sell (and the gap we fill), who their clients are,
the platforms and badges they carry, where they are, whether they run ads or hire PPC / SEO people, their size and age, the
founder's own background. NEVER audit their own website (no "your site lacks a tag / pixel / booking tool / location pages",
"your blog is old", "your site is slow"): we sell them delivery capacity, not fixes to their site; such hooks are thrown away."""
NICHE_BRIEF = """These are DIRECT CLIENTS (businesses that could hire IT Force for their own Google Ads, SEO or website). Facts about their
own site, ads, reviews and visibility are useful hooks."""

PROMPT = """You prepare facts for short outreach messages from IT Force, a Google Ads / PPC / SEO and web development team.
{segment_brief}

CAMPAIGN BRIEF (who we write to, their likely pains, the offer): {brief}

COMPANY: {company}
EVIDENCE about the company (the only things you may rely on; each has an id, a stored field path, its value and the date it was read):
{evidence}
{people}
Write up to {max_hooks} COMPANY HOOKS and, for each person listed, up to {max_person} PERSON HOOKS (from that person's own
items; a person hook may also cite company items). A hook is a short, true observation about THEM that a message could use.
Rules, all enforced by code afterwards (a hook that breaks one is thrown away):
- Use ONLY the evidence. Every hook lists the evidence ids it rests on. Do not use anything else you know.
- Use only numbers that appear in the cited evidence; do not compute, round or convert them.
- One plain sentence about the company or the person, in the third person ("They ...", "Their ..."), not about us.
- No URLs or domains, no prices, no guesses (no "probably", "seems", "likely").
- Give every hook a "kind", one of: {kinds}
- Prefer specific, checkable hooks that show what makes THIS company different from other agencies; skip generic ones.
Also give:
- "angle": one sentence, the single most promising reason to write to them, based on the hooks.
- "case_tag": the one tag from this list that best matches THEIR CLIENTS' industry (the case IT Force would show them), or null: {tags}.

Answer with JSON only:
{{"company_hooks": [{{"fact": "...", "evidence": ["E1"], "kind": "partner_badge"}}],
  "people": {{"P1": [{{"fact": "...", "evidence": ["P1.2"], "kind": "founder_background"}}]}},
  "angle": "...", "case_tag": null}}"""


def _lines(items: list[dict]) -> str:
    return "\n".join(f"{e['id']} | {e['path']} = {e['value']} | read {e['at']}" for e in items)


def _hook_dict(h: MetroHook) -> dict:
    try:
        ev = json.loads(h.evidence_json) if h.evidence_json else []
    except ValueError:
        ev = []
    return {"id": h.id, "fact": h.fact, "source_field": h.source_field, "source_ref": h.source_ref,
            "seen_at": h.seen_at.strftime("%Y-%m-%d") if h.seen_at else None, "kind": h.kind, "cycle": h.cycle,
            "scope": h.scope or "person", "lead_id": h.lead_id, "company_id": h.company_id, "evidence": ev,
            "used": h.used_touch_id is not None, "used_touch_id": h.used_touch_id}


def hooks_query(s: Session, lead: MetroLead):
    """The hooks a lead may use: its company's (shared) plus its own (and its pre-Phase 3 rows)."""
    conds = [MetroHook.lead_id == lead.id]
    if lead.company_id:
        conds.append((MetroHook.company_id == lead.company_id) & (MetroHook.scope == "company"))
    return s.query(MetroHook).filter(or_(*conds))


def hooks_for(s: Session, lead_id: int) -> list[dict]:
    lead = s.get(MetroLead, lead_id)
    if lead is None:
        return []
    return [_hook_dict(h) for h in hooks_query(s, lead).order_by(MetroHook.scope.desc(), MetroHook.id).all()]


def hook_counts(s: Session, leads: list[MetroLead]) -> dict[int, int]:
    """{lead_id: number of hooks it may use} for many leads in two queries."""
    if not leads:
        return {}
    ids = [l.id for l in leads]
    cids = list({l.company_id for l in leads if l.company_id})
    per_lead: dict[int, int] = {}
    for (lid,) in s.query(MetroHook.lead_id).filter(MetroHook.lead_id.in_(ids)).all():
        per_lead[lid] = per_lead.get(lid, 0) + 1
    per_co: dict[int, int] = {}
    if cids:
        for (cid,) in s.query(MetroHook.company_id).filter(MetroHook.company_id.in_(cids), MetroHook.scope == "company").all():
            per_co[cid] = per_co.get(cid, 0) + 1
    return {l.id: per_lead.get(l.id, 0) + per_co.get(l.company_id, 0) for l in leads}


def build_evidence(s: Session, lead: MetroLead, company: MetroCompany | None, campaign=None) -> list[dict]:
    """The numbered evidence of ONE lead as the model sees it (company items E1.., then this person's P1.1..)."""
    camp = campaign or (s.get(MetroCampaign, lead.campaign_id) if lead.campaign_id else None)
    seg = segment_of(camp) if camp is not None else "niche"
    comp_items = evm.number(evm.company_evidence(company, colleagues(s, lead), seg)[:MAX_EVIDENCE], "E")
    pers = evm.person_evidence(lead)
    for n, it in enumerate(pers, 1):
        it["id"] = f"P1.{n}"
    return comp_items + pers


def colleagues(s: Session, lead: MetroLead) -> list[MetroLead]:
    if not lead.company_id:
        return [lead]
    q = s.query(MetroLead).filter(MetroLead.company_id == lead.company_id)
    if lead.campaign_id:
        q = q.filter(MetroLead.campaign_id == lead.campaign_id)
    return q.order_by(MetroLead.id).all() or [lead]


def _clear_drafts(s: Session, lead_ids: list[int]) -> int:
    """Draft chains written from hooks that are about to be replaced: their touches go, their hooks are free again. A touch that
    is approved, scheduled or sent is never touched."""
    if not lead_ids:
        return 0
    drafts = s.query(MetroTouch).filter(MetroTouch.lead_id.in_(lead_ids), MetroTouch.status == "draft",
                                        MetroTouch.approved_at.is_(None), MetroTouch.send_anyway_at.is_(None)).all()
    ids = [t.id for t in drafts]
    if ids:
        s.query(MetroHook).filter(MetroHook.used_touch_id.in_(ids)).update({MetroHook.used_touch_id: None}, synchronize_session=False)
        for t in drafts:
            s.delete(t)
        touched = {t.lead_id for t in drafts}
        for l in s.query(MetroLead).filter(MetroLead.id.in_(touched)).all():
            l.chain_written_at = None
            l.chain_json = None
    return len(ids)


def write_company_hooks(s: Session, company: MetroCompany | None, leads: list[MetroLead], campaign: MetroCampaign, *,
                        ask: Callable[..., str] | None = None) -> dict:
    """ONE model call for a company and the given leads of it (or one lead without a company). Stores the company hooks once
    (shared) and each person's hooks. Returns counts per lead and the rejected hooks with their reasons."""
    ask = ask or aiclient.ask
    seg = segment_of(campaign)
    brief = json.loads(campaign.brief_json) if getattr(campaign, "brief_json", None) else {}
    forbidden = [str(x) for x in (brief.get("do_not_claim") or [])]
    tags = case_tags_for(s, campaign)
    all_leads = colleagues(s, leads[0]) if company is not None else leads
    comp_items = evm.number(evm.company_evidence(company, all_leads, seg)[:MAX_EVIDENCE], "E")
    people = []
    for k, lead in enumerate(leads, 1):
        pe = evm.person_evidence(lead)
        for n, it in enumerate(pe, 1):
            it["id"] = f"P{k}.{n}"
        people.append((f"P{k}", lead, pe))
    substantive = len(comp_items) + sum(1 for _p, _l, pe in people for e in pe if not e["path"].startswith("lead."))
    if substantive < 2:                                  # the CSV fields alone are not enough to say anything
        return {"company_id": company.id if company else None, "hooks": 0, "per_lead": {l.id: 0 for l in leads},
                "reason": "not enough stored evidence", "rejected": [], "angle": None, "case_tag": None}
    people_txt = ""
    for pid, lead, pe in people:
        people_txt += (f"\nPERSON {pid}: {lead.full_name or 'a lead'}, {lead.title or 'a decision maker'}\n"
                       + (_lines(pe) or "(no items)") + "\n")
    brief_txt = json.dumps({k: brief.get(k) for k in ("who", "pains") if brief.get(k)}, ensure_ascii=False)
    if getattr(campaign, "offer", None):
        brief_txt += f" Offer: {campaign.offer}"
    kinds = ", ".join(f"{k} ({d})" for k, (d, segs) in KINDS.items() if seg in segs)
    prompt = PROMPT.format(segment_brief=AGENCY_BRIEF if seg == "agency" else NICHE_BRIEF, brief=brief_txt or "none",
                           company=(company.name if company else (leads[0].company_name or "unknown")),
                           evidence=_lines(comp_items) or "(none)", people=people_txt, max_hooks=MAX_HOOKS,
                           max_person=MAX_PERSON_HOOKS, kinds=kinds, tags=", ".join(tags) if tags else "none (use null)")
    s.commit()                                   # P3b #3: no transaction stays open across the model call
    data = aiclient.parse_json(ask(prompt, model=aiclient.SONNET, max_tokens=8000, kind="metro_hooks"))
    if not isinstance(data, dict):
        raise aiclient.AIError("unexpected answer shape")
    comp_ev = {e["id"]: e for e in comp_items}
    rejected, seen = [], set()

    def keep(raw, ev, cap):
        out = []
        for h in (raw or [])[:cap * 2]:
            if not isinstance(h, dict):
                continue
            ok, why = verify_hook(h, ev, forbidden, seg)
            key = re.sub(r"\W+", " ", str(h.get("fact") or "").lower()).strip()
            if ok and key in seen:
                ok, why = False, "duplicate"
            if not ok:
                rejected.append({"fact": str(h.get("fact"))[:160], "why": why})
                continue
            seen.add(key)
            out.append(h)
            if len(out) >= cap:
                break
        return out

    comp_raw = data.get("company_hooks") if "company_hooks" in data else data.get("hooks")     # "hooks": a Phase 2 shaped answer
    kept_company = keep(comp_raw, comp_ev, MAX_HOOKS)
    kept_people = {}
    ppl = data.get("people") if isinstance(data.get("people"), dict) else {}
    for pid, lead, pe in people:
        ev = {**comp_ev, **{e["id"]: e for e in pe}}
        kept_people[lead.id] = keep(ppl.get(pid), ev, MAX_PERSON_HOOKS)

    # replace the unused hooks; hooks used by an approved / sent touch stay in the ledger
    lead_ids = [l.id for l in all_leads]
    cleared = _clear_drafts(s, lead_ids)
    if company is not None:
        s.query(MetroHook).filter(MetroHook.company_id == company.id, MetroHook.scope == "company",
                                  MetroHook.used_touch_id.is_(None)).delete(synchronize_session="fetch")
    for lead in leads:
        s.query(MetroHook).filter(MetroHook.lead_id == lead.id, MetroHook.used_touch_id.is_(None),
                                  or_(MetroHook.scope.is_(None), MetroHook.scope == "person")).delete(synchronize_session="fetch")
    if company is not None:                     # pre-Phase 3 per-lead copies of company facts, for the colleagues not asked now
        s.query(MetroHook).filter(MetroHook.lead_id.in_(lead_ids), MetroHook.scope.is_(None),
                                  MetroHook.used_touch_id.is_(None)).delete(synchronize_session="fetch")
    s.flush()
    cycle = min((l.current_cycle or 1) for l in leads)

    def store(h, ev, lead_id, scope):
        cited = [ev[str(c)] for c in h["evidence"]]
        s.add(MetroHook(lead_id=lead_id, company_id=company.id if company else None, fact=str(h["fact"]).strip(),
                        source_field=", ".join(dict.fromkeys(c["path"] for c in cited)),
                        source_ref=str(cited[0].get("ref") or "")[:300], seen_at=evm.day_of(cited),
                        kind=str(h.get("kind") or "")[:40] or None, cycle=cycle, scope=scope, campaign_id=campaign.id,
                        evidence_json=json.dumps([{"id": c["id"], "path": c["path"], "value": str(c["value"])[:400], "at": c["at"]}
                                                  for c in cited], ensure_ascii=False)))

    if company is not None:
        for h in kept_company:
            store(h, comp_ev, None, "company")
    else:                                       # no company: its "company" hooks belong to the one lead
        for h in kept_company:
            store(h, comp_ev, leads[0].id, "person")
    for pid, lead, pe in people:
        ev = {**comp_ev, **{e["id"]: e for e in pe}}
        for h in kept_people[lead.id]:
            store(h, ev, lead.id, "person")

    angle = str(data.get("angle") or "").strip()[:300]
    ct = data.get("case_tag")
    angle = angle if angle and not URL_RX.search(angle) and not PRICE_RX.search(angle) else None
    ct = ct if isinstance(ct, str) and ct in tags else None
    now = utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    for lead in all_leads:                      # the angle and case tag are the company's: every colleague gets them
        notes = json.loads(lead.score_notes_json or "{}")
        notes["angle"], notes["case_tag"], notes["hooks_at"] = angle, ct, now
        lead.score_notes_json = json.dumps(notes, ensure_ascii=False)
    for lead in leads:
        lead.enriched_at = utcnow()
    s.commit()
    per_lead = {l.id: len(kept_company) + len(kept_people.get(l.id, [])) for l in leads}
    return {"company_id": company.id if company else None, "hooks": len(kept_company) + sum(len(v) for v in kept_people.values()),
            "company_hooks": len(kept_company), "per_lead": per_lead, "rejected": rejected, "angle": angle, "case_tag": ct,
            "drafts_cleared": cleared}


def extract_hooks(s: Session, lead: MetroLead, campaign: MetroCampaign, *, ask: Callable[..., str] | None = None) -> dict:
    """One lead (the Phase 2 entry point): its company's hooks and its own."""
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    r = write_company_hooks(s, company, [lead], campaign, ask=ask)
    return {"lead_id": lead.id, "hooks": r["hooks"], "rejected": r["rejected"], "angle": r.get("angle"),
            "case_tag": r.get("case_tag"), **({"reason": r["reason"]} if r.get("reason") else {})}


# ───────────────────────── a batch over the shortlist (background; one at a time) ─────────────────────────

class HooksRun:
    lock = threading.Lock()
    state: dict = {"running": False}
    stop_flag = threading.Event()


def hooks_status() -> dict:
    return dict(HooksRun.state)


def stop_hooks() -> None:
    HooksRun.stop_flag.set()


def group_by_company(s: Session, lead_ids: list[int]) -> list[tuple[int | None, list[int]]]:
    """[(company_id or None, [lead ids])], in the order the leads were given; a lead without a company is its own group."""
    groups: dict = {}
    order = []
    for lid in lead_ids:
        l = s.get(MetroLead, lid)
        if l is None:
            continue
        key = l.company_id if l.company_id else f"lead-{lid}"
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(lid)
    return [(k if isinstance(k, int) else None, groups[k]) for k in order]


def refresh_scan(s: Session, company: MetroCompany | None, fetch=None, sleep=None) -> bool:
    """Phase 3: a company whose stored website scan was made by the older scanner (no services, industries, partners ...) is
    re-read before its hooks are written, so one "Write hooks" click is enough after the upgrade. Paced like any scan; a failed
    read never replaces the good older one. True when it re-read."""
    from . import webscan
    from .db import get_setting
    if company is None or not company.domain or not company.website_scan_json or webscan.scan_current(company.website_scan_json):
        return False
    import time as _time
    pace = float((get_setting(s, "pace_seconds", {}) or {}).get("web", 3))
    scan = webscan.scan_site(company.domain, fetch or webscan.http_fetcher(), sleep=sleep or _time.sleep, pace=pace)
    if scan.get("ok"):
        company.website_scan_json, company.website_scan_at = json.dumps(scan, ensure_ascii=False), utcnow()
        s.commit()
        return True
    return False


def start_hooks_run(campaign_id: int, lead_ids: list[int], *, ask=None, background: bool = True, fetch=None, sleep=None) -> dict:
    from . import progress
    with Session(get_engine()) as s:
        groups = group_by_company(s, lead_ids)
    with HooksRun.lock:
        if HooksRun.state.get("running"):
            return {"started": False, "reason": "a run is already going", **HooksRun.state}
        HooksRun.stop_flag.clear()
        rid = progress.start("hooks", "Writing hooks", total=len(groups), campaign_id=campaign_id, stop=stop_hooks, by_click=True)
        from . import runqueue
        qid = runqueue.begin("hooks", campaign_id, [[str(cid if cid else f"lead-{ids[0]}"), ids] for cid, ids in groups],
                             label="Writing hooks", progress_id=rid)
        progress.update(rid, queue_id=qid)
        HooksRun.state = {"running": True, "campaign_id": campaign_id, "total": len(groups), "leads": len(lead_ids), "done": 0,
                          "failed": 0, "hooks": 0, "rejected": 0, "log": [], "progress_id": rid, "leads_done": 0}

    def work():
        try:
            for cid, ids in groups:
                if HooksRun.stop_flag.is_set():
                    HooksRun.state["stopped"] = True
                    break
                with Session(get_engine()) as s:
                    leads = [s.get(MetroLead, i) for i in ids]
                    camp = s.get(MetroCampaign, campaign_id)
                    comp = s.get(MetroCompany, cid) if cid else None
                    label = (comp.name if comp else leads[0].company_name or leads[0].full_name) or str(ids[0])
                    progress.update(rid, current=f"{label} ({len(ids)} lead{'s' if len(ids) != 1 else ''})", step="writing hooks")
                    try:
                        if comp is not None and comp.domain and comp.website_scan_json:
                            from . import webscan as _ws
                            if not _ws.scan_current(comp.website_scan_json):
                                progress.update(rid, step="re-reading the site (new scanner)")
                                if refresh_scan(s, comp, fetch=fetch, sleep=sleep):
                                    HooksRun.state["rescanned"] = HooksRun.state.get("rescanned", 0) + 1
                                progress.update(rid, step="writing hooks")
                        r = write_company_hooks(s, comp, leads, camp, ask=ask)
                        HooksRun.state["hooks"] += r["hooks"]
                        HooksRun.state["rejected"] += len(r.get("rejected", []))
                        HooksRun.state["leads_done"] += len(ids)
                    except Exception as e:
                        s.rollback()
                        HooksRun.state["failed"] += 1
                        HooksRun.state["log"] = (HooksRun.state["log"] + [{"company_id": cid, "error": f"{type(e).__name__}: {e}"[:200]}])[-20:]
                HooksRun.state["done"] += 1
                runqueue.item_done(qid, str(cid if cid else f"lead-{ids[0]}"))
                progress.update(rid, done=HooksRun.state["done"], failed=HooksRun.state["failed"])
        finally:
            st = HooksRun.state
            HooksRun.state["running"] = False
            from . import lines as _lines
            head = f"Hooks for {_lines.plural(st['leads_done'] or st['leads'], 'lead')}"
            if st["total"] and st["total"] != st["leads"]:
                head += f" ({_lines.plural(st['done'], 'company', 'companies')})"
            progress.finish(rid, _lines.line(head + (" (stopped)" if st.get("stopped") else ""),
                                             _lines.part(st["hooks"], "hook", tail="kept") or "no hook could be written",
                                             (f"{st['rejected']} thrown away by the checks" if st["rejected"] else None),
                                             _lines.part(st.get("rescanned"), "site", "sites", "re-read"),
                                             _lines.part(st["failed"], "company", "companies", "failed")),
                            "stopped" if st.get("stopped") else "done")
            runqueue.end(qid, "stopped" if st.get("stopped") else "done")

    if background:
        threading.Thread(target=work, name="metro-hooks", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(groups), "leads": len(lead_ids), "progress_id": rid}
