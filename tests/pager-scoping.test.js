// Two paginated lists on one page — does the pager resolve inside "Submitted proposals"?
// Functions are lifted from proposal.js so the test can't drift from shipped code.
const fs = require('fs');
// This file printed PASS/FAIL but always exited 0, so the suite runner could never
// see a failure here (found 2026-10-06). Count FAIL lines and set the exit code.
let _fails = 0;
const _log = console.log;
console.log = (...a) => { if (/^FAIL\b/.test(String(a[0]))) _fails++; _log(...a); };
const src = fs.readFileSync(require('path').join(__dirname, '..', 'upwork-enricher', 'proposal.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const a = src.indexOf('function _submittedSectionRoot()');
const b = src.indexOf('\n  }\n', src.indexOf('function _findNextPageControl()')) + 4;
const fnSrc = src.slice(a, b);
const helperSrc = src.slice(src.indexOf('  function _isRelativeTimeText('), src.indexOf('  // A cheap signature of what is currently rendered.'));
if (!helperSrc.includes('_parseCurrentPageText')) throw new Error('could not lift the pager helpers from proposal.js');

// ── minimal DOM ───────────────────────────────────────────────────────────
let ALL = [];
function E(tag, opts = {}) {
  const el = {
    tag, children: [], parentElement: null,
    _text: opts.text || '', _attrs: opts.attrs || {}, className: opts.cls || '',
    disabled: !!opts.disabled,
    get innerText() {
      return this._text || this.children.map(c => c.innerText).filter(Boolean).join('\n');
    },
    get textContent() { return this.innerText; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    get tagName() { return this.tag.toUpperCase(); },
    get firstElementChild() { return this.children[0] || null; },
    contains(other) {
      // Needed by the innermost-match selection: a wrapper and the button
      // inside it can carry identical text, and only containment tells them
      // apart.
      let found = false;
      (function walk(n) { for (const c of n.children) { if (c === other) found = true; walk(c); } })(this);
      return found || this === other;
    },
    querySelectorAll(sel) {
      // Honour the selector. An earlier version ignored it and returned every
      // descendant, so a pagination CONTAINER was offered as a candidate
      // control — its joined text contains each child's label, which made a
      // loose text match appear to succeed against an unclickable div.
      const out = [];
      (function walk(n) { for (const c of n.children) { out.push(c); walk(c); } })(this);
      if (!sel) return out;
      const parts = sel.split(',').map(s => s.trim()).filter(Boolean);
      return out.filter(el => parts.some(pt => {
        const role = pt.match(/^\[role="?([^"\]]+)"?\]$/);
        if (role) return (el._attrs.role || '') === role[1];
        return el.tag === pt;
      }));
    },
  };
  ALL.push(el);
  return el;
}
function add(parent, child) { child.parentElement = parent; parent.children.push(child); return child; }

function buildPage() {
  ALL = [];
  const body = E('body');

  // ── Active proposals (13) — its own pager, MUST NOT be chosen ──
  const active = add(body, E('section'));
  add(active, E('h2', { text: 'Active proposals (13)' }));
  const arow = add(active, E('div'));
  add(arow, E('div', { text: 'Received Sep 16, 2026' }));   // "Received", not "Initiated"
  const apager = add(active, E('div'));
  add(apager, E('button', { text: '1', attrs: { 'aria-current': 'page' } }));
  add(apager, E('button', { text: '2' }));
  add(apager, E('button', { text: '\u203a' }));             // active list's next arrow

  // ── Submitted proposals (68) — the one we want ──
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals (68)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Initiated Sep 16, 2026' }));  // the scraper's anchor
  const spager = add(submitted, E('div'));
  const s1 = add(spager, E('button', { text: '1', attrs: { 'aria-current': 'page' } }));
  const s2 = add(spager, E('button', { text: '2' }));
  add(spager, E('button', { text: '\u2026' }));
  return { body, wantedNext: s2, activeNext: apager.children[2] };
}

function run(body) {
  global.document = { querySelectorAll: () => ALL.filter(e => e !== body) };
  // _lastPagerDiag is module-scope in proposal.js; declare it so the extracted
  // functions can write their diagnostics without a ReferenceError.
  // The pager code now leans on the pure helpers defined just above it in proposal.js
  // (_parseCurrentPageText, _parseSubmittedCount) and on _PAGE_SIZE; lift them too.
  const f = new Function('let _lastPagerDiag = null; const _PAGE_SIZE = 10;' + helperSrc + fnSrc + '; return { _findNextPageControl, _submittedSectionRoot, _diag: () => _lastPagerDiag };')();
  return f;
}

// case 1 — both lists present
{
  const { body, wantedNext, activeNext } = buildPage();
  const { _findNextPageControl, _submittedSectionRoot } = run(body);
  const root = _submittedSectionRoot();
  const got = _findNextPageControl();
  const rootOk = !!root && /submitted proposals/i.test(root.innerText) && /initiated/i.test(root.innerText);
  const pick = got === wantedNext;
  const notActive = got !== activeNext;
  console.log(`${rootOk ? 'PASS' : 'FAIL'}  section root resolves to the Submitted section`);
  console.log(`${pick ? 'PASS' : 'FAIL'}  next control is the SUBMITTED pager's "2"  -> got ${got ? '"' + got.innerText + '"' : 'null'}`);
  console.log(`${notActive ? 'PASS' : 'FAIL'}  did NOT pick the Active list's arrow`);
}

// case 2 — Submitted section absent (e.g. page not rendered yet)
{
  ALL = [];
  const body = E('body');
  const active = add(body, E('section'));
  add(active, E('h2', { text: 'Active proposals (13)' }));
  const ap = add(active, E('div'));
  add(ap, E('button', { text: '\u203a' }));
  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === null ? 'PASS' : 'FAIL'}  no Submitted section -> returns null (refuses to page the wrong list)`);
}

// ── case 3 — relaxed fallback: Submitted section exists and has its own pager,
// but the rows no longer say "Initiated". Pass 1 fails; pass 2 must resolve it
// WITHOUT reaching for the Active list.
{
  ALL = [];
  const body = E('body');
  const active = add(body, E('section'));
  add(active, E('h2', { text: 'Active proposals (13)' }));
  const apager = add(active, E('div'));
  add(apager, E('button', { text: '\u203a' }));

  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals (68)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Received Sep 16, 2026' }));   // NOT "Initiated"
  const spager = add(submitted, E('div'));
  add(spager, E('button', { text: '1', attrs: { 'aria-current': 'page' } }));
  const s2 = add(spager, E('button', { text: '2' }));

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === s2 ? 'PASS' : 'FAIL'}  relaxed: no "Initiated" -> still finds the SUBMITTED "2"  -> got ${got ? '"' + got.innerText + '"' : 'null'}`);
  console.log(`${got !== apager.children[0] ? 'PASS' : 'FAIL'}  relaxed: still did NOT pick the Active arrow`);
}

