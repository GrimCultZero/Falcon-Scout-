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
assert(/sidebar\.scrollTop = 0; await/.test(collect) && collect.indexOf('sidebar.scrollTop = 0') < collect.indexOf('add();'), 'collectConversationRows scrolls to the TOP before the first scrape');
assert(/for \(let step = 1; step <= 4; step\+\+\) \{[\s\S]*?add\(\);[\s\S]*?\}/.test(collect), '…and scrapes again at every scroll step, keeping first-seen (newest-first) order');
assert(/const rows = await collectConversationRows\(\);/.test(src) && !/const rows = scrapeConversationList\(\);/.test(src), 'the sync uses it');
assert(/last_activity_at: _listWhen\(lines\),/.test(src), 'every row carries last_activity_at');
assert(/if \(\/\^\(monday\|tuesday\|wednesday\|thursday\|friday\|saturday\|sunday\)\$\/i\.test\(ln\)\) continue;/.test(src), 'weekday lines are no longer read as a job title');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'manifest.json'), 'utf8'));
assert(manifest.version === '5.2', `extension version bumped to 5.2 (the debug file's walk_info shows which one ran) — ${manifest.version}`);

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
