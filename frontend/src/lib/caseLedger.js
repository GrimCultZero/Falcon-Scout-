// ── Structured case ledger (DESIGN.md §21.3, Step 21-A) ─────────────────────
//
// Single source of truth for every case study. Replaces the scattered prose +
// `_CASE_META` (JobDetail.jsx) + the hardcoded attachables inventory. Cases are
// DATA the model may only reference by id via a `{{case:<id>}}` placeholder,
// which the app expands into the canonical line. Structural consequences:
//   - metrics can't drift (rendered from `metrics`, never typed by the model)
//   - verticals can't be relabeled (never model-authored)
//   - a case cannot appear twice (the expander dedups by id → one results block)
//
// SEED PROVENANCE (every figure copied from a VERIFIED record, never invented):
//   - KB #1  "PPC/SEO client case studies overview" — 11 cases with figures
//   - CASES.md (SMASH, Game-X, Atlant, Skin Reboot, GST, ChronoCash, Luxury Parfums)
//   - KB #518 "web-dev portfolio" (SMASH/Game-X/GKit/Casa figures)
//   - KB #32  Ukrainian Oxytec case (6× organic traffic / +76% Mar–Nov 2020)
// A case with no verified figure gets metrics:[] (none here — see WORKLOG note on GKit).
//
// `attachment` mirrors the current renderer's convention so 21-A does not change
// observable output: pdf → "attached as PDF"; everything else → "attached in
// profile highlights". `service` is the PRIMARY domain for matching; a few cases
// are genuinely dual (skin-reboot, derma) — refined when 21-B/C needs it.

export const CASE_LEDGER = [
  {
    id: 'skin-reboot', name: 'Skin Reboot', vertical: 'ecom-health', service: 'ppc',
    attachment: 'pdf', is_real: true,
    metrics: ['+693.8% revenue', '17.51 PMax ROAS', '+134.12% conversions', '+91.58% traffic'],
    one_liner: 'Scaled a Korean medical-aesthetic (restricted-niche) ecommerce brand with SEO + feed-based Performance Max — feed optimization, enhanced conversions, and wasted-spend pruning',
  },
  {
    id: 'derma-solution', name: 'Derma Solution', vertical: 'ecom-health', service: 'seo',
    attachment: 'pdf', is_real: true,
    metrics: ['+1,861% organic traffic', '+14,342% conversions', '357 → 25,989 monthly users', '155 referring domains (DR 19)', '35.26% of revenue from Organic Search'],
    one_liner: 'Technical-first SEO in a strict YMYL medical-aesthetics niche — fixed robots/HTTPS/canonicals/site speed, schema, and E-E-A-T authority building',
  },
  {
    id: 'golden-state-trailers', name: 'Golden State Trailers', vertical: 'b2b-manufacturing', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+350% organic traffic', '67 keywords in Top 3', '110 referring domains'],
    one_liner: 'SEO geo-expansion for a US B2B custom-trailer / food-truck manufacturer — commercial-intent semantic core, 72 state/city landing pages, and steady link building',
  },
  {
    id: 'nectar-flowers', name: 'Nectar Flowers', vertical: 'ecom-florist', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['-72% cost per conversion', '+350% revenue', '-67% CPC'],
    one_liner: 'Google Ads rebuild for a highly seasonal Ottawa florist — restructured campaigns by intent (delivery / occasions), tightened geo, added Shopping / DSA / remarketing',
  },
  {
    id: 'fridgefix', name: 'FridgeFix', vertical: 'local-service', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['-92% cost per conversion', '+1,405% conversions', '$1.71 CPC'],
    one_liner: 'Local lead-gen for a California refrigerator-repair business — full GA4/GTM conversion tracking, Local PMax + Search, and ongoing negative-keyword / geo pruning',
  },
  {
    id: 'house-painting', name: 'House Painting', vertical: 'local-service', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['2,100+ clicks', '7.3% CTR', '$140 avg cost per conversion'],
    one_liner: 'Search + PMax local lead generation for a US painting contractor',
  },
  {
    id: 'multilingual-site', name: 'Multilingual Site', vertical: 'construction', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['17,100 new monthly visits', '18 keywords in Top 1', '47 keywords in Top 3', '+30% visibility'],
    one_liner: 'Bilingual (Italian + German) local SEO for a construction / permits consultancy on the Italian–Austrian border — dual-language indexing and technical structure',
  },
  {
    id: 'oxytec', name: 'Oxytec', vertical: 'b2b-equipment', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['6× organic traffic', '+76% organic traffic (Mar–Nov 2020)'],
    one_liner: 'SEO for a German-market water / air purification equipment supplier — technical fixes, semantic strategy, and competitor-based link building',
  },
  {
    id: 'luxury-parfums', name: 'Luxury Parfums', vertical: 'ecom-luxury', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+143% revenue', '+79% monthly visits', '33 keywords in Top 1'],
    one_liner: 'Organic growth for a luxury-scent ecommerce brand — on-page optimization, content strategy, and technical SEO',
  },
  {
    id: 'chronocash', name: 'ChronoCash', vertical: 'ecom-luxury', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['€0.52 CPC', '+42% conversions', '4,690 conversions from 9,210 clicks', '€4.83K monthly ad spend'],
    one_liner: 'Google Ads lead generation for a European luxury-watch dealer — Video + PMax + DSA + Demand Gen across buyer-intent stages, focused on minimizing cost per conversion',
  },
  {
    id: 'atlant', name: 'Atlant', vertical: 'real-estate', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+56.5% conversions', '-31% CPC', '+144% clicks'],
    one_liner: 'Google Ads audit + management for a residential property developer — per-complex branded campaigns + PMax + DSA + remarketing for new-listing lead gen',
  },
  {
    id: 'vape-shop', name: 'Vape Shop', vertical: 'ecom-restricted', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['7,000 monthly visitors', '54 keywords in Google Top 1', '80 referring domains'],
    one_liner: 'Fast SEO ramp-up for a newly launched restricted (e-cigarette) ecommerce site — technical setup, semantic core, content, and link building',
  },
  {
    id: 'smash', name: 'SMASH', vertical: 'ecom-fashion', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+217% monthly revenue', '3.4× conversion rate', '-52% bounce rate', '2.4× mobile session depth'],
    one_liner: 'Custom OpenCart rebuild for a Ukrainian streetwear brand — a bespoke theme, a Lucky Box gamification module, and a mobile-first rebuild',
  },
  {
    id: 'game-x', name: 'Game-X', vertical: 'ecom-hardware', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+34% conversion rate', '-60% pre-sale support tickets', '2.4× AOV', '4.9/5 CSAT'],
    one_liner: 'Three custom OpenCart modules built from scratch for a 5,200-SKU PC-hardware store — a PC configurator, a real-time compatibility engine, and a build-aware smart cart',
  },
  {
    id: 'gkit', name: 'GKit', vertical: 'ecom-fashion', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    // WEAK METRICS (first month, new domain) — flagged for Artem to supply stronger figures.
    metrics: ['2,600 search impressions in month 1 (new domain)', '42 clicks'],
    one_liner: 'Full OpenCart build for a branded fashion / footwear store — KeepinCRM bidirectional sync, bilingual hreflang, and SEO wired in at launch',
  },
  {
    id: 'casa-eleganza', name: 'Casa Eleganza', vertical: 'ecom-furniture', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+41% conversion on filtered pages', '+28% AOV', '-45% PDP bounce', '3× special-order inquiries'],
    one_liner: 'Custom Shopify 2.0 build for a US premium furniture retailer — multi-axis filtering, a "Complete the Look" room bundler, and inline Synchrony financing',
  },
]

