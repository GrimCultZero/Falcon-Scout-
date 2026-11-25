"""Phase 2 routes: week mode and the Linked Helper gate, LinkedIn accounts, the extension's job queue, enrichment
runs, scores and the shortlist, hooks, the email-finder round trip. Included into the /metro router by router.py.
Nothing here sends a message; nothing here visits a page itself (the extension does, when the gate lets it).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import emailfinder as ef
from . import enrich as en
from . import gate
from . import hooks as hk
from . import progress
from . import results as rs
from . import scoring as sc
from .db import (MetroCampaign, MetroCompany, MetroLead, MetroScrapeJob, MetroSender, MetroSetting, get_engine, get_setting,
                 put_setting, read_settings, utcnow)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
p2 = APIRouter()

# Settings a person may change from the UI, with their checks. Everything else is read only.
EDITABLE = {
    "scrape_cap_per_day": lambda v: isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= gate.HARD_MAX_VISITS,
    "shortlist_min_fit": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100,
    "linked_helper_process_names": lambda v: isinstance(v, list) and v and all(isinstance(x, str) and x.strip() for x in v),
    "cache_days": lambda v: isinstance(v, dict) and all(isinstance(x, int) and 1 <= x <= 365 for x in v.values()),
    "pagespeed_api_key": lambda v: v is None or (isinstance(v, str) and len(v) <= 200),
}


def _err(e: gate.GateError) -> HTTPException:
    return HTTPException(e.status, {"message": str(e), **e.extra} if e.extra else str(e))


def _campaign(s: Session, cid: int) -> MetroCampaign:
    c = s.get(MetroCampaign, cid)
    if c is None:
        raise HTTPException(404, "no such campaign")
    return c


# ───────────────────────── settings (the editable few) ─────────────────────────

class SettingsIn(BaseModel):
    values: dict


@p2.put("/settings")
def settings_put(body: SettingsIn):
    with Session(get_engine()) as s:
        for k, v in body.values.items():
            if k not in EDITABLE:
                raise HTTPException(400, f"{k} cannot be changed here")
            if not EDITABLE[k](v):
                raise HTTPException(400, f"{k}: not a valid value")
            put_setting(s, k, v)
        s.commit()
        return read_settings(s)


# ───────────────────────── week mode ─────────────────────────

class WeekIn(BaseModel):
    mode: str
    confirmed: bool = False


@p2.get("/week")
def week_get():
    """The header chips: the week mode and today's LinkedIn visits against the cap."""
    with Session(get_engine()) as s:
        return {"week_mode": gate.week_mode(s), **gate.totals_today(s)}


@p2.get("/week/check")
def week_check():
    """What the confirm pop-up shows before a switch to a Metro week: is Linked Helper running?"""
    with Session(get_engine()) as s:
        try:
            running = gate.linked_helper_running(s)
            return {"readable": True, "linked_helper_running": running}
        except Exception as e:
            return {"readable": False, "linked_helper_running": [], "error": type(e).__name__}


@p2.put("/week")
def week_put(body: WeekIn):
    with Session(get_engine()) as s:
        try:
            return {**gate.set_week_mode(s, body.mode, confirmed=body.confirmed), **gate.totals_today(s)}
        except gate.GateError as e:
            raise _err(e)


# ───────────────────────── accounts and the job queue (called by the extension) ─────────────────────────

class RegisterIn(BaseModel):
    account_ref: str
    label: str | None = None
    chrome_profile: str | None = None


class AccountPatch(BaseModel):
    role: str | None = None
    daily_cap: int | None = None
    active: bool | None = None


class ResultIn(BaseModel):
    sender_id: int
    result: dict | None = None
    error: str | None = None


@p2.get("/accounts")
def accounts_list():
    with Session(get_engine()) as s:
        return {"accounts": [gate.sender_dict(s, r) for r in s.query(MetroSender).filter_by(kind="linkedin").order_by(MetroSender.id).all()],
                **gate.totals_today(s)}


@p2.post("/accounts/register")
def accounts_register(body: RegisterIn):
    with Session(get_engine()) as s:
        try:
            return gate.sender_dict(s, gate.register_account(s, account_ref=body.account_ref, label=body.label,
                                                             chrome_profile=body.chrome_profile))
        except gate.GateError as e:
            raise _err(e)


@p2.patch("/accounts/{sender_id}")
def accounts_patch(sender_id: int, body: AccountPatch):
    with Session(get_engine()) as s:
        try:
            r = gate.update_account(s, sender_id, role=body.role, daily_cap=body.daily_cap, active=body.active,
                                    set_cap="daily_cap" in body.model_fields_set)
            return gate.sender_dict(s, r)
        except gate.GateError as e:
            raise _err(e)


