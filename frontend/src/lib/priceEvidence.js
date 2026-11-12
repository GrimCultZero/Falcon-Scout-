// Test-week money rules for the ANALYSER (owner decision 2026-11-12, during the feed's
// test week 2026-11-10 .. 2026-11-17; see feed_config.json "test_week").
//
// The feed now lets through postings with a low or missing rate and with unverified
// payment, because Artem sends proposals to them anyway. The analyser used to undo that:
// "ceiling under $15/hr" and "unverified payment with under 5 reviews" were hard
// disqualifiers (score 0), so 13 of the first 15 test-tagged jobs came out SKIP. During
// the test week the analyser judges the job (scope fit, client quality, competition) and
// treats money as evidence with a weight:
//
//   * a rate that is not stated (empty, zero, or a $5 / $10 placeholder) is NEUTRAL: it
//     may well match what Artem wants, it is simply not written down;
//   * the client's average hourly rate counts only when real history stands behind it
//     ($5,000+ spent, payment verified); "$15/hr on $315 spent" is noise;
//   * an established client who pays far below the floor (average under $15/hr) is a
//     DRAMATIC downgrade even when payment is verified: SKIP, score 2-3 (a fit-band
//     SKIP, never 0-1);
//   * unverified payment is not a disqualifier: scored on fit, verdict capped at MAYBE;
//   * scores 0-1 stay for the real disqualifiers only (verified US-only, already hired).
//
// The letter generator is NOT touched and does not read this (it never sees the analysis:
// GET /jobs/{id}/analysis has no route, see WORKLOG). Pure functions, no React.

export const PLACEHOLDER_FIXED_MAX = 10      // a fixed budget of $1..$10 is Upwork's minimum, not an offer
export const STRONG_HISTORY_SPENT = 5000     // dollars spent before a client's average rate is evidence
export const CHEAP_PAYER_AVG = 15            // $/hr: below this, with strong history, is the dramatic case
export const UNVERIFIED_MAX_SCORE = 6        // unverified payment: at most MAYBE

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Is the owner's test week on? Same rule as api/upwork_api.py test_week_active():
 *  inclusive Europe/Kyiv dates; a missing or malformed block means NO (the old rules). */
export function testWeekActive(cfg, now = Date.now()) {
  const tw = cfg && cfg.test_week
  if (!tw || typeof tw !== 'object' || !tw.until) return false
  if (!YMD.test(String(tw.until)) || (tw.from && !YMD.test(String(tw.from)))) return false
  let today = null
  for (const zone of ['Europe/Kyiv', 'Europe/Kiev']) {
    try {
      today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
      break
    } catch { /* try the older zone name */ }
  }
  if (!today) today = new Date(now).toISOString().slice(0, 10)
  return (!tw.from || today >= String(tw.from)) && today <= String(tw.until)
}

/** "$231K total spent" -> 231000; "$315 total spent" -> 315; unknown -> null. */
export function parseSpent(detail) {
  const m = String(detail || '').match(/\$\s*([\d,]*\.?\d+)\s*([kKmM])?/)
  if (!m) return null
  let n = parseFloat(m[1].replace(/,/g, ''))
  if (!isFinite(n)) return null
  if (m[2]) n *= /k/i.test(m[2]) ? 1e3 : 1e6
  return n
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return isFinite(n) ? n : null
}

/**
 * What does this job say about price, and how much is it worth?
 * @param {object} job   a feed row
 * @param {number} floor Artem's applicable hourly floor for this job (30, or 40 for web-dev)
 */
