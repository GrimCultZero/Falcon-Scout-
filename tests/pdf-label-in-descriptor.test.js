// A PDF case carries ONE attachment label, even when the label sits inside a
// descriptor parenthetical.
//
// Job 21630 (2026-11-02): the chat wrote "Derma Solution (attached as PDF) (USA,
// YMYL medical aesthetics, attached as a PDF)". _stripDuplicateAttachmentLabel
// merged the two into "Derma Solution (USA, YMYL medical aesthetics, attached as
// PDF)", and _fixPdfCaseLabelMisattribution, running after it in the same chain,
// did not recognise that shape as labelled and added "(attached as PDF)" again.
//
// Run: node tests/pdf-label-in-descriptor.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const dedupe = src.slice(src.indexOf('const _ATTACH_PHRASE_RE ='), src.indexOf('// Collapse a DUPLICATED reference to the audit SAMPLE attachment'))
  .replace(/_recordViolations\([^)]*\)/g, '0');
const fixStart = src.indexOf('function _fixPdfCaseLabelMisattribution(');
const fix = src.slice(fixStart, src.indexOf('\n}\n', fixStart) + 3);
const chain = new Function(`${dedupe}\n${fix}\nreturn (t) => _fixPdfCaseLabelMisattribution(_stripDuplicateAttachmentLabel(t))`)();

const labels = (s) => (s.match(/attached\s+(?:as\s+(?:a\s+)?pdf|in\s+(?:the\s+)?profile\s+highlights)/gi) || []).length;
const quiet = (f) => (t) => { const l = console.log; console.log = () => {}; try { return f(t); } finally { console.log = l; } };
const run = quiet(chain);

const REAL = 'For a measured outcome, Derma Solution (attached as PDF) (USA, YMYL medical aesthetics, attached as a PDF) went from about 357 to 25,989 organic users a month.';
const out = run(REAL);
assert(labels(out) === 1, `the real doubled label from job 21630 ends with exactly one (${out})`);
assert(/Derma Solution \(USA, YMYL medical aesthetics, attached as PDF\)/.test(out), 'the descriptor is kept and carries the label');

// The label already inside a descriptor parenthetical is not doubled.
assert(labels(run('Derma Solution (USA, medical aesthetics, attached as PDF) grew organic traffic.')) === 1, 'a descriptor parenthetical that carries the label is left alone');
assert(labels(run('Skin Reboot (skincare ecommerce, attached in profile highlights) grew revenue.')) === 1, 'the profile-highlights wording inside a descriptor counts too');

// The shapes that already worked still work.
assert(labels(run('Derma Solution (attached as PDF) grew organic traffic.')) === 1, 'name, then the label: unchanged');
assert(labels(run('Derma Solution, attached as PDF) grew organic traffic.')) <= 1, 'the comma-joined shape stays at one label');
const bare = run('Derma Solution grew organic traffic.');
assert(labels(bare) === 1 && /Derma Solution \(attached as PDF\)/.test(bare), 'an unlabelled PDF case still gets its label');
assert(labels(run('Skin Reboot (attached as PDF) and Derma Solution (attached as PDF) both grew.')) === 2, 'two cases, one label each');
// A descriptor with no label gets one, and only one.
const desc = run('Derma Solution (USA, YMYL medical aesthetics) went from 357 to 25,989 users.');
assert(labels(desc) === 1, 'a descriptor with no label gets exactly one');

console.log(`\n${bad ? `${bad} FAILED` : 'ALL PASS'}`);
process.exit(bad ? 1 : 0);