// ── case 4 — the guard that makes the fallback safe: the Submitted heading is
// present, but the only pager-bearing ancestor also contains the Active list.
// Paging there would advance the wrong list, so it must refuse.
{
  ALL = [];
  const body = E('body');
  const active = add(body, E('section'));
  add(active, E('h2', { text: 'Active proposals (13)' }));
  const apager = add(active, E('div'));
  add(apager, E('button', { text: '\u203a' }));
  add(body, E('h2', { text: 'Submitted proposals (68)' }));  // heading only, no pager

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === null ? 'PASS' : 'FAIL'}  guard: only ancestor with a pager owns the Active list -> refuses  -> got ${got ? '"' + got.innerText + '"' : 'null'}`);
}

// ── case 5 — the REAL Upwork air3 pagination, using the exact control text
// captured from production (sync_runs id 60). The page buttons embed accessible
// text, so their innerText is never a bare digit, and the arrows are icon-only
// with no text and no aria-label. Every earlier strategy reported
// numericControls: 0 against this and gave up.
{
  ALL = [];
  const body = E('body');
  const active = add(body, E('section'));
  add(active, E('h2', { text: 'Active proposals  (13)' }));

  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (67)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Initiated Sep 16, 2026' }));
  const pager = add(submitted, E('div'));
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  add(pager, E('button', { text: 'Current page 1 of 7\n             1' }));
  const go2 = add(pager, E('button', { text: 'go to page\n             2' }));
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === go2 ? 'PASS' : 'FAIL'}  air3: picks "go to page 2" from page 1 of 7  -> got ${got ? JSON.stringify(got.innerText.replace(/\s+/g, ' ')) : 'null'}`);
}

