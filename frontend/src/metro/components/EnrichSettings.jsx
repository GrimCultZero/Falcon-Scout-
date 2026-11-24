// Settings added in Phase 2: the enrichment settings (caps, shortlist threshold, cache lifetimes, the Linked Helper
// process names, the optional PageSpeed key) and the layer 1-2 fit rules (editable JSON, validated by the backend).
import { useEffect, useState } from 'react'
import { api, fromLines, toLines } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Field, card, input } from './ui.jsx'

export function EnrichSettings() {
  const [s, setS] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const adopt = (j) => {
    setS(j)
    setForm({ scrape_cap_per_day: j.scrape_cap_per_day, shortlist_min_fit: j.shortlist_min_fit,
      lh: toLines(j.linked_helper_process_names), cache: { ...(j.cache_days || {}) }, key: '' })
  }
  useEffect(() => { api('/settings').then(adopt).catch((e) => setError(e.message)) }, [])
  if (!form) return <div style={card}><Err error={error} /></div>
  const save = async (clearKey = false) => {
    const values = { scrape_cap_per_day: Number(form.scrape_cap_per_day), shortlist_min_fit: Number(form.shortlist_min_fit),
      linked_helper_process_names: fromLines(form.lh), cache_days: Object.fromEntries(Object.entries(form.cache).map(([k, v]) => [k, Number(v)])) }
    if (clearKey) values.pagespeed_api_key = null
    else if (form.key.trim()) values.pagespeed_api_key = form.key.trim()
    try { adopt(await api('/settings', { method: 'PUT', json: { values } })); setError(''); setSaved('Saved'); setTimeout(() => setSaved(''), 3000) }
    catch (e) { setError(e.message) }
  }
  return (
    <div style={card} data-testid="enrich-settings">
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: METRO.teal }}>Enrichment (Phase 2)</h3>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
        The week switch is in the header. Visits are capped per account; the cap here is the default for every account (1 to 80), and an account's own cap is set on the Senders tab.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
        <Field label="Daily visit cap (default)"><input style={input} type="number" min="1" max="80" value={form.scrape_cap_per_day} onChange={(e) => setForm({ ...form, scrape_cap_per_day: e.target.value })} /></Field>
        <Field label="Shortlist from fit score"><input style={input} type="number" min="0" max="100" value={form.shortlist_min_fit} onChange={(e) => setForm({ ...form, shortlist_min_fit: e.target.value })} /></Field>
        {Object.keys(form.cache).map((k) => (
          <Field key={k} label={`Reuse ${k.replace(/_/g, ' ')} reading (days)`}>
            <input style={input} type="number" min="1" max="365" value={form.cache[k]} onChange={(e) => setForm({ ...form, cache: { ...form.cache, [k]: e.target.value } })} />
          </Field>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Linked Helper process names" hint="A Metro week is refused while one of these runs (Windows process list). One per line.">
          <textarea style={{ ...input, minHeight: 54 }} value={form.lh} onChange={(e) => setForm({ ...form, lh: e.target.value })} />
        </Field>
        <Field label={`PageSpeed API key ${s.pagespeed_api_key?.set ? '(set)' : '(not set: the free anonymous quota is used)'}`}
          hint="Optional. Typed here only; never shown again, never logged.">
          <input style={input} type="password" autoComplete="off" placeholder={s.pagespeed_api_key?.set ? 'leave empty to keep it' : 'paste a key'} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
        </Field>
      </div>
      <Err error={error} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Btn onClick={() => save(false)}>Save</Btn>
        {s.pagespeed_api_key?.set && <Btn kind="ghost" onClick={() => save(true)}>Remove the PageSpeed key</Btn>}
        {saved && <span style={{ fontSize: 12, color: '#1a9d5c', fontWeight: 700 }}>{saved}</span>}
      </div>
    </div>
  )
}

export function FitRules() {
  const [text, setText] = useState('')
  const [defaults, setDefaults] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => { api('/fit-rules').then((j) => { setText(JSON.stringify(j.rules, null, 1)); setDefaults(j.defaults) }).catch((e) => setError(e.message)) }, [])
  const save = async () => {
    let body
    try { body = JSON.parse(text) } catch { setError('That is not valid JSON.'); return }
    try {
      const j = await api('/fit-rules', { method: 'PUT', json: body })
      setText(JSON.stringify(j.rules, null, 1)); setError(''); setSaved('Saved. Use Score on the Leads tab to apply it.'); setTimeout(() => setSaved(''), 4000)
    } catch (e) { setError(e.message) }
  }
  return (
    <div style={card} data-testid="fit-rules">
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: METRO.teal }}>Layers 1 and 2: fit rules</h3>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
        Each rule reads one stored, dated field (<code>website.signals.ga4</code>, <code>pagespeed.score</code>, <code>ads.running</code>, <code>gbp.review_count</code>,
        <code> ahrefs.dr</code>, <code>linkedin_company.employees_on_linkedin</code> ...), tests it (true, false, lt, lte, gt, gte, eq, contains_any, len_gte, len_lt) and adds points.
        A field that was never measured adds nothing and is reported as not measured. Layer 1 uses the website, PageSpeed, Ads Transparency and Business Profile; layer 2 uses Ahrefs (niche) and the LinkedIn company page.
      </p>
      <textarea style={{ ...input, minHeight: 260, fontFamily: 'Consolas, monospace', fontSize: 12 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <Err error={error} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <Btn onClick={save}>Save rules</Btn>
        <Btn kind="ghost" onClick={() => defaults && setText(JSON.stringify(defaults, null, 1))}>Load the defaults (then Save)</Btn>
        {saved && <span style={{ fontSize: 12, color: '#1a9d5c', fontWeight: 700 }}>{saved}</span>}
      </div>
    </div>
  )
}
