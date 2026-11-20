# -*- coding: utf-8 -*-
"""2-week SEO / GEO / Google Ads focus test (owner, 2026-11-19). api/focus_filter.py.

Pinned with the owner's own real examples:
  * a pure web-dev job -> hidden (webdev)
  * a pure design job -> hidden (design)
  * "Shopify developer + SEO" -> KEPT (a mix is kept)
  * "marketing manager, mentions Google Ads" -> KEPT
  * "GA4 setup" -> KEPT
  * "Meta ads only" -> hidden (meta_tiktok_ads)
plus the window logic (reimplemented from test_week_active, not imported -- this
task's module may not touch api/upwork_api.py) and a couple of extra edge cases
(bare "geo" never keeps on its own; a hide-shaped job with no named category at all
still gets a reason, "no-signal", never an unlabelled drop).

Run: .venv\\Scripts\\python tests\\test_focus_filter.py
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import focus_filter as ff  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


def utc(y, m, d, h=12):
    return datetime(y, m, d, h, 0, tzinfo=timezone.utc)


# ── the owner's own examples ────────────────────────────────────────────────
keep, cat = ff.classify_focus(
    "WordPress Website Designer & Developer",
    "We need a WordPress developer to build a custom theme for our brand new site. Full-stack development experience a plus.",
)
check(not keep and cat == "webdev", f"pure web-dev job -> hidden (webdev): got keep={keep} cat={cat!r}")

keep, cat = ff.classify_focus(
    "Graphic Designer for Brand Identity",
    "Looking for a talented graphic designer to create a logo and full brand identity package. Figma and Illustrator required.",
)
check(not keep and cat == "design", f"pure design job -> hidden (design): got keep={keep} cat={cat!r}")

keep, cat = ff.classify_focus(
    "Shopify Developer Needed",
    "We need a Shopify developer to rebuild our theme AND handle ongoing technical SEO for the store.",
)
check(keep, f'"Shopify developer + SEO" -> KEPT (a mix is kept, here via a STRONG phrase, "technical SEO"): got keep={keep} cat={cat!r}')

# 2026-11-20 tightening (owner-approved, after the 14-day replay): a BARE "SEO" mention
# -- no stronger phrase, no marketing title, no second signal -- under a web-dev title is
# now the thing this fix exists to catch. "an explicit SEO deliverable" (above) still
# keeps it; a throwaway word does not.
keep, cat = ff.classify_focus(
    "Shopify Developer Needed",
    "We need a Shopify developer to rebuild our theme AND handle ongoing SEO for the store.",
)
check(not keep and cat == "webdev",
      f'…but a bare, undecorated "SEO" mention (no stronger phrase) under the SAME web-dev title is now HIDDEN: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Digital Marketing Manager",
    "We're hiring a marketing manager to oversee our digital presence, including running Google Ads campaigns.",
)
check(keep, f'"marketing manager, mentions Google Ads" -> KEPT (title itself reads as a marketing role): got keep={keep} cat={cat!r}')

# Bare "GA4" with a non-marketing title and no second signal is also now HIDDEN --
# the exact single-bare-mention shape the 2026-11-20 tightening targets.
keep, cat = ff.classify_focus(
    "Analytics Setup Needed",
    "Need someone to set up GA4 tracking and conversion events for our e-commerce site.",
)
check(not keep and cat == "no-signal",
      f'a job titled only "Analytics Setup Needed", with just a bare GA4 mention and nothing else -> now HIDDEN: got keep={keep} cat={cat!r}')

# Two distinct bare WEAK mentions together are accepted as a real signal even with
# a plain title ("SEO" + "GA4" here -- "Google Ads" moved to STRONG 2026-11-20, so
# it would short-circuit this test before the weak two-signal logic ever ran).
keep, cat = ff.classify_focus(
    "Analytics Setup Needed",
    "Need someone to set up GA4 tracking and also do some basic SEO cleanup.",
)
check(keep, f'SEO + GA4 together (two independent weak signals) -> KEPT even with a plain title: got keep={keep} cat={cat!r}')

# A bare "Google Ads" / singular "Google Ad" / "Adwords" mention is STRONG now
# (2026-11-20) -- it keeps the job anywhere, no title/keywords/second-signal rescue
# needed, closing two real recall-test gaps (#2078, #22138).
keep, cat = ff.classify_focus(
    "Google Ad Management and Editing",
    "I need help to track and manage our Google ad. I'd like professional help in editing it and understanding how it is working for us.",
    "google ad",
)
check(keep and cat == "google_ads", f'#2078 "Google Ad Management and Editing" (singular "Google ad") -> now KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Google Adwords Specialist",
    "We need a freelancer to help improve our Google Ads campaigns while also supporting website visibility on Google and Google Business Profile.",
    None,
)
check(keep and cat == "google_ads", f'#22138 "Google Adwords Specialist" -> now KEPT: got keep={keep} cat={cat!r}')

# "Google Ad Manager" (GAM, a different ad-serving product, unrelated to Google
# Ads/PPC) must NOT be swept in by the new broad "google ad(s)" pattern.
keep, cat = ff.classify_focus("Google Ad Manager Setup", "Configure our Google Ad Manager account for programmatic display inventory.", None)
check(not keep, f'"Google Ad Manager" (a different product) is not a Google Ads keep signal: got keep={keep} cat={cat!r}')

# ── bare weak mentions in the TITLE itself (not just description) still keep ────
keep, cat = ff.classify_focus("SEO Specialist Wanted", "General help needed for our online store, details on request.", None)
check(keep and cat == "seo", f'a bare "SEO" in the TITLE keeps the job even with no other detail at all: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("GA4 Expert", "Help us with our analytics.", None)
check(keep and cat == "analytics", f'a bare "GA4" in the TITLE keeps it too: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Facebook & Instagram Ads Manager",
    "Looking for someone to run our Meta ads campaigns across Facebook and Instagram. No other channels.",
)
check(not keep and cat == "meta_tiktok_ads", f'"Meta ads only" -> hidden (meta_tiktok_ads): got keep={keep} cat={cat!r}')

# ── extra edge cases ─────────────────────────────────────────────────────────
keep, cat = ff.classify_focus("Travel Consultant", "Help clients plan trips. Must know geo-targeting for ad placement geographically relevant to each region.", None)
check(not keep and cat != "geo_ai_search", f'bare "geo" (geo-targeting / geographically) never keeps on its own: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("AEO/GEO Specialist", "We want to improve our visibility in ChatGPT and other AI answer engines (AEO/GEO).", None)
check(keep and cat == "geo_ai_search", f'the real AEO/GEO (AI-search) usage IS a keep signal: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Bookkeeper Wanted", "Looking for a part-time bookkeeper to manage invoices and expense tracking.", None)
check(not keep and cat == "no-signal", f'off-lane but no named hide category -> "no-signal", never an unlabelled drop: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Video Editor for YouTube Channel", "Need a videographer for motion graphics and video editing, no other skills needed.", None)
check(not keep and cat == "video", f'pure video job -> hidden (video): got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Content Writer", "Looking for a copywriter to write engaging blog posts for our brand's website.", None)
check(not keep and cat == "copywriting", f'copywriting-only -> hidden (copywriting): got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Virtual Assistant", "Data entry and admin assistant tasks, managing spreadsheets.", None)
check(not keep and cat == "data_entry", f'pure data-entry job -> hidden (data_entry): got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Technical SEO Audit", "We need a technical SEO audit of our ecommerce site, focused on local SEO and link building.", None)
check(keep and cat == "seo", f'technical/local/ecommerce SEO + link building -> KEPT (seo): got keep={keep} cat={cat!r}')

# ── the 2026-11-20 replay's 8 named verification jobs, real titles/descriptions/
# keywords (trimmed), confirmed against the live DB before this fix shipped ───────
keep, cat = ff.classify_focus(
    "Ads expert for local businesses", "You will use a platform called Tryfullhouse.com to run ads. "
    "You must have: 3+ years running Meta and Google Ads, TikTok Ads, LinkedIn Ads...",
    "Pay Per Click Advertising",
)
check(keep, f'#23075 "Ads expert for local businesses" (title matches the marketing-title exception) -> stays KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Digital Marketing Strategist / Growth Marketer for Virtual Menopause Clinic Launch (Ontario, Canada)",
    "We're looking for a results-driven marketer to own our launch strategy... build and run a 90-day launch "
    "marketing plan... SEO basics for the new site.",
    "Marketing Strategy, Market Analysis, Facebook, Social Media Marketing",
)
check(keep, f'#23085 "Digital Marketing Strategist / Growth Marketer..." (title is a marketing role) -> stays KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Marketing Help - Home Services Businesses",
    "I need an individual who can manage, grow, and scale our facebook, instagram, and tik tok page... "
    "I also need a Google my business page set up, Google ads, Meta ads, etc.",
    "Social Media Marketing, Social Media Content Creation, Instagram, TikTok",
)
check(keep, f'#23079 "Marketing Help - Home Services Businesses" (title is a marketing role) -> stays KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Fractional CMO for Baby Industry",
    "We're looking for a hands-on fractional CMO who will own our marketing end to end: set the strategy, "
    "run paid acquisition on Google Ads and Meta, and take over our social content.",
    "Internet Marketing, Marketing Strategy, Social Media Marketing, Facebook",
)
check(keep, f'#23029 "Fractional CMO for Baby Industry" (title contains CMO, a marketing role) -> stays KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Engineering Manager, E-commerce Platform and AI",
    "We need a hands-on engineering manager who leads a remote team... Own the migration end to end: data, "
    "integrations, URLs and SEO, cut-over and rollback.",
    "Total Quality Management, Performance Management, Product Management",
)
check(not keep, f'#22995 "Engineering Manager, E-commerce Platform and AI" (bare SEO only, engineering title) -> now HIDDEN: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Senior Android Developer | Kotlin, Utility Apps, Ad SDKs, Firebase, MMP & AI Assisted Development",
    "We are building a lean Android utility app studio... understands monetization integrations... "
    "reporting through GA4 and Firebase.",
    "Android SDK, In-App Purchases, Android, Kotlin",
)
check(not keep, f'#23058 "Senior Android Developer..." (bare GA4 only, dev title) -> now HIDDEN: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "FinTech & Trading Compliance Auditor (CFP® / CFA / JD / CPA) – FINRA & CFPB Marketing Content Audit",
    "We deliver high-stakes content governance and regulatory risk audits... line-by-line verification of "
    "public-facing copy, performance advertising claims and backlink disclosures.",
    "Financial Analysis, Regulatory Compliance",
)
check(not keep, f'#23042 "FinTech & Trading Compliance Auditor..." (bare Backlink only, compliance title) -> now HIDDEN: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Website Outreach Specialist – Appointment Setter",
    "We are looking for an experienced cold caller to contact local U.S. businesses... identifying "
    "opportunities to improve website design, mobile presentation, performance, SEO, and keep up with newer technology.",
    "Sales & Marketing, Lead Generation, Cold Calling, Scheduling",
)
check(not keep, f'#23021 "Website Outreach Specialist – Appointment Setter" (bare SEO only, sales-setter title; keywords mention marketing but the TITLE does not) -> now HIDDEN: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("PPC Specialist", "Manage our Performance Max and Shopping campaigns via Google Ads, with Merchant Center setup.", None)
check(keep and cat == "google_ads", f'PPC / Performance Max / Shopping / Merchant Center -> KEPT (google_ads): got keep={keep} cat={cat!r}')

# ── the keywords field also counts toward the blob (Upwork's own skill tags) ──
keep, cat = ff.classify_focus("Freelance Specialist Needed", "General help wanted for our online store.", "Google Ads, PPC, Shopping Campaigns")
check(keep, f'a keep signal in the keywords/skills field alone still keeps the job: got keep={keep} cat={cat!r}')

# ── focus_test_active: Kyiv-time, inclusive, malformed dates never loosen it ──
CFG = {"focus_test": {"from": "2026-11-19", "until": "2026-12-03"}}
check(not ff.focus_test_active(CFG, utc(2026, 11, 18, 21)), "Nov 18, 23:00 Kyiv: not yet")
check(ff.focus_test_active(CFG, utc(2026, 11, 18, 22)), "Nov 19, 00:00 Kyiv (Nov 18 22:00 UTC): ACTIVE (start is Kyiv time)")
check(ff.focus_test_active(CFG, utc(2026, 11, 25)), "mid-window: active")
check(ff.focus_test_active(CFG, utc(2026, 12, 3, 21)), "Dec 3, 23:00 Kyiv: still active (end date inclusive)")
check(not ff.focus_test_active(CFG, utc(2026, 12, 3, 22)), "Dec 4, 00:00 Kyiv: OVER -- expires on its own, no manual step")
check(not ff.focus_test_active({}, utc(2026, 11, 25)) and not ff.focus_test_active({"focus_test": None}, utc(2026, 11, 25)), "no block: never active")
check(not ff.focus_test_active({"focus_test": {"until": "not-a-date"}}, utc(2026, 11, 25)), "a malformed date never activates the filter")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
