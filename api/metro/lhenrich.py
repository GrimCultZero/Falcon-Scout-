"""Linked Helper "Data Enrichment" exports (METRO_TASK.md F3): what a row may tell us about the lead's company and the lead.

WHERE A COMPANY'S DOMAIN MAY COME FROM, in this order (the first that gives a usable one wins, the rest only leave a note):
  1. already on the company                      (a different Linked Helper domain is recorded as a disagreement, never applied)
  2. Linked Helper, the lead's CURRENT organization: `organization_domain_N`, else `organization_website_N`
     (source `linkedhelper`). "Current" = the open position (no end date) whose name matches `current_company`, or the
     only open position when `current_company` is empty. NEVER an older job, NEVER `website_1..3` (the person's own sites).
  3. a business e-mail address of the lead: its domain unless it is a free-mail provider   (source `email-domain`)
  4. the domain finder (F2): name patterns, AI lookup, LinkedIn.
1-3 are first-party data: no site check. A parked / for-sale domain, a generic one (linkedin.com, facebook.com ...), a free-mail
domain and a builder placeholder (wixsite.com ...) are rejected. Every decision leaves a line in the company's trail.
"""
from __future__ import annotations

import json
import re
from collections import Counter

from sqlalchemy.orm import Session

from . import csvimport as ci
from .db import MetroCompany, MetroLead, utcnow

GENERIC_HOSTS = {"linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "google.com",
                 "g.page", "goo.gl", "bit.ly", "linktr.ee", "wikipedia.org", "crunchbase.com", "yelp.com", "bbb.org",
                 "clutch.co", "zoominfo.com", "yellowpages.com", "apple.com", "microsoft.com", "amazon.com", "tiktok.com",
                 "pinterest.com", "medium.com", "github.com", "calendly.com", "example.com"}
PLACEHOLDER_SUFFIXES = (".wixsite.com", ".godaddysites.com", ".business.site", ".weebly.com", ".wordpress.com", ".blogspot.com",
                        ".squarespace.com", ".sites.google.com", ".site123.me", ".webflow.io", ".carrd.co", ".my.canva.site")
PARKED_HOSTS = {"sedo.com", "hugedomains.com", "dan.com", "afternic.com", "godaddy.com", "namecheap.com", "bodis.com",
                "parkingcrew.net", "undeveloped.com", "domainmarket.com", "squadhelp.com", "brandbucket.com", "uniregistry.com"}


def usable_domain(raw: str | None) -> tuple[str | None, str]:
    """(domain or None, why not). Pure: no fetch."""
    from .webscan import normalize_site
    n = normalize_site(raw or "")
    if not n:
        return None, "not a domain"
    d = n[0]
    if d in ci.FREE_MAIL:
        return None, f"{d} is a free-mail provider"
    if any(d == g or d.endswith("." + g) for g in GENERIC_HOSTS):
        return None, f"{d} is a generic site, not the company's own"
    if any(d.endswith(s) for s in PLACEHOLDER_SUFFIXES) or d in {s.lstrip(".") for s in PLACEHOLDER_SUFFIXES}:
        return None, f"{d} is a site-builder placeholder"
    if any(d == p or d.endswith("." + p) for p in PARKED_HOSTS):
        return None, f"{d} is a parked / for-sale host"
    if re.search(r"(^|[.-])(forsale|for-sale|parked|domainforsale)([.-]|$)", d):
        return None, f"{d} looks parked"
    return d, "ok"


_COMPANY_PAGE_RE = re.compile(r"^https?://(?:[a-z0-9-]+\.)*linkedin\.com/company/([^/?#\s]+)", re.I)


def company_page(raw: str | None) -> str | None:
    """F4: `organization_url_N` as the company's LinkedIn page in the one form the rest of Metro stores
    (`https://www.linkedin.com/company/<slug>/`), or None when it is not a company page (a school, a person, a Sales
    Navigator link, an empty cell)."""
    m = _COMPANY_PAGE_RE.match((raw or "").strip())
    if not m or m.group(1).lower() in ("unavailable", "linkedin"):
        return None
    return f"https://www.linkedin.com/company/{m.group(1)}/"


