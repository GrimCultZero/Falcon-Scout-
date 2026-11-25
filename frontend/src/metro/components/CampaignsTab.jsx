// Campaigns (METRO_PLAN.md Phase 1, steps 1 and 7): the list, a new-campaign form, and for the open
// campaign its brief, offer, launch kit (the "package" it runs with) and the launch checklist.
// Metro never edits LinkedIn: the checklist only records that a person did each manual step.
import { useCallback, useEffect, useState } from 'react'
import { api, fromLines, toLines } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Field, Pill, card, input, lineColor } from './ui.jsx'
import { templateFor } from '../lib/templates.js'

const fmt = (iso) => (iso ? new Date(iso + 'Z').toLocaleString() : '')

export default function CampaignsTab({ selected = null, openCampaign, onOpenLeads, line = null, onChanged, startNew = false, onStartedNew }) {
  const [list, setList] = useState(null)
  const [meta, setMeta] = useState({ types: ['agency', 'niche'], regions: ['US/CA', 'EU'] })
  const sel = selected                              // F4: the campaign shown on the right is the one MetroApp holds (Leads' "Brief and settings" sets it)
  const [creating, setCreating] = useState(false)      // false | 'choose' | 'agency' | 'niche'
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await api('/campaigns')
      setList(j.campaigns)
      setMeta({ types: j.types, regions: j.regions })
      setError('')
    } catch (e) { setError(e.message); setList([]) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (startNew) { setCreating('choose'); onStartedNew?.() } }, [startNew, onStartedNew])
  const changed = async () => { await load(); onChanged?.() }

  const pick = (id) => { openCampaign?.(id) }             // a freshly created campaign is shown here, to fill in its brief
  const openItsLeads = (id) => { setCreating(false); onOpenLeads?.(id) }   // F4: a click on a campaign in the list opens ITS leads

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <Btn onClick={() => setCreating('choose')} data-testid="new-campaign">New campaign</Btn>
        <Err error={error} />
        {list == null && <div style={{ fontSize: 13 }}>Loading...</div>}
        {list && list.length === 0 && !error && <div style={{ ...card, fontSize: 13 }}>No campaigns yet. Create the first one.</div>}
        {list && list.length > 0 && !(list || []).some((c) => !line || c.type === line) && (
          <div style={{ ...card, fontSize: 13 }}>No {line} campaigns. Click the {line} line in the header to show both.</div>)}
        {(list || []).filter((c) => !line || c.type === line).map((c) => (
          <button key={c.id} type="button" onClick={() => openItsLeads(c.id)} data-campaign={c.id} title="Open this campaign's leads. The brief and settings are one click away on the Leads page."
            style={{ ...card, textAlign: 'left', cursor: 'pointer', padding: '12px 14px', fontFamily: METRO.font,
              borderLeft: `5px solid ${lineColor(c.type)}`, outline: sel === c.id && !creating ? `2px solid ${METRO.cyan}` : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 14, color: METRO.ink }}>{c.name}</strong>
              <Pill color={c.status === 'active' ? '#1a9d5c' : METRO.teal} solid={c.status === 'active'}>{c.status}</Pill>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(0,12,14,0.6)', marginTop: 4 }}>
              {c.type}{c.region ? ` · ${c.region}` : ''}{c.month ? ` · ${c.month}` : ''} · {c.leads} lead{c.leads === 1 ? '' : 's'}
              {c.checklist_open > 0 && c.status !== 'draft' ? ` · ${c.checklist_open} launch step${c.checklist_open === 1 ? '' : 's'} open` : ''}
            </div>
          </button>
        ))}
      </div>
      <div>
        {creating === 'choose'
          ? <ChooseType onPick={setCreating} onCancel={() => setCreating(false)} />
          : creating
          ? <NewCampaign key={creating} type={creating} meta={meta} onCancel={() => setCreating(false)} onCreated={async (c) => { setCreating(false); await changed(); pick(c.id) }} />
          : sel && (list || []).some((c) => c.id === sel)
            ? <CampaignDetail key={sel} id={sel} meta={meta} onChanged={changed} onOpenLeads={onOpenLeads}
              onDeleted={async () => { openCampaign?.(null); await changed() }} />
            : <div style={{ ...card, fontSize: 13, color: 'rgba(0,12,14,0.6)' }}>Pick a campaign, or create one.</div>}
      </div>
    </div>
  )
}

