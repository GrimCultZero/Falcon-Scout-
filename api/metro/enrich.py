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

from . import aiclient, gate, pagespeed, webscan
from .db import (MetroCampaign, MetroCompany, MetroLead, MetroScrapeJob, MetroSetting, get_engine, get_setting, utcnow)

FREE_MAIL = {"gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com",
             "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "msn.com", "yandex.com", "qq.com", "ymail.com"}
GENERIC_NAME_WORDS = {"inc", "llc", "ltd", "limited", "gmbh", "corp", "corporation", "co", "company", "group", "agency", "the",
                      "and", "of", "digital", "marketing", "media", "solutions", "services", "consulting", "studio", "studios",
                      "partners", "global", "international", "creative", "design", "web", "online", "clinic", "center", "centre",
                      "health", "medical", "dental", "group", "associates", "advertising", "seo", "ppc"}
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

def name_tokens(name: str) -> list[str]:
    toks = [t for t in re.split(r"[^a-z0-9]+", (name or "").lower()) if len(t) >= 3 and t not in GENERIC_NAME_WORDS]
    return toks


def verify_domain_matches_name(name: str, scan: dict) -> bool:
    """True when the scanned site plausibly belongs to the company: a distinctive word of the company name is in the
    domain, the title, the headline or the meta description. A guess that fails this is never stored."""
    toks = name_tokens(name)
    if not toks or not scan or not scan.get("ok"):
        return False
    hay = " ".join(str(scan.get(k) or "") for k in ("title", "h1", "meta_description")).lower()   # not the domain: that is the guess itself
    hay_compact = re.sub(r"[^a-z0-9]", "", hay)
    return any(t in hay_compact for t in toks[:3])


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


def ai_domain_candidate(company: MetroCompany, lead: MetroLead | None, ask: Callable[..., str] | None = None) -> str | None:
    """Ask the model for the company's website. The answer is only a CANDIDATE: resolve_domain stores it only after the
    site itself confirms the name."""
    ask = ask or aiclient.ask
    ctx = [f"Company: {company.name}"]
    if company.country:
        ctx.append(f"Country: {company.country}")
    if lead is not None:
        if lead.title:
            ctx.append(f"A person there: {lead.title}")
        if lead.location:
            ctx.append(f"Location: {lead.location}")
    prompt = ("What is the official website domain of this company? Answer with JSON only: {\"domain\": \"example.com\"} "
              "or {\"domain\": null} when you are not sure. Do not guess.\n" + "\n".join(ctx))
    try:
        data = aiclient.parse_json(ask(prompt, model=aiclient.HAIKU, max_tokens=2000, kind="metro_domain"))
    except Exception:
        return None
    d = webscan.normalize_site(str((data or {}).get("domain") or "")) if isinstance(data, dict) else None
    if d and d[0] not in FREE_MAIL and not d[0].endswith(("linkedin.com", "facebook.com", "wikipedia.org")):
        return d[0]
    return None


def resolve_domain(s: Session, company: MetroCompany, leads: list[MetroLead], *, fetch: webscan.Fetcher,
                   ask: Callable[..., str] | None = None, use_ai: bool = True, sleep=time.sleep) -> dict:
    """Step 1. Returns {domain, source, tried: [...]} and stores domain + source on the company when found."""
    if company.domain:
        return {"domain": company.domain, "source": company.domain_source, "tried": []}
    tried = []

    def take(domain: str, source: str):
        other = s.query(MetroCompany).filter(MetroCompany.domain == domain, MetroCompany.id != company.id).first()
        if other is not None:
            tried.append(f"{source}: {domain} already belongs to company {other.id}")
            return None
        company.domain, company.domain_source = domain, source
        s.commit()
        return {"domain": domain, "source": source, "tried": tried}

    c = candidate_from_email(leads)
    if c:
        tried.append("email-finder")
        got = take(c[0], "email-finder")
        if got:
            return got
    li = candidate_from_linkedin(company)
    # order: CSV (already stored) -> email-finder export -> AI lookup -> LinkedIn company page
    if use_ai:
        cand = ai_domain_candidate(company, leads[0] if leads else None, ask)
        tried.append(f"ai-lookup:{cand or 'no answer'}")
        if cand:
            scan = webscan.scan_site(cand, fetch, sleep=sleep, pace=0)
            if verify_domain_matches_name(company.name, scan):
                got = take(cand, "ai-lookup")
                if got:
                    return got
            else:
                tried.append(f"ai-lookup: {cand} rejected (the site does not carry the company name)")
    if li:
        tried.append("linkedin")
        got = take(li, "linkedin")
        if got:
            return got
    return {"domain": None, "source": None, "tried": tried}


# ───────────────────────── one company ─────────────────────────

def _cache_days(s: Session) -> dict:
    return get_setting(s, "cache_days", {}) or {}


def enrich_company(s: Session, company: MetroCompany, *, fetch: webscan.Fetcher, get_json: pagespeed.JsonGetter | None = None,
                   ask: Callable[..., str] | None = None, use_ai: bool = True, campaign: MetroCampaign | None = None,
                   queue_browser_jobs: bool = True, sleep=time.sleep, now: datetime | None = None) -> dict:
    """Steps 1-3 for one company; queues the browser-only readings. Returns what it did (for the progress view)."""
    now = now or utcnow()
    days = _cache_days(s)
    pace = float((get_setting(s, "pace_seconds", {}) or {}).get("web", 3))
    out: dict = {"company_id": company.id, "name": company.name, "did": [], "skipped": []}
    leads = s.query(MetroLead).filter_by(company_id=company.id).order_by(MetroLead.persona_score.desc()).all()

    r = resolve_domain(s, company, leads, fetch=fetch, ask=ask, use_ai=use_ai, sleep=sleep)
    out["domain"], out["domain_source"] = r["domain"], r["source"]
    if r["tried"]:
        out["domain_tried"] = r["tried"]
    if not company.domain:
        out["skipped"].append("no domain")
        if (queue_browser_jobs and company.linkedin_url and not company.linkedin_page_json
                and gate.enqueue(s, "linkedin_company", company.linkedin_url, company_id=company.id,
                                 campaign_id=campaign.id if campaign else None)):
            out["did"].append("queued the LinkedIn company page (it may name the website)")
        s.commit()
        return out
    dom = company.domain

    # step 2: website scan
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
    if lead_ids:
        q = q.filter(MetroLead.id.in_(lead_ids))
    seen, out = set(), []
    for (cid,) in q.order_by(MetroLead.persona_score.desc()).all():
        if cid not in seen:
            seen.add(cid)
            out.append(cid)
    return out


def start_run(campaign_id: int, lead_ids: list[int] | None = None, *, fetch: webscan.Fetcher | None = None,
              get_json: pagespeed.JsonGetter | None = None, ask=None, use_ai: bool = True, background: bool = True,
              limit: int | None = None, sleep=time.sleep) -> dict:
    """Start enrichment for a campaign's `new` leads (or only the given ones). Refuses a second run."""
    with Run.lock:
        if Run.state.get("running"):
            return {"started": False, "reason": "a run is already going", **Run.state}
        with Session(get_engine()) as s:
            ids = _company_ids(s, campaign_id, lead_ids)
        if limit:
            ids = ids[:limit]
        Run.stop_flag.clear()
        Run.state = {"running": True, "campaign_id": campaign_id, "total": len(ids), "done": 0, "failed": 0,
                     "started_at": utcnow().isoformat(), "current": None, "log": []}
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
                    try:
                        res = enrich_company(s, comp, fetch=fetch, get_json=get_json, ask=ask, use_ai=use_ai, campaign=camp, sleep=sleep)
                        Run.state["log"] = (Run.state["log"] + [res])[-30:]
                    except Exception as e:           # one company never stops the run
                        s.rollback()
                        Run.state["failed"] += 1
                        Run.state["log"] = (Run.state["log"] + [{"company_id": cid, "error": f"{type(e).__name__}: {e}"[:200]}])[-30:]
                Run.state["done"] += 1
        finally:
            Run.state["running"] = False
            Run.state["current"] = None
            Run.state["finished_at"] = utcnow().isoformat()

    if background:
        threading.Thread(target=work, name="metro-enrich", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(ids)}


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
    if lead_ids:
        q = q.filter(MetroLead.id.in_(lead_ids))
    queued = {"linkedin_company": 0, "linkedin_profile": 0, "ahrefs": 0}
    considered = 0
    for l in q.all():
        if not shortlist_filter(l, min_fit):
            continue
        considered += 1
        comp = s.get(MetroCompany, l.company_id) if l.company_id else None
        if comp is not None:
            if (comp.linkedin_url and not fresh(comp.linkedin_page_at, int(days.get("linkedin_company", 30)),
                                                 ok=snapshot_ok(comp.linkedin_page_json), now=now)
                    and gate.enqueue(s, "linkedin_company", comp.linkedin_url, company_id=comp.id, lead_id=l.id, campaign_id=campaign.id)):
                queued["linkedin_company"] += 1
            if (campaign.type == "niche" and comp.domain
                    and not fresh(comp.ahrefs_at, int(days.get("ahrefs", 30)), ok=snapshot_ok(comp.ahrefs_json), now=now)
                    and gate.enqueue(s, "ahrefs", comp.domain, company_id=comp.id, campaign_id=campaign.id)):
                queued["ahrefs"] += 1
        raw = json.loads(l.raw_json or "{}")
        prof = raw.get("linkedin_profile") or {}
        prof_at = None
        if prof.get("fetched_at"):
            try:
                prof_at = datetime.strptime(prof["fetched_at"], "%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                prof_at = None
        if l.profile_url and not fresh(prof_at, 30, ok=bool(prof.get("ok")), now=now) \
                and gate.enqueue(s, "linkedin_profile", l.profile_url, company_id=l.company_id, lead_id=l.id, campaign_id=campaign.id):
            queued["linkedin_profile"] += 1
    s.commit()
    return {"shortlisted_considered": considered, "queued": queued, "min_fit": min_fit}
