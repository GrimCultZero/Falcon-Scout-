// Three owner-approved fixes after job 16378 (2026-09-27, "fix all three"):
//
//   1. fixCaseGeoClaims (caseLedger.js), applied by the grounding checker under
//      enforce: a place attached to a named case in a clear-cut shape is DELETED
//      ("Atlant Real Estate (…): California property developer" → "property
//      developer"). Anything less clear-cut stays the caseGeoNotInLedger flag.
//   2. blankNegatedLaunch (letterGuards.js): "rather than simply starting over from
//      scratch" is an existing account, not a launch — it had fired
//      wrongAuditOfferOnLaunch and launchJobMissingCTA.
//   3. The circumvention check no longer reads the word "signal" as the Signal
//      app ("trust signal", "signal streams"); the app still flags as a channel.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const L = await import(pathToFileURL(path.join(LIB, 'caseLedger.js')).href);
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const fix = (t) => L.fixCaseGeoClaims(t).text;

  // ── 1. place fixes, one per shape ───────────────────────────────────────
  const d16378 = 'Atlant Real Estate (attached in profile highlights): California property developer, B2B lead gen. Built per-complex branded Search campaigns.';
  assert(fix(d16378) === 'Atlant Real Estate (attached in profile highlights): property developer, B2B lead gen. Built per-complex branded Search campaigns.', 'job 16378: "California property developer" → "property developer" (adjective)');
  assert(fix('Vape Shop (USA): restricted e-commerce, new site launch.') === 'Vape Shop: restricted e-commerce, new site launch.', '"Vape Shop (USA):" → "Vape Shop:" (parenthetical)');
  assert(fix('Derma Solution (attached as PDF): YMYL medical aesthetics (Korean products), US market launch.') === 'Derma Solution (attached as PDF): YMYL medical aesthetics, US market launch.', '"(Korean products)" goes; the US, which is on record for Derma, stays');
  assert(fix('Atlant (attached in profile highlights) Real Estate: property developer, new-listing lead gen, US market. Rebuilt the structure.') === 'Atlant (attached in profile highlights) Real Estate: property developer, new-listing lead gen. Rebuilt the structure.', '", US market." goes (list item)');
  assert(fix('ChronoCash, Germany (attached in profile highlights): ran Video, PMax, DSA.') === 'ChronoCash (attached in profile highlights): ran Video, PMax, DSA.', '"ChronoCash, Germany (…)" → "ChronoCash (…)" (appositive)');
  assert(fix('FridgeFix (attached in profile highlights): (appliance repair, Vienna), cost per conversion dropped 92%.') === 'FridgeFix (attached in profile highlights): (appliance repair), cost per conversion dropped 92%.', '"(appliance repair, Vienna)" → "(appliance repair)"');
  assert(fix('FridgeFix (attached in profile highlights): Appliance repair, Dallas, Fort Worth metro. Rebuilt tracking.') === 'FridgeFix (attached in profile highlights): Appliance repair. Rebuilt tracking.', '"Appliance repair, Dallas, Fort Worth metro." → "Appliance repair." (two list items, right to left)');
  assert(fix('Golden State Trailers (attached in profile highlights): B2B custom trailer manufacturer, geo expansion across California. Grew organic traffic 350%.') === 'Golden State Trailers (attached in profile highlights): B2B custom trailer manufacturer, geo expansion. Grew organic traffic 350%.', '"geo expansion across California." → "geo expansion." (preposition)');
  assert(fix("I've scaled exactly this for Atlant, a property developer in Kyiv - branded campaigns per complex.") === "I've scaled exactly this for Atlant, a property developer - branded campaigns per complex.", '"a property developer in Kyiv - …" loses "in Kyiv"');
  assert(fix('House Painting (attached in profile highlights): tight local targeting for a California contractor.') === 'House Painting (attached in profile highlights): tight local targeting for a contractor.', '"for a California contractor" → "for a contractor"');
  assert(fix('Nectar Flowers (attached in profile highlights): Ottawa florist, -72% cost per conversion.') === 'Nectar Flowers (attached in profile highlights): Ottawa florist, -72% cost per conversion.', 'a place ON record is never touched');
  const chicago = 'Atlant (attached in profile highlights): property developer, Chicago-adjacent vertical, new-listing lead gen.';
  assert(fix(chicago) === chicago && L.fixCaseGeoClaims(chicago).left.length === 1, '"Chicago-adjacent vertical" is not clear-cut: left as a flag, text untouched');
  assert(fix('Ukrainian developer Atlant grew conversions 56.5%.') === 'Developer Atlant grew conversions 56.5%.', 'a sentence that loses its first word gets its capital back');

  // grounding checker, enforce: fixes and records caseGeoStripped; the rest stays a flag
  const gcSrc = fs.readFileSync(path.join(LIB, 'groundingCheck.js'), 'utf8')
    .replace("from './caseLedger'", `from '${pathToFileURL(path.join(LIB, 'caseLedger.js')).href}'`);
  const tmp = path.join(os.tmpdir(), `groundingCheck-${process.pid}.mjs`);
  fs.writeFileSync(tmp, gcSrc);
  const { groundingCheck } = await import(pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);
  const gc = groundingCheck(d16378, { enforce: true });
  assert(gc.text.includes('): property developer, B2B lead gen') && gc.violations.includes('caseGeoStripped') && !gc.violations.includes('caseGeoNotInLedger'), 'groundingCheck (enforce) fixes the 16378 line and records caseGeoStripped');
  const gc2 = groundingCheck(chicago, { enforce: true });
  assert(gc2.text === chicago && gc2.violations.includes('caseGeoNotInLedger') && !gc2.violations.includes('caseGeoStripped'), 'an unfixable place stays caseGeoNotInLedger');
  assert(groundingCheck(d16378, { enforce: false }).text === d16378, 'shadow mode never changes text');

  // ── 2. negated launch ───────────────────────────────────────────────────
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const liftArray = (name) => { const i = src.indexOf(`const ${name} = [`); let d = 0; const j = src.indexOf('[', i); for (let k = j; k < src.length; k++) { if (src[k] === '[') d++; else if (src[k] === ']') { d--; if (d === 0) return eval(src.slice(j, k + 1)); } } };
  const LAUNCH = liftArray('LAUNCH_FROM_SCRATCH_RE');
  const isLaunch = (p) => LAUNCH.some(re => re.test(G.blankNegatedLaunch(p.toLowerCase())));
  assert(!isLaunch('We want someone who knows how to leverage that existing data to improve performance rather than simply starting over from scratch.'), 'job 16378: "rather than simply starting over from scratch" is not a launch');
  assert(!isLaunch('This is not a new account. Everything is already set up.'), '"This is not a new account" is not a launch');
  assert(!isLaunch('This is not a "build from scratch" job. We have a live account.'), '"not a \\"build from scratch\\" job" is not a launch');
  assert(isLaunch('We need to launch our first Google Ads account from scratch.'), 'a real from-scratch launch still is one');
  assert(isLaunch('Brand new store, zero pixel data, build and launch our campaigns.'), 'zero-pixel / build-and-launch still read as a launch');

  // The noun-phrase order, job 17538 (2026-10-07). Every earlier pattern wanted
  // "set up" BEFORE "google ads", so a posting titled "Google Ads setup" was not a
  // launch, Rule 450 never applied, and the letter offered to audit an account
  // that did not exist and to "check" things nobody had built. Owner: "there is
  // nothing to check … there is nothing to audit".
  assert(isLaunch('Google Ads setup'), 'job 17538: the title "Google Ads setup" alone reads as a launch');
  assert(isLaunch("We're looking for Google Ads set up including tracking, conversion verification and analytics assurance."), 'job 17538: "Google Ads set up including tracking" reads as a launch');
  assert(isLaunch('We are looking for Google Ads set up for our new service business.'), '"Google Ads set up" (spaced) reads as a launch');
  // …but the SAME words with a possessive describe an account that already exists.
  assert(!isLaunch('Please review our Google Ads setup and tell us what is wrong.'), '"review OUR Google Ads setup" is an existing account, not a launch');
  assert(!isLaunch('We want you to improve the current Google Ads setup.'), '"the current Google Ads setup" is an existing account, not a launch');
  // Job 16131, titled "Audit & Fix Existing Search Campaigns" — the one false
  // positive the new pattern threw up across all 523 postings, now negated.
  assert(!isLaunch('This is **not a basic Google Ads setup job**. I am already at an intermediate level with Google Ads.'), 'job 16131: "not a basic Google Ads setup job" is not a launch');
  assert(isLaunch('We do not have conversion tracking setup yet, so build and launch the account from scratch.'), 'the negation needs the article — "do not have tracking setup" does not blank a real launch');
  assert(/LAUNCH_FROM_SCRATCH_RE\.some\(re => re\.test\(blankNegatedLaunch\(jobContextLower\)\)\)/.test(src) && /_PPC_LAUNCH_FROM_SCRATCH_RE\.test\(blankNegatedLaunch\(jobContextLower\)\)/.test(src), 'both launch detectors in JobDetail.jsx blank negated phrases first');

  // ── 2b. the NEW ACCOUNT prompt note (job 17538) ──────────────────────────
  // A running account gets a hard deterministic instruction; a from-scratch build
  // got nothing but a static block the model ignored. This is the mirror image.
  const note = src.slice(src.indexOf('const _newAccountNote'), src.indexOf('const _auditDeclinedAsk'));
  assert(/_launchFromScratch = _casePpcSignal && !_runningAccount/.test(src), 'the NEW ACCOUNT note never fires on a running account (the two would contradict)');
  assert(/LAUNCH_FROM_SCRATCH_RE\.some\(re => re\.test\(blankNegatedLaunch\(_postingTitleDesc\.toLowerCase\(\)\)\)\)/.test(src), 'the note reads the posting only, and blanks negated launches first');
  assert(/_runningAccountNote,\n\s*_newAccountNote,/.test(src), 'the note is actually added to the job context');
  assert(/NOTHING TO AUDIT, NOTHING TO CHECK/.test(note) && /Do NOT offer an audit/.test(note), 'the note forbids the audit offer outright');
  assert(/first thing I'd check/.test(note) && /same mistake with a different noun/.test(note), 'it forbids the diagnostic framing too, not just the word "audit"');
  assert(/5 working days/.test(note) && /never "1 working day"/.test(note), 'it names the Rule 450 CTA and rules out the audit turnaround');
  assert(/zero to performing/.test(note) && /SAY WHAT YOU WILL ACTUALLY SET UP/.test(note), 'it asks for the track record and the concrete setup list');
  // Owner chose (b), 2026-10-07: keep the service rule, bridge the B2B mechanic.
  assert(/_postingWantsB2B/.test(src) && /do NOT cite them here/.test(note), 'on a B2B posting it still refuses the SEO-only B2B cases on a paid-media job');
  assert(/do not claim a B2B vertical track record Artem does not have/.test(note), '…and it bridges the mechanic instead of inventing a B2B track record');

  // ── 3. "signal" ─────────────────────────────────────────────────────────
  const CIRC = liftArray('CIRCUMVENTION_RISK');
  const risky = (t) => CIRC.some(re => re.test(t));
  assert(!risky('Technical foundation first, then E-E-A-T authority building where one missing trust signal kills rankings.'), '"trust signal" is SEO vocabulary, not a contact channel (job 16252)');
  assert(!risky('A multi-location setup fragments conversion data across three separate signal streams.'), '"signal streams" is not a contact channel (job 16378)');
  assert(risky('Message me on Signal and we can talk.'), '"Message me on Signal" is still flagged');
  assert(risky('Happy to continue on WhatsApp or Signal.'), '"WhatsApp or Signal" is still flagged');
  assert(risky('Download the Signal app.'), '"the Signal app" is still flagged');
  assert(!risky('Process-wise: each Shopify account gets a hands-on technical audit.'), '"Process-wise" is not the Wise payment service (a sent letter)');
  assert(risky('You can pay me via Wise if that is easier.'), '"pay me via Wise" is still flagged');

  // ── the corpus ──────────────────────────────────────────────────────────
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    let changed = 0, cleanTouched = 0, fixedN = 0, leftN = 0;
    for (const r of rows) {
      const t = r.text || '';
      const res = L.fixCaseGeoClaims(t);
      if (L.findCaseFactConflicts(t).geo.length === 0 && res.text !== t) cleanTouched++;
      if (res.text !== t) changed++;
      fixedN += res.fixed.length; leftN += res.left.length;
    }
    console.log(`\ncorpus: the place fixer changes ${changed} letters (${fixedN} places fixed, ${leftN} left as flags)`);
    assert(cleanTouched === 0, 'a letter with no place conflict is never changed');
    assert(fixedN >= 15 && leftN <= 3, `clear-cut shapes cover almost every real case (${fixedN} fixed / ${leftN} left on 2026-09-27: 18 / 2)`);
    const oldSignal = /\b(?:whatsapp|telegram|signal|discord|viber|wechat)\b/i;
    const oldHits = rows.filter(r => oldSignal.test(r.text || '')).length;
    const newHits = rows.filter(r => risky(r.text || '')).length;
    console.log(`corpus: letters the contact-channel rules flag — before ${oldHits}, now ${newHits}`);
    assert(newHits < oldHits, 'the "signal" false alarms on sent letters are gone');
  } else {
    console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
