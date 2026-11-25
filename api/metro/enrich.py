"""Enrichment orchestration (METRO_PLAN.md Phase 2, steps 1-3 and the queueing for 4-5).

Per company, in this order, each step paced and cached per domain:

  1. domain        CSV -> email-finder export -> AI lookup (verified against the site) -> LinkedIn company page
  2. website scan  webscan.scan_site (backend fetch, no LinkedIn)
  3. PageSpeed     mobile score (Google API, optional key)
     + browser jobs (queued for the extension; only issued in a Metro week): Ads Transparency, Business Profile

Every reading is a dated snapshot on `metro_companies` (`*_json` + `*_at`). A reading is reused until it is
older than its cache lifetime (Settings `cache_days`); a failed reading is retried after one day and never
overwrites a good one. Nothing here visits LinkedIn: LinkedIn pages are only QUEUED as jobs and the backend
gate decides when an account may take them.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Callable

from sqlalchemy.orm import Session

from . import aiclient, domainfinder as df, gate, pagespeed, progress, webscan
from .db import (MetroCampaign, MetroCompany, MetroLead, MetroScrapeJob, MetroSetting, get_engine, get_setting, put_setting, utcnow)

from .csvimport import FREE_MAIL          # one list for free-mail providers (F3 widened it)
GENERIC_NAME_WORDS = df.GENERIC_NAME_WORDS
FAILED_RETRY_DAYS = 1


# ───────────────────────── freshness ─────────────────────────

def fresh(at: datetime | None, days: int, *, ok: bool = True, now: datetime | None = None) -> bool:
    """A snapshot is reused while it is younger than `days` (a failed one: FAILED_RETRY_DAYS)."""
    if at is None:
        return False
    limit = days if ok else FAILED_RETRY_DAYS
    return (now or utcnow()) - at < timedelta(days=limit)


def _loads(v):
    try:
        return json.loads(v) if v else None
    except ValueError:
        return None


def snapshot_ok(raw: str | None) -> bool:
    j = _loads(raw)
    return bool(j and j.get("ok"))


# ───────────────────────── domain resolution ─────────────────────────
# The name rules live in domainfinder.py (F2); these names stay importable from here.
name_tokens = df.name_tokens
verify_domain_matches_name = df.verify_domain_matches_name


def candidate_from_email(leads: list[MetroLead]) -> tuple[str, str] | None:
    """A business-email domain from an email a finder or an export gave us: (domain, email_source)."""
    for l in leads:
        if l.email and l.email_source in ("linkedhelper", "apollo", "finder", "csv") and (l.email_type or "") != "personal":
            d = webscan.normalize_site(l.email.split("@")[-1])
            if d and d[0] not in FREE_MAIL:
                return d[0], l.email_source
    return None


def candidate_from_linkedin(company: MetroCompany) -> str | None:
    page = _loads(company.linkedin_page_json) or {}
    site = page.get("website")
    n = webscan.normalize_site(site) if site else None
    if n and "linkedin.com" not in n[0]:
        return n[0]
    return None


def ai_domain_candidate(company: MetroCompany, lead: MetroLead | None, ask: Callable[..., str] | None = None,
                        web: bool = True) -> tuple[str | None, str]:
    """Ask Sonnet, with web search when it is available, for the company's website. (candidate or None, the reason).
    The answer is only a CANDIDATE: resolve_domain stores it only after the site itself confirms the name."""
    return df.ai_lookup(company.name, country=company.country, location=lead.location if lead is not None else None,
                        title=lead.title if lead is not None else None, ask=ask or aiclient.ask, web=web)


def _location_of(leads: list[MetroLead]) -> str | None:
    for l in leads:
        if l.location:
            return l.location
    return None


def resolve_domain(s: Session, company: MetroCompany, leads: list[MetroLead], *, fetch: webscan.Fetcher,
                   ask: Callable[..., str] | None = None, use_ai: bool = True, sleep=time.sleep, pace: float = 3.0,
                   web: bool | None = None, use_patterns: bool = True) -> dict:
    """Step 1, cheapest first: stored domain -> email-finder business address -> the LinkedIn page already read ->
    name patterns (<= 6 paced fetches) -> AI lookup with web search. A guessed domain is stored only when its site
    carries the company name and is not parked. Returns {domain, source, tried: [strings], steps: [dicts]} and stores
    domain + source on the company when found. (The LinkedIn jobs of step d are queued by enrich_company.)"""
    if company.domain:
        return {"domain": company.domain, "source": company.domain_source, "tried": [], "steps": []}
    tried: list[str] = []
    steps: list[dict] = []

    def other_has(domain: str):
        return s.query(MetroCompany).filter(MetroCompany.domain == domain, MetroCompany.id != company.id).first()

    def take(domain: str, source: str):
        other = other_has(domain)
        if other is not None:
            tried.append(f"{source}: {domain} already belongs to company {other.id}")
            return None
        company.domain, company.domain_source = domain, source
        s.commit()
        return {"domain": domain, "source": source, "tried": tried, "steps": steps}

    # a. data we already hold
    c = candidate_from_email(leads)
    if c:
        tried.append("email-finder")
        got = take(c[0], "email-finder")
        steps.append({"step": "email-finder", "result": f"found {c[0]}" if got else "already used by another company"})
        if got:
            return got
    li = candidate_from_linkedin(company)
    if li:
        tried.append("linkedin")
        got = take(li, "linkedin")
        steps.append({"step": "linkedin", "result": f"found {li} on the company page" if got else "already used by another company"})
        if got:
            return got

    # b. name patterns
    if use_patterns:
        hit, entry = df.try_name_patterns(company.name, country=company.country, location=_location_of(leads), fetch=fetch,
                                          taken=lambda d: other_has(d) is not None, sleep=sleep, pace=pace)
        steps.append(entry)
        tried.append(f"name-pattern x{entry['tried']}: {entry['result']}")
        if hit:
            got = take(hit, "name-pattern")
            if got:
                return got

    # c. AI lookup, with web search where the app can do it
    if use_ai:
        if web is None:
            web, why_not = (True, "") if ask is not None else aiclient.web_search_available()
        else:
            why_not = "" if web else "web search is off"
        lead0 = leads[0] if leads else None
        cand, reason = ai_domain_candidate(company, lead0, ask, web=bool(web))
        mode = "web" if web else f"no web ({why_not})"
        if not cand:
            steps.append({"step": "ai", "result": reason, "mode": mode})
            tried.append(f"ai-lookup: {reason}")
        else:
            p = webscan.probe_home(cand, fetch)
            if not p.get("ok"):
                msg = f"{cand} rejected (the site did not answer)"
            elif p.get("parked"):
                msg = f"{cand} rejected (parked or for sale)"
            elif not df.verify_domain_matches_name(company.name, p, place=_location_of(leads), strict=False):
                msg = f"{cand} rejected (the site does not carry the company name)"
            else:
                msg = None
            if msg:
                steps.append({"step": "ai", "result": msg, "mode": mode})
                tried.append(f"ai-lookup: {msg}")
            else:
                got = take(cand, "ai-lookup")
                steps.append({"step": "ai", "result": f"found {cand}" if got else f"{cand} already used by another company", "mode": mode})
                if got:
                    return got
    return {"domain": None, "source": None, "tried": tried, "steps": steps}


def queue_linkedin_for_domain(s: Session, company: MetroCompany, leads: list[MetroLead], campaign: MetroCampaign | None) -> dict:
    """Step d. Only QUEUES; the gate decides when (Metro weeks only, counted against the visits). A `keep` lead's profile
    names the current company's LinkedIn page; the page names the website. Returns one trail entry."""
    cid = campaign.id if campaign else None
    if company.linkedin_url and not snapshot_ok(company.linkedin_page_json):
        if gate.enqueue(s, "linkedin_company", company.linkedin_url, company_id=company.id, campaign_id=cid):
            return {"step": "linkedin", "result": "queued the company page (Metro week only)"}
        return {"step": "linkedin", "result": "company page already queued"}
    if company.linkedin_url:
        return {"step": "linkedin", "result": "company page read, no website on it"}
    keep = [l for l in leads if l.persona_verdict == "keep" and l.profile_url and l.status == "new"]
    if not keep:
        return {"step": "linkedin", "result": "not queued (no persona-keep lead with a profile)"}
    lead = keep[0]
    raw = _loads(lead.raw_json) or {}
    if (raw.get("linkedin_profile") or {}).get("ok"):
        return {"step": "linkedin", "result": "profile read, no company page named"}
    if gate.enqueue(s, "linkedin_profile", lead.profile_url, company_id=company.id, lead_id=lead.id, campaign_id=cid):
        return {"step": "linkedin", "result": "queued the profile (Metro week only)"}
    return {"step": "linkedin", "result": "profile already queued"}


