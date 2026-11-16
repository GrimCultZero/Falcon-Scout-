// Dashboard "Edits before sending" card and the generation hooks (audit 2026-10-29, T10), plus the T9
// footnote that states the exact reply definition. Run: node tests/edit-ratio-card.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

(async () => {
  const { editPct, sharePct } = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'editRatio.js')).href);
  assert(editPct({ n: 5, median_edit_ratio: 0.124 }) === '12%' && editPct({ n: 5, median_edit_ratio: 0 }) === '0%', 'median edit ratio is shown as a percentage');
  assert(sharePct({ n: 5, under10_share: 60 }) === '60%' && sharePct({ n: 3, under10_share: 33.3 }) === '33%', 'share sent with under 10% edits is shown as a percentage');
  assert(editPct(null) === '-' && editPct({ n: 0, median_edit_ratio: null }) === '-' && sharePct({ n: 0, under10_share: null }) === '-', 'no data -> a dash, never 0%');

  const card = read('frontend', 'src', 'components', 'EditRatioCard.jsx');
  const dash = read('frontend', 'src', 'components', 'Dashboard.jsx');
  const vite = read('frontend', 'vite.config.js');
  const jd = read('frontend', 'src', 'components', 'JobDetail.jsx');
  const cal = read('frontend', 'src', 'components', 'CalibrationCard.jsx');
  assert(/fetch\('\/generations\/stats'\)/.test(card) && /data-n=\{c\.n\}/.test(card) && /low sample/.test(card), 'the card reads /generations/stats, shows n per row and "low sample"');
  assert(/import EditRatioCard from '\.\/EditRatioCard'/.test(dash) && /<EditRatioCard active=\{active\} \/>/.test(dash), 'the Dashboard shows the card');
  assert(/'\/generations': 'http:\/\/localhost:8000'/.test(vite), 'the dev proxy forwards /generations');

  // hooks: every way a letter lands in the textarea records it; none can break the letter
  assert(/function _recordGeneration\(jobId, kind, text, model(?:, bomb = null)?\)/.test(jd) && /fetch\('\/generations', \{\s*method: 'POST'/.test(jd) && /\.catch\(\(\) => \{\}\)/.test(jd.slice(jd.indexOf('function _recordGeneration'), jd.indexOf('function _recordViolations'))), 'the recorder is a fire-and-forget POST that swallows every failure');
  assert(/_recordGeneration\([^)]*coreOnly \? 'rescan' : 'generate', _finalText/.test(jd), 'generate and rescan are recorded where the finished letter is set');
  assert(/_recordGeneration\(job\?\.id, 'chat', _t/.test(jd), 'a chat rewrite is recorded as kind "chat"');
  assert(/\^Error generating cover letter/.test(jd), 'an error message is never recorded as a letter');

  // T9 footnote
  assert(/data\.definition_note/.test(cal) && /data-testid="definition-note"/.test(cal) && cal.indexOf('data.definition_note') > cal.indexOf('data.regimes.map'), 'the Calibration card shows the definition footnote below the tables');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
