// Leads (METRO_PLAN.md Phase 1, step 5): the four pipeline cards (Import -> Enrich -> Write -> Send)
// over a table of the campaign's leads, with DevScout's rule "WHAT YOU SEE RUNS": there are no scope
// buttons. Every action applies to the rows the filters show, or to the ticked rows when any are
// ticked, and each button carries the number it will actually process. Phase 1 has one live action
// (Import); Enrich is live from Phase 2; Write and Send show their counts and the phase that turns them on.
// F1 (25 Nov): "what you see runs" is enforced in ONE place, `targetIds()`: ticked rows, else EVERY row the
// filters show (asked from the backend, not only the loaded page), never the whole campaign.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import ImportDialog from './ImportDialog.jsx'
import EnrichPanel from './EnrichPanel.jsx'
import { Btn, Err, Pill, card, input, lineColor } from './ui.jsx'

const PAGE = 100
const STATUS_COLOR = { new: METRO.teal, junk: '#b36b00', suppressed: METRO.agencyLine, previously_contacted: '#7a5af8' }

export default function LeadsTab({ campaignId: pickedId, onCampaign, line = null, active = true, rev = 0, onCreateCampaign }) {
  const [campaigns, setCampaigns] = useState([])
  const [data, setData] = useState({ total: 0, counts: {}, leads: [] })
  const [pipe, setPipe] = useState(null)
  const [f, setF] = useState({ status: '', verdict: '', invite: '', has_email: '', q: '', sort: 'persona' })
  const [ticked, setTicked] = useState(new Set())
  const [limit, setLimit] = useState(PAGE)
  const [showImport, setShowImport] = useState(false)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [tick, setTick] = useState(0)
  const [usable, setUsable] = useState(0)          // usable (status new) leads among the rows the filters show
  const [remaining, setRemaining] = useState(0)    // of those, the ones whose company is not enriched yet
  const [confirmRemove, setConfirmRemove] = useState(false)

  // The campaign list is read again every time this tab is shown and after any campaign change (create, delete, edit).
  const loadCampaigns = useCallback(() => api('/campaigns').then((j) => setCampaigns(j.campaigns)).catch((e) => setError(e.message)), [])
  useEffect(() => { if (active) loadCampaigns() }, [active, rev, loadCampaigns])
  // The header line filter: a picked campaign of the other line is not shown (it stays picked for when the filter is cleared).
  const picked = campaigns.find((c) => c.id === pickedId) || null
  const campaignId = picked && line && picked.type !== line ? null : pickedId
  const campaign = campaigns.find((c) => c.id === campaignId) || null
  const listed = campaigns.filter((c) => !line || c.type === line)

  // The filters as query parameters: the same for the table, the ids and the batch buttons.
  const filterParams = useCallback(() => {
    const p = new URLSearchParams({ campaign_id: campaignId })
    for (const k of ['status', 'verdict', 'invite', 'has_email', 'q']) if (f[k] !== '') p.set(k, f[k])
    return p
  }, [campaignId, f])

  const load = useCallback(async () => {
    if (!campaignId) return
    const p = filterParams()
    p.set('limit', limit); p.set('sort', f.sort)
    // usable rows among the shown ones, and how many of those are not enriched yet (status is forced to new)
    const u = filterParams(); u.set('limit', 1)
    const noStatus = f.status !== '' && f.status !== 'new'
    u.set('status', 'new')
    const r = new URLSearchParams(u); r.set('enriched', 'no')
    try {
      const [d, pl, uu, rr] = await Promise.all([api(`/leads?${p}`), api(`/campaigns/${campaignId}/pipeline`),
        noStatus ? { total: 0 } : api(`/leads?${u}`), noStatus ? { total: 0 } : api(`/leads?${r}`)])
      setData(d); setPipe(pl); setUsable(uu.total); setRemaining(rr.total); setError('')
    } catch (e) { setError(e.message) }
  }, [campaignId, f, limit, filterParams])
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t) }, [load])
  useEffect(() => { setTicked(new Set()) }, [campaignId, f.status, f.verdict, f.invite, f.has_email, f.q])

  const shown = data.leads
  const scope = ticked.size > 0 ? { n: ticked.size, what: 'ticked' } : { n: data.total, what: 'shown' }
  // How many a card button will really process: ticked rows that are usable, else the usable rows the filters show.
  const eligible = useMemo(() => (ticked.size ? shown.filter((l) => ticked.has(l.id) && l.status === 'new').length : usable),
    [shown, ticked, usable])

  // WHAT YOU SEE RUNS: the ticked ids, else every id the filters show. Never the whole campaign.
  const targetIds = useCallback(async () => {
    if (ticked.size) return [...ticked]
    const r = await api(`/leads/ids?${filterParams()}`)
    return r.ids
  }, [ticked, filterParams])

  const decide = async (l, decision) => {
    try { await api(`/leads/${l.id}`, { method: 'PATCH', json: { decision } }); load() } catch (e) { setError(e.message) }
  }
  const rescore = async () => {
    try {
      const ids = await targetIds()
      if (!ids.length) { setNote('No leads shown'); return }
      const r = await api(`/campaigns/${campaignId}/rescore`, { method: 'POST', json: { lead_ids: ids } })
      setNote(`Rescored ${ids.length}: ${r.changed || 0} changed`); load()
    } catch (e) { setError(e.message) }
  }
  const runEnrich = async (ids) => {
    if (!ids.length) { setNote('Nothing to enrich in this view'); return }
    try {
      const r = await api(`/campaigns/${campaignId}/enrich`, { method: 'POST', json: { lead_ids: ids } })
      setNote(r.started ? `Enriching ${r.total} companies (domain, website scan, PageSpeed; browser reads are queued)` : r.reason)
      setError(''); setTick((x) => x + 1); load()
    } catch (e) { setError(e.message) }
  }
  const enrich = async () => {
    try { await runEnrich(await targetIds()) } catch (e) { setError(e.message) }
  }
  // "Enrich next N": the best-scored usable leads of the current filter and sort whose company is not enriched yet, persona keep first.
  const enrichNext = async (n) => {
    try {
      const p = filterParams()
      p.set('status', 'new'); p.set('enriched', 'no'); p.set('keep_first', 'true'); p.set('sort', f.sort); p.set('limit', n)
      const r = await api(`/leads?${p}`)
      await runEnrich(r.leads.map((l) => l.id))
    } catch (e) { setError(e.message) }
  }
  const removeTicked = async () => {
    try {
      const r = await api(`/campaigns/${campaignId}/leads/remove`, { method: 'POST', json: { lead_ids: [...ticked] } })
      setNote(`Removed ${r.removed} lead${r.removed === 1 ? '' : 's'}${r.kept_with_history ? `; ${r.kept_with_history} kept (a message was sent or a reply came)` : ''}`)
      setConfirmRemove(false); setTicked(new Set()); load(); loadCampaigns()
    } catch (e) { setError(e.message); setConfirmRemove(false) }
  }
  const toggleAll = () => setTicked(ticked.size === shown.length ? new Set() : new Set(shown.map((l) => l.id)))

  const setFilter = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setLimit(PAGE) }
  const sel = { ...input, width: 'auto', padding: '5px 8px' }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select style={{ ...sel, minWidth: 240, fontWeight: 700 }} value={campaignId || ''} data-testid="leads-campaign"
          onChange={(e) => onCampaign(Number(e.target.value) || null)}>
          <option value="">Choose a campaign...</option>
          {listed.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.leads})</option>)}
        </select>
        {campaign && <Pill color={lineColor(campaign.type)}>{campaign.type} · {campaign.status}</Pill>}
        <Err error={error} />
      </div>

      {!campaignId && (
        <div style={{ ...card, fontSize: 13, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }} data-testid="leads-empty">
          <span>{listed.length ? 'Choose a campaign above to see its leads and import a list, or start a new one.' : 'No campaign yet. Create one to import a list into.'}</span>
          <Btn onClick={() => onCreateCampaign?.()} data-testid="create-campaign">Create campaign</Btn>
        </div>
      )}

      {campaignId && pipe && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }} data-testid="pipeline">
          <Stage n="1" title="Import" line={`${pipe.import.leads} lead${pipe.import.leads === 1 ? '' : 's'} in this campaign`}
            sub={`${pipe.import.new} ready · ${pipe.import.junk} junk · ${pipe.import.suppressed} suppressed · ${pipe.import.previously_contacted || 0} previously contacted`}>
            <Btn small onClick={() => setShowImport(true)} data-testid="open-import">Import CSV</Btn>
          </Stage>
          <Stage n="2" title="Enrich" line={`${pipe.enrich.ready} ready`} sub="Domain, website scan, PageSpeed; then browser reads">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn small onClick={enrich} disabled={eligible === 0} title="Domain, website scan and PageSpeed run on the backend, paced and cached per domain. Browser reads are queued and run only in a Metro week. Runs on the ticked rows, or on every row the filters show." data-testid="enrich-btn">{`Enrich ${eligible} ${scope.what}`}</Btn>
              {[20, 50].map((n) => (
                <Btn key={n} small kind="ghost" onClick={() => enrichNext(n)} disabled={remaining === 0} data-testid={`enrich-next-${n}`}
                  title="The best-scored leads in the current filter and sort whose company is not enriched yet (persona keep first)">{`Enrich next ${Math.min(n, remaining)}`}</Btn>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)', marginTop: 4 }} data-testid="enrich-remaining">{remaining} not enriched yet in this view</div>
          </Stage>
          <Stage n="3" title="Write" line={`${pipe.write.ready} ready`} sub={`Phase ${pipe.write.phase}`}>
            <Btn small disabled title="Chain writing arrives in Phase 3">{`Write 0 ${scope.what}`}</Btn>
          </Stage>
          <Stage n="4" title="Send" line={`${pipe.send.ready} ready`} sub={`Phase ${pipe.send.phase}. Nothing is ever sent without a button press and a confirm.`}>
            <Btn small disabled title="Sending arrives in Phases 4-5">{`Send 0 ${scope.what}`}</Btn>
          </Stage>
        </div>
      )}

      {campaignId && campaign && <EnrichPanel campaign={campaign} refreshKey={tick} onChanged={load} targetIds={targetIds}
        scope={scope} ticked={ticked.size > 0} />}

      {campaignId && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input style={{ ...sel, minWidth: 200 }} placeholder="Search name, title, company, place" value={f.q} onChange={setFilter('q')} />
            <select style={sel} value={f.status} onChange={setFilter('status')} aria-label="Status">
              <option value="">All statuses</option>
              {['new', 'junk', 'suppressed', 'previously_contacted'].map((s) => <option key={s} value={s}>{s} ({data.counts[s] || 0})</option>)}
            </select>
            <select style={sel} value={f.verdict} onChange={setFilter('verdict')} aria-label="Persona">
              <option value="">Any persona</option><option value="keep">keep</option><option value="review">review</option><option value="junk">junk</option>
            </select>
            <select style={sel} value={f.invite} onChange={setFilter('invite')} aria-label="Linked Helper">
              <option value="">Any Linked Helper state</option><option value="connected">connected</option><option value="invited">invited</option><option value="none">not invited</option>
            </select>
            <select style={sel} value={f.has_email} onChange={setFilter('has_email')} aria-label="Email">
              <option value="">Email or not</option><option value="true">has email</option><option value="false">no email</option>
            </select>
            <select style={sel} value={f.sort} onChange={setFilter('sort')} aria-label="Sort">
              <option value="persona">best persona first</option><option value="name">name</option><option value="company">company</option><option value="newest">newest</option>
            </select>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700 }} data-testid="scope">
              {scope.n} {scope.what}{ticked.size ? ' (ticked)' : ''}
            </span>
            <Btn kind="ghost" small onClick={rescore} title="Run layer 0 again with the current persona rules, on the ticked rows or the rows shown">Rescore</Btn>
            {ticked.size > 0 && !confirmRemove && <Btn kind="ghost" small onClick={() => setConfirmRemove(true)} data-testid="remove-ticked">{`Remove ${ticked.size} ticked`}</Btn>}
            {confirmRemove && (
              <span role="dialog" aria-label="Remove leads" data-testid="remove-dialog" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, border: `1px solid ${METRO.agencyLine}`, borderRadius: 8, padding: '3px 8px' }}>
                Remove {ticked.size} lead{ticked.size === 1 ? '' : 's'} from this campaign? Not undoable.
                <Btn small onClick={removeTicked} data-testid="confirm-remove">Remove</Btn><Btn small kind="ghost" onClick={() => setConfirmRemove(false)}>Keep</Btn>
              </span>
            )}
            {note && <span style={{ fontSize: 12, color: '#1a9d5c' }}>{note}</span>}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid="leads-table">
              <thead>
                <tr style={{ textAlign: 'left', color: METRO.teal, fontSize: 12 }}>
                  <th style={{ width: 28 }}><input type="checkbox" aria-label="Tick all shown" checked={shown.length > 0 && ticked.size === shown.length} onChange={toggleAll} /></th>
                  <th>Name</th><th>Title</th><th>Company</th><th>Place</th><th>Persona</th><th>Fit</th><th>Linked Helper</th><th>Email</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid rgba(0,86,105,0.1)', verticalAlign: 'top' }}>
                    <td><input type="checkbox" aria-label={`Tick ${l.full_name}`} checked={ticked.has(l.id)}
                      onChange={() => { const n = new Set(ticked); n.has(l.id) ? n.delete(l.id) : n.add(l.id); setTicked(n) }} /></td>
                    <td style={{ fontWeight: 700 }}>{l.profile_url
                      ? <a href={l.profile_url} target="_blank" rel="noreferrer" style={{ color: METRO.ink }}>{l.full_name || '(no name)'}</a> : (l.full_name || '(no name)')}</td>
                    <td style={{ maxWidth: 220 }}>{l.title}</td>
                    <td>{l.company_name}</td>
                    <td style={{ maxWidth: 150 }}>{l.location}</td>
                    <td>
                      <button type="button" onClick={() => setOpen(open === l.id ? null : l.id)} title="Why this score"
                        style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: METRO.font, fontWeight: 800,
                          color: l.persona_verdict === 'keep' ? '#1a9d5c' : l.persona_verdict === 'junk' ? '#b36b00' : METRO.teal }}>
                        {l.persona_score ?? '-'} {l.persona_verdict}{l.persona_locked ? ' (by hand)' : ''}
                      </button>
                      {open === l.id && <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11, color: 'rgba(0,12,14,0.7)' }}>
                        {l.persona_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                    </td>
                    <td title={l.deep_score != null ? `deep ${l.deep_score}` : ''}>{l.fit_score ?? '-'}</td>
                    <td>{l.invite_status === 'connected' ? 'connected' : l.invite_status === 'invited' ? 'invited' : '-'}</td>
                    <td style={{ fontSize: 12 }}>{l.email ? <>{l.email}<div style={{ fontSize: 10, color: 'rgba(0,12,14,0.5)' }}>{l.email_source}{l.email_verified ? ', verified' : ', unverified'}</div></> : '-'}</td>
                    <td><Pill color={STATUS_COLOR[l.status] || METRO.teal}>{l.status}</Pill>
                      {(l.suppressed_reason || l.prior_contact_reason) && <div style={{ fontSize: 10, color: 'rgba(0,12,14,0.55)', maxWidth: 160 }}>
                        {l.suppressed_reason || `previously contacted, kept: ${l.prior_contact_reason}`}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {l.status === 'junk' && <Btn kind="ghost" small onClick={() => decide(l, 'keep')}>Keep anyway</Btn>}
                      {l.status === 'new' && <Btn kind="ghost" small onClick={() => decide(l, 'junk')}>Mark junk</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(0,12,14,0.6)' }}>No leads match. Import a CSV, or relax the filters.</div>}
          </div>
          {data.total > shown.length && (
            <div style={{ marginTop: 10, textAlign: 'center' }}><Btn kind="ghost" small onClick={() => setLimit(limit + PAGE)}>Show more ({shown.length} of {data.total})</Btn></div>
          )}
        </div>
      )}

      {showImport && campaign && <ImportDialog campaign={campaign} onClose={() => setShowImport(false)}
        onDone={() => { load(); loadCampaigns() }} />}
    </div>
  )
}

function Stage({ n, title, line, sub, children }) {
  return (
    <div style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${METRO.teal}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: METRO.teal, letterSpacing: '0.06em' }}>{n}. {title.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 800, margin: '4px 0 2px' }}>{line}</div>
      <div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)', minHeight: 28 }}>{sub}</div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  )
}
