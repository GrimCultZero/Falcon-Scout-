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
//
// ── Location + timeframe (2026-09-24) ──
// A case's LOCATION and TIMEFRAME are facts exactly like its metrics, and they
// drift the same way whenever the model writes case prose itself. Job 16113
// (2026-09-24) shipped "Nectar Flowers: UK florist … over 90 days" — the
// florist is in Ottawa, Canada, and no period is on record for it at all.
//   geo          place groups the record supports (keys of _GEO_GROUPS below, or
//                a lowercased place name). [] = the record names no location, so
//                ANY place attached to the case is unsupported.
//   location     the same, human-readable — rendered into the prompt.
//   periods      { from, to } calendar months ('YYYY-MM', inclusive),
//                { duration: 'N unit' } where the record gives a length but no
//                dates, or { months: [m1, m2] } for a month span with no year.
//                [] = no timeframe on record.
//   years        extra calendar years the record ties to the case (e.g. founded).
//   period_label the same, human-readable — rendered into the prompt.
// Sources, same rule as the metrics: KB #1 section headers and "Period:" lines;
// KB #32 (Oxytec); KB #502 / #245 + CASES.md (Atlant); KB #507 (ChronoCash);
// KB #487 / #518 + CASES.md (SMASH, Game-X, GKit, Casa Eleganza).
//
// KNOWN SOURCE CONFLICT — Atlant. KB #1 lists "Real Estate Complex (USA)" with
// Atlant's exact figures (+144.25% clicks, +56.51% conversions, -31.02% CPC),
// while KB #502 (core, distilled from the Ukrainian source #245) and CASES.md
// say Atlant (atlant.build) is a Ukrainian developer building in Kyiv & region.
// The ledger follows #502, so a "US developer" claim about Atlant is flagged.
//
// Skin Reboot: KB #1 places it in the USA; "Korean" is in the canonical line
// because the brand sells Korean medical-aesthetic skincare, so both stand.

