// Inbox sync (upwork-enricher/messages-list.js), 2026-09-30.
//
// Owner: "we got a response yesterday (sofia) - I dont see it in outcomes. And
// what is is this one from June doing on the top of the list?"
//
// Both morning syncs scraped the WRONG part of the inbox: waitForListContent
// scrolled the virtualised conversation list to the bottom, then the scrape read
// only the rows still rendered there — 20 conversations from Jul 2026 back to
// 2025. Sofia Toro's thread (the newest) wasn't among them; an old Galactic Fed
// thread was, got matched to its 'invited' proposal and promoted to 'replied'
// with that morning's timestamp, so a July reply topped Outcomes.
//
// Now the list is scraped top-down at every scroll step (collectConversationRows)
// and each row carries last_activity_at (_listWhen) so the backend dates a
// late-found reply by the conversation, not by the sync.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'upwork-enricher', 'messages-list.js');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

// ── _listWhen, lifted from the shipped file ─────────────────────────────────
const from = src.indexOf('  const _WEEKDAYS');
const to = src.indexOf('\n  }\n', src.indexOf('function _listWhen')) + 4;
const { _listWhen } = new Function(`${src.slice(from, to)}; return { _listWhen }`)();
// "now" = Wed 30 Sep 2026, 13:45 local
const now = new Date(2026, 8, 30, 13, 45, 0);
const local = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
assert(local(_listWhen(['ST', 'Sofia Toro, Speedrack West', '7:57 PM', 'You: thank you'], new Date(2026, 8, 29, 20, 12))) === '2026-9-29 19:57', 'a time is today at that time ("7:57 PM" on the 29th)');
assert(local(_listWhen(['ST', 'Sofia Toro, Speedrack West', 'Yesterday', 'You: thank you'], now)) === '2026-9-29 12:00', '"Yesterday" is yesterday at local noon');
assert(local(_listWhen(['HO', 'Hajar Oumhand', 'Thursday', 'Hajar: Thanks'], now)) === '2026-9-24 12:00', 'a weekday is the most recent past one ("Thursday" from a Wednesday = the 24th)');
assert(local(_listWhen(['X', 'Name', 'Wednesday', 'hi'], now)) === '2026-9-23 12:00', 'today\'s weekday name means last week, never today');
assert(local(_listWhen(['BL', 'Balagan Llc', '9/22/26', 'approved'], now)) === '2026-9-22 12:00', 'M/D/YY');
assert(local(_listWhen(['Yuriy Braterskyy', '12/24/25', 'Shopify SEO'], now)) === '2025-12-24 12:00', 'a date on the second line (no avatar initials)');
assert(_listWhen(['TH', 'Thomas Haugen', 'SEO Account Manager June', 'Hi Artem'], now) === null, 'no date line: null (the backend falls back to the sync time)');