def stash_other_email(lead: MetroLead, old: str | None) -> None:
    """F4: an address a better one replaced is kept in the lead's raw data (`mapped.other_emails`), never lost silently."""
    if not old:
        return
    try:
        raw = json.loads(lead.raw_json) if lead.raw_json else {}
    except ValueError:
        raw = {}
    alts = raw.setdefault("mapped", {}).setdefault("other_emails", [])
    if old not in alts:
        alts.append(old)
        lead.raw_json = json.dumps(raw, ensure_ascii=False)


def _fuzzy_same(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return a == b or a.startswith(b + " ") or b.startswith(a + " ") or (len(a) >= 5 and len(b) >= 5 and (a in b or b in a))


def current_org(orgs: list[dict], current_company: str | None) -> dict | None:
    """The organization that is the lead's CURRENT company, or None. Never an older job."""
    key = ci.company_key(current_company)
    open_orgs = [o for o in orgs if o["open"]]
    if key:
        for o in open_orgs:
            if _fuzzy_same(ci.company_key(o["name"]), key):
                return o
        return None                                     # a name that matches nothing open: do not guess
    return open_orgs[0] if len(open_orgs) == 1 else None


def row_enrichment(row: dict, n: dict, cols: dict) -> dict:
    """Everything one export row says that F3 uses, from the already normalized row `n`."""
    orgs = ci.extract_orgs(row)
    cur = current_org(orgs, n.get("company_name"))
    cand, cand_raw = None, None
    if cur:
        for raw in (cur["domain"], cur["website"]):
            if raw:
                cand_raw = raw
                cand, _why = usable_domain(raw)
                if cand:
                    break
    return {"org": cur, "lh_domain": cand, "lh_company_page": company_page((cur or {}).get("url")),
            "lh_domain_rejected": (usable_domain(cand_raw)[1] if cand_raw and not cand else None),
            "co_industry": n.get("co_industry") or (cur or {}).get("extra", {}).get("organization_industry"),
            "co_description": (cur or {}).get("description") or None, "co_location": (cur or {}).get("location") or None,
            "co_extra": (cur or {}).get("extra") or {}, "unmapped": ci.unmapped_columns(row, cols)}


def _trail_add(company: MetroCompany, step: dict) -> bool:
    """Append a trail line unless the same one is there already (re-import changes nothing). True when added."""
    try:
        t = json.loads(company.domain_tried_json) if company.domain_tried_json else {}
    except ValueError:
        t = {}
    steps = t.get("steps") or []
    if any(x.get("step") == step["step"] and x.get("result") == step["result"] for x in steps):
        return False
    steps.append(step)
    company.domain_tried_json = json.dumps({"at": t.get("at") or utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "steps": steps}, ensure_ascii=False)
    return True


def _set_domain(company: MetroCompany, domain: str, source: str, step: dict, domains: dict) -> None:
    company.domain, company.domain_source = domain, source
    domains[domain] = company
    _trail_add(company, step)
    if company.website_scan_at is None:
        company.enrich_tried_at = None          # "Enrich next N" must pick it up now that it has a site to read


def apply_company(s: Session, company: MetroCompany | None, enr: dict, *, domains: dict, pending: set,
                  stats: Counter, dry_run: bool, email: str | None = None) -> None:
    """Domain (rules 2 and 3 of the module docstring) and company facts. `company` is None in a dry run for a company that
    would be created: the counts still say what would happen. `domains` = domain -> company stored, `pending` = domains a
    dry run has pretended to set (so two companies are not both given one domain)."""
    lh = enr["lh_domain"]
    if enr.get("lh_domain_rejected"):
        stats["domain_rejected"] += 1
    cur = company.domain if company is not None else None
    if lh:
        owner = domains.get(lh)
        if cur:
            if cur != lh:
                stats["domain_disagree"] += 1
                if company is not None and not dry_run:
                    _trail_add(company, {"step": "linkedhelper", "result": f"disagrees: Linked Helper says {lh}, kept {cur}"})
        elif (owner is not None and owner is not company) or lh in pending:
            stats["domain_taken"] += 1
        else:
            stats["domain_set_linkedhelper"] += 1
            cur = lh
            pending.add(lh)
            if company is not None and not dry_run:
                _set_domain(company, lh, "linkedhelper", {"step": "linkedhelper", "result": f"set {lh} (current organization)"}, domains)
    if not cur and email and not ci.email_is_free_mail(email):
        d, _why = usable_domain(email.split("@")[-1])
        if d:
            owner = domains.get(d)
            if (owner is not None and owner is not company) or d in pending:
                stats["domain_taken"] += 1
            else:
                stats["domain_set_email"] += 1
                pending.add(d)
                if company is not None and not dry_run:
                    _set_domain(company, d, "email-domain", {"step": "email-domain", "result": f"set {d} (business email)"}, domains)
        else:
            stats["domain_rejected"] += 1
    page = enr.get("lh_company_page")
    if page:                                  # F4: the current company's LinkedIn page, for the LinkedIn domain step
        have = company.linkedin_url if company is not None else None
        if not have:
            stats["company_pages"] += 1
            if company is not None and not dry_run:
                company.linkedin_url = page
                _trail_add(company, {"step": "linkedhelper", "result": f"company page {page} (current organization)"})
        elif have and have.rstrip("/").lower() != page.rstrip("/").lower():
            stats["company_page_disagree"] += 1
    if company is not None and enr.get("co_industry") and not company.industry:
        if not dry_run:
            company.industry = enr["co_industry"]
        stats["company_facts"] += 1


def apply_lead(lead: MetroLead, n: dict, enr: dict, *, stats: Counter, dry_run: bool) -> list[str]:
    """Badges and person / company facts onto a STORED lead. Facts fill only EMPTY slots; a badge takes the file's value.
    Returns what changed."""
    changed: list[str] = []
    b = n.get("badges") or {}
    for key, attr in (("open_link", "open_profile"), ("premium", "premium"), ("hiring", "hiring"), ("job_seeker", "job_seeker")):
        if key in b and getattr(lead, attr) != b[key]:
            if not dry_run:
                setattr(lead, attr, b[key])
            changed.append(attr)
    if b.get("open_link"):
        stats["open_profile"] += 1
    try:
        raw = json.loads(lead.raw_json) if lead.raw_json else {}
    except ValueError:
        raw = {}
    mapped = raw.setdefault("mapped", {})
    facts = []
    for k in ("summary", "skills", "followers", "connections"):
        if n.get(k) and not mapped.get(k):
            mapped[k] = n[k]
            facts.append(k)
    if n.get("industry_person") and not mapped.get("industry"):
        mapped["industry"] = n["industry_person"]
        facts.append("industry")
    cf = {k: v for k, v in {"description": enr.get("co_description"), "location": enr.get("co_location"),
                            "industry": enr.get("co_industry"), **(enr.get("co_extra") or {})}.items() if v}
    old = mapped.setdefault("company_facts", {})
    new_cf = {k: v for k, v in cf.items() if k not in old}
    if new_cf:
        old.update(new_cf)
        facts.append("company_facts")
    if facts:
        stats["person_facts"] += 1
        changed += facts
        if not dry_run:
            lead.raw_json = json.dumps(raw, ensure_ascii=False)
    return changed


def backfill_company_pages(s: Session) -> dict:
    """F4, once (db.f4_company_pages): the Linked Helper rows already imported kept every non-empty column in the lead's raw data,
    so a company that has no LinkedIn page yet gets the one its lead's CURRENT organization names (same rule as the website).
    Returns {"leads_with_row": n, "pages_set": n, "no_page_in_row": n}."""
    out = Counter()
    for lead in s.query(MetroLead).filter(MetroLead.company_id.isnot(None), MetroLead.raw_json.isnot(None)).all():
        try:
            row = (json.loads(lead.raw_json) or {}).get("row") or {}
        except ValueError:
            continue
        orgs = ci.extract_orgs(row)
        if not orgs:
            continue
        out["leads_with_row"] += 1
        cur = current_org(orgs, lead.company_name)
        page = company_page((cur or {}).get("url"))
        comp = s.get(MetroCompany, lead.company_id)
        if not page or comp is None:
            out["no_page_in_row"] += 1
            continue
        if not comp.linkedin_url:
            comp.linkedin_url = page
            _trail_add(comp, {"step": "linkedhelper", "result": f"company page {page} (current organization, from the stored import)"})
            out["pages_set"] += 1
    s.commit()
    return dict(out)
