// Standing business facts (owner instruction, 2026-11-20), pinned in the
// generator so the letter for job 24349 ("Expert SEO Specialist / Agency ...
// AEO & GEO | USA/Canada", a white-label posting with 8 required application
// questions) answers correctly:
//   - Experience: 12 years, in every letter — no "since 2015", no "11 years".
//   - Delivery: white-label → Artem leads personally, IT Force executes, no
//     subcontractors. Normal postings → Artem as a freelancer, no agency
//     framing unless white-label.
//   - Projects: about 50 US, about 20 Canada — always "about".
//   - Timing: Google Ads ~1-2 weeks after the algorithms learn; SEO 60-90
//     days; never a 12-month promise.
//   - GEO/AEO: no measured result, no confirmed case — approach only.
//   - Capacity: up to about 5 new projects/month, never volunteered.
//   - Pricing: Google Ads $700 full setup (5 working days) then $600/month;
//     SEO $1,050/month all inclusive; white-label price = direct price.
//
// Run: node tests/business-facts.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const SRC_PATH = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
const src = fs.readFileSync(SRC_PATH, 'utf8').replace(/\r\n/g, '\n');
const LIB_DIR = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const libFiles = fs.readdirSync(LIB_DIR).filter(f => f.endsWith('.js'));

// ── experience: exactly "12 years", nowhere else a different figure ────────
assert(/const ARTEM_EXPERIENCE_YEARS = '12 years'/.test(src), 'ARTEM_EXPERIENCE_YEARS is the single source of truth, "12 years"');
assert(/a Google Ads\/PPC\/SEO and ecommerce web development specialist \(12 years\)/.test(src), 'the system prompt opener states 12 years');
// Two lines in JobDetail.jsx deliberately NAME "since 2015" / "11 years" as the
// banned phrasings the model must never use (a comment, and the facts-block
// bullet instructing "never \"since 2015\", never \"11 years\""). Those negative
// examples are correct and intentional; strip exactly those two known lines
// before scanning so a REAL stray occurrence elsewhere still fails the test.
const srcForStaleCheck = src
  .replace(/\/\/ never "since 2015" or "11 years".*\n/, '')
  .replace(/never "since 2015", never "11 years", never any other number\.`,\n/, '');
for (const re of [/since\s+2015/i, /\b11[-\s]years?\b/i, /\b11[-\s]year\b/i]) {
  assert(!re.test(srcForStaleCheck), `JobDetail.jsx never contains ${re} (outside the two intentional "never say this" lines)`);
  for (const f of libFiles) {
    const content = fs.readFileSync(path.join(LIB_DIR, f), 'utf8');
    assert(!re.test(content), `${f} never contains ${re}`);
  }
}

// ── delivery model ──────────────────────────────────────────────────────
assert(/ARTEM_DELIVERY_MODEL = 'On WHITE-LABEL postings: Artem leads every engagement personally, his team at IT Force executes the work — no subcontractors, ever\./.test(src),
  'delivery model: white-label -> Artem leads personally, IT Force executes, no subcontractors');
assert(/On a NORMAL \(non-white-label\) posting: Artem answers as an individual freelancer; do not mention IT Force, an agency, team size, or white-label framing/.test(src),
  'delivery model: normal postings -> no agency/IT Force framing unless white-label');

// ── projects ────────────────────────────────────────────────────────────
assert(/const ARTEM_PROJECT_COUNTS = 'about 50 completed projects for US clients, about 20 for Canadian clients'/.test(src),
  'project counts: about 50 US, about 20 Canada, always "about"');

// ── timing ──────────────────────────────────────────────────────────────
assert(/Google Ads: measurable results typically show up about 1–2 weeks after the algorithms learn the account/.test(src),
  'timing: Google Ads ~1-2 weeks after the algorithms learn');
assert(/SEO: visible results in 60–90 days/.test(src), 'timing: SEO visible results in 60-90 days');
assert(/Never promise a 12-month outcome or frame results in 12-month terms/.test(src), 'timing: no 12-month promise, ever');

// ── GEO/AEO ─────────────────────────────────────────────────────────────
assert(/GEO\/AEO \(AI SEARCH\) — APPROACH ONLY, NEVER A RESULT \(owner rule, 2026-11-20 — absolute\)/.test(src),
  'GEO/AEO has its own absolute system-prompt rule');
assert(/There is NO measured result and NO confirmed case on record for GEO\/AEO/.test(src),
  'GEO/AEO: no measured result, no confirmed case, stated plainly');
assert(/describe the APPROACH only: entity clarity, structured data\/schema markup, E-E-A-T signals/.test(src),
  'GEO/AEO: approach described as entity clarity, schema, E-E-A-T, measurement method');
assert(/If the posting asks directly for a GEO\/AEO result or example, say NOTHING about results: no apology, no "we're still gathering data", no disclaimer, no placeholder/.test(src),
  'GEO/AEO: if asked directly for a result, say nothing about results — no apology, no placeholder');

// ── capacity ────────────────────────────────────────────────────────────
assert(/const ARTEM_CAPACITY_FACT = 'Up to about 5 new projects per month\. NEVER volunteer this/.test(src),
  'capacity: up to about 5 new projects/month, never volunteered');
assert(/we take on a limited number of projects at a time, as a boutique, handcrafted agency/.test(src),
  'capacity: boutique/handcrafted-agency framing when a number is asked for');

// ── pricing ─────────────────────────────────────────────────────────────
const feesLine = (src.match(/const ARTEM_FIXED_FEES = '([^\n]+)'\n/) || [])[1] || '';
assert(/\$700 for the first month \(full setup, delivered within 5 working days/.test(feesLine), 'pricing: Google Ads $700 full setup, 5 working days');
assert(/then a 3-week included support window, then \$600\/month/.test(feesLine), 'pricing: 3 weeks of support, then $600/month');
assert(/Technical SEO: \$1,050\/month, all inclusive/.test(feesLine), 'pricing: SEO $1,050/month, all inclusive');
assert(/White-label pricing is the SAME as direct pricing — never a markup or a discount for white-label work/.test(feesLine),
  'pricing: white-label price equals direct price');
// unchanged from the prior commit — still passes with the new wording around it
assert(/never an hourly rate, never a range/.test(feesLine) && /\$300 flat/.test(feesLine), 'pricing: $300 audit kept, still never hourly/a range');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
