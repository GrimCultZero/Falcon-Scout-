// The closing audit offer on a running account (owner rule, 2026-09-29).
//
// Owner: "I dont understand why generator stopped offering audits as CTA in the
// end where the job posting explicitly states that accounts are already running.
// It is happening constantly." Job 16684 ("take over and directly manage our
// existing Google Ads and Meta Ads accounts … we're not starting from scratch")
// ended on its week-one plan, twice. Why nothing held the close in place:
//   - the prompt never said WHERE the audit offer goes, its ending rule says
//     "No CTA", and the no-pricing note said the model "may" offer it;
//   - "not starting from scratch" matched the launch triggers — the prompt's
//     "WHEN NOT TO OFFER AN AUDIT" list and KB #450's routing both;
//   - the audit rules (#402, #404) route on audit vocabulary, which a takeover
//     posting needn't use;
//   - no check reports a running-account letter with no audit offer at all.
// Now: postingHasRunningAccount + ensureRunningAccountAuditCta (letterGuards.js),
// prompt wording, routing. Calibrated on the 256 sent letters: on the 67 whose
// posting states a running account, the insert fires 0 times — every one already
// offered an audit, in eight different wordings.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const running = (t) => G.postingHasRunningAccount(t);

  // ── the posting says the account is running ─────────────────────────────
  const post16684 = "E-commerce Performance Marketing Expert — Google Ads & Meta Ads\nWe're looking for an experienced E-commerce Performance Marketing Specialist to take over and directly manage our existing Google Ads and Meta Ads accounts.\nThis is an existing setup with extensive historical data — we're not starting from scratch.\nPlease focus on concrete actions and implementation rather than a general audit or review process.\nIn your proposal, please include:\n-Your hourly rate.";
  assert(!!running(post16684), 'job 16684: a takeover of existing accounts is a running account — "not starting from scratch" does not make it a launch');
  const RUNNING = [
    'We are seeking a skilled Google Ads Specialist to manage and optimize our advertising campaigns.',
    'Need a freelancer to review and improve my Google AdWords search and shopping campaigns.',
    'Our Google Ads account has been underperforming since March.',
    'We currently spend around $3,000/month on Google Ads.',
    'Take over our existing PPC account and cut wasted spend.',
    'Google Ads has 4 active campaigns across Brand Search, Non-Brand Search and Shopping.',
  ];
  for (const s of RUNNING) assert(!!running(`Google Ads\n${s}`), `running: "${s.slice(0, 80)}"`);
  const NOT_RUNNING = [
    'We need an expert to set up and optimize a Google Ads account for a Shopify jewelry store.',
    'Launching our first Google Ads campaigns — no existing account, zero pixel data.',
    'We are seeking a Google Ads expert to set up and manage our account.',
    'Build our Google Ads from scratch for a new brand.',
    "We don't have a Google Ads account yet.",
    'Looking for a Google Ads specialist for product testing on new Shopify stores.',
  ];
  for (const s of NOT_RUNNING) assert(running(`Google Ads\n${s}`) === null, `not running: "${s.slice(0, 80)}"`);

  // ── the closing audit offer ─────────────────────────────────────────────
  const letter = 'Reading your post, the tracking migration broke signal continuity.\n\nFirst 24 hours: negatives added, budget bleeding stopped. First week: 8+ daily sales or a clear roadmap to it.\n\nArtem';
  const plain = G.ensureRunningAccountAuditCta(letter, { postingText: post16684, asksRate: false });
  const paras = plain.text.split('\n\n');
  assert(plain.inserted === 'plain' && paras[paras.length - 1] === 'Artem' && /^I can audit your Google Ads account entirely by hand/.test(paras[paras.length - 2]), 'running account, no audit offer: the offer becomes the last paragraph before "Artem"');
  assert(!/\$\d/.test(plain.text) && /within 1 working day/.test(plain.text) && /attaching a sample of a recent Google Ads audit/.test(plain.text), '…price-free when the posting did not ask, with the 1-working-day turnaround and the sample');
  const priced = G.ensureRunningAccountAuditCta(letter, { postingText: post16684 + '\nThere is potential for a long-term collaboration if the initial takeover goes well.', asksRate: true });
  assert(priced.inserted === 'priced+credit' && /\$300 flat/.test(priced.text) && /credited back if we move on to ongoing management/.test(priced.text), 'asked for a rate + ongoing signal: $300 flat and the fee credit');
  const pricedOnly = G.ensureRunningAccountAuditCta(letter, { postingText: post16684, asksRate: true });
  assert(pricedOnly.inserted === 'priced' && !/credited back/.test(pricedOnly.text), 'no ongoing signal: no credit line');
  // the checks read the inserted paragraph as a complete offer
  const MANUAL = /\b(?:entirely|100\s?%|completely|fully|all)\s+manual(?:ly)?\b|\bmanual(?:ly)?\b[^.\n]{0,60}\bno\s+automat|\bby\s+hand\b[^.\n]{0,60}\baudit\b|\baudit\b[^.\n]{0,60}\bby\s+hand\b|\bno\s+automat\w*[^.\n]{0,60}\bmanual(?:ly)?\b/i;
  const COMPLIMENTARY = /\b(?:complimentary|credit(?:ed)?\s+(?:back|toward|against|off)|on\s+(?:me|the\s+house)|waive[d]?|no\s+charge|free)\b[^.\n]{0,70}\b(?:if|when|once|should)\b[^.\n]{0,50}\b(?:work(?:ing)?\s+together|ongoing|continu(?:e|ing)|hire|retain|management|partner)\b/i;
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes(MANUAL.source) && MANUAL.test(plain.text) && MANUAL.test(priced.text), 'both versions satisfy _MANUAL_AUDIT_CLAIM_RE (copied here verbatim, checked against the source)');
  assert(src.includes(COMPLIMENTARY.source.slice(0, 120)) && COMPLIMENTARY.test(priced.text), 'the credit line satisfies _DRAFT_COMPLIMENTARY_RE');
  assert(G.draftAttachesAuditSample(plain.text), 'draftAttachesAuditSample sees the sample');
  assert(G.ensureAuditSampleMention(plain.text, {}).inserted === null, 'and ensureAuditSampleMention adds no second one');
  // left alone
  const offered = 'Every audit I run is done entirely by hand.\n\nArtem';
  assert(G.ensureRunningAccountAuditCta(offered, { postingText: post16684 }).inserted === null, 'a letter that already offers an audit is left alone');
  for (const t of ['Account Audit: I will analyze your current Google Ads setup.', "I'm attaching a sample Google Ads audit so you can see the format.", 'I am fully on board with starting on a paid audit.', "I'd start with a quick audit of the account."])
    assert(G.ensureRunningAccountAuditCta(`${t}\n\nArtem`, { postingText: post16684 }).inserted === null, `existing offer recognised: "${t.slice(0, 60)}"`);
  assert(G.ensureRunningAccountAuditCta('First 24 hours: conversion-tracking audit complete.\n\nArtem', { postingText: post16684 }).inserted === 'plain', 'a plan step ("conversion-tracking audit complete") is not an offer');
  assert(G.ensureRunningAccountAuditCta(letter, { postingText: 'Google Ads\nWe need an expert to set up and optimize a Google Ads account for our new store.' }).inserted === null, 'a setup / launch posting never gets it');
  assert(G.ensureRunningAccountAuditCta(letter, { postingText: 'SEO Specialist\nImprove our existing site rankings; our current campaigns are organic only.' }).inserted === null, 'a posting with no Google Ads never gets it');
  assert(G.ensureRunningAccountAuditCta(letter, { postingText: post16684 + '\nWe already had an audit done last month.' }).inserted === null, 'nor one whose client already had an audit');
  const unsigned = G.ensureRunningAccountAuditCta('Plan text.', { postingText: post16684 });
  assert(/Plan text\.\n\nI can audit/.test(unsigned.text), 'no sign-off: the offer is appended at the end');

  // ── wiring in JobDetail.jsx ─────────────────────────────────────────────
  const chainAt = src.indexOf('_postingOnlyLowerForStrips), _requiredOpenerPhrase))');
  const ctaAt = src.indexOf('const _cta = ensureRunningAccountAuditCta(text, { postingText: _postingTitleDesc, asksRate: _postingAsksRate })');
  assert(chainAt !== -1 && ctaAt > chainAt && ctaAt - chainAt < 1500, 'the insert runs right after the strip chain, so no strip can remove it');
  assert(/_recordViolations\('generator', job\?\.id, \['auditCtaAutoInserted'\]\)/.test(src), '…and is recorded as auditCtaAutoInserted');
  assert(/_dualChannelNote,\n\s+_runningAccountNote,\n\s+_actionOverAuditNote,/.test(src) && /RUNNING ACCOUNT — CLOSE WITH THE AUDIT OFFER/.test(src), 'the RUNNING ACCOUNT note reaches the prompt');
  assert(/- The audit offer is the LAST paragraph of the letter, right before "Artem"/.test(src), 'WHEN TO OFFER AN AUDIT says where the offer goes');
  assert(/A NEGATED mention is the opposite signal and does NOT make a launch/.test(src), 'WHEN NOT TO OFFER AN AUDIT no longer reads "not starting from scratch" as a launch');
  assert(/The concrete deliverable offer is NOT one of these banned lines/.test(src), 'the "No CTA" ending rule carves out the audit offer');
  assert(/The audit offer itself STAYS: on an existing \/ running account it is still the letter's closing paragraph/.test(src) && !/You may still OFFER the audit as the closing call to action/.test(src), 'the no-pricing note keeps the offer (it said "may")');

  // ── routing, lifted from JobDetail.jsx ──────────────────────────────────
  const from = src.indexOf('function parseRuleScopes');
  const to = src.indexOf('function rulesForAnalyser');
  const R = new Function('postingHasRunningAccount', 'blankNegatedLaunch', `${src.slice(from, to)}; return { jobScopes }`)(G.postingHasRunningAccount, G.blankNegatedLaunch);
  const s16684 = R.jobScopes(post16684.replace(/rather than a general audit or review process/, 'rather than a review process'));
  assert(!s16684.has('launch'), 'job 16684: "we\'re not starting from scratch" no longer routes KB #450 (launch)');
  assert(s16684.has('audit'), '…and the takeover routes the audit rules (#402, #404) even without the word "audit"');
  assert(R.jobScopes('Build our Google Ads from scratch for a new brand.').has('launch'), 'a real from-scratch launch still routes as launch');

  // ── corpus ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
  } else {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    let eligible = 0, fired = 0;
    for (const r of rows) {
      if (!running(r.posting || '')) continue;
      eligible++;
      if (G.ensureRunningAccountAuditCta(r.text, { postingText: r.posting }).inserted) fired++;
    }
    console.log(`\ncorpus: ${rows.length} letters — ${eligible} on running-account postings; the insert would fire on ${fired}`);
    // Every sent letter on a running-account posting already offers an audit —
    // the insert must never add a second one.
    assert(eligible >= 55 && fired === 0, `sent letters are never given a second offer (${fired} of ${eligible}; 0 of 67 on 2026-09-29)`);
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
