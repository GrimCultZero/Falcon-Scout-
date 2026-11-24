"""Campaigns and the launch kit (METRO_PLAN.md Phase 1, steps 1 and 7).

A campaign is Agency (US/Canada, then Europe) or Niche (one per month, with a niche brief). It holds:
  * the brief: who it is for, the pains assumed, the case-study tags it may use, the do-not-claim
    list (and, in `offer`, what is offered);
  * the launch kit: the "package" the campaign runs with: the LinkedIn profile variant (headline,
    About, banner, featured items), the case studies and sample audits it may use, the brief and the
    offer;
  * the launch checklist: the manual steps Oleh does on LinkedIn before starting, with the date each
    was done. Metro never edits LinkedIn itself; it only records that the person did it.

Starting a campaign (draft -> active) records the date and returns the checklist state. It does NOT
block on open steps (nothing is sent in Phase 1); the UI shows what is still open.
"""
from __future__ import annotations

import json

from sqlalchemy import func
from sqlalchemy.orm import Session

from .db import MetroCampaign, MetroLead, utcnow

TYPES = ("agency", "niche")
STATUSES = ("draft", "active", "paused", "done")
REGIONS = ("US/CA", "EU")          # suggestions for the form; any text is accepted

DEFAULT_CHECKLIST = [
    {"key": "profile_switched", "label": "LinkedIn profile switched to this campaign's variant (headline, About, banner)"},
    {"key": "featured_swapped", "label": "Featured items swapped for this campaign's case studies and sample audits"},
    {"key": "share_updates_off", "label": 'Settings > "Share profile updates with your network" is OFF'},
]

EMPTY_BRIEF = {"who": "", "pains": [], "case_tags": [], "do_not_claim": []}
EMPTY_KIT = {
    "profile_variant": {"label": "", "headline": "", "about": "", "banner": "", "featured": []},
    "case_studies": [],       # [{"title", "url"}]
    "sample_audits": [],      # [{"title", "note"}]
    "notes": "",
}


def _clean_list(v) -> list[str]:
    if isinstance(v, str):
        v = [x for x in (p.strip() for p in v.replace("\r", "").split("\n")) if x]
    if not isinstance(v, list):
        return []
    return [str(x).strip() for x in v if str(x).strip()]


def clean_brief(b) -> dict:
    b = b if isinstance(b, dict) else {}
    return {"who": str(b.get("who") or "").strip(), "pains": _clean_list(b.get("pains")),
            "case_tags": _clean_list(b.get("case_tags")), "do_not_claim": _clean_list(b.get("do_not_claim"))}


def clean_kit(k) -> dict:
    k = k if isinstance(k, dict) else {}
    pv = k.get("profile_variant") if isinstance(k.get("profile_variant"), dict) else {}
    return {
        "profile_variant": {x: str(pv.get(x) or "").strip() for x in ("label", "headline", "about", "banner")}
                           | {"featured": _clean_list(pv.get("featured"))},
        "case_studies": [{"title": str(c.get("title") or "").strip(), "url": str(c.get("url") or "").strip()}
                         for c in (k.get("case_studies") or []) if isinstance(c, dict) and (c.get("title") or c.get("url"))],
        "sample_audits": [{"title": str(c.get("title") or "").strip(), "note": str(c.get("note") or "").strip()}
                          for c in (k.get("sample_audits") or []) if isinstance(c, dict) and (c.get("title") or c.get("note"))],
        "notes": str(k.get("notes") or "").strip(),
    }


def _checklist(c: MetroCampaign) -> dict:
    if c.checklist_json:
        return json.loads(c.checklist_json)
    return {"items": [dict(i, done_at=None) for i in DEFAULT_CHECKLIST], "history": []}


