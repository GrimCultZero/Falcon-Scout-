// Two paginated lists on one page — does the pager resolve inside "Submitted proposals"?
// Functions are lifted from proposal.js so the test can't drift from shipped code.
const fs = require('fs');
const src = fs.readFileSync(String.raw`C:\Users\syzov\upwork-cockpit\upwork-enricher\proposal.js`, 'utf8')
  .replace(/\r\n/g, '\n');
const a = src.indexOf('function _submittedSectionRoot()');
const b = src.indexOf('\n  }\n', src.indexOf('function _findNextPageControl()')) + 4;
const fnSrc = src.slice(a, b);

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
  const f = new Function('let _lastPagerDiag = null;' + fnSrc + '; return { _findNextPageControl, _submittedSectionRoot };')();
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