export function priceEvidence(job, floor = 30) {
  const j = job || {}
  const hmin = num(j.hourly_rate_min)
  const hmax = num(j.hourly_rate_max)
  const hourlyPresent = j.hourly_rate_min != null || j.hourly_rate_max != null
  const ceiling = hmax > 0 ? hmax : (hmin > 0 ? hmin : null)
  const fixedRaw = j.fixed_budget != null && String(j.fixed_budget).trim() !== ''
  const fixed = fixedRaw ? num(j.fixed_budget) : null

  let state, kind, why
  if (ceiling) { state = 'stated'; kind = 'hourly'; why = `hourly ceiling $${ceiling}/hr` }
  else if (hourlyPresent) { state = 'unstated'; kind = 'none'; why = 'the hourly rate is zero' }
  else if (fixed > PLACEHOLDER_FIXED_MAX) { state = 'stated'; kind = 'fixed'; why = `fixed budget $${fixed}` }
  else if (fixed > 0) { state = 'unstated'; kind = 'none'; why = `the fixed budget shows $${fixed}, Upwork's minimum placeholder, not an offer` }
  else if (fixedRaw) { state = 'unstated'; kind = 'none'; why = 'the fixed budget is zero' }
  else { state = 'unstated'; kind = 'none'; why = 'the posting states no rate' }

  const avg = num(j.avg_rate) || num(j.client_avg_hourly_rate) || 0
  const spent = parseSpent(j.client_total_spent_detail)
  const verified = j.payment_verified === true
  const strongHistory = avg > 0 && spent != null && spent >= STRONG_HISTORY_SPENT && verified
  // A rate the posting commits to that already clears the floor is a stronger signal than
  // history (the owner's 2026-08-28 rule): never the dramatic case.
  const postedClears = state === 'stated' && kind === 'hourly' && ceiling >= floor
  // Stated fixed price: the average hourly rate is a weak signal (existing FLAT-RATE EXCEPTION).
  const cheapPayer = strongHistory && avg < CHEAP_PAYER_AVG && !postedClears && kind !== 'fixed'
  const weakAvg = avg > 0 && avg < floor && !strongHistory && !postedClears

  return {
    state, kind, why, ceiling, fixed, avg, spent, floor,
    strongHistory, cheapPayer, weakAvg, postedClears,
    paymentUnverified: j.payment_verified === false,
    statedLow: state === 'stated' && kind === 'hourly' && ceiling < floor,
  }
}

const money = (n) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`)

/** Replacement "Rate:" line for an UNSTATED rate (null when the rate is stated: keep the old line). */
export function testWeekRateLine(ev) {
  if (!ev || ev.state !== 'unstated') return null
  return `Rate: NOT STATED (${ev.why}). Treat this as unknown, NOT as low and NOT as zero: a posting that omits its rate may well match what Artem charges. Do NOT invent a rate, currency or rate type, do NOT compute an effective hourly rate from a placeholder, and do NOT deduct points for the omission.`
}

/** Extra MANDATORY FLAGS for the test week (strings, same style as the existing ones). */
export function testWeekFlags(ev) {
  const out = []
  if (!ev) return out
  if (ev.cheapPayer) {
    out.push(`CHEAP PAYER, DRAMATIC DOWNGRADE (test-week rule): this client has paid an average of $${ev.avg}/hr across ${money(ev.spent)} spent, with payment verified. That is established evidence they pay far below Artem's $${ev.floor}/hr floor, and ${ev.state === 'unstated' ? 'the posting states no rate that could outweigh it' : `the posting offers only $${ev.ceiling}/hr`}. Verified payment does NOT rescue this. Verdict SKIP, score 2-3 (a fit-band SKIP, NOT 0-1). Quote both numbers in one flag: "Client avg $${ev.avg}/hr over ${money(ev.spent)} spent".`)
  } else if (ev.weakAvg) {
    out.push(`Client avg $${ev.avg}/hr rests on only ${ev.spent == null ? 'an unknown amount' : money(ev.spent)} spent: too little history to count as evidence. Informational only: NO deduction and NO verdict cap on this account.`)
  }
  if (ev.state === 'unstated' && !ev.cheapPayer) {
    out.push(`Rate NOT STATED (${ev.why}): neutral, may match Artem's price. One informational flag at most; no deduction, no "rate-floor risk", no "cannot assess" as a negative.`)
  }
  if (ev.paymentUnverified) {
    out.push('Payment NOT verified (test-week rule): NOT a disqualifier. Score the job on fit and client quality; the verdict is capped at MAYBE (score at most 6). One flag.')
  }
  return out
}

