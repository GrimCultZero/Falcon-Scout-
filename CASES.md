# Falcon Scout — Solved Cases & Findings

**Purpose:** a growing library of distilled, reusable examples — real client scenarios we
worked through, the reasoning that won them, and the reusable pattern each one teaches. This
is *around-the-project* knowledge (not code). Any iteration, any account, reads this for
"how have we handled X before" and **appends new cases** at the bottom.

**Format per case:** Context → What we found/did → The reusable lesson → Outcome (if known).
Keep it tight. If a case yields a repeatable method, also capture it as a Core KB note in-app.

---

## Case 1 — Local-SEO map-pack recovery (white-label agency screening, Jun 2026)

**Context.** Agency "Blueprint For Scale" (white-label, home-services / mold remediation)
invited Artem, then screened him: *"A client has fallen in rankings recently — what would you
do to get them back to top 3?"* with a Local Dominator geo-grid + the client site
(puremaintenancepueblo.com) + Ahrefs.

**What we found (pulled live via Claude-in-Chrome on the agency's logged-in tools).**
- Local Dominator scan history: **Mar 9 = 1.92 avg rank, 85% of grid in top 3** (green across
  the whole map) → **Jun 8 = 3.44 avg, 43% top 3** — east (near the business pin) holds 2-3,
  the **entire west half decayed to position 4**. Nothing "out" → not a suspension, a *slide*.
- Site (WebFetch): two different phone numbers (NAP inconsistency), no LocalBusiness/Service
  schema, geo service pages exist but rank ~nothing, service area padded with NW-Colorado
  towns hours away (dilutes local relevance).
- Ahrefs (client-pasted): ~0 organic keywords/traffic, key pages dropped out of the index.

**The reasoning that wins it.** When the *periphery* decays while the blocks near the pin
hold, it's a **prominence/authority problem, not proximity** — the pin didn't move, so what
shrank is the radius the profile can hold top-3 across. That correlates directly with the
site's collapsed organic footprint: as authority faded, the rankable radius contracted and
the farthest (west) blocks fell first. Recovery = rebuild prominence (NAP cleanup, schema,
deepen+interlink geo pages, citations/local links, review velocity, spam-fight weak blocks),
then prove it on a weekly re-run of the same grid.

**Reusable lesson.** For "how would you…" screening questions, *pull the actual data live and
read it* — it beats any generic process answer. And the periphery-vs-center decay shape is a
fast, repeatable diagnostic. Captured as Core KB note **#468** ("Local SEO / Map-Pack
Recovery — diagnostic method").

**Outcome.** Response sent with the two grid screenshots (Mar vs Jun). [Pending client reply.]

---

## Case — Circumvention enforcement flag from an innocent proposal line (Jun 11, 2026)

**Context.** Upwork Trust & Safety flagged Artem's account: "offered or requested to take
payments outside of Upwork" (Circumvention). Account kept FULL platform access — it was a
policy flag + ToS-acknowledgment banner, not a suspension. Recoverable via acknowledge +
optional "Request enforcement decision review" appeal (two 1200-char fields + optional files).

**What we found.** The trigger was almost certainly one line in a Meta Ads proposal:
*"managing through Upwork hits friction … we'll find workaround."* Artem meant **Meta Business
Manager ad-account ACCESS friction** (Meta's 2FA/access blocks on agency access) — a routine
PPC topic. But Upwork's automated scanner reads *"through Upwork hits friction → workaround"*
as off-platform intent. Context didn't save it; the pattern alone fired.

**The reusable lesson (two parts).**
1. **Never let a letter put "Upwork" near "friction/workaround/limitations," name any payment
   rail (PayPal/Wise/wire/crypto/"pay directly"), or any off-platform contact channel
   (WhatsApp/Telegram/email/phone).** Platform-access difficulties (e.g. Meta BM 2FA) must be
   described positively WITHOUT naming Upwork: *"i'll set up secure partner access through Meta
   Business Manager."* When in doubt, omit. This is now enforced in the generator (commit
   9b5dce3): prompt rule + deterministic CIRCUMVENTION_RISK regex pre-check + enforcer rewrite.
2. **Appeal playbook:** open the violation's "Details" first; do an honesty gut-check (if it was
   real, acknowledge & move on — false-info appeal = permanent ban); acknowledge the ToS banner
   to restore standing; then submit a calm, factual appeal that (a) states all payments have
   always been on Upwork, (b) explains the flagged words meant ad-account ACCESS not payments,
   (c) notes the incentive to stay (Connects purchases, payment protection), (d) offers the full
   thread + a screenshot of the proposal in context. Never confrontational.

