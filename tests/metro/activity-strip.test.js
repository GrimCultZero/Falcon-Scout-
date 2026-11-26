// Metro F4 (25 Nov 2026), the front-end rules that can be checked without a browser:
//   1. the header strip: the merge of backend runs into chips (one per running job, "N running" above 2, a finished result stays
//      until dismissed, a failure first), the browser tab title, polling only while something runs, a click opens the screen;
//   2. every button shows what it did: busy state, notices that stay, a refused request always says why;
//   3. buttons look alive: acid blue with readable contrast, a 120 ms press (transform only), nothing animated under reduced motion;
//   8. wiring: the strip sits in both headers, the campaign list opens the leads, Leads has "Brief and settings".
// Run: node tests/metro/activity-strip.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'frontend', 'src')
const M = path.join(SRC, 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(M, ...p), 'utf8')
const imp = (...p) => import(pathToFileURL(path.join(M, ...p)).href)

// WCAG relative luminance / contrast
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

;(async () => {
  const act = await imp('lib', 'activity.js')
  const run = (o = {}) => ({ id: 'r1', kind: 'enrich', label: 'Enriching', campaign_id: 3, campaign_name: 'USA CAN Agency Claude 1', status: 'running', total: 20, done: 7, failed: 0,
    current: 'Rank Media Agency', step: 'website scan', started_at: 1000, finished_at: null, result: null, can_stop: true, stopping: false, ...o })

  // ── 1. merge ──
  const a = act.activityFromRun(run())
  assert(a.status === 'running' && a.done === 7 && a.total === 20 && a.canStop && a.campaignName === 'USA CAN Agency Claude 1', 'a backend run becomes an activity with its counts, campaign and Stop')
  assert(act.chipCount(a) === '7/20' && act.chipPct(a) === 35, `X of N and the bar (${act.chipCount(a)}, ${act.chipPct(a)}%)`)
  assert(act.chipDetail(a) === 'Rank Media Agency - website scan', `the current item and step are on the chip (${act.chipDetail(a)})`)
  assert(act.chipTitle(a) === 'Enriching - USA CAN Agency Claude 1 7 of 20', `the chip names the job, the campaign and the count (${act.chipTitle(a)})`)
  assert(act.activityFromRun(run({ can_stop: false })).canStop === false && act.activityFromRun(run({ status: 'done', can_stop: true })).canStop === false, 'Stop only where an abort exists and the run is still going')
  assert(act.chipPct(act.activityFromRun(run({ total: 0, done: 0 }))) === 0 && act.chipCount(act.activityFromRun(run({ total: 0, done: 0 }))) === '', 'no total: no percentage (the bar is indeterminate)')
  assert(act.activityFromRun(run({ done: 25 })).done === 25 && act.chipCount(act.activityFromRun(run({ done: 25 }))) === '20/20', 'never "25/20"')

  const fin = run({ id: 'f1', status: 'done', finished_at: 1030, result: 'Enriched 20 - 17 domains found, 3 not found', can_stop: false })
  const fail = run({ id: 'f2', kind: 'score', label: 'Scoring fit', status: 'failed', finished_at: 1040, result: 'Failed: database is locked' })
  const old = run({ id: 'f3', status: 'stopped', finished_at: 900, result: 'Enriched 4 of 20 (stopped)' })
  let b = act.buildActivities([fin, run({ id: 'r2', kind: 'hooks', label: 'Writing hooks', started_at: 1100 }), run(), fail, old])
  assert(b.running.length === 2 && b.running[0].key === 'r2', 'running jobs: newest first')
  assert(b.finished.map((x) => x.key).join() === 'f2,f1,f3', `finished: a failure first, then the newest (${b.finished.map((x) => x.key)})`)
  assert(act.buildActivities([fin], new Set(['f1'])).finished.length === 0, 'a dismissed result is gone')
  assert(act.buildActivities([fin]).finished.length === 1 && act.buildActivities([{ ...fin, finished_at: 1 }]).finished.length === 1, 'a finished result STAYS (no timeout) until dismissed')
  assert(act.buildActivities([fail], new Set()).finished.length === 1 && act.buildActivities([{ ...fail, status: 'failed' }], new Set()).finished[0].status === 'failed', 'a failure shows')
  const localOk = { id: 'l1', kind: 'local', label: 'Building the export', status: 'done', total: 0, done: 0, started_at: 1, finished_at: 2, result: 'Done' }
  assert(act.buildActivities([localOk]).finished.length === 0 && act.buildActivities([{ ...localOk, status: 'failed', result: 'x' }]).finished.length === 1, 'a page-side run that ended fine says nothing; one that failed does')
  assert(act.buildActivities([{ ...run(), status: 'weird' }]).finished.length === 1, 'an unknown status is shown as finished, never dropped')

  // chips / collapsed
  const none = act.summarize(act.buildActivities([]))
  assert(none.mode === 'idle' && none.text === 'Nothing running', 'nothing running: the idle line')
  assert(act.summarize(act.buildActivities([run(), run({ id: 'r2' })])).mode === 'chips', 'two running: two chips')
  const three = act.summarize(act.buildActivities([run(), run({ id: 'r2' }), run({ id: 'r3' })]))
  assert(three.mode === 'collapsed' && three.text === '3 running' && three.all.length === 3, 'more than 2: "3 running" with a dropdown')
  const sm = act.summarize(act.buildActivities([run(), fin]))
  assert(sm.mode === 'chips' && sm.visible.length === 2 && sm.more.length === 0, 'one running + one result: two chips side by side')
  assert(act.summarize(act.buildActivities([run(), fin]), { narrow: true }).visible.length === 1 && act.summarize(act.buildActivities([run(), fin]), { narrow: true }).more.length === 1, 'a narrow window shows the running chip and puts the result behind "+1 more"')
  const crowded = act.summarize(act.buildActivities([run(), fin, fail, old]))
  assert(crowded.mode === 'chips' && crowded.visible.length === 3 && crowded.visible[0].status === 'running' && crowded.visible[1].status === 'failed' && crowded.more.length === 1, 'a running job is never hidden by results: it stays a chip, a failure is next, the rest wait behind "+1 more"')
  assert(act.summarize(act.buildActivities([run(), fin, fail])).mode === 'chips', 'results do not push a running job into the dropdown (only more than 2 RUNNING do)')
  assert(act.summarize(act.buildActivities([run(), run({ id: 'r2' }), run({ id: 'r3' }), fin])).text === '3 running, 1 done', 'the collapsed chip counts what is done too')
  const only = act.summarize(act.buildActivities([fin, fail, old]))
  assert(only.mode === 'chips' && only.visible.length === 3 && only.more.length === 0, 'only results: up to three are chips')

  // tab title
  assert(act.tabTitle(b.running.slice(1), 'Metro') === '(Enriching 7/20) Metro', `the tab title: (Enriching 7/20) Metro (${act.tabTitle(b.running.slice(1), 'Metro')})`)
  assert(act.tabTitle(b.running, 'Metro') === '(Writing hooks'.replace('Writing hooks', 'Hooks') + ' 7/20 +1) Metro', `+N for the others (${act.tabTitle(b.running, 'Metro')})`)
  assert(act.tabTitle([], 'Metro') === 'Metro', 'idle: the plain title')
  assert(act.stripTitlePrefix('(Enriching 7/20) Falcon Scout', '(Enriching 7/20) ') === 'Falcon Scout' && act.stripTitlePrefix('Falcon Scout', '(x) ') === 'Falcon Scout', 'only our own prefix is taken off the title')
  assert(a.where.tab === 'leads' && a.where.campaignId === 3, 'a click goes to the Leads screen of its campaign')

  // polling only while something runs
  assert(act.nextDelay({ running: true }) === 1500 && act.nextDelay({ running: true, failing: true }) === 5000, 'polls every 1.5 s while something runs (5 s while the backend does not answer)')
  assert(act.nextDelay({}) === null && act.nextDelay({ burstActive: true }) === 700, 'idle: no polling at all; a short fast burst right after a button started something')

  // ── notices ──
  const nt = await imp('lib', 'notices.js')
  nt.notices.clear()
  const id1 = nt.notify.ok('Enriching 20 companies'), id2 = nt.notify.error('Enrich was refused: a run is already going')
  assert(nt.notices.get().length === 2 && nt.notices.get()[1].kind === 'error', 'notices stack')
  nt.notify.error('Enrich was refused: a run is already going')
  assert(nt.notices.get().length === 2 && nt.notices.get()[1].count === 2, 'the same error twice is one notice, counted')
  nt.notices.dismiss(id1)
  assert(nt.notices.get().length === 1, 'a notice stays until it is dismissed')
  nt.notices.clear()
  assert(nt.noticeFromResult('Done 5').kind === 'ok' && nt.noticeFromResult({ kind: 'warn', text: 'x' }).kind === 'warn' && nt.noticeFromResult(undefined) === null && nt.noticeFromResult({ foo: 1 }) === null, 'what a handler returns -> the notice (nothing returned = no notice)')
  assert(nt.refusal({ started: false, reason: 'a run is already going' }).kind === 'warn' && nt.refusal({ started: true }) === null, 'a "started: false" answer is a warning, never a green success')
  for (let i = 0; i < 10; i++) nt.notify.ok('n' + i)
  assert(nt.notices.get().length <= 6, 'the pile is capped')
  nt.notices.clear()

  // ── api.js: a refused or failed request always shows its reason ──
  const { api } = await imp('api.js')
  const realFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 409, statusText: 'Conflict', json: async () => ({ detail: 'a run is already going' }) })
  let err
  try { await api('/campaigns/3/enrich', { method: 'POST', json: {} }) } catch (e) { err = e }
  assert(err && err.message === 'a run is already going' && err.notified === true, 'a refused POST throws with the reason and is marked as already shown')
  assert(nt.notices.get().length === 1 && nt.notices.get()[0].kind === 'error' && /enrich was refused: a run is already going/.test(nt.notices.get()[0].text), `and a notice says it (${nt.notices.get()[0]?.text})`)
  nt.notices.clear()
  try { await api('/leads?x=1') } catch { /* expected */ }
  assert(nt.notices.get().length === 0, 'a refused GET (a background refresh) does not shout')
  global.fetch = async () => { throw new TypeError('Failed to fetch') }
  err = null
  try { await api('/campaigns/3/score', { method: 'POST', json: {} }) } catch (e) { err = e }
  assert(/Cannot reach the backend/.test(err?.message || '') && nt.notices.get().length === 1 && /did not run/.test(nt.notices.get()[0].text), 'a backend that is away: a clear sentence, not "Failed to fetch"')
  nt.notices.clear()
  global.fetch = async () => ({ ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({ detail: [{ msg: 'field required' }] }) })
  try { await api('/x/y', { method: 'POST', json: {}, quiet: true }) } catch { /* expected */ }
  assert(nt.notices.get().length === 0, 'quiet: true leaves the notice to the caller')
  global.fetch = realFetch

  // ── 2. the shared Btn ──
  const ui = read('components', 'ui.jsx')
  assert(/setBusy\(true\)/.test(ui) && /disabled=\{disabled \|\| working\}/.test(ui) && /aria-busy/.test(ui) && /mt-spinner/.test(ui), 'a button is disabled with a spinner while its request runs')
  assert(/noticeFromResult\(v\)/.test(ui) && /notices\.push\(n\.kind, n\.text, n\.detail\)/.test(ui), 'what the handler returns is shown as a notice')
  assert(/r\.then\(\(v\) =>[\s\S]*?, fail\)/.test(ui) && /catch \(err\) \{ fail\(err\)/.test(ui), 'a handler that throws, or a promise that rejects, shows its reason')
  assert(/err\.notified/.test(ui) || /!err \|\| !err\.notified/.test(ui), 'an error api.js already showed is not shown twice')
  assert(/if \(busy \|\| busyProp \|\| disabled/.test(ui), 'a click while busy does nothing (no double start)')
  const host = read('components', 'NoticeHost.jsx')
  assert(/notices\.dismiss\(n\.id\)/.test(host) && /role=\{n\.kind === 'error' \? 'alert' : 'status'\}/.test(host) && !/setTimeout/.test(host), 'a notice has a dismiss button, and nothing closes it by itself')
  const css = read('metro.css')
  assert(/\.mt-notices \{[^}]*position: fixed/.test(css), 'notices are fixed on screen, so a scrolled page cannot hide them')

  // ── 3. look and press ──
  assert(/--mt-acid: #00e5ff/i.test(css), 'acid blue #00E5FF is the highlight colour')
  const cr = contrast('#00e5ff', '#000c0e')
  assert(cr >= 7, `dark text on the acid fill reads (contrast ${cr.toFixed(1)} : 1, AAA needs 7)`)
  assert(/\.mt-btn--primary \{[^}]*background: var\(--mt-acid\)[^}]*color: var\(--mt-ink\)/.test(css), 'the primary button is acid with dark text')
  assert(/\.mt-btn:active:not\(:disabled\) \{ transform: translateY\(1\.5px\)/.test(css), 'press: down 1.5 px')
  assert(/transition: transform 120ms/.test(css), 'press and release take 120 ms')
  assert(/\.mt-btn--primary:hover:not\(:disabled\)/.test(css) && /\.mt-btn--ghost:hover:not\(:disabled\)/.test(css), 'a visible hover on both kinds')
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert(/transition: none/.test(rm) && /transform: none/.test(rm) && /\.mt-spinner \{ animation: none/.test(rm) && /\.mt-chip-dot \{ animation: none/.test(rm) && /\.mt-chip-indet \{ animation: none/.test(rm), 'nothing animates under reduced motion (press, spinner, pulse, sliding bar)')
  assert(/\[data-testid="metro-app"\] button:not\(:disabled\):active/.test(css), 'every other button inside Metro presses the same way')
  assert(/\.mt-tab\[aria-selected="true"\]/.test(css) && /className="mt-tab"/.test(read('MetroApp.jsx')), 'the active tab is acid')

  // ── 1/8. wiring ──
  const strip = read('components', 'ActivityStrip.jsx'), store = read('lib', 'progressStore.js'), shell = read('SideShell.jsx'), metro = read('MetroApp.jsx')
  const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
  assert(/\{activityStrip\}/.test(metro) && /\{activityStrip\}/.test(app) && metro.indexOf('</header>') < metro.indexOf('{activityStrip}') && /<\/header>\s+\{activityStrip\}/.test(app), 'the strip is drawn under the Metro header and under the Falcon Scout header (a bar of its own: a header row has no room for it)')
  assert(/activityStrip=\{<ActivityStrip onGo=\{goto\} showIdle=\{false\} \/>\}/.test(shell) && /activityStrip=\{<ActivityStrip onGo=\{goto\} \/>\}/.test(shell), 'the shell gives it to both sides')
  assert(/change\('metro'\)/.test(shell) && /requestGoto\(/.test(shell), 'a click on a chip from the Falcon Scout side switches to Metro and opens the screen')
  assert(/takePending\(\)/.test(metro) && /addEventListener\('metro-goto'/.test(metro), 'MetroApp opens the requested tab and campaign (also when it mounts a moment later)')
  assert(/`\$\{prefix\}Metro`/.test(shell) && /tabTitle\(running, ''\)/.test(shell) && /MutationObserver/.test(shell), 'the browser tab title carries what is running: "(Enriching 7/20) Metro"')
  assert(/data-testid="strip-stop"/.test(strip) && /a\.canStop && !a\.stopping/.test(strip) && /stopRun\(/.test(strip), 'Stop is on the chip where an abort exists')
  assert(/data-testid="strip-result"/.test(strip) && /dismiss\(a\.key\)/.test(strip), 'a finished result has a dismiss button')
  assert(/chipDetail\(a\)/.test(strip) && /chipCount\(a\)/.test(strip) && /a\.campaignName/.test(strip), 'a chip shows the campaign, X of N and the current item and step')
  assert(/summarize\(acts, \{ narrow \}\)/.test(strip) && /NARROW_BELOW = 1100/.test(strip), '"N running" dropdown above 2, or in a narrow window')
  assert(/nextDelay\(/.test(store) && !/setInterval/.test(store) && /poll\(\)\s+\/\/ once on load/.test(store), 'polling: once on load, then only while something runs (a timer chain, no interval)')
  assert(/addEventListener\('metro-click', announce\)/.test(store) && /dispatchEvent\(new Event\('metro-click'\)\)/.test(ui), 'a button that starts a request makes the strip look at once')
  assert(/function subscribe\(fn\)/.test(store) && /useSyncExternalStore\(subscribe, getView, getView\)/.test(store), 'one stable subscribe function (an inline one re-subscribed on every render and kept resetting the poll timer: found in the browser)')
  assert(/alive\.current = true; return \(\) => \{ alive\.current = false \}/.test(ui), 'a button re-arms its "mounted" flag (React StrictMode unmounts and mounts again; found in the browser: a button stayed busy for ever)')
  assert(/useProgress\(\)/.test(read('components', 'ProgressDock.jsx')) && !/setInterval\(\(\) => \{ load/.test(read('components', 'ProgressDock.jsx')), 'the dock reads the same store (no second poller)')

  const leads = read('components', 'LeadsTab.jsx'), camps = read('components', 'CampaignsTab.jsx'), enrich = read('components', 'EnrichPanel.jsx')
  assert(/onClick=\{\(\) => openItsLeads\(c\.id\)\}/.test(camps) && /const openItsLeads = \(id\) => \{ setCreating\(false\); onOpenLeads\?\.\(id\) \}/.test(camps), 'a click on a campaign in the list opens its leads')
  assert(/data-testid="open-brief"/.test(leads) && /onOpenBrief\?\.\(campaign\.id\)/.test(leads) && /openBrief = \(id\) => \{ chooseCampaign\(id\); pick\('campaigns'\) \}/.test(metro), '"Brief and settings" on Leads opens the campaign page')
  assert(/data-testid="leads-campaign"/.test(leads), 'the dropdown on Leads stays for switching')
  assert(/enrichNextLabel\(/.test(leads) && !/with a domain \+/.test(leads) && /with a website/.test(leads) && /not tried yet/.test(leads), 'F5: the "Enrich next N" label is plain; the with / without detail is in the small line')
  assert(!/metro-email-finder-campaign/.test(enrich) && /Content-Disposition/.test(enrich), 'the email list download takes its unique name from the backend (campaign, date and time)')
  assert(/export-file|import-file/.test(read('components', 'ImportDialog.jsx')) && /ImportDialog/.test(enrich) && !/email-import\?source/.test(enrich), 'the email results use the same Import dialog')
  const buttonsReturn = (leads.match(/return \{ kind: 'warn'/g) || []).length
  assert(buttonsReturn >= 3, `buttons answer a refusal with a warning notice (${buttonsReturn} places in Leads)`)
  assert(!/setNote\(/.test(leads) && !/setNote\(/.test(enrich), 'no small green "note" line is left: every result is a notice')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
