// _stripRedundantTrailingCaseBlock — the same case studies cited twice.
//
// Job 17575 (2026-10-07, "Google Ads Set Up"): the letter cited Nectar Flowers and
// Skin Reboot under "Proof this approach works:" near the top, then cited the SAME
// two again under "Relevant work:" lower down, reworded with the same metrics.
// caseDuplicated fired, but nothing removed them, because this function only ever
// looked at a case block running to the very END of the letter (modulo a short
// sign-off) — and here a "Rate:" section sat after the duplicate block, so the
// block was never examined at all. It now walks back to the last case paragraph
// wherever it sits, and leaves everything after it untouched.
//
// Run: node tests/duplicate-case-block.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const grab = (startMarker, endMarker) => {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker, i);
  if (i === -1 || j === -1) throw new Error(`could not lift ${startMarker}`);
  return src.slice(i, j + endMarker.length);
};
const lifted = [
  grab('const _ATTACH_PHRASE_RE', '\n'),
  grab('const _ANY_CASE_NAME_RE', '\n'),
  grab('const _CASE_BLOCK_LEADIN_RE', '\n'),
  grab('const _escRe', '\n'),
  grab('const _CASE_ATTACH_PHRASE', '\n'),
  grab('function _labelEarlierMention', '\n}\n'),
  grab('function _stripRedundantTrailingCaseBlock', '\n}\n'),
].join('\n');
const { _stripRedundantTrailingCaseBlock: strip } =
  new Function('_recordViolations', `${lifted}; return { _stripRedundantTrailingCaseBlock }`)(() => {});

// The real letter from job 17575, trimmed to its paragraph skeleton.
const L17575 = [
  'Setting up google ads + shopping for a furniture Shopify store - 12 years running google ads, google premier partner 2026.',
  'Proof this approach works:',
  'Nectar Flowers (attached in profile highlights): ecommerce florist on Shopify, rebuilt search campaigns around purchase intent, grew transaction revenue 350% and dropped cost per conversion 72%.',
  'Skin Reboot (attached as PDF): health/wellness ecommerce on Shopify, fixed conversion tracking, tightened shopping feed strategy, scaled revenue +693.8% at 17.51 pmax roas.',
  'For furniture ecommerce on Shopify the setup difference between wasted budget and profitable campaigns is getting the product feed, conversion tracking, and shopping structure right from day one.',
  "What I'd set up:",
  'Google ads account + merchant center, Shopify catalog sync with correct feed mapping, ga4 + gtm wiring for purchase conversions firing correctly.',
  'Relevant work:',
  'Nectar Flowers (attached in profile highlights): Shopify florist, rebuilt campaign structure around delivery zones and occasion intent. Grew transaction revenue 350%, dropped cost per conversion 72%.',
  'Skin Reboot (attached as PDF): health/wellness Shopify store in a restricted niche. Fixed tracking, tightened shopping feed strategy, scaled revenue +693.8% at 17.51 pmax roas.',
  'Rate:',
  'Setup + launch: $700 flat, campaigns live and approved within 5 working days.',
  'Artem',
].join('\n\n');

const out = strip(L17575);
const count = (t, s) => (t.match(new RegExp(s, 'gi')) || []).length;

assert(count(L17575, 'Nectar Flowers') === 2 && count(L17575, 'Skin Reboot') === 2, 'the real letter does cite both cases twice');
assert(count(out, 'Nectar Flowers') === 1, 'Nectar Flowers is left cited once');
assert(count(out, 'Skin Reboot') === 1, 'Skin Reboot is left cited once');
assert(/Proof this approach works:/.test(out), 'the FIRST block and its lead-in survive — the duplicate is the later one');
assert(!/Relevant work:/.test(out), '…and the later lead-in goes with the entries it was introducing');
assert(/Rate:/.test(out) && /\$700 flat/.test(out) && /campaigns live and approved within 5 working days/.test(out),
  'everything AFTER the duplicate block is preserved — this is what the old end-anchored version could not do');
assert(/Artem\s*$/.test(out.trim()), 'the sign-off still ends the letter');
assert(out.indexOf('Nectar Flowers') < out.indexOf("What I'd set up:"), 'the surviving citation is the earlier one, in place');

// The classic shape (block really does run to the end) must still work.
const trailing = [
  'Opening line about the account.',
  'Nectar Flowers (attached in profile highlights): ecommerce florist, grew revenue 350%.',
  'Some middle prose that is not a case study at all.',
  'Relevant work:',
  'Nectar Flowers (attached in profile highlights): ecommerce florist, grew revenue 350%.',
  'Artem',
].join('\n\n');
assert(count(strip(trailing), 'Nectar Flowers') === 1, 'a block that does run to the end is still stripped (no regression)');

// Never touch a letter that cites each case once.
const clean = [
  'Opening line.',
  'Relevant work:',
  'Nectar Flowers (attached in profile highlights): ecommerce florist, grew revenue 350%.',
  'Skin Reboot (attached as PDF): health/wellness ecommerce, +693.8% revenue.',
  'Rate: $700 flat.',
  'Artem',
].join('\n\n');
assert(strip(clean) === clean, 'a letter citing each case once is returned byte-identical');
assert(strip('') === '' && strip(null) === null, 'empty input is handled');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
