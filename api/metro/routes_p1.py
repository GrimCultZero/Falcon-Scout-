"""Phase 1 routes: campaigns and the launch kit, CSV import, leads, persona rules, suppression
candidates. Included into the /metro router by router.py (so api/main.py still mounts one line).
Nothing here sends anything to anyone.
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from . import aiclient
from . import enrich as en
from . import progress
from . import briefdraft
from . import campaigns as camp
from . import importer
from . import candidates as cand
from . import leads as leadsmod
from .emailfinder import email_kind, emailable
from . import persona as pe
from . import removal
from .db import MetroCampaign, MetroCompany, MetroImport, MetroLead, MetroSetting, get_engine, get_setting, utcnow

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


class DraftBriefIn(BaseModel):
    niche: str
    region: str | None = None


class ScopeIn(BaseModel):
    lead_ids: list[int] | None = None


class RemoveLeadsIn(BaseModel):
    lead_ids: list[int]
    dry_run: bool = False


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


@p1.post("/campaigns/draft-brief")
def campaigns_draft_brief(body: DraftBriefIn):
    """Draft a niche brief through /claude from the niche and the KB's case studies. NOTHING is saved."""
    with Session(get_engine()) as s:
        try:
            return briefdraft.draft(s, body.niche, body.region)
        except ValueError as e:
            raise _bad(e)
        except aiclient.AIError as e:
            raise HTTPException(502, f"the model did not answer: {e}")


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


@p1.get("/campaigns/{cid}/delete-preview")
def campaigns_delete_preview(cid: int):
    """What deleting this campaign would remove (the confirm pop-up shows these counts)."""
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        return {**removal.campaign_counts(s, c), "deletable": c.status == "draft"}


@p1.delete("/campaigns/{cid}")
def campaigns_delete(cid: int):
    """Delete a DRAFT campaign with its leads and import records. Metro's own tables only."""
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        try:
            return removal.delete_draft(s, c)
        except ValueError as e:
            raise HTTPException(409, str(e))


@p1.post("/campaigns/{cid}/leads/remove")
def campaigns_remove_leads(cid: int, body: RemoveLeadsIn):
    """Remove ticked leads from the campaign (leads with a sent message or a reply are kept)."""
    with Session(get_engine()) as s:
        return removal.remove_leads(s, _campaign(s, cid), body.lead_ids, dry_run=body.dry_run)


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
    from starlette.concurrency import run_in_threadpool

    def work():
        with Session(get_engine()) as s:
            c = _campaign(s, cid)
            try:
                if dry_run:
                    return leadsmod.run_import(s, c, raw, filename=file.filename, list_source=list_source, dry_run=True)
                with progress.track("import", f"Importing {file.filename or 'a file'}", campaign_id=cid) as t:
                    r = leadsmod.run_import(s, c, raw, filename=file.filename, list_source=list_source, dry_run=False)
                    from . import lines as _l
                    t["result"] = (_l.line(f"Imported {file.filename or 'the file'}", _l.part(r.get("added"), "lead", tail="added") or "no new leads",
                                           _l.part(r.get("filled"), "lead", tail="filled in"), _l.part(r.get("duplicates"), "row", tail="already there")) +
                                   ((". Linked Helper data: " + leadsmod.enrichment_line(r["enrichment"])) if r.get("enrichment", {}).get("matched") else ""))
                    return r
            except ValueError as e:
                raise _bad(e)
    return await run_in_threadpool(work)


@p1.post("/campaigns/{cid}/import-file")
async def campaigns_import_file(cid: int, file: UploadFile = File(...), list_source: str = Query(""), force: bool = Query(False)):
    """F4: the ONE import for every CSV (lead list, Linked Helper export, email-finder results). It imports at once and
    answers with a summary in plain words; it stops before writing only when the file looks wrong (see importer.py)."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large (the limit is 20 MB)")
    from starlette.concurrency import run_in_threadpool

    def work():
        with Session(get_engine()) as s:
            c = _campaign(s, cid)
            try:
                return importer.import_file(s, c, raw, filename=file.filename, list_source=list_source, force=force)
            except ValueError as e:
                raise _bad(e)
    return await run_in_threadpool(work)


@p1.get("/campaigns/{cid}/imports")
def campaigns_imports(cid: int):
    with Session(get_engine()) as s:
        _campaign(s, cid)
        rows = s.query(MetroImport).filter_by(campaign_id=cid).order_by(MetroImport.id.desc()).all()
        return {"imports": [{"id": r.id, "filename": r.filename, "list_source": r.list_source, "rows_read": r.rows_read,
                             "created_at": r.created_at.isoformat() if r.created_at else None,
                             "result": json.loads(r.result_json) if r.result_json else None} for r in rows]}


@p1.post("/campaigns/{cid}/rescore")
def campaigns_rescore(cid: int, body: ScopeIn | None = None):
    """Layer 0 again with the persona rules as they are now. Locked and suppressed leads are untouched.
    `lead_ids` limits it to those leads (the app sends the rows it shows)."""
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        with progress.track("rescore", "Persona score (layer 0)", campaign_id=cid) as t:
            r = leadsmod.rescore_campaign(s, c, lead_ids=(body.lead_ids if body else None))
            from . import lines as _l
            n_checked = len(body.lead_ids) if body and body.lead_ids is not None else None
            head = f"Persona score checked for {_l.plural(n_checked, 'lead')}" if n_checked else "Persona score checked"
            t["result"] = _l.line(head, _l.part(r.get("changed"), "lead", tail="changed") or "none changed")
            return r


@p1.get("/campaigns/{cid}/pipeline")
def campaigns_pipeline(cid: int):
    """The four pipeline cards (Import -> Enrich -> Write -> Send). Only Import is live in Phase 1."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        by = dict(s.query(MetroLead.status, func.count()).filter(MetroLead.campaign_id == cid)
                  .group_by(MetroLead.status).all())
        return {"import": {"leads": sum(by.values()), "new": by.get("new", 0), "junk": by.get("junk", 0),
                           "suppressed": by.get("suppressed", 0),
                           "previously_contacted": by.get("previously_contacted", 0)},
                "enrich": {"ready": by.get("new", 0), "live": False, "phase": "2"},
                "write": {"ready": 0, "live": False, "phase": "3"},
                "send": {"ready": 0, "live": False, "phase": "4-5"}}


