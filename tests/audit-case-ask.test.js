// A posting that asks to see an audit gets Artem's real audit sample as the case.
//
// Job 21630 (2026-11-02): "One redacted audit or performance case showing the
// problem, your analysis, recommended actions, and what you personally did."
// The letter wrote "Audit case: Derma Solution (attached as PDF)" (a results
// case) and mentioned the real audit only as an attachment line. Artem: "why are
// you picking Derma solution as audit case and not the real audit case?" The
// generator had the audit's contents, but filed under "VERTICAL REFERENCE
// TEMPLATES" because the KB title says "examples"; the chat had none of it (see
// tests/test_chat_kb_samples.py).
//
// The phrases below are real postings from the DB (2026-11-02). The detector
// matches 24 of 2,387 postings, each read and each a real ask (22 are here), and
// none of the 8 near misses, which are not asks.
//
// Run: node tests/audit-case-ask.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'letterGuards.js')).href);

  const ASKS = [
    'One redacted audit or performance case showing the problem, your analysis, recommended actions, and what you personally did.',
    'Proven experience with full-scope website audits (please share samples)',
    'Please share relevant examples of similar audit projects you have completed, ideally within the fashion or e-commerce space.',
    'If this sounds like your kind of project, send over a sample audit or a few case studies.',
    'Examples of similar SEO audits (travel/tourism/hospitality preferred).',
    'Rate: Open – please share your hourly or day rate, and a link to any sample audit/report work.',
    "Share a technical SEO audit you've delivered (redacted is fine), or describe the top three things you check first.",
    'Can you provide a redacted sample audit or performance report and a client reference who can verify your work?',
    'Sample audits or reports, with confidential details removed.',
    '- Two relevant audit or growth strategy examples.',
    '- One or two relevant audit examples, with confidential information removed.',
    'Please send examples of website audits, conversion work, UX/content strategy, or website copy projects.',
    'A sample audit or fix list (anonymized is fine).',
    'Please provide a short example of a technical SEO audit or developer ticket you personally produced.',
    'Please share your relevant experience and examples of similar audits you’ve completed.',
    'Please include examples of similar technical audits, your proposed approach, the time required, and your fixed-price quote.',
    'Please share examples of previous SEO audits, your proposed approach, timeline, and fixed-price quote.',
    'Examples of similar audits you have completed.',
    'Can you provide a redacted example of a previous SEO audit report and action plan?',
    'An example of an account you’ve managed or an audit you’ve conducted.',
    'An example of an audit or optimization you’ve done.',
    'Please provide examples of similar large-scale WordPress content audits, your proposed methodology, estimated completion time.',
  ];
  for (const s of ASKS) assert(!!G.findAuditCaseAsk(s), `asks: "${s.slice(0, 70)}"`);

  const NOT_ASKS = [
    // the audit the client is buying, not one Artem has done
    'We need a full technical SEO audit of our Shopify store, delivered as an audit report with priorities.',
    'Deliverable: an audit report and a 90-day roadmap.',
    // near misses from the DB
    'Please share relevant experience with similar audits and examples of recommendations that led to measurable improvements.',
    'Please share relevant examples, your audit approach and your proposed fee.',
    'Please share relevant examples of similar projects and your approach to SEO audits.',
    'No unpaid audit, detailed keyword research, or sample blog content is required.',
    'Please share your experience with Wix SEO, how you approach audits and implementation, and examples of results you’ve achieved.',
    'Please share relevant experience with Google Ads audits and optimization, along with examples of past results.',
    'A privacy-safe walkthrough is welcome; no new unpaid audit or sample is requested.',
    'An email campaign concept, an SEO content recommendation, a sample ad, or a brief messaging audit.',
  ];
  for (const s of NOT_ASKS) assert(!G.findAuditCaseAsk(s), `not an ask: "${s.slice(0, 70)}"`);

  const a = G.findAuditCaseAsk('Please include:\n\n1. One redacted audit or performance case showing the problem, your analysis.');
  assert(a && /redacted audit or performance case/.test(a.sentence), 'returns the asking sentence for the prompt to quote');

  // Which KB entries are the samples: the live titles of #419 and #6.
  const S = G.isAuditSampleEntry;
  assert(S({ title: 'two technical SEO website audit examples that Artem attaches to cover letter' }), '#419 is an audit sample');
  assert(S({ title: 'Google Ads audit Example 1' }), '#6 is an audit sample');
  assert(S({ title: 'x', content: 'WORK SAMPLE: Technical SEO Audit - example.com' }), 'a "WORK SAMPLE:" entry is one');
  assert(!S({ title: 'Upwork Prompt Gemini + template examples' }), '#396 (templates) is not');
  assert(!S({ title: 'Artem PPC SEO Client Case Studies Results Overview' }), '#1 (case studies) is not');

  // Wiring in the generator.
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');
  const ref = src.slice(src.indexOf('const referenceEntries = manualEntries.filter('), src.indexOf('if (referenceEntries.length > 0)'));
  assert(/!isAuditSampleEntry\(e\)/.test(ref), 'audit samples are no longer filed as "vertical reference templates"');
  assert(/const auditSampleEntries = manualEntries\.filter\(e => isAuditSampleEntry\(e\)\)/.test(src), 'they get their own block');
  assert(/\$\{referenceText\}\$\{auditSamplesText\}\$\{_auditCaseBlock\}/.test(src), 'the block and the audit-case directive reach the prompt');
  assert(/auditSamplesText  = cached\.auditSamplesText/.test(src) && /referenceText, auditSamplesText,\s*\r?\n\s*cachedAt/.test(src), 'a cached regenerate keeps them');
  assert(/findAuditCaseAsk\(_postingForNotes\) && draftAttachesAuditSample\(proposal\)/.test(src), 'an attached audit sample answers an audit-examples ask in the live note');

  // Owner, 2026-11-02, on the first rewrite: the letter never said the sample was
  // attached as its own statement, and "I wrote the audit myself" read as cringe.
  const dir = src.slice(src.indexOf('THIS POSTING ASKS TO SEE AN AUDIT YOU HAVE DONE'), src.indexOf('const _auditCaseBlock') + 4000);
  assert(/SENTENCE OF ITS OWN[^]*must say it is attached/.test(dir), 'the attachment is its own sentence and must say "attached"');
  assert(/NEVER write "I wrote the audit myself"/.test(dir), 'authorship claims ("I wrote the audit myself") are forbidden');
  assert(!/he wrote the audit/.test(dir), 'the directive no longer tells the model Artem wrote it');
  assert(/by-hand claim goes INSIDE the audit-case paragraph/.test(dir), 'the by-hand claim sits in the audit paragraph, not after the rate');

  console.log(`\n${bad ? `${bad} FAILED` : 'ALL PASS'}`);
  process.exit(bad ? 1 : 0);
})();