@p2.get("/jobs/next")
def jobs_next(sender_id: int, kinds: str = ""):
    with Session(get_engine()) as s:
        want = [k for k in kinds.split(",") if k] or None
        return gate.next_job(s, sender_id, want)


@p2.post("/jobs/{job_id}/result")
def jobs_result(job_id: int, body: ResultIn):
    with Session(get_engine()) as s:
        try:
            return rs.complete_job(s, job_id, body.sender_id, result=body.result, error=body.error)
        except gate.GateError as e:
            raise _err(e)


@p2.get("/jobs")
def jobs_summary(campaign_id: int | None = None):
    with Session(get_engine()) as s:
        q = s.query(MetroScrapeJob.kind, MetroScrapeJob.status)
        if campaign_id is not None:
            q = q.filter(MetroScrapeJob.campaign_id == campaign_id)
        out: dict = {}
        for kind, status in q.all():
            out.setdefault(kind, {}).setdefault(status, 0)
            out[kind][status] += 1
        return {"jobs": out, "week_mode": gate.week_mode(s)}


# ───────────────────────── enrichment, scores, shortlist ─────────────────────────

class RunIn(BaseModel):
    lead_ids: list[int] | None = None         # None = the whole campaign (API callers); the app always sends the rows it shows
    limit: int | None = None
    use_ai: bool = True
    shortlist_only: bool = False              # hooks: keep only the shortlisted among lead_ids


@p2.post("/campaigns/{cid}/enrich")
def campaign_enrich(cid: int, body: RunIn | None = None):
    """Steps 1-3 for the campaign's usable leads' companies (background; one run at a time; paced; cached per domain)."""
    body = body or RunIn()
    with Session(get_engine()) as s:
        _campaign(s, cid)
    return en.start_run(cid, body.lead_ids, ask=None, use_ai=body.use_ai, limit=body.limit)


@p2.get("/enrich/status")
def enrich_status():
    return {"enrich": en.status(), "hooks": hk.hooks_status()}


@p2.get("/progress")
def progress_get(campaign_id: int | None = None):
    """Every long action: running ones first, then the recently finished, each with counts, the current item and step,
    elapsed time and an estimate. The page only draws this; a reloaded tab shows a run that is still going."""
    return progress.snapshot(campaign_id)


@p2.post("/progress/{run_id}/stop")
def progress_stop(run_id: str):
    if not progress.request_stop(run_id):
        raise HTTPException(409, "this run cannot be stopped (it is finished, or it has no stop)")
    return {"stopping": True}


class RetryIn(BaseModel):
    lead_ids: list[int]


