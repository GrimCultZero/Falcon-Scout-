// Proposals sync coverage (audit 2026-10-29, T5).
//
// Symptom: sync_runs read 19 of 90 submitted proposals (runs 553/554), 30 of 93
// (runs 670-677), and "81 of 94 with pages of 8, 6 and 7 rows". Cause, measured on
// the live page (2026-11-07): for every proposal older than about a week Upwork
// prints the age on its own line ("last week", "last month", "2 quarters ago").
// The title filter knew "N days ago" but not those, so the row's "title" came out
// as "last week" -- 9 characters, passing the 8-character minimum. The title
// dedupe then kept ONE row per page and dropped the other nine (all ten rows of
// page 4 on the live list said "last week"), and the "zero new rows" stop ended
// the whole sync at the first page that contributed nothing.
//
// Pinned here, against functions lifted from upwork-enricher/proposal.js:
//   * ages are never titles; the row's own proposal link supplies the title;
//   * a row is the same row only when it has the same proposal id;
//   * the header count ("Submitted proposals (94)") drives expectations and stops;
//   * a short page is re-read before moving on; one empty page no longer ends
//     the sync, two in a row do;
//   * coverage and the stop reason are recorded.
//
// No DOM, no network, no timers: the pager and the scraper are stubs.
// Run: node tests/proposal-sync-rows.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'upwork-enricher', 'proposal.js'), 'utf8').replace(/\r\n/g, '\n');

// ── lift the real code ──────────────────────────────────────────────────────
const sliceFn = (startMarker, endMarker) => {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`could not lift ${startMarker}`);
  return src.slice(a, b);
};
const helpersSrc = sliceFn('  function _isRelativeTimeText(', '  // A cheap signature of what is currently rendered.');
const scrapeAllSrc = sliceFn('  async function scrapeAllProposalPages()', '  async function scrapeProposalsList()');

const helpers = new Function('_PAGE_SIZE', `${helpersSrc}\nreturn { _isRelativeTimeText, _pickJobTitle, _rowKey, _parseSubmittedCount, _parseCurrentPageText, _expectedRowsOnPage, _pagingStopReason };`)(10);
const { _isRelativeTimeText, _pickJobTitle, _rowKey, _parseSubmittedCount, _parseCurrentPageText, _expectedRowsOnPage, _pagingStopReason } = helpers;

// scrapeAllProposalPages with a stub page, stub pager and instant "sleep".
function runScrapeAll({ headerText, pages, advanceFails = {} }) {
  // pages: array (index = page-1) of arrays of reads; each read is the rows one scrape returns.
  // A page's reads are consumed in order, the last one repeating.
  const state = { page: 1, reads: {}, scrapeCalls: 0 };
  const stubs = {
    _PAGE_CAP: 15, _PAGE_CAP_MAX: 40, _PAGE_SIZE: 10,
    ...helpers,
    document: { body: { innerText: headerText } },
    setTimeout: (fn) => { fn(); return 0; },       // retries wait 1.5 s; do not
    console: { log() {}, warn() {}, error() {} },
    scrapeProposalsList: async () => {
      state.scrapeCalls++;
      const reads = pages[state.page - 1] || [[]];
      const i = state.reads[state.page] = (state.reads[state.page] || 0);
      state.reads[state.page]++;
      return { rows: reads[Math.min(i, reads.length - 1)], debug: { n: 1 } };
    },
    _goToNextProposalsPage: async () => {
      // What the real _goToNextProposalsPage does when there is no next control: note why, return false.
      if (advanceFails[state.page]) { stubs.__box.note({ stopReason: 'no next-page control found' }); return false; }
      state.page++; return true;
    },
    __box: {},
  };
  const body = `
    let _lastPagerDiag = null;
    __box.note = (o) => { _lastPagerDiag = Object.assign(_lastPagerDiag || {}, o); };
    ${scrapeAllSrc}
    return scrapeAllProposalPages().then(r => ({ r, diag: _lastPagerDiag }));`;
  const names = Object.keys(stubs);
  const fn = new Function(...names, body);
  return fn(...names.map((k) => stubs[k])).then((out) => ({ ...out, state }));
}

