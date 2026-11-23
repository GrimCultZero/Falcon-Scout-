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
    # Role-shaped Google Ads / Adwords phrases (owner correction, 2026-11-20): a
    # BARE "google ads"/"adwords" mention is WEAK (below) -- only a phrase that
    # names the ROLE itself (management/manager/specialist/expert/campaign) is
    # unambiguous enough to keep a job anywhere it appears. "manager(s)" requires
    # the PLURAL "ads" -- singular "Google Ad Manager" is GAM, a real Upwork skill
    # TAG, not a job title ("Google Ads Manager" plural IS a job title); the
    # management/specialist/expert/campaign words stay ambiguous-ad-count safe.
    "google_ads": re.compile(
        r"\bppc\b|paid search|performance\s*max\b|\bpmax\b|"
        r"\bgoogle\s*ads\s*managers?\b|"
        r"\bgoogle\s*ads?\s*(?:management|specialists?|experts?|campaigns?)\b|"
        r"\badwords\s*(?:management|managers?|specialists?|experts?|campaigns?)\b|"
        # Task 8.2 (owner, 2026-11-23): "Google Ad Grants"/"AdGrants"/"Ad Grants" —
        # a real, role-shaped Google Ads program (free ad credits for nonprofits),
        # same treatment as the other role-shaped phrases above. \s* covers both
        # "Ad Grants" and the no-space "AdGrants" spelling.
        r"\bad\s*grants?\b",
        re.I,
    ),
    # Bare "google analytics" DOWNGRADED to WEAK below (D4, owner 2026-11-21): it's
    # near-universal boilerplate on general marketing-manager postings (an Upwork
    # auto-tag as often as a real ask), exactly the replay's false-positive shape --
    # #25357 "Fractional Digital Marketing Manager" was kept ONLY by this bare
    # mention in its keywords field, with no other Google Ads/SEO signal anywhere.
    # "google tag manager" and "search console" stay STRONG -- they're role-shaped
    # product names a generic marketing posting doesn't casually namedrop the way
    # it does "Google Analytics" (practically every marketing job lists GA as a
    # skill; far fewer mention Tag Manager or Search Console specifically).
    "analytics": re.compile(
        r"google tag manager|search console|\blooker\b",
        re.I,
    ),
}

# WEAK: a single bare mention with no supporting context -- exactly the replay's
# false-positive shape (a one-word "SEO"/"GA4"/"Google Ads"/"Backlink" buried in an
# unrelated job's description). A weak match ONLY counts as a keep if one of:
#   1. it ALSO appears in the title or keywords (not just the description);
#   2. the job's TITLE itself reads as a marketing/ads role (MARKETING_TITLE_RE);
#   3. a SECOND, independent weak category also matched somewhere (two distinct
#      weak mentions together are a real signal, even without a strong phrase).
# A bare mention in a description alone, under a web-dev/design/engineering/admin/
# VA/data-entry/sales-setter title, satisfies none of these and is HIDDEN.
#
# "google_ads" here (owner correction, 2026-11-20) covers bare "Google Ad"
# (singular or plural), "Adwords" and "Ad Words" with no role word attached --
# the role-shaped phrases above are STRONG, this is everything else, including
# "Google Ad Manager" (GAM -- an Upwork skill TAG on real Google Ads jobs, not a
# distinct product in practice here; rule 1 above rescues it whenever it's a
# keyword/title tag, same as any other weak mention).
#
# "google shopping"/"merchant center" DOWNGRADED from STRONG to WEAK here (Task
# 0b.8b, owner 2026-11-21): job #25354 ("E-commerce/AI Expert Viritual Assistant
# A-Z", an Amazon Seller Central / online-store VA role, category admin_support)
# was kept only because its skills bullet list included one bare line -- "Hands-on
# Google Ads and Google Merchant Center skills" -- among many unrelated asks. A
# feature/product name mentioned once in a generic skills list is exactly the
# replay's false-positive shape (same as bare "Google Ads"/GA4), not the
# unambiguous-anywhere signal STRONG is for -- "merchant center"/"google shopping"
# are features a job post CAN casually namedrop without being a Google Ads job,
# unlike "performance max"/"ppc"/"paid search" which essentially never appear
# outside dedicated ads work.
WEAK_PATTERNS = {
    "seo": re.compile(r"\bseo\b|\bbacklinks?\b", re.I),
    "google_ads": re.compile(r"\bgoogle\s*ads?\b|\badwords\b|\bad\s*words\b|google shopping|merchant center", re.I),
    "analytics": re.compile(r"\bga4\b|google analytics", re.I),
}

