// ProgressDock: one panel for every long Metro action (METRO_TASK.md F2, item 2). Adapted from DevScout's ProgressDock.jsx
// and restyled in Metro's colours. It draws what the backend says (GET /metro/progress), so it survives a tab reload and
// shows a run that is still going. Not a modal: the leads table behind it keeps updating while a run goes.
//
// A run with a known total fills a bar and shows "7 of 20", a percentage, elapsed time and an estimate; one without a total
// shows a sliding bar and the elapsed time. The current item reads like "Enriching: Rank Media Agency, 7 of 20 - website scan".
// Stop appears only when the backend says the run can be stopped. A finished run leaves one result line.
import { useEffect, useState } from 'react'
import { METRO } from '../theme.js'
import { describeRun, fmtDuration, visibleRuns } from '../lib/progressJobs.js'
import { stopRun, useProgress } from '../lib/progressStore.js'
import { notify } from '../lib/notices.js'

const DISMISS_KEY = 'falconscout.metro.progress.dismissed'
const FILL = { enrich: METRO.cyan, deep: METRO.cyan, hooks: '#8fd6e6', score: '#7fe0b0', rescore: '#7fe0b0', import: '#f0b866', 'email-import': '#f0b866', 'mx-check': '#8fd6e6', local: METRO.cyan }
const CSS = `
@keyframes metro-dock-slide { from { transform: translateX(-110%); } to { transform: translateX(300%); } }
@keyframes metro-dock-pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.metro-dock-indet { width: 35%; animation: metro-dock-slide 1.3s ease-in-out infinite; will-change: transform; }
.metro-dock-dot { animation: metro-dock-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .metro-dock-indet { animation: none; width: 100%; opacity: .45; } .metro-dock-dot { animation: none; } }
`

function readDismissed() {
  try { return new Set(JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '[]')) } catch { return new Set() }
}

// The runs come from the shared store (lib/progressStore.js): the header strip and this dock read the same request.
export default function ProgressDock({ campaignId = null }) {
  const view = useProgress()
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [, setTick] = useState(0)
  const running = view.runs.some((r) => r.status === 'running')
  useEffect(() => {                              // the clock of the elapsed time ticks only while something shows
    if (!running) return undefined
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  const dismiss = (id) => {
    const n = new Set(dismissed); n.add(id); setDismissed(n)
    try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...n].slice(-60))) } catch { /* not remembered */ }
  }
  const stop = async (r) => { try { await stopRun(r.id) } catch (e) { if (!e.notified) notify.error(`Could not stop: ${e.message}`) } }

  const nowS = Date.now() / 1000 + view.offset
  const all = campaignId ? view.runs.filter((r) => !r.campaign_id || r.campaign_id === campaignId) : view.runs
  // F5 (item 5): a finished run's result is told in the header strip ONLY; the dock is the detail view of what is running now.
  const shown = visibleRuns(all, nowS, dismissed).filter((r) => r.status === 'running')
  if (!shown.length) return <style>{CSS}</style>

  return (
    <div data-testid="progress-dock" role="status" aria-live="polite"
      style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 18, zIndex: 30, width: 'min(720px, calc(100vw - 24px))',
        background: `linear-gradient(90deg, ${METRO.ink}, ${METRO.teal})`, color: METRO.ice, border: `1px solid ${METRO.cyan}`, borderRadius: 12,
        boxShadow: '0 8px 28px rgba(0,12,14,0.35)', padding: collapsed ? '7px 14px' : '12px 16px', fontFamily: METRO.font, display: 'grid', gap: 10 }}>
      <style>{CSS}</style>
      <button type="button" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} title={collapsed ? 'Show the detail' : 'Collapse to a strip'}
        style={{ position: 'absolute', top: 6, right: 8, border: 'none', background: 'rgba(255,255,255,0.1)', color: METRO.ice, borderRadius: 6, cursor: 'pointer', width: 22, height: 22, fontSize: 12 }}>
        {collapsed ? '▴' : '▾'}
      </button>
      {shown.map((r) => <Run key={r.id} run={r} nowS={nowS} collapsed={collapsed} onStop={() => stop(r)} onDismiss={() => dismiss(r.id)} />)}
    </div>
  )
}

function Run({ run, nowS, collapsed, onStop, onDismiss }) {
  const total = run.total || 0
  const done = Math.min(run.done || 0, total || run.done || 0)
  const pct = total ? Math.round((done / total) * 100) : 0
  const live = run.status === 'running'
  const elapsed = run.finished_at ? run.finished_at - run.started_at : nowS - run.started_at
  const eta = live && total && done >= 2 && done < total ? (elapsed / done) * (total - done) : null
  const color = run.status === 'failed' ? METRO.agencyLine : (FILL[run.kind] || METRO.cyan)
  const indet = live && !total

  if (!live) {
    return (
      <div data-testid="progress-result" style={{ display: 'flex', alignItems: 'center', gap: 9, paddingRight: 30 }}>
        <span aria-hidden="true" style={{ color: run.status === 'failed' ? '#ff8a84' : '#7fe0b0', fontWeight: 800 }}>{run.status === 'failed' ? '!' : run.status === 'stopped' ? '■' : '✓'}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{run.result || run.label}</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{fmtDuration(elapsed)}</span>
        <button type="button" onClick={onDismiss} title="Close" style={{ marginLeft: 'auto', border: 'none', background: 'none', color: METRO.ice, cursor: 'pointer', opacity: 0.7 }}>×</button>
      </div>
    )
  }
  return (
    <div data-testid="progress-run" data-kind={run.kind} style={{ display: 'grid', gap: 6, paddingRight: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="metro-dock-dot" aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 800 }}>{run.label}</span>
        {run.stopping && <span style={{ fontSize: 11, opacity: 0.7 }}>stopping after this item</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700 }}>{total ? `${done} / ${total}` : done ? `${done}` : 'working'}</span>
        {run.can_stop && !run.stopping && (
          <button type="button" onClick={onStop} data-testid="progress-stop"
            style={{ border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(230,38,31,0.85)', color: '#fff', borderRadius: 7, padding: '3px 10px', cursor: 'pointer', fontFamily: METRO.font, fontSize: 12, fontWeight: 700 }}>
            Stop
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          <div aria-hidden="true" style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
            <span className={indet ? 'metro-dock-indet' : undefined}
              style={{ display: 'block', height: '100%', borderRadius: 999, background: color, transition: 'width 0.4s ease', ...(indet ? {} : { width: `${pct}%` }) }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12 }}>
            <span data-testid="progress-item" style={{ fontWeight: 600 }}>{describeRun(run)}{run.detail ? <span style={{ opacity: 0.65, fontStyle: 'italic' }}> · {run.detail}</span> : null}</span>
            <span style={{ marginLeft: 'auto', opacity: 0.8, whiteSpace: 'nowrap' }}>
              {total ? `${pct}% · ` : ''}{fmtDuration(elapsed)} elapsed{eta != null ? ` · ~${fmtDuration(eta)} left` : ''}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
