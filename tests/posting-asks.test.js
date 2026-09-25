// What the posting asks for, and what the letter prices — three fixes from job
// 16242 (2026-09-25), all in frontend/src/lib/letterGuards.js:
//
//   postingAsksForTimeline — the original inline regex plus the list shapes it
//     missed ("…your proposed first steps, timeline, and cost"), which made
//     coverHasTimeline flag the timeline the client had asked for.
//   findRequestedExample + letterGivesExample — the posting asks for an example
//     and the letter names no case: the live "Fix before sending" line. On 16242
//     a chat rewrite swapped the example for Game-X, the web-dev strip removed
//     it, and nothing noticed.
//   findOffLedgerSeoPrices — KB Rule 426 has two SEO prices ($700 flat audit,
//     included in the $1,050/month retainer); 16242 quoted "$3,500 flat" and no
//     check saw it, because the SEO price checks only ran on audit-classified jobs.
//
// Every added pattern was read match by match against the 476 postings in the
// DB on 2026-09-25 (WORKLOG.md). The corpus sections here use the sent-letter
// fixture, which carries each letter's posting.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const L = await import(pathToFileURL(path.join(LIB, 'caseLedger.js')).href);

  // ── timeline asks ───────────────────────────────────────────────────────
  const T = (s) => G.postingAsksForTimeline(s);
  assert(T('Please apply with a relevant before-and-after project example, your proposed first steps, timeline, and cost.'), 'job 16242: "first steps, timeline, and cost" asks for a timeline');
  assert(T('Give us a timeline and a fixed price for Phase 1.'), '"Give us a timeline and a fixed price" asks');
  assert(T('Your timeline in business days.'), '"Your timeline in business days" asks');
  assert(T('Please include 2-3 case studies, and confirm your fixed price and timeline.'), '"your fixed price and timeline" asks');
  assert(T("What's your timeline?"), '"What\'s your timeline?" asks');
  assert(T('Please provide a timeline.') && T('How long will it take?') && T('What is the ETA?'), 'the original shapes still ask ("provide a timeline", "how long", "ETA")');
  assert(!T('**Project Timeline & Budget:** * **Duration:** Long-term partnership'), 'a client\'s own "Timeline & Budget:" header is NOT a request (a real posting, #9419)');
  assert(!T('We have a tight timeline and need someone reliable.'), '"we have a tight timeline" is not a request');

  // ── example asks ────────────────────────────────────────────────────────
  const E = (s) => G.findRequestedExample(s);
  assert(E('Please apply with a relevant before-and-after project example, your proposed first steps, timeline, and cost.')?.phrase === 'before-and-after', 'job 16242: the before-and-after example is found');
  assert(!!E('An example of an underperforming campaign you improved, including the starting situation.'), 'job 16113: "An example of an underperforming campaign you improved"');
  assert(!!E('Please include: SEO case studies, traffic growth screenshots.'), '"Please include: SEO case studies"');
  assert(!!E('Examples of Shopify stores you\'ve audited.'), '"Examples of Shopify stores you\'ve audited"');
  assert(!!E('Links to Shopify stores you\'ve built or worked on.'), '"Links to Shopify stores you\'ve built"');
  assert(!!E('Briefly describe a similar project you have completed and the outcome.'), '"describe a similar project you have completed"');
  assert(!E('For example, our store sells candles and diffusers.'), '"For example, our store…" is not an ask');
  assert(!E('Reporting should show results separately by campaign.'), 'a posting describing its own reporting is not an ask (a real posting, #16177)');
  assert(!E('Own Merchant Center end-to-end for a portfolio of existing Shopify stores.'), '"a portfolio of existing stores" is the client\'s business, not an ask');

  // ── does the letter give one? ───────────────────────────────────────────
  const letter16242 = "Your 57% site health is fixable.\n\n12 years in technical SEO.\n\nTimeline: 2 weeks for the diagnostic.\n\nAttaching a sample technical SEO audit so you can see the format and depth.\n\nArtem";
  assert(!G.letterGivesExample(letter16242), 'job 16242\'s letter as shared names no case — the note fires');
  assert(G.letterGivesExample(letter16242.replace('12 years in technical SEO.', '12 years in technical SEO.\n\nDerma Solution (attached as PDF): YMYL medical aesthetics.')), 'with Derma Solution added it gives one');
  assert(G.letterGivesExample('Live store I built: smash.com.ua — the checkout rebuild.'), 'a live URL answers a portfolio ask too (KB #518 "Live proof sites")');
  assert(L.casesMentioned('FridgeFix and Nectar Flowers, plus SMASH.').join() === 'nectar-flowers,fridgefix,smash', 'casesMentioned returns the named cases in ledger order');
  assert(L.casesMentioned('smash your targets').length === 0, 'the verb "smash" is not SMASH');

  // ── SEO prices ──────────────────────────────────────────────────────────
  const P = (s, o) => G.findOffLedgerSeoPrices(s, o);
  const p16242 = P('Timeline: 2 weeks for the diagnostic + prioritized fix doc. Cost for the diagnostic phase + implementation coordination + follow-up audit: $3,500 flat.');
  assert(p16242.length === 1 && p16242[0].amount === 3500 && p16242[0].kind === 'flat', 'job 16242: "$3,500 flat" is off the ledger');
  assert(P("Cost: $700 flat for the technical audit. It's included in the $1,050/month optimization retainer if we continue.").length === 0, 'the Rule 426 wording passes ($700 flat, $1,050/month)');
  assert(P('I charge $35/hr for implementation work.').length === 0, 'hourly figures are left to the rate-anchor checks');
  assert(P('Derma Solution (attached as PDF): $140 average cost per conversion, 357 → 25,989 users.').length === 0, 'a case paragraph\'s figures are metrics, not prices');
  assert(P('With your $5k/month ad budget, the first fix is tracking.').length === 0, 'the client\'s own budget is not Artem\'s price');
  const range = P('That maps to monthly around $1,200 - $1,800 depending on scope.');
  assert(range.length === 1 && range[0].kind === 'monthly' && range[0].amount === 1200 && range[0].high === 1800, 'a range is one monthly quote, flagged (a real sent letter)');
  assert(P('Monthly retainer $950 for full scope.')[0]?.kind === 'monthly', '"Monthly retainer $950" reads as monthly and is flagged');
  assert(P('No retainer needed: $700 flat for the audit.').length === 0, '"No retainer needed: $700 flat" is the flat audit price, not a monthly one');
  assert(P('$500 flat, as posted.', { postedFixed: '500' }).length === 0, 'the posting\'s own fixed budget is allowed');

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
    let lost = 0, gained = 0;
    for (const r of rows) {
      const p = r.posting || '';
      const old = G._TIMELINE_ASK_ORIGINAL_RE.test(p), now = G.postingAsksForTimeline(p);
      if (old && !now) lost++;
      if (now && !old) gained++;
    }
    assert(lost === 0, `the widened timeline detector keeps every posting the original caught (lost ${lost}; gained ${gained})`);

    let asks = 0; const none = [];
    for (const r of rows) {
      const ask = G.findRequestedExample(r.posting || '');
      if (!ask) continue;
      asks++;
      if (!G.letterGivesExample(r.text || '')) none.push(`[${r.status}] "${ask.sentence.slice(0, 90)}"`);
    }
    console.log(`\ncorpus: ${asks} of ${rows.length} sent letters answered a posting asking for an example; ${none.length} gave none:`);
    none.forEach(s => console.log('      ' + s));
    // 6 on 2026-09-25, each read by hand as a genuine miss.
    assert(none.length >= 1 && none.length <= 10, `the missing-example note would have fired on real misses only (${none.length}; 6 on 2026-09-25)`);

    const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');
    const lift = (marker) => { const l = src.split('\n').find(x => x.includes(marker)); return eval(l.slice(l.indexOf('= /') + 2).replace(/\.test\([^)]*\)\s*$/, '').trim()); };
    const PPC = lift('const PPC_JOB_KEYWORDS ='), SEO = lift('const SEO_JOB_KEYWORDS ='), ASKS = lift('const _postingAsksRateRegex =');
    let seo = 0; const flagged = [];
    for (const r of rows) {
      const p = (r.posting || '').toLowerCase();
      if (!SEO.test(p) || PPC.test(p)) continue;
      seo++;
      if (!ASKS.test(p)) continue;
      for (const h of G.findOffLedgerSeoPrices(r.text || '', { postedFixed: r.fixed_budget })) flagged.push(`[${r.status}] $${h.amount}${h.high ? '-' + h.high : ''} ${h.kind} | ${h.sentence.slice(0, 110)}`);
    }
    console.log(`\ncorpus: ${seo} SEO-only letters; off-ledger prices where the posting asked for one:`);
    flagged.forEach(s => console.log('      ' + s));
    // 2 on 2026-09-25 ("monthly around $1,200 - $1,800", "$950/month"), both real deviations from Rule 426.
    assert(flagged.length <= 5, `off-ledger SEO prices stay rare (${flagged.length}; 2 on 2026-09-25) — a jump means metrics are being read as prices`);
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
