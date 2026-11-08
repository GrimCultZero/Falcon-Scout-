// Decides when the Outcomes "sync from upwork" button may say "synced"
// (audit 2026-10-29, T6; the failure is in WORKLOG 2026-09-16).
//
// The button used to paint a green "synced" 800 ms after the click, whether or not
// anything had run. It showed "SYNCED" through a whole blackout. Now the ONLY
// thing that counts as synced is a row in sync_runs, written by the backend AFTER
// the click. The dashboard takes the id of the newest proposals-list run before
// it dispatches the click; anything with a higher id is new.
//
//   waiting - no new run yet (keep polling, up to a time limit)
//   ok      - a new run read rows
//   empty   - a new run exists but read 0 rows (a failed or empty scrape)
//
// Pure functions over the GET /sync-runs payload, so a test can fake any history.

/** Highest run id in a /sync-runs payload, or 0 when there are none. */
export function newestRunId(payload) {
  const runs = payload && Array.isArray(payload.runs) ? payload.runs : []
  let max = 0
  for (const r of runs) if (r && typeof r.id === 'number' && r.id > max) max = r.id
  return max
}

/**
 * @param {object|null} payload   GET /sync-runs?leg=proposals-list
 * @param {number} baselineId     newest run id seen BEFORE the click
 * @returns {{state: 'waiting'|'ok'|'empty', run?: object, text?: string}}
 */
export function judgeSyncRuns(payload, baselineId) {
  const runs = payload && Array.isArray(payload.runs) ? payload.runs : []
  const fresh = runs.filter(r => r && typeof r.id === 'number' && r.id > baselineId)
  if (!fresh.length) return { state: 'waiting' }

  fresh.sort((a, b) => b.id - a.id)                     // newest first
  const good = fresh.find(r => (r.rows_scraped || 0) > 0)
  if (good) {
    const hdr = good.header_count
    const pct = good.coverage != null ? Math.round(good.coverage * 100) : null
    const text = hdr
      ? `read ${good.rows_scraped} of ${hdr} proposals${pct != null ? ` (${pct}%)` : ''}`
      : `read ${good.rows_scraped} proposals`
    return { state: 'ok', run: good, text }
  }

  const last = fresh[0]
  const sc = last.scroll && typeof last.scroll === 'object' ? last.scroll : {}
  const stage = sc.failed && sc.stage ? ` (${sc.stage})` : ''
  return { state: 'empty', run: last, text: `the sync ran but read 0 rows${stage}` }
}

export const SYNC_POLL_MS = 3000
export const SYNC_GIVE_UP_MS = 180000   // the messages leg can walk rooms for ~2 min