// A row as the (fixed) scraper emits it: distinct proposal id, link title.
const mkRow = (n, extra = {}) => ({ upwork_job_id: null, upwork_proposal_id: '2061000000000' + String(n).padStart(6, '0'), job_title: `Google Ads job number ${n}`, initiated_at: 'Initiated Oct 29, 2026', viewed: false, ...extra });
const rowsFor = (from, to) => { const a = []; for (let i = from; i <= to; i++) a.push(mkRow(i)); return a; };

(async () => {
  // ── 1. ages are not titles ────────────────────────────────────────────────
  for (const t of ['last week', 'last month', 'this week', 'last year', 'last quarter', '2 quarters ago', '4 days ago',
                   '3 weeks ago', 'yesterday', 'today', 'just now', 'an hour ago', 'a few seconds ago', 'about 3 weeks ago',
                   '1 month ago', '5 months ago', 'Last Week', '  last   month ']) {
    assert(_isRelativeTimeText(t) === true, `"${t}" is an age`);
  }
  for (const t of ['SEO Audit and Website Optimization', 'Google Ads expert for last week of month promo', 'Fix tracking broken a year ago',
                   'Weekly reporting', 'Last Mile Delivery Google Ads', 'Today Show Google Ads Campaign', 'Yesterday Once More SEO', '']) {
    assert(_isRelativeTimeText(t) === false, `"${t}" is not an age`);
  }

  // ── 2. the row's title ────────────────────────────────────────────────────
  // The exact shape of a live row older than a week (titles synthetic).
  const oldRowLines = ['Initiated Oct 29, 2026', 'last week', 'Boosted', 'SEO Service for Dental Clinics', 'General Profile'];
  // The filter as it shipped in 5.15 (copied, not lifted: it no longer exists). It is
  // here so this file shows what went wrong, not only that it is fixed.
  const legacyTitle = (lines) => {
    for (const line of lines) {
      if (line.length < 8 || line.length > 200) continue;
      if (/^(initiated|submitted|viewed|received|status|posted)\b/i.test(line)) continue;
      if (/^[\d$.,\s]+$/.test(line)) continue;
      if (/\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i.test(line)) continue;
      if (/^(yesterday|today|just now|a (minute|moment|few seconds) ago)\b/i.test(line)) continue;
      if (/\b(boosted|not boosted|learn more)\b/i.test(line)) continue;
      return line;
    }
    return '';
  };
  assert(legacyTitle(oldRowLines) === 'last week', 'REPRODUCTION: the 5.15 filter returned "last week" as the title of an older row');
  assert(legacyTitle(['Initiated Jun 1, 2026', '2 quarters ago', 'Technical SEO Audit']) === '2 quarters ago', 'REPRODUCTION: …and "2 quarters ago"');
  assert(_pickJobTitle(['SEO Service for Dental Clinics'], oldRowLines) === 'SEO Service for Dental Clinics', 'link text gives the title');
  assert(_pickJobTitle([], oldRowLines) === 'SEO Service for Dental Clinics', '…and with no link, the text lines still skip "last week"');
  assert(_pickJobTitle([], ['Initiated Sep 3, 2026', 'last month', 'Google Ads Audit for Florist']) === 'Google Ads Audit for Florist', '"last month" is skipped');
  assert(_pickJobTitle([], ['Initiated Jun 1, 2026', '2 quarters ago', 'Boost outbid', 'Technical SEO Audit Needed']) === 'Technical SEO Audit Needed', '"2 quarters ago" is skipped (the old unit list had no "quarter")');
  assert(_pickJobTitle(['last week', 'Real Title Here'], []) === 'Real Title Here', 'a link whose text is an age is passed over');
  assert(_pickJobTitle(['Boosted'], ['Initiated Nov 3, 2026', '4 days ago', 'Boost outbid', 'PPC Specialist for Roofing']) === 'PPC Specialist for Roofing', 'a "Boosted" badge link is not a title');
  assert(_pickJobTitle([], ['Initiated Nov 3, 2026', 'last week']) === '', 'only an age and nothing else -> no title (never "last week")');
  assert(_pickJobTitle(['  Multi\n line   title  '], []) === 'Multi line title', 'whitespace in link text is collapsed');

  // ── 3. identity ───────────────────────────────────────────────────────────
  assert(_rowKey({ upwork_proposal_id: '123', upwork_job_id: 'abc', job_title: 'X' }) === 'p:123', 'proposal id wins');
  assert(_rowKey({ upwork_job_id: 'abc', job_title: 'X' }) === 'j:abc', 'then the job id');
  assert(_rowKey({ job_title: ' Same Title ' }) === 't:same title', 'then the title');
  assert(_rowKey({ job_title: '' }) === '', 'nothing -> no key (the row cannot be matched)');
  assert(_rowKey({ upwork_proposal_id: '1', job_title: 'Same' }) !== _rowKey({ upwork_proposal_id: '2', job_title: 'Same' }),
    'two proposals that share a title are two rows');
  // The regression itself: ten rows that all read "last week", each with its own id.
  const tenOld = [];
  for (let i = 1; i <= 10; i++) tenOld.push({ upwork_proposal_id: String(900 + i), job_title: _pickJobTitle([`Google Ads job ${i}`], ['Initiated Oct 29, 2026', 'last week', `Google Ads job ${i}`]) });
  assert(new Set(tenOld.map(_rowKey)).size === 10 && tenOld.every((r) => r.job_title.startsWith('Google Ads job')),
    'ten rows that all say "last week" are ten rows with real titles (was: one row titled "last week")');

  // ── 4. header count and expectations ──────────────────────────────────────
  assert(_parseSubmittedCount('Active proposals  (10)\nSubmitted proposals  (94)\nInitiated') === 94, 'header count read from "Submitted proposals  (94)"');
  assert(_parseSubmittedCount('Active proposals (10)') === null, 'the Active header is not the submitted count');
  assert(_parseSubmittedCount('') === null && _parseSubmittedCount(null) === null, 'empty -> null');
  assert(_expectedRowsOnPage(1, 94) === 10 && _expectedRowsOnPage(9, 94) === 10 && _expectedRowsOnPage(10, 94) === 4, 'pages 1-9 expect 10, page 10 of 94 expects 4');
  assert(_expectedRowsOnPage(11, 94) === 0 && _expectedRowsOnPage(1, null) === null, 'past the end -> 0; unknown count -> null');

  // ── 4b. the pager's own text: with or without a separator ─────────────────
  // 12 of 88 runs since run 520 stopped at page 1 (10 of 90 rows). Their pager text
  // had NO separator: "Current page 1 of 101" (= "of 10" + the digit "1") and
  // "go to page2". The old patterns read 101 pages and could not find "go to page 2".
  const cp = (t, e) => { const r = _parseCurrentPageText(t, e); return r ? `${r.current}/${r.total}` : null; };
  assert(cp('Current page 2 of 9\n2') === '2/9' && cp('Current page 3 of 10 3') === '3/10', 'separated text still parses (newline or space)');
  assert(cp('Current page 1 of 101') === '1/10', 'RUN 666: "Current page 1 of 101" is page 1 of 10, not of 101');
  assert(cp('Current page 1 of 91') === '1/9', 'RUN 662: "Current page 1 of 91" is page 1 of 9');
  assert(cp('Current page 2 of 92') === '2/9' && cp('Current page 10 of 1010') === '10/10', 'glued digit stripped on later pages too (2 of 9, 10 of 10)');
  assert(cp('Current page 9 of 9') === '9/9' && cp('Current page 10 of 10') === '10/10' && cp('Current page 1 of 7') === '1/7',
    'no visible digit at all: the total is left alone');
  assert(cp('Current page 1 of 11', 11) === '1/11', 'ambiguous "of 11": the header count (11 pages) decides it is 11, not 1');
  assert(cp('Current page 1 of 11', 1) === '1/1', '…and if the header implies 1 page, it is 1');
  assert(cp('Current page 1 of 101', 10) === '1/10', 'header agrees with the stripped reading');
  assert(cp('go to page 2') === null && cp('') === null && cp(null) === null, 'other controls are not the current-page control');
  const goTo = /^go\s*to\s*page\s*(\d+)$/i;
  assert(goTo.test('go to page 2') && goTo.test('go to page2') && goTo.test('Go to page   12') && !goTo.test('go to page') && !goTo.test('go to pager 2'),
    '"go to page N" is matched with or without the space (shipped pattern is in the source: checked below)');
  assert(src.includes('/^go\\s*to\\s*page\\s*(\\d+)$/i'), 'the shipped file uses that tolerant pattern');

  // ── 5. when to stop ───────────────────────────────────────────────────────
  assert(/header count reached/.test(_pagingStopReason({ mergedCount: 94, headerCount: 94, emptyStreak: 0, page: 10, cap: 17 })), 'stops when the header count is reached');
  assert(_pagingStopReason({ mergedCount: 30, headerCount: 90, emptyStreak: 1, page: 4, cap: 15 }) === null, 'ONE page adding nothing does not stop the sync (the 19-of-90 bug)');
  assert(/two pages in a row/.test(_pagingStopReason({ mergedCount: 30, headerCount: 90, emptyStreak: 2, page: 5, cap: 15 })), 'two empty pages in a row do');
  assert(/page cap/.test(_pagingStopReason({ mergedCount: 30, headerCount: 900, emptyStreak: 0, page: 15, cap: 15 })), 'the page cap still ends it');
  assert(_pagingStopReason({ mergedCount: 5, headerCount: null, emptyStreak: 0, page: 1, cap: 15 }) === null, 'unknown header count: keeps going until the pager ends');

  // ── 6. the whole loop, with the pager and scraper stubbed ─────────────────
  const header94 = 'Active proposals  (10)\nSubmitted proposals  (94)';
  const fullPages = []; for (let p = 0; p < 10; p++) fullPages.push([rowsFor(p * 10 + 1, Math.min(p * 10 + 10, 94))]);

  let o = await runScrapeAll({ headerText: header94, pages: fullPages });
  assert(o.r.rows.length === 94 && o.state.page === 10, `a clean 10-page list: 94 of 94 rows, ${o.state.page} pages`);
  assert(o.diag.headerCount === 94 && o.diag.coverage === 1 && /header count reached/.test(o.diag.stopReason), `coverage 1.0 and the stop reason is recorded (${o.diag.stopReason})`);
  assert(o.r.debug.pagination.coverage === 1 && o.r.debug.pagination.headerCount === 94, 'the banner/debug carries header count and coverage');
  assert(o.state.scrapeCalls === 10, 'no re-reads when every page is full');

  // Run 554's shape: page 3 yields 1 row (zero new). Old code stopped dead.
  const run554 = fullPages.map((p) => p.slice());
  run554[2] = [rowsFor(21, 21)];                                 // page 3: 1 row, and it is one already seen below
  run554[2] = [[mkRow(21)]];
  let o2 = await runScrapeAll({ headerText: 'Submitted proposals  (90)', pages: [[rowsFor(1, 10)], [rowsFor(11, 19)], [[mkRow(11)]], [rowsFor(31, 40)], [rowsFor(41, 50)]], advanceFails: { 5: true } });
  assert(o2.state.page === 5, `a page that adds nothing new no longer ends the sync: reached page ${o2.state.page} (run 554 stopped at 3)`);
  assert(o2.r.rows.length === 10 + 9 + 10 + 10 && o2.diag.coverage < 0.95, `…and the gap shows as low coverage (${o2.r.rows.length} of 90 = ${o2.diag.coverage}) instead of looking like success`);

  // A page caught mid-render: 1 row first, the full 10 on the re-read.
  const half = fullPages.map((p) => p.slice());
  half[3] = [[mkRow(31)], rowsFor(31, 40)];
  let o3 = await runScrapeAll({ headerText: header94, pages: half });
  assert(o3.r.rows.length === 94, `a half-rendered page is re-read before moving on: ${o3.r.rows.length} of 94`);
  assert(o3.diag.perPage[3].retries === 1 && o3.diag.perPage[3].scraped === 10 && o3.diag.perPage[3].expected === 10, 'the retry is recorded per page (retries 1, expected 10)');

  // The page never fills: two re-reads, then it moves on (does not loop forever).
  const never = fullPages.map((p) => p.slice());
  never[3] = [[mkRow(31)]];
  let o4 = await runScrapeAll({ headerText: header94, pages: never });
  assert(o4.diag.perPage[3].retries === 2 && o4.r.rows.length === 85, `a page that never fills is re-read twice, then skipped: ${o4.r.rows.length} rows, retries ${o4.diag.perPage[3].retries}`);
  assert(o4.diag.coverage < 0.95 && o4.diag.coverage === Math.round(85 / 94 * 10000) / 10000, `its coverage is honest (${o4.diag.coverage})`);

  // Stuck on one page: the pager "advances" but the same rows come back.
  const stuck = [[rowsFor(1, 10)], [rowsFor(1, 10)], [rowsFor(1, 10)], [rowsFor(1, 10)]];
  let o5 = await runScrapeAll({ headerText: header94, pages: stuck });
  assert(o5.state.page === 3 && /two pages in a row/.test(o5.diag.stopReason), `stuck on the same rows: stops after two empty pages (page ${o5.state.page})`);

  // No next control: the last page; the pager's own reason is kept.
  let o6 = await runScrapeAll({ headerText: 'Submitted proposals  (23)', pages: [[rowsFor(1, 10)], [rowsFor(11, 20)], [rowsFor(21, 22)]], advanceFails: { 3: true } });
  assert(o6.r.rows.length === 22 && o6.diag.stopReason === 'no next-page control found' && o6.diag.coverage === Math.round(22 / 23 * 10000) / 10000,
    `end of the list before the header count: stops on the pager's reason, coverage ${o6.diag.coverage}`);

  // Same title, different proposals: both kept.
  const dup = [[[mkRow(1, { job_title: 'SEO Audit' }), mkRow(2, { job_title: 'SEO Audit' }), ...rowsFor(3, 10)]]];
  let o7 = await runScrapeAll({ headerText: 'Submitted proposals  (10)', pages: dup });
  assert(o7.r.rows.length === 10, 'two proposals with the same title are both kept');

  // A viewed reading on a re-read upgrades the row; it is never downgraded.
  const vw = [[ [mkRow(1, { viewed: false }), ...rowsFor(2, 5)], [mkRow(1, { viewed: true }), ...rowsFor(2, 10)] ]];
  let o8 = await runScrapeAll({ headerText: 'Submitted proposals  (10)', pages: vw });
  assert(o8.r.rows.length === 10 && o8.r.rows.find((r) => r.upwork_proposal_id === mkRow(1).upwork_proposal_id).viewed === true,
    'a "viewed" seen on the re-read is kept');

  // No header on the page: behaves as before (pager decides), no retries, no coverage.
  let o9 = await runScrapeAll({ headerText: 'whatever', pages: [[rowsFor(1, 10)], [rowsFor(11, 15)]], advanceFails: { 2: true } });
  assert(o9.r.rows.length === 15 && o9.diag.coverage === null && o9.diag.perPage.every((p) => p.retries === 0), 'no header count: no coverage claimed, no re-reads');

  // ── 7. wiring in the shipped file ─────────────────────────────────────────
  const scrapeListSrc = sliceFn('  async function scrapeProposalsList()', '  // Travels to sync_runs.scroll_json');
  assert(/_pickJobTitle\(linkTexts, lines\)/.test(scrapeListSrc), 'scrapeProposalsList takes the title from _pickJobTitle (link first)');
  assert(!/\(seconds\?\|minutes\?\|hours\?\|days\?\|weeks\?\|months\?\|years\?\)/.test(scrapeListSrc), 'the old unit-list age filter is gone from the row loop');
  assert(/if \(!upwork_proposal_id && !upwork_job_id && job_title\)/.test(scrapeListSrc), 'title dedupe applies only to rows with no id of their own');
  assert(!/if \(added === 0 && page > 1\) break;/.test(src), 'the "zero new rows ends the sync" stop is gone');
  assert(/header_count: \(_lastPagerDiag && _lastPagerDiag\.headerCount\) \|\| null/.test(src), 'the sync POST carries header_count');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'upwork-enricher', 'manifest.json'), 'utf8'));
  const _v = manifest.version.split('.').map(Number);
  assert(_v[0] > 5 || (_v[0] === 5 && _v[1] >= 16), `extension version is 5.16 or newer, so a stale loaded extension is visible (${manifest.version})`);

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
