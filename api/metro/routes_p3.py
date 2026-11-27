"""Phase 3 routes: case pages, chains (write, review, edit, approve, send anyway), the lead panel, the exports.
Included into the /metro router by router.py. Nothing here sends a message: exports hand a file to Oleh.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import accounts, cases, chains, exports, progress
from . import evidence as evm
from . import hooks as hk
from . import scoring as sc
from .db import MetroCampaign, MetroCaseLink, MetroCompany, MetroLead, MetroTouch, get_engine, get_setting
from .emailfinder import email_kind, email_sendable
from .filenames import content_disposition, download_name

p3 = APIRouter()


def _campaign(s: Session, cid: int) -> MetroCampaign:
    c = s.get(MetroCampaign, cid)
    if c is None:
        raise HTTPException(404, "no such campaign")
    return c


def _lead(s: Session, lid: int) -> MetroLead:
    l = s.get(MetroLead, lid)
    if l is None:
        raise HTTPException(404, "no such lead")
    return l


# ───────────────────────── case pages ─────────────────────────

@p3.get("/cases")
def cases_list():
    with Session(get_engine()) as s:
        rows = s.query(MetroCaseLink).order_by(MetroCaseLink.id).all()
        tags = sorted({t for r in rows for t in (r.industry_tags or "").split(", ") if t})
        return {"total": len(rows), "industry_tags": tags, "cases": [cases.case_dict(r) for r in rows]}


@p3.post("/cases/import")
async def cases_import():
    """Read itforce.ua/en/cases (the listing pages only) and store every English case with its tags. Adds and updates, never deletes."""
    def work():
        with Session(get_engine()) as s, progress.track("cases", "Importing IT Force case pages") as t:
            r = cases.import_cases(s)
            if not r.get("ok"):
                t["result"] = f"Case pages not imported: {r.get('error')}"
                return r
            from . import lines as _l
            t["result"] = _l.line(f"Case pages: {r['total']} stored", _l.part(r["added"], "new", "new"), _l.part(r["updated"], "updated", "updated"))
            return r
    return await run_in_threadpool(work)


# ───────────────────────── the lead table's Phase 3 cells and the panel ─────────────────────────

def channels_of(l: MetroLead) -> dict:
    """The Channels cell: email business / personal / none (and whether it is sendable), LinkedIn connected / invited / not,
    Open Profile."""
    kind = email_kind(l)
    return {"email": kind or "none", "email_sendable": email_sendable(l), "email_status": l.email_status,
            "linkedin": {"connected": "connected", "invited": "invited"}.get(l.invite_status, "not"), "open_profile": bool(l.open_profile)}


def p3_cells(s: Session, leads: list[MetroLead]) -> dict[int, dict]:
    """{lead_id: {channels, hooks, chain, account_role, primary_lead_id}} for the table, in a few queries."""
    counts = hk.hook_counts(s, leads)
    ids = [l.id for l in leads]
    by_lead: dict[int, list[MetroTouch]] = {}
    if ids:
        for t in s.query(MetroTouch).filter(MetroTouch.lead_id.in_(ids), MetroTouch.status != "cancelled").order_by(MetroTouch.step).all():
            by_lead.setdefault(t.lead_id, []).append(t)
    out = {}
    for l in leads:
        ts = [t for t in by_lead.get(l.id, []) if t.cycle == l.current_cycle]
        out[l.id] = {"channels": channels_of(l), "hooks": counts.get(l.id, 0), "chain": chains.chain_status(s, l, ts),
                     "account_role": l.account_role, "primary_lead_id": l.primary_lead_id}
    return out


@p3.get("/leads/{lead_id}/panel")
def lead_panel(lead_id: int):
    """The side panel: a short summary of everything known, the hooks with their evidence, the chain in send order."""
    with Session(get_engine()) as s:
        l = _lead(s, lead_id)
        camp = s.get(MetroCampaign, l.campaign_id) if l.campaign_id else None
        comp = s.get(MetroCompany, l.company_id) if l.company_id else None
        if chains.ensure_intro(s, l):           # P3b: accepted since the wave was written: the LinkedIn intro joins it
            s.commit()
        if camp is not None and l.chain_written_at and not l.chain_approved_at:
            chains.recheck(s, l, camp)          # the flags shown are today's checks (a rules change, a colleague's chain)
            s.commit()
        notes = json.loads(l.score_notes_json or "{}")
        group = hk.colleagues(s, l)
        seg = hk.segment_of(camp) if camp else "niche"
        scan = json.loads(comp.website_scan_json) if comp is not None and comp.website_scan_json else {}
        facts = {"domain": comp.domain if comp else None, "industry": comp.industry if comp else None, "logo": comp.logo_data if comp else None,
                 "sells": (scan.get("services") or [])[:12] if scan.get("ok") else [],
                 "industries": (scan.get("industries") or [])[:10] if scan.get("ok") else [],
                 "niches": list((scan.get("niches") or {}).keys())[:6] if scan.get("ok") else [],
                 "partners": evm.website_for_evidence(scan).get("partners") or [] if scan.get("ok") else [],
                 "case_studies": (scan.get("case_studies") or [])[:6] if scan.get("ok") else [],
                 "careers": scan.get("careers") if scan.get("ok") else None,
                 "founded": scan.get("founded_year") if scan.get("ok") else None,
                 "service_gap": evm.service_gap(scan) if scan else None}
        colleagues = [{"id": c.id, "full_name": c.full_name, "title": c.title, "account_role": c.account_role,
                       "chain": chains.chain_status(s, c)} for c in group if c.id != l.id]
        return {"lead": {"id": l.id, "full_name": l.full_name, "first_name": l.first_name, "title": l.title, "company_name": l.company_name,
                         "location": l.location, "profile_url": l.profile_url, "email": l.email, "persona_score": l.persona_score,
                         "persona_verdict": l.persona_verdict, "fit_score": l.fit_score, "status": l.status,
                         "account_role": l.account_role, "primary_lead_id": l.primary_lead_id, "channels": channels_of(l),
                         "segment": seg},
                "why_scored": [m["label"] for m in (notes.get("fit") or {}).get("matched", [])],
                "angle": notes.get("angle"), "case_tag": notes.get("case_tag"), "company": facts, "colleagues": colleagues,
                "hooks": hk.hooks_for(s, l.id), "chain": chains.chain_view(s, l)}


# ───────────────────────── writing chains ─────────────────────────

class WriteIn(BaseModel):
    lead_ids: list[int] | None = None


@p3.post("/campaigns/{cid}/chains")
def campaign_chains(cid: int, body: WriteIn | None = None):
    """Write chains for the shortlisted leads (or the given ones), one lead per call, in the background. One primary contact per
    company gets a chain; the colleagues are held."""
    body = body or WriteIn()
    with Session(get_engine()) as s:
        _campaign(s, cid)
        threshold = float(get_setting(s, "shortlist_min_fit", 50))
        q = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.status == "new")
        if body.lead_ids is not None:
            q = q.filter(MetroLead.id.in_(body.lead_ids))
            ids = [l.id for l in q.all()]
        else:
            ids = [l.id for l in q.all() if sc.shortlist_filter(l, threshold)]
    if not ids:
        return {"started": False, "reason": "no shortlisted leads (enrich and score the campaign first)"}
    return chains.start_chains_run(cid, ids)


@p3.get("/campaigns/{cid}/chains/summary")
def campaign_chains_summary(cid: int):
    """For the Write card: how many shortlisted leads, how many companies (= chains to write), and where the chains stand."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        threshold = float(get_setting(s, "shortlist_min_fit", 50))
        leads = [l for l in s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.status == "new").all()
                 if sc.shortlist_filter(l, threshold)]
        cells = p3_cells(s, leads)
        states: dict[str, int] = {}
        for c in cells.values():
            states[c["chain"]["state"]] = states.get(c["chain"]["state"], 0) + 1
        companies = len({l.company_id or f"l{l.id}" for l in leads})
        approved = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.chain_approved_at.isnot(None)).count()
        drafts = sum(1 for c in cells.values() if c["chain"]["state"] in ("written", "issues"))
        from . import logos as _logos
        logos_missing = len(_logos.missing(s, cid))
        return {"shortlisted": len(leads), "companies": companies, "states": states, "approved": approved, "drafts": drafts,
                "hooks_written": sum(1 for c in cells.values() if c["hooks"] > 0),
                "hook_companies": len({l.company_id or f"l{l.id}" for l in leads if cells[l.id]["hooks"] > 0}), "logos_missing": logos_missing}


