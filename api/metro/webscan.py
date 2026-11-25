"""Website scan (METRO_PLAN.md Phase 2, step 2). No LinkedIn visit, no browser: the backend fetches the
company's public pages itself and reads what is in the HTML.

What it looks for (only what is visible in the page source; a tag injected later by a tag manager is
reported as "tag manager present", never guessed):
  * Google Ads tag (AW-...), GA4 (G-...), legacy Universal Analytics (UA-...), Google Tag Manager (GTM-...),
    Meta pixel, call tracking (CallRail, CallTrackingMetrics, WhatConverts, Invoca ...)
  * a booking form / scheduler (Calendly, Acuity, Zocdoc, ... or a "book now" call to action) and any form
  * the CMS (WordPress, Shopify, Wix, Squarespace, Webflow, ...)
  * service pages and location pages (counted from the internal links)
  * blog freshness: the newest dated post found on the blog index
  * public emails and phones on the pages it read

At most MAX_PAGES pages per company (home, contact, blog, one services page), paced, and the result is a
dated snapshot (`metro_companies.website_scan_json` + `website_scan_at`) that is reused until it is older
than the cache lifetime in Settings. A host that resolves to a private or loopback address is never fetched.
"""
from __future__ import annotations

import ipaddress
import re
import socket
import time
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urljoin, urlparse

MAX_PAGES = 5
MAX_BYTES = 1_500_000
USER_AGENT = "Mozilla/5.0 (compatible; IT-Force-Metro/1.0; +https://itforce.ua)"

Fetched = tuple[int, str, str]          # (status, final url, text)
Fetcher = Callable[[str], Fetched]


def is_public_host(host: str) -> bool:
    """False for localhost, private, loopback and link-local addresses (so a CSV cannot make us call our own network)."""
    host = (host or "").strip().lower().strip("[]")
    if not host or host in ("localhost",) or host.endswith((".local", ".internal", ".localhost")):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True            # does not resolve: the fetch itself will fail; nothing private is reached
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return True


def http_fetcher(timeout: float = 12.0, allow_private: bool = False) -> Fetcher:
    import httpx

    def fetch(url: str) -> Fetched:
        host = urlparse(url).hostname or ""
        if not allow_private and not is_public_host(host):
            return 0, url, ""
        try:
            with httpx.Client(follow_redirects=True, timeout=timeout, headers={"User-Agent": USER_AGENT,
                              "Accept": "text/html,application/xhtml+xml"}) as c:
                r = c.get(url)
                ctype = r.headers.get("content-type", "")
                if "html" not in ctype and "xml" not in ctype and ctype:
                    return r.status_code, str(r.url), ""
                final_host = r.url.host or ""
                if not allow_private and not is_public_host(final_host):
                    return 0, str(r.url), ""
                return r.status_code, str(r.url), r.text[:MAX_BYTES]
        except Exception:
            return 0, url, ""
    return fetch


# ───────────────────────── pure extraction ─────────────────────────

_TAGS = {
    "google_ads":  re.compile(r"\bAW-\d{6,}\b|googleadservices\.com/pagead|googleads\.g\.doubleclick\.net", re.I),
    "ga4":         re.compile(r"\bG-[A-Z0-9]{8,12}\b"),
    "universal_analytics": re.compile(r"\bUA-\d{4,10}-\d{1,3}\b|google-analytics\.com/analytics\.js|ga\('create'", re.I),
    "tag_manager": re.compile(r"\bGTM-[A-Z0-9]{4,10}\b|googletagmanager\.com/gtm\.js", re.I),
    "meta_pixel":  re.compile(r"fbq\(\s*['\"]init|connect\.facebook\.net/[^'\"]+/fbevents\.js", re.I),
    "linkedin_insight": re.compile(r"snap\.licdn\.com/li\.lms-analytics|_linkedin_partner_id", re.I),
    "call_tracking": re.compile(r"callrail\.com|calltrackingmetrics\.com|tctm\.co|whatconverts\.com|invoca\.net|"
                                r"callfire|dialogtech|ruler\.analytics|ruleranalytics|infinity\.convirza|convirza", re.I),
}
_BOOKING = re.compile(r"calendly\.com|acuityscheduling\.com|squareup\.com/appointments|simplybook|setmore\.com|zocdoc\.com|"
                      r"mindbodyonline|janeapp\.com|nexhealth|localmed|healthgrades\.com/.*schedule|opentable\.com|"
                      r"booksy\.com|vagaro\.com|fresha\.com|appointy\.com|youcanbook\.me|hubspot\.com/meetings|"
                      r"tidycal|cal\.com/", re.I)
_BOOK_CTA = re.compile(r"\b(book (?:an? |your )?(?:appointment|consultation|visit|now|online)|schedule (?:an? |your )?"
                       r"(?:appointment|consultation|visit)|request (?:an? )?appointment|free consultation)\b", re.I)
