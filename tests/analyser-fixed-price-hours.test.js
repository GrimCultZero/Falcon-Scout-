// The analyser checks its own hours estimate on a fixed-price job.
//
// Job 21650 (2026-11-02): a $250 Wix job asking for a technical audit, Wix SEO setup,
// redirect, canonical and schema review, image and script review, Core Web Vitals work,
// implementation of fixes and a launch checklist. The analyser wrote "about 6-8h of work
// ... $31-42/hr effective, at or above his $30/hr floor". The hours were a guess from the
// smallest band that fit; Artem's own technical SEO audit alone is $700 flat (KB rule 426).
// A realistic 12-20h makes it about $12-20/hr.
//
// Prompt-level rule, so this checks the wording is in the analyser's fixed-price section.
//
// Run: node tests/analyser-fixed-price-hours.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('FIXED / FLAT-PRICE RATE INTERPRETATION RULE');
const b = src.indexOf('ANOMALOUS / IMPLAUSIBLE BUDGET RULE');
const sec = src.slice(a, b);

assert(a > 0 && b > a, 'the fixed-price section exists');
assert(/CHECK THE HOURS ESTIMATE BEFORE TRUSTING IT/.test(sec), 'the check is inside the fixed-price section');
assert(/Count the distinct workstreams the posting lists and ADD them/.test(sec), 'workstreams are added, not matched to the smallest band');
assert(/implementation of fixes/.test(sec) && /top of the range or above it/.test(sec), '"implementation of fixes" moves the estimate up');
assert(/State the estimate as a RANGE and compute the effective rate at BOTH ends/.test(sec), 'a range, with the rate at both ends');
assert(/only when the HIGH-hours end clears it/.test(sec), '"at or above his floor" needs the high-hours end to clear it');
assert(/\$700 flat price/.test(sec) && /below \$700/.test(sec), 'cross-checked against his own $700 audit price');
assert(/Do not invent a PPC equivalent/.test(sec), 'no invented PPC price comparison');
assert(/Label them "~" and "estimated"/.test(sec), 'hours are labelled as estimates');
// What was there before is untouched.
assert(/Same hard-disqualifier thresholds apply to the EFFECTIVE rate/.test(sec) && /Effective rate = \$B \/ estimated hours/.test(sec),
  'the existing effective-rate rule and thresholds are unchanged');
// The one-line example thresholds still agree with the 700 figure in the KB rule.
assert(!/\$700[^.]{0,40}hours/i.test(sec), 'no hours figure is attached to the $700 price');

console.log(`\n${bad ? `${bad} FAILED` : 'ALL PASS'}`);
process.exit(bad ? 1 : 0);