@p3.post("/leads/{lead_id}/chain")
def lead_chain_write(lead_id: int):
    """(Re)write ONE lead's chain now, in the background (the panel's Rewrite button)."""
    with Session(get_engine()) as s:
        l = _lead(s, lead_id)
        cid = l.campaign_id
    return chains.start_chains_run(cid, [lead_id])


@p3.post("/campaigns/{cid}/logos")
def campaign_logos(cid: int):
    """P3b #2: read the logos of the campaign's companies that have a website and no logo yet (their own site only, paced,
    in the background). New enrich runs read the logo by themselves."""
    from . import logos
    return logos.start_logos_run(cid)


@p3.get("/leads/{lead_id}/cases")
def lead_cases(lead_id: int):
    """"Change case": the IT Force cases matching the agency's client niche AND the service first, then all the others."""
    with Session(get_engine()) as s:
        return chains.case_options(s, _lead(s, lead_id))


class CaseIn(BaseModel):
    case_id: int | None = None


@p3.post("/leads/{lead_id}/chain/case")
def lead_chain_case(lead_id: int, body: CaseIn):
    """Put the chosen case under the approach email (a draft) and keep it for later rewrites; case_id null = the automatic match."""
    with Session(get_engine()) as s:
        l = _lead(s, lead_id)
        try:
            r = chains.set_case(s, l, body.case_id)
        except ValueError as e:
            raise HTTPException(409, str(e))
        camp = s.get(MetroCampaign, l.campaign_id)
        if camp is not None and l.chain_written_at:
            chains.recheck(s, l, camp)
            s.commit()
        return {**r, "chain": chains.chain_view(s, l)}


