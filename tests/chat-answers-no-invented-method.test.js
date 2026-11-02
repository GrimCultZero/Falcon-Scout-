// Screening-question answers state only the working method the KB records.
//
// Job 21630 (2026-11-02), three paste-ready answers to the client's questions:
//   - "how did you verify the completed work?" was answered with an acceptance check
//     on every brief, a re-crawl against the brief and a Search Console check, none
//     of which is on record, written as Artem's habits;
//   - an audit's projected mobile score (45-55) was read as the speed GAIN, and "a
//     modest gain, so it went last" was derived from it; the audit gives no such reason;
//   - each answer closed with "I don't have a measured result", and one opened with
//     "I'd rather give you a case I can back up than a neat story I can't".
// The chat directive for a screening-question turn now forbids all four.
//
// Run: node tests/chat-answers-no-invented-method.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('THIS TURN IS ADDITIONAL / SCREENING QUESTIONS');
const dir = src.slice(a, src.indexOf("WHEN A SCREENING QUESTION ASKS FOR PROOF, CAMPAIGNS, OR COMPANY NAMES:", a));

assert(a > 0, 'the screening-turn directive exists');
assert(/HOW ARTEM WORKS IS A FACT TOO/.test(dir) && /Do NOT add verification steps, acceptance checks/.test(dir),
  'working method comes from the KB only: no invented verification steps');
assert(/never fill the gap with a plausible routine/.test(dir), 'a question with no record is flagged to Artem, not filled');
assert(/A NUMBER IS ONLY WHAT THE DOCUMENT CALLS IT/.test(dir) && /A projected or target score is not a gain/.test(dir),
  'a projected score is not read as a gain');
assert(/never derive a claim from it that the document does not make/.test(dir), 'no reason is derived from a number');
assert(/NO DISCLAIMERS IN A PASTE-READY ANSWER/.test(dir) && /would rather give a case you can back up/.test(dir),
  'no "no measured result" closer and no "case I can back up" opener');
assert(/ANSWER THE QUESTION ASKED, OR SAY WHICH PART YOU CANNOT/.test(dir) && /a sequencing decision is not a recommendation left out/.test(dir),
  'the nearest case is not relabelled as the story asked for');
// Still part of the same turn-only directive, so a letter or an ordinary chat is unaffected.
assert(/looksLikeScreeningQ/.test(src.slice(Math.max(0, a - 400), a)), 'it applies only on a screening-question turn');

console.log(`\n${bad ? `${bad} FAILED` : 'ALL PASS'}`);
process.exit(bad ? 1 : 0);
