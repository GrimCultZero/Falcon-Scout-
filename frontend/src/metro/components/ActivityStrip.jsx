// The header strip (METRO_TASK.md F4, item 1): what is running now, on EVERY Metro tab and on the Falcon Scout side too.
// Ported from DevScout's ActivityStrip.jsx / docs/activity-strip.md; fed by the backend's progress runs (lib/progressStore.js).
//   * one chip per running job: what, which campaign, X of N, a thin bar, the item it is on and the step;
//   * more than 2 things (or a narrow window with more than 1): one "N running" chip with a dropdown;
//   * a click opens the screen where it runs; Stop where the backend says an abort exists;
//   * a finished run's result line STAYS until dismissed; a failure sorts first and is red.
// The bottom dock stays as the detail view.
import { useEffect, useState } from 'react'
import '../metro.css'
import { buildActivities, chipCount, chipDetail, chipPct, chipTitle, summarize } from '../lib/activity.js'
import { dismiss, dismissMany, stopRun, useProgress } from '../lib/progressStore.js'
import { notify } from '../lib/notices.js'

const NARROW_BELOW = 1100          // the strip has its own bar under the header, so it only collapses in a really narrow window

function Chip({ a, onGo, onStop }) {
  const go = () => onGo?.(a.where, a)
  const key = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }
  if (a.status !== 'running') {
    const icon = a.status === 'failed' ? '!' : a.status === 'stopped' ? '■' : '✓'
    return (
      <div className={`mt-chip mt-chip--${a.status}`} role="button" tabIndex={0} onClick={go} onKeyDown={key} data-testid="strip-result" data-status={a.status}
        title={`${a.result || a.label}${a.campaignName ? ` (${a.campaignName})` : ''}. Click to open it.`}>
        <div className="mt-chip-row">
          <span aria-hidden="true" style={{ fontWeight: 800, color: a.status === 'failed' ? '#ff8a84' : a.status === 'stopped' ? '#f0b866' : '#7fe0b0' }}>{icon}</span>
          <span className="mt-chip-result">{a.result || a.label}</span>
          <button type="button" className="mt-chip-x" aria-label="Dismiss this result" title="Dismiss"
            onClick={(e) => { e.stopPropagation(); dismiss(a.key) }}>×</button>
        </div>
      </div>
    )
  }
  const pct = chipPct(a)
  const detail = chipDetail(a)
  return (
    <div className="mt-chip" role="button" tabIndex={0} onClick={go} onKeyDown={key} data-testid="strip-chip" data-kind={a.kind}
      title={`${chipTitle(a)}${detail ? `: ${detail}` : ''}. Click to open it.`}>
      <div className="mt-chip-row">
        <span className="mt-chip-dot" aria-hidden="true" />
        <span className="mt-chip-title">{a.label}{a.campaignName ? ` · ${a.campaignName}` : ''}</span>
        <span className="mt-chip-count" data-testid="strip-count">{chipCount(a) || 'working'}</span>
        {a.canStop && !a.stopping && (
          <button type="button" className="mt-chip-stop" data-testid="strip-stop" onClick={(e) => { e.stopPropagation(); onStop(a) }}>Stop</button>
        )}
        {a.stopping && <span style={{ fontSize: 10.5, opacity: 0.75 }}>stopping</span>}
      </div>
      <div className="mt-chip-bar" aria-hidden="true">
        {a.total ? <span className="mt-chip-fill" style={{ width: `${pct}%` }} /> : <span className="mt-chip-fill mt-chip-indet" />}
      </div>
      {detail && <div className="mt-chip-detail" data-testid="strip-detail">{detail}</div>}
    </div>
  )
}

export default function ActivityStrip({ onGo, showIdle = true }) {
  const view = useProgress()
  const [open, setOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < NARROW_BELOW)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW_BELOW)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const acts = buildActivities(view.runs, view.dismissed)
  const s = summarize(acts, { narrow })
  const stop = async (a) => { try { await stopRun(a.key); notify.ok(`Stopping ${a.label.toLowerCase()} after the current item`) } catch (e) { if (!e.notified) notify.error(`Could not stop: ${e.message}`) } }
  const go = (where, a) => { setOpen(false); onGo?.(where, a) }
  // the dropdown closes when the list empties
  useEffect(() => { if (s.mode === 'idle' || (s.mode === 'chips' && !s.more.length)) setOpen(false) }, [s.mode, s.more.length])

  // The strip has its own bar under the header (on both sides): a header row has no room for chips that name the item and the step.
  // On the Falcon Scout side the bar exists only while there is something to show (showIdle=false), so that side does not jump.
  if (s.mode === 'idle') return showIdle ? <div className="mt-strip-bar mt-strip-bar--idle"><div className="mt-strip mt-strip-idle" data-testid="strip" data-mode="idle" title="Nothing is running in Metro right now.">Nothing running</div></div> : null
  if (s.mode === 'chips') {
    return (
      <div className="mt-strip-bar"><div className="mt-strip" data-testid="strip" data-mode="chips">
        {s.visible.map((a) => <Chip key={a.key} a={a} onGo={go} onStop={stop} />)}
        {s.more.length > 0 && (
          <div className="mt-chip" role="button" tabIndex={0} aria-expanded={open} data-testid="strip-more" style={{ minWidth: 0 }} onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o) } }} title="Earlier results, still here until you dismiss them">
            <div className="mt-chip-row"><span className="mt-chip-title">+{s.more.length} more {open ? '▴' : '▾'}</span></div>
          </div>
        )}
        {open && s.more.length > 0 && (
          <div className="mt-menu" role="menu" data-testid="strip-menu">
            {s.more.map((a) => <Chip key={a.key} a={a} onGo={go} onStop={stop} />)}
            <button type="button" className="mt-notice-all" style={{ justifySelf: 'start' }} onClick={() => dismissMany(s.more.map((a) => a.key))}>Dismiss these</button>
          </div>
        )}
      </div></div>
    )
  }
  return (
    <div className="mt-strip-bar"><div className="mt-strip" data-testid="strip" data-mode="collapsed">
      <div className="mt-chip" role="button" tabIndex={0} aria-expanded={open} data-testid="strip-collapsed" style={{ minWidth: 0 }}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o) } }}
        title="Everything Metro is doing, and what finished">
        <div className="mt-chip-row">
          {acts.running.length > 0 && <span className="mt-chip-dot" aria-hidden="true" />}
          <span className="mt-chip-title">{s.text} {open ? '▴' : '▾'}</span>
        </div>
      </div>
      {open && (
        <div className="mt-menu" role="menu" data-testid="strip-menu">
          {s.all.map((a) => <Chip key={a.key} a={a} onGo={go} onStop={stop} />)}
          {acts.finished.length > 1 && (
            <button type="button" className="mt-notice-all" style={{ justifySelf: 'start' }} onClick={() => dismissMany(acts.finished.map((a) => a.key))}>Dismiss all results</button>
          )}
          <div className="mt-menu-note">A finished run stays here until you dismiss it. The dock at the bottom shows the detail.</div>
        </div>
      )}
    </div></div>
  )
}
