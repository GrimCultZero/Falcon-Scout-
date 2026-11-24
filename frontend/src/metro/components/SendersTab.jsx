// Senders (Phase 2: the LinkedIn account registry). Accounts register themselves from the Metro LinkedIn Scraper
// extension (it reads who is signed in from linkedin.com/feed; no extra visit). Here Oleh sets the role (only
// ONE account is the messenger), the daily visit cap (1-80) and whether an account is active. Mailboxes arrive
// in Phase 4.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Pill, card, input } from './ui.jsx'

export default function SendersTab() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api('/accounts').then((j) => { setData(j); setError('') }).catch((e) => setError(e.message)), [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])

  const patch = async (id, body) => {
    try { await api(`/accounts/${id}`, { method: 'PATCH', json: body }); load() } catch (e) { setError(e.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 980 }}>
      <div style={card} data-testid="accounts">
        <h3 style={{ margin: '0 0 4px', fontSize: 15, color: METRO.teal }}>LinkedIn accounts</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
          One Chrome profile per account, each with the Metro LinkedIn Scraper extension (folder <code>metro-linkedin</code>, load it at chrome://extensions).
          Open linkedin.com/feed once in a profile and it appears here. Today: {data ? `${data.visits} visits of ${data.cap}` : '...'}.
          Only one account is the messenger; the others only scrape. Visits are counted before they happen and can never pass the cap.
        </p>
        <Err error={error} />
        {data && data.accounts.length === 0 && <div style={{ fontSize: 13 }}>No account has registered yet.</div>}
        {(data?.accounts || []).map((a) => (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 150px 90px auto', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(0,86,105,0.1)', fontSize: 13 }}>
            <div><b>{a.label}</b><div style={{ fontSize: 11, color: 'rgba(0,12,14,0.55)' }}>{a.account_ref}{a.chrome_profile ? ` · ${a.chrome_profile}` : ''}</div></div>
            <div><select style={{ ...input, width: 'auto' }} value={a.role} onChange={(e) => patch(a.id, { role: e.target.value })} aria-label="Role">
              <option value="scraper">scraper</option><option value="messenger">messenger</option></select></div>
            <div>Visits <b>{a.visits_today}</b> of <b>{a.cap_today}</b>
              <div><input style={{ ...input, width: 70, padding: '3px 6px' }} type="number" min="1" max="80" defaultValue={a.daily_cap ?? ''} placeholder="default"
                aria-label="Daily cap" onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== a.daily_cap) patch(a.id, { daily_cap: v }) }} /></div></div>
            <div><Pill color={a.active ? '#1a9d5c' : 'rgba(0,12,14,0.5)'}>{a.active ? 'active' : 'off'}</Pill></div>
            <Btn kind="ghost" small onClick={() => patch(a.id, { active: !a.active })}>{a.active ? 'Switch off' : 'Switch on'}</Btn>
          </div>
        ))}
      </div>
    </div>
  )
}
