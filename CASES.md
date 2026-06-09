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
