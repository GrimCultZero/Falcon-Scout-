"""IT Force case pages (METRO_PLAN.md Phase 3, step 1): the English cases at itforce.ua/en/cases, with URL, title and tags.

Every case card on the listing pages (/en/cases/, /en/cases/page/2/ ...) carries the case's English URL, its title, its
categories (industries such as "Medicine / Health / Aesthetics" and services such as "PPC contextual advertising"), the
client's country and a one-line task. That is all the chain writer needs, so the listing pages are read and nothing else;
Ukrainian-only cases never appear there and stay unlinked background.

The link a message carries is chosen and attached BY CODE (`best_case`), never written by the model (the locked decision
"Case studies"; DevScout's rule). `metro_case_links` is the store; the KB table is untouched.
"""
from __future__ import annotations

import html as _html
import re
import time
from typing import Callable

from sqlalchemy.orm import Session

from .db import MetroCaseLink, utcnow

INDEX_URL = "https://itforce.ua/en/cases/"
CASE_URL = re.compile(r"^https://itforce\.ua/en/cases/[a-z0-9-]+/$")
MAX_PAGES = 20
# The site's service categories; every other category is an industry.
SERVICE_CATEGORIES = {"ppc contextual advertising", "seo", "smm", "email", "aso", "development", "by shopify", "horoshop",
                      "web analytics", "website development", "contextual advertising", "targeted advertising"}

_ITEM = re.compile(r'<div class="case__item"\s', re.I)
_LINK = re.compile(r'<a href="([^"]+)" class="case__item-link">(.*?)</a>', re.I | re.S)
_CAT = re.compile(r'<a href="[^"]*" class="case__item-category">(.*?)</a>', re.I | re.S)
_COUNTRY = re.compile(r'<div class="case__additional-country-name">(.*?)</div>', re.I | re.S)
_TASK = re.compile(r'<div class="case__additional-task">(.*?)</div>', re.I | re.S)
_PAGE_N = re.compile(r'/en/cases/page/(\d+)/')


def _txt(s: str) -> str:
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def parse_listing(html: str) -> list[dict]:
    """The case cards of one listing page. Pure."""
    out = []
    for block in _ITEM.split(html or "")[1:]:
        m = _LINK.search(block)
        if not m:
            continue
        url = m.group(1).strip()
        if not CASE_URL.match(url):
            continue
        cats = [_txt(c) for c in _CAT.findall(block)]
        services = [c for c in cats if c.lower() in SERVICE_CATEGORIES]
        industries = [c for c in cats if c.lower() not in SERVICE_CATEGORIES]
        c = _COUNTRY.search(block)
        t = _TASK.search(block)
        out.append({"url": url, "title": _txt(m.group(2))[:200], "industry_tags": industries, "service_tags": services,
                    "country": _txt(c.group(1))[:60] if c else None, "task": _txt(t.group(1))[:400] if t else None})
    return out


def last_page(html: str) -> int:
    nums = [int(n) for n in _PAGE_N.findall(html or "")]
    return max(nums) if nums else 1


def fetch_all(fetch: Callable[[str], tuple[int, str, str]], *, sleep: Callable[[float], None] = time.sleep, pace: float = 1.5) -> dict:
    """Read every listing page. `fetch(url) -> (status, final_url, text)` (webscan.http_fetcher)."""
    status, _final, first = fetch(INDEX_URL)
    if not (status and 200 <= status < 300 and first):
        return {"ok": False, "error": f"the cases page did not answer ({status or 'no answer'})", "cases": []}
    cases = parse_listing(first)
    n = min(last_page(first), MAX_PAGES)
    errors = []
    for p in range(2, n + 1):
        sleep(pace)
        st, _f, txt = fetch(f"{INDEX_URL}page/{p}/")
        if st and 200 <= st < 300 and txt:
            cases += parse_listing(txt)
        else:
            errors.append(f"page {p}: {st or 'no answer'}")
    seen, uniq = set(), []
    for c in cases:
        if c["url"] not in seen:
            seen.add(c["url"])
            uniq.append(c)
    return {"ok": True, "pages": n, "cases": uniq, "errors": errors}


