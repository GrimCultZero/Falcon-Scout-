// Header health strip and the Outcomes "synced" gate (audit 2026-10-29, T6).
//
// healthStrip.js decides how GET /health is DRAWN: one quiet pill when all is
// well, one pill per amber/red instrument otherwise, and never silence when the
// backend does not answer. syncGate.js decides when the Outcomes button may say
// "synced": only when a sync_runs row exists that was written AFTER the click.
// (The button used to turn green 800 ms after the click whatever happened; it
// showed SYNCED through a whole blackout, WORKLOG 2026-09-16.)
//
// Both are pure functions, so a canned /health payload or a faked sync history is
// all a test needs.
//
// Run: node tests/health-strip.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const lib = (f) => import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', f)).href);

(async () => {
  const { healthStripState, pillText } = await lib('healthStrip.js');
  const { newestRunId, judgeSyncRuns, SYNC_POLL_MS, SYNC_GIVE_UP_MS } = await lib('syncGate.js');

  const item = (level, extra = {}) => ({ level, label: extra.label || 'X', reason: extra.reason || `${level} because`, ...extra });
  const report = (items) => ({ overall: 'ok', problems: [], items });
  const allOk = () => report({
    feed: item('ok', { label: 'Feed' }), proposals_sync: item('ok', { label: 'Proposals' }), messages_sync: item('ok', { label: 'Messages' }),
    backup: item('ok', { label: 'Backup' }), bridge: item('ok', { label: 'CLI bridge' }), passive_read: item('info', { label: 'Passive read' }),
    rooms_visited: item('info', { label: 'Rooms visited' }),
  });

  // ── the strip ─────────────────────────────────────────────────────────────
  let s = healthStripState(allOk());
  assert(s.overall === 'ok' && s.pills.length === 1 && s.pills[0].level === 'ok' && s.pills[0].text === 'Instruments live',
    'all fine -> ONE quiet green pill ("no news" is visibly not a broken strip)');
  assert(/Feed: /.test(s.pills[0].title) && /Backup: /.test(s.pills[0].title) && /CLI bridge: /.test(s.pills[0].title), '…whose tooltip lists every instrument');

  const bridgeDown = allOk(); bridgeDown.items.bridge = item('red', { label: 'CLI bridge', reason: 'AI provider is the CLI bridge but it does not answer.' });
  s = healthStripState(bridgeDown);
  assert(s.overall === 'red' && s.pills.length === 1 && s.pills[0].key === 'bridge' && s.pills[0].text === 'CLI bridge down', 'bridge stopped -> a red "CLI bridge down" pill (acceptance)');
  assert(/does not answer/.test(s.pills[0].title), '…with the backend\'s reason in the tooltip');

  const stale = allOk(); stale.items.proposals_sync = item('red', { label: 'Proposals', age_minutes: 1500, coverage: 1.0 });
  s = healthStripState(stale);
  assert(s.pills[0].key === 'proposals_sync' && /Sync 1\.0 d ago|Sync 25 h ago|Sync 1 d ago/.test(s.pills[0].text), `old sync -> red pill with its age ("${s.pills[0].text}")`);

  const many = allOk();
  many.items.feed = item('amber', { label: 'Feed', age_minutes: 45 });
  many.items.messages_sync = item('red', { label: 'Messages', age_minutes: 5000 });
  many.items.bridge = item('amber', { label: 'CLI bridge' });
  s = healthStripState(many);
  assert(s.pills.map(p => p.level).join() === 'red,amber,amber' && s.pills[0].key === 'messages_sync' && s.overall === 'red', 'several problems: red first, then amber; overall is the worst');

  const backupRed = allOk(); backupRed.items.backup = item('red', { label: 'Backup' });
  s = healthStripState(backupRed);
  assert(s.pills.length === 1 && s.pills[0].level === 'ok', 'a red backup is NOT a second pill: it keeps its own chip (BackupChip)');
  assert(/RED\s+Backup/.test(s.summary), '…but is still listed in the summary');

  const info = allOk(); info.items.passive_read = item('info'); info.items.rooms_visited = item('info');
  assert(healthStripState(info).pills.length === 1, 'info items never become pills');

  for (const bad_ of [null, undefined, {}, 'oops', { items: null }, { items: 5 }]) {
    const st = healthStripState(bad_);
    assert(st.overall === 'unknown' && st.pills.length === 1 && st.pills[0].text === 'Health unknown' && st.pills[0].level === 'amber', `no usable /health (${JSON.stringify(bad_)}) -> amber "Health unknown", never silence`);
  }
  assert(pillText('proposals_sync', { last_run_zero_rows: true, age_minutes: 30 }) === 'Sync read 0 rows', 'a 0-row latest run is named when nothing else is the reason');
  assert(pillText('proposals_sync', { last_run_zero_rows: true, age_minutes: 1462 }) === 'Sync 24 h ago',
    '...but a pill lit by 24 h without a good read says so, not "read 0 rows" (owner, 2026-11-09)');
  assert(pillText('proposals_sync', { coverage: 0.2111, age_minutes: 30 }) === 'Sync read 21%', 'low coverage is named on the pill (19 of 90 -> 21%)');
  assert(pillText('proposals_sync', { coverage: 1.0, age_minutes: 600 }) === 'Sync 10 h ago', 'a stale but complete sync names its age');
  assert(pillText('feed', { age_minutes: 45 }) === 'Feed quiet 45 min' && pillText('feed', {}) === 'Feed: nothing yet', 'feed pill text');
  assert(pillText('feed', { connected: false, age_minutes: 5 }) === 'Feed: Upwork API disconnected', 'a disconnected API is named on the feed pill, not shown as "nothing yet"');
  assert(pillText('messages_sync', { age_minutes: 4320 }) === 'Inbox 3 d ago', 'inbox pill text in days');

  // ── the sync gate ─────────────────────────────────────────────────────────
  const run = (id, rows, extra = {}) => ({ id, ts: '2026-11-08T10:00:00', leg: 'proposals-list', rows_scraped: rows, header_count: extra.header_count ?? null, coverage: extra.coverage ?? null, scroll: extra.scroll ?? null });
  const hist = { runs: [run(698, 87, { header_count: 87, coverage: 1 }), run(697, 87, { header_count: 87, coverage: 1 })] };
  assert(newestRunId(hist) === 698 && newestRunId({ runs: [] }) === 0 && newestRunId(null) === 0 && newestRunId({}) === 0, 'newestRunId: highest id, 0 when none or malformed');

  assert(judgeSyncRuns(hist, 698).state === 'waiting', 'THE GATE: with no run newer than the click, the answer is "waiting" -- never "synced"');
  assert(judgeSyncRuns(null, 698).state === 'waiting' && judgeSyncRuns({ runs: 'x' }, 698).state === 'waiting', '…also when the backend gave no usable answer');
  assert(judgeSyncRuns({ runs: [] }, 0).state === 'waiting', '…and with an empty history');

  const after = { runs: [run(699, 87, { header_count: 87, coverage: 1 }), ...hist.runs] };
  let v = judgeSyncRuns(after, 698);
  assert(v.state === 'ok' && v.run.id === 699 && v.text === 'read 87 of 87 proposals (100%)', `a run written after the click that read rows -> synced, with what it read ("${v.text}")`);
  v = judgeSyncRuns({ runs: [run(699, 19, { header_count: 90, coverage: 0.2111 }), ...hist.runs] }, 698);
  assert(v.state === 'ok' && v.text === 'read 19 of 90 proposals (21%)', 'a short read is reported as what it was (19 of 90, 21%), not hidden behind "synced"');
  v = judgeSyncRuns({ runs: [run(699, 10), ...hist.runs] }, 698);
  assert(v.state === 'ok' && v.text === 'read 10 proposals', 'a run from before coverage was recorded still works');

  v = judgeSyncRuns({ runs: [run(699, 0, { scroll: { failed: true, stage: 'no-rows' } }), ...hist.runs] }, 698);
  assert(v.state === 'empty' && /read 0 rows \(no-rows\)/.test(v.text), `a new run that read 0 rows -> NOT synced, with its stage ("${v.text}")`);
  v = judgeSyncRuns({ runs: [run(699, 0), ...hist.runs] }, 698);
  assert(v.state === 'empty' && !/\(/.test(v.text), '…and without a recorded stage');
  v = judgeSyncRuns({ runs: [run(700, 87, { header_count: 87, coverage: 1 }), run(699, 0, { scroll: { failed: true, stage: 'gate-declined' } }), ...hist.runs] }, 698);
  assert(v.state === 'ok' && v.run.id === 700, 'an empty run followed by a good one counts as synced');
  v = judgeSyncRuns({ runs: [run(700, 0, { scroll: { failed: true, stage: 'no-rows' } }), run(699, 87, { header_count: 87, coverage: 1 }), ...hist.runs] }, 698);
  assert(v.state === 'ok' && v.run.id === 699, '…and a good run followed by a later empty one still counts: a row that read rows exists after the click');
  assert(judgeSyncRuns({ runs: hist.runs }, 697).state === 'ok' && judgeSyncRuns({ runs: hist.runs }, 698).state === 'waiting', 'strictly newer: id 698 is not "after" a click that saw 698');
  assert(SYNC_POLL_MS >= 1000 && SYNC_GIVE_UP_MS >= 120000, 'it waits long enough for the messages leg (up to ~2 min) before giving up');

  // ── wiring in the shipped files ───────────────────────────────────────────
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  const app = read('frontend', 'src', 'App.jsx');
  const strip = read('frontend', 'src', 'components', 'HealthStrip.jsx');
  const out = read('frontend', 'src', 'components', 'Outcomes.jsx');
  const vite = read('frontend', 'vite.config.js');
  assert(/import HealthStrip from '\.\/components\/HealthStrip'/.test(app) && /<HealthStrip \/>/.test(app) && /<BackupChip \/>/.test(app), 'the strip is mounted in the header next to the backup chip');
  assert(/fetch\('\/health'\)/.test(strip) && /POLL_MS = 30000/.test(strip) && /setInterval\(load, POLL_MS\)/.test(strip), 'the strip polls /health every 30 s ("within one poll")');
  assert(/'\/health': 'http:\/\/localhost:8000'/.test(vite) && /'\/sync-runs': 'http:\/\/localhost:8000'/.test(vite), 'the dev proxy forwards /health and /sync-runs');
  assert(!/setSyncStatus\(\{ ok: true, banner: true \}\)/.test(out), 'the unconditional green "synced" after 800 ms is gone from Outcomes');
  assert(/judgeSyncRuns\(await r\.json\(\), baselineRunId\)/.test(out) && /newestRunId\(await r\.json\(\)\)/.test(out), 'Outcomes takes a baseline run id before the click and judges only newer runs');
  assert(out.indexOf('baselineRunId = newestRunId') < out.indexOf("new CustomEvent('cockpit:sync-statuses')"), 'the baseline is read BEFORE the sync is dispatched');
  assert(/setSyncStatus\(\{ ok: true, text: verdict\.text, run: verdict\.run \}\)/.test(out), 'the only place that sets ok is the verdict from the database');
  assert(/typeof d\.scanned === 'number' && d\.scanned === 0\) return/.test(out), '"last synced" ignores a sync event that scanned 0 rows');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
