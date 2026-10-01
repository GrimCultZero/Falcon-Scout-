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
const { pathToFileURL } = require('url');

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

// ── The armed case losing the opener to another case (jobs 16872, 16926) ──────
//
// Job 16926 (2026-10-01): Skin Reboot armed, the letter opened with Derma
// Solution in textbook Digit Bomb form — metrics first, name, bridge. Two causes,
// both fixed here: (1) "LEAD WITH THE EXACT-VERTICAL CASE (mandatory)" also claims
// slot 1 and the block never said which wins; (2) the block's own worked examples
// hardcoded Skin Reboot, so with Skin Reboot armed the prompt called the armed
// case "a different case" and showed a Skin-Reboot-led opener as the WRONG answer.
const exFrom = src.indexOf('const _DIGIT_BOMB_EXAMPLE_SETS');
const exTo = src.indexOf('\n}\n', src.indexOf('function _digitBombExamples')) + 3;
const { _DIGIT_BOMB_EXAMPLE_SETS: SETS, _digitBombExamples } =
  new Function(`${src.slice(exFrom, exTo)}; return { _DIGIT_BOMB_EXAMPLE_SETS, _digitBombExamples }`)();

const setText = (s) => `${s.correct}\n${s.wrongOrder}\n${s.wrongBridge}`;
const namesIn = (s) => ['Skin Reboot', 'Derma Solution', 'Atlant', 'FridgeFix'].filter(n => setText(s).includes(n));

assert(SETS.length >= 2, 'there is more than one worked-example set to choose from');
assert(SETS.every(s => namesIn(s).length > 0), 'every set actually names the cases it claims');
assert(!SETS.some((s, i) => SETS.some((o, j) => i !== j && s.caseIds.some(id => o.caseIds.includes(id)))),
  'the sets are case-disjoint, so whichever case is armed at least one set is clean');

for (const armed of ['skin-reboot', 'derma-solution', 'atlant', 'fridgefix']) {
  const chosen = _digitBombExamples(armed);
  const name = { 'skin-reboot': 'Skin Reboot', 'derma-solution': 'Derma Solution', atlant: 'Atlant', fridgefix: 'FridgeFix' }[armed];
  assert(!setText(chosen).includes(name), `armed ${name}: the examples shown never name it (so "this is a different case" is true)`);
}
assert(_digitBombExamples('nectar-flowers') === SETS[0], 'a case named in no set gets the first set');
assert(_digitBombExamples(undefined) === SETS[0], 'no armed case: the first set, never undefined');

// wiring: the prompt renders the chosen set, not hardcoded prose
assert(/\$\{_dbEx\.correct\}\n\$\{_dbEx\.wrongOrder\}\n\$\{_dbEx\.wrongBridge\}/.test(src),
  'generator prompt: the three worked examples come from the chosen set');
assert(/const _dbEx = _digitBombCase \? _digitBombExamples\(_digitBombCase\.id\) : null/.test(src),
  'the set is chosen from the armed case id');

// wiring: precedence over the exact-vertical case rule
const dbBlock = src.slice(src.indexOf('DIGIT BOMB OPENER MODE'), src.indexOf('Artem has explicitly picked the case'));
assert(/PRECEDENCE OVER CASE SELECTION/.test(dbBlock) && /LEAD WITH\nTHE EXACT-VERTICAL CASE|LEAD WITH THE EXACT-VERTICAL CASE/.test(dbBlock),
  'the block names the exact-vertical rule and says the opener is not a case-selection decision');
assert(/takes\nposition 1 outright|position 1 outright/.test(dbBlock), 'the armed case is stated to win position 1 outright');
assert(/16926/.test(dbBlock) && /16872/.test(dbBlock), 'both real misses are cited as evidence');

// wiring: one shared detector, and the live note under the textarea
assert(/missingDigitBombFacts = !!_dbMiss/.test(src), 'the generator check calls the shared detector');
assert(/digitBombOpenerMiss/.test(src) && /_liveDigitBombMiss/.test(src),
  'the live "Fix before sending" note runs the same detector as the check');
assert(/lastDigitBombCase, setLastDigitBombCase/.test(src) && /setLastDigitBombCase\(_digitBombCase\)/.test(src),
  'the live note reads the case armed for THIS letter, not the dropdown value');

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'letterGuards.js')).href);
  const L = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'caseLedger.js')).href);
  const miss = (letter, armedId) => G.digitBombOpenerMiss(letter, L.CASE_BY_ID[armedId], L.CASE_LEDGER);

  // The real letter from job 16926, verbatim.
  const L16926 = '+1,861% organic traffic and +14,342% conversions scaling a medical aesthetics e-commerce site - Derma Solution (attached as PDF), same product/category-page structure you\'ll be working with, same "what\'s holding us back?" Diagnostic problem.\n\n12 years in technical SEO, Google Premier Partner 2026.';

  const m = miss(L16926, 'skin-reboot');
  assert(m && m.reason === 'other-case', 'job 16926: Skin Reboot armed, the opener is flagged');
  assert(m && m.openedWith === 'Derma Solution', '…and it names the case that took the slot');
  assert(miss(L16926, 'derma-solution') === null,
    'the very same letter is CORRECT when Derma Solution was the armed case — form was never the problem');

  // Job 16872's real opener, Skin Reboot armed.
  assert(miss(L716, 'skin-reboot')?.openedWith === 'FridgeFix', 'job 16872: armed Skin Reboot, opened with FridgeFix');

  const good = '+693.8% revenue at 17.51 PMax ROAS - Skin Reboot (attached as PDF): Korean medical-aesthetic ecommerce, same restricted-niche feed problem you have.';
  assert(miss(good, 'skin-reboot') === null, 'a correct armed opener passes');
  assert(miss('Skin Reboot (attached as PDF) grew revenue +693.8% for a Korean skincare brand.', 'skin-reboot')?.reason === 'name-before-metric',
    'name before the first metric is still a miss');
  const late = `${'Twelve years in technical SEO and a Google Premier Partner, working across restricted niches. '.repeat(2)}+693.8% revenue - Skin Reboot.`;
  assert(miss(late, 'skin-reboot')?.reason === 'metric-not-leading', 'metrics that arrive after the first 80 characters are a miss');
  assert(miss('12 years in technical SEO. I can run a full audit within 1 working day.', 'skin-reboot')?.reason === 'absent',
    'armed case absent and no other case named: absent, not other-case');
  assert(miss('', 'skin-reboot') === null && G.digitBombOpenerMiss('anything', null, L.CASE_LEDGER) === null,
    'no letter, or nothing armed: nothing to report');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
