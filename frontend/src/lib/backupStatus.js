// Decides whether the header should show the "backup" warning chip.
//
// The database is the only copy of the business (knowledge base, proposals and
// their outcomes, telemetry) and, until 2026-10-29, nothing copied it off the
// machine. tools/backup_db.py now does, and the backend reports on it at
// GET /backup-status. This turns that report into one of two answers: say
// nothing (healthy), or show a red chip with a reason. A healthy backup stays
// invisible on purpose -- a header that always shows a green badge trains the
// owner to ignore it.
//
// Pure function, no React, so a test can feed it fake timestamps.

export const BACKUP_STALE_HOURS = 48

/**
 * @param {object|null|undefined} status  the /backup-status payload
 * @returns {{label: string, title: string}|null}  null = show nothing
 */
export function backupChipState(status) {
  // No answer at all (backend down / old backend): the rest of the UI already
  // shows that; a second red chip would only add noise.
  if (!status || typeof status !== 'object') return null

  if (status.last_error) {
    return {
      label: 'Backup FAILED',
      title: `The last backup attempt failed: ${status.last_error}`,
    }
  }

  if (!status.last_backup_at || status.age_hours == null) {
    return {
      label: 'No backup yet',
      title: `No backup file found in ${status.dir || 'the backup folder'}. ` +
             'The database is the only copy of your data.',
    }
  }

  if (status.age_hours > BACKUP_STALE_HOURS) {
    const days = Math.floor(status.age_hours / 24)
    return {
      label: `Backup ${days}d old`,
      title: `Last backup: ${status.last_backup_at} (${status.age_hours} h ago) in ${status.dir}. ` +
             `Expected at least one every 24 h.`,
    }
  }

  return null
}
