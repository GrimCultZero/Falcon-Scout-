// Accepting a call is as forbidden as offering one.
//
// Job 18075 (2026-10-12) closed with "EST meetings (9:00 - 14:00) work for me."
// and no check fired. The posting listed "Available for meetings between 9:00
// and 14:00 EST" as a hard requirement, so the letter simply agreed — and the
// detector only ever looked for OFFER shapes ("happy to jump on a call").
//
// KB #5 is explicit that confirming counts: "do NOT confirm availability for a
// call". The prescribed answer is to redirect to the written deliverable, not to
// agree and not to refuse.
//
// The hazard: "call" in these letters nearly always means a CONVERSION ("call
// tracking", "booked calls"), which is why the module is held to zero false
// positives on the real corpus. A scheduling signal must appear in the same
// sentence before an acceptance counts.
//
// Run: node tests/call-acceptance.test.js
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'letterGuards.js')).href);
  const flags = (t) => G.findCallOffers(t).length > 0;

  // ── the real line from job 18075 ───────────────────────────────────────────
  assert(flags('EST meetings (9:00 - 14:00) work for me.'),
    'job 18075: "EST meetings (9:00 - 14:00) work for me." is caught');

  // ── other ways of agreeing to a meeting ────────────────────────────────────
  assert(flags('I am available for meetings between 9:00 and 14:00 EST.'),
    'plural "meetings" after available-for (the singular noun was the original miss)');
  assert(flags('Those meeting times work for me.'), '"those meeting times work for me"');
  assert(flags('Meetings in your window work for me.'), '"meetings in your window work for me"');
  assert(flags('I can make 9-14 EST for calls.'), '"I can make 9-14 EST for calls"');

  // ── offers still caught (no regression) ────────────────────────────────────
  assert(flags('Happy to jump on a kick-off call to align.'), 'offering a call is still caught');
  assert(flags('Let us schedule a quick call this week.'), 'scheduling language is still caught');

  // ── "call" as a CONVERSION must stay clear ─────────────────────────────────
  assert(!flags('Call tracking works for me to measure leads.'), 'call TRACKING is a conversion, not a meeting');
  assert(!flags('Booked calls are the metric that works for me here.'), 'booked calls are a metric');
  assert(!flags('I can make your calls convert at a better rate.'), 'making calls convert is not agreeing to one');
  assert(!flags('Call volume by time of day is the metric that matters.'),
    'call volume with a time reference is still a conversion, not an appointment');
  assert(!flags('That approach works for me.'), 'no call noun at all');

  // ── the written redirect must never be flagged ─────────────────────────────
  assert(!flags('I will send a written handover instead of a call.'),
    'redirecting to writing is the CORRECT answer and must not be flagged');
  assert(!flags('Everything is delivered as a written findings document, so nothing needs scheduling.'),
    'a written-delivery sentence is not an acceptance');

  // ── the live note under the textarea uses this same function ───────────────
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');
  assert(/_liveCallOffers = proposal \? findCallOffers\(proposal\) : \[\]/.test(src),
    'so an accepted meeting now shows in the red "Fix before sending" box as Artem edits');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
