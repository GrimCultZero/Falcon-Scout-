// "Top 3%" is not a claim the app may make about Artem (owner decision 2026-11-16): the credential is
// "Google Premier Partner", nothing more. The old analyser prompt said "Top 3% globally", the analyser repeated it
// in its notes (70 stored analyses carry it), and those notes can reach a letter as hints.
// Pinned: no prompt, guard, library, backend or extension source contains the phrase; the analyser still names
// the Premier Partner credential; and the hint path strips the phrase from old stored analyses.
// Run: node tests/no-top3-claim.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.venv', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

(async () => {
  // top 3 %, Top 3%, top-3%, TOP 3 % ... and the spelled-out forms
  const CLAIM = /top[ -]?3\s?%|top\s+three\s+percent|top\s+3\s+percent/i;
  const files = [
    ...walk(path.join(ROOT, 'frontend', 'src'), ['.js', '.jsx']),
    ...walk(path.join(ROOT, 'api'), ['.py']),
    ...walk(path.join(ROOT, 'upwork-enricher'), ['.js']),
    path.join(ROOT, 'cli-bridge.js'),
  ].filter(f => fs.existsSync(f));
  // Metro's campaign briefs carry "Top 3% of Google Partners" as a DO NOT CLAIM entry (owner's brief, 2026-11-25).
  // These two files only list it as forbidden; they never say it.
  const FORBIDDEN_LIST = [path.join('frontend', 'src', 'metro', 'lib', 'templates.js'), path.join('api', 'metro', 'briefdraft.py')];
  const hits = files.filter(f => !FORBIDDEN_LIST.includes(path.relative(ROOT, f)))
    .filter(f => CLAIM.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f));
  for (const f of FORBIDDEN_LIST) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const rest = src.split(/\r?\n/).filter(l => !/do_not_claim|DO_NOT_CLAIM|['"]Top 3% of Google Partners['"]/i.test(l)).join('\n');
    assert(!CLAIM.test(rest), `${f} mentions Top 3% only inside the do-not-claim list`);
  }
  assert(files.length > 40, `scanned ${files.length} prompt / guard / lib / backend / extension sources`);
  assert(hits.length === 0, `no source contains "Top 3%" (found in: ${hits.join(', ') || 'none'})`);

  const jd = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');
  assert(/- Google Premier Partner 2026\. This credential is SPECIFIC TO GOOGLE ADS/.test(jd), 'the analyser profile still names the credential: "Google Premier Partner 2026"');

  const H = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'analyserHints.js')).href);
  // real phrasings from the stored analyses
  const stored = [
    'Google Premier Partner 2026 (Top 3% globally) credential is a strong differentiator on a Google Ads job',
    'Premier Partner 2026 status (Top 3% globally) is a direct differentiator for Google Ads work',
    'Google Premier Partner 2026 (top 3% globally) + attached audit sample differentiate it in a crowded pool',
    'Google Premier Partner 2026 — Top 3% globally. Cite it on Ads jobs.',
    'Premier Partner (Top 3%) helps here',
  ];
  for (const s of stored) {
    const out = H.withoutTopPercentClaim(s);
    assert(!CLAIM.test(out) && /Premier Partner/.test(out) && !/globally|worldwide|\(\s*\)|\(|\)/.test(out.replace(/\(Top 3%\)/i, '')), `stripped cleanly (no stray 'globally' or bracket), credential kept: ${out.slice(0, 80)}`);
    assert(!/[()]/.test(out), `no leftover bracket: ${out.slice(0, 60)}`);
  }
  const lines = H.letterHintLines({ reasons: stored.map(s => s + ' on this posting about campaigns') });
  assert(lines.length > 0 && lines.every(l => !CLAIM.test(l)), 'letter hints built from old stored analyses never contain the phrase');
  const block = H.analyserHintsBlock({ reasons: stored.map(s => s + ' on this posting about campaigns') });
  assert(block.length > 0 && !CLAIM.test(block), 'the analyser block that goes into the letter prompt never contains the phrase');
  assert(H.withoutTopPercentClaim('Top 5 agency results for 3% of clients') === 'Top 5 agency results for 3% of clients' && H.withoutTopPercentClaim('+3% conversions, top rated') === '+3% conversions, top rated', 'ordinary percentages and "top rated" are untouched');
  assert(H.withoutTopPercentClaim(null) === '' && H.withoutTopPercentClaim('') === '', 'empty input is safe');

  // corpus of real sent letters, when it is available locally
  const DATA = path.join(__dirname, '.letters.json');
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const sent = rows.map(r => r.sent_text || r.letter || '').filter(Boolean);
    assert(sent.every(t => !CLAIM.test(t)), `none of ${sent.length} sent letters in the corpus claims "Top 3%"`);
  } else {
    console.log('SKIP  corpus section: no tests/.letters.json');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