def store_trail(company: MetroCompany, steps: list[dict], now: datetime) -> None:
    company.domain_tried_json = json.dumps({"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "steps": steps}, ensure_ascii=False)


def trail_of(company: MetroCompany) -> dict | None:
    t = _loads(company.domain_tried_json)
    return t if isinstance(t, dict) else None


def domain_why(company: MetroCompany) -> str | None:
    """Why a company has no domain, in the words the table shows; None when it has one."""
    if company.domain:
        return None
    t = trail_of(company)
    return df.trail_text(t["steps"]) if t else "not tried yet"


# ───────────────────────── one company ─────────────────────────

def _cache_days(s: Session) -> dict:
    return get_setting(s, "cache_days", {}) or {}


def enrich_company(s: Session, company: MetroCompany, *, fetch: webscan.Fetcher, get_json: pagespeed.JsonGetter | None = None,
                   ask: Callable[..., str] | None = None, use_ai: bool = True, campaign: MetroCampaign | None = None,
                   queue_browser_jobs: bool = True, sleep=time.sleep, now: datetime | None = None,
                   web: bool | None = None, on_step: Callable[[str], None] | None = None) -> dict:
    """Steps 1-3 for one company; queues the browser-only readings. Returns what it did (for the progress view)."""
    now = now or utcnow()
    days = _cache_days(s)
    pace = float((get_setting(s, "pace_seconds", {}) or {}).get("web", 3))
    out: dict = {"company_id": company.id, "name": company.name, "did": [], "skipped": []}
    leads = s.query(MetroLead).filter_by(company_id=company.id).order_by(MetroLead.persona_score.desc()).all()
    step = on_step or (lambda _x: None)

    company.enrich_tried_at = now            # attempted: "Enrich next N" never picks this company again
    had_domain = bool(company.domain)
    step("reading the site" if had_domain else "finding the website")
    r = resolve_domain(s, company, leads, fetch=fetch, ask=ask, use_ai=use_ai, sleep=sleep, pace=pace, web=web)
    out["domain"], out["domain_source"] = r["domain"], r["source"]
    out["domain_new"] = bool(company.domain) and not had_domain
    if r["tried"]:
        out["domain_tried"] = r["tried"]
    if not company.domain:
        out["skipped"].append("no domain")
        steps = list(r["steps"])
        if queue_browser_jobs:
            li = queue_linkedin_for_domain(s, company, leads, campaign)
            steps.append(li)
            if li["result"].startswith("queued"):
                out["did"].append("LinkedIn: " + li["result"])
        store_trail(company, steps, now)
        out["domain_why"] = df.trail_text(steps)
        s.commit()
        return out
    if r["steps"]:
        store_trail(company, r["steps"], now)
    dom = company.domain

    # step 2: website scan
    step("website scan")
    if not fresh(company.website_scan_at, int(days.get("website", 30)), ok=snapshot_ok(company.website_scan_json), now=now):
        scan = webscan.scan_site(dom, fetch, sleep=sleep, pace=pace)
        if scan.get("ok") or not snapshot_ok(company.website_scan_json):    # a failure never replaces a good reading
            company.website_scan_json, company.website_scan_at = json.dumps(scan, ensure_ascii=False), now
        out["did"].append("website scan" + ("" if scan.get("ok") else " (site did not answer)"))
    else:
        out["skipped"].append("website scan is fresh")
    s.commit()

    # step 3a: PageSpeed (only for a site that answered)
    scan_ok = snapshot_ok(company.website_scan_json)
    if scan_ok and get_json is not None:
        step("PageSpeed")
        if not fresh(company.pagespeed_at, int(days.get("pagespeed", 14)), ok=snapshot_ok(company.pagespeed_json), now=now):
            key_row = s.get(MetroSetting, "pagespeed_api_key")
            key = json.loads(key_row.value_json) if key_row else None
            snap = pagespeed.measure(f"https://{dom}/", get_json, key or None)
            if snap.get("ok") or not snapshot_ok(company.pagespeed_json):
                company.pagespeed_json, company.pagespeed_at = json.dumps(snap), now
            out["did"].append("PageSpeed" + ("" if snap.get("ok") else f" failed ({snap.get('error')})"))
            sleep(float((get_setting(s, "pace_seconds", {}) or {}).get("pagespeed", 2)))
        else:
            out["skipped"].append("PageSpeed is fresh")
        s.commit()

    # step 3b: browser-only readings, queued (the gate hands them out only in a Metro week)
    if queue_browser_jobs and scan_ok:
        cid = campaign.id if campaign else None
        if not fresh(company.ads_at, int(days.get("ads", 14)), ok=snapshot_ok(company.ads_json), now=now):
            if gate.enqueue(s, "ads_transparency", dom, company_id=company.id, campaign_id=cid):
                out["did"].append("queued Ads Transparency")
        if not fresh(company.gbp_at, int(days.get("gbp", 30)), ok=snapshot_ok(company.gbp_json), now=now):
            q = " ".join(x for x in (company.name, company.country or (leads[0].location if leads else "")) if x)
            if gate.enqueue(s, "gbp", q.strip(), company_id=company.id, campaign_id=cid):
                out["did"].append("queued Business Profile")
        s.commit()
    return out


# ───────────────────────── a run over a campaign (background) ─────────────────────────

class Run:
    """One enrichment run at a time; progress is in memory (the snapshots themselves are the durable state)."""
    lock = threading.Lock()
    state: dict = {"running": False}
    stop_flag = threading.Event()


def status() -> dict:
    return dict(Run.state)


def stop() -> None:
    Run.stop_flag.set()


def _company_ids(s: Session, campaign_id: int, lead_ids: list[int] | None) -> list[int]:
    q = s.query(MetroLead.company_id).filter(MetroLead.campaign_id == campaign_id, MetroLead.status == "new",
                                             MetroLead.company_id.isnot(None))
    if lead_ids is not None:             # an explicit (possibly empty) list is the scope; None = the whole campaign (API only)
        q = q.filter(MetroLead.id.in_(lead_ids))
    seen, out = set(), []
    for (cid,) in q.order_by(MetroLead.persona_score.desc()).all():
        if cid not in seen:
            seen.add(cid)
            out.append(cid)
    return out


def start_run(campaign_id: int, lead_ids: list[int] | None = None, *, fetch: webscan.Fetcher | None = None,
              get_json: pagespeed.JsonGetter | None = None, ask=None, use_ai: bool = True, background: bool = True,
              limit: int | None = None, sleep=time.sleep, web: bool | None = None) -> dict:
    """Start enrichment for a campaign's `new` leads (or only the given ones). Refuses a second run.
    Progress is the backend's (progress.py); the companies this run touches are marked for the "just enriched" filter."""
    with Run.lock:
        if Run.state.get("running"):
            return {"started": False, "reason": "a run is already going", **Run.state}
        with Session(get_engine()) as s:
            ids = _company_ids(s, campaign_id, lead_ids)
            if limit:
                ids = ids[:limit]
            started = utcnow()
            put_setting(s, "last_enrich_run", {"campaign_id": campaign_id, "started_at": started.strftime("%Y-%m-%dT%H:%M:%S"),
                                               "companies": len(ids)})
            s.commit()
        Run.stop_flag.clear()
        rid = progress.start("enrich", "Enriching", total=len(ids), campaign_id=campaign_id, stop=stop)
        Run.state = {"running": True, "campaign_id": campaign_id, "total": len(ids), "done": 0, "failed": 0,
                     "started_at": started.isoformat(), "current": None, "log": [], "progress_id": rid,
                     "domains_found": 0, "domains_had": 0, "domains_missing": 0}
    fetch = fetch or webscan.http_fetcher()
    get_json = get_json or pagespeed.http_json_getter()

    def work():
        try:
            for cid in ids:
                if Run.stop_flag.is_set():
                    Run.state["stopped"] = True
                    break
                with Session(get_engine()) as s:
                    comp = s.get(MetroCompany, cid)
                    camp = s.get(MetroCampaign, campaign_id)
                    Run.state["current"] = comp.name if comp else cid
                    progress.update(rid, current=comp.name if comp else str(cid), step="starting")
                    try:
                        res = enrich_company(s, comp, fetch=fetch, get_json=get_json, ask=ask, use_ai=use_ai, campaign=camp, sleep=sleep,
                                             web=web, on_step=lambda st: progress.update(rid, step=st))
                        Run.state["log"] = (Run.state["log"] + [res])[-30:]
                        if res.get("domain_new"):
                            Run.state["domains_found"] += 1
                        elif res.get("domain"):
                            Run.state["domains_had"] += 1
                        else:
                            Run.state["domains_missing"] += 1
                    except Exception as e:           # one company never stops the run
                        s.rollback()
                        Run.state["failed"] += 1
                        Run.state["log"] = (Run.state["log"] + [{"company_id": cid, "error": f"{type(e).__name__}: {e}"[:200]}])[-30:]
                Run.state["done"] += 1
                progress.update(rid, done=Run.state["done"], failed=Run.state["failed"])
        finally:
            st = Run.state
            Run.state["running"] = False
            Run.state["current"] = None
            Run.state["finished_at"] = utcnow().isoformat()
            line = (f"Enriched {st['done']}" + (f" of {st['total']} (stopped)" if st.get("stopped") else "") +
                    f" - {st['domains_found']} domains found, {st['domains_missing']} not found" +
                    (f", {st['domains_had']} already had one" if st["domains_had"] else "") +
                    (f", {st['failed']} failed" if st["failed"] else ""))
            progress.finish(rid, line, "stopped" if st.get("stopped") else "done")

    if background:
        threading.Thread(target=work, name="metro-enrich", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(ids), "progress_id": rid}


# ───────────────────────── layer 2: the deep readings, queued for the shortlist ─────────────────────────

def queue_deep(s: Session, campaign: MetroCampaign, lead_ids: list[int] | None = None, *, now: datetime | None = None) -> dict:
    """Queue the readings that need a browser and cost a visit or a shared seat, for SHORTLISTED leads only
    (layer 1 at or above the threshold): the LinkedIn company page, the LinkedIn profile, and (niche campaigns only)
    Ahrefs. Fresh readings are not queued again. Nothing here visits anything: the gate decides when and who."""
    now = now or utcnow()
    days = _cache_days(s)
    min_fit = float(get_setting(s, "shortlist_min_fit", 50))
    from .scoring import shortlist_filter
    q = s.query(MetroLead).filter(MetroLead.campaign_id == campaign.id, MetroLead.status == "new")
    if lead_ids is not None:
        q = q.filter(MetroLead.id.in_(lead_ids))
    queued = {"linkedin_company": 0, "linkedin_profile": 0, "ahrefs": 0}
    job_ids: list[int] = []
    considered = 0
    for l in q.all():
        if not shortlist_filter(l, min_fit):
            continue
        considered += 1
        comp = s.get(MetroCompany, l.company_id) if l.company_id else None
        if comp is not None:
            if (comp.linkedin_url and not fresh(comp.linkedin_page_at, int(days.get("linkedin_company", 30)),
                                                 ok=snapshot_ok(comp.linkedin_page_json), now=now)
                    and (j := gate.enqueue(s, "linkedin_company", comp.linkedin_url, company_id=comp.id, lead_id=l.id, campaign_id=campaign.id))):
                queued["linkedin_company"] += 1
                job_ids.append(j.id)
            if (campaign.type == "niche" and comp.domain
                    and not fresh(comp.ahrefs_at, int(days.get("ahrefs", 30)), ok=snapshot_ok(comp.ahrefs_json), now=now)
                    and (j := gate.enqueue(s, "ahrefs", comp.domain, company_id=comp.id, campaign_id=campaign.id))):
                queued["ahrefs"] += 1
                job_ids.append(j.id)
        raw = json.loads(l.raw_json or "{}")
        prof = raw.get("linkedin_profile") or {}
        prof_at = None
        if prof.get("fetched_at"):
            try:
                prof_at = datetime.strptime(prof["fetched_at"], "%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                prof_at = None
        if l.profile_url and not fresh(prof_at, 30, ok=bool(prof.get("ok")), now=now) \
                and (j := gate.enqueue(s, "linkedin_profile", l.profile_url, company_id=l.company_id, lead_id=l.id, campaign_id=campaign.id)):
            queued["linkedin_profile"] += 1
            job_ids.append(j.id)
    s.commit()
    return {"shortlisted_considered": considered, "queued": queued, "min_fit": min_fit, "job_ids": job_ids}


def follow_jobs(campaign_id: int, job_ids: list[int], label: str = "Deep readings") -> str | None:
    """A progress run that follows queued extension jobs as they come back (done, failed or cancelled). It closes by
    itself when every job is in. Nothing to follow: no run."""
    if not job_ids:
        return None
    ids = list(job_ids)

    def poll() -> dict:
        with Session(get_engine()) as s:
            rows = s.query(MetroScrapeJob.status, MetroScrapeJob.kind).filter(MetroScrapeJob.id.in_(ids)).all()
            wk = gate.week_mode(s)
        done = sum(1 for st, _ in rows if st == "done")
        failed = sum(1 for st, _ in rows if st in ("failed", "cancelled"))
        waiting = sum(1 for st, k in rows if st in ("queued", "leased"))
        li_waiting = sum(1 for st, k in rows if st in ("queued", "leased") and k in gate.LINKEDIN_KINDS)
        detail = ""
        if li_waiting and wk != "metro":
            detail = f"{li_waiting} LinkedIn reading(s) wait for a Metro week"
        elif waiting:
            detail = f"{waiting} waiting for the browser extension"
        out = {"total": len(rows), "done": done + failed, "failed": failed, "detail": detail}
        if rows and waiting == 0:
            out.update(finished=True, result=f"Deep readings: {done} read" + (f", {failed} failed" if failed else ""))
        return out

    return progress.start("deep", label, total=len(ids), campaign_id=campaign_id, poll=poll)