/** Appended LAST in the analyser's system prompt so it supersedes everything above it,
 *  including the KB's "CRITICAL RULES" section. */
export function testWeekPromptBlock(until) {
  return `

TEST-WEEK MONEY RULES (owner decision 2026-11-12, active until ${until || 'the end of the test week'}; these SUPERSEDE every statement above about rate and payment, including HARD DISQUALIFIERS 2 and 3, the effective-hourly "HARD SKIP" examples and any rule under CRITICAL RULES):
Artem sends proposals to low-rate, no-rate and unverified-payment postings anyway. Your verdict is about the QUALITY of the job, not about whether the money clears a floor.
- Score first on scope fit, client quality and competition. Money is weighed after that, as evidence.
- Hard disqualifiers are now ONLY: a verified US-only restriction and an already-hired count of 1 or more. Scores 0-1 are reserved for those two. NEVER score 0-1 because of a low rate, a low fixed budget, a missing rate, a low effective hourly or unverified payment.
- A rate ceiling below $15/hr, or a computed effective hourly below $15/hr, is a soft flag and at most -2 points, not a skip.
- A rate that is NOT STATED (empty, zero, or a $5/$10 placeholder) is NEUTRAL. Do not penalise it and do not write it up as a risk.
- The client's average hourly rate is evidence only when the MANDATORY FLAGS say real history stands behind it. A low average on a few hundred dollars of spend is noise.
- An established, verified client with a very low average (the MANDATORY FLAGS will say so) is a DRAMATIC downgrade: SKIP, score 2-3.
- Unverified payment is not a disqualifier: score on fit, verdict at most MAYBE.
- Follow the MANDATORY FLAGS above verbatim; they were computed from the data.`
}

/**
 * Deterministic backstop applied to the model's answer (prompt instructions get ignored).
 * @param {object} parsed  the model's JSON ({verdict, score, summary, reasons, flags})
 * @param {object} ev      priceEvidence(job)
 * @param {{realDisq?: boolean, until?: string}} opts
 *        realDisq: a REAL hard disqualifier exists (verified US-only, already hired)
 * @returns {{parsed: object, events: string[]}}  parsed is a copy; events name each correction
 */
export function testWeekGuard(parsed, ev, opts = {}) {
  const p = { ...parsed, flags: Array.isArray(parsed && parsed.flags) ? [...parsed.flags] : [] }
  const events = []
  const raw = Number(p.score)
  let score = isFinite(raw) ? raw : null
  const realDisq = !!opts.realDisq
  const verdictFor = (s) => (s >= 7 ? 'APPLY' : s >= 5 ? 'MAYBE' : 'SKIP')

  if (score !== null && !realDisq) {
    if (ev && ev.cheapPayer) {
      if (score > 3) { score = 3; events.push('cheapPayerCap') }
      else if (score < 2) { score = 2; events.push('cheapPayerFloor') }
      p.verdict = 'SKIP'
    } else {
      if (score <= 1) {
        score = 3
        p.verdict = 'SKIP'
        events.push('moneyZeroFloored')
        p.flags.push('The analyser scored this 0-1 on money grounds, which the test-week rules forbid. Fit was NOT assessed: press Re-analyse.')
      }
      if (ev && ev.paymentUnverified && score > UNVERIFIED_MAX_SCORE) {
        score = UNVERIFIED_MAX_SCORE
        p.verdict = verdictFor(score)
        events.push('unverifiedCap')
      }
    }
    p.score = score
  }
  p.rules = 'testweek'
  p.flags.push(`Analysed under the test-week money rules (relaxed until ${opts.until || 'the end of the test week'}).`)
  return { parsed: p, events }
}
