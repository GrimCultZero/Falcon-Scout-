// Validate the preview-window check against the 253 real sent proposals it was
// derived from. The check's logic is LIFTED OUT OF JobDetail.jsx at runtime, so
// this test cannot drift from what actually ships.
//
// What is being verified is not "does it run" but "does it still separate the
// letters that got opened from the ones that did not". If a future edit to the
// generic-word list or the character window quietly destroys that separation,
// the check would keep firing and keep looking sensible while measuring nothing.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
// Built on demand from the local DB. Deliberately NOT committed: it holds real
// client job postings and sent letters, and upwork_jobs.db is gitignored for the
// same reason. Regenerate with: python tools/dump_letters_fixture.py
const DATA = path.join(__dirname, '.letters.json');
if (!fs.existsSync(DATA)) {
  try {
    require('child_process').execFileSync(
      'python', [path.join(__dirname, '..', 'tools', 'dump_letters_fixture.py')],
      { stdio: 'inherit' });
  } catch (e) {
    console.log('SKIP  no corpus available — run: python tools/dump_letters_fixture.py');
    console.log('      (it needs upwork_jobs.db, which is not in the repo)');
    process.exit(0);
  }
}

// ── lift the shipped logic ────────────────────────────────────────────────
// CRLF -> LF first: this repo checks out CRLF and an un-normalised '\n  }\n'
// probe silently matches nothing (caught twice while building the pager tests).
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('const _PREVIEW_CHARS = 180');
const end = src.indexOf('const previewNotSpecific =', start);
if (start === -1 || end === -1) {
  console.log('FAIL  could not locate the preview check in JobDetail.jsx — did it move or get renamed?');
  process.exit(1);
}
const logic = src.slice(start, end);

const build = new Function('text', '_postingOnlyLower', `
  ${logic}
  return { count: _previewSpecificWords.length, words: _previewSpecificWords, min: _PREVIEW_MIN_SPECIFIC };
`);

// ── run it over the real corpus ───────────────────────────────────────────
const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const OPENED = new Set(['viewed', 'replied', 'interviewing', 'hired']);

const bands = { '0-1': [0, 0], '2-3': [0, 0], '4-6': [0, 0], '7+': [0, 0] };
let sumOpened = 0, nOpened = 0, sumNot = 0, nNot = 0, wouldFire = 0;

for (const r of rows) {
  const { count } = build(r.text, (r.posting || '').toLowerCase());
  const opened = OPENED.has(r.status);
  const band = count <= 1 ? '0-1' : count <= 3 ? '2-3' : count <= 6 ? '4-6' : '7+';
  bands[band][0]++;
  if (opened) bands[band][1]++;
  if (opened) { sumOpened += count; nOpened++; } else { sumNot += count; nNot++; }
  if (count < 4) wouldFire++;
}

const meanOpened = sumOpened / nOpened;
const meanNot = sumNot / nNot;

console.log(`corpus: ${rows.length} real sent proposals\n`);
console.log('band   n     opened');
for (const [k, [n, o]] of Object.entries(bands)) {
  console.log(`${k.padEnd(6)} ${String(n).padStart(3)}   ${n ? (o / n * 100).toFixed(1) : '0.0'}%`);
}
console.log(`\nmean specific words — opened ${meanOpened.toFixed(2)} | not opened ${meanNot.toFixed(2)}`);
console.log(`check would fire on ${wouldFire}/${rows.length} (${(wouldFire / rows.length * 100).toFixed(0)}%) of past letters\n`);

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

// The separation must survive, in the same direction and rough magnitude as the
// analysis that justified building this (3.46 vs 2.33).
assert(meanOpened > meanNot,
  `opened letters score higher than unopened (${meanOpened.toFixed(2)} > ${meanNot.toFixed(2)})`);
assert(meanOpened - meanNot > 0.7,
  `separation is still substantial (gap ${(meanOpened - meanNot).toFixed(2)} > 0.7)`);
// The worst band must still be the worst; a scoring change that flattens this
// means the measure has stopped tracking what it was built to track.
const rate = (k) => bands[k][0] ? bands[k][1] / bands[k][0] * 100 : 0;
assert(rate('0-1') < rate('2-3'), `0-1 band opens worse than 2-3 (${rate('0-1').toFixed(1)}% < ${rate('2-3').toFixed(1)}%)`);
assert(rate('7+') > rate('0-1') * 1.5, `7+ band opens far better than 0-1 (${rate('7+').toFixed(1)}% vs ${rate('0-1').toFixed(1)}%)`);
// A check that fires on everything is noise; one that never fires is dead.
assert(wouldFire > rows.length * 0.2 && wouldFire < rows.length * 0.95,
  `fire rate is informative, not degenerate (${(wouldFire / rows.length * 100).toFixed(0)}%)`);

// The standing opener must be caught — it is the specific failure this exists for.
const standing = build(
  '12 years running Google Ads, Google Premier Partner 2026. I would start by auditing what is already in place.',
  'shopify jewelry store merchant center feed google ads setup');
assert(standing.count < 4, `the standing "12 years running Google Ads…" opener fails the check (scored ${standing.count})`);

// A genuinely specific opener must pass.
const good = build(
  "i saw you're scaling retail and hospitality across three Charlotte locations and a WooCommerce store with a wellness product line",
  'retail hospitality charlotte woocommerce wellness product line google ads');
assert(good.count >= 4, `a client-specific opener passes (scored ${good.count}: ${good.words.join(', ')})`);

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