function ChooseType({ onPick, onCancel }) {
  const opt = (type, title, text) => (
    <button type="button" data-testid={`choose-${type}`} onClick={() => onPick(type)}
      style={{ ...card, textAlign: 'left', cursor: 'pointer', fontFamily: METRO.font, borderLeft: `5px solid ${lineColor(type)}` }}>
      <strong style={{ fontSize: 15, color: METRO.ink }}>{title}</strong>
      <div style={{ fontSize: 12, color: 'rgba(0,12,14,0.65)', marginTop: 4 }}>{text}</div>
    </button>
  )
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, color: METRO.teal }}>New campaign: which line?</h2>
      {opt('agency', 'Agency line', 'Small digital marketing agencies that could resell or hand over delivery. Arrives with a ready brief you can edit.')}
      {opt('niche', 'Niche line', 'One industry per month (dental clinics, flower shops...). The brief is drafted from the niche and your case studies.')}
      <div><Btn kind="ghost" onClick={onCancel}>Cancel</Btn></div>
    </div>
  )
}

function NewCampaign({ type, meta, onCancel, onCreated }) {
  const tpl = templateFor(type)
  const [f, setF] = useState({ name: '', region: 'US/CA', month: '', offer: tpl.offer,
    who: tpl.who, pains: toLines(tpl.pains), case_tags: '', do_not_claim: toLines(tpl.do_not_claim) })
  const [caseStudies, setCaseStudies] = useState([])
  const [niche, setNiche] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    try {
      onCreated(await api('/campaigns', { method: 'POST', json: {
        name: f.name, type, region: f.region, month: type === 'niche' ? f.month || null : null, offer: f.offer,
        brief: { who: f.who, pains: fromLines(f.pains), case_tags: fromLines(f.case_tags), do_not_claim: fromLines(f.do_not_claim) },
        ...(caseStudies.length ? { launch_kit: { case_studies: caseStudies } } : {}),
      } }))
    } catch (e) { setError(e.message) }
  }
  // Draft the brief: through /claude from the niche and the KB's case studies. It only fills the form; nothing is saved.
  const draft = async () => {
    setDrafting(true); setError(''); setDraftNote('')
    try {
      const d = await api('/campaigns/draft-brief', { method: 'POST', json: { niche, region: f.region } })
      setF((cur) => ({ ...cur, who: d.who, pains: toLines(d.pains), case_tags: toLines(d.case_tags), do_not_claim: toLines(d.do_not_claim),
        offer: d.offer || cur.offer, name: cur.name || niche.trim() }))
      setCaseStudies(d.case_studies || [])
      setDraftNote(`Drafted from ${d.kb_case_studies} case studies. Nothing is saved until you press Create.${d.dropped?.length ? ` ${d.dropped.length} item(s) were dropped by the checks.` : ''}`)
    } catch (e) { setError(e.message) } finally { setDrafting(false) }
  }
  return (
    <div style={{ ...card, borderLeft: `5px solid ${lineColor(type)}` }} data-testid={`new-${type}`}>
      <h2 style={{ margin: '0 0 14px', fontSize: 18, color: METRO.teal }}>New {type} campaign</h2>
      {type === 'niche' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <div style={{ flex: 1 }}><Field label="Niche" hint="for example: dental clinics, US"><input style={input} value={niche} onChange={(e) => setNiche(e.target.value)} data-testid="niche-input" /></Field></div>
          <div style={{ marginBottom: 12 }}><Btn onClick={draft} disabled={!niche.trim() || drafting} data-testid="draft-brief">{drafting ? 'Drafting...' : 'Draft the brief'}</Btn></div>
        </div>
      )}
      {draftNote && <div style={{ fontSize: 12, color: '#1a9d5c', marginBottom: 10 }}>{draftNote}{caseStudies.length ? ` Case studies: ${caseStudies.map((c) => c.title).join('; ')}.` : ''}</div>}
      <Field label="Name"><input style={input} value={f.name} onChange={set('name')} placeholder={type === 'agency' ? 'USA CAN Claude' : 'Dental clinics, December'} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Region">
          <input style={input} list="metro-regions" value={f.region} onChange={set('region')} />
          <datalist id="metro-regions">{meta.regions.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        {type === 'niche' && <Field label="Month" hint="2026-12"><input style={input} value={f.month} onChange={set('month')} /></Field>}
      </div>
      <Field label="Who it is for"><textarea style={{ ...input, minHeight: 56 }} value={f.who} onChange={set('who')} data-testid="brief-who" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Assumed pains" hint="one per line"><textarea style={{ ...input, minHeight: 110 }} value={f.pains} onChange={set('pains')} /></Field>
        <Field label="Allowed case tags" hint="one per line"><textarea style={{ ...input, minHeight: 110 }} value={f.case_tags} onChange={set('case_tags')} /></Field>
        <Field label="Do not claim" hint="one per line"><textarea style={{ ...input, minHeight: 110 }} value={f.do_not_claim} onChange={set('do_not_claim')} /></Field>
      </div>
      <Field label="Offer"><textarea style={{ ...input, minHeight: 56 }} value={f.offer} onChange={set('offer')} placeholder="free mini-audit / pilot audit" /></Field>
      <Err error={error} />
      <div style={{ display: 'flex', gap: 8 }}><Btn onClick={save} disabled={!f.name.trim()}>Create</Btn><Btn kind="ghost" onClick={onCancel}>Cancel</Btn></div>
    </div>
  )
}

