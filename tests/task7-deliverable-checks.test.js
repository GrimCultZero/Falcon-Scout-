// Task 7.5 (owner, 2026-11-23, job 25615): three new record-only checks —
// offerMissingBeforeAttachment, duplicateAttachment, wrongDeliverableForScope.
// Exercised against the EXACT real texts from both correction files
// (corrections/20261123T160843-job-25615.md, corrections/20261123T161839-job-25615.md)
// and the auditor's own "good" model letter (Task 7.6).
//
// Run: node tests/task7-deliverable-checks.test.js
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);

  // ── draft 1 (first generation, 20261123T160843) — offers the plan, never offers the audit ──
  const draft1 = `Keyword mapping, on-page rewrites and developer tasks all lean on GA4 and Search Console reporting organic conversions cleanly, so that's where I'd start, before your SEO developer touches anything.

12 years across SEO and Google Ads (Google Premier Partner 2026). I write technical findings as tickets your developer can implement without follow-up questions: speed, indexing, schema, crawlability. And the backlink review ends in a safe, practical off-page plan, not a list of links.

Relevant results:

Golden State Trailers (attached in profile highlights): technical audit and fixes, commercial-intent keyword research, 72 localized city pages and steady link building. Organic traffic +350%, 67 keywords in Top 3.

FridgeFix (attached in profile highlights): GA4 and GTM conversion tracking set up before scaling Google Ads. Conversions +1,405%, cost per conversion -92%.

I can prepare a custom 3-month SEO promotion plan within 2 working days, covering deliverables, costs, link building budget, a basic site check and competitor overview. Every audit I run is done entirely by hand, no automated tools and no templated report. I'm attaching a sample technical SEO audit and a sample SEO promotion plan so you can see the format and depth.

Artem`;

  // ── draft 2 (after the owner's chat correction, 20261123T161839) — offers the audit, but badly ──
  const draft2 = `Keyword mapping, on-page rewrites and developer tasks all lean on GA4 and Search Console reporting organic conversions cleanly, so that's where I'd start, before your SEO developer touches anything.

12 years in technical SEO. I write findings as tickets your developer can implement without follow-up questions: speed, indexing, schema, crawlability. The backlink review ends in a safe, practical off-page plan, not a list of links.

Relevant results:

Golden State Trailers (attached in profile highlights): technical audit and fixes, commercial-intent keyword research, 72 localized city pages and steady link building. Organic traffic +350%, 67 keywords in Top 3.

Derma Solution (attached as PDF): YMYL medical aesthetics, technical-first SEO. Fixed robots.txt, HTTPS, canonicals and site speed, added schema, then built authority to 155 referring domains. Organic users went from about 357 to 25,989 per month.

For the technical audit, I'm attaching two samples of recent audits: a bilingual EN/DE bridal e-commerce site on Webflow, and a multi-language beauty e-commerce store on Shopify. Every issue is numbered with its business impact, the exact fix (code included where needed), a priority tier, and the role who handles it, programmer or content manager. Every audit is done by hand, no automated tools. Two technical SEO audit samples are attached so you can see exactly what your developer would receive.

Artem`;

  // ── the auditor's own "good" model letter (Task 7.6) — offer -> content -> proof, once ──
  const goodExample = `Before you scale SEO and Google Ads, the tracking has to be right, so I'd start with your GA4 and Search Console setup and make sure organic conversions are measured cleanly. Everything else on your list builds on that.

I'd handle this as one manual SEO audit covering all five areas you listed:
- keyword research mapped to your core service and product pages
- on-page review of titles, descriptions, H1-H3, internal links and content
- technical issues (speed, indexing, schema, crawlability) written as prioritized tickets your SEO developer can implement without follow-up questions
- a GA4 and Search Console check, so organic and Google Ads results can be compared
- a backlink review with a safe, practical off-page plan
Everything is checked by hand, not exported from a tool. I'm attaching two recent technical SEO audit samples so you can see exactly what your developer would receive.

12 years in SEO and Google Ads, Google Premier Partner 2026.

Relevant results:

Golden State Trailers (attached in profile highlights): technical audit and fixes, commercial-intent keyword research, 72 localized city pages and steady link building. Organic traffic +350%, 67 keywords in Top 3.

FridgeFix (attached in profile highlights): GA4 and GTM conversion tracking set up before scaling Google Ads. Conversions +1,405%, cost per conversion -92%.

Which pages matter most to you right now, services or products? I'd start the keyword mapping there.

Artem`;

  // ── offerMissingBeforeAttachment: both drafts fire, the good example does not ──
  assert(G.offerMissingBeforeAttachment(draft1) === true, 'draft 1: the audit is attached but never offered -> fires');
  assert(G.offerMissingBeforeAttachment(draft2) === true, 'draft 2: "For the technical audit, I\'m attaching..." is not a commitment sentence -> fires');
  assert(G.offerMissingBeforeAttachment(goodExample) === false, 'the good example commits ("I\'d handle this as one manual SEO audit...") before the attachment -> does not fire');

  // ── duplicateAttachment: only draft 2 mentions the audit sample twice ──
  assert(G.duplicateAttachment(draft1) === false, 'draft 1: the audit sample is mentioned once -> does not fire');
  assert(G.duplicateAttachment(draft2) === true, 'draft 2: "I\'m attaching two samples of recent audits" AND "Two technical SEO audit samples are attached" -> fires');
  assert(G.duplicateAttachment(goodExample) === false, 'the good example mentions the audit sample once -> does not fire');

  // ── isolated unit checks ──
  assert(G.offerMissingBeforeAttachment('I can prepare a custom 3-month SEO promotion plan within 2 working days. I\'m attaching a sample SEO promotion plan so you can see the format.') === false,
    'a real plan commitment before the plan attachment -> does not fire');
  assert(G.offerMissingBeforeAttachment('I\'m attaching a sample SEO promotion plan so you can see the format.') === true,
    'a plan sample attached with NO commitment sentence anywhere -> fires');
  assert(G.duplicateAttachment('I\'m attaching a sample SEO promotion plan. Later: here is a sample SEO promotion plan again.') === true,
    'two genuine plan-sample mentions, not just the audit sample -> fires too (not audit-specific)');

  // ── wrongDeliverableForScope ──
  assert(G.wrongDeliverableForScope(draft1, { wantsOngoingWork: false, isAuditJob: true }) === 'plan-on-audit-only',
    'draft 1: the 3-month plan on an audit-only job with no ongoing-work ask -> wrong deliverable');
  assert(G.wrongDeliverableForScope(goodExample, { wantsOngoingWork: false, isAuditJob: true }) === null,
    'the good example offers only the audit on an audit-only job -> correct deliverable');
  assert(G.wrongDeliverableForScope('I can prepare a custom 3-month SEO promotion plan.', { wantsOngoingWork: true, isAuditJob: false }) === null,
    'the plan on a genuine growth/retainer job (wants_ongoing_work=true, not an audit ask) -> correct deliverable');
  assert(G.wrongDeliverableForScope('I\'m attaching a sample technical SEO audit so you can see the depth.', { wantsOngoingWork: true, isAuditJob: false }) === 'audit-on-growth-retainer',
    'the audit sample offered on a growth/retainer job that never asked for an audit -> wrong deliverable');
  assert(G.wrongDeliverableForScope('Plain letter with neither deliverable mentioned.', { wantsOngoingWork: false, isAuditJob: true }) === null,
    'no deliverable mentioned at all -> nothing to flag');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
