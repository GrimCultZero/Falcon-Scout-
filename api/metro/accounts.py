"""A company is ONE account (Phase 3; Oleh's shortlist of 26 Nov had 3 people at one agency, 2 at two others).

One primary contact per company gets the chain: the best persona. The others are HELD as "same company": shown, never written
to, until the primary's chain ends (then a later, different-angle touch may follow; Phase 6 decides). A reply from ANYONE of
the company stops every channel for all of them (`stop_company`, called by the reply handling of Phase 4/5).

Who is primary, first rule that separates them:
  1. a real person (a "lead" whose name is the company's own name is a company page, never primary);
  2. a hand choice (`make_primary`) is kept until changed;
  3. persona score, higher first;
  4. who can be reached now: LinkedIn connected, then a sendable email, then invited;
  5. the more senior title (founder / owner / CEO / president / managing partner first);
  6. the older lead (smaller id).
"""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from .db import MetroLead, MetroTouch, utcnow
from .emailfinder import email_sendable

SENIOR = re.compile(r"\b(founder|co-?founder|owner|ceo|chief executive|president|managing (?:partner|director)|principal|partner)\b", re.I)


def _key(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def is_company_page(lead: MetroLead) -> bool:
    n, c = _key(lead.full_name), _key(lead.company_name)
    return bool(n and c and (n == c or n in c or c in n))


def reach(lead: MetroLead) -> int:
    if lead.invite_status == "connected":
        return 3
    if email_sendable(lead):
        return 2
    if lead.invite_status == "invited":
        return 1
    return 0


def rank_key(lead: MetroLead) -> tuple:
    return (is_company_page(lead), -(lead.persona_score or 0), -reach(lead), not bool(SENIOR.search(lead.title or "")), lead.id)


def assign(s: Session, leads: list[MetroLead]) -> dict[int, list[MetroLead]]:
    """Primary / held for every company among these leads (all USABLE leads of the company in the same campaign count, not only
    the ones given). Returns {company_id: [primary, *held]}. Leads without a company are their own primary."""
    out: dict[int, list[MetroLead]] = {}
    for lead in leads:
        if not lead.company_id:
            lead.account_role, lead.primary_lead_id = "primary", None
            continue
        if lead.company_id in out:
            continue
        group = s.query(MetroLead).filter(MetroLead.company_id == lead.company_id, MetroLead.campaign_id == lead.campaign_id,
                                          MetroLead.status == "new").all()
        if not group:
            continue
        picked = [l for l in group if l.account_role == "primary" and _picked_by_hand(l)]
        primary = picked[0] if picked else sorted(group, key=rank_key)[0]
        ordered = [primary] + sorted([l for l in group if l.id != primary.id], key=rank_key)
        for l in ordered:
            l.account_role = "primary" if l.id == primary.id else "held"
            l.primary_lead_id = None if l.id == primary.id else primary.id
        out[lead.company_id] = ordered
    return out


def _picked_by_hand(lead: MetroLead) -> bool:
    try:
        return bool(json.loads(lead.chain_json or "{}").get("primary_by_hand"))
    except ValueError:
        return False


def make_primary(s: Session, lead: MetroLead) -> list[MetroLead]:
    """A person's own choice of the company's primary contact. The old primary becomes held; its DRAFT chain is cleared
    (an approved or sent touch is never touched)."""
    if not lead.company_id:
        return [lead]
    group = s.query(MetroLead).filter(MetroLead.company_id == lead.company_id, MetroLead.campaign_id == lead.campaign_id).all()
    for l in group:
        notes = json.loads(l.chain_json or "{}") if l.chain_json else {}
        if l.id == lead.id:
            notes["primary_by_hand"] = True
            l.account_role, l.primary_lead_id = "primary", None
        else:
            notes.pop("primary_by_hand", None)
            if l.account_role == "primary":
                from .hooks import _clear_drafts
                _clear_drafts(s, [l.id])
                notes = {}
            l.account_role, l.primary_lead_id = "held", lead.id
        l.chain_json = json.dumps(notes) if notes else None
    return group


def stop_company(s: Session, lead: MetroLead, reason: str) -> dict:
    """A reply (or an opt-out) from anyone stops EVERY channel for every lead of that company: their touches that are not sent
    yet are cancelled and the leads are marked. Returns what it stopped."""
    group = ([l for l in s.query(MetroLead).filter(MetroLead.company_id == lead.company_id).all()] if lead.company_id else [lead])
    ids = [l.id for l in group]
    cancelled = 0
    for t in s.query(MetroTouch).filter(MetroTouch.lead_id.in_(ids), MetroTouch.status.in_(("draft", "scheduled"))).all():
        t.status = "cancelled"
        cancelled += 1
    for l in group:
        l.stopped_reason = (reason if l.id == lead.id else f"{reason} (a colleague, lead {lead.id})")[:200]
        l.updated_at = utcnow()
    return {"leads": ids, "touches_cancelled": cancelled}
