# -*- coding: utf-8 -*-
"""2-week SEO / GEO / Google Ads focus test (owner, 2026-11-19).

Mirrors the owner-approved test_week pattern (feed_config.json block, auto-expiry in
Europe/Kyiv time, nothing recorded destructively): while `feed_config.json`'s
`focus_test` block is active, a newly captured API job that matches NONE of the
keep-signal categories is hidden (jobs.hidden_at set, same mechanism as the manual
"Hide from feed" button — fully reversible with the existing /jobs/{id}/unhide route,
no new rescue mechanism needed) and recorded in feed_drops with reason
"focus:<category>". After the block's `until` date (Kyiv), focus_test_active() returns
False by itself and no job is hidden by this module again — no manual step.

Deliberately separate from api/upwork_api.py and the feed fetch/filter pipeline
(owner instruction): this only runs inside api/main.py's _upsert_api_jobs, AFTER a
posting has already passed the normal feed filter and is about to be stored. It never
drops a posting outright -- the row is always inserted, just hidden -- so nothing here
can lose a job the normal filter already decided to keep.

Pure functions only; no DB access, no I/O. Tested directly (tests/focus-filter.test
equivalent: tests/test_focus_filter.py) with the owner's own real examples.
"""
import re
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
    _OWNER_TZ = ZoneInfo("Europe/Kyiv")
except Exception:
    _OWNER_TZ = None


def focus_test_active(cfg: dict, now: "datetime | None" = None) -> bool:
    """Same inclusive-date, Europe/Kyiv, malformed-date-never-loosens-the-filter
    rule as upwork_api.test_week_active (reimplemented here, not imported, since
    that module is off limits for this task)."""
    tw = (cfg or {}).get("focus_test")
    if not isinstance(tw, dict) or not tw.get("until"):
        return False
    moment = now or datetime.now(timezone.utc)
    today = moment.astimezone(_OWNER_TZ).date() if _OWNER_TZ else moment.date()
    try:
        until = datetime.strptime(str(tw["until"]), "%Y-%m-%d").date()
        start = datetime.strptime(str(tw["from"]), "%Y-%m-%d").date() if tw.get("from") else None
    except ValueError:
        return False
    return (start is None or today >= start) and today <= until


# ── keep signals: ANY one match keeps the job, whatever else is in it ───────────
# A posting that mixes a keep signal with anything else (e.g. "Shopify developer +
# SEO") is KEPT -- these are checked first and short-circuit before any hide check.
#
# "a generic digital/ecommerce marketing manager role that mentions Google Ads or
# SEO" needs no pattern of its own: GOOGLE_ADS / SEO below already match on any
# mention anywhere in the text, title included, regardless of what the role is
# titled -- a title pattern would be strictly redundant with the text-wide match.
KEEP_PATTERNS = {
    "seo": re.compile(
        r"\bseo\b|search engine optimi[sz]ation|link[\s-]?building|\bbacklinks?\b|seo audit",
        re.I,
    ),
    # Bare "geo" is deliberately NOT matched on its own -- it is overwhelmingly
    # "geo-targeting" / "geography" in ordinary ad-agency postings, which would
    # falsely keep a plain Meta/TikTok-ads job. Only the real AI-search usage
    # (the acronym pair, or "GEO/AEO" next to an optimization/visibility word)
    # counts.
    "geo_ai_search": re.compile(
        r"generative engine optimi[sz]ation|answer engine optimi[sz]ation|\baeo\b|"
        r"\bllm\b\s*(?:seo|visibility|search|optimi[sz]ation)|ai[\s-]?search(?:\s+optimi[sz]ation|\s+visibility)?|"
        r"ai overview|chatgpt\s*(?:visibility|search|optimi[sz]ation)|"
        r"\bgeo\b\s*(?:optimi[sz]ation|visibility)|(?:aeo|seo)\s*/\s*geo\b|\bgeo\s*/\s*aeo\b",
        re.I,
    ),
    "google_ads": re.compile(
        r"google ads|\bppc\b|paid search|performance\s*max\b|\bpmax\b|google shopping|merchant center",
        re.I,
    ),
    "analytics": re.compile(
        r"\bga4\b|google analytics|google tag manager|\bgtm\b|search console|\blooker\b",
        re.I,
    ),
}

# ── hide categories: only used to LABEL the feed_drops reason once NO keep signal
# matched. A job matching one of these AND a keep signal was already kept above. ──
HIDE_PATTERNS = {
    "webdev": re.compile(
        r"wordpress|shopify\s*(?:developer|development|store\s*build|theme)|webflow|"
        r"web\s*(?:site)?\s*(?:design|develop)|theme development|app development|"
        r"full[\s-]?stack|\bwix\b|squarespace",
        re.I,
    ),
    "design": re.compile(
        r"graphic design|\bui\s*/?\s*ux\b|ux design|ui design|logo design|brand identity|"
        r"\bfigma\b|\billustrator\b|\bphotoshop\b",
        re.I,
    ),
    "video": re.compile(r"video editing|video production|videographer|motion graphics|youtube editor", re.I),
    "copywriting": re.compile(r"copywrit|content writer|blog writer|ghostwrit", re.I),
    "social": re.compile(
        r"social media manage|social media management|community manage|instagram manage|tiktok content",
        re.I,
    ),
    "meta_tiktok_ads": re.compile(
        r"\b(?:meta|facebook|instagram|tiktok) ads\b|facebook advertising|meta advertising|tiktok advertising",
        re.I,
    ),
    "data_entry": re.compile(r"data entry|virtual assistant|admin(?:istrative)? assistant", re.I),
}


def classify_focus(title: str, text: str, keywords: "str | None" = None):
    """(keep: bool, category: str). category is which KEEP pattern matched when
    keep is True, or which HIDE pattern (or "no-signal" if none) matched when
    keep is False -- "no-signal" is the feed_drops reason for a posting that is
    off-lane but doesn't fit any of the owner's named examples either."""
    blob = " ".join(p for p in (title, text, keywords) if p)
    for cat, pat in KEEP_PATTERNS.items():
        if pat.search(blob):
            return True, cat
    for cat, pat in HIDE_PATTERNS.items():
        if pat.search(blob):
            return False, cat
    return False, "no-signal"
