"""Phase 1 routes: campaigns and the launch kit, CSV import, leads, persona rules, suppression
candidates. Included into the /metro router by router.py (so api/main.py still mounts one line).
Nothing here sends anything to anyone.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from . import campaigns as camp
from . import candidates as cand
from . import leads as leadsmod
from . import persona as pe
from .db import MetroCampaign, MetroImport, MetroLead, MetroSetting, get_engine, utcnow

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

p1 = APIRouter()


class CampaignIn(BaseModel):
    name: str
    type: str
    region: str | None = None
    month: str | None = None
    offer: str | None = None
    brief: dict | None = None
    launch_kit: dict | None = None


class CampaignPatch(BaseModel):
    name: str | None = None
    type: str | None = None
    region: str | None = None
    month: str | None = None
    offer: str | None = None
    brief: dict | None = None
    launch_kit: dict | None = None
    status: str | None = None


class CheckIn(BaseModel):
    done: bool


class LeadPatch(BaseModel):
    decision: str            # keep | junk


class DecisionIn(BaseModel):
    decision: str


def _campaign(s: Session, cid: int) -> MetroCampaign:
    c = s.get(MetroCampaign, cid)
    if c is None:
        raise HTTPException(404, "no such campaign")
    return c


def _bad(e: Exception) -> HTTPException:
    return HTTPException(400, str(e))


# ───────────────────────── campaigns ─────────────────────────

@p1.get("/campaigns")
def campaigns_list():
    with Session(get_engine()) as s:
        rows = s.query(MetroCampaign).order_by(MetroCampaign.id.desc()).all()
        return {"campaigns": [camp.to_dict(s, c, full=False) for c in rows],
                "types": list(camp.TYPES), "regions": list(camp.REGIONS)}


@p1.post("/campaigns")
def campaigns_create(body: CampaignIn):
    with Session(get_engine()) as s:
        try:
            c = camp.create(s, **body.model_dump())
        except ValueError as e:
            raise _bad(e)
        return camp.to_dict(s, c)


@p1.get("/campaigns/{cid}")
def campaigns_get(cid: int):
    with Session(get_engine()) as s:
        return camp.to_dict(s, _campaign(s, cid))


@p1.patch("/campaigns/{cid}")
def campaigns_patch(cid: int, body: CampaignPatch):
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        try:
            camp.update(s, c, body.model_dump(exclude_unset=True))
        except ValueError as e:
            raise _bad(e)
        return camp.to_dict(s, c)


@p1.post("/campaigns/{cid}/start")
def campaigns_start(cid: int):
    """Activate the campaign; the answer carries the launch checklist (open steps are shown, never enforced)."""
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        try:
            camp.start(s, c)
        except ValueError as e:
            raise _bad(e)
        return camp.to_dict(s, c)


@p1.post("/campaigns/{cid}/checklist/{key}")
def campaigns_check(cid: int, key: str, body: CheckIn):
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        try:
            camp.set_check(s, c, key, body.done)
        except KeyError:
            raise HTTPException(404, "no such checklist step")
        return camp.to_dict(s, c)


@p1.post("/campaigns/{cid}/import")
async def campaigns_import(cid: int, file: UploadFile = File(...), dry_run: bool = Query(True),
                           list_source: str = Query("")):
    """Import a Linked Helper / Sales Navigator / hand-made CSV into the campaign. Dry run by default."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large")
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        try:
            return leadsmod.run_import(s, c, raw, filename=file.filename, list_source=list_source, dry_run=dry_run)
        except ValueError as e:
            raise _bad(e)


@p1.get("/campaigns/{cid}/imports")
def campaigns_imports(cid: int):
    with Session(get_engine()) as s:
        _campaign(s, cid)
        rows = s.query(MetroImport).filter_by(campaign_id=cid).order_by(MetroImport.id.desc()).all()
        return {"imports": [{"id": r.id, "filename": r.filename, "list_source": r.list_source, "rows_read": r.rows_read,
                             "created_at": r.created_at.isoformat() if r.created_at else None,
                             "result": json.loads(r.result_json) if r.result_json else None} for r in rows]}


@p1.post("/campaigns/{cid}/rescore")
def campaigns_rescore(cid: int):
    """Layer 0 again with the persona rules as they are now. Locked and suppressed leads are untouched."""
    with Session(get_engine()) as s:
        return leadsmod.rescore_campaign(s, _campaign(s, cid))