_CMS = [
    ("WordPress", re.compile(r"/wp-content/|/wp-includes/|name=[\"']generator[\"'][^>]*WordPress", re.I)),
    ("Shopify", re.compile(r"cdn\.shopify\.com|Shopify\.theme", re.I)),
    ("Wix", re.compile(r"static\.wixstatic\.com|wix-code|X-Wix", re.I)),
    ("Squarespace", re.compile(r"static1?\.squarespace\.com|squarespace-cdn|Squarespace", re.I)),
    ("Webflow", re.compile(r"webflow\.com|data-wf-(?:page|site)", re.I)),
    ("Duda", re.compile(r"multiscreensite\.com|dudaone|duda\.co", re.I)),
    ("GoDaddy", re.compile(r"img1\.wsimg\.com|godaddy\.com/websites", re.I)),
    ("Drupal", re.compile(r"Drupal\.settings|/sites/default/files/", re.I)),
    ("Joomla", re.compile(r"/media/jui/|Joomla!", re.I)),
    ("HubSpot CMS", re.compile(r"hs-scripts\.com|hubspotusercontent|hs_cos_wrapper", re.I)),
    ("Magento", re.compile(r"Mage\.Cookies|/static/frontend/Magento", re.I)),
]
_SERVICE_PATH = re.compile(r"/(services?|treatments?|procedures?|what-we-do|solutions|specialt(?:y|ies)|practice-areas?|our-services|"
                           r"products)(/|$|\?)", re.I)
_LOCATION_PATH = re.compile(r"/(locations?|areas?-we-serve|service-areas?|serving|offices?|find-us|visit-us|clinics?)(/|$|\?)", re.I)
_CONTACT_PATH = re.compile(r"/(contact|contact-us|get-in-touch|reach-us)(/|$|\?|\.html?)", re.I)
_BLOG_PATH = re.compile(r"/(blog|news|insights|articles|resources|journal|updates)(/|$|\?)", re.I)
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
_JUNK_EMAIL = re.compile(r"(\.(png|jpe?g|gif|svg|webp|css|js)$)|sentry|wixpress|example\.|@2x|u00|noreply|no-reply|"
                         r"domain\.com|yourdomain|email\.com$|godaddy|squarespace", re.I)
_PHONE = re.compile(r"href=[\"']tel:([+\d][\d\s().\-]{6,20})", re.I)
_HREF = re.compile(r"<a\b[^>]*?href=[\"']([^\"'#][^\"']*)[\"']", re.I)
_DATE_PATTERNS = [
    re.compile(r"article:published_time[\"'][^>]*content=[\"'](\d{4}-\d{2}-\d{2})", re.I),
    re.compile(r"<time[^>]*datetime=[\"'](\d{4}-\d{2}-\d{2})", re.I),
    re.compile(r"\"datePublished\"\s*:\s*\"(\d{4}-\d{2}-\d{2})", re.I),
    re.compile(r"\"dateModified\"\s*:\s*\"(\d{4}-\d{2}-\d{2})", re.I),
]
# Marketing services a company names on its own pages (agency fit); a term counts when it appears in the visible text.
MARKETING_TERMS = {
    "ppc": r"\bppc\b|pay[- ]per[- ]click|paid search|paid media|paid advertising",
    "google_ads": r"google ads|adwords",
    "seo": r"\bseo\b|search engine optimi[sz]ation",
    "social_media": r"social media (?:marketing|management|advertising)|paid social|meta ads|facebook ads",
    "web_design": r"web ?(?:site )?design|web development|website development",
    "branding": r"\bbranding\b|brand identity",
    "content": r"content (?:marketing|creation|strategy)",
    "email_marketing": r"email marketing",
    "ecommerce": r"e-?commerce",
    "white_label": r"white[- ]?label",
}
_TERM_RX = {k: re.compile(v, re.I) for k, v in MARKETING_TERMS.items()}
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_META_DESC = re.compile(r"<meta[^>]+name=[\"']description[\"'][^>]*content=[\"']([^\"']*)", re.I)
_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
_STRIP = re.compile(r"<[^>]+>")


def _clean(t: str, n: int = 200) -> str:
    return re.sub(r"\s+", " ", _STRIP.sub(" ", t or "")).strip()[:n]


# A parked or for-sale page belongs to nobody we want: the domain registrar's page, not the company's.
_PARKED = re.compile(r"(this|the) (domain|web ?site|web page)( name)?( is|may be)? (currently )?(for sale|available for purchase|parked)|"
                     r"domain (name )?(is )?for sale|buy this domain|is for sale|this domain (is|may be) (for sale|available)|"
                     r"make an offer (on|for) this domain|domain parking|parked (free|domain|at|by)|parkingcrew|sedoparking|"
                     r"hugedomains|afternic|dan\.com/|register\.com/parked|domain (has )?expired|location\.href\s*=\s*[\"']/lander|"
                     r"website (is )?(coming soon|under construction) .{0,40}(godaddy|namecheap)|"
                     r"this site can.t be reached|default web ?site page|apache2 (ubuntu )?default page|welcome to nginx", re.I)
