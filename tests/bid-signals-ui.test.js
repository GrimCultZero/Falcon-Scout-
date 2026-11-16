// Bid selection signals in the UI (audit 2026-10-29, T12) and the live preview note (T13). RECORD-ONLY:
// the app shows the data and the owner decides. Run: node tests/bid-signals-ui.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const lib = (f) => pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', f)).href;

(async () => {
  const B = await import(lib('bidSignals.js'));
  const { applicantsBand, agoText, applicantsChip, shouldDim, ladderView, previewCheck, parseTs } = B;
  const NOW = Date.parse('2026-11-16T12:00:00Z');

  // ── applicants band + when it was read ────────────────────────────────────
  assert(['Less than 5', '5 to 10', '10 to 15', '15 to 20', '20 to 50', '50+', '8', '75', null, ''].map(applicantsBand).join('|') === '<5|5-10|10-15|15-20|20-50|50+|5-10|50+||', 'applicants text -> band (same bands as the server)');
  assert(parseTs('2026-11-16 09:00:00') === Date.parse('2026-11-16T09:00:00Z') && parseTs('2026-11-16T09:00:00') === Date.parse('2026-11-16T09:00:00Z') && parseTs('2026-11-16T09:00:00+02:00') === Date.parse('2026-11-16T07:00:00Z'), 'a bare DB timestamp is read as UTC (no 2-hour drift)');
  assert(agoText('2026-11-16T11:30:00', NOW) === '30 min ago' && agoText('2026-11-16T09:00:00', NOW) === '3 h ago' && agoText('2026-11-13T12:00:00', NOW) === '3 d ago' && agoText(null, NOW) === '', 'age wording');
  const chip = applicantsChip({ proposals: '20 to 50', enriched_at: '2026-11-16T09:00:00' }, NOW);
  assert(chip && chip.band === '20-50' && chip.label === '20–50 applicants' && chip.read === 'read 3 h ago' && /refreshed when you press Apply/.test(chip.title), 'ACCEPTANCE: the card chip shows the band AND when it was read');
  assert(applicantsChip({ proposals: '50+', enriched_at: null, captured_at: '2026-11-16T11:00:00' }, NOW).read === 'read 1 h ago', 'an API job that was never enriched shows its capture time as the read time');
  assert(applicantsChip({ proposals: '50+' }, NOW).read === 'read time unknown' && applicantsChip({}, NOW) === null, 'unknown read time is said, never invented; no count -> no chip');
  assert(applicantsChip({ proposals: '50+', enriched_at: '2026-11-16T11:00:00' }, NOW).hot === true && applicantsChip({ proposals: '5 to 10', enriched_at: '2026-11-16T11:00:00' }, NOW).hot === false, 'only 50+ is flagged hot');

  // ── the optional dim: off by default, display only ─────────────────────────
  const j50 = { proposals: '50+' }, j10 = { proposals: '5 to 10' };
  assert(!shouldDim(j50, {}) && !shouldDim(j50, { dim_applicants_50plus: false }) && !shouldDim(j50, null), 'OFF by default: nothing is dimmed');
  assert(shouldDim(j50, { dim_applicants_50plus: true }) && !shouldDim(j10, { dim_applicants_50plus: true }), 'when on, only 50+ cards are dimmed');
  const list = read('frontend', 'src', 'components', 'JobList.jsx');
  assert(/opacity: isUsOnly \? 0\.55 : dimmed \? 0\.5 : 1/.test(list) && !/\.filter\([^)]*(?:dimmed|shouldDim|applicants)/.test(list), 'the dim only changes opacity; no job is removed from the list');
  assert(/data-testid="applicants-chip"/.test(list) && /applicantsChip\(job\)/.test(list), 'the feed card draws the applicants chip');
  const fs_ = read('frontend', 'src', 'components', 'FeedSettings.jsx');
  assert(/data-testid="dim-50plus"/.test(fs_) && /never a filter/.test(fs_) && /FEED_CONFIG_SAVED_EVENT/.test(fs_), 'Feed Settings has the checkbox, says "never a filter", and tells the feed when it is saved');

  // ── the boost ladder helper: numbers only ──────────────────────────────────
  const ladder = [{ rank: 1, connects: 35, age: '4 hours ago' }, { rank: 2, connects: 26, age: '3 hours ago' }, { rank: 3, connects: 23, age: '5 hours ago' }, { rank: 4, connects: 17, age: '7 hours ago' }];
  const fresh = ladderView({ boost_bids: ladder, boost_bids_captured_at: '2026-11-16T11:00:00' }, NOW);
  assert(fresh && fresh.rank1 === 35 && fresh.rank2 === 26 && fresh.rank3 === 23 && fresh.ageText === '1 h ago' && fresh.stale === false, 'ACCEPTANCE: the ladder shows its age and the connects at ranks 1, 2 and 3');
  assert(ladderView({ boost_bids: ladder, boost_bids_captured_at: '2026-11-16T09:00:00' }, NOW).stale === false, 'exactly 3 hours old is not yet stale');
  assert(ladderView({ boost_bids: ladder, boost_bids_captured_at: '2026-11-16T08:59:00' }, NOW).stale === true, 'older than 3 hours is stale');
  assert(ladderView({ boost_bids: ladder }, NOW).stale === true && ladderView({ boost_bids: ladder }, NOW).ageText === 'capture time unknown', 'no capture time: stale, and it says so');
  assert(ladderView({ boost_bids: [] }, NOW) === null && ladderView({}, NOW) === null && ladderView({ boost_bids: [{ rank: 'x' }] }, NOW) === null, 'no ladder -> nothing is drawn');
  assert(ladderView({ boost_bids: [{ rank: 2, connects: 9 }, { rank: 1, connects: 12 }], boost_bids_captured_at: '2026-11-16T11:00:00' }, NOW).rank3 === null, 'a rank that is not on the ladder is null, not guessed');
  const jd = read('frontend', 'src', 'components', 'JobDetail.jsx');
  assert(/data-testid="ladder-helper"/.test(jd) && /data-testid="ladder-stale"/.test(jd) && /STALE \(over 3 h\)/.test(jd) && /Connects held now: rank 1 =/.test(jd), 'the job card shows the ladder age, a STALE mark and the connects at ranks 1-3');
  const helper = jd.slice(jd.indexOf('data-testid="ladder-helper"'), jd.indexOf('data-testid="ladder-helper"') + 900);   // the JSX the owner sees
  assert(!/recommend|should bid|best bid|suggest/i.test(helper.replace(/\/\/.*$/gm, '')), 'the helper makes no recommendation: numbers only (comments aside)');

  // ── refresh right before applying ──────────────────────────────────────────
  const apply = jd.slice(jd.indexOf('const applyOnUpwork'), jd.indexOf('const saveToKB'));
  assert(/cockpit:enrich/.test(apply) && /5 \* 60000/.test(apply) && /bridgeReady/.test(apply) && /try \{[\s\S]*\} catch \(_\) \{\}/.test(apply) && apply.indexOf('cockpit:enrich') < apply.indexOf('openInUpworkTab'), 'applying re-runs the enrich first (best effort, only if the count is over 5 minutes old) and never blocks the apply tab');
  assert(/job\.proposals \? `\$\{job\.proposals\}/.test(jd) && /· read \$\{agoText/.test(jd), 'the Applicants row says when the count was read');

  // ── dashboard wiring ───────────────────────────────────────────────────────
  const dash = read('frontend', 'src', 'components', 'Dashboard.jsx');
  const card = read('frontend', 'src', 'components', 'RateDimensionsCard.jsx');
  const vite = read('frontend', 'vite.config.js');
  assert(/<RateDimensionsCard url="\/bid-signals"/.test(dash) && /<RateDimensionsCard url="\/style-variants"/.test(dash), 'the Dashboard shows the Bid signals card and the Letter style card');
  assert(/'\/bid-signals': 'http:\/\/localhost:8000'/.test(vite) && /'\/style-variants': 'http:\/\/localhost:8000'/.test(vite), 'the dev proxy forwards both endpoints');
  assert(/data\.caption/.test(card) && /data\.definition_note/.test(card) && /rateText\(c, 'reply', minN\)/.test(card) && /isLowSample\(c, lowN\)/.test(card) && /data-n=\{c\.n\}/.test(card), 'the card shows the caption, n, low sample, rates via the Calibration helpers, and the footnote');
  assert(card.indexOf('reply-rate') < card.indexOf('open-rate') && /fontWeight: 700, fontSize: 14 \}\} data-testid="reply-rate"/.test(card), 'reply rate is the headline, open rate secondary');
  assert(/without this snapshot/.test(card), 'proposals with no snapshot are counted, not hidden');

  // ── T13: the live preview note ─────────────────────────────────────────────
  const m = jd.match(/const _PREVIEW_CHARS = (\d+)\s+const _PREVIEW_MIN_SPECIFIC = (\d+)\s+const _PREVIEW_GENERIC = new Set\(\(([\s\S]*?)\)\.split\(' '\)\)/);
  assert(m && Number(m[1]) === B.PREVIEW_CHARS && Number(m[2]) === B.PREVIEW_MIN_SPECIFIC, 'the live note uses the same window (180) and minimum (4) as the generation-time check');
  const literal = m[3].split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^'|'(?:\s*\+)?$/g, '')).join('');
  assert(literal === B.PREVIEW_GENERIC_TEXT, 'the generic-word list is identical in the generator and in the live note (no drift)');
  const posting = 'we sell handmade ceramic coffee mugs on shopify and need google shopping feed fixes for our merchant center disapprovals';
  const good = previewCheck('Your ceramic coffee mugs feed shows merchant center disapprovals; I would fix the shopify product feed first.', posting);
  const generic = previewCheck('12 years running Google Ads, Google Premier Partner 2026. I help businesses grow online with strategy and experience.', posting);
  assert(good.count >= 4 && !good.notSpecific, `a letter that repeats the posting's own words passes (${good.count})`);
  assert(generic.count < 4 && generic.notSpecific, `the credential-first opener is flagged (${generic.count} specific words)`);
  assert(previewCheck('x'.repeat(300) + ' ceramic mugs shopify feed merchant', posting).count === 0, 'only the first 180 characters count');
  assert(/data-testid="preview-note"/.test(jd) && /A note only; nothing is blocked/.test(jd), 'the note is shown under the textarea and says nothing is blocked');
  const noteBlock = jd.slice(jd.indexOf('data-testid="preview-note"') - 100, jd.indexOf('data-testid="preview-note"') + 1400);
  assert(!/disabled=|return null|throw |setProposal/.test(noteBlock.split('</div>')[0]), 'the note never disables a button or edits the letter');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
