// Header "Hidden by focus: N" chip (SEO/GEO/Google Ads focus test, owner 2026-11-19).
// Pure logic (lib/focusTestChip.js) only -- the component itself is a thin wrapper,
// same pattern as backup-chip.test.js.
//
// Run: node tests/focus-test-chip.test.js
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const lib = (f) => import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', f)).href);

(async () => {
  const { focusTestChipState } = await lib('focusTestChip.js');

  assert(focusTestChipState(null) === null, 'no response at all (backend down / endpoint missing) -> no chip, not a crash');
  assert(focusTestChipState({ active: false, hidden_count: 12 }) === null, 'the test is not active -> no chip, whatever the count says (it expired on its own)');

  let s = focusTestChipState({ active: true, hidden_count: 0 });
  assert(s && s.label === 'Hidden by focus: 0', 'active, nothing hidden yet -> the chip still shows, at 0');

  s = focusTestChipState({ active: true, hidden_count: 1 });
  assert(s.label === 'Hidden by focus: 1' && /1 off-lane job so far/.test(s.title) && !/jobs so far/.test(s.title), 'singular "job" in the tooltip at exactly 1');

  s = focusTestChipState({ active: true, hidden_count: 37 });
  assert(s.label === 'Hidden by focus: 37' && /37 off-lane jobs/.test(s.title), 'plural "jobs" and the count both appear in the tooltip');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
