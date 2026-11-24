// Campaigns (METRO_PLAN.md Phase 1, steps 1 and 7): the list, a new-campaign form, and for the open
// campaign its brief, offer, launch kit (the "package" it runs with) and the launch checklist.
// Metro never edits LinkedIn: the checklist only records that a person did each manual step.
import { useCallback, useEffect, useState } from 'react'
import { api, fromLines, toLines } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Field, Pill, card, input, lineColor } from './ui.jsx'

const fmt = (iso) => (iso ? new Date(iso + 'Z').toLocaleString() : '')

export default function CampaignsTab({ openCampaign, onOpenLeads }) {
  const [list, setList] = useState(null)
  const [meta, setMeta] = useState({ types: ['agency', 'niche'], regions: ['US/CA', 'EU'] })
  const [sel, setSel] = useState(() => Number(window.localStorage.getItem('falconscout.metro.campaign')) || null)
  const [creating, setCreating] = useState(false)
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

  const pick = (id) => { setSel(id); window.localStorage.setItem('falconscout.metro.campaign', String(id)); openCampaign?.(id) }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <Btn onClick={() => setCreating(true)} data-testid="new-campaign">New campaign</Btn>
        <Err error={error} />
        {list == null && <div style={{ fontSize: 13 }}>Loading...</div>}
        {list && list.length === 0 && !error && <div style={{ ...card, fontSize: 13 }}>No campaigns yet. Create the first one.</div>}
        {(list || []).map((c) => (
          <button key={c.id} type="button" onClick={() => { setCreating(false); pick(c.id) }} data-campaign={c.id}
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
        {creating
          ? <NewCampaign meta={meta} onCancel={() => setCreating(false)} onCreated={async (c) => { setCreating(false); await load(); pick(c.id) }} />
          : sel && (list || []).some((c) => c.id === sel)
            ? <CampaignDetail key={sel} id={sel} meta={meta} onChanged={load} onOpenLeads={onOpenLeads} />
            : <div style={{ ...card, fontSize: 13, color: 'rgba(0,12,14,0.6)' }}>Pick a campaign, or create one.</div>}
      </div>
    </div>
  )
}

function NewCampaign({ meta, onCancel, onCreated }) {
  const [f, setF] = useState({ name: '', type: 'agency', region: 'US/CA', month: '', offer: '' })
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    try {
      onCreated(await api('/campaigns', { method: 'POST', json: { ...f, month: f.type === 'niche' ? f.month || null : null } }))
    } catch (e) { setError(e.message) }
  }
  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 14px', fontSize: 18, color: METRO.teal }}>New campaign</h2>
      <Field label="Name"><input style={input} value={f.name} onChange={set('name')} placeholder="US agencies, Medicine / Health December" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Type">
          <select style={input} value={f.type} onChange={set('type')}>{meta.types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </Field>
        <Field label="Region">
          <input style={input} list="metro-regions" value={f.region} onChange={set('region')} />
          <datalist id="metro-regions">{meta.regions.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        {f.type === 'niche' && <Field label="Month" hint="2026-12"><input style={input} value={f.month} onChange={set('month')} /></Field>}
      </div>
      <Field label="Offer"><input style={input} value={f.offer} onChange={set('offer')} placeholder="free mini-audit / pilot audit" /></Field>
      <Err error={error} />
      <div style={{ display: 'flex', gap: 8 }}><Btn onClick={save} disabled={!f.name.trim()}>Create</Btn><Btn kind="ghost" onClick={onCancel}>Cancel</Btn></div>
    </div>
  )
}

function CampaignDetail({ id, meta, onChanged, onOpenLeads }) {
  const [c, setC] = useState(null)
  const [form, setForm] = useState(null)
  const [imports, setImports] = useState([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

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
            {c.status === 'active' && <Btn kind="ghost" small onClick={() => setStatus('paused')}>Pause</Btn>}
            {c.status !== 'done' && c.status !== 'draft' && <Btn kind="ghost" small onClick={() => setStatus('done')}>Mark done</Btn>}
          </span>
        </div>
        <Err error={error} />
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
