// Metro Settings (Phase 1): the layer 0 persona rules (editable), and the suppression list with the
// Upwork-derived candidates that wait for a decision. NOTHING is suppressed until a candidate is
// approved here, one by one. Week mode, caps and test mode are read-only for now (their controls come
// with the phases that use them).
import { useEffect, useState } from 'react'
import { api, fromLines, toLines } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Field, Pill, card, input } from './ui.jsx'

export default function SettingsTab() {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 980 }}>
      <Defaults />
      <Candidates />
      <PersonaRules />
    </div>
  )
}

function Defaults() {
  const [s, setS] = useState(null)
  useEffect(() => { api('/settings').then(setS).catch(() => setS({})) }, [])
  if (!s) return null
  return (
    <div style={card}>
      <h3 style={{ margin: '0 0 8px', fontSize: 15, color: METRO.teal }}>Safe defaults (read only for now)</h3>
      <div style={{ fontSize: 13, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <span>Week mode: <b>{s.week_mode === 'linked_helper' ? 'Linked Helper week' : 'Metro week'}</b></span>
        <span>Scrape cap: <b>{s.scrape_cap_per_day}</b>/day (max {s.scrape_cap_max})</span>
        <span>Email test mode: <b>{s.email_test_mode ? 'on' : 'OFF'}</b></span>
        <span>LinkedIn test mode: <b>{s.linkedin_test_mode ? 'on' : 'OFF'}</b></span>
      </div>
    </div>
  )
}

function Candidates() {
  const [list, setList] = useState(null)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const load = async () => {
    try {
      const [c, st] = await Promise.all([api('/suppression/candidates'), api('/suppression/stats')])
      setList(c.candidates); setStats(st)
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])
  const refresh = async () => {
    try { const r = await api('/suppression/candidates/refresh', { method: 'POST' }); setInfo(`${r.added} new domain(s) proposed`); await load() }
    catch (e) { setError(e.message) }
  }
  const decide = async (id, decision) => {
    try { await api(`/suppression/candidates/${id}/decision`, { method: 'POST', json: { decision } }); await load() } catch (e) { setError(e.message) }
  }
  const color = { pending: '#b36b00', approved: '#1a9d5c', rejected: 'rgba(0,12,14,0.5)' }
  return (
    <div style={card} data-testid="candidates">
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: METRO.teal }}>Suppression list</h3>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
        {stats ? `${stats.total} entries today (${Object.entries(stats.by_kind).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}). ` : ''}
        Domains found in your Upwork proposals are listed below as candidates. Nothing is suppressed until you approve it; a rejected domain stays rejected.
        Metro never imports Upwork clients as leads.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <Btn kind="ghost" small onClick={refresh}>Look for Upwork clients' domains</Btn>
        {info && <span style={{ fontSize: 12, color: '#1a9d5c' }}>{info}</span>}
      </div>
      <Err error={error} />
      {list && list.length === 0 && <div style={{ fontSize: 13 }}>No candidates yet.</div>}
      {(list || []).map((c) => (
        <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '190px 1fr auto', gap: 10, alignItems: 'start', padding: '8px 0', borderTop: '1px solid rgba(0,86,105,0.1)' }}>
          <div><b style={{ fontSize: 13 }}>{c.value}</b><div><Pill color={color[c.decision]}>{c.decision}</Pill></div></div>
          <div style={{ fontSize: 12, color: 'rgba(0,12,14,0.7)' }}>{c.evidence}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {c.decision !== 'approved' && <Btn small onClick={() => decide(c.id, 'approve')}>Suppress</Btn>}
            {c.decision === 'pending' && <Btn kind="ghost" small onClick={() => decide(c.id, 'reject')}>Not a client</Btn>}
          </div>
        </div>
      ))}
    </div>
  )
}

const LIST_FIELDS = [
  ['decision_maker', 'Decision maker words', 'In the title or headline: counts as a decision maker.'],
  ['senior', 'Senior words', 'Used when no decision maker word is present.'],
  ['junk_title', 'Junk words (title / headline)', 'Any hit marks the lead junk: freelancer, student, recruiter ...'],
  ['junk_text', 'Junk phrases (headline / summary)', '"open to work" and similar.'],
]