function CampaignDetail({ id, meta, onChanged, onOpenLeads, onDeleted }) {
  const [c, setC] = useState(null)
  const [form, setForm] = useState(null)
  const [imports, setImports] = useState([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [del, setDel] = useState(null)      // the counts the confirm pop-up shows

  const adopt = (j) => {
    setC(j)
    setForm({
      name: j.name, region: j.region || '', month: j.month || '', offer: j.offer || '',
      who: j.brief.who, pains: toLines(j.brief.pains), case_tags: toLines(j.brief.case_tags), do_not_claim: toLines(j.brief.do_not_claim),
      pv: { ...j.launch_kit.profile_variant, featured: toLines(j.launch_kit.profile_variant.featured) },
      case_studies: j.launch_kit.case_studies, sample_audits: j.launch_kit.sample_audits, notes: j.launch_kit.notes,
    })
  }
  useEffect(() => {
    api(`/campaigns/${id}`).then(adopt).catch((e) => setError(e.message))
    api(`/campaigns/${id}/imports`).then((j) => setImports(j.imports)).catch(() => {})
  }, [id])
  if (!c || !form) return <div style={card}>{error ? <Err error={error} /> : 'Loading...'}</div>

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setPv = (k) => (e) => setForm({ ...form, pv: { ...form.pv, [k]: e.target.value } })
  const save = async () => {
    try {
      const j = await api(`/campaigns/${id}`, { method: 'PATCH', json: {
        name: form.name, region: form.region, month: form.month || null, offer: form.offer,
        brief: { who: form.who, pains: fromLines(form.pains), case_tags: fromLines(form.case_tags), do_not_claim: fromLines(form.do_not_claim) },
        launch_kit: { profile_variant: { ...form.pv, featured: fromLines(form.pv.featured) }, case_studies: form.case_studies,
          sample_audits: form.sample_audits, notes: form.notes },
      } })
      adopt(j); setError(''); setSaved('Saved'); setTimeout(() => setSaved(''), 2000); onChanged()
    } catch (e) { setError(e.message) }
  }
  const act = async (path, json) => {
    try { adopt(await api(path, { method: 'POST', json })); setError(''); onChanged() } catch (e) { setError(e.message) }
  }
  const askDelete = async () => {
    try { setDel(await api(`/campaigns/${id}/delete-preview`)); setError('') } catch (e) { setError(e.message) }
  }
  const doDelete = async () => {
    try { await api(`/campaigns/${id}`, { method: 'DELETE' }); setDel(null); onDeleted?.() } catch (e) { setError(e.message); setDel(null) }
  }
  const setStatus = async (status) => {
    try { adopt(await api(`/campaigns/${id}`, { method: 'PATCH', json: { status } })); onChanged() } catch (e) { setError(e.message) }
  }

  const rows = (key, cols) => (
    <div style={{ display: 'grid', gap: 6 }}>
      {form[key].map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr) auto`, gap: 6 }}>
          {cols.map(([f, ph]) => (
            <input key={f} style={input} placeholder={ph} value={r[f] || ''}
              onChange={(e) => setForm({ ...form, [key]: form[key].map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)) })} />
          ))}
          <Btn kind="ghost" small onClick={() => setForm({ ...form, [key]: form[key].filter((_, j) => j !== i) })}>Remove</Btn>
        </div>
      ))}
      <div><Btn kind="ghost" small onClick={() => setForm({ ...form, [key]: [...form[key], {}] })}>Add</Btn></div>
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, borderLeft: `5px solid ${lineColor(c.type)}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 20, color: METRO.teal }}>{c.name}</h2>
          <Pill color={c.status === 'active' ? '#1a9d5c' : METRO.teal} solid={c.status === 'active'}>{c.status}</Pill>
          <span style={{ fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>{c.type}{c.region ? ` · ${c.region}` : ''} · {c.leads} leads</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Btn kind="ghost" small onClick={() => onOpenLeads?.(id)}>Open leads</Btn>
            {c.status === 'draft' && <Btn kind="ghost" small onClick={askDelete} data-testid="delete-campaign" title="Delete this draft campaign with its leads and import records">Delete campaign</Btn>}
            {c.status === 'active' && <Btn kind="ghost" small onClick={() => setStatus('paused')}>Pause</Btn>}
            {c.status !== 'done' && c.status !== 'draft' && <Btn kind="ghost" small onClick={() => setStatus('done')}>Mark done</Btn>}
          </span>
        </div>
        <Err error={error} />
        {del && (
          <div role="dialog" aria-label="Delete campaign" data-testid="delete-dialog"
            style={{ marginTop: 10, border: `1px solid ${METRO.agencyLine}`, borderRadius: 10, padding: '12px 14px', background: '#fff6f5' }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Delete "{del.campaign}"?</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              This removes <b>{del.leads}</b> lead{del.leads === 1 ? '' : 's'}, <b>{del.imports}</b> import record{del.imports === 1 ? '' : 's'}
              {del.hooks ? <>, {del.hooks} hook{del.hooks === 1 ? '' : 's'}</> : null}{del.touches ? <>, {del.touches} draft message{del.touches === 1 ? '' : 's'}</> : null}
              {del.queued_jobs ? <> and {del.queued_jobs} queued browser job{del.queued_jobs === 1 ? '' : 's'}</> : null}. It cannot be undone.
              The suppression list, the companies and everything on the Falcon Scout side are not touched.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Btn onClick={doDelete} data-testid="confirm-delete">Delete it</Btn><Btn kind="ghost" onClick={() => setDel(null)}>Keep it</Btn>
            </div>
          </div>
        )}
      </div>

      <div style={card} data-testid="launch-checklist">
        <h3 style={{ margin: '0 0 6px', fontSize: 15, color: METRO.teal }}>Launch checklist</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
          Manual steps on LinkedIn. Metro never edits LinkedIn; tick each one when you have done it, and the date is kept.
        </p>
        {c.checklist.items.map((it) => (
          <label key={it.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', fontSize: 13 }}>
            <input type="checkbox" checked={!!it.done_at} onChange={(e) => act(`/campaigns/${id}/checklist/${it.key}`, { done: e.target.checked })} />
            <span>{it.label}{it.done_at && <span style={{ color: '#1a9d5c', marginLeft: 8, fontSize: 11 }}>done {fmt(it.done_at)}</span>}</span>
          </label>
        ))}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          {c.status === 'active'
            ? <span style={{ fontSize: 12, color: '#1a9d5c', fontWeight: 700 }}>Started {fmt(c.started_at)}{c.checklist_open ? ` · ${c.checklist_open} step(s) still open` : ''}</span>
            : c.status === 'done' ? null
              : <Btn onClick={() => act(`/campaigns/${id}/start`)}>Start campaign{c.checklist_open ? ` (${c.checklist_open} step${c.checklist_open === 1 ? '' : 's'} open)` : ''}</Btn>}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: METRO.teal }}>Brief and offer</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <Field label="Name"><input style={input} value={form.name} onChange={set('name')} /></Field>
          <Field label="Region"><input style={input} list="metro-regions" value={form.region} onChange={set('region')} /></Field>
          {c.type === 'niche' && <Field label="Month"><input style={input} value={form.month} onChange={set('month')} placeholder="2026-12" /></Field>}
        </div>
        <Field label="Who it is for"><textarea style={{ ...input, minHeight: 56 }} value={form.who} onChange={set('who')} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Assumed pains" hint="one per line"><textarea style={{ ...input, minHeight: 90 }} value={form.pains} onChange={set('pains')} /></Field>
          <Field label="Allowed case tags" hint="one per line"><textarea style={{ ...input, minHeight: 90 }} value={form.case_tags} onChange={set('case_tags')} /></Field>
          <Field label="Do not claim" hint="one per line"><textarea style={{ ...input, minHeight: 90 }} value={form.do_not_claim} onChange={set('do_not_claim')} /></Field>
        </div>
        <Field label="Offer"><input style={input} value={form.offer} onChange={set('offer')} /></Field>
      </div>

      <div style={card}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, color: METRO.teal }}>Launch kit: the package this campaign runs with</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Field label="Profile variant name"><input style={input} value={form.pv.label} onChange={setPv('label')} placeholder="Agency partner variant" /></Field>
          <Field label="Headline"><input style={input} value={form.pv.headline} onChange={setPv('headline')} /></Field>
        </div>
        <Field label="About"><textarea style={{ ...input, minHeight: 90 }} value={form.pv.about} onChange={setPv('about')} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Banner"><input style={input} value={form.pv.banner} onChange={setPv('banner')} placeholder="file name or note" /></Field>
          <Field label="Featured items" hint="one per line"><textarea style={{ ...input, minHeight: 56 }} value={form.pv.featured} onChange={setPv('featured')} /></Field>
        </div>
        <Field label="Case studies it may use">{rows('case_studies', [['title', 'Title'], ['url', 'English case URL']])}</Field>
        <Field label="Sample audits it may use">{rows('sample_audits', [['title', 'Title'], ['note', 'Note']])}</Field>
        <Field label="Notes"><textarea style={{ ...input, minHeight: 56 }} value={form.notes} onChange={set('notes')} /></Field>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Btn onClick={save}>Save brief and kit</Btn>
          {saved && <span style={{ fontSize: 12, color: '#1a9d5c', fontWeight: 700 }}>{saved}</span>}
        </div>
      </div>

      {imports.length > 0 && (
        <div style={card}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, color: METRO.teal }}>Imports</h3>
          {imports.map((i) => (
            <div key={i.id} style={{ fontSize: 12, padding: '4px 0', borderTop: '1px solid rgba(0,86,105,0.1)' }}>
              {fmt(i.created_at)} · {i.filename} · <em>{i.list_source}</em> · {i.rows_read} rows
              {i.result ? ` · ${i.result.added} added, ${i.result.suppressed} suppressed, ${i.result.junk} junk` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
