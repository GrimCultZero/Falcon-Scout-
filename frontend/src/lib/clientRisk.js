// Client-risk and competition rules for the analyser (owner, 2026-11-24). Pure functions, no I/O:
// the analyser prompt states these rules, and applyClientRiskGuards() enforces them in code
// because prompt rules alone get ignored (see the audit-job override in JobDetail.jsx).
//
// 1. UNVERIFIED PAYMENT is not junk by itself. Upwork's own guidance calls it a weak signal: a client
//    who has not added a card is usually just new (1 in 5 postings), and the real cost is that Upwork
//    gives no payment protection until a method is verified. Artem never accepts a contract before the
//    client verifies, so it is a flag, not a deduction. It is treated as junk / likely fraud ONLY when the
//    client is in a high-risk country. The list is the owner's call ("Pakistan, Nigeria, anything generally
//    considered high risk; you name it"). No public source ranks countries by fake Upwork clients (checked
//    2026-11-24), so it rests on our own data (Pakistan 43% and Bangladesh 64% of postings unverified, against
//    about 11% for the US) plus the two countries most often named for advance-fee and impersonation fraud.
//    Deliberately NOT listed: Turkey and Belgium look high but on 9-10 postings, and are ordinary markets.
//    Extend or trim the list here; the prompt and the tests read it from this constant.
// 2. COMPETITION: a client who is already interviewing anyone (even one or two), or a pool of 50+ applicants,
//    caps the score. Our own reply rate at 50+ applicants is about 2%, against about 20% at 20-49.

export const HIGH_RISK_UNVERIFIED_COUNTRIES = ['pakistan', 'nigeria', 'bangladesh', 'ghana']

/** "Pakistan, Nigeria, Bangladesh, Ghana" -- the list as it is written into the analyser prompt. */
export function highRiskCountriesLabel() {
  return HIGH_RISK_UNVERIFIED_COUNTRIES.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ')
}

const _COUNTRY_CODES = { pk: 'pakistan', pak: 'pakistan', ng: 'nigeria', nga: 'nigeria', bd: 'bangladesh', bgd: 'bangladesh', gh: 'ghana', gha: 'ghana' }

function _countryKey(c) {
  const s = String(c == null ? '' : c).trim().toLowerCase()
  return _COUNTRY_CODES[s] || s
}

/** @returns {{unverified: boolean, country: string, highRisk: boolean}}
 *  `unverified` is true ONLY for an explicit false: null/undefined means the client panel was not read. */
export function paymentRisk(job) {
  const unverified = !!job && job.payment_verified === false
  const key = _countryKey(job && job.client_country)
  return { unverified, country: key, highRisk: unverified && HIGH_RISK_UNVERIFIED_COUNTRIES.includes(key) }
}

/** Lower bound of Upwork's applicants band: "Less than 5" -> 0, "5 to 10" -> 5, "20 to 50" -> 20, "50+" -> 50,
 *  a bare number -> itself. Unreadable -> null. */
export function applicantsLowerBound(raw) {
  if (raw == null) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  if (/less than/.test(s)) return 0
  const m = s.match(/\d+/)
  return m ? Number(m[0]) : null
}

/** The competition read for a job: how many are being interviewed, the applicants band, and the score
 *  ceiling they imply (null = no ceiling) with the human reasons behind it. */
export function competitionSignal(job) {
  const interviewing = Number(job && job.interviewing) || 0
  const applicants = applicantsLowerBound(job && job.proposals)
  const reasons = []
  let ceiling = null
  const cap = (n, why) => { ceiling = ceiling == null ? n : Math.min(ceiling, n); reasons.push(why) }

  if (interviewing >= 10) cap(5, `client is already interviewing ${interviewing} candidates, the shortlist is closing`)
  else if (interviewing >= 5) cap(6, `client is already interviewing ${interviewing} candidates, the funnel is heavily shortlisted`)
  else if (interviewing >= 3) cap(7, `client is already interviewing ${interviewing} candidates, the funnel is filling`)
  else if (interviewing >= 1) cap(8, `client is already interviewing ${interviewing} candidate${interviewing === 1 ? '' : 's'}`)

  const crowded = applicants != null && applicants >= 50
  if (crowded) cap(7, 'a crowded pool of 50+ applicants')
  if (crowded && interviewing >= 3) cap(6, '50+ applicants AND an interview shortlist already forming')

  return { interviewing, applicants, crowded, ceiling, reasons }
}

