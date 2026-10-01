// The job-TYPE flags are read from the posting, never from the assembled prompt.
//
// 53840ec (job 15261) moved jobIsPaidMedia / jobIsPpc / jobIsSeo onto the posting
// after Falcon's own prompt text — analyser prose, CLIENT TYPE line, case notes —
// reclassified SEO jobs as paid media and switched their price checks off. It
// missed jobIsWebdev. Job 16878 (2026-09-30, technical SEO for a 10K-product
// multi-domain webshop, "Your fixed-price proposal") shipped "$8,500 for Priority
// 1" with no SEO price flag: on the prompt blob the direct-client CLIENT TYPE line
// says "developer" (a web-dev task signal) and the business-facts block says
// "Shopify sites we manage" (a platform) — together, web-dev — so
// _seoPricingContext was false and findOffLedgerSeoPrices never ran. Over 498
// stored postings, Falcon's text alone flipped 159 to web-dev, 56 of them pure SEO.
//
// Run: node tests/job-type-posting-only.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const lineOf = (name) => { const i = src.indexOf(`const ${name} = `); return src.slice(i, src.indexOf('\n', i)); };
const grab = (name) => new Function(`return ${lineOf(name).replace(`const ${name} = `, '').replace(/;?\s*$/, '')}`)();

// The classifier exactly as generate() runs it.
const isStart = src.indexOf('const _isWebdevText = (t) =>');
const isEnd = src.indexOf('\n            const jobIsWebdev = ', isStart);
const isWebdev = new Function('WEBDEV_INTENT_REQUIRED', '_WEBDEV_EXPLICIT_RE', '_WEBDEV_PLATFORM_RE', '_WEBDEV_TASK_SIGNAL_RE', '_WEBDEV_TASK_SCOPED_RE',
  `${src.slice(isStart, isEnd)}; return _isWebdevText`)(true, grab('_WEBDEV_EXPLICIT_RE'), grab('_WEBDEV_PLATFORM_RE'), grab('_WEBDEV_TASK_SIGNAL_RE'), grab('_WEBDEV_TASK_SCOPED_RE'));

// Falcon's own blocks, as jobContext carries them: the direct-client CLIENT TYPE
// line and the business-facts block (added when the posting has a checklist).
const ctStart = src.indexOf('CLIENT TYPE: DIRECT end client');
const clientTypeDirect = src.slice(ctStart, src.indexOf('`', ctStart));
const factsLib = new Function(`${src.slice(src.indexOf('function extractWebsiteUrl(text)'), src.indexOf('function buildArtemFactsBlock'))}
${src.slice(src.indexOf('function buildArtemFactsBlock'), src.indexOf('\n}\n', src.indexOf('function buildArtemFactsBlock')) + 3)}
return { extractApplicationChecklist, buildArtemFactsBlock }`)();

// Shaped like 16878's posting (paraphrased): pure technical SEO, a checklist, a fixed-price ask.
const posting = [
  'SEO Expert & Google ranking expert for a multi-domain webshop', 'sales_marketing', 'Search Engine Optimization, On-Page SEO',
  'We are looking for an experienced technical / ecommerce SEO specialist to own SEO implementation for a large ecommerce platform with about 10,000 products across several category domains with one central checkout.',
  'The work covers technical SEO, indexation governance, faceted navigation, crawl management, structured data, internal linking, PLP optimization and Core Web Vitals.',
  'Please include in your proposal:',
  '- 1-3 comparable ecommerce SEO projects you personally worked on',
  '- Measurable results, preferably with Google Search Console data',
  '- Your proposed timeframe',
  '- Your fixed-price proposal',
].join('\n');
const postingLower = posting.toLowerCase();
const checklist = factsLib.extractApplicationChecklist(posting);
const facts = checklist ? factsLib.buildArtemFactsBlock(posting) : '';

(async () => {
  assert(!!checklist && /shopify sites we manage/i.test(facts), 'the posting has a checklist, so the business-facts block ("Shopify sites we manage") goes into the prompt');
  assert(/\bdeveloper\b/i.test(clientTypeDirect), 'the direct-client CLIENT TYPE line contains "developer"');
  assert(!isWebdev(postingLower), 'a pure technical-SEO posting is not web-dev');
  assert(isWebdev([postingLower, clientTypeDirect, facts].join('\n').toLowerCase()),
    "…but with Falcon's own CLIENT TYPE line + facts block the same job read as web-dev (the 16878 bug)");

  // the decision reads the posting
  assert(/const jobIsWebdev = _isWebdevText\(_postingOnlyLower\)/.test(src), 'jobIsWebdev is decided on the posting only');
  assert(/jobIsWebdevMaintenance = jobIsWebdev && _WEBDEV_MAINT_RE\.test\(_postingOnlyLower\) && !_WEBDEV_NEWBUILD_RE\.test\(_postingOnlyLower\)/.test(src),
    '…and so is the maintenance-vs-new-build reading');
  assert(/if \(jobIsWebdev !== _isWebdevText\(jobContextLower\)\) \{[\s\S]{0,300}?'jobTypeBlobContamination'/.test(src),
    'a disagreement with the prompt blob is recorded (jobTypeBlobContamination), so the correction is measured');
  assert(/const jobIsPpc = PPC_JOB_KEYWORDS\.test\(_postingOnlyLower\)/.test(src) && /const jobIsSeo = SEO_JOB_KEYWORDS\.test\(_postingOnlyLower\)/.test(src)
    && /const jobIsPaidMedia = PAID_MEDIA_KEYWORD_RE\.test\(_postingOnlyLower\)/.test(src),
    'all four job-type flags now read the posting (PPC, SEO, paid media already did)');
  assert(src.indexOf('const _postingOnlyLower = ') < src.indexOf('const jobIsWebdev = '), '_postingOnlyLower is declared before jobIsWebdev reads it (no use-before-declaration)');

  // real web-dev postings still read as web-dev from the posting alone
  for (const p of [
    'We need a Shopify developer to customize our theme and fix the product page template.',
    'Build a WooCommerce store for our bakery, from scratch.',
    'Looking for a web developer to redesign our WordPress website.',
  ]) assert(isWebdev(p.toLowerCase()), `still web-dev: "${p}"`);

  // the gate it unblocks: the SEO price check sees an invented fixed price
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'letterGuards.js')).href);
  const letter = 'Timeframe: Priority 1 in 5 - 6 weeks.\n\nFixed price: $8,500 for Priority 1 (the 8 site-wide interventions that must complete before scaling).\n\nArtem';
  const off = G.findOffLedgerSeoPrices(letter, { postedFixed: '$400', postingText: posting });
  assert(off.length === 1 && off[0].amount === 8500 && off[0].kind === 'flat',
    'with the gate open, "$8,500 fixed" is flagged as off the SEO ledger ($700 audit, included in the $1,050/month retainer — KB Rule 426)');
  assert(/const _seoPricingContext = jobIsSeo && !jobIsPpc && !jobIsWebdev/.test(src), '…the gate being jobIsSeo && !jobIsPpc && !jobIsWebdev');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
