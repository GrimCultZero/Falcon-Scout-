"""
One-shot script: imports the GKit case study and web-dev KB rules into the
running Falcon Scout backend (http://localhost:8000).

Run once:  python scripts/import_webdev.py

Safe to re-run — it checks existing entries by title before inserting.
"""
import requests, json, sys

BASE = "http://localhost:8000"

def existing_titles():
    r = requests.get(f"{BASE}/kb", timeout=10)
    r.raise_for_status()
    return {e["title"] for e in r.json()}

def post(entry):
    r = requests.post(f"{BASE}/kb", json=entry, timeout=10)
    if r.status_code not in (200, 201):
        print(f"  ERROR {r.status_code}: {r.text[:200]}")
        return False
    return True

ENTRIES = [
    # ── Case study ────────────────────────────────────────────────────────────
    {
        "title": "Case Study: GKit — Branded Fashion E-Commerce on OpenCart",
        "type": "scraped",
        "tags": "webdev,ecommerce,opencart,seo,case-study",
        "source_url": "https://itforce.ua/cases/rozrobka-seo-saitu-brendovoho-odiahu-vzuttia-ta-aksesuariv/",
        "content": """# GKit — Branded Clothing, Footwear & Accessories E-Commerce

**Client:** GKit (gkit.com.ua)
**Industry:** E-commerce — branded apparel (Nike, Adidas, Jordan, New Balance, etc.), Ukraine market
**Platform:** OpenCart
**Team:** IT Force (PM: Karina Arbuzova · Dev: Dmitro Leiber · SEO: Serhiy Shalagin)
**Launch:** End of February 2026

## What was built

Full-scope ecommerce development + SEO launch:

**Development**
- Full responsive OpenCart store from design mockups
- Product variant system (size/color as options, not duplicate SKUs)
- Bidirectional CRM sync: KeepinCRM ↔ site (products in, orders out)
- Image storage in CRM → CDN delivery via Bunny.net (performance)
- Bilingual site (Ukrainian / Russian): bilingual fields in CRM, hreflang tags
- Filter system with human-readable SEO URLs
- GA4 + Google Tag Manager + GSC setup (ecommerce module)

**SEO architecture**
- Three-tier category structure: Accessories / Clothing / Footwear
- Schema.org markup: Product, BreadcrumbList, Organization
- hreflang implementation for dual-language
- Canonical strategy for filter pages
- Sitemap + robots.txt, HTTPS redirect, image lazy-loading + WebP
- Metadata templates per category
- Competitor analysis vs yesoriginal.com.ua, answear.ua, allstars.ua

**Missing UX elements fixed**
- Language switcher dropdown, cart/wishlist counters, product review forms
- Breadcrumb navigation, footer service pages (shipping, returns, privacy, FAQ)

## Results — first month (March 2026, ~2 weeks post-launch)

| Metric | Value |
|---|---|
| Organic sessions | 85 |
| Engaged sessions | 50 (58.8% engagement rate) |
| Avg session duration | 1 minute |
| Search Console clicks | 42 |
| Impressions | 2,600 |
| Avg CTR | 1.6% |
| Avg position | 24.3 (page 3) |

Impressions trending upward from March 18 onward — strong early trajectory for a brand-new domain. CTR of 1.6% on page 3 indicates good snippet quality.

## Key differentiators vs typical web dev shop

1. **SEO-ready from day one** — architecture, schema, hreflang, canonical done during build, not as an afterthought.
2. **Analytics fully wired** — GA4 ecommerce tracking + GTM from launch, not installed months later.
3. **CRM integration** — bidirectional sync means zero manual product entry; orders flow back to CRM automatically.
4. **Single team, full scope** — development, SEO, and analytics delivered together, not handed off between vendors.
""",
    },

    # ── Web dev KB rules ──────────────────────────────────────────────────────
    {
        "title": "Rule: Web dev — credential framing (no false '12 years web dev' claim)",
        "type": "rule",
        "tags": "scope:webdev",
        "content": """For web development jobs, frame experience as digital expertise that INCLUDES ecommerce web development — NOT as "12 years of web development" (that's misleading; the 12-year track record is in digital marketing / PPC / SEO).

CORRECT framing examples:
- "12 years in digital, building and ranking ecommerce stores on Shopify, WordPress, and OpenCart."
- "12 years working with ecommerce clients — the last several building and SEO-optimizing their stores directly."
- "12 years across ecommerce SEO and store development on Shopify, WooCommerce, and OpenCart."

DO NOT say: "12 years of web development" or "12 years as a web developer" — those are false.
DO say: "12 years" plus a phrase that naturally bridges digital/ecommerce expertise into web dev.

The unique selling point is the COMBINATION: most web developers hand off to a separate SEO person. Mention that the build comes with SEO architecture + GA4/GTM analytics wired in from day one — this is the differentiator.
""",
    },
    {
        "title": "Rule: Web dev — do NOT cite Google Premier Partner credential",
        "type": "rule",
        "tags": "scope:webdev",
        "content": """On pure web development jobs (Shopify, WordPress, WooCommerce, OpenCart) that have NO Google Ads / PPC component, do NOT mention "Google Premier Partner 2026".

The Premier Partner badge is a Google Ads (PPC) program credential. Citing it on a web dev job where there's no paid media scope looks off-topic and breaks the reader's trust.

Exception: if the job combines web development WITH Google Ads management or PPC setup, then Premier Partner IS relevant and SHOULD be mentioned in the PPC context.
""",
    },
    {
        "title": "Rule: Web dev — use GKit case study for ecommerce store builds",
        "type": "rule",
        "tags": "scope:webdev",
        "content": """The primary web development case study to reference is GKit — a branded fashion/footwear ecommerce store built on OpenCart (launched Q1 2026).

WHEN TO CITE GKit:
- OpenCart jobs → cite directly ("built and SEO-optimized a branded fashion store on OpenCart")
- Any ecommerce store development (Shopify, WooCommerce, etc.) → reference the delivery model ("similar to our recent GKit build: dev + SEO architecture + GA4 all in one")
- Bilingual / multilingual store jobs → GKit had Ukrainian/Russian hreflang + CRM sync
- Fashion/apparel/footwear/accessories verticals → cite directly

WHAT TO HIGHLIGHT from GKit:
- OpenCart + KeepinCRM bidirectional sync (products in, orders out)
- Dual-language with hreflang
- SEO-ready from day one: schema, canonical, filter URLs
- GA4/GTM ecommerce tracking set up at launch
- 2,600 impressions in first month (new domain, page 3 average)

Do NOT fabricate metrics beyond what's listed above. If asked about conversion rate, revenue, or rankings beyond "page 3 average at 2 weeks post-launch" — say the client's full data isn't public.
""",
    },
    {
        "title": "Rule: Web dev — the full-scope differentiator (build + SEO + analytics)",
        "type": "rule",
        "tags": "scope:webdev,always",
        "content": """The core differentiator for IT Force web development vs typical Upwork devs:

**Most web devs build the site, then the client separately hires an SEO person months later. By then, the architecture is locked and SEO fixes are expensive retrofits.**

IT Force delivers all three in one engagement:
1. Development (Shopify / WordPress / WooCommerce / OpenCart)
2. SEO-ready architecture from the ground up (URL structure, schema, canonical, sitemap, hreflang if needed)
3. Analytics wired at launch (GA4 ecommerce tracking, GTM, Search Console)

This pitch is true, verifiable from the GKit case, and resonates with ecommerce clients who have been burned by "we'll add SEO later" promises.

HOW TO USE: Within the first 2-3 sentences of a web dev cover letter, after mirroring the client's problem, introduce this angle — e.g.:
"Where most dev shops hand off to a separate SEO team later, we wire the technical SEO and GA4 tracking into the build itself — so the site ranks from day one instead of six months after launch."
""",
    },
    {
        "title": "Rule: Web dev — scope boundary (no custom software engineering)",
        "type": "rule",
        "tags": "scope:webdev",
        "content": """IT Force's web development scope is CMS/ecommerce PLATFORM work:
- Shopify (store setup, theme customization, app integration)
- WordPress / WooCommerce (themes, plugins, site builds)
- OpenCart (store builds, extensions, CRM integration)

OUT OF SCOPE — do not claim capability for:
- Custom web applications built in React, Vue, Angular, Next.js (standalone SPA)
- Node.js / Python / Ruby / Go backend APIs
- Mobile apps (iOS / Android / React Native / Flutter)
- SaaS platform development
- Blockchain / Web3 / smart contracts
- Complex custom integrations that go beyond standard CMS plugin/API usage

If a job is clearly asking for custom software engineering beyond CMS platforms, the generator should SKIP the job or explicitly note the scope mismatch in the proposal. Do not claim these capabilities.
""",
    },
]


def main():
    print(f"Connecting to {BASE}…")
    try:
        existing = existing_titles()
    except Exception as e:
        print(f"Cannot reach backend: {e}\nMake sure Falcon Scout is running.")
        sys.exit(1)

    print(f"Found {len(existing)} existing KB entries.\n")

    added = 0
    skipped = 0
    for entry in ENTRIES:
        title = entry["title"]
        if title in existing:
            print(f"  SKIP (already exists): {title[:70]}")
            skipped += 1
        else:
            ok = post(entry)
            if ok:
                print(f"  ADDED: {title[:70]}")
                added += 1

    print(f"\nDone. Added {added}, skipped {skipped}.")


if __name__ == "__main__":
    main()
