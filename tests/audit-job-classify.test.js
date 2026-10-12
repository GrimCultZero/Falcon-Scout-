// Which postings count as Artem's $300 PPC-audit product.
//
// This classifier is unusually expensive to get wrong: when it says yes, a
// deterministic override FORCES verdict APPLY and score >= 7, discarding the
// analyser's own reasoning. A false positive costs connects on a job he should
// have skipped.
//
// Job 18023 (2026-10-12): "Lead Generation Specialist | Google Ads, Meta Ads,
// Local SEO & GoHighLevel" — 50+ applicants, GoHighLevel as screening question
// 3 (he has none), client average $5.64/hr. The analyser reasoned its way to
// SKIP and said so in its own summary ("this is NOT a Google Ads audit job — the
// audit flag fired incorrectly"), then the override flipped it to APPLY.
//
// The word "audit" appears NOWHERE in that posting. The four fields were joined
// with spaces, Upwork's auto-assigned keyword tag ends "...Marketing Audit", the
// description starts "Summary# Lead Generation Specialist | Google Ads", and the
// classifier matched the phantom phrase "Audit Summary# Lead Generation
// Specialist | Google Ads" across the seam. The regex gap already excludes
// newlines, so joining with "\n" makes a cross-field match impossible.
//
// Run: node tests/audit-job-classify.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const lift = (n) => {
  const i = src.indexOf(`const ${n} = /`);
  const line = src.slice(i, src.indexOf('\n', i));
  return eval(line.slice(line.indexOf('/')));
};
const AUDIT = lift('_PPC_AUDIT_JOB_RE');
const GUARD = lift('_ONGOING_MGMT_NOT_AUDIT_RE');

// Mirrors the source expression exactly (asserted below).
const isAudit = (title, category, keywords, desc) =>
  AUDIT.test([title, category, keywords, desc].join('\n')) &&
  !(GUARD.test(desc) && !/\baudit\b/i.test(title));

// ── the bug ──────────────────────────────────────────────────────────────────
const j18023 = [
  'Lead Generation Specialist | Google Ads, Meta Ads, Local SEO & GoHighLevel',
  'sales_marketing',
  'Google Ads, Google Analytics, Pay Per Click Advertising, SEO Keyword Research, Search Engine Optimization, Marketing Audit',
  'Summary# Lead Generation Specialist | Google Ads, Meta Ads, Local SEO & GoHighLevel\nSet up and manage Google Ads and Meta Ads campaigns.\nSet up lead nurturing and follow-up automations using GoHighLevel.\nThis is an ongoing opportunity for the right person.',
];
assert(!/\baudit\b/i.test(j18023[0]) && !/\baudit\b/i.test(j18023[3]),
  'job 18023: the client never writes the word "audit" — only Upwork\'s keyword tag does');
assert(AUDIT.test(j18023.join(' ')), '…and joined by SPACES the old code did match it (the phantom phrase)');
assert(!AUDIT.test(j18023.join('\n')), '…joined by NEWLINES it cannot: the regex gap excludes newlines');
assert(!isAudit(...j18023), 'job 18023 is NOT a PPC audit job, so the verdict override must not fire');

// ── real audit jobs must survive ─────────────────────────────────────────────
assert(isAudit('Google Ads Account Audit', '', '', 'Please audit our account.'),
  'the plainest case: a post titled "Google Ads Account Audit"');
assert(isAudit('Google Ads Audit + Ongoing Management', '', '',
  'Audit first, then manage campaigns on an ongoing basis with monthly reports.'),
  'an audit TITLE outranks ongoing-management wording in the body (Artem\'s flagship, previously suppressed)');
assert(isAudit('Comprehensive Audit for Google Search and Shopping Ads', '', '', 'Review our shopping setup.'),
  '"Google Search and Shopping Ads" is the same product family — matches on its own field now');
assert(isAudit('Google Shopping Feed Expert Needed for Feed Audit & Optimisation', '', '', 'Audit the feed.'),
  '"Google Shopping" counts too');

// ── ongoing roles must NOT be audit jobs ─────────────────────────────────────
assert(!isAudit('Google Ads Specialist', '', '',
  'Manage and optimize Google Ads campaigns on an ongoing basis. Review performance monthly.'),
  'an ongoing specialist role is not an audit, even though it says "review"');
assert(!isAudit('Google Ads and Meta Ads Specialist', '', '',
  'You will manage Google Ads and Meta Ads campaigns and report monthly.'),
  'words BETWEEN "manage" and "campaigns" no longer let an ongoing role through (the 18023 shape)');

// ── the guard must not over-reach ────────────────────────────────────────────
assert(!GUARD.test('Skills: Management, Campaign Optimization, Analytics'),
  'a skills list ("Management, Campaign") is not a claim that the engagement is ongoing');
assert(GUARD.test('We need someone to manage our Google Ads campaigns long term.'),
  '…but a real verb form still is');

// ── the source really is wired this way ──────────────────────────────────────
assert(/_PPC_AUDIT_JOB_RE\.test\(\[job\.title \|\| '', job\.category \|\| '', job\.keywords \|\| '', fullDescription\]\.join\('\\n'\)\)/.test(src),
  'source joins the fields with a newline, not a space');
assert(/!\(_ONGOING_MGMT_NOT_AUDIT_RE\.test\(fullDescription\) && !\/\\baudit\\b\/i\.test\(job\.title \|\| ''\)\)/.test(src),
  'source gives an audit in the title precedence over the ongoing-management guard');
assert(!/merchant\s*\\s\*cent/i.test(String(AUDIT)),
  'Merchant Center was deliberately NOT added to the PPC vocabulary — it pulled in five non-audit jobs');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
