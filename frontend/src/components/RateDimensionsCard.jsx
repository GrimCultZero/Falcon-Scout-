import { useEffect, useState } from 'react'
import { rateText, isLowSample } from '../lib/calibration'

// Reply / open rate by one or more dimensions (T12 bid signals, T13 style variants). Reply rate is the headline, open
// rate secondary, n always shown, no rate under n = 10, "low sample" under n = 30 (same cell rules as the Calibration
// card; the numbers come from the same server-side function). Among jobs you applied to: a hint, not a gate.
export default function RateDimensionsCard({ url, testid, active = true }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!active) return
    fetch(url).then(r => { if (!r.ok) throw new Error('API error ' + r.status); return r.json() })
      .then(setData).catch(e => setError(e.message))
  }, [active, url])

  if (error) return <div style={{ color: 'var(--text3)', fontSize: 12 }}>Unavailable: {error}</div>
  if (!data) return <div style={{ color: 'var(--text3)', fontSize: 12 }}>Loading…</div>
  const minN = data.min_rate_n, lowN = data.low_sample_n
  return (
    <div data-testid={testid}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }} data-testid="rate-caption">{data.caption}</div>
      {data.dimensions.map(d => (
        <div key={d.key} style={{ marginBottom: 14 }} data-testid="rate-dimension" data-dimension={d.key}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            {d.label} {d.missing > 0 && <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {d.missing} without this snapshot</span>}
          </div>
          {!d.cells.length ? <div style={{ fontSize: 11, color: 'var(--text3)' }}>No proposals with this snapshot yet.</div> : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead><tr>
                <th style={th}></th><th style={{ ...th, textAlign: 'right' }}>n</th>
                <th style={{ ...th, textAlign: 'right' }}>Reply rate</th><th style={{ ...th, textAlign: 'right' }}>Open rate</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {d.cells.map(c => (
                  <tr key={c.key} data-testid="rate-row" data-n={c.n}>
                    <td style={td}>{c.key}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{c.n}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: 14 }} data-testid="reply-rate">{rateText(c, 'reply', minN)}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text3)' }} data-testid="open-rate">{rateText(c, 'open', minN)}</td>
                    <td style={{ ...td, color: '#f59e0b', fontSize: 11 }}>{isLowSample(c, lowN) ? 'low sample' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }} data-testid="rate-definition">{data.definition_note}</div>
    </div>
  )
}

const th = { textAlign: 'left', padding: '4px 8px', color: 'var(--text3)', fontWeight: 600, borderBottom: '1px solid var(--border)' }
const td = { padding: '4px 8px', borderBottom: '1px solid var(--border)' }
