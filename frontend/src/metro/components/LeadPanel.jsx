// The lead panel (METRO_PLAN.md Phase 3, step 5; Oleh's table layout of 25 Nov): a click on a row of the Leads table opens it.
// Top: a short summary of everything known (company facts, why it scored, the angle, channels, colleagues at the same company).
// Then the hooks with their evidence. Then the chain in send order (channel, day, text), editable, with the checks' flags and
// Approve / Send anyway (stored with its date). Nothing here sends anything.
// P3b (27 Nov): the chain is a WAVE (DevScout's shape): its ONE angle and the 2-3 facts it uses are shown above the messages, each
// message says its job, a failing wave says "Do not send as is", and "Change case" picks the case under the approach email (the
// cases matching the agency's client niche and the service first, then all).
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Logo, Pill, input } from './ui.jsx'
import { Empty } from './Marks.jsx'
import { chainPill, channelsText, sizeNote, touchHead, trackText } from '../lib/chainView.js'

const muted = { fontSize: 11.5, color: 'rgba(0,12,14,0.6)' }
const h4 = { margin: '16px 0 6px', fontSize: 12, fontWeight: 800, color: METRO.teal, letterSpacing: '0.05em', textTransform: 'uppercase' }

export default function LeadPanel({ leadId, onClose, onChanged, onOpenLead }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setD(await api(`/leads/${leadId}/panel`)); setError('') } catch (e) { setError(e.message) }
  }, [leadId])
  useEffect(() => { setD(null); load() }, [load])
  // a chain run finishing (the header strip) reloads the panel, so a rewrite shows up by itself
  useEffect(() => {
    const h = () => setTimeout(load, 1200)
    window.addEventListener('metro-progress', h)
    return () => window.removeEventListener('metro-progress', h)
  }, [load])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const changed = (chain) => { if (chain) setD((x) => (x ? { ...x, chain } : x)); onChanged?.() }
  const approve = async (sendAnyway) => {
    const r = await api(`/leads/${leadId}/chain/approve`, { method: 'POST', json: { send_anyway: !!sendAnyway } })
    changed(r.chain)
    return r.send_anyway ? 'Approved with Send anyway (the date is stored on the failing touches)' : 'Chain approved'
  }
  const unapprove = async () => { const r = await api(`/leads/${leadId}/chain/unapprove`, { method: 'POST' }); changed(r.chain); return 'Approval taken back' }
  const rewrite = async () => {
    const r = await api(`/leads/${leadId}/chain`, { method: 'POST' })
    window.dispatchEvent(new Event('metro-progress'))
    return r.started ? undefined : { kind: 'warn', text: r.reason || 'The chain was not started' }
  }
  const makePrimary = async () => { await api(`/leads/${leadId}/primary`, { method: 'POST' }); await load(); onChanged?.(); return 'This person is now the company\'s primary contact' }
  const decide = async (decision) => { await api(`/leads/${leadId}`, { method: 'PATCH', json: { decision } }); await load(); onChanged?.() }

  const lead = d?.lead
  const chain = d?.chain
  const pill = chainPill(chain?.status)
  const failing = chain?.touches?.some((t) => !t.checks_passed) || (chain?.notes?.chain_flags || []).length > 0
  const ch = channelsText(lead?.channels)
  return (
    <aside className="mt-panel" role="dialog" aria-label="Lead" data-testid="lead-panel">
      <div className="mt-panel-head">
        {lead && <Logo src={d?.company?.logo} name={lead.company_name} size={38} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{lead ? (lead.full_name || '(no name)') : 'Loading ...'}</div>
          {lead && <div style={muted}>{lead.title}{lead.company_name ? ` · ${lead.company_name}` : ''}{lead.location ? ` · ${lead.location}` : ''}</div>}
        </div>
        <button type="button" className="mt-panel-x" onClick={onClose} aria-label="Close the panel" data-testid="panel-close">×</button>
      </div>
      <div className="mt-panel-body">
        <Err error={error} />
        {!d ? <Empty moving>Loading ...</Empty> : (
          <>
            {/* summary */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-testid="panel-summary">
              <Pill color={METRO.teal}>fit {lead.fit_score ?? '-'}</Pill>
              <Pill color={METRO.teal}>persona {lead.persona_score ?? '-'} {lead.persona_verdict || ''}</Pill>
              <Pill color={lead.channels.email_sendable ? '#1a9d5c' : '#7a8a8e'}>{ch.email}</Pill>
              <Pill color={lead.channels.linkedin === 'connected' ? '#1a9d5c' : '#7a8a8e'}>{ch.linkedin}</Pill>
              {ch.extra && <Pill color={METRO.teal}>{ch.extra}</Pill>}
              {lead.account_role === 'held' && <Pill color="#8a6d00">held: same company</Pill>}
              {lead.account_role === 'primary' && d.colleagues.length > 0 && <Pill color={METRO.teal}>primary contact</Pill>}
            </div>
            {(chain?.notes?.angle || d.angle) && <p style={{ fontSize: 13, margin: '10px 0 0' }} data-testid="panel-angle"><b>Angle:</b> {chain?.notes?.angle || d.angle}</p>}
            <CompanyFacts c={d.company} />
            {d.why_scored.length > 0 && <div style={{ ...muted, marginTop: 6 }}><b>Why it scored:</b> {d.why_scored.slice(0, 5).join('; ')}</div>}
            {d.colleagues.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }} data-testid="panel-colleagues">
                <b>Same company:</b>{' '}
                {d.colleagues.map((c, i) => (
                  <span key={c.id}>{i > 0 ? ', ' : ''}<button type="button" className="mt-linkish" onClick={() => onOpenLead?.(c.id)}>{c.full_name || c.id}</button>
                    <span style={muted}> ({c.account_role === 'primary' ? 'primary' : 'held'})</span></span>
                ))}
                {lead.account_role === 'held' && <div style={{ marginTop: 4 }}><Btn small kind="ghost" onClick={makePrimary} data-testid="make-primary"
                  title="This person gets the chain instead; the current primary is held and its draft chain is cleared">Make this the primary contact</Btn></div>}
              </div>
            )}
            {lead.status === 'junk' && <div style={{ marginTop: 6 }}><Btn small kind="ghost" onClick={() => decide('keep')}>Keep anyway</Btn></div>}
            {lead.status === 'new' && <div style={{ marginTop: 6 }}><Btn small kind="ghost" onClick={() => decide('junk')}>Mark junk</Btn></div>}

            {/* hooks */}
            <div style={h4}>Hooks ({d.hooks.length})</div>
            {d.hooks.length === 0 && <div style={muted}>No hooks yet. "Write hooks" on the Enrichment card writes them for the shortlisted leads.</div>}
            {d.hooks.map((h) => (
              <details key={h.id} className="mt-hook" data-testid="panel-hook">
                <summary>
                  <span className="mt-hook-kind">{(h.kind || 'fact').replace(/_/g, ' ')}</span>
                  <span className="mt-hook-scope">{h.scope === 'company' ? 'company' : 'person'}</span>
                  {h.used && <span className="mt-hook-scope">in the chain</span>}
                  <div style={{ fontSize: 13, marginTop: 3 }}>{h.fact}</div>
                </summary>
                <div style={{ ...muted, padding: '4px 0 2px 4px' }}>
                  {(h.evidence && h.evidence.length ? h.evidence : [{ path: h.source_field, value: '', at: h.seen_at }]).map((e, i) => (
                    <div key={i}><code>{e.path}</code>{e.value ? ` = ${String(e.value).slice(0, 220)}` : ''} · read {e.at}</div>
                  ))}
                </div>
              </details>
            ))}

            {/* chain */}
            <div style={{ ...h4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Chain</span>
              <Pill color={pill.color}>{pill.label}</Pill>
              {chain?.track && <span style={{ ...muted, textTransform: 'none', letterSpacing: 0, fontWeight: 600 }} data-testid="chain-track">{trackText(chain.track, chain.notes)}</span>}
            </div>
            {chain?.notes?.facts?.length > 0 && (
              <div style={{ fontSize: 12, margin: '2px 0 6px' }} data-testid="chain-facts">
                <b>The facts this wave uses</b> <span style={muted}>(only these; the other hooks stay for the next wave)</span>
                <ol style={{ margin: '3px 0 0', paddingLeft: 18 }}>{chain.notes.facts.map((f) => <li key={f.id}>{f.fact} <span style={muted}>({String(f.kind || 'fact').replace(/_/g, ' ')})</span></li>)}</ol>
              </div>
            )}
            {chain?.touches?.length > 0 && lead.account_role !== 'held' && <CasePicker leadId={leadId} chain={chain} onChanged={changed} />}
            {chain?.notes?.plan?.waiting && <div className="mt-warn-line" data-testid="chain-waiting">{chain.notes.plan.waiting}</div>}
            {chain?.notes?.summary && <div style={{ fontSize: 12.5, margin: '4px 0 8px' }}>{chain.notes.summary}</div>}
            {failing && chain?.touches?.length > 0 && <div className="mt-donot" data-testid="do-not-send">Do not send as is: {(chain.notes?.chain_flags || []).map((f) => f.text).join('; ') || 'some messages fail their checks (marked below)'}</div>}
            {(chain?.notes?.issues || []).length > 0 && <div className="mt-warn-line">{chain.notes.issues.join('; ')}</div>}
            {lead.account_role === 'held' && <div style={muted}>Held: the company's primary contact gets the chain. This person is not written to until that chain ends.</div>}
            {chain?.touches?.length === 0 && lead.account_role !== 'held' && <div style={muted}>No chain yet. "Write chains" on the Write card writes it (or use Rewrite below).</div>}
            {chain?.touches?.map((t) => <Touch key={t.id} t={t} onSaved={changed} locked={!!t.approved_at} />)}
            {lead.account_role !== 'held' && lead.status === 'new' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(0,86,105,0.15)' }}>
                {chain?.touches?.length > 0 && !chain.status.state.startsWith('approved') && chain.status.state !== 'approved' && (failing
                  ? <Btn kind="secondary" onClick={() => approve(true)} data-testid="send-anyway" title="The checks failed. Approve anyway: the date is stored on every failing touch.">Send anyway</Btn>
                  : <Btn onClick={() => approve(false)} data-testid="approve">Approve</Btn>)}
                {chain?.status?.state === 'approved' && <Btn kind="ghost" onClick={unapprove} data-testid="unapprove">Take approval back</Btn>}
                {chain?.status?.state !== 'approved' && <Btn kind="ghost" onClick={rewrite} data-testid="rewrite" title="Write this lead's wave again (one call through /claude): one angle, 2-3 facts; a hand-picked case is kept">{chain?.touches?.length ? 'Rewrite chain' : 'Write chain'}</Btn>}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function CompanyFacts({ c }) {
  if (!c) return null
  const rows = [
    ['Sells', c.sells?.join(', ')],
    ['Gap', c.service_gap],
    ['Industries', [...(c.industries || []), ...(c.industries?.length ? [] : c.niches || [])].join(', ')],
    ['Badges', c.partners?.join(', ')],
    ['Their work', c.case_studies?.join('; ')],
    ['Careers', c.careers?.found ? (c.careers.ppc_seo_roles?.length ? `hiring: ${c.careers.ppc_seo_roles.join(', ')}` : 'careers page, no PPC / SEO role named') : ''],
    ['Founded', c.founded],
  ].filter(([, v]) => v)
  if (!rows.length && !c.domain) return null
  return (
    <table style={{ fontSize: 12, marginTop: 8, borderCollapse: 'collapse' }} data-testid="panel-company"><tbody>
      {c.domain && <tr><td style={{ ...muted, paddingRight: 8, verticalAlign: 'top' }}>Site</td><td>{c.domain}{c.industry ? ` · ${c.industry}` : ''}</td></tr>}
      {rows.map(([k, v]) => <tr key={k}><td style={{ ...muted, paddingRight: 8, verticalAlign: 'top' }}>{k}</td><td>{String(v)}</td></tr>)}
    </tbody></table>
  )
}

function Touch({ t, onSaved, locked }) {
  const [body, setBody] = useState(t.text)
  const [subject, setSubject] = useState(t.subject || '')
  useEffect(() => { setBody(t.text); setSubject(t.subject || '') }, [t.id, t.text, t.subject])
  const dirty = body !== t.text || (t.channel === 'email' && subject !== (t.subject || ''))
  const size = sizeNote(t.channel, body)
  const save = async () => {
    const r = await api(`/touches/${t.id}`, { method: 'PUT', json: { body, subject: t.channel === 'email' ? subject : undefined } })
    onSaved?.(r.chain)
    return r.ok ? 'Saved; the chain passes its checks' : { kind: 'warn', text: 'Saved; the chain still has flags (see the touches)' }
  }
  return (
    <div className={`mt-touch${t.checks_passed ? '' : ' mt-touch--bad'}`} data-testid="panel-touch" data-step={t.step}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <b style={{ fontSize: 12.5 }}>{touchHead(t)}</b>
        <span style={{ fontSize: 11, color: size.over ? METRO.errorText : 'rgba(0,12,14,0.5)' }}>{size.n} / {size.max} {size.unit}</span>
      </div>
      {t.channel === 'email' && !t.reply && <input style={{ ...input, marginTop: 6, fontWeight: 700 }} value={subject} disabled={locked} aria-label={`Subject of step ${t.step}`}
        onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />}
      {t.channel === 'email' && t.reply && <div style={{ ...muted, marginTop: 4 }}>A reply in the thread (Re: the subject above it)</div>}
      <textarea style={{ ...input, marginTop: 6, minHeight: t.channel === 'linkedin' ? 84 : 150, resize: 'vertical', lineHeight: 1.45 }} value={body} disabled={locked}
        aria-label={`Text of step ${t.step}`} onChange={(e) => setBody(e.target.value)} />
      {t.case && <div style={{ ...muted, marginTop: 3 }}>Case link added under the text by code: <a href={t.case.url} target="_blank" rel="noreferrer">{t.case.title}</a></div>}
      {t.hooks.length > 0 && <div style={{ ...muted, marginTop: 3 }}>Uses: {t.hooks.join(' | ')}</div>}
      {t.checks.length > 0 && <ul className="mt-flags">{t.checks.map((f, i) => <li key={i}>{f.text}</li>)}</ul>}
      {t.send_anyway_at && <div style={{ ...muted, color: METRO.errorText }}>Send anyway on {t.send_anyway_at.slice(0, 16).replace('T', ' ')}</div>}
      {dirty && !locked && <div style={{ marginTop: 6 }}><Btn small onClick={save} data-testid="touch-save">Save edit</Btn>
        <Btn small kind="ghost" onClick={() => { setBody(t.text); setSubject(t.subject || '') }}>Undo</Btn></div>}
    </div>
  )
}

// P3b (Oleh, 27 Nov): "Change case". The case under the approach email is matched by code on the agency's client NICHE and the
// SERVICE we pitch; here Oleh can pick another one (the matching cases first, then all of them) or go back to the automatic match.
// A hand pick is kept when the wave is rewritten.
function CasePicker({ leadId, chain, onChanged }) {
  const [opts, setOpts] = useState(null)
  const [open, setOpen] = useState(false)
  const cur = chain?.notes?.case
  useEffect(() => { if (open && !opts) api(`/leads/${leadId}/cases`).then(setOpts).catch(() => setOpts({ matching: [], others: [] })) }, [open, opts, leadId])
  const pickCase = async (id) => {
    const r = await api(`/leads/${leadId}/chain/case`, { method: 'POST', json: { case_id: id } })
    onChanged?.(r.chain)
    setOpen(false)
    return r.case ? `Case under the approach email: ${r.case.title}` : 'No case attached (nothing matches; pick one from the list)'
  }
  return (
    <div style={{ fontSize: 12, margin: '4px 0 8px' }} data-testid="case-picker">
      <b>Case:</b>{' '}
      {cur ? <a href={cur.url} target="_blank" rel="noreferrer">{cur.title}</a> : <span style={muted}>{chain?.notes?.case_note || 'none attached'}</span>}
      {chain?.notes?.case_by_hand && <span style={muted}> (picked by hand)</span>}
      {' '}<Btn small kind="ghost" onClick={() => setOpen((o) => !o)} data-testid="change-case">{open ? 'Close' : 'Change case'}</Btn>
      {open && (
        <div style={{ marginTop: 6, maxHeight: 240, overflow: 'auto', border: '1px solid rgba(0,86,105,0.2)', borderRadius: 8, padding: 6, background: '#fff' }}>
          {!opts ? <div style={muted}>Loading ...</div> : (
            <>
              <div style={{ ...muted, fontWeight: 700 }}>Matching their clients ({(opts.niches || []).join(', ') || 'not known'}) and the service ({opts.service || 'Google Ads and SEO'})</div>
              {opts.matching.length === 0 && <div style={muted}>No case matches both. Pick one below, or leave none.</div>}
              {opts.matching.map((c) => <CaseRow key={c.id} c={c} on={cur?.id === c.id} onPick={() => pickCase(c.id)} />)}
              <div style={{ ...muted, fontWeight: 700, marginTop: 6 }}>All other cases</div>
              {opts.others.map((c) => <CaseRow key={c.id} c={c} on={cur?.id === c.id} onPick={() => pickCase(c.id)} />)}
              {opts.by_hand && <div style={{ marginTop: 6 }}><Btn small kind="ghost" onClick={() => pickCase(null)}>Back to the automatic match</Btn></div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CaseRow({ c, on, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', borderTop: '1px solid rgba(0,86,105,0.08)' }} data-testid="case-option">
      <div style={{ flex: 1, minWidth: 0 }}>{c.title}<div style={muted}>{c.why}{c.country ? ` · ${c.country}` : ''}</div></div>
      {on ? <Pill color={METRO.teal}>attached</Pill> : <Btn small kind="ghost" onClick={onPick}>Use</Btn>}
    </div>
  )
}
