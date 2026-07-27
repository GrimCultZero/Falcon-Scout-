// ── Deterministic grounding checker (DESIGN.md §21.4, Step 21-B) ────────────
//
// Runs on the generated draft before it reaches the textarea. For each
// DETERMINISTICALLY-CHECKABLE claim class it extracts claims and verifies them
// against an allowed source; untraceable claims are flagged (shadow) or
// stripped/reverted (enforce). It is a CHECKER — pass/fail per span — never an
// LLM rewriter, so it cannot "ignore" rules the way the Haiku enforcer did.
//
// SHIPS SHADOW / RECORD-ONLY FIRST: with { enforce:false } (the default) it
// returns the text UNCHANGED and only reports violation codes for the
// `⚠ Top rule violations` telemetry. Do NOT flip enforce on without checking in
// (owner rule, ANTIFAB_HANDOFF.md §0/§8) — the generator is load-bearing.
//
// Scope discipline (§21.8): deterministic claim-classes ONLY. No semantic judge.
// Metric/attachment checks are scoped to PARAGRAPHS THAT NAME A LEDGER CASE, so
// pattern statements ("most accounts leak 30-40% of budget") are never touched,
// and market checks read ONLY the posting body — the client's account country is
// NOT a licence to name a target market.
//
// Claim classes (maps to the six job-8484 fixture defects, ANTIFAB_HANDOFF.md §9):
//   metricNotInLedger  — fabricated numbers on a named case (defects #1*/#4)
//   caseDuplicated     — a case cited in 2+ blocks (defect #3 / 2026-07-24 dup block)
//   attachmentUnbacked — wrong or duplicated attachment label on a case (defect #5)
//   marketNotInPosting — geo/market not authorised by the posting (2026-07-24 "Israel")
//   seoAuditTurnaround — a non-PPC audit given a day-count turnaround (defect #6)
//   (*#1/#2/#3's ANONYMIZED/relabeled forms are killed by the ledger at 21-C — once the
//    model must emit {{case:id}} it can't write an anonymized fabricated story or relabel
//    a vertical at all. The checker owns the NAMED-case classes.)

import { CASE_LEDGER, CASE_BY_ID } from './caseLedger'

// ── case name matchers (mirror _CASE_META shapes) ──
const _NAME_RES = {
  'nectar-flowers': /\bnectar\s*flowers\b/i,
  'fridgefix': /\bfridgefix\b/i,
  'house-painting': /\bhouse\s+painting\b/i,
  'golden-state-trailers': /\bgolden\s+state\s+trailers\b/i,
  'multilingual-site': /\bmultilingual\s+site\b/i,
  'oxytec': /\boxytec\b/i,
  'luxury-parfums': /\bluxury\s+parfums\b/i,
  'chronocash': /\bchronocash\b/i,
  'atlant': /\batlant\b/i,
  'vape-shop': /\bvape\s*shop\b/i,
  'smash': /\bsmash\b/i,
  'game-x': /\bgame-?x\b/i,
  'gkit': /\bgkit\b/i,
  'casa-eleganza': /\bcasa\s*eleganza\b/i,
  'derma-solution': /\bderma\s*solution\b/i,
  'skin-reboot': /\bskin\s*reboot\b/i,
}
const _casesIn = (s) => Object.keys(_NAME_RES).filter(id => _NAME_RES[id].test(s))

// ── metric extraction ──
// Result-shaped tokens only (percentages, multipliers, money, ROAS, counts+result
// noun). Deliberately EXCLUDES time units (weeks/days/months/hours), so a case
// timeline ("rebuilt in 6 weeks") is never mistaken for a fabricated metric.
const _METRIC_RES = [
  /[+\-−]?\d[\d.,]*\s?%/gi,                                                   // 18%, +693.8%
  /\b\d[\d.,]*\s?[x×](?=\s|$|[.,)])/gi,                                       // 3.4x, 2.4×
  /\$\s?\d[\d.,]*\s?[km]?\b/gi,                                               // $47K, $140
  /\b\d[\d.,]*\s?(?:pmax\s+)?roas\b/gi,                                       // 17.51 ROAS
  /\broas\s+\d[\d.,]*/gi,                                                     // ROAS 17.51
  /\b\d[\d.,]*\+?\s?(?:referring\s+domains?|keywords?|conversions?|clicks|visits?|visitors|sku'?s?|impressions?|users|sessions|leads)\b/gi,
]
// the bare numeric value inside a metric token, e.g. "+693.8% revenue" -> "693.8"
const _numOf = (tok) => (String(tok).match(/\d[\d.,]*/) || [''])[0].replace(/,/g, '').replace(/\.$/, '')
// the set of numeric values approved for a case (from its ledger metrics)
const _caseNumbers = (id) => {
  const c = CASE_BY_ID[id]
  const set = new Set()
  if (!c) return set
  for (const m of c.metrics || []) for (const n of String(m).match(/\d[\d.,]*/g) || []) set.add(n.replace(/,/g, '').replace(/\.$/, ''))
  return set
}

