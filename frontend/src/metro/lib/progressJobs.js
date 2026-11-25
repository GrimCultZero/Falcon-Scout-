// Progress helpers for Metro's dock (copied from DevScout's src/utils/progressJobs.js and adapted, F2, 25 Nov 2026).
//
// DevScout kept its progress in the page; Metro's lives in the BACKEND (api/metro/progress.py), so a reloaded tab still shows
// a run that is going. What stays from DevScout is the rule for WHEN a bar shows and how it reads:
//   - under SHOW_AFTER_MS (1 s) nothing is drawn, so a quick action does not flash a bar;
//   - the total is known -> a filling bar with "7 of 20"; not known -> an indeterminate bar with the elapsed time;
//   - Stop exists only when the run has an abort (the backend says `can_stop`);
//   - a run ends with ONE line of result.
// Everything here is pure (the clock is passed in) so tests/metro/progress-dock.test.js runs it without a browser.

export const SHOW_AFTER_MS = 1000
export const RESULT_SHOWN_S = 90         // a finished run's result line stays this long, unless it is dismissed

// 12s / 3 min / 1h 5m
export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// "Enriching: Rank Media Agency, 7 of 20 - website scan". Without a total: "Enriching: Rank Media Agency - website scan".
export function describeRun(run) {
  const total = run.total || 0
  const head = run.current ? `${run.label}: ${run.current}` : run.label
  const of = total ? `, ${Math.min(run.done + 1, total)} of ${total}` : ''
  const step = run.step ? ` - ${run.step}` : ''
  return `${head}${run.current ? of : ''}${step}`
}

// Which runs the dock draws now. `runs` come from GET /metro/progress (server clock `serverNow`, seconds);
// `dismissed` is a Set of run ids the person closed; `local` are page-side runs (a download) in the same shape.
export function visibleRuns(runs, serverNow, dismissed = new Set()) {
  const out = []
  for (const r of runs || []) {
    if (!r || dismissed.has(r.id)) continue
    if (r.status === 'running') {
      if ((serverNow - r.started_at) * 1000 >= SHOW_AFTER_MS) out.push(r)
    } else if (r.finished_at && serverNow - r.finished_at <= RESULT_SHOWN_S) {
      // a run that was over before a second passed and went fine says nothing; a failure is always said
      if (r.status === 'failed' || r.finished_at - r.started_at >= SHOW_AFTER_MS / 1000 || r.kind === 'enrich' || r.kind === 'deep') out.push(r)
    }
  }
  return out
}

// A page-side tracker for work that never reaches the backend (building a download). Same run shape as the backend's.
export function createLocalRuns({ now = () => Date.now() / 1000 } = {}) {
  const runs = new Map()
  let seq = 0
  return {
    start(label, { total = 0 } = {}) {
      const id = `local-${++seq}`
      runs.set(id, { id, kind: 'local', label, status: 'running', total, done: 0, failed: 0, current: null, step: null, started_at: now(), finished_at: null, result: null, can_stop: false })
      return id
    },
    update(id, patch) { const r = runs.get(id); if (r && r.status === 'running') Object.assign(r, patch) },
    end(id, result = 'Done', ok = true) { const r = runs.get(id); if (r) { r.status = ok ? 'done' : 'failed'; r.result = result; r.finished_at = now() } },
    list() { return [...runs.values()] },
  }
}
export const localRuns = createLocalRuns()
