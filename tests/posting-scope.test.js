// Job 16684 (2026-09-29, owner: "fix all"): the letter answered the posting's
// list but not the posting. Five fixes, each tested here:
//   1. groundingCheck: a figure the POSTING states is the client's, never a case
//      metric. The draft tied Nectar Flowers to "your $2,000–$3,000/month";
//      metricNotInLedger deleted that whole sentence — case name, attachment note
//      and bridge — and the letter opened on "Dropped CPA 72%, grew transaction
//      revenue 350% inside 90 days." with no case at all.
//   2. findUnsolicitedLogistics: "Available to start immediately" answered the
//      posting's "Your availability to start." and was flagged as volunteered.
//   3. postingDeclinesAudit: missingAuditPriceEntirely demanded the $300 audit on
//      a posting that asks for "concrete actions and implementation rather than a
//      general audit or review process".
//   4. Telemetry-only codes (agencyClassificationOverrodeRegex) out of the flag list.
//   5. postingNamesGoogleAndMeta / letterCoversMeta + two prompt notes: the plan
//      covered Google only on a Google Ads + Meta takeover, and its first 24 hours
//      was pure review.
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
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const gcSrc = fs.readFileSync(path.join(LIB, 'groundingCheck.js'), 'utf8')
    .replace("from './caseLedger'", `from '${pathToFileURL(path.join(LIB, 'caseLedger.js')).href}'`);
  const tmp = path.join(os.tmpdir(), `groundingCheck-scope-${process.pid}.mjs`);
  fs.writeFileSync(tmp, gcSrc);
  const { groundingCheck } = await import(pathToFileURL(tmp).href);

  // ── 1. the client's figures are not case metrics ────────────────────────
  const posting16684 = 'E-commerce Performance Marketing Expert — Google Ads & Meta Ads\nCombined paid media spend is currently around $2,000–$3,000 per month and may increase based on performance.';
  const opener = 'Dropped CPA 72%, grew transaction revenue 350% inside 90 days. Nectar Flowers (attached in profile highlights), a seasonal ecommerce florist whose account had drifted, same recovery shape as your $2,000 - $3,000/month setup.';
  const tail = '\n\n12 years running Google Ads, Google Premier Partner 2026.\n\nArtem';
  const kept = groundingCheck(opener + tail, { postingText: posting16684, enforce: true });
  assert(kept.text.startsWith(opener) && !kept.violations.includes('metricNotInLedger'), "job 16684: the client's $2,000–$3,000 is theirs — the case sentence stays, case name and all");
  const old = groundingCheck(opener + tail, { postingText: '', enforce: true });
  assert(old.text.startsWith('Dropped CPA 72%, grew transaction revenue 350% inside 90 days.\n'), '(without the posting it is the shipped opener: numbers, no case)');
  assert(old.violations.includes('caseMetricsOrphaned'), '…and that is now reported as caseMetricsOrphaned');
  const fab = groundingCheck('Nectar Flowers (attached in profile highlights): 9.4x ROAS in a month.' + tail, { postingText: posting16684, enforce: true });
  assert(fab.violations.includes('metricNotInLedger') && !/9\.4x/.test(fab.text), 'a fabricated case metric is still removed');
  const shape = groundingCheck('Nectar Flowers (attached in profile highlights): 3x revenue.' + tail, { postingText: 'Google Ads has 3 active campaigns.', enforce: false });
  assert(shape.violations.includes('metricNotInLedger'), 'shape-specific: the posting\'s "3 campaigns" never licenses a "3x" on a case');
  const k = groundingCheck('Nectar Flowers (attached in profile highlights): at your $2,000/month we would keep it lean.' + tail, { postingText: 'Budget around $2K per month.', enforce: false });
  assert(!k.violations.includes('metricNotInLedger'), '"$2K" in the posting and "$2,000" in the letter are the same figure');
  assert(groundingCheck(opener + tail, { postingText: posting16684, enforce: false }).text === opener + tail, 'shadow mode still never changes text');

  // ── 2. logistics the posting asked about ────────────────────────────────
  const avail = 'Ongoing: 8 - 10 hours/week once stable. Available to start immediately.';
  assert(G.findUnsolicitedLogistics(avail, { postingText: 'In your proposal, please include:\n-Your availability to start.' }).length === 0, 'job 16684: availability answers "Your availability to start."');
  assert(G.findUnsolicitedLogistics(avail, { postingText: 'Manage our Google Ads account.' }).map(l => l.kind).join() === 'availability', '…and is still flagged when nobody asked');
  for (const p of ['Your availability and rate', 'Availability to start immediately', 'Looking for someone to start immediately.', 'When can you start?', 'How many hours per week can you commit?'])
    assert(G.findUnsolicitedLogistics('Can start immediately.', { postingText: p }).length === 0, `availability asked: "${p}"`);
  assert(G.findUnsolicitedLogistics("I'm based in EET, timezone overlap isn't an issue.", { postingText: 'Manage our SEO.' }).map(l => l.kind).join() === 'timezone', 'an unasked timezone is still flagged');
  assert(G.findUnsolicitedLogistics("I'm based in EET, timezone overlap isn't an issue.", { postingText: 'Must overlap with EST business hours.' }).length === 0, '…not when the posting asks for overlap');
  assert(G.findUnsolicitedLogistics('I work async with structured weekly reporting.', { postingText: 'There is already extensive historical data available.' }).length === 2, '"data available" is not an availability ask, and async/reporting stay flagged');

  // ── 3. the posting turns down an audit ──────────────────────────────────
  const DECLINES = [
    'Please focus on concrete actions and implementation rather than a general audit or review process.',
    'We need someone who can implement the improvements—not just provide an audit.',
    'This is NOT an audit-only project.',
    'We are interested in practical implementation, not just an audit or theoretical recommendations.',
    'working collaboratively with our team rather than a standalone CRO audit',
    'We do not want someone who only gives us an audit document.',
    'We are not looking for another audit or a list of recommendations.',
    'implement the improvements rather than simply send us an automated SEO audit',
  ];
  for (const s of DECLINES) assert(!!G.postingDeclinesAudit(s), `declines an audit: "${s.slice(0, 80)}"`);
  const STILL_WANTS = [
    'We are not looking for a generic SEO audit or a report that simply lists technical issues.',
    'This is not a standard SEO audit.',
    'We are not looking for an automated audit that simply exports a list of errors.',
    'This is not a basic SEO audit or automated SEMrush/Ahrefs report.',
    'This is not a full audit. We need someone to briefly review the account.',
    "there's room to continue working together beyond the audit",
    'The goal of this project is not simply to collect more reviews.',
    'No fake reviews, review gating, or keyword-stuffed names.',
  ];
  for (const s of STILL_WANTS) assert(G.postingDeclinesAudit(s) === null, `not declined: "${s.slice(0, 80)}"`);

  // ── 5. Google Ads + Meta in scope ───────────────────────────────────────
  const both = (t) => G.postingNamesGoogleAndMeta(t);
  assert(both("E-commerce Performance Marketing Expert — Google Ads & Meta Ads\nWe're looking for an experienced specialist to take over and directly manage our existing Google Ads and Meta Ads accounts."), 'job 16684: Google Ads + Meta takeover is in scope');
  assert(both('Google Ads and Meta Ads Specialist\nSeeking an experienced specialist to audit, correct, and manage Google Ads and Meta Ads campaigns.'), 'a title naming Meta');
  assert(!both('Google Ads Specialist for E-commerce Product Testing\nPlan and structure product tests on Google (Standard Shopping, Search, Performance Max).\n\nNice to have\n\n\t•\tExperience with Meta Ads alongside Google\n\t•\tExperience with dropshipping\n\nHow to apply\nPlease include your rate.'), 'job 16678: Meta under "Nice to have" is not in scope');
  assert(!both('Google Ads & Funnel Specialist\nRun our Google Ads lead gen.\nNice to Have (Not Required)\nMeta Ads experience\nSEO / local SEO experience'), 'a nice-to-have section with unbulleted items');
  assert(!both('Google Ads Setup Support\nSet up our Google Ads. Possibly we are interested in working together long-term and adding Meta Ads, especially Instagram.'), 'a maybe-later');
  assert(!both("Google Ads Expert for E-commerce\nWe are an e-commerce company growing two brands through Meta and Google Ads, and we're looking for someone who can assess our Google Ads efforts."), "the client's own channel, not the freelancer's work");
  assert(!both('Meta Ads Manager for Maternal Wellness Brand\nRun our Meta campaigns.'), 'Meta without Google Ads is not a dual-channel job');
  assert(G.letterCoversMeta('Meta Sales campaigns get a creative-fatigue check.') && G.letterCoversMeta('Facebook pixel and CAPI verified.'), 'letterCoversMeta reads Meta work');
  assert(!G.letterCoversMeta('Optimised the meta descriptions and meta tags.'), '…but not SEO meta tags');

  // ── wiring in JobDetail.jsx ─────────────────────────────────────────────
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  assert(/\[jobObj\.title, jobObj\.description_full \|\| jobObj\.description_snippet \|\| jobObj\.raw_message\]\.filter\(Boolean\)\.join\('\\n'\)/.test(src), 'the grounding checker gets the title + description');
  assert(/const _logisticsVolunteered = findUnsolicitedLogistics\(text, \{ postingText: `\$\{job\.title \|\| ''\}\\n\$\{fullDescription\}` \}\)/.test(src) && /const hasUnsolicitedLogistics = _logisticsVolunteered\.length > 0/.test(src) && !src.includes('UNSOLICITED_LOGISTICS_RE'), 'hasUnsolicitedLogistics reads the posting (the inline list is gone)');
  assert(/const missingAuditPriceEntirely = _postingAsksRate && jobIsPpcAuditExisting && !draftOffersPpcAudit && !_auditDeclinedAsk/.test(src), 'missingAuditPriceEntirely stands down when the posting declines an audit');
  const info = src.match(/const _INFO_ONLY_CODES = new Set\(\[([\s\S]*?)\]\)/);
  assert(info && /'agencyClassificationOverrodeRegex'/.test(info[1]) && /'draftNotCompliant'/.test(info[1]) && /'digitBombArmedForThisRun'/.test(info[1]), 'telemetry-only codes are listed…');
  assert(/setRuleFlags\(_getRunViolations\(\)\.filter\(n => !_INFO_ONLY_CODES\.has\(n\)\)\)/.test(src), '…and kept out of the flag list under the letter');
  assert(/_caseDomainNote,\n\s+_dualChannelNote,\n\s+_actionOverAuditNote,/.test(src), 'both job-specific notes reach the prompt, next to the case-domain note');
  assert(/const _dualChannelNote = postingNamesGoogleAndMeta\(_postingTitleDesc\)/.test(src) && /None of the approved case studies is a Meta case/.test(src), 'the Meta note is gated on the detector and forbids a Meta track record');
  assert(/const _actionOverAuditNote = _auditDeclinedAsk/.test(src) && /the EARLIEST block must contain real changes/.test(src), 'the action note is gated on the posting declining an audit');
  assert(/const metaChannelMissing = !!_dualChannelNote && !letterCoversMeta\(text\)/.test(src) && /metaChannelMissing && 'metaChannelMissing'/.test(src), 'metaChannelMissing is a reported check');

  // ── corpus ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
  } else {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const logistics = rows.filter(r => G.findUnsolicitedLogistics(r.text, { postingText: r.posting }).length).length;
    let dual = 0, noMeta = 0, declines = 0;
    for (const r of rows) {
      if (G.postingDeclinesAudit(r.posting || '')) declines++;
      if (!G.postingNamesGoogleAndMeta(r.posting || '')) continue;
      dual++;
      if (!G.letterCoversMeta(r.text)) noMeta++;
    }
    console.log(`\ncorpus: ${rows.length} letters — logistics flagged ${logistics}; ${declines} posting(s) decline an audit; ${dual} Google+Meta posting(s), ${noMeta} letter(s) never mention Meta`);
    // Hand-reviewed 2026-09-29: the old logistics check flagged 10; the 4 dropped
    // all answer an explicit ask ("Your availability and rate", "Availability to
    // start immediately", "Looking for someone to start immediately", "your
    // availability"). The 2 Meta misses are "Google Ads and Meta Ads Specialist"
    // and a Google Ads + Facebook Ads manager posting.
    assert(logistics >= 4 && logistics <= 8, `logistics flags stay on the unasked ones (${logistics}; 6 on 2026-09-29, was 10)`);
    assert(declines >= 2 && declines <= 6, `audit-declining postings stay rare (${declines}; 4 on 2026-09-29)`);
    assert(dual >= 8 && dual <= 14 && noMeta <= 4, `Google + Meta postings found (${dual}; 11 on 2026-09-29), Meta misses (${noMeta}; 2)`);
  }

  try { fs.unlinkSync(tmp); } catch {}
  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