def store(s: Session, cases: list[dict]) -> dict:
    """Add new cases, update the tags of known ones (by URL). Never deletes."""
    added = updated = 0
    for c in cases:
        row = s.query(MetroCaseLink).filter_by(url=c["url"]).first()
        vals = {"title": c.get("title"), "industry_tags": ", ".join(c.get("industry_tags") or []) or None,
                "service_tags": ", ".join(c.get("service_tags") or []) or None, "country": c.get("country"), "task": c.get("task")}
        if row is None:
            s.add(MetroCaseLink(url=c["url"], **vals))
            added += 1
        else:
            if any(getattr(row, k) != v for k, v in vals.items()):
                for k, v in vals.items():
                    setattr(row, k, v)
                row.updated_at = utcnow()
                updated += 1
    s.commit()
    return {"added": added, "updated": updated, "total": s.query(MetroCaseLink).count()}


def import_cases(s: Session, fetch=None, **kw) -> dict:
    from .webscan import http_fetcher
    res = fetch_all(fetch or http_fetcher(timeout=20.0), **kw)
    if not res["ok"]:
        return res
    return {**store(s, res["cases"]), "pages": res["pages"], "read": len(res["cases"]), "errors": res["errors"], "ok": True}


def case_dict(c: MetroCaseLink) -> dict:
    split = lambda v: [x.strip() for x in (v or "").split(",") if x.strip()]  # noqa: E731
    return {"id": c.id, "url": c.url, "title": c.title, "industry_tags": split(c.industry_tags), "service_tags": split(c.service_tags),
            "country": c.country, "task": c.task}


# What IT Force sells an agency: delivery of paid search and SEO. A case in those services is the stronger proof.
_OUR_SERVICES = ("ppc contextual advertising", "seo")


def best_case(s: Session, tag: str | None, *, segment: str = "agency", fallback_tags: list[str] | None = None) -> dict | None:
    """The case page a chain attaches, chosen by code: the industry tag (the one the hook writer matched to THEIR clients)
    first, then any fallback tag; among those, a PPC / SEO case first, then a client outside Ukraine (stronger proof for a
    US / Canadian reader), then the newest. None when nothing matches (the chain then carries no link)."""
    rows = [case_dict(c) for c in s.query(MetroCaseLink).order_by(MetroCaseLink.id.desc()).all()]
    if not rows:
        return None
    for t in [x for x in [tag, *(fallback_tags or [])] if x]:
        hits = [r for r in rows if t.lower() in (x.lower() for x in r["industry_tags"])]
        if hits:
            hits.sort(key=lambda r: (not any(x.lower() in _OUR_SERVICES for x in r["service_tags"]),
                                     (r["country"] or "").lower() == "ukraine", -r["id"]))
            return hits[0]
    return None


# ───────────────────────── P3b: the case matched on the agency's client NICHE and the SERVICE we pitch ─────────────────────────
# Oleh, 27 Nov: "matched on the company's client niche AND the service (PPC/SEO), not on one industry tag", plus a "Change case"
# picker in the lead panel. The site files "SEO search promotion" as a category next to the industries, so a case's services are
# read from its service tags, that category and its title.

