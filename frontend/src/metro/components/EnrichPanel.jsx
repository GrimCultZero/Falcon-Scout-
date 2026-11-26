// Enrichment under the pipeline cards (METRO_PLAN.md Phase 2): run status, scoring, the SHORTLIST, the evidence
// and hooks of one lead (every hook shows the stored field it rests on and the date it was read), the queue of
// browser jobs, and the email-finder round trip with Linked Helper. Nothing here sends anything to anyone.
// F1: every button here runs on the ticked rows, or on the rows the filters show (`targetIds`), never on the whole campaign.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, MoreMenu, Pill, card } from './ui.jsx'
import { Empty } from './Marks.jsx'
import { join, part, queuedLine } from '../lib/resultLines.js'
import ImportDialog from './ImportDialog.jsx'

export default function EnrichPanel({ campaign, refreshKey, onChanged, targetIds, scope = { n: 0, what: 'shown' }, ticked = false }) {
  const cid = campaign.id
  const [st, setSt] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [sl, setSl] = useState(null)
  const [open, setOpen] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')            // only a failed background refresh; what a BUTTON did is said by the notices
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

  // What a button does is said in a notice that stays (ui.jsx Btn + lib/notices.js); a refused request says why by itself (api.js).
  const refresh = () => { load(); onChanged?.(); window.dispatchEvent(new Event('metro-progress')) }
  // Resolve the scope first; an empty scope runs nothing (the backend also treats an explicit empty list as "nobody").
  const scoped = (fn, msg) => async () => {
    const ids = await targetIds()
    if (!ids.length) return { kind: 'warn', text: 'No leads shown, so there is nothing to do. Change the filters or tick some rows.' }
    const r = await fn(ids)
    refresh()
    return typeof msg === 'function' ? msg(r) : msg
  }
  // F5 (item 2): the fit score is worked out by itself at the end of every enrich run and whenever a browser reading lands. This is
  // only for after a rules change in Settings. Its result line ("Scored fit for 12 leads") is the header strip's (item 5).
  const rescore = scoped((ids) => api(`/campaigns/${cid}/score`, { method: 'POST', json: { lead_ids: ids } }), () => undefined)
  const deep = scoped((ids) => api(`/campaigns/${cid}/deep`, { method: 'POST', json: { lead_ids: ids } }),
    (r) => (r.progress_id ? undefined : queuedLine(r.queued)))          // queued jobs are followed by a strip run; nothing queued has no run to say so
  const hooks = scoped((ids) => api(`/campaigns/${cid}/hooks`, { method: 'POST', json: { lead_ids: ids, shortlist_only: !ticked } }),
    (r) => (r.started ? undefined : { kind: 'warn', text: r.reason || 'Hooks were not started' }))
  const openLead = async (l) => {
    setOpen(l.id); setDetail(null)
    try { setDetail(await api(`/leads/${l.id}/evidence`)) } catch (e) { setError(e.message) }
  }
  const markEmail = async (l, status) => { await api(`/leads/${l.id}/email-status`, { method: 'POST', json: { status } }); load(); return `${l.email} marked ${status}` }

  // One short status for the browser jobs (F5, item 7); the per-kind detail is its tooltip.
  const kinds = jobs ? Object.entries(jobs.jobs) : []
  const sum = (key) => kinds.reduce((n, [, v]) => n + (v[key] || 0), 0)
  const waiting = sum('queued'), readDone = sum('done'), readFailed = sum('failed')
  const metroWeek = jobs?.week_mode === 'metro'
  const jobsLine = join([part(waiting, 'reading', 'readings', 'waiting'), part(readDone, 'reading', 'readings', 'done'), part(readFailed, 'reading', 'readings', 'failed')])
  const jobsDetail = kinds.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${join([part(v.queued, 'waiting', 'waiting'), part(v.done, 'done', 'done'), part(v.failed, 'failed', 'failed')]) || 'nothing yet'}`).join(' · ')

  return (
    <div style={card} data-testid="enrich-panel">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: METRO.teal }}>Enrichment and shortlist</h3>
        <Btn kind="ghost" small onClick={hooks} disabled={running || !sl?.shortlisted} title="Hooks, angle and case tag through /claude; every hook is checked against the stored fields. Ticked rows, or the shortlisted ones among the rows shown." data-testid="hooks-btn">Write hooks ({scope.n} {scope.what}{ticked ? '' : ', shortlisted only'})</Btn>
        <Btn kind="ghost" small onClick={() => setEmailDlg(true)} data-testid="emails-btn" title="The Linked Helper email-finder list for the ticked rows, or the shown rows that are shortlisted">Emails (Linked Helper)</Btn>
        <MoreMenu testid="panel-more" align="right">
          <Btn kind="ghost" small onClick={deep} title="Queue the LinkedIn pages and (niche) Ahrefs for the shortlisted leads among the ticked or shown rows. LinkedIn pages run only in a Metro week." data-testid="deep-btn">Queue deep readings ({scope.n} {scope.what}, shortlisted only)</Btn>
          <Btn kind="ghost" small onClick={rescore} title="The fit score is worked out by itself after every enrich run and every browser reading. Use this only after you changed the fit rules in Settings. Runs on the ticked rows, or on every row the filters show." data-testid="score-btn">Rescore fit ({scope.n} {scope.what})</Btn>
        </MoreMenu>
      </div>
      <Err error={error} />

      {jobsLine && (
        <div style={{ fontSize: 12, marginBottom: 8, color: 'rgba(0,12,14,0.7)' }} data-testid="browser-jobs" title={jobsDetail}>
          Browser readings: {jobsLine}{waiting > 0 && !metroWeek ? ' (waiting for a Metro week)' : ''}
        </div>
      )}

      {sl && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, margin: '4px 0 8px' }} data-testid="shortlist-count">
            Shortlist: {sl.shortlisted} of {sl.total_usable} usable leads (fit {sl.min_fit} or more{sl.measured ? `; ${sl.measured} scored so far` : ''})
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
              <Empty>Nobody is shortlisted yet. Enrich some leads: each run scores them by itself.</Empty></div>}
          </div>
        </>
      )}

      {open && (
        <div style={{ marginTop: 12, borderTop: `2px solid ${METRO.teal}`, paddingTop: 10 }} data-testid="evidence">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <b>Hooks and the stored evidence behind them</b>
            <Btn kind="ghost" small onClick={() => { setOpen(null); setDetail(null) }}>Close</Btn>
          </div>
          {!detail ? <div style={{ fontSize: 12 }}><Empty moving>Loading ...</Empty></div> : (
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
      {emailDlg && <EmailDialog campaign={campaign} targetIds={targetIds} ticked={ticked} scope={scope} onClose={() => setEmailDlg(false)} onDone={refresh} />}
    </div>
  )
}

// The email-finder round trip. Step 1 downloads the list for Linked Helper (a name with campaign, date and time, so it never
// overwrites a file you keep); step 3 is the ONE import dialog (it knows the finder's results). The free domain check is a run.
function EmailDialog({ campaign, targetIds, ticked, scope, onClose, onDone }) {
  const [prev, setPrev] = useState(null)
  const [ids, setIds] = useState(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  // The export follows "what you see runs": the ticked rows, else the shown rows that are shortlisted.
  useEffect(() => {
    let alive = true
    targetIds().then((x) => {
      if (!alive) return
      setIds(x)
      return api(`/campaigns/${campaign.id}/email-export/preview`, { method: 'POST', json: { lead_ids: x, shortlist_only: !ticked } }).then((p) => alive && setPrev(p))
    }).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [campaign.id, targetIds, ticked])
  const download = async () => {
    let r
    try {
      r = await fetch(`/metro/campaigns/${campaign.id}/email-export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: ids || [], shortlist_only: !ticked }) })
    } catch { throw new Error('Cannot reach the backend (is falconscout.bat running?)') }
    if (!r.ok) { let d = ''; try { d = (await r.json()).detail } catch { /* no body */ } throw new Error(`The list was refused: ${d || `${r.status} ${r.statusText}`}`) }
    // the backend names the file: campaign, what it is, date and time (never the same twice)
    const name = /filename="?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '')?.[1] || downloadName(campaign.name, 'linked-helper-email-list')
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a'); a.href = url; a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return `Saved ${name} to your Downloads folder (${prev?.exported ?? '?'} leads). Import it into Linked Helper as a list.`
  }
  const check = async () => {
    const r = await api(`/campaigns/${campaign.id}/email-check`, { method: 'POST' })
    onDone()
    return r.started ? undefined : { kind: 'warn', text: r.reason || 'Nothing to check' }
  }
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,12,14,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', width: 560, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto', fontSize: 13 }}>
        <h3 style={{ margin: '0 0 8px', color: METRO.teal }}>Emails through Linked Helper</h3>
        <ol style={{ margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.6 }}>
          <li><b>Export</b> the profile URLs of {ticked ? `the ${scope.n} ticked rows` : `the shortlisted ones among the ${scope.n} rows shown`}: {prev ? `${prev.exported} lead(s) without an email` : '...'}{prev && Object.keys(prev.skipped).length ? ` (skipped: ${Object.entries(prev.skipped).map(([k, n]) => `${n} ${k}`).join(', ')})` : ''}.
            <div><Btn small kind="ghost" onClick={download} disabled={!ids || !prev?.exported} data-testid="email-export-download">Download the Linked Helper list (CSV)</Btn></div></li>
          <li>In Linked Helper: import it as a list, run its email finder (Data credits), export the results.</li>
          <li><b>Import</b> the results with the same Import button as every other CSV. Emails are stored as <i>unverified</i>; only an address the provider calls verified, or one you mark, can ever be emailed.
            <div><Btn small onClick={() => setImporting(true)} data-testid="email-import-open">Import the results (CSV)</Btn></div></li>
        </ol>
        <Err error={error} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <Btn kind="ghost" small onClick={check} data-testid="email-check" title="Looks up each address's domain (free): does it accept mail? Marks it domain ok or invalid. It never marks an address verified.">Check the domains (free)</Btn>
          <Btn kind="ghost" onClick={onClose}>Close</Btn>
        </div>
      </div>
      {importing && <ImportDialog campaign={campaign} onClose={() => setImporting(false)} onDone={onDone} />}
    </div>
  )
}

// the same shape as the backend's api/metro/filenames.py, for the case the header cannot be read
function downloadName(campaign, what) {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  const slug = (s) => String(s || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'campaign'
  return `metro_${slug(campaign)}_${what}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`
}
