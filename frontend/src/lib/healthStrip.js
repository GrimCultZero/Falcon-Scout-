// What the header's health strip shows (audit 2026-10-29, T6).
//
// The backend (GET /health, tools/health_report.py) already decides ok / amber /
// red for every instrument and says why. This only decides how that is DRAWN:
//
//   * everything fine  -> one quiet green pill, so "no news" is visibly different
//                         from "the strip is broken";
//   * something is off -> one pill per amber/red instrument, red first, with the
//                         reason in the tooltip;
//   * no answer at all -> an amber "Health unknown" pill, never silence.
//
// The backup has its own red chip (BackupChip, T1), so it is left out of the
// pills to avoid two chips for one fault. /health still reports it, and the
// tooltip of the quiet pill lists it.
//
// Pure functions, no React: tests feed them canned reports.

const PILL_ORDER = ['red', 'amber']
const NOT_SHOWN_AS_PILL = new Set(['backup'])   // has its own chip

function ago(minutes) {
  if (minutes == null) return 'never'
  const m = Math.max(0, Number(minutes))
  if (m < 90) return `${Math.round(m)} min`
  const h = m / 60
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0).replace(/\.0$/, '')} h`
  return `${(h / 24).toFixed(1).replace(/\.0$/, '')} d`
}

/** Short text for a pill. The tooltip carries the full reason. */
export function pillText(key, item) {
  switch (key) {
    case 'feed':
      if (item.connected === false) return 'Feed: Upwork API disconnected'
      return item.age_minutes == null ? 'Feed: nothing yet' : `Feed quiet ${ago(item.age_minutes)}`
    case 'proposals_sync':
      // A pill exists only when something is really off: a low read (coverage), or no
      // good read for hours. An empty latest run is named only when nothing else is
      // the reason; since 2026-11-09 it never lights the pill on its own.
      if (item.coverage != null && item.coverage < 0.95) return `Sync read ${Math.round(item.coverage * 100)}%`
      if (item.age_minutes != null && item.age_minutes >= 360) return `Sync ${ago(item.age_minutes)} ago`
      if (item.last_run_zero_rows) return 'Sync read 0 rows'
      return item.age_minutes == null ? 'Sync: never ran' : `Sync ${ago(item.age_minutes)} ago`
    case 'messages_sync':
      return item.age_minutes == null ? 'Inbox: never walked' : `Inbox ${ago(item.age_minutes)} ago`
    case 'bridge':
      return 'CLI bridge down'
    default:
      return item.label || key
  }
}

/**
 * @param {object|null|undefined} report  the GET /health payload
 * @returns {{overall: string, pills: Array<{key, level, text, title}>, summary: string}}
 */
export function healthStripState(report) {
  if (!report || typeof report !== 'object' || !report.items || typeof report.items !== 'object') {
    return {
      overall: 'unknown',
      pills: [{ key: 'health', level: 'amber', text: 'Health unknown',
                title: 'The backend did not answer /health, so nothing about the feed, the syncs or the bridge can be vouched for.' }],
      summary: 'Health unknown',
    }
  }

  const pills = []
  for (const key of Object.keys(report.items)) {
    const it = report.items[key]
    if (!it || NOT_SHOWN_AS_PILL.has(key)) continue
    if (!PILL_ORDER.includes(it.level)) continue
    pills.push({ key, level: it.level, text: pillText(key, it), title: `${it.label || key}: ${it.reason || it.level}` })
  }
  pills.sort((a, b) => PILL_ORDER.indexOf(a.level) - PILL_ORDER.indexOf(b.level))

  const lines = Object.keys(report.items).map(k => {
    const it = report.items[k] || {}
    return `${(it.level || '?').toUpperCase().padEnd(5)} ${it.label || k}: ${it.reason || ''}`
  })
  const summary = lines.join('\n')

  if (!pills.length) {
    return { overall: 'ok', pills: [{ key: 'all-ok', level: 'ok', text: 'Instruments live', title: summary }], summary }
  }
  return { overall: pills[0].level, pills, summary }
}
