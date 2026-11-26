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
import { Btn, Err, MoreMenu, Pill, card, input, lineColor } from './ui.jsx'
import { Empty } from './Marks.jsx'
import { enrichNextLabel, join, part, plural } from '../lib/resultLines.js'

const PAGE = 100
const STATUS_COLOR = { new: METRO.teal, junk: '#b36b00', suppressed: METRO.agencyLine, previously_contacted: '#7a5af8' }

export default function LeadsTab({ campaignId: pickedId, onCampaign, line = null, active = true, rev = 0, onCreateCampaign, onOpenBrief }) {
  const [campaigns, setCampaigns] = useState([])
  const [data, setData] = useState({ total: 0, counts: {}, leads: [] })
  const [pipe, setPipe] = useState(null)
  const [f, setF] = useState({ status: '', verdict: '', invite: '', has_email: '', q: '', enriched: '', sort: 'persona' })
  const [ticked, setTicked] = useState(new Set())
  const [limit, setLimit] = useState(PAGE)
  const [showImport, setShowImport] = useState(false)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [usable, setUsable] = useState(0)          // usable (status new) leads among the rows the filters show
  const [remaining, setRemaining] = useState(0)    // of those, the ones whose company is not enriched yet
  const [noDomain, setNoDomain] = useState(0)      // of the usable rows shown, the ones whose company has no domain
  const [lastRun, setLastRun] = useState(null)     // when the last enrich run started (the "just enriched" mark)
  const [plans, setPlans] = useState(null)           // what "Enrich next N" would take: companies with a domain first
  const [confirmAll, setConfirmAll] = useState(false)
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
    for (const k of ['status', 'verdict', 'invite', 'has_email', 'q', 'enriched']) if (f[k] !== '') p.set(k, f[k])
    return p
  }, [campaignId, f])

  // What "Enrich next N" takes: the same filters (not status / enriched, the backend forces those) and the chosen sort.
  const nextParams = useCallback(() => {
    const p = new URLSearchParams()
    for (const k of ['verdict', 'invite', 'has_email', 'q']) if (f[k] !== '') p.set(k, f[k])
    p.set('sort', f.sort)
    return p
  }, [f])

  const load = useCallback(async () => {
    if (!campaignId) return
    const p = filterParams()
    p.set('limit', limit); p.set('sort', f.sort)
    // usable rows among the shown ones, and how many of those are not enriched yet (status is forced to new)
    const u = filterParams(); u.set('limit', 1)
    const noStatus = f.status !== '' && f.status !== 'new'
    u.set('status', 'new')
    const r = new URLSearchParams(u); r.set('enriched', 'no')
    const nd = new URLSearchParams(u); nd.set('domain', 'no'); nd.set('enriched', 'yes')
    try {
      const [d, pl, uu, rr, nn, pn] = await Promise.all([api(`/leads?${p}`), api(`/campaigns/${campaignId}/pipeline`),
        noStatus ? { total: 0 } : api(`/leads?${u}`), noStatus ? { total: 0 } : api(`/leads?${r}`), noStatus ? { total: 0 } : api(`/leads?${nd}`),
        api(`/campaigns/${campaignId}/enrich-next?${nextParams()}&ns=20,50`)])
      setData(d); setPipe(pl); setUsable(uu.total); setRemaining(rr.total); setNoDomain(nn.total); setLastRun(d.last_run); setPlans(pn); setError('')
    } catch (e) { setError(e.message) }
  }, [campaignId, f, limit, filterParams, nextParams])
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t) }, [load])
  useEffect(() => { setTicked(new Set()) }, [campaignId, f.status, f.verdict, f.invite, f.has_email, f.q, f.enriched])
  // The progress dock shows the run; when it ends the table is read again so the new domains and marks appear.
  useEffect(() => {
    const h = () => { setTimeout(load, 1500) }
    window.addEventListener('metro-progress', h)
    return () => window.removeEventListener('metro-progress', h)
  }, [load])

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

  // F4 (item 2): every handler below RETURNS what it did (a line, or { kind: 'warn', text }) or throws; the Btn shows it in a notice that stays,
  // and a refused request shows its reason by itself (api.js). Nothing is said in a small line a page may scroll away.
  const decide = async (l, decision) => { await api(`/leads/${l.id}`, { method: 'PATCH', json: { decision } }); load() }
  const rescore = async () => {
    const ids = await targetIds()
    if (!ids.length) return { kind: 'warn', text: 'No leads shown, so there is nothing to rescore.' }
    await api(`/campaigns/${campaignId}/rescore`, { method: 'POST', json: { lead_ids: ids } })     // its result line is the header strip's
    load()
    return undefined
  }
  const runEnrich = async (ids, plan) => {
    if (!ids.length) return { kind: 'warn', text: 'Nothing to enrich in this view: every company here was tried already, or the filters hide them.' }
    const r = await api(`/campaigns/${campaignId}/enrich`, { method: 'POST', json: { lead_ids: ids } })
    setTick((x) => x + 1); load()
    window.dispatchEvent(new Event('metro-progress'))
    if (!r.started) return { kind: 'warn', text: `Enrich did not start: ${r.reason || 'the backend refused'}${r.current ? ` (it is on ${r.current})` : ''}` }
    return undefined          // a run that started is told by the header strip (item 5: one place per message)
  }
  // "Enrich all shown" above 50 companies asks first and shows the count.
  const enrich = async () => {
    const ids = await targetIds()
    if (eligible > 50 && !confirmAll) { setConfirmAll(eligible); return undefined }
    setConfirmAll(false)
    return runEnrich(ids)
  }
  const retryDomains = async (ids) => {
    const r = await api(`/campaigns/${campaignId}/retry-domain`, { method: 'POST', json: { lead_ids: ids } })
    setTick((x) => x + 1); load(); window.dispatchEvent(new Event('metro-progress'))
    return r.started ? undefined : { kind: 'warn', text: r.reason || 'Nothing was started' }
  }
  const retryShown = async () => {
    const p = filterParams(); p.set('status', 'new'); p.set('domain', 'no'); p.set('enriched', 'yes')
    const r = await api(`/leads/ids?${p}`)
    return retryDomains(ticked.size ? [...ticked] : r.ids)
  }
  // "Enrich next N": the next N COMPANIES of the current filter and sort that are not enriched yet. Companies with a domain come first,
  // the ones with no domain only after them (the backend decides, so the count on the button is what really runs).
  const enrichNext = async (n) => {
    const p = nextParams(); p.set('take', n); p.set('ns', '')
    const r = await api(`/campaigns/${campaignId}/enrich-next?${p}`)
    return runEnrich(r.lead_ids || [], r.plan)
  }
  const removeTicked = async () => {
    const r = await api(`/campaigns/${campaignId}/leads/remove`, { method: 'POST', json: { lead_ids: [...ticked] } })
    setConfirmRemove(false); setTicked(new Set()); load(); loadCampaigns()
    return join([part(r.removed, 'lead', 'leads', 'removed') || 'No lead removed', part(r.kept_with_history, 'lead', 'leads', 'kept (a message was sent or a reply came)')])
  }
  // The label of an "Enrich next N" button is plain (F5, Oleh 25 Nov): how many it will take. What those companies have is said in the small line.
  const nextLabel = (n) => enrichNextLabel(Math.min(n, plans?.plans?.[String(n)]?.companies ?? n))
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
        {campaign && <Btn kind="ghost" small onClick={() => onOpenBrief?.(campaign.id)} data-testid="open-brief"
          title="The campaign page: brief, offer, launch checklist, import records">Brief and settings</Btn>}
        <Err error={error} />
      </div>

      {!campaignId && (
        <div style={{ ...card, fontSize: 13, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }} data-testid="leads-empty">
          <Empty>{listed.length ? 'Choose a campaign above to see its leads and import a list, or start a new one.' : 'No campaign yet. Create one to import a list into.'}</Empty>
          <Btn onClick={() => onCreateCampaign?.()} data-testid="create-campaign">Create campaign</Btn>
        </div>
      )}

      {campaignId && pipe && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }} data-testid="pipeline">
          <Stage n="1" title="Import" line={`${pipe.import.leads} lead${pipe.import.leads === 1 ? '' : 's'} in this campaign`}
            sub={join([part(pipe.import.new, 'ready', 'ready'), part(pipe.import.junk, 'junk', 'junk'), part(pipe.import.suppressed, 'suppressed', 'suppressed'),
              part(pipe.import.previously_contacted, 'previously contacted', 'previously contacted')]).replace(/, /g, ' · ')}>
            <Btn small onClick={() => setShowImport(true)} data-testid="open-import">Import CSV</Btn>
          </Stage>
          <Stage n="2" title="Enrich" line={`${pipe.enrich.ready} ready`}
            sub={campaign?.type === 'agency' ? 'Domain and website scan, then the browser readings' : 'Domain, website scan and PageSpeed, then the browser readings'}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Btn small kind={remaining === 0 ? 'ghost' : 'primary'} onClick={() => enrichNext(20)} disabled={remaining === 0} data-testid="enrich-next-20"
                title="The next 20 companies of the current filter and sort that are not enriched yet. Companies with a website come first; the ones without a website only after them.">{nextLabel(20)}</Btn>
              <Btn key={50} small kind="ghost" onClick={() => enrichNext(50)} disabled={remaining === 0} data-testid="enrich-next-50"
                title="The next 50 companies, companies with a website first">{nextLabel(50)}</Btn>
              <MoreMenu testid="enrich-more">
                <Btn small kind="ghost" onClick={enrich} disabled={eligible === 0} title="Runs on the ticked rows, or on every row the filters show; above 50 it asks first." data-testid="enrich-btn">{ticked.size ? `Enrich ${eligible} ticked` : `Enrich all ${eligible} shown`}</Btn>
                {noDomain > 0 && <Btn small kind="ghost" onClick={retryShown} data-testid="retry-domains" title="Run the website finder again (name patterns, then an AI lookup with web search) for the companies in this view that were tried and still have no website">{`Retry domain (${ticked.size ? 'ticked' : `${noDomain} tried, not found`})`}</Btn>}
              </MoreMenu>
            </div>
            {confirmAll && (
              <div role="dialog" aria-label="Enrich all shown" data-testid="enrich-all-confirm" style={{ marginTop: 6, fontSize: 12, border: `1px solid ${METRO.agencyLine}`, borderRadius: 8, padding: '5px 8px' }}>
                Enrich all {confirmAll} companies in this view? It runs paced, about a minute per company at worst.
                <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}><Btn small onClick={enrich} data-testid="enrich-all-yes">Enrich {confirmAll}</Btn><Btn small kind="ghost" onClick={() => setConfirmAll(false)}>Cancel</Btn></span>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)', marginTop: 4 }} data-testid="enrich-remaining">
              {remaining === 0 ? 'Everything in this view is enriched' : `${remaining} not enriched yet in this view`}
              {plans?.pool && (plans.pool.with_domain > 0 || plans.pool.without_domain > 0) ? `: ${join([part(plans.pool.with_domain, 'company', 'companies', 'with a website'), part(plans.pool.without_domain, 'company', 'companies', 'not tried yet')])}` : ''}
            </div>
          </Stage>
          <Stage n="3" title="Write" line={`${pipe.write.ready} ready`} sub={`Arrives in Phase ${pipe.write.phase}`} />
          <Stage n="4" title="Send" line={`${pipe.send.ready} ready`} sub={`Phase ${pipe.send.phase}. Nothing is sent without a button and a confirm.`} />
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
            <select style={sel} value={f.enriched} onChange={setFilter('enriched')} aria-label="Enriched" data-testid="filter-enriched">
              <option value="">Enriched or not</option><option value="recent">just enriched (last run)</option><option value="yes">enriched</option><option value="no">not enriched yet</option>
            </select>
            <select style={sel} value={f.sort} onChange={setFilter('sort')} aria-label="Sort" data-testid="sort">
              <option value="persona">best persona first</option><option value="just_enriched">just enriched first</option><option value="name">name</option><option value="company">company</option><option value="newest">newest</option>
            </select>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700 }} data-testid="scope">
              {scope.n} {scope.what}{ticked.size ? ' (ticked)' : ''}
            </span>
            <MoreMenu testid="toolbar-more" align="right">
              <Btn kind="ghost" small onClick={rescore} data-testid="rescore-btn" title="Persona score (layer 0, from the CSV): run it again with the current persona rules, on the ticked rows or the rows shown. The fit score is worked out by itself after every enrich run and every browser reading.">{`Rescore persona (${scope.n} ${scope.what})`}</Btn>
            </MoreMenu>
            {lastRun && f.enriched !== 'recent' && <Btn kind="ghost" small onClick={() => setF({ ...f, enriched: 'recent', sort: 'just_enriched' })} data-testid="show-just-enriched" title="Only the companies the last enrich run touched">Show just enriched</Btn>}
            {ticked.size > 0 && !confirmRemove && <Btn kind="ghost" small onClick={() => setConfirmRemove(true)} data-testid="remove-ticked">{`Remove ${ticked.size} ticked`}</Btn>}
            {confirmRemove && (
              <span role="dialog" aria-label="Remove leads" data-testid="remove-dialog" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, border: `1px solid ${METRO.agencyLine}`, borderRadius: 8, padding: '3px 8px' }}>
                Remove {ticked.size} lead{ticked.size === 1 ? '' : 's'} from this campaign? Not undoable.
                <Btn small onClick={removeTicked} data-testid="confirm-remove">Remove</Btn><Btn small kind="ghost" onClick={() => setConfirmRemove(false)}>Keep</Btn>
              </span>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} data-testid="leads-table">
              <thead>
                <tr style={{ textAlign: 'left', color: METRO.teal, fontSize: 12 }}>
                  <th style={{ width: 28 }}><input type="checkbox" aria-label="Tick all shown" checked={shown.length > 0 && ticked.size === shown.length} onChange={toggleAll} /></th>
                  <th>Name</th><th>Title</th><th>Company</th><th>Website</th><th>Place</th><th>Persona</th><th>Fit</th><th>Linked Helper</th><th>Email</th><th>Status</th><th />
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
                    <td>{l.company_name}{l.just_enriched && <div><Pill color="#1a9d5c">just enriched</Pill></div>}</td>
                    <td style={{ fontSize: 12, maxWidth: 230 }} data-testid="domain-cell">
                      {l.domain ? <>{l.domain}<div style={{ fontSize: 10, color: 'rgba(0,12,14,0.5)' }}>{l.domain_source}</div></>
                        : l.company_id ? <>
                          <details className="mt-trail" data-testid="domain-trail">
                            <summary>{l.domain_why && l.domain_why !== 'not tried yet' ? 'no website · details' : 'no website · not tried yet'}</summary>
                            <div className="mt-trail-body" data-testid="domain-why">{l.domain_why}</div>
                          </details>
                          {l.status === 'new' && l.domain_why && l.domain_why !== 'not tried yet' && <Btn kind="ghost" small onClick={() => retryDomains([l.id])} data-testid="retry-domain-row">Retry domain</Btn>}
                        </> : '-'}
                    </td>
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
                    <td style={{ fontSize: 12 }}>{l.email ? <>{l.email}<div style={{ fontSize: 10, color: 'rgba(0,12,14,0.5)' }}>{l.email_source}, {emailStatusText(l)}{l.email_type === 'personal' ? ', personal (used only because there is no business address)' : ''}</div></> : '-'}
                      {l.open_profile && <div data-testid="open-profile-badge" title="Open Profile: can get a free InMail" style={{ display: 'inline-block', marginTop: 2, fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: 'rgba(0,128,128,0.12)', color: METRO.teal }}>Open Profile</div>}</td>
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
            {shown.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'rgba(0,12,14,0.6)' }}><Empty>No leads match. Import a CSV, or relax the filters.</Empty></div>}
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

// F4: the words for an address's status. "domain_ok" is the free DNS check: the DOMAIN accepts mail, the mailbox is not proven.
const emailStatusText = (l) => (l.email_status === 'verified' || l.email_verified ? 'verified'
  : l.email_status === 'domain_ok' ? 'domain accepts mail, not verified' : l.email_status === 'invalid' ? 'invalid (no such domain)' : 'unverified')

function Stage({ n, title, line, sub, children }) {
  return (
    <div style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${METRO.teal}` }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: METRO.teal, letterSpacing: '0.06em' }}>{n}. {title.toUpperCase()}</div>
      <div style={{ fontSize: 14, fontWeight: 800, margin: '4px 0 2px' }}>{line}</div>
      <div style={{ fontSize: 11, color: 'rgba(0,12,14,0.6)', minHeight: 28 }}>{sub}</div>
      {children && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}