function PersonaRules() {
  const [rules, setRules] = useState(null)
  const [form, setForm] = useState(null)
  const [defaults, setDefaults] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const adopt = (r) => {
    setRules(r)
    setForm({
      keep_threshold: r.keep_threshold, weights: { ...r.weights },
      lists: Object.fromEntries(LIST_FIELDS.map(([k]) => [k, toLines(r[k])])),
      relevant: Object.fromEntries(Object.entries(r.relevant).map(([k, v]) => [k, toLines(v)])),
      geo: Object.fromEntries(Object.entries(r.geo).map(([k, v]) => [k, toLines(v)])),
    })
  }
  useEffect(() => { api('/persona-rules').then((j) => { adopt(j.rules); setDefaults(j.defaults) }).catch((e) => setError(e.message)) }, [])
  if (!form) return <div style={card}><Err error={error} /></div>

  const save = async () => {
    const body = {
      keep_threshold: Number(form.keep_threshold),
      weights: Object.fromEntries(Object.entries(form.weights).map(([k, v]) => [k, Number(v)])),
      ...Object.fromEntries(LIST_FIELDS.map(([k]) => [k, fromLines(form.lists[k])])),
      relevant: Object.fromEntries(Object.entries(form.relevant).map(([k, v]) => [k, fromLines(v)])),
      geo: Object.fromEntries(Object.entries(form.geo).map(([k, v]) => [k, fromLines(v)])),
    }
    try {
      adopt((await api('/persona-rules', { method: 'PUT', json: body })).rules)
      setError(''); setSaved('Saved. Use Rescore on the Leads tab to apply it to a campaign.'); setTimeout(() => setSaved(''), 4000)
    } catch (e) { setError(e.message) }
  }
  const area = (value, onChange, rows = 5) => <textarea style={{ ...input, minHeight: rows * 18 }} value={value} onChange={onChange} />

  return (
    <div style={card} data-testid="persona-rules">
      <h3 style={{ margin: '0 0 4px', fontSize: 15, color: METRO.teal }}>Layer 0: persona rules</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
        Scored from the CSV only: title, seniority, location, and junk patterns. A junk lead is kept and marked, never deleted. One item per line.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        <Field label="Keep from score"><input style={input} type="number" min="0" max="100" value={form.keep_threshold} onChange={(e) => setForm({ ...form, keep_threshold: e.target.value })} /></Field>
        {Object.keys(form.weights).map((k) => (
          <Field key={k} label={`Weight: ${k.replace(/_/g, ' ')}`}>
            <input style={input} type="number" value={form.weights[k]} onChange={(e) => setForm({ ...form, weights: { ...form.weights, [k]: e.target.value } })} />
          </Field>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {LIST_FIELDS.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={hint}>{area(form.lists[k], (e) => setForm({ ...form, lists: { ...form.lists, [k]: e.target.value } }))}</Field>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {Object.keys(form.relevant).map((k) => (
          <Field key={k} label={`Business words for ${k} campaigns`} hint="In the title, headline or company name.">
            {area(form.relevant[k], (e) => setForm({ ...form, relevant: { ...form.relevant, [k]: e.target.value } }))}
          </Field>
        ))}
        {Object.keys(form.geo).map((k) => (
          <Field key={k} label={`Places for region ${k}`} hint="A campaign whose region is named like this scores location against these words.">
            {area(form.geo[k], (e) => setForm({ ...form, geo: { ...form.geo, [k]: e.target.value } }))}
          </Field>
        ))}
      </div>
      <Err error={error} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Btn onClick={save}>Save rules</Btn>
        <Btn kind="ghost" onClick={() => defaults && adopt(defaults)}>Load the defaults (then Save)</Btn>
        {saved && <span style={{ fontSize: 12, color: '#1a9d5c', fontWeight: 700 }}>{saved}</span>}
      </div>
    </div>
  )
}
