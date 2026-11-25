"""What an extension sends back for a job (METRO_PLAN.md Phase 2, steps 4-5), checked and stored as dated snapshots.

The extension is not trusted: only known keys of the right type are kept, sizes are capped, and a job can be
completed only by the account it was leased to. A reading that failed is stored as `{"ok": false, ...}` so the
company is retried after a day, but it never replaces a good reading.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from sqlalchemy.orm import Session

from . import gate
from .db import MetroCompany, MetroLead, MetroScrapeJob, utcnow
from .webscan import normalize_site

# kind -> (company snapshot column prefix, allowed keys with their types)
SCHEMAS = {
    "ads_transparency": ("ads", {"found": bool, "advertiser": str, "running": bool, "ads_count": int, "ads_count_text": str,
                                 "first_seen": str, "last_seen": str, "regions": list, "formats": list, "sample_url": str}),
    "gbp": ("gbp", {"found": bool, "name": str, "rating": float, "review_count": int, "categories": list, "address": str,
                    "phone": str, "website": str, "claimed": bool, "hours_listed": bool, "photos": int}),
    "ahrefs": ("ahrefs", {"domain": str, "dr": float, "ur": float, "organic_keywords": int, "organic_traffic": int,
                          "backlinks": int, "ref_domains": int, "summary": str}),
    "linkedin_company": ("linkedin_page", {"name": str, "website": str, "industry": str, "employees_range": str,
                                           "employees_on_linkedin": int, "followers": int, "about": str,
                                           "specialties": list, "headquarters": str, "founded": str, "company_type": str,
                                           "recent_posts": list}),
    "linkedin_profile": (None, {"headline": str, "about": str, "location": str, "current_role": str, "current_company": str,
                                "current_company_url": str,
                                "tenure": str, "experience": list, "recent_activity": list, "skills": list, "connections": str}),
}
MAX_STR = 3000
MAX_LIST = 30


def _clean_value(v, typ):
    if v is None:
        return None
    if typ is bool:
        return bool(v) if isinstance(v, (bool, int)) else None
    if typ is int:
        if isinstance(v, bool):
            return None
        if isinstance(v, (int, float)):
            return int(v)
        m = re.sub(r"[^\d]", "", str(v))
        return int(m) if m else None
    if typ is float:
        if isinstance(v, bool):
            return None
        try:
            return float(str(v).replace(",", "."))
        except ValueError:
            return None
    if typ is str:
        return str(v).strip()[:MAX_STR] if not isinstance(v, (dict, list)) else None
    if typ is list:
        if not isinstance(v, list):
            return None
        out = []
        for x in v[:MAX_LIST]:
            if isinstance(x, (str, int, float)):
                out.append(str(x)[:600])
            elif isinstance(x, dict):
                out.append({str(k)[:40]: (str(val)[:600] if not isinstance(val, (dict, list)) else None) for k, val in list(x.items())[:12]})
        return out
    return None


def clean_result(kind: str, raw: dict) -> dict:
    _, schema = SCHEMAS[kind]
    out = {}
    for k, typ in schema.items():
        if k in (raw or {}):
            v = _clean_value(raw[k], typ)
            if v is not None:
                out[k] = v
    return out


def complete_job(s: Session, job_id: int, sender_id: int, *, result: dict | None = None, error: str | None = None,
                 now: datetime | None = None) -> dict:
    now = now or utcnow()
    job = s.get(MetroScrapeJob, job_id)
    if job is None:
        raise gate.GateError("no such job", 404)
    if job.status != "leased" or job.sender_id != sender_id:
        raise gate.GateError("this job is not leased to this account", 409)
    company = s.get(MetroCompany, job.company_id) if job.company_id else None
    lead = s.get(MetroLead, job.lead_id) if job.lead_id else None
    if error or not isinstance(result, dict):
        job.status, job.error, job.finished_at = "failed", (error or "no result")[:500], now
        col = SCHEMAS[job.kind][0]
        if company is not None and col and not _has_good(company, col):
            _store(company, col, {"ok": False, "error": (error or "no result")[:200]}, now)
        s.commit()
        return {"status": "failed"}
    data = clean_result(job.kind, result)
    snap = {"ok": True, **data, "fetched_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "target": job.target}
    notes = []
    if job.kind in ("ads_transparency", "gbp") and data.get("found") is False:
        snap["found"] = False                                  # a clean "nothing there" is a reading, not an error
    if job.kind == "linkedin_profile":
        if lead is None:
            raise gate.GateError("the job has no lead", 409)
        raw = json.loads(lead.raw_json or "{}")
        raw["linkedin_profile"] = snap
        lead.raw_json = json.dumps(raw, ensure_ascii=False)
        lead.enriched_at = now
        notes += _company_from_profile(s, lead, data, job)
    else:
        if company is None:
            raise gate.GateError("the job has no company", 409)
        _store(company, SCHEMAS[job.kind][0], snap, now)
        if job.kind == "linkedin_company" and not company.domain and data.get("website"):
            n = normalize_site(data["website"])
            if n and "linkedin.com" not in n[0]:
                taken = s.query(MetroCompany).filter(MetroCompany.domain == n[0], MetroCompany.id != company.id).first()
                if taken is None:
                    company.domain, company.domain_source = n[0], "linkedin"
                    notes.append(f"domain {n[0]} from the LinkedIn company page")
    job.status, job.result_json, job.finished_at, job.error = "done", json.dumps(snap, ensure_ascii=False), now, None
    s.commit()
    return {"status": "done", "notes": notes}


def _company_from_profile(s: Session, lead: MetroLead, data: dict, job: MetroScrapeJob) -> list[str]:
    """F2, domain finder step d: the profile names the current company's LinkedIn page. When the company has no page
    stored and its name agrees with the one on the profile, keep the page and queue its reading (the page names the
    website). A profile of someone who has moved on names another company and is ignored."""
    url = str(data.get("current_company_url") or "")
    comp = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    if comp is None or comp.domain or comp.linkedin_url or not re.match(r"^https://([a-z]+\.)?linkedin\.com/company/[^/?#]+", url, re.I):
        return []
    from .domainfinder import name_tokens, _fold
    toks = name_tokens(comp.name)
    seen = _fold(str(data.get("current_company") or ""))
    compact = re.sub(r"[^a-z0-9]", "", seen)
    if not toks or not any(t in seen.split() or (len(t) >= 5 and t in compact) for t in toks):
        return [f"the profile's current company ({data.get('current_company') or 'unknown'}) does not match {comp.name}; page not used"]
    clean = re.match(r"^https://[a-z.]*linkedin\.com/company/[^/?#]+", url, re.I).group(0)
    comp.linkedin_url = clean + "/"
    gate.enqueue(s, "linkedin_company", comp.linkedin_url, company_id=comp.id, lead_id=lead.id, campaign_id=job.campaign_id)
    return [f"company page {comp.linkedin_url} queued from the profile"]


def _has_good(company: MetroCompany, col: str) -> bool:
    raw = getattr(company, f"{col}_json")
    try:
        return bool(raw and json.loads(raw).get("ok"))
    except ValueError:
        return False


def _store(company: MetroCompany, col: str, snap: dict, now: datetime) -> None:
    setattr(company, f"{col}_json", json.dumps(snap, ensure_ascii=False))
    setattr(company, f"{col}_at", now)