export const CASE_LEDGER = [
  {
    id: 'skin-reboot', name: 'Skin Reboot', vertical: 'ecom-health', service: 'ppc',
    attachment: 'pdf', is_real: true,
    metrics: ['+693.8% revenue', '17.51 PMax ROAS', '+134.12% conversions', '+91.58% traffic'],
    one_liner: 'Scaled a Korean medical-aesthetic (restricted-niche) ecommerce brand with SEO + feed-based Performance Max — feed optimization, enhanced conversions, and wasted-spend pruning',
    geo: ['us', 'north-america', 'korea'],
    location: 'USA (the products are Korean medical-aesthetic skincare)',
    periods: [{ from: '2024-09', to: '2025-10' }],
    period_label: 'Sep 2024 – Oct 2025',
  },
  {
    id: 'derma-solution', name: 'Derma Solution', vertical: 'ecom-health', service: 'seo',
    attachment: 'pdf', is_real: true,
    metrics: ['+1,861% organic traffic', '+14,342% conversions', '357 → 25,989 monthly users', '155 referring domains (DR 19)', '35.26% of revenue from Organic Search'],
    one_liner: 'Technical-first SEO in a strict YMYL medical-aesthetics niche — fixed robots/HTTPS/canonicals/site speed, schema, and E-E-A-T authority building',
    geo: ['us', 'north-america'],
    location: 'USA',
    // KB #506: "Conversions +14,342% (Sep-Oct YoY)" — months, no year.
    periods: [{ months: [9, 10] }],
    period_label: 'the +14,342% conversions compare Sep–Oct year over year (no year on record); no other timeframe on record',
  },
  {
    id: 'golden-state-trailers', name: 'Golden State Trailers', vertical: 'b2b-manufacturing', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+350% organic traffic', '67 keywords in Top 3', '110 referring domains'],
    one_liner: 'SEO geo-expansion for a US B2B custom-trailer / food-truck manufacturer — commercial-intent semantic core, 72 state/city landing pages, and steady link building',
    geo: ['us', 'north-america'],
    location: 'USA',
    periods: [],
  },
  {
    id: 'nectar-flowers', name: 'Nectar Flowers', vertical: 'ecom-florist', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['-72% cost per conversion', '+350% revenue', '-67% CPC'],
    one_liner: 'Google Ads rebuild for a highly seasonal Ottawa florist — restructured campaigns by intent (delivery / occasions), tightened geo, added Shopping / DSA / remarketing',
    geo: ['canada', 'ottawa', 'ontario', 'north-america'],
    location: 'Ottawa, Canada',
    periods: [],
  },
  {
    id: 'fridgefix', name: 'FridgeFix', vertical: 'local-service', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['-92% cost per conversion', '+1,405% conversions', '$1.71 CPC'],
    one_liner: 'Local lead-gen for a California refrigerator-repair business — full GA4/GTM conversion tracking, Local PMax + Search, and ongoing negative-keyword / geo pruning',
    geo: ['us', 'north-america', 'california', 'orange-county'],
    location: 'Orange County, California, USA',
    // KB #1's "Highlighted period (July–August 2023)" carries its OWN figures
    // (2,587 clicks, 1,134 conversions, $0.67/conv, $0.29 CPC); the headline
    // metrics above are not tied to it.
    periods: [{ from: '2023-07', to: '2023-08' }],
    period_label: 'Jul–Aug 2023 is the highlighted period in KB #1 (its own figures: 2,587 clicks, 1,134 conversions, $0.67 per conversion); the headline -92% / +1,405% figures carry no period',
  },
  {
    id: 'house-painting', name: 'House Painting', vertical: 'local-service', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['2,100+ clicks', '7.3% CTR', '$140 avg cost per conversion'],
    one_liner: 'Search + PMax local lead generation for a US painting contractor',
    geo: ['us', 'north-america'],
    location: 'USA',
    periods: [],
  },
  {
    id: 'multilingual-site', name: 'Multilingual Site', vertical: 'construction', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['17,100 new monthly visits', '18 keywords in Top 1', '47 keywords in Top 3', '+30% visibility'],
    one_liner: 'Bilingual (Italian + German) local SEO for a construction / permits consultancy on the Italian–Austrian border — dual-language indexing and technical structure',
    geo: ['italy', 'austria', 'germany', 'tyrol', 'europe'],
    location: 'the Italian–Austrian border (site in Italian + German)',
    periods: [],
  },
  {
    id: 'oxytec', name: 'Oxytec', vertical: 'b2b-equipment', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['6× organic traffic', '+76% organic traffic (Mar–Nov 2020)'],
    one_liner: 'SEO for a German-market water / air purification equipment supplier — technical fixes, semantic strategy, and competitor-based link building',
    geo: ['germany', 'europe', 'switzerland', 'austria', 'dach'],
    location: 'the German market (Swiss HQ, branches across Europe)',
    // KB #32: work began Feb 2020; the +76% compares March with November 2020.
    periods: [{ from: '2020-02', to: '2020-11' }, { from: '2020-03', to: '2020-11' }],
    period_label: 'work began Feb 2020; the +76% compares Mar vs Nov 2020',
  },
  {
    id: 'luxury-parfums', name: 'Luxury Parfums', vertical: 'ecom-luxury', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+143% revenue', '+79% monthly visits', '33 keywords in Top 1'],
    one_liner: 'Organic growth for a luxury-scent ecommerce brand — on-page optimization, content strategy, and technical SEO',
    geo: [],
    periods: [],
  },
  {
    id: 'chronocash', name: 'ChronoCash', vertical: 'ecom-luxury', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['€0.52 CPC', '+42% conversions', '4,690 conversions from 9,210 clicks', '€4.83K monthly ad spend'],
    one_liner: 'Google Ads lead generation for a European luxury-watch dealer — Video + PMax + DSA + Demand Gen across buyer-intent stages, focused on minimizing cost per conversion',
    geo: ['europe'],
    location: 'Europe',
    periods: [{ from: '2025-02', to: '2025-02' }],
    period_label: 'Feb 2025 (one month of data)',
  },
  {
    id: 'atlant', name: 'Atlant', vertical: 'real-estate', service: 'ppc',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+56.5% conversions', '-31% CPC', '+144% clicks'],
    one_liner: 'Google Ads audit + management for a residential property developer — per-complex branded campaigns + PMax + DSA + remarketing for new-listing lead gen',
    geo: ['ukraine', 'kyiv'],
    location: 'Ukraine (Kyiv & region)',
    periods: [{ from: '2023-06', to: '2023-11' }],
    period_label: 'Jun–Nov 2023, compared with the prior 6 months',
  },
  {
    id: 'vape-shop', name: 'Vape Shop', vertical: 'ecom-restricted', service: 'seo',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['7,000 monthly visitors', '54 keywords in Google Top 1', '80 referring domains'],
    one_liner: 'Fast SEO ramp-up for a newly launched restricted (e-cigarette) ecommerce site — technical setup, semantic core, content, and link building',
    geo: [],
    periods: [],
  },
  {
    id: 'smash', name: 'SMASH', vertical: 'ecom-fashion', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+217% monthly revenue', '3.4× conversion rate', '-52% bounce rate', '2.4× mobile session depth'],
    one_liner: 'Custom OpenCart rebuild for a Ukrainian streetwear brand — a bespoke theme, a Lucky Box gamification module, and a mobile-first rebuild',
    geo: ['ukraine'],
    location: 'Ukraine',
    periods: [{ duration: '6 weeks' }, { duration: '6 months' }],
    years: [2019],
    period_label: '6-week build; results measured 6 months post-launch (brand founded 2019)',
  },
  {
    id: 'game-x', name: 'Game-X', vertical: 'ecom-hardware', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+34% conversion rate', '-60% pre-sale support tickets', '2.4× AOV', '4.9/5 CSAT'],
    one_liner: 'Three custom OpenCart modules built from scratch for a 5,200-SKU PC-hardware store — a PC configurator, a real-time compatibility engine, and a build-aware smart cart',
    geo: ['ukraine'],
    location: 'Ukraine',
    periods: [{ duration: '8 weeks' }, { duration: '6 months' }],
    period_label: '8-week build; results measured 6 months post-launch',
  },
  {
    id: 'gkit', name: 'GKit', vertical: 'ecom-fashion', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    // WEAK METRICS (first month, new domain) — flagged for Artem to supply stronger figures.
    metrics: ['2,600 search impressions in month 1 (new domain)', '42 clicks'],
    one_liner: 'Full OpenCart build for a branded fashion / footwear store — KeepinCRM bidirectional sync, bilingual hreflang, and SEO wired in at launch',
    geo: ['ukraine'],
    location: 'Ukraine',
    periods: [{ from: '2026-01', to: '2026-03' }, { duration: '2 weeks' }, { duration: '1 month' }],
    period_label: 'launched Q1 2026; the figures are from the first month (~2 weeks post-launch)',
  },
  {
    id: 'casa-eleganza', name: 'Casa Eleganza', vertical: 'ecom-furniture', service: 'web-dev',
    attachment: 'profile-highlights', is_real: true,
    metrics: ['+41% conversion on filtered pages', '+28% AOV', '-45% PDP bounce', '3× special-order inquiries'],
    one_liner: 'Custom Shopify 2.0 build for a US premium furniture retailer — multi-axis filtering, a "Complete the Look" room bundler, and inline Synchrony financing',
    geo: ['us', 'north-america', 'florida', 'miami', 'new-jersey', 'paramus', 'italy', 'europe'],
    location: 'USA (showrooms in Miami, FL and Paramus, NJ; sells Italian / European luxury furniture)',
    periods: [],
    period_label: 'none on record (results are "post-launch", with no duration)',
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

// ── Case facts in the prompt ──────────────────────────────────────────────────
// The model reads case studies from the KB entries (portfolioText), where a
// location is a section header at best and a period is often absent. This block
// states both explicitly, including the absences, so a gap reads as "none on
// record" rather than as room to fill in.
export function renderCaseFactsBlock() {
  const rows = CASE_LEDGER.map(c =>
    `- ${c.name}: location — ${c.location || 'none on record'}; timeframe — ${c.period_label || 'none on record'}`)
  return '\n\nCASE FACTS ON RECORD (location + timeframe — FIXED DATA, exactly like the metrics):\n' +
    'State a case\'s location or timeframe ONLY as written here. "none on record" means say nothing about it: never supply one, never estimate one, never borrow the client\'s own country or timeline for it. Never tie a period to a metric unless this list ties them together.\n' +
    rows.join('\n')
}

// ── Case fact check: location + timeframe ─────────────────────────────────────
// Consumed by groundingCheck.js (claim classes caseGeoNotInLedger /
// caseTimeframeNotInLedger) and by the flag note in JobDetail.jsx.
//
// A CLOSED place vocabulary on purpose: a place the checker does not know is
// never flagged, so it can miss a fabrication but cannot invent one. Matched
// case-sensitively (proper nouns are capitalised in every letter), which keeps
// "polish the ad copy", "turkey" and the pronoun "us" out of it.
// Groups make synonyms share one allowance ("US" = "American" = "U.S.").
const _GEO_GROUPS = {
  'us': ['United States', 'USA', 'U.S.A.', 'U.S.', 'US', 'America', 'American', 'Americans'],
  'north-america': ['North America', 'North American'],
  'canada': ['Canada', 'Canadian', 'Canadians'],
  'ottawa': ['Ottawa'],
  'ontario': ['Ontario'],
  'california': ['California', 'Californian', 'Southern California', 'SoCal'],
  'orange-county': ['Orange County'],
  'florida': ['Florida'],
  'miami': ['Miami'],
  'new-jersey': ['New Jersey'],
  'paramus': ['Paramus'],
  'europe': ['Europe', 'European', 'EU'],
  'germany': ['Germany', 'German'],
  'italy': ['Italy', 'Italian'],
  'austria': ['Austria', 'Austrian'],
  'switzerland': ['Switzerland', 'Swiss'],
  'dach': ['DACH'],
  'tyrol': ['South Tyrol', 'Tyrol', 'Tyrolean'],
  'ukraine': ['Ukraine', 'Ukrainian'],
  'kyiv': ['Kyiv', 'Kiev'],
  'korea': ['South Korea', 'Korea', 'Korean', 'K-beauty'],
  'uk': ['United Kingdom', 'Great Britain', 'Britain', 'British', 'UK', 'U.K.', 'England', 'Scotland', 'Scottish', 'Wales', 'Welsh', 'London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Bristol', 'Glasgow', 'Edinburgh'],
}
// Places no case is from — known only so that a case cannot be moved there.
const _GEO_OTHER = [
  'Ireland', 'Irish', 'Dublin', 'Australia', 'Australian', 'Sydney', 'Melbourne', 'Brisbane', 'Perth',
  'New Zealand', 'Auckland', 'Mexico', 'Mexican', 'Toronto', 'Vancouver', 'Montreal', 'Quebec', 'Alberta',
  'Calgary', 'British Columbia', 'France', 'French', 'Paris', 'Spain', 'Spanish', 'Madrid', 'Barcelona',
  'Portugal', 'Portuguese', 'Lisbon', 'Netherlands', 'Dutch', 'Holland', 'Amsterdam', 'Belgium', 'Belgian',
  'Brussels', 'Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Vienna', 'Zurich', 'Geneva', 'Milan', 'Rome',
  'Poland', 'Polish', 'Warsaw', 'Czech Republic', 'Czechia', 'Prague', 'Sweden', 'Swedish', 'Stockholm',
  'Norway', 'Norwegian', 'Oslo', 'Denmark', 'Danish', 'Copenhagen', 'Finland', 'Finnish', 'Helsinki',
  'Scandinavia', 'Scandinavian', 'Nordic', 'Nordics', 'Greece', 'Greek', 'Athens', 'Turkey', 'Turkish',
  'Istanbul', 'Romania', 'Romanian', 'Bulgaria', 'Bulgarian', 'Hungary', 'Hungarian', 'Croatia', 'Serbia',
  'Russia', 'Russian', 'Moscow', 'Lviv', 'Kharkiv', 'Odesa', 'Odessa', 'Dnipro',
  'UAE', 'United Arab Emirates', 'Emirati', 'Dubai', 'Abu Dhabi', 'Saudi Arabia', 'Saudi', 'Riyadh', 'Qatar',
  'Doha', 'Kuwait', 'Bahrain', 'Oman', 'Middle East', 'GCC', 'MENA', 'Israel', 'Israeli', 'Tel Aviv',
  'Egypt', 'Egyptian', 'Cairo', 'Morocco', 'Nigeria', 'Nigerian', 'Kenya', 'South Africa', 'South African',
  'Africa', 'African', 'India', 'Indian', 'Mumbai', 'Delhi', 'Bangalore', 'Pakistan', 'Pakistani',
  'Bangladesh', 'Singapore', 'Malaysia', 'Malaysian', 'Indonesia', 'Indonesian', 'Philippines', 'Filipino',
  'Thailand', 'Vietnam', 'Vietnamese', 'China', 'Chinese', 'Hong Kong', 'Shanghai', 'Beijing', 'Taiwan',
  'Japan', 'Japanese', 'Tokyo', 'Seoul', 'Asia', 'Asian', 'APAC', 'Latin America', 'LATAM', 'Brazil',
  'Brazilian', 'Argentina', 'Chile', 'Colombia', 'Peru',
  'Texas', 'New York', 'NYC', 'Chicago', 'Los Angeles', 'San Diego', 'San Francisco', 'Bay Area',
  'Silicon Valley', 'Houston', 'Dallas', 'Seattle', 'Denver', 'Boston', 'Atlanta', 'Las Vegas', 'Midwest',
  'East Coast', 'West Coast', 'Arizona', 'Nevada', 'Oregon', 'Washington', 'Colorado', 'Utah', 'Georgia',
  'North Carolina', 'South Carolina', 'Virginia', 'West Virginia', 'Pennsylvania', 'Ohio', 'Michigan',
  'Illinois', 'Indiana', 'Wisconsin', 'Minnesota', 'Iowa', 'Missouri', 'Tennessee', 'Kentucky', 'Alabama',
  'Mississippi', 'Louisiana', 'Arkansas', 'Oklahoma', 'Kansas', 'Nebraska', 'Montana', 'Idaho', 'Wyoming',
  'Alaska', 'Hawaii', 'Maryland', 'Massachusetts', 'Connecticut', 'New Mexico', 'New Hampshire', 'Vermont',
  'Maine', 'Delaware', 'Rhode Island', 'North Dakota', 'South Dakota',
]
const _escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const _GEO_GROUP_OF = (() => {
  const m = new Map()
  for (const [g, terms] of Object.entries(_GEO_GROUPS)) for (const t of terms) m.set(t, g)
  for (const t of _GEO_OTHER) if (!m.has(t)) m.set(t, t.toLowerCase())
  return m
})()
// Longest first, so "North American" wins over "American" and "Germany" over "German".
const _GEO_RE = new RegExp(
  `(?<![A-Za-z0-9.-])(?:${[..._GEO_GROUP_OF.keys()].sort((a, b) => b.length - a.length).map(_escRe).join('|')})(?![A-Za-z0-9])`,
  'g')

// How each case is named in real letters (checked against the sent-letter
// corpus, 2026-09-24). Case-sensitive where the name is also an ordinary word:
// "smash your targets", "your house painting business", "your vape shop".
const _CASE_NAME_RES = {
  'skin-reboot': /\bskin\s*reboot\b/gi,
  'derma-solution': /\bderma\s*solutions?\b/gi,
  'golden-state-trailers': /\bgolden\s+state\s+trailers\b/gi,
  'nectar-flowers': /\bnectar\s*flowers\b/gi,
  'fridgefix': /\bfridge\s*fix\b/gi,
  'house-painting': /\bHouse\s+[Pp]ainting\b/g,
  'multilingual-site': /\bMultilingual\s+(?:Construction(?:\s+(?:Website|Site))?|Website|Site)\b/g,
  'oxytec': /\boxytec\b/gi,
  'luxury-parfums': /\bluxury\s+parfums\b/gi,
  'chronocash': /\bchrono\s*cash\b/gi,
  'atlant': /\bAtlant\b/g,
  'vape-shop': /\bVape\s+[Ss]hop\b/g,
  'smash': /\bSMASH\b/g,
  'game-x': /\bgame-?x\b/gi,
  'gkit': /\bgkit\b/gi,
  'casa-eleganza': /\bcasa\s+eleganza\b/gi,
}

// Sentence boundary: . ! ? followed by whitespace, except after a common
// abbreviation or a dotted initialism ("U.S.", "e.g."). Decimals never split,
// because the character after "693." is a digit, not whitespace.
const _ABBREV_TAIL_RE = /(?:\b[A-Z]\.[A-Z]|\be\.g|\bi\.e|\bvs|\betc|\bapprox|\bInc|\bLtd|\bCo|\bSt|\bNo|\bMr|\bMs|\bDr)$/
function _sentenceBounds(para, pos) {
  let start = 0, end = para.length
  const re = /[.!?]+(?=\s)|\n/g
  let m
  while ((m = re.exec(para))) {
    if (m[0] !== '\n' && _ABBREV_TAIL_RE.test(para.slice(Math.max(0, m.index - 8), m.index))) continue
    const after = m.index + m[0].length
    if (after <= pos) start = after
    else { end = m[0] === '\n' ? m.index : after; break }
  }
  return [start, end]
}

// One window per case mention: the rest of the paragraph when the paragraph
// opens with the case (a case entry), otherwise the sentence naming it —
// always cut at the next case mention so one case's facts are never read as
// another's.
function _caseWindows(text) {
  const out = []
  for (const para of String(text).split(/\n\s*\n/)) {
    const hits = []
    for (const c of CASE_LEDGER) {
      const re = _CASE_NAME_RES[c.id] || new RegExp(`\\b${_escRe(c.name)}\\b`, 'gi')
      re.lastIndex = 0
      let m
      while ((m = re.exec(para))) hits.push({ c, start: m.index, end: m.index + m[0].length })
    }
    hits.sort((a, b) => a.start - b.start)
    hits.forEach((h, i) => {
      const nextStart = i + 1 < hits.length ? hits[i + 1].start : para.length
      const opensPara = /^[\s\-•*·–—]*$/.test(para.slice(0, h.start))
      let from, to
      if (opensPara) { from = h.start; to = nextStart }
      else {
        const [s, e] = _sentenceBounds(para, h.start)
        from = i > 0 ? Math.max(s, hits[i - 1].end) : s
        to = Math.min(e, nextStart)
      }
      out.push({ c: h.c, text: para.slice(from, to), nameStart: h.start - from, nameEnd: h.end - from })
    })
  }
  return out
}

// A place or period inside a clause that talks about the CLIENT ("the same
// seasonal spikes you'd see in London", "on your account within 60 days") is
// the bridge to their situation, not a claim about the case.
const _CLAUSE_BREAK_RE = /[,;:()]|\s[-–—]\s/g
const _SECOND_PERSON_RE = /\b(?:you|your|yours|you're|you'd|you've|you'll)\b/i
function _isClientClause(win, pos) {
  let clauseStart = 0
  _CLAUSE_BREAK_RE.lastIndex = 0
  let m
  while ((m = _CLAUSE_BREAK_RE.exec(win)) && m.index < pos) clauseStart = m.index + m[0].length
  return _SECOND_PERSON_RE.test(win.slice(clauseStart, pos))
}

const _excerpt = (s, a, b) => {
  const from = Math.max(0, a - 50), to = Math.min(s.length, b + 50)
  return `${from > 0 ? '…' : ''}${s.slice(from, to).replace(/\s+/g, ' ').trim()}${to < s.length ? '…' : ''}`
}

// ── timeframe extraction ──
const _MONTH_SRC = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const _MONTH_NUM = (s) => ({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 })[s.toLowerCase().slice(0, 3)]
const _YEAR_SRC = '(?:19|20)\\d{2}'
const _MONTH_RANGE_RE = new RegExp(`\\b(${_MONTH_SRC})\\.?(?:\\s+(${_YEAR_SRC}))?\\s*(?:-|–|—|to|through|until)\\s*(${_MONTH_SRC})\\.?(?:\\s+(${_YEAR_SRC}))?\\b`, 'gi')
const _MONTH_YEAR_RE = new RegExp(`\\b(${_MONTH_SRC})\\.?\\s+(${_YEAR_SRC})\\b`, 'gi')
const _QUARTER_RE = new RegExp(`\\bQ([1-4])\\s*(${_YEAR_SRC})\\b`, 'g')
const _YEAR_RE = new RegExp(`(?<![\\d,.$€£])(${_YEAR_SRC})(?![\\d%])`, 'g')
const _NUM_WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, thirty: 30, sixty: 60, ninety: 90 }
const _VAGUE = /^(?:a\s+couple\s+of|a\s+few|several|half\s+a)$/i
const _NUM_SRC = `\\d+(?:\\.\\d+)?|a\\s+couple\\s+of|a\\s+few|half\\s+a|several|${Object.keys(_NUM_WORD).sort((a, b) => b.length - a.length).join('|')}`
const _DURATION_RE = new RegExp(`(?<![\\w.$€£])(${_NUM_SRC})(?:\\s*(?:-|–|to)\\s*(${_NUM_SRC}))?(?:\\s+|-)(days?|weeks?|months?|years?|quarters?)(?![a-z])`, 'gi')
const _UNIT_DAYS = { day: 1, week: 7, month: 30.44, quarter: 91.31, year: 365.25 }
// "a month" / "several weeks" only count after a time preposition — "$600 a
// month" and "8 calls a day" are rates, not timeframes.
const _TIME_PREP_TAIL_RE = /\b(?:in|within|over|after|across|for|inside|during|under|than|about|around|roughly|nearly|almost|only|just|first|past|last|next|of|the)\s+$/i
const _numVal = (s) => {
  const k = String(s).toLowerCase().replace(/\s+/g, ' ')
  if (/^\d/.test(k)) return parseFloat(k)
  return _NUM_WORD[k] ?? null
}
export function parseDurationDays(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*(day|week|month|quarter|year)s?$/i)
  return m ? parseFloat(m[1]) * _UNIT_DAYS[m[2].toLowerCase()] : null
}

