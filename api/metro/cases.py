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