@p2.post("/campaigns/{cid}/retry-domain")
def campaign_retry_domain(cid: int, body: RetryIn):
    """"Retry domain": run the domain finder again for the companies of these leads that still have no domain. Companies
    with a domain are left alone. Goes through the same run (progress, stop) as Enrich."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        picked, seen = [], set()
        for l in s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.id.in_(body.lead_ids), MetroLead.status == "new",
                                           MetroLead.company_id.isnot(None)).order_by(MetroLead.persona_score.desc()).all():
            comp = s.get(MetroCompany, l.company_id)
            if comp is not None and not comp.domain and comp.id not in seen:
                seen.add(comp.id)
                picked.append(l.id)
                comp.enrich_tried_at = None
        s.commit()
    if not picked:
        return {"started": False, "reason": "every company in this selection already has a domain"}
    return en.start_run(cid, picked)


@p2.post("/enrich/stop")
def enrich_stop():
    en.stop()
    return {"stopping": True}


@p2.post("/campaigns/{cid}/score")
def campaign_score(cid: int, body: RunIn | None = None):
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        n = len(body.lead_ids) if body and body.lead_ids is not None else 0
        with progress.track("score", "Scoring fit (layers 1 and 2)", campaign_id=cid, total=0) as t:
            r = sc.score_campaign(s, c, lead_ids=(body.lead_ids if body else None))
            t["result"] = f"Scored fit for {r['scored']} lead(s)"
            return r


@p2.post("/campaigns/{cid}/deep")
def campaign_deep(cid: int, body: RunIn | None = None):
    """Queue layer 2 readings (LinkedIn pages, Ahrefs for niche) for the shortlist. They run only in a Metro week."""
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        r = en.queue_deep(s, c, (body or RunIn()).lead_ids)
        r["progress_id"] = en.follow_jobs(cid, r.get("job_ids") or [])
        return r


def shortlist_dict(s: Session, l: MetroLead, hook_counts: dict) -> dict:
    notes = json.loads(l.score_notes_json or "{}")
    comp = s.get(MetroCompany, l.company_id) if l.company_id else None
    return {"id": l.id, "full_name": l.full_name, "title": l.title, "company_name": l.company_name,
            "domain": comp.domain if comp else None, "domain_source": comp.domain_source if comp else None,
            "persona_score": l.persona_score, "fit_score": l.fit_score, "deep_score": l.deep_score,
            "fit_matched": [m["label"] for m in (notes.get("fit") or {}).get("matched", [])],
            "fit_coverage": (notes.get("fit") or {}).get("coverage"), "deep_coverage": (notes.get("deep") or {}).get("coverage"),
            "hooks": hook_counts.get(l.id, 0), "angle": notes.get("angle"), "case_tag": notes.get("case_tag"),
            "email": l.email, "email_status": l.email_status, "email_source": l.email_source,
            "invite_status": l.invite_status, "profile_url": l.profile_url}


@p2.get("/campaigns/{cid}/shortlist")
def campaign_shortlist(cid: int, min_fit: float | None = None, limit: int = Query(200, ge=1, le=1000)):
    from sqlalchemy import func
    from .db import MetroHook
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        threshold = float(min_fit if min_fit is not None else get_setting(s, "shortlist_min_fit", 50))
        leads = [l for l in s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.status == "new").all()
                 if sc.shortlist_filter(l, threshold)]
        leads.sort(key=lambda l: (-(l.fit_score or 0), -(l.deep_score or 0), -(l.persona_score or 0)))
        counts = dict(s.query(MetroHook.lead_id, func.count()).filter(MetroHook.lead_id.in_([l.id for l in leads]) if leads else False)
                      .group_by(MetroHook.lead_id).all()) if leads else {}
        total_new = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.status == "new").count()
        measured = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.status == "new", MetroLead.fit_score.isnot(None)).count()
        return {"campaign": {"id": c.id, "type": c.type, "name": c.name}, "min_fit": threshold, "total_usable": total_new,
                "measured": measured, "shortlisted": len(leads),
                "leads": [shortlist_dict(s, l, counts) for l in leads[:limit]]}


@p2.get("/leads/{lead_id}/evidence")
def lead_evidence(lead_id: int):
    """Everything stored about a lead's company, the numbered evidence the hooks are built from, and the hooks."""
    with Session(get_engine()) as s:
        l = s.get(MetroLead, lead_id)
        if l is None:
            raise HTTPException(404, "no such lead")
        comp = s.get(MetroCompany, l.company_id) if l.company_id else None
        ev = hk.build_evidence(s, l, comp)
        notes = json.loads(l.score_notes_json or "{}")
        return {"lead_id": l.id, "evidence": ev, "hooks": hk.hooks_for(s, l.id), "angle": notes.get("angle"),
                "case_tag": notes.get("case_tag"), "fit": notes.get("fit"), "deep": notes.get("deep")}


@p2.post("/campaigns/{cid}/hooks")
def campaign_hooks(cid: int, body: RunIn | None = None):
    """Step 7: hooks, angle and case tag for the shortlisted leads (or the given ones), through /claude, in the background."""
    body = body or RunIn()
    with Session(get_engine()) as s:
        c = _campaign(s, cid)
        threshold = float(get_setting(s, "shortlist_min_fit", 50))
        q = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.status == "new")
        if body.lead_ids is not None:
            q = q.filter(MetroLead.id.in_(body.lead_ids))
        # ticked leads are the person's own choice (they bypass the threshold); rows merely shown are shortlisted only
        explicit = body.lead_ids is not None and not body.shortlist_only
        ids = [l.id for l in q.all() if sc.shortlist_filter(l, threshold) or explicit]
        if body.limit:
            ids = ids[:body.limit]
    if not ids:
        return {"started": False, "reason": "no shortlisted leads (score the campaign first)"}
    return hk.start_hooks_run(cid, ids)


# ───────────────────────── fit rules ─────────────────────────

@p2.get("/fit-rules")
def fit_rules_get():
    with Session(get_engine()) as s:
        return {"rules": sc.rules_of(s), "defaults": sc.DEFAULT_RULES}


@p2.put("/fit-rules")
def fit_rules_put(rules: dict):
    errs = sc.validate_rules(rules)
    if errs:
        raise HTTPException(400, "; ".join(errs))
    with Session(get_engine()) as s:
        put_setting(s, "fit_rules", sc.merge_rules(rules))
        s.commit()
        return {"rules": sc.rules_of(s)}


# ───────────────────────── email finder round trip ─────────────────────────

class EmailMark(BaseModel):
    status: str