function _timeHits(win) {
  const hits = []
  const taken = []
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x)
  const take = (a, b, hit) => { taken.push([a, b]); hits.push({ ...hit, start: a, end: b, text: win.slice(a, b) }) }
  let m
  _MONTH_RANGE_RE.lastIndex = 0
  while ((m = _MONTH_RANGE_RE.exec(win))) {
    take(m.index, m.index + m[0].length, { kind: 'mrange', m1: _MONTH_NUM(m[1]), y1: m[2] ? +m[2] : null, m2: _MONTH_NUM(m[3]), y2: m[4] ? +m[4] : null })
  }
  _MONTH_YEAR_RE.lastIndex = 0
  while ((m = _MONTH_YEAR_RE.exec(win))) {
    if (free(m.index, m.index + m[0].length)) take(m.index, m.index + m[0].length, { kind: 'my', m: _MONTH_NUM(m[1]), y: +m[2] })
  }
  _QUARTER_RE.lastIndex = 0
  while ((m = _QUARTER_RE.exec(win))) {
    if (free(m.index, m.index + m[0].length)) take(m.index, m.index + m[0].length, { kind: 'q', q: +m[1], y: +m[2] })
  }
  _YEAR_RE.lastIndex = 0
  while ((m = _YEAR_RE.exec(win))) {
    if (!free(m.index, m.index + m[0].length)) continue
    if (/\bpartner\s*$/i.test(win.slice(Math.max(0, m.index - 12), m.index))) continue  // "Google Premier Partner 2026"
    take(m.index, m.index + m[0].length, { kind: 'y', y: +m[1] })
  }
  _DURATION_RE.lastIndex = 0
  while ((m = _DURATION_RE.exec(win))) {
    const a = m.index, b = m.index + m[0].length
    if (!free(a, b)) continue
    const unit = m[3].toLowerCase().replace(/s$/, '')
    const tail = win.slice(b, b + 14)
    if (/^\s*(?:a|per)\s+(?:day|week|month|year)\b/i.test(tail)) continue   // "7 days a week"
    const lo = _numVal(m[1]), hi = m[2] ? _numVal(m[2]) : lo
    const wordy = !/^\d/.test(m[1])
    if (wordy && (_VAGUE.test(m[1]) || /^an?$/i.test(m[1])) && !_TIME_PREP_TAIL_RE.test(win.slice(Math.max(0, a - 16), a))) continue
    if (unit === 'year' && lo >= 10 && lo <= 15) continue   // Artem's own "12 years", never a case period
    if (_VAGUE.test(m[1])) { take(a, b, { kind: 'dur', vague: true }); continue }
    if (lo == null) continue
    take(a, b, { kind: 'dur', lo: lo * _UNIT_DAYS[unit], hi: (hi ?? lo) * _UNIT_DAYS[unit] })
  }
  return hits
}

