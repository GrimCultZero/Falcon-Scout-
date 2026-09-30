// A panel the job-page reader could not see is UNKNOWN, not "no".
//
// 30 Sep 2026, job 16845 (Meta & Google Ads Strategist, client with $3.2K spent):
// the API feed captured it at 09:55; the auto-enrich sweep read the page in a
// background tab two minutes later, Upwork had not rendered the client panel,
// and content.js wrote payment_verified = false — its default whenever the
// words "Payment verified" were not on the page. The backend keeps a value only
// when a reading is null, so that false overwrote the feed's status. The
// analysis then warned of "high non-payment risk" on a verified client. Across
// the database, 41 of the 42 jobs stored as unverified had no "Member since"
// either (every client panel has one); the 42nd was a real one ($0 spent).
//
// Run: node tests/client-panel-unknown.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'content.js'), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('  function getJobId()');
const to = src.indexOf('\n    return data;\n  }\n', src.indexOf('  function extractData()')) + '\n    return data;\n  }\n'.length;
function read(pageText) {
  const document = {
    title: 'Meta & Google Ads Strategist | Upwork',
    body: { innerText: pageText },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const window = { location: { href: 'https://www.upwork.com/jobs/~022105234066801763360' } };
  const quiet = { log() {}, warn() {}, error() {} };
  return new Function('document', 'window', 'console', `${src.slice(from, to)}; return extractData();`)(document, window, quiet);
}

const activity = ['Activity on this job', 'Proposals:', '50+', 'Last viewed by client:', '56 minutes ago',
  'Interviewing:', '0', 'Invites sent:', '0', 'Unanswered invites:', '0'].join('\n');
const clientPanel = (verifiedLines) => ['About the client', ...verifiedLines, '5.00 of 1 reviews', 'United Kingdom',
  '4 jobs posted', '50% hire rate, 1 open job', '$3.2K total spent', '2 hires, 1 active', 'Member since Mar 17, 2026'].join('\n');
const job = 'Meta & Google Ads Strategist\nWe need a freelancer or agency to own Meta Ads and Google Ads.';

let d = read([job, activity, clientPanel(['Payment method verified', 'Phone number verified'])].join('\n'));
assert(d.payment_verified === true && d.phone_verified === true, 'full page, verified client: payment and phone verified');
assert(d.proposals === '50+' && d.interviewing === 0 && d.invites_sent === 0 && d.client_already_hired === 0,
  '…activity read; "Already hired" absent from a rendered panel is a real 0');

d = read([job, activity].join('\n'));
assert(d.payment_verified === null && d.phone_verified === null,
  'client panel never rendered (the 16845 case): payment and phone UNKNOWN (null), so the backend keeps the feed\'s value');

d = read(job);
assert(d.interviewing === null && d.invites_sent === null && d.unanswered_invites === null && d.client_already_hired === null && d.proposals === null,
  'activity panel never rendered: interviewing / invites / already hired unknown, not a default 0');

d = read([job, activity, clientPanel(['Payment method not verified'])].join('\n'));
assert(d.payment_verified === false, 'Upwork says "Payment method not verified": not verified');
assert(d.phone_verified === false, '…and a rendered client panel with no phone line: phone not verified');

d = read([job, activity, clientPanel([])].join('\n'));
assert(d.payment_verified === false, 'rendered client panel with no "verified" line at all: not verified (its absence means something there)');

d = read([job, 'Payment method not verified'].join('\n'));
assert(d.payment_verified === false, 'Upwork\'s own "not verified" wording counts even without the rest of the panel');

// the backend side: null never overwrites, and the sweep retries a job whose panel is missing
const main = fs.readFileSync(path.join(__dirname, '..', 'api', 'main.py'), 'utf8');
assert(/if field in data and data\[field\] is not None:\s*\n\s*setattr\(job, field, data\[field\]\)/.test(main),
  'backend /enrich: a null reading never overwrites a stored value');
assert(/or_\(Job\.enriched_at\.is_\(None\), Job\.client_member_since\.is_\(None\)\)/.test(main),
  'auto-enrich sweep: a job read without its client panel is read again (within the attempt cap and cooldown)');
assert(/def _payment_word\(v\)/.test(main) && !/'verified' if job\.get\('payment_verified'\) else 'NOT verified'/.test(main)
  && !/'verified' if j\.payment_verified else 'NOT verified'/.test(main),
  'backend prompts: unknown payment is written as unknown, not "NOT verified"');

const jd = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');
assert(/payment \$\{job\.payment_verified \? 'verified' : job\.payment_verified === false \? 'NOT verified' : 'status unknown \(client panel not read\)'\}/.test(jd),
  'analyser prompt (letter page): unknown payment is written as unknown');
assert(/\(job\.payment_verified === false && \(Number\(job\.client_review_count\) \|\| 0\) < 5\)/.test(jd),
  'PPC-audit override: only a real "not verified" is a disqualifier, not an unread panel');
const popup = fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'popup.js'), 'utf8');
assert(/d\.payment_verified === false \? '✗ Not verified' : null/.test(popup), 'extension popup: unknown payment is not shown as "Not verified"');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
