"""Evidence for hooks (Phase 3): what is STORED about a company and about a person, as numbered items (path, value, date).

Split in two, because a hook is either about the company (written once, shared by every lead of that company) or about
one person (their own profile):

  * company_evidence: the website scan (Phase 3 adds services, industries, case studies, careers, partner badges, client
    logos, founding year, team size), Ads Transparency, Business Profile, Ahrefs, the LinkedIn company page, and the
    Linked Helper company facts the leads' rows carry (description, industry, location); plus ONE item code derives
    itself: the service gap (they sell SEO / web / social and name no paid search, or the reverse);
  * person_evidence: title, headline, location, and the Linked Helper person extras (summary, skills, industry,
    followers, connections, current position, start date, the hiring badge), plus a LinkedIn profile reading.

Segment rule (decision row "PageSpeed by segment", 25 Nov, and the hook review of 26 Nov): for an AGENCY campaign the
"audit of their own site" fields (tags, pixels, call tracking, booking, service / location page counts, blog freshness,
PageSpeed) are not evidence at all; they stay evidence for niche (direct client) campaigns. hooks.py enforces the same
rule again on the hooks themselves.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

from .db import MetroCompany, MetroLead, utcnow

MAX_COMPANY_EVIDENCE = 70
MAX_PERSON_EVIDENCE = 24

# Keys that are bookkeeping, not facts about anyone.
SKIP_KEYS = ("ok", "scanned_at", "fetched_at", "target", "errors", "pages_read", "final_url", "url", "strategy", "status",
             "service_examples", "location_examples", "ids", "sample_url", "phones", "emails", "emails_on_own_domain", "parked",
             "domain", "read", "version", "service_urls")
# The "audit of their own site" fields: never evidence for an agency campaign.
AGENCY_SKIPPED = ("website.signals", "website.booking", "website.blog", "website.service_pages", "website.location_pages",
                  "website.cms", "pagespeed")


def _load(raw):
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def _flat(prefix: str, obj, out: list, at: str | None, ref: str | None, skip=SKIP_KEYS):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in skip:
                continue
            _flat(f"{prefix}.{k}", v, out, at, ref, skip)
    elif isinstance(obj, list):
        if not obj:
            return
        if all(isinstance(x, (str, int, float)) for x in obj):
            out.append({"path": prefix, "value": ", ".join(str(x) for x in obj[:15]), "at": at, "ref": ref})
        else:
            for i, x in enumerate(obj[:6]):
                _flat(f"{prefix}[{i}]", x, out, at, ref, skip)
    elif obj is not None and obj != "":
        out.append({"path": prefix, "value": obj, "at": at, "ref": ref})


def is_agency_skipped(path: str) -> bool:
    return any(path == p or path.startswith(p + ".") or path.startswith(p + "[") for p in AGENCY_SKIPPED)


# ───────────────────────── the service gap (derived by code, never by the model) ─────────────────────────

FAMILIES = {
    "paid search / Google Ads": re.compile(r"\bppc\b|pay[- ]per[- ]click|google ads|adwords|paid search|search engine marketing|\bsem\b|"
                                           r"performance max|\bpmax\b|google_ads", re.I),
    "SEO": re.compile(r"\bseo\b|search engine optimi[sz]ation|link building|\bgeo\b|\baeo\b", re.I),
    "paid social": re.compile(r"paid social|facebook ads|facebook advertising|meta ads|instagram advertising|tiktok ads|social media advertising|"
                              r"social ads|paid media", re.I),
    "social media": re.compile(r"social media|social_media|instagram|tiktok", re.I),
    "web design / development": re.compile(r"web ?(?:site)? ?(?:design|development|experiences?)|web_design|wordpress|shopify (?:web|website)|"
                                           r"full stack|website", re.I),
    "branding": re.compile(r"branding|brand identity|brand films?", re.I),
    "content": re.compile(r"content (?:marketing|creation|writing)|\bcontent\b|ugc", re.I),
    "email marketing": re.compile(r"email", re.I),
}


def service_families(names: list[str]) -> list[str]:
    hay = " | ".join(str(n) for n in names or [])
    return [k for k, rx in FAMILIES.items() if rx.search(hay)]


def service_gap(scan: dict | None) -> str | None:
    """One sentence on what an agency sells and which of OUR two services (paid search, SEO) it names nowhere, or None when the
    scan does not say enough. Based on the service pages and headings found (at least 3); the words anywhere in the text
    (`marketing_terms`) are reported honestly beside it."""
    if not isinstance(scan, dict) or not scan.get("ok"):
        return None
    names = [str(x) for x in scan.get("services") or []]
    if len(names) < 3:
        return None
    fam = service_families(names)
    text_terms = set(scan.get("marketing_terms") or [])
    have_ppc, have_seo = "paid search / Google Ads" in fam, "SEO" in fam
    if have_ppc and have_seo:
        return None
    sells = ", ".join(f for f in fam if f not in ("paid search / Google Ads",)) or "other services"
    missing = []
    if not have_ppc:
        note = " (the words PPC or Google Ads appear elsewhere in the text)" if text_terms & {"ppc", "google_ads"} else ""
        missing.append(f"paid search / Google Ads{note}")
    if not have_seo:
        note = " (the word SEO appears elsewhere in the text)" if "seo" in text_terms else ""
        missing.append(f"SEO{note}")
    return (f"The service pages and headings found ({len(names)}) cover {sells}; none of them is about "
            f"{' or '.join(missing)}.")


def website_for_evidence(snap: dict) -> dict:
    """The scan as the model may read it. Two fields are reshaped because their raw form invites a false fact (the first live run,
    26 Nov: "Their client base includes 250 e-commerce businesses" from a WORD COUNT):
      * `niches` {niche: how often the word appears} -> the niche names, most mentioned first, with no numbers;
      * `careers`: only the PPC / SEO / paid-media roles named on the careers page; a careers page with no such role says nothing
        (having a careers page is not "hiring a PPC person")."""
    out = dict(snap)
    n = out.get("niches")
    if isinstance(n, dict):
        out["niches"] = [f"{k} (named most often)" if i == 0 else k for i, k in enumerate(n)] if n else None
    if isinstance(out.get("partners"), list):
        from .webscan import _partners_dedup
        out["partners"] = _partners_dedup(out["partners"])
    c = out.get("careers")
    if isinstance(c, dict):
        out["careers"] = {"ppc_seo_roles": c.get("ppc_seo_roles")} if c.get("ppc_seo_roles") else None
    return out


# ───────────────────────── company ─────────────────────────

def _company_facts_from_leads(leads: list[MetroLead]) -> tuple[dict, str | None, str | None]:
    """The Linked Helper company facts any lead of this company carries (first non-empty value per key wins)."""
    facts, at, ref = {}, None, None
    for l in leads:
        mapped = (_load(l.raw_json) or {}).get("mapped") or {}
        cf = mapped.get("company_facts") or {}
        if isinstance(cf, dict):
            for k, v in cf.items():
                if v and k not in facts and k in ("description", "location", "industry", "organization_industry",
                                                  "organization_size", "organization_founded", "organization_type", "organization_specialties"):
                    facts[k] = v
                    at = at or (l.created_at or utcnow()).strftime("%Y-%m-%d")
                    ref = ref or (l.source_file or "Linked Helper export")
    return facts, at, ref


def company_evidence(company: MetroCompany | None, leads: list[MetroLead], segment: str) -> list[dict]:
    """Numbered later by the caller. Every item: path, value, at (YYYY-MM-DD), ref."""
    items: list[dict] = []
    if company is None:
        return items
    for col, root in (("website_scan", "website"), ("pagespeed", "pagespeed"), ("ads", "ads"), ("gbp", "gbp"),
                      ("ahrefs", "ahrefs"), ("linkedin_page", "linkedin_company")):
        snap = _load(getattr(company, f"{col}_json"))
        at = getattr(company, f"{col}_at")
        if not (isinstance(snap, dict) and snap.get("ok")) or at is None:
            continue
        day = at.strftime("%Y-%m-%d")
        if root == "website":
            snap = website_for_evidence(snap)
        sub: list[dict] = []
        _flat(root, snap, sub, day, company.domain or company.name)
        items += sub
        if root == "website":
            gap = service_gap(snap)
            if gap:
                items.append({"path": "derived.service_gap", "value": gap, "at": day, "ref": company.domain or company.name})
    facts, fat, fref = _company_facts_from_leads(leads)
    for k, v in facts.items():
        val = re.sub(r"\s+", " ", str(v)).strip()
        items.append({"path": f"linkedhelper.company.{k}", "value": val[:900], "at": fat, "ref": fref})
    base = (company.created_at or utcnow()).strftime("%Y-%m-%d")
    if company.industry and "industry" not in facts:
        items.append({"path": "company.industry", "value": company.industry, "at": base, "ref": "import"})
    if company.country:
        items.append({"path": "company.country", "value": company.country, "at": base, "ref": "import"})
    if segment == "agency":
        items = [i for i in items if not is_agency_skipped(i["path"])]
    return [i for i in items if i.get("at")][:MAX_COMPANY_EVIDENCE]


# ───────────────────────── person ─────────────────────────

def _top_skills(raw: str, n: int = 8) -> str | None:
    """"Business Development : 47,Marketing : 59, ..." -> the n most endorsed skill names (endorsement counts dropped: a count
    is not a fact we would ever state)."""
    if not raw:
        return None
    pairs = []
    for part in str(raw).split(","):
        name, _, num = part.partition(":")
        name = name.strip()
        try:
            k = int(num.strip())
        except ValueError:
            k = 0
        if name:
            pairs.append((k, name))
    pairs.sort(key=lambda x: -x[0])
    return ", ".join(nm for _k, nm in pairs[:n]) or None


def person_evidence(lead: MetroLead) -> list[dict]:
    raw = _load(lead.raw_json) or {}
    mapped = raw.get("mapped") or {}
    row = raw.get("row") or {}
    at = (lead.created_at or utcnow()).strftime("%Y-%m-%d")
    ref = lead.source_file or "import"
    items = []

    def add(path, val, n=700):
        if val not in (None, "", [], {}):
            items.append({"path": path, "value": re.sub(r"\s+", " ", str(val)).strip()[:n], "at": at, "ref": ref})

    add("lead.title", lead.title)
    add("lead.headline", mapped.get("headline") or row.get("headline"))
    add("lead.company", lead.company_name)
    add("lead.location", lead.location)
    add("person.summary", mapped.get("summary"), 900)
    add("person.skills", _top_skills(mapped.get("skills")))
    add("person.industry", mapped.get("industry"))
    add("person.followers", mapped.get("followers"))
    add("person.position_description", row.get("position_description_1"), 500)
    start = str(row.get("organization_start_1") or "").strip()
    if re.match(r"^\d{4}", start):
        add("person.current_position_since", start[:7])
    if lead.hiring:
        add("person.badge_hiring", "LinkedIn shows a hiring badge on this person's profile")
    prof = raw.get("linkedin_profile")
    if isinstance(prof, dict) and prof.get("ok"):
        pat = (prof.get("fetched_at") or "")[:10] or None
        sub: list[dict] = []
        _flat("linkedin_profile", prof, sub, pat, lead.profile_url)
        items += [i for i in sub if i["at"]]
    return items[:MAX_PERSON_EVIDENCE]


def number(items: list[dict], prefix: str) -> list[dict]:
    for n, it in enumerate(items, 1):
        it["id"] = f"{prefix}{n}"
    return items


def evidence_for_lead(lead: MetroLead, company: MetroCompany | None, colleagues: list[MetroLead], segment: str) -> list[dict]:
    """The list shown in the lead's panel: company items (C1..) then this person's (P1..)."""
    return number(company_evidence(company, colleagues or [lead], segment), "C") + number(person_evidence(lead), "P")


def day_of(items: list[dict]) -> datetime:
    return datetime.strptime(min(i["at"] for i in items), "%Y-%m-%d")
