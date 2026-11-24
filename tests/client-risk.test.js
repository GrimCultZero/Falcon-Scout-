// Client-risk rules for the analyser (owner, 2026-11-24). See frontend/src/lib/clientRisk.js.
//   1. Unverified payment is NOT junk by itself; only a high-risk country (Pakistan, Nigeria) makes it a hard SKIP.
//   2. An 8/10 on a client already interviewing 3 people is too generous: ceilings on the score.
//   3. A crowded pool (50+ applicants) is penalised; below 50 is not.
//   4. "key_points": the few things that decide the verdict, cleaned to <= 4 with a tone.
// Then wiring checks against JobDetail.jsx so the rules cannot be silently bypassed.
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib', 'clientRisk.js')
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }

;(async () => {
  const m = await import(pathToFileURL(LIB).href)
  const { HIGH_RISK_UNVERIFIED_COUNTRIES, highRiskCountriesLabel, paymentRisk, applicantsLowerBound, competitionSignal, competitionFlags, paymentFlag, applyClientRiskGuards, cleanKeyPoints } = m

  // ── payment ────────────────────────────────────────────────────────────────
  assert(!paymentRisk({ payment_verified: true, client_country: 'Pakistan' }).highRisk, 'verified payment from Pakistan is not high-risk')
  assert(!paymentRisk({ payment_verified: null, client_country: 'Pakistan' }).unverified, 'unknown payment (panel not read) is not "unverified"')
  assert(paymentRisk({ payment_verified: false, client_country: 'Pakistan' }).highRisk, 'unverified + Pakistan is high-risk')
  assert(paymentRisk({ payment_verified: false, client_country: 'Nigeria' }).highRisk, 'unverified + Nigeria is high-risk')
  assert(paymentRisk({ payment_verified: false, client_country: 'Bangladesh' }).highRisk, 'unverified + Bangladesh is high-risk (64% of its postings are unverified in our data)')
  assert(paymentRisk({ payment_verified: false, client_country: 'Ghana' }).highRisk, 'unverified + Ghana is high-risk')
  assert(!paymentRisk({ payment_verified: true, client_country: 'Bangladesh' }).highRisk, 'verified + Bangladesh is NOT high-risk')
  assert(highRiskCountriesLabel() === 'Pakistan, Nigeria, Bangladesh, Ghana', 'the prompt label is built from the list')
  assert(HIGH_RISK_UNVERIFIED_COUNTRIES.every(c => c === c.toLowerCase()), 'the list is stored lower-case')
  assert(paymentRisk({ payment_verified: false, client_country: 'PAK' }).highRisk, 'a legacy 3-letter code (PAK) is recognised')
  assert(paymentRisk({ payment_verified: false, client_country: ' pakistan ' }).highRisk, 'case and whitespace do not matter')
  for (const c of ['Germany', 'United States', 'United Kingdom', 'Australia', 'Canada', 'Turkey', 'Belgium', null, '']) {
    assert(!paymentRisk({ payment_verified: false, client_country: c }).highRisk, `unverified + ${JSON.stringify(c)} is NOT high-risk (owner: "if it is Germany he maybe just did not bother")`)
  }
  assert(paymentFlag({ payment_verified: true, client_country: 'Pakistan' }) === null, 'no payment flag when verified')
  assert(paymentFlag({ payment_verified: null }) === null, 'no payment flag when unknown')
  assert(/NOT a disqualifier and NO point deduction/.test(paymentFlag({ payment_verified: false, client_country: 'Germany' })), 'unverified Germany: neutral flag, no deduction')
  assert(/HARD DISQUALIFIER 3, score 0, verdict SKIP/.test(paymentFlag({ payment_verified: false, client_country: 'Pakistan' })), 'unverified Pakistan: hard disqualifier flag')

  // ── applicants band parsing (the real values Upwork stores) ────────────────
  assert(applicantsLowerBound('Less than 5') === 0, '"Less than 5" -> 0')
  assert(applicantsLowerBound('5 to 10') === 5 && applicantsLowerBound('20 to 50') === 20, 'bands use their lower bound')
  assert(applicantsLowerBound('50+') === 50, '"50+" -> 50')
  assert(applicantsLowerBound('16') === 16 && applicantsLowerBound(7) === 7, 'a bare number is itself')
  assert(applicantsLowerBound(null) === null && applicantsLowerBound('') === null && applicantsLowerBound('n/a') === null, 'unreadable -> null')

  // ── competition ceilings ───────────────────────────────────────────────────
  const sig = (j) => competitionSignal(j).ceiling
  assert(sig({ interviewing: 0, proposals: '5 to 10' }) === null, 'nothing interviewing, small pool: no ceiling')
  assert(sig({ interviewing: 1, proposals: '5 to 10' }) === 8, '1 interviewing: score at most 8 (a point off)')
  assert(sig({ interviewing: 2, proposals: '10 to 15' }) === 8, '2 interviewing: score at most 8')
  assert(sig({ interviewing: 3, proposals: '5 to 10' }) === 7, '3 interviewing: score at most 7 (the reported 8/10 case)')
  assert(sig({ interviewing: 4 }) === 7, '4 interviewing: at most 7')
  assert(sig({ interviewing: 5 }) === 6, '5 interviewing: at most 6')
  assert(sig({ interviewing: 9 }) === 6, '9 interviewing: at most 6')
  assert(sig({ interviewing: 10 }) === 5, '10 interviewing: at most 5')
  assert(sig({ interviewing: 0, proposals: '20 to 50' }) === null, '20-50 applicants: NOT penalised')
  assert(sig({ interviewing: 0, proposals: '50+' }) === 7, '50+ applicants: at most 7')
  assert(sig({ interviewing: 3, proposals: '50+' }) === 6, '50+ applicants AND 3 interviewing: at most 6')
  assert(sig({ interviewing: 10, proposals: '50+' }) === 5, 'the lowest ceiling wins')
  assert(competitionFlags({ interviewing: 3 }).some(f => /-2 points, score at most 7/.test(f)), '3 interviewing: flag states -2 and the ceiling')
  assert(competitionFlags({ interviewing: 1 }).length === 1 && /-1 point, score at most 8/.test(competitionFlags({ interviewing: 1 })[0]), '1 interviewing: a flag that states -1 and the ceiling')
  assert(competitionFlags({ interviewing: 0, proposals: '5 to 10' }).length === 0, 'no signal, no flags')

  // ── the guard: enforce in code ─────────────────────────────────────────────
  const base = { verdict: 'APPLY', score: 8, summary: 's', reasons: ['r'], flags: [] }
  let r = applyClientRiskGuards(base, { interviewing: 3, proposals: '5 to 10', payment_verified: true })
  assert(r.parsed.score === 7 && r.parsed.verdict === 'APPLY', '8/10 with 3 interviewing -> 7/10, still APPLY')
  assert(r.parsed.flags.some(f => /Score capped at 7/.test(f)) && r.events.includes('competition-ceiling'), '...with a visible flag and a telemetry event')
  r = applyClientRiskGuards(base, { interviewing: 5, payment_verified: true })
  assert(r.parsed.score === 6 && r.parsed.verdict === 'MAYBE', '8/10 with 5 interviewing -> 6/10 and MAYBE, never APPLY')
  r = applyClientRiskGuards({ ...base, score: 9 }, { interviewing: 12, payment_verified: true })
  assert(r.parsed.score === 5 && r.parsed.verdict === 'MAYBE', '9/10 with 12 interviewing -> 5/10 MAYBE')
  r = applyClientRiskGuards({ ...base, score: 10 }, { interviewing: 1, payment_verified: true })
  assert(r.parsed.score === 8 && r.parsed.verdict === 'APPLY', '10/10 with someone already interviewing -> 8/10, still APPLY')
  r = applyClientRiskGuards({ ...base, score: 9 }, { interviewing: 2, payment_verified: true })
  assert(r.parsed.score === 8, '9/10 with 2 interviewing -> 8/10')
  r = applyClientRiskGuards({ ...base, score: 6, verdict: 'MAYBE' }, { interviewing: 3, payment_verified: true })
  assert(r.parsed.score === 6 && r.events.length === 0, 'a score already under the ceiling is left alone (the guard never raises)')
  r = applyClientRiskGuards({ ...base, score: 3, verdict: 'SKIP' }, { interviewing: 12, payment_verified: true })
  assert(r.parsed.score === 3 && r.parsed.verdict === 'SKIP', 'a SKIP is never lifted')
  r = applyClientRiskGuards(base, { interviewing: 3, payment_verified: true }, { skipCeiling: true })
  assert(r.parsed.score === 8, 'skipCeiling (PPC audit jobs keep their "always apply" policy)')
  r = applyClientRiskGuards(base, { interviewing: 0, proposals: '20 to 50', payment_verified: true })
  assert(r.parsed.score === 8 && r.events.length === 0, 'a normal 20-50 applicant job is untouched')

  r = applyClientRiskGuards({ ...base, score: 8 }, { payment_verified: false, client_country: 'Pakistan' })
  assert(r.parsed.verdict === 'SKIP' && r.parsed.score === 0 && r.events.includes('unverified-high-risk-country'), 'unverified Pakistan: forced to 0 SKIP')
  r = applyClientRiskGuards({ ...base, score: 8 }, { payment_verified: false, client_country: 'Germany' })
  assert(r.parsed.verdict === 'APPLY' && r.parsed.score === 8 && r.events.length === 0, 'unverified Germany, new client: NOT downgraded at all')
  r = applyClientRiskGuards({ ...base, score: 8 }, { payment_verified: true, client_country: 'Pakistan' })
  assert(r.parsed.score === 8, 'verified Pakistan: untouched')
  r = applyClientRiskGuards(null, {})
  assert(r.parsed === null, 'null answer passes through')

  // ── key points ─────────────────────────────────────────────────────────────
  const kp = cleanKeyPoints([{ text: 'Interviewing 3 already', tone: 'bad' }, 'plain string', { text: '' }, { text: 'x'.repeat(300), tone: 'nonsense' }, { text: 'd' }, { text: 'e' }])
  assert(kp.length === 4, 'at most 4 key points, blanks dropped')
  assert(kp[0].tone === 'bad' && kp[1].tone === 'warn' && kp[2].tone === 'warn', 'tone is kept when valid, else "warn"')
  assert(kp[2].text.length <= 140, 'long text is cut')
  assert(cleanKeyPoints(undefined).length === 0 && cleanKeyPoints('nope').length === 0, 'missing or malformed -> none (older cached analyses)')

  // ── wiring in JobDetail.jsx ────────────────────────────────────────────────
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  const has = (re, msg) => assert(re.test(src), msg)
  has(/from '\.\.\/lib\/clientRisk'/, 'JobDetail imports the client-risk library')
  has(/mandatoryFlags\.push\(\.\.\.competitionFlags\(job\)\)/, 'competition flags feed the analyser pre-check')
  has(/paymentFlag\(job\)/, 'the payment flag feeds the analyser pre-check')
  has(/applyClientRiskGuards\(parsed, job, \{ skipCeiling: _isPpcAuditJob \}\)/, 'the guard runs on the parsed answer')
  has(/paymentRisk\(job\)\.highRisk/, 'the audit-job override only yields to a HIGH-RISK unverified client')
  assert(!/payment_verified === false && \(Number\(job\.client_review_count\) \|\| 0\) < 5/.test(src), 'the old "unverified + under 5 reviews" disqualifier is gone from code')
  assert(!/Payment NOT verified AND client has under 5 reviews/.test(src), 'the old hard-disqualifier wording is gone from the prompt')
  has(/Payment NOT verified AND the client is in a HIGH-RISK country \(\$\{highRiskCountriesLabel\(\)\}\)/, 'the prompt states the country-based rule from the shared list')
  has(/If interviewing is 1 or 2: subtract 1 point, score AT MOST 8/, 'the prompt deducts a point for 1-2 interviewing')
  has(/"key_points":\[/, 'the output schema asks for key_points')
  has(/data-testid="key-points"/, 'the key points are rendered')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
