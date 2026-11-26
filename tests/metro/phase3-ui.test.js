// Metro Phase 3 (26 Nov 2026), the front-end rules that can be checked without a browser:
//   * Metro opens where Oleh left it: the Leads filters, sort and open panel are remembered per campaign; a remembered campaign
//     is kept while the list loads and dropped only when it is gone (lib/metroState.js);
//   * the Channels and Chain cells and the editor's size counter (lib/chainView.js);
//   * the strip: the ETA on the chip; the Falcon Scout side shows only a running chip and what needs attention (lib/activity.js);
//   * the Leads table has the few columns of Oleh's layout; a row opens the lead panel; Write and Send are live; the wagon outline
//     and the header padding are CSS (the SVG files are untouched).
// Run: node tests/metro/phase3-ui.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.join(__dirname, '..', '..')
const M = path.join(ROOT, 'frontend', 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(M, ...p), 'utf8')
const imp = (...p) => import(pathToFileURL(path.join(M, ...p)).href)

function memStore() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

;(async () => {
  const st = await imp('lib', 'metroState.js')
  const cv = await imp('lib', 'chainView.js')
  const act = await imp('lib', 'activity.js')

  // ── remembered view ──
  const s = memStore()
  assert(JSON.stringify(st.readLeadsView(s, 1).filters) === JSON.stringify(st.DEFAULT_FILTERS) && st.readLeadsView(s, 1).panel === null, 'nothing remembered: the default filters, no panel')
  st.writeLeadsView(s, 1, { filters: { ...st.DEFAULT_FILTERS, invite: 'connected', sort: 'company', q: 'atak' }, panel: 122 })
  const v1 = st.readLeadsView(s, 1)
  assert(v1.filters.invite === 'connected' && v1.filters.sort === 'company' && v1.filters.q === 'atak' && v1.panel === 122, 'filters, sort and the open panel come back after a reload')
  assert(st.readLeadsView(s, 2).panel === null && st.readLeadsView(s, 2).filters.sort === 'persona', 'per campaign: another campaign has its own view')
  st.writeLeadsView(s, 1, { panel: null })
  assert(st.readLeadsView(s, 1).panel === null && st.readLeadsView(s, 1).filters.q === 'atak', 'closing the panel keeps the filters')
  s.setItem(st.STATE_KEY, '{not json')
  assert(st.readLeadsView(s, 1).filters.sort === 'persona', 'an unreadable store falls back to the defaults')
  s.setItem(st.STATE_KEY, JSON.stringify({ leads: { 1: { sort: 5, evil: 'x', panel: 'x' } } }))
  const v2 = st.readLeadsView(s, 1)
  assert(v2.filters.sort === 'persona' && !('evil' in v2.filters) && v2.panel === null, 'only known keys and types are read back')
  assert(st.campaignToShow(3, null) === 3, 'while the list loads, the remembered campaign stays (the picker never flashes)')
  assert(st.campaignToShow(3, [{ id: 3 }, { id: 4 }]) === 3 && st.campaignToShow(9, [{ id: 3 }]) === null && st.campaignToShow(null, []) === null,
    'the picker only when the remembered campaign is gone')

  // ── cells ──
  const c1 = cv.channelsText({ email: 'business', email_sendable: true, linkedin: 'connected', open_profile: true })
  assert(c1.email === 'email: business' && c1.linkedin === 'LinkedIn: connected' && c1.extra === 'Open Profile', 'Channels: business email, connected, Open Profile')
  const c2 = cv.channelsText({ email: 'personal', email_sendable: false, email_status: 'unverified', linkedin: 'not' })
  assert(c2.email === 'email: personal (not checked)' && c2.linkedin === 'LinkedIn: not invited' && c2.extra === '', 'Channels: an unchecked personal address, not invited')
  assert(cv.channelsText({ email: 'none', linkedin: 'invited' }).email === 'email: none', 'Channels: no address')
  assert(cv.chainPill({ state: 'issues', label: 'issues (6 touches)' }).color === cv.CHAIN_COLORS.issues && cv.chainPill(null).label === 'not written',
    'Chain cell: the state decides the colour; no chain = not written')
  assert(cv.touchHead({ step: 2, channel: 'email', day: 3 }) === 'Step 2 · Email · day 3', 'a touch head: step, channel, day')
  assert(cv.sizeNote('linkedin', 'x'.repeat(301)).over && !cv.sizeNote('linkedin', 'x'.repeat(300)).over, 'LinkedIn: 300 characters at most (the same limit as the checks)')
  assert(cv.sizeNote('email', Array(121).fill('w').join(' ')).over && !cv.sizeNote('email', Array(120).fill('w').join(' ')).over, 'email: 120 words at most')
  assert(cv.chainStatesLine({ written: 5, issues: 2, held: 5, none: 0 }) === '5 written, 2 with issues, 5 held (same company)', 'the Write card line has no zero')

  // ── the strip ──
  const run = (o) => act.activityFromRun({ id: o.id || 'r', kind: 'chains', label: 'Writing chains', status: 'running', total: 8, done: 3, started_at: 1, ...o })
  assert(act.chipEta(run({ eta_s: 180 })) === '~3 min left' && act.chipEta(run({ eta_s: 42 })) === '~40 s left' && act.chipEta(run({ eta_s: null })) === '',
    'the ETA on the chip: minutes, seconds, nothing until the backend has one')
  assert(act.chipEta(run({ status: 'done', eta_s: 100 })) === '', 'no ETA on a finished run')
  const acts = act.buildActivities([
    { id: 'a', kind: 'chains', status: 'running', started_at: 3 },
    { id: 'b', kind: 'hooks', status: 'done', result: 'Hooks for 13 leads', started_at: 1, finished_at: 2 },
    { id: 'c', kind: 'enrich', status: 'failed', result: 'Enrich failed', started_at: 1, finished_at: 2 },
    { id: 'd', kind: 'enrich', status: 'stopped', result: 'Enriched 1 of 6 (stopped)', started_at: 1, finished_at: 2 },
  ])
  const fs_ = act.attentionOnly(acts)
  assert(fs_.running.length === 1 && fs_.finished.map((a) => a.key).sort().join() === 'c,d', 'Falcon side: the running chip and the failed / stopped runs only; an ordinary result stays on Metro')
  assert(acts.finished.length === 3, 'the Metro side keeps every result')
  assert(act.SHORT.chains === 'Chains', 'the tab title has a word for a chain run')
  const strip = read('components', 'ActivityStrip.jsx')
  assert(/falconSide \? attentionOnly\(built\) : built/.test(strip) && /mt-chip--compact/.test(strip) && /strip-eta/.test(strip), 'the strip filters the Falcon side, draws a compact chip there and the ETA everywhere')
  assert(/<ActivityStrip onGo=\{goto\} showIdle=\{false\} falconSide \/>/.test(read('SideShell.jsx')), 'SideShell gives the Falcon side the attention-only strip')

  // ── the Leads page and the panel ──
  const leads = read('components', 'LeadsTab.jsx')
  assert(/<th>Person and company<\/th><th>Fit<\/th><th>Channels<\/th><th>Hooks<\/th><th>Chain<\/th>/.test(leads), "the table has Oleh's five columns")
  assert(/data-testid="write-chains"/.test(leads) && /Write chains \(\$\{chainSum\?\.shortlisted/.test(leads), 'Write card: "Write chains (N shortlisted)" is its button')
  assert(/data-testid="export-lh"/.test(leads) && /data-testid="export-email"/.test(leads), 'Send card: the Linked Helper and email exports')
  assert(/setPanel\(l\.id\)/.test(leads) && /<LeadPanel leadId=\{panel\}/.test(leads), 'a click on a row opens the lead panel')
  assert(/readLeadsView\(store, pickedId\)/.test(leads) && /writeLeadsView\(store, pickedId/.test(leads), 'the Leads view is read from and written to the remembered state')
  const panel = read('components', 'LeadPanel.jsx')
  assert(/data-testid="approve"/.test(panel) && /data-testid="send-anyway"/.test(panel) && /data-testid="do-not-send"/.test(panel), 'the panel: Approve, Send anyway, "Do not send as is"')
  assert(/Case link added under the text by code/.test(panel) && !/<textarea[^>]*case/.test(panel), 'the case link is shown as code-attached, never in the editable text')
  const css = read('metro.css')
  assert(/\.mt-chip-wagon \.mt-wagon svg \{ filter: drop-shadow/.test(css), 'the wagon on the dark chip gets a light outline by CSS')
  assert(/padding: '0 20px 0 22px'/.test(read('MetroApp.jsx')), 'the Metro header has left padding for the badge')
  const wagonPublic = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'metro-wagon.svg'), 'utf8')
  assert(wagonPublic === read('assets', 'metro-wagon.svg') && !/drop-shadow|filter/.test(wagonPublic), 'the wagon SVG itself is unchanged')

  console.log(`\n${bad ? `${bad} FAILED` : 'all passed'}`)
  process.exit(bad ? 1 : 0)
})()
