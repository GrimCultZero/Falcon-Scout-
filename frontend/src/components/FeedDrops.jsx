import { useCallback, useEffect, useState } from 'react'
import { describeReason, reasonKind } from '../lib/feedDrops'

// "Filtered out (last 24 h)" in Feed Settings (audit 2026-10-29, T18).
//
// Nothing recorded what the API feed dropped, so a wrongly dropped in-lane job could
// only be found by searching Upwork by hand. This lists everything the filter dropped
// in the last 24 h, grouped by reason, each title linking to Upwork. The groups where
// the filter judged the WORDS come first: that is where a miss would be. The rate,
// payment, age and country groups are the floors doing their job.
export default function FeedDrops() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState({})          // reason -> expanded

  const load = useCallback(() => {
    setErr('')
    fetch('/feed-drops?hours=24')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(setData)
      .catch(e => setErr('Could not load: ' + e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const groups = (data && data.groups) || []
  const hasText = groups.some(g => reasonKind(g.reason) === 'text')

  return (
    <div data-testid="feed-drops" style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Filtered out (last 24 h){data ? ` · ${data.total}` : ''}
        </div>
        <button onClick={load} className="btn-secondary" style={{ fontSize: 10, padding: '2px 10px', marginLeft: 'auto' }}>Refresh</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.5 }}>
        Every posting the feed fetched and then dropped, and why. Scan the first groups for in-lane work that
        should not be here; the rate, payment, age and country groups are your own floors. Kept for {data ? data.retention_days : 7} days.
      </div>
      {err && <div style={{ fontSize: 11, color: '#ef4444' }}>{err}</div>}
      {data && !groups.length && <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>
        Nothing dropped in the last 24 h. The list fills on the next fetch.
      </div>}
      {groups.map(g => {
        const kind = reasonKind(g.reason)
        const isOpen = !!open[g.reason]
        const accent = kind === 'text' ? '#f59e0b' : '#9aa5b4'
        return (
          <div key={g.reason} style={{ marginBottom: 6 }}>
            <button
              onClick={() => setOpen(o => ({ ...o, [g.reason]: !o[g.reason] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent',
                       border: `1px solid ${accent}55`, borderRadius: 5, padding: '5px 9px', cursor: 'pointer', color: 'var(--text2)', fontSize: 11 }}
            >
              <span style={{ color: accent, fontWeight: 700 }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontWeight: 600 }}>{describeReason(g.reason)}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono, monospace)', color: accent, fontWeight: 700 }}>{g.count}</span>
            </button>
            {isOpen && (
              <ul style={{ listStyle: 'none', margin: '4px 0 6px', padding: '0 0 0 18px', maxHeight: 260, overflowY: 'auto' }}>
                {g.rows.map(r => (
                  <li key={r.upwork_job_id} style={{ fontSize: 11, lineHeight: 1.6 }}>
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ color: '#00c8d4', textDecoration: 'none' }}>{r.title || r.upwork_job_id}</a>
                  </li>
                ))}
                {g.count > g.rows.length && <li style={{ fontSize: 10, color: 'var(--text3)' }}>…and {g.count - g.rows.length} more</li>}
              </ul>
            )}
          </div>
        )
      })}
      {data && groups.length > 0 && !hasText && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>No keyword or stop-word drops: only your floors dropped anything.</div>
      )}
    </div>
  )
}
