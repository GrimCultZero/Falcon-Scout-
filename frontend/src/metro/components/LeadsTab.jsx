// Leads (METRO_PLAN.md Phase 1, step 5): the four pipeline cards (Import -> Enrich -> Write -> Send)
// over a table of the campaign's leads, with DevScout's rule "WHAT YOU SEE RUNS": there are no scope
// buttons. Every action applies to the rows the filters show, or to the ticked rows when any are
// ticked, and each button carries the number it will actually process. Phase 1 has one live action
// (Import); the other three show their counts and the phase that turns them on.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import ImportDialog from './ImportDialog.jsx'
import { Btn, Err, Pill, card, input, lineColor } from './ui.jsx'

const PAGE = 100
const STATUS_COLOR = { new: METRO.teal, junk: '#b36b00', suppressed: METRO.agencyLine }

export default function LeadsTab({ campaignId, onCampaign }) {
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

  useEffect(() => { api('/campaigns').then((j) => setCampaigns(j.campaigns)).catch((e) => setError(e.message)) }, [])
  const campaign = campaigns.find((c) => c.id === campaignId) || null

  const load = useCallback(async () => {
    if (!campaignId) return
    const p = new URLSearchParams({ campaign_id: campaignId, limit, sort: f.sort })
    for (const k of ['status', 'verdict', 'invite', 'has_email', 'q']) if (f[k] !== '') p.set(k, f[k])
    try {
      const [d, pl] = await Promise.all([api(`/leads?${p}`), api(`/campaigns/${campaignId}/pipeline`)])
      setData(d); setPipe(pl); setError('')
    } catch (e) { setError(e.message) }
  }, [campaignId, f, limit])
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t) }, [load])
  useEffect(() => { setTicked(new Set()) }, [campaignId, f.status, f.verdict, f.invite, f.has_email, f.q])

  const shown = data.leads
  const scope = ticked.size > 0 ? { n: ticked.size, what: 'ticked' } : { n: data.total, what: 'shown' }
  const eligible = useMemo(() => {
    const rows = ticked.size ? shown.filter((l) => ticked.has(l.id)) : shown
    return rows.filter((l) => l.status === 'new').length
  }, [shown, ticked])

  const decide = async (l, decision) => {
    try { await api(`/leads/${l.id}`, { method: 'PATCH', json: { decision } }); load() } catch (e) { setError(e.message) }
  }
  const rescore = async () => {
    try { const r = await api(`/campaigns/${campaignId}/rescore`, { method: 'POST' }); setNote(`Rescored: ${r.changed || 0} changed`); load() }
    catch (e) { setError(e.message) }
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
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.leads})</option>)}
        </select>
        {campaign && <Pill color={lineColor(campaign.type)}>{campaign.type} · {campaign.status}</Pill>}
        <Err error={error} />
      </div>

      {!campaignId && <div style={{ ...card, fontSize: 13 }}>Choose a campaign (or create one in Campaigns) to see its leads and import a list.</div>}

      {campaignId && pipe && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }} data-testid="pipeline">
          <Stage n="1" title="Import" line={`${pipe.import.leads} lead${pipe.import.leads === 1 ? '' : 's'} in this campaign`}
            sub={`${pipe.import.new} ready · ${pipe.import.junk} junk · ${pipe.import.suppressed} suppressed`}>
            <Btn small onClick={() => setShowImport(true)} data-testid="open-import">Import CSV</Btn>
          </Stage>
          <Stage n="2" title="Enrich" line={`${pipe.enrich.ready} ready`} sub={`Phase ${pipe.enrich.phase}`}>
            <Btn small disabled title="Enrichment arrives in Phase 2">{`Enrich ${eligible} ${scope.what}`}</Btn>
          </Stage>
          <Stage n="3" title="Write" line={`${pipe.write.ready} ready`} sub={`Phase ${pipe.write.phase}`}>
            <Btn small disabled title="Chain writing arrives in Phase 3">{`Write 0 ${scope.what}`}</Btn>
          </Stage>
          <Stage n="4" title="Send" line={`${pipe.send.ready} ready`} sub={`Phase ${pipe.send.phase}. Nothing is ever sent without a button press and a confirm.`}>
            <Btn small disabled title="Sending arrives in Phases 4-5">{`Send 0 ${scope.what}`}</Btn>
          </Stage>
        </div>
      )}

      {campaignId && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input style={{ ...sel, minWidth: 200 }} placeholder="Search name, title, company, place" value={f.q} onChange={setFilter('q')} />
            <select style={sel} value={f.status} onChange={setFilter('status')} aria-label="Status">
              <option value="">All statuses</option>
              {['new', 'junk', 'suppressed'].map((s) => <option key={s} value={s}>{s} ({data.counts[s] || 0})</option>)}
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
            <Btn kind="ghost" small onClick={rescore} title="Run layer 0 again with the current persona rules">Rescore</Btn>
            {note && <span style={{ fontSize: 12, color: '#1a9d5c' }}>{note}</span>}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid="leads-table">
              <thead>
                <tr style={{ textAlign: 'left', color: METRO.teal, fontSize: 12 }}>
                  <th style={{ width: 28 }}><input type="checkbox" aria-label="Tick all shown" checked={shown.length > 0 && ticked.size === shown.length} onChange={toggleAll} /></th>
                  <th>Name</th><th>Title</th><th>Company</th><th>Place</th><th>Persona</th><th>Linked Helper</th><th>Email</th><th>Status</th><th />
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
                    <td>{l.invite_status === 'connected' ? 'connected' : l.invite_status === 'invited' ? 'invited' : '-'}</td>
                    <td style={{ fontSize: 12 }}>{l.email ? <>{l.email}<div style={{ fontSize: 10, color: 'rgba(0,12,14,0.5)' }}>{l.email_source}{l.email_verified ? ', verified' : ', unverified'}</div></> : '-'}</td>
                    <td><Pill color={STATUS_COLOR[l.status] || METRO.teal}>{l.status}</Pill>
                      {l.suppressed_reason && <div style={{ fontSize: 10, color: 'rgba(0,12,14,0.55)', maxWidth: 160 }}>{l.suppressed_reason}</div>}</td>
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
        onDone={() => { load(); api('/campaigns').then((j) => setCampaigns(j.campaigns)) }} />}
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
