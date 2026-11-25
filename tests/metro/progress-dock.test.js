// Metro F2 (25 Nov 2026), the front-end rules that can be checked without a browser:
//   2. the progress dock: DevScout's 1-second rule, a filling bar when the total is known and an indeterminate one with
//      elapsed time when not, the current item named ("Enriching: Rank Media Agency, 7 of 20 - website scan"), ETA,
//      Stop only when the backend says so, one result line, and the backend (not the page) owns the runs;
//   3. the small fixes: Score FIT vs persona wording, "Enrich next 20" primary, a confirm above 50, a "just enriched"
//      filter and sort, the domain column with its reason and Retry, the Linked Helper email export on "what you see runs".
// Run: node tests/metro/progress-dock.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'frontend', 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

;(async () => {
  const pj = await import(pathToFileURL(path.join(SRC, 'lib', 'progressJobs.js')).href)
  const base = { kind: 'enrich', label: 'Enriching', status: 'running', total: 20, done: 6, failed: 0, current: 'Rank Media Agency', step: 'website scan', started_at: 1000, finished_at: null }

  // wording
  assert(pj.describeRun(base) === 'Enriching: Rank Media Agency, 7 of 20 - website scan', `the current item reads like the brief (${pj.describeRun(base)})`)
  assert(pj.describeRun({ ...base, total: 0, done: 0 }) === 'Enriching: Rank Media Agency - website scan', 'without a total there is no "x of y"')
  assert(pj.describeRun({ ...base, current: null, step: null }) === 'Enriching', 'before the first item it is just the label')
  assert(pj.describeRun({ ...base, done: 20 }) === 'Enriching: Rank Media Agency, 20 of 20 - website scan', 'never "21 of 20"')
  assert(pj.fmtDuration(12) === '12s' && pj.fmtDuration(185) === '3 min' && pj.fmtDuration(3900) === '1h 5m' && pj.fmtDuration(NaN) === null, 'durations read 12s / 3 min / 1h 5m')

  // the 1-second rule and the result line
  assert(pj.visibleRuns([base], 1000.4).length === 0, 'a run younger than a second draws nothing')
  assert(pj.visibleRuns([base], 1001.2).length === 1, 'after a second it shows')
  const fin = { ...base, status: 'done', finished_at: 1030, result: 'Enriched 20 - 17 domains found, 3 not found' }
  assert(pj.visibleRuns([fin], 1040).length === 1, 'a finished run leaves its result line')
  assert(pj.visibleRuns([fin], 1030 + pj.RESULT_SHOWN_S + 5).length === 0, 'and it goes away after a while')
  const withId = { ...fin, id: 'abc' }
  assert(pj.visibleRuns([withId], 1040, new Set(['abc'])).length === 0, 'a dismissed result stays dismissed')
  const quick = { id: 'q', kind: 'score', label: 'Scoring', status: 'done', total: 0, started_at: 1000, finished_at: 1000.3, result: 'Scored 5' }
  assert(pj.visibleRuns([quick], 1001).length === 0, 'an action that finished inside a second says nothing')
  assert(pj.visibleRuns([{ ...quick, status: 'failed', result: 'Failed: x' }], 1001).length === 1, 'a failure is always said')
  const lr = pj.createLocalRuns({ now: () => 5 })
  const id = lr.start('Building the export', { total: 3 }); lr.update(id, { done: 1 }); lr.end(id, 'Done')
  assert(lr.list()[0].status === 'done' && lr.list()[0].result === 'Done', 'page-side runs (a download) use the same shape')

  // the dock draws what the backend says
  const dock = read('components', 'ProgressDock.jsx')
  const store = read('lib', 'progressStore.js')
  assert(/api\('\/progress'\)/.test(store) && /\/progress\/\$\{id\}\/stop/.test(store) && /useProgress\(\)/.test(dock) && /stopRun\(/.test(dock), 'the dock reads GET /metro/progress (through the shared store, F4) and stops through the backend')
  assert(/addEventListener\('metro-progress'/.test(store), 'a screen that starts something announces it so the bar shows at once')
  assert(/run\.can_stop && !run\.stopping/.test(dock), 'Stop appears only when the backend says the run can be stopped')
  assert(/const indet = live && !total/.test(dock) && /metro-dock-indet/.test(dock), 'no total: an indeterminate bar')
  assert(/elapsed/.test(dock) && /left/.test(dock) && /eta/.test(dock), 'elapsed time and an estimate')
  assert(/data-testid="progress-result"/.test(dock) && /run\.result/.test(dock), 'a finished run shows its one-line result')
  assert(/localStorage/.test(dock) && /DISMISS_KEY/.test(dock), 'a dismissed result is remembered across a reload')
  assert(/#37bbd5|METRO\.cyan/.test(dock) && /METRO\.teal/.test(dock) && !/--act-scrape|--act-ai/.test(dock), 'drawn in Metro colours, not DevScout\'s')
  assert(/<ProgressDock \/>/.test(read('MetroApp.jsx')), 'the dock is mounted once, in the Metro app')

  // 3. small fixes
  const leads = read('components', 'LeadsTab.jsx')
  const enrich = read('components', 'EnrichPanel.jsx')
  assert(/Score fit \{scope\.n\} \{scope\.what\}/.test(enrich), '"Score fit N shown" (the fit score, layers 1 and 2)')
  assert(/Rescore persona \(\$\{scope\.n\} \$\{scope\.what\}\)/.test(leads), '"Rescore persona" (the layer 0 score computed on import)')
  assert(/The persona score is a different one/.test(enrich) && /Score fit in the Enrichment card/.test(leads), 'each button explains the other score')
  assert(/kind=\{remaining === 0 \? 'ghost' : 'primary'\} onClick=\{\(\) => enrichNext\(20\)\}/.test(leads), '"Enrich next 20" is the primary button on the Enrich card')
  assert(/eligible > 50 && !confirmAll/.test(leads) && /data-testid="enrich-all-confirm"/.test(leads) && /Enrich all \{confirmAll\} companies/.test(leads), '"Enrich all shown" asks for a confirm above 50 and shows the count')
  assert(/value="recent">just enriched \(last run\)/.test(leads) && /value="just_enriched">just enriched first/.test(leads), 'a "just enriched" filter and sort')
  assert(/data-testid="show-just-enriched"/.test(leads) && /l\.just_enriched/.test(leads), 'a one-click "Show just enriched" and a badge on the row')
  assert(/data-testid="domain-why"/.test(leads) && /l\.domain_why/.test(leads) && /data-testid="retry-domain-row"/.test(leads), 'each company without a domain shows why and a Retry domain button')
  assert(/retry-domain/.test(leads) && /data-testid="retry-domains"/.test(leads), 'and there is a bulk Retry domain')
  assert(/email-export`, \{ method: 'POST'/.test(enrich) && /shortlist_only: !ticked/.test(enrich) && /await targetIds\(\)|targetIds\(\)\.then/.test(enrich), 'the Linked Helper email export runs on what you see: ticked rows, else the shown rows that are shortlisted')
  assert(!/email-export`\} style/.test(enrich) && !/href=\{`\/metro\/campaigns\/\$\{campaign\.id\}\/email-export`\}/.test(enrich), 'the old whole-shortlist download link is gone')
  assert((enrich.match(/dispatchEvent\(new Event\('metro-progress'\)\)/g) || []).length >= 1 && /dispatchEvent\(new Event\('metro-progress'\)\)/.test(leads), 'starting an action announces it to the dock')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
