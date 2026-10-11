// The chat path gets the same anti-fabrication guards as the generator.
//
// Job 17985 (2026-10-11). Asked twice to detail Derma Solution on a Google Ads
// job, the chat's <remarks> claimed it had added "Poland, 1-month 8.33% CTR,
// 4.82 PMax ROAS, shopping feed rebuild + campaign architecture". The letter
// kept a bare one-line mention with no figures at all. Two failures stacked:
//
//   1. the chat claimed an edit its <proposal> never made — the old safety net
//      only checked the case NAME was present, and it was;
//   2. every claimed figure was invented. KB #506 (owner recap) says DERMA
//      SOLUTION (USA) — SEO: organic +1,861%, conversions +14,342%, 155
//      referring domains. No CTR, no PMax ROAS — 17.51 PMax ROAS is Skin
//      Reboot's, and the only 4.82 in the KB is a client star rating.
//
// Failure 1 is the only reason failure 2 never reached the client.
//
// Root cause: the chat's post-processing chain had 14 functions and NONE of the
// anti-fabrication machinery. The grounding checker has enforced on generate()
// since 2026-08-19 and had never once run on chat output — so every guard
// protected the letter the generator wrote, not the letter Artem sends.
//
// Run: node tests/chat-grounding.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8')
  .replace(/\r\n/g, '\n');

// ── 1. grounding now runs on chat output, via the SAME function ──────────────
const chain = SRC.match(/const newProposal {2}= proposalMatch \? ([\s\S]*?) : null/)[1];
assert(/_gcShadow\(/.test(chain), 'the chat proposal chain runs the grounding checker');
assert(/_gcShadow\([\s\S]*, job, 'chat'\)/.test(chain), "…tagged as the 'chat' surface so telemetry can tell them apart");
assert(/function _gcShadow\(finalText, jobObj, surface = 'generator'\)/.test(SRC),
  'one shared _gcShadow with a surface parameter — not a second copy that can drift');
assert(/_recordViolations\(surface, jobObj && jobObj\.id, gc\.violations\)/.test(SRC),
  'violations are recorded under whichever surface called it');
{
  let d = 0, ok = true;
  for (const ch of chain) { if (ch === '(') d++; else if (ch === ')') { d--; if (d < 0) ok = false; } }
  assert(ok && d === 0, 'the rewrapped chain is balanced (methodology #1: never count parens by eye)');
}

// ── 2. the safety net distinguishes "named" from "detailed" ──────────────────
assert(/_wantsDetail = \/\\b\(detail\|details\|metrics\?/.test(SRC),
  'a request for detail/metrics/numbers is recognised');
assert(/_hasRealMetric = \(c\.metrics \|\| \[\]\)\.some/.test(SRC),
  'it checks the case\'s REAL ledger metrics appear in the letter');
assert(/if \(_present && !\(_wantsDetail && !_hasRealMetric\)\) continue/.test(SRC),
  'a case that is present AND detailed is left alone; present-but-bare on a detail request is not');
assert(/chatClaimedCaseDetailButMissing/.test(SRC), 'the miss is recorded as its own violation code');
assert(/paras\[idx\] = line/.test(SRC) && /renderCaseLine\(c\.id\)/.test(SRC),
  'the bare mention is replaced by the LEDGER rendering — figures never come from the model');

// ── 3. the prompt forbids inventing, and says what to do instead ─────────────
assert(/A CASE HAS ONLY THE NUMBERS IT HAS/.test(SRC), 'the chat prompt forbids inventing a metric');
assert(/do NOT borrow one case’s figure for another/.test(SRC), '…or borrowing another case\'s figure');
assert(/17985/.test(SRC) && /8\.33% CTR, 4\.82 PMax ROAS/.test(SRC),
  'the real failure is cited verbatim as the example');
assert(/SAY SO/.test(SRC) && /is a GOOD answer/.test(SRC),
  'and it is told what the correct answer looks like instead of just what is banned');

// ── 4. the figures themselves, against the ledger ────────────────────────────
(async () => {
  const L = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'caseLedger.js')).href);
  const derma = L.CASE_BY_ID['derma-solution'];
  const skin = L.CASE_BY_ID['skin-reboot'];
  const dermaBlob = JSON.stringify(derma).toLowerCase();

  assert(derma.service === 'seo', 'Derma Solution is an SEO case, so a Google Ads job has no paid figure to cite');
  assert(derma.location === 'USA', 'Derma Solution is USA — "Poland" was invented');
  assert(!/roas/.test(dermaBlob), 'Derma Solution has no ROAS of any kind on record');
  assert(!/8\.33/.test(dermaBlob) && !/4\.82/.test(dermaBlob), 'neither claimed figure exists for Derma');
  assert(JSON.stringify(skin.metrics).includes('17.51'),
    '17.51 PMax ROAS belongs to Skin Reboot — the chat attached it to the wrong case');

  const rendered = L.renderCaseLine('derma-solution') || '';
  assert(/1,861/.test(rendered), 'the ledger rendering carries Derma\'s REAL headline figure');
  assert(!/poland/i.test(rendered) && !/roas/i.test(rendered),
    '…and cannot reintroduce the invented ones');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
