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

# ═══════════════════════════════════════════════════════════════════════════
# T18 (audit 2026-10-29): closing the keyword leak
#
# The 2026-10-29 coverage audit found ~10-12 in-lane postings in 48 h that the
# feed never stored, because `require_keyword_in_text` needs a configured phrase as
# an exact substring: "Google and Instagram Ads" has no "google ad", "GEO/AEO"
# has neither spelled-out form, "Google Page indexing" has no "seo". These are the
# five titles pinned by the audit's acceptance criteria.
# ═══════════════════════════════════════════════════════════════════════════
NEW_KW = ["google tag manager", "ga4", "google analytics", "conversion tracking", "consent mode",
          "search console", "indexing", "aeo", "geo", "ai search", "llm seo", "local citation",
          "citation building", "guest post", "youtube ads", "google business profile", "gbp"]
OLD_CFG = {**CFG, "keywords": [k for k in CFG["keywords"] if k not in NEW_KW], "google_proximity": False}
PLAIN = "Please see the details below."


def row(title, desc=PLAIN):
    return {"title": title, "description_full": desc, "payment_verified": True}


def passes(title, desc=PLAIN, cfg=None):
    return upwork_api._row_passes(row(title, desc), cfg or CFG) is None


for t in ("Google and Instagram Ads Expert",
          "Google and Social Ads Expert Needed",
          "GEO/AEO Optimization Specialist",
          "Google Page indexing Task",
          "Usercentrics + GTM + Google Consent Mode v2"):
    assert_(passes(t), f"ACCEPTANCE: passes the filter: {t}")
    assert_(not passes(t, cfg=OLD_CFG), f"…and was dropped by the old rules (this is the leak): {t}")

assert_(all(k in CFG["keywords"] for k in NEW_KW), "all 17 new keywords are in the live feed_config.json")
assert_(all(k in upwork_api.DEFAULT_FEED_CONFIG["keywords"] for k in NEW_KW), "…and in the defaults, so a reset config is not weaker")

# ── the proximity rule: TITLE only, within 6 words ──────────────────────────
near = upwork_api._google_near_ads
assert_(near("Google and Instagram Ads Expert") and near("Google & Meta Ads") and near("Paid campaigns across Google, Facebook"), "google near ads/campaigns")
assert_(near("Google Search Specialist") and near("PPC manager for Google") and near("Google Shopping feed") and near("Google PMax setup"), "…and search / ppc / shopping / pmax")
assert_(near("Ads on Google") and near("advertising on google"), "either side of the word")
assert_(near("Google a b c d e Ads") and not near("Google a b c d e f g Ads"), "within 6 words, not 7")
assert_(not near("Google Docs template designer") and not near("Ad copywriter for Facebook"), "google alone, ads alone: no")
assert_(not passes("Website designer", "We run Google and Meta advertising and want a new site."),
        "the rule is title-only: 'Google ... ads' in a DESCRIPTION does not rescue an off-lane title (54 such stored postings had off-lane titles)")
assert_(not passes("Paid Ads Specialist Needed for Two Upcoming Campaigns"),
        "known, not covered: no 'google' in the title (the audit's 'US apparel co.' example)")

# ── whole words: aeo / geo / ga4 / gbp ──────────────────────────────────────
assert_(passes("GEO Specialist"), "'geo' as a word passes")
assert_(passes("SEO & GEO/AEO expert"), "…in 'GEO/AEO'")
assert_(not passes("Geography tutor for school", "Teach geography."), "'geo' is not inside 'geography'")
assert_(not passes("Geolocation feature for a mobile app", "Add geolocation."), "…nor 'geolocation'")
assert_(not passes("Geo-location API developer", "Build a geo-location API."), "…nor hyphen-joined ('geo-location', 'geo-fencing')")
assert_(not passes("Aeolian harp maker", "Make harps."), "'aeo' is not inside 'aeolian'")
assert_(passes("GA4 audit"), "'ga4' passes")
assert_(not passes("Product ga40 label design", "x"), "'ga4' is not inside 'ga40'")

# ── title-only tools: the description alone does not count ──────────────────
assert_(not passes("Graphic Designer Required", "Some familiarity with Hotjar, Google Analytics or similar."),
        "a designer 'familiar with Google Analytics' is NOT in the lane")
