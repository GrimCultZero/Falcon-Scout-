// "Filtered out (24h)" view and the GBP / tracking badges (audit 2026-10-29, T18).
//
// Pure wording / badge rules (lib/feedDrops.js) plus checks that the pieces are wired:
// the view lives in Feed Settings, the badge in the job list (NOT in JobDetail, which
// holds the generator), the dev proxy forwards /feed-drops.
//
// Run: node tests/feed-drops-ui.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

(async () => {
  const lib = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'feedDrops.js')).href);
  const { describeReason, reasonKind, feedTagBadge, feedTagBadges } = lib;

  // ── reasons in plain language ─────────────────────────────────────────────
  assert(describeReason('no-keyword-in-text') === 'No feed keyword in the title or description', 'no-keyword-in-text');
  assert(describeReason('stopword:meta ads') === 'Stop word in the title: "meta ads"', 'stopword:<word>');
  assert(describeReason('hourly<25') === 'Hourly rate under $25' && describeReason('fixed<100') === 'Fixed price under $100', 'rate floors');
  assert(describeReason('unverified-payment') === 'Payment not verified', 'payment');
  assert(describeReason('posted>72h') === 'Posted more than 72 h ago', 'age');
  assert(describeReason('country:india') === 'Excluded country: india', 'country');
  assert(describeReason('something-new') === 'something-new' && describeReason('') === 'Unknown reason' && describeReason(null) === 'Unknown reason', 'an unknown reason is shown as it is, never hidden');

  // ── which groups are where a miss would be ────────────────────────────────
  for (const r of ['no-keyword-in-text', 'stopword:facebook']) assert(reasonKind(r) === 'text', `${r} is a "text" group (an in-lane miss would show here)`);
  for (const r of ['hourly<25', 'fixed<100', 'unverified-payment', 'posted>72h', 'country:india']) assert(reasonKind(r) === 'policy', `${r} is a "policy" group (the owner's floors)`);
  assert(reasonKind('something-new') === 'text', 'an unknown reason counts as "text": show it first rather than bury it');

  // ── badges (owner decision: GBP and tracking-only are shown, labelled) ─────
  const t = feedTagBadge('tracking'), g = feedTagBadge('gbp');
  assert(t && t.label === 'TRACKING ONLY' && /Google Ads or SEO/.test(t.title), "'tracking' -> a TRACKING ONLY badge that says what it means");
  assert(g && g.label === 'GBP' && /reputation management/.test(g.title), "'gbp' -> a GBP badge that flags the reputation-management half");
  assert(t.color !== g.color && t.bg !== g.bg, 'the two badges look different');
  assert(feedTagBadge(null) === null && feedTagBadge(undefined) === null && feedTagBadge('') === null && feedTagBadge('other') === null, 'no tag (or an unknown one) -> no badge, nothing hidden');

  // ── test week (2026-11-10 .. 2026-11-17): purple TEST badges, several tags per row ──
  for (const [tag, label] of [['test:unverified', 'TEST: UNVERIFIED'], ['test:low-hourly', 'TEST: LOW HOURLY'], ['test:low-fixed', 'TEST: LOW FIXED']]) {
    const b = feedTagBadge(tag);
    assert(b && b.label === label && /Test week/.test(b.title) && /Normally dropped|payment is not verified/.test(b.title), `${tag} -> a "${label}" badge that says what it is`);
  }
  assert(feedTagBadge('test:unverified').color === feedTagBadge('test:low-fixed').color && feedTagBadge('test:low-fixed').color !== feedTagBadge('gbp').color, 'the test badges share a colour that is not the GBP or TRACKING one');
  assert(/scams|no-hire/.test(feedTagBadge('test:unverified').title), 'the unverified badge warns about scams and no-hire posts');
  const many = feedTagBadges('gbp,test:low-fixed');
  assert(many.length === 2 && many[0].tag === 'gbp' && many[1].tag === 'test:low-fixed', 'a row with "gbp,test:low-fixed" gets both badges');
  assert(feedTagBadges('test:unverified,test:low-hourly').length === 2, 'two test tags -> two badges');
  assert(feedTagBadges(null).length === 0 && feedTagBadges('').length === 0 && feedTagBadges('nonsense,').length === 0, 'no tag / unknown tag -> no badge');
  assert(describeReason('testweek:webdev') === 'Test week: pure web development / design job hidden' && reasonKind('testweek:webdev') === 'text', "'testweek:webdev' drops are labelled and shown with the word-rule groups (so they get audited)");

  // ── wiring ────────────────────────────────────────────────────────────────
  const settings = read('frontend', 'src', 'components', 'FeedSettings.jsx');
  const drops = read('frontend', 'src', 'components', 'FeedDrops.jsx');
  const list = read('frontend', 'src', 'components', 'JobList.jsx');
  const detail = read('frontend', 'src', 'components', 'JobDetail.jsx');
  const vite = read('frontend', 'vite.config.js');
  assert(/import FeedDrops from '\.\/FeedDrops'/.test(settings) && /<FeedDrops \/>/.test(settings), 'Feed Settings shows the Filtered out view');
  assert(/fetch\('\/feed-drops\?hours=24'\)/.test(drops) && /Filtered out \(last 24 h\)/.test(drops), 'the view reads the last 24 h from /feed-drops');
  assert(/href=\{r\.url\}/.test(drops) && /target="_blank"/.test(drops), 'each title links to Upwork');
  assert(/reasonKind\(g\.reason\)/.test(drops) && /describeReason\(g\.reason\)/.test(drops), 'groups use the plain-language labels and the text/policy split');
  assert(/import \{ feedTagBadges \} from '\.\.\/lib\/feedDrops'/.test(list) && /feedTagBadges\(job\.feed_tag\)/.test(list) && /data-testid="feed-tag"/.test(list), 'the job list draws a badge for every tag in job.feed_tag');
  assert(!/feed_tag|feedTagBadge/.test(detail), 'JobDetail.jsx (the generator) is not touched');
  assert(/'\/feed-drops': 'http:\/\/localhost:8000'/.test(vite), 'the dev proxy forwards /feed-drops');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
