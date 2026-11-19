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
    "We need a Shopify developer to rebuild our theme AND handle ongoing SEO for the store.",
)
check(keep, f'"Shopify developer + SEO" -> KEPT (a mix is kept): got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Digital Marketing Manager",
    "We're hiring a marketing manager to oversee our digital presence, including running Google Ads campaigns.",
)
check(keep, f'"marketing manager, mentions Google Ads" -> KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Analytics Setup Needed",
    "Need someone to set up GA4 tracking and conversion events for our e-commerce site.",
)
check(keep, f'"GA4 setup" -> KEPT: got keep={keep} cat={cat!r}')

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
