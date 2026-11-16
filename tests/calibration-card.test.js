// Dashboard "Calibration" card (audit 2026-10-29, T9): the rate wording and the wiring.
// Run: node tests/calibration-card.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

(async () => {
  const { rateText, isLowSample, verdictOrder } = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'calibration.js')).href);

  assert(rateText({ n: 9, reply_rate: 55.5, open_rate: 70 }, 'reply') === 'n=9', 'n = 9: no percentage, only n');
  assert(rateText({ n: 10, reply_rate: 40, open_rate: 70 }, 'reply') === '40%' && rateText({ n: 10, reply_rate: 40, open_rate: 70 }, 'open') === '70%', 'n = 10: reply and open rate shown');
  assert(rateText({ n: 12, reply_rate: null, open_rate: null }, 'reply') === 'n=12', 'a missing rate from the server is never invented');
  assert(rateText(null, 'reply') === 'n=0', 'no cell -> n=0');
  assert(isLowSample({ n: 29 }) && !isLowSample({ n: 30 }) && isLowSample(null), 'n < 30 is a low sample');
  assert(verdictOrder([{ key: 'SKIP' }, { key: 'ZZZ' }, { key: 'APPLY' }, { key: 'MAYBE' }]).map(c => c.key).join() === 'APPLY,MAYBE,SKIP,ZZZ', 'verdicts are listed APPLY, MAYBE, SKIP, then anything new');

  const card = read('frontend', 'src', 'components', 'CalibrationCard.jsx');
  const dash = read('frontend', 'src', 'components', 'Dashboard.jsx');
  const vite = read('frontend', 'vite.config.js');
  assert(/fetch\('\/calibration'\)/.test(card), 'the card reads /calibration (snapshots only, server side)');
  assert(/data\.regimes\.map/.test(card) && /data-regime=\{r\.regime\}/.test(card), 'every regime is drawn on its own, never pooled');
  assert(/Reply rate/.test(card) && card.indexOf('reply-rate') < card.indexOf('open-rate') && /fontWeight: 700, fontSize: 14 \}\} data-testid="reply-rate"/.test(card), 'reply rate is the headline (bold, larger), open rate secondary');
  assert(/low sample/.test(card) && /data\.caption/.test(card) && /data\.declined_note/.test(card), 'the card shows "low sample", the caption and the declined note');
  assert(/import CalibrationCard from '\.\/CalibrationCard'/.test(dash) && /<CalibrationCard active=\{active\} \/>/.test(dash) && /among jobs you applied to/.test(dash), 'the Dashboard shows the card, titled as "among jobs you applied to"');
  assert(/'\/calibration': 'http:\/\/localhost:8000'/.test(vite), 'the dev proxy forwards /calibration');
  assert(!/\/calibration|CalibrationCard|lib\/calibration|(?<!last_)analysis_json/.test(read('frontend', 'src', 'components', 'JobDetail.jsx')), 'JobDetail.jsx (the generator) does not touch calibration');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
