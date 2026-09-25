// Case location + timeframe check (frontend/src/lib/caseLedger.js →
// findCaseFactConflicts), validated against the real sent-letter history.
//
// Why it exists: job 16113 (2026-09-24) wrote Nectar Flowers — an Ottawa,
// Canada florist with no period on record — up as a "UK florist … over 90
// days". Run over the 256 sent letters on 2026-09-24 it found 21 more such
// claims, every one confirmed by hand against KB #1 / #506 (FridgeFix placed in
// "Vienna" and "Dallas", Atlant as a "US market" / "Chicago-adjacent"
// developer, Skin Reboot given "7 months" against a 14-month record, …).
// Those are pinned below so a future change can't quietly stop catching them.
// 2026-09-25: 24, after the owner ruled that Atlant's location is never
// stated (three more letters had named it correctly — Kyiv / Ukrainian).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const L = await import(pathToFileURL(path.join(LIB, 'caseLedger.js')).href);
  const facts = (t) => L.findCaseFactConflicts(t);
  const geoTerms = (t) => facts(t).geo.map(g => `${g.case}:${g.term}`);
  const timePhrases = (t) => facts(t).time.map(x => `${x.case}:${x.phrase}`);
  const clean = (t) => { const r = facts(t); return r.geo.length === 0 && r.time.length === 0; };

  // ── the ledger's own text must pass ─────────────────────────────────────
  const dirty = L.CASE_LEDGER.filter(c => !clean(L.renderCaseLine(c.id)));
  assert(dirty.length === 0, `every canonical case line passes its own check${dirty.length ? ' — dirty: ' + dirty.map(c => c.id).join(', ') : ''}`);
  const expanded = L.expandCasePlaceholders(L.CASE_LEDGER.map(c => `{{case:${c.id}}}`).join('\n\n')).text;
  assert(clean(expanded), 'all sixteen canonical lines together, one per paragraph, pass');

  // ── job 16113, verbatim ─────────────────────────────────────────────────
  const nectar16113 = 'Nectar Flowers (attached in profile highlights): UK florist running broad Search + Shopping, conversion tracking counted every cart-add instead of completed orders, so the algorithm optimised toward browsers. I rebuilt the tracking to fire on thank-you-page purchases only, tightened match types to phrase/exact, and carved out a separate campaign for high-intent "flower delivery [city]" queries. Dropped cost per conversion 72% and grew transaction income 350% over 90 days.';
  assert(geoTerms(nectar16113).join() === 'nectar-flowers:UK', 'job 16113: "UK florist" is flagged for Nectar Flowers');
  assert(timePhrases(nectar16113).join() === 'nectar-flowers:90 days', 'job 16113: "over 90 days" is flagged (no period on record)');
  assert(facts(nectar16113).geo[0].on_record === 'Ottawa, Canada', 'the flag carries what IS on record (Ottawa, Canada)');

  // ── places ──────────────────────────────────────────────────────────────
  assert(clean('Nectar Flowers (attached in profile highlights): a highly seasonal Ottawa florist, -72% cost per conversion.'), 'Nectar Flowers as an Ottawa florist passes');
  assert(clean('Nectar Flowers: a Canadian florist in Ontario, North American delivery market.'), 'Canada / Ontario / North American all pass for Nectar Flowers');
  assert(clean('Nectar Flowers (attached in profile highlights): Ottawa florist — the same seasonal spikes you\'d see in London around Mother\'s Day.'),
    'a place in a clause about the CLIENT ("you\'d see in London") is the bridge, not a claim about the case');
  assert(geoTerms('Atlant (attached in profile highlights): property developer, new-listing lead gen, US market.').join() === 'atlant:US',
    'Atlant as a "US market" developer is flagged');
  assert(geoTerms('Atlant: one of the largest developers in Kyiv, Ukrainian residential complexes.').sort().join() === 'atlant:Kyiv,atlant:Ukrainian',
    'Atlant\'s REAL location is flagged too — owner, 2026-09-25: letters state no location for it, neither Ukraine nor the US');
  assert(facts('Atlant (attached in profile highlights): Dallas developer.').geo[0].on_record === 'never state one', 'and the flag says so ("never state one")');
  assert(clean('Skin Reboot (attached as PDF): Korean medical-aesthetic skincare sold in the US.'), 'Skin Reboot: Korean (the products) and US (the business) both pass');
  assert(geoTerms('Derma Solution (attached as PDF): YMYL medical aesthetics (Korean products).').join() === 'derma-solution:Korean',
    '"Korean" on Derma Solution is flagged — that is Skin Reboot\'s attribute, not Derma\'s');
  assert(clean('FridgeFix (attached in profile highlights): refrigerator repair in Orange County, Southern California.'), 'FridgeFix in Orange County / Southern California passes');
  assert(geoTerms('FridgeFix (attached in profile highlights): Appliance repair, Dallas, Fort Worth metro.').join() === 'fridgefix:Dallas', 'FridgeFix in Dallas is flagged');
  assert(geoTerms('Golden State Trailers (attached in profile highlights): B2B manufacturer selling cargo trailers across California.').join() === 'golden-state-trailers:California',
    'Golden State Trailers "across California" is flagged — it IS California-based, but the owner wants letters to say only "US" (2026-09-25)');
  assert(clean('Golden State Trailers (attached in profile highlights): US B2B manufacturer, 72 state/city landing pages.'), 'Golden State Trailers as US passes');
  assert(geoTerms('Vape Shop (USA): restricted e-commerce, new site launch.').join() === 'vape-shop:USA', 'Vape Shop has no location on record, so "(USA)" is flagged');
  assert(clean('Multilingual Site (attached in profile highlights): South Tyrol, Italian + German, on the Italian–Austrian border.'), 'the multilingual case\'s real geography passes');
  assert(clean('Oxytec (attached in profile highlights): German-market supplier with a Swiss HQ and European branches.'), 'Oxytec: German market, Swiss HQ, European branches pass');
  assert(clean('FridgeFix (attached in profile highlights): polish the ad copy, then turkey-shoot the negatives.'), 'lower-case words that are also places ("polish", "turkey") are never places');
  assert(clean('Luxury Parfums (attached in profile highlights): a perfume store in Ruritania.'), 'a place outside the vocabulary is never flagged — the check can miss, not invent');
  assert(geoTerms('FridgeFix (attached in profile highlights): Orange County repair shop. Nectar Flowers (attached in profile highlights): Ottawa florist.').length === 0,
    'two cases in one paragraph: Ottawa is read as Nectar Flowers\', not FridgeFix\'s');

  // ── timeframes ──────────────────────────────────────────────────────────
  assert(clean('Skin Reboot (attached as PDF): Sep 2024 – Oct 2025, +693.8% revenue.'), 'Skin Reboot\'s recorded period passes');
  assert(clean('Skin Reboot (attached as PDF): over 13 months, 17.51 PMax ROAS.'), 'a duration matching the record (13 of 14 months) passes');
  assert(clean('Skin Reboot (attached as PDF): in a little over a year, 17.51 PMax ROAS.'), '"a year" for a 14-month record passes (±20%)');
  assert(timePhrases('Skin Reboot (attached as PDF): Engagement: 7 months. Results: +91.58% organic traffic.').join() === 'skin-reboot:7 months',
    '"7 months" against a 14-month record is flagged (a real sent letter)');
  assert(clean('Oxytec (attached in profile highlights): +76% organic traffic (Mar–Nov 2020).'), 'Oxytec\'s canonical "(Mar–Nov 2020)" passes');
  assert(timePhrases('Oxytec (attached in profile highlights): grew organic traffic 6× in 2019.').join() === 'oxytec:2019', 'Oxytec "in 2019" is flagged (work began Feb 2020)');
  assert(clean('SMASH (attached in profile highlights): a 6-week build, results measured 6 months post-launch, a brand founded in 2019.'), 'SMASH\'s build, results window and founding year pass');
  assert(timePhrases('SMASH (attached in profile highlights): revenue tripled in 3 months.').join() === 'smash:3 months', 'SMASH "in 3 months" is flagged');
  assert(clean('FridgeFix (attached in profile highlights): 1,134 conversions at $0.67 in July–August 2023.'), 'FridgeFix\'s highlighted period passes');
  assert(timePhrases('FridgeFix (attached in profile highlights): cost per conversion down 92% over 90 days.').join() === 'fridgefix:90 days', 'FridgeFix "over 90 days" is flagged');
  assert(clean('Atlant (attached in profile highlights): Jun–Nov 2023 against the prior 6 months, +56.5% conversions.'), 'Atlant\'s recorded comparison window passes');
  assert(clean('ChronoCash (attached in profile highlights): €4.83K a month in ad spend, February 2025.'), '"€4.83K a month" is a rate, not a timeframe; February 2025 is on record');
  assert(clean('Derma Solution (attached as PDF): +14,342% conversions, Sep–Oct year over year.'), 'Derma\'s yearless "Sep–Oct" comparison (KB #506) passes');
  assert(timePhrases('Derma Solution (attached as PDF): 357 to 25,989 monthly users in under a year.').join() === 'derma-solution:a year', 'Derma "in under a year" is flagged (no duration on record)');
  assert(clean('In 12 years running Google Ads, FridgeFix is the clearest turnaround I have, and I am a Google Premier Partner 2026.'),
    'Artem\'s own "12 years" and "Premier Partner 2026" are never read as case periods');
  assert(clean('FridgeFix (attached in profile highlights): 2,587 clicks, 1,134 conversions, 7 days a week coverage.'), '"7 days a week" and comma-grouped numbers are not timeframes');
  assert(clean('FridgeFix (attached in profile highlights): the same rebuild would take your account about 60 days.'), 'a timeframe in a clause about the client\'s account is not a case claim');
  assert(clean('FridgeFix (attached in profile highlights): audit delivered within 1 working day, launch in 5 working days.'), 'Artem\'s delivery terms ("1 working day") are not case periods');

  // ── the prompt block ────────────────────────────────────────────────────
  const block = L.renderCaseFactsBlock();
  assert(L.CASE_LEDGER.every(c => block.includes(`- ${c.name}:`)), 'the CASE FACTS ON RECORD block lists every case');
  assert(/Luxury Parfums: location — none on record; timeframe — none on record/.test(block), 'a case with nothing on record says so explicitly');
  assert(/Nectar Flowers: location — Ottawa, Canada; timeframe — none on record/.test(block), 'Nectar Flowers: Ottawa, Canada, no timeframe');
  assert(/Atlant: location — never state one;/.test(block), 'Atlant: the prompt is told to state no location');
  assert(/Golden State Trailers: location — USA — say "US" only, never the state;/.test(block), 'Golden State Trailers: the prompt is told "US" only');
  const atlantRow = block.split('\n').find(l => l.startsWith('- Atlant:')) || '';
  assert(atlantRow && !/Ukrain|Kyiv|USA|\bUS\b/.test(atlantRow), 'the prompt\'s Atlant row names no place at all (SMASH / Game-X / GKit still say Ukraine — that rule is Atlant\'s only)');

  // ── grounding checker integration (record-only) ─────────────────────────
  // groundingCheck.js imports './caseLedger' extensionless (Vite resolves it,
  // Node does not), so load a copy with the import pointed at the real file.
  const gcSrc = fs.readFileSync(path.join(LIB, 'groundingCheck.js'), 'utf8')
    .replace("from './caseLedger'", `from '${pathToFileURL(path.join(LIB, 'caseLedger.js')).href}'`);
  const tmp = path.join(os.tmpdir(), `groundingCheck-${process.pid}.mjs`);
  fs.writeFileSync(tmp, gcSrc);
  const { groundingCheck } = await import(pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);
  const gc = groundingCheck(nectar16113, { postingText: '', enforce: true });
  assert(gc.violations.includes('caseGeoNotInLedger') && gc.violations.includes('caseTimeframeNotInLedger'), 'groundingCheck records both new claim classes on the 16113 paragraph');
  assert(gc.text === nectar16113, 'and, even with enforce on, leaves the text untouched (record-only)');
  assert(!groundingCheck(expanded, { enforce: true }).violations.some(v => /^case(Geo|Timeframe)/.test(v)), 'canonical lines raise neither class');

  // ── the corpus ──────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    try {
      require('child_process').execFileSync('python', [path.join(__dirname, '..', 'tools', 'dump_letters_fixture.py')], { stdio: 'inherit' });
    } catch (e) {
      console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
    }
  }
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    // Reviewed by hand on 2026-09-24 against KB #1 / #506: every one is a real
    // unsupported claim. (case id, term or phrase)
    const REVIEWED = [
      ['multilingual-site', '6 months'], ['derma-solution', '12 months'], ['vape-shop', 'USA'],
      ['golden-state-trailers', 'California'], ['atlant', 'US'], ['house-painting', 'California'],
      ['atlant', 'Chicago'], ['chronocash', 'Germany'], ['derma-solution', 'Korean'], ['chronocash', 'German'],
      ['derma-solution', 'a year'], ['house-painting', 'two weeks'], ['fridgefix', 'Vienna'],
      ['derma-solution', '18-month'], ['fridgefix', 'Dallas'], ['house-painting', 'San Diego'],
      ['atlant', 'Dallas'], ['skin-reboot', '7 months'],
      // Added 2026-09-25 with the owner's rule that Atlant's location is never
      // stated — these three letters named its real one (Kyiv / Ukrainian).
      ['atlant', 'Kyiv'], ['atlant', 'Ukrainian'],
    ];
    const reviewed = new Set(REVIEWED.map(([c, t]) => `${c}|${t}`));
    const found = new Set();
    const unreviewed = [];
    let hits = 0;
    for (const r of rows) {
      const res = facts(r.text || '');
      for (const g of res.geo) { hits++; found.add(`${g.case}|${g.term}`); if (!reviewed.has(`${g.case}|${g.term}`)) unreviewed.push(`GEO  ${g.name}: "${g.term}" | ${g.excerpt}`); }
      for (const t of res.time) { hits++; found.add(`${t.case}|${t.phrase}`); if (!reviewed.has(`${t.case}|${t.phrase}`)) unreviewed.push(`TIME ${t.name}: "${t.phrase}" | ${t.excerpt}`); }
    }
    console.log(`\ncorpus: ${rows.length} letters, ${hits} unsupported case facts`);
    const missed = REVIEWED.filter(([c, t]) => !found.has(`${c}|${t}`));
    assert(missed.length === 0, `every hand-reviewed corpus finding is still caught${missed.length ? ' — missed: ' + missed.map(x => x.join(':')).join(', ') : ''}`);
    if (unreviewed.length) {
      console.log(`NOTE  ${unreviewed.length} finding(s) not in the reviewed list — new letters since 2026-09-24? Check each by hand:`);
      unreviewed.forEach(u => console.log('      ' + u));
    }
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