// ── case 6 — on the last page there is no page 8 to ask for. It must stop
// cleanly rather than clicking an arrow that reloads page 7.
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (67)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Initiated Sep 16, 2026' }));
  const pager = add(submitted, E('div'));
  add(pager, E('button', { text: 'go to page\n             6' }));
  add(pager, E('button', { text: 'Current page 7 of 7\n             7' }));
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === null ? 'PASS' : 'FAIL'}  air3: last page (7 of 7) -> stops  -> got ${got ? JSON.stringify(got.innerText.replace(/\s+/g, ' ')) : 'null'}`);
}

// ── case 7 — a [role="button"] wrapper whose only child is the real <button>.
// Both carry the identical accessible text, so both match and document order
// offers the wrapper first. Clicking a wrapper never reaches the handler bound
// to the child — this is what produced "clicked, but the list never changed"
// on a run where the correct control had been located (sync_runs id 61).
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals \u00a0(67)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Initiated Sep 16, 2026' }));
  const pager = add(submitted, E('div'));
  add(pager, E('button', { text: 'Current page 1 of 7\n             1' }));
  const wrapper = add(pager, E('div', { attrs: { role: 'button' } }));
  const realBtn = add(wrapper, E('button', { text: 'go to page\n             2' }));

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === realBtn ? 'PASS' : 'FAIL'}  nested: picks the inner <button>, not the role=button wrapper  -> got ${got ? got.tag : 'null'}`);
}

// ── case 8 — 2026-10-06: a proposal TITLE that contains "next". Page 2 of the
// Submitted list began with job 16999's proposal, "Google Ads partner to take a
// furniture & home ecommerce brand to the next level". With no "go to page 3"
// control rendered, strategy 1 (any "next" in an aria-label) took the title link
// for the pager: the sync tab left for /nx/proposals/2105638033129840641 and the
// proposals leg never reported, three syncs running.
function page2WithNextTitle({ titleAsButton = false, nextButton = false } = {}) {
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals (60)' }));
  const row = add(submitted, E('div'));
  add(row, E('div', { text: 'Initiated Oct 1, 2026' }));
  const title = 'Google Ads partner to take a furniture & home ecommerce brand to the next level';
  const link = titleAsButton
    ? add(row, E('button', { text: title, attrs: { 'aria-label': title + ' Boosted' } }))
    : add(row, E('a', { text: title, attrs: { href: '/nx/proposals/2105638033129840641', 'aria-label': title + ' Boosted' } }));
  const pager = add(submitted, E('div'));
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));         // icon-only prev
  add(pager, E('button', { text: 'go to page\n 1' }));
  add(pager, E('button', { text: 'Current page 2 of 6\n 2' }));
  add(pager, E('button', { text: '…' }));                                              // no "go to page 3"
  const next = nextButton ? add(pager, E('button', { attrs: { 'aria-label': 'Next page' } })) : null;
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));         // icon-only next
  return { body, link, next };
}
{
  const { body, link } = page2WithNextTitle();
  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got !== link ? 'PASS' : 'FAIL'}  "…to the next level": the proposal's title link is never taken for the pager  -> got ${got ? JSON.stringify(got.innerText.slice(0, 40)) : 'null'}`);
}
{
  const { body, link } = page2WithNextTitle({ titleAsButton: true });
  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got !== link ? 'PASS' : 'FAIL'}  …nor a title rendered as a button: "next" inside a longer name is not a pager name`);
}
{
  const { body, next } = page2WithNextTitle({ nextButton: true });
  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === next ? 'PASS' : 'FAIL'}  a real control named exactly "Next page" is still used  -> got ${got ? (got.getAttribute('aria-label') || got.innerText) : 'null'}`);
}

