import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import * as XLSX from 'xlsx'

// ════════════════════════════════════════════════════════════════════════════
//  RULE ROUTING (DESIGN.md §16 — hallucination mitigation, Phase 2)
//
//  Every KB rule carries scope tags in its `tags` field as `scope:<name>`.
//  Vocabulary: always | ppc | seo | audit | launch | regulated | agency | analyser.
//  We classify the job once into a Set of active scopes, then inject ONLY the
//  rules whose scope intersects the job (plus always-on) — instead of dumping
//  all ~27 rules into every call. This kills the attention-dilution that caused
//  cross-domain violations (audit offered on a launch job, PPC case on an SEO
//  job, etc.). Borderline rules were tagged `always` so routing never DROPS a
//  rule that should have fired.
// ════════════════════════════════════════════════════════════════════════════

// Parse the `scope:<name>` entries out of a rule's tags → array of scope names.
// Untagged rules (no scope: entry) return [] and are treated as always-on for
// the generator (safe default — never silently dropped).
function parseRuleScopes(rule) {
  const tags = (rule && rule.tags) || ''
  return tags.split(',')
    .map(t => t.trim())
    .filter(t => t.startsWith('scope:'))
    .map(t => t.slice('scope:'.length))
}

// Classify a job's free text into the Set of active scopes. Keyword-based;
// generous on purpose (a job can be several scopes at once, e.g. ppc+launch+regulated).
function jobScopes(text) {
  const t = (text || '').toLowerCase()
  const scopes = new Set()
  const has = (re) => re.test(t)

  if (has(/\b(google\s+ads?|adwords|ppc|paid\s+search|paid\s+media|paid\s+advertising|performance\s+max|pmax|shopping\s+ads?|search\s+ads?|display\s+ads?|smart\s+bidding|meta\s+ads?|facebook\s+ads?|instagram\s+ads?|bing\s+ads?|microsoft\s+ads?|\bsem\b|\bcpc\b|\bcpa\b|\broas\b|ad\s+spend|merchant\s+center|google\s+merchant)\b/i)) {
    scopes.add('ppc')
  }
  if (has(/\b(seo|organic\s+(?:search|traffic)|rankings?|serp|backlinks?|link\s+building|technical\s+seo|keyword\s+research|on-?page|content\s+strategy|schema(?:\s+markup)?|\baeo\b|\bgeo\b|ai\s+overview|search\s+visibility|local\s+seo|map\s+pack|google\s+business\s+profile)\b/i)) {
    scopes.add('seo')
  }
  // AUDIT = there is an EXISTING account/site to audit (optimise/fix/review
  // running campaigns). NOT a from-scratch launch.
  if (has(/\b(audit|optimi[sz]e\s+(?:our|my|the\s+existing)|fix\s+(?:our|my)|review\s+(?:my|our)\s+(?:account|campaigns?|ads?)|wasted\s+(?:ad\s+)?spend|not\s+converting|underperform|existing\s+(?:account|campaigns?)|our\s+(?:current\s+)?campaigns?|already\s+running|clean\s+up\s+(?:our|my))\b/i)) {
    scopes.add('audit')
  }
  // LAUNCH = building from scratch / zero pixel data.
  if (has(/\b(from\s+scratch|zero[-\s]?pixel|from\s+\$?0\b|from\s+zero|\$0\s+to\s+scale|zero\s+(?:pixel\s+)?data|build\s+(?:and|&)\s+launch|launch\s+(?:and|&|,)?\s*scale|no\s+existing\s+(?:account|campaigns?|ad\s+account)|starting\s+from\s+(?:zero|scratch)|brand[-\s]?new\s+(?:ad\s+)?account|launch\s+(?:exclusively\s+)?(?:via|on|with)\s+google\s+ads)\b/i)) {
    scopes.add('launch')
  }
  // REGULATED / restricted YMYL vertical. Widened (DESIGN.md §16 gap) to catch
  // peptides / bio-hacking / aesthetics / skincare that the old rule-437 set missed.
  if (has(/\b(hemp|cbd|cannabis|marijuana|\bthc\b|vape|vaping|e-?cig(?:arette)?|nicotine|kratom|psilocybin|mushroom|supplement|nutraceutical|peptides?|sarms?|bio[-\s]?hacking|med[-\s]?spa|medspa|aesthetics?|cosmetic|skincare|skin\s+care|dermatology|derma|botox|filler|ymyl|salmon\s+dna|ghk-?cu|micro-?infusion|clinical\s+skincare|telehealth|supplements?|weight\s+loss|testosterone|hormone)\b/i)) {
    scopes.add('regulated')
  }
  if (has(/\b(agency|white[-\s]?label|reseller|we\s+are\s+a\s+(?:marketing|digital|web|advertising|seo|ppc|creative)\s+agency|on\s+behalf\s+of\s+(?:our|their)\s+clients?|for\s+our\s+clients?)\b/i)) {
    scopes.add('agency')
  }
  // WEBDEV = ecommerce/CMS platform work: Shopify, WordPress/WooCommerce, OpenCart.
  // NOT custom software engineering (those are stopped by feed stop_words or scored low).
  if (has(/\b(shopify|woocommerce|opencart|magento|bigcommerce|prestashop|wordpress\s+(?:developer|development|website|site|theme|plugin|design)|ecommerce\s+(?:website|store|site|development|platform|design)|online\s+store\s+(?:development|build|setup|creation)|website\s+(?:development|redesign|developer|builder|creation)|web\s+(?:developer|development|design)|build\s+(?:a|an|our|my|the)\s+(?:website|online\s+store|ecommerce\s+site|shop|store)|cms\s+(?:website|development)|theme\s+(?:development|customization)|plugin\s+development|landing\s+page\s+(?:developer|development))\b/i)) {
    scopes.add('webdev')
  }
  return scopes
}

// Filter rules for the GENERATOR: include always-on, untagged (safe default),
// and any rule whose scope intersects the job's active scopes. EXCLUDE rules
// that are analyser-only (every scope === 'analyser').
function rulesForGenerator(allRules, activeScopes) {
  return allRules.filter(r => {
    const scopes = parseRuleScopes(r)
    if (scopes.length === 0) return true                       // untagged → safe include
    if (scopes.every(s => s === 'analyser')) return false      // analyser-only → drop
    if (scopes.includes('always')) return true
    return scopes.some(s => activeScopes.has(s))
  })
}

// Filter rules for the ANALYSER: only rules explicitly scoped 'analyser'.
// The 23 cover-letter generation rules are pure noise when scoring a job.
function rulesForAnalyser(allRules) {
  return allRules.filter(r => parseRuleScopes(r).includes('analyser'))
}

// Extract the first non-Upwork, non-social URL from a job description.
// Returns the cleaned URL string or null.
const _URL_SKIP_RE = /\b(upwork\.com|instagram|facebook|linkedin|twitter|youtube|google\.com|google\.co|mailto:|bit\.ly|loom\.com|drive\.google|docs\.google|zoom\.us|imgur|dropbox|t\.co|ow\.ly)\b/i
function extractWebsiteUrl(text) {
  if (!text) return null
  const re = /https?:\/\/[^\s<>"'()\[\]{},;]+/gi
  const matches = text.match(re) || []
  return matches
    .map(u => u.replace(/[.,;:!?)]+$/, ''))
    .find(u => !_URL_SKIP_RE.test(u)) || null
}

// ── Application-checklist extraction ────────────────────────────────────────
// Detects an explicit "To Apply / Send: / Please include:" gate in a job posting
// and extracts the individual items the proposal MUST address. Returns null when
// no checklist is found, otherwise { items: [{text, factual}], promptBlock }.
//
// Why deterministic (not left to the model): ignoring an application checklist is
// an automatic reject on Upwork, and a rich dropped attachment can pull the model
// off the brief entirely. Extracting the items in code guarantees they reach the
// prompt as a non-negotiable block the POSTING owns.
//
// FACTUAL items (team size, retainer/budget, turnaround time, "N sites you
// manage", years in business, location) require Artem's real data — the prompt
// will instruct the model to answer from KB facts or leave a [[ ARTEM: … ]]
// placeholder, never to fabricate.
const _CHECKLIST_TRIGGER_RE = /^(?:\s*)(?:to\s+apply|how\s+to\s+apply|to\s+be\s+considered|when\s+(?:you\s+)?appl(?:y|ying)|in\s+your\s+(?:proposal|application|cover\s+letter)\s*,?\s*(?:please\s+)?(?:include|tell|share|send)|please\s+(?:include|send|provide|share|answer)|kindly\s+(?:include|send|provide)|send(?:\s+(?:me|us))?|provide|include|share|application\s+requirements?|requirements?\s+to\s+apply|must\s+include)\b[:\s]*$/im
// End-of-line variant: a trigger phrase immediately before a line-ending colon.
// The trailing ":" is a strong "list follows" signal, so we can allow preceding
// prose on the same line ("Looking for X. Please include in your proposal:")
// without the false positives a bare "include" mid-sentence would cause.
const _CHECKLIST_TRIGGER_EOL_RE = /(?:to\s+apply|to\s+be\s+considered|please\s+(?:include|send|provide|answer|share)|in\s+your\s+(?:proposal|application|cover\s+letter)|include\s+the\s+following|answer\s+the\s+following|must\s+include|application\s+requirements?)\b[^.\n]{0,40}:\s*$/i
// Inline form: "To apply, send: a, b, c" (items on the same line after a colon)
const _CHECKLIST_INLINE_RE = /\b(?:to\s+apply|to\s+be\s+considered|please\s+(?:include|send|provide)|in\s+your\s+(?:proposal|application))\b[^.\n:]{0,40}:\s*([^\n]{8,400})/i
// Item is FACTUAL (needs Artem's real data, not invented prose)
const _FACTUAL_ITEM_RE = /\b(team\s+size|how\s+many\s+(?:people|staff|employees)|retainer|budget|rate|pricing|price\s+range|cost|fee|turnaround|turn[-\s]?around\s+time|how\s+(?:long|fast)|delivery\s+time|years?\s+(?:of\s+)?(?:experience|in\s+business)|how\s+long\s+have\s+you|\d+\s*[-–]\s*\d+\s+(?:sites?|websites?|clients?|projects?)|sites?\s+you\s+manage|websites?\s+you\s+(?:manage|run|maintain)|examples?\s+of|portfolio|links?\s+to|location|time\s?zone|availability|hours?\s+(?:per|\/)\s*week|start\s+date)\b/i

function extractApplicationChecklist(text) {
  if (!text || text.length < 20) return null
  const lines = text.split(/\r?\n/)
  let items = []

  // Strategy 1 — a trigger line ("To Apply", "Send:", "Please include:") followed
  // by a list (bulleted, dashed, numbered, or plain short lines).
  for (let i = 0; i < lines.length; i++) {
    const tl = lines[i].trim()
    if (!_CHECKLIST_TRIGGER_RE.test(tl) && !_CHECKLIST_TRIGGER_EOL_RE.test(tl)) continue
    const collected = []
    for (let j = i + 1; j < lines.length && collected.length < 12; j++) {
      const raw = lines[j].trim()
      if (!raw) { if (collected.length) break; else continue }
      // Stop if we hit another section header (a line ending in ':' with no list marker)
      // A nested sub-header ("To Apply" then "Send:") — skip it, don't collect.
      if (_CHECKLIST_TRIGGER_RE.test(raw) || /:$/.test(raw)) continue
      const isListItem = /^(?:[-*•·▪◦‣–—]|\d+[.)]|[a-z][.)])\s+/i.test(raw)
      const stripped = raw.replace(/^(?:[-*•·▪◦‣–—]|\d+[.)]|[a-z][.)])\s+/i, '').trim()
      if (!isListItem) {
        // Allow a couple of short plain lines (some clients don't use bullets),
        // but bail on long prose paragraphs — those aren't checklist items.
        if (collected.length === 0 && raw.length > 0 && raw.length <= 120 && !/[.!?]$/.test(raw)) {
          collected.push(stripped); continue
        }
        break
      }
      if (stripped.length >= 2) collected.push(stripped)
    }
    if (collected.length) { items = collected; break }
  }

  // Strategy 2 — inline "to apply, send: a, b and c" on one line.
  if (!items.length) {
    const m = text.match(_CHECKLIST_INLINE_RE)
    if (m && m[1]) {
      items = m[1]
        .split(/\s*(?:,|;|\band\b|•|\/)\s*/i)
        .map(s => s.replace(/^(?:a|your|the)\s+/i, '').trim())
        .filter(s => s.length >= 3)
    }
  }

  if (!items.length || items.length > 12) return null

  const classified = items.map(text => ({ text, factual: _FACTUAL_ITEM_RE.test(text) }))
  const hasFactual = classified.some(c => c.factual)

  const promptBlock =
    `⛔ MANDATORY APPLICATION CHECKLIST (the client put this in the posting — this OVERRIDES any attached file's topic; the POSTING defines what to answer):\n` +
    `The proposal will be AUTO-REJECTED if it does not address EVERY item below. This list is FOR YOUR REFERENCE — cover every point, but do NOT reproduce this list or its wording in the letter (see the ANSWER IN YOUR OWN VOICE rule below):\n` +
    classified.map((c, i) => `  ${i + 1}. ${c.text}${c.factual ? '   ← FACTUAL: answer from ARTEM\'S BUSINESS FACTS below if it covers this; otherwise a clear placeholder like [[ ARTEM: fill in ]] — never invent an unknown number, price, URL, or claim.' : ''}`).join('\n') +
    `\n\nANSWER IN YOUR OWN VOICE — NEVER ECHO THE QUESTIONS (mandatory, highest-priority on wording): Do NOT paste or restate the client's question text as a heading before answering it. Copying their exact wording — e.g. "1. Your experience with local service business campaigns (with a quick example or result)" then an answer — is the #1 tell of a mechanical AI form-fill and it reads terribly. Instead: answer the points in Artem's own words, woven into natural, flowing prose the way a person actually writes. If a light structure genuinely helps readability, use a SHORT self-authored label of 2–4 words in Artem's voice ("Local results:", "First thing I'd check:", "Rate & availability:") — NEVER the client's full question echoed back. The client can see their own questions; repeating them wastes space and signals a template. Prefer flowing paragraphs over any numbered list; a numbered list is acceptable ONLY when the client explicitly numbered the questions AND you keep the labels to a few of your own words.` +
    (hasFactual
      ? `\n\nFACTUAL ITEMS RULE (critical): for team size, portfolio/site URLs, landing-page turnaround, and monthly retainer, use the values in "ARTEM'S BUSINESS FACTS" below. For anything factual NOT covered there (e.g. a specific client name, an exact metric you don't have), do NOT fabricate — emit a visible [[ ARTEM: … ]] placeholder so he fills it before sending.`
      : ``) +
    `\n\nNO BODY↔ANSWERS DUPLICATION (mandatory structure): do NOT cover the same point twice — once in a body section and again where you address the checklist. Pick one home for each piece of content. The right shape: a SHORT hook (the client's core problem + the credentials + ONE sharp differentiating insight), then address their points once, in your own words. Do NOT write full body sections ("here's my approach…", "here's how I'd build the pages…") that you then repeat almost verbatim when answering the questions — that doubles the length and reads as padding.` +
    `\n\nTIMELINE/DURATION QUESTIONS (mandatory): if any checklist item asks "how long", "rough timeline", "turnaround", "ETA", "when can you complete/start", or similar, the answer MUST contain a CONCRETE time estimate (e.g. "3–5 business days", "about a week", "2–3 days once I have access"). Describing the deliverable or the steps is NOT an answer to a timeline question — give an actual duration. (This is the one case where stating a timeline in the letter is REQUIRED, overriding the usual omit-timeline rule.)`

  return { items: classified, promptBlock, hasFactual }
}

// ── Artem's standing business facts ─────────────────────────────────────────
// REAL data used to answer application checklists and client proof / portfolio /
// pricing requests, so the generator fills these instead of leaving
// [[ ARTEM: … ]] placeholders. Source: owner instruction (2026-06-24). This JS
// copy is operative; a KB "reference" entry mirrors it for documentation.
const ARTEM_PORTFOLIO = {
  shopify: ['https://casaeleganza.com', 'https://paramusmegafurniture.com'],
  wordpress: ['https://tothebeauty.com', 'https://www.envieq.com', 'https://www.redwallmural.com'],
}
// Fires the facts block when a posting/question asks for proof, portfolio, team
// size, turnaround, or pricing.
const _PROOF_REQUEST_RE = /\b(portfolio|examples?\b|case\s+stud|\bproof\b|sites?\s+you(?:'?ve)?\s*(?:manage|run|built|worked|maintain)|websites?\s+you|links?\s+to|show\s+(?:us|me)|references?|team\s+size|how\s+many\s+(?:people|staff)|retainer|turn[-\s]?around|monthly\s+(?:budget|fee|rate|retainer))\b/i

function buildArtemFactsBlock(contextText) {
  const t = (contextText || '').toLowerCase()
  const wantsShopify = /\bshopify\b/.test(t)
  const wantsWp = /\bword\s?press\b|\bwp\b|\bwoo\s?commerce\b|\belementor\b/.test(t)
  let portfolioLines
  if (wantsShopify && !wantsWp) {
    portfolioLines = `Shopify sites we manage: ${ARTEM_PORTFOLIO.shopify.join(', ')}`
  } else if (wantsWp && !wantsShopify) {
    portfolioLines = `WordPress sites we manage: ${ARTEM_PORTFOLIO.wordpress.join(', ')}`
  } else {
    portfolioLines =
      `WordPress sites we manage: ${ARTEM_PORTFOLIO.wordpress.join(', ')}\n` +
      `    Shopify sites we manage: ${ARTEM_PORTFOLIO.shopify.join(', ')}\n` +
      `    (Share the set that matches the client's platform — a WordPress job → the WordPress links, a Shopify job → the Shopify links. Don't paste both unless both are relevant.)`
  }
  return [
    `ARTEM'S BUSINESS FACTS — use these REAL values when the client asks for proof / examples / portfolio, team size, turnaround, or pricing. These OVERRIDE the [[ ARTEM: … ]] placeholder rule for the items below (real values exist — use them):`,
    ``,
    `• PORTFOLIO — share ONLY when the client asks for examples / proof / portfolio / "sites you manage". Never paste links unprompted.`,
    `    ${portfolioLines}`,
    ``,
    `• TEAM SIZE: 20 people. ⚠️ State this ONLY when the client EXPLICITLY asks about team size, company size, or headcount. NEVER volunteer it otherwise — most letters should not mention team size at all.`,
    ``,
    `• LANDING-PAGE TURNAROUND and MONTHLY RETAINER: not fixed — give a specific, credible figure that fits THIS job's scope, positioned as a skilled non-US freelancer (fast delivery, strong value vs US agencies). Sensible anchors: a single landing page in ~2–4 business days; an ongoing retainer roughly $800–$2,500/mo depending on the number of sites and the workload described. Give a real number/range when asked — never a placeholder for these two.`,
  ].join('\n')
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatRate(min, max) {
  if (!min && !max) return 'Rate not specified'
  if (min === max || !max) return `$${min}/hr`
  return `$${min}–$${max}/hr`
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// Returns ISO 3166-1 alpha-2 code for a country name, or null if unknown.
// Used to render flag images via flagcdn.com (emoji flags don't render on Windows).
function getCountryCode(country) {
  if (!country) return null
  const codes = {
    'Afghanistan': 'af', 'Albania': 'al', 'Algeria': 'dz', 'Argentina': 'ar',
    'Armenia': 'am', 'Australia': 'au', 'Austria': 'at', 'Azerbaijan': 'az',
    'Bahrain': 'bh', 'Bangladesh': 'bd', 'Belarus': 'by', 'Belgium': 'be',
    'Bolivia': 'bo', 'Bosnia and Herzegovina': 'ba', 'Brazil': 'br',
    'Bulgaria': 'bg', 'Cambodia': 'kh', 'Canada': 'ca', 'Chile': 'cl',
    'China': 'cn', 'Colombia': 'co', 'Costa Rica': 'cr', 'Croatia': 'hr',
    'Cyprus': 'cy', 'Czech Republic': 'cz', 'Czechia': 'cz', 'Denmark': 'dk',
    'Dominican Republic': 'do', 'Ecuador': 'ec', 'Egypt': 'eg',
    'El Salvador': 'sv', 'Estonia': 'ee', 'Ethiopia': 'et', 'Finland': 'fi',
    'France': 'fr', 'Georgia': 'ge', 'Germany': 'de', 'Ghana': 'gh',
    'Greece': 'gr', 'Guatemala': 'gt', 'Honduras': 'hn', 'Hong Kong': 'hk',
    'Hungary': 'hu', 'India': 'in', 'Indonesia': 'id', 'Iran': 'ir',
    'Iraq': 'iq', 'Ireland': 'ie', 'Israel': 'il', 'Italy': 'it',
    'Jamaica': 'jm', 'Japan': 'jp', 'Jordan': 'jo', 'Kazakhstan': 'kz',
    'Kenya': 'ke', 'Kuwait': 'kw', 'Latvia': 'lv', 'Lebanon': 'lb',
    'Lithuania': 'lt', 'Luxembourg': 'lu', 'Malaysia': 'my', 'Mexico': 'mx',
    'Moldova': 'md', 'Morocco': 'ma', 'Myanmar': 'mm', 'Nepal': 'np',
    'Netherlands': 'nl', 'New Zealand': 'nz', 'Nicaragua': 'ni',
    'Nigeria': 'ng', 'North Macedonia': 'mk', 'Norway': 'no', 'Oman': 'om',
    'Pakistan': 'pk', 'Panama': 'pa', 'Paraguay': 'py', 'Peru': 'pe',
    'Philippines': 'ph', 'Poland': 'pl', 'Portugal': 'pt', 'Qatar': 'qa',
    'Romania': 'ro', 'Russia': 'ru', 'Saudi Arabia': 'sa', 'Serbia': 'rs',
    'Singapore': 'sg', 'Slovakia': 'sk', 'Slovenia': 'si', 'South Africa': 'za',
    'South Korea': 'kr', 'Korea': 'kr', 'Spain': 'es', 'Sri Lanka': 'lk',
    'Sweden': 'se', 'Switzerland': 'ch', 'Taiwan': 'tw', 'Tanzania': 'tz',
    'Thailand': 'th', 'Tunisia': 'tn', 'Turkey': 'tr', 'Türkiye': 'tr',
    'Uganda': 'ug', 'Ukraine': 'ua', 'United Arab Emirates': 'ae', 'UAE': 'ae',
    'United Kingdom': 'gb', 'UK': 'gb', 'United States': 'us', 'USA': 'us',
    'Uruguay': 'uy', 'Uzbekistan': 'uz', 'Venezuela': 've', 'Vietnam': 'vn',
    'Zimbabwe': 'zw',
  }
  if (codes[country]) return codes[country]
  // Upwork's API returns ISO 3166-1 alpha-3 codes (GBR, AUS, DEU, SWE, ARE, NLD, CAN…)
  // that the name map above doesn't cover — map alpha-3 → alpha-2 so their flags render.
  const alpha3 = {
    AFG:'af',ALB:'al',DZA:'dz',ARG:'ar',ARM:'am',AUS:'au',AUT:'at',AZE:'az',BHR:'bh',BGD:'bd',
    BLR:'by',BEL:'be',BOL:'bo',BIH:'ba',BRA:'br',BGR:'bg',KHM:'kh',CAN:'ca',CHL:'cl',CHN:'cn',
    COL:'co',CRI:'cr',HRV:'hr',CYP:'cy',CZE:'cz',DNK:'dk',DOM:'do',ECU:'ec',EGY:'eg',SLV:'sv',
    EST:'ee',ETH:'et',FIN:'fi',FRA:'fr',GEO:'ge',DEU:'de',GHA:'gh',GRC:'gr',GTM:'gt',HND:'hn',
    HKG:'hk',HUN:'hu',IND:'in',IDN:'id',IRN:'ir',IRQ:'iq',IRL:'ie',ISR:'il',ITA:'it',JAM:'jm',
    JPN:'jp',JOR:'jo',KAZ:'kz',KEN:'ke',KWT:'kw',LVA:'lv',LBN:'lb',LTU:'lt',LUX:'lu',MYS:'my',
    MEX:'mx',MDA:'md',MAR:'ma',MMR:'mm',NPL:'np',NLD:'nl',NZL:'nz',NIC:'ni',NGA:'ng',MKD:'mk',
    NOR:'no',OMN:'om',PAK:'pk',PAN:'pa',PRY:'py',PER:'pe',PHL:'ph',POL:'pl',PRT:'pt',QAT:'qa',
    ROU:'ro',RUS:'ru',SAU:'sa',SRB:'rs',SGP:'sg',SVK:'sk',SVN:'si',ZAF:'za',KOR:'kr',ESP:'es',
    LKA:'lk',SWE:'se',CHE:'ch',TWN:'tw',TZA:'tz',THA:'th',TUN:'tn',TUR:'tr',UGA:'ug',UKR:'ua',
    ARE:'ae',GBR:'gb',USA:'us',URY:'uy',UZB:'uz',VEN:'ve',VNM:'vn',ZWE:'zw',
  }
  return alpha3[String(country).trim().toUpperCase()] || null
}

function CountryFlag({ country, style = {} }) {
  const code = getCountryCode(country)
  if (!code) return <span style={style}>🌐</span>
  return (
    <img
      src={`https://flagcdn.com/16x12/${code}.png`}
      srcSet={`https://flagcdn.com/32x24/${code}.png 2x`}
      width="16" height="12"
      alt={country}
      style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: 1, flexShrink: 0, ...style }}
    />
  )
}

// ── Description formatter ──────────────────────────────────────────────────
const SECTION_KEYWORDS = [
  'Summary', 'Overview', 'Job Overview', 'About the Role', 'About the Job',
  'Responsibilities', 'What You\'ll Do', 'What You Will Do', 'What You\'ll Own',
  'Requirements', 'What We Need', 'What We\'re Looking For', 'Must Have', 'Must-Have',
  'Nice to Have', 'Bonus', 'Preferred', 'Skills', 'Skills and Expertise',
  'Qualifications', 'Experience', 'About Us', 'About the Company',
  'Who We Are', 'The Role', 'The Job', 'Deliverables', 'Scope of Work',
  'To Apply', 'How to Apply', 'Next Steps', 'Note', 'Important',
]

function formatDescription(text) {
  if (!text) return null
  const lines = []
  let current = ''

  const rawLines = text.split(/\n/)
  for (const raw of rawLines) {
    const line = raw.trim()
    if (!line) {
      if (current) { lines.push({ type: 'text', content: current.trim() }); current = '' }
      continue
    }
    // Separator lines
    if (/^[-—=*]{3,}$/.test(line)) {
      if (current) { lines.push({ type: 'text', content: current.trim() }); current = '' }
      continue
    }
    // Bullet items
    if (/^[-*•→]\s+/.test(line)) {
      if (current) { lines.push({ type: 'text', content: current.trim() }); current = '' }
      lines.push({ type: 'bullet', content: line.replace(/^[-*•→]\s+/, '') })
      continue
    }
    // Numbered items
    if (/^\d+\.\s+/.test(line) && line.length < 120) {
      if (current) { lines.push({ type: 'text', content: current.trim() }); current = '' }
      lines.push({ type: 'bullet', content: line.replace(/^\d+\.\s+/, '') })
      continue
    }
    // Section headings — keyword match or ALL CAPS short line
    const isKeyword = SECTION_KEYWORDS.some(k => line.toLowerCase().startsWith(k.toLowerCase()) && line.length < k.length + 30)
    const isAllCaps = line === line.toUpperCase() && line.length < 60 && /[A-Z]/.test(line)
    if (isKeyword || isAllCaps) {
      if (current) { lines.push({ type: 'text', content: current.trim() }); current = '' }
      lines.push({ type: 'heading', content: line.replace(/:$/, '') })
      continue
    }
    // Continuation — join with previous text
    current += (current ? ' ' : '') + line
  }
  if (current) lines.push({ type: 'text', content: current.trim() })
  return lines
}

// ── Build the best available Upwork URL for a job ─────────────────────────
// Three URL forms, picked by intent:
//
//   default (view / "Open on Upwork")  →  /jobs/~ID
//     Upwork's canonical job URL. This is what their own emails, search
//     results, and feed link to. For logged-in sessions it shows the
//     authenticated job-detail page; for logged-out, it shows the public
//     marketing version (better than a hard login wall).
//
//   { forApply: true }  →  /nx/proposals/job/~ID/apply
//     The proposal-apply form. Hard auth-required; takes you straight to
//     the bid + cover letter input. Use only when the user explicitly wants
//     to apply (the Apply on Upwork button).
//
//   { forEnrichment: true }  →  /nx/s/job-details-viewer/jobs/~ID
//     The viewer URL, kept because the Chrome extension's content.js only
//     fires on URLs matching this pattern (see upwork-enricher/manifest.json).
//     Used when opening a background tab specifically for enrichment scrape.
// Open a URL on Upwork in a new foreground tab.
//
// When the extension bridge is loaded (bridgeReady === true), routes through
// `cockpit:open-tab` → bridge.js → background.js → `chrome.tabs.create()`.
// That's a first-party navigation from Chrome's POV, which generally
// includes the user's Upwork session cookie even from a localhost:5180
// origin (vs. plain `window.open`, which can lose the cookie to SameSite/
// CHIPS cross-site restrictions and bounce to Upwork's login wall).
//
// Falls back to `window.open` when the bridge isn't there.
function openInUpworkTab(url, bridgeReady) {
  if (!url) return
  if (bridgeReady) {
    window.dispatchEvent(new CustomEvent('cockpit:open-tab', { detail: { url } }))
  } else {
    window.open(url, '_blank')
  }
}

// ── Sniper target icon used inside the "Apply on Upwork" button ──────────
// Idle: black. Hover (via CSS): red with drop-shadow glow and a 45° rotate
// so the crosshair sits on the diagonal — feels more like a scope reticle.
function TargetIcon() {
  return (
    <svg
      className="target-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <line x1="12" y1="1.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22.5" y2="12" />
    </svg>
  )
}

// ── Click animation: the target icon ITSELF explodes — explosion + spark
// burst centred on the target icon inside the Apply button. Vanilla DOM
// nodes appended to <body> with CSS animations (no React re-render churn),
// auto-removed on animationend. ~420ms total.
//
// `originEl` is the button element. We measure the position of the SVG
// .target-icon inside it so the boom lands exactly on the reticle.
function fireApplyAnimation(originEl) {
  if (typeof window === 'undefined' || !originEl) return
  // Respect reduced-motion preference — skip everything if set.
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  } catch {}

  // Prefer the target icon's centre; fall back to the button centre.
  const iconEl = originEl.querySelector && originEl.querySelector('.target-icon')
  const rect = (iconEl || originEl).getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  // Explosion at the target
  const boom = document.createElement('div')
  boom.className = 'falcon-explosion'
  boom.style.left = cx + 'px'
  boom.style.top  = cy + 'px'
  boom.addEventListener('animationend', () => boom.remove(), { once: true })
  document.body.appendChild(boom)

  // 8 sparks radiating from the same point
  for (let i = 0; i < 8; i++) {
    const spark = document.createElement('div')
    spark.className = 'falcon-spark'
    spark.style.left = cx + 'px'
    spark.style.top  = cy + 'px'
    spark.style.setProperty('--angle', (i * 45) + 'deg')
    spark.addEventListener('animationend', () => spark.remove(), { once: true })
    document.body.appendChild(spark)
  }
}

// ── Logo flash on click ────────────────────────────────────────────────────
// Find the <img> inside the button and re-trigger the .falcon-logo-flash
// CSS animation. Forces a reflow between remove and add so the animation
// plays even on rapid repeat clicks.
function flashLogo(buttonEl) {
  if (typeof window === 'undefined' || !buttonEl) return
  const img = buttonEl.querySelector && buttonEl.querySelector('img')
  if (!img) return
  img.classList.remove('falcon-logo-flash')
  // eslint-disable-next-line no-unused-expressions
  void img.offsetWidth  // force reflow so animation restarts
  img.classList.add('falcon-logo-flash')
  img.addEventListener('animationend', () => img.classList.remove('falcon-logo-flash'), { once: true })
}

// ── LogoCanvas: green Falcon Scout logo with a highlighter-style glow ──────
// No background tile — just the logo on the button's native background.
// The "highlighter" outline is built by stacking multiple drop-shadows in
// the filter chain. drop-shadow respects the PNG's alpha, so the glow
// hugs the logo's exact shape (unlike box-shadow which would be a rectangle).
// Used across Enrich / Analyse / Generate.
function LogoCanvas({ alt = '', spinning = false }) {
  return (
    <img
      src="/falcon-scout-mark5.png"
      alt={alt}
      style={{
        height: 34, width: 'auto', display: 'inline-block', verticalAlign: 'middle',
        marginRight: 9, marginTop: -10, marginBottom: -10,
        animation: spinning ? 'spin 1.2s linear infinite' : undefined,
        // Green tint + stacked drop-shadows for a "highlighter outline" that
        // traces the logo's silhouette. Each successive drop-shadow widens
        // and softens the glow so the logo reads cleanly on light or dark
        // button backgrounds.
        filter: [
          'brightness(0) invert(1)',                                    // white base
          'sepia(1) saturate(8) hue-rotate(90deg) brightness(1.05)',    // green tint
          'drop-shadow(0 0 1px rgba(0,208,112,0.95))',                  // tight inner outline
          'drop-shadow(0 0 4px rgba(0,208,112,0.7))',                   // mid glow
          'drop-shadow(0 0 10px rgba(0,208,112,0.45))',                 // soft outer halo
        ].join(' '),
      }}
    />
  )
}

// ── SpinningLogo: centered rotating green logo for loading states ──────────
// Used as the in-progress indicator across Analyse / Generate / Enrich (any
// button except Apply). Same green tint + glow as LogoCanvas, rotating.
function SpinningLogo({ size = 40 }) {
  return (
    <img
      src="/falcon-scout-mark5.png"
      alt=""
      style={{
        height: size, width: 'auto', display: 'block',
        animation: 'spin 1.2s linear infinite',
        filter: [
          'brightness(0) invert(1)',
          'sepia(1) saturate(8) hue-rotate(90deg) brightness(1.05)',
          'drop-shadow(0 0 1px rgba(0,208,112,0.95))',
          'drop-shadow(0 0 5px rgba(0,208,112,0.7))',
          'drop-shadow(0 0 11px rgba(0,208,112,0.45))',
        ].join(' '),
      }}
    />
  )
}

// ── Logo splash animation ──────────────────────────────────────────────────
// The logo itself stays put — pixel particles radiate outward from BEHIND
// the logo (lower z-index), visible only past the logo's edges. Combined
// with the existing flashLogo() scale pulse this produces a satisfying
// "punch + spark" effect on click.
function fireLogoSplash(buttonEl) {
  if (typeof window === 'undefined' || !buttonEl) return
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  } catch {}
  const img = buttonEl.querySelector && buttonEl.querySelector('img')
  if (!img) return

  const rect = img.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // Logo's outer radius — particles must finish their flight INSIDE this
  // boundary so the splash stays contained within the logo's visual area.
  const logoRadius = Math.min(rect.width, rect.height) / 2
  // Particle start radius — well inside the logo so they're hidden behind
  // it initially and "spray" outward toward the edges.
  const startRadius = logoRadius * 0.25

  // Falcon Scout sparks palette — white/yellow/orange hot tones
  const colors = ['#ffffff', '#fde047', '#fbbf24', '#f97316', '#fdba74']

  // Raise the logo above the splash particles
  img.classList.add('falcon-logo-splashing')
  let lastEl = null

  // 36 particles in radial pattern — denser burst for the "splash + explode"
  // feel. Even angular spacing + small jitter.
  const COUNT = 36
  for (let i = 0; i < COUNT; i++) {
    const baseAng = (i / COUNT) * Math.PI * 2
    const ang = baseAng + (Math.random() - 0.5) * 0.35   // ±10° jitter
    const startX = cx + Math.cos(ang) * startRadius - 2.5  // -2.5 centers the 5px pixel
    const startY = cy + Math.sin(ang) * startRadius - 2.5
    // Cap flight so final position stays within the logo's outer radius.
    // Available room = logoRadius - startRadius. Use 50–95% of that for
    // organic variation; particles end at the logo edge, never past it.
    const maxFlight = logoRadius - startRadius
    const flightDist = maxFlight * (0.5 + Math.random() * 0.45)
    const dx = Math.cos(ang) * flightDist
    const dy = Math.sin(ang) * flightDist

    const px = document.createElement('div')
    px.className = 'falcon-logo-splash-px'
    px.style.left = startX + 'px'
    px.style.top  = startY + 'px'
    px.style.background = colors[i % colors.length]
    px.style.setProperty('--dx', dx + 'px')
    px.style.setProperty('--dy', dy + 'px')
    px.style.animationDelay = (Math.random() * 30) + 'ms'
    px.addEventListener('animationend', () => px.remove(), { once: true })
    document.body.appendChild(px)
    lastEl = px
  }

  const restore = () => img.classList.remove('falcon-logo-splashing')
  if (lastEl) lastEl.addEventListener('animationend', restore, { once: true })
  setTimeout(restore, 650)
}

// ── Button-shatter animation ───────────────────────────────────────────────
// Pixel shrapnel erupts from BEHIND the button — the button stays visible
// in place, layered above the pixels (z-index 5 vs 1) so only the pixels
// that travel past the button's edges become visible. The initial pixel
// positions cover the button's surface, so before they move they're
// completely hidden; as their flight vectors carry them outward, they
// emerge from beneath each edge like sparks escaping a contained burst.
//
// Process:
//   1. Capture the button's bounding rect
//   2. Add .falcon-button-erupting to raise its z-index above the pixels
//   3. Spawn 128 pixels on a 16×8 grid covering the rect, each with a flight
//      vector pointing away from button center (with jitter for organic feel)
//   4. On the last pixel's animationend, remove the erupting class
function fireButtonShatter(buttonEl) {
  if (typeof window === 'undefined' || !buttonEl) return
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  } catch {}

  const rect = buttonEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  // Falcon Scout palette — orange/yellow/red + white highlights for sparks
  const colors = ['#f97316', '#fbbf24', '#dc2626', '#ffffff', '#fdba74', '#ea580c']

  // Raise the button above the pixel shrapnel for the duration of the burst.
  buttonEl.classList.add('falcon-button-erupting')
  const restore = () => buttonEl.classList.remove('falcon-button-erupting')

  // Grid: 16 cols × 8 rows = 128 pixels, scaled to fit button.
  // Dense enough that the button visibly "becomes" particles instead of
  // looking like a sparse spray.
  const cols = 16
  const rows = 8
  const stepX = rect.width / cols
  const stepY = rect.height / rows
  const pixelSize = 4
  let lastPixel = null

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = rect.left + c * stepX + stepX / 2 - pixelSize / 2
      const py = rect.top  + r * stepY + stepY / 2 - pixelSize / 2

      // Flight vector: from button center, outward. Add jitter so pixels
      // don't all fly in a perfectly symmetric pattern.
      const ang = Math.atan2(py + pixelSize / 2 - cy, px + pixelSize / 2 - cx)
      const dist = 60 + Math.random() * 60   // 60–120px
      const angJitter = (Math.random() - 0.5) * 0.6  // ±0.3 rad
      const dx = Math.cos(ang + angJitter) * dist
      const dy = Math.sin(ang + angJitter) * dist - 8  // slight upward bias

      const pixel = document.createElement('div')
      pixel.className = 'falcon-button-pixel'
      pixel.style.left = px + 'px'
      pixel.style.top  = py + 'px'
      pixel.style.background = colors[(r * cols + c) % colors.length]
      pixel.style.setProperty('--dx', dx + 'px')
      pixel.style.setProperty('--dy', dy + 'px')
      // Stagger animation start very slightly for organic feel
      pixel.style.animationDelay = (Math.random() * 40) + 'ms'
      pixel.addEventListener('animationend', () => pixel.remove(), { once: true })
      document.body.appendChild(pixel)
      lastPixel = pixel
    }
  }

  // Restore the button after the longest pixel finishes — use the last
  // pixel's animationend as the trigger, with a safety timeout fallback.
  if (lastPixel) {
    lastPixel.addEventListener('animationend', restore, { once: true })
  }
  setTimeout(restore, 700)  // safety: animation is 520ms + up to 40ms delay
}

function getUpworkUrl(job, options = {}) {
  let id = null
  if (job.upwork_job_id) id = job.upwork_job_id.replace(/^~/, '')
  if (!id && job.url) {
    const m = job.url.match(/~([0-9a-zA-Z]{10,})/)
    if (m) id = m[1]
  }
  if (!id && job.raw_message) {
    const m = job.raw_message.match(/~([0-9a-zA-Z]{10,})/)
    if (m) id = m[1]
  }
  if (id) {
    if (options.forEnrichment) {
      return `https://www.upwork.com/nx/s/job-details-viewer/jobs/~${id}`
    }
    if (options.forApply) {
      return `https://www.upwork.com/nx/proposals/job/~${id}/apply`
    }
    return `https://www.upwork.com/jobs/~${id}`
  }

  // No ID anywhere → fall back to whatever URL we have, then a keyword search
  if (job.url) return job.url
  if (job.raw_message) {
    const m = job.raw_message.match(/https?:\/\/www\.upwork\.com\/[^\s\)"]+/)
    if (m) return m[0]
  }
  return `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(job.title || '')}&sort=recency`
}

// ── Enrichment field row ───────────────────────────────────────────────────
function EnrichRow({ label, value, good, bad }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: 600,
        color: good ? '#00c8d4' : bad ? '#ef4444' : 'var(--text)',
      }}>{value}</span>
    </div>
  )
}

// ── Stars ──────────────────────────────────────────────────────────────────
function Stars({ score, count }) {
  if (!score) return null
  const full = Math.floor(score)
  const half = score - full >= 0.5
  return (
    <span style={{ fontSize: 12, color: 'var(--text2)' }}>
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))} {score} ({count} review{count !== 1 ? 's' : ''})
    </span>
  )
}

export default function JobDetail({ job }) {
  const [enriching, setEnriching] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState('')
  const [enrichDebug, setEnrichDebug] = useState(null)  // last enrichment result or error
  const [enrichDebugOpen, setEnrichDebugOpen] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(false)
  const [updatingBids, setUpdatingBids] = useState(false)
  const [bidsMsg, setBidsMsg] = useState('')
  // Snapshot of job.boost_bids_captured_at taken when "Update bids" is clicked.
  // Lets us confirm success by observing the timestamp advance (via the App-level
  // rapid-poll re-fetch) even if the extension's BIDS_UPDATED notification never
  // arrives — e.g. an older/unreloaded worker, or MV3 killing the worker mid-scrape.
  const bidsCapturedAtRef = useRef(null)
  const leftColRef = useRef(null)
  const wrapperRef = useRef(null)

  // Restore previously-saved column widths on first mount of JobDetail. Runs
  // once per dashboard session; subsequent job switches keep the same widths.
  useLayoutEffect(() => {
    _restoreColumnWidths(wrapperRef.current)
  }, [])

  // Re-check column widths on viewport resize. If the saved widths no longer
  // fit, _restoreColumnWidths clears them and the layout reverts to plain
  // flex distribution — prevents the leftmost column's content from being
  // clipped by overflow:hidden on the wrapper.
  useEffect(() => {
    const onResize = () => _restoreColumnWidths(wrapperRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Bridge handshake: listen for 'cockpit:bridge:ready' from bridge.js
  // and ping on mount in case bridge.js loaded before this component
  useEffect(() => {
    const onReady = () => setBridgeReady(true)
    window.addEventListener('cockpit:bridge:ready', onReady)
    // Ping immediately and again after a short delay (in case extension is slow)
    window.dispatchEvent(new CustomEvent('cockpit:bridge:ping'))
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent('cockpit:bridge:ping')), 500)
    return () => {
      window.removeEventListener('cockpit:bridge:ready', onReady)
      clearTimeout(t)
    }
  }, [])

  // Scroll to top before paint so the user never sees a scrolled-down state
  useLayoutEffect(() => {
    if (leftColRef.current) leftColRef.current.scrollTop = 0
  }, [job.id])

  // Listen for extension signals
  useEffect(() => {
    const onComplete = (e) => {
      setEnriching(false)
      setEnrichMsg('')
      const d = e.detail || {}
      setEnrichDebug({
        ok: true,
        jobId:     d.jobId,
        title:     d.title,
        proposals: d.proposals,
        hire_rate: d.hire_rate,
        avg_rate:  d.avg_rate,
        ts:        d.enrichedAt || new Date().toISOString(),
      })
    }
    const onError = (e) => {
      setEnriching(false)
      const msg = e.detail?.error || 'Unknown error'
      setEnrichMsg('✗ ' + msg)
      setEnrichDebug({ ok: false, error: msg, ts: new Date().toISOString() })
    }
    window.addEventListener('cockpit:enrich:complete', onComplete)
    window.addEventListener('cockpit:enrich:error', onError)
    return () => {
      window.removeEventListener('cockpit:enrich:complete', onComplete)
      window.removeEventListener('cockpit:enrich:error', onError)
    }
  }, [])

  // "Update bids" completion / error — refresh the boost-competition data only.
  useEffect(() => {
    const onBidsDone = (e) => {
      setUpdatingBids(false)
      const n = e.detail?.count
      setBidsMsg(typeof n === 'number' ? (n > 0 ? `✓ bids updated (${n})` : '✓ no active bids yet') : '✓ bids updated')
    }
    const onBidsErr = (e) => {
      setUpdatingBids(false)
      setBidsMsg('✗ ' + (e.detail?.error || 'update failed'))
    }
    window.addEventListener('cockpit:bids:complete', onBidsDone)
    window.addEventListener('cockpit:bids:error', onBidsErr)
    return () => {
      window.removeEventListener('cockpit:bids:complete', onBidsDone)
      window.removeEventListener('cockpit:bids:error', onBidsErr)
    }
  }, [])

  // Self-verifying completion: the App-level rapid-poll re-fetches this job every
  // ~1.5 s after the button is clicked, so job.boost_bids_captured_at advances the
  // moment the extension POSTs fresh bids. Treat that advance as success — this is
  // the robust path that does NOT depend on the extension's BIDS_UPDATED message
  // reaching the page (which can be dropped by an old build or a dead MV3 worker).
  useEffect(() => {
    if (!updatingBids) return
    const cur = job.boost_bids_captured_at || null
    const prev = bidsCapturedAtRef.current
    if (cur && cur !== prev) {
      setUpdatingBids(false)
      const n = Array.isArray(job.boost_bids) ? job.boost_bids.length : null
      setBidsMsg(typeof n === 'number' && n > 0 ? `✓ bids updated (${n})` : '✓ bids updated')
    }
  }, [job.boost_bids_captured_at, job.boost_bids, updatingBids])

  useEffect(() => {
    if (!bidsMsg) return
    const t = setTimeout(() => setBidsMsg(''), 4000)
    return () => clearTimeout(t)
  }, [bidsMsg])

  // JobDetail is not remounted when the selected job changes (no React key), so
  // clear any in-flight "Update bids" state when we switch jobs — otherwise a
  // pending update on job A could resolve against job B's data.
  useEffect(() => {
    setUpdatingBids(false)
    setBidsMsg('')
    bidsCapturedAtRef.current = null
  }, [job.id])

  // Clear the status message after 3 s
  useEffect(() => {
    if (!enrichMsg) return
    const t = setTimeout(() => setEnrichMsg(''), 3000)
    return () => clearTimeout(t)
  }, [enrichMsg])

  const handleEnrich = (event) => {
    if (!bridgeReady) {
      setEnrichMsg('✗ Extension not connected — reload this tab (F5)')
      return
    }
    // Logo splash + explode: the logo itself stays put, sparks radiate from
    // behind it AND it scale-pulses dramatically. The button frame doesn't
    // change at all during the animation.
    try { if (event && event.currentTarget) { flashLogo(event.currentTarget); fireLogoSplash(event.currentTarget) } } catch {}
    // Enrichment requires the viewer URL — content.js in the extension only
    // fires on /nx/s/job-details-viewer/* (see manifest.json content_scripts).
    const url = getUpworkUrl(job, { forEnrichment: true })
    setEnrichMsg('')
    // Dispatch the enrich event immediately so the extension starts working,
    // but DEFER the visual "Enriching…" spinner state by ~480ms so the logo
    // animation (flashLogo 420ms + fireLogoSplash 480ms) plays to completion
    // before the logo is replaced by the spinner SVG.
    window.dispatchEvent(new CustomEvent('cockpit:enrich', { detail: { url } }))
    setTimeout(() => setEnriching(true), 480)
    // Safety timeout — reset if extension never responds
    setTimeout(() => {
      setEnriching(prev => { if (prev) setEnrichMsg('✗ No response from extension — reload the tab'); return false })
    }, 15000)
  }

  const handleUpdateBids = (event) => {
    if (!bridgeReady) {
      setBidsMsg('✗ Extension not connected — reload this tab (F5)')
      return
    }
    const rawId = (job.upwork_job_id || '').replace(/^~/, '')
    if (!rawId) {
      setBidsMsg('✗ No Upwork job id — enrich first')
      return
    }
    try { if (event && event.currentTarget) { flashLogo(event.currentTarget) } } catch {}
    setBidsMsg('')
    // Snapshot the current capture time so the self-verifying effect can tell
    // when fresh bids actually land (see the effect above).
    bidsCapturedAtRef.current = job.boost_bids_captured_at || null
    window.dispatchEvent(new CustomEvent('cockpit:update-bids', { detail: { job_id: rawId } }))
    setUpdatingBids(true)
    // Safety timeout — the apply page load + scrape can take ~15-20s. If we get
    // here still "updating", neither fresh bids nor a BIDS_UPDATED signal arrived:
    // usually the extension needs a reload (chrome://extensions → reload), or the
    // apply page had no bids (job closed / already applied).
    setTimeout(() => {
      setUpdatingBids(prev => { if (prev) setBidsMsg('✗ No new bids — reload the extension, or the apply page had none'); return false })
    }, 30000)
  }

  const hasEnrichment = job.enriched_at || job.connects_required || job.proposals || job.hire_rate

  // Parse client reviews if available
  let reviews = []
  try { if (job.client_reviews) reviews = JSON.parse(job.client_reviews) } catch {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0, width: '100%' }}>

      {/* ── COLUMN WRAPPER (3 cols) ──────────────────────────────────────── */}
      <div ref={wrapperRef} style={{ display: 'flex', flex: 1, overflowY: 'hidden', overflowX: 'auto', minHeight: 0 }}>

        {/* ══ JOB DETAILS ══════════════════════════════════════════════════ */}
        <div ref={leftColRef} data-col-id="details" style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', minWidth: '15%', overflowAnchor: 'none' }}>

          {/* Job title */}
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.35, marginBottom: 12, fontFamily: 'var(--font-display)' }}>
            {job.title || 'Untitled'}
          </div>

          {/* Header badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {(() => {
              const top = job.hourly_rate_max || job.hourly_rate_min || 0
              const rs = top >= 50
                ? { background: 'rgba(0,180,200,0.16)', color: '#0891b2', border: '1px solid rgba(0,180,200,0.40)' }
                : top >= 30
                  ? { background: 'rgba(0,180,200,0.10)', color: '#0891b2', border: '1px solid rgba(0,180,200,0.28)' }
                  : { background: 'rgba(234,88,12,0.12)', color: '#c2410c', border: '1px solid rgba(234,88,12,0.35)' }
              return (
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, fontWeight: 700, ...rs }}>
                  {formatRate(job.hourly_rate_min, job.hourly_rate_max)}
                </span>
              )
            })()}
            {job.client_country && (
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CountryFlag country={job.client_country} />
                {job.client_country}
              </span>
            )}
            {job.avg_rate && (() => {
              // Parse numeric value from avg_rate (handles "20", "$20", "20.50", etc.)
              const numericRate = parseFloat(String(job.avg_rate).replace(/[^0-9.]/g, '')) || 0
              let badgeStyle
              if (numericRate > 45) {
                // Acidic / highlighter green, dark text
                badgeStyle = { background: '#d4ff3a', color: '#1a3300', border: '1px solid #b8e029' }
              } else if (numericRate >= 35) {
                // Bright green
                badgeStyle = { background: 'rgba(34,197,94,0.85)', color: '#052e16', border: '1px solid #16a34a' }
              } else if (numericRate >= 30) {
                // Mint
                badgeStyle = { background: 'rgba(110,231,183,0.6)', color: '#064e3b', border: '1px solid #34d399' }
              } else if (numericRate >= 25) {
                // Yellow
                badgeStyle = { background: 'rgba(251,191,36,0.55)', color: '#78350f', border: '1px solid #f59e0b' }
              } else {
                // Orange
                badgeStyle = { background: 'rgba(249,115,22,0.55)', color: '#7c2d12', border: '1px solid #ea580c' }
              }
              return (
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, fontWeight: 700, ...badgeStyle }}>
                  💵 Avg ${job.avg_rate}
                </span>
              )
            })()}
            {job.client_spend && (
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, background: 'rgba(59,130,246,0.13)', color: '#1e40af', border: '1px solid rgba(59,130,246,0.35)', fontWeight: 600 }}>
                💰 {job.client_spend}
              </span>
            )}
            {job.fixed_budget && (
              <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, background: 'rgba(139,92,246,0.13)', color: '#5b21b6', border: '1px solid rgba(139,92,246,0.35)', fontWeight: 600 }}>
                📦 Budget: {job.fixed_budget}
              </span>
            )}
            {job.captured_at && (
              <span title={new Date(job.captured_at).toLocaleString()} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border2)' }}>
                🕐 {timeAgo(job.captured_at.endsWith('Z') || job.captured_at.includes('+') ? job.captured_at : job.captured_at + 'Z')}
              </span>
            )}
            {(() => {
              const detectedUrl = extractWebsiteUrl(job.description_full || job.raw_message || '')
              if (!detectedUrl) return null
              const domain = detectedUrl.replace(/^https?:\/\//i, '').split('/')[0]
              return (
                <span
                  title={detectedUrl}
                  style={{ fontSize: 12, padding: '3px 10px', borderRadius: 4, fontWeight: 700,
                    background: 'rgba(234,179,8,0.15)', color: '#a16207',
                    border: '1px solid rgba(234,179,8,0.45)', cursor: 'default' }}
                >
                  🌐 {domain}
                </span>
              )
            })()}
          </div>

          {/* Meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 0, marginBottom: 20 }}>
            {[
              ['POSTED', job.posted_date],
              ['CAPTURED', fmtDate(job.captured_at)],
              ['CATEGORY', job.category],
              ['KEYWORDS', job.keywords],
            ].filter(([, v]) => v).map(([label, val]) => (
              <>
                <div key={label + 'l'} style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{label}</div>
                <div key={label + 'v'} style={{ fontSize: 11, color: 'var(--text2)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{val}</div>
              </>
            ))}
          </div>

          {/* Enrich button — opens job in background tab, extension auto-enriches */}
          {(() => {
            const jobUrl = getUpworkUrl(job)
            const hasDirectUrl = !jobUrl.includes('/search/')
            const isEnriched = !!job.enriched_at

            // Pick the right class — primary for unenriched (CTA), secondary for enriched (already done)
            const enrichClass = isEnriched ? 'btn-secondary' : 'btn-primary'

            return (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8, gap: 10, marginBottom: 24 }}>
                <button
                  onClick={handleEnrich}
                  disabled={enriching || !hasDirectUrl}
                  title={!hasDirectUrl ? 'No direct URL captured — use Open on Upwork instead' : isEnriched ? 'Click to re-enrich' : ''}
                  className={enrichClass}
                  style={{ flexShrink: 0, paddingTop: 5, paddingBottom: 5, fontSize: 12.5 }}
                >
                  {enriching
                    ? <><LogoCanvas spinning />Enriching…</>
                    : isEnriched
                      ? <><LogoCanvas alt="Enriched" />Enriched</>
                      : <><LogoCanvas />Enrich</>
                  }
                </button>
                {/* Update bids — refreshes ONLY the boost-competition data (opens
                    the apply page in a background tab). Bids change constantly, so
                    this is a lightweight refresh separate from full enrichment. */}
                <button
                  onClick={handleUpdateBids}
                  disabled={updatingBids || !hasDirectUrl}
                  title="Refresh the boost-bid competition data only (no full re-enrichment)"
                  className="btn-secondary"
                  style={{ flexShrink: 0, paddingTop: 5, paddingBottom: 5, fontSize: 12.5 }}
                >
                  {updatingBids ? <><LogoCanvas spinning />Updating bids…</> : <>⚡ Update bids</>}
                </button>
                {bidsMsg && (
                  <span style={{ fontSize: 11, color: bidsMsg.startsWith('✗') ? '#ef4444' : 'var(--text3)', flexShrink: 1, minWidth: 0 }}>
                    {bidsMsg}
                  </span>
                )}
                {enrichMsg && (
                  <span style={{ fontSize: 11, color: enrichMsg.startsWith('✗') ? '#ef4444' : 'var(--text3)', flexShrink: 1, minWidth: 0 }}>
                    {enrichMsg}
                  </span>
                )}
                {enrichDebug && (
                  <button
                    onClick={() => setEnrichDebugOpen(o => !o)}
                    title="Toggle last enrichment debug"
                    style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                      fontFamily: 'inherit', lineHeight: 1.5, flexShrink: 0,
                      background: enrichDebug.ok ? 'rgba(0,208,112,0.10)' : 'rgba(239,68,68,0.10)',
                      border: `1px solid ${enrichDebug.ok ? 'rgba(0,208,112,0.30)' : 'rgba(239,68,68,0.30)'}`,
                      color: enrichDebug.ok ? '#00d070' : '#ef4444',
                    }}
                  >{enrichDebug.ok ? '✓ debug' : '✗ debug'}</button>
                )}
                {/* "Open on Upwork" button — opens the canonical /jobs/~ID
                    URL (not the apply form) so logged-in users land on the
                    job-detail page, and logged-out users see the public
                    marketing version instead of a hard login wall. The
                    noopener/noreferrer flags are deliberately omitted: those
                    strip tab context that Upwork's session-continuity check
                    seems to rely on, which was causing re-auth prompts even
                    when valid cookies existed in a neighbor tab. */}
                <button
                  onClick={() => openInUpworkTab(jobUrl, bridgeReady)}
                  className="btn-ghost"
                  title={bridgeReady
                    ? 'Open this job on Upwork (routed via extension — preserves your session)'
                    : 'Open this job on Upwork (extension not connected — may require re-login)'}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
                  Open on Upwork
                </button>
              </div>
            )
          })()}

          {/* Enrichment debug panel — expands below action row when ✓/✗ debug button clicked */}
          {enrichDebug && enrichDebugOpen && (
            <div style={{
              background: 'var(--bg2)', border: `1px solid ${enrichDebug.ok ? 'rgba(0,208,112,0.25)' : 'rgba(239,68,68,0.25)'}`,
              borderRadius: 6, padding: '8px 12px', fontSize: 10,
              fontFamily: 'var(--font-mono, monospace)', color: 'var(--text2)', lineHeight: 1.7,
            }}>
              {enrichDebug.ok ? (
                <>
                  <div style={{ color: '#00d070', fontWeight: 700, marginBottom: 4 }}>
                    ✓ Enrichment successful — {enrichDebug.ts ? new Date(enrichDebug.ts).toLocaleTimeString() : ''}
                  </div>
                  <div>job_id: <b>{enrichDebug.jobId || '?'}</b></div>
                  {enrichDebug.title    && <div>title: {enrichDebug.title}</div>}
                  {enrichDebug.proposals && <div>proposals: {enrichDebug.proposals}</div>}
                  {enrichDebug.hire_rate != null && <div>hire_rate: {enrichDebug.hire_rate}%</div>}
                  {enrichDebug.avg_rate  != null && <div>avg_rate: ${enrichDebug.avg_rate}/hr</div>}
                  {!enrichDebug.proposals && !enrichDebug.hire_rate && (
                    <div style={{ color: '#f59e0b', marginTop: 4 }}>
                      ⚠ Backend returned OK but no enrichment fields — job may not be in DB yet (listener not running?) or the Upwork page didn't load fully before the extension scraped it.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>
                    ✗ Enrichment failed — {enrichDebug.ts ? new Date(enrichDebug.ts).toLocaleTimeString() : ''}
                  </div>
                  <div>{enrichDebug.error}</div>
                  <div style={{ color: '#f59e0b', marginTop: 4 }}>
                    Common causes: extension context invalidated (hard-refresh this tab: Ctrl+Shift+R) · backend not running (check port 8000) · job not yet in DB (open via Jobs feed first)
                  </div>
                </>
              )}
            </div>
          )}

          {/* Posting — single block. After enrichment, the full Upwork description
              replaces the (often truncated) Telegram bot message. Falls back to
              raw_message when the job hasn't been enriched yet. */}
          {(() => {
            const usingFull = !!job.description_full
            const body = job.description_full || job.raw_message
            if (!body) return null
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, color: usingFull ? '#00c8d4' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{usingFull ? '⚡ Posting (from Upwork)' : 'Message (from Telegram bot)'}</span>
                </div>
                <pre style={{
                  fontSize: 13, color: 'var(--text)',
                  background: usingFull ? 'rgba(0,200,212,0.04)' : 'var(--bg2)',
                  border: '1px solid ' + (usingFull ? 'rgba(0,200,212,0.20)' : 'var(--border)'),
                  borderRadius: 4, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  lineHeight: 1.7, margin: 0,
                }}>
                  {body}
                </pre>
              </div>
            )
          })()}

          {/* ── ENRICHMENT SECTION ─────────────────────────────────────── */}
          {hasEnrichment && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 10, color: '#00c8d4', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⚡ Enriched data</span>
                {job.enriched_at && <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {fmtDate(job.enriched_at)}</span>}
              </div>

              {/* Job details block */}
              {(job.experience_level || job.hours_per_week || job.duration || job.project_type || job.geo_restriction) && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>Job Details</div>
                  <EnrichRow label="Experience" value={job.experience_level} />
                  <EnrichRow label="Hrs / week" value={job.hours_per_week} />
                  <EnrichRow label="Duration" value={job.duration} />
                  <EnrichRow label="Project type" value={job.project_type} />
                  {job.geo_restriction && (
                    <EnrichRow
                      label="Location"
                      value={job.geo_restriction}
                      good={/worldwide/i.test(job.geo_restriction)}
                      bad={/us.only|united states only|north america only/i.test(job.geo_restriction)}
                    />
                  )}
                </div>
              )}

              {/* Preferred qualifications — Upwork's SOFT filter. Worth flagging
                  but NOT a hard disqualifier. The analyser also receives this and
                  is told to add a flag (not lower the score) when it doesn't match
                  Artem's profile. */}
              {job.preferred_qualifications && (
                <div style={{ marginBottom: 16, padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.30)', borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>⚠ Preferred qualifications</span>
                    <span style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>(soft filter — doesn't block applying)</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {job.preferred_qualifications}
                  </div>
                </div>
              )}

              {/* Activity block */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>Activity</div>
                <EnrichRow label="Applicants" value={job.proposals} />
                <EnrichRow label="Connects required" value={job.connects_required} />
                <EnrichRow label="Interviewing" value={job.interviewing} />
                <EnrichRow
                  label="Already hired"
                  value={job.client_already_hired != null ? job.client_already_hired : null}
                  bad={job.client_already_hired > 0}
                />
                <EnrichRow label="Invites sent" value={job.invites_sent} />
                <EnrichRow label="Unanswered invites" value={job.unanswered_invites} bad={job.unanswered_invites > 3} />
                <EnrichRow label="Last viewed" value={job.last_viewed} />
                {(job.bid_high || job.bid_average || job.bid_low) && (
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bids</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'flex', gap: 10 }}>
                        {job.bid_low  != null && <span style={{ color: '#00c8d4' }}>↓${job.bid_low}</span>}
                        {job.bid_average != null && <span>avg ${job.bid_average}</span>}
                        {job.bid_high != null && <span style={{ color: '#ef4444' }}>↑${job.bid_high}</span>}
                      </span>
                    </div>
                  </div>
                )}
                {job.boost_bids && job.boost_bids.length > 0 && (
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Boost competition
                      {job.boost_bids_captured_at && (
                        <span style={{ textTransform: 'none', fontWeight: 400, marginLeft: 6, opacity: 0.7 }}>
                          · {new Date(job.boost_bids_captured_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {job.boost_bids.map(b => (
                        <div key={b.rank} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: 'var(--text3)' }}>{b.rank === 1 ? '🥇' : b.rank === 2 ? '🥈' : b.rank === 3 ? '🥉' : `${b.rank}th`}</span>
                          <span style={{ fontWeight: 700, color: b.rank === 1 ? '#a855f7' : 'var(--text)' }}>{b.connects}c</span>
                          <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{b.age}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Client block */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>Client</div>
                {(job.client_rating_score || job.client_review_count) && (
                  <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <Stars score={job.client_rating_score} count={job.client_review_count} />
                  </div>
                )}
                <EnrichRow label="Hire rate" value={job.hire_rate != null ? `${job.hire_rate}%` : null} good={job.hire_rate > 50} bad={job.hire_rate < 20} />
                <EnrichRow label="Payment" value={job.payment_verified ? '✓ Verified' : job.payment_verified === false ? '✗ Not verified' : null} good={job.payment_verified} bad={job.payment_verified === false} />
                <EnrichRow label="Phone" value={job.phone_verified ? '✓ Verified' : null} good={job.phone_verified} />
                <EnrichRow label="Jobs posted" value={job.client_jobs_posted} />
                <EnrichRow label="Open jobs" value={job.client_jobs_open} />
                <EnrichRow label="Total spent" value={job.client_total_spent_detail} />
                <EnrichRow label="Hires" value={job.client_hires} />
                <EnrichRow label="Active" value={job.client_active} />
                <EnrichRow label="Avg hourly paid" value={job.client_avg_hourly_rate ? `$${job.client_avg_hourly_rate}/hr` : null} />
                <EnrichRow label="Hours billed" value={job.client_hours_billed} />
                <EnrichRow label="Member since" value={job.client_member_since} />
                <EnrichRow label="City" value={job.client_city} />
                <EnrichRow label="Company size" value={job.client_company_size} />
                <EnrichRow label="Industry" value={job.client_industry} />
              </div>

              {/* Screening questions */}
              {job.screening_questions && (() => {
                try {
                  const qs = JSON.parse(job.screening_questions)
                  return (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>Screening Questions</div>
                      {qs.map((q, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                          <span style={{ color: '#00c8d4', flexShrink: 0 }}>{i + 1}.</span>
                          <span>{q}</span>
                        </div>
                      ))}
                    </div>
                  )
                } catch { return null }
              })()}

              {/* Client history / reviews */}
              {reviews.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>Client History</div>
                  {reviews.map((r, i) => (
                    <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                      {r.feedback
                        ? <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 6 }}>{r.feedback}</div>
                        : <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 6 }}>Private job</div>
                      }
                      <div style={{ fontSize: 10, color: 'var(--text3)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        {r.rating != null && (
                          <span style={{ fontWeight: 700, color: r.rating >= 4.5 ? '#00d070' : r.rating >= 3.5 ? '#f59e0b' : '#ef4444' }}>
                            {r.rating}/5
                          </span>
                        )}
                        {r.date_from && <span>{r.date_from}{r.date_to ? ` – ${r.date_to}` : ''}</span>}
                        {r.rate && <span>${r.rate}/hr</span>}
                        {r.hours && <span>{r.hours} hrs</span>}
                        {r.billed && <span style={{ color: '#60a5fa' }}>{r.billed}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── DIVIDER 1 ── */}
        <Divider />

        {/* ══ AI ANALYSIS ══════════════════════════════════════════════════ */}
        <AIAnalysisColumn job={job} hasEnrichment={hasEnrichment} bridgeReady={bridgeReady} onEnrich={handleEnrich} />

        {/* ── DIVIDER 2 ── */}
        <Divider />

        {/* ══ PROPOSAL ═════════════════════════════════════════════════════ */}
        <ProposalColumn job={job} bridgeReady={bridgeReady} />
      </div>
    </div>
  )
}

// ── Rule conflict detection ────────────────────────────────────────────────
async function checkRuleConflict(newRuleText) {
  const res = await fetch('/kb?type=rule')
  if (!res.ok) return null
  const existing = await res.json()
  if (existing.length === 0) return null

  const checkRes = await fetch('/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      _kind: 'rule_check',
      // Mechanical JSON conflict-detect — Haiku is plenty (handoff §Haiku flip)
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: 'You detect contradictions between rules for an Upwork job-filtering assistant. A contradiction means two rules give opposite instructions for the same situation (e.g. "skip X" vs "always take X"). Respond ONLY with valid JSON, no markdown: {"conflict":true/false,"conflicting_index":null_or_number,"explanation":"one sentence"}',
      messages: [{ role: 'user', content: `New rule: "${newRuleText}"\n\nExisting rules:\n${existing.map((r, i) => `${i}. ${r.content}`).join('\n')}\n\nDoes the new rule directly contradict any existing rule?` }],
    }),
  })
  if (!checkRes.ok) return null
  const data = await checkRes.json()
  const text = (data.content || []).map(b => b.text || '').join('').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const result = JSON.parse(match[0])
    if (!result.conflict || result.conflicting_index == null) return null
    const rule = existing[result.conflicting_index]
    if (!rule) return null
    return { conflictingRule: rule, explanation: result.explanation || '' }
  } catch { return null }
}

// ── Rule conflict modal ────────────────────────────────────────────────────
function ConflictModal({ newRuleText, conflictingRule, explanation, onKeepNew, onKeepExisting, onSaveBoth, onClose }) {
  const [editNew, setEditNew] = useState(newRuleText)
  const [editExisting, setEditExisting] = useState(conflictingRule.content)
  const [mode, setMode] = useState('choose') // 'choose' | 'edit'
  const [saving, setSaving] = useState(false)

  const handleSaveBoth = async () => {
    setSaving(true)
    await onSaveBoth(editNew, editExisting)
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10,
        width: 540, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>Rule Conflict Detected</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{explanation}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 18, color: 'var(--text3)', cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* New rule */}
          <div style={{ borderRadius: 6, border: '1px solid rgba(0,200,212,0.35)', background: 'rgba(0,200,212,0.05)', padding: 12 }}>
            <div style={{ fontSize: 10, color: '#00c8d4', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6 }}>New Rule</div>
            {mode === 'edit'
              ? <textarea value={editNew} onChange={e => setEditNew(e.target.value)} rows={3}
                  style={{ width: '100%', background: 'var(--bg2)', border: '1px solid rgba(0,200,212,0.35)', borderRadius: 4, padding: '7px 10px', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
              : <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{newRuleText}</div>
            }
          </div>

          <div style={{ textAlign: 'center', fontSize: 11, color: '#ef4444', fontWeight: 600 }}>↕ contradicts</div>

          {/* Existing rule */}
          <div style={{ borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.05)', padding: 12 }}>
            <div style={{ fontSize: 10, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6 }}>Existing Rule in KB</div>
            {mode === 'edit'
              ? <textarea value={editExisting} onChange={e => setEditExisting(e.target.value)} rows={3}
                  style={{ width: '100%', background: 'var(--bg2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, padding: '7px 10px', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
              : <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{conflictingRule.content}</div>
            }
          </div>
        </div>

        {mode === 'choose' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onKeepNew}
              style={{ flex: 1, padding: '9px 12px', background: '#00c8d4', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Use New Rule
            </button>
            <button onClick={onKeepExisting}
              style={{ flex: 1, padding: '9px 12px', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Keep Existing
            </button>
            <button onClick={() => setMode('edit')}
              style={{ flex: 1, padding: '9px 12px', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✏ Edit Both
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setMode('choose')}
              style={{ padding: '9px 14px', background: 'var(--bg2)', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
              ← Back
            </button>
            <button onClick={handleSaveBoth} disabled={saving || !editNew.trim() || !editExisting.trim()}
              style={{ flex: 1, padding: '9px 12px', background: saving ? 'var(--bg3)' : '#00c8d4', color: saving ? 'var(--text3)' : '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Saving…' : '✓ Save Both Edited Rules'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inline chat ────────────────────────────────────────────────────────────
// Compact collapsible chat that lives at the bottom of Analysis / Proposal columns.
// Props:
//   job            – current job object (for /chat job_id)
//   systemSuffix   – extra instructions appended to the KB-grounded system prompt
//   extraContext   – live context (analysis JSON, proposal text) injected per message
//   placeholder    – textarea hint text
// ── localStorage-backed cache helpers ──────────────────────────────────────
// Used to persist analyser / generator / chat state across page reloads.
// `kind` namespaces the key so multiple InlineChat instances don't collide.
function _lsKey(kind, jobId) { return `falconscout.${kind}.${jobId}` }
function _lsLoad(kind, jobId) {
  if (jobId == null) return null
  try {
    const v = localStorage.getItem(_lsKey(kind, jobId))
    return v ? JSON.parse(v) : null
  } catch { return null }
}
function _lsSave(kind, jobId, value) {
  if (jobId == null) return
  try { localStorage.setItem(_lsKey(kind, jobId), JSON.stringify(value)) } catch {}
}
function _lsRemove(kind, jobId) {
  if (jobId == null) return
  try { localStorage.removeItem(_lsKey(kind, jobId)) } catch {}
}

function _friendlyApiError(detail, status) {
  if (!detail) return `API error ${status}`
  // detail may be a string like: 'Claude API error: {"type":"error","error":{"type":"rate_limit_error","message":"..."}}'
  // or just a plain message. Try to extract the inner error type + message.
  try {
    const jsonStart = detail.indexOf('{')
    if (jsonStart !== -1) {
      const parsed = JSON.parse(detail.slice(jsonStart))
      const inner = parsed?.error || parsed
      const type = inner?.type || ''
      const msg = inner?.message || ''
      if (type === 'rate_limit_error') return 'Rate limit reached — wait a few seconds and try again.'
      if (type === 'overloaded_error') return 'Claude is overloaded — try again in a moment.'
      if (type === 'authentication_error') return 'API key error — check ANTHROPIC_API_KEY in .env.'
      if (msg) return msg.length > 120 ? msg.slice(0, 120) + '…' : msg
    }
  } catch {}
  return detail.length > 120 ? detail.slice(0, 120) + '…' : detail
}

// Deterministic markdown + dash cleanup applied to ALL model-generated copy
// the user pastes into Upwork (cover letters AND chat deliverables/answers).
// Claude reliably ignores the "no markdown / use plain hyphens" rules despite
// prompting, so we strip them for free here. Mirrors the inline strip in
// generate(); kept in one helper so cover-letter and chat output stay in sync.
//   **bold**/__bold__ → bold   *italic*/_italic_ → italic
//   ## headings → headings     — / – (em/en dash) → " - "
function _cleanPasteText(s) {
  if (!s) return ''
  return s
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*(.+?)\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/_([^_\n]+?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    // Strip standalone horizontal-rule divider lines (---, ***, ___, ===). These
    // are a template/AI tell — a cover letter is one flowing message, never a
    // document carved into ruled sections.
    .replace(/^[ \t]*[-*_=]{3,}[ \t]*$/gm, '')
    // Strip meta-scaffolding SECTION HEADERS the model bolts on when a posting
    // asks numbered questions — "Direct Answers to Your Application Questions",
    // "The Differentiator", etc. Answering the questions in order is right; wrapping
    // them in a titled section reads like a filled-in form, not a message. Only
    // whole-line, header-shaped matches are removed (content is never touched).
    .replace(/^[ \t]*(?:direct answers?(?:\s+to\s+your\s+application\s+questions?)?|answers?\s+to\s+your\s+(?:application\s+)?questions?|application\s+questions?|(?:the|my)\s+differentiator|why\s+(?:me|artem|work\s+with\s+me))[ \t]*:?[ \t]*$/gim, '')
    .replace(/\s*[—–]\s*/g, ' - ')   // em/en dash → plain hyphen, single-spaced
    // Strip stray CJK / non-Latin script glitches. The letter is English-only;
    // Sonnet occasionally emits a Chinese/Japanese/Korean token mid-word (e.g.
    // "審査" for "review/scrutiny"). Any CJK char is therefore always an error.
    // Covers: CJK ideographs + ext-A, kana, hangul, fullwidth/halfwidth forms,
    // CJK symbols & punctuation.
    .replace(/[　-〿぀-ヿ㐀-䶿一-鿿ꀀ-꓏가-힯豈-﫿＀-￯]/g, '')
    // Collapse artifacts the removal can leave: doubled spaces, and a space
    // sitting just before closing punctuation.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:)\]])/g, '$1')
    // Collapse the blank-line runs the divider/header removals leave behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Deterministic removal of generic-consumer case-study paragraphs on a
// restricted/YMYL job. The enforcer LLM (Haiku) has repeatedly IGNORED the
// "delete the irrelevant case" instruction, so we strip it in code instead —
// 100% pattern-detectable, zero LLM dependence. A case study is a paragraph
// (blank-line-separated block) whose first line starts with the case name.
const _GENERIC_CASE_LINE_RE =
  /^(nectar\s+flowers?|house\s+painting|fridge\s*fix|fridgefix|refrigerat(?:or|ion)\s+repair|golden\s+state\s+trailers?)\b/i
function _stripGenericCaseParagraphs(text, isRegulated) {
  if (!isRegulated || !text) return text
  const paras = text.split(/\n\s*\n/)
  const kept = paras.filter(p => {
    const firstLine = (p.trim().split('\n')[0] || '').trim()
    return !_GENERIC_CASE_LINE_RE.test(firstLine)
  })
  return kept.join('\n\n')
}

// Deterministic removal of a fabricated "I inspected your site" opening
// sentence. The generator likes to open with "I took a look at <domain> -
// <invented business description>", which (a) claims a site visit that never
// happened and (b) invents the client's business model from just a company
// name — both NO-FABRICATED-DIAGNOSIS violations the Haiku enforcer keeps
// missing. 100% detectable, so strip it in code: if the FIRST sentence opens
// with an inspection claim, delete that sentence and keep the rest.
const _FABRICATED_OPENER_RE =
  /^\s*(?:i\s+(?:took\s+a\s+look\s+at|had\s+a\s+look\s+(?:at|through)|checked\s+(?:out|over)|looked\s+(?:at|over|into|through)|reviewed|visited|explored|dug\s+into|went\s+through|pulled\s+up|browsed|poked\s+around)|after\s+(?:looking\s+at|reviewing|checking)|having\s+(?:looked\s+at|reviewed|checked)|looking\s+(?:at|over)\s+your)\b/i
function _stripFabricatedOpener(text) {
  if (!text) return text
  const paras = text.split(/\n\s*\n/)
  if (!paras.length) return text
  const first = paras[0]
  if (!_FABRICATED_OPENER_RE.test(first)) return text
  // Drop the leading inspection-claim sentence (up to the first . ! or ?).
  const m = first.match(/^[\s\S]*?[.!?](?:\s+|$)/)
  if (!m) {
    // Whole first paragraph is the fabricated opener — drop it entirely.
    return paras.slice(1).join('\n\n').trim()
  }
  const remainder = first.slice(m[0].length).trim()
  if (remainder) paras[0] = remainder
  else paras.shift()
  return paras.join('\n\n').trim()
}

// Strip "Relevant case studies:" block header — not an approved format (PATTERN A/B/C
// all use a lead-in sentence, never a standalone heading). This label always appears
// when the generator writes a proof paragraph mentioning the cases AND then repeats
// them in a labeled block below — the classic duplication pattern. Removing the header
// leaves the block entries as plain paragraphs; the prompt rule prevents the duplication
// in future runs, and this is the safety net.
function _stripDuplicateCaseBlockLabel(text) {
  if (!text) return text
  if (!/relevant case studies:/i.test(text)) return text
  console.log('[Falcon] Stripped "Relevant case studies:" block header — case study duplication pattern detected.')
  _recordViolations('generator', null, ['caseDuplication'])
  return text.replace(/\n*Relevant case studies:\s*\n*/gi, '\n\n')
}

// Collapse a DUPLICATED attachment label on a case-study line. The generator
// sometimes emits the attachment phrase twice, e.g.
//   "Skin Reboot (attached as PDF) (health/wellness ecommerce, attached as PDF):"
// — two parentheticals both carrying "attached as PDF". Keep the descriptor
// parenthetical and a SINGLE attachment phrase →
//   "Skin Reboot (health/wellness ecommerce, attached as PDF):"
// Also handles the same phrase appearing twice inside ONE parenthetical.
const _ATTACH_PHRASE_RE = /\battached\s+(?:as\s+(?:a\s+)?pdf|in\s+(?:the\s+)?profile\s+highlights)\b/i
// A new duplicate-label variant: the attachment phrase appears once inside a
// parenthetical AND immediately again as bare text right before the colon,
// e.g. "Skin Reboot (attached as PDF), attached as PDF: fixed event mapping…"
// — reads as a garbled half-formed template. Keep the parenthetical, drop the
// repeated bare phrase.
const _DUPLICATE_LABEL_BEFORE_COLON_RE = new RegExp(
  `(\\([^()]*${_ATTACH_PHRASE_RE.source}[^()]*\\))\\s*,\\s*(?:also\\s+)?${_ATTACH_PHRASE_RE.source}\\s*:`,
  'gi'
)
function _stripDuplicateAttachmentLabel(text) {
  if (!text) return text
  let out = text
  // 0) "(attached as PDF), attached as PDF:" → "(attached as PDF):"
  out = out.replace(_DUPLICATE_LABEL_BEFORE_COLON_RE, '$1:')
  // 1) Two adjacent parentheticals that BOTH carry an attachment phrase → merge.
  out = out.replace(/\(([^()]*)\)\s*\(([^()]*)\)/g, (full, a, b) => {
    if (!_ATTACH_PHRASE_RE.test(a) || !_ATTACH_PHRASE_RE.test(b)) return full
    const phrase = (a.match(_ATTACH_PHRASE_RE) || b.match(_ATTACH_PHRASE_RE))[0]
    const clean = (s) => s.replace(_ATTACH_PHRASE_RE, '').replace(/^[\s,;]+|[\s,;]+$/g, '').trim()
    const desc = [clean(a), clean(b)].filter(Boolean).join(', ')
    return desc ? `(${desc}, ${phrase})` : `(${phrase})`
  })
  // 2) Same attachment phrase twice inside ONE parenthetical → drop the duplicate.
  out = out.replace(/\(([^()]*)\)/g, (full, inner) => {
    const re = new RegExp(_ATTACH_PHRASE_RE.source, 'gi')
    if ((inner.match(re) || []).length < 2) return full
    let seen = false
    const collapsed = inner
      .replace(new RegExp(_ATTACH_PHRASE_RE.source, 'gi'), m => (seen ? '' : (seen = true, m)))
      .replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/^[\s,;]+|[\s,;]+$/g, '')
    return `(${collapsed})`
  })
  // 3) Redundant STANDALONE attach sentence within a paragraph that already has
  //    the attach phrase in a parenthetical label. e.g.
  //    "Derma Solution (attached as PDF): … 155 referring domains. Attached as a PDF."
  //    → drop the trailing standalone "Attached as a PDF." sentence.
  out = out.split(/\n{2,}/).map(para => {
    const gRe = new RegExp(_ATTACH_PHRASE_RE.source, 'gi')
    if ((para.match(gRe) || []).length < 2) return para
    // Only act when the label form is present in a parenthetical (that's the keeper).
    const hasParenAttach = /\([^)]*\battached\s+(?:as\s+(?:a\s+)?pdf|in\s+(?:the\s+)?profile\s+highlights)\b[^)]*\)/i.test(para)
    if (!hasParenAttach) return para
    // Remove a standalone attach clause sitting at a sentence boundary (not inside parens).
    return para
      .replace(/([.!?])\s+(?:also\s+)?attached\s+(?:as\s+(?:a\s+)?pdf|in\s+(?:the\s+)?profile\s+highlights)\s*[.!?]?(?=\s|$)/gi, '$1')
      .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.!?,;:])/g, '$1').trimEnd()
  }).join('\n\n')
  if (out !== text) {
    console.log('[Falcon] Collapsed duplicate attachment label(s).')
    _recordViolations('generator', null, ['duplicateAttachmentLabel'])
  }
  return out
}

// Collapse a DUPLICATED reference to the audit SAMPLE attachment. The generator
// sometimes points at it inline ("(see attached sample - lemoos.com audit)") AND
// again in the canonical closing sentence ("i'm attaching a sample technical SEO
// audit so you can see the format and depth."). Two mentions of the same
// attachment reads as sloppy/padded — keep the canonical closing sentence and
// drop the inline parenthetical; if multiple canonical sentences exist, keep one.
const _AUDIT_SAMPLE_CANON_RE = /\bi['’]?m\s+(?:also\s+)?attaching\s+a\s+sample\s+(?:recent\s+)?(?:technical\s+seo|google\s+ads)\s+audit\b[^.\n]*\.?/gi
// A parenthetical that references the attached audit sample (contains both an
// "attach*" word and "audit"). Case-study labels ("(attached as PDF)") never
// contain "audit", so this won't touch them.
const _AUDIT_SAMPLE_INLINE_RE = /\s*\([^)]*\battach\w*[^)]*\baudit\b[^)]*\)/gi
function _stripDuplicateAuditSampleMention(text) {
  if (!text) return text
  let t = text
  const canon = t.match(_AUDIT_SAMPLE_CANON_RE) || []
  const inline = t.match(_AUDIT_SAMPLE_INLINE_RE) || []
  // If the canonical closing offer exists, remove inline parenthetical audit-sample refs.
  if (canon.length >= 1 && inline.length >= 1) {
    t = t.replace(_AUDIT_SAMPLE_INLINE_RE, '')
  }
  // If multiple canonical offers remain, keep only the last.
  const remaining = t.match(_AUDIT_SAMPLE_CANON_RE) || []
  if (remaining.length > 1) {
    let seen = 0
    t = t.replace(_AUDIT_SAMPLE_CANON_RE, (m) => { seen++; return seen < remaining.length ? '' : m })
  }
  // Tidy artifacts left by removals: doubled spaces, space-before-punctuation,
  // and a stray blank line where a whole sentence was removed.
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:])/g, '$1').replace(/\n{3,}/g, '\n\n')
  if (t !== text) {
    console.log('[Falcon] Collapsed duplicate audit-sample attachment mention.')
    _recordViolations('generator', null, ['duplicateAuditSample'])
  }
  return t
}

// Known case-study names, anchored to a paragraph start (they begin their entry).
// PDF cases (Derma Solution / Skin Reboot) carry their own "(attached as PDF)"
// label; every OTHER case needs the "(attached in profile highlights)" lead-in.
const _NON_PDF_CASE_NAME_RE = /^(?:nectar\s*flowers|fridgefix|house\s+painting|golden\s+state\s+trailers|multilingual\s+site|oxytec|luxury\s+parfums|chronocash|atlant|vape\s*shop|smash|game-?x|gkit|casa\s*eleganza)\b/i
const _ANY_CASE_NAME_RE = /^(?:nectar\s*flowers|fridgefix|house\s+painting|golden\s+state\s+trailers|multilingual\s+site|oxytec|luxury\s+parfums|chronocash|atlant|vape\s*shop|smash|game-?x|gkit|casa\s*eleganza|derma\s*solution|skin\s*reboot)\b/i
// Deterministically ensure the case-study block ANNOUNCES the cases and labels the
// non-PDF ones as attached. The generator sometimes dumps "Nectar Flowers: …" /
// "FridgeFix: …" straight into the letter with no lead-in and no attachment label —
// so the client has no idea these are relevant proof or that they're attached. If a
// non-PDF case study is present and "profile highlights" appears nowhere, insert the
// canonical lead-in immediately before the first case-study paragraph.
// A few interchangeable lead-in phrasings so inserted transitions don't look
// templated across letters. Each keeps the mandatory "(attached in profile
// highlights):" attachment label — only the intro words vary.
// PLAIN lead-ins — no attachment label. The "(attached in profile highlights)" note
// belongs INLINE on each non-PDF case (so a mixed block of a profile-highlights case +
// a separate PDF case is described correctly), NOT folded into a collective lead-in.
const _HIGHLIGHTS_LEADINS = [
  'Here are some relevant results:',
  'A few relevant results:',
  'Some comparable results:',
  'A few results from similar work:',
  'Proof this approach works:',
  'A couple of relevant wins:',
  'Recent relevant work:',
]

// Insert "(attached in profile highlights)" right after a non-PDF case's name (before its
// ":" / "-" separator), unless the case already carries an attachment label.
function _addProfileHighlightsLabel(para) {
  const t = String(para).trim()
  if (/attached\s+(?:in\s+profile\s+highlights|as\s+(?:a\s+)?pdf)/i.test(t)) return t
  const m = t.match(_NON_PDF_CASE_NAME_RE)
  if (!m) return t
  return `${t.slice(0, m[0].length)} (attached in profile highlights)${t.slice(m[0].length)}`
}

// A "[[ ARTEM: … ]]" placeholder that already contains a concrete $ figure is effectively
// filled — the model computed a real price/estimate but wrapped it in review brackets that
// read as unfinished. Unwrap those to plain text. Placeholders with NO dollar amount (a
// genuine "[[ ARTEM: fill in your team size ]]") are left intact for Artem to complete.
function _unwrapFilledPlaceholders(text) {
  if (!text) return text
  return text.replace(/\[\[\s*ARTEM\s*:\s*([^\]]*?\$\s?\d[^\]]*?)\s*\]\]/gi, (_m, inner) => inner.trim())
}

// Known case studies: canonical name + whether it's a PDF (Derma / Skin Reboot).
const _CASE_META = [
  { re: /\bnectar\s*flowers\b/i, name: 'Nectar Flowers', pdf: false },
  { re: /\bfridgefix\b/i, name: 'FridgeFix', pdf: false },
  { re: /\bhouse\s+painting\b/i, name: 'House Painting', pdf: false },
  { re: /\bgolden\s+state\s+trailers\b/i, name: 'Golden State Trailers', pdf: false },
  { re: /\bmultilingual\s+site\b/i, name: 'Multilingual Site', pdf: false },
  { re: /\boxytec\b/i, name: 'Oxytec', pdf: false },
  { re: /\bluxury\s+parfums\b/i, name: 'Luxury Parfums', pdf: false },
  { re: /\bchronocash\b/i, name: 'ChronoCash', pdf: false },
  { re: /\batlant\b/i, name: 'Atlant', pdf: false },
  { re: /\bvape\s*shop\b/i, name: 'Vape Shop', pdf: false },
  { re: /\bsmash\b/i, name: 'SMASH', pdf: false },
  { re: /\bgame-?x\b/i, name: 'Game-X', pdf: false },
  { re: /\bgkit\b/i, name: 'GKit', pdf: false },
  { re: /\bcasa\s*eleganza\b/i, name: 'Casa Eleganza', pdf: false },
  { re: /\bderma\s*solution\b/i, name: 'Derma Solution', pdf: true },
  { re: /\bskin\s*reboot\b/i, name: 'Skin Reboot', pdf: true },
]
// Split a CRAMMED case-study paragraph (2+ case studies run together in one line/
// paragraph) into one entry per paragraph — the enforcer is unreliable at this, so
// do it deterministically. Each entry becomes "Name: <description>." with a blank
// line between; PDF cases keep an inline "(attached as PDF)" label; non-PDF cases are
// covered by a single "(attached in profile highlights):" lead-in.
function _splitCrammedCaseStudies(text) {
  if (!text) return text
  const alreadyHasPhrase = /profile\s+highlights?/i.test(text)
  const paras = text.split(/\n{2,}/)
  let changed = false
  const result = []
  for (const para of paras) {
    const hits = []
    for (const meta of _CASE_META) {
      const m = para.match(meta.re)
      if (m) hits.push({ idx: m.index, len: m[0].length, meta })
    }
    if (hits.length < 2) { result.push(para); continue }  // not a crammed block
    hits.sort((a, b) => a.idx - b.idx)
    // Only split a period-separated case LIST — each case (after the first) preceded
    // by a sentence boundary (.!?). If the cases are joined by a conjunction into ONE
    // flowing sentence ("… SMASH (…) and Game-X (…) on OpenCart"), leave it alone —
    // splitting a compound sentence mangles it (dangling "and", orphaned prefix).
    let isList = true
    for (let i = 1; i < hits.length; i++) {
      if (!/[.!?]$/.test(para.slice(0, hits[i].idx).replace(/\s+$/, ''))) { isList = false; break }
    }
    if (!isList) { result.push(para); continue }
    changed = true
    // Keep substantial non-lead-in prefix text (a full sentence, not "Recent examples:").
    const prefix = para.slice(0, hits[0].idx).trim()
    if (prefix && prefix.length > 60 && !/[:—-]\s*$/.test(prefix)) result.push(prefix)
    let hasNonPdf = false
    let labeledProfile = false
    const entries = []
    for (let i = 0; i < hits.length; i++) {
      const end = i + 1 < hits.length ? hits[i + 1].idx : para.length
      const seg = para.slice(hits[i].idx, end).trim()
      let after = seg.slice(hits[i].len).replace(/^\s+/, '')
      let label = ''
      const lbl = after.match(/^\((?:case\s+study\s+)?attached\s+as\s+a?\s*pdf\)/i)
      if (lbl) { label = ' (attached as PDF)'; after = after.slice(lbl[0].length).replace(/^\s+/, '') }
      after = after.replace(/^[:\-–—]\s*/, '').replace(/[\s,;]+$/, '')
      if (after && !/[.!?]$/.test(after)) after += '.'
      if (!hits[i].meta.pdf) {
        hasNonPdf = true
        // Label the FIRST non-PDF case inline (profile highlights) — not the lead-in.
        if (!label && !labeledProfile) { label = ' (attached in profile highlights)'; labeledProfile = true }
      }
      entries.push(`${hits[i].meta.name}${label}: ${after}`.trim())
    }
    if (!alreadyHasPhrase) {
      result.push(hasNonPdf
        ? _HIGHLIGHTS_LEADINS[Math.floor(Math.random() * _HIGHLIGHTS_LEADINS.length)]
        : 'Here are some relevant results:')
    }
    for (const e of entries) result.push(e)
  }
  if (changed) {
    console.log('[Falcon] Split crammed case-study paragraph into separate labelled entries.')
    _recordViolations('generator', null, ['splitCrammedCaseStudies'])
  }
  return result.join('\n\n')
}

function _ensureCaseStudyHighlightsLeadIn(text) {
  if (!text) return text
  // Backstop: kill the FABRICATED Skin Reboot "$12k → $95k" revenue figure if it ever
  // resurfaces (real: +693.8% revenue at 17.51 PMax ROAS). Removed from all prompt
  // sources, but guarded here so it can never reach a client again.
  const deFab = text.replace(/(?:from\s+)?\$?\s*12\s*k\s*(?:→|->|to|–|—|-)\s*\$?\s*95\s*k/gi, '+693.8%')
  if (deFab !== text) {
    console.log('[Falcon] Replaced fabricated Skin Reboot $12k→$95k with real +693.8%.')
    _recordViolations('generator', null, ['fabricatedSkinRebootRevenue'])
  }
  text = deFab
  // Kill a DUPLICATED same-percentage metric — the model sometimes repeats a figure with
  // a vague second unit ("+693.8% revenue, +693.8% monthly"). Drop the redundant copy.
  const deDupPct = text
    // "+693.8% revenue, +693.8% monthly" → keep the first
    .replace(/(\+\s?(\d[\d.]*)\s?%\s+[a-z]+)\s*,\s*\+\s?\2\s?%\s+[a-z]+/gi, '$1')
    // "+693.8% (+693.8%)" → drop the redundant parenthetical echo of the SAME number
    .replace(/(\+\s?(\d[\d.]*)\s?%)\s*\(\s*\+\s?\2\s?%\s*\)/gi, '$1')
  if (deDupPct !== text) {
    console.log('[Falcon] Removed duplicated same-percentage metric.')
    _recordViolations('generator', null, ['duplicateMetric'])
  }
  text = deDupPct
  // Split a crammed one-paragraph case block into separate labelled entries (this
  // also adds the lead-in when it fires).
  text = _splitCrammedCaseStudies(text)
  const paras = text.split(/\n{2,}/)
  const hasNonPdf = paras.some(p => _NON_PDF_CASE_NAME_RE.test(p.trim()))
  if (!hasNonPdf) return text  // only PDF cases → they carry their own label
  const firstCaseIdx = paras.findIndex(p => _ANY_CASE_NAME_RE.test(p.trim()))
  if (firstCaseIdx < 0) return text
  // 1) The "(attached in profile highlights)" note belongs on each CASE, never folded into
  //    a collective lead-in — a shared lead-in can't describe a block that mixes profile-
  //    highlights cases with separate PDF cases. Strip the note from any LEAD-IN line (a
  //    short colon-header before the cases that is NOT itself a case line).
  for (let i = 0; i < firstCaseIdx; i++) {
    const t = paras[i].trim()
    if (/:$/.test(t) && !_ANY_CASE_NAME_RE.test(t) && /attached\s+in\s+profile\s+highlights/i.test(t)) {
      paras[i] = t.replace(/\s*\(?\s*,?\s*attached\s+in\s+profile\s+highlights\s*\)?/i, '')
    }
  }
  // 2) Label EVERY non-PDF case inline (no-op if it already carries an attachment label).
  //    Handles blocks with multiple non-PDF cases (e.g. Multilingual Site + Casa Eleganza)
  //    that would otherwise be left with no attachment notice.
  let labeled = false
  for (let i = firstCaseIdx; i < paras.length; i++) {
    if (_NON_PDF_CASE_NAME_RE.test(paras[i].trim())) {
      const before = paras[i]
      paras[i] = _addProfileHighlightsLabel(paras[i])
      if (paras[i] !== before) labeled = true
    }
  }
  // 3) Ensure the block is introduced by a PLAIN lead-in (no attachment label on it).
  const prev = firstCaseIdx > 0 ? paras[firstCaseIdx - 1].trim() : ''
  const hasLeadIn = firstCaseIdx > 0 && prev.length <= 160 && /:$/.test(prev) && !_ANY_CASE_NAME_RE.test(prev)
  // The lead-in must NOT claim a deliverable TYPE the cases don't represent. The KB cases
  // are campaign / SEO RESULTS, not audit deliverables, so a lead-in like "Recent audit
  // work:" mislabels them. Neutralize any lead-in that types the cases as audits.
  if (hasLeadIn && /\baudits?\b/i.test(prev)) {
    paras[firstCaseIdx - 1] = _HIGHLIGHTS_LEADINS[Math.floor(Math.random() * _HIGHLIGHTS_LEADINS.length)]
    console.log('[Falcon] Neutralized a case-study lead-in that mislabeled the cases as "audit work".')
    _recordViolations('generator', null, ['caseLeadInMislabel'])
  } else if (!hasLeadIn) {
    const leadIn = _HIGHLIGHTS_LEADINS[Math.floor(Math.random() * _HIGHLIGHTS_LEADINS.length)]
    paras.splice(firstCaseIdx, 0, leadIn)
  }
  if (labeled) {
    console.log('[Falcon] Labeled non-PDF case(s) inline (attached in profile highlights); lead-in kept plain.')
    _recordViolations('generator', null, ['caseHighlightsInlineLabel'])
  }
  return paras.join('\n\n')
}

// Deterministic removal of a DUPLICATED "SEO/tracking wired into the build" differentiator.
// The model repeatedly makes this point in the opener AND again in an explicit
// "The differentiator:" / "The unique part:" paragraph — the self-echo the owner flagged.
// The prompt rule ("state it once") is unreliable, so enforce it in code: if the build-SEO
// theme appears in 2+ paragraphs, drop the explicit-label paragraph and keep the earlier
// organic mention. Only fires when the point is genuinely made in a NON-labeled paragraph too.
const _DIFF_THEME_RE = /\b(?:into\s+the\s+build|wir(?:e|ed|ing)\s+(?:the\s+)?(?:technical\s+)?seo|ranks?\s+from\s+day\s+one|seo\s+architecture|(?:schema|ga4|tracking)[^.\n]*\b(?:at\s+launch|into\s+the\s+build|from\s+day\s+one)|six\s+months\s+(?:later|after)|separate\s+seo\s+(?:person|contractor)|patched\s+in\s+months|retrofit)\b/i
const _DIFF_LABEL_RE = /^[ \t]*(?:the\s+differentiator|the\s+unique\s+(?:part|thing)|what\s+sets\s+(?:me|us)\s+apart|here'?s\s+the\s+difference|the\s+(?:real\s+)?edge|my\s+edge)\b\s*:?/i
function _stripDuplicateDifferentiator(text) {
  if (!text) return text
  const paras = text.split(/\n{2,}/)
  const themeIdx = paras.map((p, i) => (_DIFF_THEME_RE.test(p) ? i : -1)).filter(i => i >= 0)
  if (themeIdx.length < 2) return text  // made at most once — nothing to dedupe
  const labeledIdx = themeIdx.find(i => _DIFF_LABEL_RE.test(paras[i].trim()))
  if (labeledIdx === undefined) return text  // no explicit-label paragraph to drop
  // Require the theme to ALSO appear outside the labeled paragraph (so we keep one copy).
  if (!themeIdx.some(i => i !== labeledIdx)) return text
  paras.splice(labeledIdx, 1)
  console.log('[Falcon] Removed duplicated "The differentiator:" paragraph (self-echo of the build-SEO point).')
  _recordViolations('generator', null, ['duplicateDifferentiator'])
  return paras.join('\n\n')
}

// Deterministic removal of a VOLUNTEERED rate/price when the client did not ask.
// Artem's rule is "never quote a price upfront" — the hourly bid is set in the Upwork
// application form, not the cover letter. The prompt rule is unreliable, so strip a
// standalone rate/pricing paragraph here. Gated on `asksRate` so a REQUESTED rate stays.
const _RATE_PARA_RE = /^(?:my\s+)?rate\b/i
const _RATE_DOLLAR_HR_RE = /\$\s?\d[\d,]*\s*(?:\/\s?|\s?per\s+)?(?:hr|hour)\b/i
const _RATE_CONTEXT_RE = /\b(?:rate|charge|scope|project\s+cost|total\s+project|price|pricing|per\s+hour)\b/i
function _stripUnaskedRate(text, asksRate) {
  if (!text || asksRate) return text
  const paras = text.split(/\n{2,}/)
  const kept = paras.filter(p => {
    const t = p.trim()
    // CARVE-OUT: the productised AUDIT offer ($300 flat, 1 working day) is Artem's
    // standard deliverable and IS the pitch — it must survive even when the posting
    // never asked for a rate. Never strip a paragraph that mentions an audit.
    if (/\baudits?\b/i.test(t)) return true
    // A paragraph that is PRIMARILY a rate/price quote: it opens with "Rate …",
    // or it states an hourly figure ("$40/hr") inside a pricing context.
    const isRatePara = _RATE_PARA_RE.test(t) ||
      (_RATE_DOLLAR_HR_RE.test(t) && _RATE_CONTEXT_RE.test(t)) ||
      /\btotal\s+project\s+cost\b/i.test(t)
    return !isRatePara
  })
  if (kept.length !== paras.length) {
    console.log('[Falcon] Stripped a volunteered rate/pricing paragraph (client did not ask for a rate).')
    _recordViolations('generator', null, ['unaskedRateStripped'])
  }
  return kept.join('\n\n')
}

// Strips fabricated vertical-specific web dev experience in the opening sentence.
// Pattern: "12 years in digital, building and ranking car rental sites on WordPress."
// This claims a vertical build track record that doesn't exist in the approved case
// studies (only documented build is GKit, fashion ecommerce on OpenCart). The second
// sentence is always the real technical insight — a better hook. Strip the lie, keep
// everything after it. Matches "X years in digital ... building ... sites on [platform]."
const _FABRICATED_VERTICAL_OPENER_RE =
  /^\d+\s+years?\s+in\s+digital\b[^.!?\n]*\bbuilding\b[^.!?\n]*\b(?:sites?|websites?)\s+on\s+(?:wordpress|shopify|opencart|magento|woocommerce)\b[^.!?\n]*[.!?]/im
function _stripFabricatedVerticalOpener(text) {
  if (!text) return text
  const m = text.match(_FABRICATED_VERTICAL_OPENER_RE)
  if (!m) return text
  console.log('[Falcon] Stripped fabricated vertical-web-dev opener:', m[0].slice(0, 80))
  _recordViolations('generator', null, ['fabricatedVerticalOpener'])
  return text.slice(m.index + m[0].length).replace(/^\s+/, '')
}

// Deterministic removal of a day-count turnaround promised on a TECHNICAL SEO
// AUDIT (KB Rule 416). A technical SEO audit is a ~2-week job and its timeline
// is OMITTED from the cover letter — the "2 working days" turnaround belongs
// ONLY to the SEO PROMOTION PLAN (Rule 402), never to the audit. The generator
// repeatedly emits "diagnostic crawl + redirect/indexation audit in 2 working
// days" — 100% pattern-detectable, so strip it in code instead of trusting the
// LLM enforcer (DESIGN.md §16).
//
// Two patterns handled:
// (A) SEO-prefixed audit: "technical SEO audit in 2 working days" — strip timing,
//     keep audit phrase. Self-gating via the SEO prefix (can't touch the PPC
//     "google ads audit in 1 working day").
// (B) Bare "audit delivered within N days" — generator uses this when it outputs
//     a "Timeline:" label ("Timeline: audit delivered within 2 working days of GSC
//     access."). Strip the whole sentence if it starts with "Timeline:", otherwise
//     strip just the timing suffix.
const _SEO_AUDIT_TURNAROUND_RE =
  /((?:technical\s+seo|seo|diagnostic|indexation|crawl|redirect|canonical|schema|core\s+web\s+vitals|migration)\b[^.]{0,60}\baudit)\s+(?:in|within|delivered\s+(?:in|within)?|turned?\s+around\s+in)\s+\d+(?:\s*[-–]\s*\d+)?\s*(?:working\s+|business\s+)?days?\b/gi
// Catches "Timeline: audit delivered within N days of ..." — strip the whole sentence
const _AUDIT_TIMELINE_LABEL_RE =
  /^[ \t]*Timeline\s*:\s*audit\b[^\n.]*(?:in|within)\s+\d+[^\n.]*days?\b[^\n.]*[.\n]?/gim
// A technical DIAGNOSTIC / crawl carries no day-count either (same rule as the
// technical audit — the "2 working days" turnaround is the SEO PLAN only). The
// model phrases it as "run a technical diagnostic in 2 working days", which the
// audit regex above misses because there's no literal "audit". Strip the timing,
// keep the diagnostic phrase. Does NOT touch "SEO promotion plan ... 2 working
// days" (no "diagnostic") or the Google Ads audit (no "diagnostic").
const _DIAGNOSTIC_TURNAROUND_RE =
  /((?:technical\s+(?:seo\s+)?|seo\s+|crawl\s+|indexation\s+)?diagnostic(?:\s+crawl)?)\s+(?:in|within|delivered\s+(?:in|within)?|turned?\s+around\s+in)\s+\d+(?:\s*[-–]\s*\d+)?\s*(?:working\s+|business\s+)?days?/gi
// (C) The "Timeline:" label form the earlier patterns MISS (2026-07-27):
//   "Timeline:\n\nFull audit delivered in 2 working days from GSC/GA4 access."
// (A) misses it because there's no SEO noun directly before "audit" ("Full
// audit"); (B)'s _AUDIT_TIMELINE_LABEL_RE misses it because it required
// "Timeline: audit" on one line (here "Timeline:" sits on its own line and the
// sentence starts with "Full"). For a comprehensive/technical/SEO/store audit
// that day-count is both a Rule-416 violation and an implausible overcommit,
// so strip the whole Timeline block. GATE: a Google Ads / PPC / paid-media
// audit's "1 working day" turnaround IS required (Rule 402) — the replacer
// leaves the block untouched when the matched text names ads/ppc/paid.
const _AUDIT_TIMELINE_BLOCK_RE =
  /^[ \t]*Timeline\s*:[ \t]*\n*[ \t]*(?:(?:full|comprehensive|complete|the)\s+)*(?:technical\s+|seo\s+|site\s+|store\s+|shopify\s+|e-?commerce\s+)?audit\b[^\n]*?\b(?:in|within)\s+\d+(?:\s*[-–]\s*\d+)?\s*(?:working\s+|business\s+)?days?\b[^\n]*\n?/gim
function _stripSeoAuditTurnaround(text) {
  if (!text) return text
  // Strip "Timeline: audit ... N days" sentence first (whole sentence removal)
  text = text.replace(_AUDIT_TIMELINE_LABEL_RE, '')
  // Strip the "Timeline:" block form (label + "Full audit ... N days"), unless
  // it's a PPC/Google Ads audit whose 1-day turnaround is required.
  text = text.replace(_AUDIT_TIMELINE_BLOCK_RE, (m) =>
    /\b(?:google\s+ads|ppc|paid\s+(?:search|media|ads)|adwords)\b/i.test(m) ? m : '')
  // Strip SEO-prefixed "... audit in/within N days" (keep audit phrase)
  text = text.replace(_SEO_AUDIT_TURNAROUND_RE, '$1')
  // Strip "... diagnostic in/within N days" (keep the diagnostic phrase)
  text = text.replace(_DIAGNOSTIC_TURNAROUND_RE, '$1')
  return text
}

// Deterministic strip of Loom references in generated cover letters.
// Rule 2 bans screen-recording deliverables; "Loom" keeps slipping through
// the prompt because Claude treats it as a casual async comms tool rather
// than a screen-recording mention. Replace any "Loom" mention in a comms
// context with nothing (the surrounding sentence stays; the brand name goes)
// or strip the whole "recorded Loom ..." clause where it's a deliverable offer.
const _LOOM_RE = /\b(?:recorded?\s+)?Loom\s+(?:messages?|videos?|walkthroughs?|recordings?|updates?|clips?)\b/gi
function _stripLoomReference(text) {
  if (!text) return text
  // Replace "recorded Loom messages" / "Loom videos" etc. with a neutral form
  return text.replace(_LOOM_RE, 'short video updates')
}

// Deterministic fix for unnamed attachment references ("attaching a sample so
// you can see the format" without a type specifier). The prompt rule is ignored
// repeatedly, so we fix it in code. Context clue: if "technical SEO audit"
// appears nearby in the same sentence, it's the audit sample; otherwise it's
// the SEO promotion plan (the only other attachment offered without a named type).
function _fixUnnamedAttachment(text) {
  if (!text) return text
  // "attaching a sample so you can see the format" → insert type name
  // Handles "a sample so you can see" and "a sample so you can see the format"
  return text.replace(
    /\battaching\s+a\s+sample\s+so\s+you\s+can\s+see(\s+the\s+format)?\b/gi,
    (match, fmtSuffix) => `attaching a sample SEO promotion plan so you can see the format`
  )
}

// Deterministic fix for PDF case studies misattributed to "profile highlights".
// Derma Solution and Skin Reboot are PDF attachments — Multilingual Site is the
// only real "profile highlights" case. The generator sometimes wraps both PDFs
// under a section header like "Experience (attached in profile highlights):" which
// is wrong on two counts: (1) wrong attachment label, (2) a block header instead
// of per-case inline labels. Fix: strip the wrong section header, then add
// "(attached as PDF)" inline after each PDF case name if not already present.
function _fixPdfCaseLabelMisattribution(text) {
  if (!text) return text
  // Remove section-header form: "Experience (attached in profile highlights):\n"
  // Targets lines where a generic label ("Experience", "Case studies", etc.) is
  // paired with "(attached in profile highlights)" — NOT the per-case inline form
  // "Multilingual Site (attached in profile highlights):", which is correct.
  text = text.replace(
    /^[ \t]*(?:experience|results?|work|portfolio|case\s+studies?)\s*\(\s*attached\s+in\s+profile\s+highlights?\s*\)\s*:[ \t]*\n?/gim,
    ''
  )
  // Ensure each PDF case name carries "(attached as PDF)" immediately after it.
  // Negative lookahead: skip if already labelled (any "(attached..." follows).
  for (const name of ['Derma Solution', 'Skin Reboot']) {
    const re = new RegExp(`\\b(${name})\\b(?!\\s*\\(attached)`, 'gi')
    text = text.replace(re, '$1 (attached as PDF)')
  }
  return text
}

// Strip any sentence where the model leaks its internal KB terminology to the client.
// "I don't have B2B case studies in the KB right now" is never acceptable in a
// client-facing message — it exposes internal tooling and signals a gap before one
// is even confirmed. Remove the whole sentence containing the KB reference.
function _stripKbLeak(text) {
  if (!text) return text
  // Remove any sentence (ending in . or \n) that mentions "the KB" / "in the KB" / "my KB"
  return text.replace(/[^.!?\n]*\b(?:the|my|our|in\s+the)\s+KB\b[^.!?\n]*[.!?]?\n?/gi, '')
}

// Fire-and-forget telemetry: record which guard pre-checks fired this run so
// "top violations" is data-driven (DESIGN.md §16, Phase C). Never blocks the UI.
function _recordViolations(surface, jobId, checks) {
  const list = (checks || []).filter(Boolean)
  if (!list.length) return
  try {
    fetch('/rule-violations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface, job_id: jobId ?? null, checks: list }),
    }).catch(() => {})
  } catch (_) {}
}

// Safety net for chat-reworked letters: the model sometimes leaks its
// "what I changed" narration INTO the <proposal> block (e.g. "Stripped the
// week-by-week plan… kept only the hook…"). Drop leading paragraphs that are
// clearly edit-commentary, stopping at the first real letter paragraph.
const _NARRATION_LEAD_RE =
  /^(to remove\b|stripped\b|kept only\b|removed the\b|applied rule\b|here'?s the\b|here is the\b|i'?ve (removed|stripped|kept|reworked|cleaned)\b|reworked the\b|splitting into\b|four standalone\b|this (version|is the)\b|the (cleaned|reworked|updated|new) (letter|version|cover)\b|cleaned[- ]?up\b)/i
function _stripLeadingNarration(text) {
  if (!text) return text
  const paras = text.split(/\n\s*\n/)
  while (paras.length > 1 && _NARRATION_LEAD_RE.test(paras[0].trim())) {
    paras.shift()
  }
  return paras.join('\n\n')
}

// The signoff "Artem" sometimes leaks to the TOP of the letter (the model emits
// the name before the body), so the letter opens by just saying "Artem". Strip a
// signoff that stands alone as the opening line(s) — with or without a closer
// ("Best,\nArtem", "Regards, Artem", bare "Artem"). Only fires when "Artem" is
// the whole opening line (followed by a line break); never touches "Artem" used
// inside the first sentence (e.g. "Artem here, I noticed…").
function _stripLeadingSignoff(text) {
  if (!text) return text
  const cleaned = text.replace(
    /^\s*(?:(?:best|kind)\s+regards?|regards|thanks|thank\s+you|cheers|sincerely|best)?\s*[,–-]?\s*artem\s*[.,!]?\s*\n+/i,
    ''
  )
  return cleaned.replace(/^\s+/, '')
}

// Strip a redundant "Attachments: …" summary line. Each case-study paragraph
// already carries its own "(attached …)" label, so a trailing list line is
// duplicative machine-junk (e.g. "Attachments: derma solution (attached as PDF)
// (PDF), skin reboot (attached as PDF) (PDF), …").
function _stripAttachmentsSummaryLine(text) {
  if (!text) return text
  return text
    .replace(/(?:^|\n)[ \t]*attachments?\s*:[^\n]*(?=\n|$)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
}

// Deterministic CASING normaliser. Philosophy: casing is NEVER where the
// "human imperfection" lives — a real person capitalises "I" and their own name
// automatically; uniform lowercase "i"/"artem" reads as an AI affectation, not a
// typo. So we always fix casing here, while leaving the model's intentional
// non-casing imperfections (its/it's, missing commas, fragments) untouched.
// Fixes: pronoun I (+ I'm/I've/I'd/I'll), the name Artem, and sentence/line
// starts. Skips a small set of intentionally lowercase-initial tokens.
const _KEEP_LOWER_INITIAL = /^(iOS|iPhone|iPad|iMac|eCommerce|eBay|gTLD|macOS)\b/
function _humanizeCasing(s) {
  if (!s) return ''
  let t = s
  // 1) Pronoun "I" and its contractions. \bi\b matches standalone "i" AND the
  //    "i" in "i'm / i've / i'd / i'll" (apostrophe is a word boundary).
  t = t.replace(/\bi\b/g, 'I')
  // 2) The name. Always capital A.
  t = t.replace(/\bartem\b/g, 'Artem')
  // 3) Sentence/line starts → capitalise the first letter, unless the word is a
  //    known lowercase-initial token (iOS, eCommerce…). Triggers: start of text,
  //    after . ! ? (with optional closing quote/paren) + whitespace, or after a
  //    newline (with optional bullet marker).
  t = t.replace(
    /(^|[.!?]['")\]]?[ \t]+|\n[ \t]*(?:[-*•][ \t]+)?)([a-z])/g,
    (full, pre, ch, offset, str) => {
      const rest = str.slice(offset + pre.length)
      if (_KEEP_LOWER_INITIAL.test(rest)) return full
      return pre + ch.toUpperCase()
    }
  )
  // Reduce the em-dash / spaced-hyphen connector — ChatGPT's single most
  // recognizable punctuation tell (the current letters use " - " in nearly every
  // sentence). Keep the FIRST as an occasional human dash; convert the rest to
  // commas. Only a SPACED dash directly before a lowercase word (a clause
  // connector) is touched — never hyphenated compounds ("high-intent"), numeric
  // ranges ("300-500", "9am - 5pm"), or dashes before a capitalised proper noun.
  {
    let dashCount = 0
    t = t.replace(/[ \t]+[-–—][ \t]+(?=[a-z])/g, () => (++dashCount === 1 ? ' - ' : ', '))
  }
  return t
}

// Strip any stray three-tag-protocol markup from text that ends up in a chat
// bubble. Safety net for when the model emits malformed tags (e.g. a closing
// </remarks> with no opening tag, or an unclosed <chat_reply>) — the regex
// extraction fails, we fall back to the raw reply, and without this the user
// sees / copies literal "<chat_reply>", "</remarks>", "<answer>" artefacts.
function _stripProtocolTags(s) {
  if (!s) return ''
  return s
    // Remove opening/closing tags for all protocol elements, including any
    // attributes (e.g. <answer q="...">). Leaves the inner text intact.
    .replace(/<\/?\s*(?:remarks|proposal|chat_reply|answer)(?:\s+[^>]*)?>/gi, '')
    // Collapse the blank lines the removed tags leave behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Reduce stored chat messages to the {role, content} shape the Anthropic
// Messages API + /chat Pydantic model accept. Our assistant messages can
// carry UI-only fields (notably `answers` — structured screening-question
// blocks); sending them raw triggers "messages.N.answers: Extra inputs are
// not permitted". Folds answer text into content so history context survives,
// then drops empty messages.
function _sanitizeMessagesForApi(msgs) {
  return (msgs || []).map(m => {
    let content = m.content || ''
    if (Array.isArray(m.answers) && m.answers.length) {
      const answerText = m.answers.map((a, i) => `Answer ${i + 1}: ${a.text}`).join('\n\n')
      content = content && content.trim() ? `${content}\n\n${answerText}` : answerText
    }
    return { role: m.role, content }
  }).filter(m => m.content && m.content.trim())
}

// One copy-paste-ready answer to an additional/screening question, rendered
// inside an assistant chat bubble. The Copy button copies ONLY `text` (the
// clean paste-ready answer) — never the label or any surrounding commentary.
function AnswerBlock({ q, text, index }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#00c8d4', letterSpacing: '0.04em' }}>
          Q{index + 1}{q ? ` · ${q}` : ''}
        </span>
        <button
          onClick={copy}
          title="Copy this answer — paste straight into Upwork"
          style={{
            marginLeft: 'auto', flexShrink: 0,
            padding: '3px 10px', fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
            border: '1px solid ' + (copied ? '#00d070' : 'var(--border2)'),
            borderRadius: 4, cursor: 'pointer',
            background: copied ? 'rgba(0,208,112,0.12)' : 'var(--bg2)',
            color: copied ? '#00d070' : 'var(--text2)',
            transition: 'all 0.15s',
          }}
        >
          {copied ? '✓ Copied' : '⎘ Copy'}
        </button>
      </div>
      <div style={{ padding: '9px 11px', fontSize: 12, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </div>
    </div>
  )
}

function InlineChat({ job, systemSuffix, extraContext, onMessagesChange, onRework, reworkLabel = '↺ Rework above', chatId = 'chat', onProposalRewrite, currentProposalText, fillHeight = false }) {
  const _kind = `chat.${chatId}`
  const _readStored = (jid) => {
    if (jid == null) return []
    const s = _lsLoad(_kind, jid)
    return Array.isArray(s) ? s : []
  }

  // Initial state reads directly from localStorage so the chat is present on
  // first render. No useEffect-based "restore" → no race with the save effect.
  const [messages, _setMessagesRaw] = useState(() => _readStored(job?.id))
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [formedRule, setFormedRule] = useState(null) // { text, saving, saved }
  const [formingRule, setFormingRule] = useState(false)
  // "Additional Questions" mode: when armed, the next message is treated as the
  // client's screening/additional questions → the generator reworks the cover
  // letter to REMOVE the overlapping content AND emits one standalone answer
  // per question. Armed by the button, consumed (reset) on the next send.
  const [addlQMode, setAddlQMode] = useState(false)
  const [ruleConflict, setRuleConflict] = useState(null) // { newRuleText, conflictingRule, explanation }
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Tracks which job the current `messages` array belongs to. Used to guard
  // against saving an in-flight `messages` value to the wrong job's storage
  // key when the user switches jobs.
  const messagesJobIdRef = useRef(job?.id ?? null)

  // Wrapper around setMessages that ALSO persists to localStorage synchronously
  // inside the state updater. This avoids useEffect-based saves entirely, which
  // sidesteps React 18 Strict Mode's double-effect-fire wiping storage with the
  // initial empty state.
  const setMessages = (updater) => {
    _setMessagesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      const jid = messagesJobIdRef.current
      if (jid != null) {
        if (!next || next.length === 0) _lsRemove(_kind, jid)
        else _lsSave(_kind, jid, next)
      }
      return next
    })
  }

  // Notify parent of message changes — used by ProposalColumn to keep its
  // chatMessagesRef in sync so regenerate() can pick up chat adjustments.
  useEffect(() => {
    if (onMessagesChange) onMessagesChange(messages)
  }, [messages])

  // On job switch: reload that job's saved messages and update the ref so
  // subsequent saves go to the new job's storage key.
  useEffect(() => {
    if (messagesJobIdRef.current === (job?.id ?? null)) return
    messagesJobIdRef.current = job?.id ?? null
    _setMessagesRaw(_readStored(job?.id))
    setInput('')
    setError(null)
    setFormedRule(null)
  }, [job?.id])

  // Trigger rework: parent re-runs the column's main action (analyse/generate) with chat as adjustments.
  // Adds a brief status message in the chat so the user knows it fired.
  const triggerRework = (msgsForParent) => {
    if (!onRework) return
    setMessages(prev => [...prev, { role: 'assistant', content: '⟳ Reworking above with your notes…' }])
    onRework(msgsForParent)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const buildSuffix = () => [
    extraContext ? `## Current Context\n${extraContext}` : '',
    systemSuffix || '',
  ].filter(Boolean).join('\n\n')

  // Detect short rework command — single-word "rework" (with optional punctuation),
  // or phrases like "rework above", "redo", "re-analyse with this", "regenerate"
  const REWORK_PATTERN = /^(rework|redo|re-?analy[sz]e|regenerate|run again)\b[\s,.!]*$|^(rework|redo|re-?analy[sz]e|regenerate)\b.*\b(above|now|please|with (these|this|my) (notes|tweaks|feedback|adjustments))/i

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')

    // "rework" command → bypass /chat, hand the full transcript to the parent column
    if (onRework && REWORK_PATTERN.test(text)) {
      triggerRework(newMessages)
      return
    }

    setSending(true)
    setError(null)
    try {
      // Send at most the last 10 messages to keep input tokens low.
      // The full history stays in `messages` state for display.
      //
      // SANITIZE to {role, content} — assistant messages carry an `answers`
      // array (and possibly other UI-only fields) that the API rejects.
      const apiMessages = _sanitizeMessagesForApi(newMessages.slice(-10))

      // Proposal-column chats use a tagged-response protocol so Claude can
      // either (a) rewrite the cover letter, or (b) produce a separate
      // chat-only deliverable (e.g. a paragraph answering an additional
      // question the client asked), WITHOUT mixing the two. The previous
      // protocol forced every reply to also rewrite the cover letter, which
      // is why "answer this client question" requests ended up injecting
      // paragraphs into the cover letter instead of staying in chat.
      //
      // The three tags Claude can emit:
      //   <remarks>      always — one short paragraph: what Claude did + why
      //   <proposal>     ONLY when the cover letter actually needs changing
      //   <chat_reply>   when the user wants a chat-only deliverable (answer
      //                  to an additional client question, brainstormed
      //                  variants, etc.) — full text shown in the chat bubble
      //
      // Decision rule for Claude:
      //   • User is refining the COVER LETTER → emit <proposal>, omit <chat_reply>
      //   • User wants a STANDALONE answer/paragraph → emit <chat_reply>, omit <proposal>
      //   • Ambiguous / discussion only → omit both, just <remarks>
      const isProposalChat = !!onProposalRewrite
      let effectiveSuffix = buildSuffix()
      if (isProposalChat) {
        effectiveSuffix += (effectiveSuffix ? '\n\n' : '') + [
          '## CURRENT PROPOSAL DRAFT (the text in the top textarea)',
          (currentProposalText && currentProposalText.trim()) || '(empty — no proposal generated yet)',
          '',
          '## RESPONSE FORMAT — strict, no exceptions',
          'Respond using ONE or TWO of the tagged sections below. <remarks> is always required. Pick <proposal> XOR <chat_reply> based on what the user is asking for; never both. No text outside the tags.',
          '',
          '<remarks>',
          'One short paragraph (1-3 sentences) for Artem, explaining what you produced and why. Cite rule numbers when applying them (e.g. "Applied Rule 5"). Do NOT include the deliverable text here — that goes in the other tag.',
          'NEVER narrate the protocol itself: do not write sentences like "I\'m using <chat_reply>", "this requires a standalone answer so I\'m using…", or name any of the tags. Artem never sees the tag names — talk about the WORK ("here\'s a paste-ready answer to their screening question"), not the mechanism.',
          '</remarks>',
          '',
          'EMIT <proposal> WHEN the user is asking you to modify the cover letter in the top textarea (rewrite a section, apply a rule, tighten phrasing, change tone, etc.).',
          '<proposal>',
          'The COMPLETE updated cover letter, exactly as it should appear in the textarea. Write the full text even for small changes.',
          '</proposal>',
          '',
          'EMIT <chat_reply> INSTEAD WHEN the user is asking for a standalone deliverable that should NOT be merged into the cover letter — most often: drafting a separate answer to an additional question the client posted (Upwork "Additional Questions" field), brainstorming variants for Artem to consider, explaining strategy, or producing copy that targets a different field.',
          '<chat_reply>',
          'The full standalone deliverable, written in Artem\'s casual voice (correct casing — always capital "I" and "Artem", capitalised sentence starts; same relaxed tone as the cover letter). This is what Artem will copy and paste into the relevant Upwork field. Do NOT touch the cover letter.',
          '</chat_reply>',
          '',
          'ADDITIONAL / SCREENING QUESTIONS MODE (mandatory when it applies):',
          'When the user pastes one or more screening or "additional questions" from the job posting (a numbered list, or several distinct question sentences), you MUST produce a separate, standalone, paste-ready answer for EACH question — one at a time. This is the case EVEN IF the cover letter already covers the same material: the client pastes these into separate Upwork answer fields, so each answer must stand completely on its own. NEVER reply "this is already covered in the proposal" or "no separate answer needed" — that is wrong and unhelpful here; always write the actual answers.',
          'Put the answers inside <chat_reply>, one <answer> block per question, in the order asked. Format each exactly like this:',
          '<answer q="3-6 word label for this question">',
          'the clean, paste-ready answer in Artem\'s conversational voice — correct casing (always capital "I", capitalised sentence starts), with at most 1 minor non-casing typo or punctuation quirk to sound human. Self-contained, complete on its own, NO "see above", NO "as mentioned", NO reference to the proposal or other answers. Plain text only, no markdown.',
          '</answer>',
          'Emit exactly one <answer> block per question. The text inside each <answer> is what Artem copies straight into Upwork, so it must be clean and need zero editing. Any commentary you have goes in <remarks>, never inside <answer>.',
          'EXPERIENCE / PAST-WORK QUESTIONS — USE THE COVER LETTER\'S CASE-STUDY FORMAT (mandatory): when a question asks about recent or similar projects, relevant experience, past results, examples, or client references, the answer MUST carry 1-3 relevant case studies written EXACTLY as they are in the cover letter — the case name, its inline attachment notice, and its REAL figures. Format each on its own line, e.g. "FridgeFix (attached in profile highlights): local appliance repair in California, -92% cost per conversion and +1,405% conversions after purging wasted spend and tightening intent targeting." PDF cases keep "(attached as PDF)". Rules: (a) match the case DOMAIN to the question — PPC/Google Ads cases for an Ads question, SEO cases for an SEO question, web-dev cases for a build question; (b) always include the concrete numbers, never a vague "extensive experience with similar projects"; (c) use ONLY approved case studies and their real figures — never invent a client, a metric, or a vertical; (d) the answer must still stand alone, so briefly say what the work WAS, not just the result.',
          '',
          'If neither rewrite nor chat-deliverable applies (pure discussion, clarification, "what do you think of X" without producing copy), emit only <remarks> and skip both <proposal> and <chat_reply>.',
        ].join('\n')

        // Per-turn HARD directive when the user's current message is clearly a
        // screening / additional question. The model has repeatedly NARRATED
        // its plan in <remarks> ("Providing a standalone response in <chat_reply>
        // with one <answer> block…") and then failed to emit the actual <answer>.
        // This makes the answer output non-optional for THIS turn and forbids
        // the planning narration explicitly.
        // Conservative — only fire on EXPLICIT screening-question markers, not
        // any question (would mis-trigger on discussion like "what do you think?").
        const SCREENING_Q_RE = /\b(?:additional|screening)\s+questions?\b|\bplease\s+(?:answer|include\s+in\s+your\s+proposal)\b|\banswer\s+(?:these|the\s+following)\s+questions?\b|^\s*\d+[\.\)]\s+.+\?|^\s*(?:please\s+)?(?:describe|tell\s+(?:us|me)\s+about|share\s+(?:\d|some|your|a\s+few|examples?|case\s+stud)|list\s+(?:any|your|some)|walk\s+(?:us|me)\s+through|what(?:'s|\s+is|\s+are)\s+your\s+(?:experience|approach)|how\s+(?:would|do)\s+you\s+(?:approach|handle))\b/im
        // The "Additional Questions" button arms addlQMode; a pasted question
        // also auto-detects. Either path triggers the same mandatory directive.
        const looksLikeScreeningQ = addlQMode || SCREENING_Q_RE.test(text)
        if (looksLikeScreeningQ) {
          effectiveSuffix += '\n\n' + [
            '## THIS TURN IS ADDITIONAL / SCREENING QUESTIONS — MANDATORY DUAL OUTPUT',
            'The user just pasted the client\'s additional/screening questions. For THIS reply you MUST emit BOTH deliverables (this is the ONE case where <proposal> AND <chat_reply> appear together — the usual "pick one" rule does NOT apply here):',
            '',
            '1. <chat_reply> with one <answer> block per question — the ACTUAL paste-ready answer fully written out, in order. These go into Upwork\'s separate answer fields.',
            '',
            '2. <proposal> = the cover letter REWORKED to REMOVE any content that now overlaps with these answers. The screening answers and the cover letter are read together by the client, so the letter must NOT pre-answer the questions — that reads as copy-paste padding. Strip the paragraphs/sentences in the letter that duplicate what the <answer> blocks now cover, and preserve everything that does NOT overlap.',
            '',
            'CASE-STUDY / PROOF / EXPERIENCE OVERLAP — ZERO DUPLICATION RULE:\n\nThe cover letter and the screening answers are displayed on the same Upwork page. Any case study, campaign result, or client name that appears in BOTH the letter and an answer is duplication — the client reads it twice and it reads as copy-paste padding. This is the exact failure to prevent.\n\nRULE: Each piece of proof goes in EXACTLY ONE place — either the letter or an answer, never both.\n\nWHEN a screening question explicitly asks for proof, campaigns run, client examples, or companies worked with:\n→ Put all case-study details (client name + metrics + context) in the ANSWER only.\n→ REMOVE those same case studies from the cover letter entirely — including any one-liner proof citations like "FridgeFix: +1,405% conversions." Replace the proof block in the letter with a single cross-reference line: "Campaign examples and client references in the answers below." This keeps the letter clean and directs the client to the answers for proof.\n\nWHEN a screening question asks about approach, methodology, or strategy (not asking for proof/examples):\n→ Put the strategic content in the ANSWER.\n→ Keep brief proof citations in the letter IF they are not duplicated in any answer.\n\nNEVER have the same client name + metric appear in both the letter and an answer. If FridgeFix appears in any answer, it must not appear in the letter, even as a one-liner. If Skin Reboot appears in the letter, it must not appear in any answer.',
            '',
            'INLINE APPLICATION-QUESTION SECTIONS (second most common duplication source): When the cover letter contains labeled sections that directly answer the client\'s application/screening questions — look for "On [topic]:" headers, numbered answers, or paragraphs that map one-to-one to the questions being answered — STRIP those sections from the letter too. They are duplicates of what goes into Upwork\'s separate answer fields. Example: if the letter has "On AI workflow: ..." and "On the three-pronged strategy: ..." as separate paragraphs, and the screening questions are asking exactly those things, delete those paragraphs from the letter. What stays: the hook, credentials, brief proof, offer, rate, close. What goes: any section that IS an answer to a question Artem is now providing a standalone answer for.',
            '',
            '<proposal> PURITY — ABSOLUTE: inside the <proposal> tags put NOTHING but the final cover-letter text itself. The very first character must be the first word of the letter (the credentials hook). FORBIDDEN inside <proposal>: any explanation of what you changed ("stripped X", "kept only Y", "removed the…", "applied Rule…"), any "here is the reworked letter" preamble, any of the <answer> text, and any earlier/longer version of the letter. Output EXACTLY ONE version of the letter — never the old long version followed by the new short one. Anything you want to say about your edits goes in <remarks>, never in <proposal>.',
            '',
            'HARD RULES:',
            '- NEVER reply "this is already covered in the proposal" or "no separate answers needed" — that is the exact failure to avoid. The whole point is to MOVE the content OUT of the letter and INTO standalone answers.',
            '- NEVER just narrate the plan ("splitting into two deliverables…", "I\'m using…"). Emit the actual <proposal> and <answer> text. Narration with no deliverable is a FAILURE.',
            '- Keep <remarks> to ONE short sentence about the work, no tag names, no plan description.',
            '- NEVER reference internal tooling, databases, or knowledge bases in the answer text. Do NOT write "in the KB", "in my KB", "not in the KB right now", or any variant. The client has no idea what a KB is.',
            '- CASE-STUDY BUSINESS-MODEL INTEGRITY: never relabel a case study\'s real industry/business model to match the client\'s vertical. Skin Reboot is skincare ECOMMERCE (NOT SaaS/software); Nectar Flowers is an ecommerce florist; FridgeFix/House Painting are local services; Derma Solution is a medical clinic; Atlant is real estate. If the client asks "do you have experience with X" (e.g. SaaS) and there is NO case in that exact vertical, do NOT fake it by calling an ecommerce case "a SaaS case". Instead answer honestly: cite the closest case by its REAL model and bridge the transferable mechanic ("same trial-vs-paid ROAS tracking challenge, different business model"), or say the experience is adjacent and lean on the method. A relabeled case is a lie the client catches instantly.',
            '',
            'WHEN A SCREENING QUESTION ASKS FOR PROOF, CAMPAIGNS, OR COMPANY NAMES:',
            '',
            'STEP 1 — scan the available case studies for anything that works as B2B or professional-service proof. Examples that qualify: Trailers (commercial vehicle/equipment dealer = B2B), Derma Solution (medical aesthetics clinic = professional service), kitchen remodeling in LA (contractor/trade business). LEAD WITH THESE. Do not preface with "I don\'t have B2B case studies" — just cite the case study and the result.',
            '',
            'STEP 2 — after citing 2-3 relevant case studies with results, add 1-2 sentences personalising to THIS client\'s specific challenge using details from their job description. Show you understand their exact funnel problem — for a VA placement company: blocking job-seeker traffic, filtering inquiry quality, capturing only business owners ready to hire. This is the proof of strategic fit.',
            '',
            'STEP 3 — one-line close if the client asked for companies by name and they\'re under NDA: "Client names are under NDA but happy to provide references on request." That\'s it. No paragraphs about it.',
            '',
            'ONLY use the NDA/no-public-case-study opener if truly NOTHING in the case study library applies even loosely. That is rare. Default is: find the closest match and cite it confidently.',
            '',
            'FORMAT: 3-5 short paragraphs. No bullet lists. No preamble. No narration about what you are doing. Just the case studies, the results, and the client-specific insight.',
          ].join('\n')
        }
        // Inject Artem's real business facts (portfolio URLs, team size, pricing)
        // whenever this turn is a screening question OR the client is asking for
        // proof / portfolio / team / pricing — so paste-ready answers use real
        // data, platform-matched, instead of vague claims or placeholders.
        if (looksLikeScreeningQ || _PROOF_REQUEST_RE.test(text)) {
          const platformHint = `${job?.title || ''}\n${job?.description_full || job?.description_snippet || ''}\n${text}`
          effectiveSuffix += '\n\n' + buildArtemFactsBlock(platformHint)
        }
        // Consume the armed mode — it applies to this one turn only.
        if (addlQMode) setAddlQMode(false)
      }

      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          job_id: job?.id ?? null,
          system_suffix: effectiveSuffix,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(_friendlyApiError(data.detail, res.status))
      const reply = (data.content || []).map(b => b.text || '').join('')

      if (isProposalChat) {
        const remarksMatch    = reply.match(/<remarks>([\s\S]*?)<\/remarks>/i)
        const proposalMatch   = reply.match(/<proposal>([\s\S]*?)<\/proposal>/i)
        const chatReplyMatch  = reply.match(/<chat_reply>([\s\S]*?)<\/chat_reply>/i)
        // Strip stray protocol tags from each extracted field too — guards
        // against nested/duplicated tags inside a successfully-matched block.
        const remarksText  = remarksMatch ? _stripProtocolTags(remarksMatch[1]) : ''
        // Run the chat-reworked letter through the same deterministic cleaning
        // the generator uses (markdown + CJK strip, then casing) so a chat
        // rewrite can't reintroduce lowercase "i" / foreign-char glitches.
        const newProposal  = proposalMatch ? _humanizeCasing(_stripKbLeak(_fixPdfCaseLabelMisattribution(_stripFabricatedVerticalOpener(_stripFabricatedOpener(_stripDuplicateCaseBlockLabel(_stripLeadingNarration(_stripDuplicateAuditSampleMention(_stripDuplicateAttachmentLabel(_ensureCaseStudyHighlightsLeadIn(_cleanPasteText(_stripProtocolTags(proposalMatch[1])))))))))))) : null
        const chatReplyText = chatReplyMatch ? chatReplyMatch[1].trim() : null

        // Cover-letter rewrite path — only push when content actually changed.
        const letterUpdated = !!(newProposal && newProposal !== (currentProposalText || '').trim())
        if (letterUpdated) {
          onProposalRewrite(newProposal)
        }

        // Parse <answer> blocks (additional-questions mode) so each renders as
        // its own copy-paste block. Search chatReplyText first; if the
        // <chat_reply> wrapper was malformed (no opening tag etc.), fall back
        // to scanning the WHOLE raw reply — the <answer> blocks themselves are
        // usually well-formed even when the wrapper isn't.
        let parsedAnswers = null
        const _scanAnswers = (src) => {
          if (!src) return null
          const ansRe = /<answer(?:\s+q="([^"]*)")?\s*>([\s\S]*?)<\/answer>/gi
          const out = []
          let am
          while ((am = ansRe.exec(src)) !== null) {
            // Clean paste text (markdown + em/en dash → hyphen) so the per-answer
            // Copy button gives Upwork-ready text, same as the cover letter.
            const text = _humanizeCasing(_cleanPasteText(_stripProtocolTags(am[2])))
            if (text) out.push({ q: (am[1] || '').trim(), text })
          }
          return out.length ? out : null
        }
        parsedAnswers = _scanAnswers(chatReplyText) || _scanAnswers(reply)

        // Compose the visible chat bubble. Every branch runs through
        // _stripProtocolTags so a malformed-tag fallback never leaks literal
        // "<chat_reply>" / "</remarks>" artefacts into what the user sees/copies.
        if (parsedAnswers) {
          // When this turn ALSO reworked the cover letter (the de-dupe /
          // additional-questions flow), prepend a clear cue so it's obvious
          // both deliverables landed: the letter updated AND N answers below.
          const cue = letterUpdated
            ? `✓ Cover letter updated (de-duplicated) · ${parsedAnswers.length} answer${parsedAnswers.length === 1 ? '' : 's'} below`
            : ''
          const baseRemarks = _stripProtocolTags(remarksText) || ''
          const content = cue ? (baseRemarks ? `${cue}\n\n${baseRemarks}` : cue) : baseRemarks
          setMessages(prev => [...prev, { role: 'assistant', content, answers: parsedAnswers }])
        } else {
          let bubble
          if (chatReplyText) {
            // chat_reply is paste-ready copy → clean markdown + dashes too.
            const cleanReply = _humanizeCasing(_cleanPasteText(_stripProtocolTags(chatReplyText)))
            bubble = remarksText ? `${remarksText}\n\n${cleanReply}` : cleanReply
          } else if (remarksText) {
            bubble = remarksText
          } else {
            // Nothing parsed — strip tags off the raw reply so the user still
            // gets clean, copyable text instead of the protocol scaffolding.
            bubble = _cleanPasteText(_stripProtocolTags(reply))
          }
          setMessages(prev => [...prev, { role: 'assistant', content: bubble }])
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const formRule = async () => {
    if (!messages.length || formingRule) return
    setFormingRule(true)
    setFormedRule(null)
    try {
      const ruleRequest = {
        role: 'user',
        content: 'Based on this conversation, distill ONE concise rule (1-2 sentences max) that captures what I want to remember or apply in future jobs/cover letters. Output ONLY the rule text — no preamble, no quotes, no label.',
      }
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [..._sanitizeMessagesForApi(messages.slice(-8)), ruleRequest],
          job_id: job?.id ?? null,
          system_suffix: buildSuffix(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(_friendlyApiError(data.detail, res.status))
      const text = (data.content || []).map(b => b.text || '').join('').trim()
      setFormedRule({ text, saving: false, saved: false })
    } catch (e) {
      setError(e.message)
    } finally {
      setFormingRule(false)
    }
  }

  const saveRuleToKB = async (text) => {
    const res = await fetch('/kb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'rule',
        title: `Rule: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
        content: text,
        tags: 'rule',
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `API ${res.status}`)
    }
  }

  const addRuleToKB = async () => {
    if (!formedRule?.text) return
    setFormedRule(prev => ({ ...prev, saving: true }))
    try {
      const conflict = await checkRuleConflict(formedRule.text)
      if (conflict) {
        setFormedRule(prev => ({ ...prev, saving: false }))
        setRuleConflict({ newRuleText: formedRule.text, ...conflict })
        return
      }
      await saveRuleToKB(formedRule.text)
      setFormedRule(prev => ({ ...prev, saving: false, saved: true }))
    } catch (e) {
      setFormedRule(prev => ({ ...prev, saving: false }))
      setError(e.message)
    }
  }

  const resolveConflict = {
    keepNew: async () => {
      try {
        await fetch(`/kb/${ruleConflict.conflictingRule.id}`, { method: 'DELETE' })
        await saveRuleToKB(ruleConflict.newRuleText)
        setFormedRule(prev => ({ ...prev, saved: true }))
      } catch (e) { setError(e.message) }
      setRuleConflict(null)
    },
    keepExisting: () => {
      setRuleConflict(null)
    },
    saveBoth: async (newText, existingText) => {
      try {
        await fetch(`/kb/${ruleConflict.conflictingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: existingText, title: `Rule: ${existingText.slice(0, 60)}${existingText.length > 60 ? '…' : ''}` }),
        })
        await saveRuleToKB(newText)
        setFormedRule(prev => ({ ...prev, saved: true }))
      } catch (e) { setError(e.message) }
      setRuleConflict(null)
    },
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      // When fillHeight is on (proposal column, with a resize-controlled
      // wrapper), the chat fills its parent and the messages area grows with
      // it. Otherwise the chat stays at its natural height with a 380px cap.
      ...(fillHeight ? { flex: 1, minHeight: 0 } : { flexShrink: 0 }),
    }}>

      {/* Toolbar — always above the scroll area, never hidden */}
      {messages.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={formRule}
              disabled={formingRule || sending}
              className="btn-secondary"
            >
              {formingRule ? '…forming' : '✦ Form a Rule'}
            </button>
            {onRework && (
              <button
                onClick={() => triggerRework(messages)}
                disabled={sending}
                className="btn-secondary"
                title="Re-run with your chat notes applied"
              >
                {reworkLabel}
              </button>
            )}
          </div>
          <button
            onClick={() => { setMessages([]); setError(null); setFormedRule(null) }}
            className="btn-ghost"
          >
            Clear
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{
        padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 10,
        overflowY: 'auto',
        ...(fillHeight ? { flex: 1, minHeight: 0 } : { maxHeight: 380 }),
      }}>
        {messages.length > 0 && <div style={{ paddingTop: 8 }} />}
        {messages.map((m, i) => {
          return (
            <div key={i} style={{ display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-start' }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: m.role === 'user' ? '#0d2040' : '#00c8d4',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: '#fff',
              }}>
                {m.role === 'user' ? 'A' : 'C'}
              </div>
              <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Optional remarks/commentary prelude — shown above the answer
                    blocks. For plain messages this is the whole bubble. */}
                {m.content && (
                  <div style={{
                    background: m.role === 'user' ? 'var(--bg3)' : 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderRadius: m.role === 'user' ? '10px 3px 10px 10px' : '3px 10px 10px 10px',
                    padding: '8px 11px', fontSize: 12, lineHeight: 1.6,
                    color: m.answers ? 'var(--text2)' : 'var(--text)',
                    fontStyle: m.answers ? 'italic' : 'normal',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {m.content}
                  </div>
                )}
                {/* Per-question copy-paste answer blocks (additional-questions mode) */}
                {m.answers && m.answers.map((a, ai) => (
                  <AnswerBlock key={ai} q={a.q} text={a.text} index={ai} />
                ))}
              </div>
            </div>
          )
        })}
        {sending && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#00c8d4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0 }}>C</div>
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '3px 10px 10px 10px', padding: '10px 14px' }}>
              <svg width="28" height="10" viewBox="0 0 40 14">
                <circle cx="6" cy="7" r="3.5" fill="#00c8d4"><animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0s" repeatCount="indefinite"/></circle>
                <circle cx="20" cy="7" r="3.5" fill="#00c8d4"><animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.2s" repeatCount="indefinite"/></circle>
                <circle cx="34" cy="7" r="3.5" fill="#00c8d4"><animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.4s" repeatCount="indefinite"/></circle>
              </svg>
            </div>
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: '#ef4444', padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 4 }}>✗ {error}</div>
        )}

        {/* Formed rule bubble */}
        {formedRule && (
          <div style={{ background: 'rgba(0,200,212,0.08)', border: '1px solid rgba(42,184,184,0.35)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, color: '#00c8d4', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>✦ Formed Rule</div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{formedRule.text}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!formedRule.saved ? (
                <button
                  onClick={addRuleToKB}
                  disabled={formedRule.saving}
                  style={{
                    padding: '5px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                    background: formedRule.saving ? 'var(--bg3)' : '#00c8d4',
                    color: formedRule.saving ? 'var(--text3)' : '#fff',
                    border: 'none', borderRadius: 4, cursor: formedRule.saving ? 'wait' : 'pointer',
                  }}
                >
                  {formedRule.saving ? 'Saving…' : '✚ Add to KB'}
                </button>
              ) : (
                <span style={{ fontSize: 11, color: '#00d070', fontWeight: 600 }}>✓ Saved to KB</span>
              )}
              <button
                onClick={() => setFormedRule(null)}
                style={{ fontSize: 10, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px' }}
              >
                dismiss
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px' }}>
        {onProposalRewrite && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setAddlQMode(v => !v); requestAnimationFrame(() => inputRef.current?.focus()) }}
              title="Arm this, then paste the client's additional/screening questions and send. The cover letter is reworked to drop the overlap and you get a standalone answer per question."
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 700,
                background: addlQMode ? '#00c8d4' : 'var(--bg)',
                color: addlQMode ? '#fff' : 'var(--text2)',
                border: '1px solid ' + (addlQMode ? '#00c8d4' : 'var(--border2)'),
                borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {addlQMode ? '✓ Additional Questions — armed' : '＋ Additional Questions'}
            </button>
            {addlQMode && (
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                paste the client's questions below, then send → letter de-duped + one answer per question
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (e.altKey) {
                // Alt+Enter: insert newline at cursor position
                e.preventDefault()
                const ta = e.currentTarget
                const s = ta.selectionStart, end = ta.selectionEnd
                const next = input.slice(0, s) + '\n' + input.slice(end)
                setInput(next)
                requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
              } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                // Plain Enter: send
                e.preventDefault()
                send()
              }
            }
          }}
          placeholder={addlQMode ? "Paste the client's additional / screening questions here, then send…" : "Ask… (Enter to send, Alt+Enter for new line)"}
          rows={2}
          disabled={sending}
          style={{
            flex: 1, padding: '8px 10px', resize: 'none', outline: 'none',
            background: '#fff', border: '1px solid var(--border2)', borderRadius: 5,
            fontFamily: 'Inter, sans-serif', fontSize: 12, lineHeight: 1.5,
            color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 700,
            background: sending || !input.trim() ? 'var(--border)' : '#00c8d4',
            color: sending || !input.trim() ? 'var(--text3)' : '#fff',
            border: 'none', borderRadius: 5, alignSelf: 'stretch',
            cursor: sending || !input.trim() ? 'default' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {sending ? '…' : '↑'}
        </button>
        </div>
      </div>

      {ruleConflict && (
        <ConflictModal
          newRuleText={ruleConflict.newRuleText}
          conflictingRule={ruleConflict.conflictingRule}
          explanation={ruleConflict.explanation}
          onKeepNew={resolveConflict.keepNew}
          onKeepExisting={resolveConflict.keepExisting}
          onSaveBoth={resolveConflict.saveBoth}
          onClose={() => setRuleConflict(null)}
        />
      )}
    </div>
  )
}

// ── Draggable divider ──────────────────────────────────────────────────────
const COLUMN_WIDTHS_KEY = 'falconscout.columnWidths'

function _saveColumnWidths(wrapper) {
  if (!wrapper) return
  const cols = Array.from(wrapper.children).filter(c => c.dataset && c.dataset.colId)
  const widths = {}
  for (const c of cols) widths[c.dataset.colId] = c.offsetWidth
  try { localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths)) } catch {}
}

function _restoreColumnWidths(wrapper) {
  if (!wrapper) return
  let widths
  try { widths = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) || 'null') } catch {}
  if (!widths) return

  const cols = Array.from(wrapper.children).filter(c => c.dataset && c.dataset.colId)
  if (!cols.length) return

  const requested = cols.reduce((s, c) => s + (Number(widths[c.dataset.colId]) || 0), 0)
  if (!requested) return

  // Compute available horizontal room. Subtract dividers (the non-data-col-id
  // children) so we know exactly how much real estate the data columns get.
  const allChildren = Array.from(wrapper.children)
  const dividersWidth = allChildren
    .filter(c => !c.dataset || !c.dataset.colId)
    .reduce((sum, c) => sum + (c.offsetWidth || 0), 0)
  const clientW = wrapper.clientWidth || 0
  const available = Math.max(0, clientW - dividersWidth)

  // Scale-to-fit instead of clearing. The previous behaviour wiped localStorage
  // when widths didn't fit — but useLayoutEffect can fire before the parent
  // layout is settled, so `clientWidth` briefly reads 0 / too small, the
  // "doesn't fit" branch triggered, and the user's saved layout was destroyed
  // before the page even finished rendering. Now we never delete the persisted
  // state; we just clamp it proportionally for the current viewport.
  //   - widths fit (or wrapper not laid out yet — clientW too small to trust)
  //         → apply saved widths verbatim
  //   - widths exceed a real, laid-out wrapper → scale them down proportionally
  //     so the ratio is preserved but everything fits without horizontal clip
  let scale = 1
  // Only scale when we trust clientW. Below 200px means the wrapper isn't
  // laid out yet — applying the saved widths verbatim is correct; flex will
  // pick up the slack on the same frame and the layout reconciles.
  if (clientW > 200 && available > 0 && requested > available) {
    scale = available / requested
  }

  // If the scale required to fit is so aggressive that columns would shrink
  // below a usable size (e.g. zoom-out compressed the viewport beyond what
  // the saved layout supports), abandon the fixed widths and fall back to
  // pure flex layout — columns redistribute via flex: 1 + minWidth: 15%
  // and nothing overflows the wrapper. The user's saved widths are NOT
  // wiped from localStorage; they'll reapply once the viewport is wide
  // enough again.
  if (scale < 0.55 || (available > 0 && available < 300)) {
    for (const c of cols) {
      c.style.flex = ''
      c.style.width = ''
    }
    return
  }

  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    const w = widths[c.dataset.colId]
    // Last column always flex: 1 so it fills any remaining viewport space,
    // preventing the empty gap on the right when saved widths sum < available.
    if (i === cols.length - 1) {
      c.style.flex = '1'
      c.style.width = ''
    } else if (typeof w === 'number' && w > 0) {
      c.style.flex = 'none'
      c.style.width = Math.max(40, Math.floor(w * scale)) + 'px'
    }
  }
}

function Divider() {
  const [dragging, setDragging] = useState(false)

  const onMouseDown = (e) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const prev = e.currentTarget.previousSibling
    const next = e.currentTarget.nextSibling
    const wrapper = e.currentTarget.parentElement
    const startPrevW = prev.offsetWidth
    const startNextW = next.offsetWidth

    const onMove = (me) => {
      const dx = me.clientX - startX
      const totalW = startPrevW + startNextW
      const newPrev = Math.max(totalW * 0.15, startPrevW + dx)
      const newNext = Math.max(totalW * 0.15, startNextW - dx)
      if (newPrev + newNext <= totalW + 2) {
        prev.style.flex = 'none'
        prev.style.width = newPrev + 'px'
        next.style.flex = 'none'
        next.style.width = newNext + 'px'
      }
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Persist the new layout so it survives reloads / job switches
      _saveColumnWidths(wrapper)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Double-click: reset all columns to equal widths and clear saved layout
  const onDoubleClick = (e) => {
    const wrapper = e.currentTarget.parentElement
    const cols = Array.from(wrapper.children).filter(c => c.dataset && c.dataset.colId)
    cols.forEach(c => { c.style.flex = '1'; c.style.width = '' })
    try { localStorage.removeItem(COLUMN_WIDTHS_KEY) } catch {}
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · Double-click to reset equal widths"
      style={{
        width: 4, flexShrink: 0, cursor: 'col-resize',
        background: dragging ? '#00c8d4' : 'var(--border)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!dragging) e.currentTarget.style.background = '#00c8d4' }}
      onMouseLeave={e => { if (!dragging) e.currentTarget.style.background = 'var(--border)' }}
    />
  )
}

// ── AI Analysis column ─────────────────────────────────────────────────────
function AIAnalysisColumn({ job, hasEnrichment, bridgeReady, onEnrich }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [similar, setSimilar] = useState(null)      // { positive_count, cold_count, results, total_matched }
  const [similarOpen, setSimilarOpen] = useState(false)
  const [feedback, setFeedback] = useState(null) // 'liked' | 'disliked'
  const [enrichingForAnalysis, setEnrichingForAnalysis] = useState(false)
  const scrollRef = useRef(null)
  const cacheRef = useRef({}) // persists analysis per job id
  const chatMessagesRef = useRef([])  // latest chat transcript (kept in sync by InlineChat)

  // Turn the chat transcript into a system-prompt section the LLM will obey on the next run.
  const buildAdjustments = (msgs) => {
    if (!msgs || msgs.length === 0) return ''
    const transcript = msgs
      .filter(m => m.content && !m.content.startsWith('⟳ Reworking'))
      .map(m => `${m.role === 'user' ? 'Artem' : 'You (previous reply)'}: ${m.content}`)
      .join('\n\n')
    if (!transcript.trim()) return ''
    return `\n\nARTEM'S ADJUSTMENTS TO YOUR PREVIOUS ANALYSIS (from the chat below — these are his corrections; the previous verdict was wrong in the ways he describes; apply them now and produce a NEW verdict that reflects his feedback, even if the score changes substantially):\n${transcript}`
  }

  useLayoutEffect(() => {
    let cached = cacheRef.current[job?.id]
    // Hydrate from localStorage on cold start (page refresh wiped memory)
    if (!cached && job?.id != null) {
      const stored = _lsLoad('analysis', job.id)
      if (stored && stored.analysis) {
        cached = stored
        cacheRef.current[job.id] = stored
      }
    }
    if (cached) {
      setAnalysis(cached.analysis)
      setFeedback(cached.feedback)
    } else {
      setAnalysis(null)
      setFeedback(null)
    }
    setError(null)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [job?.id])

  // Persist to memory + localStorage whenever analysis/feedback changes
  useEffect(() => {
    if (job?.id != null && analysis) {
      const value = { analysis, feedback }
      cacheRef.current[job.id] = value
      _lsSave('analysis', job.id, value)
    }
  }, [analysis, feedback, job?.id])

  // "Share with Claude" hook — when the header button dispatches the event,
  // contribute this column's state to the snapshot collector object on event.detail.
  useEffect(() => {
    const onShare = (e) => {
      if (!e.detail) return
      e.detail.analysis = analysis || null
      e.detail.analysisChat = (chatMessagesRef.current || []).slice()
      e.detail.analysisFeedback = feedback || null
    }
    window.addEventListener('falconscout:share-with-claude', onShare)
    return () => window.removeEventListener('falconscout:share-with-claude', onShare)
  }, [analysis, feedback])

  // When enrichment was triggered from the Analyse button, fire analyse() as soon
  // as the job prop arrives with real enrichment data (App.jsx re-fetches on enrich complete).
  useEffect(() => {
    if (enrichingForAnalysis && (job.enriched_at || job.proposals || job.hire_rate)) {
      setEnrichingForAnalysis(false)
      analyse() // analyse is recreated each render and will have the fresh job in its closure
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.enriched_at, job.proposals, job.hire_rate, enrichingForAnalysis])

  // Cancel pending analyse if the extension signals an error
  useEffect(() => {
    const onEnrichError = () => setEnrichingForAnalysis(false)
    window.addEventListener('cockpit:enrich:error', onEnrichError)
    return () => window.removeEventListener('cockpit:enrich:error', onEnrichError)
  }, [])

  const saveFeedback = async (kind) => {
    setFeedback(kind)
    const tag = kind === 'liked' ? 'analysis_liked' : 'analysis_disliked'
    const content = `Job: ${job.title} (${job.client_country || 'unknown'}, ${job.hourly_rate_min ? `$${job.hourly_rate_min}-$${job.hourly_rate_max}/hr` : job.fixed_budget || 'rate n/a'})\nVerdict: ${analysis.verdict} ${analysis.score}/10\nSummary: ${analysis.summary}\nReasons: ${analysis.reasons?.join('; ')}\nFlags: ${analysis.flags?.join('; ') || 'none'}`
    await fetch('/kb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'feedback', title: `${kind === 'liked' ? '👍' : '👎'} Analysis: ${job.title}`, content, tags: tag }),
    })
  }

  const analyse = async (adjustmentsArg, options = {}) => {
    // Adjustments: if not explicitly passed, pull the latest chat transcript so even a plain
    // Re-analyse picks up the user's notes since the last run.
    const adjustments = typeof adjustmentsArg === 'string'
      ? adjustmentsArg
      : buildAdjustments(chatMessagesRef.current)

    // coreOnly: pull only Core entries (rules + is_core=true) for a fast, cheap
    // re-analysis after a rule or Core entry change. Default analyse() still
    // injects Core entries (case studies, notes) but layers feedback examples
    // on top so the model has stylistic guidance from past liked analyses.
    const { coreOnly = false } = options

    // If not yet enriched, trigger enrichment first; this function re-fires via useEffect when done
    if (!hasEnrichment) {
      if (!bridgeReady) {
        setError('Extension not connected. Reload this tab (F5), then try again.')
        return
      }
      setEnrichingForAnalysis(true)
      onEnrich()
      return
    }
    setLoading(true)
    setError(null)
    setAnalysis(null)
    setFeedback(null)
    setSimilar(null)
    setSimilarOpen(false)
    try {
      // Fetch rules + Core entries (always); style examples only on full pass.
      let rulesText = ''
      let examplesText = ''
      let coreContextText = ''
      try {
        const fetches = [
          fetch('/kb?type=rule'),
          // Core entries — same set the Generator's Rescan uses. The backend's
          // is_core=true filter implicitly includes rules; we filter those out
          // below to avoid duplicating them in the prompt.
          fetch('/kb?is_core=true'),
        ]
        if (!coreOnly) {
          fetches.push(fetch('/kb?type=feedback&tag=analysis_liked'))
        }
        const results = await Promise.all(fetches)
        const [rulesRes, coreRes, examplesRes] = results

        if (rulesRes && rulesRes.ok) {
          const allRules = [...(await rulesRes.json())].sort((a, b) => (a.id || 0) - (b.id || 0))
          // Routing: the analyser only needs analyser-scoped rules (skip/fit/
          // rate/threshold). The ~23 cover-letter generation rules are noise
          // here and were diluting the verdict. Number by stable DB id.
          const rules = rulesForAnalyser(allRules)
          console.log(`[Falcon] Analyser: ${rules.length}/${allRules.length} rules after scope routing`)
          if (rules.length > 0) {
            rulesText = '\n\nCRITICAL RULES — apply these FIRST before anything else. They override general scoring. When a rule applies, refer to it in your flags/reasons by WHAT IT SAYS (paraphrase its content), NEVER by a number — citing rule numbers from memory produces hallucinated numbers that do not exist.\n' +
              rules.map(r => `- ${r.content}`).join('\n')
          }
        }
        if (coreRes && coreRes.ok) {
          // Skip rules (already in their own section) and cap each entry's size
          // to keep the prompt lean — Core is meant to be tight.
          const coreEntries = (await coreRes.json()).filter(e => e.type !== 'rule')
          if (coreEntries.length > 0) {
            coreContextText = '\n\nCORE KB CONTEXT — Artem has flagged these as the always-on subset of his knowledge base. Weight them when judging fit (capabilities, past wins, vertical strengths, red flags he\'s learned). Never invent facts outside this list:\n' +
              coreEntries.map((e, i) => {
                const body = (e.content || '').slice(0, 1200)
                return `[${e.type}] ${e.title}\n${body}`
              }).join('\n\n')
          }
        }
        if (examplesRes && examplesRes.ok) {
          const examples = await examplesRes.json()
          if (examples.length > 0) {
            examplesText = '\n\nEXAMPLES OF ANALYSES ARTEM LIKED (match this style and reasoning depth):\n' +
              examples.slice(0, 3).map((e, i) => `Example ${i+1}:\n${e.content}`).join('\n\n')
          }
        }
      } catch {}

      // Prefer the full description scraped by the enricher; the Telegram bot's
      // posting often truncates with "..." so description_snippet is unreliable.
      // The raw Telegram message is a last-ditch fallback.
      const fullDescription = (job.description_full || job.description_snippet || job.raw_message || '').trim()
      // Precompute the three mandatory-flag signals so they survive even if
      // Claude drifts past the system-prompt instructions. We append them to
      // the user message as forced-include items.
      const _avgRate = Number(job.avg_rate) || 0
      const _interviewing = Number(job.interviewing) || 0
      // Domain-aware rate floor. Artem's DEVELOPER rate is $40/hr; his PPC/SEO
      // floor is $30/hr. A web-dev job paying $30-39 IS below his dev rate, so it
      // must be flagged — a flat $30 floor under-rated those jobs.
      const _WEBDEV_RATE_RE = /\b(wordpress|woocommerce|elementor|shopify|webflow|wix|squarespace|web\s*develop\w*|website\s+develop\w*|web\s+developer|landing\s+page|front[-\s]?end|full[-\s]?stack|\bhtml\b|\bcss\b|javascript|\breact\b|vue\.?js|\bphp\b|laravel|\bplugin\b|theme\s+(?:development|customi[sz]ation)|page\s*speed|core\s+web\s+vitals|web\s+design|bug\s*fix|site\s+build|custom\s+module|opencart)\b/i
      const _isWebDevJob = _WEBDEV_RATE_RE.test(`${job.title || ''} ${job.category || ''} ${job.keywords || ''} ${fullDescription}`)
      const _rateFloor = _isWebDevJob ? 40 : 30
      const _floorLabel = _isWebDevJob ? `$${_rateFloor}/hr developer` : `$${_rateFloor}/hr`
      // PPC / GOOGLE ADS ACCOUNT AUDIT jobs are sold as a FIXED $300 / 1-working-day
      // deliverable — NOT an hourly engagement. So the hourly floor is irrelevant here and
      // a low posted ceiling or low client avg must NOT count against the job, and
      // "short-term / part-time / one-off" is the NATURE of an audit, not a risk.
      // (Owner instruction 2026-07-22: always apply to these, don't care about the rate.)
      const _PPC_AUDIT_JOB_RE = /\b(?:google\s*ads?|adwords|ppc|paid\s+search|\bsem\b)\b[^.\n]{0,80}\b(?:audit|review|assessment|health\s*check|analys[ei]s|analyse|analyze)\b|\b(?:audit|review|assessment|health\s*check)\b[^.\n]{0,80}\b(?:google\s*ads?|adwords|ppc|paid\s+search|\bsem\b)\b/i
      const _isPpcAuditJob = _PPC_AUDIT_JOB_RE.test(`${job.title || ''} ${job.category || ''} ${job.keywords || ''} ${fullDescription}`)
      const mandatoryFlags = []
      if (_isPpcAuditJob) {
        mandatoryFlags.push(`PPC / GOOGLE ADS ACCOUNT AUDIT — this is Artem's STANDARD productised deliverable: FIXED $300, delivered in 1 working day, with his Google Ads audit samples attached. Because it is a FIXED-FEE deliverable and NOT an hourly engagement, the hourly rate floor DOES NOT APPLY: do NOT deduct points for a low posted hourly ceiling or a low client historical avg rate, and do NOT raise any rate-floor-risk flag. "Short-term", "part-time", "small project" and "one-off" describe the NATURE of an audit — treat them as EXPECTED and NEUTRAL, never as negatives or scope-creep risk. This job type is always worth applying to: verdict APPLY and score 7-9 unless one of the four HARD disqualifiers genuinely applies.`)
      } else if (_avgRate > 0 && _avgRate < _rateFloor - 10) {
        mandatoryFlags.push(`Client historical avg rate $${_avgRate}/hr is FAR below Artem's ${_floorLabel} floor — strong rate-floor risk, cap verdict at MAYBE, -3 points`)
      } else if (_avgRate > 0 && _avgRate < _rateFloor - 5) {
        mandatoryFlags.push(`Client avg rate $${_avgRate}/hr is materially below Artem's ${_floorLabel} floor — posted ceiling unlikely to be realised, -2 points`)
      } else if (_avgRate > 0 && _avgRate < _rateFloor) {
        mandatoryFlags.push(`Client avg rate $${_avgRate}/hr is below Artem's ${_floorLabel} floor — expect rate pressure, -1 point`)
      } else if (_avgRate > 0 && _avgRate >= _rateFloor) {
        const _ceil = Number(job.hourly_rate_max) || 0
        mandatoryFlags.push(
          _ceil > 0 && _avgRate > _ceil
            ? `POSITIVE rate signal (NOT a risk — do not invert this): client historical avg $${_avgRate}/hr is ABOVE the posted $${_ceil}/hr ceiling AND above Artem's ${_floorLabel} floor. The posted range is conservative/placeholder; this client actually pays premium, so there is clear room to negotiate UP toward their norm. Do NOT deduct points, do NOT cap the verdict, and NEVER call this client "rate-floor risk", "budget-tier", or a "rate rejection risk". A client bidding a $${_ceil} ceiling is well within what they pay.`
            : `Client historical avg $${_avgRate}/hr meets or exceeds Artem's ${_floorLabel} floor — rate is a NON-issue (mild positive). No rate-floor deduction; do NOT flag any rate-floor risk.`
        )
      }
      if (_interviewing >= 10) {
        mandatoryFlags.push(`Client already interviewing ${_interviewing} candidates — shortlist is closing, cap verdict at MAYBE, -3 points`)
      } else if (_interviewing >= 5) {
        mandatoryFlags.push(`Client already interviewing ${_interviewing} candidates — funnel heavily shortlisted, -2 points`)
      } else if (_interviewing >= 3) {
        mandatoryFlags.push(`Client already interviewing ${_interviewing} candidates — funnel is filling, -1 point`)
      }
      // Connect COST is intentionally NOT a scoring factor: Artem boosts every
      // proposal, so the flat connects-required number doesn't change his calculus.
      // BOOST COMPETITION, however, IS meaningful — it shows how aggressively
      // rivals are boosting for the top slot (captured from the apply page when
      // available). The TOP boost bid is what Artem must outbid to lead the field.
      const _boostBids = Array.isArray(job.boost_bids) ? job.boost_bids : []
      const _boostConnects = _boostBids.map(b => Number(b.connects) || 0).filter(n => n > 0)
      const _topBoost = _boostConnects.length ? Math.max(..._boostConnects) : 0
      let _boostBucket = null
      if (_topBoost > 0) {
        if (_topBoost >= 100) {
          _boostBucket = 'heavy'
          mandatoryFlags.push(`Heavy boost competition (${_boostBids.length} boosters, top bid ${_topBoost} connects) — rivals are boosting hard for the top slot, so winning visibility costs a large boost. Real competition signal (Artem boosts everything, but leading THIS field is expensive). -1 point.`)
        } else if (_topBoost >= 50) {
          _boostBucket = 'moderate'
          mandatoryFlags.push(`Moderate boost competition (${_boostBids.length} boosters, top bid ${_topBoost} connects) — a meaningful boost is needed to lead the field. Informational, no point change.`)
        } else {
          _boostBucket = 'light'
          mandatoryFlags.push(`Light boost competition (${_boostBids.length} boosters, top bid ${_topBoost} connects) — the field isn't boosting hard; a modest boost wins a top slot. Mild positive on win-odds.`)
        }
      }

      // Telemetry (Phase C): record which analyser threshold flags fired.
      _recordViolations('analyser', job?.id, [
        (_avgRate > 0 && _avgRate < _rateFloor - 10) ? 'avgRate<<floor' : (_avgRate > 0 && _avgRate < _rateFloor - 5) ? 'avgRate<floor-5' : (_avgRate > 0 && _avgRate < _rateFloor) ? 'avgRate<floor' : null,
        _interviewing >= 10 ? 'interviewing>=10' : _interviewing >= 5 ? 'interviewing>=5' : _interviewing >= 3 ? 'interviewing>=3' : null,
        _boostBucket ? `boost:${_boostBucket}` : null,
      ])

      // Explicit, deterministic rate descriptor — so the analyser NEVER has to
      // INFER whether the rate is hourly vs fixed (a past hallucination: it
      // invented "$120 flat" / speculated "£120/hr" from a bare number). We
      // state the structure outright from the stored fields.
      const _hasHourly = job.hourly_rate_min != null || job.hourly_rate_max != null
      const _hasFixed = job.fixed_budget != null && String(job.fixed_budget).trim() !== ''
      let rateLine
      // For THIS job the applicable floor is stated explicitly so the model uses
      // the right number — $40/hr on web-dev jobs (Artem's developer rate),
      // $30/hr otherwise. This OVERRIDES the generic "$30/hr" in the rules below.
      const _floorDirective = _isWebDevJob
        ? `Artem's $40/hr DEVELOPER floor (this is a web-development job — use $40/hr, NOT the generic $30/hr, wherever the rules below reference his minimum)`
        : `Artem's $30/hr floor`
      if (_hasHourly) {
        rateLine = `Rate: HOURLY $${job.hourly_rate_min ?? '?'}-$${job.hourly_rate_max ?? '?'}/hr (this is an HOURLY rate — apply the RATE-RANGE rule, compare the CEILING to ${_floorDirective}).`
      } else if (_hasFixed) {
        // Anomalous-budget guard: a fixed figure that is implausibly large
        // (>= $50k as a one-off SEO/PPC deliverable) OR a fixed sum attached to
        // an "ongoing" role is almost always BAD/placeholder data — our capture
        // occasionally mis-grabs a number, and Upwork ongoing work is billed
        // hourly/monthly, never as a lump sum. This must NEVER drive a SKIP
        // (it was: a bogus $200k budget produced SKIP/3 on a perfect-fit job).
        // Reframe as "verify this" and tell the model to judge on scope + client.
        const _budgetNum = parseFloat(String(job.fixed_budget).replace(/[^0-9.]/g, '')) || 0
        const _ongoingLabel = /ongoing/i.test(String(job.project_type || ''))
        const _budgetAnomalous = _budgetNum >= 50000 || (_ongoingLabel && _budgetNum > 0)
        if (_budgetAnomalous) {
          rateLine = `Rate: the fixed-budget field shows $${job.fixed_budget}${job.project_type ? ` (${job.project_type})` : ''}, but treat this number as SUSPECT / UNVERIFIED DATA — NOT a fact and NOT a reason to skip. ${_ongoingLabel ? 'It is labeled an ONGOING role, which is normally billed hourly or monthly, not as a single fixed sum. ' : ''}${_budgetNum >= 50000 ? `$${job.fixed_budget} as a one-off SEO/PPC engagement is implausible and is almost certainly a capture error or a placeholder ceiling. ` : ''}A large or incoherent budget figure is NEVER a disqualifier — if anything a big budget is a positive signal. Do NOT call this job "unbiddable" or "structurally incoherent", do NOT build the verdict around this number, and do NOT deduct points for it. Add exactly ONE flag: "Budget figure ($${job.fixed_budget}) looks anomalous — verify before bidding". Then score the job on SCOPE FIT, CLIENT QUALITY, and the client's historical hourly rate, treating the budget as effectively unspecified.`
        } else {
          rateLine = `Rate: FIXED-PRICE budget $${job.fixed_budget} USD${job.project_type ? ` (${job.project_type})` : ''} — this is a FIXED budget, NOT hourly. Apply the FIXED/FLAT-PRICE rule: estimate effort in hours from the scope, then compute effective hourly = budget ÷ hours, and compare THAT to ${_floorDirective}. The budget is in USD as captured ("Budget: $X"); do NOT speculate about other currencies.`
        }
      } else {
        rateLine = `Rate: NOT SPECIFIED in the posting. Do NOT fabricate a rate, currency, or rate type. Treat the rate as genuinely unknown, add a flag "Rate not specified — cannot assess rate-floor risk", and do NOT let an invented rate drive the verdict up or down.`
      }

      const jobSummary = [
        `Title: ${job.title}`,
        rateLine,
        `Country: ${job.client_country || 'unknown'}`,
        `Freelancer geo restriction: ${job.geo_restriction || 'none'}`,
        `Category: ${job.category || 'unknown'}`,
        `Keywords: ${job.keywords || 'none'}`,
        `Description (full):\n${fullDescription}`,
        `Client: ${job.client_review_count || 0} reviews, ${job.client_rating_score || 0} rating, ${job.hire_rate || '?'}% hire rate, ${job.client_total_spent_detail || 'unknown spend'}, payment ${job.payment_verified ? 'verified' : 'NOT verified'}`,
        `Activity: ${job.proposals || '?'} applicants, ${job.interviewing || 0} interviewing, ${job.client_already_hired ?? 0} ALREADY HIRED, ${job.invites_sent || 0} invites sent (NOTE: "connects required" is deliberately omitted — it is an ignored flat entry cost, NOT a competition signal; judge competition from applicant count and boost bids only)`,
        _boostBids.length
          ? `Boost competition (captured from the apply page — rivals' boost bids in connects, this is the REAL competition signal; do NOT confuse with the flat "connects required" cost which is IGNORED): ${_boostBids.map(b => `#${b.rank}=${b.connects}c`).join(', ')}. Top bid ${_topBoost} connects = what Artem must outbid to lead the boosted field.`
          : `Boost competition: not captured for this job (apply page not yet scraped) — judge competition from applicant count instead.`,
        job.avg_rate ? `Client avg hourly rate paid to freelancers: $${job.avg_rate}/hr` : '',
        job.preferred_qualifications ? `Preferred qualifications (Upwork's soft filter — for each criterion Artem doesn't meet, apply the SOFT NEGATIVE SIGNAL scoring rule from your system prompt: -1 point + a "Doesn't meet preferred: <criterion>" flag. ALSO apply the MALFORMED PREFERRED-QUALIFICATIONS GUARD — if a line looks nonsensical for the job context (sign-language requirement on a PPC job, two languages smushed without separators, etc.), treat it as scraping corruption and DO NOT penalise):\n${job.preferred_qualifications}` : '',
        mandatoryFlags.length ? `\nMANDATORY FLAGS — the analyser pre-check computed these from the data above; you MUST include each one verbatim in your "flags" array and apply the corresponding point deductions and verdict caps as stated in the system prompt:\n${mandatoryFlags.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')

      const response = await fetch('/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _kind: coreOnly ? 'analysis_rescan' : 'analysis',
          model: 'claude-sonnet-4-5',
          // 600 was too tight — bumped to 1200 for normal jobs. 1200 still
          // truncates on very long job descriptions (120+ lines of scope).
          // 2000 gives enough headroom for the largest jobs seen in practice.
          max_tokens: 2000,
          system: `You are analyzing Upwork jobs for Artem Yatsuk. Use this profile to calibrate every score.

ARTEM'S UPWORK PROFILE (real, verified data — use this to assess fit):
- Location: Kharkiv, Ukraine (UTC+3). Ukraine IS in Europe — "Location: Europe" or "Location: Eastern Europe" preferred qualifications are NOT a mismatch. Not US, not India. Cannot work under US-only geo restrictions.
- Job Success Score: 95% — Top Rated badge. This is a strong trust signal; raises his competitiveness in crowded pools.
- Total earnings: $100K+. Completed 68 jobs, 2,509 hours logged.
- Associated agency ITForce: 97% JSS, 3,102 hours — additional credibility signal for agency/team jobs.
- Rate: $30/hr floor for PPC/SEO work; $40/hr floor for WEB-DEVELOPMENT work (WordPress/Shopify/OpenCart/custom modules — his developer rate is higher). The job-specific floor for THIS posting is stated in the rate line above — use that number. Recent contracts ran at $35-40/hr; one at $50/hr. For strategy/audit-only work he has charged $700-1,645 fixed. He is NOT a $10-20/hr generalist — price him accordingly.
- Availability: 30+ hrs/week, response time 4-8 hours. Good signal for clients requiring responsiveness.
- Languages: English (Fluent), Ukrainian (Native). No barrier for English-first clients.
- Education: Master's degree (MCA), Kharkiv Polytechnic Institute.
- Google Premier Partner 2026 — Top 3% globally. This credential is SPECIFIC TO GOOGLE ADS (PPC) — it is NOT an SEO credential and should NOT be cited as a differentiator on pure SEO jobs. On Google Ads / PPC jobs it is a major edge; on SEO-only jobs mention his SEO results instead.

CORE EXPERTISE (strong fit — score these 7-10 if scope matches):
- Google Ads (PPC): Search, PMax, Shopping, Remarketing, LSA. Aggressive negative keyword hygiene, RSA A/B testing, competitor conquesting, closed-loop GA4/GTM tracking. Premier Partner status applies here — cite it on Ads jobs, not SEO jobs.
- Technical & Local SEO: Log file analysis, indexation fixes, Core Web Vitals, site architecture, Google Business Profile, City-Silo / Map Pack ranking across 70+ cities.
- Ecommerce SEO: Shopify, OpenCart, WooCommerce. YMYL/EEAT compliance frameworks.
- Analytics & Tracking: GA4, Google Tag Manager, conversion tracking audits, attribution.
- Web Development (ecommerce platforms): Shopify store setup, theme customization, app integration, SEO-optimized builds. WordPress/WooCommerce site development, plugin/theme work, performance optimization. OpenCart store builds with CRM integration (KeepinCRM bidirectional sync), bilingual SEO, analytics setup. Full-scope delivery: architecture → development → GA4/GTM → technical SEO. Proven cases — OpenCart: GKit (branded fashion store, KeepinCRM + dual-language SEO), SMASH (streetwear — custom theme + Lucky Box gamification module, +217% revenue), Game-X (PC-hardware store — custom Configurator + Compatibility Engine + Smart Cart modules, +34% conversion); Shopify: Casa Eleganza (USA premium furniture retailer — custom Shopify 2.0 theme, multi-axis filtering, "Complete the Look" room bundler, Synchrony financing integration; +41% conversion on filtered pages, +28% AOV). Game-X proves complex custom-module/backend work, not just theming; Casa Eleganza is DIRECT Shopify proof for US ecommerce/furniture/luxury builds. Score 7-10 when scope is ecommerce platform work on Shopify / WordPress / WooCommerce / OpenCart.

PROVEN RESULTS (use these to judge vertical fit — if the job is in one of these verticals, it's a stronger match):
- Medical/YMYL SEO: +1,861% organic traffic, +14,342% conversions (Derma Solution case study — attached in profile).
- Local service ads: -92% Cost-Per-Lead, +1,405% conversions.
- Ecommerce: +693% revenue via Technical SEO + PMax.
- Shopify furniture/luxury (DIRECT web-dev build proof — use for Shopify / furniture / home-decor / US-retail store jobs): Casa Eleganza (casaeleganza.com) custom Shopify 2.0 build — +41% conversion on filtered collection pages, +28% average order value, -45% PDP bounce, 3x special-order inquiries.
- REAL ESTATE / property-developer Google Ads (DIRECT proof — do NOT score real-estate PPC jobs as "no vertical experience"): Atlant property developer, +56.5% leads, -31% CPC, budget scaled +68% with cost/conversion up <8%; branded per-complex campaigns + PMax + DSA for new-listing lead gen. This is real, citable proof for any real-estate / realtor / property / new-listing / home-builder Ads job, including ones that explicitly demand "real estate experience".
- Programmatic local SEO: Top Map Pack in 70+ cities.
- Google Merchant Center specialist (recent $200 and $1,645 fixed-price jobs, both 5-star).

WEAK FIT / SCORE LOWER for:
- Verticals with no case study overlap and an explicit experience gate (e.g. "must have finance/legal/SaaS SEO background only") — score 2-4.
- Jobs where the primary deliverable is content writing, link building outreach, or social media management with no PPC/SEO audit component.
- Clients whose avg rate paid is well below $30/hr — may resist his pricing.
- Custom software engineering (React SPA, Node.js API, mobile app, SaaS platform, blockchain) — IT Force scope is CMS/ecommerce platforms, not custom application development. Score 2-4, not 0.

COMPETITIVE POSITIONING:
- In pools of 20-50 applicants for generic SEO/PPC work, Artem's Top Rated + Premier Partner + $100K+ profile stands out — don't over-penalise for applicant count unless the scope is clearly misaligned.
- For audit-first or one-off deliverable jobs, his $700 fixed SEO audit and $300 fixed Google Ads / PPC account audit (1 working day) price points are competitive and proven.

PPC / GOOGLE ADS ACCOUNT AUDIT JOBS — ALWAYS APPLICABLE (mandatory; overrides the rate rules):
When the core ask is a Google Ads / PPC account AUDIT, REVIEW, assessment, health check or "analyse our campaigns", this is Artem's productised flagship deliverable: a FIXED $300 audit delivered in 1 working day, with real Google Ads audit samples attached. Treat it as follows:
- THE HOURLY RATE FLOOR DOES NOT APPLY. It is a fixed-fee deliverable, not an hourly engagement. A low posted hourly range (even $10-25/hr) and a low client historical avg rate are NOT reasons to deduct points, cap the verdict, or raise rate-floor risk. Do not compute an effective hourly against the posted range — the price is $300 flat regardless of what the posting advertises hourly.
- "SHORT-TERM" / "PART-TIME" / "ONE-OFF" / "SMALL PROJECT" IS THE NATURE OF AN AUDIT — it is exactly what Artem wants here. Never treat those words as a negative, as "scope-creep risk", or as evidence the client wants cheap ongoing hourly support. An audit IS a short, bounded, one-off deliverable.
- These jobs are cheap to win, fast to deliver, and frequently convert into ongoing management afterwards — the audit is the door-opener. Applying is nearly always correct.
- VERDICT: APPLY, score 7-9. Only a genuine HARD disqualifier (US-only geo lock, already-hired, unverified payment with under 5 reviews) may pull it below that. Client quality concerns (few reviews, modest spend) are a flag at most, never a SKIP on their own — the downside is capped at one small fixed fee.
- For web development BUILD jobs (Shopify/WordPress/OpenCart, from-scratch/new site), the differentiator is full-scope delivery: most web devs hand off to a separate SEO person; IT Force delivers build + SEO architecture + analytics in one engagement — cite this as the edge. BUT for MAINTENANCE / CHANGES / FIX jobs on an EXISTING store (theme tweaks, adjustments, fixing issues), the client hired a developer, not an SEO — the edge is dev RELIABILITY (careful theme work, test-before-deploy, doesn't break existing functionality/tracking), NOT an SEO/ranking pitch. Don't force the SEO angle where it wasn't asked for.

AGENCY / WHITE-LABEL REQUIREMENT (mandatory — an explicit "agency" ask is NOT a disqualifier):
Artem is a Top Rated individual freelancer BUT delivers through his associated agency IT Force (97% JSS, 3,102 hours — a ~20-person web-development team). So when a posting explicitly requires an AGENCY, a "white-label partner", "Talent Type: Agency", a named account owner, ongoing delivery capacity, or subcontracting structure, that is NOT a structure mismatch and NOT a reason to skip — IT Force IS that agency and is presented as the delivery partner. Judge these jobs on SCOPE + RATE like any other job, never on "Artem is solo":
- If the agency/white-label work sits in Artem's core delivery lane (WordPress / WooCommerce / Shopify / OpenCart build & development, ecommerce, technical SEO, Google Ads), score it on scope strength — it can be MAYBE or APPLY (5-8), NOT a 2/10. His web-dev cases (SMASH, Game-X, GKit, Casa Eleganza) ARE exactly the white-label proof these clients ask for. Bias toward applying when the core scope matches.
- Screening questions about agency track record, white-label client count, weekly capacity, or a named point of contact are ANSWERABLE via IT Force — they do NOT trigger the EXPLICIT PROOF REQUIREMENT skip below, and they do NOT force a 2-4. Do not call the agency structure an "unbridgeable gap".
- Only down-score for reasons that apply to ANY job: a genuine rate problem (judge by the ceiling/avg per the rate rules — soft flag + −1, not a skip unless it truly computes below floor) or a genuine SCOPE-BREADTH gap where the PRIMARY need is work Artem/IT Force does not do (native mobile apps, custom enterprise API/ERP integration, React SPA / SaaS engineering). Those are the real signals — the agency label itself is not.
- Stay honest, not inflated: IT Force is a real ecommerce/web-dev team, not a 7-service full-stack shop. On a multi-service posting whose PRIMARY need is outside the core lane, a MAYBE with honest strength-ranking is fair — but that is a scope judgment, NOT an "individual freelancer can't be an agency" rejection.

HARD DISQUALIFIERS — if any apply, score MUST be 0 and verdict MUST be SKIP, no exceptions:
1. "Freelancer geo restriction" field contains "United States only", "US only", or any similar restriction (Artem cannot legally apply)
2. Rate ceiling is below $15/hr. For HOURLY RANGE jobs (e.g. "$15-$45/hr"), use the CEILING ($45 in this example), NOT the floor — the ceiling is what the client is willing to pay up to, and Artem can negotiate to that. Only disqualify when the CEILING (or the single rate, for non-range jobs) is below $15/hr. Below-$30 ceilings should be a soft negative signal / flag, not a hard skip.
3. Payment NOT verified AND client has under 5 reviews. READ THE CLIENT LINE LITERALLY — this fires ONLY when the client line above literally says "payment NOT verified". If it says "payment verified", the client IS verified: you may NOT write "payment not verified", "unverified payment", or "high non-payment risk" anywhere in your output. NEVER CONTRADICT THE CLIENT DATA YOU WERE GIVEN — do not call spend "unknown" when a spend figure is provided, and do not invent a client-quality red flag that the data disproves. Fabricating this disqualifier has caused wrong SKIPs.
4. "ALREADY HIRED" count ≥ 1 — the client has already hired someone for this role and is unlikely to hire again. Verdict MUST be SKIP and the "flags" array MUST include a flag noting "Client already hired N freelancer(s)".

SCORE CALIBRATION — what the 0-10 number means (mandatory):
The score must distinguish "categorically cannot/should-never apply" from "could apply but poor fit." Use these bands:
- 0-1 → RESERVED for the four HARD DISQUALIFIERS above ONLY. A score of 0 means "Artem literally cannot apply or it is categorically pointless" (geo-locked out, rate below floor, unverified+unproven client, already hired). Do NOT use 0-1 for fit/vertical/experience mismatches.
- 2-4 → SKIP for FIT reasons. The job is applicable in principle (no hard disqualifier) but a poor match: wrong vertical with an explicit experience gate, a screening question demanding proof Artem can't credibly give, heavy specialization Artem lacks, or a very crowded pool where specialists clearly out-compete him. Verdict SKIP, score 2-4 — NOT 0.
  EXPLICIT PROOF REQUIREMENT (most-missed 2-4 trigger): if the posting explicitly asks for a portfolio, examples, or screenshots of work Artem has NOT done (e.g. "share examples of content you ranked on external platforms", "attach a portfolio of web designs", "show us case studies from the finance vertical"), this is a near-disqualifying signal. The client will evaluate proposals against this requirement; Artem cannot credibly answer it. Score MUST be 2-4 (SKIP), NOT 5-6. Do NOT call this MAYBE and do NOT suggest that Artem can "work around" the requirement in the letter. CARVE-OUT: this rule is about proof of SKILLS or VERTICALS Artem genuinely lacks — it does NOT apply to agency-structure / white-label / team-capacity / account-manager questions, which are answerable via IT Force (see AGENCY / WHITE-LABEL REQUIREMENT above). An explicit agency ask is not a proof gap.
- 5-6 → MAYBE. Adjacent fit, real but surmountable concerns, worth a tailored proposal.
- 7-10 → APPLY. Strong fit.
IMPORTANT: Only the four hard disqualifiers force a 0. A vertical/experience mismatch — even a strong, explicit one backed by a screening question — is a FIT-based SKIP and must score 2-4, never 0, and must NOT be described as a "hard disqualifier" in the summary (call it a "strong fit mismatch" or "vertical gap" instead).

RATE-RANGE INTERPRETATION RULE (mandatory):
For jobs posted with a rate range "$X-$Y/hr":
- Treat the CEILING $Y as the negotiable upper bound — Artem can apply at any rate up to $Y.
- Compare $Y (not $X) to Artem's applicable floor stated in the rate line ($30/hr for PPC/SEO, $40/hr for web-development jobs).
- If $Y ≥ the applicable floor, the rate is acceptable; do NOT disqualify and do NOT add a "rate below minimum" flag.
- If $Y is between $15 and (floor − 1), this is a soft negative signal — flag it ("Rate ceiling $Y/hr is below Artem's $<floor>/hr target") and subtract 1 point, but do NOT skip.
- Only the $Y < $15 case triggers the hard disqualifier above.

FIXED / FLAT-PRICE RATE INTERPRETATION RULE (mandatory — distinct from hourly):
A flat fixed-price budget is a DOLLAR AMOUNT, not a rate. NEVER directly compare it to Artem's hourly floor (stated in the rate line — $30/hr PPC/SEO, $40/hr web-dev) without converting to an effective hourly rate first.
- Identify whether the rate is hourly ("$X/hr", "hourly_rate_min/max" populated) or fixed (no "/hr" suffix, plain dollar amount, "fixed_budget" field populated, or wording like "flat", "project", "one-off").
- For a FIXED budget $B, ESTIMATE the effort in hours from the scope described in the job posting:
    - Quick audit / single-page review: 2-4h
    - Multi-deliverable audit + fix on 1 site: 5-10h
    - Audit + fix across multiple sites (e.g. 3 WordPress sites): 8-20h
    - Implementation work (GTM setup, conversion tracking install, etc.): 4-12h per site
    - Strategy doc / roadmap: 4-8h
  Use the upper end of the range when scope is uncertain — Artem prefers to under-promise time.
- Effective rate = $B / estimated hours. Compare THAT to Artem's applicable floor (the rate line states it: $30/hr PPC/SEO, $40/hr web-dev).
- Examples:
    - "$100 flat" for an audit + fix on 3 sites (≈10-15h scope) → effective $7-10/hr → HARD SKIP (below $15 floor when computed)
    - "$500 flat" for a single-page conversion audit (≈3-5h) → effective $100-167/hr → great rate
    - "$200 flat" for "quick GA4 setup" (≈2h) → effective $100/hr → fine
- The flag MUST quote both numbers so the user can sanity-check: "$100 flat ÷ ~12h scope ≈ $8/hr effective, below $30/hr minimum"
- Same hard-disqualifier thresholds apply to the EFFECTIVE rate as to hourly: < $15/hr → hard SKIP; $15-29 → soft flag + −1; ≥ $30 → acceptable.

ANOMALOUS / IMPLAUSIBLE BUDGET RULE (mandatory — data-quality, not disqualifier): A budget figure that is implausibly large for the scope (e.g. tens of thousands of dollars for an SEO/PPC engagement), or a fixed lump-sum attached to an "ongoing" role, is almost always a CAPTURE ERROR or a placeholder — not a real client term. NEVER treat such a number as a fact, and NEVER let it drive the verdict. Specifically: do NOT call the job "unbiddable", "structurally incoherent", or skip it because the budget "doesn't make sense"; do NOT compute an effective rate from a clearly-bogus number; do NOT deduct points for it. A large budget, if anything, is a POSITIVE signal (well-funded, serious client). When the budget looks anomalous, add exactly ONE flag ("Budget figure $X looks anomalous — verify before bidding") and then score the job on SCOPE FIT, CLIENT QUALITY, and the client's historical hourly rate, treating the budget as effectively unspecified. A weird budget number is a reason to VERIFY, never a reason to SKIP a job whose scope and client otherwise fit.

CLIENT AVG RATE SIGNAL — RATE-FLOOR RISK OR UPSIDE (mandatory; the avg is what they actually pay — it can cut EITHER way: below floor = risk, above ceiling = upside):
The "Client avg hourly rate paid to freelancers" field is what this client HAS ACTUALLY PAID across their past contracts. Treat it as a stronger predictor than the posted rate range when the two disagree — clients consistently pay what their history shows, not what their job post advertises.
- If avg_rate < $30/hr but ≥ $25/hr: subtract 1 point. Add a flag: "Client avg rate $X/hr is below Artem's $30/hr floor — posted ceiling may not be realised; expect rate pressure".
- If avg_rate < $25/hr but ≥ $20/hr: subtract 2 points. Add a flag: "Client avg rate $X/hr is materially below Artem's $30/hr floor — posted ceiling unlikely to be realised; rate-floor risk is high".
- If avg_rate < $20/hr: subtract 3 points AND cap verdict at MAYBE (never APPLY on rate-floor-risky clients no matter how strong the fit). Flag: "Client historical avg rate $X/hr is far below Artem's $30/hr floor — strong evidence Artem's bid will not clear; rate-floor risk dominates fit signals".
- If avg_rate is AT or ABOVE Artem's applicable floor: this is NOT a risk. Do NOT deduct points and do NOT add any "rate-floor risk" flag. The direction matters — the below-floor logic above does NOT invert. A client who has historically paid MORE than the posted range is a POSITIVE signal: the posted ceiling is conservative/a placeholder, the client actually pays premium, and there is room to negotiate UP toward their historical rate. NEVER describe a client whose avg is at/above the posted ceiling as "budget-tier", "rate rejection risk", or "rate-floor risk", and never claim Artem's bid "may read as budget-tier" — bidding at or below what a client already pays is not a problem. A high client avg rate can only help the score, never hurt it.
- If avg_rate ≥ $30/hr: no penalty.
- If avg_rate is absent (not enriched yet): ignore this rule entirely — do not penalise for missing data.
- Do NOT counter the avg-rate deduction with optimism like "can negotiate to upper range" — historical paying behaviour does not move with negotiation.
FLAT-RATE / FIXED-PRICE EXCEPTION: When the job is fixed-price (flat budget, not hourly), avg_rate is a WEAK signal. Historical hourly rates don't predict whether this specific fixed budget will yield an adequate effective rate — use the FIXED/FLAT-PRICE RATE INTERPRETATION RULE for that. Do NOT cite avg_rate as a positive signal on flat-rate jobs ("client avg $34/hr exceeds the floor — positive" is wrong reasoning on a $500 flat project). A high avg_rate on a fixed-price job is at most a very mild positive (client is used to paying real rates); it never offsets a rate-floor concern identified by the effective hourly calculation. Equally, a below-floor avg_rate on a flat-rate job should be noted but weighted less heavily than on an hourly job.

INTERVIEWING-COUNT SIGNAL (mandatory — most-missed shortlist-saturation flag):
The "interviewing" count is the number of candidates the client is ALREADY in active interview conversations with. It is the single strongest leading indicator that the funnel is closing. Entering the funnel late, after the client has shortlisted multiple candidates, rarely converts even with strong fit.
- If interviewing >= 3 but < 5: subtract 1 point. Flag: "Client already interviewing N candidates — funnel is filling".
- If interviewing >= 5 but < 10: subtract 2 points. Flag: "Client already interviewing N candidates — funnel heavily shortlisted; entering this late is uphill".
- If interviewing >= 10: subtract 3 points AND cap verdict at MAYBE (never APPLY). Flag: "Client already interviewing N candidates — shortlist is closing; entering this late rarely converts even with strong fit. Strongly consider SKIP unless fit is exceptional and budget alignment is provable".
- If interviewing is 0 or absent: no penalty.

CONNECTS COST — IGNORE (mandatory): Do NOT factor the "connects required" number into the score or verdict, and do NOT flag it. Artem boosts every proposal, so connect cost has no bearing on his decision. Even a very high connect requirement is irrelevant — never deduct points for it or mention it as a concern.
CRITICAL — connects required is NOT a competition signal: the "connects required" number is a flat ENTRY PRICE Upwork sets, NOT a measure of how contested the job is. NEVER describe connects as a "competitive auction", "premium auction", "high competition", or infer demand/competition from it. Competition is read ONLY from (a) the applicant count and (b) the BOOST COMPETITION bids below. A high connects-required number with few applicants and low boost bids is an UNCONTESTED job — do not call it competitive. Conflating connect cost with auction/competition is a specific error to avoid.

BOOST COMPETITION SIGNAL (mandatory when captured — this REPLACES connect cost as the real competition read): The job data may include "Boost competition" — the actual boost bids (in connects) rivals placed for the top proposal slots, scraped from the apply page. This IS decision-relevant (unlike the flat connect cost): it shows how aggressively others are fighting for visibility, and the TOP bid is what Artem must outbid to lead the boosted field. Weigh it as follows:
- Top boost bid >= 100 connects: heavy competition — rivals want this badly and leading the field is expensive. -1 point and a flag. Does NOT cap the verdict (Artem can still boost in), but temper optimism on win-odds.
- Top boost bid 50-99: moderate — note it, no point change.
- Top boost bid < 50: light — the field isn't boosting hard, a modest boost wins a top slot. Treat as a mild POSITIVE on win-odds (this is a winnable, under-contested job).
- When boost competition IS captured, prefer it over raw applicant count as your competition read — it's the concrete signal. When it is NOT captured, fall back to applicant count. The MANDATORY FLAGS already encode the right bucket — include the boost flag verbatim and apply its point change.

MALFORMED PREFERRED-QUALIFICATIONS GUARD (mandatory — scraping artifacts are not real client requirements):
The "preferred_qualifications" field is scraped from Upwork's UI and can suffer concatenation bugs. If a line is obviously nonsensical for the job context — e.g. "Sign Language" listed for a routine Google Ads/PPC posting, two language requirements smushed without separators ("German Sign Language" when "German" and "Italian Sign Language" were probably separate entries), or an industry requirement that has zero relevance to the job category — treat that line as a likely scraping artifact and DO NOT penalise or flag it as a mismatch. You may note in the analysis "(preferred-qual data quality issue, skipped)" but do not deduct points. Apply common sense: a real client preferring sign-language fluency in a PPC manager is essentially never genuine; assume corruption.

COACHING / TUTORING DETECTOR (mandatory — most-missed Rule 2 signal):
When the client describes the engagement using any of these intent patterns, it is a coaching / mentorship request, NOT a done-for-you service request:
- "guide me / guide on" / "mentor me" / "coach me" / "teach me" / "show me how"
- "help me understand" / "improve my understanding" / "walk me through"
- "advisor" / "advisory" / "consultant to talk to" / "someone to talk to about"
- "explain to me" / "answer my questions" / "be available for questions"
- "looking for an expert to learn from"
The Falcon Scout assumes coaching engagements almost always imply live sessions, Zoom calls, screen-share walkthroughs, or async-but-interactive Q&A — all of which are Rule 2 territory (Artem does not do live sessions or tutorials). When two or more of these signals appear, OR one strong signal appears with no offsetting "deliverable" language, you MUST:
- Add a flag: "Coaching/tutoring request ('<exact quoted phrase>') — likely Rule 2 violation (live sessions / tutorials)"
- Cap the score at 5 and prefer verdict MAYBE over APPLY (or SKIP if the entire role is coaching with no deliverable component).
- Do NOT frame this as "reposition as audit-only" unless the posting explicitly also asks for a one-off deliverable — that framing has bitten us before (the user reads the cover letter promising a deliverable, the client expects coaching, mismatch).

ANTI-REPOSITION (mandatory, applies to ALL job types): Do NOT suggest repositioning the scope when the client's scope is explicitly and unambiguously defined. If the posting says "rank content on external high-authority platforms" or "build a React SPA" or "manage our social media", those ARE the deliverables — suggesting "reposition as a technical audit" or "offer a strategy consult instead" is wishful thinking that leads Artem to write a proposal for a job he cannot do. Only suggest repositioning if the posting has a genuine secondary deliverable Artem CAN provide that sits alongside the primary one. "Reposition" is not a workaround for an experience gap.

RULE 2 SCOPE — DO NOT OVER-TRIGGER (mandatory; counterpart to the coaching detector above):
Rule 2 skips jobs that require live sessions / tutorials / Zoom / Loom / synchronous video communication / screen-recording deliverables. It fires ONLY when the posting LITERALLY asks for one of those. Before flagging a Rule 2 violation you MUST be able to quote the EXACT phrase from the posting that asks for synchronous video or a screen recording (e.g. "weekly Zoom calls", "record a Loom walkthrough", "screen-share session", "live training", "video tutorial"). If you cannot quote such a phrase, Rule 2 does NOT apply — do not invoke it, do not flag it, do not lower the score for it.
Routine campaign-management and optimization language is NORMAL asynchronous PPC/SEO work and NEVER triggers Rule 2. This explicitly includes: "A/B test", "rapid tests", "test and iterate", "continuously optimize", "kill losing ads quickly", "monitor performance", "ongoing management", "daily monitoring", "real-time bidding", "active campaign management", "rapid testing", "optimize bids". These describe work Artem does SOLO inside the ad platform — they do NOT mean live calls, screen-shares, or synchronous collaboration. Treating them as a Rule 2 violation is a known false-positive that has wrongly produced SKIP / 0-10 verdicts; do not repeat it.
A job that is an ongoing Google Ads / PPC management role with active optimization is squarely in Artem's wheelhouse — it is NOT a disqualifier. Score it on its merits (client quality, rate, vertical fit), not on the presence of optimization verbs.

WALKTHROUGH / LOOM / VIDEO-EXPLANATION REQUESTS — ADVISE COMPLIANTLY (mandatory): When the posting asks for a "Loom video", a screen recording, or "walk me through / explain what you found" (common as a secondary ask on audit jobs), do NOT recommend that the proposal offer a Loom or a recorded video. The cover-letter generator is HARD-BANNED from naming Loom or committing to any video / screen-recording deliverable (Rule 2), so recommending it puts the analysis at odds with the letter. If you mention this at all, recommend the COMPLIANT response instead: a clear WRITTEN findings-and-recommendations summary in plain language, and — only if the client clearly insists on talking it through — a single short wrap-up call. NEVER write "offer a Loom recap", "record a walkthrough video", "async Loom", or name Loom anywhere in your reasoning or flags. (Whether the request affects the score still follows the Rule 2 rules above: a secondary "explain your findings" ask on an otherwise done-for-you audit is fine and needs no video offer; only a PRIMARY live/video deliverable is a Rule 2 concern.)

PREFERRED QUALIFICATIONS — SOFT NEGATIVE SIGNAL (penalty, not skip):
The "Preferred qualifications" field is Upwork's soft filter. Clients see a banner on the proposal noting any mismatch ("You do not meet all the client's preferred qualifications"), but Artem can still apply.
SCORING RULE (mandatory):
- Artem's location for preferred-qualification checks: Kharkiv, Ukraine. Ukraine IS in Europe — "Location: Europe" is NOT a mismatch. Location mismatches that DO apply: "Location: United States", "Location: US only", "Location: India", "Location: UK only", or any country/region that excludes Ukraine/Eastern Europe.
- For each criterion in Preferred qualifications that Artem CLEARLY does not meet, subtract 1 point from the score. Examples of clear mismatches: "Location: United States" (Artem is in Ukraine), "Location: India" (Artem is in Ukraine), specific certification he lacks. Examples that are NOT mismatches: "Location: Europe" (Ukraine is in Europe), "Location: Eastern Europe" (Ukraine is in Eastern Europe), "English required" (Artem is fluent in English), "Talent Type: Agency" / "Agency" (Artem delivers via his associated agency IT Force — do NOT flag this as unmet; see AGENCY / WHITE-LABEL REQUIREMENT above).
- Floor the resulting score at 5 — preferred-qualification mismatches alone never push verdict to SKIP and never push score below 5.
- For every missed criterion, the "flags" array MUST include a flag in the exact format: "Doesn't meet preferred: <criterion as written>" (one flag per criterion).
- The cover letter should pre-empt the concern (timezone overlap, async cadence, etc.) — but that's the generator's job; here, your job is to score honestly and flag visibly.${rulesText}${coreContextText}${examplesText}${adjustments}
Respond ONLY with a JSON object. No markdown, no explanation, just the JSON:
{"verdict":"APPLY","score":8,"summary":"brief fit summary","reasons":["reason 1","reason 2","reason 3"],"flags":["flag 1"]}
Use APPLY, MAYBE, or SKIP for verdict. Score is 0-10.`,
          messages: [{ role: 'user', content: `Analyze this job:\n\n${jobSummary}` }],
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message || `API ${response.status}`)
      if (!data.content) throw new Error('No content in response: ' + JSON.stringify(data))
      const text = data.content.map(b => b.text || '').join('')
      const clean = text.replace(/```json|```/g, '').trim()
      // Extract JSON object even if there's surrounding text.
      let parsed = null
      const jsonMatch = clean.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else if (data.stop_reason === 'max_tokens' || /^\s*\{/.test(clean)) {
        // Truncation guard: the response began a JSON object but got cut off
        // before the closing brace (no complete {...} to match). Rather than
        // a cryptic "No JSON found", tell the user it was truncated so they
        // know to just re-run (and so we don't lose a clearly-started verdict).
        throw new Error('Analysis response was truncated before it finished — hit Re-analyse to retry. (raised max_tokens; if this persists the summary is unusually long)')
      } else {
        throw new Error('No JSON found in: ' + clean.slice(0, 100))
      }
      setAnalysis(parsed)
      // Fire similarity lookup — fire-and-forget, never blocks the analysis UX
      if (job?.id) {
        fetch(`/proposals/similar?job_id=${job.id}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setSimilar(d) })
          .catch(() => {})
      }
      // Cache the verdict server-side so proposal-save can snapshot it even
      // when the save goes through a path that doesn't pass through React state.
      // Fire-and-forget — never surface an error to the user.
      if (job?.id) {
        fetch(`/jobs/${job.id}/analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...parsed,
            model: 'claude-sonnet-4-5',
            ran_at: new Date().toISOString(),
          }),
        }).catch(() => {})
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const verdictColor = { APPLY: '#00c8d4', MAYBE: '#f59e0b', SKIP: '#ef4444' }
  const verdictEmoji = { APPLY: '🟢', MAYBE: '🟡', SKIP: '🔴' }

  return (
    <div data-col-id="analyser" style={{ flex: 1, overflow: 'hidden', minWidth: '15%', display: 'flex', flexDirection: 'column' }}>
      {/* Scrollable content */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowAnchor: 'none' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>▸ AI Analysis</div>

      {/* Cached/stale analysis is hidden when the job isn't currently enriched.
          Otherwise we'd show analysis generated against a previous (or
          missing) enrichment state — e.g. a "$6.6K spent" claim while the
          current badge shows "$89K spent". Force the user to re-run on the
          fresh enriched state for accuracy. */}
      {(!analysis || !hasEnrichment) && !loading && !enrichingForAnalysis && (
        <>
          <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            Claude will score this job's fit, highlight reasons to apply or skip, and flag any risks.
          </p>
          <button onClick={(e) => { flashLogo(e.currentTarget); fireLogoSplash(e.currentTarget); setTimeout(() => analyse(), 480) }} className="btn-primary" style={{ width: '100%', paddingTop: 5, paddingBottom: 5, fontSize: 12.5 }}>
            <LogoCanvas />
            {hasEnrichment ? 'Analyse this job' : 'Enrich & Analyse'}
          </button>
        </>
      )}

      {(loading || enrichingForAnalysis) && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 0' }}>
          <SpinningLogo />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{enrichingForAnalysis ? 'Enriching job first…' : 'Analysing…'}</span>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '10px 12px' }}>
          Error: {error}
        </div>
      )}

      {analysis && hasEnrichment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'var(--bg2)', border: `1px solid ${verdictColor[analysis.verdict]}40`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{verdictEmoji[analysis.verdict]}</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: verdictColor[analysis.verdict] }}>{analysis.score}/10</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: verdictColor[analysis.verdict], marginBottom: 6 }}>{analysis.verdict}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{analysis.summary}</div>
          </div>

          {/* Similar-proposals badge — appears once similarity data loads */}
          {similar && similar.total_matched >= 3 && (() => {
            const isGreen  = similar.positive_count >= 1
            const isAmber  = !isGreen && similar.cold_count >= 3
            if (!isGreen && !isAmber) return null
            const color    = isGreen ? '#00d070' : '#f59e0b'
            const bg       = isGreen ? 'rgba(0,208,112,0.09)' : 'rgba(245,158,11,0.09)'
            const border   = isGreen ? 'rgba(0,208,112,0.28)' : 'rgba(245,158,11,0.28)'
            const icon     = isGreen ? '✓' : '⚠'
            const label    = isGreen
              ? `${similar.positive_count} similar job${similar.positive_count > 1 ? 's' : ''} got a response`
              : `${similar.cold_count} similar job${similar.cold_count > 1 ? 's' : ''} ghosted`
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <button
                  onClick={() => setSimilarOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: bg, border: `1px solid ${border}`,
                    borderRadius: similarOpen ? '6px 6px 0 0' : 6,
                    padding: '6px 10px', cursor: 'pointer', width: '100%',
                    color, fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <span>{icon}</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{similarOpen ? '▲' : '▼'}</span>
                </button>
                {similarOpen && (
                  <div style={{
                    background: bg, border: `1px solid ${border}`, borderTop: 'none',
                    borderRadius: '0 0 6px 6px', padding: '8px 10px',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    {[...similar.results]
                      .filter(r => r.outcome_signal !== 'pending')
                      // Surface the outcomes the header counts FIRST (positives
                      // when green, cold when amber) so the number and the
                      // visible rows line up — otherwise a higher-similarity
                      // ghosted job hides the very jobs the count refers to.
                      .sort((a, b) => {
                        const rank = (x) => isGreen
                          ? (x.outcome_signal === 'positive' ? 0 : 1)
                          : (x.outcome_signal === 'cold' ? 0 : 1)
                        if (rank(a) !== rank(b)) return rank(a) - rank(b)
                        return (b.similarity_score || 0) - (a.similarity_score || 0)
                      })
                      .slice(0, Math.max(5, isGreen ? similar.positive_count : similar.cold_count))
                      .map(r => (
                      <div key={r.proposal_id} style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{
                          flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 5px',
                          borderRadius: 3,
                          background: r.outcome_signal === 'positive' ? 'rgba(0,208,112,0.15)' : 'rgba(245,158,11,0.12)',
                          color: r.outcome_signal === 'positive' ? '#00d070' : '#f59e0b',
                        }}>{r.status}</span>
                        <span style={{ opacity: 0.8 }}>{r.job_title || '(untitled)'}</span>
                        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10, opacity: 0.5 }}>sim {r.similarity_score}/{similar.max_score || 10}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          <div>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Reasons</div>
            {analysis.reasons.map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text2)', padding: '5px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <span style={{ color: '#00c8d4' }}>✓</span><span>{r}</span>
              </div>
            ))}
          </div>

          {analysis.flags.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Red Flags</div>
              {analysis.flags.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: '#b45309', padding: '5px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, fontWeight: 500 }}>
                  <span style={{ color: '#d97706' }}>⚠</span><span>{f}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => { if (job?.id) { delete cacheRef.current[job.id]; _lsRemove('analysis', job.id) } analyse() }}
              className="btn-ghost"
              style={{ flex: 1, minWidth: 100, paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
            >
              ↺ Re-analyse
            </button>
            <button
              onClick={() => { if (job?.id) { delete cacheRef.current[job.id]; _lsRemove('analysis', job.id) } analyse(null, { coreOnly: true }) }}
              title="Re-pull rules + Core KB entries only, then re-analyse — fast and cheap. Use after adding a new rule or sending an entry to Core."
              className="btn-secondary"
              style={{ flex: 1, minWidth: 140, paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
            >
              ⟳ Rescan & Re-analyse
            </button>
            <button
              onClick={() => { setAnalysis(null); setFeedback(null); if (job?.id) { delete cacheRef.current[job.id]; _lsRemove('analysis', job.id) } }}
              title="Clear analysis"
              className="btn-ghost"
              style={{ paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
            >
              ✕ Clear
            </button>
            <button
              onClick={() => saveFeedback('liked')}
              title="This analysis was accurate"
              style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, border: '1px solid', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                background: feedback === 'liked' ? 'rgba(0,208,112,0.12)' : 'none',
                borderColor: feedback === 'liked' ? '#00d070' : 'var(--border)',
              }}
            >👍</button>
            <button
              onClick={() => saveFeedback('disliked')}
              title="This analysis was off"
              style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, border: '1px solid', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                background: feedback === 'disliked' ? '#ef444420' : 'none',
                borderColor: feedback === 'disliked' ? '#ef4444' : 'var(--border)',
              }}
            >👎</button>
          </div>
          {feedback && <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center' }}>{feedback === 'liked' ? 'Saved as example for future analyses' : 'Noted — will avoid this pattern'}</div>}
        </div>
      )}

      </div>{/* end scrollable content */}

      {/* Chat pinned to bottom — feeds back into analyse() */}
      <InlineChat
        job={job}
        chatId="analyser"
        extraContext={analysis ? `Analysis result:\nVerdict: ${analysis.verdict} (${analysis.score}/10)\nSummary: ${analysis.summary}\nReasons: ${analysis.reasons?.join('; ')}\nFlags: ${analysis.flags?.join('; ') || 'none'}` : ''}
        systemSuffix={"You are discussing this job's analysis with Artem. Help him think through whether to apply, what angle to take, how to position himself, and what risks to watch for. Reference specific data points. Be direct and tactical. If Artem tells you the score is wrong or wants the verdict reworked, tell him to type 'rework' (or click the ↺ Rework above button) and the analysis will re-run with his notes applied.\n\nGROUNDING — anti-capitulation (critical): When Artem questions or pushes back on a data point (e.g. \"$120 flat — where do you see it?\"), do NOT cave or fabricate alternatives to agree with him. CITE THE EXACT STORED FIELD you used from the job data above (e.g. \"the Rate line says FIXED-PRICE budget $120 USD, project type One-time project\"). If the data genuinely does not contain something, say plainly \"the posting data doesn't specify X\" — do NOT invent possibilities (do NOT speculate \"could be £120/hr\" when the budget field says fixed $120 USD) just to seem agreeable. Staying grounded in the actual data beats agreeing. Only change your read if Artem supplies NEW information that the captured data didn't have; a bare challenge is not new information."}
        onMessagesChange={(msgs) => { chatMessagesRef.current = msgs }}
        onRework={(msgs) => {
          if (job?.id) { delete cacheRef.current[job.id]; _lsRemove('analysis', job.id) }
          analyse(buildAdjustments(msgs))
        }}
        reworkLabel="↺ Rework verdict"
      />
    </div>
  )
}

// ── Proposal column ────────────────────────────────────────────────────────
// See DESIGN.md sections 6 and 8 (Phase 5).
//
// Two states this column moves through for a given job:
//   (a) No saved Proposal row yet → Generate flow, then a "Save to KB" button.
//   (b) Saved Proposal exists → loaded into the textarea; status dropdown,
//       client-reply paste, and notes are revealed. Edits PUT back.
function ProposalColumn({ job, bridgeReady = false }) {
  // Same enrichment check the JobDetail/AnalysisColumn use — gate cached
  // cover-letter output behind this so a stale proposal from a previous
  // enrichment state doesn't appear on a now-un-enriched job.
  const hasEnrichment = job.enriched_at || job.connects_required || job.proposals || job.hire_rate
  const [proposal, setProposal] = useState('')
  // ── Ahrefs + Website inspect ─────────────────────────────────────────────
  const _detectedUrl = extractWebsiteUrl(job.description_full || job.raw_message || '')
  const [ahrefsDomain, setAhrefsDomain] = useState(
    job.ahrefs_domain || job.website_url || (_detectedUrl ? _detectedUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : '') || ''
  )
  const [ahrefsLoading, setAhrefsLoading] = useState(false)
  const [ahrefsResult, setAhrefsResult] = useState(job.ahrefs_summary || null)
  const ahrefsTimerRef = useRef(null)
  const [websiteLoading, setWebsiteLoading] = useState(false)
  const [websiteText, setWebsiteText] = useState(job.website_summary || null)
  const websiteTimerRef = useRef(null)

  // Sync when a different job is selected
  useEffect(() => {
    setAhrefsResult(job.ahrefs_summary || null)
    setWebsiteText(job.website_summary || null)
    const detected = extractWebsiteUrl(job.description_full || job.raw_message || '')
    const domainFallback = job.ahrefs_domain || job.website_url || (detected ? detected.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : '') || ''
    setAhrefsDomain(d => d || domainFallback)
  }, [job.id, job.ahrefs_summary, job.ahrefs_domain, job.website_url, job.website_summary])

  // Listen for AHREFS_COMPLETE notification from bridge
  useEffect(() => {
    const onComplete = (e) => {
      const { job_id, summary } = e.detail || {}
      if (job_id !== job.upwork_job_id && job_id !== String(job.id)) return
      if (ahrefsTimerRef.current) { clearTimeout(ahrefsTimerRef.current); ahrefsTimerRef.current = null }
      setAhrefsLoading(false)
      setAhrefsResult(summary || null)
    }
    const onError = () => {
      if (ahrefsTimerRef.current) { clearTimeout(ahrefsTimerRef.current); ahrefsTimerRef.current = null }
      setAhrefsLoading(false)
    }
    window.addEventListener('cockpit:ahrefs:complete', onComplete)
    window.addEventListener('cockpit:ahrefs:error', onError)
    return () => {
      window.removeEventListener('cockpit:ahrefs:complete', onComplete)
      window.removeEventListener('cockpit:ahrefs:error', onError)
    }
  }, [job.id, job.upwork_job_id])

  const handleAhrefsEnrich = () => {
    // Normalise: strip protocol/path/trailing slash and LOWERCASE (domains are
    // case-insensitive; a capitalised host like "Snugzy.co.uk" can miss in Ahrefs).
    const raw = ahrefsDomain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\/+$/, '').toLowerCase()
    if (!raw) return
    if (!bridgeReady) { alert('Extension not connected — reload this tab (F5)'); return }
    setAhrefsLoading(true)
    setAhrefsResult(null)
    window.dispatchEvent(new CustomEvent('cockpit:enrich-ahrefs', {
      detail: { job_id: job.upwork_job_id || String(job.id), domain: raw }
    }))
    if (ahrefsTimerRef.current) clearTimeout(ahrefsTimerRef.current)
    ahrefsTimerRef.current = setTimeout(() => {
      setAhrefsLoading(false)
      setAhrefsResult('⚠ Ahrefs scrape timed out — try again')
    }, 60000)
  }

  // Website inspect listener
  useEffect(() => {
    const onComplete = (e) => {
      const { job_id, summary } = e.detail || {}
      if (job_id !== job.upwork_job_id && job_id !== String(job.id)) return
      if (websiteTimerRef.current) { clearTimeout(websiteTimerRef.current); websiteTimerRef.current = null }
      setWebsiteLoading(false)
      setWebsiteText(summary || null)
    }
    const onError = () => {
      if (websiteTimerRef.current) { clearTimeout(websiteTimerRef.current); websiteTimerRef.current = null }
      setWebsiteLoading(false)
    }
    window.addEventListener('cockpit:website-inspect:complete', onComplete)
    window.addEventListener('cockpit:website-inspect:error', onError)
    return () => {
      window.removeEventListener('cockpit:website-inspect:complete', onComplete)
      window.removeEventListener('cockpit:website-inspect:error', onError)
    }
  }, [job.id, job.upwork_job_id])

  const handleWebsiteInspect = () => {
    const raw = ahrefsDomain.trim()
    if (!raw) return
    if (!bridgeReady) { alert('Extension not connected — reload this tab (F5)'); return }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setWebsiteLoading(true)
    setWebsiteText(null)
    window.dispatchEvent(new CustomEvent('cockpit:inspect-website', {
      detail: { job_id: job.upwork_job_id || String(job.id), url }
    }))
    if (websiteTimerRef.current) clearTimeout(websiteTimerRef.current)
    websiteTimerRef.current = setTimeout(() => {
      setWebsiteLoading(false)
      setWebsiteText('⚠ Website scrape timed out — check the extension console')
    }, 60000)
  }
  // ─────────────────────────────────────────────────────────────────────────

  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [feedback, setFeedback] = useState(null) // 'liked' | 'disliked'
  const scrollRef = useRef(null)
  const proposalCacheRef = useRef({}) // { [jobId]: { proposal, feedback } } for unsaved drafts
  const prevProposalJobIdRef = useRef(null) // tracks previous job id for save-before-reset
  const chatMessagesRef = useRef([])  // latest cover-letter chat transcript
  // Whether the cover-letter chat has any messages yet. When empty, the chat
  // section collapses to just its input bar so the cover-letter section fills
  // the column instead of leaving a tall blank chat void.
  const [chatHasMessages, setChatHasMessages] = useState(false)
  // KB context cache — saves the 4 KB fetches (rules / examples / sent / manual)
  // when the user regenerates the same job within a short window. Keyed by
  // `${jobId}_${coreOnly ? 'core' : 'all'}`. TTL is 5 minutes so rule edits or
  // new KB entries flow in on the next regenerate after a tweak. This does
  // NOT reduce Claude tokens — the assembled context is still sent in full.
  // It only saves the HTTP round-trips (~200-400ms) and lets fast iteration
  // feel snappy.
  const kbContextCacheRef = useRef({}) // { [`${jobId}_core|all`]: { kbRulesText, examplesText, pastProposalsText, portfolioText, cachedAt } }

  // Chat section height — user-resizable via the drag handle between the
  // cover-letter section and the chat. Persisted to localStorage so the layout
  // sticks across reloads. Clamped to a sensible range.
  const CHAT_MIN = 120
  const CHAT_MAX = 800
  const CHAT_DEFAULT = 340
  const [chatHeight, setChatHeight] = useState(() => {
    try {
      const stored = parseInt(localStorage.getItem('falconscout.chatHeight') || '', 10)
      if (Number.isFinite(stored) && stored >= CHAT_MIN && stored <= CHAT_MAX) return stored
    } catch {}
    return CHAT_DEFAULT
  })
  const resizeStateRef = useRef(null) // { startY, startHeight } during drag
  const onResizeStart = (e) => {
    e.preventDefault()
    resizeStateRef.current = { startY: e.clientY, startHeight: chatHeight }
    const onMove = (ev) => {
      const s = resizeStateRef.current
      if (!s) return
      // Dragging down INCREASES chat height (handle moves down = chat takes
      // more space). Wait — handle is ABOVE the chat, so dragging down means
      // the handle moves down which shrinks the chat. Invert: subtract delta.
      const delta = s.startY - ev.clientY
      const next = Math.max(CHAT_MIN, Math.min(CHAT_MAX, s.startHeight + delta))
      setChatHeight(next)
    }
    const onUp = () => {
      resizeStateRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
  }
  // Persist the height after the user stops dragging
  useEffect(() => {
    try { localStorage.setItem('falconscout.chatHeight', String(chatHeight)) } catch {}
  }, [chatHeight])

  // Turn the chat transcript into a system-prompt instruction the next generate() call must obey
  const buildAdjustments = (msgs) => {
    if (!msgs || msgs.length === 0) return ''
    const transcript = msgs
      .filter(m => m.content && !m.content.startsWith('⟳ Reworking'))
      .map(m => `${m.role === 'user' ? 'Artem' : 'You (previous draft / reply)'}: ${m.content}`)
      .join('\n\n')
    if (!transcript.trim()) return ''
    return `\n\nARTEM'S ADJUSTMENTS TO YOUR PREVIOUS COVER LETTER (from the chat — these are his corrections; rewrite the cover letter so it incorporates every adjustment he listed, even if it requires substantially rewording or restructuring):\n${transcript}`
  }

  // Phase 5 — Save-to-KB / outcome capture state
  const [savedProposal, setSavedProposal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [statusValue, setStatusValue] = useState('sent')
  const [replyText, setReplyText] = useState('')
  const [notesText, setNotesText] = useState('')

  // "Share with Claude" hook — contribute this column's state to the snapshot.
  useEffect(() => {
    const onShare = (e) => {
      if (!e.detail) return
      e.detail.proposal = proposal || ''
      e.detail.proposalChat = (chatMessagesRef.current || []).slice()
      e.detail.proposalFeedback = feedback || null
      e.detail.savedProposal = savedProposal || null
    }
    window.addEventListener('falconscout:share-with-claude', onShare)
    return () => window.removeEventListener('falconscout:share-with-claude', onShare)
  }, [proposal, feedback, savedProposal])

  // Reset and load saved proposal whenever the selected job changes.
  // Save the current unsaved draft to cache BEFORE resetting — the closure
  // here captures the pre-reset state values, which is exactly what we want.
  useLayoutEffect(() => {
    const prevId = prevProposalJobIdRef.current
    const newId = job?.id
    // Save current unsaved draft for the job we're leaving (memory + localStorage)
    if (prevId != null && prevId !== newId && proposal && !savedProposal) {
      const value = { proposal, feedback }
      proposalCacheRef.current[prevId] = value
      _lsSave('proposalDraft', prevId, value)
    }
    prevProposalJobIdRef.current = newId

    setSavedProposal(null)
    setSaveMsg(null)
    setStatusValue('sent')
    setReplyText('')
    setNotesText('')
    setFeedback(null)
    if (scrollRef.current) scrollRef.current.scrollTop = 0

    // Restore cached unsaved draft for the new job (memory first, then localStorage)
    let cached = proposalCacheRef.current[newId]
    if (!cached && newId != null) {
      const stored = _lsLoad('proposalDraft', newId)
      if (stored && stored.proposal) {
        cached = stored
        proposalCacheRef.current[newId] = stored
      }
    }
    setProposal(cached?.proposal || '')
    if (cached?.feedback) setFeedback(cached.feedback)

    if (!newId) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/proposals?job_id=${newId}`)
        if (!res.ok) return
        const list = await res.json()
        if (cancelled) return
        if (Array.isArray(list) && list.length > 0) {
          const sp = list[0]
          setSavedProposal(sp)
          setProposal(sp.sent_text || '')
          setStatusValue(sp.status || 'sent')
          setReplyText(sp.client_reply_text || '')
          setNotesText(sp.notes || '')
          // Once we have a DB-saved proposal, drop the unsaved draft cache
          delete proposalCacheRef.current[newId]
          _lsRemove('proposalDraft', newId)
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [job?.id])

  // Continuously persist the proposal draft to localStorage as the user edits
  // it (so a page refresh mid-typing doesn't lose work). Skip when there's a
  // DB-saved proposal — that's the source of truth.
  useEffect(() => {
    if (job?.id == null || savedProposal) return
    if (!proposal) {
      _lsRemove('proposalDraft', job.id)
      return
    }
    const value = { proposal, feedback }
    proposalCacheRef.current[job.id] = value
    _lsSave('proposalDraft', job.id, value)
  }, [proposal, feedback, savedProposal, job?.id])

  const [ruleInput, setRuleInput] = useState('')
  const [distilledRule, setDistilledRule] = useState(null) // { text, saving, saved }
  const [distilling, setDistilling] = useState(false)
  const [kbRules, setKbRules] = useState([])
  const [loadingKbRules, setLoadingKbRules] = useState(false)
  // Dropped files — PDFs / images / text files the user drags in before generating.
  // Each entry: { name, mediaType, data (base64), blockType ('document'|'image'|'text') }
  const [droppedFiles, setDroppedFiles] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)

  const fetchKbRules = async () => {
    setLoadingKbRules(true)
    try {
      const res = await fetch('/kb?type=rule')
      if (res.ok) {
        const data = await res.json()
        // Sort by id ASC so rule numbering matches the backend's chat injection
        // (Rule 1 = first created, Rule 2 = second, …) and stays stable.
        setKbRules([...data].sort((a, b) => (a.id || 0) - (b.id || 0)))
      }
    } catch {} finally {
      setLoadingKbRules(false)
    }
  }

  const distillRule = async () => {
    const text = ruleInput.trim()
    if (!text || distilling) return
    setDistilling(true)
    setDistilledRule(null)
    try {
      const res = await fetch('/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _kind: 'rule_distill',
          // Compress free-form input → 1-2 sentence rule. Haiku is plenty.
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          system: 'You distill user input into a single, clear, actionable rule for an Upwork proposal assistant. Output ONLY the rule text — 1-2 sentences max, imperative tone, no preamble, no quotes.',
          messages: [{ role: 'user', content: text }],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || `API ${res.status}`)
      const rule = data.content.map(b => b.text || '').join('').trim()
      setDistilledRule({ text: rule, saving: false, saved: false })
    } catch (e) {
      setDistilledRule({ text: '', saving: false, saved: false, error: e.message })
    } finally {
      setDistilling(false)
    }
  }

  const [myRulesConflict, setMyRulesConflict] = useState(null)

  const saveDistilledRuleToKB = async (text) => {
    const res = await fetch('/kb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'rule',
        title: `Rule: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
        content: text,
        tags: 'rule',
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `API ${res.status}`)
    }
  }

  const addDistilledToKB = async () => {
    if (!distilledRule?.text) return
    setDistilledRule(prev => ({ ...prev, saving: true }))
    try {
      const conflict = await checkRuleConflict(distilledRule.text)
      if (conflict) {
        setDistilledRule(prev => ({ ...prev, saving: false }))
        setMyRulesConflict({ newRuleText: distilledRule.text, ...conflict })
        return
      }
      await saveDistilledRuleToKB(distilledRule.text)
      setDistilledRule(prev => ({ ...prev, saving: false, saved: true }))
      setRuleInput('')
      fetchKbRules()
    } catch (e) {
      setDistilledRule(prev => ({ ...prev, saving: false, error: e.message }))
    }
  }

  const resolveMyRulesConflict = {
    keepNew: async () => {
      try {
        await fetch(`/kb/${myRulesConflict.conflictingRule.id}`, { method: 'DELETE' })
        await saveDistilledRuleToKB(myRulesConflict.newRuleText)
        setDistilledRule(prev => ({ ...prev, saved: true }))
        setRuleInput('')
        fetchKbRules()
      } catch {}
      setMyRulesConflict(null)
    },
    keepExisting: () => { setMyRulesConflict(null) },
    saveBoth: async (newText, existingText) => {
      try {
        await fetch(`/kb/${myRulesConflict.conflictingRule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: existingText, title: `Rule: ${existingText.slice(0, 60)}${existingText.length > 60 ? '…' : ''}` }),
        })
        await saveDistilledRuleToKB(newText)
        setDistilledRule(prev => ({ ...prev, saved: true }))
        setRuleInput('')
        fetchKbRules()
      } catch {}
      setMyRulesConflict(null)
    },
  }

  const deleteKbRule = async (id) => {
    try {
      await fetch(`/kb/${id}`, { method: 'DELETE' })
      setKbRules(prev => prev.filter(r => r.id !== id))
    } catch {}
  }

  const saveProposalFeedback = async (kind) => {
    setFeedback(kind)
    const tag = kind === 'liked' ? 'proposal_liked' : 'proposal_disliked'
    const content = `Job: ${job.title} (${job.client_country || 'unknown'}, ${job.hourly_rate_min ? `$${job.hourly_rate_min}-$${job.hourly_rate_max}/hr` : job.fixed_budget || 'rate n/a'})\nKeywords: ${job.keywords || 'none'}\n\nCover Letter:\n${proposal}`
    await fetch('/kb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'feedback', title: `${kind === 'liked' ? '👍' : '👎'} Cover Letter: ${job.title}`, content, tags: tag }),
    })
  }

  // ── File drop handlers ────────────────────────────────────────────────────
  const _readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve({ name: file.name, data: base64, mediaType: file.type || 'application/octet-stream' })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const _isExcel = (f) =>
    f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    f.type === 'application/vnd.ms-excel' ||
    /\.(xlsx|xls)$/i.test(f.name)

  const _readExcelAsText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        const parts = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name]
          const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false })
          return `[Sheet: ${name}]\n${csv}`
        })
        resolve(parts.join('\n\n'))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })

  const handleFileDrop = async (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer?.files || [])
    const supported = files.filter(f =>
      f.type === 'application/pdf' ||
      f.type.startsWith('image/') ||
      f.type === 'text/plain' ||
      _isExcel(f)
    )
    if (!supported.length) return
    const loaded = await Promise.all(supported.map(async f => {
      if (_isExcel(f)) {
        const text = await _readExcelAsText(f)
        // Encode text as base64 so the rest of the pipeline stays uniform
        const b64 = btoa(unescape(encodeURIComponent(text)))
        return { name: f.name, data: b64, mediaType: 'text/plain', blockType: 'text', size: f.size, _excelText: text }
      }
      const { name, data, mediaType } = await _readFileAsBase64(f)
      const blockType = f.type === 'application/pdf' ? 'document' : f.type.startsWith('image/') ? 'image' : 'text'
      return { name, data, mediaType, blockType, size: f.size }
    }))
    setDroppedFiles(prev => [...prev, ...loaded])
  }

  const generate = async (adjustmentsArg, options = {}) => {
    // If not explicitly passed, pull the latest chat transcript so any "Redo" picks up the user's notes.
    const adjustments = typeof adjustmentsArg === 'string'
      ? adjustmentsArg
      : buildAdjustments(chatMessagesRef.current)

    // coreOnly: pull only entries flagged is_core=true (plus all rules, which
    // are always loaded). Used by the "Rescan & Re-write" button for a fast,
    // cheap rewrite against the curated Core subset of the KB.
    const { coreOnly = false } = options
    const coreSuffix = coreOnly ? '&is_core=true' : ''

    setLoading(true)
    setFeedback(null)
    try {
      // Load the stored analysis verdict so the generator can gate on SKIP /
      // include score + flags in the job context. ProposalColumn is a sibling
      // of AIAnalysisColumn and can't read its state directly — fetch from API.
      let storedAnalysis = null
      try {
        const aRes = await fetch(`/jobs/${job.id}/analysis`)
        if (aRes.ok) {
          const aData = await aRes.json()
          storedAnalysis = aData?.analysis || null
        }
      } catch {}

      // SKIP gate — deterministic (DESIGN.md §16): if the stored verdict is SKIP,
      // produce a pass note directly without calling Claude. The prompt-only gate
      // was reliably ignored by the model. The Redo button passes { skipOverride: true }
      // so Artem can still force-generate a real letter when he wants to.
      if (storedAnalysis?.verdict === 'SKIP' && !options.skipOverride) {
        const reason = storedAnalysis.summary
          ? storedAnalysis.summary.replace(/\.$/, '')
          : storedAnalysis.flags?.[0] || 'hard disqualifiers apply'
        setProposal(`Skip — ${reason}.\n\nNot applying on this one.`)
        setLoading(false)
        return
      }

      // ── Client-type detection (hoisted) ──────────────────────────────────────
      // Decide DIRECT vs agency/white-label up front, with the SAME scope logic
      // that gates the white-label rules. Needed early so we can KEEP white-label
      // few-shot examples OUT of the prompt on direct-client jobs — a white-label
      // "winner" shown as a template to emulate overpowers any one-line guard and
      // makes the model copy the white-label framing. (The model did exactly this
      // on a school's direct WordPress job.)
      const _earlyDesc = (job.description_full || job.description_snippet || job.raw_message || '').trim()
      const isAgencyClient = jobScopes(
        [job?.title, job?.keywords, job?.category, _earlyDesc, job?.preferred_qualifications]
          .filter(Boolean).join(' ')
      ).has('agency')
      // Markers that an example/past proposal is a white-label/agency-partner pitch.
      const _WHITELABEL_EXAMPLE_RE = /white[-\s]?label|behind the scenes|invisible partner|in the background|your end[-\s]?clients?|for your clients?|clean handoffs?|as a (?:white[-\s]?label|background) partner/i
      // On a DIRECT job, drop white-label examples so they can't be emulated.
      const _filterWhiteLabel = (text) => (isAgencyClient || !text) ? text : (_WHITELABEL_EXAMPLE_RE.test(text) ? '' : text)

      // Fetch KB rules, liked-feedback examples, sent proposals, and portfolio in parallel
      let kbRulesText = ''
      let examplesText = ''
      let pastProposalsText = ''
      let portfolioText = ''
      let referenceText = ''  // vertical templates / prompt reference entries (e.g. "Upwork Prompt Gemini + template examples")

      // ── Check browser-side cache before refetching KB ──────────────────
      // Regenerations of the same job within 5 minutes reuse the previously
      // assembled context strings. Skips 4 HTTP fetches (~200-400ms saved).
      // Does NOT reduce Claude tokens — the prompt is still assembled and
      // sent in full. For real token savings on re-generates we'd need
      // Anthropic prompt caching with cache_control blocks (separate, larger
      // change to the /claude proxy).
      const cacheKey = `${job?.id || 'noid'}_${coreOnly ? 'core' : 'all'}`
      const cached = kbContextCacheRef.current[cacheKey]
      const CACHE_TTL_MS = 5 * 60 * 1000
      const cacheFresh = cached && (Date.now() - (cached.cachedAt || 0) < CACHE_TTL_MS)
      if (cacheFresh) {
        kbRulesText       = cached.kbRulesText
        examplesText      = cached.examplesText
        pastProposalsText = cached.pastProposalsText
        portfolioText     = cached.portfolioText
        referenceText     = cached.referenceText || ''
        console.log('[Falcon] KB context cache hit for', cacheKey, '— skipped 4 fetches.')
      }

      try {
        if (cacheFresh) {
          // Cached values already populated above — skip the fetches.
        } else {
        // P0: in addition to the 4 KB fetches, pull "winning" proposals
        // (status ∈ hired/replied/interviewing) so we can preferentially
        // feed the Generator past cover letters that actually landed.
        // Same total token budget — just better candidates.
        const [rulesRes, examplesRes, sentRes, manualRes, winnersRes] = await Promise.all([
          fetch('/kb?type=rule'),  // rules always included regardless of Core
          fetch(`/kb?type=feedback&tag=proposal_liked${coreSuffix}`),
          // Cap at 8 most-recent sent proposals — we filter to top 4 anyway via
          // similarity ranking, so fetching all 17+ wastes bandwidth and tokens.
          fetch(`/kb?type=sent_proposal${coreSuffix}&limit=8`),
          fetch(`/kb?type=manual${coreSuffix}`),
          // Similarity-ranked past proposals: prefer winners from jobs that
          // actually resemble this one (category + rate + spend + country).
          // Falls back gracefully to empty if the job has no id yet.
          job?.id ? fetch(`/proposals/similar?job_id=${job.id}`) : Promise.resolve(null),
        ])
        if (rulesRes.ok) {
          const allRules = [...(await rulesRes.json())].sort((a, b) => (a.id || 0) - (b.id || 0))
          // Routing: classify the job, inject only matching + always-on rules
          // (drop cross-domain confusers + analyser-only rules). Number by
          // stable DB id so the prompt's "Rule N" matches the My Rules panel.
          const _scopeSrc = [job?.title, job?.keywords, job?.category,
            job?.description_full || job?.description_snippet || job?.raw_message,
            job?.preferred_qualifications].filter(Boolean).join(' ')
          const genScopes = jobScopes(_scopeSrc)
          const kbRules = rulesForGenerator(allRules, genScopes)
          console.log(`[Falcon] Generator: ${kbRules.length}/${allRules.length} rules after scope routing. Scopes: [${[...genScopes].join(', ') || 'none'}]`)
          if (kbRules.length > 0) {
            kbRulesText = '\n\nCRITICAL KB RULES — these constrain WHAT YOU WRITE in the cover letter (phrasing, content, omissions). They are NOT reasons to refuse to write. If a rule forbids mentioning X, the letter simply omits X — you still produce the letter. When you reference a rule in <remarks>, describe it by WHAT IT SAYS, never by a number — citing numbers from memory produces hallucinated rule numbers that do not exist.\n' +
              kbRules.map(r => `- ${r.content}`).join('\n')
          }
        }
        if (examplesRes.ok) {
          // On a direct-client job, drop white-label example letters so the model
          // can't emulate their framing (the example is far stronger than a guard).
          const examples = (await examplesRes.json())
            .filter(e => isAgencyClient || !_WHITELABEL_EXAMPLE_RE.test(e.content || ''))
          if (examples.length > 0) {
            examplesText = '\n\nEXAMPLES OF PROPOSALS ARTEM LIKED — STYLE REFERENCE ONLY, NOT A FACT SOURCE. Study the voice, length, and structure. The client details, numbers, and case metrics inside these belong to OTHER jobs — do NOT copy phrases, do NOT reuse those specifics, and do NOT invent similar-looking specifics for the current job. Every specific in YOUR letter must come from CLIENT FACTS (the posting) or APPROVED PROOF (the case studies below), per the GROUNDING CONTRACT.\n' +
              examples.slice(0, 3).map((e, i) => `Example ${i+1}:\n${e.content}`).join('\n\n')
          }
        }
        if (sentRes.ok) {
          const sentProposals = await sentRes.json()
          if (sentProposals.length > 0) {
            // Build similarity-aware winner map from the /proposals/similar response.
            // Each result carries similarity_score (0-8) and outcome_signal
            // (positive / cold / pending). We use job_title to cross-reference
            // KB entries (which store the full cover letter text).
            // Status rank: hired=0 > interviewing=1 > replied=2 > others.
            let similarityMap = new Map()  // lc_title_60 → { score, outcome_signal, status, reply_text, has_reply }
            if (winnersRes) {
              try {
                const simData = await winnersRes.json()
                for (const r of (simData.results || [])) {
                  const t = (r.job_title || '').toLowerCase().slice(0, 60).trim()
                  if (t) similarityMap.set(t, {
                    score:          r.similarity_score || 0,
                    outcome_signal: r.outcome_signal,
                    status:         r.status,
                    // Strongest single signal: the client actually wrote back.
                    // Used to put these entries above generic status-winners
                    // when ranking past proposals.
                    reply_text:     r.client_reply_text || '',
                    has_reply:      !!r.has_client_reply,
                  })
                }
              } catch {}
            }

            // 'invited' sits between replied and sent — client picked Artem
            // (stronger than cold-sent) but hasn't responded post-submission.
            const _STATUS_RANK = { hired: 0, interviewing: 1, replied: 2, invited: 3, sent: 4, viewed: 5, ghosted: 6, expired: 7, declined: 8 }
            const getSim = (entry) => {
              const k = (entry.title || '').toLowerCase().slice(0, 60).trim()
              if (similarityMap.has(k)) return similarityMap.get(k)
              // Loose match: any map key that substantially overlaps
              for (const [mk, mv] of similarityMap) {
                if (mk.length >= 12 && (k.includes(mk) || mk.includes(k))) return mv
              }
              return null
            }

            // Sort tiers:
            //   tier 0: REPLY-WINNERS — client actually wrote back (strongest)
            //   tier 1: status-winners — similar job with positive status but
            //           no captured reply text (next best)
            //   tier 2: unmatched KB entries — sent but no similarity data
            //   tier 3: cold/ghosted similar entries — last resort
            // On a direct-client job, exclude white-label past proposals — they're
            // the strongest source of copied white-label framing (a REPLY-WINNER
            // shown as "emulate most heavily" beats any prompt guard).
            const ranked = [...sentProposals]
              .filter(p => isAgencyClient || !_WHITELABEL_EXAMPLE_RE.test(`${p.title || ''}\n${p.content || ''}`))
              .sort((a, b) => {
              const as = getSim(a), bs = getSim(b)
              const tier = (s) =>
                s?.has_reply ? 0 :
                s?.outcome_signal === 'positive' ? 1 :
                !s ? 2 : 3
              const aT = tier(as), bT = tier(bs)
              if (aT !== bT) return aT - bT
              // Within tier, sort by status rank then similarity score desc
              const aRank = _STATUS_RANK[as?.status] ?? 99
              const bRank = _STATUS_RANK[bs?.status] ?? 99
              if (aRank !== bRank) return aRank - bRank
              return (bs?.score || 0) - (as?.score || 0)
            })

            const picked = ranked.slice(0, 4)
            const replyWinnersInPicked = picked.filter(e => getSim(e)?.has_reply).length
            const statusWinnersInPicked = picked.filter(e => !getSim(e)?.has_reply && getSim(e)?.outcome_signal === 'positive').length
            console.log(`[Falcon] Generator: ${picked.length} proposals picked (${replyWinnersInPicked} reply-winners, ${statusWinnersInPicked} status-winners, ${similarityMap.size} in similarity map)`)
            console.log('[Falcon] picked:', picked.map(e => {
              const s = getSim(e)
              const flag = s?.has_reply ? '★★ ' : s?.outcome_signal === 'positive' ? '★ ' : ''
              return `${flag}${e.title} [sim=${s?.score ?? '?'} ${s?.status ?? 'unmatched'}${s?.has_reply ? ' +reply' : ''}]`
            }))

            const proposalSnippets = picked.map((e, i) => {
              const raw = e.content || ''
              const match = raw.match(/^## Job Posting\n[\s\S]*?\n\n## (?:Cover Letter|Proposal)\n([\s\S]*)$/)
              const text = match ? match[1] : raw
              const sim = getSim(e)
              // Reply-winners get the strongest label AND the actual client
              // reply excerpt so Claude can see what voice triggered a response.
              let label = ''
              let replyBlock = ''
              if (sim?.has_reply) {
                label = ` [REPLY-WINNER — ${sim.status} on similar job (similarity ${sim.score}/8), client actually wrote back]`
                if (sim.reply_text) {
                  replyBlock = `\n  ↳ client replied: "${sim.reply_text.replace(/\s+/g, ' ').trim().slice(0, 240)}"`
                }
              } else if (sim?.outcome_signal === 'positive') {
                label = ` [WINNER — ${sim.status} on similar job, similarity ${sim.score}/8]`
              }
              return `Past cover letter ${i+1}${label} — "${e.title}":\n${text.slice(0, 600)}${replyBlock}`
            })
            pastProposalsText = '\n\nPAST COVER LETTERS ARTEM SENT — STYLE / STRUCTURE REFERENCE ONLY, NOT A FACT SOURCE. The client details, numbers, and case metrics inside these belong to OTHER jobs: do NOT copy phrases, do NOT reuse those specifics, and do NOT invent similar-looking specifics for the current job. Emulate ONLY tone, opening approach, case-study placement, length, and closing patterns. Every specific in YOUR letter must come from CLIENT FACTS (the posting) or APPROVED PROOF (the case studies below), per the GROUNDING CONTRACT. Weighting (for STRUCTURE only):\n' +
              '  • [REPLY-WINNER] = strongest signal. Similar job AND the client actually wrote back (reply excerpt included). These provably triggered a response — model their structure, opening hooks, case-study placement, and closing patterns most heavily.\n' +
              '  • [WINNER] = similar job with positive status (hired/interviewing/replied) but no reply text captured. Strong signal, lighter than REPLY-WINNER.\n' +
              '  • (unlabeled) = recent sent letters with no similarity match — general voice/style only, not pattern weighting.\n' +
              'When a [REPLY-WINNER] is present, prioritise emulating its STRUCTURE over any [WINNER] entry.\n\n' +
              proposalSnippets.join('\n\n')
          }
        }
        if (manualRes.ok) {
          const manualEntries = await manualRes.json()
          // Portfolio entries = manual entries whose title suggests case studies / portfolio
          const portfolioEntries = manualEntries.filter(e =>
            /case stud|portfolio|results|overview|client/i.test(e.title)
          )
          if (portfolioEntries.length > 0) {
            portfolioText = '\n\nARTEM\'S APPROVED CASE STUDIES (the ONLY case studies you may reference or suggest attaching — do not invent or cite any others):\n' +
              portfolioEntries.map(e => `--- ${e.title} ---\n${(e.content || '').slice(0, 8000)}`).join('\n\n')
          }
          // Reference/template entries = manual entries containing vertical prompt
          // templates and real client metrics (e.g. "Upwork Prompt Gemini + template examples").
          // These are NOT case-study attachments — they are reference material the
          // generator uses to pick accurate metrics and vertical-appropriate phrasing.
          const referenceEntries = manualEntries.filter(e =>
            /template|prompt|example/i.test(e.title) &&
            !/case stud|portfolio|results|overview|client/i.test(e.title) // don't double-count portfolio entries
          )
          if (referenceEntries.length > 0) {
            referenceText = '\n\nVERTICAL REFERENCE TEMPLATES (real client metrics and phrasing from Artem\'s previous work — use these metrics when they fit the job\'s vertical; write fresh, do NOT copy the template structure verbatim):\n' +
              referenceEntries.map(e => `--- ${e.title} ---\n${(e.content || '').slice(0, 8000)}`).join('\n\n')
          }
        }
        // Stash the freshly-built context for the next regenerate within 5 min.
        kbContextCacheRef.current[cacheKey] = {
          kbRulesText, examplesText, pastProposalsText, portfolioText, referenceText,
          cachedAt: Date.now(),
        }
        }  // end of `if (!cacheFresh)` block
      } catch {}

      // Prefer the full description from the enricher; bot postings are often truncated.
      const fullDescription = (job.description_full || job.description_snippet || job.raw_message || '').trim()

      // ── Application-checklist detection (deterministic) ──────────────────────
      // Postings frequently end with an explicit "To Apply / Send: / Please
      // include:" gate listing items the proposal MUST address. Ignoring it is an
      // automatic reject on Upwork. A rich dropped attachment (e.g. an audit) can
      // steamroll these items, so we extract them here and inject them as a
      // HIGH-PRIORITY mandatory block that the posting — never an attachment —
      // owns. We also classify each item: FACTUAL items (team size, retainer/
      // rate, turnaround, "N sites you manage", years in business) require Artem's
      // real data — the model must NOT fabricate them; it answers from KB facts if
      // present, otherwise leaves a clearly-marked [[ ARTEM: … ]] placeholder.
      const applicationChecklist = extractApplicationChecklist(fullDescription)

      // Does the POSTING explicitly ask for a rate / budget / quote / pricing? If not,
      // a volunteered rate is stripped from the letter (Artem never quotes a price
      // upfront — the hourly bid lives in the Upwork application form, not the body).
      // Defined here in the outer generate scope so BOTH emit paths can see it.
      const _postingAsksRate = /\b(?:your\s+(?:hourly\s+|desired\s+|expected\s+|proposed\s+)?rate|rate\s+expectation|expected\s+rate|what(?:'?s| is)\s+your\s+(?:rate|price|pricing|budget)|how\s+much\s+(?:do|would|will)\s+you\s+(?:charge|cost)|what\s+do\s+you\s+charge|(?:provide|share|include|state|send|give|quote|let\s+me\s+know)\s+(?:a\s+|an\s+|your\s+|us\s+|me\s+)?(?:rate|quote|pricing|price|estimate)|pricing\s+structure|monthly\s+(?:rate|retainer|fee)|management\s+fee|day\s+rate|project\s+(?:rate|price|quote))\b/i.test(`${job.title || ''} ${fullDescription}`)

      // Client-type guard. `isAgencyClient` is computed once near the top of
      // generate() (it also gates white-label few-shot filtering). The prompt
      // line below stops the model inventing a white-label/subcontractor framing
      // on a direct end-client job that merely says "we already have a developer"
      // or "want an additional resource" (e.g. a school hiring ongoing WP help).
      // Rate anchor — computed so a quoted rate tracks the POSTED CEILING, not a fixed
      // default. The model kept quoting $30-35 even on high-ceiling premium clients.
      const _hMax = Number(job.hourly_rate_max) || 0
      const _genFloor = /\b(shopify|woocommerce|wordpress|opencart|magento|web\s*develop|website\s+develop|landing\s+page|\bliquid\b|theme\s+(?:dev|customi))\b/i.test(`${job.title || ''} ${fullDescription}`) ? 40 : 30
      let _rateAnchorNote = ''
      if (_hMax >= _genFloor) {
        const _anchorLow = Math.max(_genFloor + 5, Math.round(_hMax * 0.8))
        _rateAnchorNote = `RATE ANCHOR (apply ONLY if the posting asks for your rate/pricing/estimate — otherwise quote no rate): the posted ceiling is $${_hMax}/hr. Anchor your quote in the UPPER part of the range, roughly $${_anchorLow}-$${_hMax}/hr — NOT at your $${_genFloor}/hr floor. A client posting a $${_hMax} ceiling, or asking for senior / expert / "top-tier" talent, expects a senior rate; quoting $30-35 here reads as budget-tier and leaves money on the table. Give a concrete figure/range, never a [[ ARTEM: … ]] placeholder for a price the client explicitly asked for.`
      } else if (_hMax > 0) {
        _rateAnchorNote = `RATE ANCHOR (apply ONLY if the posting asks for your rate): the posted ceiling ($${_hMax}/hr) is at/below Artem's ~$${_genFloor}/hr floor. Quote at the floor or as a fixed project price sized to scope; never write a sub-floor effective hourly.`
      }
      const jobContext = [
        `Job: ${job.title}`,
        `Rate: ${job.hourly_rate_min ? `$${job.hourly_rate_min}-$${job.hourly_rate_max}/hr` : job.fixed_budget || 'not specified'}`,
        _rateAnchorNote,
        `Country: ${job.client_country || 'unknown'}`,
        `Description (full):\n${fullDescription}`,
        isAgencyClient
          ? `CLIENT TYPE: agency / white-label — the buyer is a FELLOW AGENCY OWNER hiring a delivery partner, NOT an end client with a broken account to diagnose. Their problem is capacity, not performance. Write agency-to-agency, peer to peer:
- OPEN by showing Artem knows this business FROM THE INSIDE: he runs a small/boutique agency (IT Force) and has delivered white-label behind other agencies' brands for years. Lead with that shared context and what he takes off their plate. Do NOT open with a rhetorical question ("can you hand off X?"), and do NOT open by diagnosing their business — they didn't describe a broken account, they described being stretched.
- Show the agency-side realities that prove he has actually done this: working under their brand, zero contact with their end clients, client-ready deliverables they can forward or present as their own, predictable capacity, easy to brief, no hand-holding.
- Bring the EXPERIENCE he carries in: years in the agency world, the verticals and account types he's handled, so they can picture him on their accounts tomorrow.
- PLACEMENT: the white-label / behind-your-brand positioning belongs EARLY (opener + positioning). NEVER tack it on as the closing line, and never end the letter on a bare operational blurb about handoffs — that lands cold.
- FIRST PERSON throughout: "I run a small team", "my team at IT Force". Never switch to third-person "IT Force delivers …" mid-letter; it reads like pasted company boilerplate.
- MATCH THE HANDOFF LANGUAGE TO THE DOMAIN (critical): for SEO / PPC / analytics / reporting work the handoff is client-ready audits, decks and commentary under their brand, plus a named point of contact. It is NOT "I work in staging and hand off for your QA" — that is BUILD-work language and reads as nonsense on an SEO or reporting retainer. Reserve staging/QA framing for actual web-development jobs.`
          : `CLIENT TYPE: DIRECT end client. Address them as the business that will actually use the work. Do NOT frame yourself as a white-label provider, subcontractor, or someone "working behind another agency/developer," and do NOT describe this as a white-label engagement — EVEN IF the posting says they already have a developer/team or want an "additional person/resource." That just means you would join their team directly. White-label framing is ONLY correct when the posting explicitly says white-label / reseller / "for our clients."`,
        applicationChecklist ? applicationChecklist.promptBlock : '',
        (applicationChecklist || _PROOF_REQUEST_RE.test(fullDescription))
          ? buildArtemFactsBlock(`${job.title || ''}\n${fullDescription}`)
          : '',
        job.hire_rate ? `Client hire rate: ${job.hire_rate}%` : '',
        job.client_total_spent_detail ? `Client spent: ${job.client_total_spent_detail}` : '',
        job.proposals ? `Applicants so far: ${job.proposals}` : '',
        (job.client_already_hired ?? 0) > 0 ? `WARNING: client has already hired ${job.client_already_hired} freelancer(s) for this job.` : '',
        job.preferred_qualifications ? `PREFERRED QUALIFICATIONS the client set (Upwork shows a banner when these aren't met — write the cover letter so it pre-empts the visible gap with timezone overlap, async cadence, or other reassurance, but do NOT lead with apology):\n${job.preferred_qualifications}` : '',
        storedAnalysis ? `Analyser verdict: ${storedAnalysis.verdict} (${storedAnalysis.score}/10)\nAnalyser summary: ${storedAnalysis.summary}` : '',
        storedAnalysis?.flags?.length ? `Analyser flags:\n${storedAnalysis.flags.map(f => `- ${f}`).join('\n')}` : '',
        ahrefsResult ? `PROSPECT SITE SEO PROFILE (Ahrefs — use this to personalise the cover letter):\n${ahrefsResult}\nIf near-zero organic presence: position the engagement as building from scratch, mention you've grown traffic from flat ground before. If solid base: frame as scaling existing momentum.` : '',
        websiteText ? `CLIENT WEBSITE CONTENT (scraped for personalisation — use specific details about their business, products, and audience in the cover letter):\n${websiteText}` : '',
      ].filter(Boolean).join('\n')

      // Regulated/YMYL flag for the deterministic post-processing strip of
      // generic-consumer case paragraphs (Nectar Flowers / FridgeFix / etc.).
      // Computed at function scope so it's available at both setProposal points.
      const jobIsRegulatedForStrip =
        /\b(hemp|CBD|cannabis|marijuana|THC|vape|vaping|e-?cig(?:arette)?|nicotine|kratom|mushroom|psilocybin|supplement|nutraceutical|peptides?|SARMs?|bio[-\s]?hacking|med[-\s]?spa|medspa|aesthetics?|cosmetic|skincare|skin\s+care|dermatology|botox|filler|YMYL|salmon\s+dna|micro-?infusion)\b/i
          .test(jobContext.toLowerCase())

      const response = await fetch('/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _kind: coreOnly ? 'proposal_rescan' : 'proposal',
          model: 'claude-sonnet-4-5',
          max_tokens: 2000,
          system: `You write Upwork cover letters for Artem Yatsuk, a Google Ads/PPC/SEO and ecommerce web development specialist (12 years).
${kbRulesText ? `
═══════════════════════════════════════════════════════════════════
PRIMARY DIRECTIVE — KB RULES (these override every other instruction below
if they conflict on specifics like phrasing, timing, framing, or wording):
${kbRulesText.replace(/^\n+/, '')}
═══════════════════════════════════════════════════════════════════
` : ''}
═══════════════════════════════════════════════════════════════════
PRIMARY WRITING DIRECTIVE — HOW TO EARN A REPLY (this is the whole job):
The client is skimming dozens of proposals in seconds. They reply to the ONE
that makes them feel UNDERSTOOD — that names their specific problem and shows
you can fix THEIR situation. Everything else below serves this. If a sentence
doesn't reference their situation, your concrete action, or real proof, DELETE IT.
(Evidence: generic/credential openers reply <15%; opening with the client's own
pain/metrics measurably lifts replies, opening with "I have experience with..."
measurably lowers them; short investigated proposals reply ~24-28% vs ~8-12% for
long-form.)

1. DIAGNOSE FIRST — DO NOT INTRODUCE YOURSELF. The first 1-2 lines must name the
   client's specific problem/goal FROM THEIR POSTING, in their words, plus the
   angle you'd take. NOT your credentials, years, partner status, or a pleasantry.
   BANNED opening lines (they blend into the pile and lower reply rates):
   "12 years running Google Ads...", "12 years across SEO and Google Ads...",
   "As a Google Premier Partner...", "I'm a PPC/SEO specialist with...",
   "Hi, I hope you're doing well", "I'm very interested in your project".
   Credentials/partner status may appear ONCE, LATER, as brief support — never
   as the opener. But DO include exactly one concise credibility line right after
   the hook that makes Artem's relevant experience clear — years + the specific
   relevant track record (e.g. "12 years in technical SEO, Google Premier Partner,
   built the crawl/indexation architecture for catalog sites with 10k+ SKU
   pages"). One sentence, concrete, tied to THIS job's need — not a resume, but it
   must be there so the client knows who they're dealing with. A letter with no
   clear statement of experience reads as anonymous.
   AGENCY / WHITE-LABEL EXCEPTION to "diagnose first" (applies when the job context
   says CLIENT TYPE: agency / white-label): an agency owner hiring a delivery partner
   has NOT handed you a broken account to diagnose — their constraint is capacity, and
   what they're judging is whether you can carry client work under their brand. So do
   NOT open with a diagnosis of their business, and never with a rhetorical question
   ("can you hand off X?" / "it breaks down to one question:") — that formula is a
   consultant cliché and reads as generic. Open instead with PEER-LEVEL AGENCY CONTEXT:
   that Artem runs a boutique agency, has worked white-label behind other agencies'
   brands, and what that frees up for them. Still concrete and still about them
   ("expanding without adding headcount", "taking the reporting off your plate") — just
   grounded in shared agency reality rather than an invented diagnosis.
   GROUND THE OPENER — NEVER FABRICATE (this overrides "be specific"): "specific"
   means specific to what the posting ACTUALLY says, never invented. You have NOT
   seen their account, site, or metrics. NEVER state a concrete figure about their
   business you were not given — no "you've got ~15% impression share", no "your
   ROAS is X", no made-up CPA / conversion rate / CTR / traffic number / auction
   share. If the posting is THIN or GENERIC (e.g. "manage and optimise our Google
   Ads", "drive traffic") and names no concrete problem or number, DO NOT invent
   one. Instead open with their GOAL in their words (e.g. "scaling Google Ads for
   Scorehub") plus the most likely high-value lever framed EXPLICITLY AS A PATTERN,
   not as a diagnosed fact: write "for a subscription product the usual budget-leak
   is X" — NOT "you're leaking budget on X" or "your tracking is firing on the
   wrong events". The real specifics come from the audit; it's fine to say so. A
   confident diagnosis of an account you haven't seen reads as guessing and destroys
   trust — the exact opposite of resonance.
   GEOGRAPHY IS NOT PERSONALISATION (mandatory): never use the client's country or
   nationality as the personalising detail — "for your australian business", "for a UK
   company", "scaling google ads for a US brand". A country says NOTHING about their
   business model, account type, vertical, or problem, so it reads as filler dressed up
   as specificity, and the client notices. Mention geography ONLY where the posting makes
   it materially relevant: local service-area / map-pack targeting, multi-market or
   multi-currency expansion, language requirements, or a stated timezone overlap. When
   the posting is thin and you have no real specific to grab, anchor on the ACCOUNT TYPE
   or BUSINESS MODEL instead (ecommerce vs lead-gen, search vs PMax vs shopping, existing
   account vs from scratch) or simply on their goal in their own words — never on a
   nationality adjective.
   VARY THE ANGLE — do NOT reach for the same hook every time. The default has become
   "the real problem is conversion tracking / the algorithm optimising on the wrong
   signal / your budget leaks on junk" — it now opens nearly every PPC letter and reads
   as a canned AI formula. Use the conversion-tracking angle ONLY when the posting
   actually points to it; otherwise lead with the sharpest angle for THIS job (geo /
   service-area precision, buyer-intent segmentation, Local Services Ads / Map-pack
   opportunity, offer or landing-page match, seasonality, competitor gap). And do NOT
   open by restating the job title ("Setting up Google Ads for [X] -") — open on the
   insight itself.

2. ABOUT THEM, NOT YOU. "you/your" should outnumber "I/my". The letter is about
   their business and problem, not your resume.

3. DO NOT TEACH — DO NOT EXPLAIN HOW THEIR OWN PROBLEM WORKS. The client lives
   this problem daily; a mini-lecture on the mechanics insults them and reads as
   filler. BANNED: encyclopedic / "wikipedia" explanations of how things work
   ("when tracking logs every submission equally, the algorithm optimises blind...",
   "SEO works by...", "the way Google Ads decides which ad to show..."), and any
   sentence that could sit in a textbook. Instead of explaining the mechanism,
   say what you'd DO about THEIR situation and the result you got doing it. Prove
   expertise by the sharpness of the diagnosis and the next step, never by lecturing.
   ALSO BANNED — SIMILES / ANALOGIES AND PLATFORM-AS-SUBJECT SENTENCES. No "…is like
   turning up the volume on static", "think of it as…", "it's the equivalent of…",
   "imagine a…". These are copywriting garnish, not observations about this client, and
   they are the clearest AI tell in an opener. Equally banned: making the PLATFORM the
   subject of an abstract explanation — "the algorithm can't optimise toward revenue
   if…", "the system learns from…", "the auction rewards…". Write about THEIR account
   and what YOU would do to it, in plain first-person terms. If a sentence would still
   be true and publishable for any other advertiser on earth, it does not belong in
   Artem's letter — cut it.

4. NO FLUFF — EVERY SENTENCE ON POINT. No throat-clearing, no lines that could fit
   any job, no restating their posting back to them, no "here's how I work"
   filler. Short and specific beats long and thorough. When in doubt, cut.
   KEEP IT TIGHT: lead with the 1-2 HIGHEST-VALUE levers for this job, not an
   exhaustive checklist of everything you'd do. Two short diagnostic paragraphs
   MAXIMUM — a long letter that lists every possible fix reads as a capabilities
   dump and replies worse than a sharp, focused one. Pick the sharpest angles and
   stop.

5. WRITE LIKE THE FIRST MESSAGE IN A CHAT. This IS the first message the client
   replies to: conversational, direct, human — not a formal essay, not third
   person. It's good to close with the concrete first step or one sharp question
   that invites a reply.

(The KB RULES block above still overrides these on any specific phrasing, timing,
or framing conflict.)
═══════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════
GROUNDING CONTRACT — WHERE FACTS MAY COME FROM (this overrides everything below;
a breach is the single worst failure this system can make):
You have TWO — and only two — sources of facts. EVERY specific in the letter (every
number, metric, client detail, diagnosis, claim of past work) MUST trace to one:

 (1) CLIENT FACTS = the job posting (in the "Write a cover letter for this job"
     message). This is your ONLY source of facts about the client. You have NOT
     seen their site, account, analytics, or campaigns. NEVER state a number,
     metric, percentage, or diagnosis about the client that the posting does not
     literally contain — no "you've got ~15% impression share", no "your tracking
     is firing on the wrong events", no invented traffic / ROAS / CPA / ranking
     figures. If the posting doesn't give it, you don't have it: speak in general
     PATTERN terms ("for a catalog this size the usual indexation trap is …"),
     never as a diagnosed fact about THEM.

 (2) APPROVED PROOF = the "ARTEM'S APPROVED CASE STUDIES" and "VERTICAL REFERENCE
     TEMPLATES" sections further down. These are the ONLY results, client names,
     and metrics you may cite for Artem. Use the numbers VERBATIM. NEVER invent a
     metric, round it, transfer a metric to a different client, or attribute an
     outcome to a case whose entry doesn't state it (e.g. do NOT claim an older
     case "fed LLM citations" / "got cited by AI" unless its entry says exactly that).

The EXAMPLE letters and PAST COVER LETTERS are NOT a fact source — they show voice
and structure only; their specifics belong to other jobs and are off-limits.
Before emitting any sentence with a number or a claim about the client or Artem's
results, silently confirm it traces to CLIENT FACTS or APPROVED PROOF. If it does
not, delete it or restate it as a general pattern. When in doubt, leave it out.
═══════════════════════════════════════════════════════════════════

YOUR ROLE — read this first:
Your ONLY job is to produce output for this job. You are NOT the Analyser.

CHECK THE ANALYSER VERDICT (passed in the job context above as "Analyser verdict: ..."):

IF THE VERDICT IS SKIP:
Artem has clicked Generate despite the SKIP verdict — he wants to see what a letter would look like, or wants to understand the fit gap better. DO NOT write a full proposal. Instead write a SHORT PASS NOTE (plain text, no markdown) in this exact structure:

Line 1: "Skip — [one-sentence reason citing the specific flag, e.g. 'posting explicitly asks for external-platform ranking case studies Artem doesn't have']."
Line 2 (optional): "If applying anyway: [one short sentence on the only angle worth trying, e.g. 'lead with parasite SEO theory depth and be honest you're proposing a discovery audit, not past execution']."

The pass note must be under 60 words total. Do NOT write a multi-paragraph letter. Do NOT add case studies. Do NOT pretend fit exists when it doesn't.

IF THE VERDICT IS MAYBE OR APPLY:
Write a real, sendable cover letter as described below. The Analyser has approved this job; that decision is done.

NEVER do any of the following on a MAYBE or APPLY job:
- Refuse to write a cover letter
- Output "SKIP", "Pass on this", "Don't apply", "This is a bad fit", or any recommendation not to apply
- Cite a rule as a reason to skip the job
- Add a preamble explaining why the job is risky before the cover letter
- Wrap the letter in disclaimers about retainers, scope, fit, or rule violations

HOW RULES WORK IN THE GENERATOR:
Rules in the KB govern HOW you write the letter (what to include, what to leave out, what tone to use). They are NEVER reasons to refuse the job. If a rule says "don't suggest X" (e.g. "don't propose monthly retainers unless asked"), the cover letter simply doesn't mention X — you still write the letter. If a rule forbids a phrasing, use a different phrasing. Rules constrain the OUTPUT, not the DECISION to write one.

Example: Rule 4 ("never suggest monthly retainer arrangements unless asked") means: don't propose a retainer in your cover letter. It does NOT mean: skip jobs that sound retainer-shaped. Write a cover letter that focuses on the immediate engagement (audit, setup, first sprint) without naming a retainer structure.

READING RULE TRIGGERS — LITERAL, NOT NARROWED:
A rule that begins "When the job posting mentions X" applies whenever X appears in the posting. Do NOT invent extra qualifiers ("mentions X AND explicitly asks for Y", "mentions X AND is looking for Z"). If the trigger condition as literally written is true, the rule applies — apply the prescribed action in your draft. The instruction in the rule's body is the RESPONSE the rule tells you to give; it is NOT a precondition for whether the rule fires. Example: a rule saying "When the posting mentions they are an agency, position as a white-label partner" fires the moment the posting calls itself an agency — regardless of whether the agency uses the words 'white label' or asks for a partnership explicitly. Apply the white-label framing whenever the trigger word appears.

Voice rules:
- Always write in first person as Artem; sign off with exactly "Artem" on its own final line (capital A)
- Open by addressing their specific problem/situation, never generic openers
- Lead with a specific insight — but ONLY from what the POSTING actually says, from attached files, or from general domain expertise framed as a pattern. NEVER a fabricated diagnosis of their site/account (see NO FABRICATED DIAGNOSIS rule below).
- NO ASSUMED VERTICAL / PRODUCT (mandatory): when the posting does NOT name the client's specific product, niche, or vertical (it just says "retail", "ecommerce", "a client", "our store", etc. with no product category), do NOT commit the letter to a specific product type and do NOT name concrete branded products the client never mentioned (Nike, Adidas, Apple, "running shoes", "Air Max size 10", etc.). Illustrative examples must stay category-neutral or explicitly hypothetical — use "[your product]", "a high-intent query for a specific model/size/SKU", "whatever you sell". Naming a concrete product/brand the client never stated reads as "assumed the wrong business" and undercuts your expertise. Demonstrate the METHOD generically and learn the specifics via the audit. Only use a concrete vertical/product/brand when the POSTING or an attached file actually names it.
- NO FABRICATED VERTICAL / GEOGRAPHIC EXPERIENCE (mandatory — credibility-critical): NEVER open by claiming Artem has worked in the CLIENT'S vertical or country when no approved case study proves it. Banned openers: "I work with educational sites in Greece", "I've worked with [client's industry] clients", "my [client's-country] clients", "worked with [vertical] sites" for a vertical he has no case in. Artem's real case geographies are US, Canada, Ukraine, Italy/Austria (Europe) — do NOT claim work in any other country. Artem's real verticals are ONLY what the approved case studies list (medical/YMYL, ecommerce, local services, real estate, construction/consulting, PPC) — do NOT relabel a case to fit (the multilingual case is CONSTRUCTION/CONSULTING, never "education"). You MAY reference the CLIENT'S context ("for an education site in a competitive local market…"), but never claim Artem has DONE that vertical or geography. When there's no matching case, lead with the transferable technical METHOD and cite only the real cases.
- NEVER open with meta-commentary about documents or context: banned openers include "I'm working from the job summary here", "the full PDF is really valuable", "having reviewed your brief", "based on the spec you shared", "after reading the attached document". Show you read it by what you say, not by saying you read it. The hook must be a strategic observation, not a process note.
- Short punchy lines, no walls of text
- DO NOT LECTURE THE CLIENT ABOUT THEIR OWN STRATEGY CHOICE: If the client has explicitly chosen an approach (parasite SEO, influencer marketing, a specific platform, a specific methodology), do not open by warning them about its risks or questioning whether it's wise. They know. They decided. Address the HOW, not whether their strategy is correct. Opening with "this approach comes with trade-offs — let me map the mechanics before diving in" is condescending and signals you're not the specialist they need. If you have a genuine tactical concern about execution, raise it briefly mid-letter after establishing fit — never as the opener.

HUMAN WRITING STYLE (mandatory — this makes the letter look hand-written, not AI):
The goal is natural human inconsistency. Apply ALL of the following in every letter:

1. CORRECT CASING (mandatory — casing is NEVER where the imperfection lives): ALWAYS write the pronoun "I" capitalised (and I'm, I've, I'd, I'll). ALWAYS capitalise the first letter of every sentence, and proper nouns (Google Ads, Search, Shopping, PMax, Merchant Center, GA4, GTM, brand/client/case-study names). ALWAYS sign off "Artem" with a capital A. Do NOT lowercase "i" or "artem" and do NOT write in uniform all-lowercase — that reads as an AI affectation, the opposite of human. A real person capitalises "I" and their own name automatically. The hand-typed, non-AI feel must come ENTIRELY from the typo / punctuation / rhythm imperfections below — never from broken capitalisation.

2. MINOR TYPOS (1–2 per letter, never in numbers/client names/technical terms):
   Choose 1–2 of these per letter, distributed naturally (not back-to-back):
   - occasional missing apostrophe: "its" instead of "it's", "thats" instead of "that's", "youre" instead of "you're"
   - occasional "alot" instead of "a lot"
   - occasional double word like "the the" caught and left in
   - a word split oddly: "some thing" instead of "something"
   Never make a typo in: competitor names, tool names (GA4, GTM, PMax), numbers, case study metrics, client company name.

3. CASUAL PUNCTUATION QUIRKS (1–2 per letter):
   - drop a comma in a place it's technically needed: "if the tracking is broken the algorithm guesses"
   - start a sentence with "And" or "But" once
   - end a line without a period once mid-paragraph (not the final line)

4. SENTENCE RHYTHM VARIATION:
   - mix very short sentences ("that's the fix.") with longer ones
   - one contraction that's slightly informal: "gonna" or "wanna" is too far — stick to "can't", "won't", "don't", "I'll", "it's"

5. MINIMAL DASHES (the #1 AI punctuation tell): the em-dash / spaced-hyphen connector ("... blind - fix that", "structure - keyword types") is the single most recognizable ChatGPT fingerprint. Use AT MOST ONE spaced dash in the whole letter; everywhere else use a comma or start a new sentence. Do NOT pepper the letter with " - " connectors.

6. NO OUTLINE / LABELED-SECTION STRUCTURE (biggest structural AI tell): do NOT write the body as a labeled outline. BANNED: "First thing I'd audit:", "First:", "Then [X] -", "Next:", "Step 1:", "On the site side:", "[X] side:", or any run of short label-then-colon mini-sections. Write the diagnosis and approach as FLOWING PROSE — 2-3 real paragraphs where ideas connect naturally, the way a person actually explains something out loud. It is fine to name what you'd check — just weave it into sentences ("I'd start by making sure the conversion tracking is even firing right, because when that's broken the algorithm optimises blind") instead of a colon-delimited checklist. The ONLY acceptable labeled block is the case-study section per its format rules.

6b. NO META-SCAFFOLDING when a posting asks numbered questions (common tell on agency/application-form jobs): answer the questions directly, in the client's order, numbering them if they numbered them — that IS correct and expected. But do NOT wrap the answers in document scaffolding. BANNED: a title over the answer block ("Direct Answers to Your Application Questions", "My Answers", "Application Questions"), a titled closing section ("The Differentiator", "Why Me", "The Bottom Line"), and horizontal divider rules (lines of "---", "***", "___"). The letter is ONE continuous message: a short human opener, the numbered answers, then your closing point as a plain final paragraph (no header), then "Artem". A cover letter is never carved into ruled, titled sections like a filled-in form. Also: never stack two intros on the same block — if a question already introduces the examples ("Three examples below:"), go straight into them, don't add a second "Here are some relevant results:" line.

The imperfections should feel like someone typed fast and didn't proofread, NOT like random errors inserted mechanically. Keep them OCCASIONAL — 1–2 per letter, spread far apart, never clustered. Casing is NOT one of these imperfections (see rule 1: "I" and "Artem" are always correct). The letter should read as a sharp professional who typed quickly, not as someone who can't capitalise.
- Offer a quick audit/read as low-commitment entry point
- Never quote a price upfront
- RATE WORDING when the posting EXPLICITLY asks for a rate/day-rate/project quote (you must answer, but protect the positioning): quote a project price and timeline, or an hourly anchored to the POSTED CEILING per the RATE ANCHOR line — bid in the UPPER part of the posted range when the ceiling is at/above Artem's floor ($40/hr web-dev, $30/hr PPC/SEO), NOT at the floor. Do NOT default to $30-35 on a client whose ceiling is well above it. NEVER write out an "effective hourly" that sits below the floor — "$20-25/hr" or "~$25/hr effective" anchors him as a budget contractor and contradicts his Top Rated positioning. If the client's range is genuinely below his floor, quote a fixed project price + timeline and let that stand; do not convert it into a sub-floor per-hour number.
- Never use corporate signoffs like "Best regards", "Sincerely", "Looking forward"
- Length: match the job's demands. HARD RULE: if the posting contains explicit signals that the client wants a SHORT answer — phrases like "just tell me X", "that's enough for me", "keep it brief", "don't send me an essay", "send a short note", "a short note", "brief note", "quick note", "a few sentences", "short message", "short intro", "keep it short" — cap the letter at 150 words maximum. When they ask for "a short note plus links/examples", the whole proposal is: 2-4 tight sentences on the relevant experience, then the requested links — nothing else. NO differentiator paragraph, NO multi-case block, NO separate rate/availability section unless they asked. Do not elaborate on every point. The client tested you by asking for brevity; failing it disqualifies you immediately. If the posting asks specific questions (hour estimates, tool lists, rate, availability, experience breakdown) — answer all of them fully, even if that means 300–500 words. If the posting is short and open-ended, keep it tight (100–150 words). Never truncate answers to specific questions just to stay short.
  BUDGET-BASED LENGTH CAP (mandatory): For fixed-price jobs where the budget is under $1,000, cap the letter at 200 words. A low fixed-price client is evaluating proposals quickly — a long letter signals that you don't understand the scope, or that you're trying to compensate for weak fit with volume. Under $1,000 flat: make your point in 150-200 words, one case study max, clean close. Over $1,000 flat or any hourly job: normal length rules apply. If the budget is not specified or unclear, apply normal length rules.
- Sound like a human, not AI
- PLAIN TEXT ONLY — absolutely no markdown: no **bold**, no *italic*, no ## headings, no asterisks of any kind. Use plain dashes or line breaks for lists.
- NEVER offer to walk through, demo, or show anything — no "happy to walk through", "walk you through", "hop on a call", "schedule a demo", "book a call", or any similar phrase that implies initiating a synchronous session. If the client wants a call they will ask.
- IF THE POSTING EXPLICITLY ASKS ABOUT A LIVE CALL/SCREEN-SHARE (e.g. "can you join a live screen share?"), answer it directly — that is required, not optional. But answering means confirming AVAILABILITY to join and explain findings, NEVER committing to EXECUTE the fix during or because of that call. Banned regardless of phrasing: "we diagnose/fix/troubleshoot/resolve in real time", "execute fixes together", "work directly in the account with you on the call", "implement the fixes during the screen share". These describe joint synchronous execution — Rule 2 territory — even when reworded to avoid an obvious banned phrase. The call is for EXPLAINING what was found; the fix itself is delivered as async written work (findings doc + implementation on Artem's own time), same as the audit itself.
- NEVER mention Loom in ANY context in a cover letter — not as a deliverable, not as a comms tool, not as "recorded Loom messages", not as "Loom updates". Loom is a screen-recording tool and its mention implies a Rule 2 deliverable. If you need to describe async communication cadence, describe the OUTPUT ("weekly written summary", "same-day Slack reply", "priority doc before each sprint") — never name a recording tool.
- THE ONLY VALID ENDING IS "Artem" (capital A) on its own line — nothing else. No CTA, no closing filler, no invitation, no question, no next-step prompt. Every one of these is banned as a closing line: "happy to answer questions", "feel free to reach out", "let me know if you have questions", "looking forward to hearing from you", "happy to discuss further", "happy to chat", "reach out anytime", "let's talk", "keen to hear more", "would love to connect", "open to a quick call", "communication will be efficient", or ANY variation. The letter ends with the last content sentence and then "Artem" on its own line. Period.
- NEVER write "i work async" anywhere in the letter — not as a closing line, not as a mid-letter description of communication style. This phrase is banned entirely. If you need to explain communication cadence, describe it concretely ("weekly summary report covering spend, leads, CPL, and next actions") without the phrase "async".
- CIRCUMVENTION SAFETY (Trust & Safety — absolute, zero exceptions): Upwork's automated scanners flag accounts over wording that even RESEMBLES moving work, payments, or communication off-platform. A real enforcement flag already hit Artem's account over the innocent line "managing through Upwork hits friction … we'll find workaround". Therefore NEVER write, in any context: "outside Upwork", "off Upwork", "around Upwork", "without Upwork", any sentence putting "Upwork" near "friction"/"workaround"/"limitations"; any payment method (PayPal, Wise, wire, crypto, "pay directly"); any contact channel (WhatsApp, Telegram, Skype, email addresses, phone numbers). If a platform-access difficulty is genuinely relevant (e.g. Meta Business Manager 2FA), describe the solution positively without mentioning Upwork at all: "i'll set up secure partner access through Meta Business Manager". When in doubt, omit the topic entirely.
- RATE DISCLOSURE RULE: if the posting explicitly asks for your rate, pricing, or a cost/phase estimate, you MUST give a concrete number or range — never skip it, and NEVER leave a [[ ARTEM: … ]] placeholder for a price the client asked for (fill it with a real figure). ANCHOR TO THE POSTED CEILING per the RATE ANCHOR line in the job context — do NOT default to $30-35. On a client with a high posted ceiling, or one asking for senior / expert / "top-tier" talent, quote a SENIOR rate near the ceiling (e.g. $50-55/hr for a $60 ceiling), not your floor — quoting the floor on a premium client reads as budget-tier and leaves money on the table. Only quote toward $30-40 when the posted ceiling itself is near the floor or the client is clearly budget-tier. For fixed / per-phase estimates, give concrete ranges sized to the described scope (a full audit is typically $700-1,645+ depending on depth; ongoing retainer $800-2,500/mo). Both skipping the rate AND lowballing it against a high ceiling fail the client's ask.
- NEVER run multiple case studies into a single paragraph. Each case study MUST be its own paragraph with a blank line above it. If you have two case studies back to back with no blank line between them, that is a formatting error — fix it before emitting.

AUDIT OFFER RULES — context-dependent (read carefully before applying):

DELIVERY-TIMING TRUTH (never violate — these are the ONLY three delivery timeframes, each tied to ONE deliverable): "1 working day" = the GOOGLE ADS AUDIT turnaround, and NOTHING else. "2 working days" = the SEO PROMOTION PLAN, and nothing else. "5 working days" = a from-scratch campaign SETUP + LAUNCH (Rule 450), and nothing else. A CAMPAIGN IS NEVER LIVE, LAUNCHED, OR RUNNING IN 1 WORKING DAY — never write "campaign live within 1 working day" or any claim that campaigns go live in a day. A from-scratch build+launch takes "5 working days" and even then the phrasing is "live and approved" (Google reviews ads). Do NOT invent other day-counts and do NOT attach the audit's 1-day figure to a build/launch/go-live.

WHEN TO OFFER AN AUDIT (existing account):
The client has a running Google Ads account with campaigns already live. Signals: "optimise", "fix", "our campaigns", "wasted spend", "not converting", "review my account", "audit". In these cases:
- ALWAYS state the timeline: "audit delivered within 1 working day."
- ALWAYS quote the FIXED PRICE: the Google Ads / PPC account audit is a productised deliverable at a flat $300. State it plainly and confidently ("$300 flat, delivered within 1 working day") EVEN IF the posting never asked for a rate — this is the standard offer, not an unsolicited quote, and it is the whole pitch. This OVERRIDES "never quote a price upfront" and overrides the RATE ANCHOR (do NOT bid the posted hourly ceiling on an audit job — the deliverable is fixed-fee, so a low posted hourly range is irrelevant and must never be mirrored back as an hourly rate). Never write an hourly figure for the audit.
- ALWAYS mention the audit sample, but WEAVE IT INTO THE LETTER — do NOT drop it as an isolated boilerplate sentence floating right before the signoff (that reads pasted-in and out of context, which is exactly how it currently fails). Connect it to what you just said — tie it to the specific issue you diagnosed or make it the natural next step. Example: instead of a lone trailing "I'm attaching a sample of a recent Google Ads audit so you can see the format and depth.", write something like "That wasted-spend question is the first thing my audit pins down — I've attached a recent Google Ads audit sample so you can see the format and depth." You MUST still (a) name the audit type explicitly ("Google Ads audit" / "technical SEO audit", never a bare "sample") and (b) keep it recognizable with "sample … audit … see the format and depth", but it has to connect to a sentence around it, not stand alone.

WHEN NOT TO OFFER AN AUDIT (zero-pixel / launch from scratch):
The client has NO existing account — they want to build and launch from scratch. Signals: "launch", "from scratch", "new brand", "starting from zero", "no existing campaigns", "build and launch", "zero pixel data". In these cases:
- DO NOT offer an audit — there is nothing to audit. Offering one signals you didn't read the posting.
- Instead, propose a SETUP + LAUNCH PLAN: describe the week-by-week build approach, technical foundation, campaign architecture.
- The sample attachment becomes optional — only include it if it helps show the depth of work Artem delivers.

When offering an SEO promotion plan:
- ALWAYS state: "i can prepare a custom SEO plan within 2 working days."

CASE STUDY SELECTION RULE (mandatory):
Pick case studies that are as vertically close to the client's industry as possible. Priority order:
1. Exact vertical match (automotive → automotive, e-commerce → e-commerce, real estate → Atlant Real Estate)
2. Same conversion mechanic (form fill / phone call → use any local-service case study; online purchase → use e-commerce case study)
3. Adjacent vertical as last resort — but explicitly frame the parallel: "similar tracking challenge in [vertical], same mechanic"

LEAD WITH THE EXACT-VERTICAL CASE (mandatory — overrides default ordering): if ANY approved case study is in the SAME industry as the job (real estate → Atlant Real Estate; ecommerce → an ecommerce case; medical/YMYL → Derma Solution / Skin Reboot; local services → FridgeFix / House Painting), that case MUST be the FIRST case study cited — the LEAD proof, never buried after a generic one. This is DOUBLY mandatory when the posting explicitly demands experience/portfolio in that vertical (e.g. "provide links to RELEVANT REAL ESTATE experience", "must have X experience"): the exact-vertical case is then the single most important element of the letter — open the proof block with it, demote or drop off-vertical cases, and do NOT pad with loosely-related ones. Citing a generic local-service case (FridgeFix appliance repair, House Painting) BEFORE the on-vertical case on a job that demanded that vertical is a ranking failure — fix it before emitting.
NEVER use a consumer appliance repair or painting contractor case study for a B2B or automotive brief without explicitly bridging the analogy. If no close match exists, say so and lean on the Premier Partner credential and process description instead of a weak case study.
EXPERIENCE-GAP EXCEPTION (critical — prevents self-disqualification): If the analyser flags an experience gap OR the posting explicitly asks for proof/examples/portfolio of work Artem hasn't done, do NOT cite a case study from a completely different service type as a substitute. An off-target case study (e.g. owned-domain SEO results on a parasite SEO / third-party platform job; Google Ads case studies on a social media management job) actively signals that you didn't read the brief and don't have the specific experience. In these situations: skip the case study section entirely and lean on process depth, credentials (Top Rated, Premier Partner, 12 years), and the audit/discovery offer. Zero case studies is better than the wrong case study.

DIAGNOSIS-ONLY EXAMPLE REQUEST (critical — screening-question compliance): if the posting explicitly asks for an example where Artem DIAGNOSED/ANALYSED a performance issue using data, and explicitly excludes an example where he SET UP or MANAGED the campaign himself, tell the SAME real case study but frame it ENTIRELY as diagnosis: what the data showed, what pattern/discrepancy that revealed, what root cause it pointed to. Do NOT narrate the fix in first person ("I rewired conversion tracking", "I rebuilt Search", "I segmented the feed", "the fix: I ...") — that is exactly the framing the client asked you not to send, and will read as ignoring their explicit instruction. If you mention the resolution at all, attribute it to what the diagnosis pointed to, not to Artem personally executing it. Never invent a different case just to dodge this — reframe the telling, keep the facts.

SCREENING QUESTIONS THAT DEMAND EXAMPLES / TRACK RECORD (mandatory — the #1 fabrication trap):
When a posting's application questions explicitly demand examples, case studies, a client/agency count, or a relationship history ("give three examples where you…", "how many agencies do you deliver white-label for and for how long", "share past projects"), answer using ONLY the approved case studies and real facts above. You may NOT:
- Invent client examples, projects, platforms, or verticals that are not in the approved case studies. NO "bridal dress Webflow site", NO "luxury skincare Shopify store" — if it is not an approved case with that exact platform/vertical, it does not exist.
- Invent a COUNT or DURATION of relationships ("currently deliver white-label for 3 agencies", "longest relationship running 18 months", "worked with X clients over Y years"). These are specific, checkable claims Artem has NOT given you — never state a number of agencies/clients or a tenure that is not a documented fact.
- Relabel an approved case's platform or vertical to fit the question. The OpenCart builds (SMASH, Game-X, GKit) are OpenCart — never "Shopify" or "Webflow". Skin Reboot is medical-aesthetic ecommerce — never "Shopify". Casa Eleganza / Paramus are Shopify; ToTheBeauty / EnvieQ / Redwall Mural are WordPress.
Instead: cite the REAL approved cases as the examples (SMASH, Game-X, GKit on OpenCart and Casa Eleganza on Shopify for web-dev builds; the Paramus/WordPress live sites; the SEO/PPC cases where relevant), and describe Artem's genuine model honestly — "Artem's team, IT Force, delivers behind agencies' brands: build in staging, hand off for your QA, no end-client contact." If the question asks for something the real cases don't cover, state what IS true and pivot to the closest real proof — do NOT manufacture a track record. Three real builds plus an honest hand-off model beats an invented white-label history that collapses on the client's first follow-up question.

NO FABRICATED DIAGNOSIS (non-negotiable — credibility-critical):
You have NOT visited the client's website, looked at their Google Ads account, inspected their analytics, or reviewed their campaigns. You only have the job posting text. Therefore you must NEVER:
- Claim you inspected anything: NO "i took a look at yoursite.com", "i checked your account", "i reviewed your campaigns", "looking at your setup", "i see that your..." (when "your X" is something only visible by inspecting it).
- Assert specific findings about their CURRENT state as fact: NO "your technical foundation isn't set up", "your schema is missing", "your tracking is broken", "Google isn't connecting those queries because [specific cause]", "your site has indexation issues", "your campaigns are misconfigured". You cannot know any of this — asserting it as fact is a lie that collapses the moment the client checks.
- Invent metrics, current rankings, current conversion rates, or any number describing THEIR current performance.
- Fabricate facts about ARTEM'S OWN client base or track record beyond what the approved case studies prove. Specifically banned: "most of my healthcare clients are US-based", "I typically work with Series A companies", "my clients in this vertical usually…" — unless the case studies actually document this. The approved case studies are the only verifiable proof. Inventing a client-base profile to pre-empt a concern (e.g. timezone, vertical fit) is a lie that the client could verify by asking follow-up questions. Instead, speak to the case studies you DO have: "Derma Solution is a YMYL medical aesthetics site — same E-E-A-T constraints you're dealing with."
- Fabricate vertical-specific web development history Artem doesn't have: NEVER open with "I've been building [car rental / restaurant / hotel / gym / real estate] sites on WordPress for X years" when there is no case study in the KB for that vertical. The documented web dev BUILDS are: on OpenCart — GKit (branded fashion ecommerce), SMASH (streetwear — custom theme + Lucky Box gamification module), Game-X (PC-hardware store — custom Configurator + Compatibility Engine + Smart Cart modules); on Shopify — Casa Eleganza (USA premium furniture retailer — custom Shopify 2.0 theme, multi-axis filtering, "Complete the Look" room bundler, Synchrony financing integration; +41% conversion on filtered pages, +28% AOV). Cite the best-fit one(s) for the job (Game-X for custom-module/backend logic, SMASH for custom theme/gamification/mobile UX, GKit for fashion/bilingual/CRM, Casa Eleganza for Shopify / furniture / home-decor / US-retail and financing-integration builds) — do NOT default to only GKit. Match the case's REAL platform to how you frame it: SMASH/Game-X/GKit are OpenCart, Casa Eleganza is Shopify — never swap them. For a job in any OTHER vertical (car rental, hospitality, automotive, healthcare, etc.), do NOT invent a vertical track record. Frame the hook around the transferable technical method instead — but MATCH THE SCOPE: for a NEW BUILD, "my approach wires SEO architecture and GA4 tracking into the build from day one — so the site ranks from launch instead of six months later"; for a MAINTENANCE / CHANGES / FIX job on an existing store, drop the ranks-from-launch line entirely and hook on dev reliability instead ("I work directly in your theme, test every change in a duplicate before it goes live, and don't break your existing functionality or tracking"). Then cite the best-fit case as proof of the delivery model. Vertical-specific build history that isn't backed by an approved case study is a fabrication, even when it feels plausible to invent.
- DESCRIBE THE CLIENT'S BUSINESS when the posting only gives a company name or URL. If the posting says nothing more than "The company is acme.io" or just links a domain, you do NOT know what they do, who their customers are, or how they operate — do NOT state it. NEVER open with "I took a look at acme.io - [invented description]". Forbidden: claiming their business model, market, customer type, or geography as fact when the posting didn't state it. You may refer to them generically ("your platform", "your account", "your campaigns") and speak to the problem the POSTING describes, but never narrate their business as if you researched it. Inferring loosely from a domain name (e.g. "mytender.io" → tenders) is acceptable ONLY if framed as the problem space, never as "here's what your company does."

What you CAN do instead (this is how you sound sharp WITHOUT lying):
- Restate the problem THEY described in the posting, in your words.
- Offer expertise as a PATTERN or HYPOTHESIS, explicitly framed as such: "often when a site isn't ranking for its own brand name, it comes down to [X, Y, or Z] — i'd pin down which in the audit." "in my experience, branded-search gaps usually trace back to [common causes]." The audit is where you FIND OUT; the cover letter is where you show you know WHERE to look.
- Describe what your audit/process WILL check — future tense, not claimed past findings: "first thing i'd check is whether [X]" not "your [X] is broken".
The line: talk about what you'll INVESTIGATE and the patterns you KNOW, never about what you've supposedly already FOUND on their specific property.

ATTACHMENTS & SAMPLES RULE (non-negotiable): Artem has exactly these attachable materials:
1. Derma Solution case study — PDF. When mentioned, say "attached as a PDF" in the same or next sentence.
2. Skin Reboot case study — PDF. Same rule.
3. Google Ads / PPC audit sample — real document Artem attaches ONLY to proposals for jobs that involve auditing an EXISTING account (optimise / fix / review running campaigns). Mention it as: "attaching a sample of a recent Google Ads audit so you can see the format and depth." DO NOT offer or attach this on LAUNCH / from-scratch / zero-pixel jobs — there is no account to audit, and offering one signals you didn't read the brief (see WHEN NOT TO OFFER AN AUDIT above). This item is required ONLY when the AUDIT OFFER RULES say an audit applies.
4. SEO promotion plan sample — real document for SEO proposals. Mention as: "attaching a sample SEO promotion plan so you can see the format." NEVER write "attaching a sample so you can see the format" without naming the type — always name it: "SEO promotion plan", "Google Ads audit", "technical SEO audit". An unnamed "sample" confuses the client and signals you copy-pasted the line.
5. Technical SEO audit sample — a real 36-page technical SEO audit PDF Artem delivered (lemoos.com, a bilingual e-commerce site: glossary + a 4-tier priority framework, crawl/indexation/redirects/canonicals/schema/Core Web Vitals findings). Attach this when the SEO job involves a technical AUDIT / DIAGNOSIS / site review / migration recovery / crawl / indexation work (i.e. the client wants you to FIND and FIX issues on an existing site — NOT a from-scratch build). Mention it as: "attaching a sample technical SEO audit so you can see the format and depth." This is the SEO counterpart to the Google Ads audit sample — when the SEO job is audit/diagnosis-driven, attaching it is REQUIRED.
6. Every other case study — use the block format below. "attached in profile highlights" goes ONCE in the lead-in sentence, not repeated after each entry.
That is the complete inventory. There are NO schema implementation samples, NO AI visibility breakdowns, NO entity mapping examples, NO separate SEO reports beyond the plan sample and the technical SEO audit sample, NO additional work examples beyond what is listed. Do not invent materials, do not promise to send things that are not on this list, do not say "profile highlights" contains anything that isn't an approved case study from the list. This covers everything — case studies, audit samples, schema examples, AI visibility breakdowns, reports, screenshots, or any other work example. If you say "i'm attaching X" or "happy to send X" or "here are samples of X", X must be in the approved list. If it is not listed, do not mention it. Inventing promised materials destroys credibility when the client asks for them and they don't exist.

SEO JOB DELIVERABLE — pick the RIGHT deliverable by what the client actually wants (mandatory):

(A) TECHNICAL-AUDIT / DIAGNOSIS / MIGRATION-RECOVERY SEO jobs — the client wants you to FIND and FIX issues on an EXISTING site (signals: "audit", "technical audit", "site review", "crawl", "GSC / Search Console", "indexation", "redirect chains", "canonicals", "Core Web Vitals", "migration", "recover traffic", "diagnose", "why did rankings drop"). For these you MUST:
  - attach the TECHNICAL SEO AUDIT SAMPLE (inventory item 5). WEAVE the mention into the letter tied to what you diagnosed — do NOT drop it as an isolated boilerplate line floating before the signoff (out-of-context orphan = current failure). Keep it recognizable and named ("sample technical SEO audit … see the format and depth"), but connect it to a surrounding sentence, e.g. "That crawl/indexation matrix is exactly what my audit maps — I've attached a recent technical SEO audit sample so you can see the format and depth." NOT a lone trailing "I'm attaching a sample technical SEO audit so you can see the format and depth."
  - offer the concrete diagnostic deliverable but state NO turnaround time for it (e.g. "i can run a full diagnostic crawl covering redirects, indexation, canonicals, schema and Core Web Vitals, then hand you a prioritized findings doc"). CRITICAL: a technical SEO audit is NOT a 1–2 day job — NEVER attach a day-count to it ("audit in 2 working days", "audit within 2 days", "deliver the audit in 1 working day" are all FORBIDDEN). The "1 working day" turnaround is the GOOGLE ADS audit only; the "2 working days" turnaround is the SEO PROMOTION PLAN only (option B). The technical SEO audit's timeline is OMITTED from the cover letter entirely (internal estimate ~2 weeks; that figure never goes in the letter).
  EXCEPTION — AUDIT + RETAINER JOBS: if the client mentions BOTH an initial audit AND ongoing/retainer/long-term work ("audit project, followed by a retainer", "initial audit then monthly SEO", "audit and ongoing improvements"), the (A) "do not push the plan" rule does NOT apply. For audit+retainer jobs you MUST include BOTH: (1) the audit sample attachment, AND (2) the 3-month SEO promotion plan CTA. The plan covers the retainer phase.

(B) GROWTH / RANKINGS / ONGOING-SEO jobs — the client wants to grow organic traffic/rankings (not primarily diagnose a broken site). For these you MUST offer the custom 3-month SEO Promotion Plan in 2 working days (deliverables, costs, link building budget, basic site check, competitor overview) and attach the SEO promotion plan sample:
"i can prepare a custom 3-month SEO promotion plan within 2 working days — covers deliverables, costs, link building budget, a basic site check, and competitor overview. i'm attaching a sample SEO promotion plan so you can see the format."

A job can be BOTH (audit now → growth later): attach the technical SEO audit sample AND offer the plan. Skip only for a clearly one-off micro-task (e.g. "fix this one schema bug").

(C) WEBSITE-BUILD / WEB-DEVELOPMENT jobs where the client wants a site BUILT (not SEO campaigns run) — signals: "WordPress developer", "Shopify developer", "build a website", "develop our site", "create our online store", "website development". Even when the posting includes "SEO-friendly design" or "basic on-page SEO setup", that is a BUILD requirement (architecture and structure are SEO-ready from day one), NOT an ongoing SEO campaign deliverable. For these jobs:
  - Do NOT offer the 3-month SEO promotion plan — it is an ongoing-campaign document and will confuse a client who hired a developer, not an SEO agency.
  - Do NOT attach the SEO promotion plan sample.
  - If you want a closing deliverable offer, frame it as: "happy to put together a project scope with build timeline and tech stack before we start" — or simply close with the sign-off and your name.
  - The differentiator DEPENDS ON SCOPE — match it, don't force the SEO angle:
    • NEW BUILD / from-scratch / launch (signals: "build a website", "create our store", "develop our new site", "from scratch", "launch"): LEAD with "IT Force wires SEO architecture, schema, GA4 conversion tracking, and Core Web Vitals INTO the build itself — the site ranks from launch, not six months after a separate SEO contractor." Here the ranks-from-launch USP is on-target.
    • MAINTENANCE / CHANGES / FIX / adjust-existing (signals: "changes", "adjust", "adjustments", "existing", "fix", "minor issues", "update sections", "tweaks", "ongoing changes", "improve the store", "modify", "theme customization on our store"): the store ALREADY EXISTS — there is no launch, so do NOT lead with "ranks from launch" (it's aimed at the wrong scenario and the client hired a DEVELOPER, not an SEO). LEAD instead with DEV RELIABILITY: careful theme/Liquid work, testing every change in a duplicate/preview before pushing live, clean scoped delivery, and NOT breaking existing functionality. Demote SEO/tracking to at most ONE reassurance line — "changes won't break your rankings, schema, or GA4 tracking" — never a ranking pitch. Pitching an SEO service they didn't ask for reads as not listening.
  - STATE THE DIFFERENTIATOR ONCE (mandatory — no self-echo): make your core differentiating point in ONE place, then move on. Do NOT establish it in the opening/body ("I build production-ready with GA4/GTM/schema wired in at launch") and then RESTATE the same idea in a separate closing paragraph ("The unique part:" / "The differentiator:" / "What sets me apart:" → "I wire the technical SEO and GA4 into the build so it ranks from day one"). That is the same claim twice — it reads as padding and as if you're trying to convince yourself. Pick the single strongest framing, say it once, and cut the duplicate. In particular, if the "tracking/SEO wired into the build" point is already in the letter, do NOT add a second "The unique part:"/"The differentiator:" paragraph repeating it.

CASE STUDY SELECTION — match the case study's domain to the job's domain (mandatory):

The job is one of: PPC/Google Ads, SEO, or mixed (both). Identify which from the posting (keywords like "Google Ads", "PMax", "Shopping", "PPC", "ad spend", "CPC", "ROAS" → PPC; "SEO", "ranking", "organic traffic", "schema", "AEO", "GEO", "AI Overviews", "content" → SEO).

Case studies by domain (use ONLY case studies whose domain matches the job):
- PPC / Google Ads case studies: Atlant Real Estate (property developer — +56.5% conv, -31% CPC, +144% clicks; new-listing lead gen via branded per-complex campaigns + PMax + DSA — the DIRECT proof for any real-estate / realtor / property / new-listing PPC job), ChronoCash (European LUXURY WATCH dealer, high-ticket B2C — €0.52 CPC, +42% conversions, 4.69K conv from 9.21K clicks; Video + PMax + DSA + Demand Gen — the lead case for luxury / high-ticket / jewellery / watch PPC), FridgeFix (-92% cost/conv, +1,405% conv), House Painting (2,100+ clicks, 7.3% CTR), Nectar Flowers (-72% CPA, +350% income), Skin Reboot (PPC angle — 17.51 PMax ROAS, +693.8% revenue, restricted/beauty PDF).
- SEO case studies: Derma Solution (+1,861% organic traffic, +14,342% conv PDF), Skin Reboot (SEO angle — +91.58% traffic, +693.8% revenue PDF), Golden State Trailers (B2B manufacturer — +350% organic traffic, 72 city pages, 67 keywords Top 3, 110 referring domains), Luxury Parfums (ecommerce scents — +79% visits, +143% revenue, 33 keywords Top 1), Multilingual Site (17,100 new monthly visits, 18 Top 1 + 47 Top 3 keywords).
- Mixed-discipline jobs: pick one from each domain.

CRITICAL: NEVER cite a PPC-only case study (FridgeFix, House Painting, Nectar Flowers) in an SEO proposal. NEVER cite an SEO-only case study (Derma Solution organic traffic, Multilingual Site rankings) in a PPC proposal. Skin Reboot is the only case study with both PPC and SEO angles — pick the metric that matches.

CASE-STUDY BUSINESS-MODEL INTEGRITY (mandatory — credibility-critical): Each case study has a FIXED, REAL business model. NEVER relabel a case's industry or business model to force-fit the job's vertical. In particular:
- Skin Reboot = health/wellness SKINCARE ECOMMERCE (DTC physical product). It is NOT SaaS, NOT software, NOT a subscription product. Never call it "a SaaS case", "B2B software", or similar.
- Nectar Flowers = ecommerce FLORIST (physical product). FridgeFix = appliance REPAIR (local service). House Painting = painting CONTRACTOR (local service). Derma Solution = medical aesthetics CLINIC. Atlant = REAL ESTATE developer. None of these is SaaS/software.
- PLATFORM INTEGRITY (web-dev cases): Game-X, SMASH, and GKit are ALL built on OPENCART — they are NOT Shopify, NOT WooCommerce, NOT WordPress. NEVER describe them as "Shopify work/builds/stores" or under a "Recent Shopify work" heading. On a Shopify (or WooCommerce/WordPress) job, you have TWO honest options: (a) cite Artem's REAL Shopify stores — casaeleganza.com and paramusmegafurniture.com — as the direct platform proof; and/or (b) present Game-X/SMASH/GKit as OpenCart builds whose skills transfer ("same custom-theme + module + tracking work, built on OpenCart — the Liquid/theme layer is the same discipline"). Label the platform truthfully every time; calling an OpenCart build "Shopify" is a fabrication the client catches on the first click.
- When the job is in a vertical we have NO case study for (e.g. SaaS / software / a subscription product), do NOT recategorize an ecommerce or local-service case to match. Either (a) cite the case HONESTLY by its real model and bridge the transferable MECHANIC ("same trial-vs-paid ROAS tracking problem, different business model"), or (b) skip the case and lean on the method + Premier Partner credential. A relabeled case is a fabrication the client catches the moment they open it.

RESTRICTED/YMYL JOBS OVERRIDE (vertical beats channel for the supporting slots): when the job is in a restricted/regulated/YMYL vertical (peptides, skincare, medical aesthetics, supplements, CBD/vape, health/wellness), DO NOT use the generic consumer cases (FridgeFix, House Painting, Nectar Flowers, Golden State Trailers) EVEN ON A PPC JOB — they are off-vertical and signal weak relevance judgment. Use Skin Reboot (the restricted/YMYL paid hero) as the lead, and at most one more genuinely restricted/YMYL case. Fewer on-point cases beat more with a generic filler. If only Skin Reboot truly fits, cite only Skin Reboot and stop.

VAPE SHOP ORDERING RULE (mandatory — overrides any KB rule that contradicts this): Vape Shop is the LEAD case study ONLY when the job is in a substance-restricted vertical where paid advertising is blocked or severely limited — specifically: CBD, hemp, cannabis, THC, e-cigarettes/vaping products, kratom, peptides, SARMs, or similar regulated-substance e-commerce. The reason Vape Shop leads in those cases is the shared "paid is blocked, organic must carry the load" constraint — that is the direct vertical parallel. For healthcare / medical / YMYL jobs where paid advertising is fully available (ABA therapy, medical aesthetics clinics, healthcare SaaS, telehealth), Vape Shop is NOT the lead. On those jobs: Derma Solution leads (strongest YMYL medical proof), Skin Reboot second, Vape Shop third at most or omitted. Any KB rule saying "Vape Shop leads on restricted/YMYL" applies only to substance-restricted, not to general healthcare YMYL.

CASE STUDY VOLUME CAP (mandatory): When you already have 2 or more strong vertical matches, do NOT add a 3rd or 4th case study that is off-vertical or only loosely adjacent just to pad the letter. Adding a weak case after strong ones dilutes the signal and increases length for no gain. The rule: once you have 2 case studies with strong vertical alignment, stop — only add a 3rd if it adds a genuinely new dimension (e.g. a local SEO case when the first two are national, or a restricted-vertical case when the first two aren't). Multilingual Site (construction/tenders consulting, Italian-German border) should ONLY appear when there is no better local SEO, multilingual, or international-targeting case to show — it is a weak match for healthcare, YMYL, or ecommerce jobs.

ATTACHED PDF / SCOPE DOCUMENT ACKNOWLEDGMENT:
- When you have NOT been given the document: briefly note you're working from the job summary and invite the client to share screening questions directly. Example: "I'm working from the job summary here — happy to answer any screening questions from the spec directly." Do NOT fabricate answers to unknown questions.
- When you HAVE been given the document (it appears in ATTACHED FILES above): do NOT write meta-commentary about having reviewed it ("the full PDF is really valuable", "I'm working from the job summary here"). The fact that you read it should be IMPLICIT — shown by the specificity of your insights, not stated. Open with a strategic observation from the content. Demonstrate comprehension, don't narrate it.
  CRITICAL — APPLICATION QUESTIONS IN THE DOCUMENT: If the attached file contains explicit application/screening questions the client requires answered (numbered list, "To Apply:", "Please answer:"), do NOT embed full answers to those questions as labeled inline sections in the cover letter body ("On AI workflow: ...", "On three-pronged strategy: ..."). The client reads the cover letter in one field and the application question answers in SEPARATE Upwork fields — full answers in both creates duplication the client notices. Instead: write the cover letter as hook + proof (case studies) + brief offer + rate, and add ONE line: "I've answered your [N] application questions in the fields below." Keep the letter under 250 words in this case. The full answers are produced when Artem pastes the questions into chat.

CASE STUDY FORMATTING — THIS IS THE ONLY ACCEPTABLE FORMAT:

Each case study gets its own paragraph with a blank line above it. The attachment label depends on which case study:
- Derma Solution / Skin Reboot → end the entry with "(case study attached as a PDF)"
- All others → covered by a lead-in "(attached in profile highlights):" before they start

PATTERN A — only non-PDF case studies:

[lead-in sentence] (attached in profile highlights):

[Client Name]: [what was done]. [key metric(s).]

[Client Name]: [what was done]. [key metric(s).]

PATTERN B — only PDF case studies (Derma Solution and/or Skin Reboot):

[lead-in sentence]:

Skin Reboot: [what was done]. [key metric(s).] (case study attached as a PDF)

Derma Solution: [what was done]. [key metric(s).] (case study attached as a PDF)

PATTERN C — MIXED (both PDF and non-PDF):
Lead-in only references the non-PDF ones via "profile highlights"; PDF entries carry their own label.

here are some relevant results — the non-PDF case studies are attached in profile highlights:

Nectar Flowers: Rebuilt campaign structure around purchase intent. Dropped cost per conversion 72% and grew transaction revenue 350%.

Skin Reboot: Grew revenue +693.8% at 17.51 PMax ROAS by fixing tracking and tightening intent targeting. (case study attached as a PDF)

RULES (apply to all three patterns):
- Blank line between every entry — mandatory, not optional
- Client name in Title Case followed by a colon
- Each entry is 1-2 sentences max
- NEVER attribute Derma Solution or Skin Reboot to "profile highlights" — those are PDFs
- NEVER repeat "profile highlights" after individual entries — it's in the lead-in only
- NO DUPLICATION — each case study appears EXACTLY ONCE in the letter. If you have already mentioned a case study with its metric in the hook or proof paragraph, do NOT include it again in the case studies block. The block is only for cases that have not appeared earlier in the letter. If all your cases are already woven into the narrative, skip the block entirely. Reading the same case study twice signals copy-paste assembly, not craft — one mention, one location, full stop.

WRONG (do not produce this):
quick background: i've scaled brands. Nectar Flowers grew revenue 350% and Skin Reboot hit 17.51 ROAS, full case study attached in profile highlights.

The wrong example above is wrong because: (1) multiple case studies crammed in one sentence with no blank lines, (2) Skin Reboot is incorrectly labeled "profile highlights" when it should be "attached as a PDF".${portfolioText}${referenceText}${pastProposalsText}${examplesText}${adjustments}
${kbRulesText ? `
RULE COMPLIANCE GATE (silent, mandatory):
Before you emit the cover letter, run this checklist *internally* (do NOT include it in your output):
1. Go through every KB Rule listed above, one by one.
2. For each rule, decide: does its trigger condition apply to this job posting?
3. If yes, verify the corresponding action is present in your draft (exact phrasing where the rule mandates it — e.g. "1 working day", "2 working days", specific framings).
4. If any rule fires but isn't reflected in the draft, REWRITE the draft to comply BEFORE emitting. The user has been correcting outputs manually because rules get skipped — that ends here. Treat every rule with a fired trigger as a hard pre-emit requirement, not a suggestion.
5. Case study formatting check: if your draft mentions any non-PDF case studies, verify ALL of the following or rewrite:
   a. There is a lead-in sentence containing "(attached in profile highlights)" before the first case study
   b. EVERY case study is its own paragraph with a blank line above it — count the case studies, count the blank-line separators, they must match
   c. Every client name is in Title Case (e.g. "Nectar Flowers", "FridgeFix") not lowercase
   d. "attached in profile highlights" does NOT appear after individual entries — only once in the lead-in
6. Case study duplication check: scan your draft for each case study name (Derma Solution, Skin Reboot, Nectar Flowers, FridgeFix, House Painting, Multilingual Site, GKit, etc.). If any name appears more than once, that is a duplication violation. Remove the SECOND occurrence — either delete it from the formal block (if the case was already used in the narrative), or collapse the narrative mention to a single word of the client name only. Each case study must appear exactly once.

Then proceed to FINAL OUTPUT FORMAT.
` : ''}
FINAL OUTPUT FORMAT: Return ONLY the cover-letter text, nothing else. No preamble, no meta-commentary, no "Here's the cover letter:", no rule-check explanation, no skip recommendation.${droppedFiles.length > 0 ? `

ATTACHED FILES (${droppedFiles.length}): ${droppedFiles.map(f => f.name).join(', ')}
Read ALL attached files carefully BEFORE writing. They likely contain the client's full brief, spec, screening questions, or portfolio requirements not captured in the posting text. Answer any screening questions you find. Incorporate every requirement from the files into the letter.
PRIORITY RULE: the JOB POSTING defines what this proposal must accomplish. An attached file is supporting context, NOT the brief. If a file's topic, platform, or vertical conflicts with the posting (e.g. the file is a Shopify SEO audit but the posting asks for WordPress site management), the POSTING wins — answer what the CLIENT asked for. Never let a rich attachment pull the letter off the posting's actual requirements, and never skip the application checklist because the attachment was about something else.` : ''}`,
          messages: [{ role: 'user', content: (() => {
            const textPart = `Write a cover letter for this job:\n\n${jobContext}`
            const fileBlocks = droppedFiles
              .filter(f => f.blockType === 'document' || f.blockType === 'image')
              .map(f => f.blockType === 'document'
                ? { type: 'document', source: { type: 'base64', media_type: f.mediaType, data: f.data } }
                : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } })
            const textFileContent = droppedFiles
              .filter(f => f.blockType === 'text')
              .map(f => `--- ${f.name} ---\n${f._excelText || atob(f.data)}`)
              .join('\n\n')
            const fullText = textFileContent
              ? `${textPart}\n\nADDITIONAL TEXT FILES:\n${textFileContent}`
              : textPart
            return fileBlocks.length > 0
              ? [...fileBlocks, { type: 'text', text: fullText }]
              : fullText
          })() }],
          ...(droppedFiles.some(f => f.blockType === 'document') ? { _betas: ['pdfs-2024-09-25'] } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message || `API ${response.status}`)
      let text = data.content.map(b => b.text || '').join('')

      // ── Deterministic markdown strip (KB Rule: no asterisks/markdown) ────
      // Claude reliably ignores this rule despite top-anchoring. Since it's
      // 100% pattern-detectable, strip it here for free instead of relying
      // on the Claude enforcer pass.
      //   **bold** → bold    *italic* → italic    __bold__ → bold    _italic_ → italic
      //   ### Heading → Heading (but preserve leading hyphens used as bullets)
      // Shared cleanup — markdown strip + em/en-dash → hyphen. Same helper the
      // chat answers use, so cover letter and chat output never drift.
      text = _cleanPasteText(text)
      // Kill a signoff that leaked to the top (letter opening with just "Artem").
      text = _stripLeadingSignoff(text)
      // Kill a redundant "Attachments: …" summary line (case studies self-label).
      text = _stripAttachmentsSummaryLine(text)

      // KB Rule 416: strip any day-count turnaround promised on a technical SEO
      // audit ("audit in 2 working days"). That turnaround is the SEO PLAN only;
      // a technical SEO audit's timeline is omitted from the letter. Done here
      // (before the compliance checks) so it's gone on BOTH the early-return and
      // the enforcer paths. Idempotent. (DESIGN.md §16 + §20.)
      const _preAuditStrip = text
      text = _stripSeoAuditTurnaround(text)
      if (text !== _preAuditStrip) {
        console.log('[Falcon] Rule pre-check: stripped a day-count turnaround off an SEO technical audit (KB Rule 416) — "2 working days" is the SEO PLAN only, never the audit.')
        _recordViolations('generator', job?.id, ['seoAuditTurnaround'])
      }

      // Loom reference strip: Rule 2 bans screen-recording deliverable offers.
      // "Loom messages/videos" keeps appearing in the comms cadence paragraph
      // despite the prompt ban. Replaced deterministically with neutral phrasing.
      const _preLoomStrip = text
      text = _stripLoomReference(text)
      if (text !== _preLoomStrip) {
        console.log('[Falcon] Rule pre-check: replaced Loom reference with neutral phrasing (Rule 2 — no screen-recording deliverable offers).')
        _recordViolations('generator', job?.id, ['loomReference'])
      }

      // Unnamed attachment fix: "attaching a sample so you can see the format"
      // without a type name. Prompt rule is chronically ignored so fixed in code.
      const _preAttachFix = text
      text = _fixUnnamedAttachment(text)
      if (text !== _preAttachFix) {
        console.log('[Falcon] Rule pre-check: fixed unnamed attachment reference → "sample SEO promotion plan".')
        _recordViolations('generator', job?.id, ['unnamedAttachment'])
      }

      // ── Normalize "(attached in profile highlights)" phrasing ──────────────
      // Canonical form: lowercase, in parens, no period. Any variant the
      // generator produces — capitalized, period-terminated, bare without
      // parens — gets normalized to the canonical form deterministically.
      // Examples of variants normalized:
      //   "Attached in profile highlights."        → "(attached in profile highlights)"
      //   "attached in profile highlights."        → "(attached in profile highlights)"
      //   "attached in the profile highlights"     → "(attached in profile highlights)"
      //   "(Attached in profile highlights.)"      → "(attached in profile highlights)"
      //   "Attached in Profile Highlights."        → "(attached in profile highlights)"
      text = text.replace(
        // Optional opening paren, optional "the", any caps, optional trailing
        // period/closing paren combo.
        /\(?\s*attached\s+in\s+(?:the\s+)?profile\s+highlights?\.?\s*\)?/gi,
        '(attached in profile highlights)'
      )

      // ── Rule-compliance enforcement pass ────────────────────────────────
      // Prompt engineering alone has proven unreliable for hard rule
      // requirements (e.g. Rule 8: "audit takes 1 working day" — Claude
      // keeps writing "2 working days" or "3-5 days" on the first pass
      // despite top-anchoring + compliance gate). This second pass is a
      // narrow, isolated Claude call with ONLY the rules + the job posting
      // + the draft. No voice rules, no case studies, no past proposals —
      // just compliance. With a 5-line context the rules get unambiguous
      // attention. The corrected text replaces the draft.
      //
      // Only fires when there's at least one KB rule active; otherwise this
      // call would be pure overhead.
      try {
        const rulesRes = await fetch('/kb?type=rule')
        if (rulesRes.ok) {
          const allEnfRules = [...(await rulesRes.json())].sort((a, b) => (a.id || 0) - (b.id || 0))
          // Routing: same scope filter as the first pass, so the enforcer sees
          // exactly the rules that constrained generation (no cross-domain
          // confusers re-introduced in the "narrow" pass). Classify from job
          // fields (jobContextLower isn't defined this early in the block).
          const _enfScopeSrc = [job?.title, job?.keywords, job?.category,
            job?.description_full || job?.description_snippet || job?.raw_message,
            job?.preferred_qualifications].filter(Boolean).join(' ')
          const rules = rulesForGenerator(allEnfRules, jobScopes(_enfScopeSrc))
          if (rules.length > 0) {
            // ── Free regex pre-check ─────────────────────────────────────
            // For deterministic phrasing patterns (currently: "X working
            // day(s)"), we can verify compliance without spending a Claude
            // call. The rule of thumb: if the draft contains only timing
            // phrases that the rules permit, no Claude enforcer needed.
            //
            // How it works:
            //   • Extract every "\d+ working day(s)" phrase from rule
            //     content — these are the ALLOWED set.
            //   • Extract every "\d+ working day(s)" phrase from the draft —
            //     these are the ACTUAL set.
            //   • If ACTUAL ⊆ ALLOWED, the draft is compliant for timing
            //     rules. Skip the Claude enforcer.
            //   • Otherwise (draft has a timing phrase not in the allowed
            //     set, or contains other suspicious timing patterns like
            //     "3-5 days" / "X business days"), fire the Claude pass.
            //
            // This catches the most common failure mode ("audit takes 2
            // working days" when rule says "1 working day") at zero cost.
            // Tone/structure rules still go through Claude — they're not
            // pattern-detectable.
            const TIMING_RE = /\d+\s*(?:-\s*\d+\s*)?(?:working\s+|business\s+)?days?\b/gi
            const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
            const allowedTimings = new Set(
              rules.flatMap(r => (String(r.content || '').match(TIMING_RE) || []).map(norm))
            )
            const draftTimings = (text.match(TIMING_RE) || []).map(norm)
            const timingCompliant = draftTimings.length === 0 ||
              draftTimings.every(t => allowedTimings.has(t))

            // ── Cover-letter TIMELINE check (KB Rule 17) ─────────────────────
            // Rule 17: "...estimate SEO technical audit at 2 weeks in the scope
            // of work but OMIT the timeline from the cover letter." The "X days"
            // TIMING_RE above misses phase-style scheduling language the model
            // loves to produce — "first 48 hours", "week 1", "weeks 1-2",
            // "day 1", phased roadmaps. Detect those so the enforcer fires and
            // strips them. We deliberately do NOT flag the two ALLOWED delivery
            // phrasings ("1 working day" for the Ads audit per Rule 8, "2 working
            // days" for the SEO plan per the promotion-plan rule) — those are
            // "X working day(s)" forms this regex never matches.
            const COVER_TIMELINE_RE = [
              /\b(?:first|next|within|by|over\s+the)\s+\d+\s*(?:-\s*\d+\s*)?(?:hours?|days?|weeks?|months?)\b/i, // "first 48 hours", "within 2 weeks"
              /\bweeks?\s+\d+(?:\s*[-–]\s*\d+)?\b/i,   // "week 1", "weeks 1-2"
              /\bdays?\s+\d+(?:\s*[-–]\s*\d+)?\b/i,    // "day 1", "days 1-3"
              /\bmonths?\s+\d+(?:\s*[-–]\s*\d+)?\b/i,  // "month 1", "months 1-3"
              /\bphase\s+\d+\b/i,                       // "phase 1"
              /\b\d+\s*[-–]\s*(?:week|day|month)\s+(?:plan|roadmap|timeline|process|rollout)\b/i, // "3-week plan"
              // Turnaround / delivery statement quoting a week/month/day timeframe
              // — "turnaround is typically 2 weeks", "delivered in 2 weeks",
              // "takes 2-3 weeks", "ready in 10 days". The "2 working days" SEO-plan
              // delivery is NOT matched: "working" sits between the number and the
              // unit, so \d+\s*(?:week|month|day) fails on it.
              /\b(?:turn[\s-]?around|deliver(?:y|ed|able)?|complete[ds]?|takes?|typically|usually|within|ready\s+in|done\s+in|time[\s-]?frame|lead\s+time|timeline\s+(?:is|of))\b[^.\n]{0,50}?\b\d+\s*(?:[-–]\s*\d+\s*)?(?:week|month|day)s?\b/i,
              // Bare "audit delivered/in within N working days" — generator puts this
              // under a "Timeline:" label to answer client's timeline question.
              // "2 working days" for an audit is wrong (it's for the SEO plan only).
              /\baudit\b[^.\n]{0,40}(?:delivered|in|within)\s+\d+\s*(?:[-–]\s*\d+\s*)?(?:working\s+|business\s+)?days?\b/i,
              // Explicit "Timeline:" label in the letter body
              /^[ \t]*Timeline\s*:/im,
              // "Timeline <for a full build …>: 4 - 6 weeks" — a Timeline label that
              // isn't immediately followed by a colon, with a duration later in the line.
              /^[ \t]*Timeline\b[^\n]*\b\d+\s*(?:[-–]\s*\d+\s*)?(?:hour|day|week|month)s?\b/im,
              // Forward-looking build estimate: "a full turnkey build runs/takes 4-6 weeks",
              // "build … in 4 - 6 weeks" — number-first range the trigger-word pattern misses.
              /\b(?:build|store|site|project|site\s+build|turnkey)\b[^.\n]{0,40}?\b\d+\s*[-–]\s*\d+\s*(?:week|month)s?\b/i,
            ]
            // Does the POSTING explicitly ask for a timeline/duration? If so, a
            // timeline in the letter is REQUIRED, not forbidden — so we must NOT
            // strip it (gate coverHasTimeline off), and we separately REQUIRE that
            // a concrete estimate is present.
            const _postingAsksTimeline = /\b(rough\s+timeline|timeline\s+for|provide\s+(?:a\s+)?timeline|estimated?\s+(?:timeline|completion|delivery|duration)|how\s+long\s+(?:will|would|does|it|to)\b|turn[\s-]?around\s+time|delivery\s+time(?:frame|line)?|when\s+(?:can|could|will)\s+you\s+(?:complete|finish|deliver|start|have)|time\s*frame|timeframe|\beta\b|how\s+(?:soon|quickly)|completion\s+time|expected\s+(?:timeline|duration|completion))\b/i.test(`${job.title || ''} ${fullDescription}`)
            // Only fire the "strip the timeline" guard when the client did NOT ask.
            const coverHasTimeline = !_postingAsksTimeline && COVER_TIMELINE_RE.some(re => re.test(text))
            // Conversely: if the client ASKED for a timeline, the draft MUST give a
            // concrete duration. A deliverable/steps description is not an answer.
            const _draftHasTimeEstimate = /(\b\d+\s*(?:[-–]\s*\d+)?\s*(?:hour|hr|day|business\s+day|working\s+day|week|month)s?\b|within\s+(?:a\s+|about\s+)?\d|same[-\s]day|next[-\s]day|by\s+(?:end\s+of\s+)?(?:the\s+)?(?:day|week|month)|a\s+(?:few|couple\s+of)\s+(?:days|weeks))/i.test(text)
            const timelineRequestedButMissing = _postingAsksTimeline && !_draftHasTimeEstimate

            // ── Forbidden-phrase check ───────────────────────────────────────
            // Patterns that are deterministically wrong regardless of which
            // specific KB rule covers them. Catches "happy to walk through",
            // "hop on a call", "schedule a demo", etc. — all forms of
            // proactively offering a synchronous session (violates Rule KB 5:
            // "never initiate or offer a call") and video/walkthrough offers
            // (Rule KB 400). If any match, fire the Claude enforcer to rewrite.
            const FORBIDDEN_PHRASES = [
              // Proactive call / session offers (KB Rule 5 + KB Rule 400)
              /walk\s*(?:you\s+)?through/i,
              /hop\s+on\s+(?:a\s+)?(?:call|chat|zoom|meet)/i,
              /jump\s+on\s+(?:a\s+)?(?:call|chat|zoom|meet)/i,
              /schedule\s+(?:a\s+)?(?:call|chat|meeting|demo|session|intro)/i,
              /book\s+(?:a\s+)?(?:call|time|slot|meeting)/i,
              /(?:video|screen)\s+walkthrough/i,
              /happy\s+to\s+(?:hop|jump|get\s+on|set\s+up\s+a\s+call)/i,
              // Proactive "I'll send you" offers — implies nothing is attached yet
              /happy\s+to\s+(?:send|share|forward|provide|show|put\s+together)/i,
              /(?:can\s+)?send\s+(?:over\s+)?(?:samples?|examples?|work|results?|(?:case\s+)?studies|breakdowns?)/i,
              // Invented samples / materials not in the approved list
              // (Attachments rule: only Derma Solution PDF, Skin Reboot PDF,
              // and approved case studies in profile highlights exist)
              /schema\s+(?:implementation\s+)?samples?/i,
              /AI\s+visibility\s+(?:audit\s+)?breakdown/i,
              /entity\s+(?:mapping\s+)?(?:samples?|examples?|breakdowns?)/i,
              /(?:technical\s+)?SEO\s+(?:audit\s+)?(?:samples?|examples?|breakdowns?)\s+(?:attached|in\s+(?:my\s+)?profile)/i,
              /profile\s+highlights?[^.]*(?:schema|AI\s+visibility|entity|breakdown|audit\s+sample)/i,
              // Synchronous-execution overcommit: answering "can you join a
              // screen share" is fine (required when the posting explicitly
              // asks) — but committing to work/fix things "together" AND
              // "live"/"in real time" goes beyond a call to explain findings
              // and into ongoing synchronous collaboration (Rule 2 territory).
              // Bidirectional (either word can come first) and NOT gated on a
              // specific verb — "together" co-occurring near "live"/"real time"
              // is already a narrow, rare combination that doesn't collide with
              // the required "yes I can join a screen share" screening answer.
              /\btogether\b[^.\n]{0,50}\b(?:real[\s-]?time|live)\b/i,
              /\b(?:real[\s-]?time|live)\b[^.\n]{0,50}\btogether\b/i,
              // Same violation, rephrased without the word "together" (the
              // model dodges narrow regexes by rewording) — catch the
              // underlying meaning: a diagnostic/fix verb landing "in real
              // time", working "in the account with you" on the call, or
              // fixes implemented "during" the call/screen-share. All three
              // describe joint synchronous execution, not just explaining
              // findings on a call.
              /\b(?:diagnose|fix|troubleshoot|resolve|implement|execute)\w*\b[^.\n]{0,30}\bin\s+real[\s-]?time\b/i,
              /\bwork(?:ing)?\s+directly\s+in\s+the\s+account\s+with\s+you\b/i,
              /\b(?:fix(?:es|ing)?|implement(?:ation|ing)?|resolv\w+|troubleshoot\w*)\b[^.\n]{0,70}\bduring\b[^.\n]{0,25}\b(?:the\s+)?(?:screen\s*share|call|session)\b/i,
            ]
            const hasForbiddenPhrase = FORBIDDEN_PHRASES.some(re => re.test(text))

            // ── Banned OPENER check (PRIMARY WRITING DIRECTIVE #1) ───────────
            // The model keeps opening with a credential/pleasantry line despite
            // the prompt rule ("12 years running Google Ads...", "As a Premier
            // Partner...", "I'm very interested..."). Research is unambiguous:
            // credential/generic openers reply <15% and measurably lower reply
            // rate; a client-problem-first opener lifts it. Deterministically
            // detect a bad FIRST line so the enforcer rewrites it into a hook
            // that names the client's problem. Only the opener is checked, so
            // credentials cited LATER as support are untouched.
            const _firstLine = (text.trim().split('\n').find(l => l.trim().length > 0) || '').trim()
            const BANNED_OPENERS = [
              /^\d+\+?\s*years?\b/i,                                        // "12 years running..."
              /^(?:with\s+)?(?:over\s+)?\d+\+?\s*years?\s+(?:of\s+)?experience/i,
              /^(?:as\s+)?a?\s*google\s+premier\s+partner/i,                // "As a Google Premier Partner..."
              /^i['’]?m\s+(?:a\s+)?(?:google\s+)?(?:ads?|ppc|seo|paid|digital|marketing|premier)/i, // "I'm a PPC/SEO specialist"
              /^i\s+(?:have|bring|speciali[sz]e)\b/i,                        // "I have X years", "I specialise in"
              /^(?:hi|hello|hey|greetings)\b[^.\n]{0,45}(?:hope|doing\s+well|how\s+are\s+you)/i, // "Hi, I hope you're doing well"
              /^i['’]?m\s+(?:very\s+|really\s+|super\s+)?(?:interested|excited|keen|thrilled)\b/i, // "I'm very interested in your project"
              // Consultant-cliché rhetorical framing: "X comes down to one question: can you…?",
              // "X boils down to a single question". Reads as generic copywriting, not a person.
              /\b(?:breaks?|boils?|comes?)\s+down\s+to\s+(?:one|a\s+single|this)\s+(?:question|thing)\b/i,
              // A first line that is purely a rhetorical question aimed at the reader.
              /^(?:can|could|what\s+if|how\s+do|ever\s+wonder|are)\s+you\b[^?\n]{0,160}\?\s*$/i,
              // Geography-as-personalisation: "for an australian business", "for your UK
              // company". A nationality says nothing about business model or account type —
              // it's filler dressed up as specificity. (See GEOGRAPHY IS NOT PERSONALISATION.)
              /\bfor\s+(?:an?|your|their)\s+(?:australian|aussie|american|british|english|scottish|irish|canadian|german|french|dutch|spanish|italian|swedish|norwegian|danish|polish|indian|singaporean|japanese|chinese|brazilian|mexican|european|kiwi|new\s+zealand|u\.?k\.?|u\.?s\.?a?\.?)\s+(?:business|company|brand|client|store|shop|site|firm|startup)\b/i,
            ]
            const hasBannedOpener = BANNED_OPENERS.some(re => re.test(_firstLine))

            // ── "Wikipedia" / explainer opener ───────────────────────────────
            // Owner: "get rid of these generic AI-ish wikipedia style intros."
            // Writing rule 3 (DO NOT TEACH) already bans encyclopedic explanations
            // and VARY THE ANGLE bans the canned conversion-tracking hook, but the
            // model keeps producing them — so detect them in code. Two tells, checked
            // on the OPENING PARAGRAPH only (later mentions are fine):
            //   (a) a simile/analogy flourish — "…is like turning up the volume on
            //       static". Pure copywriting garnish, never a real observation.
            //   (b) the PLATFORM as the sentence subject — "The algorithm can't
            //       optimise toward revenue if…". That is textbook voice: explaining
            //       mechanics in the abstract instead of talking about THIS client.
            const _openingPara = (text.trim().split(/\n{2,}/)[0] || '')
            const _SIMILE_RE = /\bis\s+(?:a\s+bit\s+|basically\s+|essentially\s+)?like\b|\bis\s+the\s+equivalent\s+of\b|\bthink\s+of\s+it\s+as\b|\bakin\s+to\b|\bimagine\s+(?:a|an|you|your|if|what)\b/i
            const _MECHANISM_SUBJECT_RE = /\bthe\s+(?:algorithm|platform|system|auction|machine)\s+(?:can'?t|cannot|won'?t|will\s+not|doesn'?t|does\s+not|has\s+no|needs|learns|optimi[sz]es?|bids)\b/i
            const hasExplainerOpener = _SIMILE_RE.test(_openingPara) || _MECHANISM_SUBJECT_RE.test(_openingPara)

            // ── Circumvention-risk check (Trust & Safety critical) ───────────
            // Upwork's automated scanners flag anything that pattern-matches
            // taking work/payments/comms off-platform. A real enforcement flag
            // hit Artem's account (2026-06-11) over an innocent line: "managing
            // through Upwork hits friction … we'll find workaround" (it meant
            // Meta ad-account ACCESS, but the scanner can't know that). These
            // patterns must never appear in a letter, in ANY context.
            const CIRCUMVENTION_RISK = [
              // "outside/off/around/bypass … Upwork" in any phrasing
              /\b(?:outside|off|around|bypass(?:ing)?|avoid(?:ing)?|without)\s+(?:of\s+)?upwork\b/i,
              // Upwork + friction/workaround/limitation in the same breath
              /\bupwork\b[^.\n]{0,70}\b(?:friction|work[\s-]?around|limitations?|restrict\w*|gets?\s+in\s+the\s+way)/i,
              /\b(?:friction|work[\s-]?around|limitations?)\b[^.\n]{0,70}\bupwork\b/i,
              // Off-platform payment rails
              /\b(?:paypal|payoneer|wise|revolut|bank\s+transfer|wire\s+transfer|crypto|usdt|direct\s+payment|pay\s+(?:me\s+)?directly)\b/i,
              // Off-platform contact channels (pre-contract contact sharing is also flagged)
              /\b(?:whatsapp|telegram|signal|discord|viber|wechat)\b/i,
              /\b(?:email|reach)\s+me\s+(?:at|on|directly)\b/i,
              /\b[\w.+-]+@(?:gmail|outlook|yahoo|proton)\w*\.\w+/i,
            ]
            const hasCircumventionRisk = CIRCUMVENTION_RISK.some(re => re.test(text))

            // ── Fabricated-diagnosis check (credibility-critical) ─────────────
            // The generator only has the job posting — it has NOT visited the
            // site / account. Catch claims that it inspected something, or
            // assertions about the client's CURRENT state as fact. These read
            // as confident expertise but collapse the instant the client checks.
            const FABRICATED_DIAGNOSIS = [
              /i\s+took\s+a\s+look\s+at/i,
              /i\s+(?:checked|reviewed|looked\s+(?:at|over)|inspected|audited|analy[sz]ed|examined|went\s+through)\s+your\b/i,
              /(?:i\s+)?(?:can\s+)?(?:see|noticed|found|spotted)\s+(?:that\s+)?your\b/i,
              /looking\s+at\s+your\s+(?:site|account|setup|campaigns?|website|tracking|analytics|profile)/i,
              /your\s+(?:current\s+)?(?:technical\s+foundation|schema|tracking|setup|site|account|campaigns?|tags?|pixels?|conversions?)\s+(?:isn'?t|is\s+not|aren'?t|are\s+not|has(?:n'?t)?|lacks?|is\s+missing|needs?)\b/i,
              /google\s+(?:isn'?t|is\s+not|can'?t|cannot)\s+(?:connecting|showing|ranking|indexing|finding|crawling|reading)/i,
              /(?:right\s+now|currently),?\s+(?:your|the)\s+(?:site|account|setup|tracking|schema)/i,
              // Fabricated METRIC about the client's account (a number Artem was
              // never given). "You've got ~15% impression share", "you're at 2x
              // ROAS", "your CPA is $40", "your impression share is 15%", etc.
              // The posting almost never states these; asserting one = guessing.
              /\b(?:you(?:'ve| have| are|'re)?|your)\b[^.\n]{0,40}\b\d[\d.,]*\s*[%xX]?\s*(?:impression\s+share|ROAS|CPA|CPC|CTR|conversion\s+rate|click-?through|quality\s+score)/i,
              /\b(?:impression\s+share|ROAS|CPA|CPC|CTR|conversion\s+rate|quality\s+score)\b[^.\n]{0,25}\b(?:is|of|at|around|~|sits?\s+at)\b[^.\n]{0,10}\d/i,
            ]
            const hasFabricatedDiagnosis = FABRICATED_DIAGNOSIS.some(re => re.test(text))

            // ── Unsolicited-logistics + filler-closer check (KB Rule 436) ────
            // Generator keeps padding the tail with "working hours: i'm UTC+2…
            // i work async with structured weekly reporting… looking forward
            // to working with you." None of that was asked for. Rule 436 says:
            // never volunteer timezone, working hours, async preference,
            // reporting cadence, or availability unless the client asked, and
            // never end with filler closers ("looking forward to working with
            // you", "happy to discuss", "let me know your thoughts", etc.).
            // These regexes flag potential violations; the enforcer decides
            // whether to trim (when unsolicited) or keep (when the client
            // explicitly asked OR it's inside a case-study description).
            const UNSOLICITED_LOGISTICS_RE = [
              // Timezone self-identification
              /\b(?:i'?m|i\s+am|based|operate|working)\s+(?:in\s+)?(?:UTC|GMT|EST|PST|CET|EET|CST|MST)\b/i,
              /\btime\s*zone\s+(?:overlap|isn'?t|is\s+not|won'?t)\b/i,
              // Working-hours / async self-description
              /\b(?:working\s+hours?|work\s+async|async\s+(?:work|with\s+structured))\b/i,
              /\bdaily\s+stand-?ups?\b/i,
              // Reporting cadence volunteered ("weekly/monthly reporting" as
              // an offer, not a case-study metric).
              /\bstructured\s+(?:weekly|monthly|biweekly)\s+report/i,
              /\b(?:weekly|monthly|biweekly)\s+(?:performance\s+)?report(?:s|ing)\s+(?:so|on|of|covering|against)\b/i,
              // Availability / start-date volunteered
              /\b(?:i'?m\s+)?available\s+(?:immediately|right\s+away|asap|now|to\s+start)\b/i,
              /\bcan\s+start\s+(?:immediately|right\s+away|asap|today|tomorrow|this\s+week|next\s+week)\b/i,
              /\b\d+\+?\s*hours?\s+(?:per|a)\s+week\s+available\b/i,
            ]
            const FILLER_CLOSER_RE = [
              /\blooking\s+forward\s+to\s+(?:working|hearing|chatting|connecting|speaking|the\s+opportunity)/i,
              /\bhappy\s+to\s+(?:discuss|chat|connect|jump\s+on|hop\s+on|talk)/i,
              /\blet\s+me\s+know\s+(?:your\s+thoughts|if\s+(?:you|this)|when)/i,
              /\bexcited\s+to\s+(?:chat|connect|discuss|work|hear)/i,
              /\bfeel\s+free\s+to\s+(?:reach\s+out|message|contact|ping)/i,
              /\bavailable\s+to\s+(?:chat|connect|discuss|jump\s+on\s+a\s+call|hop\s+on\s+a\s+call)/i,
            ]
            const hasUnsolicitedLogistics = UNSOLICITED_LOGISTICS_RE.some(re => re.test(text))
            const hasFillerCloser = FILLER_CLOSER_RE.some(re => re.test(text))

            // ── Assumed-vertical / fabricated-brand check ────────────────────
            // On a thin posting that never names the client's product, the model
            // invents a concrete vertical to sound specific (e.g. "buy Nike Air
            // Max size 10" on a generic "retail" job). Any concrete consumer
            // brand that appears in the DRAFT but NOT in the posting was ASSUMED,
            // not given — flag it so the enforcer neutralises it to a generic
            // example. (Case-study client names are Artem's own and live in the
            // APPROVED CASE STUDIES block, so they're not in this list.)
            const _CONSUMER_BRANDS_RE = /\b(nike|adidas|puma|reebok|new balance|under armour|gucci|prada|louis vuitton|chanel|zara|h&m|uniqlo|apple|samsung|sony|\blg\b|dell|\bhp\b|lenovo|nikon|canon|ikea|wayfair|sephora|ulta|lululemon|north face|patagonia|rolex|lego|dyson|bose|gopro|fitbit|peloton)\b/gi
            const _postingBlob = `${job.title || ''} ${fullDescription}`.toLowerCase()
            const _assumedBrands = [...new Set((text.match(_CONSUMER_BRANDS_RE) || []).map(b => b.toLowerCase()))]
              .filter(b => !_postingBlob.includes(b))
            const hasAssumedBrand = _assumedBrands.length > 0

            // ── Case-study business-model mislabel (credibility-critical) ─────
            // None of Artem's case studies is SaaS/software. On a SaaS/software
            // job the model has relabeled an ecommerce case (e.g. Skin Reboot
            // skincare) as "a SaaS case" to fake vertical fit. Flag when a known
            // non-SaaS case name appears within ~50 chars of a SaaS/software term
            // (either order) — that's a fabricated business model.
            const _NON_SAAS_CASE = '(?:skin\\s*reboot|nectar\\s*flowers|fridgefix|house\\s+painting|derma\\s*solution|atlant|smash|game-?x|gkit|casa\\s*eleganza|oxytec|vape\\s*shop|multilingual\\s+site|golden\\s+state\\s+trailers|trailers)'
            const _SAAS_TERM = '(?:saas|software[- ]as[- ]a[- ]service|b2b\\s+software|software\\s+(?:platform|company|product|brand|business)|subscription\\s+(?:software|platform|saas))'
            const _MISLABEL_RE = new RegExp(`\\b${_NON_SAAS_CASE}\\b[^.!?\\n]{0,50}\\b${_SAAS_TERM}\\b|\\b${_SAAS_TERM}\\b[^.!?\\n]{0,50}\\b${_NON_SAAS_CASE}\\b`, 'i')
            const caseMislabeledAsSaas = _MISLABEL_RE.test(text)

            // ── OpenCart case mislabeled as Shopify/WooCommerce/WordPress ────
            // Game-X, SMASH and GKit are OpenCart builds. On a Shopify/Woo/WP job
            // the generator sometimes files them under "Recent Shopify work" — a
            // fabricated platform claim. Flag when an OpenCart case is present AND a
            // wrong-platform "work/build/store" label appears in the draft.
            const _OPENCART_CASE_RE = /\b(?:smash|game-?x|gkit)\b/i
            const _WRONG_PLATFORM_LABEL_RE = /\b(?:recent\s+)?(?:shopify|woo\s?commerce|wordpress)(?:\s*[\/&,]\s*[a-z]+)?\s+(?:work|builds?|projects?|stores?|experience|results?|sites?)\b/i
            const openCartMislabeledAsPlatform = _OPENCART_CASE_RE.test(text) && _WRONG_PLATFORM_LABEL_RE.test(text)

            // ── Echoed-question check (mechanical AI-form-fill tell) ─────────
            // The generator sometimes pastes the client's screening questions
            // verbatim as headings ("Your experience with local service business
            // campaigns (with a quick example or result)") before answering — the
            // #1 tell that a human didn't write it. If a checklist item's wording
            // appears near-verbatim in the draft, flag it for rephrasing.
            const _normEcho = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
            const _draftNorm = _normEcho(text)
            const _echoedQuestions = (applicationChecklist?.items || [])
              .map(it => (it.text || '').trim())
              .filter(q => q.length >= 25)                 // only long questions, not short labels
              .filter(q => {
                const nq = _normEcho(q)
                return _draftNorm.includes(nq.slice(0, Math.min(nq.length, 45)))
              })
            const hasEchoedQuestion = _echoedQuestions.length > 0

            // ── Listy / labeled-outline structure (structural AI tell) ───────
            // The body reading as a labeled outline ("First thing I'd audit:",
            // "Site side:", "Step 1:") is a top AI tell. Flag when 2+ such labels
            // appear so the enforcer dissolves them into flowing prose. ("Recent
            // examples:" and the case-study lead-ins are excluded — that block is
            // allowed to have a lead-in.)
            const _OUTLINE_LABEL_RES = [
              /\bfirst\s+thing\s+i(?:['’]?d| would| i['’]?ll)?\b/i,
              /(?:^|\n|[.!?]\s)\s*(?:first|second|third|fourth|then|next|finally|lastly)\s*[,:]/i,
              /\b(?:on\s+the\s+)?(?:site|tracking|campaign|account|technical|analytics|creative|copy|landing[-\s]?page|paid|organic)\s+side\s*:/i,
              /\bstep\s+\d+\s*[-:–]/i,
            ]
            // Also catch the "topic checklist" shape: multiple paragraphs each
            // starting with a short Title-case label then a spaced dash then the
            // body ("Schema/structured data - Product schema…", "GEO/AI visibility
            // - LLMs rank…"). Case-study lead-ins use ": " (colon), not " - ", so
            // they don't match. 2+ such label-blocks reads as an outline.
            const _labelBlockRe = /(?:^|\n)[ \t]*[A-Z][\w/&]{1,25}(?:[ \t]+[\w/&()]+){0,4}[ \t]+[–-][ \t]+\S/g
            const _labelBlockCount = (text.match(_labelBlockRe) || []).length
            const hasListyOutline = _OUTLINE_LABEL_RES.filter(re => re.test(text)).length >= 2
              || _labelBlockCount >= 2

            // ── Fabricated GEOGRAPHIC experience (opener) ────────────────────
            // The opener sometimes claims Artem "works with sites in <the client's
            // country>" when he has no case study there — a fabricated track record
            // (e.g. "I work with educational sites in Greece"). Artem's real case
            // geographies are a small known set; naming the client's country as a
            // place he works, when it's not one of them, is a fabrication.
            // Artem's REAL case-study geographies (do not flag these). Greece is
            // NOT here — he has no Greek client, so a "in Greece" claim is fabricated.
            const _ARTEM_CASE_GEOS = /\b(usa?|united\s+states|america|canad|ukrain|ital|austria|europe|european)\b/i
            const _clientCountry = (job.client_country || '').trim()
            let fabricatedGeoExperience = false
            if (_clientCountry.length >= 4 && !_ARTEM_CASE_GEOS.test(_clientCountry)) {
              const cc = _clientCountry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const opening = text.slice(0, 500)
              const geoClaimRe = new RegExp(
                `\\b(?:work(?:ed|ing)?\\s+with|clients?\\s+in|sites?\\s+in|projects?\\s+in|experience\\s+(?:in|with)|i'?ve\\s+worked)\\b[^.\\n]{0,45}\\b${cc}\\b`
                + `|\\b${cc}\\b[^.\\n]{0,25}\\b(?:sites?|clients?|businesses|market)\\b`, 'i')
              fabricatedGeoExperience = geoClaimRe.test(opening)
            }

            // ── Exact-vertical case must LEAD (generalised) ──────────────────
            // When the job is in a vertical we hold a SPECIFIC case for, that case
            // must be the FIRST proof cited — never buried after a generic local-
            // service filler (FridgeFix appliance repair / House Painting). The
            // table maps each vertical to (a) how to detect the job and (b) how to
            // find that vertical's case signal in the draft. Add a row to extend.
            // (Restricted/substance verticals are handled by the dedicated Vape
            // Shop ordering rule, so they're intentionally not duplicated here.)
            const _jobVerticalBlob = `${job.title || ''} ${fullDescription}`
            const _GENERIC_FILLER_CASE_RE = /\b(fridgefix|house\s+painting)\b/i
            const _VERTICAL_LEAD_CASES = [
              { name: 'real estate',
                jobRe: /\b(real\s*estate|realtor|realty|propert(?:y|ies)|new\s+listing|home\s+builder|brokerage|\bmls\b)\b/i,
                caseRe: /\b(real\s*estate|atlant|property\s+develop|residential\s+(?:complex|development)|new[-\s]?listing)\b/i,
                lead: 'Atlant property developer — real-estate Google Ads, new-listing lead gen: +56.5% leads, -31% CPC, +144% clicks (branded per-complex campaigns + PMax + DSA)' },
              { name: 'medical / YMYL',
                jobRe: /\b(medical|health\s*care|healthcare|clinic|dental|dentist|dermatolog\w*|aesthetic\w*|med[-\s]?spa|wellness|cosmetic|skin\s*care|botox|filler|telehealth|therapy)\b/i,
                caseRe: /\b(derma\s*solution|skin\s*reboot|medical|aesthetic|dermatolog|ymyl)\b/i,
                lead: 'Derma Solution (medical/YMYL — +1,861% organic traffic, +14,342% conversions) and/or Skin Reboot' },
              { name: 'ecommerce',
                jobRe: /\b(e-?commerce|online\s+store|shopify|woocommerce|magento|product\s+feed|merchant\s+center|shopping\s+ads?|\bdtc\b|\bd2c\b)\b/i,
                caseRe: /\b(nectar\s*flowers|skin\s*reboot|smash|game-?x|oxytec|e-?commerce|shopify|\broas\b|revenue)\b/i,
                lead: 'an ecommerce case (Nectar Flowers -72% CPA / +350% revenue, or Skin Reboot 17.51 ROAS)' },
            ]
            const _jobVertical = _VERTICAL_LEAD_CASES.find(v => v.jobRe.test(_jobVerticalBlob)) || null
            let exactVerticalCaseNotLeading = false
            if (_jobVertical) {
              const _genIdx = text.search(_GENERIC_FILLER_CASE_RE)
              const _verIdx = text.search(_jobVertical.caseRe)
              // Flag when a generic filler case leads BEFORE the on-vertical case
              // (or the on-vertical case is absent while a filler is present).
              exactVerticalCaseNotLeading = _genIdx >= 0 && (_verIdx < 0 || _genIdx < _verIdx)
            }

            // ── Regulated-vertical / Vape Shop case-study checks (KB Rule 437) ──
            // (1) If the job is in a regulated/restricted-substance vertical
            //     (hemp/CBD/cannabis/vape/supplement/etc.) the draft MUST cite
            //     the Vape Shop case study — it's the only direct-vertical
            //     proof in the KB. Without it, Q3-style answers default to
            //     stretching medical-aesthetic case studies into "yes I've
            //     done CBD" overclaims.
            // (2) When the draft DOES mention the vape case, it must not
            //     fabricate multi-location / GBP / local-pack work — the KB
            //     entry is a new-site e-commerce build, not a retail chain.
            //     The generator drifts toward inventing "5-location vape
            //     retail" + "Google Business Profiles" to mirror the client's
            //     multi-location need; this kills credibility on contact.
            // Lower-cased job context, used by all the guards below. Declared
            // here (before its first use) to avoid a temporal-dead-zone error.
            const jobContextLower = Array.isArray(jobContext)
              ? jobContext.join('\n').toLowerCase()
              : String(jobContext).toLowerCase()

            const REGULATED_VERTICAL_RE =
              /\b(hemp|CBD|cannabis|marijuana|THC|vape|vaping|e-?cig(?:arette)?|nicotine|kratom|mushroom|psilocybin|supplement|nutraceutical|peptides?|SARMs?|bio[-\s]?hacking|med[-\s]?spa|medspa|aesthetics?|cosmetic|skincare|skin\s+care|dermatology|botox|filler|YMYL|salmon\s+dna|micro-?infusion)\b/i
            const jobIsRegulated = REGULATED_VERTICAL_RE.test(jobContextLower)
            // Vape Shop is an SEO case (technical foundation, semantic core, link
            // building) — it is the regulated proof for SEO/SEO-inclusive jobs.
            // On a PURE PPC/paid-media job it would be a channel mismatch, so we
            // only require it when the job involves SEO. (Skin Reboot's PPC angle
            // is the regulated proof on pure-PPC jobs.)
            const jobIsSeoForVape = /\b(seo|organic|ranking|backlink|schema|local\s+seo)\b/i.test(jobContextLower)
            const draftMentionsVape = /\bvape\s+shop\b/i.test(text)
            const regulatedJobMissingVape = jobIsRegulated && jobIsSeoForVape && !draftMentionsVape
            // Inverse: Vape Shop is an SEO case. Citing it on a PURE PPC job
            // (paid-media, no SEO scope) is a channel mismatch — its organic
            // metrics don't belong in a Google Ads pitch.
            const jobIsPaidNoSeo = /\b(google\s+ads?|ppc|paid\s+search|paid\s+media|pmax|performance\s+max|shopping|media\s+buyer)\b/i.test(jobContextLower) && !jobIsSeoForVape
            const vapeOnPpcOnlyJob = draftMentionsVape && jobIsPaidNoSeo

            // ── Irrelevant case study on a regulated job (Rule 407) ──────────
            // Generic consumer cases (florist, home services, appliance repair,
            // B2B trailers) on a restricted/YMYL brief signal weak relevance
            // judgment and dilute the on-point restricted cases. Flag them.
            const GENERIC_CONSUMER_CASE_RE =
              /\b(nectar\s+flowers?|house\s+painting|fridge\s*fix|fridgefix|refrigerat(?:or|ion)\s+repair|golden\s+state\s+trailers?)\b/i
            const irrelevantCaseOnRegulated = jobIsRegulated && GENERIC_CONSUMER_CASE_RE.test(text)

            // ── Experience baseline + Premier Partner check (KB Rule 439) ────
            // Every cover letter must state "12 years" experience early. For
            // PPC / Google Ads / paid-media jobs it must ALSO mention "Google
            // Premier Partner 2026" — third-party trust signal that the
            // generator otherwise forgets.
            // (Separate, broader PPC detector than `jobIsPpc` below — that
            // one is for the case-study domain match and uses a narrower set.
            // For "should we mention Premier Partner" we want to catch every
            // paid-media variant, including Meta/Bing/Smart Bidding etc.)
            const YEARS_EXPERIENCE_RE = /\b12\s+years?\b/i
            const PREMIER_PARTNER_RE = /\bgoogle\s+premier\s+partner\b/i
            const PAID_MEDIA_KEYWORD_RE =
              /\b(google\s+ads?|adwords|ppc|paid\s+search|paid\s+media|performance\s+max|pmax|smart\s+bidding|shopping\s+ads?|search\s+ads?|display\s+ads?|meta\s+ads?|facebook\s+ads?|instagram\s+ads?|bing\s+ads?|microsoft\s+ads?|paid\s+advertising)\b/i
            const jobIsPaidMedia = PAID_MEDIA_KEYWORD_RE.test(jobContextLower)
            const draftHasYears = YEARS_EXPERIENCE_RE.test(text)
            const draftHasPremier = PREMIER_PARTNER_RE.test(text)
            const missingYearsExperience = !draftHasYears
            const ppcMissingPremierPartner = jobIsPaidMedia && !draftHasPremier

            // Vape-case fabrication detector: look around any "vape" mention
            // for local-SEO / multi-location language that isn't in the real
            // KB description.
            let vapeFabrication = false
            if (draftMentionsVape) {
              const VAPE_FABRICATION_NEAR = [
                /\d+\s*[-\s]?\s*locations?\b/i,
                /\bmulti-?location\b/i,
                /\bgoogle\s+business\s+profile/i,
                /\bGBP\b/,
                /\bmap\s+pack\b/i,
                /\blocal\s+(?:pack|citations?|seo)\b/i,
                /\bretail\s+chain\b/i,
                /\bfoot\s+traffic\b/i,
                /\bstore\s+visits?\b/i,
                /\bin-?store\b/i,
              ]
              const textLower = text.toLowerCase()
              const vapeIdx = textLower.indexOf('vape')
              if (vapeIdx !== -1) {
                // Check ±400 chars around the first "vape" mention.
                const window = text.slice(Math.max(0, vapeIdx - 100), vapeIdx + 500)
                vapeFabrication = VAPE_FABRICATION_NEAR.some(re => re.test(window))
              }
            }

            // ── PDF-attachment check (KB Rule 407) ───────────────────────────
            // Derma Solution and Skin Reboot MUST be described as "attached as
            // PDF". Check: if either name appears in the draft, "pdf" must also
            // appear within ~120 chars of it (same sentence / next sentence).
            const PDF_CASE_STUDIES = ['derma solution', 'skin reboot']
            const textLower = text.toLowerCase()
            // Fires if either: (a) PDF case study mentioned without "pdf" nearby,
            // OR (b) PDF case study mentioned with "profile highlights" nearby
            // (direct mis-attribution — these are PDFs, not highlights).
            const missingPdfLabel = PDF_CASE_STUDIES.some(name => {
              const idx = textLower.indexOf(name)
              if (idx === -1) return false
              const window = textLower.slice(Math.max(0, idx - 60), idx + name.length + 200)
              const hasPdf = window.includes('pdf')
              const hasHighlightsInWindow = /profile\s+highlights?/i.test(window)
              // Violation if: no pdf mention, OR explicitly attributed to highlights
              return !hasPdf || hasHighlightsInWindow
            })

            // ── Audit-sample mention check (KB Rule 401) ─────────────────────
            // When the job posting is about an audit (SEO audit, Google Ads
            // audit, PPC audit, account audit…) the draft MUST mention that
            // Artem is attaching a sample audit. Pattern: "attach" + ("sample"
            // OR "audit") must both appear somewhere in the draft.
            // "audit" in the draft itself doesn't count — we need the attachment
            // language (e.g. "attach a sample", "sample audit attached").
            // (jobContextLower is declared earlier in this block, before the
            // regulated/vape/premier guards that also use it.)

            // ── Case-study domain-match check ────────────────────────────────
            // PPC-only case studies in an SEO job (or vice versa) is a hard
            // disqualifier — cite a Google Ads result in an SEO pitch and
            // credibility tanks.
            const PPC_ONLY_NAMES = [
              /fridgefix|refrigerat(?:or|ion)\s+repair/i,
              /house\s+paint/i,
              /nectar\s+flowers?/i,
            ]
            const SEO_ONLY_NAMES = [
              /multilingual\s+site/i,
            ]
            const PPC_JOB_KEYWORDS = /\b(?:google\s+ads|google\s+ppc|ppc|p(?:erformance)?\s*max|pmax|shopping\s+ads?|adwords|cpc|cpa|roas|paid\s+ads?|ad\s+spend|ad\s+(?:campaigns?|account)|meta\s+ads|facebook\s+ads)\b/i
            const SEO_JOB_KEYWORDS = /\b(?:seo\b|search\s+engine\s+optimi[sz]ation|organic\s+(?:traffic|search)|google\s+rank|ranking|backlinks?|schema(?:\s+markup)?|ai\s+overviews?|aeo|geo\s+(?:seo|search)|content\s+strategy|technical\s+seo|onpage\s+seo|off[\s-]page\s+seo)\b/i
            const jobIsPpc = PPC_JOB_KEYWORDS.test(jobContextLower)
            const jobIsSeo = SEO_JOB_KEYWORDS.test(jobContextLower)
            // Webdev detection: if the job is about building a site (WordPress dev,
            // Shopify, OpenCart, web dev, build a website), suppress the SEO promotion
            // plan requirement — that deliverable is wrong for a development scope.
            const WEBDEV_JOB_RE = /\b(shopify|woocommerce|opencart|magento|wordpress\s+(?:developer|development|website|site|theme|plugin|design)|ecommerce\s+(?:website|store|site|development)|online\s+store\s+(?:development|build|setup|creation)|website\s+(?:development|redesign|developer|builder|creation)|web\s+(?:developer|development|design)|build\s+(?:a|an|our|my|the)\s+(?:website|online\s+store|ecommerce\s+site))\b/i
            const jobIsWebdev = WEBDEV_JOB_RE.test(jobContextLower)
            // Maintenance/changes web-dev job (existing store, not a from-scratch build).
            // On these the SEO/ranks-from-launch pitch is off-target — the client hired a
            // developer to make changes, not an SEO. Flag if the opener leads with SEO/rank.
            const _WEBDEV_MAINT_RE = /\b(chang(?:es?|ing)|adjust(?:ments?|ing|\s+existing)?|fix(?:es|ing|\s+(?:minor\s+)?issues?)?|updat(?:e|ing)\s+(?:sections?|the\s+(?:site|store|theme))|tweaks?|ongoing\s+(?:changes|work|help|support|maintenance)|maintenance|modif(?:y|ications?)|improve\s+(?:the\s+)?(?:store|site|ux|user\s+experience)|existing\s+(?:store|site|theme|functionality)|theme\s+customi[sz]ation)\b/i
            const _WEBDEV_NEWBUILD_RE = /\b(build\s+(?:a|an|our|my|the|from)|from\s+scratch|create\s+(?:a|an|our|my)\s+(?:new\s+)?(?:site|store|website)|develop\s+(?:a|an|our)\s+new|new\s+(?:site|store|website)|launch|redesign|rebuild)\b/i
            const jobIsWebdevMaintenance = jobIsWebdev && _WEBDEV_MAINT_RE.test(jobContextLower) && !_WEBDEV_NEWBUILD_RE.test(jobContextLower)
            // Opener (first ~350 chars) leads with an SEO/ranking pitch?
            const _openerSeoPitch = /\b(rank(?:s|ing)?\s+(?:from\s+(?:day|launch)|higher|better|well)|so\s+the\s+site\s+ranks|technical\s+seo|seo\s+(?:architecture|team|person|contractor)|ranks\s+from\s+launch|six\s+months\s+(?:after|later)|hand\s+off\s+to\s+a\s+separate\s+seo)\b/i.test(text.slice(0, 350))
            // The "build + SEO wired in from day one" DIFFERENTIATOR anywhere in the body is
            // just as off-target on a maintenance job as leading with it — the client hired a
            // dev to change an existing store, there is no build/launch to wire SEO into.
            const _seoBuildDifferentiatorAnywhere = /\b(into\s+the\s+build\s+from\s+(?:day\s+one|launch)|build\s+(?:the\s+)?(?:store|site)\s+and\s+hand\s+off|ranks?\s+from\s+(?:day\s+one|launch)|six\s+months\s+(?:after|later)|wire[sd]?\s+(?:the\s+|in\s+)?(?:technical\s+)?seo\b[^.\n]*\b(?:build|launch|day\s+one)|hand\s+off\s+to\s+a\s+separate\s+seo)\b/i.test(text)
            const seoLedOnMaintenanceWebdev = jobIsWebdevMaintenance && (_openerSeoPitch || _seoBuildDifferentiatorAnywhere)
            const ppcCaseInDraft = PPC_ONLY_NAMES.some(re => re.test(text))
            const seoCaseInDraft = SEO_ONLY_NAMES.some(re => re.test(text))
            // Mismatch only fires when job is clearly ONE domain and a case
            // study from the OTHER appears. Mixed/ambiguous jobs skip the check.
            const caseStudyDomainMismatch =
              (jobIsSeo && !jobIsPpc && ppcCaseInDraft) ||
              (jobIsPpc && !jobIsSeo && seoCaseInDraft)

            // ── SEO promotion plan check ──────────────────────────────────────
            // For SEO jobs, the proposal must offer a 3-month SEO Promotion
            // Plan delivered in 2 working days. Two failure modes:
            //   (a) "missingSeoPlanOffer" — the offer is absent entirely
            //   (b) "wrongSeoPlanTiming" — the offer is present but the
            //       timing is something other than "2 working days"
            //       (e.g. "5 business days", "3-5 days", "a week")
            let missingSeoPlanOffer = false
            let wrongSeoPlanTiming = false
            let wrongPlanOnAuditJob = false
            // Hoisted so the audit-sample check below can enforce ONE deliverable
            // per letter (never both a 3-month plan AND a technical audit offer).
            let hasSeoPlanMention = false
            let jobIsAuditOnly = false
            if (jobIsSeo && !jobIsPpc && !jobIsWebdev) {
              hasSeoPlanMention = /\b(?:seo\s+(?:promotion\s+)?plan|seo\s+roadmap|promotion\s+plan)\b/i.test(text)
              // For a pure audit-only job with no retainer/ongoing component, the audit
              // sample attachment IS the CTA — suppress the plan check. But if the job
              // mentions a retainer or ongoing work, the plan is still required even when
              // the job starts with an audit phase.
              // Retainer/ongoing signal = an ACTUAL continuing engagement, not a
              // deliverable phrase. "long-term strategy / plan / recommendations /
              // goals" are audit-REPORT sections, NOT ongoing work — so "long-term"
              // only counts when followed by an engagement word (partnership, work,
              // management, contract, retainer, support, collaboration, basis, …).
              const _RETAINER_SIGNAL_RE = /\b(retainer|ongoing\s+(?:seo|work|management|support|optimi|improvement|help|maintenance)|monthly\s+(?:seo|retainer|management|work|support|hours?)|recurring|continue\s+improving|long.?term\s+(?:engagement|partnership|work|management|contract|support|collaboration|retainer|relationship|role|help|assistance|basis|commitment|maintenance))\b/i
              // Technical-FIX jobs (fix rich snippets / schema / indexation / "amends" on an
              // existing site — NOT grow rankings) want implementation, not a 3-month
              // promotion campaign. Treat them like audit-only so the promotion plan is
              // suppressed. Guarded by "no growth language + no retainer" so genuine
              // ongoing-SEO / growth jobs (which DO want the plan) are unaffected.
              const _TECH_FIX_RE = /\b(technical\s+seo|rich\s+snippet|schema|structured\s+data|core\s+web\s+vitals|indexation|crawl(?:ability)?|canonical|hreflang|\bamend|(?:not|aren'?t|isn'?t)\s+showing|troubleshoot|page\s*speed)\b/i
              const _GROWTH_RE = /\b(grow(?:th|ing)?|increase\s+(?:traffic|rankings?|leads|sales)|rank\s+(?:higher|better)|pages?\s+that\s+rank|organic\s+growth|more\s+(?:traffic|leads|sales)|drive\s+(?:traffic|leads)|scale\s+(?:traffic|rankings)|link[\s-]?building|monthly\s+seo|content\s+(?:strategy|marketing)|build\s+content|promotion|campaign|own\s+(?:how|our|your|the)\b|discover(?:y|ed)?\b|ai\s+(?:answer|overview|tool)|get\s+picked\s+up)\b/i
              const jobIsTechFixOnly = _TECH_FIX_RE.test(jobContextLower) && !_GROWTH_RE.test(jobContextLower) && !_RETAINER_SIGNAL_RE.test(jobContextLower)
              jobIsAuditOnly = (/\baudit\b/i.test(jobContextLower) || jobIsTechFixOnly) &&
                !_RETAINER_SIGNAL_RE.test(jobContextLower)
              const draftHasAuditSampleAttach = /\battach(?:ing|ed)?\b[^.]{0,60}\bsample\b[^.]{0,80}\baudit\b/i.test(text) ||
                /\baudit\b[^.]{0,60}\bsample\b[^.]{0,60}\battach/i.test(text)
              // One deliverable per letter. Suppress the plan requirement when the
              // job is audit-only (the audit sample IS the deliverable there) OR
              // when the draft already offers an audit sample — never force BOTH.
              const planSuppressedByAuditCTA = jobIsAuditOnly || draftHasAuditSampleAttach
              missingSeoPlanOffer = !hasSeoPlanMention && !planSuppressedByAuditCTA
              // Inverse: on a pure AUDIT-ONLY job, the 3-month SEO promotion plan is
              // the WRONG deliverable — it's an ongoing-campaign document. If the
              // draft offers it, strip it (the client asked for an audit, not a
              // retainer pitch). Not fired on audit+retainer jobs (jobIsAuditOnly
              // is false there).
              wrongPlanOnAuditJob = jobIsAuditOnly && hasSeoPlanMention
              if (hasSeoPlanMention) {
                // Find the position of the plan mention, then look at the
                // surrounding ±200-char window for a timing phrase. Fire if
                // the window contains any timing that isn't "2 working days".
                const planMatch = text.match(/\b(?:seo\s+(?:promotion\s+)?plan|seo\s+roadmap|promotion\s+plan)\b/i)
                if (planMatch) {
                  const idx = planMatch.index || 0
                  const planWindow = text.slice(Math.max(0, idx - 200), idx + 200)
                  // Extract all timing-shaped phrases from the window
                  const windowTimings = planWindow.match(/\d+\s*(?:-\s*\d+\s*)?(?:working\s+|business\s+)?days?\b/gi) || []
                  // Compliant if window has "2 working days" AND no other timing
                  const hasCorrect = windowTimings.some(t => /^2\s*working\s+days?$/i.test(t.trim()))
                  const hasWrong = windowTimings.some(t => !/^2\s*working\s+days?$/i.test(t.trim()))
                  if (!hasCorrect || hasWrong) {
                    wrongSeoPlanTiming = windowTimings.length > 0
                  }
                }
              }
            }

            // Audit-type jobs don't always use the literal word "audit" — a
            // posting asking for technical SEO / crawl-indexation / faceted-nav /
            // schema / site-speed / Search Console work is an audit-driven job and
            // MUST still carry the audit-sample mention. (Gap that silently
            // produced letters with no deliverable at all.)
            const _AUDIT_SIGNAL_RE = /\b(technical\s+seo|crawl(?:ing|ability|\s+budget)?|index(?:ing|ation)|faceted\s+nav(?:igation)?|structured\s+data|schema(?:\s+markup)?|site\s+speed|core\s+web\s+vitals|site\s+review|search\s+console|\bgsc\b|canonical|redirect\s+chain|migration|traffic\s+drop|ranking\s+drop|diagnos)/i
            const isAuditJob = /\baudit\b/i.test(jobContextLower) || _AUDIT_SIGNAL_RE.test(jobContextLower)
            let missingAuditSampleMention = false
            if (isAuditJob) {
              // Check that the draft contains both "attach" and "sample" (in any
              // order) — this covers "attach a sample audit", "sample attached",
              // "i'm attaching a recent audit sample", etc.
              const hasAttach = /\battach/i.test(text)
              const hasSampleRef = /\bsample/i.test(text)
              // Require the audit sample ONLY on audit-only (technical/diagnosis)
              // jobs, and only when there's no other deliverable. Growth/ongoing
              // SEO jobs get the 3-month plan instead (missingSeoPlanOffer) — never
              // force BOTH the plan and the audit offer in the same letter.
              missingAuditSampleMention = !(hasAttach && hasSampleRef) && !hasSeoPlanMention && jobIsAuditOnly
            }

            // ── Wrong audit offer on a LAUNCH / from-scratch job (KB Rule 450) ──
            // When the client is launching a Google Ads account FROM SCRATCH
            // (zero pixel data, $0 to scale, no existing campaigns), there is
            // nothing to audit — offering an account audit or attaching an
            // "audit sample" signals Artem didn't read the brief. This is the
            // inverse of missingAuditSampleMention: there, an audit job is
            // missing the audit offer; here, a launch job WRONGLY includes one.
            const LAUNCH_FROM_SCRATCH_RE = [
              /\bfrom\s+scratch\b/i,
              /\bzero[-\s]?pixel\b/i,
              /\bfrom\s+\$?0\b/i,
              /\bfrom\s+zero\b/i,
              /\$0\s+to\s+scale\b/i,
              /\bzero\s+(?:pixel\s+)?data\b/i,
              /\bbuild(?:,| and|\s+launch|\s+&)\b[^.]*\blaunch\b/i,
              /\blaunch(?:,| and|\s+&|\s+optimize|\s+optimise)\b[^.]*\bscale\b/i,
              /\bno\s+existing\s+(?:account|campaigns?|ad\s+account)\b/i,
              /\bstarting\s+from\s+(?:zero|scratch)\b/i,
              /\b(?:new|brand[-\s]?new)\s+(?:ad\s+)?account\b/i,
              /\blaunch\s+(?:exclusively\s+)?(?:via|on|with)\s+google\s+ads\b/i,
              // Plain "set up a Google Ads campaign" / "campaign setup" / "build a
              // Google Ads setup" is ALSO a from-scratch build (there is no
              // existing account to audit). These were missed, so Rule 450 never
              // fired and the model invented a bogus "campaign live in 1 day".
              /\bset\s*up\s+[^.]{0,40}\bgoogle\s+ads?\b[^.]{0,25}\bcampaign/i,
              /\bcampaign\s+set[-\s]?up\b/i,
              /\bbuild\s+[^.]{0,30}\bgoogle\s+ads?\b[^.]{0,15}\b(?:setup|campaign|account)\b/i,
              /\bset\s*up\s+and\s+launch\b/i,
            ]
            const jobIsLaunchFromScratch = LAUNCH_FROM_SCRATCH_RE.some(re => re.test(jobContextLower))
            // Draft "offers an audit": attach+audit in proximity, "audit sample",
            // "sample ... audit", or an audit-delivery turnaround promise.
            const AUDIT_OFFER_IN_DRAFT_RE = [
              /\battach\w*[^.]{0,60}\baudit\b/i,
              /\baudit\b[^.]{0,60}\b(?:sample|attached|attaching)\b/i,
              /\bsample[^.]{0,40}\baudit\b/i,
              /\baudit\s+(?:delivered|turnaround|within)\b/i,
              /\b(?:google\s+ads?|ppc|account)\s+audit\b[^.]{0,40}\b(?:format|depth|attach)/i,
            ]
            const draftOffersAudit = AUDIT_OFFER_IN_DRAFT_RE.some(re => re.test(text))
            // Only a violation when the posting is NOT itself an audit request.
            // (If the client literally asked for an audit, respect that.)
            const wrongAuditOfferOnLaunch = jobIsLaunchFromScratch && draftOffersAudit && !isAuditJob

            // ── Launch CTA required (KB Rule 450) ────────────────────────────
            // On a from-scratch PPC launch, the mandatory CTA is "i can set up
            // and launch your campaigns from scratch in 5 working days" — the
            // launch-job equivalent of the audit / SEO-plan deliverable offer.
            // Flag when the draft is a launch job but lacks that "5 working
            // days" setup-and-launch commitment (covers missing CTA OR a
            // wrong-phrasing one like "5 business days" / "within a week").
            const jobIsPaidLaunch = jobIsLaunchFromScratch &&
              /\b(google\s+ads?|ppc|paid\s+search|paid\s+media|pmax|performance\s+max|shopping|search\s+campaigns?|media\s+buyer)\b/i.test(jobContextLower)
            const draftHasLaunchCTA = /\b5\s+working\s+days\b/i.test(text) &&
              /\b(set\s*up|launch|build)\b/i.test(text)
            const launchJobMissingCTA = jobIsPaidLaunch && !draftHasLaunchCTA

            // ── False "campaign live in 1 day" claim ─────────────────────────
            // "1 working day" is the GOOGLE ADS AUDIT turnaround ONLY. A campaign
            // is NOT live/launched/running in 1 day — a from-scratch build+launch
            // is "5 working days" (Rule 450), and even then Google's ad review
            // means it's "live and approved", not instant. The timing-compliance
            // guard accepts "1 working day" as a valid token (it is, for audits),
            // so this untrue claim slips through unless caught explicitly.
            const campaignLiveTooFast =
              /\bcampaigns?\b[^.\n]{0,45}\b(?:live|launch(?:ed|ing)?|running|ready|up\s+and\s+running)\b[^.\n]{0,30}\b(?:within|in)\s+(?:1|one|a|1\s*[-–]\s*2|two|2)\s*(?:working\s+|business\s+)?days?\b/i.test(text) ||
              /\b(?:live|launch(?:ed|ing)?|running|ready)\b[^.\n]{0,30}\b(?:within|in)\s+(?:1|one|a)\s*(?:working\s+|business\s+)?day\b[^.\n]{0,45}\bcampaign/i.test(text)

            // ── Case-study presence check (KB Rule 407) ──────────────────────
            // Every proposal should include at least 1 case study reference.
            // We don't match KB entry titles (those are internal names like
            // "Artem PPC SEO Client Case Studies Results Overview" — never
            // appropriate in a proposal). Instead we look for signal phrases
            // that indicate a real result was cited: a client name from the
            // portfolio content, or generic result language ("grew roas",
            // "increased revenue", "reduced cpa", "case study", etc.).
            // If portfolioText exists but none of these signals appear in the
            // draft, fire the enforcer to add a specific example.
            const RESULT_SIGNALS = [
              /case\s+stud/i,
              /grew\s+(?:their\s+)?(?:roas|revenue|traffic|conversions?|sales)/i,
              /(?:reduced?|cut|lowered?)\s+(?:cpa|cost|spend|cpc)/i,
              /increased?\s+(?:roas|revenue|traffic|conversions?|sales|leads?)/i,
              /(?:derma\s+solution|skin\s+reboot)/i,
            ]
            const hasResultSignal = RESULT_SIGNALS.some(re => re.test(text))
            let missingCaseStudy = false
            if (portfolioText || referenceText) {
              missingCaseStudy = !hasResultSignal
            }

            // ── Diagnosis-only case study, wrongly told as remediation ───────
            // Some postings explicitly ask for an ANALYSIS/DIAGNOSIS example and
            // explicitly EXCLUDE examples where Artem set up / managed / fixed the
            // campaign himself ("share an example where you diagnosed an issue
            // using data, NOT one where you set up or managed the campaign").
            // Artem's real case studies are audit+fix engagements, so the
            // generator's case-study retelling naturally narrates the FIX in
            // first-person management verbs ("I rewired conversion tracking,
            // rebuilt Search, segmented the feed") — which directly contradicts
            // what the client asked NOT to see. This must be caught: the facts
            // can stay, but the case study must be told as DIAGNOSIS (what the
            // data showed, what that revealed) not REMEDIATION (what Artem did
            // to fix it).
            const _DIAGNOSIS_ONLY_REQUEST_RE =
              /\b(?:an?\s+example|instance|case)\b[^.\n]{0,60}\bdiagnos\w*\b[^.\n]{0,120}\bnot\b[^.\n]{0,60}\b(?:set\s*up|manag(?:e|ed|ing)|ran|running|built|build)\b|\bnot\s+(?:one|an?\s+example)\b[^.\n]{0,60}\b(?:you\s+)?(?:set\s*up|manag(?:e|ed|ing))\b[^.\n]{0,40}\byourself\b/i
            const jobWantsDiagnosisOnlyExample = _DIAGNOSIS_ONLY_REQUEST_RE.test(fullDescription)
            // First-person management/build verbs applied to Artem's own action
            // in the case-study retelling — the exact framing the client banned.
            const _REMEDIATION_VERB_RE =
              /\b(?:i|we)\s+(?:rewired|rebuilt|rebuild|segmented|restructured|relaunched|launched|implemented|migrated|redesigned|overhauled)\b|\bthe\s+fix\s*:\s*(?:i|we)?\s*(?:rewired|rebuilt|segmented|restructured)/i
            const caseStudyToldAsRemediation = jobWantsDiagnosisOnlyExample && _REMEDIATION_VERB_RE.test(text)

            // ── Profile-highlights + paragraph-format check ──────────────────
            // When non-PDF case studies are referenced the draft must:
            //   (a) contain "profile highlights" in a lead-in sentence, AND
            //   (b) not cram multiple case studies into one paragraph.
            // Cramming detection: find all "Title Case Name:" patterns (case
            // study identifiers); if two appear without a \n\n between them,
            // the block is a single run-on paragraph.
            const hasNonPdfResultSignal = [
              // Known non-PDF case names at a paragraph start (terse "Name: metric"
              // entries have no verbs, so name-matching is the reliable signal).
              /(?:^|\n)\s*(?:nectar\s*flowers|fridgefix|house\s+painting|golden\s+state\s+trailers|multilingual\s+site|oxytec|luxury\s+parfums|chronocash|atlant|vape\s*shop|smash|game-?x|gkit)\b/i,
              /case\s+stud/i,
              /grew\s+(?:their\s+)?(?:roas|revenue|traffic|conversions?|sales)/i,
              /(?:reduced?|cut|lowered?)\s+(?:cpa|cost|spend|cpc)/i,
              /increased?\s+(?:roas|revenue|traffic|conversions?|sales|leads?)/i,
            ].some(re => re.test(text))
            const hasHighlightsPhrase = /profile\s+highlights?/i.test(text)
            // Detect cramming: look for 2+ distinct metric values (percentages,
            // ROAS numbers, dollar amounts like "$12k") — each signals a separate
            // case study. If they appear without a \n\n paragraph break between
            // the first and last, the case studies are run together in one paragraph.
            const metricRe = /\d+(?:[.,]\d+)?(?:\s*%|\s*×|\s*roas\b|\s*k\/month|\s*k\s+(?:month|revenue))/gi
            const metricMatches = [...text.matchAll(metricRe)]
            let csCrammed = false
            if (metricMatches.length >= 2) {
              const between = text.slice(
                metricMatches[0].index,
                metricMatches[metricMatches.length - 1].index
              )
              csCrammed = !between.includes('\n\n')
            }
            const missingHighlightsPhrase = hasNonPdfResultSignal && (!hasHighlightsPhrase || csCrammed)

            const draftCompliant = timingCompliant && !hasForbiddenPhrase && !hasCircumventionRisk && !missingPdfLabel
              && !missingAuditSampleMention && !missingCaseStudy && !missingHighlightsPhrase
              && !caseStudyDomainMismatch && !missingSeoPlanOffer && !wrongSeoPlanTiming && !wrongPlanOnAuditJob
              && !coverHasTimeline && !hasFabricatedDiagnosis
              && !hasUnsolicitedLogistics && !hasFillerCloser
              && !regulatedJobMissingVape && !vapeFabrication
              && !missingYearsExperience && !ppcMissingPremierPartner
              && !wrongAuditOfferOnLaunch && !irrelevantCaseOnRegulated
              && !launchJobMissingCTA && !vapeOnPpcOnlyJob && !campaignLiveTooFast && !caseStudyToldAsRemediation
              && !hasAssumedBrand && !exactVerticalCaseNotLeading && !caseMislabeledAsSaas
              && !timelineRequestedButMissing && !hasEchoedQuestion && !fabricatedGeoExperience
              && !openCartMislabeledAsPlatform && !seoLedOnMaintenanceWebdev && !hasListyOutline
              && !hasBannedOpener && !hasExplainerOpener

            // Telemetry (Phase C): record every guard that fired this run.
            _recordViolations('generator', job?.id, [
              hasBannedOpener && 'hasBannedOpener',
              hasExplainerOpener && 'hasExplainerOpener',
              hasForbiddenPhrase && 'hasForbiddenPhrase',
              missingAuditSampleMention && 'missingAuditSampleMention',
              wrongAuditOfferOnLaunch && 'wrongAuditOfferOnLaunch',
              irrelevantCaseOnRegulated && 'irrelevantCaseOnRegulated',
              vapeOnPpcOnlyJob && 'vapeOnPpcOnlyJob',
              regulatedJobMissingVape && 'regulatedJobMissingVape',
              vapeFabrication && 'vapeFabrication',
              missingYearsExperience && 'missingYearsExperience',
              ppcMissingPremierPartner && 'ppcMissingPremierPartner',
              launchJobMissingCTA && 'launchJobMissingCTA',
              campaignLiveTooFast && 'campaignLiveTooFast',
              caseStudyToldAsRemediation && 'caseStudyToldAsRemediation',
              coverHasTimeline && 'coverHasTimeline',
              hasFabricatedDiagnosis && 'hasFabricatedDiagnosis',
              hasUnsolicitedLogistics && 'hasUnsolicitedLogistics',
              hasFillerCloser && 'hasFillerCloser',
              hasAssumedBrand && 'hasAssumedBrand',
              exactVerticalCaseNotLeading && 'exactVerticalCaseNotLeading',
              caseMislabeledAsSaas && 'caseMislabeledAsSaas',
              openCartMislabeledAsPlatform && 'openCartMislabeledAsPlatform',
              seoLedOnMaintenanceWebdev && 'seoLedOnMaintenanceWebdev',
              hasListyOutline && 'hasListyOutline',
              timelineRequestedButMissing && 'timelineRequestedButMissing',
              hasEchoedQuestion && 'hasEchoedQuestion',
              fabricatedGeoExperience && 'fabricatedGeoExperience',
              hasCircumventionRisk && 'hasCircumventionRisk',
              missingCaseStudy && 'missingCaseStudy',
              caseStudyDomainMismatch && 'caseStudyDomainMismatch',
              missingSeoPlanOffer && 'missingSeoPlanOffer',
              wrongSeoPlanTiming && 'wrongSeoPlanTiming',
              wrongPlanOnAuditJob && 'wrongPlanOnAuditJob',
              missingHighlightsPhrase && 'missingHighlightsPhrase',
              missingPdfLabel && 'missingPdfLabel',
              !timingCompliant && 'timingViolation',
            ])

            if (draftCompliant) {
              console.log('[Falcon] Rule pre-check passed — skipping Claude enforcer call. Saved ~$0.0015.')
              setProposal(_unwrapFilledPlaceholders(_humanizeCasing(_stripUnaskedRate(_stripDuplicateDifferentiator(_stripKbLeak(_fixPdfCaseLabelMisattribution(_stripFabricatedVerticalOpener(_stripFabricatedOpener(_stripDuplicateCaseBlockLabel(_stripGenericCaseParagraphs(_stripSeoAuditTurnaround(_stripDuplicateAuditSampleMention(_stripDuplicateAttachmentLabel(_ensureCaseStudyHighlightsLeadIn(_cleanPasteText(text))))), jobIsRegulatedForStrip))))))), _postingAsksRate))).trim())
              return
            }

            if (hasForbiddenPhrase) {
              console.log('[Falcon] Rule pre-check: forbidden phrase detected — firing Claude enforcer.')
            }
            if (missingAuditSampleMention) {
              console.log('[Falcon] Rule pre-check: audit job but draft missing attach+sample — firing Claude enforcer.')
            }
            if (wrongAuditOfferOnLaunch) {
              console.log('[Falcon] Rule pre-check: launch/from-scratch job but draft OFFERS an audit (nothing to audit) — firing Claude enforcer.')
            }
            if (irrelevantCaseOnRegulated) {
              console.log('[Falcon] Rule pre-check: generic consumer case study on a regulated/YMYL job (Rule 407) — firing Claude enforcer.')
            }
            if (launchJobMissingCTA) {
              console.log('[Falcon] Rule pre-check: PPC launch/from-scratch job missing the "5 working days" setup-and-launch CTA (Rule 450) — firing Claude enforcer.')
            }
            if (vapeOnPpcOnlyJob) {
              console.log('[Falcon] Rule pre-check: Vape Shop (SEO case) cited on a pure-PPC job — channel mismatch (Rule 437) — firing Claude enforcer.')
            }
            if (missingCaseStudy) {
              console.log('[Falcon] Rule pre-check: no approved case study found in draft — firing Claude enforcer.')
            }
            if (missingHighlightsPhrase) {
              console.log(`[Falcon] Rule pre-check: case study format issue (highlights=${hasHighlightsPhrase}, crammed=${csCrammed}) — firing Claude enforcer.`)
            }
            if (caseStudyDomainMismatch) {
              console.log(`[Falcon] Rule pre-check: case study domain mismatch (jobIsSeo=${jobIsSeo}, jobIsPpc=${jobIsPpc}, ppcInDraft=${ppcCaseInDraft}, seoInDraft=${seoCaseInDraft}) — firing Claude enforcer.`)
            }
            if (missingSeoPlanOffer) {
              console.log('[Falcon] Rule pre-check: SEO job but no SEO promotion plan offered — firing Claude enforcer.')
            }
            if (wrongSeoPlanTiming) {
              console.log('[Falcon] Rule pre-check: SEO promotion plan offered with wrong timing (must be "2 working days") — firing Claude enforcer.')
            }
            if (wrongPlanOnAuditJob) {
              console.log('[Falcon] Rule pre-check: audit-only SEO job but draft offers the 3-month SEO promotion plan (wrong deliverable) — firing Claude enforcer to remove it.')
            }
            if (coverHasTimeline) {
              console.log('[Falcon] Rule pre-check: cover letter contains a timeline/phase schedule (Rule 17 — omit timeline from cover letter) — firing Claude enforcer.')
            }
            if (hasFabricatedDiagnosis) {
              console.log('[Falcon] Rule pre-check: fabricated site/account diagnosis detected (claims to have inspected the client property) — firing Claude enforcer.')
            }
            if (hasUnsolicitedLogistics) {
              console.log('[Falcon] Rule pre-check: unsolicited logistics (timezone/hours/reporting/availability) detected (Rule 436) — firing Claude enforcer.')
            }
            if (hasFillerCloser) {
              console.log('[Falcon] Rule pre-check: filler closer detected ("looking forward to working with you" etc., Rule 436) — firing Claude enforcer.')
            }
            if (regulatedJobMissingVape) {
              console.log('[Falcon] Rule pre-check: regulated-vertical job (CBD/hemp/vape/supplement/etc.) but Vape Shop case study not cited (Rule 437) — firing Claude enforcer.')
            }
            if (vapeFabrication) {
              console.log('[Falcon] Rule pre-check: vape case-study fabrication detected (multi-location/GBP/local-pack language near vape mention — KB says new-site ecommerce, NOT retail chain) (Rule 437) — firing Claude enforcer.')
            }
            if (missingYearsExperience) {
              console.log('[Falcon] Rule pre-check: cover letter is missing the mandatory "12 years" experience baseline (Rule 439) — firing Claude enforcer.')
            }
            if (ppcMissingPremierPartner) {
              console.log('[Falcon] Rule pre-check: PPC/Google Ads job but draft missing "Google Premier Partner 2026" (Rule 439) — firing Claude enforcer.')
            }
            if (hasAssumedBrand) {
              console.log(`[Falcon] Rule pre-check: draft names brand(s) the posting never mentioned (${_assumedBrands.join(', ')}) — assumed vertical, firing Claude enforcer.`)
            }
            if (exactVerticalCaseNotLeading) {
              console.log(`[Falcon] Rule pre-check: ${_jobVertical?.name} job but draft leads with a generic filler case before the on-vertical case — firing Claude enforcer to reorder.`)
            }
            if (caseMislabeledAsSaas) {
              console.log('[Falcon] Rule pre-check: a non-SaaS case study is described as SaaS/software (business-model fabrication) — firing Claude enforcer.')
            }
            if (openCartMislabeledAsPlatform) {
              console.log('[Falcon] Rule pre-check: an OpenCart case (SMASH/Game-X/GKit) is labeled as Shopify/Woo/WP work — platform fabrication, firing Claude enforcer.')
            }
            if (seoLedOnMaintenanceWebdev) {
              console.log('[Falcon] Rule pre-check: maintenance/changes web-dev job but opener leads with SEO/ranking pitch — off-target, firing Claude enforcer.')
            }
            if (hasListyOutline) {
              console.log('[Falcon] Rule pre-check: body uses a labeled-outline structure (First thing I\'d…/Site side:/Step N) — AI tell, firing Claude enforcer to rewrite as prose.')
            }
            if (timelineRequestedButMissing) {
              console.log('[Falcon] Rule pre-check: posting asks for a timeline/duration but the draft gives no concrete estimate — firing Claude enforcer.')
            }
            if (hasEchoedQuestion) {
              console.log(`[Falcon] Rule pre-check: draft echoes the client's screening question(s) verbatim (${_echoedQuestions.length}) — mechanical form-fill, firing Claude enforcer.`)
            }
            if (fabricatedGeoExperience) {
              console.log(`[Falcon] Rule pre-check: opener claims experience in the client's country (${_clientCountry}) with no case study there — fabricated geo/vertical experience, firing Claude enforcer.`)
            }

            // Build a list of specific violations found by the pre-check so the
            // enforcer knows exactly what to fix (and is allowed to add content
            // where the draft is missing required elements).
            const specificViolations = []
            if (hasBannedOpener) {
              specificViolations.push(
                'OPENER VIOLATION (PRIMARY WRITING DIRECTIVE #1): the letter opens with a ' +
                `credential/pleasantry line — "${_firstLine.slice(0, 90)}". This is the single ` +
                'biggest reply-rate killer: generic/credential openers get skimmed past. Rewrite ' +
                'ONLY the opening (first 1-2 lines) so it LEADS with the client\'s specific problem ' +
                'or goal taken from THEIR posting, in their words, plus the angle you\'d take — NOT ' +
                'Artem\'s years, partner status, or a pleasantry. Move the credential (if kept at all) ' +
                'to a brief later mention, never the first line. Do not touch the rest of the letter. ' +
                'If the opener leans on the client\'s COUNTRY or nationality as the personalising detail ("for an australian business", "for your UK company"), remove that — a nationality says nothing about their business model or account type and reads as filler. Anchor on the account type / business model (ecommerce vs lead-gen, existing account vs from scratch, search vs PMax) or their goal in their own words instead. Keep geography only if the posting makes it material (local service-area targeting, multi-market expansion, timezone requirement).' +
                (isAgencyClient
                  ? ' AGENCY/WHITE-LABEL JOB — do NOT replace it with a diagnosis of their business or another rhetorical question ("can you…?", "it comes down to one question"). The buyer is a fellow agency owner whose constraint is CAPACITY, not a broken account. Open instead with peer-level agency context: Artem runs a boutique agency (IT Force) and has delivered white-label behind other agencies\' brands, and what that takes off their plate. First person, no company boilerplate.'
                  : '')
              )
            }
            if (hasExplainerOpener) {
              specificViolations.push(
                'WIKIPEDIA / EXPLAINER OPENER (writing rule 3 — DO NOT TEACH): the opening paragraph ' +
                `reads like a textbook entry rather than a message to this client — "${_openingPara.slice(0, 120)}". ` +
                'Two things to strip: (a) the SIMILE/ANALOGY garnish ("…is like turning up the volume on static", ' +
                '"think of it as…") — it is copywriting filler, not an observation about them; and (b) any sentence ' +
                'where THE PLATFORM is the subject explaining mechanics in the abstract ("the algorithm can\'t ' +
                'optimise toward revenue if it\'s firing on page views…"). The client already knows how Google Ads ' +
                'works; explaining it to them reads as padding and as AI-generated. ' +
                'REWRITE the opening paragraph so it is about THEIR account and what you would DO: name the ' +
                'specific thing you\'d look at first and the action you\'d take, in plain first-person terms. ' +
                'No metaphors, no universal truths, no mechanism lectures. Also VARY THE ANGLE — if the posting ' +
                'does not actually point at conversion tracking, do not lead with it; pick the sharpest angle for ' +
                'THIS posting (buyer-intent segmentation, budget allocation across campaign types, geo/service-area ' +
                'precision, offer/landing-page match, seasonality, competitor gap). Keep the rest of the letter intact.'
              )
            }
            if (!timingCompliant) {
              const _offending = [...new Set(draftTimings.filter(t => !allowedTimings.has(t)))]
              const _allowed = [...allowedTimings]
              specificViolations.push(
                'TIMING VIOLATION — fix by exact find-and-replace: the draft uses ' +
                `delivery timeframe(s) the rules do NOT permit: ${_offending.map(t => `"${t}"`).join(', ') || '(a non-standard timeframe)'}. ` +
                (_allowed.length ? `The ONLY permitted timeframes are: ${_allowed.map(t => `"${t}"`).join(', ')}. ` : '') +
                'A Google Ads / PPC audit MUST be stated as "1 working day". An SEO promotion plan MUST be "2 working days". ' +
                'Find each offending phrase verbatim and replace it with the correct permitted value for what it describes (audit → "1 working day", SEO plan → "2 working days"). ' +
                'NEVER leave a multi-day range like "5-7 working days" or invent any other number. This is the single most-repeated failure — do not skip it.'
              )
            }
            if (coverHasTimeline) {
              specificViolations.push(
                'TIMELINE IN COVER LETTER (Rule 17 violation): The draft includes a schedule / phased timeline OR an audit turnaround estimate — e.g. "first 48 hours", "week 1", "weeks 1-2", "day 1", "phase 1", a multi-week roadmap, OR "turnaround is typically 2 weeks", "audit takes 2-3 weeks", "delivered in 2 weeks for a full diagnostic". Rule 17 requires the technical-audit timeline to be OMITTED from the cover letter entirely (it belongs only in the scope-of-work doc, never volunteered here). Per Rule 7, when a technical audit is mentioned you ONLY state that you are attaching a recent audit sample — you do NOT quote a turnaround time. Rewrite so the SAME work/deliverables are described WITHOUT any time markers: DELETE every "first X hours", "week N", "day N", "phase N", "within X weeks", "turnaround is X weeks", "takes X weeks" phrase. If a whole sentence exists only to state the audit turnaround (e.g. "for technical audits on existing sites, turnaround is typically 2 weeks…"), DELETE the entire sentence — do not replace it with anything. KEEP the two allowed delivery phrasings if present ("1 working day" for a Google Ads audit, "2 working days" for the SEO promotion plan) — those are delivery commitments, not a project timeline.'
              )
            }
            if (hasFabricatedDiagnosis) {
              specificViolations.push(
                'FABRICATED DIAGNOSIS (credibility-critical): The draft claims to have inspected the client\'s site/account, OR asserts a specific finding about their CURRENT state as fact (e.g. "i took a look at yoursite.com", "your technical foundation isn\'t set up", "Google isn\'t connecting those queries because [cause]", "your tracking is broken"). Artem has ONLY the job posting — he has not seen their property. Rewrite every such claim two ways: (1) reframe inspection claims as future investigation ("first thing i\'d check is whether X" instead of "your X is broken"); (2) reframe asserted findings as patterns/hypotheses ("often when a site isn\'t ranking for its own brand name it comes down to X or Y — i\'d confirm which in the audit" instead of "your foundation isn\'t set up"). Keep the sharp, knowledgeable tone — just move from "i already found this on your site" to "here\'s what i\'d look for and why". Do NOT invent any number describing their current performance.'
              )
            }
            if (hasAssumedBrand) {
              specificViolations.push(
                `ASSUMED VERTICAL / FABRICATED BRAND (credibility-critical): The draft names concrete consumer brand(s) the posting never mentioned — ${_assumedBrands.join(', ')}. The posting does NOT state the client's specific product or vertical, so naming a product/brand assumes their business and risks reading as "assumed the wrong company". ` +
                'REWRITE every illustrative example to be category-neutral or explicitly hypothetical — replace the named brand/product with "[your product]", "a specific model/size/SKU", "whatever you sell", or a generic "research query vs high-intent buy query" framing. Keep the underlying insight (buyer-intent segmentation, feed structure, etc.) — only strip the assumed product identity. Do NOT substitute a different specific brand; go neutral. Case-study client names in the APPROVED CASE STUDIES block are Artem\'s own and must NOT be touched.'
              )
            }
            if (fabricatedGeoExperience) {
              specificViolations.push(
                `FABRICATED GEOGRAPHIC / VERTICAL EXPERIENCE (credibility-critical): The opener claims Artem works with sites in ${_clientCountry} and/or in the client's specific vertical — but he has NO case study in ${_clientCountry} and none in that vertical. This is a fabricated track record the client can expose in one question. ` +
                `REWRITE the opening so it does NOT claim experience in the client's country or vertical. Do NOT relabel a real case to match (the multilingual case is CONSTRUCTION/CONSULTING, not education; it is Italy/Austria, not ${_clientCountry}). Frame the hook around the transferable TECHNICAL METHOD (what Google indexes vs. what the site thinks it exposes, 12-month GSC diagnosis, multilingual indexing) and cite only what the approved case studies actually prove. It is fine to reference the CLIENT's situation ("for an education site in a competitive local market…") — just never claim Artem has DONE that vertical/geography before.`
              )
            }
            if (hasEchoedQuestion) {
              specificViolations.push(
                `ECHOED SCREENING QUESTIONS (mechanical form-fill — wording-critical): The draft pastes the client's question wording near-verbatim as a heading/label before answering — e.g. "${_echoedQuestions[0].slice(0, 70)}${_echoedQuestions[0].length > 70 ? '…' : ''}". No human echoes the client's own questions back at them; it reads as an AI template. ` +
                'REWRITE so the answers are in Artem\'s own words woven into natural prose. Remove every pasted question heading. If a light label genuinely aids readability, use a SHORT self-authored 2–4-word label in Artem\'s voice ("Local results:", "First thing I\'d check:", "Rate & availability:") — never the client\'s full question. Cover every point, just don\'t restate the questions.'
              )
            }
            if (timelineRequestedButMissing) {
              specificViolations.push(
                'MISSING TIMELINE ANSWER (the client explicitly asked): The posting asks for a timeline / how long / turnaround / ETA, but the draft gives NO concrete duration — it describes the deliverable or steps instead. ' +
                'ADD a concrete time estimate that directly answers the question (e.g. "I\'d complete the review in about 3–5 business days once I have staging access", "roughly a week end-to-end"). Keep it realistic and scope-appropriate. This is the ONE case where a timeline in the letter is REQUIRED — do not omit it, and do not answer a "how long" question with a description of what you\'ll deliver.'
              )
            }
            if (hasListyOutline) {
              specificViolations.push(
                'LISTY / LABELED-OUTLINE STRUCTURE (structural AI tell): The body reads as a labeled outline — "First thing I\'d audit:", "Then campaign structure -", "Site side:", "Step N:", or similar colon-delimited mini-sections. This is one of the clearest "a bot wrote it" signals. ' +
                'REWRITE the diagnosis/approach as FLOWING PROSE — 2-3 connected paragraphs where the ideas link naturally, the way a person explains something out loud. Keep every fact and check you already named, just weave them into sentences instead of a checklist ("I\'d start by making sure the conversion tracking is even firing right, because when that\'s broken the algorithm optimises blind, then look at whether budget is going to high-intent terms or leaking to broad informational queries…"). Do NOT keep any "First:/Then:/Site side:/Step N:" labels. Leave the case-study block and its lead-in as they are.'
              )
            }
            if (seoLedOnMaintenanceWebdev) {
              specificViolations.push(
                'OFF-TARGET SEO PITCH ON A MAINTENANCE JOB: This is a web-dev MAINTENANCE / CHANGES / FIX job on an EXISTING store, but the letter pitches SEO/ranking ("wire the technical SEO/GA4 into the build from day one", "most devs build the store and hand off", "ranks from launch", "six months later") — whether in the opener OR as a "differentiator" paragraph in the body. The store already exists (no build, no launch) and the client hired a DEVELOPER, not an SEO — this reads as pitching a service they didn\'t ask for. ' +
                'FIX: REMOVE the SEO/"wired into the build" differentiator entirely. Lead and differentiate on DEV RELIABILITY: careful theme/Liquid work, testing every change in a duplicate/preview before pushing live, clean scoped delivery, and not breaking existing functionality. Keep SEO/tracking to AT MOST one reassurance line ("changes won\'t break your rankings, schema, or GA4 tracking") — never a ranking pitch or a "from day one" build claim. There is no launch to rank from.'
              )
            }
            if (openCartMislabeledAsPlatform) {
              specificViolations.push(
                'PLATFORM FABRICATION — OpenCart case labeled as Shopify/Woo/WordPress (credibility-critical): Game-X, SMASH and GKit are all OPENCART builds, but the draft files them under a "Shopify/WooCommerce/WordPress work" heading — a false platform claim the client catches on the first click. ' +
                'FIX: relabel the case intro so the platform is truthful — call it "Recent ecommerce work" or "OpenCart builds", NOT "Shopify work". If you want DIRECT proof on the job\'s platform, cite Artem\'s real Shopify stores instead: casaeleganza.com and paramusmegafurniture.com. When keeping the OpenCart cases, frame them as transferable ("built on OpenCart — same custom-theme + module + tracking discipline"). Never call an OpenCart build Shopify/Woo/WordPress.'
              )
            }
            if (caseMislabeledAsSaas) {
              specificViolations.push(
                'CASE-STUDY BUSINESS-MODEL FABRICATION (credibility-critical): The draft describes one of Artem\'s case studies as SaaS / software / a subscription product. NONE of his cases is SaaS — Skin Reboot is skincare ECOMMERCE, Nectar Flowers an ecommerce florist, FridgeFix/House Painting local services, etc. ' +
                'FIX: stop calling the case a SaaS/software case. Either describe it by its REAL business model and bridge the transferable mechanic to the client\'s SaaS context ("same trial-vs-paid ROAS tracking challenge, different business model"), or remove the case and lean on the method + Premier Partner credential. Do NOT relabel a case\'s industry to match the job — the client opens it and sees the truth.'
              )
            }
            if (exactVerticalCaseNotLeading && _jobVertical) {
              specificViolations.push(
                `CASE-STUDY ORDERING — ${_jobVertical.name.toUpperCase()} CASE MUST LEAD (relevance-critical): This is a ${_jobVertical.name} job, but the draft cites a generic local-service filler case (FridgeFix appliance repair / House Painting) BEFORE the on-vertical proof. ` +
                `REORDER the proof block so the ${_jobVertical.name} case leads: ${_jobVertical.lead}. It must be the FIRST case study cited. ` +
                'Then keep AT MOST one supporting case only if it adds the same conversion mechanic. Drop the weakest generic case rather than pad — the on-vertical case is the most important element of this letter and cannot be buried after a generic one.'
              )
            }
            if (hasUnsolicitedLogistics) {
              specificViolations.push(
                'UNSOLICITED LOGISTICS (Rule 436): The draft volunteers logistical info the client did NOT ask about — e.g. timezone ("i\'m UTC+2", "working hours", "timezone overlap isn\'t a blocker"), async-vs-sync preference ("i work async"), reporting cadence ("structured weekly reporting", "monthly performance reporting"), availability windows, or start-date promises. ' +
                'CHECK THE JOB POSTING FIRST: if the client explicitly asked about any of these (e.g. a screening question "what\'s your timezone?" or "how do you report?"), KEEP the relevant answer. Also KEEP these tokens when they appear inside a case-study description (e.g. "monthly reporting" as a deliverable Artem ran for a past client). ' +
                'For everything else: DELETE the unsolicited logistics sentence entirely — do not rewrite it shorter, REMOVE it. Volunteering this info preempts doubts the client wasn\'t having and reads defensive. Do not replace the deleted sentence with anything.'
              )
            }
            if (hasFillerCloser) {
              specificViolations.push(
                'FILLER CLOSER (Rule 436): The draft ends with empty pleasantry — "looking forward to working with you", "happy to discuss", "let me know your thoughts", "excited to chat", "feel free to reach out", "available to jump on a call", or similar. ' +
                'DELETE the entire filler sentence. Do NOT replace it. The cover letter must end on the last substantive line — the case study, the audit/plan offer, or simply the signature line ("artem"). If the signature line is missing after deletion, add "artem" on its own line.'
              )
            }
            if (hasCircumventionRisk) {
              specificViolations.push(
                'CIRCUMVENTION RISK (Trust & Safety — HIGHEST PRIORITY): The draft contains wording Upwork\'s automated scanners flag as taking work, payments, or communication off-platform — e.g. "outside/off/around Upwork", "Upwork … friction/workaround/limitations", payment rails (PayPal, Wise, wire, crypto, "pay me directly"), or off-platform contact channels (WhatsApp, Telegram, email addresses). ' +
                'A real enforcement flag already hit this account over an innocent sentence of this shape. REWRITE or DELETE every such phrase. If discussing platform-access friction (e.g. Meta Business Manager 2FA), describe the technical solution WITHOUT mentioning Upwork or the words "friction"/"workaround" near it — e.g. "i\'ll set up secure partner access through Meta Business Manager". Never mention payment methods or contact channels at all.'
              )
            }
            if (regulatedJobMissingVape) {
              specificViolations.push(
                'MISSING VAPE SHOP CASE STUDY (Rule 437): This job involves a regulated/restricted-substance vertical (hemp/CBD/cannabis/vape/supplement/etc.). The draft MUST cite the Vape Shop case study (KB entry #1, case #3) as the LEAD direct-vertical proof — it is the only direct-vertical match in the entire KB. ' +
                'Add a paragraph that leads with: "vape shop: restricted e-cig e-commerce, new-site launch — built to 7,000 monthly visitors, 54 keywords in google top 1, 80 referring domains. work: technical foundation, semantic core, meta template system, content, and link building. same restricted-substance bucket as [hemp/CBD/etc.] — paid is blocked, organic carries the growth load." ' +
                'Place Vape Shop BEFORE the PDF case studies (Skin Reboot, Derma Solution) in any regulated-vertical Q&A or capability paragraph — PDFs are layered after as adjacent YMYL/restricted proof, not as the lead. ' +
                'CRITICAL — do NOT invent multi-location, retail-chain, GBP, local-pack, citations, in-store foot traffic, or any local-SEO details for the Vape Shop case. The real KB entry is a new-site e-commerce build only.'
              )
            }
            if (vapeFabrication) {
              specificViolations.push(
                'VAPE CASE-STUDY FABRICATION (Rule 437 — credibility-critical): The draft describes the Vape Shop case with details that are NOT in the KB — multi-location language, location counts, "Google Business Profile", "GBP", "map pack", "local citations", "retail chain", "in-store foot traffic", or similar local-SEO work. ' +
                'The real KB entry (entry #1, case #3) says: "newly launched restricted e-commerce site", "E-cigarettes / restricted e-commerce", metrics: 7,000 monthly visitors, 80 referring domains, 54 keywords in Google Top 1, work: technical improvements, semantic core development, meta template setup, content creation, link building. ' +
                'It is NOT a multi-location retail chain. It did NOT involve GBP / local pack / citations / multi-location landing pages. ' +
                'REWRITE the Vape Shop paragraph to describe ONLY what is in the KB: a NEW restricted-e-commerce site built from scratch, the exact metrics above, and the listed work types. The relevance to a multi-location client is the SHARED RESTRICTED-SUBSTANCE PLAYBOOK (paid blocked, organic must carry, compliance-aware content, E-E-A-T), NOT that vape was also multi-location.'
              )
            }
            if (missingYearsExperience) {
              specificViolations.push(
                'MISSING "12 YEARS" EXPERIENCE BASELINE (Rule 439): The draft never states Artem\'s "12 years" of experience. This is mandatory on every cover letter and must appear within the first 2-3 sentences of the body (typically the second sentence, right after the intro mirror — never buried at the end or in a Q&A answer). ' +
                'For an SEO job, use the exact phrase "12 years" in context such as: "12 years in technical SEO" or "12 years scaling organic SEO across <relevant verticals>" or "12 years building technical SEO for <job-relevant context>". ' +
                'For a PPC / Google Ads / paid-media job, use BOTH "12 years" AND "Google Premier Partner 2026": "12 years running Google Ads, Google Premier Partner 2026" or similar. ' +
                'For a hybrid SEO + PPC job, combine: "12 years across SEO and Google Ads (Google Premier Partner 2026)". ' +
                'State EXACTLY "12 years" — never inflate to "15 years", "over a decade", "12+ years", or "more than 10 years". Insert this credential sentence early; do not pad with extra adjectives.'
              )
            }
            if (ppcMissingPremierPartner) {
              specificViolations.push(
                'MISSING "GOOGLE PREMIER PARTNER 2026" (Rule 439): This is a PPC / Google Ads / paid-media job (the posting mentions Google Ads / PPC / paid search / Performance Max / Smart Bidding / Shopping / Meta Ads / Bing Ads / etc.). ' +
                'The draft MUST include "Google Premier Partner 2026" in the experience-baseline sentence. This is a third-party trust signal that immediately differentiates from competing applicants and must not be omitted on any paid-media job. ' +
                'Combine it with the "12 years" credential — example: "12 years running Google Ads, Google Premier Partner 2026." Place it in the first 2-3 sentences of the body, not at the end. ' +
                'Do NOT add "Premier Partner" to SEO-only sections of the letter — it is a Google Ads program, not an SEO credential. Use it specifically in the PPC/paid-media credential line.'
              )
            }
            if (hasForbiddenPhrase) {
              specificViolations.push('FORBIDDEN PHRASE: The draft contains a prohibited phrase (e.g. "walk through", "hop on a call", "schedule a demo", invented sample/attachment references). Remove or rewrite every occurrence.')
            }
            if (missingPdfLabel) {
              specificViolations.push('MISSING PDF LABEL: The draft mentions "Derma Solution" or "Skin Reboot" without stating it is "attached as a PDF". If the draft incorrectly attributes one of these PDF case studies to "profile highlights", change it to "attached as a PDF". Add or correct the PDF label in the same or following sentence.')
            }
            if (missingAuditSampleMention) {
              specificViolations.push(
                'MISSING AUDIT SAMPLE MENTION: This is an audit / diagnosis job and the draft does not offer to attach the matching audit sample. ' +
                (jobIsSeo
                  ? 'This is an SEO technical-audit/diagnosis/migration job → attach the TECHNICAL SEO AUDIT SAMPLE (inventory item 5, the real 36-page lemoos.com audit PDF). Add a sentence like: "i\'m attaching a sample technical SEO audit so you can see the format and depth." Do NOT say there is no SEO audit sample — there is. Do NOT substitute the PPC audit sample.'
                  : 'This is a PPC/Google Ads audit job → attach the Google Ads audit sample: "i\'m attaching a sample of a recent Google Ads audit so you can see the format and depth."') +
                ' Place it near the end (e.g. with the diagnostic CTA). Keep the conversational voice.'
              )
            }
            if (vapeOnPpcOnlyJob) {
              specificViolations.push(
                'VAPE SHOP ON A PURE-PPC JOB — CHANNEL MISMATCH (Rule 437): The draft cites the Vape Shop case on a Google Ads / paid-media job that has NO SEO scope. Vape Shop is an SEO case — its metrics (monthly visitors, referring domains, keywords in Top 1) are organic, not paid — so it is off-channel here and weakens the pitch. ' +
                'DELETE the entire Vape Shop paragraph (and remove "vape shop" from any case-studies lead-in line). On this pure-PPC job the regulated/restricted proof is Skin Reboot\'s PAID angle (17.51 PMax ROAS, +693.8% revenue) — keep that as the lead. Do not replace Vape with another SEO case.'
              )
            }
            if (irrelevantCaseOnRegulated) {
              specificViolations.push(
                'IRRELEVANT CASE STUDY ON A RESTRICTED/YMYL JOB (Rule 407): The draft cites a generic consumer case study (Nectar Flowers / House Painting / FridgeFix / Golden State Trailers) on a restricted/regulated/YMYL brief (peptides, skincare, supplements, medical aesthetics, etc.). These off-vertical cases signal weak relevance judgment and dilute the on-point restricted cases beside them. ' +
                'DELETE the generic consumer case entirely. Do NOT replace it with another case unless that case is genuinely restricted/YMYL-relevant. Fewer, on-point cases are STRONGER than more cases with a filler — it is correct to end with just 1-2 restricted-niche cases (Skin Reboot, Derma Solution, Vape Shop). ' +
                'Also match channel: on a Google Ads/PPC job cite the PAID result (e.g. Skin Reboot 17.51 PMax ROAS, +693.8% revenue), not a case\'s SEO/organic-traffic numbers.'
              )
            }
            if (launchJobMissingCTA) {
              specificViolations.push(
                'MISSING LAUNCH CTA (Rule 450): This is a from-scratch PPC launch job. The draft must close with the mandatory launch-delivery commitment — that Artem can SET UP AND LAUNCH the campaigns from scratch in "5 working days" (the launch-job equivalent of the 1-working-day audit offer / 2-working-day SEO plan). ' +
                'Add a sentence near the end, e.g. "i can set up and launch your campaigns from scratch in 5 working days - technical foundation, merchant center feed, and the initial Search campaigns live and approved." ' +
                'Use EXACTLY the phrase "5 working days" (not "5 business days", "a week", or any variation). Keep the lowercase conversational voice. Do NOT add any other timeline/turnaround language.'
              )
            }
            if (campaignLiveTooFast) {
              specificViolations.push(
                'FALSE "CAMPAIGN LIVE IN 1 DAY" CLAIM (credibility-critical): the draft claims the campaign(s) go live / launch / are running within ~1 (or 1-2) working day(s). That is untrue — "1 working day" is the GOOGLE ADS AUDIT turnaround ONLY; it is NEVER a campaign build/launch/go-live timeframe. A from-scratch build+launch is "5 working days" (Rule 450), and even then Google\'s ad review means it is "live AND approved", not instant. ' +
                'Fix: replace the false claim. If this is a from-scratch setup/launch job, use the Rule 450 line — "i can set up and launch your campaigns from scratch in 5 working days" (initial Search campaigns live and approved). If it is not a launch job, DELETE the go-live timeframe entirely rather than quote any day-count for a campaign. Never state or imply a campaign is live within 1 working day.'
              )
            }
            if (caseStudyToldAsRemediation) {
              specificViolations.push(
                'CASE STUDY VIOLATES THE CLIENT\'S EXPLICIT SCREENING INSTRUCTION (critical — this can get the proposal auto-rejected): the posting explicitly asks for an example where Artem DIAGNOSED a performance issue using data, and explicitly says NOT an example where he set up or managed the campaign himself. The draft\'s case study is narrated in first-person REMEDIATION verbs ("I rewired conversion tracking", "rebuilt Search", "segmented the feed", "the fix: ...") — this is exactly the framing the client said not to send. ' +
                'Fix: keep the SAME case study and the SAME real metrics/facts, but retell it as DIAGNOSIS ONLY. Describe what the DATA SHOWED and what that REVEALED as the root cause (e.g. "the data showed collapsing ROAS despite high click volume, and cross-referencing Ads conversions against GA4 revenue showed the gap traced to the conversion goal firing on the wrong event") — do NOT narrate what Artem personally did to fix it ("I rewired / rebuilt / segmented / implemented"). If a fix must be mentioned at all, attribute it neutrally to what the diagnosis pointed to, not to Artem\'s own remediation action. The point of the story is the DIAGNOSTIC PROCESS (what was tracked, what pattern emerged, what it revealed), not the repair.'
              )
            }
            if (wrongAuditOfferOnLaunch) {
              specificViolations.push(
                'WRONG AUDIT OFFER ON A LAUNCH JOB (Rule 450 — credibility-critical): The client is launching a Google Ads account FROM SCRATCH (zero pixel data, $0 to scale, no existing campaigns). There is NOTHING to audit — they have no running account. The draft offers an audit and/or says it is "attaching a sample of a recent Google Ads audit". Offering an audit here proves Artem did not read the brief. ' +
                'DELETE the entire audit-offer / audit-sample sentence. Do NOT replace it with another audit mention. ' +
                'If a deliverable/attachment is wanted to show depth, the correct one for a from-scratch launch is the SETUP + LAUNCH PLAN (week-by-week build approach: technical foundation, Merchant Center feed, campaign architecture, scaling triggers) which the draft should already describe — do not attach an "audit". You MAY keep a brief offer to share a relevant case study PDF, but remove all audit-as-deliverable language. ' +
                'End the letter on a substantive line per the closing rules (no filler closer).'
              )
            }
            if (wrongPlanOnAuditJob) {
              specificViolations.push(
                'WRONG DELIVERABLE — SEO PROMOTION PLAN ON AN AUDIT-ONLY JOB: The client asked for a one-time SEO AUDIT / ranking analysis with a written report + prioritized recommendations — NOT ongoing SEO management. There is no retainer or continuing engagement in this posting (any "long-term strategy / recommendations" is a SECTION of the audit report, not ongoing work). The draft offers a "3-month SEO promotion plan", which is an ongoing-campaign document — the wrong deliverable, and it reads as an unwanted upsell. ' +
                'DELETE the entire "i can prepare a custom 3-month SEO promotion plan…" sentence. If the draft attaches "a sample SEO promotion plan", REPLACE that clause with the technical SEO audit sample instead: "i\'m attaching a sample technical SEO audit so you can see the format and depth." (If a technical SEO audit sample is already attached, just delete the promotion-plan sentence and keep it.) The deliverable here is the audit + prioritized fixes (e.g. the rich-snippets/schema fix), nothing more — never a promotion plan or link-building budget.'
              )
            }
            if (missingSeoPlanOffer) {
              specificViolations.push(
                'MISSING SEO PROMOTION PLAN OFFER: This is an SEO job. The draft must offer a custom 3-month SEO Promotion Plan deliverable in 2 working days, covering: deliverables, costs, link building budget, basic site check, competitor overview. ' +
                'CRITICAL OVERRIDE — even if the job description mentions an initial audit phase, if it also mentions a retainer, ongoing work, or long-term improvement (e.g. "audit project, followed by a retainer", "ongoing SEO", "monthly improvements"), the (A) audit-only exception does NOT apply. You MUST include the plan CTA in addition to any audit sample mention. ' +
                'Add a sentence like: "i can prepare a custom 3-month SEO promotion plan within 2 working days — covers deliverables, costs, link building budget, a basic site check, and competitor overview. i\'m attaching a sample SEO promotion plan so you can see the format." ' +
                'Keep the lowercase conversational voice. Place it near the end of the proposal, before the case studies block or the sign-off. Do NOT remove the audit sample mention if it is already present — keep both.'
              )
            }
            if (wrongSeoPlanTiming) {
              specificViolations.push(
                'WRONG SEO PROMOTION PLAN TIMING: The draft offers the SEO promotion plan with the wrong delivery timeframe. ' +
                'The ONLY acceptable phrasing is "2 working days" — not "5 business days", "3-5 days", "a week", or any variation. ' +
                'Find the SEO promotion plan sentence and replace whatever timing is there with the exact phrase "2 working days". Change ONLY the timing. Keep everything else verbatim.'
              )
            }
            if (missingCaseStudy) {
              specificViolations.push(
                'MISSING CASE STUDY REFERENCE: The draft must include at least one concrete result from the APPROVED CASE STUDIES ' +
                'provided below. Pick ONE specific metric or outcome (e.g. "grew ROAS from 1.8× to 4.2×", a revenue number, ' +
                'a CPA reduction) and weave it into a single sentence naturally. ' +
                'Rules: (a) only use content that appears verbatim in the APPROVED CASE STUDIES section below — do NOT invent industries, ' +
                'metrics, or client descriptions; (b) do NOT write "happy to send", "can send over", or any future-offer phrasing — ' +
                'the results are cited as past proof, not a future deliverable; (c) keep the lowercase conversational voice; ' +
                '(d) after the result mention, add "full case study attached in profile highlights".'
              )
            }
            if (caseStudyDomainMismatch) {
              const jobDomain = jobIsSeo ? 'SEO' : 'PPC / Google Ads'
              const wrongDomain = jobIsSeo ? 'PPC / Google Ads' : 'SEO'
              const wrongCases = jobIsSeo
                ? 'FridgeFix, House Painting, Nectar Flowers (PPC-only — do not cite in SEO proposals)'
                : 'Multilingual Site, Derma Solution organic-traffic results (SEO-only — do not cite in PPC proposals)'
              const rightCases = jobIsSeo
                ? 'Derma Solution (+1,861% organic traffic, +14,342% conv — PDF), Skin Reboot SEO angle (+91.58% traffic, +693% revenue — PDF), Multilingual Site (17,100 new monthly visits)'
                : 'FridgeFix (-92% cost/conv, +1,405% conv), House Painting (2,100+ clicks, 7.3% CTR), Nectar Flowers (-72% CPA, +350% income), ChronoCash (luxury watches — €0.52 CPC, +42% conv), Skin Reboot PPC angle (17.51 PMax ROAS, +693.8% revenue — PDF)'
              specificViolations.push(
                `CASE STUDY DOMAIN MISMATCH: This is a ${jobDomain} job, but the draft cites a ${wrongDomain} case study. ` +
                `Wrong (remove): ${wrongCases}. ` +
                `Right (use one of these instead): ${rightCases}. ` +
                `Replace the mismatched case study entirely — keep the same paragraph format and "attached in profile highlights" / "attached as a PDF" labels, just swap in a domain-appropriate case study with its real metrics.`
              )
            }
            if (missingHighlightsPhrase) {
              specificViolations.push(
                'CASE STUDY FORMAT VIOLATION: The case study block is formatted incorrectly. ' +
                (csCrammed ? 'Multiple case studies are crammed into a single paragraph — they are separated by ", and" or similar connectors instead of blank lines. ' : '') +
                (!hasHighlightsPhrase ? '"profile highlights" is missing entirely. ' : '') +
                'Rewrite ONLY the case study section using this exact structure (keep everything else verbatim):\n\n' +
                '[lead-in sentence] (attached in profile highlights):\n\n' +
                '[Client Name]: [what was done]. [key metric(s).]\n\n' +
                '[Client Name]: [what was done]. [key metric(s).]\n\n' +
                'The blank line between entries is mandatory. "attached in profile highlights" goes in the lead-in only — never after individual entries. Client names in Title Case.'
              )
            }

            const enforcePrompt = [
              'You are a rules-compliance checker for an Upwork cover letter draft. Your ONLY job is to fix the specific violations listed below, then verify every applicable KB rule is satisfied.',
              '',
              'SPECIFIC VIOLATIONS TO FIX (these were caught by an automated pre-check — fix ALL of them):',
              ...specificViolations.map((v, i) => `${i + 1}. ${v}`),
              '',
              'RULES (each rule may have a trigger condition; apply the rule whenever its trigger condition is true for the job posting below):',
              ...rules.map(r => `Rule ${r.id}. ${r.content}`),
              '',
              ...((missingCaseStudy || missingHighlightsPhrase || caseStudyDomainMismatch) && (portfolioText || referenceText) ? [
                'APPROVED CASE STUDIES & REFERENCE METRICS (use these as the ONLY source for case study references — do not invent any):',
                ...(portfolioText ? [portfolioText.trim()] : []),
                ...(referenceText ? [referenceText.trim()] : []),
                '',
              ] : []),
              'JOB POSTING (use this to evaluate which rules fire):',
              jobContext,
              '',
              'CURRENT DRAFT:',
              text.trim(),
              '',
              'INSTRUCTIONS:',
              '1. Fix EXACTLY the violations in the SPECIFIC VIOLATIONS list above — these are the only changes you make. They were caught by a deterministic pre-check, so they are real; fix every one.',
              '2. The RULES section is REFERENCE ONLY — use it to understand HOW to fix the listed violations correctly (e.g. exact phrasing a rule mandates). Do NOT go hunting for other rule violations to fix, and do NOT re-evaluate the whole draft. If something is not in the SPECIFIC VIOLATIONS list, leave it exactly as written.',
              '3. Make the SMALLEST edit that satisfies each listed violation — preserve voice, tone, structure, and every other sentence verbatim. Output exactly ONE version of the letter; never include the old version, an explanation, or any duplicate.',
              '4. Do NOT add new commitments, claims, case studies, or sentences beyond what the listed violations require.',
              '',
              'OUTPUT FORMAT: Return ONLY the corrected cover letter text — the first character is the first word of the letter. No preamble, no list of changes, no explanation, no second version.',
            ].join('\n')

            const enforceRes = await fetch('/claude', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                _kind: 'proposal_rule_enforce',
                // Sonnet for the enforcement pass. Haiku (~7× cheaper) proved
                // unreliable at catching fabrications / rule violations and at
                // clean surgical rewrites — the owner saw issues in most letters
                // (2026-07-14), so we swapped back to Sonnet as the code always
                // anticipated. Reliability of this pass matters more than its cost.
                model: 'claude-sonnet-4-5',
                max_tokens: 1500,
                system: 'You are a precision rule-compliance editor for Upwork cover letters. You make minimal, surgical edits to enforce rules. You may add brief sentences only when a violation explicitly requires adding missing content.',
                messages: [{ role: 'user', content: enforcePrompt }],
              }),
            })
            if (enforceRes.ok) {
              const enforceData = await enforceRes.json()
              const correctedText = _stripAttachmentsSummaryLine(_stripLeadingSignoff((enforceData.content || []).map(b => b.text || '').join('').trim()))
              if (correctedText && correctedText.length > 40) {
                text = correctedText
              }
            }
          }
        }
      } catch (enforceErr) {
        // Enforcement pass is best-effort — if it fails, fall back to the
        // first-pass draft. The first pass already has strong rule priming
        // so it's not catastrophic when the enforcer is unavailable.
        console.warn('[Falcon] Rule-compliance pass failed, using first-pass draft:', enforceErr)
      }

      setProposal(_unwrapFilledPlaceholders(_humanizeCasing(_stripUnaskedRate(_stripDuplicateDifferentiator(_stripKbLeak(_fixPdfCaseLabelMisattribution(_stripFabricatedVerticalOpener(_stripFabricatedOpener(_stripDuplicateCaseBlockLabel(_stripGenericCaseParagraphs(_stripDuplicateAuditSampleMention(_stripDuplicateAttachmentLabel(_ensureCaseStudyHighlightsLeadIn(_cleanPasteText(text)))), jobIsRegulatedForStrip))))))), _postingAsksRate))).trim())
    } catch (e) {
      setProposal(`Error generating cover letter: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(proposal)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // One-click: copy the cover letter to the clipboard AND open the Upwork
  // job page in a new tab. The user pastes (Ctrl+V) into Upwork's proposal
  // form. Replaces the otherwise two-step Copy + Open on Upwork dance.
  //
  // Tab open is routed through the extension bridge (`cockpit:open-tab`) when
  // available — `chrome.tabs.create()` from the extension's background worker
  // is treated as a first-party navigation by Chrome, so Upwork's session
  // cookie is sent and the user lands authenticated. Plain window.open from
  // localhost:5180 → upwork.com sometimes hits a cross-site cookie wall
  // (SameSite=Strict / CHIPS) and gets bounced to the login screen. Falls
  // back to window.open if the extension isn't loaded.
  const applyOnUpwork = (e) => {
    fireApplyAnimation(e && e.currentTarget)
    if (proposal.trim()) {
      navigator.clipboard.writeText(proposal).catch(() => {})
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    // Delay the tab open so the bullet + explosion is visible. window.open
    // pulls focus immediately and the user never sees the animation. Going
    // through the bridge (chrome.tabs.create) is safe to delay; the
    // window.open fallback path is also fine within ~1s of a click in
    // modern browsers' popup-blocker grace window.
    const url = getUpworkUrl(job, { forApply: true })
    const reduced = (typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    // 600ms: explosion runs 420ms, plus a small buffer so the spark fade is
    // visible before the new tab steals focus.
    const openDelay = reduced ? 0 : 600
    setTimeout(() => openInUpworkTab(url, bridgeReady), openDelay)
  }

  // Save proposal to /proposals for outcome tracking (Outcomes tab)
  const saveToKB = async () => {
    if (!job?.id || !proposal.trim()) {
      setSaveMsg({ kind: 'err', text: 'Nothing to save' })
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      const isUpdate = !!savedProposal
      const url = isUpdate ? `/proposals/${savedProposal.id}` : '/proposals'
      const method = isUpdate ? 'PUT' : 'POST'
      const body = isUpdate ? {
        sent_text: proposal,
        status: statusValue,
        client_reply_text: replyText || null,
        notes: notesText || null,
      } : {
        job_id: job.id,
        sent_text: proposal,
        status: statusValue,
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `API ${res.status}`)
      }
      const saved = await res.json()
      setSavedProposal(saved)
      setStatusValue(saved.status || statusValue)
      // Clear unsaved draft cache since it's now persisted
      delete proposalCacheRef.current[job.id]
      _lsRemove('proposalDraft', job.id)

      setSaveMsg({ kind: 'ok', text: isUpdate ? 'Updated in Outcomes' : 'Saved to Outcomes' })
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg({ kind: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const STATUSES = [
    'draft', 'sent', 'viewed', 'replied', 'interviewing',
    'hired', 'declined', 'ghosted', 'expired', 'withdrawn',
  ]
  const STATUS_COLOR = {
    draft: '#6b7280', sent: '#3b82f6', viewed: '#8b5cf6',
    replied: '#00c8d4', interviewing: '#06b6d4', hired: '#00d070',
    declined: '#ef4444', ghosted: '#f59e0b',
    expired: '#9ca3af', withdrawn: '#6b7280',
  }

  return (
    <div data-col-id="proposal" style={{ flex: 1, overflow: 'hidden', minWidth: '15%', display: 'flex', flexDirection: 'column' }}>
      {/* Cover letter section — flex: 1 so it fills the column above the chat.
          Pre-generation, a growing placeholder fills the leftover height so
          there's no blank void; post-generation the textarea fills it. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowAnchor: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>▸ Cover Letter</div>
        <button
          onClick={() => { setShowRules(v => { if (!v) fetchKbRules(); return !v }) }}
          className="btn-ghost"
        >
          ⚙ My Rules
        </button>
      </div>

      {/* Rules panel */}
      {showRules && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>My Rules — applied to every analysis &amp; cover letter</div>

          {/* Input + distill */}
          <textarea
            value={ruleInput}
            onChange={e => setRuleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); distillRule() } }}
            placeholder="Describe a rule in plain language… (Enter to create)"
            rows={2}
            style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, padding: '7px 10px', borderRadius: 4, outline: 'none', resize: 'none', boxSizing: 'border-box', lineHeight: 1.5 }}
          />
          <button
            onClick={distillRule}
            disabled={distilling || !ruleInput.trim()}
            className="btn-secondary"
            style={{ width: '100%' }}
          >
            {distilling ? '…forming rule' : '✦ Create Rule'}
          </button>

          {/* Distilled rule bubble */}
          {distilledRule && !distilledRule.error && (
            <div style={{ background: 'rgba(0,200,212,0.08)', border: '1px solid rgba(0,200,212,0.30)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 10, color: '#00c8d4', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>✦ Distilled Rule</div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>{distilledRule.text}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!distilledRule.saved ? (
                  <button
                    onClick={addDistilledToKB}
                    disabled={distilledRule.saving}
                    style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', background: distilledRule.saving ? 'var(--bg3)' : '#00c8d4', color: distilledRule.saving ? 'var(--text3)' : '#fff', border: 'none', borderRadius: 4, cursor: distilledRule.saving ? 'wait' : 'pointer' }}
                  >
                    {distilledRule.saving ? 'Saving…' : '✚ Add to KB'}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: '#00d070', fontWeight: 600 }}>✓ Saved to KB</span>
                )}
                <button onClick={() => setDistilledRule(null)} style={{ fontSize: 10, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}>dismiss</button>
              </div>
            </div>
          )}
          {distilledRule?.error && (
            <div style={{ fontSize: 11, color: '#ef4444' }}>✗ {distilledRule.error}</div>
          )}

          {/* Existing KB rules */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Active Rules in KB</div>
            {loadingKbRules && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Loading…</div>}
            {!loadingKbRules && kbRules.length === 0 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>No rules yet.</div>}
            {kbRules.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', background: 'var(--bg3)', borderRadius: 4, marginBottom: 6 }}>
                <span style={{ color: '#00c8d4', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 2, minWidth: 38, fontFamily: 'var(--font-mono, monospace)' }}>
                  #{i + 1}
                </span>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{r.content}</span>
                <button onClick={() => deleteKbRule(r.id)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File drop zone — always visible so files can be attached before or after generation */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleFileDrop}
        style={{
          border: `1px dashed ${isDragOver ? '#00c8d4' : 'var(--border2)'}`,
          borderRadius: 6,
          padding: droppedFiles.length > 0 ? '8px 10px' : '10px 12px',
          background: isDragOver ? '#00c8d420' : 'transparent',
          transition: 'all 0.15s',
          cursor: 'default',
        }}
      >
        {droppedFiles.length === 0 ? (
          <div style={{ fontSize: 11, color: isDragOver ? '#00c8d4' : 'var(--text3)', textAlign: 'center', pointerEvents: 'none' }}>
            Drop PDF, Excel, image, or text file to add context to the generator
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {droppedFiles.map((f, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
                padding: '2px 6px 2px 8px', borderRadius: 4,
                background: '#00c8d414', color: '#00c8d4', border: '1px solid #00c8d440',
              }}>
                {f.blockType === 'document' ? '📄' : f.blockType === 'image' ? '🖼' : _isExcel(f) || /\.(xlsx|xls)$/i.test(f.name) ? '📊' : '📝'} {f.name}
                <button onClick={() => setDroppedFiles(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: '#00c8d4', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
            <span style={{ fontSize: 10, color: 'var(--text3)', alignSelf: 'center' }}>
              — drop more to add
            </span>
          </div>
        )}
      </div>

      {/* Ahrefs SEO health enrichment — optional, available before/after generate */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Prospect site (Ahrefs)
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={ahrefsDomain}
            onChange={e => setAhrefsDomain(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAhrefsEnrich() }}
            placeholder="e.g. soilsynergy.eu"
            style={{
              flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '5px 9px', fontSize: 12, color: 'var(--text)',
              fontFamily: 'var(--font-mono)', outline: 'none',
            }}
          />
          <button
            onClick={handleAhrefsEnrich}
            disabled={!ahrefsDomain.trim() || ahrefsLoading || websiteLoading}
            style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5,
              background: ahrefsLoading ? 'rgba(14,165,233,0.12)' : 'rgba(14,165,233,0.15)',
              color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.35)',
              cursor: ahrefsDomain.trim() && !ahrefsLoading && !websiteLoading ? 'pointer' : 'not-allowed',
              opacity: !ahrefsDomain.trim() || ahrefsLoading || websiteLoading ? 0.55 : 1,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {ahrefsLoading ? '⏳…' : '⚡ Ahrefs'}
          </button>
          <button
            onClick={handleWebsiteInspect}
            disabled={!ahrefsDomain.trim() || websiteLoading || ahrefsLoading}
            title="Scrape the client's website and use it to personalise the cover letter"
            style={{
              padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5,
              background: websiteLoading ? 'rgba(234,179,8,0.10)' : 'rgba(234,179,8,0.13)',
              color: '#a16207', border: '1px solid rgba(234,179,8,0.40)',
              cursor: ahrefsDomain.trim() && !websiteLoading && !ahrefsLoading ? 'pointer' : 'not-allowed',
              opacity: !ahrefsDomain.trim() || websiteLoading || ahrefsLoading ? 0.55 : 1,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {websiteLoading ? '⏳…' : '🔍 Inspect'}
          </button>
        </div>
        {ahrefsResult && (
          <div style={{ fontSize: 11, color: '#0ea5e9', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
            {ahrefsResult}
          </div>
        )}
        {websiteText && (
          <div style={{ fontSize: 11, color: '#a16207', lineHeight: 1.5, maxHeight: 80, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)' }}>
            {websiteText}
          </div>
        )}
      </div>

      {(!proposal || !hasEnrichment) && !loading && (
        <>
          <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            {hasEnrichment
              ? 'Claude will write a cover letter in your voice — tailored to this job and client.'
              : 'Enrich the job first so the cover letter is built on fresh client data (current spend, hire rate, applicants).'}
          </p>
          <button
            onClick={(e) => { flashLogo(e.currentTarget); fireLogoSplash(e.currentTarget); setTimeout(() => generate(), 480) }}
            disabled={!hasEnrichment}
            title={!hasEnrichment ? 'Enrich the job first — click the orange Enrich button above' : ''}
            className="btn-primary"
            style={{ width: '100%', paddingTop: 5, paddingBottom: 5, fontSize: 12.5, opacity: hasEnrichment ? 1 : 0.5, cursor: hasEnrichment ? 'pointer' : 'not-allowed' }}
          >
            <LogoCanvas />
            {hasEnrichment ? 'Generate Cover Letter' : 'Enrich first'}
          </button>
          {/* Placeholder fills the leftover column height so there's no blank
              void — shows where the generated letter will appear. */}
          <div style={{
            flex: 1, minHeight: 120,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: 20, marginTop: 4,
            border: '1px dashed var(--border2)', borderRadius: 8,
            color: 'var(--text3)', textAlign: 'center',
          }}>
            <div style={{ opacity: 0.4 }}><LogoCanvas /></div>
            <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 260, whiteSpace: 'pre-line' }}>
              {hasEnrichment
                ? 'Your cover letter will appear here.\nDrop a PDF or add an Ahrefs scan above to enrich it.'
                : 'Once enriched, the generated cover letter will appear in this space.'}
            </div>
          </div>
        </>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 0' }}>
          <SpinningLogo />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Writing…</span>
        </div>
      )}

      {proposal && hasEnrichment && (
        // flex: 1 + minHeight: 0 — the proposal block grows to fill whatever
        // vertical space the cover-letter section has, instead of sitting at
        // its natural ~280px height with blank space below. Dragging the
        // chat-resize handle now grows the textarea, not the empty gap.
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
          {/* Saved-state banner */}
          {savedProposal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
                background: (STATUS_COLOR[savedProposal.status] || '#888') + '22',
                color: STATUS_COLOR[savedProposal.status] || '#888',
              }}>{savedProposal.status}</span>
              <span>saved {savedProposal.sent_at ? new Date(savedProposal.sent_at).toLocaleString() : ''}</span>
            </div>
          )}

          <textarea
            value={proposal}
            onChange={e => setProposal(e.target.value)}
            // flex: 1 lets the textarea consume any space the section has
            // beyond the minHeight floor. resize: 'vertical' is preserved
            // so the user can still drag the textarea handle to override.
            style={{ width: '100%', flex: 1, minHeight: 280, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.65, resize: 'vertical', outline: 'none' }}
          />

          {feedback && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{feedback === 'liked' ? '👍 Saved — will use as style example for future cover letters' : '👎 Noted — will avoid this pattern'}</div>}

          {/* Save feedback */}
          {saveMsg && (
            <div style={{
              fontSize: 10, padding: '5px 10px', borderRadius: 3, fontWeight: 600,
              color: saveMsg.kind === 'ok' ? '#00d070' : '#ef4444',
              background: (saveMsg.kind === 'ok' ? '#00d070' : '#ef4444') + '15',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              display: 'inline-block', width: 'fit-content',
            }}>{saveMsg.text}</div>
          )}

          {/* Outcome panel — visible only after first save */}
          {savedProposal && (
            <div style={{ marginTop: 6, padding: 14, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>▸ Outcome</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 50 }}>Status</label>
                <select
                  value={statusValue}
                  onChange={e => setStatusValue(e.target.value)}
                  style={{ flex: 1, background: '#fff', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', color: 'var(--text)', cursor: 'pointer' }}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Client Response (paste here when it arrives)</label>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Paste the client's response here..."
                  style={{ width: '100%', minHeight: 70, background: '#fff', border: '1px solid var(--border2)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea
                  value={notesText}
                  onChange={e => setNotesText(e.target.value)}
                  placeholder="What you'd want to remember about this cover letter / why it did or didn't land..."
                  style={{ width: '100%', minHeight: 50, background: '#fff', border: '1px solid var(--border2)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>
                Click "Update in Outcomes" above to persist status / response / notes changes.
              </div>
            </div>
          )}
        </div>
      )}

      </div>{/* end scrollable content */}

      {/* Action row — pinned OUTSIDE the scroll area as a fixed footer for the
          cover-letter section. Always visible when a proposal exists AND the
          job is currently enriched. We gate on hasEnrichment because the
          textarea above is already hidden in the un-enriched state — leaving
          the action row orphaned (as the user saw on zoom-out) is confusing.
          When the job becomes enriched again, the cached proposal + actions
          reappear together. */}
      {proposal && hasEnrichment && (
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0,
          padding: '10px 20px',
          background: 'var(--bg)',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -6px 12px -6px rgba(0,0,0,0.18)',
        }}>
          <button
            onClick={applyOnUpwork}
            disabled={!proposal.trim()}
            title={proposal.trim()
              ? 'Copy the cover letter to your clipboard and open this job on Upwork — paste with Ctrl+V into the proposal form'
              : 'Generate a cover letter first'}
            className="btn-apply"
            style={{ flex: 1.4, minWidth: 150, paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
          >
            <TargetIcon />
            Apply on Upwork
          </button>
          <button
            onClick={copy}
            className="btn-primary"
            style={{ flex: 1, minWidth: 90, paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5, ...(copied ? { background: '#00d070' } : {}) }}
          >
            {copied ? '✓ Copied!' : '⎘ Copy'}
          </button>
          <button
            onClick={saveToKB}
            disabled={saving || !proposal.trim()}
            className="btn-secondary"
            style={{ flex: 1, minWidth: 130, paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
          >
            {saving ? 'Saving…' : (savedProposal ? '↻ Update in Outcomes' : '✚ Save to Outcomes')}
          </button>
          <button onClick={() => generate(null, { skipOverride: true })} className="btn-ghost" style={{ paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}>
            ↺ Redo
          </button>
          <button
            onClick={() => generate(null, { coreOnly: true })}
            title="Re-pull rules + Core KB entries only, then rewrite the proposal — fast and cheap. Use after adding a new rule or sending an entry to Core."
            className="btn-secondary"
            style={{ minWidth: 140, paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
          >
            ⟳ Rescan & Re-write
          </button>
          <button
            onClick={() => {
              setProposal('')
              setFeedback(null)
              if (job?.id) { delete proposalCacheRef.current[job.id]; _lsRemove('proposalDraft', job.id) }
            }}
            title="Clear cover letter"
            className="btn-ghost"
            style={{ paddingTop: 2, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 10.5 }}
          >
            ✕
          </button>
          <button
            onClick={() => saveProposalFeedback('liked')}
            title="This cover letter was good"
            style={{ padding: '8px 12px', fontSize: 14, borderRadius: 4, border: '1px solid', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              background: feedback === 'liked' ? 'rgba(0,208,112,0.12)' : 'var(--bg2)',
              borderColor: feedback === 'liked' ? '#00d070' : 'var(--border)',
            }}
          >👍</button>
          <button
            onClick={() => saveProposalFeedback('disliked')}
            title="This cover letter missed the mark"
            style={{ padding: '8px 12px', fontSize: 14, borderRadius: 4, border: '1px solid', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
              background: feedback === 'disliked' ? '#ef444420' : 'var(--bg2)',
              borderColor: feedback === 'disliked' ? '#ef4444' : 'var(--border)',
            }}
          >👎</button>
        </div>
      )}

      </div>{/* end cover letter section */}

      {/* Drag handle — resizes the chat section below. Only shown once the
          chat has messages; with an empty chat there's nothing to resize and
          the cover-letter section should own the full height. */}
      {chatHasMessages && (
      <div
        onMouseDown={onResizeStart}
        title="Drag to resize the chat section"
        style={{
          flexShrink: 0,
          height: 6,
          cursor: 'row-resize',
          background: 'var(--bg2)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        <span style={{
          width: 36, height: 2, borderRadius: 1,
          background: 'var(--text3)', opacity: 0.5,
        }} />
      </div>
      )}

      {/* Chat section. With messages: fixed, user-resizable height. Empty: the
          container shrinks to just the input bar (InlineChat's message area is
          empty anyway) so it doesn't leave a tall blank void — the cover-letter
          section above takes the freed space via its flex:1. */}
      <div style={{ ...(chatHasMessages ? { height: chatHeight } : {}), flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <InlineChat
          job={job}
          chatId="proposal"
          extraContext=""
          systemSuffix="You are helping Artem refine the cover letter currently shown in the top textarea. Keep his casual voice, stay grounded in KB facts, and never invent case studies. Apply the KB rules, but refer to them by what they say — never cite a rule number (numbers from memory are hallucinated)."
          onMessagesChange={(msgs) => { chatMessagesRef.current = msgs; setChatHasMessages((msgs || []).length > 0) }}
          onRework={(msgs) => generate(buildAdjustments(msgs))}
          reworkLabel="↺ Rework letter"
          onProposalRewrite={(text) => setProposal(text)}
          currentProposalText={proposal}
          fillHeight={true}
        />
      </div>

      {myRulesConflict && (
        <ConflictModal
          newRuleText={myRulesConflict.newRuleText}
          conflictingRule={myRulesConflict.conflictingRule}
          explanation={myRulesConflict.explanation}
          onKeepNew={resolveMyRulesConflict.keepNew}
          onKeepExisting={resolveMyRulesConflict.keepExisting}
          onSaveBoth={resolveMyRulesConflict.saveBoth}
          onClose={() => setMyRulesConflict(null)}
        />
      )}
    </div>
  )
}
