import { useEffect, useState } from 'react'
import { rateText, isLowSample, verdictOrder } from '../lib/calibration'

// Dashboard "Calibration" card (T9). Reply rate is the headline, open rate is secondary.
// Every regime is shown on its own (analyser before / after 2026-11-12), never pooled.
// Rates are among jobs you applied to; the card is a hint, not a gate.
function Rows({ cells, minN, lowN }) {
  return (cells || []).map(c => (
    <tr key={c.key} data-testid="calibration-row" data-n={c.n}>
      <td style={td}>{c.key}</td>
      <td style={{ ...td, textAlign: 'right' }}>{c.n}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: 14 }} data-testid="reply-rate">{rateText(c, 'reply', minN)}</td>
      <td style={{ ...td, textAlign: 'right', color: 'var(--text3)' }} data-testid="open-rate">{rateText(c, 'open', minN)}</td>
      <td style={{ ...td, color: '#f59e0b', fontSize: 11 }}>{isLowSample(c, lowN) ? 'low sample' : ''}</td>
    </tr>
  ))
}

export default function CalibrationCard({ active = true }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!active) return
    fetch('/calibration').then(r => { if (!r.ok) throw new Error('API error ' + r.status); return r.json() })
      .then(setData).catch(e => setError(e.message))
  }, [active])

  if (error) return <div style={{ color: 'var(--text3)', fontSize: 12 }}>Calibration unavailable: {error}</div>
  if (!data) return <div style={{ color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
  const minN = data.min_rate_n, lowN = data.low_sample_n
  return (
    <div data-testid="calibration-card">
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{data.caption}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }} data-testid="declined-note">{data.declined_note}</div>
      {!data.regimes.length && <div style={{ color: 'var(--text3)', fontSize: 12 }}>No analyser snapshots yet.</div>}
      {data.regimes.map(r => (
        <div key={r.regime} style={{ marginBottom: 16 }} data-testid="calibration-regime" data-regime={r.regime}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{r.label} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· n={r.n}</span></div>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>
              <th style={th}></th><th style={{ ...th, textAlign: 'right' }}>n</th>
              <th style={{ ...th, textAlign: 'right' }}>Reply rate</th><th style={{ ...th, textAlign: 'right' }}>Open rate</th><th style={th}></th>
            </tr></thead>
            <tbody>
              <Rows cells={[{ ...r.total, key: 'All' }]} minN={minN} lowN={lowN} />
              <Rows cells={verdictOrder(r.by_verdict).map(c => ({ ...c, key: 'Verdict: ' + c.key }))} minN={minN} lowN={lowN} />
              <Rows cells={r.by_band.map(c => ({ ...c, key: 'Score ' + c.key }))} minN={minN} lowN={lowN} />
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

const th = { textAlign: 'left', padding: '4px 8px', color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }
const td = { padding: '4px 8px', borderBottom: '1px solid var(--border)' }
