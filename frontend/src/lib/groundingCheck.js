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

// Decimal-safe sentence-boundary finder: a .!? is a sentence end only when
// followed by whitespace + an uppercase letter, or end of string — so
// "693.8%" never splits mid-number (the char after "693." is "8", not
// uppercase). Returns the start offset of every sentence.
function _sentenceStarts(text) {
  const starts = [0]
  const re = /[.!?](?=\s+[A-Z]|\s*$)/g
  let m
  while ((m = re.exec(text))) {
    let end = m.index + 1
    while (end < text.length && /\s/.test(text[end])) end++
    if (end > starts[starts.length - 1]) starts.push(end)
  }
  return starts
}

// Remove the whole sentence(s) enclosing each [start,end) span. Bare-deleting
// a fabricated number/place leaves a glaringly broken fragment ("Started at
// cost per lead," / "launch campaigns in [market]") — an obvious
// auto-generation artifact, arguably worse than the claim it replaced. A
// missing sentence reads naturally; a mid-sentence gap or bracket does not.
// (Confirmed necessary before ever flipping enforce on: testing the previous
// bare-token-deletion approach against a real fabrication produced exactly
// that kind of visibly broken output.)
function _removeEnclosingSentences(text, spans) {
  if (!spans.length) return text
  const starts = _sentenceStarts(text)
  const boundsFor = (pos) => {
    let idx = 0
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= pos) idx = i
      else break
    }
    const s = starts[idx]
    const e = idx + 1 < starts.length ? starts[idx + 1] : text.length
    return [s, e]
  }
  let ranges = spans.map(([s]) => boundsFor(s))
  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1])
    } else merged.push([...r])
  }
  let out = ''
  let cursor = 0
  for (const [s, e] of merged) {
    out += text.slice(cursor, s)
    cursor = e
  }
  out += text.slice(cursor)
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n[ \t]+/g, '\n').trim()
}

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

  // ── tooManyCaseStudies: many DIFFERENT cases crammed into one letter ──
  // caseDuplicated (above) catches the SAME case cited twice; this catches
  // the opposite failure — a screening-question-heavy job pulling in one
  // fresh case per question until the letter reads as a portfolio dump
  // instead of 1-2 sharp proof points (confirmed real on job 12185: five
  // distinct cases — Derma Solution, Vape Shop, Skin Reboot, ChronoCash,
  // Atlant — stacked into a single sent letter, one per screening
  // question). Design target elsewhere in this codebase (the
  // localServiceCaseDisplacedByEcomHealth enforcer instruction) is explicit:
  // "at most 2 case studies for this job." Shadow-only, like caseDuplicated
  // — deciding WHICH case(s) to cut needs vertical-relevance judgment a
  // regex can't safely make; blindly stripping could remove the one case
  // that's actually on-point for this job.
  const _allCasesInLetter = _uniq(paraCases.flat())
  if (_allCasesInLetter.length > 2) record('tooManyCaseStudies')

  // ── metricNotInLedger + attachmentUnbacked: scoped to case paragraphs ──
  const newParas = paras.map((para, pi) => {
    const ids = paraCases[pi]
    if (!ids.length) return para
    let p = para

    // metrics must trace (by number) to one of the cases named in this paragraph
    const allowed = new Set()
    ids.forEach(id => _caseNumbers(id).forEach(n => allowed.add(n)))
    const badSpans = []
    for (const re of _METRIC_RES) {
      const re2 = new RegExp(re.source, re.flags)
      let m
      while ((m = re2.exec(p))) {
        const n = _numOf(m[0])
        if (n && !allowed.has(n)) {
          record('metricNotInLedger')
          badSpans.push([m.index, m.index + m[0].length])
        }
      }
    }
    if (enforce && badSpans.length) {
      // Remove the whole sentence(s) carrying the fabricated number(s) rather
      // than just the number token — see _removeEnclosingSentences above.
      p = _removeEnclosingSentences(p, badSpans)
    }

    // attachment label must match the (single) cited case's ledger attachment,
    // and must appear at most once.
    if (ids.length === 1) {
      const want = _expectedLabel(ids[0])
      const pdfN = (p.match(_PDF_LABEL_RE) || []).length
      const phN = (p.match(_PH_LABEL_RE) || []).length
      // Track whether a REAL violation fired — the enforce branch below must
      // only touch paragraphs that are actually wrong. It used to gate on
      // "a label exists at all" (pdfN + phN > 0), which is true for nearly
      // every case paragraph, so it silently rewrote every letter's labels
      // even on fully correct ones — caught before ever flipping enforce on
      // in production by testing a clean, zero-violation letter and finding
      // the "text unchanged" check failed anyway.
      let attachBad = false
      if (pdfN + phN > 1) { record('attachmentUnbacked'); attachBad = true } /* duplicate label */
      if (want === 'pdf' && phN > 0) { record('attachmentUnbacked'); attachBad = true }          // should be PDF, labelled highlights
      if (want === 'profile-highlights' && pdfN > 0) { record('attachmentUnbacked'); attachBad = true } // vice-versa
      if (want === 'none' && (pdfN + phN) > 0) { record('attachmentUnbacked'); attachBad = true }
      // Guard against the sentence-removal above having deleted the case
      // name itself (e.g. the fabrication WAS the case's only sentence) —
      // don't try to re-insert a label onto a name that's no longer there.
      if (enforce && attachBad && _NAME_RES[ids[0]].test(p)) {
        // Collapse to exactly one correct label. Strip WITH the leading
        // whitespace (the space originally between the case name and the
        // label) — stripping only the "(...)" part left a stray space
        // behind ("Name (label) : text" instead of "Name (label): text")
        // once the fresh label was re-inserted after the name.
        p = p.replace(new RegExp('\\s*' + _PDF_LABEL_RE.source, 'gi'), '')
              .replace(new RegExp('\\s*' + _PH_LABEL_RE.source, 'gi'), '')
        const label = want === 'pdf' ? ' (attached as PDF)' : want === 'profile-highlights' ? ' (attached in profile highlights)' : ''
        if (label) p = p.replace(_NAME_RES[ids[0]], (m) => `${m}${label}`)
      }
    }
    return p
  })
  // Drop any paragraph that sentence-removal emptied out entirely (the
  // fabrication was that case's only sentence) rather than leaving an
  // orphan blank paragraph in the joined letter.
  if (enforce) out = newParas.filter(p => p && p.trim()).join('\n\n')

  // ── marketNotInPosting: a geo/market claim not authorised by the posting body ──
  // Collected first (not mutated in-place) so enforcement can remove the
  // whole enclosing sentence via the same helper as the metric check, instead
  // of leaving a visible "[market]" placeholder bracket in a sent letter.
  const marketSpans = []
  // (a) "launch/expand/target/scale/roll out/enter/go live ... in|to|for <Place>"
  const _VERB = '(?:launch(?:ing)?|expand(?:ing)?|target(?:ing)?|scal(?:e|ing)|roll(?:ing)?\\s+out|enter(?:ing)?|go(?:ing)?\\s+live|breaking\\s+into|entering)'
  const marketRe = new RegExp(`\\b${_VERB}\\b[^.\\n]{0,24}?\\b(?:in|into|to|for|across)\\s+(?:the\\s+)?([A-Za-z][A-Za-z.\\- ]{1,26}?)(?=[\\s.,;:)\\n]|$)`, 'gi')
  let mm
  while ((mm = marketRe.exec(out))) {
    const place = mm[1]
    const canon = _gazetteerHit(place.split(/\s+(?:market|region|audience|customers?|keywords?|shoppers?)\b/i)[0])
    if (!canon) continue
    if (posting.includes(canon) || posting.includes(place.trim().toLowerCase())) continue  // authorised
    record('marketNotInPosting')
    marketSpans.push([mm.index, mm.index + mm[0].length])
  }
  // (b) "<demonym> (market|keywords|brand|audience|customers|shoppers|targeting)"
  const demonymRe = new RegExp(`\\b(${Object.keys(_DEMONYMS).join('|')})\\s+(?:market|keywords?|brand|audience|customers?|shoppers?|targeting|consumers?|buyers?)\\b`, 'gi')
  while ((mm = demonymRe.exec(out))) {
    const canon = _DEMONYMS[mm[1].toLowerCase()]
    if (canon && !posting.includes(canon) && !posting.includes(mm[1].toLowerCase())) {
      record('marketNotInPosting')
      marketSpans.push([mm.index, mm.index + mm[0].length])
    }
  }
  // (c) "<CC> targeting/market/keywords/ads" e.g. "IL targeting"
  const codeRe = new RegExp(`\\b(${Object.keys(_CODES).join('|').toUpperCase()})\\s+(?:targeting|market|keywords?|ads?|campaigns?)\\b`, 'g')
  while ((mm = codeRe.exec(out))) {
    const canon = _CODES[mm[1].toLowerCase()]
    if (canon && !posting.includes(canon) && !posting.includes(mm[1].toLowerCase())) {
      record('marketNotInPosting')
      marketSpans.push([mm.index, mm.index + mm[0].length])
    }
  }
  if (enforce && marketSpans.length) out = _removeEnclosingSentences(out, marketSpans)

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
