"""Exports of approved chains (METRO_PLAN.md Phase 3, step 6). Nothing is sent from here: a file is handed to Oleh.

  * Linked Helper CSV: one row per lead with LinkedIn touches; the profile and name columns Linked Helper imports by, and one
    CUSTOM VARIABLE per LinkedIn message (`metro_message_1` ... `metro_message_3`), so a Linked Helper "message" action can use
    {metro_message_1} etc. The day of each message is a column too (`metro_day_1` ...).
  * Email CSV: one row per email touch (lead, address, step, day, subject, body), in send order.

Only APPROVED chains (Approve, or Send anyway) of usable, unstopped primary contacts are exported; a suppressed or held lead
never is. The email file leaves out leads with no sendable address and says how many. Names are unique (filenames.py).
"""
from __future__ import annotations

import csv
import io

from sqlalchemy.orm import Session

from .db import MetroLead, MetroTouch
from .emailfinder import email_sendable

LH_MAX_MESSAGES = 3
LH_COLUMNS = ["profile_url", "member_id", "first_name", "last_name", "full_name", "company_name", "title", "metro_lead_id"]
EMAIL_COLUMNS = ["email", "email_type", "email_status", "first_name", "last_name", "full_name", "company_name", "metro_lead_id",
                 "step", "day", "subject", "body"]


def _approved_leads(s: Session, campaign_id: int, lead_ids: list[int] | None = None) -> list[MetroLead]:
    q = s.query(MetroLead).filter(MetroLead.campaign_id == campaign_id, MetroLead.status == "new",
                                  MetroLead.chain_approved_at.isnot(None), MetroLead.stopped_reason.is_(None))
    if lead_ids is not None:
        q = q.filter(MetroLead.id.in_(lead_ids))
    return [l for l in q.order_by(MetroLead.id).all() if l.account_role != "held"]


def _touches(s: Session, lead: MetroLead, channel: str) -> list[MetroTouch]:
    return s.query(MetroTouch).filter(MetroTouch.lead_id == lead.id, MetroTouch.cycle == lead.current_cycle, MetroTouch.channel == channel,
                                      MetroTouch.status == "draft", MetroTouch.approved_at.isnot(None)).order_by(MetroTouch.step).all()


def _first(lead: MetroLead) -> str:
    return lead.first_name or (lead.full_name or "").split(" ")[0]


def linkedhelper_csv(s: Session, campaign_id: int, lead_ids: list[int] | None = None) -> tuple[str, dict]:
    from . import chains
    rows, skipped_no_profile, skipped_no_li = [], 0, 0
    for l in s.query(MetroLead).filter(MetroLead.campaign_id == campaign_id, MetroLead.invite_status == "connected").all():
        chains.ensure_intro(s, l)                # P3b: accepted since the wave was written: the intro joins it (needs Approve)
    s.commit()
    for l in _approved_leads(s, campaign_id, lead_ids):
        ts = _touches(s, l, "linkedin")[:LH_MAX_MESSAGES]
        if not ts:
            skipped_no_li += 1
            continue
        if not l.profile_url:
            skipped_no_profile += 1
            continue
        row = {"profile_url": l.profile_url, "member_id": l.member_id or "", "first_name": _first(l), "last_name": l.last_name or "",
               "full_name": l.full_name or "", "company_name": l.company_name or "", "title": l.title or "", "metro_lead_id": l.id}
        for i in range(LH_MAX_MESSAGES):
            row[f"metro_message_{i + 1}"] = ts[i].body if i < len(ts) else ""
            row[f"metro_day_{i + 1}"] = ts[i].day if i < len(ts) else ""
        rows.append(row)
    cols = LH_COLUMNS + [c for i in range(LH_MAX_MESSAGES) for c in (f"metro_message_{i + 1}", f"metro_day_{i + 1}")]
    return _csv(cols, rows), {"leads": len(rows), "no_linkedin_touch": skipped_no_li, "no_profile": skipped_no_profile}


def email_csv(s: Session, campaign_id: int, lead_ids: list[int] | None = None) -> tuple[str, dict]:
    rows, no_address, leads = [], 0, 0
    for l in _approved_leads(s, campaign_id, lead_ids):
        ts = _touches(s, l, "email")
        if not ts:
            continue
        if not email_sendable(l):
            no_address += 1
            continue
        leads += 1
        opened: dict = {}
        for t in ts:
            if t.subject:
                opened["last"] = t.subject
            subject = t.subject or (f"Re: {opened['last']}" if opened.get("last") else "")   # P3b: a reply in the thread
            rows.append({"email": l.email, "email_type": l.email_type or "business", "email_status": l.email_status or "",
                         "first_name": _first(l), "last_name": l.last_name or "", "full_name": l.full_name or "",
                         "company_name": l.company_name or "", "metro_lead_id": l.id, "step": t.step, "day": t.day,
                         "subject": subject, "body": t.body or ""})
    return _csv(EMAIL_COLUMNS, rows), {"leads": leads, "emails": len(rows), "no_sendable_address": no_address}


def _csv(cols: list[str], rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore", lineterminator="\r\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return "﻿" + buf.getvalue()           # BOM: Excel opens it as UTF-8
