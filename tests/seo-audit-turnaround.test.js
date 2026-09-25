// "Audit delivered within 1 working day" on a TECHNICAL SEO audit (job 16252,
// 2026-09-25). "1 working day" is the Google Ads audit's turnaround only (Rule
// 402); a technical SEO audit carries no timeline in the letter (Rule 416). The
// existing strip (A) needs an SEO noun in the same sentence as "audit", so the
// bare sentence slipped through. (D) removes it — but ONLY on SEO-only postings,
// because on a PPC job the same sentence is required: 6 of the 7 such sentences in
// the sent corpus are Google Ads audits, one in a paragraph that never says
// "Google Ads". The strip is lifted out of JobDetail.jsx at runtime, like the other
// tests here, so the test can't drift from what ships.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
const DATA = path.join(__dirname, '.letters.json');
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const start = src.indexOf('const _SEO_AUDIT_TURNAROUND_RE');
const end = src.indexOf('\n}\n', src.indexOf('function _stripBareSeoAuditTurnaround')) + 3;
if (start === -1 || end < start) { console.log('FAIL  could not locate the SEO-audit turnaround strips in JobDetail.jsx'); process.exit(1); }
const { strip, bare } = new Function(`
  const console = { log() {} };
  ${src.slice(start, end)}
  return { strip: _stripSeoAuditTurnaround, bare: _stripBareSeoAuditTurnaround };
`)();
const liftRe = (marker) => {
  const l = src.split('\n').find(x => x.includes(marker));
  return eval(l.slice(l.indexOf('= /') + 2).replace(/\.test\([^)]*\)\s*$/, '').trim());
};
const SEO_SIGNAL = liftRe('const _caseSeoSignal =');
const PPC_SIGNAL = liftRe('const _casePpcSignal =');
const seoOnly = (posting) => SEO_SIGNAL.test(posting) && !PPC_SIGNAL.test(posting);
const run = (text, posting) => bare(strip(text), seoOnly(posting));

// ── job 16252, verbatim paragraph ─────────────────────────────────────────
const p16252 = "I can run a full diagnostic crawl covering schema validity, indexation state, crawl efficiency, internal-link signals, and AEO readiness, done entirely by hand, no automated tools spitting out a templated report, then hand you a prioritized findings doc that maps what's blocking visibility now vs what strengthens the AI-citation layer. Audit delivered within 1 working day.\n\nAttaching a recent technical SEO audit sample so you can see the format and depth.\n\nArtem";
const posting16252 = 'Technical SEO Specialist for Website. We need a technical SEO specialist to improve our website’s performance and search visibility. The work includes auditing the site, identifying technical issues, and implementing fixes to improve crawlability, indexing, schema and overall site health.';
const out16252 = run(p16252, posting16252);
assert(seoOnly(posting16252), 'job 16252\'s posting reads as SEO-only');
assert(!/1 working day/.test(out16252), 'job 16252: "Audit delivered within 1 working day." is removed');
assert(out16252.includes('what strengthens the AI-citation layer.\n\nAttaching a recent technical SEO audit sample'), 'the rest of the paragraph and the next one are untouched');

// ── shapes ────────────────────────────────────────────────────────────────
const SEO_POSTING = 'Technical SEO audit and fixes for our site: crawlability, indexing, schema.';
const PPC_POSTING = 'Google Ads specialist to audit and optimize our PPC campaigns.';
assert(run('The audit is delivered within 1 working day as a prioritised findings doc: what\'s broken and the fix order.', SEO_POSTING)
  === 'The audit is delivered as a prioritised findings doc: what\'s broken and the fix order.', 'a sentence that goes on keeps its description and loses only the day-count');
assert(run('Fee:\nAudit delivered within 2 working days.', SEO_POSTING) === 'Fee:', 'a bare sentence on its own line after a label goes');
assert(run('I can run a technical SEO audit, delivered within 2 working days.', SEO_POSTING) === 'I can run a technical SEO audit.', 'the comma form ("technical SEO audit, delivered within…") is caught by (A)');
const ppcLetter = "Ready to audit your account and hand you a prioritised action plan. Audit delivered within 1 working day. I'm attaching a sample of a recent Google Ads audit so you can see the format and depth.";
assert(run(ppcLetter, PPC_POSTING) === ppcLetter, 'on a PPC posting the Google Ads "1 working day" stays (Rule 402)');
assert(run(ppcLetter, SEO_POSTING) === ppcLetter, 'on an SEO posting it still stays when its paragraph names Google Ads');
assert(run('Audit delivered within 1 working day.', 'Google Ads and SEO support for our store — PPC plus technical SEO.') === 'Audit delivered within 1 working day.', 'a mixed SEO + PPC posting is never touched');
const clean = 'I\'d map crawl and indexation first, then schema.\n\nArtem';
assert(run(clean, SEO_POSTING) === clean, 'a letter with no turnaround comes back identical');

// ── the corpus ────────────────────────────────────────────────────────────
if (fs.existsSync(DATA)) {
  const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const BARE_RE = /(^|[.!?]\s+|\n)(?:the\s+)?(?:full\s+|complete\s+)?audit\s+(?:is\s+|will\s+be\s+|gets\s+)?(?:delivered|ready|done|completed?|turned\s+around)\s+(?:in|within)\s+\d/i;
  let bareLetters = 0, changed = 0, keptPpc = 0;
  for (const r of rows) {
    const t = r.text || '';
    if (!BARE_RE.test(t)) continue;
    bareLetters++;
    const out = bare(t, seoOnly(r.posting || ''));
    if (out !== t) { changed++; console.log(`      would change [${r.status}] ${(r.posting || '').slice(0, 80).replace(/\s+/g, ' ')}`); }
    else keptPpc++;
  }
  console.log(`\ncorpus: ${bareLetters} sent letters carry a bare "audit delivered within N days" sentence; the strip changes ${changed}`);
  // 2026-09-25: 7 such letters, 6 on Google Ads postings. None may lose its required turnaround.
  assert(bareLetters >= 1 && changed <= 1, `the bare strip leaves the Google Ads letters alone (${keptPpc} kept, ${changed} changed)`);
} else {
  console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
}

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