assert_(not passes("Web Developer (Contract)", "Implement tracking: GA4, Meta Pixel, Google Tag Manager."),
        "a web developer whose description lists GA4 and GTM is not either")
for t in ("Google Tag Manager server-side setup", "GA4 migration help", "Google Analytics 4 report", "Conversion tracking fix for Shopify",
          "Google Search Console cleanup", "Guest Posting outreach", "YouTube Ads manager", "Google Business Profile optimisation", "GBP audit"):
    assert_(passes(t), f"a TITLE naming the tool or task passes: {t}")

# ── indexing needs a lane word ──────────────────────────────────────────────
assert_(not passes("Database indexing optimisation for PostgreSQL", "Tune queries."), "'indexing' alone: database work is off-lane")
assert_(not passes("Elasticsearch indexing engineer", "Build the pipeline."), "…and so is search-engine plumbing")
assert_(passes("Indexing properly pages from a website", "Pages are not indexed."), "'indexing' with 'website' passes (a stored posting)")
assert_(passes("Page indexing task", "Get my pages into Google."), "'indexing' with 'google' passes")

# ── text-scope AI-search / citation phrases ─────────────────────────────────
assert_(passes("Visibility in AI search", "We want to rank in ChatGPT."), "'ai search' passes (full text)")
assert_(passes("Citation building for UK business", "Build local citations."), "'citation building' passes")
assert_(passes("Local citation cleanup", "Fix NAP."), "'local citation' passes")
assert_(passes("Website help", "We use consent mode v2."), "'consent mode' passes (full text)")

# ── the marker (owner decision): tracking-only and GBP are SHOWN, labelled ──
tag = lambda t: upwork_api.feed_tag_for(row(t), CFG)
assert_(tag("Usercentrics + GTM + Google Consent Mode v2") == "tracking", "tracking-only title -> 'tracking'")
assert_(tag("Google Analytics 4 setup and report") == "tracking", "…GA4 / Analytics")
assert_(tag("Conversion tracking fix for Shopify") is None, "a title that also names a core keyword (Shopify) is not tracking-only")
assert_(tag("Google Ads Conversion Tracking Specialist") is None, "'Google Ads' in the title: not tracking-only")
assert_(tag("Audit Existing Server Side GA4, GTM & Google Ads Tracking / Stape") is None, "…even with GA4 and GTM in it")
assert_(tag("GA4 + SEO reporting") is None, "…or SEO")
assert_(tag("Google Business Profile bad review removal") == "gbp", "GBP / reputation title -> 'gbp'")
assert_(tag("GBP / Google Maps Ranking Specialist for a Web Design Agency") == "gbp", "…GBP + Maps")
assert_(tag("Local SEO GBP Audit Specialist") is None, "GBP with SEO in the title: ordinary local SEO, no tag")
assert_(tag("Google Business Profile + Local Services Ads Setup Specialist Needed") is None, "…or with Ads")
assert_(tag("Google Ads Specialist") is None and tag("Technical SEO audit") is None and tag("") is None, "ordinary jobs carry no tag")
for t in ("Usercentrics + GTM + Google Consent Mode v2", "Google Analytics 4 setup and report", "Google Business Profile bad review removal",
          "GBP / Google Maps Ranking Specialist for a Web Design Agency"):
    assert_(passes(t), f"a tagged row still PASSES the filter (marked, not dropped): {t}")
seen = {"~1": {"upwork_job_id": "~1", "title": "Usercentrics + GTM + Google Consent Mode v2", "description_full": PLAIN, "payment_verified": True},
        "~2": {"upwork_job_id": "~2", "title": "Google Ads Specialist", "description_full": PLAIN, "payment_verified": True}}
kept, stats = upwork_api._apply_filter(seen, CFG, 2)
assert_(len(kept) == 2 and {r["upwork_job_id"]: r["feed_tag"] for r in kept} == {"~1": "tracking", "~2": None},
        "_apply_filter keeps both rows and sets feed_tag on the kept row")

