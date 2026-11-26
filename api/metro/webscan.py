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
  * Phase 3 (agency hooks): what they SELL (service pages by path or slug, and service headings on one-page sites), the
    industries they serve (industries pages, niche words in their links and text), case-study titles, a careers page and
    any PPC / SEO / paid-media role on it, partner badges (Google, HubSpot, Shopify, Meta ...), client-logo alt texts,
    the founding year, a team size and "nationwide / across Canada" phrases. A finding is only what the HTML says.

At most MAX_PAGES pages per company (home, services, work, careers, industries, contact, blog), paced, and the result is a
dated snapshot (`metro_companies.website_scan_json` + `website_scan_at`) that is reused until it is older
than the cache lifetime in Settings. A host that resolves to a private or loopback address is never fetched.
"""
from __future__ import annotations

import html as _html
import ipaddress
import re
import socket
import time
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urljoin, urlparse

MAX_PAGES = 7
SCAN_VERSION = 2            # 2 = Phase 3 (services, industries, case studies, careers, partners ...). An older scan is re-read.
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
    return re.sub(r"\s+", " ", _html.unescape(_STRIP.sub(" ", t or ""))).strip()[:n]


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



# ───────────────────────── Phase 3: what an agency sells, for whom, with which badges ─────────────────────────
# Why: the 26 Nov hook review found "0 service pages" on sites that clearly list services. The old rule counted only
# links under /services/; agencies use flat slugs (/search-engine-optimization, /hubspot-services), /capabilities/...,
# or one-page sites whose services are headings. And nothing said who their clients are or which badges they carry.

_A_TAG = re.compile(r"<a\b[^>]*?href=[\"']([^\"'#][^\"']*)[\"'][^>]*>(.*?)</a>", re.I | re.S)
_SKIP_PATH = re.compile(r"/(blog|news|insights|articles|journal|updates|podcasts?|events?|webinars?|privacy[a-z-]*|terms[a-z-]*|cookies?[a-z-]*|"
                        r"legal|accessibility[a-z-]*|sitemap|site-map|login|sign-?in|cart|checkout|account|wp-content|wp-admin|tag|category|author|"
                        r"feed|page/\d+|contact|contact-us|about|about-us|team|our-team|culture|reviews?|faq|pricing|awards?|resources|ai-policy)(/|$)", re.I)
_SERVICE_PREFIX = re.compile(r"^/(services?|capabilities|what-we-do|solutions|expertise|offerings|our-services|our-[a-z-]*services|"
                             r"specialt(?:y|ies)|treatments?|procedures?|practice-areas?)/", re.I)
_SERVICE_INDEX = re.compile(r"^/(services?|capabilities|what-we-do|solutions|expertise|offerings|our-services|our-[a-z-]*services)/?$", re.I)
SERVICE_WORDS = ("seo", "ppc", "pay-per-click", "google-ads", "adwords", "sem", "search-engine-optimization", "search-engine-marketing",
                 "paid-search", "paid-social", "paid-media", "paid-advertising", "digital-advertising", "social-media", "facebook-ads",
                 "meta-ads", "instagram-advertising", "instagram-marketing", "tiktok", "linkedin-ads", "amazon-ads", "amazon-storefront",
                 "web-design", "website-design", "web-development", "website-development", "development", "wordpress", "woocommerce",
                 "shopify", "hubspot", "salesforce", "branding", "content-marketing", "content-creation", "content-writing",
                 "email-marketing", "cro", "conversion-rate-optimization", "link-building", "local-seo", "technical-seo", "analytics",
                 "marketing-automation", "demand-gen", "account-based-marketing", "revops", "influencer-marketing", "video-production",
                 "ux", "app-development", "ai-services", "ai-marketing", "reputation-management", "online-reputation", "programmatic",
                 "retail-media", "ugc", "pmax", "performance-max", "youtube-ads", "lead-generation", "geo", "aeo", "design-services",
                 "marketing-solutions", "marketing-services", "managed-services", "devops")
_SERVICE_SLUG = re.compile(r"(?:^|-)(" + "|".join(re.escape(w) for w in SERVICE_WORDS) + r")(?:-|$)", re.I)
_CASE_PATH = re.compile(r"/(case-stud(?:y|ies)|case-study-[a-z0-9-]+|results|our-work|work|portfolio|projects|success-stories|"
                        r"[a-z-]*case-studies)(/|$)", re.I)
_INDUSTRY_PATH = re.compile(r"^/(industries|industry|core-verticals|verticals|who-we-serve|industries-we-serve|sectors|markets|"
                            r"markets-we-serve|clients-we-serve)(/|$)", re.I)
_CAREERS_PATH = re.compile(r"^/(careers?|jobs|join-us|join-our-team|work-with-us|hiring|open-positions|employment|vacancies)/?$", re.I)
_CAREERS_HOST = re.compile(r"(boards\.greenhouse\.io|jobs\.lever\.co|apply\.workable\.com|\.breezy\.hr|\.bamboohr\.com|jobs\.ashbyhq\.com|"
                           r"\.recruitee\.com|\.applytojob\.com|wellfound\.com/company)", re.I)
# Niches an agency may serve: the words are matched in its own link slugs and its visible text.
NICHE_WORDS = {
    "dental": r"dental|dentists?|orthodont\w*", "medical": r"medical|healthcare|health ?care|clinics?|physicians?",
    "med spa / aesthetics": r"med ?spas?|aesthetic\w*|plastic surgeons?|plastic surgery|cosmetic surgery", "wellness": r"wellness",
    "legal": r"law firms?|lawyers?|attorneys?", "home services": r"hvac|plumb\w*|roofing|roofers?|home services|landscap\w*|pest control|electricians?",
    "real estate": r"real estate|realtors?|proptech|property management", "restaurants / hospitality": r"restaurants?|hospitality|hotels?",
    "e-commerce": r"e-?commerce|online stores?|dtc|d2c|direct-to-consumer", "saas / tech": r"saas|software companies|tech companies|startups?",
    "b2b": r"b2b", "nonprofit": r"non-?profits?", "beauty": r"beauty|cosmetics|skincare", "fashion": r"fashion|apparel|jewel(?:le)?ry",
    "fitness": r"fitness|gyms?", "automotive": r"automotive|car dealers?|dealerships?",
    "finance": r"financial services|fintech|wealth management|insurance|accounting firms?|cpas?",
    "manufacturing": r"manufactur\w*|industrial", "education": r"education|schools?|universit(?:y|ies)|edtech", "cannabis": r"cannabis|dispensar(?:y|ies)",
    "food & beverage": r"food (?:and|&) beverage|food brands?|beverage brands?|cpg|consumer packaged goods|consumer goods|spirits|breweries|brewery",
    "franchise / multi-location": r"franchis\w*|multi-location", "construction": r"construction", "travel": r"travel|tourism",
    "entertainment": r"entertainment|gaming", "professional services": r"professional services|consulting firms",
    "senior living": r"senior living", "veterinary": r"veterinar\w*|pet care", "solar / energy": r"solar|renewable energy",
}
_NICHE_RX = {k: re.compile(r"\b(?:" + v + r")\b", re.I) for k, v in NICHE_WORDS.items()}
PARTNER_BADGES = [
    ("Google Premier Partner", re.compile(r"google\s+premier\s+partner|premier[- ]partner", re.I)),
    ("Google Partner", re.compile(r"google\s+(?:ads\s+)?partner\b|google\.com/partners|googlepartners|google-partner|partners\.google|"
                                  r"google\.com/adwords/thirdpartypartners", re.I)),
    ("HubSpot Partner", re.compile(r"hubspot\s+(?:(?:platinum|gold|diamond|elite|silver|solutions?|certified)\s+)*(?:solutions?\s+)?partner|"
                                   r"app\.hubspot\.com/ecosystem|hubspot-partner|ecosystem\.hubspot", re.I)),
    ("Shopify Partner", re.compile(r"shopify\s+(?:plus\s+)?(?:partner|expert)|shopify-partner|shopify\.com/partners", re.I)),
    ("Meta Business Partner", re.compile(r"meta\s+business\s+partner|facebook\s+marketing\s+partner|meta\s+(?:certified\s+)?partner|facebook\s+partner", re.I)),
    ("Microsoft Advertising Partner", re.compile(r"microsoft\s+advertising\s+(?:select\s+|elite\s+)?partner|bing\s+ads\s+(?:accredited|partner)|microsoft\s+partner", re.I)),
    ("Salesforce Partner", re.compile(r"salesforce\s+(?:consulting\s+|crm\s+|summit\s+|ridge\s+|crest\s+)?partner|salesforce-partner", re.I)),
    ("Amazon Ads Partner", re.compile(r"amazon\s+(?:ads\s+)?(?:verified\s+|advanced\s+)?partner|amazon\s+spn", re.I)),
    ("Klaviyo Partner", re.compile(r"klaviyo\s+(?:master\s+|gold\s+|platinum\s+|elite\s+|silver\s+)?partner", re.I)),
    ("Semrush Partner", re.compile(r"semrush\s+(?:agency\s+)?partner", re.I)),
    ("TikTok Partner", re.compile(r"tiktok\s+(?:marketing\s+|agency\s+)?partner", re.I)),
    ("BigCommerce Partner", re.compile(r"bigcommerce\s+(?:certified\s+|elite\s+)?partner", re.I)),
    ("Listed on Clutch", re.compile(r"clutch\.co/profile|clutch\s+(?:top|leader|global|champion)", re.I)),
]
_HUBSPOT_TIER = re.compile(r"hubspot\s+(platinum|gold|diamond|elite|silver)", re.I)
_IMG = re.compile(r"<img\b[^>]*>", re.I)
_ALT = re.compile(r"\balt\s*=\s*[\"']([^\"']*)[\"']", re.I)
_SRC = re.compile(r"\bsrc\s*=\s*[\"']([^\"']*)[\"']", re.I)
_CLASS = re.compile(r"\bclass\s*=\s*[\"']([^\"']*)[\"']", re.I)
_HEADING = re.compile(r"<h([2-4])[^>]*>(.*?)</h\1>", re.I | re.S)
_FOUNDED = re.compile(r"\b(?:since|founded in|founded|established in|established|est\.)\s+((?:19[5-9]\d|20[0-2]\d))\b", re.I)
_TEAM = re.compile(r"\bteam of (\d{1,4})\b|\b(\d{1,4})\+?\s+(?:full-time\s+)?(?:employees|team members|in-house experts|experts|specialists|"
                   r"marketers|professionals|people on our team)\b", re.I)
_GEO = re.compile(r"[^.!?]{0,90}\b(?:nationwide|across the (?:us|u\.s\.|usa|united states|country|globe|world)|across (?:canada|north america|the gta)|"
                  r"throughout (?:the us|the united states|canada)|coast to coast|worldwide|globally|in \d+ countries)\b[^.!?]{0,90}", re.I)
_ROLE = re.compile(r"\b(?:(?:senior|junior|lead|head of|sr\.|jr\.)\s+)?(?:ppc|sem|seo|paid (?:search|media|social)|google ads|performance marketing|digital advertising|"
                   r"search engine (?:optimization|marketing)|media buy(?:ing|er)|paid acquisition)\b[^.\n<>]{0,40}?"
                   r"\b(?:specialist|manager|strategist|analyst|coordinator|director|lead|buyer|executive|associate|expert|intern)s?\b", re.I)
_SERVICE_HEADING = re.compile(r"\b(seo|search engine|ppc|pay[- ]per[- ]click|google ads|paid (?:search|media|social|advertising)|social media|"
                              r"email marketing|content (?:marketing|writing|creation)|web(?:site)? (?:design|development)|branding|"
                              r"conversion rate|link building|amazon ads|shopify|hubspot|marketing automation)\b", re.I)
_GENERIC_TEXT = re.compile(r"^(learn more|read more|view (all|more)|see (all|more)|more|details|explore|click here|services?|our services|solutions|"
                           r"capabilities|what we do|home|menu|next|previous|back|view case study|read the case( study)?|case stud(y|ies)|our work|"
                           r"work|view project|see the work|discover more)$", re.I)


def _slug_words(path: str) -> str:
    last = [x for x in path.strip("/").split("/") if x][-1:] or [""]
    w = re.sub(r"[-_]+", " ", re.sub(r"\.(html?|php|aspx?)$", "", last[0])).strip()
    return w[:1].upper() + w[1:] if w else ""


def _link_name(text: str, path: str, kind: str = "") -> str:
    """The name of a linked page: its link text, unless that is generic ("Learn more") or a call to action that shares no word
    with the address ("Let's Build Something" for /design-and-creative-services/): then the address's own words. A case study
    whose link text is a result ("4x Return on ad spend") keeps both: "Holmes smokehouse: 4x Return on ad spend"."""
    name = _clean(_NON_TEXT.sub(" ", text or ""), 90)
    slug = _slug_words(path)
    if not name or len(name) < 3 or _GENERIC_TEXT.match(name):
        return slug
    words = set(re.findall(r"[a-z0-9]{3,}", slug.lower())) - {"case", "study", "studies", "services", "service", "the", "and"}
    shared = words & set(re.findall(r"[a-z0-9]{3,}", name.lower()))
    if words and not shared:
        return f"{slug}: {name}"[:90] if kind == "case" else slug
    return name[:80]


def classify_path(path: str) -> str | None:
    """service | case | industry | careers | location | None, for an internal path. Pure."""
    p = "/" + path.strip("/").lower() + "/"
    if p == "//":
        return None
    if _CAREERS_PATH.match(p.rstrip("/")):
        return "careers"
    if _CASE_PATH.search(p):
        return "case"
    if _INDUSTRY_PATH.match(p):
        return "industry"
    if _SKIP_PATH.search(p):
        return None
    if _LOCATION_PATH.search(p):
        return "location"
    if _SERVICE_PREFIX.match(p) or _SERVICE_INDEX.match(p) or _SERVICE_PATH.search(p):
        return "service"
    parts = [x for x in p.strip("/").split("/") if x]
    if len(parts) <= 2 and _SERVICE_SLUG.search(parts[-1]):
        return "service"
    return None


def find_partners(html: str) -> list[str]:
    """Partner badges named in the page (visible text, image alt texts, links). Pure."""
    alts = " ".join(_ALT.findall(html))
    hrefs = " ".join(m.group(1) for m in _HREF.finditer(html))
    hay = _clean(_NON_TEXT.sub(" ", html), 400000) + " " + alts + " " + hrefs
    out = []
    for label, rx in PARTNER_BADGES:
        if rx.search(hay):
            if label == "Google Partner" and "Google Premier Partner" in out:
                continue
            if label == "HubSpot Partner":
                tier = _HUBSPOT_TIER.search(hay)
                label = f"HubSpot {tier.group(1).title()} Partner" if tier else label
            out.append(label)
    return out


def find_logos(html: str, own: str = "") -> list[str]:
    """Alt texts of images that look like client logos (logo / client / brand in the src, class or alt). Pure."""
    own_key = re.sub(r"[^a-z0-9]", "", own.lower().split(".")[0]) if own else ""
    out = []
    for tag in _IMG.findall(html):
        m = _ALT.search(tag)
        alt = _clean(m.group(1), 80) if m else ""
        meta = " ".join(x.group(1) for x in (_SRC.search(tag), _CLASS.search(tag)) if x).lower() + " " + alt.lower()
        if not alt or not re.search(r"logo|client|brand|partner|customer|trusted", meta):
            continue
        name = re.sub(r"^(client|logo|brand|customer)\s*[=:\-]\s*", "", alt, flags=re.I)
        name = re.sub(r"[\s_-]*(logo|icon|image|img|png|svg|jpe?g|webp)\b.*$", "", name, flags=re.I).strip(" -|_")
        name = name[:1].upper() + name[1:]
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        if (len(name) < 2 or len(name) > 40 or not key or (own_key and (own_key in key or key in own_key))
                or re.search(r"google|hubspot|shopify|meta\b|facebook|clutch|partner|award|badge|certif|linkedin|instagram|twitter|youtube|"
                             r"tiktok|menu|arrow|close|search|phone|icon|placeholder|^logo$", name, re.I)):
            continue
        if name.lower() not in (x.lower() for x in out):
            out.append(name)
    return out[:20]


def find_niches(text: str, slugs: str = "") -> dict:
    """{niche: count} from the visible text and the internal link slugs (dash-separated, read as words). Pure."""
    hay = (text or "") + " " + (slugs or "").replace("-", " ").replace("/", " ")
    out = {}
    for k, rx in _NICHE_RX.items():
        n = len(rx.findall(hay))
        if n:
            out[k] = n
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def find_roles(text: str) -> list[str]:
    """PPC / SEO / paid-media job titles named on a page (a careers page). Pure."""
    out = []
    for m in _ROLE.finditer(text or ""):
        r = re.sub(r"\s+", " ", m.group(0)).strip(" -|:")
        if r.lower() not in (x.lower() for x in out):
            out.append(r[:80])
    return out[:6]


def _dedup(xs: list) -> list:
    seen, out = set(), []
    for x in xs:
        k = re.sub(r"\W+", " ", str(x).lower()).strip()
        if x and k and k not in seen:
            seen.add(k)
            out.append(x)
    return out


def agency_signals(html: str, url: str, text: str) -> dict:
    """The agency-side findings of one page. Pure."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    services, cases, industries, slugs = [], [], [], []
    service_urls, case_urls = set(), set()
    careers_url = industry_index = work_index = services_index = None
    for m in _A_TAG.finditer(html):
        href, inner = m.group(1).strip(), m.group(2)
        if href.startswith(("mailto:", "tel:", "javascript:", "sms:")):
            continue
        absu = urljoin(url, href).split("#")[0]
        pu = urlparse(absu)
        h = (pu.hostname or "").lower().removeprefix("www.")
        if h != host:
            if careers_url is None and _CAREERS_HOST.search(absu):
                careers_url = absu
            continue
        path = pu.path or "/"
        slugs.append(path)
        kind = classify_path(path)
        depth = len([x for x in path.strip("/").split("/") if x])
        if kind == "careers":
            careers_url = careers_url or absu
        elif kind == "service":
            if _SERVICE_INDEX.match(path):
                services_index = services_index or absu
                continue
            if absu not in service_urls:
                service_urls.add(absu)
                services.append(_link_name(inner, path, "service"))
        elif kind == "case":
            if depth <= 1 and not re.search(r"case-study-", path, re.I):
                work_index = work_index or absu
                continue
            if absu not in case_urls:
                case_urls.add(absu)
                cases.append(_link_name(inner, path, "case"))
        elif kind == "industry":
            if depth <= 1:
                industry_index = industry_index or absu
                continue
            industries.append(_link_name(inner, path, "industry"))
    for _lvl, inner in _HEADING.findall(html):                       # one-page sites: the services are headings
        hd = _clean(_NON_TEXT.sub(" ", inner), 90)
        if 3 <= len(hd) <= 60 and _SERVICE_HEADING.search(hd):
            services.append(hd)
    founded = sorted({int(y) for y in _FOUNDED.findall(text)})
    team = [re.sub(r"\s+", " ", m.group(0)) for m in _TEAM.finditer(text)][:2]
    geo = [re.sub(r"\s+", " ", m.group(0)).strip()[:180] for m in _GEO.finditer(text)][:3]
    return {"services": _dedup(services)[:30], "service_urls": sorted(service_urls)[:40], "case_studies": _dedup(cases)[:15],
            "industries": _dedup(industries)[:20], "careers_url": careers_url, "services_index": services_index,
            "work_index": work_index, "industry_index": industry_index, "partners": find_partners(html),
            "client_logos": find_logos(html, host), "niches": find_niches(text, " ".join(slugs)),
            "founded_year": founded[0] if founded else None, "team_size_text": team, "geo_phrases": geo}


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
    text = _clean(_NON_TEXT.sub(" ", html), 400000)
    terms = sorted(k for k, rx in _TERM_RX.items() if rx.search(text))
    agency = agency_signals(html, url, text)
    service_links |= set(agency["service_urls"])
    t = _TITLE.search(html)
    d = _META_DESC.search(html)
    h = _H1.search(html)
    return {"url": url, "signals": sig, "ids": find_tag_ids(html), "booking_tool": booking_tool, "booking_cta": booking_cta,
            "has_form": has_form, "cms": cms, "service_links": sorted(service_links)[:30], "location_links": sorted(location_links)[:30],
            "contact_url": contact_url, "blog_url": blog_url, "emails": emails, "phones": phones, "dates": sorted(set(dates))[-20:],
            "title": _clean(t.group(1), 160) if t else None, "meta_description": _clean(d.group(1), 300) if d else None,
            "h1": _clean(h.group(1), 160) if h else None, "internal_links": len(links), "marketing_terms": terms,
            "parked": is_parked(html, url), "agency": agency, "roles": find_roles(text)}


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
    ag = h.get("agency") or {}
    # Phase 3 order: what they sell, their work, careers, industries, then contact and blog (the niche readings).
    svc = ag.get("services_index") or (h["service_links"][0] if h["service_links"] else None)
    if svc:
        get(svc, "service")
    if ag.get("work_index"):
        get(ag["work_index"], "work")
    if ag.get("careers_url"):
        get(ag["careers_url"], "careers")
    if ag.get("industry_index"):
        get(ag["industry_index"], "industries")
    if h["contact_url"]:
        get(h["contact_url"], "contact")
    blog = get(h["blog_url"], "blog") if h["blog_url"] else None

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
        "ok": True, "version": SCAN_VERSION, "domain": dom, "scanned_at": ref.strftime("%Y-%m-%dT%H:%M:%SZ"), "pages_read": sorted(pages),
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
    scan.update(_agency_rollup(pages, dom))
    return scan