PARKING_HOSTS = ("hugedomains.com", "sedo.com", "sedoparking.com", "dan.com", "afternic.com", "godaddy.com", "namecheap.com",
                 "squadhelp.com", "undeveloped.com", "parkingcrew.net", "bodis.com", "above.com", "domainmarket.com")


_NON_TEXT = re.compile(r"<(script|style|noscript|svg|template)\b.*?</\1>", re.I | re.S)      # code and styles are not what a page says


def is_parked(html: str, final_url: str = "") -> bool:
    """True for a registrar's parking or for-sale page (by its words, or because the address ended on a parking host)."""
    host = (urlparse(final_url).hostname or "").lower().removeprefix("www.")
    if host and any(host == h or host.endswith("." + h) for h in PARKING_HOSTS):
        return True
    text = _clean(html or "", 6000)
    return bool(_PARKED.search(text) or _PARKED.search((html or "")[:6000]))


def find_tag_ids(html: str) -> dict:
    """The identifiers behind the tags (for the record; never shown as a hook unless stored)."""
    return {"google_ads": sorted(set(re.findall(r"\bAW-\d{6,}\b", html)))[:5],
            "ga4": sorted(set(re.findall(r"\bG-[A-Z0-9]{8,12}\b", html)))[:5],
            "tag_manager": sorted(set(re.findall(r"\bGTM-[A-Z0-9]{4,10}\b", html)))[:5]}


def analyze_page(html: str, url: str) -> dict:
    """What one page tells us. Pure: no network."""
    html = html or ""
    sig = {k: bool(rx.search(html)) for k, rx in _TAGS.items()}
    booking_tool = bool(_BOOKING.search(html))
    booking_cta = bool(_BOOK_CTA.search(_clean(html, 400000)))
    has_form = bool(re.search(r"<form\b", html, re.I))
    cms = next((name for name, rx in _CMS if rx.search(html)), None)
    host = urlparse(url).hostname or ""
    links, service_links, location_links, contact_url, blog_url = set(), set(), set(), None, None
    for m in _HREF.finditer(html):
        href = m.group(1).strip()
        if href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        absu = urljoin(url, href)
        pu = urlparse(absu)
        if (pu.hostname or "").lower().removeprefix("www.") != host.lower().removeprefix("www."):
            continue
        path = pu.path or "/"
        if path in ("", "/"):
            continue
        links.add(absu.split("#")[0])
        if _SERVICE_PATH.search(path + "/"):
            service_links.add(absu.split("#")[0])
        if _LOCATION_PATH.search(path + "/"):
            location_links.add(absu.split("#")[0])
        if contact_url is None and _CONTACT_PATH.search(path):
            contact_url = absu.split("#")[0]
        if blog_url is None and _BLOG_PATH.search(path):
            blog_url = absu.split("#")[0]
    emails = sorted({e.lower() for e in _EMAIL.findall(html) if not _JUNK_EMAIL.search(e)})[:8]
    phones = sorted({re.sub(r"\s+", " ", p).strip() for p in _PHONE.findall(html)})[:4]
    dates = []
    for rx in _DATE_PATTERNS:
        dates += rx.findall(html)
    text = _clean(html, 400000)
    terms = sorted(k for k, rx in _TERM_RX.items() if rx.search(text))
    t = _TITLE.search(html)
    d = _META_DESC.search(html)
    h = _H1.search(html)
    return {"url": url, "signals": sig, "ids": find_tag_ids(html), "booking_tool": booking_tool, "booking_cta": booking_cta,
            "has_form": has_form, "cms": cms, "service_links": sorted(service_links)[:30], "location_links": sorted(location_links)[:30],
            "contact_url": contact_url, "blog_url": blog_url, "emails": emails, "phones": phones, "dates": sorted(set(dates))[-20:],
            "title": _clean(t.group(1), 160) if t else None, "meta_description": _clean(d.group(1), 300) if d else None,
            "h1": _clean(h.group(1), 160) if h else None, "internal_links": len(links), "marketing_terms": terms,
            "parked": is_parked(html, url)}


def normalize_site(domain_or_url: str) -> tuple[str, str] | None:
    """(domain, https URL) for a company site, or None."""
    v = (domain_or_url or "").strip()
    if not v:
        return None
    if not re.match(r"^[a-z]+://", v, re.I):
        v = "https://" + v
    pu = urlparse(v)
    host = (pu.hostname or "").lower().removeprefix("www.")
    if not re.fullmatch(r"([a-z0-9-]+\.)+[a-z]{2,}", host):
        return None
    return host, f"https://{host}/"