@p1.get("/campaigns/{cid}/pipeline")
def campaigns_pipeline(cid: int):
    """The four pipeline cards (Import -> Enrich -> Write -> Send). Only Import is live in Phase 1."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        by = dict(s.query(MetroLead.status, func.count()).filter(MetroLead.campaign_id == cid)
                  .group_by(MetroLead.status).all())
        return {"import": {"leads": sum(by.values()), "new": by.get("new", 0), "junk": by.get("junk", 0),
                           "suppressed": by.get("suppressed", 0)},
                "enrich": {"ready": by.get("new", 0), "live": False, "phase": "2"},
                "write": {"ready": 0, "live": False, "phase": "3"},
                "send": {"ready": 0, "live": False, "phase": "4-5"}}


# ───────────────────────── leads ─────────────────────────

def lead_dict(l: MetroLead) -> dict:
    notes = json.loads(l.score_notes_json).get("persona") if l.score_notes_json else None
    return {"id": l.id, "campaign_id": l.campaign_id, "full_name": l.full_name, "title": l.title,
            "company_name": l.company_name, "location": l.location, "profile_url": l.profile_url,
            "email": l.email, "email_source": l.email_source, "email_verified": bool(l.email_verified),
            "invite_status": l.invite_status, "persona_score": l.persona_score, "persona_verdict": l.persona_verdict,
            "persona_reasons": (notes or {}).get("reasons", []), "persona_locked": bool(l.persona_locked),
            "status": l.status, "suppressed_reason": l.suppressed_reason, "list_source": l.list_source,
            "invited_at": l.invited_at.isoformat() if l.invited_at else None,
            "connected_at": l.connected_at.isoformat() if l.connected_at else None}


@p1.get("/leads")
def leads_list(campaign_id: int | None = None, status: str | None = None, verdict: str | None = None,
               invite: str | None = None, has_email: bool | None = None, q: str | None = None,
               sort: str = "persona", limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    with Session(get_engine()) as s:
        base = s.query(MetroLead)
        if campaign_id is not None:
            base = base.filter(MetroLead.campaign_id == campaign_id)
        counts = dict(base.with_entities(MetroLead.status, func.count()).group_by(MetroLead.status).all())
        qq = base
        if status:
            qq = qq.filter(MetroLead.status == status)
        if verdict:
            qq = qq.filter(MetroLead.persona_verdict == verdict)
        if invite:
            qq = qq.filter(MetroLead.invite_status == invite)
        if has_email is True:
            qq = qq.filter(MetroLead.email.isnot(None))
        if has_email is False:
            qq = qq.filter(MetroLead.email.is_(None))
        if q and q.strip():
            like = f"%{q.strip().lower()}%"
            qq = qq.filter(or_(func.lower(MetroLead.full_name).like(like), func.lower(MetroLead.title).like(like),
                               func.lower(MetroLead.company_name).like(like), func.lower(MetroLead.location).like(like)))
        total = qq.count()
        order = {"persona": MetroLead.persona_score.desc(), "name": MetroLead.full_name.asc(),
                 "company": MetroLead.company_name.asc(), "newest": MetroLead.id.desc()}.get(sort, MetroLead.persona_score.desc())
        rows = qq.order_by(order, MetroLead.id).offset(offset).limit(limit).all()
        return {"total": total, "counts": counts, "leads": [lead_dict(l) for l in rows]}


@p1.patch("/leads/{lead_id}")
def leads_patch(lead_id: int, body: LeadPatch):
    """A person's own call on layer 0: "keep anyway" or "mark junk". Rescoring never flips it afterwards."""
    with Session(get_engine()) as s:
        l = s.get(MetroLead, lead_id)
        if l is None:
            raise HTTPException(404, "no such lead")
        if l.status == "suppressed":
            raise HTTPException(400, "a suppressed lead cannot be changed here")
        if body.decision not in ("keep", "junk"):
            raise HTTPException(400, "decision must be keep or junk")
        l.status = "new" if body.decision == "keep" else "junk"
        l.persona_locked = True
        s.commit()
        return lead_dict(l)


# ───────────────────────── persona rules ─────────────────────────

@p1.get("/persona-rules")
def persona_rules_get():
    with Session(get_engine()) as s:
        return {"rules": leadsmod.rules_of(s), "defaults": pe.DEFAULT_RULES}


@p1.put("/persona-rules")
def persona_rules_put(rules: dict):
    errs = pe.validate_rules(rules)
    if errs:
        raise HTTPException(400, "; ".join(errs))
    with Session(get_engine()) as s:
        row = s.get(MetroSetting, "persona_rules")
        if row is None:
            row = MetroSetting(key="persona_rules", value_json="{}")
            s.add(row)
        row.value_json = json.dumps(pe.merge_rules(rules))
        row.updated_at = utcnow()
        s.commit()
        return {"rules": json.loads(row.value_json)}


# ───────────────────────── suppression candidates (Upwork-derived, need Oleh's decision) ─────────────────────────

@p1.get("/suppression/candidates")
def suppression_candidates():
    with Session(get_engine()) as s:
        return {"candidates": cand.listing(s)}


@p1.post("/suppression/candidates/refresh")
def suppression_candidates_refresh():
    """Read the proposals (read only) and PROPOSE domains. Nothing is suppressed by this call."""
    with Session(get_engine()) as s:
        return cand.refresh_from_proposals(s)


@p1.post("/suppression/candidates/{cand_id}/decision")
def suppression_candidates_decide(cand_id: int, body: DecisionIn):
    with Session(get_engine()) as s:
        try:
            return cand.decide(s, cand_id, body.decision)
        except KeyError:
            raise HTTPException(404, "no such candidate")
        except ValueError as e:
            raise _bad(e)