**Outcome.** Drafts provided; root cause fixed in code. [Appeal pending Artem's submission.]

---

## Case Study — SMASH eCommerce Redesign (OpenCart, Web Dev, Jun 2026)

**Client.** SMASH — Ukrainian streetwear brand (smash.com.ua), founded 2019, 90K+ Instagram followers. Strong offline/social brand, weak online store.

**Problem.** Default OpenCart theme looked like any generic shop — no brand identity. Two growth blockers: (1) no gamification/repeat-purchase mechanics, (2) poor mobile UX on 63% of their traffic.

**Solution (6 weeks).**
1. **Custom theme** — fully bespoke OpenCart theme matching SMASH's editorial streetwear aesthetic. Every default element replaced.
2. **Lucky Box module** — custom-built gamification: mystery boxes of curated streetwear at 25–35% off retail. Three tiers (S/M/L: 2,999–4,999₴). No duplicates, no dead stock. Integrated with OpenCart inventory + order management.
3. **Mobile-first rebuild** — swipe gallery, one-tap size selection, sticky checkout bar, 1.8s avg page load.

**Results (6 months post-launch).**
- +217% monthly revenue
- 3.4× conversion rate
- −52% bounce rate / −38% mobile bounce
- 2.4× mobile session depth

**Reusable lesson.** Gamification (mystery box / tiered discount mechanics) is a high-ROI add-on for fashion/streetwear eCommerce — especially when brand identity is strong but return-purchase rate is low. Positions web dev work as revenue driver, not just design. Good proof case for proposals involving eCommerce conversion, mobile UX, or OpenCart.

**KB entry:** #487 (`case_study`, `is_core=1`)

---

## Case Study — Game-X PC Builder eCommerce (OpenCart custom modules, Jun 2026)

**Client.** Game-X (game-x.com.ua) — Ukrainian PC hardware e-commerce store on OpenCart 3.x.

**Problem.** 5,200+ SKUs with zero compatibility guidance — buyers couldn't tell if parts worked together. Support overwhelmed, carts abandoned.

**Solution (8 weeks).** Three custom OpenCart modules built from scratch:
1. **PC Configurator** — 6-step guided builder (CPU → MB → RAM → GPU → PSU → Case), each step auto-filters to compatible options only, live price counter, admin UI, mobile-responsive.
2. **Compatibility Engine** — relational matrix over four rule layers (CPU↔MB socket, RAM type↔MB slot, GPU wattage↔PSU rating, case form factor↔MB size), real-time validation so zero invalid builds reach checkout.
3. **Smart Cart** — build-aware checkout, saves complete builds per user, detects when a swapped part breaks compatibility and warns pre-checkout in plain language.

**Tech.** OpenCart 3.x, PHP 8.1, MySQL, Vanilla JS, custom OC module API, CSS3, Git/CI.

**Results (6 months).** +34% conversion (configurator vs standard pages), −60% pre-sale support tickets, 2.4× AOV, 4.9/5 CSAT.

**Reusable lesson.** Strongest proof case for **complex custom OpenCart/PHP development** — not just theming but real backend logic (rule engine, stateful cart, admin tooling). Pairs with SMASH (#487, OpenCart theme + gamification) and Game-X (#496) to cover the OpenCart/eCommerce-dev vertical. Lead with this when a job needs custom modules, product configurators, or compatibility/validation logic.

**KB entry:** #496 (`case_study`, `is_core=1`).

---

## Case Study — Atlant Real Estate Google Ads (property developer, found Jun 30 2026)

**Context.** Analyser SKIPped a "Real Estate Adwords Specialist" job (id 4381, score 2/10), its top reason: *"Artem has zero real-estate case studies."* That was WRONG — a strong real-estate Google Ads case existed in the KB but was invisible: auto-imported, Ukrainian title, `is_core=0`, so neither the analyser's static vertical list nor the model recognised it.

**The case (KB #245, Ukrainian source → distilled to English KB #502, core).** Atlant (atlant.build), major Ukrainian property developer. Google Ads audit + ongoing management for new-listing/apartment-sales lead gen. Results (Jun–Nov 2023 vs prior 6mo): **+56.5% leads, −31% CPC, +144% clicks**, budget scaled +68% while cost/conversion rose <8%; paid drove 49% of traffic. Winning structure: branded campaigns per residential complex (lowest CPL) + PMax + DSA + remarketing + installment-plan campaigns.

**Fix.** (1) Added clean English core `case_study` #502 so the generator can cite it. (2) Added REAL ESTATE to the analyser's PROVEN-RESULTS vertical list with an explicit "do NOT score real-estate PPC jobs as no-vertical-experience" instruction.

**Reusable lesson.** The analyser/generator only "know" verticals that are (a) core and (b) in a language/title the model can match. Auto-imported Ukrainian case studies are effectively invisible proof. When a vertical gap is flagged, CHECK THE KB in the source language (нерухомість = real estate) before trusting "Artem has no X experience" — and promote/translate the match to a core English entry. Other auto-imported cases likely hide the same way (cargo/B2B #190, IKEA furniture #198, Irish-pub-in-Switzerland #176, etc.).

**KB entries:** #502 (English, core) ← distilled from #245 (Ukrainian source).

---

## Case metrics — authoritative recap loaded (Jun 30 2026)

Owner supplied `Cases recap.docx` with REAL numbers for all cases → stored as core KB note **#506** (single source of truth). Key reconciliations vs what the generator had been citing:
- **Skin Reboot "$12k→$95k revenue" was FABRICATED** — real figures: +91.58% traffic, +134.12% conv, **+693.8% revenue, 17.51 PMax ROAS** (overall ROAS 15.04, 50,036 clicks). Removed the dollar figure from both generator case menus.
- **Golden State Trailers "+350% organic / 72 city pages" is REAL** (67 kw Top 3, 110 ref domains) — an earlier review wrongly flagged it as conflated; the generator was accurate.
- **ChronoCash = NEW case** (KB **#507**): European luxury watch dealer, Google Ads — €0.52 CPC, +42% conv, 4.69K conv from 9.21K clicks, €4.83K/mo (Video+PMax+DSA+Demand Gen). Added to PPC menu as the lead luxury/high-ticket case.
- **Luxury Parfums** added to SEO menu (+79% visits, +143% revenue, 33 kw Top 1).
- **Confirmed gaps:** NO CallRail/DNI case and NO SaaS case exist — so prior letters claiming CallRail experience were unbacked; the SaaS-mislabel and CallRail concerns stand.

Full per-case numbers live in KB #506; CASES.md keeps just the deltas.