// ── the numbered buttons run out (2026-10-16) ────────────────────────────────
// Real DOM from the sync of 2026-10-16: page 2 of 9 offered "go to page 1" and
// "Current page 2 of 9" and NOTHING for page 3 — Upwork only renders numbers
// around the current page. The rest were icon-only <button .air3-pagination>
// with no text and no aria-label, invisible to every strategy, so the walk
// stopped at page 2: 17 of 85 submitted proposals scraped, the other 68 never
// refreshed, and a reply on any of them never reached the dashboard.
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (85)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Initiated Oct 12, 2026' }));

  const spager = add(submitted, E('div'));
  // first | prev | 1 | [2] | next | last  — exactly the live shape.
  const first = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  const prev  = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  add(spager, E('button', { text: 'go to page\n1' }));
  add(spager, E('button', { text: 'Current page 2 of 9\n2' }));
  const next  = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  const last  = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === next ? 'PASS' : 'FAIL'}  page 2 of 9 with no "go to page 3" -> falls back to the icon NEXT arrow`);
  console.log(`${got !== last ? 'PASS' : 'FAIL'}  …and not the LAST-page arrow, which would skip pages 3-8`);
  console.log(`${got !== first && got !== prev ? 'PASS' : 'FAIL'}  …and not an arrow BEFORE the current page`);
}

// The last page must still stop rather than click an arrow forever.
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (85)' }));
  const srow = add(submitted, E('div'));
  add(srow, E('div', { text: 'Initiated Oct 12, 2026' }));
  const spager = add(submitted, E('div'));
  add(spager, E('button', { cls: 'air3-btn air3-pagination' }));
  add(spager, E('button', { text: 'go to page\n8' }));
  add(spager, E('button', { text: 'Current page 9 of 9\n9' }));
  add(spager, E('button', { cls: 'air3-btn air3-pagination' }));

  const { _findNextPageControl } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === null ? 'PASS' : 'FAIL'}  page 9 of 9 -> stops, even with icon arrows still rendered`);
}

// ── sync_runs 554 (2026-10-29 12:24): the audit's T5 regression ──────────────
// Page 2 of 9 as stored in that run's probe: 10 title links (each also labelled
// "<title> Boosted"), "Boost outbid" / "Boosted" buttons between them, the
// tooltip and collapse buttons above, then first | prev | go to page 1 |
// Current page 2 of 9 | next | last. That run went on to read page 3 as ONE row
// (the age line "last week" had been taken for the title of all ten, see
// proposal-sync-rows.test.js) and the zero-new-rows stop ended the sync at 19 of
// 90. The PAGER found its way correctly the whole time; pinning that here keeps
// the two causes apart: the fix for the rows must not be mistaken for a pager fix.
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (90)' }));
  add(submitted, E('button', { attrs: { 'aria-label': 'More info on submitted proposals' } }));
  add(submitted, E('button', { text: 'Close the tooltip' }));
  add(submitted, E('button', { cls: 'header-collapse-button air3-btn m-0 p-0' }));
  const titles = ['Google Ads expert: set up a Search campaign', 'SEO & Google Ads Specialist One-Time Audit', 'Google Ads For Florist Business',
    'Google Ads Manager for Fitness Equipment Ecommerce', 'Google Ads Account Audit', 'Complete Company Website', 'Google Ads Specialist for IT Support',
    'Google Ads and Conversion tracking audit with PDF Report', 'Google Ads Specialist Negative Keyword Optimization', 'Google Ads Specialist Needed to take the account to the next level'];
  titles.forEach((t, i) => {
    const row = add(submitted, E('div'));
    add(row, E('div', { text: 'Initiated Oct 2' + (i % 9) + ', 2026\nlast week' }));
    add(row, E('button', { text: i % 2 ? 'Boost outbid' : 'Boosted' }));
    add(row, E('a', { text: t, attrs: { href: '/nx/proposals/20610000000000000' + String(i).padStart(2, '0'), 'aria-label': t + ' Boosted' } }));
  });
  const spager = add(submitted, E('div'));
  const first = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  const prev  = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  add(spager, E('button', { text: 'go to page\n1' }));
  add(spager, E('button', { text: 'Current page 2 of 9\n2' }));
  const next  = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  const last  = add(spager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));

  const { _findNextPageControl, _diag } = run(body);
  const got = _findNextPageControl();
  const probe = (_diag() || {}).probe || {};
  console.log(`${got === next ? 'PASS' : 'FAIL'}  run 554: page 2 of 9 with 10 age-line rows -> the NEXT arrow is chosen (the pager was never the fault)`);
  console.log(`${got !== last && got !== first && got !== prev ? 'PASS' : 'FAIL'}  run 554: not the last-page arrow, not an arrow before the current page`);
  console.log(`${probe.rowLinksSkipped === 10 ? 'PASS' : 'FAIL'}  run 554: all 10 row title links (one of them "…to the next level") are skipped as rows -> ${probe.rowLinksSkipped}`);
  console.log(`${probe.currentPage === 2 && probe.totalPages === 9 ? 'PASS' : 'FAIL'}  run 554: position read as page 2 of 9`);
}