export const CASE_BY_ID = Object.freeze(
  CASE_LEDGER.reduce((m, c) => { m[c.id] = c; return m }, {})
)

// Matches a placeholder the model may emit: {{case:skin-reboot}} (whitespace-tolerant).
const _PLACEHOLDER_RE = /\{\{\s*case\s*:\s*([a-z0-9][a-z0-9-]*)\s*\}\}/gi

const _attachmentLabel = (attachment) =>
  attachment === 'pdf' ? ' (attached as PDF)' :
  attachment === 'profile-highlights' ? ' (attached in profile highlights)' : ''

// Render the ONE canonical line for a case id, or null if unknown.
// Format: "Name (attached …): <one-liner>. <metric1, metric2, …>."
export function renderCaseLine(id) {
  const c = CASE_BY_ID[String(id || '').toLowerCase()]
  if (!c) return null
  const body = String(c.one_liner || '').trim().replace(/[.\s]+$/, '')
  const metrics = Array.isArray(c.metrics) && c.metrics.length ? ` ${c.metrics.join(', ')}.` : ''
  return `${c.name}${_attachmentLabel(c.attachment)}: ${body}.${metrics}`.replace(/[ \t]{2,}/g, ' ').trim()
}

// Expand every {{case:id}} placeholder in `text` into its canonical line.
// DEDUPS by id (a case can appear at most once — the second placeholder is dropped),
// and drops unknown ids. Pure + idempotent. Returns metadata so 21-B (the checker)
// can later record `caseDuplicated` / `caseUnknown` telemetry; 21-A does NOT strip
// prose or record violations — it only performs the structural expansion.
export function expandCasePlaceholders(text) {
  if (!text || !_PLACEHOLDER_RE.test(text)) {
    _PLACEHOLDER_RE.lastIndex = 0
    return { text: text || '', expanded: [], duplicates: [], unknown: [], changed: false }
  }
  _PLACEHOLDER_RE.lastIndex = 0
  const seen = new Set(), expanded = [], duplicates = [], unknown = []
  const out = String(text).replace(_PLACEHOLDER_RE, (_m, rawId) => {
    const id = rawId.toLowerCase()
    if (!CASE_BY_ID[id]) { unknown.push(id); return '' }   // unknown case → drop
    if (seen.has(id)) { duplicates.push(id); return '' }   // duplicate → drop (dedup by id)
    seen.add(id)
    expanded.push(id)
    return renderCaseLine(id)
  })
  // Tidy the blank-line runs a dropped placeholder can leave behind.
  const cleaned = out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
  return { text: cleaned, expanded, duplicates, unknown, changed: true }
}
