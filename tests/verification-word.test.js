// The posting's verification word (KB #427): read every real wording, never
// invent one, never let another client's word leak in as a style.
//
// Job 17254 (2026-10-05, Google Ads for a UAE healthcare client — no verification
// phrase anywhere) opened with a lone "SCALE" line. Its strongest past-letter
// example was #733, job 17063's letter, which opened "BUILD" because that client
// wrote 'Please start your proposal with the word "BUILD" so we know you read the
// full job post.' #733 ranked first as a [REPLY-WINNER] — a loose title match gave
// it the reply of a different job titled just "Google Ads Specialist" — and the
// model copied the shape with a word from this posting ("scale profitably").
// Meanwhile the generator's own detector (_REQUIRED_OPENER_RE) knew none of that:
// it missed 10 of the 13 real wordings in the sent corpus.
//
// Run: node tests/verification-word.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const DATA = path.join(__dirname, '.letters.json');

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'letterGuards.js')).href);

  // ── the detector: every wording the sent corpus actually carries ─────────
  const WORDINGS = [
    ['Start your reply with the word "PIPTO" so we know you read this far', 'PIPTO'],
    ['Start your proposal with the word "SPRING"', 'SPRING'],
    ['Start your application with the word: "SCALE"', 'SCALE'],
    ['- Start your proposal with the word "READY" so I know you\'ve read this properly', 'READY'],
    ['Start your proposal with “SEARCH”', 'SEARCH'],
    ['Start your proposal with "FURNACE" so I know you read the post', 'FURNACE'],
    ['Please start your proposal with the word "RECYCLING" so we know', 'RECYCLING'],
    ['Start your application with “SYDNEY COLIVING.” so we know', 'SYDNEY COLIVING'],
    ['Please begin your proposal with "LOCAL GOOGLE" so we know you\'ve read the full posting', 'LOCAL GOOGLE'],
    ['Please begin your application with LUXURY ECOMMERCE to confirm that you have read the complete brief', 'LUXURY ECOMMERCE'],
    ['Please start your proposal with the word "BUILD" so we know you read the full job post.', 'BUILD'],
  ];
  for (const [posting, want] of WORDINGS) {
    const got = G.postingRequiredOpener(posting);
    assert(got === want, `reads ${JSON.stringify(want)} from: ${posting.slice(0, 70)} (${JSON.stringify(got)})`);
  }
  const old = new Function(`return ${(() => { const l = src.split('\n').find(x => x.includes('const _REQUIRED_OPENER_RE =')); return l.slice(l.indexOf('= /') + 2).trim(); })()}`)();
  assert(WORDINGS.filter(([p]) => old.test(p)).length <= 3, `the old _REQUIRED_OPENER_RE alone read only ${WORDINGS.filter(([p]) => old.test(p)).length} of these 11`);
  for (const p of [
    "EWHC is seeking an experienced Google Ads Specialist to manage and scale healthcare lead-generation campaigns. We want to reduce CPA and scale profitably.",
    'Start your proposal with a short summary of your experience.',
    'Begin your application with your hourly rate and availability.',
  ]) assert(G.postingRequiredOpener(p) === null, `no phrase asked for: "${p.slice(0, 70)}"`);

  // ── the backstop on a new letter ──────────────────────────────────────────
  const l17254 = 'SCALE\n\n12 years running Google Ads, Google Premier Partner 2026. AED 25 CPL for Blood Tests is where the money leaks.\n\nArtem';
  const s = G.stripUnrequestedOpenerWord(l17254, null);
  assert(s.removed === 'SCALE' && s.text === '12 years running Google Ads, Google Premier Partner 2026. AED 25 CPL for Blood Tests is where the money leaks.\n\nArtem',
    'job 17254: the lone "SCALE" line goes when the posting asks for no word; the letter starts at its real first sentence');
  assert(G.stripUnrequestedOpenerWord(l17254, 'SCALE').text === l17254, '…and stays when the posting asks for it');
  assert(G.stripUnrequestedOpenerWord('LUXURY ECOMMERCE\n-92% cost per conversion…', null).removed === 'LUXURY ECOMMERCE', 'a two-word code line goes too');
  for (const keep of ['SEO\nis where this account leaks.', 'SCALE your Shopping campaigns by fixing the feed first.', '12 years running Google Ads.', 'Hi Sofia,\n\nThe tracking…'])
    assert(G.stripUnrequestedOpenerWord(keep, null).removed === null, `not a code word, kept: "${keep.split('\n')[0]}"`);

  // ── past letters lose their client's word before they are shown ──────────
  assert(G.dropPastLetterCodeWord('BUILD\n-92% cost per conversion, +1,405% conversions - FridgeFix…') === '-92% cost per conversion, +1,405% conversions - FridgeFix…',
    'past letter #733: "BUILD" comes off the top');
  assert(G.dropPastLetterCodeWord('LOCAL Google -92% cost per conversion and +1,405% conversions for FridgeFix', 'Please begin your proposal with "LOCAL GOOGLE" so we know you\'ve read the full posting')
    === '-92% cost per conversion and +1,405% conversions for FridgeFix', 'inline: the phrase that letter\'s own posting asked for comes off ("LOCAL Google …")');
  const plain = '12 years running Google Ads, Google Premier Partner 2026.\n\nThe tracking…';
  assert(G.dropPastLetterCodeWord(plain, '') === plain, 'a past letter with no code word is shown as it was');

  // ── wiring ────────────────────────────────────────────────────────────────
  assert(/const _requiredOpenerPhrase = postingRequiredOpener\(fullDescription\) \|\|/.test(src), 'generator: the required phrase comes from postingRequiredOpener (old regex as fallback)');
  assert(/stripUnrequestedOpenerWord\(text, _requiredOpenerPhrase\)[\s\S]{0,400}?'unrequestedOpenerWord'/.test(src), 'generator: an unrequested word is removed and recorded (unrequestedOpenerWord)');
  assert(/const text = dropPastLetterCodeWord\(match \? match\[1\] : raw, _entryPosting\)/.test(src), 'past-letter examples go through dropPastLetterCodeWord with their own posting');
  assert(/Math\.min\(mk\.length, k\.length\) >= 30 && \(k\.includes\(mk\) \|\| mk\.includes\(k\)\)/.test(src), 'a loose title match needs two specific (30+ character) titles — a bare "Google Ads Specialist" no longer lends its reply');
  assert(/VERIFICATION PHRASE \(KB #427\): this posting asks for NONE/.test(src) && /stripUnrequestedOpenerWord\([\s\S]{0,700}?_chatRequiredOpener\)\.text/.test(src),
    'chat: told whether the posting asks for a word, and its reworked letter goes through the same backstop');

  // ── the corpus: the backstop never takes a word a posting asked for ──────
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    let codeWordLetters = 0, wronglyRemoved = 0;
    for (const r of rows) {
      const req = G.postingRequiredOpener(r.posting || '');
      const probe = G.stripUnrequestedOpenerWord(r.text || '', null);
      if (probe.removed) codeWordLetters++;
      if (G.stripUnrequestedOpenerWord(r.text || '', req).removed) { wronglyRemoved++; console.log(`      would remove "${probe.removed}" | ${(r.posting || '').slice(0, 90).replace(/\s+/g, ' ')}`); }
    }
    console.log(`\ncorpus: ${rows.length} sent letters, ${codeWordLetters} open with a code-word line`);
    assert(codeWordLetters >= 1 && wronglyRemoved === 0, `every code word in a sent letter was asked for by its posting, and none would be removed (${wronglyRemoved})`);
  } else {
    console.log('SKIP  corpus section — no tests/.letters.json (run: python tools/dump_letters_fixture.py)');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
