// ONE shared reader of GET /metro/progress for the header strip (on both sides of the switch) and the bottom dock, so they show
// the same numbers from one request. Polls only while something runs, plus once on load and a short burst after a button
// announces (window event 'metro-progress') that it started something. Pure scheduling lives in lib/activity.js (nextDelay).
import { useSyncExternalStore } from 'react'
import { api } from '../api.js'
import { nextDelay } from './activity.js'
import { localRuns } from './progressJobs.js'

const DISMISS_KEY = 'falconscout.metro.strip.dismissed'
const BURST_MS = 8000

let snap = { runs: [], server_now: Date.now() / 1000, offset: 0, loaded: false, failing: false }
let dismissed = readDismissed()
let burstUntil = 0
let timer = null
let inFlight = false
let started = false
const subs = new Set()
let view = null

function readDismissed() {
  try { return new Set(JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '[]')) } catch { return new Set() }
}
const emit = () => { view = null; for (const f of subs) f() }

async function poll() {
  if (inFlight) return
  inFlight = true
  try {
    const j = await api('/progress')
    snap = { ...j, offset: j.server_now - Date.now() / 1000, loaded: true, failing: false }
  } catch {
    snap = { ...snap, failing: true }
  } finally { inFlight = false }
  emit()
  schedule()
}

function schedule() {
  clearTimeout(timer); timer = null
  if (!subs.size) return
  const running = snap.runs.some((r) => r.status === 'running') || localRuns.list().some((r) => r.status === 'running')
  const d = nextDelay({ running, burstActive: Date.now() < burstUntil, failing: snap.failing })
  if (d != null) timer = setTimeout(poll, d)
}

// A button says "I just started something": ask now and keep asking quickly for a few seconds, so a run that the backend
// registers a moment later (a synchronous action) is caught.
export function announce() { burstUntil = Date.now() + BURST_MS; poll() }

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('metro-progress', announce)
  window.addEventListener('metro-click', announce)      // any Metro button that started a request
  localRuns.subscribe(() => { emit(); schedule() })     // a page-side run (building a download) shows in the strip too
  poll()                                   // once on load
}

function saveDismissed() { try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed].slice(-80))) } catch { /* not remembered */ } }
export function dismiss(id) { dismissed = new Set(dismissed).add(String(id)); saveDismissed(); emit() }
export function dismissMany(ids) { dismissed = new Set([...dismissed, ...ids.map(String)]); saveDismissed(); emit() }

// P3b #4b: an interrupted run (a backend restart stopped it) starts again on the items it did not finish
export async function resumeRun(queueId) {
  const r = await api(`/runs/${queueId}/resume`, { method: 'POST' })
  announce()
  return r
}
export async function dismissInterrupted(queueId, key) {
  try { await api(`/runs/${queueId}/dismiss`, { method: 'POST', quiet: true }) } catch { /* the local dismiss below still hides it */ }
  dismiss(key)
}

export async function stopRun(id) {
  await api(`/progress/${id}/stop`, { method: 'POST' })
  announce()
}

// the snapshot every consumer reads: backend runs plus page-side runs, on the server's clock
function getView() {
  if (!view) {
    const local = localRuns.list().map((r) => ({ ...r, started_at: r.started_at + snap.offset, finished_at: r.finished_at ? r.finished_at + snap.offset : null }))
    view = { runs: [...snap.runs, ...local], offset: snap.offset, loaded: snap.loaded, failing: snap.failing, dismissed }
  }
  return view
}

// ONE stable subscribe function: React re-subscribes whenever its identity changes, and every re-subscription restarts the poll timer
// (found in the browser: with an inline arrow the timer never fired while the page re-rendered more often than the delay).
function subscribe(fn) {
  subs.add(fn)
  start()
  if (timer == null) schedule()
  return () => { subs.delete(fn); if (!subs.size) { clearTimeout(timer); timer = null } }
}
export function useProgress() {
  return useSyncExternalStore(subscribe, getView, getView)
}
