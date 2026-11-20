// Round 2 of job-24349 fixes (owner review, 2026-11-20, after the vape-strip
// orphaning bugfix landed): the regeneration under that fix was still "not
// acceptable" -- 8 further items.
//   1. Q4 dropped -> enforced (ensureLocalSeoResultsAnswer), not just recorded.
//   2. "I'm not claiming a measured AI-search result..." states what Artem
//      lacks, just phrased differently than the prior "no X is on record" fix.
//   3. Q8 pricing -> enforced (ensurePricingFigureWhenAsked).
//   4. "12 years" -> enforced in the intro (ensureExperienceYearsStated).
//   5. Final cleanup guard: revert to pre-strip text if a strip leaves orphan
//      punctuation (":,", ".:", "Example:,", "(...):,") behind.
//   6. Vape Shop strip narrowed to SAME-SENTENCE local-SEO claims only (see
//      tests/letter-24349-fixes.test.js for the full before/after coverage).
//   7. "a competitive B2B manufacturing vertical" for Golden State Trailers --
//      bare "competitive" now stripped too, without breaking the sentence.
//
// Run: node tests/letter-24349-fixes-round2.test.js
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const SQ = await import(pathToFileURL(path.join(LIB, 'screeningQuestions.js')).href);

  // ── 2. the exact "not claiming" admission sentence ─────────────────────
  const notClaiming = "My approach layers entity clarity and E-E-A-T signals on top of the traditional technical foundation. I'm not claiming a measured AI-search result, this is the approach and how I'd track it.";
  const adm = G.stripAdmissions(notClaiming);
  assert(adm.text === 'My approach layers entity clarity and E-E-A-T signals on top of the traditional technical foundation.',
    `the exact job-24349 round-2 Q5 sentence is removed whole: got ${JSON.stringify(adm.text)}`);
  assert(adm.removed.includes("I'm not claiming a measured AI-search result, this is the approach and how I'd track it."), 'reported as removed');
  const otherPhrasing = G.stripAdmissions("I don't claim a proven case for this exact niche, but the process transfers directly.");
  assert(otherPhrasing.removed.length + otherPhrasing.rewritten.length === 1, '"I don\'t claim a ... case" (the other phrasing) also fires');
  // approach-only prose with no disclaimer survives
  const clean = 'My approach layers entity clarity and E-E-A-T signals on top of the traditional technical foundation.';
  assert(G.stripAdmissions(clean).text === clean, 'approach-only prose with no disclaimer is untouched');

  // ── 5. final cleanup guard ──────────────────────────────────────────────
  assert(G.hasOrphanPunctuation('Golden State Trailers (attached in profile highlights):, USA B2B manufacturer.'), '":," is detected as orphan punctuation');
  assert(G.hasOrphanPunctuation('...67 keywords Top 3.: (attached in profile highlights), restricted ecommerce new site...'), '".:" is detected');
  assert(G.hasOrphanPunctuation('Example:, a restricted niche new site, hit 54 Top-1 keywords.'), '"Example:," is detected');
  assert(G.hasOrphanPunctuation('Golden State Trailers (attached in profile highlights):, USA B2B.'), '"(...):," is detected');
  assert(!G.hasOrphanPunctuation('A perfectly clean sentence, with a normal comma, and a period.'), 'ordinary punctuation is not flagged');
  assert(!G.hasOrphanPunctuation('12 years in technical SEO.'), 'a clean real sentence is not flagged');

  // ── 7. bare "competitive" qualifier, without breaking the sentence ──────
  const competitiveSentence = 'Golden State Trailers took longer - 72 city pages ranking across a competitive B2B manufacturing vertical required steady authority building.';
  const qualResult = G.stripUnledgeredCaseQualifiers(competitiveSentence);
  assert(qualResult.text === 'Golden State Trailers took longer - 72 city pages ranking across a B2B manufacturing vertical required steady authority building.',
    `bare "competitive" is stripped without breaking the sentence ("B2B manufacturing vertical" is real, per the ledger): got ${JSON.stringify(qualResult.text)}`);
  assert(qualResult.removed.includes('competitive'), 'reported as removed');
  assert(!/\ba\s+required\b/.test(qualResult.text), 'no broken "a required ..." fragment (the actual bug from stripping the whole noun phrase)');

  // ── 1. ensureLocalSeoResultsAnswer: Q4 missing -> inserted from the ledger ──
  const sq = {
    source: 'description', heading: 'Required Application Questions',
    questions: [
      { n: 1, title: 'Experience and Portfolio', text: 'How many SEO projects...' },
      { n: 4, title: 'Local SEO Results', text: 'Describe a local SEO project where you significantly improved Google Maps visibility, local organic rankings, or qualified inbound leads.' },
      { n: 8, title: 'Pricing and Capacity', text: 'Please provide your wholesale/white-label monthly pricing for Local SEO, National SEO, E-commerce SEO, AEO/GEO services.' },
    ],
    casesAsked: 3,
  };
  const letterMissingQ4 = '1. Experience and Portfolio: about 50 US, 20 Canada.\n\n8. Pricing and Capacity: we take on a limited number of projects.';
  const q4 = SQ.ensureLocalSeoResultsAnswer(letterMissingQ4, sq);
  assert(q4.inserted, 'Q4 is inserted when missing');
  assert(/^4\. Local SEO Results: Golden State Trailers \(attached in profile highlights\), SEO geo-expansion for a US B2B custom-trailer \/ food-truck manufacturer/m.test(q4.text),
    `the inserted answer is built from Golden State Trailers' real ledger record: got ${JSON.stringify(q4.text)}`);
  assert(/\+350% organic traffic, 67 keywords in Top 3, 110 referring domains/.test(q4.text), 'the inserted answer states the real ledger metrics');
  // inserted in the correct numeric position (between 1 and 8)
  const order = [...q4.text.matchAll(/^(\d)\.\s/gm)].map(m => Number(m[1]));
  assert(JSON.stringify(order) === JSON.stringify([1, 4, 8]), `inserted in numeric order 1, 4, 8: got ${JSON.stringify(order)}`);
  // never fires when Q4 is already answered
  const letterHasQ4 = '1. Experience and Portfolio: stuff.\n\n4. Local SEO Results: already answered.\n\n8. Pricing: stuff.';
  assert(!SQ.ensureLocalSeoResultsAnswer(letterHasQ4, sq).inserted, 'never fires when the question is already answered');
  // never fires when there's no local-SEO-results question at all
  const sqNoQ4 = { ...sq, questions: sq.questions.filter(q => q.n !== 4) };
  assert(!SQ.ensureLocalSeoResultsAnswer(letterMissingQ4, sqNoQ4).inserted, 'never fires when no question asks for local SEO results');

  // ── 3. ensurePricingFigureWhenAsked: Q8 pricing -> the one real figure ──
  const price = SQ.ensurePricingFigureWhenAsked(q4.text, sq, { isSeoJob: true, isPpcJob: false });
  assert(price.inserted, 'the real SEO figure is appended when pricing was asked and none is stated');
  assert(/8\. Pricing and Capacity: we take on a limited number of projects\. For SEO, the flat rate is \$1,050\/month, all inclusive\./.test(price.text),
    `appended into Q8's own paragraph, exact figure: got ${JSON.stringify(price.text)}`);
  // never fires if a real figure is already present anywhere
  const alreadyPriced = letterMissingQ4 + ' The SEO retainer is $1,050/month.';
  assert(!SQ.ensurePricingFigureWhenAsked(alreadyPriced, sq, { isSeoJob: true, isPpcJob: false }).inserted, 'never fires when a real figure is already stated');
  // never fires when pricing wasn't actually asked
  const sqNoPricing = { ...sq, questions: sq.questions.filter(q => q.n !== 8) };
  assert(!SQ.ensurePricingFigureWhenAsked(letterMissingQ4, sqNoPricing, { isSeoJob: true, isPpcJob: false }).inserted, 'never fires when no question asks for pricing');
  // Google Ads job gets the Ads figure, not the SEO one
  const adsPrice = SQ.ensurePricingFigureWhenAsked(letterMissingQ4, sq, { isSeoJob: false, isPpcJob: true });
  assert(/\$700 for the first month \(full setup\), then \$600\/month/.test(adsPrice.text), 'a Google Ads job gets the Ads fee, not the SEO one');

  // ── 4. ensureExperienceYearsStated: "12 years" in the intro ─────────────
  const noYears = "I run a small agency (IT Force, 20 people) and have delivered white-label for years.";
  const yrs = G.ensureExperienceYearsStated(noYears);
  assert(yrs.inserted && yrs.text.startsWith('12 years in SEO/PPC and ecommerce web development.'), `"12 years" is prepended to the first paragraph when missing entirely: got ${JSON.stringify(yrs.text)}`);
  // never fires when already present, anywhere
  const hasYears = "12 years in technical SEO, Google Premier Partner 2026.";
  assert(!G.ensureExperienceYearsStated(hasYears).inserted, 'never fires when "12 years" is already stated');
  const hasYearsLater = "Some opener.\n\nLater on: 12 years running this.";
  assert(!G.ensureExperienceYearsStated(hasYearsLater).inserted, 'never fires even if "12 years" is stated later, not just the opener');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