// ── attachment labels ──
const _PDF_LABEL_RE = /\(\s*(?:case\s+study\s+)?attached\s+as\s+a?\s*pdf\s*\)/gi
const _PH_LABEL_RE = /\(\s*attached\s+in\s+(?:the\s+)?profile\s+highlights?\s*\)/gi
const _expectedLabel = (id) => {
  const a = CASE_BY_ID[id] && CASE_BY_ID[id].attachment
  return a === 'pdf' ? 'pdf' : a === 'profile-highlights' ? 'profile-highlights' : 'none'
}

// ── geo / market gazetteer (countries + demonyms + a few codes) ──
const _COUNTRIES = ['united states','usa','america','united kingdom','britain','england','scotland','wales','ireland','canada','australia','new zealand','germany','france','spain','italy','netherlands','belgium','switzerland','austria','sweden','norway','denmark','finland','poland','portugal','greece','czechia','hungary','romania','ukraine','russia','israel','turkey','uae','united arab emirates','saudi arabia','qatar','india','pakistan','china','japan','singapore','malaysia','indonesia','philippines','thailand','vietnam','south korea','south africa','nigeria','kenya','egypt','brazil','mexico','argentina','chile','colombia']
const _DEMONYMS = { american:'usa', british:'united kingdom', english:'england', scottish:'scotland', irish:'ireland', canadian:'canada', australian:'australia', 'new zealand':'new zealand', kiwi:'new zealand', german:'germany', french:'france', spanish:'spain', italian:'italy', dutch:'netherlands', belgian:'belgium', swiss:'switzerland', austrian:'austria', swedish:'sweden', norwegian:'norway', danish:'denmark', finnish:'finland', polish:'poland', portuguese:'portugal', greek:'greece', ukrainian:'ukraine', russian:'russia', israeli:'israel', turkish:'turkey', emirati:'uae', indian:'india', pakistani:'pakistan', chinese:'china', japanese:'japan', singaporean:'singapore', malaysian:'malaysia', indonesian:'indonesia', filipino:'philippines', thai:'thailand', vietnamese:'vietnam', korean:'south korea', brazilian:'brazil', mexican:'mexico', argentine:'argentina', chilean:'chile', colombian:'colombia' }
const _CODES = { il:'israel', uk:'united kingdom', us:'usa', usa:'usa', uae:'uae', nz:'new zealand', de:'germany', fr:'france', es:'spain', it:'italy', nl:'netherlands', dk:'denmark', se:'sweden', ca:'canada', au:'australia' }
const _gazetteerHit = (raw) => {
  const t = String(raw).trim().toLowerCase().replace(/[.]/g, '')
  if (_COUNTRIES.includes(t)) return t
  if (_DEMONYMS[t]) return _DEMONYMS[t]
  return null
}

function _uniq(arr) { return [...new Set(arr)] }