def scan_site(domain: str, fetch: Fetcher, *, sleep: Callable[[float], None] = time.sleep, pace: float = 3.0,
              now: datetime | None = None) -> dict:
    """Read a company's site. Returns the snapshot dict; `ok` is False when the home page could not be read."""
    site = normalize_site(domain)
    if site is None:
        return {"ok": False, "error": "not a valid domain", "domain": domain}
    dom, home = site
    pages, fetched, errors = {}, 0, []

    def get(url: str, label: str):
        nonlocal fetched
        if fetched >= MAX_PAGES or url in {p["url"] for p in pages.values()}:
            return None
        if fetched:
            sleep(pace)
        status, final, text = fetch(url)
        fetched += 1
        if status and 200 <= status < 300 and text:
            pages[label] = analyze_page(text, final)
            pages[label]["status"] = status
            return pages[label]
        errors.append(f"{label}: {status or 'no answer'}")
        return None

    h = get(home, "home")
    if h is None and not home.startswith("https://www."):
        h = get(f"https://www.{dom}/", "home")
    if h is None:
        http_try = get(f"http://{dom}/", "home")
        h = http_try
    if h is None:
        return {"ok": False, "domain": dom, "error": "the site did not answer", "errors": errors,
                "scanned_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    if h["contact_url"]:
        get(h["contact_url"], "contact")
    blog = get(h["blog_url"], "blog") if h["blog_url"] else None
    if h["service_links"]:
        get(h["service_links"][0], "service")

    # roll the per-page findings up into one record
    def any_page(key, sub=None):
        return any((p["signals"][sub] if sub else p[key]) for p in pages.values())

    signals = {k: any_page(None, k) for k in _TAGS}
    emails = sorted({e for p in pages.values() for e in p["emails"]})
    own = [e for e in emails if e.split("@")[-1].endswith(dom)]
    phones = sorted({x for p in pages.values() for x in p["phones"]})
    service_links = sorted({u for p in pages.values() for u in p["service_links"]})
    location_links = sorted({u for p in pages.values() for u in p["location_links"]})
    post_dates = sorted(set(blog["dates"])) if blog else []
    newest = post_dates[-1] if post_dates else None
    ref = now or datetime.now(timezone.utc)
    days_since = None
    if newest:
        try:
            days_since = (ref.date() - datetime.strptime(newest, "%Y-%m-%d").date()).days
        except ValueError:
            days_since = None
    scan = {
        "ok": True, "domain": dom, "scanned_at": ref.strftime("%Y-%m-%dT%H:%M:%SZ"), "pages_read": sorted(pages),
        "signals": signals,
        "ids": {k: sorted({i for p in pages.values() for i in p["ids"][k]}) for k in ("google_ads", "ga4", "tag_manager")},
        "booking": {"tool": any_page("booking_tool"), "cta": any_page("booking_cta"), "form": any_page("has_form")},
        "cms": next((p["cms"] for p in pages.values() if p["cms"]), None),
        "service_pages": len(service_links), "location_pages": len(location_links),
        "service_examples": service_links[:5], "location_examples": location_links[:5],
        "blog": {"found": blog is not None, "url": h["blog_url"], "newest_post": newest, "days_since": days_since,
                 "dated_posts": len(post_dates)},
        "marketing_terms": sorted({t for p in pages.values() for t in p["marketing_terms"]}),
        "emails": emails[:8], "emails_on_own_domain": own[:5], "phones": phones[:3],
        "title": h["title"], "meta_description": h["meta_description"], "h1": h["h1"],
        "final_url": h["url"], "errors": errors, "parked": bool(h.get("parked")),
    }
    return scan


def probe_home(domain: str, fetch: Fetcher) -> dict:
    """ONE page: the home page of a guessed domain (https, then www). The cheap look the domain finder takes before
    it believes a guess; a full scan comes later, only for a domain that passed. Returns the home page's analysis
    with ok / parked / final host, or {ok: False}."""
    site = normalize_site(domain)
    if site is None:
        return {"ok": False, "domain": domain, "error": "not a valid domain"}
    dom, home = site
    for url in (home, f"https://www.{dom}/"):
        status, final, text = fetch(url)
        if status and 200 <= status < 300 and text:
            a = analyze_page(text, final)
            return {"ok": True, "domain": dom, "final_url": final, "final_host": (urlparse(final).hostname or "").lower().removeprefix("www."),
                    "title": a["title"], "h1": a["h1"], "meta_description": a["meta_description"], "parked": a["parked"],
                    "emails": a["emails"], "text": _clean(_NON_TEXT.sub(" ", text), 400000)[:4000].lower()}
    return {"ok": False, "domain": dom, "error": "no answer"}
