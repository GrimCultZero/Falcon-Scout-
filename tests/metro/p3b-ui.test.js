// Metro P3b (27 Nov 2026), the front-end rules of the Minor fixes list that can be checked without a browser:
//   #1 / #8  the Metro mark is the header mark and the tab icon; a Falcon Scout bell cannot repaint the Metro tab icon; the Falcon Scout
//            side never shows the title "Metro";
//   #3       "Cannot reach the backend" only after a real health check (/metro/ping) fails twice; a busy backend says so;
//   #4b      an interrupted run shows as stopped, with Resume;
//   #5       labels say what they process ("Write hooks (13 shortlisted · 8 companies)");
//   #6       three button kinds: primary acid, secondary lime, tertiary outline, with the volume style;
//   #7       no red anywhere: lime Agency line, orange errors;
//   #9       a run Oleh started shows its "done" chip on the Falcon Scout side; background results do not;
//   the wave: each message says its job; the panel's track line; "Change case" is in the panel.
// Run: node tests/metro/p3b-ui.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.join(__dirname, '..', '..')
const M = path.join(ROOT, 'frontend', 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(M, ...p), 'utf8')
const imp = (...p) => import(pathToFileURL(path.join(M, ...p)).href)

;(async () => {
  // ── #5 labels ──
  const sl = await imp('lib', 'scopeLabels.js')
  assert(sl.scopeLabel('Write hooks', { n: 13, what: 'shortlisted', companies: 8 }) === 'Write hooks (13 shortlisted · 8 companies)', 'the label Oleh asked for')
  assert(sl.scopeLabel('Write chains', { n: 1, what: 'ticked', companies: 1 }) === 'Write chains (1 ticked)', 'one lead of one company: no "· 1 company"')
  assert(sl.scopeLabel('Write hooks', { n: 3, what: 'shortlisted', companies: 1 }) === 'Write hooks (3 shortlisted · 1 company)', 'singular company')
  assert(sl.companiesOf([{ id: 1, company_id: 7 }, { id: 2, company_id: 7 }, { id: 3 }]) === 2, 'companies among rows (a row without a company is its own)')
  const leads = read('components', 'LeadsTab.jsx')
  const enrich = read('components', 'EnrichPanel.jsx')
  assert(/api\(`\/leads\/scope\?\$\{filterParams\(\)\}`\)/.test(leads) && /shortlisted_companies/.test(leads), 'the counts come from the backend for the rows the filters show (/leads/scope)')
  assert(!/shortlisted only\)/.test(enrich) && /hooksLabel/.test(enrich), '"Write hooks (495 shown, shortlisted only)" is gone')

  // ── #9 and #4b in the strip ──
  const act = await imp('lib', 'activity.js')
  const runs = [
    { id: 'a', kind: 'chains', label: 'Writing chains', status: 'done', result: 'Chains for 8 leads', by_click: true, started_at: 1, finished_at: 5 },
    { id: 'b', kind: 'score', label: 'Scoring', status: 'done', result: 'Scored 12', by_click: false, started_at: 1, finished_at: 4 },
    { id: 'q3', queue_id: 3, kind: 'hooks', label: 'Writing hooks', status: 'interrupted', result: 'Stopped by a backend restart at 3 of 8; Resume continues with the 5 left', can_resume: true, started_at: 1, finished_at: 3 },
  ]
  const b = act.buildActivities(runs)
  const falcon = act.attentionOnly(b)
  assert(falcon.finished.some((x) => x.key === 'a') && !falcon.finished.some((x) => x.key === 'b'),
    '#9: a run Oleh started shows its "done" on the Falcon Scout side; a background result does not')
  const q = b.finished.find((x) => x.key === 'q3')
  assert(q && q.status === 'stopped' && q.interrupted && q.canResume && q.queueId === 3, '#4b: an interrupted run is drawn as stopped, with Resume')
  assert(falcon.finished.some((x) => x.key === 'q3'), '...and it needs attention on both sides')
  const strip = read('components', 'ActivityStrip.jsx')
  assert(/data-testid="strip-resume"/.test(strip) && /resumeRun\(a\.queueId\)/.test(strip), 'the strip has a Resume button for it')
  assert(/export async function resumeRun\(queueId\)/.test(read('lib', 'progressStore.js')) && /\/runs\/\$\{queueId\}\/resume/.test(read('lib', 'progressStore.js')),
    'Resume posts /metro/runs/{id}/resume')

  // ── #8 the tab title and icon ──
  assert(act.isMetroTitle('Metro') && act.isMetroTitle('(Enriching 7/20) Metro') && !act.isMetroTitle('Falcon Scout') && !act.isMetroTitle('🔔 3 new – Falcon Scout'),
    'the shell knows its own Metro titles')
  const shell = read('SideShell.jsx')
  assert(/falconBase/.test(shell) && /side === 'metro' \? `\$\{prefix\}Metro` : prefix \+ falconBase\.current/.test(shell),
    'on the Falcon Scout side the tab says what Falcon Scout set, never "Metro"')
  const fav = await imp('lib', 'favicon.js')
  assert(fav.METRO_ICON === '/brand/metro-mark.png', 'the Metro tab icon is the approved mark')
  assert(/MutationObserver/.test(read('lib', 'favicon.js')), 'a Falcon Scout bell cannot repaint the Metro tab icon (a watcher puts the mark back)')
  assert(fs.existsSync(path.join(ROOT, 'frontend', 'public', 'brand', 'metro-mark.png')), 'brand/metro-mark.png is served')
  assert(/<MetroMark running=\{anyRunning\}/.test(read('MetroApp.jsx')) && /METRO_MARK = '\/brand\/metro-mark\.png'/.test(read('components', 'Marks.jsx')), '#1: the header shows the mark')

  // ── #3 the backend-down message ──
  const api = await imp('api.js')
  let calls = 0
  const up = await api.backendUp(async (u) => { calls++; return { ok: u === '/metro/ping' } }, 2)
  assert(up && calls === 1, '/metro/ping answering = up')
  calls = 0
  const down = await api.backendUp(async () => { calls++; throw new Error('refused') }, 2)
  assert(!down && calls === 2, 'down only after TWO failed health checks')
  try {
    await api.fetchOrExplain('/metro/accounts', { method: 'POST' }, async (u) => { if (u === '/metro/ping') return { ok: true }; throw new Error('reset') })
    assert(false, 'a failed request throws')
  } catch (e) {
    assert(e.message === api.BUSY && !e.unreachable, 'a failed request while the backend answers /ping says "busy", never "Cannot reach the backend"')
  }
  let n = 0
  const r = await api.fetchOrExplain('/metro/accounts', {}, async () => { n++; if (n === 1) throw new Error('blip'); return { ok: true, status: 200 } })
  assert(r.ok && n === 2, 'a GET is tried once more before anything is said')
  assert(!/Cannot reach the backend/.test(leads) && !/Cannot reach the backend/.test(enrich), 'no screen writes its own "Cannot reach the backend" any more')

  // ── #6 buttons ──
  const ui = read('components', 'ui.jsx')
  assert(/export const btnClass = \(kind\) => \(kind === 'primary' \? 'primary' : kind === 'secondary' \? 'secondary' : 'ghost'\)/.test(ui), 'three kinds: primary, secondary, tertiary (ghost)')
  const css = read('metro.css')
  assert(/\.mt-btn--secondary \{[^}]*background: var\(--mt-lime\)/.test(css) && /--mt-lime: #b8f82c/.test(css), 'secondary = lime #B8F82C')
  assert(/\.mt-btn--primary \{[^}]*background-image: linear-gradient/.test(css) && /inset 0 1px 0 rgba\(255, 255, 255, 0\.75\)/.test(css) && /0 2px 0 var\(--mt-acid-lip\)/.test(css),
    'the volume style: gradient sheen, inner highlight, bottom lip')
  assert(/\.mt-btn--primary:hover:not\(:disabled\) \{[^}]*transform: translateY\(-1px\)/.test(css) && /\.mt-btn:active:not\(:disabled\) \{ transform: translateY\(1\.5px\)/.test(css), 'lift on hover, press on click')
  assert(/kind="secondary" small onClick=\{hooks\}/.test(enrich) && /kind="secondary" small onClick=\{\(\) => setEmailDlg\(true\)\}/.test(enrich), 'Write hooks and Emails are secondary')
  assert(/data-testid="write-chains"/.test(leads) && !/kind="(?:secondary|ghost)"[^>]*data-testid="write-chains"/.test(leads), 'Write chains is the primary of its stage')
  assert(/kind="secondary" onClick=\{\(\) => download\('linkedhelper'\)\}/.test(leads.replace(/small /g, '')) || /small kind="secondary" onClick=\{\(\) => download\('linkedhelper'\)\}/.test(leads), 'the exports are secondary')

  // ── #7 no red ──
  const files = []
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  walk(M)
  const red = files.filter((f) => /\.(js|jsx|css|svg)$/.test(f) && /#e6261f|rgba\(230, ?38, ?31/i.test(fs.readFileSync(f, 'utf8')))
  assert(red.length === 0, `no red left in Metro (${red.map((f) => path.relative(M, f)).join(', ') || 'none'})`)
  const theme = read('theme.js')
  assert(/agencyLine: '#B8F82C'/.test(theme) && /error: '#F2711C'/.test(theme), 'Agency line lime #B8F82C, errors deep orange #F2711C')
  assert(/<LinePill type=\{campaign\.type\}>/.test(leads), 'the "agency · draft" pill is a lime fill with dark text (never lime text on white)')

  // ── the wave in the panel ──
  const cv = await imp('lib', 'chainView.js')
  assert(cv.touchHead({ step: 2, channel: 'email', day: 0, job: 'hook' }) === 'Step 2 · Email · day 0 · Hook email (new thread)', 'each message says its job')
  assert(cv.touchHead({ step: 5, channel: 'linkedin', day: 16, job: 'pointer', after_step: 4, working_days_after: 2 }).includes('2 working days after step 4'), 'the pointer says when it goes')
  assert(cv.touchHead({ step: 0, channel: 'linkedin', job: 'intro', on_accept: true }).includes('on acceptance'), 'a late intro goes on acceptance')
  assert(cv.trackText('linkedin_first', { plan: { four: true } }) === 'LinkedIn intro + 4 emails + LinkedIn pointer', 'the track line of a connected lead')
  assert(cv.trackText('email_first', { plan: { four: false, intro_on_accept: true } }) === '3 emails; the LinkedIn intro after the acceptance', 'the track line of an invited lead')
  assert(cv.trackText('email_first', { plan: { four: true } }) === '4 emails (not connected on LinkedIn)', 'the track line of a lead who is not connected')
  assert(/replace\(\/\[\^A-Za-z0-9 \]\/g/.test(ui), 'initials skip "&" ("Baal & Spots" -> "BS")')
  const panel = read('components', 'LeadPanel.jsx')
  assert(/function CasePicker/.test(panel) && /\/leads\/\$\{leadId\}\/cases/.test(panel) && /\/chain\/case/.test(panel) && /data-testid="change-case"/.test(panel), '"Change case" is in the lead panel')
  assert(/data-testid="chain-facts"/.test(panel) && /Do not send as is/.test(panel), 'the panel shows the facts the wave uses and "Do not send as is"')
  assert(/<Logo src=\{d\?\.company\?\.logo\}/.test(panel) && /<Logo src=\{l\.logo\}/.test(leads), '#2: logos in the panel and the Leads rows (initials when none)')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
