// Metro Phase 1 front end, wiring and rules that can be checked without a browser:
//   * the three live tabs are mounted from MetroApp; CRM and Senders stay "coming";
//   * the Leads tab follows DevScout's rule "what you see runs": no scope buttons, the action buttons
//     carry the number they will process, the ticked rows win over the filtered ones;
//   * Enrich / Write / Send are not live in Phase 1 (disabled), and nothing in Metro's UI sends;
//   * F4: one Import button, no preview; the backend stops only a file that looks wrong;
//   * Settings lists Upwork-derived candidates for a one-by-one decision;
//   * line helpers for the one-item-per-line fields.
// Run: node tests/metro/metro-ui.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const SRC = path.join(__dirname, '..', '..', 'frontend', 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

;(async () => {
  const api = await import(pathToFileURL(path.join(SRC, 'api.js')).href)
  assert(JSON.stringify(api.fromLines(' a \n\n b\n')) === JSON.stringify(['a', 'b']), 'fromLines trims and drops empty lines')
  assert(api.toLines(['a', 'b']) === 'a\nb' && api.toLines(null) === '', 'toLines joins, and survives a missing list')

  const app = read('MetroApp.jsx')
  assert(/<CampaignsTab/.test(app) && /<LeadsTab/.test(app) && /<SettingsTab/.test(app), 'Campaigns, Leads and Settings are mounted')
  assert(/crm:/.test(app) && !/senders:\s*['"]/.test(app) && /<SendersTab/.test(app), 'CRM is still a placeholder; Senders is a real tab from Phase 2')

  const leads = read('components', 'LeadsTab.jsx')
  assert(/WHAT YOU SEE RUNS/.test(leads) && /ticked\.size > 0 \? \{ n: ticked\.size, what: 'ticked' \} : \{ n: data\.total, what: 'shown' \}/.test(leads),
    'scope = the ticked rows, else the rows the filters show')
  assert(/Enrich \$\{eligible\} ticked/.test(leads) && /Enrich all \$\{eligible\} shown/.test(leads), 'the Enrich button carries the number it would process (F2: "Enrich all N shown" / "Enrich N ticked")')
  assert(/<Btn small kind="ghost" onClick=\{enrich\}[^>]*data-testid="enrich-btn"/.test(leads), 'Enrich is live from Phase 2 and still carries its number')
  // P3: Write is live (Write chains) and Send exports files; Metro itself still sends nothing (Phase 4-5).
  assert(/<Stage n="3" title="Write"/.test(leads) && /data-testid="write-chains"/.test(leads), 'Write is live from Phase 3 (Write chains)')
  assert(/<Stage n="4" title="Send"/.test(leads) && /Metro itself sends nothing yet \(Phase 4-5\)/.test(leads), 'the Send card exports and says that Metro sends nothing yet')
  assert(!/\/send|method: 'POST'.*send/i.test(leads), 'the Leads tab never calls a send route')

  const imp = read('components', 'ImportDialog.jsx')
  assert(/send\(false\)/.test(imp) && !/dry_run/.test(imp) && !/Preview/.test(imp) && /import-file\?/.test(imp),
    'F4: the import dialog has no preview step: one Import button for every CSV (the backend stops a file that looks wrong)')
  assert(/res\.summary\.headline/.test(imp) && !/JSON\.stringify/.test(imp), 'F4: the result is said in words, never as JSON')

  const set = read('components', 'SettingsTab.jsx')
  assert(/Suppress<\/Btn>/.test(set) && /Not a client<\/Btn>/.test(set) && /candidates\/\$\{id\}\/decision/.test(set),
    'Settings: each Upwork-derived domain is approved or rejected one by one')
  assert(/Nothing is suppressed until you approve it/.test(set), 'Settings says nothing is suppressed until approved')

  const camps = read('components', 'CampaignsTab.jsx')
  assert(/Metro never edits LinkedIn/.test(camps) && /Start campaign/.test(camps) && /checklist\/\$\{it\.key\}/.test(camps),
    'Campaigns: launch checklist, Start campaign, and the "never edits LinkedIn" note')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