# ───────────────────────── leads ─────────────────────────

def lead_dict(l: MetroLead, comp: MetroCompany | None = None, last_run: datetime | None = None) -> dict:
    notes = json.loads(l.score_notes_json).get("persona") if l.score_notes_json else None
    extra = {}
    if comp is not None:
        extra = {"company_id": comp.id, "domain": comp.domain, "domain_source": comp.domain_source,
                 "domain_why": en.domain_why(comp), "enrich_tried_at": comp.enrich_tried_at.isoformat() if comp.enrich_tried_at else None,
                 "just_enriched": bool(last_run and comp.enrich_tried_at and comp.enrich_tried_at >= last_run)}
    return {**extra, "id": l.id, "campaign_id": l.campaign_id, "full_name": l.full_name, "title": l.title,
            "company_name": l.company_name, "location": l.location, "profile_url": l.profile_url,
            "email": l.email, "email_source": l.email_source, "email_verified": bool(l.email_verified),
            "invite_status": l.invite_status, "persona_score": l.persona_score, "persona_verdict": l.persona_verdict,
            "persona_reasons": (notes or {}).get("reasons", []),
            "fit_score": l.fit_score, "deep_score": l.deep_score, "email_status": l.email_status,
            "emailable": emailable(l), "email_kind": email_kind(l), "persona_locked": bool(l.persona_locked),
            "status": l.status, "suppressed_reason": l.suppressed_reason, "prior_contact_reason": l.prior_contact_reason, "list_source": l.list_source,
            "open_profile": bool(l.open_profile), "premium": l.premium, "hiring": l.hiring, "email_type": l.email_type,
            "invited_at": l.invited_at.isoformat() if l.invited_at else None,
            "connected_at": l.connected_at.isoformat() if l.connected_at else None}


def _last_run_start(s: Session) -> datetime | None:
    v = get_setting(s, "last_enrich_run", None)
    try:
        return datetime.strptime(v["started_at"], "%Y-%m-%dT%H:%M:%S") if v else None
    except (KeyError, TypeError, ValueError):
        return None


def _lead_filter(s: Session, *, campaign_id, status, verdict, invite, has_email, q, enriched, domain=None, join_company=False):
    """(base query of the campaign, the same query with every filter applied): the one place the filters live,
    so "the rows the filters show" means the same thing for the table, the ids and the batch buttons."""
    base = s.query(MetroLead)
    if campaign_id is not None:
        base = base.filter(MetroLead.campaign_id == campaign_id)
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
    if enriched in ("no", "yes", "recent") or domain in ("yes", "no") or join_company:
        qq = qq.join(MetroCompany, MetroCompany.id == MetroLead.company_id, isouter=not (enriched in ("no", "yes", "recent") or domain in ("yes", "no")))
    if enriched in ("no", "yes"):                                                  # a lead without a company cannot be enriched
        done = or_(MetroCompany.enrich_tried_at.isnot(None), MetroCompany.website_scan_at.isnot(None))
        qq = qq.filter(done if enriched == "yes" else ~done)
    if enriched == "recent":                                                       # F2: the companies the last enrich run touched
        since = _last_run_start(s)
        qq = qq.filter(MetroCompany.enrich_tried_at >= since) if since else qq.filter(False)
    if domain == "yes":
        qq = qq.filter(MetroCompany.domain.isnot(None))
    if domain == "no":
        qq = qq.filter(MetroCompany.domain.is_(None))
    return base, qq


