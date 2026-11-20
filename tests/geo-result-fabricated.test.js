// GEO/AEO (generative/answer-engine optimization — AI search visibility) has NO
// case study, no measured result, and no confirmed number on record anywhere in
// the KB or the case ledger (owner, 2026-11-20): "there is no measured result and
// no confirmed case on record. Describe the approach only ... Never invent or
// imply a result, a past win, or a case."
//
// Job 24349 ("Expert SEO Specialist / Agency ... AEO & GEO") asks directly:
// "Have you produced measurable results in AI search? If yes, provide examples
// and explain how you measured them." That is exactly the shape where a model
// might invent a plausible-sounding citation/visibility number — the same
// fabrication risk metricNotInLedger exists to catch for named cases, except
// metricNotInLedger only scans paragraphs that NAME a ledger case, and no
// GEO/AEO case exists at all, so a GEO sentence with an invented number but no
// case name would slip through untouched.
//
// This test: the detector (groundingCheck's geoResultFabricated) flags a GEO/AEO
// sentence stating a result number, leaves approach-only GEO/AEO prose alone,
// never mistakes bare "geo" (geo-targeting/geography, routine in ad-agency
// letters) for GEO/AEO, and CASE_LEDGER really does have zero geo/aeo cases (the
// premise the whole check rests on).
//
// Run: node tests/geo-result-fabricated.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const L = await import(pathToFileURL(path.join(LIB, 'caseLedger.js')).href);

  // The premise: no GEO/AEO case exists in the ledger at all.
  const geoOrAeoCases = L.CASE_LEDGER.filter(c => c.service === 'geo' || c.service === 'aeo');
  assert(geoOrAeoCases.length === 0, `CASE_LEDGER has zero GEO/AEO cases (the premise geoResultFabricated relies on): found ${geoOrAeoCases.length}`);

  // groundingCheck.js imports './caseLedger' extensionless (Vite resolves it,
  // bare node ESM does not) — rewrite to a real file URL in a scratch copy,
  // same technique as tests/geo-fix-and-flags.test.js.
  const gcSrc = fs.readFileSync(path.join(LIB, 'groundingCheck.js'), 'utf8')
    .replace("from './caseLedger'", `from '${pathToFileURL(path.join(LIB, 'caseLedger.js')).href}'`);
  const tmp = path.join(os.tmpdir(), `groundingCheck-geo-${process.pid}.mjs`);
  fs.writeFileSync(tmp, gcSrc);
  const { groundingCheck } = await import(pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);

  // ── fabricated GEO/AEO results — must flag ──────────────────────────────
  assert(groundingCheck('Our GEO optimization increased AI citations by 45%.').violations.includes('geoResultFabricated'),
    'a GEO sentence with a invented % result is flagged');
  assert(groundingCheck("We've driven a 3.4x lift in AEO visibility for past clients.").violations.includes('geoResultFabricated'),
    'an AEO sentence with an invented multiplier is flagged');
  assert(groundingCheck('Our answer engine optimization work grew AI-driven leads by 32%.').violations.includes('geoResultFabricated'),
    'the full "answer engine optimization" phrase with an invented % result is flagged');
  assert(groundingCheck('AI search optimization lifted qualified leads by 28% for one client.').violations.includes('geoResultFabricated'),
    '"AI search optimization" + a result number is flagged');

  // ── approach-only GEO/AEO — no result claimed, must NOT flag ────────────
  assert(!groundingCheck('We focus on GEO through entity clarity, schema markup, and E-E-A-T signals.').violations.includes('geoResultFabricated'),
    'approach-only GEO prose (no metric) is not flagged');
  assert(!groundingCheck('For AEO, I prioritize structured data and clear entity definitions so AI engines can parse the content confidently.').violations.includes('geoResultFabricated'),
    'approach-only AEO prose is not flagged');
  assert(!groundingCheck('GEO and AEO are still early — I measure visibility by tracking brand mentions and citations across ChatGPT, Perplexity, and AI Overviews over time.').violations.includes('geoResultFabricated'),
    'describing HOW results would be measured, with no stated past result, is not flagged');

  // ── bare "geo" (geo-targeting / geography) must never be mistaken for GEO/AEO ──
  assert(!groundingCheck('We handled geo-targeting adjustments and grew conversions 20%.').violations.includes('geoResultFabricated'),
    'bare "geo-targeting" + an unrelated metric is not a GEO/AEO claim');
  assert(!groundingCheck('Golden State Trailers: geo expansion across the US. Grew organic traffic 350%.').violations.includes('geoResultFabricated'),
    'a real SEO case\'s geographic expansion + its real metric is not a GEO/AEO claim');

  // ── a metric elsewhere in the letter, unrelated to the GEO/AEO sentence, stays clean ──
  assert(!groundingCheck('Golden State Trailers grew organic traffic 350%. For GEO, I focus on entity clarity and schema.').violations.includes('geoResultFabricated'),
    'a real case metric in one sentence and approach-only GEO in another sentence do not cross-contaminate');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