/** The deductions the prompt asks the model to make, as mandatory-flag strings. Deterministic, from the data. */
export function competitionFlags(job) {
  const sig = competitionSignal(job)
  const out = []
  const n = sig.interviewing
  if (n >= 10) out.push(`Client already interviewing ${n} candidates — shortlist is closing, cap verdict at MAYBE, -4 points, score at most 5`)
  else if (n >= 5) out.push(`Client already interviewing ${n} candidates — funnel heavily shortlisted, cap verdict at MAYBE, -3 points, score at most 6`)
  else if (n >= 3) out.push(`Client already interviewing ${n} candidates — funnel is filling, -2 points, score at most 7`)
  else if (n >= 1) out.push(`Client already interviewing ${n} candidate${n === 1 ? '' : 's'} — someone is already ahead of you, -1 point, score at most 8`)
  if (sig.crowded) out.push(`Crowded pool: 50+ applicants — -1 point, score at most 7 (our own reply rate at 50+ is about 2%, against about 20% at 20-49)`)
  if (sig.crowded && n >= 3) out.push('50+ applicants AND an interview shortlist already forming — cap verdict at MAYBE, score at most 6')
  return out
}

/** The payment mandatory flag, or null when payment is verified or unknown. */
export function paymentFlag(job) {
  const r = paymentRisk(job)
  if (!r.unverified) return null
  if (r.highRisk) {
    return `PAYMENT NOT VERIFIED + CLIENT IN A HIGH-RISK COUNTRY (${job.client_country}) — treat as junk / likely fraud: this is HARD DISQUALIFIER 3, score 0, verdict SKIP`
  }
  return 'Payment not verified — most likely a new client who has not added a card yet. NOT a disqualifier and NO point deduction (Artem never accepts a contract before the client verifies; Upwork gives no payment protection until then). Include exactly one flag: "Payment not verified: ask the client to verify before accepting a contract."'
}

/** Enforce the rules above on the model's parsed answer. Returns { parsed, events } where events name each
 *  guard that changed something (fed to the violation telemetry). Never raises a score. */
export function applyClientRiskGuards(parsed, job, { skipCeiling = false } = {}) {
  const events = []
  if (!parsed || typeof parsed !== 'object') return { parsed, events }
  const flags = Array.isArray(parsed.flags) ? [...parsed.flags] : []
  const addFlag = (f) => { if (!flags.includes(f)) flags.push(f) }

  const pay = paymentRisk(job)
  if (pay.highRisk && !(parsed.verdict === 'SKIP' && (Number(parsed.score) || 0) <= 1)) {
    parsed = { ...parsed, verdict: 'SKIP', score: 0 }
    addFlag(`Payment not verified and the client is in ${job.client_country}: treated as junk / likely fraud (hard disqualifier).`)
    events.push('unverified-high-risk-country')
  }

  const sig = competitionSignal(job)
  const score = Number(parsed.score)
  if (!skipCeiling && sig.ceiling != null && Number.isFinite(score) && score > sig.ceiling) {
    const verdict = (sig.ceiling <= 6 && parsed.verdict === 'APPLY') ? 'MAYBE' : parsed.verdict
    parsed = { ...parsed, score: sig.ceiling, verdict }
    addFlag(`Score capped at ${sig.ceiling}/10: ${sig.reasons.join('; ')}.`)
    events.push('competition-ceiling')
  }
  return { parsed: { ...parsed, flags }, events }
}

/** Key points for the top of the analysis: the model's own `key_points` (string or {text, tone}),
 *  cleaned to at most 4 with a tone of good / warn / bad. */
export function cleanKeyPoints(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const k of raw) {
    const text = String(k && typeof k === 'object' ? (k.text ?? '') : (k ?? '')).trim()
    if (!text) continue
    const tone = k && typeof k === 'object' && ['good', 'warn', 'bad'].includes(k.tone) ? k.tone : 'warn'
    out.push({ text: text.length > 140 ? text.slice(0, 139) + '…' : text, tone })
    if (out.length === 4) break
  }
  return out
}