@p1.get("/leads")
def leads_list(campaign_id: int | None = None, status: str | None = None, verdict: str | None = None,
               invite: str | None = None, has_email: bool | None = None, q: str | None = None,
               enriched: str | None = None, keep_first: bool = False, domain: str | None = None,
               sort: str = "persona", limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    with Session(get_engine()) as s:
        base, qq = _lead_filter(s, campaign_id=campaign_id, status=status, verdict=verdict, invite=invite,
                                has_email=has_email, q=q, enriched=enriched, domain=domain, join_company=(sort == "just_enriched"))
        counts = dict(base.with_entities(MetroLead.status, func.count()).group_by(MetroLead.status).all())
        total = qq.count()
        order = {"persona": MetroLead.persona_score.desc(), "name": MetroLead.full_name.asc(),
                 "company": MetroLead.company_name.asc(), "newest": MetroLead.id.desc(),
                 "just_enriched": case((MetroCompany.enrich_tried_at.is_(None), 1), else_=0).asc()}.get(sort, MetroLead.persona_score.desc())
        if sort == "just_enriched":                 # F2: the most recently touched companies first, then best persona
            orders_first = [case((MetroCompany.enrich_tried_at.is_(None), 1), else_=0).asc(), MetroCompany.enrich_tried_at.desc()]
            order = MetroLead.persona_score.desc()
        orders = [*(orders_first if sort == "just_enriched" else []), order, MetroLead.id]
        if keep_first:          # persona `keep` first, then the chosen sort
            orders.insert(0, case((MetroLead.persona_verdict == "keep", 0), else_=1))
        rows = qq.order_by(*orders).offset(offset).limit(limit).all()
        comps = {c.id: c for c in s.query(MetroCompany).filter(MetroCompany.id.in_([l.company_id for l in rows if l.company_id])).all()} if rows else {}
        since = _last_run_start(s)
        return {"total": total, "counts": counts, "last_run": since.isoformat() if since else None,
                "leads": [lead_dict(l, comps.get(l.company_id), since) for l in rows]}


@p1.get("/campaigns/{cid}/enrich-next")
def campaigns_enrich_next(cid: int, ns: str = "20,50", take: int | None = Query(None, ge=1, le=500), verdict: str | None = None,
                          invite: str | None = None, has_email: bool | None = None, q: str | None = None, sort: str = "persona"):
    """F4: what "Enrich next N" will take. Usable leads whose company is not enriched yet, in the order of the current filter,
    but companies WITH a domain first (then persona `keep` first, then the chosen sort): the companies with no domain wait
    behind them (they are for "Retry domain"). One lead per company. `ns` = the sizes the buttons show a count for;
    `take` = also return the lead ids of the first N companies (what the click runs)."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        _, qq = _lead_filter(s, campaign_id=cid, status="new", verdict=verdict, invite=invite, has_email=has_email, q=q,
                             enriched="no", domain=None)
        second = {"name": MetroLead.full_name.asc(), "company": MetroLead.company_name.asc(), "newest": MetroLead.id.desc()}.get(sort, MetroLead.persona_score.desc())
        rows = (qq.with_entities(MetroLead.id, MetroLead.company_id, MetroCompany.domain)
                .order_by(case((MetroCompany.domain.isnot(None), 0), else_=1), case((MetroLead.persona_verdict == "keep", 0), else_=1), second, MetroLead.id).all())
        seen, picks = set(), []
        for lid, comp_id, dom in rows:
            if comp_id in seen:
                continue
            seen.add(comp_id)
            picks.append((lid, bool(dom)))

        def plan(n: int) -> dict:
            first = picks[:n]
            wd = sum(1 for _l, d in first if d)
            return {"n": n, "companies": len(first), "with_domain": wd, "without_domain": len(first) - wd}
        sizes = [int(x) for x in ns.split(",") if x.strip().isdigit()][:6]
        wd_all = sum(1 for _l, d in picks if d)
        out = {"pool": {"companies": len(picks), "with_domain": wd_all, "without_domain": len(picks) - wd_all},
               "plans": {str(n): plan(n) for n in sizes}}
        if take:
            out["lead_ids"] = [lid for lid, _d in picks[:take]]
            out["plan"] = plan(take)
        return out


@p1.get("/leads/ids")
def leads_ids(campaign_id: int | None = None, status: str | None = None, verdict: str | None = None,
              invite: str | None = None, has_email: bool | None = None, q: str | None = None,
              enriched: str | None = None, domain: str | None = None, limit: int = Query(5000, ge=1, le=20000)):
    """Every lead id the filters show (not just the loaded page): what a card button runs on when nothing is ticked."""
    with Session(get_engine()) as s:
        _, qq = _lead_filter(s, campaign_id=campaign_id, status=status, verdict=verdict, invite=invite,
                             has_email=has_email, q=q, enriched=enriched, domain=domain)
        total = qq.count()
        ids = [r[0] for r in qq.with_entities(MetroLead.id).order_by(MetroLead.id).limit(limit).all()]
        return {"total": total, "ids": ids, "truncated": total > len(ids)}


@p1.patch("/leads/{lead_id}")
def leads_patch(lead_id: int, body: LeadPatch):
    """A person's own call on layer 0: "keep anyway" or "mark junk". Rescoring never flips it afterwards."""
    with Session(get_engine()) as s:
        l = s.get(MetroLead, lead_id)
        if l is None:
            raise HTTPException(404, "no such lead")
        if l.status in ("suppressed", "previously_contacted"):
            raise HTTPException(400, "a suppressed or previously contacted lead cannot be changed here")
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
