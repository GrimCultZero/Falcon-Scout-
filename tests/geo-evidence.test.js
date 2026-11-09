// When may "United States only" disqualify a job? (audit 2026-10-29, T20 step 4)
//
// The analyser treats a US-only location as a hard disqualifier, so a false flag turns
// a good job into a SKIP. A US-only reading now only counts as a restriction with
// evidence AND a read under 24 h old; otherwise the analyser is told the location is
// "unverified" (and must not SKIP on it). lib/geoEvidence.js holds that rule; this
// feeds it jobs and checks it is wired into the analyser, and ONLY the analyser: the
// letter generator in the same file is not touched.
//
// Run: node tests/geo-evidence.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');

(async () => {
  const { geoVerdict, geoPromptValue, isUsOnlyValue, GEO_FRESH_HOURS } = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'geoEvidence.js')).href);
  const NOW = Date.parse('2026-11-09T12:00:00Z');
  const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
  const us = (extra = {}) => ({ geo_restriction: 'United States only', geo_evidence: 'Only freelancers located in the U.S. may apply', geo_read_at: hoursAgo(1), ...extra });

  assert(GEO_FRESH_HOURS === 24, 'the evidence window is 24 hours');
  assert(['United States only', 'US only', 'USA only', 'U.S. only', 'us only'].every(isUsOnlyValue) && !isUsOnlyValue('Worldwide') && !isUsOnlyValue('Canada only') && !isUsOnlyValue(null),
    'US-only values are recognised; Worldwide, other countries and null are not');

  let v = geoVerdict(us(), NOW);
  assert(v.usOnly && v.verified && !v.unverified, 'US-only WITH evidence, read 1 h ago -> VERIFIED (a real hard disqualifier)');
  assert(geoVerdict(us({ geo_read_at: hoursAgo(23.9) }), NOW).verified, '…still verified at 23.9 h');
  v = geoVerdict(us({ geo_read_at: hoursAgo(24.1) }), NOW);
  assert(v.unverified && !v.verified && /limit 24 h/.test(v.why), 'read 24.1 h ago -> UNVERIFIED (the reading is too old)');
  v = geoVerdict({ geo_restriction: 'United States only' }, NOW);
  assert(v.unverified && /no evidence/.test(v.why), 'a pre-T20 row (no evidence, no read time) -> UNVERIFIED');
  v = geoVerdict(us({ geo_evidence: '   ' }), NOW);
  assert(v.unverified, 'blank evidence is no evidence');
  v = geoVerdict(us({ geo_read_at: null }), NOW);
  assert(v.unverified && /no read time/.test(v.why), 'evidence but no read time -> UNVERIFIED');
  v = geoVerdict(us({ geo_read_at: 'not a date' }), NOW);
  assert(v.unverified, 'an unparseable read time -> UNVERIFIED');
  v = geoVerdict(us({ geo_read_at: hoursAgo(-3) }), NOW);
  assert(v.unverified, 'a read time in the future (clock skew) -> UNVERIFIED, not trusted');
  v = geoVerdict({ geo_restriction: 'Worldwide', geo_evidence: 'x', geo_read_at: hoursAgo(1) }, NOW);
  assert(!v.usOnly && !v.verified && !v.unverified, 'Worldwide is never US-only, verified or not');
  assert(!geoVerdict({}, NOW).usOnly && !geoVerdict(null, NOW).usOnly, 'no restriction / no job -> nothing');

  // the line the analyser is given
  assert(geoPromptValue(us(), NOW) === 'United States only', 'verified US-only -> the prompt says "United States only" (the hard disqualifier fires)');
  const unver = geoPromptValue(us({ geo_evidence: null }), NOW);
  assert(/^location unverified/.test(unver) && /NOT a restriction and NOT a disqualifier/.test(unver) && /Location unverified: check the job page/.test(unver),
    'unverified US-only -> the prompt says "location unverified", that it is NOT a disqualifier, and asks for a flag');
  assert(!/United States only/.test(geoPromptValue(us({ geo_read_at: hoursAgo(48) }), NOW).replace(/"United States only" reading/, '')), '…and the unverified wording does not repeat the restriction as a fact');
  assert(geoPromptValue({ geo_restriction: 'Worldwide' }, NOW) === 'Worldwide' && geoPromptValue({}, NOW) === 'none', 'Worldwide and "nothing known" pass through unchanged');

  // wiring in JobDetail.jsx: analyser only
  const jd = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
  assert(/import \{ geoVerdict, geoPromptValue \} from '\.\.\/lib\/geoEvidence'/.test(jd), 'JobDetail imports the evidence rule');
  assert(/`Freelancer geo restriction: \$\{geoPromptValue\(job\)\}`/.test(jd), "the analyser's job summary uses geoPromptValue (not the raw field)");
  assert(/does NOT trigger this rule/.test(jd), 'the HARD DISQUALIFIERS text says an unverified location does not trigger rule 1');
  assert(/geoVerdict\(job\)\.verified \|\|/.test(jd) && !/united states only\|us only\|usa only\)\\b\/i\.test\(String\(job\.geo_restriction/.test(jd),
    'the PPC-audit override only treats a VERIFIED US-only as a real disqualifier');
  assert(/geoVerdict\(job\)\.unverified \? `\$\{job\.geo_restriction\} \(unverified\)`/.test(jd), 'the Location chip says "(unverified)" instead of showing a flat red US-only');
  // the diff against HEAD is small and stays out of the generator
  let diff = '';
  try { diff = execSync('git diff -U0 HEAD -- frontend/src/components/JobDetail.jsx', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { diff = ''; }
  if (diff) {
    const changed = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l));
    assert(changed.length <= 14, `JobDetail.jsx changes are small (${changed.length} changed lines vs HEAD)`);
    assert(changed.every((l) => /geo|Geo|geoVerdict|geoPrompt|Location|unverified|import \{/.test(l)), 'every changed line is about the geo rule (nothing in the letter generator)');
  } else {
    console.log('SKIP  JobDetail diff checks (already committed, or git unavailable)');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
