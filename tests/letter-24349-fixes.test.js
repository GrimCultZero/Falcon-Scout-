// Fixes for the real job-24349 letter (owner review, 2026-11-20, after the
// first regeneration under the new business-facts prompt):
//   1. Years-claim guard — strip "since <year>" / "<N> years" (N != 12).
//   2. GEO/AEO admission strip — "no measured result is on record" states
//      what Artem lacks, the same violation class as every "I don't have ..."
//      pattern, just phrased impersonally.
//   3. Pricing: a partial-coverage pricing question must still get the one
//      real figure Artem has, not be omitted entirely.
//   4. Unledgered claims: "moderate-competition niche" for Golden State
//      Trailers (not in its ledger record), and Vape Shop cited near
//      local-SEO/multi-location language (KB Rule 437).
//   5. timingViolation: the owner-confirmed "60-90 days" SEO window must not
//      false-flag.
//
// Run: node tests/letter-24349-fixes.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);

  // ── 1. years-claim guard ──────────────────────────────────────────────
  const r1 = G.stripOffStandardYearsClaim("12 years in technical SEO, US and Canada work since 2016.");
  assert(r1.text === '12 years in technical SEO.', `the real job-24349 sentence loses "since 2016" but keeps "12 years": got ${JSON.stringify(r1.text)}`);
  assert(r1.rewritten.length === 1 && r1.removed.length === 0, 'reported as a rewrite (partial removal), not a full delete');

  const r2 = G.stripOffStandardYearsClaim('I have been doing this since 2010.');
  assert(r2.text === '' && r2.removed.length === 1, 'a standalone "since <year>" sentence with nothing worth keeping is deleted entirely');

  const r3 = G.stripOffStandardYearsClaim('11 years of hands-on PPC management.');
  assert(r3.text === '' && r3.removed.length === 1, '"11 years" (not 12) is stripped');

  const r4 = G.stripOffStandardYearsClaim('12 years in technical SEO.');
  assert(r4.text === '12 years in technical SEO.' && r4.removed.length === 0 && r4.rewritten.length === 0, 'the real "12 years" claim, alone, is left untouched');

  const r5 = G.stripOffStandardYearsClaim("Your 5-year-old business deserves better SEO.");
  assert(r5.text === "Your 5-year-old business deserves better SEO." && r5.removed.length === 0, "a claim about the CLIENT's own history (\"your ...\") is left alone");

  // ── 2. GEO/AEO admission strip ────────────────────────────────────────
  const geo = '5. AEO, GEO, and AI Search: entity clarity and E-E-A-T signals. No measured AI-search result is on record yet, this is the approach going forward, not a claimed win.';
  const adm = G.stripAdmissions(geo);
  assert(adm.text === '5. AEO, GEO, and AI Search: entity clarity and E-E-A-T signals.', `the exact job-24349 Q5 admission sentence is removed whole: got ${JSON.stringify(adm.text)}`);
  assert(adm.removed.includes('No measured AI-search result is on record yet, this is the approach going forward, not a claimed win.'), 'reported as removed');
  // approach-only prose with no admission survives
  const geoOk = 'For AEO, I prioritize structured data and clear entity definitions so AI engines can parse the content confidently.';
  assert(G.stripAdmissions(geoOk).text === geoOk, 'approach-only GEO/AEO prose with no lack-admission is untouched');
  // the first-person shape still works (no regression)
  assert(G.stripAdmissions("I don't have a SaaS case to show you.").removed.length === 1, 'the existing first-person admission patterns still fire');

  // ── 3. pricing: partial coverage must still give the one real figure ──
  assert(/PARTIAL PRICING COVERAGE \(owner, 2026-11-20, job 24349\)/.test(SRC), 'the checklist prompt has the partial-pricing-coverage rule');
  assert(/state the ONE real figure you DO have \(e\.g\. "\$1,050\/month, all inclusive" for SEO\) rather than omitting pricing altogether/.test(SRC),
    'the rule explicitly says: give the one real figure, don\'t omit pricing just because the question asked for more detail');

  // ── 4a. unledgered case-competitiveness qualifier ──────────────────────
  const golden = 'Golden State Trailers hit 67 keywords in Top 3 and +350% organic traffic, but that was GEO-targeted city pages in a B2B manufacturing niche with moderate competition, not a national head-term war.';
  const qual = G.stripUnledgeredCaseQualifiers(golden);
  assert(qual.text === 'Golden State Trailers hit 67 keywords in Top 3 and +350% organic traffic, but that was GEO-targeted city pages in a B2B manufacturing niche, not a national head-term war.',
    `"with moderate competition" (not in Golden State Trailers' ledger record) is stripped: got ${JSON.stringify(qual.text)}`);
  assert(qual.removed.includes('with moderate competition'), 'reported as removed');
  // a sentence with no named case is untouched
  const noCaseSent = 'We expect moderate competition in most local markets.';
  assert(G.stripUnledgeredCaseQualifiers(noCaseSent).text === noCaseSent, 'a competitiveness claim with no named ledger case is left alone (nothing to check it against)');

  // ── 4b. Vape Shop near local-SEO / multi-location language (KB Rule 437) ──
  // Correction, item 6 (owner, 2026-11-20): KB Rule 437's own anti-fabrication
  // clause is about a CLAIM MADE ABOUT the case, not mere proximity to the
  // words elsewhere in the letter. Detection is scoped to the SAME SENTENCE.

  // A list that cites Vape Shop alongside other cases, where the local-SEO
  // language is in a DIFFERENT (earlier) sentence -- the real job-24349 shape
  // this was over-stripping before the fix -- is now left alone.
  const vapeListNoCoOccurrence = 'Core strengths: local SEO (multi-location service-area businesses, GBP/Map Pack optimization). Strongest case studies: Golden State Trailers, Vape Shop, Luxury Parfums.';
  assert(G.stripVapeNearLocalSeo(vapeListNoCoOccurrence).text === vapeListNoCoOccurrence,
    'Vape Shop in a case list, with local-SEO language only in a DIFFERENT sentence, is no longer stripped (item 6 correction)');

  // A list sentence that ITSELF pairs Vape Shop with local-SEO language IS a
  // genuine same-sentence claim -- still caught, clause dropped.
  const vapeListCoOccurrence = 'Case studies for our local SEO (GBP, map pack) work: Golden State Trailers, Vape Shop, Luxury Parfums.';
  const vapeListStripped = G.stripVapeNearLocalSeo(vapeListCoOccurrence);
  assert(!/Vape\s*Shop/i.test(vapeListStripped.text), `Vape Shop IS struck when its own sentence makes the local-SEO claim: got ${JSON.stringify(vapeListStripped.text)}`);
  assert(vapeListStripped.rewritten.length === 1, 'reported as a rewrite (clause dropped, sentence kept)');
  assert(!/,\s*,/.test(vapeListStripped.text) && !/,\s*\./.test(vapeListStripped.text), 'no stray double-comma or ", ." left behind by the removal');

  // Vape Shop cited on its own, nowhere near local-SEO language, is untouched
  const vapeAlone = 'Vape Shop: a restricted-niche e-commerce brand, 7,000 monthly visitors, 54 keywords in Top 1.';
  assert(G.stripVapeNearLocalSeo(vapeAlone).text === vapeAlone, 'Vape Shop cited on its own (no local-SEO language nearby) is left untouched');
  assert(VAPE_FABRICATION_NEAR_RES_EXPORTED(G), 'VAPE_FABRICATION_NEAR_RES is exported so JobDetail.jsx\'s record-only flag and this strip share one definition');

  // ── 4c. Vape Shop in its OWN "Name (attachment): stats." sentence, cited
  // ACCURATELY as a new-site ramp-up example (the real job-24349 second-
  // generation shape, no local-SEO words in this sentence at all) -- must be
  // left COMPLETELY untouched now (item 6). Before the fix, a wide ±500-char
  // window reaching into the NEXT question's unrelated "Map Pack" discussion
  // falsely stripped this and orphaned its stats.
  const headerStyleRampUp = 'Golden State Trailers (attached in profile highlights): USA B2B manufacturer, +350% organic traffic, 72 city pages ranking, 67 keywords Top 3. Vape Shop (attached in profile highlights): restricted ecommerce new site, 7,000 monthly visitors, 54 keywords Top 1, 80 referring domains. Luxury Parfums (attached in profile highlights): ecommerce scents, +79% visits, +143% revenue, 33 keywords Top 1. 2. Brand-New Website SEO: an HVAC company in one metro can break into Map Pack and page-one local organic in that window.';
  assert(G.stripVapeNearLocalSeo(headerStyleRampUp).text === headerStyleRampUp,
    'Vape Shop\'s own ramp-up sentence has no local-SEO words in it -- untouched even though "Map Pack" appears two sentences later (the exact over-reach that broke job 24349\'s second generation)');

  // The real genuine-fabrication shape: Vape Shop's OWN "Name (attachment):
  // stats." sentence DOES make a local-SEO claim -- the whole sentence goes,
  // no orphaned fragment, and the surrounding cases are untouched.
  const headerStyleFabricated = 'Golden State Trailers (attached in profile highlights): USA B2B manufacturer, +350% organic traffic, 72 city pages ranking, 67 keywords Top 3. Vape Shop (attached in profile highlights): 5 locations, GBP dialed in, local pack rankings across all stores. Luxury Parfums (attached in profile highlights): ecommerce scents, +79% visits, +143% revenue, 33 keywords Top 1.';
  const vapeHeader = G.stripVapeNearLocalSeo(headerStyleFabricated);
  assert(vapeHeader.text === 'Golden State Trailers (attached in profile highlights): USA B2B manufacturer, +350% organic traffic, 72 city pages ranking, 67 keywords Top 3. Luxury Parfums (attached in profile highlights): ecommerce scents, +79% visits, +143% revenue, 33 keywords Top 1.',
    `Vape Shop's whole "Name (attachment): stats" sentence is removed when it IS the fabrication, no orphaned fragment, Golden State Trailers and Luxury Parfums untouched: got ${JSON.stringify(vapeHeader.text)}`);
  assert(!/\(attached in profile highlights\),\s*restricted/.test(vapeHeader.text) && !/:\s*,/.test(vapeHeader.text), 'no orphaned fragment or stray ":," left behind');

  // The real job-24349 Q3 "Example: Vape Shop, a restricted niche new site..."
  // citation -- also a correct ramp-up example, also must survive untouched.
  const q3Example = 'Example: Vape Shop, a restricted niche new site, hit 54 Top-1 keywords within months because paid was blocked, competitors were thin, and we moved fast on semantic core plus link building.';
  assert(G.stripVapeNearLocalSeo(q3Example).text === q3Example, 'the real Q3 "Example: Vape Shop, a restricted niche new site..." citation is left untouched (no local-SEO words in it)');

  // ── 5. timingViolation: the owner-confirmed 60-90-day SEO window ──────
  assert(/const OWNER_CONFIRMED_TIMINGS = \['60-90 days'\]/.test(SRC), 'the 60-90-day SEO window is in the hardcoded allow-list');
  assert(/replace\(\/\\s\*-\\s\*\/g, '-'\)/.test(SRC), 'spacing around the hyphen is normalized before comparing (so "60 - 90 days" and "60-90 days" are the same allowed phrase)');
  // exercise the real function end to end
  const allowedT = new Set(['60-90 days']);
  const normTest = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
  assert(allowedT.has(normTest('60 - 90 days')), 'the normalizer collapses "60 - 90 days" to the same token as the allow-list entry');
  const hits = G.timingViolationSentences('Visible results typically show up in 60 - 90 days once the foundation is live.', allowedT);
  assert(hits.length === 0, `the real job-24349 "60 - 90 days" SEO sentence no longer flags timingViolation: got ${JSON.stringify(hits)}`);
  const stillFlags = G.timingViolationSentences('I can finish this in 14 days.', allowedT);
  assert(stillFlags.length === 1, 'an unrelated, non-owner-confirmed timing phrase still flags (nothing over-broadened)');

  function VAPE_FABRICATION_NEAR_RES_EXPORTED(mod) {
    return Array.isArray(mod.VAPE_FABRICATION_NEAR_RES) && mod.VAPE_FABRICATION_NEAR_RES.length > 0;
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
