import { useEffect, useState } from 'react'
import { editPct, sharePct } from '../lib/editRatio'

// Dashboard "Edits before sending" card (T10, record-only). Per ISO week of the submission:
// the median edit ratio and the share of letters sent with under 10% edits, with n shown.
// n < 30 is a low sample.
function Row({ c, label }) {
  return (
    <tr data-testid="edit-row" data-n={c.n}>
      <td style={td}>{label}</td>
      <td style={{ ...td, textAlign: 'right' }}>{c.n}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: 14 }} data-testid="median-edit">{editPct(c)}</td>
      <td style={{ ...td, textAlign: 'right' }} data-testid="under10">{sharePct(c)}</td>
      <td style={{ ...td, color: '#f59e0b', fontSize: 11 }}>{c.low_sample ? 'low sample' : ''}</td>
    </tr>
  )
}

export default function EditRatioCard({ active = true }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!active) return
    fetch('/generations/stats').then(r => { if (!r.ok) throw new Error('API error ' + r.status); return r.json() })
      .then(setData).catch(e => setError(e.message))
  }, [active])

  if (error) return <div style={{ color: 'var(--text3)', fontSize: 12 }}>Edit stats unavailable: {error}</div>
  if (!data) return <div style={{ color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
  return (
    <div data-testid="edit-ratio-card">
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{data.note}</div>
      {!data.all.n && <div style={{ color: 'var(--text3)', fontSize: 12 }}>No sent letters with a recorded draft yet. Generate, send, and the first row appears.</div>}
      {data.all.n > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>
            <th style={th}></th><th style={{ ...th, textAlign: 'right' }}>n</th>
            <th style={{ ...th, textAlign: 'right' }}>Median edit</th><th style={{ ...th, textAlign: 'right' }}>Sent with &lt; 10% edits</th><th style={th}></th>
          </tr></thead>
          <tbody>
            <Row c={data.all} label="All time" />
            {[...data.weeks].reverse().map(w => <Row key={w.key} c={w} label={w.key} />)}
          </tbody>
        </table>
      )}
    </div>
  )
}

const th = { textAlign: 'left', padding: '4px 8px', color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }
const td = { padding: '4px 8px', borderBottom: '1px solid var(--border)' }
