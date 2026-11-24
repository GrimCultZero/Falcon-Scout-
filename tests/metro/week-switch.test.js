// The week-mode switch in the Metro header (Phase 2, step 4): what the UI promises, checked from the source.
//   * the chip opens a confirm pop-up in BOTH directions; nothing switches without pressing the confirm button;
//   * entering a Metro week asks the backend whether Linked Helper is running (Windows process list) and the confirm
//     button stays disabled while it is running or the list cannot be read;
//   * the visits chip is the backend's counter against the cap, not a placeholder;
//   * the Senders tab is the account registry (role, cap, active), and Settings carries the enrichment settings.
// Run: node tests/metro/week-switch.test.js
const fs = require('fs')
const path = require('path')
const SRC = path.join(__dirname, '..', '..', 'frontend', 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

const w = read('components', 'WeekSwitch.jsx')
assert(/role="dialog"/.test(w) && /data-testid="week-dialog"/.test(w), 'a pop-up (dialog) opens from the chip')
assert(/confirmed: true/.test(w) && /onClick=\{confirm\}/.test(w) && !/onClick=\{show\}[^]*confirmed: true[^]*onClick=\{show\}/.test(w), 'the switch is sent only from the confirm button')
assert(/api\('\/week\/check'\)/.test(w) && /target === 'metro'/.test(w), 'entering a Metro week asks the backend about Linked Helper first')
assert(/disabled=\{busy \|\| blocked\}/.test(w) && /!check\.readable \|\| check\.linked_helper_running\.length > 0/.test(w), 'the confirm button is disabled while Linked Helper runs or the process list is unreadable')
assert(/no scrape jobs at all/.test(w) && /Messages and reply checks are not affected/.test(w), 'the pop-up says what a Linked Helper week means')
const app = read('MetroApp.jsx')
assert(/<WeekSwitch/.test(app) && /\/metro\/week/.test(app) && /Visits \{week\?\.visits \?\? 0\} of \{week\?\.cap \?\? 60\}/.test(app), 'the header shows the week switch and the backend visit counter against the cap')
assert(!/A placeholder until Phase 2/.test(app), 'the visits chip is no longer a placeholder')
const s = read('components', 'SendersTab.jsx')
assert(/\/accounts/.test(s) && /role/.test(s) && /daily_cap/.test(s) && /max="80"/.test(s), 'Senders: accounts with role, daily cap (max 80) and on/off')
const st = read('components', 'SettingsTab.jsx')
assert(/<EnrichSettings/.test(st) && /<FitRules/.test(st), 'Settings carries the enrichment settings and the fit rules')
const es = read('components', 'EnrichSettings.jsx')
assert(/type="password"/.test(es) && /never shown again/.test(es), 'the PageSpeed key is typed into a password field and never shown again')
const panel = read('components', 'EnrichPanel.jsx')
assert(/source_field/.test(panel) && /seen_at/.test(panel), 'every hook is shown with the stored field and the date it rests on')
assert(/email-export/.test(panel) && /email-import/.test(panel) && /unverified/.test(panel), 'the email-finder round trip is in the UI, and says new emails start unverified')
assert(!/\/send|method: 'POST'.*send/i.test(panel), 'nothing in the enrichment panel sends anything')

console.log(`\n${bad ? bad + ' FAILED' : 'all passed'}`)
process.exit(bad ? 1 : 0)