# The agency's client niche (webscan.NICHE_WORDS keys, or words in a hook) -> the IT Force case industry tags that prove it.
NICHE_TAGS = {
    "dental": ["Dentistry", "Medicine / Health / Aesthetics"], "medical": ["Medicine / Health / Aesthetics", "Dentistry"],
    "med spa / aesthetics": ["Medicine / Health / Aesthetics", "Cosmetics / Perfumery / Beauty"], "wellness": ["Medicine / Health / Aesthetics", "Cosmetics / Perfumery / Beauty", "Sports Nutrition & Supplements"],
    "legal": ["Legal services"], "home services": ["Household services", "Local business"], "real estate": ["Real estate"],
    "restaurants / hospitality": ["Coffee accessories / Establishments", "Events / Holiday services", "Alcohol-related topics"],
    "e-commerce": ["Online stores", "Shopify"], "saas / tech": ["Online services", "Technology and gadgets"], "b2b": ["B2B", "Industry / Equipment"],
    "beauty": ["Cosmetics / Perfumery / Beauty"], "fashion": ["Clothing", "shoes", "accessories", "Watches"], "fitness": ["Sports Nutrition & Supplements"],
    "automotive": ["Auto", "Tires"], "manufacturing": ["Industry / Equipment", "B2B"], "education": ["Education"],
    "food & beverage": ["Alcohol-related topics", "Coffee accessories / Establishments", "Sports Nutrition & Supplements"],
    # franchise / multi-location: no tag of its own ("Local business" alone matched an Irish pub to a real-estate agency, P3b run)
    "construction": ["Industry / Equipment", "Household services"],
    "entertainment": ["Events / Holiday services", "Online services"], "professional services": ["B2B", "Legal services"],
    "travel": ["Events / Holiday services"], "finance": ["Household services"], "furniture": ["Furniture"], "gifts": ["Flowers / Gifts"],
    "hr / staffing": ["HR agencies"],
}
NICHE_TEXT = {                       # the same niches found in free text (a clients_niche hook, a company industry line)
    "dental": r"dental|dentist", "medical": r"medical|health ?care|clinic|physician|hospital", "med spa / aesthetics": r"med ?spa|aesthetic|plastic surg",
    "wellness": r"wellness", "legal": r"\blegal\b|law firm|lawyer|attorney", "home services": r"home services|hvac|plumb|roofing|landscap|contractor",
    "real estate": r"real estate|realtor|property", "restaurants / hospitality": r"restaurant|hospitality|hotel|cafe|coffee",
    "e-commerce": r"e-?commerce|online stores?|\bdtc\b|\bd2c\b|shopify|retail", "saas / tech": r"\bsaas\b|software|tech compan|startup",
    "b2b": r"\bb2b\b", "beauty": r"beauty|cosmetic|skincare|perfume", "fashion": r"fashion|apparel|clothing|jewel", "fitness": r"fitness|\bgyms?\b|sport",
    "automotive": r"automotive|car dealer|dealership|\bauto\b", "manufacturing": r"manufactur|industrial|equipment",
    "education": r"education|school|universit", "food & beverage": r"food|beverage|\bcpg\b|spirits|brewer|drink|snack",
    "franchise / multi-location": r"franchis|multi-location", "construction": r"construction", "entertainment": r"entertainment|gaming|events?\b",
    "professional services": r"professional services|consult", "travel": r"travel|tourism", "finance": r"financ|fintech|insurance|accounting",
    "furniture": r"furniture|home decor|interior", "gifts": r"flowers?|gifts?", "hr / staffing": r"recruit|staffing|\bhr\b",
}
_NICHE_TEXT_RX = {k: re.compile(v, re.I) for k, v in NICHE_TEXT.items()}
SERVICE_LABEL = {"ppc": "Google Ads / PPC", "seo": "SEO"}


def niches_in_text(*texts: str) -> list[str]:
    """Niche keys named in free text, most mentioned first."""
    hay = " | ".join(str(t or "") for t in texts)
    hits = [(k, len(rx.findall(hay))) for k, rx in _NICHE_TEXT_RX.items()]
    return [k for k, n in sorted(hits, key=lambda kv: -kv[1]) if n]