// ── the scrape starts at the top and scrapes as it scrolls ──────────────────
const wait = src.slice(src.indexOf('async function waitForListContent'), src.indexOf('async function collectConversationRows'));
assert(!/scrollTop|scrollTo\(/.test(wait), 'waitForListContent no longer scrolls (it only waits for the list)');
const collect = src.slice(src.indexOf('async function collectConversationRows'), src.indexOf('const _WEEKDAYS'));
assert(/if \(sidebar\) for \(const el of \[sidebar, \.\.\._scrollablesUp\(sidebar\)\]\) el\.scrollTop = 0;/.test(collect) && collect.indexOf('el.scrollTop = 0') < collect.indexOf('add();'), 'collectConversationRows scrolls the list and every layer above it to the top before the first scrape');
// 5.4: the list is the scroller shared by the most ROOM links (5.3's list_diag: the
// first /messages/rooms/ link is the nav's "Messages" item, with no scroller)
const finder = src.slice(src.indexOf('function findSidebarContainer'), src.indexOf('// Every scrollable ancestor of a node'));
assert(/_ROOM_HREF_RE\.test\(a\.getAttribute\('href'\) \|\| ''\)/.test(finder) && /counts\.set\(sc, \(counts\.get\(sc\) \|\| 0\) \+ 1\)/.test(finder) && /if \(c > n\)/.test(finder), 'findSidebarContainer picks the scroller shared by the most room links, not the first link\'s');
// 5.4: a hidden window renders no room — don't walk, and stop a walk that finds out
assert(/if \(queue\.length && document\.visibilityState === 'hidden'\) \{[\s\S]*?walk_skipped: 'hidden'/.test(src), 'no walk in a hidden window (rooms stay queued, walk_skipped: "hidden")');
assert(/if \(!q\.results\[cur\.room_id\]\.rendered && document\.visibilityState === 'hidden'\) \{\s*q\.stopped_hidden = true;\s*await finishWalk\(q\);/.test(src), 'a walk that hits an unrendered room in a hidden window stops there');
assert(/_nextPreviews\(previews, rows, new Set\(changed\.map\(r => r\.room_id\)\)\)/.test(src), '…and the moved rooms keep their old baselines, so they are read later');
// 5.4: the passive read — the conversation Artem opens is visible, so read it then
const passive = src.slice(src.indexOf('async function passiveReadCurrentRoom'), src.indexOf('function startPassiveReader'));
assert(/document\.visibilityState !== 'visible'\) return;/.test(passive), 'passive read: only a visible page');
assert(/st\.busy \|\| st\.tries >= 2 \|\| Date\.now\(\) - st\.at < _PASSIVE_REREAD_MS/.test(passive), '…once per room, again after 2 minutes while it stays open, and a room that will not render is tried twice then left');
assert(/if \(!location\.pathname\.includes\(room_id\)\) return;/.test(passive), '…never saved against a room Artem has already left');
assert(/recent_messages: res\.messages,/.test(passive) && /postDirect\(\[row\], \{ passive: true,/.test(passive), '…and posts the room\'s messages, flagged passive');
assert(!/\.click\(\)|dispatchEvent|\.value\s*=|execCommand/.test(passive), '…read-only: nothing on the page is clicked, typed or changed');
assert(/if \(!requested\) \{ startPassiveReader\(\); return; \}/.test(src), 'it runs whenever the page is not a sync run (never inside the sync or its walk)');
const main = fs.readFileSync(path.join(__dirname, '..', 'api', 'main.py'), 'utf8');
assert(/_dbg_name = "messages_passive_debug\.json" if _wi\.get\("passive"\) else "messages_sync_debug\.json"/.test(main), 'backend: a passive read gets its own debug file, never overwriting the last full sync');
assert(/^messages_passive_debug\.json\r?$/m.test(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8')), '…and that file (client message text) is gitignored');
assert(/for \(let step = 1; step <= 4; step\+\+\) \{[\s\S]*?add\(\);[\s\S]*?\}/.test(collect), '…and scrapes again at every scroll step, keeping first-seen (newest-first) order');
const syncFlow = src.slice(src.indexOf("if (!requested) { startPassiveReader(); return; }"));
assert(/const rows = await collectConversationRows\(\);/.test(syncFlow) && !/scrapeConversationList\(\)/.test(syncFlow), 'the sync uses it (the passive reader reads the rows as they are, which is fine)');
assert(/last_activity_at: _listWhen\(lines\),/.test(src), 'every row carries last_activity_at');
assert(/if \(\/\^\(monday\|tuesday\|wednesday\|thursday\|friday\|saturday\|sunday\)\$\/i\.test\(ln\)\) continue;/.test(src), 'weekday lines are no longer read as a job title');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'manifest.json'), 'utf8'));
assert(manifest.version === '5.4', `extension version 5.4 (the debug file's walk_info shows which one ran) — ${manifest.version}`);

// ── 5.3: reading the messages of a room that moved ──────────────────────────
// Sofia Toro's room, as its panel reads (from the owner's screenshot, 30 Sep):
// the proposal, her three questions, the decline, Artem's thank-you — in both
// shapes innerText can give a header ("Name  7:56 PM" on one line, or two).
const rStart = src.indexOf('  const _MSG_TIME_RE');
const rEnd = src.indexOf('\n  }\n', src.indexOf('function _roomMessages')) + 4;
const { _roomMessages } = new Function(`${src.slice(rStart, rEnd)}; return { _roomMessages }`)();
const sofia = (oneLine) => [
  'Sofia Toro, Speedrack West', '6:11 AM local time', 'Google Ads, GA4, GTM, HubSpot & CallRail Attribution Audit',
  ...(oneLine ? ['Artem Yatsuk 8:03 PM'] : ['Artem Yatsuk', '8:03 PM']),
  'Here are some relevant results:', 'Nectar Flowers (attached in profile highlights): ecommerce florist.', 'Artem', 'View proposal', '2 files', 'Google%20Ads%20Audit%20Example.pdf', '2 MB',
  'ST', ...(oneLine ? ['Sofia Toro 6:09 AM'] : ['Sofia Toro', '6:09 AM']),
  'Hi! Thank you for your proposal. Before selecting the finalists, could you please answer these three brief questions?',
  'Tuesday, Sep 29',
  'ST', ...(oneLine ? ['Sofia Toro 7:56 PM'] : ['Sofia Toro', '7:56 PM']),
  'Hi Artem', "We've selected another candidate for this project, but we sincerely appreciate the time and effort you put into your application.", 'Best regards,',
  ...(oneLine ? ['Artem Yatsuk 7:57 PM'] : ['Artem Yatsuk', '7:57 PM']),
  'thank you for letting me know, Sofia, all the best!',
  'Send a message...',
].join('\n');
for (const oneLine of [true, false]) {
  const msgs = _roomMessages(sofia(oneLine));
  const shape = oneLine ? 'one-line headers' : 'two-line headers';
  assert(msgs.map(m => m.from).join(',') === 'artem,client,client,artem', `${shape}: four messages, attributed artem / client / client / artem (${msgs.map(m => m.from).join(',')})`);
  const decline = msgs.filter(m => m.from === 'client').pop();
  assert(decline && /We've selected another candidate/.test(decline.text) && decline.text.startsWith('Hi Artem') && !/Tuesday|ST$/.test(decline.text), `${shape}: the client's last message is the decline, without the date divider or avatar initials`);
  assert(!/View proposal|2 files|\.pdf|2 MB/.test(msgs[0].text), `${shape}: file cards and "View proposal" are dropped`);
  assert(!msgs.some(m => /Send a message|local time/.test(m.text)), `${shape}: the compose placeholder and the header clock are dropped`);
}

// which rooms are opened again, and which baselines move
const cStart = src.indexOf('  function _previewSig(r)');
const cEnd = src.indexOf('\n  }\n', src.indexOf('function _nextPreviews')) + 4;
const { _rereadCandidates, _nextPreviews, _previewSig } = new Function(`const REREAD_BACKFILL_MS = 7 * 24 * 3600 * 1000;\n${src.slice(cStart, cEnd)}; return { _rereadCandidates, _nextPreviews, _previewSig }`)();
const nowMs = Date.parse('2026-09-30T11:00:00Z');
const row = (id, o) => ({ room_id: id, last_message: 'p', last_activity_at: '2026-09-29T16:57:00.000Z', has_unread: false, ...o });
const rows = [
  row('sofia', { last_message: 'thank you for letting me know, Sofia' }),                       // moved since the baseline
  row('same'),                                                                                     // baseline identical
  row('unread', { has_unread: true, last_message: 'new!' }),                                       // never opened by the sync
  row('fresh'),                                                                                    // linked, no baseline, recent
  row('old', { last_activity_at: '2026-07-13T09:00:00.000Z' }),                                    // linked, no baseline, old
  row('unlinked', { last_message: 'x' }),                                                          // first visit handles it
];
const previews = { sofia: { sig: 'Hi Artem|2026-09-29T16:56:00.000Z' }, same: { sig: _previewSig(row('same')) }, unread: { sig: 'old|x' } };
const observed = (id) => id !== 'unlinked';
const picked = _rereadCandidates(rows, previews, observed, nowMs).map(r => r.room_id);
assert(picked.join(',') === 'sofia,fresh', `re-read: the moved room and a recent one with no baseline — not unread, unchanged, old or unlinked ones (${picked.join(',')})`);
const next = _nextPreviews(previews, rows, new Set(['fresh']), nowMs);
assert(next.unread.sig === 'old|x' && !next.fresh && next.sofia.sig === _previewSig(rows[0]), 'baselines: an unread room and one still pending keep theirs; a read one moves');
assert(/\.\.\.reread\.map\(c => \(\{ room_id: c\.room_id, room_url: c\.room_url, reread: true \}\)\),\n\s+\.\.\.firstVisits/.test(src), 'moved rooms are walked first, then first visits');
assert(/const reread = changed\.slice\(0, REREAD_CAP\);/.test(src) && /WALK_CAP - reread\.length/.test(src), 'both within the per-sync page-load cap');
assert(/recent_messages: fresh\.messages/.test(src) && /list_diag: q\.list_diag/.test(src) && /list_diag: LIST_DIAG/.test(src), 'rows carry recent_messages; walk_info carries the list diagnostic on both paths');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
