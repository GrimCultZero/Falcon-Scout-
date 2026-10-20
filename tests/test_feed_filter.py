# -*- coding: utf-8 -*-
"""The API feed is the only feed now.

@OffersHunterBot shut down on 2026-10-15 (its hosting provider lost the
backups), so everything Falcon Scout sees from here on arrives through
upwork_api.fetch_and_filter. That makes _row_passes the single gate between
Artem and the marketplace: a filter bug now loses jobs silently, with no second
feed to notice the absence.

Three behaviours are pinned here:

1. Stop words match the TITLE only. Matching title+description meant one
   passing mention killed work squarely in the lane — "facebook" alone dropped
   28 postings in a single live fetch, nearly all Google Ads roles whose client
   also happens to run Meta.

2. Stop words match WHOLE WORDS. Substring matching read "bing" inside
   "PlumBING", which is the real reason "Google Ads Expert for Plumbing
   Campaign" was filtered as a Bing job. Artem applied to it anyway.

3. A stop word in the title only disqualifies a title that offers nothing from
   Artem's lane. Moving to title-only let Meta-only jobs through, so
   "meta ads"/"instagram"/"social media" went into the stop list — and without
   this rescue those would bin every mixed Google+Meta posting, of which one
   live fetch held three.

Run: .venv\\Scripts\\python tests\\test_feed_filter.py
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import upwork_api  # noqa: E402

CFG = upwork_api.load_feed_config()

bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


def dropped(title, description="google ads seo audit"):
    reason = upwork_api._row_passes(
        {"title": title, "description_full": description, "payment_verified": True}, CFG
    )
    return (reason or "").startswith("stopword")


hit = upwork_api._stop_word_hit

# ── 1. whole-word matching ───────────────────────────────────────────────────
assert_(hit("Google Ads Expert for Plumbing Campaign", ["bing"]) is None,
        "'bing' does not match PlumBING")
assert_(hit("Rock Climbing Gym Google Ads", ["bing"]) is None,
        "'bing' does not match ClimBING")
assert_(hit("Bing Ads Specialist Needed", ["bing"]) == "bing",
        "a real Bing job is still caught")
assert_(hit("Cold Caller for SaaS", ["cold caller"]) == "cold caller",
        "multi-word stop words still match")
assert_(hit("Tik Tok Creative Buyer", ["tik tok"]) == "tik tok",
        "'tik tok' still matches")

# ── 2. title-only ────────────────────────────────────────────────────────────
assert_(not dropped("Google Ads Specialist for Home Services",
                    "We run Google Ads and some Facebook, but Google is the priority."),
        "a stop word in the DESCRIPTION alone no longer drops the job")
assert_(dropped("Facebook Ads Manager for DTC Brand"),
        "a stop word in the TITLE still drops the job")

# ── 3. the lane rescue ───────────────────────────────────────────────────────
for t in ("Meta Ads Specialist for Boutique Bali Villa Developer",
          "Experienced Meta Ads Lead Generation Specialist",
          "Senior Social Media & Performance Marketing Manager | Jewelry",
          "LinkedIn Outreach Coordinator",
          "Bookkeeper (full-time, remote)"):
    assert_(dropped(t), f"off-lane: {t[:52]}")

# None of these contain "google ads" as a contiguous phrase, which is why the
# rescue tests a looser set of lane words than the feed keywords do.
for t in ("Google & Meta Ads Specialist for Local Music Academy",
          "Expert Healthcare Ad Campaign Manager - Google, Meta & ChatGPT Ads",
          "Social Media & Marketing Manager (Meta + Google Ads, FR/EN)"):
    assert_(not dropped(t), f"mixed Google+Meta survives: {t[:46]}")

# ── the five jobs the old rule blocked and Artem sent anyway (2 replied) ─────
for t in ("Google Ads Expert for Plumbing Campaign",
          "Google Ads, SEO & Website Specialist to Manage and Grow Our Plumbing Business",
          "Google Ads, GA4, GTM, HubSpot & CallRail Attribution Audit",
          "Google Ads Specialist for Home Services",
          "International Technical SEO Architect for Multi-Market iGaming"):
    assert_(not dropped(t), f"applied-to job survives: {t[:46]}")

# ── the keyword restoration the bot's shutdown forced ────────────────────────
# Recovered from the 226 bot postings still on disk: the terms
# @OffersHunterBot watched that the API feed never had.
for kw in ("seo", "google ad", "google search", "google ads expert", "ecommerce website"):
    assert_(kw in CFG["keywords"], f"bot keyword restored: {kw!r}")

assert_(upwork_api._row_passes(
    {"title": "SEO Backlink Acquisition Specialist",
     "description_full": "We need help building quality backlinks.",
     "payment_verified": True}, CFG) is None,
    "a plain-SEO job is reachable (the feed had 'seo audit' but not 'seo')")

# ── the 2026-10-20 coverage audit ────────────────────────────────────────────
# Probed Upwork with 29 terms the feed did not use: of 232 Google Ads / SEO
# postings found, the keyword list could not reach 26. Most were one of three
# clusters, and the AI-search one is the work Artem is actively writing letters
# for (job 17986, "AEO Expert for Backlink Building").
for kw in ("adwords", "search engine optimization", "backlink", "link build",
           "generative engine optimization", "answer engine optimization"):
    assert_(kw in CFG["keywords"], f"coverage keyword present: {kw!r}")

for title, desc in (
    ("AdWords's specialist", "Manage our AdWords account."),
    ("Generative Engine Optimization (GEO) Specialist required",
     "We want to appear in AI answers."),
    ("UK Link Builder for a B2B Warehousing firm", "Build quality links to our site."),
    ("Search Engine Optimization", "Improve our rankings."),
):
    assert_(upwork_api._row_passes(
        {"title": title, "description_full": desc, "payment_verified": True}, CFG) is None,
        f"reachable: {title[:46]}")

# "seo" is matched as a plain substring, which is what lets "google ad" match
# "google ads" — so it also matches "Seoul". No posting is currently kept on
# that alone; if one ever is, this is the cause, not a new bug.
assert_("seo" in "seoul", "known: the keyword match is a substring, so 'seo' is inside 'Seoul'")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
