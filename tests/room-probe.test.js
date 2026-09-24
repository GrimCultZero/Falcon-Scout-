// Room walk v5 — extension-side probe helpers, against a stub of a room page.
// The helpers are LIFTED OUT OF messages-list.js at runtime, so this cannot
// drift from what ships.
//
// The page shape that matters: a room page renders the room itself AND the
// conversation list in a sidebar, and that sidebar carries every OTHER
// conversation's name, title and sometimes a job link. The probe must collect
// evidence from the room's own panel only. Leaking the sidebar would attach
// another conversation's job to this room — a silent, wrong match.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'upwork-enricher', 'messages-list.js');
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  function _nameFrags(row)');
const end = src.indexOf('  // Visit-time probe.');
if (start === -1 || end === -1) {
  console.log('FAIL  could not locate the probe helpers in messages-list.js — renamed or moved?');
  process.exit(1);
}
const helperSrc = src.slice(start, end);

// ── minimal DOM stub ────────────────────────────────────────────────────────
function E(tag, opts = {}) {
  const el = {
    tag, children: [], parentElement: null,
    _text: opts.text || '', _attrs: opts.attrs || {},
    get innerText() { return this._text || this.children.map(c => c.innerText).filter(Boolean).join('\n'); },
    get outerHTML() {
      const attrs = Object.entries(this._attrs)
        .map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;')}"`).join('');
      return `<${this.tag}${attrs}>${this._text}${this.children.map(c => c.outerHTML).join('')}</${this.tag}>`;
    },
    getAttribute(k) { return this._attrs[k] ?? null; },
    querySelectorAll(sel) {
      const out = [];
      (function walk(n) { for (const c of n.children) { out.push(c); walk(c); } })(this);
      if (sel === 'a[href]') return out.filter(e => e.tag === 'a' && e._attrs.href != null);
      return out;
    },
  };
  return el;
}
const add = (p, c) => { c.parentElement = p; p.children.push(c); return c; };

let BODY = null;
function install(body) {
  BODY = body;
  const all = [];
  (function walk(n) { for (const c of n.children) { all.push(c); walk(c); } })(body);
  global.document = {
    body,
    querySelector(sel) {
      if (sel === '[contenteditable="true"]') return all.find(e => e._attrs.contenteditable === 'true') || null;
      return null;
    },
  };
}
const H = new Function(`${helperSrc}; return { _nameFrags, _roomMainPanel, _collectIds, _titleCandidates };`)();

// ── a room page: sidebar with other conversations + the open room ───────────
function roomPage({ headerOneLine = true, withCompose = true, proposalHref = null, sidebarJob = true } = {}) {
  const body = E('body');
  const sidebar = add(body, E('div'));
  for (const [name, sub] of [
    ['Goekhan Yilmaz, Networkhero GmbH', 'Google Ads PPC Specialist – Ongoing Account Management'],
    ['Byron Rennie', 'White Label SEO Agency To Manage Multiple Clients SEO'],
    ['Merine Arakelyan, LogistX', '8/27/26'],
  ]) {
    const row = add(sidebar, E('div'));
    add(row, E('a', { text: name, attrs: { href: '/ab/messages/rooms/room_x' } }));
    add(row, E('div', { text: sub }));
  }
  if (sidebarJob) add(sidebar, E('a', { text: 'View job post', attrs: { href: '/jobs/~022099999999999999999' } }));

  const main = add(body, E('div'));
  const header = add(main, E('div'));
  add(header, E('div', { text: 'Mykola Buchakchyiskyi, UNIHOST SOLUTIONS PROVIDER LTD' }));
  if (headerOneLine) {
    add(header, E('div', { text: '3:51 PM local time · PPC Specialist (Google Ads) – Part-Time, Ongoing' }));
  } else {
    add(header, E('div', { text: '3:51 PM local time' }));
    add(header, E('div', { text: 'PPC Specialist (Google Ads) – Part-Time, Ongoing' }));
  }
  const thread = add(main, E('div'));
  add(thread, E('div', { text: 'Artem Yatsuk' }));
  add(thread, E('div', { text: '+693.8% revenue and 17.51 ROAS scaling Korean medical aesthetic ecommerce (Skin Reboot, attached as PDF) — restricted YMYL niche where conversion tracking had to be surgical.' }));
  if (proposalHref) add(thread, E('a', { text: 'View proposal', attrs: { href: proposalHref } }));
  if (withCompose) add(main, E('div', { attrs: { contenteditable: 'true' } }));
  install(body);
  return { body, sidebar, main };
}

const SELF = { client_name: 'Mykola Buchakchyiskyi, UNIHOST SOLUTIONS PROVIDER LTD',
               job_title: 'PPC Specialist (Google Ads) – Part-Time, Ongoing' };
