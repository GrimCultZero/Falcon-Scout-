// "What is running now" for Metro's header strip (METRO_TASK.md F4, item 1). Ported from DevScout's src/utils/activity.js (Task 29)
// and rebuilt on Metro's own source: the BACKEND's progress runs (GET /metro/progress, api/metro/progress.py), which already
// cover import, enrich, score, persona rescore, hooks, the email imports, the domain check and the deep readings.
//
// ONE pure place turns those runs into the list the strip draws, the browser tab title and the click targets, so they cannot
// disagree. No React, no fetch: tests/metro/activity-strip.test.js runs it in Node.
//
// An activity: { key, kind, label, short, status, done, total, current, step, detail, campaignId, campaignName, canStop, stopping,
//                result, startedAt, finishedAt, where: { tab, campaignId } }
//   status  'running' | 'done' | 'stopped' | 'failed'
//   short   one or two words for the browser tab title ("Enriching")

export const SHORT = {
  enrich: 'Enriching', deep: 'Reading', hooks: 'Hooks', score: 'Scoring', rescore: 'Scoring', import: 'Importing',
  'email-import': 'Importing', 'mx-check': 'Checking emails', local: 'Working', chains: 'Chains', cases: 'Cases',
}
// every Metro job lives on the Leads screen of its campaign
export const whereOf = (run) => ({ tab: 'leads', campaignId: run.campaign_id || null })

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function activityFromRun(run) {
  if (!run) return null
  const status = ['running', 'done', 'stopped', 'failed'].includes(run.status) ? run.status : 'done'
  return {
    key: String(run.id), kind: run.kind || 'other', label: String(run.label || 'Working'), short: SHORT[run.kind] || 'Working', status,
    done: num(run.done), total: num(run.total), failed: num(run.failed),
    current: run.current || null, step: run.step || null, detail: run.detail || null,
    campaignId: run.campaign_id || null, campaignName: run.campaign_name || null,
    canStop: !!run.can_stop && status === 'running', stopping: !!run.stopping, result: run.result || null,
    startedAt: num(run.started_at), finishedAt: run.finished_at ? num(run.finished_at) : null, where: whereOf(run), local: run.kind === 'local',
    eta: run.eta_s == null ? null : num(run.eta_s), attention: !!run.attention,
  }
}

// runs + the ids the person dismissed -> { running, finished }. A finished run stays until dismissed (a failure first); a page-side
// (local) run that ended fine says nothing: the file is its result.
export function buildActivities(runs, dismissed = new Set()) {
  const running = [], finished = []
  for (const r of runs || []) {
    const a = activityFromRun(r)
    if (!a) continue
    if (a.status === 'running') { running.push(a); continue }
    if (dismissed.has(a.key)) continue
    if (a.local && a.status !== 'failed') continue
    finished.push(a)
  }
  running.sort((x, y) => y.startedAt - x.startedAt)
  finished.sort((x, y) => (y.status === 'failed') - (x.status === 'failed') || (y.finishedAt || 0) - (x.finishedAt || 0))
  return { running, finished }
}

// How the strip draws the list. RUNNING jobs decide the shape: more than 2 running (or a narrow window with more than 1) -> one
// "N running" chip with a dropdown that holds everything. Otherwise the running chips and the latest results are chips side by side
// (up to 3 in all; a window that is narrow shows 1), and results that do not fit wait behind a "+N" dropdown (`more`).
export function summarize({ running, finished }, { narrow = false } = {}) {
  const all = [...running, ...finished]
  const r = running.length
  if (!all.length) return { mode: 'idle', text: 'Nothing running', all, visible: [], more: [] }
  if (r > 2 || (narrow && r > 1)) {
    return { mode: 'collapsed', text: `${r} running${finished.length ? `, ${finished.length} done` : ''}`, all, visible: [], more: [] }
  }
  const room = Math.max(0, (narrow ? 1 : 3) - r)
  return { mode: 'chips', text: '', all, visible: [...running, ...finished.slice(0, room)], more: finished.slice(room) }
}

// "Enriching - USA CAN Agency Claude 1 7 of 20"
export function chipTitle(a) {
  const of = a.total ? ` ${Math.min(a.done, a.total)} of ${a.total}` : a.done ? ` ${a.done}` : ''
  return `${a.label}${a.campaignName ? ` - ${a.campaignName}` : ''}${a.status === 'running' ? of : ''}`
}
export const chipCount = (a) => (a.total ? `${Math.min(a.done, a.total)}/${a.total}` : a.done ? String(a.done) : '')
export const chipPct = (a) => (a.total ? Math.max(3, Math.min(100, Math.round((Math.min(a.done, a.total) / a.total) * 100))) : 0)
// "Rank Media Agency - website scan"  (the item the run is on and what it is doing to it)
export const chipDetail = (a) => [a.current, a.step].filter(Boolean).join(' - ') || a.detail || ''

// "(Enriching 7/20) Metro", "+N" for the others; the plain base when nothing runs
export function tabTitle(running, base = 'Metro') {
  if (!running || !running.length) return base
  const f = running[0]
  return `(${f.short}${f.total ? ` ${Math.min(f.done, f.total)}/${f.total}` : ''}${running.length > 1 ? ` +${running.length - 1}` : ''}) ${base}`
}
// the title currently on the tab, with a prefix this module put there taken off again
export function stripTitlePrefix(title, applied) {
  return applied && title.startsWith(applied) ? title.slice(applied.length) : title
}

// How long the page waits before asking the backend again. null = do not ask (nothing runs, no recent action): the strip polls
// ONLY while something runs, plus a short burst right after a button announced that it started something.
export function nextDelay({ running = false, burstActive = false, failing = false } = {}) {
  if (running) return failing ? 5000 : 1500
  if (burstActive) return 700
  return null
}

// The estimate on the chip (P3 queue item; the dock had it alone): "~3 min left", "~40 s left"; '' until the backend has one
// (it gives one after two units of a run with a known total).
export function chipEta(a) {
  if (!a || a.status !== 'running' || a.eta == null || !Number.isFinite(a.eta)) return ''
  const s = Math.max(0, Math.round(a.eta))
  if (s < 60) return `~${Math.max(5, Math.round(s / 5) * 5)} s left`
  return `~${Math.round(s / 60)} min left`
}

// Oleh, 26 Nov: on the Falcon Scout side the Metro strip shows ONLY a running chip and what needs attention (a failed or stopped
// run; later a new reply or a send that needs confirming). Ordinary finished results stay on the Metro side.
export function attentionOnly({ running, finished }) {
  return { running, finished: finished.filter((a) => a.status === 'failed' || a.status === 'stopped' || a.attention) }
}
