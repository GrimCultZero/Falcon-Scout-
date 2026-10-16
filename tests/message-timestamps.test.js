// A reply is the client's FIRST message, dated by when THEY sent it.
//
// Owner, 2026-10-16: "we count a reply ONLY the 1st message from a NEW client.
// If someone replied to my cover letter a week ago and the conversation
// continues this week, this shouldn't count as a new reply. Also, we only count
// new replies received this current week, there can't be anything from May,
// unless they replied this week."
//
// That needs a real timestamp per message, and the parser was throwing two away:
// `_MSG_UI_LINE_RE` dropped Upwork's day dividers ("Wednesday, Oct 14") as UI
// noise, and the group header's "7:56 PM" was matched only to find where the
// name ended. Together they date every message. Without them the best the
// backend could do was "when the sync noticed", which put proposal 318's Oct 11
// reply into week 42 and a May conversation into the current week.
//
// Run: node tests/message-timestamps.test.js
const fs = require('path') && require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'messages-list.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const a = src.indexOf('  const _MSG_TIME_RE');
const b = src.indexOf('\n  }\n', src.indexOf('  function _roomMessages(text)')) + 4;
if (a < 0 || b < 4) { console.log('FAIL  could not lift the message parser'); process.exit(1); }
const { _roomMessages, _msgStamp } =
  new Function(src.slice(a, b) + '; return { _roomMessages, _msgStamp };')();

const YEAR = new Date().getFullYear();

// ── the stamp itself ────────────────────────────────────────────────────────
assert(_msgStamp('Wednesday, Oct 14', '7:56 PM') === `${YEAR}-10-14T19:56:00`,
  'day divider + 12-hour time -> a real timestamp');
assert(_msgStamp('Monday, October 6, 2025', '9:05 AM') === '2025-10-06T09:05:00',
  'an explicit year is honoured');
assert(_msgStamp('Wednesday, Oct 14', '12:30 AM') === `${YEAR}-10-14T00:30:00`,
  'midnight is 00:xx, not 12:xx');
assert(_msgStamp('Wednesday, Oct 14', '12:30 PM') === `${YEAR}-10-14T12:30:00`,
  'noon stays 12:xx');
assert(_msgStamp(null, '7:56 PM') === null, 'a time with no date is not a timestamp');
assert(_msgStamp('Wednesday, Smarch 14', '7:56 PM') === null, 'an unparseable month is not guessed');

// Upwork omits the year on recent dates. Read in January, "Dec 28" is LAST year
// — dating it this year would put a reply in the future.
{
  const next = new Date(Date.now() + 40 * 24 * 3600 * 1000);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][next.getMonth()];
  const got = _msgStamp(`Monday, ${mon} ${next.getDate()}`, '9:00 AM');
  assert(got && new Date(got).getTime() <= Date.now(),
    'an undated divider that would land in the future rolls back a year');
}

// ── a whole thread ──────────────────────────────────────────────────────────
const thread = [
  'Sinking Birdies',
  'Monday, Oct 12',
  'Artem Yatsuk  2:14 PM',
  'Hi — I have attached the audit.',
  'Saturday, Oct 11',
  'Sinking Birdies  9:02 AM',
  'Thanks, looking now.',
  'Wednesday, Oct 14',
  'Sinking Birdies  12:02 PM',
  'Yes, I have had a look through it.',
].join('\n');

const msgs = _roomMessages(thread);
assert(msgs.length === 3, `three message groups parsed -> got ${msgs.length}`);
assert(msgs.every(m => m.at), 'every group carries a timestamp');

const clientAts = msgs.filter(m => m.from === 'client').map(m => m.at).sort();
assert(clientAts.length === 2, 'two of them are the client');
assert(clientAts[0] === `${YEAR}-10-11T09:02:00`,
  `the FIRST client message is the Oct 11 one -> got ${clientAts[0]}`);
assert(msgs.find(m => m.from === 'artem').at === `${YEAR}-10-12T14:14:00`,
  "Artem's own message is dated too, but it is not a reply");

// The continuation must not become the reply date. This is the whole point:
// proposal 318 replied on Oct 11 (week 41) and its Oct 14 follow-up had been
// re-dating it into week 42.
assert(clientAts[clientAts.length - 1] === `${YEAR}-10-14T12:02:00`
       && clientAts[0] < clientAts[clientAts.length - 1],
  'the later message is kept separate, so it cannot be mistaken for the first');

// ── dividers must not be swallowed as message text ──────────────────────────
assert(!msgs.some(m => /Monday, Oct 12|Wednesday, Oct 14/.test(m.text)),
  'day dividers stay out of the message bodies');

// ── relative dividers ───────────────────────────────────────────────────────
{
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const t = _roomMessages(['Acme', 'Today', 'Acme Corp  8:00 AM', 'Any update?'].join('\n'));
  assert(t.length === 1 && t[0].at ===
      `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}T08:00:00`,
    '"Today" resolves to today');
  const y = _roomMessages(['Acme', 'Yesterday', 'Acme Corp  8:00 AM', 'Any update?'].join('\n'));
  assert(y.length === 1 && y[0].at && y[0].at < t[0].at, '"Yesterday" resolves earlier than today');
}

// ── a thread with no dividers still parses, just undated ────────────────────
{
  const u = _roomMessages(['Acme', 'Acme Corp  8:00 AM', 'Any update?'].join('\n'));
  assert(u.length === 1 && u[0].text === 'Any update?' && !('at' in u[0]),
    'no divider -> the message still parses, with no invented date');
}

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