@p2.get("/campaigns/{cid}/email-export")
def email_export(cid: int, include_with_email: bool = False, shortlist_only: bool = True):
    """The Linked Helper list for its email finder: usable shortlisted leads without an email."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        threshold = float(get_setting(s, "shortlist_min_fit", 50))
        leads = s.query(MetroLead).filter(MetroLead.campaign_id == cid).order_by(MetroLead.id).all()
        if shortlist_only:
            leads = [l for l in leads if sc.shortlist_filter(l, threshold)]
        text, info = ef.export_csv(leads, include_with_email=include_with_email)
        headers = {"Content-Disposition": f'attachment; filename="metro-email-finder-campaign-{cid}.csv"',
                   "X-Metro-Exported": str(info["exported"]), "X-Metro-Skipped": json.dumps(info["skipped"])}
        return Response(content=text.encode("utf-8"), media_type="text/csv; charset=utf-8", headers=headers)


class EmailScopeIn(BaseModel):
    lead_ids: list[int]
    shortlist_only: bool = True               # rows merely shown: the shortlisted ones; ticked rows are the person's own choice
    include_with_email: bool = False


def _scoped_leads(s: Session, cid: int, body: EmailScopeIn) -> list[MetroLead]:
    threshold = float(get_setting(s, "shortlist_min_fit", 50))
    leads = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.id.in_(body.lead_ids)).order_by(MetroLead.id).all() if body.lead_ids else []
    if body.shortlist_only:
        leads = [l for l in leads if sc.shortlist_filter(l, threshold)]
    return leads


@p2.post("/campaigns/{cid}/email-export")
def email_export_scoped(cid: int, body: EmailScopeIn):
    """The Linked Helper list for the rows the person sees: ticked rows, else the shown rows that are shortlisted."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        text, info = ef.export_csv(_scoped_leads(s, cid, body), include_with_email=body.include_with_email)
        headers = {"Content-Disposition": f'attachment; filename="metro-email-finder-campaign-{cid}.csv"',
                   "X-Metro-Exported": str(info["exported"]), "X-Metro-Skipped": json.dumps(info["skipped"])}
        return Response(content=text.encode("utf-8"), media_type="text/csv; charset=utf-8", headers=headers)


@p2.post("/campaigns/{cid}/email-export/preview")
def email_export_preview_scoped(cid: int, body: EmailScopeIn):
    with Session(get_engine()) as s:
        _campaign(s, cid)
        _, info = ef.export_csv(_scoped_leads(s, cid, body), include_with_email=body.include_with_email)
        return {**info, "columns": ef.EXPORT_COLUMNS}


@p2.get("/campaigns/{cid}/email-export/preview")
def email_export_preview(cid: int, include_with_email: bool = False, shortlist_only: bool = True):
    with Session(get_engine()) as s:
        _campaign(s, cid)
        threshold = float(get_setting(s, "shortlist_min_fit", 50))
        leads = s.query(MetroLead).filter(MetroLead.campaign_id == cid).all()
        if shortlist_only:
            leads = [l for l in leads if sc.shortlist_filter(l, threshold)]
        _, info = ef.export_csv(leads, include_with_email=include_with_email)
        return {**info, "columns": ef.EXPORT_COLUMNS}


@p2.post("/campaigns/{cid}/email-import")
async def email_import(cid: int, file: UploadFile = File(...), source: str = Query("linkedhelper"), dry_run: bool = Query(True)):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large")
    from starlette.concurrency import run_in_threadpool

    def work():
        with Session(get_engine()) as s:
            _campaign(s, cid)
            try:
                if dry_run:
                    return ef.import_results(s, raw, campaign_id=cid, source=source, filename=file.filename, dry_run=True)
                with progress.track("email-import", f"Importing emails from {file.filename or 'a file'}", campaign_id=cid) as t:
                    r = ef.import_results(s, raw, campaign_id=cid, source=source, filename=file.filename, dry_run=False)
                    t["result"] = f"Emails imported: {r.get('stored', 0)} stored, {r.get('no_matching_lead', 0)} without a matching lead"
                    return r
            except ValueError as e:
                raise HTTPException(400, str(e))
    return await run_in_threadpool(work)


@p2.post("/campaigns/{cid}/email-check")
def email_check(cid: int):
    """The free domain check (syntax + DNS). Never marks an address verified."""
    with Session(get_engine()) as s:
        _campaign(s, cid)
        leads = s.query(MetroLead).filter(MetroLead.campaign_id == cid, MetroLead.email.isnot(None)).all()
        return ef.check_emails(s, leads)


@p2.post("/leads/{lead_id}/email-status")
def email_status(lead_id: int, body: EmailMark):
    with Session(get_engine()) as s:
        l = s.get(MetroLead, lead_id)
        if l is None:
            raise HTTPException(404, "no such lead")
        try:
            ef.mark_email(s, l, body.status)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"id": l.id, "email": l.email, "email_status": l.email_status, "emailable": ef.emailable(l)}