// ── sync_runs 666 / 662 (2026-11-06): the "page 1 only" runs ─────────────────
// 12 of 88 runs since run 520 read exactly 10 rows. Their stored probe: the
// section's only pager controls were "Current page 1 of 101" and "go to page2" --
// no separator between the accessible text and the visible digit -- so the total
// read as 101 and `go to page 2` (which demanded a space) never matched. The walk
// stopped at page 1: coverage 10/94.
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (94)' }));
  add(submitted, E('button', { cls: 'header-collapse-button air3-btn m-0 p-0' }));
  for (let i = 0; i < 10; i++) {
    const row = add(submitted, E('div'));
    add(row, E('div', { text: 'Initiated Nov 3, 2026\n4 days ago' }));
    add(row, E('a', { text: 'Google Ads job ' + i, attrs: { href: '/nx/proposals/20610000000000000' + String(i).padStart(2, '0'), 'aria-label': 'Google Ads job ' + i } }));
  }
  const pager = add(submitted, E('div'));
  add(pager, E('button', { text: 'Current page 1 of 101' }));   // "of 10" + the digit "1", glued
  const go2 = add(pager, E('button', { text: 'go to page2' }));  // and no space here either

  const { _findNextPageControl, _diag } = run(body);
  const got = _findNextPageControl();
  const probe = (_diag() || {}).probe || {};
  console.log(`${got === go2 ? 'PASS' : 'FAIL'}  run 666: "go to page2" (no space) is found -> the walk can leave page 1  -> got ${got ? JSON.stringify(got.innerText) : 'null'}`);
  console.log(`${probe.currentPage === 1 && probe.totalPages === 10 ? 'PASS' : 'FAIL'}  run 666: "Current page 1 of 101" is read as page 1 of 10 (was 101) -> ${probe.currentPage}/${probe.totalPages}`);
}
// The same glued text on the last page must still end the walk.
{
  ALL = [];
  const body = E('body');
  const submitted = add(body, E('section'));
  add(submitted, E('h2', { text: 'Submitted proposals  (94)' }));
  const row = add(submitted, E('div'));
  add(row, E('div', { text: 'Initiated Jun 3, 2026\n2 quarters ago' }));
  const pager = add(submitted, E('div'));
  add(pager, E('button', { text: 'go to page9' }));
  add(pager, E('button', { text: 'Current page 10 of 1010' }));
  add(pager, E('button', { cls: 'air3-btn air3-btn-circle air3-pagination' }));
  const { _findNextPageControl, _diag } = run(body);
  const got = _findNextPageControl();
  console.log(`${got === null ? 'PASS' : 'FAIL'}  glued "Current page 10 of 1010" is the LAST page of 10 -> stops (was: read as 1010 pages, kept clicking)  -> pages ${((_diag() || {}).probe || {}).currentPage}/${((_diag() || {}).probe || {}).totalPages}`);
}

_log(_fails ? `\n${_fails} FAILURES` : '\nall pass');
process.exit(_fails ? 1 : 0);