def _partners_dedup(xs: list[str]) -> list[str]:
    """"HubSpot Partner" goes when a page named the tier ("HubSpot Platinum Partner"); the same for Google and Premier."""
    out = list(xs)
    if any(x.startswith("HubSpot ") and x != "HubSpot Partner" for x in out):
        out = [x for x in out if x != "HubSpot Partner"]
    if "Google Premier Partner" in out:
        out = [x for x in out if x != "Google Partner"]
    return out


def _agency_rollup(pages: dict, dom: str) -> dict:
    """Phase 3: the agency findings of every page read, merged. `services` = what they sell (names), `industries` = the
    industries pages they list, `niches` = niche words counted over their text and links, `careers` = the careers page and any
    PPC / SEO / paid-media role named on it."""
    ags = [(label, p.get("agency") or {}) for label, p in pages.items()]
    pick = lambda key: _dedup([x for _l, a in ags for x in a.get(key) or []])
    niches: dict = {}
    for _l, a in ags:
        for k, v in (a.get("niches") or {}).items():
            niches[k] = niches.get(k, 0) + v
    careers_page = pages.get("careers")
    careers_url = next((a.get("careers_url") for _l, a in ags if a.get("careers_url")), None)
    roles = careers_page.get("roles") if careers_page else []
    founded = sorted(a["founded_year"] for _l, a in ags if a.get("founded_year"))
    return {"services": pick("services")[:30], "case_studies": pick("case_studies")[:15], "industries": pick("industries")[:20],
            "niches": dict(sorted(niches.items(), key=lambda kv: -kv[1])[:8]), "partners": _partners_dedup(pick("partners")),
            "client_logos": pick("client_logos")[:20], "founded_year": founded[0] if founded else None,
            "team_size_text": pick("team_size_text")[:2], "geo_phrases": pick("geo_phrases")[:3],
            "careers": {"found": careers_url is not None, "read": careers_page is not None, "url": careers_url,
                        "ppc_seo_roles": roles or []}}


def scan_current(raw) -> bool:
    """True when a stored scan (JSON text or dict) was made by this version of the scanner. A good scan of an older version
    is still a good reading (kept until replaced); it is just re-read at the next chance (Phase 3: the agency fields)."""
    import json as _json
    try:
        snap = _json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return False
    return isinstance(snap, dict) and int(snap.get("version") or 1) >= SCAN_VERSION


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
