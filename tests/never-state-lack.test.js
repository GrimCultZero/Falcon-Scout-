// "Never state what I lack" (audit 2026-10-29, T22 rule 2; owner request 2026-11-16).
// A letter must not volunteer missing proof, cases or experience. Deterministic post-check
// (lib/letterGuards.js stripAdmissions) + a prompt rule. It only REMOVES words, never adds a claim.
// Fixtures are the owner's real examples; the "must stay" sentences are real lines from his sent letters.
// Run: node tests/never-state-lack.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

(async () => {
  const { stripAdmissions, isAdmissionClause } = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'letterGuards.js')).href);
  const strip = (t) => stripAdmissions(t).text;

  // ── the owner's fixtures ──────────────────────────────────────────────────
  assert(strip("I have no SaaS case, and none of my results are Meta results. These are the Google Ads proofs for the tracking and efficiency side:")
    === 'These are the Google Ads proofs for the tracking and efficiency side:', 'FIXTURE: the admission sentence is gone and the proof lead-in stays');
  const full = "Hi Sam,\n\nI have no SaaS case, and none of my results are Meta results. These are the Google Ads proofs for the tracking and efficiency side:\n\nSkin Reboot: +693.8% revenue.\n\nWhat is your monthly budget?";
  const r = stripAdmissions(full);
  assert(r.text === "Hi Sam,\n\nThese are the Google Ads proofs for the tracking and efficiency side:\n\nSkin Reboot: +693.8% revenue.\n\nWhat is your monthly budget?", 'in a whole letter: the proof list, greeting and question are untouched');
  assert(strip("I don't have a visual proof / screenshot of that, so I won't state that I have one. Relevant Google Ads results:") === 'Relevant Google Ads results:', 'FIXTURE: "I don\'t have a visual proof / screenshot ..., so I won\'t state that I have one." is removed');

  // ── variants ──────────────────────────────────────────────────────────────
  const gone = [
    "I don't have a screenshot of that, so I can't show one.",
    "I do not have a visual proof of this.",
    "I don't have any case studies in this niche.",
    "Unfortunately I don't have a case in this niche.",
    "I don't have a case in this niche.",
    "I haven't worked with Shopify Plus before.",
    "I haven't worked with Klaviyo before, and I won't pretend otherwise.",
    "I can't share the client's name or the dashboard.",
    "I'm not able to share screenshots of that account.",
    "I have no experience with HubSpot ads.",
    "I lack experience in hospitality.",
    "None of my results are from the hospitality industry.",
    "Unfortunately, I don't have a portfolio piece for fintech.",
    "I haven't managed a hospitality brand, so I won't claim one.",
    "I have no YouTube CPA or ROAS figures at 8-figure scale, so I won't invent any.",
    "I don't have a hospice redesign to show you, so I'm not going to pretend otherwise.",
    "Relevant results: I don't have a B2B SaaS case, and I won't pretend otherwise.",
    "Neither is a Business Profile or AI-citation case, so I won't claim that.",
    "I'll be straight that I have no real estate SEO case to show.",
  ];
  for (const g of gone) {
    const out = strip(`Intro line about your account and what I would do first. ${g} Closing line about next steps.`);
    assert(!out.includes(g.slice(0, 24)) && out.startsWith('Intro line') && out.endsWith('Closing line about next steps.'), `removed: ${g.slice(0, 70)}`);
  }
  assert(strip("Fine.\n\nI don't have a case in this niche. That said, here is the closest real result: +693.8% revenue.") === "Fine.\n\nHere is the closest real result: +693.8% revenue.", 'a broken lead-in ("That said,") on the next sentence is tidied and capitalised');
  assert(strip("I haven't worked with Shopify Plus before, but I have run Google Ads for 12 Shopify stores.") === 'I have run Google Ads for 12 Shopify stores.', 'an admission clause is cut and the real claim kept');
  assert(strip("It's not a home services client and I don't have a plumbing case to show you, but the suburb-page architecture transfers directly to DFW coverage.") === 'The suburb-page architecture transfers directly to DFW coverage.', 'a real sent sentence: the admission clause goes, the rest stays');
  assert(strip("Nothing to remove here. I have run Google Ads for 12 years.") === 'Nothing to remove here. I have run Google Ads for 12 years.', 'a letter with no admission is returned unchanged');
  assert(stripAdmissions('').text === '' && stripAdmissions(null).text === '', 'empty input is safe');
  const para = strip("I have no SaaS case.\n\nSecond paragraph stays.");
  assert(para === 'Second paragraph stays.', 'a paragraph that held nothing but the admission leaves no empty paragraph');

  // ── must NOT be removed: real positive sentences from the sent letters ────
  const keep = [
    "The mechanics of seasonal demand and booking intent are the same ones I've handled elsewhere.",
    "I haven't seen your site, so those are candidates, not findings.",
    "I haven't seen the account, so those are where I'd look first, not findings.",
    "I haven't crawled your site, so those are candidates, not findings.",
    "Strategy: I do not run blanket PMax campaigns.",
    "I don't spread budget evenly across platforms.",
    "I don't touch ad copy until the search terms report shows what people are actually typing.",
    "I've attached a sample technical SEO audit so you can see the format and depth.",
    "The closest account I've personally managed is Atlant, a large residential developer (2M+ sq.m of housing built across 18 cities).",
    "I've scaled organic channels for restricted/YMYL verticals where paid advertising is blocked or severely limited.",
    "Rate: I don't bill hourly on audits or account management.",
    "I can start with the audit as soon as I have access.",
    "For AEO/GEO I structure pages so the answer, service area and proof are easy to extract, and I don't promise citations.",
    "Here are accounts I've managed:  Skin Reboot (case study attached as a PDF): health/wellness ecommerce, feed-based PMax from Sep 2024 to Oct 2025.",
    "On Webflow I've audited a bilingual store in depth and can specify the exact code changes.",
    "I built the mix of Video, PMax, DSA and Demand Gen.",
    "Golden State Trailers (attached in profile highlights) is a US manufacturer where I built 72 localized city and state landing pages on a commercial-intent keyword core.",
    "I haven't looked at your account yet, so I would start with an audit.",
    "I don't have access to your Merchant Center yet.",
    "I won't present the FridgeFix number as the norm.",
    "I haven't run your account yet, so I would begin with a read-only audit.",
    "I haven't built your funnel yet, so I would start by mapping it.",
    "I have run Google Ads for 12 years across ecommerce and lead generation.",
  ];
  for (const k of keep) assert(strip(k) === k && !isAdmissionClause(k), `kept: ${k.slice(0, 80)}`);
  assert(keep.length >= 5, 'at least 5 real positive sentences are pinned');

  // ── never adds a claim ────────────────────────────────────────────────────
  const before = "I have no SaaS case, and none of my results are Meta results. These are the Google Ads proofs: Skin Reboot (+693.8% revenue).";
  const after = strip(before);
  const words = (x) => new Set(x.toLowerCase().match(/[a-z0-9+.%]+/g));
  assert([...words(after)].every(w => words(before).has(w)), 'the output only ever contains words that were already in the letter');

  // ── prompt + chain wiring ─────────────────────────────────────────────────
  const jd = read('frontend', 'src', 'components', 'JobDetail.jsx');
  assert(/NEVER STATE WHAT ARTEM LACKS/.test(jd) && /SAY NOTHING about the gap/.test(jd) && /CLAIMING a case, result, number, timeframe or experience Artem does not have is never fine/.test(jd), 'the generator prompt carries the rule, and keeps the ban on invented claims');
  assert(/const _adm = stripAdmissions\(text\)/.test(jd) && /statedWhatArtemLacks/.test(jd), 'the generate chain runs the post-check and records when it fired');
  assert(/stripAdmissions\(text\)\.text/.test(jd.slice(jd.indexOf('onProposalRewrite={(text)'), jd.indexOf('onProposalRewrite={(text)') + 400)), 'a chat rewrite goes through the same post-check');
  assert(/invented|invent/i.test(jd) && /_fixCaseCountClaim|findCaseFactConflicts/.test(jd), 'the existing guards against invented cases and numbers are still wired');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
