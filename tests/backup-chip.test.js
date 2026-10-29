// The red "backup" chip in the header (audit 2026-10-29, T1).
//
// The database is the only copy of the business and nothing copied it off the
// machine until tools/backup_db.py. The chip is the alarm: it must be silent
// when the backup is healthy (an always-on badge gets ignored) and red the
// moment the backup is missing, failed, or older than 48 h.
//
// backupChipState() is a pure function, so these tests feed it fake timestamps
// instead of waiting two days.
//
// Run: node tests/backup-chip.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const lib = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'backupStatus.js')).href);
  const { backupChipState, BACKUP_STALE_HOURS } = lib;

  const healthy = { ok: true, stale: false, last_backup_at: '2026-10-29T20:35', age_hours: 3.2, dir: 'C:\\b', last_error: null };

  assert(BACKUP_STALE_HOURS === 48, 'the threshold is 48 hours, matching the backend');
  assert(backupChipState(healthy) === null, 'a healthy backup shows NOTHING');
  assert(backupChipState({ ...healthy, age_hours: 48 }) === null, 'exactly 48 h is still fine');

  const old = backupChipState({ ...healthy, age_hours: 72, last_backup_at: '2026-10-26T20:35' });
  assert(old && /3d old/.test(old.label), `72 h old -> red chip "${old && old.label}"`);
  assert(old && /72/.test(old.title) && /C:\\b/.test(old.title), 'the tooltip says how old and where');
  const older = backupChipState({ ...healthy, age_hours: 49 });
  assert(older && /2d old/.test(older.label), '49 h old -> "2d old" (2.04 days, just past the threshold)');

  const failed = backupChipState({ ...healthy, ok: false, last_error: 'FileNotFoundError: source database not found' });
  assert(failed && /FAILED/.test(failed.label), 'a failed last attempt -> "Backup FAILED"');
  assert(failed && /source database not found/.test(failed.title), '…and the tooltip carries the real error');
  const failedAndStale = backupChipState({ ...healthy, age_hours: 90, last_error: 'disk full' });
  assert(failedAndStale && /FAILED/.test(failedAndStale.label), 'failed wins over merely old: the cause matters more than the age');

  const none = backupChipState({ ok: false, stale: true, last_backup_at: null, age_hours: null, dir: 'C:\\nowhere', last_error: null });
  assert(none && /No backup yet/.test(none.label), 'no backup file at all -> "No backup yet"');
  assert(none && /only copy/.test(none.title), '…and says why it matters');

  assert(backupChipState(null) === null && backupChipState(undefined) === null, 'no answer (backend down) -> no second red chip');
  assert(backupChipState('oops') === null, 'a malformed payload does not throw or show a chip');

  // wiring
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.jsx'), 'utf8');
  const chip = fs.readFileSync(path.join(root, 'frontend', 'src', 'components', 'BackupChip.jsx'), 'utf8');
  const vite = fs.readFileSync(path.join(root, 'frontend', 'vite.config.js'), 'utf8');
  assert(/import BackupChip from '\.\/components\/BackupChip'/.test(app) && /<BackupChip \/>/.test(app), 'the chip is imported and mounted in the header');
  assert(/fetch\('\/backup-status'\)/.test(chip), 'the chip reads /backup-status');
  assert(/setInterval\(load, 60000\)/.test(chip), 'and re-checks every minute, so a failure shows up within a minute');
  assert(/'\/backup-status': 'http:\/\/localhost:8000'/.test(vite), 'the dev proxy forwards the route');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
