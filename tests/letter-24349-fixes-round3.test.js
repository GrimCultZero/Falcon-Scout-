// Round 3 of job-24349 fixes (owner, 2026-11-21, Task 1 — generic bugs, not just
// job 24349): remaining defects seen in the 3rd regeneration.
//   1. Missing numbered screening question -> ONE targeted repair call, insert
//      by number (insertNumberedAnswers; the repair call itself needs a live
//      backend and is exercised manually, not here).
//   2. Never append after the signature (insertBeforeSignature,
//      hasTrailingSignoff, and ensurePricingFigureWhenAsked's fixed fallback).
//   3. Strip meta sentences that leak the KB/ledger/record itself
//      (stripRecordLeakSentences).
//   4. Strip an implied-future-result admission (stripResultsComingSentences).
//   5. Repair the "): (" orphan shape directly (repairDoubleParenOrphan), and
//      the orphan guard itself now also catches it (hasOrphanPunctuation).
//
// Run: node tests/letter-24349-fixes-round3.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const SQ = await import(pathToFileURL(path.join(LIB, 'screeningQuestions.js')).href);

  // ── item 1: insertNumberedAnswers ───────────────────────────────────────
  const base1 = '1. Experience: 12 years in SEO.\n\n3. Timeline: 60-90 days.\n\nArtem';
  const withQ2 = SQ.insertNumberedAnswers(base1, [{ n: 2, text: '2. Pricing: $1,050/month, all inclusive.' }]);
  assert(withQ2 === '1. Experience: 12 years in SEO.\n\n2. Pricing: $1,050/month, all inclusive.\n\n3. Timeline: 60-90 days.\n\nArtem',
    `a missing answer is inserted at the correct numeric position (between 1 and 3): got ${JSON.stringify(withQ2)}`);
  const withQ8 = SQ.insertNumberedAnswers(base1, [{ n: 8, text: '8. Capacity: up to about 5 new accounts per month.' }]);
  assert(withQ8.endsWith('3. Timeline: 60-90 days.\n\n8. Capacity: up to about 5 new accounts per month.\n\nArtem'),
    `an answer numbered higher than everything else goes at the end, still before the signature: got ${JSON.stringify(withQ8)}`);
  assert(SQ.insertNumberedAnswers(base1, []) === base1, 'no entries -> text unchanged');
  const withTwo = SQ.insertNumberedAnswers(base1, [{ n: 5, text: '5. X: x.' }, { n: 2, text: '2. Y: y.' }]);
  assert(/2\. Y: y\.[\s\S]*5\. X: x\./.test(withTwo), `multiple entries land in numeric order regardless of input order: got ${JSON.stringify(withTwo)}`);
  // the REAL job-24349 shape: the model ran "Artem" onto the SAME paragraph as
  // the previous sentence (a single newline, not a blank-line paragraph break)
  // -- the repair call's Q8 answer landed AFTER "Artem" because the old check
  // only ever looked at "is the last paragraph EXACTLY the sign-off?".
  const mergedSignoff = '7. White-Label Partnership:\nI work under your brand.\n\nFor SEO, the flat rate is $1,050/month, all inclusive.\nArtem';
  const withQ8Merged = SQ.insertNumberedAnswers(mergedSignoff, [{ n: 8, text: '8. Pricing and Capacity: $1,050/month for SEO.' }]);
  assert(/\$1,050\/month, all inclusive\.\n\n8\. Pricing and Capacity:[\s\S]*\nArtem\s*$/.test(withQ8Merged),
    `the real job-24349 shape: Q8 still lands BEFORE the signature, even when the model ran "Artem" onto the previous sentence's paragraph: got ${JSON.stringify(withQ8Merged)}`);
  assert(/\nArtem\s*$/.test(withQ8Merged), 'the letter still ends with the signature');

  // ── item 2: hasTrailingSignoff / insertBeforeSignature ──────────────────
  assert(G.hasTrailingSignoff('Some letter text.\n\nArtem'), 'bare "Artem" as the last line is a detectable sign-off');
  assert(G.hasTrailingSignoff('Some letter text.\n\nBest,\nArtem'), '"Best,\\nArtem" is a detectable sign-off');
  assert(G.hasTrailingSignoff('Some letter text.\n\nRegards, Artem'), '"Regards, Artem" on one line is a detectable sign-off');
  assert(!G.hasTrailingSignoff('Artem here, I noticed your post.'), '"Artem" mid-sentence at the START is not a sign-off (no false positive)');
  assert(!G.hasTrailingSignoff('Some letter text with no signature at all.'), 'no sign-off -> not detected');

  const withSig = '8. Pricing: no figure stated.\n\nArtem';
  const fixed = G.insertBeforeSignature(withSig, 'For SEO, the flat rate is $1,050/month, all inclusive.');
  assert(fixed === '8. Pricing: no figure stated. For SEO, the flat rate is $1,050/month, all inclusive.\n\nArtem',
    `the addition lands in the body BEFORE the signature, never after: got ${JSON.stringify(fixed)}`);
  assert(/\nArtem\s*$/.test(fixed), 'the letter still ends with the signature');
  const noSig = '8. Pricing: no figure stated.';
  assert(G.insertBeforeSignature(noSig, 'fact.') === '8. Pricing: no figure stated.\n\nfact.', 'no detectable sign-off -> safe append as a new paragraph at the end (unchanged prior behavior)');

  // splitSignoff: the real job-24349 shape -- "Artem" run onto the SAME
  // paragraph as the previous sentence (single newline, not a blank line).
  const split1 = G.splitSignoff('7. White-Label Partnership:\nFor SEO, the flat rate is $1,050/month, all inclusive.\nArtem');
  assert(split1.body === '7. White-Label Partnership:\nFor SEO, the flat rate is $1,050/month, all inclusive.' && /^\n+artem$/i.test(split1.signoff),
    `splitSignoff finds "Artem" even mid-paragraph, not just as its own paragraph: got ${JSON.stringify(split1)}`);
  const split2 = G.splitSignoff('No signature here at all.');
  assert(split2.signoff === '' && split2.body === 'No signature here at all.', 'no sign-off -> empty signoff, body unchanged');

  // the exact job-24349 bug: ensurePricingFigureWhenAsked's fallback branch
  const sqPricing = { questions: [{ n: 8, title: 'Pricing', text: 'What is your wholesale pricing for white-label partners?' }] };
  const letterWithSig = '1. Experience: 12 years.\n\n8. Pricing: happy to discuss on a call.\n\nArtem'; // Q8's paragraph number-line matches, so this exercises the idx!==-1 branch
  const r1 = SQ.ensurePricingFigureWhenAsked(letterWithSig, sqPricing, { isSeoJob: true });
  assert(r1.inserted && r1.text.indexOf('Artem') > r1.text.indexOf('$1,050'), 'pricing fact lands before "Artem" when Q8s own paragraph is found');
  // the FALLBACK branch: no paragraph starts with "8." at all (unusual numbering in the draft)
  const letterNoQ8Para = '1. Experience: 12 years.\n\nSome other prose with no numbered Q8 line.\n\nArtem';
  const r2 = SQ.ensurePricingFigureWhenAsked(letterNoQ8Para, sqPricing, { isSeoJob: true });
  assert(r2.inserted && r2.text.indexOf('Artem') > r2.text.indexOf('$1,050'),
    `the FALLBACK branch (no Q8 paragraph found) also lands before the signature, never after: got ${JSON.stringify(r2.text)}`);
  assert(/\nArtem\s*$/.test(r2.text), 'the letter still ends with the signature after the fallback insert (the exact job-24349 bug)');

  // ── item 3: stripRecordLeakSentences ─────────────────────────────────────
  assert(G.isRecordLeakSentence('Timeline not documented in the case record.'), 'the exact job-24349 Q4 sentence is detected');
  assert(G.isRecordLeakSentence('That figure is not documented anywhere.'), '"not documented" alone is detected');
  assert(G.isRecordLeakSentence('Nothing further is on record for this.'), '"on record" is detected');
  assert(!G.isRecordLeakSentence('Golden State Trailers grew organic traffic 350%.'), 'an ordinary case-result sentence is not flagged');
  const leakResult = G.stripRecordLeakSentences('Golden State Trailers grew organic traffic 350%. Timeline not documented in the case record. The rest of the answer stands.');
  assert(leakResult.text === 'Golden State Trailers grew organic traffic 350%. The rest of the answer stands.',
    `the meta sentence is removed whole, surrounding sentences survive: got ${JSON.stringify(leakResult.text)}`);
  assert(leakResult.removed.includes('Timeline not documented in the case record.'), 'reported as removed');

  // ── item 4: stripResultsComingSentences ──────────────────────────────────
  const q5Sentence = 'The strategy is in place; measured results in AI Search are still being gathered as the platforms mature.';
  assert(G.isResultsComingSentence(q5Sentence), 'the exact job-24349 Q5 sentence is detected');
  assert(G.isResultsComingSentence('Results are coming as the campaigns mature.'), '"results are coming" variant is detected');
  assert(G.isResultsComingSentence('We are still gathering data on this one.'), '"still being gathered" / "still gathering" variant is detected');
  assert(G.isResultsComingSentence('We should see early results within a few weeks.'), '"early results" variant is detected');
  assert(G.isResultsComingSentence('We are tracking the results closely.'), '"we are tracking [the] results" variant is detected');
  assert(!G.isResultsComingSentence('We are tracking conversions via GA4 and GTM.'), 'tracking a real technical SETUP (not forward results) is NOT flagged — no false positive on legitimate tracking-method sentences');
  const comingResult = G.stripResultsComingSentences(`My approach layers entity clarity and schema markup for AI search visibility. ${q5Sentence}`);
  assert(comingResult.text === 'My approach layers entity clarity and schema markup for AI search visibility.',
    `Q5's forward-looking claim is removed whole, the approach description survives: got ${JSON.stringify(comingResult.text)}`);

  // ── item 5: repairDoubleParenOrphan + the orphan guard catches the shape ──
  const dermaOrphan = 'Derma Solution (attached as PDF): (USA medical aesthetics): +1,861% organic traffic, +14,342% conversions.';
  const dermaFixed = G.repairDoubleParenOrphan(dermaOrphan);
  assert(dermaFixed.text === 'Derma Solution (attached as PDF), USA medical aesthetics: +1,861% organic traffic, +14,342% conversions.',
    `the exact owner-specified repair: got ${JSON.stringify(dermaFixed.text)}`);
  assert(dermaFixed.repaired.length === 1, 'reported as repaired');

  const vapeOrphan = 'Vape Shop (attached in profile highlights): (restricted ecommerce): 7,000 monthly visitors.';
  const vapeFixed = G.repairDoubleParenOrphan(vapeOrphan);
  assert(vapeFixed.text === 'Vape Shop (attached in profile highlights), restricted ecommerce: 7,000 monthly visitors.',
    `the Vape Shop example repairs the same way: got ${JSON.stringify(vapeFixed.text)}`);

  const clean = 'A perfectly normal sentence (with a normal parenthetical) and nothing broken.';
  assert(G.repairDoubleParenOrphan(clean).text === clean, 'an ordinary single parenthetical is untouched (no false positive)');

  assert(G.hasOrphanPunctuation('Derma Solution (attached as PDF): (USA medical aesthetics): +1,861%...'),
    'the orphan guard itself ALSO now catches "): (" (the safety net, in case the targeted repair above misses a case)');
  assert(!G.hasOrphanPunctuation(dermaFixed.text), 'after the targeted repair, the orphan guard no longer fires on the same text');

  // ── item 5 (continued): "predictable Capacity" stray capital in _humanizeCasing ──
  // _humanizeCasing is a local, non-exported function in JobDetail.jsx; check the
  // wiring (the exact fix line is present verbatim) and duplicate the regex here
  // to exercise it directly, same pattern as the MANUAL/COMPLIMENTARY checks above.
  const jdSrc = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  assert(jdSrc.includes("t.replace(/\\bpredictable Capacity\\b/g, 'predictable capacity')"),
    '_humanizeCasing carries the exact "predictable Capacity" fix (copied here verbatim, checked against the source)');
  const CAPACITY_FIX_RE = /\bpredictable Capacity\b/g;
  assert('…deliverables they can forward, predictable Capacity, easy to brief…'.replace(CAPACITY_FIX_RE, 'predictable capacity')
    === '…deliverables they can forward, predictable capacity, easy to brief…',
    'the stray capital is lowercased in context');
  assert('Our Capacity planning process is thorough.'.replace(CAPACITY_FIX_RE, 'predictable capacity')
    === 'Our Capacity planning process is thorough.',
    'an unrelated "Capacity" (not preceded by "predictable") is left alone — narrow, literal fix only');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
