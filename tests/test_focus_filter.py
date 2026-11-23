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
# a plain title ("SEO" + "GA4" here).
keep, cat = ff.classify_focus(
    "Analytics Setup Needed",
    "Need someone to set up GA4 tracking and also do some basic SEO cleanup.",
)
check(keep, f'SEO + GA4 together (two independent weak signals) -> KEPT even with a plain title: got keep={keep} cat={cat!r}')

# ── Google Ads / Adwords: role-shaped phrases are STRONG, bare mentions are WEAK
# (owner correction, 2026-11-20, reverting the previous commit's blanket STRONG) ──
# A phrase that names the ROLE itself keeps a job anywhere, same as PPC/Performance
# Max/Merchant Center.
keep, cat = ff.classify_focus("Hiring: Google Ads Manager", "Own our paid search accounts day to day.", None)
check(keep and cat == "google_ads", f'"Google Ads Manager" (plural, a job title) -> STRONG, KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Need a Google Ads Specialist", "General help with our accounts.", None)
check(keep and cat == "google_ads", f'"Google Ads Specialist" -> STRONG, KEPT: got keep={keep} cat={cat!r}')

# A BARE mention (no role word) is WEAK -- the recall test's two real gaps
# (#2078 singular "Google ad", #22138 "Adwords") are rescued because the bare word
# is in the TITLE itself (rule 1), not because it's unconditionally strong anymore.
keep, cat = ff.classify_focus(
    "Google Ad Management and Editing",
    "I need help to track and manage our Google ad. I'd like professional help in editing it and understanding how it is working for us.",
    "google ad",
)
check(keep and cat == "google_ads", f'#2078 "Google Ad Management and Editing" ("Management" makes this phrase STRONG) -> KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus(
    "Google Adwords Specialist",
    "We need a freelancer to help improve our Google Ads campaigns while also supporting website visibility on Google and Google Business Profile.",
    None,
)
check(keep and cat == "google_ads", f'#22138 "Google Adwords Specialist" ("Specialist" makes this phrase STRONG too) -> KEPT: got keep={keep} cat={cat!r}')

# A bare "Google Ads"/"Adwords" mention buried ONLY in the description, under a
# plain non-marketing title, with no second signal, is HIDDEN -- the weak-mention
# shape this whole split exists to catch, same as bare "SEO"/"GA4".
keep, cat = ff.classify_focus(
    "Bookkeeper Wanted",
    "Need help managing our Google Ad Manager tag inventory for display ads.",
    None,
)
check(not keep and cat == "no-signal",
      f'a bare "Google Ad Manager" buried in the description of an unrelated job -> still HIDDEN: got keep={keep} cat={cat!r}')

# "Google Ad Manager" (GAM) is a real Upwork skill TAG on real Google Ads jobs
# (confirmed against the live DB: every occurrence found was alongside "Google
# Ads"/"Pay Per Click Advertising" on a real ads job) -- when it's in the title or
# KEYWORDS, rule 1 rescues it like any other weak mention, same as the owner asked.
keep, cat = ff.classify_focus(
    "Looking for a good designer.",
    "We need a freelancer to help with our display campaigns and creative assets.",
    "Google Ad Manager",
)
check(keep and cat == "google_ads", f'"Google Ad Manager" as a KEYWORD tag rescues the job: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Google Ad Manager Setup", "Configure our account for programmatic display inventory.", None)
check(keep and cat == "google_ads", f'"Google Ad Manager" in the TITLE itself also rescues the job: got keep={keep} cat={cat!r}')

# ── fail-open: a posting with no description text at all is never hidden ───────
keep, cat = ff.classify_focus("Shopify Developer Wanted", "", None)
check(keep and cat == "no-description", f'empty description text -> always KEPT (fail-open), never classified as webdev: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Virtual Assistant", "   ", "data entry")
check(keep and cat == "no-description", f'whitespace-only description text also counts as empty -> KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Virtual Assistant", None, None)
check(keep and cat == "no-description", f'description text of None also counts as empty -> KEPT: got keep={keep} cat={cat!r}')

keep, cat = ff.classify_focus("Shopify Developer Wanted", "We need a Shopify developer to rebuild our theme.", None)
check(not keep and cat == "webdev", f'a real (non-empty) description is classified normally -- fail-open only covers truly empty text: got keep={keep} cat={cat!r}')

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

# CONFLICT, flagged for the owner (Task 0.3, 2026-11-20): the original recall
# test approved #23079 staying KEPT because its title contained bare
# "Marketing". The 0.3 tightening deliberately removes bare "marketing" from
# the rescue list (it was the exact mechanism rescuing junk like "Claude Figma
# Friendly Designer for ... Trades Marketing Agency" and "AI Automation
# Engineer -- Custom Marketing Content"). "Marketing Help" doesn't contain any
# of the new specific phrases (manager/specialist/strategist/consultant, CMO,
# growth marketer, SEO/PPC/Google Ads/paid search/search engine/SEM), so it is
# now HIDDEN (Meta/TikTok ads only, no Google Ads/SEO signal at all) -- a
# deliberate behavior change the owner should confirm, not a bug.
keep, cat = ff.classify_focus(
    "Marketing Help - Home Services Businesses",
    "I need an individual who can manage, grow, and scale our facebook, instagram, and tik tok page... "
    "I also need a Google my business page set up, Google ads, Meta ads, etc.",
    "Social Media Marketing, Social Media Content Creation, Instagram, TikTok",
)
check(not keep and cat == "meta_tiktok_ads", f'#23079 "Marketing Help - Home Services Businesses": bare "Marketing" no longer rescues (Task 0.3) -> now HIDDEN, a confirmed conflict with the earlier recall-test approval: got keep={keep} cat={cat!r}')

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

# ── Task 0.3 (2026-11-20): the tightened marketing-title rescue, real titles ──
# All titles below were ACTUALLY VISIBLE in the feed on 2026-11-20, kept ONLY
# via the old bare-word marketing-title rescue (confirmed by re-running
# classify_focus against each over a scratch DB copy, read-only). None of them
# is an ads/search role. The owner's own named bad examples, verbatim:
for title, desc, kw in [
    ("Digital Project Manager", "We need a project manager to coordinate our digital initiatives across teams.", None),
    ("Lead Generation Specialist", "Looking for someone to run our lead generation campaigns, SEO is a plus.", None),
    ("Lead Developer", "Senior developer to lead our engineering team, SEO-friendly code a bonus.", None),
    ("WordPress Developer", "Build our WordPress site, SEO-friendly theme preferred.", None),
    ("Full Stack Developer", "Full stack engineer needed, some SEO awareness a plus.", None),
    ("Graphic Designer for Social Media", "Design social posts, SEO-adjacent captions a bonus.", None),
    ("Content Writer", "Write SEO-optimized blog posts for our site.", None),
    ("Virtual Assistant", "Admin tasks, some light SEO reporting.", None),
    ("Appointment Setter", "Cold-call leads, mention SEO services we offer.", None),
]:
    keep, cat = ff.classify_focus(title, desc, kw)
    check(not keep, f'Task 0.3: "{title}" (bare weak mention only) is no longer rescued -> HIDDEN: got keep={keep} cat={cat!r}')

# Real visible-feed titles, bare-word rescue removed -- confirmed junk, now hidden:
for title in [
    "Podcast Virtual Assistant – Guest Booking, Marketing & Growth",
    "Claude Figma Friendly Designer for Australian Trades Marketing Agency",
    "AI Automation Engineer – Custom Marketing Content & Scheduling Platform",
    "Video Editor for Paid Social Ads (TikTok, Meta, YouTube Shorts): Ecommerce & Retail Brands",
    "Senior Direct Response & Conversion Copywriter – Premium Brand | Emails, Landing Pages & Ads",
]:
    keep, cat = ff.classify_focus(title, "General help wanted, SEO mentioned once in passing.", None)
    check(not keep, f'Task 0.3: real visible-feed junk title no longer rescued -- "{title}": got keep={keep} cat={cat!r}')

# The owner's own named GOOD examples, verbatim -- these must keep rescuing:
for title in [
    "SEO Specialist Wanted", "PPC Manager Needed", "Google Ads Expert",
    "Marketing Manager for SaaS", "Marketing Specialist", "Marketing Strategist for Agency",
    "Marketing Consultant", "CMO for Fintech Startup", "Growth Marketer for B2B SaaS",
    "Performance Marketing Lead",
]:
    keep, cat = ff.classify_focus(title, "General help wanted, SEO mentioned once in passing.", None)
    check(keep, f'Task 0.3: a real ads/search-role title still rescues -- "{title}": got keep={keep} cat={cat!r}')

# ── Task 0b.5 (2026-11-21): the 4 borderline titles the owner asked to add.
# Each still only rescues a job that ALSO has a weak Google Ads/SEO mention
# elsewhere (both directions tested); #23079 "Marketing Help" stays hidden.
for title in ["Marketing Director for Growing Agency", "Head of Marketing for B2B SaaS",
              "Growth Manager", "Digital Marketing Manager", "Digital Marketing Specialist",
              "Digital Marketing Expert", "Digital Marketing Consultant"]:
    keep, cat = ff.classify_focus(title, "General help wanted, SEO mentioned once in passing.", None)
    check(keep, f'Task 0b.5: the new borderline title rescues a weak mention -- "{title}": got keep={keep} cat={cat!r}')

# ...but with NO weak Google Ads/SEO mention anywhere, the same titles are still hidden
# (the title alone is never enough -- the "a weak mention stays required" rule holds).
for title in ["Marketing Director for Growing Agency", "Head of Marketing for B2B SaaS",
              "Growth Manager", "Digital Marketing Manager"]:
    keep, cat = ff.classify_focus(title, "General marketing help wanted, no ads or search work at all.", None)
    check(not keep, f'Task 0b.5: the new titles do NOT rescue on their own, with no weak mention present -- "{title}": got keep={keep} cat={cat!r}')

# #23079 stays hidden: "Marketing Help" is still not one of the rescuing phrases
keep, cat = ff.classify_focus(
    "Marketing Help - Home Services Businesses",
    "I need an individual who can manage, grow, and scale our facebook, instagram, and tik tok page... "
    "I also need a Google my business page set up, Google ads, Meta ads, etc.",
    "Social Media Marketing, Social Media Content Creation, Instagram, TikTok",
)
check(not keep and cat == "meta_tiktok_ads", f'Task 0b.5: #23079 "Marketing Help" is still NOT rescued (owner: leave it hidden): got keep={keep} cat={cat!r}')

# ── Task 0b.8b (2026-11-21): "google shopping"/"merchant center" downgraded
# STRONG -> WEAK. Real job #25354 ("E-commerce/AI Expert Viritual Assistant
# A-Z", an Amazon Seller Central / online-store VA role) was wrongly KEPT by a
# single bare "Google Merchant Center skills" bullet buried in a generic skills
# list, with no other ads/SEO signal anywhere and an admin/VA-shaped title.
keep, cat = ff.classify_focus(
    "E-commerce/AI Expert  Viritual Assistant A-Z",
    "We're Hiring: Amazon + Online Store Manager (Remote). You should have: Proven Amazon account "
    "management experience, Hands-on Google Ads and Google Merchant Center skills, Strong Excel and "
    "Word skills, A marketing background, Social media know-how.",
    "Amazon Listing Optimization, Amazon Seller Central",
)
check(not keep, f'Task 0b.8b: #25354 (bare "Merchant Center" bullet, Amazon VA title) is now HIDDEN: got keep={keep} cat={cat!r}')

# ...but a real Merchant Center/Shopping job (phrase in the TITLE/keywords, or
# paired with another ads signal) is still kept -- same rules as any other weak mention.
keep, cat = ff.classify_focus("Google Shopping / Merchant Center Specialist", "Manage our product feed.", None)
check(keep and cat == "google_ads", f'a real "Merchant Center" ROLE title still keeps the job: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("Freelancer Needed", "Set up Google Merchant Center.", "Merchant Center, Google Shopping")
check(keep and cat == "google_ads", f'"Merchant Center" in the keywords field also still rescues: got keep={keep} cat={cat!r}')
# the existing "PPC Specialist" example (line ~267) is unaffected: "PPC" alone is still STRONG.
keep, cat = ff.classify_focus("PPC Specialist", "Manage our Performance Max and Shopping campaigns via Google Ads, with Merchant Center setup.", None)
check(keep and cat == "google_ads", f'PPC / Performance Max / Shopping / Merchant Center (PPC-titled) -> still KEPT: got keep={keep} cat={cat!r}')

# ── Task 0c/D4 (owner, 2026-11-21): bare "Google Analytics" downgraded STRONG -> WEAK.
# Real job #25357 "Fractional Digital Marketing Manager - B2B Fintech / Loyalty"
# (Switzerland, $0 spent) was kept ONLY by a bare "Google Analytics" in its keywords
# field ("Content Marketing, Retargeting, Google Analytics, Lead Generation"), a
# general marketing-manager role with no other Google Ads/SEO/PPC signal anywhere.
keep, cat = ff.classify_focus(
    "Fractional Digital Marketing Manager - B2B Fintech / Loyalty",
    "We need a fractional marketing leader for our fintech loyalty platform. Own strategy, "
    "content calendars, and reporting across channels.",
    "Content Marketing, Retargeting, Google Analytics, Lead Generation",
)
check(not keep, f'D4: #25357 (bare "Google Analytics" in keywords, general marketing-manager title) is now HIDDEN: got keep={keep} cat={cat!r}')

# ...but a real analytics-ROLE title, or "Google Analytics" paired with another
# weak signal, or in the TITLE itself, still keeps the job -- same rules as any
# other weak mention. "google tag manager" and "search console" are UNCHANGED (still STRONG).
keep, cat = ff.classify_focus("Google Analytics Specialist", "Set up GA4 tracking and dashboards.", None)
check(keep and cat == "analytics", f'a real "Google Analytics" ROLE title still keeps the job: got keep={keep} cat={cat!r}')
# "analytics" is narrower than the other weak categories: keywords-field co-location
# does NOT rescue it on its own (Upwork auto-tags "Google Analytics" on nearly every
# marketing job) -- only an actual TITLE mention, or a second independent weak signal, does.
keep, cat = ff.classify_focus("Freelancer Needed", "Set up Google Analytics for our site.", "Google Analytics, Reporting")
check(not keep, f'bare "Google Analytics" in the keywords field alone (no title mention) does NOT rescue: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("Freelancer Needed", "We use Google Analytics and also need basic SEO cleanup.", None)
check(keep, f'"Google Analytics" + a second independent weak signal (SEO) together still keep the job: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("General VA Needed", "Some reporting work, familiar with Google Tag Manager a plus.", None)
check(keep and cat == "analytics", f'"Google Tag Manager" is UNCHANGED -- still STRONG anywhere: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("General VA Needed", "Some reporting work, familiar with Search Console a plus.", None)
check(keep and cat == "analytics", f'"Search Console" is UNCHANGED -- still STRONG anywhere: got keep={keep} cat={cat!r}')

# ── focus_test_active: Kyiv-time, inclusive, malformed dates never loosen it ──
CFG = {"focus_test": {"from": "2026-11-19", "until": "2026-12-03"}}
check(not ff.focus_test_active(CFG, utc(2026, 11, 18, 21)), "Nov 18, 23:00 Kyiv: not yet")
check(ff.focus_test_active(CFG, utc(2026, 11, 18, 22)), "Nov 19, 00:00 Kyiv (Nov 18 22:00 UTC): ACTIVE (start is Kyiv time)")
check(ff.focus_test_active(CFG, utc(2026, 11, 25)), "mid-window: active")
check(ff.focus_test_active(CFG, utc(2026, 12, 3, 21)), "Dec 3, 23:00 Kyiv: still active (end date inclusive)")
check(not ff.focus_test_active(CFG, utc(2026, 12, 3, 22)), "Dec 4, 00:00 Kyiv: OVER -- expires on its own, no manual step")
check(not ff.focus_test_active({}, utc(2026, 11, 25)) and not ff.focus_test_active({"focus_test": None}, utc(2026, 11, 25)), "no block: never active")
check(not ff.focus_test_active({"focus_test": {"until": "not-a-date"}}, utc(2026, 11, 25)), "a malformed date never activates the filter")

# ── Task 8.2 (owner, 2026-11-23): "Google Ad Grants"/"AdGrants"/"Ad Grants" ──
keep, cat = ff.classify_focus("Google AdGrants Account Troubleshooting", "Fix issues in our Google Ad Grants account.", None)
check(keep and cat == "google_ads", f'"AdGrants" (no space) is a STRONG google_ads signal: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("Google Ad Grants Specialist for a Nonprofit Sailing Club (Campaign Strategy and Setup)", "Help us run our Ad Grants campaign.", None)
check(keep and cat == "google_ads", f'"Ad Grants" (two words) is also STRONG: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("Freelancer Needed", "We run ad grants for our nonprofit and need help.", None)
check(keep and cat == "google_ads", f'bare "ad grants" anywhere in the blob still keeps it (STRONG = anywhere): got keep={keep} cat={cat!r}')

# ── Task 8.4 (owner, 2026-11-23): Google Business Profile trial ─────────────
keep, cat = ff.classify_focus("Google Business Profile Expert", "Manage and optimize our Google Business Profile listing, posts and categories.", None)
check(keep and cat == "gbp", f'a GBP-only job is now KEPT, tagged "gbp": got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("Local GBP Specialist Needed", "Set up and maintain our google my business listing.", None)
check(keep and cat == "gbp", f'"google my business" phrasing also rescues: got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("GBP Setup for New Clinic", "Need help with GBP for our new clinic location.", None)
check(keep and cat == "gbp", f'bare "GBP" (whole word) also rescues: got keep={keep} cat={cat!r}')
# pure review-removal/reputation jobs stay hidden -- NOT part of this trial
keep, cat = ff.classify_focus("Remove Fake Google Business Profile Review", "We need someone to remove a fake negative review from our GBP listing.", None)
check(not keep, f'pure review-removal, even naming GBP, stays hidden (owner: not part of the trial): got keep={keep} cat={cat!r}')
keep, cat = ff.classify_focus("Negative google review removal", "Please help with review removal for our business.", None)
check(not keep, f'review removal with no GBP phrase at all stays hidden, unaffected either way: got keep={keep} cat={cat!r}')
# a job that's ALSO a real Google Ads/SEO job keeps its stronger category, not "gbp"
keep, cat = ff.classify_focus("Google Ads Specialist with GBP Management", "Run our Google Ads campaigns and also manage GBP.", None)
check(keep and cat == "google_ads", f'a job with a real Google Ads signal keeps that category, GBP is not the ONLY signal: got keep={keep} cat={cat!r}')
# a job that ALSO matches an off-lane HIDE category stays hidden under THAT
# category -- "ONLY focus category is GBP" means GBP and nothing else off-lane.
# Real regression caught while building this: #23079 mentions "Google my
# business page set up" as one bullet among facebook/instagram/tiktok work.
keep, cat = ff.classify_focus(
    "Marketing Help - Home Services Businesses",
    "I need an individual who can manage, grow, and scale our facebook, instagram, and tik tok page... "
    "I also need a Google my business page set up, Google ads, Meta ads, etc.",
    "Social Media Marketing, Social Media Content Creation, Instagram, TikTok",
)
check(not keep and cat == "meta_tiktok_ads", f'#23079: "Google my business" mentioned in passing on a real meta_tiktok_ads job does NOT get GBP-rescued, stays hidden as before: got keep={keep} cat={cat!r}')

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