# A title that itself reads as a marketing/ads/growth role -- the owner's own
# list, TIGHTENED 2026-11-20 (Task 0.3) after the 14-day replay showed the old
# bare-word list ("digital", "growth", "traffic", "lead gen", "performance",
# "search", bare "ads") rescuing titles that are not marketing/ads roles at
# all: "Digital Project Manager" (bare "digital"), "Podcast Virtual Assistant
# ... Marketing & Growth" (bare "growth"), "Claude Figma Friendly Designer for
# ... Trades Marketing Agency" (bare "marketing" on a design job), "Video
# Editor for Paid Social Ads" (bare "ads"), "AI Automation Engineer -- Custom
# Marketing Content" (bare "marketing" on an engineering job), "Senior ...
# Copywriter ... Ads" (bare "ads" on a copywriting job) -- all real jobs
# visible in the feed on 2026-11-20, none of them an ads/search role. Rescue
# now requires a SPECIFIC ads/search phrase or a named marketing ROLE TITLE,
# never a bare generic word: SEO, PPC, Google Ads, paid search, search engine,
# SEM, ads manager, marketing manager/specialist/strategist/consultant, CMO,
# growth marketer/marketing, performance marketing.
MARKETING_TITLE_RE = re.compile(
    r"\bseo\b|\bppc\b|google\s*ads\b|paid\s*search|search\s*engine|\bsem\b|"
    r"ads\s*(?:manager|expert|specialist)\b|marketing\s*(?:manager|director|specialist|strategist|consultant)\b|"
    r"\bcmo\b|growth\s*market(?:er|ing)\b|performance\s*marketing\b|"
    # Task 0b.5 (owner, 2026-11-21): these still only RESCUE a job that already
    # has a weak Google Ads/SEO mention elsewhere (the rule that bare words
    # never rescue on their own, Task 0.3, is unchanged) -- they just widen
    # WHICH marketing-role titles count as the rescuing title.
    r"head\s*of\s*marketing\b|growth\s*manager\b|digital\s*marketing\s*(?:manager|specialist|expert|consultant)\b",
    re.I,
)

# A title containing "marketing" (etc.) isn't always a marketing ROLE -- e.g. a
# compliance auditor hired to audit someone else's marketing content. Replay example
# #23042: "FinTech & Trading Compliance Auditor ... FINRA & CFPB Marketing Content
# Audit" is an audit job, not a marketing job, so the bare "Backlink" in its body
# must not be rescued by the marketing-title exception.
NON_MARKETING_ROLE_RE = re.compile(r"\bauditor\b|\baudit\b|\bcompliance\b", re.I)

# ── Google Business Profile trial (Task 8.4, owner 2026-11-23) ─────────────
# A GBP-only job ("Google Business Profile Expert", #25368) has no Google
# Ads/SEO signal elsewhere, so it fell through to "no-signal" and was hidden
# by the focus test since 2026-11-19. The owner wants these KEPT for the rest
# of the focus test, as a trial, visibly marked (the existing "gbp" feed_tag
# chip -- set at fetch time in api/upwork_api.py's feed_tag_for/marked_keywords,
# unrelated to this module -- already renders a "GBP" badge; nothing new needed
# there). Pure review-removal/reputation jobs are NOT part of this trial -- they
# stay hidden exactly as before, which is why REVIEW_REMOVAL_RE below is checked
# first and wins.
GBP_RE = re.compile(r"\bgoogle\s*business\s*profile\b|\bgoogle\s*my\s*business\b|\bgbp\b", re.I)
REVIEW_REMOVAL_RE = re.compile(
    r"\b(?:remov(?:e|al|ing)|delet(?:e|ion|ing)|wipe|dispute|takedown)\b[^.?!]{0,40}\breviews?\b|"
    r"\breviews?\b[^.?!]{0,40}\b(?:remov(?:e|al|ing)|delet(?:e|ion|ing)|wipe|dispute|takedown)\b",
    re.I,
)

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

    # Fail-open (owner, 2026-11-20): a posting with no description text at all has
    # nothing here to classify from -- there's no text to tell a real off-lane job
    # from a real on-lane one that just lost its description (e.g. a chat-only
    # auto-captured record). Hiding on no evidence risks losing a real job, so it
    # is always kept instead.
    if not text.strip():
        return True, "no-description"

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
            # "analytics" (bare GA4/Google Analytics) is narrower than the other weak
            # categories (D4, owner 2026-11-21): Upwork's own auto-generated skill
            # TAGS list "Google Analytics" in the keywords field on nearly every
            # marketing job regardless of scope, and a "marketing manager" TITLE
            # names a role, not an ads/SEO scope -- neither is real evidence the job
            # needs analytics work. #25357 "Fractional Digital Marketing Manager"
            # was kept only by "Google Analytics" sitting in its keywords field. So
            # for "analytics" only: the KEYWORDS half of rule 1 and the marketing-
            # title rescue (rule 2) are dropped -- only an actual TITLE mention
            # (rule 1's title half) or a second independent weak signal (rule 3)
            # still rescues it, same as any other weak mention.
            if cat == "analytics":
                if pat.search(title) or two_signals:
                    return True, cat
                continue
            if pat.search(title_kw_blob) or is_marketing_title or two_signals:
                return True, cat

    # HIDE_PATTERNS checked BEFORE the GBP trial below (Task 8.4, owner
    # 2026-11-23): "ONLY focus category is GBP" means GBP and nothing ELSE
    # off-lane. #23079 "Marketing Help - Home Services Businesses" mentions
    # "Google my business page set up" as ONE bullet among "manage, grow, and
    # scale our facebook, instagram, and tik tok page" -- a real
    # meta_tiktok_ads job, not a GBP job, and the owner has explicitly
    # confirmed this one stays hidden. If a job matches an off-lane HIDE
    # category too, that category wins; GBP only rescues when NOTHING else
    # off-lane also matched.
    for cat, pat in HIDE_PATTERNS.items():
        if pat.search(blob):
            return False, cat

    # GBP trial (Task 8.4): keep a GBP-only job unless it's really a pure
    # review-removal/reputation job — those stay hidden.
    if GBP_RE.search(blob) and not REVIEW_REMOVAL_RE.search(blob):
        return True, "gbp"

    return False, "no-signal"
