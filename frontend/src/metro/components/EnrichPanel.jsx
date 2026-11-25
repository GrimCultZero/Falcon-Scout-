// Enrichment under the pipeline cards (METRO_PLAN.md Phase 2): run status, scoring, the SHORTLIST, the evidence
// and hooks of one lead (every hook shows the stored field it rests on and the date it was read), the queue of
// browser jobs, and the email-finder round trip with Linked Helper. Nothing here sends anything to anyone.
// F1: every button here runs on the ticked rows, or on the rows the filters show (`targetIds`), never on the whole campaign.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Pill, card, input } from './ui.jsx'

export default function EnrichPanel({ campaign, refreshKey, onChanged, targetIds, scope = { n: 0, what: 'shown' }, ticked = false }) {
  const cid = campaign.id
  const [st, setSt] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [sl, setSl] = useState(null)
  const [open, setOpen] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [emailDlg, setEmailDlg] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, j, l] = await Promise.all([api('/enrich/status'), api(`/jobs?campaign_id=${cid}`), api(`/campaigns/${cid}/shortlist`)])
      setSt(s); setJobs(j); setSl(l); setError('')
    } catch (e) { setError(e.message) }
  }, [cid])
  useEffect(() => { load() }, [load, refreshKey])
  const running = !!(st?.enrich?.running || st?.hooks?.running)
  useEffect(() => { if (!running) return undefined; const t = setInterval(load, 3000); return () => clearInterval(t) }, [running, load])
  // When a run ends, the Leads tab counts (how many are enriched, how many remain) are read again.
  const wasRunning = useRef(false)
  useEffect(() => { if (wasRunning.current && !running) onChanged?.(); wasRunning.current = running }, [running, onChanged])

  const act = async (fn, msg) => {
    try { const r = await fn(); setNote(typeof msg === 'function' ? msg(r) : msg); setError(''); load(); onChanged?.() } catch (e) { setError(e.message) }
  }
  // Resolve the scope first; an empty scope runs nothing (the backend also treats an explicit empty list as "nobody").
  const scoped = (fn, msg) => async () => {
    try {
      const ids = await targetIds()
      if (!ids.length) { setNote('No leads shown, nothing to do'); return }
      await act(() => fn(ids), msg)
    } catch (e) { setError(e.message) }
  }
  const score = scoped((ids) => api(`/campaigns/${cid}/score`, { method: 'POST', json: { lead_ids: ids } }), (r) => `Scored ${r.scored} leads`)
  const deep = scoped((ids) => api(`/campaigns/${cid}/deep`, { method: 'POST', json: { lead_ids: ids } }),
    (r) => `Queued for the browser: ${Object.entries(r.queued).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')} (LinkedIn jobs run only in a Metro week)`)
  const hooks = scoped((ids) => api(`/campaigns/${cid}/hooks`, { method: 'POST', json: { lead_ids: ids, shortlist_only: !ticked } }),
    (r) => r.started ? `Writing hooks for ${r.total} leads` : r.reason)
  const stop = () => act(() => api('/enrich/stop', { method: 'POST' }), 'Stopping after the current company')
  const openLead = async (l) => {
    setOpen(l.id); setDetail(null)
    try { setDetail(await api(`/leads/${l.id}/evidence`)) } catch (e) { setError(e.message) }
  }
  const markEmail = async (l, status) => {
    try { await api(`/leads/${l.id}/email-status`, { method: 'POST', json: { status } }); load() } catch (e) { setError(e.message) }
  }

  const en = st?.enrich
  const hk = st?.hooks
  const queued = jobs ? Object.entries(jobs.jobs).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v.queued || 0} waiting, ${v.done || 0} done${v.failed ? `, ${v.failed} failed` : ''}`) : []

  return (
    <div style={card} data-testid="enrich-panel">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: METRO.teal }}>Enrichment and shortlist</h3>
        <Btn kind="ghost" small onClick={score} title="Layer 1 and 2 from what is stored, with the rules in Settings. Runs on the ticked rows, or on every row the filters show." data-testid="score-btn">Score {scope.n} {scope.what}</Btn>
        <Btn kind="ghost" small onClick={deep} title="Queue the LinkedIn pages and (niche) Ahrefs for the shortlisted leads among the ticked or shown rows. LinkedIn pages run only in a Metro week." data-testid="deep-btn">Queue deep readings ({scope.n} {scope.what}, shortlisted only)</Btn>
        <Btn kind="ghost" small onClick={hooks} disabled={running || !sl?.shortlisted} title="Hooks, angle and case tag through /claude; every hook is checked against the stored fields. Ticked rows, or the shortlisted ones among the rows shown." data-testid="hooks-btn">Write hooks ({scope.n} {scope.what}{ticked ? '' : ', shortlisted only'})</Btn>
        <Btn kind="ghost" small onClick={() => setEmailDlg(true)}>Emails (Linked Helper)</Btn>
        {en?.running && <Btn kind="ghost" small onClick={stop}>Stop run</Btn>}
        {note && <span style={{ fontSize: 12, color: '#1a9d5c' }}>{note}</span>}
      </div>
      <Err error={error} />

      {en && (en.running || en.total > 0) && (
        <div style={{ fontSize: 12, marginBottom: 8 }} data-testid="run-status">
          Website, PageSpeed and domains: {en.done} of {en.total} companies{en.running ? `, now ${en.current || '...'}` : en.stopped ? ', stopped' : ', finished'}{en.failed ? `, ${en.failed} failed` : ''}.
        </div>
      )}
      {hk && (hk.running || hk.total > 0) && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>Hooks: {hk.done} of {hk.total} leads, {hk.hooks} hooks kept, {hk.rejected} thrown away by the checks{hk.failed ? `, ${hk.failed} failed` : ''}.</div>
      )}
      {queued.length > 0 && <div style={{ fontSize: 12, marginBottom: 8, color: 'rgba(0,12,14,0.7)' }}>Browser jobs ({jobs.week_mode === 'metro' ? 'Metro week' : 'Linked Helper week: none are handed out'}): {queued.join(' · ')}</div>}

      {sl && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px' }} data-testid="shortlist-count">
            Shortlist: {sl.shortlisted} of {sl.total_usable} usable leads (layer 1 at {sl.min_fit} or more; {sl.measured} measured so far)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} data-testid="shortlist-table">
              <thead><tr style={{ textAlign: 'left', color: METRO.teal, fontSize: 12 }}>
                <th>Person</th><th>Company / site</th><th>Fit</th><th>Deep</th><th>Why it scored</th><th>Hooks</th><th>Email</th></tr></thead>
              <tbody>
                {sl.leads.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid rgba(0,86,105,0.1)', verticalAlign: 'top' }}>
                    <td><b>{l.full_name}</b><div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)', maxWidth: 200 }}>{l.title}</div></td>
                    <td>{l.company_name}<div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)' }}>{l.domain ? `${l.domain} (${l.domain_source})` : 'no domain yet'}</div></td>
                    <td><b>{l.fit_score}</b><div style={{ fontSize: 10, color: 'rgba(0,12,14,0.5)' }}>{Math.round((l.fit_coverage || 0) * 100)}% measured</div></td>
                    <td>{l.deep_score ?? '-'}</td>
                    <td style={{ fontSize: 11, maxWidth: 260 }}>{l.fit_matched.slice(0, 3).join('; ')}</td>
                    <td><button type="button" onClick={() => openLead(l)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: METRO.font, fontWeight: 800, color: METRO.teal }}>
                      {l.hooks} hooks</button></td>
                    <td style={{ fontSize: 11 }}>{l.email ? <>{l.email}<div><Pill color={l.email_status === 'verified' ? '#1a9d5c' : '#b36b00'}>{l.email_status || 'unverified'}</Pill></div>
                      {l.email_status !== 'verified' && <Btn kind="ghost" small onClick={() => markEmail(l, 'verified')}>I verified it</Btn>}</> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sl.leads.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'rgba(0,12,14,0.6)' }}>
              Nobody is shortlisted yet. Run Enrich on the leads, then Score.</div>}
          </div>
        </>
      )}

      {open && (
        <div style={{ marginTop: 12, borderTop: `2px solid ${METRO.teal}`, paddingTop: 10 }} data-testid="evidence">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <b>Hooks and the stored evidence behind them</b>
            <Btn kind="ghost" small onClick={() => { setOpen(null); setDetail(null) }}>Close</Btn>
          </div>
          {!detail ? <div style={{ fontSize: 12 }}>Loading ...</div> : (
            <>
              {detail.angle && <p style={{ fontSize: 13 }}><b>Angle:</b> {detail.angle}{detail.case_tag ? ` · case tag: ${detail.case_tag}` : ''}</p>}
              {detail.hooks.length === 0 && <p style={{ fontSize: 12 }}>No hooks stored yet.</p>}
              {detail.hooks.map((h) => (
                <div key={h.id} style={{ padding: '6px 0', borderTop: '1px solid rgba(0,86,105,0.1)', fontSize: 13 }}>
                  {h.fact}
                  <div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)' }}>from <code>{h.source_field}</code> · read {h.seen_at}{h.source_ref ? ` · ${h.source_ref}` : ''}{h.used ? ' · used' : ''}</div>
                </div>
              ))}
              <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>All stored evidence ({detail.evidence.length})</summary>
                <table style={{ fontSize: 11, marginTop: 6 }}><tbody>{detail.evidence.map((e) => (
                  <tr key={e.id}><td style={{ paddingRight: 8 }}>{e.id}</td><td style={{ paddingRight: 8 }}><code>{e.path}</code></td><td style={{ paddingRight: 8 }}>{String(e.value).slice(0, 120)}</td><td>{e.at}</td></tr>))}</tbody></table>
              </details>
            </>
          )}
        </div>
      )}
      {emailDlg && <EmailDialog campaign={campaign} onClose={() => setEmailDlg(false)} onDone={() => { load(); onChanged?.() }} />}
    </div>
  )
}

function EmailDialog({ campaign, onClose, onDone }) {
  const [prev, setPrev] = useState(null)
  const [file, setFile] = useState(null)
  const [source, setSource] = useState('linkedhelper')
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api(`/campaigns/${campaign.id}/email-export/preview`).then(setPrev).catch((e) => setError(e.message)) }, [campaign.id])

  const send = async (dry) => {
    setBusy(true); setError('')
    try {
      const form = new FormData(); form.append('file', file)
      setRes(await api(`/campaigns/${campaign.id}/email-import?source=${source}&dry_run=${dry}`, { method: 'POST', form }))
      if (!dry) onDone()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const check = async () => { try { setRes({ check: await api(`/campaigns/${campaign.id}/email-check`, { method: 'POST' }) }); onDone() } catch (e) { setError(e.message) } }
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,12,14,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', width: 560, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto', fontSize: 13 }}>
        <h3 style={{ margin: '0 0 8px', color: METRO.teal }}>Emails through Linked Helper</h3>
        <ol style={{ margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>Export</b> the shortlist's profile URLs: {prev ? `${prev.exported} lead(s) without an email` : '...'}{prev && Object.keys(prev.skipped).length ? ` (skipped: ${Object.entries(prev.skipped).map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}.
            <div><a href={`/metro/campaigns/${campaign.id}/email-export`} style={{ color: METRO.teal, fontWeight: 700 }} download>Download the Linked Helper list (CSV)</a></div></li>
          <li>In Linked Helper: import it as a list, run its email finder (Data credits), export the results.</li>
          <li><b>Import</b> the results here. Emails are stored as <i>unverified</i>; only an address the provider calls verified, or one you mark, can ever be emailed.</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] || null); setRes(null) }} />
          <select style={{ ...input, width: 'auto' }} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="linkedhelper">Linked Helper</option><option value="apollo">Apollo (fallback)</option></select>
          <Btn small kind="ghost" disabled={!file || busy} onClick={() => send(true)}>Preview</Btn>
          <Btn small disabled={!file || busy || !res || res.dry_run !== true} onClick={() => send(false)}>Import</Btn>
        </div>
        <Err error={error} />
        {res && !res.check && <pre style={{ fontSize: 11, background: 'rgba(0,86,105,0.06)', padding: 8, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(res, null, 1)}</pre>}
        {res?.check && <div style={{ marginTop: 8 }}>Checked: {JSON.stringify(res.check)}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <Btn kind="ghost" small onClick={check} title="Syntax and DNS only; never marks an address verified">Check the domains (free)</Btn>
          <Btn kind="ghost" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  )
}
