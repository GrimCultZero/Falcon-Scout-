import { useEffect, useState } from 'react'
import { healthStripState } from '../lib/healthStrip'

// Header strip for the instruments (audit 2026-10-29, T6): feed, proposals sync,
// inbox walk, CLI bridge. One quiet green pill when all is well, one pill per
// amber/red instrument otherwise. Polls /health every 30 s, so a stopped bridge or
// a stale sync turns it red within one poll. The backup keeps its own chip.
const COLORS = {
  ok:    { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.40)', fg: '#34d399', dot: '#10b981' },
  amber: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.55)', fg: '#fbbf24', dot: '#f59e0b' },
  red:   { bg: 'rgba(239,68,68,0.14)',  border: 'rgba(239,68,68,0.55)',  fg: '#ff8a8a', dot: '#ef4444' },
}
const POLL_MS = 30000

export default function HealthStrip() {
  const [report, setReport] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/health')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (alive) setReport(d) })
        .catch(() => { if (alive) setReport(null) })
    load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const state = healthStripState(report)

  return (
    <div data-testid="health-strip" data-overall={state.overall} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {state.pills.map(p => {
        const c = COLORS[p.level] || COLORS.amber
        return (
          <div
            key={p.key}
            title={p.title}
            data-testid={`health-pill-${p.key}`}
            data-level={p.level}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: c.bg, border: `1px solid ${c.border}`, color: c.fg,
              borderRadius: 4, padding: '4px 9px', fontSize: 10, fontWeight: 700,
              fontFamily: 'Inter, sans-serif', letterSpacing: '0.02em', cursor: 'help', whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
            {p.text}
          </div>
        )
      })}
    </div>
  )
}