const _monthIdx = (y, mo) => y * 12 + (mo - 1)
function _caseRanges(c) {
  return (c.periods || []).filter(p => p.from).map(p => {
    const [fy, fm] = p.from.split('-').map(Number)
    const [ty, tm] = String(p.to || p.from).split('-').map(Number)
    return { lo: _monthIdx(fy, fm), hi: _monthIdx(ty, tm) }
  })
}
function _caseDurations(c) {
  const out = []
  for (const p of c.periods || []) {
    if (p.duration) { const d = parseDurationDays(p.duration); if (d) out.push(d) }
  }
  for (const r of _caseRanges(c)) out.push((r.hi - r.lo + 1) * _UNIT_DAYS.month)
  return out
}
function _timeAllowed(c, hit) {
  const ranges = _caseRanges(c)
  const durs = _caseDurations(c)
  const years = c.years || []
  const monthSpans = (c.periods || []).filter(p => Array.isArray(p.months)).map(p => p.months)
  // A yearless month span on record ("Sep–Oct YoY") allows exactly that span.
  if (hit.kind === 'mrange' && !hit.y1 && !hit.y2 && monthSpans.some(([a, b]) => hit.m1 >= a && hit.m2 <= b)) return true
  if (!ranges.length && !durs.length && !years.length) return false
  const inRange = (i) => ranges.some(r => i >= r.lo && i <= r.hi)
  switch (hit.kind) {
    case 'dur':
      if (hit.vague) return ranges.length + durs.length > 0
      // ±20%: "over a year" / "12 months" stand for Sep 2024 – Oct 2025 (14
      // months); "6 months" does not.
      return durs.some(D => hit.hi >= D * 0.8 && hit.lo <= D * 1.2)
    case 'y':
      return years.includes(hit.y) || ranges.some(r => hit.y >= Math.floor(r.lo / 12) && hit.y <= Math.floor(r.hi / 12))
    case 'my':
      return inRange(_monthIdx(hit.y, hit.m))
    case 'q': {
      const lo = _monthIdx(hit.y, hit.q * 3 - 2)
      return ranges.some(r => lo <= r.hi && lo + 2 >= r.lo)
    }
    case 'mrange': {
      if (hit.y1 || hit.y2) {
        const y1 = hit.y1 || hit.y2, y2 = hit.y2 || hit.y1
        return inRange(_monthIdx(y1, hit.m1)) && inRange(_monthIdx(y2, hit.m2))
      }
      return ranges.some(r => {
        for (let y = Math.floor(r.lo / 12); y <= Math.floor(r.hi / 12); y++) {
          const a = _monthIdx(y, hit.m1), b = _monthIdx(hit.m2 >= hit.m1 ? y : y + 1, hit.m2)
          if (a >= r.lo && b <= r.hi) return true
        }
        return false
      })
    }
    default: return false
  }
}