const OTHERS = [
  { client_name: 'Goekhan Yilmaz, Networkhero GmbH', job_title: 'Google Ads PPC Specialist – Ongoing Account Management' },
  { client_name: 'Byron Rennie', job_title: '9/16/26' },
  { client_name: 'Merine Arakelyan, LogistX', job_title: '8/27/26' },
  { client_name: 'BL', job_title: 'Balagan Llc' },
];
const selfNames = H._nameFrags(SELF);
// Same construction as probeRoom: one fragment list per other conversation.
const otherNames = OTHERS.map(r => H._nameFrags(r).filter(n => !selfNames.includes(n))).filter(f => f.length);

let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

// _nameFrags: the REGRESSION this test caught on its first run. When the list
// row's job_title holds the actual job title, it must not become an "identity"
// fragment — the first cut did exactly that, and then filtered the room's own
// title out of the candidates as "the client's name line".
{
  const f = H._nameFrags(SELF);
  check(JSON.stringify(f) === '["Mykola Buchakchyiskyi","UNIHOST SOLUTIONS PROVIDER LTD"]',
    `a real job title in job_title is NOT treated as a name (got ${JSON.stringify(f)})`);
  check(!f.includes('Ongoing'), 'a generic word from the title ("Ongoing") never becomes an identity fragment');
}
// _nameFrags: initials and dates are not usable identity
{
  const f = H._nameFrags({ client_name: 'BL', job_title: '9/16/26' });
  check(f.length === 0, `avatar initials and dates are dropped (got ${JSON.stringify(f)})`);
  const g = H._nameFrags({ client_name: 'DM', job_title: 'David Messum, David M' });
  check(g.includes('David Messum') && !g.includes('DM'), `the real name is taken from job_title when the scraper swapped them (got ${JSON.stringify(g)})`);
  check(!g.includes('David M'), 'the abbreviated "David M" stub is dropped');
}
// sidebar detection counts CONVERSATIONS, not name fragments
{
  const body = E('body');
  const main = add(body, E('div'));
  add(main, E('div', { text: 'Sofia Toro, Speedrack West' }));   // ONE other conversation, two fragments
  add(main, E('div', { attrs: { contenteditable: 'true' } }));
  install(body);
  const oneConvo = [['Sofia Toro', 'Speedrack West']];
  check(H._roomMainPanel(oneConvo) === main,
    'two name fragments of ONE other conversation count once — the walk-up is not cut short');
}

// 1. the panel is the room, not the page
{
  const { body, main } = roomPage();
  const panel = H._roomMainPanel(otherNames);
  check(panel === main, 'panel = the room\'s own column, not <body> (the sidebar is excluded)');
  check(panel !== body, 'the walk-up stops before swallowing the sidebar');
}

// 2. titles come from THIS room's header only
{
  roomPage({ headerOneLine: true });
  const t = H._titleCandidates(H._roomMainPanel(otherNames), selfNames);
  check(t.includes('PPC Specialist (Google Ads) – Part-Time, Ongoing'),
    'a header rendered as "3:51 PM local time · <title>" yields the bare title');
  check(!t.some(x => /White Label SEO Agency/.test(x)), 'Byron\'s title from the SIDEBAR is not offered as this room\'s title');
  check(!t.some(x => /Ongoing Account Management/.test(x)), 'Goekhan\'s title from the SIDEBAR is not offered either');
  check(!t.some(x => /^Mykola/.test(x)), 'the client\'s own name line is not offered as a title');
  check(!t.some(x => /local time/.test(x)), 'the local-time line is not offered as a title');
}
{
  roomPage({ headerOneLine: false });
  const t = H._titleCandidates(H._roomMainPanel(otherNames), selfNames);
  check(t.includes('PPC Specialist (Google Ads) – Part-Time, Ongoing'), 'a header with the title on its own line also yields it');
}

// 3. ids come from the panel only
{
  roomPage({ sidebarJob: true, proposalHref: null });
  const ids = H._collectIds(H._roomMainPanel(otherNames));
  check(ids.job_ids.length === 0, `the sidebar's "View job post" link is NOT attributed to this room (got ${JSON.stringify(ids.job_ids)})`);
}
{
  roomPage({ proposalHref: '/ab/messages/rooms/room_abc?modal=proposal&proposalId=2093318450858024961' });
  const ids = H._collectIds(H._roomMainPanel(otherNames));
  check(JSON.stringify(ids.proposal_ids) === '["2093318450858024961"]',
    `proposal id read from the "View proposal" workroom-modal query string (got ${JSON.stringify(ids.proposal_ids)})`);
}
{
  roomPage({ proposalHref: '/nx/proposals/2093318450858024961' });
  const ids = H._collectIds(H._roomMainPanel(otherNames));
  check(ids.proposal_ids[0] === '2093318450858024961', 'proposal id read from a direct /nx/proposals/<id> link');
  check(ids.kinds.proposals >= 1 && ids.kinds.anchors >= 1, 'link kinds are counted for the diagnostic record');
}

// 4. not rendered yet
{
  roomPage({ withCompose: false });
  check(H._roomMainPanel(otherNames) === null, 'no compose editor yet -> no panel (the probe keeps waiting instead of guessing)');
}

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