def to_dict(s: Session, c: MetroCampaign, *, full: bool = True) -> dict:
    counts = dict(s.query(MetroLead.status, func.count()).filter(MetroLead.campaign_id == c.id)
                  .group_by(MetroLead.status).all())
    cl = _checklist(c)
    out = {
        "id": c.id, "name": c.name, "type": c.type, "region": c.region, "month": c.month, "status": c.status,
        "offer": c.offer or "", "started_at": c.started_at.isoformat() if c.started_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "leads": sum(counts.values()), "lead_counts": counts,
        "checklist_open": sum(1 for i in cl["items"] if not i.get("done_at")),
        "checklist_total": len(cl["items"]),
    }
    if full:
        out["brief"] = clean_brief(json.loads(c.brief_json)) if c.brief_json else dict(EMPTY_BRIEF)
        out["launch_kit"] = clean_kit(json.loads(c.launch_kit_json)) if c.launch_kit_json else json.loads(json.dumps(EMPTY_KIT))
        out["checklist"] = cl
    return out


def create(s: Session, *, name: str, type: str, region: str | None, month: str | None, offer: str | None,
           brief=None, launch_kit=None) -> MetroCampaign:
    name = (name or "").strip()
    if not name:
        raise ValueError("a campaign needs a name")
    if type not in TYPES:
        raise ValueError(f"type must be one of {', '.join(TYPES)}")
    if month and not _valid_month(month):
        raise ValueError("month must look like 2026-12")
    c = MetroCampaign(name=name, type=type, region=(region or "").strip() or None, month=month or None,
                      offer=(offer or "").strip() or None, status="draft",
                      brief_json=json.dumps(clean_brief(brief)), launch_kit_json=json.dumps(clean_kit(launch_kit)),
                      checklist_json=json.dumps({"items": [dict(i, done_at=None) for i in DEFAULT_CHECKLIST], "history": []}))
    s.add(c)
    s.commit()
    return c


def _valid_month(m: str) -> bool:
    import re
    return bool(re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", m))


def update(s: Session, c: MetroCampaign, fields: dict) -> MetroCampaign:
    if "name" in fields:
        if not str(fields["name"] or "").strip():
            raise ValueError("a campaign needs a name")
        c.name = str(fields["name"]).strip()
    if "type" in fields:
        if fields["type"] != c.type:
            if s.query(MetroLead).filter_by(campaign_id=c.id).count():
                raise ValueError("the type cannot change once leads are imported")
            if fields["type"] not in TYPES:
                raise ValueError(f"type must be one of {', '.join(TYPES)}")
            c.type = fields["type"]
    for f in ("region", "offer"):
        if f in fields:
            setattr(c, f, (str(fields[f] or "").strip() or None))
    if "month" in fields:
        m = fields["month"] or None
        if m and not _valid_month(m):
            raise ValueError("month must look like 2026-12")
        c.month = m
    if "brief" in fields:
        c.brief_json = json.dumps(clean_brief(fields["brief"]))
    if "launch_kit" in fields:
        c.launch_kit_json = json.dumps(clean_kit(fields["launch_kit"]))
    if "status" in fields:
        _set_status(c, fields["status"])
    s.commit()
    return c


def _set_status(c: MetroCampaign, status: str) -> None:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {', '.join(STATUSES)}")
    if status == "active" and c.status != "active":
        raise ValueError("use Start campaign to activate (it shows the launch checklist)")
    c.status = status


def start(s: Session, c: MetroCampaign) -> dict:
    """draft/paused -> active. Records the first start date. Returns the checklist state; never blocks on it."""
    if c.status == "done":
        raise ValueError("a finished campaign cannot be started again")
    if c.status != "active":
        c.status = "active"
        c.started_at = c.started_at or utcnow()
        s.commit()
    return _checklist(c)


def set_check(s: Session, c: MetroCampaign, key: str, done: bool) -> dict:
    cl = _checklist(c)
    item = next((i for i in cl["items"] if i["key"] == key), None)
    if item is None:
        raise KeyError(key)
    now = utcnow().isoformat()
    item["done_at"] = now if done else None
    cl["history"].append({"key": key, "action": "done" if done else "undone", "at": now})
    c.checklist_json = json.dumps(cl)
    s.commit()
    return cl
