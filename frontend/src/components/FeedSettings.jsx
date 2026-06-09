import { useEffect, useState } from 'react'

// Feed Settings — edit the Upwork API feed filter config (mirrors the bot's
// settings tab). Keywords + stop words drive per-keyword search and the hard
// post-filter; rate floors / country exclude / payment trim the results.
// Loads GET /feed-config, saves PUT /feed-config.

function ChipEditor({ label, hint, items, onChange, accent = '#00c8d4' }) {
  const [val, setVal] = useState('')
  const add = () => {
    const parts = val.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    const next = [...items]
    for (const p of parts) if (!next.some(x => x.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setVal('')
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {items.map((it) => (
          <span key={it} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
            padding: '2px 6px 2px 8px', borderRadius: 4,
            background: accent + '14', color: accent, border: `1px solid ${accent}40`,
          }}>
            {it}
            <button onClick={() => onChange(items.filter(x => x !== it))}
              style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
              title="Remove">×</button>
          </span>
        ))}
        {items.length === 0 && <span style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>none</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="add one or comma-separated…"
          style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 11, color: 'var(--text)', outline: 'none' }}
        />
        <button onClick={add} className="btn-secondary" style={{ fontSize: 11, padding: '4px 12px' }}>Add</button>
      </div>
    </div>
  )
}

export default function FeedSettings({ open, onClose, onSaved }) {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setMsg('')
    fetch('/feed-config').then(r => r.json()).then(setCfg).catch(() => setMsg('✗ could not load config'))
  }, [open])

  if (!open) return null
  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }))

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/feed-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
      })
      if (!res.ok) throw new Error('save failed')
      setCfg(await res.json())
      setMsg('✓ saved')
      if (onSaved) onSaved()
      setTimeout(() => { setMsg(''); onClose() }, 700)
    } catch { setMsg('✗ save failed') } finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 10,
        width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto',
        padding: '20px 22px', boxShadow: '0 12px 48px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: 0 }}>API Feed Settings</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>
          Controls the <b>API</b> feed only (the bot feed is unaffected). Each keyword runs its own
          Upwork search; results are merged, then filtered by the rules below.
        </p>

        {!cfg ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>{msg || 'Loading…'}</div> : (
          <>
            <ChipEditor label="Keywords" hint="One Upwork search per keyword. More keywords = more breadth."
              items={cfg.keywords || []} onChange={v => set('keywords', v)} />
            <ChipEditor label="Stop words" hint="Drop a job if its title/description contains any of these." accent="#ef4444"
              items={cfg.stop_words || []} onChange={v => set('stop_words', v)} />
            <ChipEditor label="Exclude countries" hint="Drop jobs from these client countries." accent="#f59e0b"
              items={cfg.exclude_countries || []} onChange={v => set('exclude_countries', v)} />

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'var(--text2)' }}>
                Min $/hr<br/>
                <input type="number" value={cfg.min_hourly ?? 0} onChange={e => set('min_hourly', Number(e.target.value))}
                  style={{ width: 80, marginTop: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--text2)' }}>
                Min $ fixed<br/>
                <input type="number" value={cfg.min_fixed ?? 0} onChange={e => set('min_fixed', Number(e.target.value))}
                  style={{ width: 80, marginTop: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--text2)' }}>
                Per-keyword limit<br/>
                <input type="number" value={cfg.per_keyword_limit ?? 20} onChange={e => set('per_keyword_limit', Number(e.target.value))}
                  style={{ width: 80, marginTop: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--text2)' }} title="0 = manual only. Otherwise the backend pulls fresh jobs on this interval, even with the dashboard closed.">
                Auto-fetch (min)<br/>
                <input type="number" value={cfg.auto_fetch_minutes ?? 0} onChange={e => set('auto_fetch_minutes', Number(e.target.value))}
                  style={{ width: 80, marginTop: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 12, color: 'var(--text)' }} />
              </label>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: -6, marginBottom: 14 }}>
              Auto-fetch: <b>{(cfg.auto_fetch_minutes ?? 0) > 0 ? `every ${cfg.auto_fetch_minutes} min (live)` : 'off (manual only)'}</b> — the backend pulls in the background so the API feed stays current like the bot.
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!cfg.require_keyword_in_text} onChange={e => set('require_keyword_in_text', e.target.checked)} />
              Require a keyword in the title/description (tightens the API's loose match)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 18, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!cfg.payment_verified_only} onChange={e => set('payment_verified_only', e.target.checked)} />
              Payment-verified clients only
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={save} disabled={saving} className="btn-primary" style={{ padding: '7px 18px', fontSize: 13 }}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              {msg && <span style={{ fontSize: 12, fontWeight: 600, color: msg.startsWith('✗') ? '#ef4444' : '#00d070' }}>{msg}</span>}
              <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}>Saved settings apply on the next ⤓ Fetch API.</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