// Main entry. `enforce:false` (default) = SHADOW: returns text unchanged, only reports.
export function groundingCheck(text, { postingText = '', enforce = false } = {}) {
  const violations = []
  if (!text || typeof text !== 'string') return { text: text || '', violations: [] }
  let out = text
  const record = (code) => violations.push(code)
  const posting = String(postingText || '').toLowerCase()
  const paras = out.split(/\n{2,}/)

  // ── caseDuplicated: a case named in 2+ separate paragraphs ──
  const paraCases = paras.map(p => _casesIn(p))
  const counts = {}
  paraCases.forEach(ids => _uniq(ids).forEach(id => { counts[id] = (counts[id] || 0) + 1 }))
  for (const id of Object.keys(counts)) if (counts[id] > 1) record('caseDuplicated')

  // ── metricNotInLedger + attachmentUnbacked: scoped to case paragraphs ──
  const newParas = paras.map((para, pi) => {
    const ids = paraCases[pi]
    if (!ids.length) return para
    let p = para

    // metrics must trace (by number) to one of the cases named in this paragraph
    const allowed = new Set()
    ids.forEach(id => _caseNumbers(id).forEach(n => allowed.add(n)))
    for (const re of _METRIC_RES) {
      p = p.replace(re, (tok) => {
        const n = _numOf(tok)
        if (!n) return tok
        if (allowed.has(n)) return tok
        record('metricNotInLedger')
        return enforce ? '' : tok   // shadow: keep; enforce: strip the number token
      })
    }

    // attachment label must match the (single) cited case's ledger attachment,
    // and must appear at most once.
    if (ids.length === 1) {
      const want = _expectedLabel(ids[0])
      const pdfN = (p.match(_PDF_LABEL_RE) || []).length
      const phN = (p.match(_PH_LABEL_RE) || []).length
      if (pdfN + phN > 1) { record('attachmentUnbacked') /* duplicate label */ }
      if (want === 'pdf' && phN > 0) record('attachmentUnbacked')          // should be PDF, labelled highlights
      if (want === 'profile-highlights' && pdfN > 0) record('attachmentUnbacked') // vice-versa
      if (want === 'none' && (pdfN + phN) > 0) record('attachmentUnbacked')
      if (enforce && (pdfN + phN) > 0) {
        // collapse to exactly one correct label
        p = p.replace(_PDF_LABEL_RE, '').replace(_PH_LABEL_RE, '')
        const label = want === 'pdf' ? ' (attached as PDF)' : want === 'profile-highlights' ? ' (attached in profile highlights)' : ''
        if (label) p = p.replace(_NAME_RES[ids[0]], (m) => `${m}${label}`)
      }
    }
    return p
  })
  if (enforce) out = newParas.join('\n\n')

  // ── marketNotInPosting: a geo/market claim not authorised by the posting body ──
  // (a) "launch/expand/target/scale/roll out/enter/go live ... in|to|for <Place>"
  const _VERB = '(?:launch(?:ing)?|expand(?:ing)?|target(?:ing)?|scal(?:e|ing)|roll(?:ing)?\\s+out|enter(?:ing)?|go(?:ing)?\\s+live|breaking\\s+into|entering)'
  const marketRe = new RegExp(`\\b${_VERB}\\b[^.\\n]{0,24}?\\b(?:in|into|to|for|across)\\s+(?:the\\s+)?([A-Za-z][A-Za-z.\\- ]{1,26}?)(?=[\\s.,;:)\\n]|$)`, 'gi')
  out = out.replace(marketRe, (full, place) => {
    const canon = _gazetteerHit(place.split(/\s+(?:market|region|audience|customers?|keywords?|shoppers?)\b/i)[0])
    if (!canon) return full
    if (posting.includes(canon) || posting.includes(place.trim().toLowerCase())) return full  // authorised
    record('marketNotInPosting')
    return enforce ? full.replace(new RegExp('\\b' + place.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'), '[market]') : full
  })
  // (b) "<demonym> (market|keywords|brand|audience|customers|shoppers|targeting)"
  const demonymRe = new RegExp(`\\b(${Object.keys(_DEMONYMS).join('|')})\\s+(?:market|keywords?|brand|audience|customers?|shoppers?|targeting|consumers?|buyers?)\\b`, 'gi')
  out.replace(demonymRe, (full, dem) => {
    const canon = _DEMONYMS[dem.toLowerCase()]
    if (canon && !posting.includes(canon) && !posting.includes(dem.toLowerCase())) record('marketNotInPosting')
    return full
  })
  // (c) "<CC> targeting/market/keywords/ads" e.g. "IL targeting"
  const codeRe = new RegExp(`\\b(${Object.keys(_CODES).join('|').toUpperCase()})\\s+(?:targeting|market|keywords?|ads?|campaigns?)\\b`, 'g')
  out.replace(codeRe, (full, cc) => {
    const canon = _CODES[cc.toLowerCase()]
    if (canon && !posting.includes(canon) && !posting.includes(cc.toLowerCase())) record('marketNotInPosting')
    return full
  })

  // ── seoAuditTurnaround: a non-PPC audit given a day-count turnaround (defect #6) ──
  // The GOOGLE ADS / PPC / paid audit's 1-working-day turnaround IS required (Rule 402),
  // so only flag when the audit is technical/SEO/store/comprehensive (not ads/ppc/paid).
  const _turn = /\b(?:full|technical|comprehensive|site|store|website|content|seo|shopify|wordpress)\s+(?:seo\s+)?audit\b[^.\n]{0,40}?\b(?:in|within|delivered\s+(?:in|within)?)\s+\d+(?:\s*[-–]\s*\d+)?\s*(?:working\s+|business\s+)?days?\b/i
  const _turnLabel = /\btimeline\s*:\s*\n?\s*full\s+audit\b[^.\n]{0,40}?\b\d+\s*(?:working\s+|business\s+)?days?\b/i
  if ((_turn.test(out) || _turnLabel.test(out)) && !/\b(google\s*ads?|adwords|ppc|paid[-\s]?(?:media|search|ads?))\b[^.\n]{0,20}\baudit\b/i.test(out)) {
    record('seoAuditTurnaround')  // removal handled by the existing _stripSeoAuditTurnaround in the pile
  }

  return { text: enforce ? out : text, violations: _uniq(violations) }
}
