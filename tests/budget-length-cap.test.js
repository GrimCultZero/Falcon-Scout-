// Validate the budget-based length cap against the real sent-letter history.
// The check's logic is lifted OUT OF JobDetail.jsx at runtime, same pattern as
// preview-specificity.test.js, so this cannot drift from what actually ships.
//
// This is a compliance check, not a correlational one (unlike the preview
// check, which exists BECAUSE it predicts outcomes). There is no claim here
// that short letters reply better — the prompt rule already exists and has for
// three months; the only question is whether the deterministic check correctly
// flags the cases where the model ignored it.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
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

const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('const _budgetLengthNum = job?.fixed_budget');
const end = src.indexOf('if (overBudgetLengthCap)', start);
if (start === -1 || end === -1) {
  console.log('FAIL  could not locate the budget-length check in JobDetail.jsx — did it move or get renamed?');
  process.exit(1);
}
const logic = src.slice(start, end);

const build = (text, fixed_budget) => {
  const job = { fixed_budget };
  const f = new Function('text', 'job', `
    ${logic}
    return { isSmall: _isSmallFixedJob, words: _draftWordCount, fires: overBudgetLengthCap };
  `);
  return f(text, job);
};

const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const smallFixed = rows.filter(r => {
  const n = parseFloat(String(r.fixed_budget || '').replace(/[^0-9.]/g, ''));
  return r.fixed_budget && n > 0 && n < 1000;
});

console.log(`corpus: ${rows.length} letters, ${smallFixed.length} sub-$1000 fixed-price\n`);

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

let flagged = 0, compliant = 0;
for (const r of smallFixed) {
  const res = build(r.text, r.fixed_budget);
  if (res.fires) flagged++; else compliant++;
}
console.log(`of ${smallFixed.length} sub-$1000 fixed-price letters: ${flagged} flagged over-length, ${compliant} within the cap\n`);

// This is the finding that justified building the check: the rule has been
// prompt-only since 2026-06-16 and is not holding on a meaningful share of
// past letters. If a future prompt change fixes compliance, this number drops
// — that is a GOOD outcome, but re-confirm it rather than silently loosening
// the assertion, since a falling flag rate could also mean the check broke.
assert(smallFixed.length > 10, `enough sub-$1000 fixed-price history to judge this (n=${smallFixed.length})`);
assert(flagged > 0, `the check catches real historical non-compliance (${flagged} flagged)`);

// ── behavioural cases ──────────────────────────────────────────────────────
const short = 'x '.repeat(150).trim();   // 150 words
const long = 'x '.repeat(300).trim();    // 300 words

assert(build(short, '500').fires === false, 'a 150-word letter on a $500 fixed job passes');
assert(build(long, '500').fires === true, 'a 300-word letter on a $500 fixed job is flagged');
assert(build(long, '1500').fires === false, 'a 300-word letter on a $1500 fixed job is NOT flagged (cap only applies under $1000)');
assert(build(long, null).fires === false, 'a 300-word letter with no fixed_budget (hourly/unspecified) is NOT flagged');
assert(build(long, '').fires === false, 'an empty fixed_budget string is treated as unspecified, not $0');
assert(build(long, '$999').fires === true, 'a "$999" budget string parses correctly and still flags');
assert(build('x '.repeat(210).trim(), '500').fires === false,
  'a 210-word letter (just over the stated 200-word target) does NOT fire — the check has margin, it is not a hair-trigger');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