# ── feed_drops: every dropped row goes to the sink ──────────────────────────
captured = []
upwork_api.set_drop_sink(lambda rows: captured.extend(rows))
seen = {
    "~a": {"upwork_job_id": "~a", "title": "Writer for blog", "description_full": "x", "payment_verified": True, "posted_date": "2026-11-09T08:00:00Z"},
    "~b": {"upwork_job_id": "~b", "title": "Python developer", "description_full": "django api", "payment_verified": True},
    "~c": {"upwork_job_id": "~c", "title": "Google Ads Specialist", "description_full": PLAIN, "payment_verified": True},
}
kept, stats = upwork_api._apply_filter(seen, CFG, 3)
by = {d["upwork_job_id"]: d for d in captured}
assert_(set(by) == {"~a", "~b"} and len(kept) == 1, "the sink gets exactly the rows that were dropped")
assert_(by["~a"]["reason"].startswith("stopword:") and by["~b"]["reason"] == "no-keyword-in-text", "…with their reasons")
assert_(by["~a"]["title"] == "Writer for blog" and by["~a"]["posted_date"] == "2026-11-09T08:00:00Z", "…title and posted date")
captured.clear()
upwork_api._apply_filter(seen, CFG, 3, record_drops=False)
assert_(captured == [], "record_drops=False (the deep fetch's per-keyword saves) records nothing")
upwork_api.set_drop_sink(lambda rows: (_ for _ in ()).throw(RuntimeError("database is locked")))
kept, stats = upwork_api._apply_filter(seen, CFG, 3)
assert_(len(kept) == 1 and stats["dropped"] == 2, "a failing sink never fails the fetch")
upwork_api.set_drop_sink(None)


# the real fetch functions, with Upwork stubbed: the sink fills on a fetch
def fake_search(kw, first=20, after="0"):
    return ([{"upwork_job_id": "~x1", "title": "Facebook Ads Manager", "description_full": "google ads", "payment_verified": True},
             {"upwork_job_id": "~x2", "title": "GEO/AEO Optimization Specialist", "description_full": PLAIN, "payment_verified": True}], 2)


real_search = upwork_api.search_jobs
upwork_api.search_jobs = fake_search
captured.clear()
upwork_api.set_drop_sink(lambda rows: captured.extend(rows))
kept, stats = upwork_api.fetch_and_filter({**CFG, "keywords": ["aeo"]})
assert_([r["upwork_job_id"] for r in kept] == ["~x2"] and [d["upwork_job_id"] for d in captured] == ["~x1"], "fetch_and_filter: the kept row is kept, the dropped row reaches the sink")
captured.clear()
kept, stats = upwork_api.fetch_and_filter_deep({**CFG, "keywords": ["aeo", "geo"], "max_posting_age_hours": 0}, max_pages=1, on_keyword=lambda fresh: None)
assert_(len(captured) == 1 and captured[0]["upwork_job_id"] == "~x1", "fetch_and_filter_deep records each drop ONCE (not once per keyword)")
upwork_api.search_jobs = real_search
upwork_api.set_drop_sink(None)

# prune re-applies _row_passes to stored jobs: nothing the old rules kept may be lost now
for t in ("Google Ads Expert for B2B", "SEO Backlink Acquisition Specialist", "Shopify store setup", "PPC audit", "WordPress developer for a clinic site"):
    assert_(passes(t), f"unchanged: still passes: {t}")

# ── found by replaying the STORED postings (tools/validate_feed_rules.py) ───
# "Google Business Profile API Expert: Transition App from Test to Production Environment"
# is software integration, not local SEO; the new google business profile keyword let it in.
assert_(not passes("Google Business Profile API Expert: Transition App from Test to Production Environment", "Move our app to production."),
        "a GBP *API* developer job is not local SEO: the keyword does not count when the title says 'api'")
assert_(not passes("GBP API integration for our dashboard", "Pull reviews via the API."), "…same for the 'gbp' keyword")
assert_(passes("Google Business Profile Expert: Recover #1 Local Rankings"), "a real GBP job still passes")
assert_(passes("Local SEO and Google Business Profile API setup", "x"), "…so excluding 'api' from the GBP keywords never drops a title that names a core keyword")
# "gtm" also means go-to-market: it must not mark a posting as tracking-only.
assert_(tag("GTM Engineer to Validate Demand and Polish Go-to-Market Plan") is None, "'GTM' (go-to-market) does not tag a posting as tracking-only")
assert_(tag("Google Tag Manager (GTM) Specialist - Cross-Domain Tracking & Attribution Setup") == "tracking", "…while Google Tag Manager still does")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
