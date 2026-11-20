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


# ── keep signals, split strong / weak (owner, 2026-11-20, after the 14-day replay
# found ~30% of kept jobs riding on a single incidental word -- e.g. "SEO" once in
# an Engineering Manager posting's migration checklist) ─────────────────────────
#
# STRONG: a specific, multi-word (or otherwise unambiguous) phrase. Keeps the job
# ANYWHERE it appears -- title, keywords or description -- same as before. A
# posting that mixes a strong signal with anything else (e.g. "Shopify developer +
# technical SEO") is KEPT.
STRONG_PATTERNS = {
    "seo": re.compile(
        r"search engine optimi[sz]ation|technical seo|local seo|e-?commerce seo|seo audit|link[\s-]?building",
        re.I,
    ),
    # Bare "geo" is deliberately NOT matched on its own -- it is overwhelmingly
    # "geo-targeting" / "geography" in ordinary ad-agency postings, which would
    # falsely keep a plain Meta/TikTok-ads job. Only the real AI-search usage
    # (the full phrase, or "GEO/AEO" next to an optimization/visibility word) counts.
    "geo_ai_search": re.compile(
        r"generative engine optimi[sz]ation|answer engine optimi[sz]ation|\baeo\b|"
        r"\bllm\b\s*(?:seo|visibility|search|optimi[sz]ation)|ai[\s-]?search(?:\s+optimi[sz]ation|\s+visibility)?|"
        r"ai overview|chatgpt\s*(?:visibility|search|optimi[sz]ation)|"
        r"\bgeo\b\s*(?:optimi[sz]ation|visibility)|(?:aeo|seo)\s*/\s*geo\b|\bgeo\s*/\s*aeo\b",
        re.I,
    ),
    # "google ad(s)" / "adwords" / "ad words" moved to STRONG 2026-11-20 (recall-test
    # gaps #2078 "Google Ad Management and Editing", singular "ad", and #22138
    # "Google Adwords Specialist", the product's old name -- both real Google Ads
    # jobs that the weak-mention rules hid). "Google Ad Manager" (GAM, a separate
    # ad-serving product, unrelated to Google Ads/PPC -- a keyword on a real job
    # the owner does NOT want swept in) is excluded via the negative lookahead.
    "google_ads": re.compile(
        r"\bppc\b|paid search|performance\s*max\b|\bpmax\b|google shopping|merchant center|"
        r"\bgoogle\s*ads?\b(?!\s*manager)|\bad\s*words\b",
        re.I,
    ),
    "analytics": re.compile(
        r"google analytics|google tag manager|search console|\blooker\b",
        re.I,
    ),
}

# WEAK: a single bare mention with no supporting context -- exactly the replay's
# false-positive shape (a one-word "SEO"/"GA4"/"Backlink" buried in an unrelated
# job's description). A weak match ONLY counts as a keep if one of:
#   1. it ALSO appears in the title or keywords (not just the description);
#   2. the job's TITLE itself reads as a marketing/ads role (MARKETING_TITLE_RE);
#   3. a SECOND, independent weak category also matched somewhere (two distinct
#      weak mentions together are a real signal, even without a strong phrase).
# A bare mention in a description alone, under a web-dev/design/engineering/admin/
# VA/data-entry/sales-setter title, satisfies none of these and is HIDDEN.
# (No "google_ads" entry here: every "google ad(s)"/"adwords" mention is STRONG now.)
WEAK_PATTERNS = {
    "seo": re.compile(r"\bseo\b|\bbacklinks?\b", re.I),
    "analytics": re.compile(r"\bga4\b", re.I),
}

# A title that itself reads as a marketing/ads/growth role -- the owner's own list.
MARKETING_TITLE_RE = re.compile(
    r"\bmarketing\b|\bads\b|\bgrowth\b|\bcmo\b|\bdigital\b|\bppc\b|\btraffic\b|"
    r"lead\s*gen|e-?commerce marketing|\bperformance\b|\bsearch\b",
    re.I,
)

# A title containing "marketing" (etc.) isn't always a marketing ROLE -- e.g. a
# compliance auditor hired to audit someone else's marketing content. Replay example
# #23042: "FinTech & Trading Compliance Auditor ... FINRA & CFPB Marketing Content
# Audit" is an audit job, not a marketing job, so the bare "Backlink" in its body
# must not be rescued by the marketing-title exception.
NON_MARKETING_ROLE_RE = re.compile(r"\bauditor\b|\baudit\b|\bcompliance\b", re.I)

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
    """(keep: bool, category: str). category is which pattern matched when keep is
    True (a STRONG or WEAK key), or which HIDE pattern (or "no-signal" if none)
    matched when keep is False -- "no-signal" is the feed_drops reason for a
    posting that is off-lane but doesn't fit any of the owner's named examples."""
    title = title or ""
    text = text or ""
    keywords = keywords or ""
    blob = " ".join(p for p in (title, text, keywords) if p)

    for cat, pat in STRONG_PATTERNS.items():
        if pat.search(blob):
            return True, cat

    title_kw_blob = " ".join(p for p in (title, keywords) if p)
    weak_hits = {cat: pat for cat, pat in WEAK_PATTERNS.items() if pat.search(blob)}
    if weak_hits:
        is_marketing_title = bool(MARKETING_TITLE_RE.search(title)) and not NON_MARKETING_ROLE_RE.search(title)
        two_signals = len(weak_hits) >= 2
        for cat, pat in weak_hits.items():
            if pat.search(title_kw_blob) or is_marketing_title or two_signals:
                return True, cat

    for cat, pat in HIDE_PATTERNS.items():
        if pat.search(blob):
            return False, cat
    return False, "no-signal"