class TouchIn(BaseModel):
    body: str | None = None
    subject: str | None = None


@p3.put("/touches/{touch_id}")
def touch_edit(touch_id: int, body: TouchIn):
    with Session(get_engine()) as s:
        t = s.get(MetroTouch, touch_id)
        if t is None:
            raise HTTPException(404, "no such touch")
        try:
            res = chains.edit_touch(s, t, body=body.body, subject=body.subject)
        except ValueError as e:
            raise HTTPException(409, str(e))
        l = s.get(MetroLead, t.lead_id)
        return {"ok": res["ok"], "chain": chains.chain_view(s, l)}


class ApproveIn(BaseModel):
    send_anyway: bool = False


@p3.post("/leads/{lead_id}/chain/approve")
def lead_chain_approve(lead_id: int, body: ApproveIn | None = None):
    with Session(get_engine()) as s:
        l = _lead(s, lead_id)
        try:
            r = chains.approve(s, l, send_anyway=bool(body and body.send_anyway))
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {**r, "chain": chains.chain_view(s, l)}


@p3.post("/leads/{lead_id}/chain/unapprove")
def lead_chain_unapprove(lead_id: int):
    with Session(get_engine()) as s:
        l = _lead(s, lead_id)
        r = chains.unapprove(s, l)
        return {**r, "chain": chains.chain_view(s, l)}


@p3.post("/leads/{lead_id}/primary")
def lead_make_primary(lead_id: int):
    """Make this lead its company's primary contact (the others are held; the old primary's draft chain is cleared)."""
    with Session(get_engine()) as s:
        l = _lead(s, lead_id)
        group = accounts.make_primary(s, l)
        s.commit()
        return {"primary": l.id, "held": [g.id for g in group if g.id != l.id]}


# ───────────────────────── exports ─────────────────────────

@p3.get("/campaigns/{cid}/export/linkedhelper")
def export_linkedhelper(cid: int, lead_ids: str | None = Query(None)):
    ids = [int(x) for x in lead_ids.split(",") if x.strip()] if lead_ids else None
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        text, info = exports.linkedhelper_csv(s, cid, ids)
        if not info["leads"]:
            raise HTTPException(409, "no approved chain with a LinkedIn message (approve chains first)")
        name = download_name(c.name, "linked-helper-messages")
        return Response(text, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": content_disposition(name), "X-Metro-Info": json.dumps(info), "X-Metro-Filename": name})


@p3.get("/campaigns/{cid}/export/email")
def export_email(cid: int, lead_ids: str | None = Query(None)):
    ids = [int(x) for x in lead_ids.split(",") if x.strip()] if lead_ids else None
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        text, info = exports.email_csv(s, cid, ids)
        if not info["emails"]:
            why = f" ({info['no_sendable_address']} approved without a sendable address)" if info["no_sendable_address"] else ""
            raise HTTPException(409, f"no approved chain with an email to a sendable address{why}")
        name = download_name(c.name, "email-chains")
        return Response(text, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": content_disposition(name), "X-Metro-Info": json.dumps(info), "X-Metro-Filename": name})