def case_services(c: dict) -> set[str]:
    """What a case proves: ppc / seo / social / email / web / aso, from its service tags, the "SEO search promotion" category and its title."""
    tags = " | ".join([*(c.get("service_tags") or []), *(c.get("industry_tags") or [])]).lower()
    title = str(c.get("title") or "").lower()
    out = set()
    if "ppc" in tags or "contextual" in tags or re.search(r"google ads|\bppc\b|performance max|\bpmax\b|google shopping|contextual advertising|search engine marketing|paid advertising", title):
        out.add("ppc")
    if "seo" in tags or re.search(r"\bseo\b|search engine (?:optimi|promotion)|search engines? promotion", title):
        out.add("seo")
    if "targeted advertising" in tags or re.search(r"meta ads|facebook|instagram|targeted|\bsmm\b|tiktok", title):
        out.add("social")
    if "email" in tags or "email" in title:
        out.add("email")
    if "web development" in tags or re.search(r"development", title):
        out.add("web")
    if "aso" in tags:
        out.add("aso")
    return out


# Niches whose clients are local businesses: a "Local business" case fits them; for the others (brands, online stores, SaaS, B2B)
# a local case (a pub, a repair shop) is a weak proof (P3b run on the copy: an Irish pub for a food-brand agency, again).
LOCAL_NICHES = {"dental", "medical", "med spa / aesthetics", "legal", "home services", "real estate", "restaurants / hospitality",
                "franchise / multi-location", "construction", "fitness", "veterinary", "senior living"}
NICHES_COUNTED = 2            # only the agency's two most named client niches count for an automatic match
NORTH_AMERICA = {"usa", "united states", "us", "canada"}


def match_cases(s: Session, niches: list[str], services: set[str] | None = None) -> list[dict]:
    """Every case, ranked for this agency. Score: their client niche (the two named most; the first counts most; a case with the
    niche's main tag counts more; a case that also fits their other niche counts more), the service we pitch (PPC and / or SEO,
    both when both are wanted), a North American client (the readers are US / Canadian agencies), then other non-Ukrainian ones;
    a "Local business" case loses points for a niche that is not local. Each item carries `niche_match`, `service_match`, `why`."""
    want = set(services or {"ppc", "seo"})
    top = [n for n in (niches or []) if n in NICHE_TAGS][:NICHES_COUNTED]
    rows = [case_dict(c) for c in s.query(MetroCaseLink).order_by(MetroCaseLink.id.desc()).all()]
    out = []
    for r in rows:
        tags = {t.lower() for t in r["industry_tags"]}
        hit_niche, score = None, 0
        for rank, n in enumerate(top):
            mapped = [t.lower() for t in NICHE_TAGS.get(n, [])]
            if any(t in tags for t in mapped):
                hit_niche = n
                score = (6 - rank) * 10 + (3 if mapped and mapped[0] in tags else 0)
                if any(any(t.lower() in tags for t in NICHE_TAGS.get(o, [])) for o in top if o != n):
                    score += 2
                if "local business" in tags and n not in LOCAL_NICHES:
                    score -= 3
                break
        svc = case_services(r) & want
        if svc:
            score += 5 + (2 if svc == want and len(want) > 1 else 0)
        country = (r["country"] or "").lower()
        score += 3 if country in NORTH_AMERICA else 0 if country == "ukraine" else 1
        why = []
        if hit_niche:
            why.append(f"their clients: {hit_niche}")
        if svc:
            why.append(" and ".join(SERVICE_LABEL.get(x, x) for x in sorted(svc)))
        out.append({**r, "niche_match": hit_niche, "service_match": sorted(svc), "why": ", ".join(why) or "no match", "_score": score})
    out.sort(key=lambda r: (-r["_score"], -r["id"]))
    for r in out:
        r.pop("_score", None)
    return out


def best_match(s: Session, niches: list[str], services: set[str] | None = None) -> dict | None:
    """The case a wave attaches automatically: it must match BOTH a client niche and the service; otherwise none (a weak case
    is worse than no case; Oleh picks one with "Change case")."""
    ranked = [r for r in match_cases(s, niches, services) if r["niche_match"] and r["service_match"]]
    return ranked[0] if ranked else None
