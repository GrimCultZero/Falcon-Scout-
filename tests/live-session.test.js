// Live-session requirement (owner, 2026-11-25): a posting that requires a live session (training sessions,
// a presentation call, a screen-share walkthrough) never scores in the green zone. Capped at MAYBE, <= 6.
// Real case: job 26103 (Aavalabs, Finland) - the analyser said "fit-based SKIP", the PPC-audit override
// rewrote it to APPLY 7. See frontend/src/lib/liveSession.js.
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib', 'liveSession.js')
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }

;(async () => {
  const { liveSessionPhrase, liveSessionSignal, applyLiveSessionGuard } = await import(pathToFileURL(LIB).href)

  // the real posting wording
  const aava = { title: 'Senior PPC Strategist (Consultant)', description_full:
    'Create playbooks and run training sessions so our team can manage day-to-day optimisation on their own. ' +
    'Shortlisted candidates will do a short paid exercise and you will present your findings to our CEO in a 30-minute call.' }
  assert(liveSessionSignal(aava, {}).required, 'job 26103 wording is a live-session requirement')

  // the other direction: routine async PPC language must NOT trigger (Rule 2 false-positive history)
  for (const t of ['We need rapid testing and continuous optimization of campaigns', 'Daily monitoring, A/B test ads, kill losing ads quickly',
    'Deliver a written audit document and a Loom-free report', 'Monthly report by email', 'real-time bidding and active campaign management']) {
    assert(!liveSessionPhrase(t), `not a live session: "${t}"`)
  }
  for (const t of ['weekly Zoom call', 'a 30-minute call with our CEO', 'screen-share walkthrough', 'live training for our team', 'weekly meeting']) {
    assert(!!liveSessionPhrase(t), `live session: "${t}"`)
  }

  // the guard: APPLY 7 -> MAYBE 6, with a flag
  let r = applyLiveSessionGuard({ verdict: 'APPLY', score: 7, flags: [] }, aava)
  assert(r.parsed.verdict === 'MAYBE' && r.parsed.score === 6, 'APPLY 7 on a live-session job becomes MAYBE 6 (yellow zone)')
  assert(r.parsed.flags.some(f => /Live session required/.test(f) && /30-minute call|training sessions/.test(f)), '...with a flag quoting the phrase')
  assert(r.events.includes('liveSessionCeiling'), '...and a telemetry event')
  r = applyLiveSessionGuard({ verdict: 'APPLY', score: 9, flags: [] }, aava)
  assert(r.parsed.score === 6 && r.parsed.verdict === 'MAYBE', 'APPLY 9 is capped too')
  r = applyLiveSessionGuard({ verdict: 'MAYBE', score: 6, flags: [] }, aava)
  assert(r.parsed.score === 6 && r.events.length === 0, 'already MAYBE 6: untouched, no event')
  r = applyLiveSessionGuard({ verdict: 'MAYBE', score: 5, flags: [] }, aava)
  assert(r.parsed.score === 5, 'a lower score is never raised')
  r = applyLiveSessionGuard({ verdict: 'SKIP', score: 3, flags: [] }, aava)
  assert(r.parsed.verdict === 'SKIP' && r.parsed.score === 3, 'a SKIP the model already gave stays a SKIP')
  r = applyLiveSessionGuard({ verdict: 'APPLY', score: 8, flags: [] }, { title: 'Google Ads audit', description_full: 'Written audit of our account.' })
  assert(r.parsed.verdict === 'APPLY' && r.parsed.score === 8, 'a job with no live-session requirement is untouched')

  // the model's own flag counts when the posting text is missing
  r = applyLiveSessionGuard({ verdict: 'APPLY', score: 7, flags: ['Requires live training/walkthrough - Artem does not do live sessions (Rule 2). SKIP.'] }, { title: 'x' })
  assert(r.parsed.score === 6 && r.parsed.verdict === 'MAYBE', "the analyser's own Rule 2 flag is honoured when the description is missing")

  // wiring: runs after the PPC-audit override and the test-week guard, so nothing can lift it again
  const jd = fs.readFileSync(SRC, 'utf8')
  const iGuard = jd.indexOf('applyLiveSessionGuard(parsed, job)')
  assert(iGuard > jd.indexOf("['auditJobVerdictOverridden']") && iGuard > jd.indexOf('testWeekGuard(parsed'),
    'JobDetail runs the live-session guard AFTER the audit override and the test-week guard')
  assert(/import \{ applyLiveSessionGuard \} from '\.\.\/lib\/liveSession'/.test(jd), 'JobDetail imports the guard')

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass')
  process.exit(bad ? 1 : 0)
})()
