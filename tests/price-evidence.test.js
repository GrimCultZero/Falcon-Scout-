// Test-week money rules for the analyser (owner decision 2026-11-12).
//
// During the feed's test week (feed_config.json "test_week") low-rate, no-rate and
// unverified-payment postings are let into the feed on purpose, and Artem sends proposals
// to them anyway. The analyser used to score them 0 on money alone. lib/priceEvidence.js
// now judges the job and weighs money as evidence: an unstated rate is neutral, a client's
// average rate counts only with real history behind it, an established cheap payer is a
// dramatic downgrade (SKIP 2-3), unverified payment is capped at MAYBE, 0-1 stay for the
// real disqualifiers. This feeds the pure functions with real job shapes (the ids are rows
// in upwork_jobs.db on 2026-11-12) and checks the wiring: ANALYSER ONLY, and only while the
// test week is on. The letter generator in the same file is untouched and, today, never
// even sees the analysis (GET /jobs/{id}/analysis has no route; pinned below).
//
// Run: node tests/price-evidence.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'priceEvidence.js')).href);
  const { testWeekActive, parseSpent, priceEvidence, testWeekRateLine, testWeekFlags, testWeekPromptBlock, testWeekGuard } = L;

  // ── the switch ──────────────────────────────────────────────────────────────
  const cfg = { test_week: { from: '2026-11-10', until: '2026-11-17' } };
  const at = (iso) => Date.parse(iso);
  assert(testWeekActive(cfg, at('2026-11-12T10:00:00Z')), 'active mid-week');
  assert(testWeekActive(cfg, at('2026-11-10T00:30:00+02:00')), 'active on the first day (Kyiv time)');
  assert(testWeekActive(cfg, at('2026-11-17T21:30:00+02:00')), 'still active late on the last day: "until" is inclusive');
  assert(!testWeekActive(cfg, at('2026-11-18T00:30:00+02:00')), 'over the minute the next Kyiv day starts: the old rules are back, no manual step');
  assert(!testWeekActive(cfg, at('2026-11-09T12:00:00Z')), 'not active before "from"');
  assert(!testWeekActive({ test_week: { from: '2026-11-10', until: 'soon' } }, at('2026-11-12T10:00:00Z')), 'a malformed date never loosens the rules');
  assert(!testWeekActive({ test_week: null }, at('2026-11-12T10:00:00Z')) && !testWeekActive(null) && !testWeekActive({}), 'no block / no config means NOT active');
  assert(testWeekActive({ test_week: { until: '2026-11-17' } }, at('2026-11-12T10:00:00Z')), 'a block with only "until" works, like the backend');

  // ── parsing the spend text ──────────────────────────────────────────────────
  assert(parseSpent('$231K total spent') === 231000 && parseSpent('$315 total spent') === 315 && parseSpent('$0 total spent') === 0
    && parseSpent('$1.2M total spent') === 1200000 && parseSpent('$1,250 total spent') === 1250 && parseSpent(null) === null && parseSpent('unknown') === null,
    'parseSpent: K, M, commas, zero, unknown');

  // ── real job shapes ─────────────────────────────────────────────────────────
  const base = { payment_verified: true };
  const j23132 = { ...base, hourly_rate_min: 5, hourly_rate_max: 10, avg_rate: 7.16, client_total_spent_detail: '$62K total spent' };   // Google Ads for Fashion Store
  const j23642 = { ...base, hourly_rate_min: null, hourly_rate_max: null, fixed_budget: null, avg_rate: 6.56, client_total_spent_detail: '$231K total spent' }; // GEO/AEO, no rate
  const j23652 = { ...base, hourly_rate_min: null, hourly_rate_max: null, fixed_budget: null, avg_rate: 15.01, client_total_spent_detail: '$315 total spent' };   // no rate, noise average
  const j23015 = { payment_verified: false, hourly_rate_min: null, hourly_rate_max: null, fixed_budget: null, client_total_spent_detail: '$0 total spent' };   // unverified, no rate
  const j22952 = { ...base, fixed_budget: '$5', client_total_spent_detail: '$0 total spent' };                                                               // $5 placeholder
  const j23399 = { ...base, hourly_rate_min: 15, hourly_rate_max: 20, avg_rate: 5.03, client_total_spent_detail: '$309K total spent' };

  let e = priceEvidence(j23132, 30);
  assert(e.state === 'stated' && e.kind === 'hourly' && e.ceiling === 10 && e.statedLow, '#23132: a $10 ceiling is stated, and low');
  assert(e.strongHistory && e.cheapPayer, '#23132: $7.16/hr over $62K spent, payment verified -> established cheap payer (DRAMATIC)');
  e = priceEvidence(j23642, 30);
  assert(e.state === 'unstated' && /no rate/.test(e.why) && e.cheapPayer, '#23642: no rate + $6.56/hr over $231K -> unstated AND cheap payer (the owner\'s $7 example)');
  e = priceEvidence(j23652, 30);
  assert(e.state === 'unstated' && !e.strongHistory && !e.cheapPayer && e.weakAvg, '#23652: no rate, $15.01 on $315 spent -> noise, not evidence: neutral');
  e = priceEvidence(j23015, 30);
  assert(e.state === 'unstated' && e.paymentUnverified && !e.cheapPayer, '#23015: unverified, no rate -> unstated, payment flagged, not a cheap payer');
  e = priceEvidence(j22952, 30);
  assert(e.state === 'unstated' && /placeholder/.test(e.why), '#22952: a fixed $5 is a placeholder, so NOT STATED');
  assert(priceEvidence({ fixed_budget: '$10' }).state === 'unstated' && priceEvidence({ fixed_budget: '$11' }).state === 'stated', '$10 is a placeholder, $11 is a budget');
  assert(priceEvidence({ fixed_budget: '$100' }).state === 'stated' && priceEvidence({ fixed_budget: '$100' }).kind === 'fixed', 'a $100 fixed budget is stated');
  e = priceEvidence({ hourly_rate_min: 0, hourly_rate_max: 0 });
  assert(e.state === 'unstated' && /zero/.test(e.why), 'a zero hourly rate is NOT STATED (it used to read as "HOURLY $0-$0" and trip the $15 hard skip)');
  assert(priceEvidence({ fixed_budget: '$0' }).state === 'unstated', 'a zero fixed budget is NOT STATED');
  e = priceEvidence({ ...base, hourly_rate_max: 35, avg_rate: 8, client_total_spent_detail: '$50K total spent' }, 30);
  assert(e.postedClears && !e.cheapPayer && !e.weakAvg, 'a posted $35 ceiling clears the $30 floor: history never makes it the dramatic case (owner rule 2026-08-28)');
  e = priceEvidence({ ...base, fixed_budget: '$400', avg_rate: 7, client_total_spent_detail: '$80K total spent' }, 30);
  assert(e.kind === 'fixed' && !e.cheapPayer, 'a stated FIXED price is not judged by the hourly average (the existing FLAT-RATE EXCEPTION)');
  e = priceEvidence({ ...base, avg_rate: 22, client_total_spent_detail: '$100K total spent' }, 30);
  assert(e.strongHistory && !e.cheapPayer && !e.weakAvg, 'strong history at $22/hr is neither dramatic nor noise: the existing -2 deduction handles it');
  assert(!priceEvidence({ payment_verified: null, avg_rate: 5, client_total_spent_detail: '$90K total spent' }).cheapPayer, 'payment status unknown: not the dramatic case (verified is required)');
  assert(priceEvidence({ ...base, hourly_rate_max: 10, client_avg_hourly_rate: 6, client_total_spent_detail: '$20K total spent' }).cheapPayer, 'the average is read from client_avg_hourly_rate when avg_rate is empty');
  e = priceEvidence(j23399, 40);
  assert(e.cheapPayer && e.floor === 40, '#23399 against the $40 developer floor: $5.03/hr over $309K is the dramatic case');

  // ── what the model is told ──────────────────────────────────────────────────
  assert(/NOT STATED/.test(testWeekRateLine(priceEvidence(j23642, 30))) && /do NOT deduct/.test(testWeekRateLine(priceEvidence(j23642, 30))), 'an unstated rate is described as unknown and not to be penalised');
  assert(testWeekRateLine(priceEvidence(j23132, 30)) === null, 'a stated rate keeps the existing rate line');
  let flags = testWeekFlags(priceEvidence(j23642, 30));
  assert(flags.length === 1 && /CHEAP PAYER/.test(flags[0]) && /SKIP, score 2-3/.test(flags[0]) && /\$6\.56\/hr/.test(flags[0]) && /\$231K/.test(flags[0]) && /does NOT rescue/.test(flags[0]),
    'the owner\'s example: one flag, quotes $6.56/hr and $231K, SKIP 2-3, verified payment does not rescue it');
  flags = testWeekFlags(priceEvidence(j23652, 30));
  assert(flags.length === 2 && /only \$315 spent/.test(flags[0]) && /NO deduction/.test(flags[0]) && /NOT STATED/.test(flags[1]), '#23652: noise average and neutral rate, no deduction');
  flags = testWeekFlags(priceEvidence(j23015, 30));
  assert(flags.some((f) => /Payment NOT verified/.test(f) && /capped at MAYBE/.test(f)) && flags.some((f) => /NOT STATED/.test(f)), '#23015: unverified is capped at MAYBE and not a disqualifier');
  assert(testWeekFlags(priceEvidence({ ...base, hourly_rate_max: 60, avg_rate: 70, client_total_spent_detail: '$9K total spent' })).length === 0, 'a normal job gets no test-week flags');
  const block = testWeekPromptBlock('2026-11-17');
  assert(/SUPERSEDE/.test(block) && /HARD DISQUALIFIERS 2 and 3/.test(block) && /CRITICAL RULES/.test(block) && /2026-11-17/.test(block), 'the prompt block supersedes hard rules 2 and 3 and the KB rules, and names the end date');
  assert(/verified US-only/.test(block) && /already-hired/.test(block) && /NEVER score 0-1/.test(block), 'it keeps 0-1 for geo and already-hired only');

  // ── the backstop ────────────────────────────────────────────────────────────
  const model = (score, verdict, extra = {}) => ({ verdict, score, summary: 's', reasons: ['r'], flags: ['f'], ...extra });
  const cheap = priceEvidence(j23642, 30);
  let r = testWeekGuard(model(8, 'APPLY'), cheap, { until: '2026-11-17' });
  assert(r.parsed.score === 3 && r.parsed.verdict === 'SKIP' && r.events.includes('cheapPayerCap'), 'cheap payer scored 8 APPLY by the model -> capped to SKIP 3');
  r = testWeekGuard(model(0, 'SKIP'), cheap);
  assert(r.parsed.score === 2 && r.parsed.verdict === 'SKIP' && r.events.includes('cheapPayerFloor'), 'cheap payer scored 0 -> lifted into the fit band: SKIP 2 (a money 0 is not allowed)');
  r = testWeekGuard(model(3, 'SKIP'), cheap);
  assert(r.parsed.score === 3 && r.events.length === 0, 'cheap payer already at SKIP 3 is left alone');
  const neutral = priceEvidence(j23652, 30);
  r = testWeekGuard(model(0, 'SKIP'), neutral, { until: '2026-11-17' });
  assert(r.parsed.score === 3 && r.parsed.verdict === 'SKIP' && r.events.includes('moneyZeroFloored') && r.parsed.flags.some((f) => /Fit was NOT assessed/.test(f)),
    'a money-only 0 on a neutral job is floored to 3 and says plainly that fit was not assessed');
  r = testWeekGuard(model(6, 'MAYBE'), neutral);
  assert(r.parsed.score === 6 && r.parsed.verdict === 'MAYBE' && r.events.length === 0, 'a neutral job the model scored on fit (6 MAYBE) is NOT touched: no invented deduction, no cap');
  r = testWeekGuard(model(8, 'APPLY'), neutral);
  assert(r.parsed.score === 8 && r.parsed.verdict === 'APPLY', 'a neutral job can still be APPLY 8: a missing rate is not a penalty');
  const unv = priceEvidence(j23015, 30);
  r = testWeekGuard(model(8, 'APPLY'), unv);
  assert(r.parsed.score === 6 && r.parsed.verdict === 'MAYBE' && r.events.includes('unverifiedCap'), 'unverified payment: APPLY 8 is capped to MAYBE 6');
  r = testWeekGuard(model(5, 'MAYBE'), unv);
  assert(r.parsed.score === 5 && r.parsed.verdict === 'MAYBE', 'unverified at 5 stays 5');
  r = testWeekGuard(model(0, 'SKIP'), neutral, { realDisq: true });
  assert(r.parsed.score === 0 && r.parsed.verdict === 'SKIP' && r.events.length === 0, 'with a REAL disqualifier (verified US-only / already hired) a 0 stays a 0');
  r = testWeekGuard(model(8, 'APPLY'), cheap, { realDisq: true });
  assert(r.parsed.score === 8, 'the backstop does not run over a real-disqualifier verdict');
  const input = model(8, 'APPLY');
  const before = JSON.stringify(input);
  testWeekGuard(input, cheap);
  assert(JSON.stringify(input) === before, 'the guard works on a copy: its input is not mutated');
  r = testWeekGuard(model(7, 'APPLY'), priceEvidence({ ...base, hourly_rate_max: 60 }, 30), { until: '2026-11-17' });
  assert(r.parsed.rules === 'testweek' && r.parsed.flags.some((f) => /relaxed until 2026-11-17/.test(f)) && r.parsed.score === 7, 'every analysis made under the test week is marked (rules=testweek + one flag) so results can be split');
  r = testWeekGuard(model('n/a', 'MAYBE'), cheap);
  assert(r.parsed.verdict === 'MAYBE' && r.parsed.score === 'n/a', 'a non-numeric score is passed through untouched');

  // ── wiring in JobDetail.jsx: analyser only, test week only ──────────────────
  const jd = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
  assert(/import \{[^}]*testWeekActive[^}]*priceEvidence[^}]*testWeekGuard[^}]*\} from '\.\.\/lib\/priceEvidence'/.test(jd), 'JobDetail imports the helpers');
  assert(/await fetch\('\/feed-config'\)/.test(jd) && /const _testWeek = testWeekActive\(_twCfg\)/.test(jd), 'the analyser reads /feed-config and asks testWeekActive (a failed read means the old rules)');
  assert(/\$\{adjustments\}\$\{_testWeek \? testWeekPromptBlock\(_twUntil\) : ''\}/.test(jd), 'the block is appended LAST in the system prompt, and only in test week');
  const iGuard = jd.indexOf('testWeekGuard(parsed,');
  const iStale = jd.indexOf('if (_isStaleAnalyse()) {', iGuard);
  const iAudit = jd.indexOf("parsed.verdict = 'APPLY'");
  assert(iGuard > iAudit && iAudit > 0 && iStale > iGuard && iStale - iGuard < 900, 'the backstop runs after the PPC-audit override and before the result is shown or saved');
  assert(/if \(_twRateLine\) \{[\s\S]{0,120}rateLine = _twRateLine/.test(jd), 'an unstated rate replaces the rate line only when the helper says so');
  assert(/_twEv && \(_twEv\.cheapPayer \|\| _twEv\.weakAvg\)/.test(jd), 'in test week the generic avg-rate deductions step aside for the two cases testWeekFlags words itself');
  const iGen = jd.indexOf('const generate = async (adjustmentsArg');
  assert(iGen > 0 && !/_testWeek|priceEvidence|testWeekGuard|testWeekPromptBlock/.test(jd.slice(iGen)), 'the LETTER GENERATOR (everything from generate() on) does not reference any of it');
  // Since 2026-11-12 the generator may READ the analysis (filtered hints) but must never be
  // GATED by it: the GET route exists, and generate() has no verdict check (tests/analyser-hints.test.js).
  const main = fs.readFileSync(path.join(ROOT, 'api', 'main.py'), 'utf8');
  assert(/@app\.get\("\/jobs\/\{job_id\}\/analysis"\)/.test(main) && !/storedAnalysis\??\.verdict/.test(jd),
    'the analysis route has a GET, and generate() never branches on the stored verdict, so the analyser changes above cannot block a letter');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