// Every place or period stated about a named case that its record does not
// support. Pure; returns [] conflicts for a letter built from canonical lines.
export function findCaseFactConflicts(text) {
  const geo = [], time = []
  if (!text || typeof text !== 'string') return { geo, time }
  const seen = new Set()
  for (const w of _caseWindows(text)) {
    const c = w.c
    _GEO_RE.lastIndex = 0
    let m
    while ((m = _GEO_RE.exec(w.text))) {
      const a = m.index, b = a + m[0].length
      if (a < w.nameEnd && b > w.nameStart) continue
      if ((c.geo || []).includes(_GEO_GROUP_OF.get(m[0]))) continue
      if (_isClientClause(w.text, a)) continue
      const key = `g|${c.id}|${m[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      geo.push({ case: c.id, name: c.name, term: m[0], on_record: c.location || 'none on record', excerpt: _excerpt(w.text, a, b) })
    }
    for (const h of _timeHits(w.text)) {
      if (_timeAllowed(c, h)) continue
      if (_isClientClause(w.text, h.start)) continue
      const key = `t|${c.id}|${h.text.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      time.push({ case: c.id, name: c.name, phrase: h.text, on_record: c.period_label || 'none on record', excerpt: _excerpt(w.text, h.start, h.end) })
    }
  }
  return { geo, time }
}

// ── What the letter says is attached ──────────────────────────────────────────
// Upwork attachments are added by hand on the proposal form — nothing in the
// extension uploads files — so a letter that says "I'm attaching a sample …" or
// "(attached as PDF)" is only true if Artem attaches it. This lists what the
// text promises, for the reminder under the cover letter. Profile-highlights
// cases are already on the profile and are not listed.
export function listClaimedAttachments(text) {
  const t = String(text || '')
  const items = []
  const add = (label) => { if (!items.includes(label)) items.push(label) }
  for (const s of t.split(/(?<=[.!?])\s+|\n+/)) {
    if (!/\battach/i.test(s) || !/\bsamples?\b/i.test(s)) continue
    const ppc = /\b(?:google\s+ads|ppc|adwords|paid\s+search)\s+audits?\b/i.test(s)
    const seo = /\b(?:technical\s+seo|seo|technical|site)\s+audits?\b/i.test(s)
    const plan = /\b(?:seo\s+)?promotion\s+plan\b|\bseo\s+plan\b/i.test(s)
    if (ppc) add('Google Ads audit sample')
    if (seo) add('Technical SEO audit sample')
    if (plan) add('SEO promotion plan sample')
    if (!ppc && !seo && !plan && /\baudits?\b/i.test(s)) add('Audit sample (type not named in the letter)')
  }
  for (const c of CASE_LEDGER) {
    if (c.attachment !== 'pdf') continue
    const re = new RegExp(`${_escRe(c.name)}[^\\n]{0,40}?\\(\\s*(?:case\\s+study\\s+)?attached\\s+as\\s+a?\\s*pdf\\s*\\)`, 'i')
    if (re.test(t)) add(`${c.name} case study (PDF)`)
  }
  return items
}
