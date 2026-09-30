// Digit Bomb armed → past letters go into the prompt without their openings.
//
// Job 16872 (2026-09-30): Skin Reboot armed, twice; both letters opened with
// FridgeFix — "-92% cost per conversion and +1,405% conversions - FridgeFix
// (attached in profile highlights): California appliance repair, rebuilt GA4/GTM
// …", copied near verbatim from past letter #716 (job 16684), one of the four
// past letters in the prompt. Each past letter is shown as its first 600
// characters — mostly its opening — under "emulate … opening approach", AFTER
// the DIGIT BOMB block. The same FridgeFix opener had already carried from job
// 16684's letter into job 16730's.
//
// Run: node tests/digit-bomb-openings.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('const _PAST_LETTER_OPENING_OMITTED');
const to = src.indexOf('\n}\n', src.indexOf('function _dropPastLetterOpenings')) + 3;
const { _dropPastLetterOpenings, _PAST_LETTER_OPENING_OMITTED: OMITTED } =
  new Function(`${src.slice(from, to)}; return { _dropPastLetterOpenings, _PAST_LETTER_OPENING_OMITTED }`)();

// Built exactly as generate() builds pastProposalsText (header, 600-char body,
// optional reply line), with the four letters job 16872 was given.
const snippet = (i, label, title, text, reply) =>
  `Past cover letter ${i}${label} — "${title}":\n${text.slice(0, 600)}${reply ? `\n  ↳ client replied: "${reply}"` : ''}`;
const L716 = '-92% cost per conversion and +1,405% conversions - FridgeFix (attached in profile highlights): California appliance repair, rebuilt GA4/GTM conversion tracking and Search + Local PMax structure around purchase-intent queries, pruned geo waste. Same tracking work you need.\n\n12 years running Google Ads, Google Premier Partner 2026.\n\nFirst thing I would audit: the purchase events.';
const L720 = 'STREETWEAR +693.8% revenue at 17.51 PMax ROAS - Skin Reboot (attached as PDF): rebuilt conversion tracking, restructured PMax.\n\n12 years running Google Ads.\n\nI can run a full audit within 1 working day.';
const L680 = "12 years running Google Ads, google premier partner 2026. First thing I'd check is whether HubSpot form submissions are imported.\n\nHere are some relevant results:\n\nNectar Flowers (attached in profile highlights): ecommerce florist.";
const LONG = 'A single very long opening paragraph that fills the whole snippet '.repeat(12);
const blob = '\n\nPAST COVER LETTERS ARTEM SENT — STYLE / STRUCTURE REFERENCE ONLY, NOT A FACT SOURCE. Emulate ONLY tone, opening approach, case-study placement, length, and closing patterns.\n\n' + [
  snippet(1, '', 'Meta & Google Ads Strategist', L720),
  snippet(2, ' [REPLY-WINNER — replied on similar job (similarity 9/8), client actually wrote back]', 'Google Ads Attribution Audit', L680, 'Thanks, could you answer three questions?'),
  snippet(3, '', 'Google Ads PPC Specialist', LONG),
  snippet(4, '', 'E-commerce Performance Marketing Expert — Google Ads & Meta', L716),
].join('\n\n');

const out = _dropPastLetterOpenings(blob);
assert(!/-92% cost per conversion|\+1,405% conversions/.test(out), "past letter #716's FridgeFix opening is not in the prompt when a bomb is armed");
assert(!/STREETWEAR \+693\.8%/.test(out) && !/HubSpot form submissions/.test(out), '…nor any other past letter\'s opening (the armed case\'s own included — the DIGIT BOMB block shows the shape)');
assert((out.match(/Past cover letter \d+/g) || []).length === 4 && (out.match(new RegExp(OMITTED.replace(/[[\]().:]/g, '\\$&'), 'g')) || []).length === 4,
  'all four past letters stay, each marked "[opening omitted …]"');
assert(/12 years running Google Ads, Google Premier Partner 2026\.\n\nFirst thing I would audit/.test(out) && /Here are some relevant results:\n\nNectar Flowers/.test(out),
  '…and keep everything after the opening (structure, case placement, close)');
assert(/↳ client replied: "Thanks, could you answer three questions\?"/.test(out), "…a reply-winner keeps its client-reply line");
assert(/Past cover letter 3 — "Google Ads PPC Specialist":\n\[opening omitted[^\]]*\]\n\nPast cover letter 4/.test(out), 'a letter whose 600 characters are all opening is left as just the marker');
assert(out.startsWith('\n\nPAST COVER LETTERS ARTEM SENT'), 'the block header is untouched');
assert(_dropPastLetterOpenings('') === '' && _dropPastLetterOpenings(null) === null, 'no past letters: nothing to do');

// wiring
assert(/\$\{_digitBombCase \? _dropPastLetterOpenings\(pastProposalsText\) : pastProposalsText\}/.test(src),
  'generator prompt: openings dropped only when a bomb is armed (unarmed letters see past letters as before)');
const last = src.indexOf('DIGIT BOMB — LAST CHECK');
assert(last > src.indexOf('RULE COMPLIANCE GATE (silent, mandatory)') && last < src.indexOf('FINAL OUTPUT FORMAT: Return ONLY the cover-letter text'),
  "a last check names the armed case's numbers after the past letters and the rules gate, right before the output format");

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
