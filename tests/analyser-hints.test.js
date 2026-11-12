// The letter generator never refuses, and reads only filtered analyser hints
// (owner decision 2026-11-12: "I don't want generator to refuse me in creating any messages
// ... If any hints from analyzer are useful ... make him read them").
//
// Until then generate() fetched /jobs/{id}/analysis on a route that did not exist (405), so
// it never saw an analysis and its SKIP gate ("Skip - ... Not applying on this one") was
// dead code. Now: the route exists; the gate is gone; the verdict and score are never put in
// the letter prompt; the system prompt tells the model to ALWAYS write the letter and how to
// use "ANALYSER NOTES"; lib/analyserHints.js passes only scope / fit observations. The lines
// below are REAL analyser output from upwork_jobs.db (2026-11-12).
//
// Run: node tests/analyser-hints.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');

(async () => {
  const { isLetterHint, letterHintLines, analyserHintsBlock, MAX_HINTS } = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'analyserHints.js')).href);

  // ── what is dropped ─────────────────────────────────────────────────────────
  const dropped = [
    "Client historical avg rate $7.74/hr is far below Artem's $30/hr floor.",
    'Rate ceiling $10/hr is below the $15/hr hard minimum (disqualifier)',
    'Rate not specified - cannot assess rate-floor risk',
    "Budget figure ($$5) looks anomalous - verify before bidding",
    'Light boost competition (4 boosters, top bid 25 connects) - the field is not boosting hard',
    'Client already interviewing 6 candidates - funnel heavily shortlisted',
    'Client is payment-verified with $6.7K spent, a 5.0 rating and a $34.89/hr historical avg',
    'Client has 0 reviews and $0 spent - no hiring or payment history, unproven buyer',
    'Client is US-based but there is no freelancer geo restriction, so Artem can apply',
    'Payment NOT verified and client has 0 reviews: hard disqualifier',
    'The analyser scored this 0-1 on money grounds, which the test-week rules forbid. Fit was NOT assessed: press Re-analyse.',
    'Analysed under the test-week money rules (relaxed until 2026-11-17).',
    'Verdict auto-corrected: analyser produced a rate-floor-based SKIP on a PPC/Google Ads audit job',
    'CHEAP PAYER, DRAMATIC DOWNGRADE (test-week rule): this client has paid an average of $7/hr',
    'Strong fit, score 8: APPLY',
    'short',
  ];
  for (const l of dropped) assert(!isLetterHint(l), `dropped: ${l.slice(0, 70)}`);

  // ── what is kept (real scope / fit notes) ───────────────────────────────────
  const kept = [
    'Primary deliverable is guest post/journalist/podcast OUTREACH - Artem does not do prospecting/pitching/PR work (fundamental scope mismatch)',
    "No technical SEO component - job is purely off-site/link acquisition, outside Artem's on-site technical lane",
    'Requires tools/platforms Artem does not use: Qwoted, Featured, Help a B2B Writer, podcast booking',
    'Posting mentions Facebook as a keyword but lists no Meta responsibilities; if Meta comes up, use the standard Meta disclosure and lead with Google Search',
    'Core lane: Google Ads Search/PMax lead-gen management plus GA4/GTM conversion tracking, which Artem does at Premier Partner level',
    'Vertical proof: FridgeFix local-service Ads (-92% cost/conversion, +1,405% conversions) and Atlant lead-gen back up the pitch',
  ];
  for (const l of kept) assert(isLetterHint(l), `kept: ${l.slice(0, 70)}`);

  // ── building the block ──────────────────────────────────────────────────────
  const analysis = {
    verdict: 'SKIP', score: 2,
    summary: 'Outreach-heavy link building role requiring capabilities Artem does not offer (journalist pitch, podcast booking). Verdict is a clear skip at a $7.74/hr client average.',
    reasons: ['Primary deliverables are guest post outreach, journalist pitch and podcast booking.', "Client historical avg rate $7.74/hr is far below Artem's $30/hr floor."],
    flags: ["Client historical avg rate $7.74/hr is FAR below Artem's $30/hr floor - strong rate-floor risk, -3 points",
      'Requires tools/platforms Artem does not use: Qwoted, Featured, Help a B2B Writer, podcast booking',
      'Light boost competition (4 boosters, top bid 13 connects)',
      'Analysed under the test-week money rules (relaxed until 2026-11-17).'],
  };
  const block = analyserHintsBlock(analysis);
  assert(block.startsWith('ANALYSER NOTES') && /Qwoted/.test(block) && /journalist pitch/.test(block), 'the block carries the scope notes');
  assert(!/SKIP|APPLY|MAYBE|verdict:|score|\$7\.74|floor|boost|connects|test-week|\$30/i.test(block.replace(/How to use them:[\s\S]*$/, '')), 'the NOTES themselves hold no verdict, score, money, competition or test-week text');
  assert(/never facts/.test(block) && /Never mention the analyser/.test(block) && /do not apologise or hedge/.test(block) && /still write the full letter/i.test(block), 'the block tells the model how to use the notes: hints, not facts; never mention them; caution not a refusal');
  assert(letterHintLines(analysis).length === 3, 'three notes survive (two flags and the reason), de-duplicated against the summary');
  assert(analyserHintsBlock(null) === '' && analyserHintsBlock({}) === '' && analyserHintsBlock({ verdict: 'APPLY', score: 9, flags: ['Rate NOT STATED'], reasons: [] }) === '',
    'no analysis, an empty one, or one with only verdict/money content gives NO block at all');
  const many = { flags: Array.from({ length: 20 }, (_, i) => `Scope note number ${i} about the WooCommerce checkout customisation work`), reasons: [], summary: '' };
  assert(letterHintLines(many).length === MAX_HINTS, `capped at ${MAX_HINTS} notes`);
  const long = { flags: ['Scope note ' + 'x'.repeat(500)], reasons: [], summary: '' };
  assert(letterHintLines(long)[0].length <= 240, 'a long note is cut to 240 characters');
  assert(letterHintLines({ flags: ['Duplicate scope note about technical audits', 'duplicate  SCOPE note about technical audits!'], reasons: [], summary: '' }).length === 1, 'duplicates are collapsed');

  // ── generate(): no gate, no verdict in the prompt, always-write instructions ─
  const jd = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
  const iGen = jd.indexOf('const generate = async (adjustmentsArg');
  const gen = jd.slice(iGen);
  assert(iGen > 0, 'found generate()');
  assert(!/Skip —|Not applying on this one|skipOverride/.test(gen), 'generate() has no SKIP gate, no "Skip" pass-note path and no skipOverride');
  assert(!/storedAnalysis\??\.verdict|storedAnalysis\??\.score|Analyser verdict:/.test(jd), 'the verdict and the score are never read from the stored analysis, and never put in the prompt');
  assert(/analyserHintsBlock\(storedAnalysis\)/.test(gen) && /import \{ analyserHintsBlock \} from '\.\.\/lib\/analyserHints'/.test(jd), 'the job context gets only the filtered hints block');
  assert(/ALWAYS WRITE THE LETTER/.test(gen) && /Write a "Skip", pass or "not applying" note instead of the letter/.test(gen), 'the system prompt says always write the letter and forbids a pass note');
  assert(!/IF THE VERDICT IS SKIP|SHORT PASS NOTE|CHECK THE ANALYSER VERDICT/.test(jd), 'the old "if the verdict is SKIP write a pass note" instructions are gone');
  assert(/NEVER do any of the following on ANY job/.test(gen) && !/on a MAYBE or APPLY job/.test(gen), 'the never-refuse list now applies to every job, not only MAYBE/APPLY');

  // ── the analyser side is unchanged by this ──────────────────────────────────
  assert(/HARD DISQUALIFIERS — if any apply, score MUST be 0/.test(jd), 'the analyser keeps its own hard-disqualifier wording (that is the analyser\'s business; the generator no longer reads it)');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
