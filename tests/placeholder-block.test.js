// An unfinished "[[ ARTEM: … ]]" slot must never reach a client (owner, 2026-10-27:
// "I want us to block things like this forever, its a bug").
//   job 20655 draft:   "Availability: [[ ARTEM: weekly availability and hours]]"
//   proposal 349 SENT: "...+693.8% revenue, at [[ ARTEM: approximate monthly spend for Skin Reboot]]."
//   proposal 351 SENT: "...before anything goes live. [[ ARTEM: name the AI tools or automations used]]"
// Pure-function cases, then wiring checks against JobDetail.jsx so a surface can't
// be added later that bypasses the gate.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const { stripPlaceholders: sp } = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const eq = (input, want, msg) => {
    const got = sp(input).text;
    assert(got === want, `${msg}${got === want ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`);
  };

  // The reported bug: a label + slot on its own line. The line AND its blank gap go.
  eq('Tracking: GTM and GA4.\n\nAvailability: [[ ARTEM: weekly availability and hours]]\n\nI can run a full audit.',
     'Tracking: GTM and GA4.\n\nI can run a full audit.', 'label + slot line is dropped with its gap (job 20655)');
  eq('Intro.\n- Availability: [[ ARTEM: hours ]]\n- Next.', 'Intro.\n- Next.', 'bulleted label + slot');
  eq('Hi.\n\n[[ ARTEM: fill in ]]\n\nBye.', 'Hi.\n\nBye.', 'slot alone on a line');

  // Proposal 349 as it was sent: a mid-sentence slot, lead-in word goes with it.
  eq('DTC ecommerce with 17.51 PMax ROAS and +693.8% revenue, at [[ ARTEM: approximate monthly spend for Skin Reboot]].\n\nNext.',
     'DTC ecommerce with 17.51 PMax ROAS and +693.8% revenue.\n\nNext.', 'inline slot loses its "at" and its comma (proposal 349)');
  // Proposal 351: the slot is its own sentence at the end of a paragraph.
  eq('I approve every ad myself before anything goes live. [[ ARTEM: name the AI tools or automations used]]\n\nFees.',
     'I approve every ad myself before anything goes live.\n\nFees.', 'slot as its own trailing sentence (proposal 351)');
  eq('First. [[ ARTEM: x ]] Second sentence.', 'First. Second sentence.', 'slot between two sentences');
  eq('We manage [[ ARTEM: N ]] sites and more.', 'We manage sites and more.', 'inline slot keeps the rest of the sentence');

  // Variants a model could plausibly emit.
  eq('Ok.\n[[ARTEM:fill in]]', 'Ok.', 'no spaces inside the brackets');
  eq('Ok.\n[[ artem: fill in ]]', 'Ok.', 'lower case');
  eq('Ok. [[ TODO: name the client ]] Done.', 'Ok. Done.', 'any [[ … ]], not only ARTEM');
  eq('Ok.\n[ARTEM: fill in]', 'Ok.', 'single-bracket ARTEM form');
  eq('Ok.\n\nAvailability: [[ ARTEM: unfinished', 'Ok.', 'unclosed slot runs to end of line');
  eq('A [[ ARTEM: x ]] b [[ ARTEM: y ]] c.', 'A b c.', 'two slots on one line');

  // What must NOT change.
  const clean = 'Hi Susie - I run $700 audits.\n\nAvailability: 25 hours a week.\n\nArray[0] and [see below] stay.';
  eq(clean, clean, 'a clean letter is returned untouched');
  eq('', '', 'empty string'); assert(sp(null).text === null, 'null passes through');
  const r = sp('Availability: [[ ARTEM: hours ]]\nOk.');
  assert(r.removed.length === 1 && /hours/.test(r.removed[0]), 'reports what it removed');
  assert(sp(clean).removed.length === 0, 'reports nothing on a clean letter');
  assert(!/\[\[|ARTEM\s*:/i.test(sp('x [[ ARTEM: a ]] y\n[[ ARTEM: b ]]\nz. [[ ARTEM: c ]]').text), 'nothing bracketed survives a messy letter');

  // Wiring: every path that produces, restores, copies or saves a letter.
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const has = (re, msg) => assert(re.test(src), msg);
  has(/const _finalText = _blockPlaceholders\(text/, 'generator: final text passes the gate before it is shown or cached');
  has(/setProposal\(_blockPlaceholders\(_gcShadow\(text, job\), job, 'chat'\)\)/, 'chat rewrite passes the gate');
  has(/setProposal\(_blockPlaceholders\(cached\?\.proposal \|\| ''/, 'a restored draft passes the gate');
  has(/const _cleanForSend = /, 'send-side helper exists');
  assert((src.match(/_cleanForSend\(/g) || []).length >= 3, 'copy, apply and save all use the send-side gate');
  assert(!/otherwise a clear placeholder like \[\[ ARTEM/.test(src), 'the prompt no longer asks the model for a placeholder (checklist item)');
  assert(!/emit a visible \[\[ ARTEM/.test(src), 'the prompt no longer asks the model for a placeholder (factual rule)');

  console.log(bad ? `\n${bad} FAILED` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
