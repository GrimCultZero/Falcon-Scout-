// Small building blocks shared by the Metro tabs (IT Force colours, Manrope).
import { useEffect, useRef, useState } from 'react'
import '../metro.css'
import { METRO } from '../theme.js'
import { noticeFromResult, notices, notify } from '../lib/notices.js'

export const card = { background: '#fff', borderRadius: 12, border: '1px solid rgba(0,86,105,0.15)', padding: '18px 20px',
  boxShadow: '0 1px 2px rgba(0,12,14,0.05)' }

// F4 (items 2 and 3): the one button of Metro.
//   * While a request runs it is disabled and shows a spinner, so a click is never "lost" or doubled.
//   * What it did is said afterwards, where it cannot be missed (lib/notices.js, shown by NoticeHost): the handler returns a string
//     (a success line), { text, kind, detail } or nothing (then the thing that started shows in the header strip). A handler that
//     throws, or a request that is refused, shows its reason and stays until dismissed.
//   * Looks (metro.css): acid blue for the primary action, teal outline otherwise, a visible hover, a 120 ms press (nothing under
//     prefers-reduced-motion).
export function Btn({ children, onClick, kind = 'primary', disabled, title, small, busy: busyProp = false, className = '', ...rest }) {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])   // (re-armed: React StrictMode mounts, unmounts and mounts again)
  const what = typeof children === 'string' ? children : (rest['aria-label'] || title || 'The action')
  const fail = (err) => { if (!err || !err.notified) notify.error(`${String(what).slice(0, 60)}: ${(err && err.message) || 'it failed'}`) }
  const click = (e) => {
    if (busy || busyProp || disabled || !onClick) return
    let r
    try { r = onClick(e) } catch (err) { fail(err); return }
    if (r && typeof r.then === 'function') {
      setBusy(true)
      window.dispatchEvent(new Event('metro-click'))             // the header strip asks the backend now, so a run is seen at once
      r.then((v) => { const n = noticeFromResult(v); if (n) notices.push(n.kind, n.text, n.detail) }, fail)
        .finally(() => { if (alive.current) setBusy(false) })
    } else {
      const n = noticeFromResult(r)
      if (n) notices.push(n.kind, n.text, n.detail)
    }
  }
  const working = busy || busyProp
  return (
    <button type="button" onClick={click} disabled={disabled || working} title={title} aria-busy={working || undefined} {...rest}
      className={`mt-btn mt-btn--${kind === 'primary' ? 'primary' : 'ghost'}${small ? ' mt-btn--small' : ''}${working ? ' mt-btn--busy' : ''} ${className}`.trim()}
      style={{ fontFamily: METRO.font, ...(rest.style || {}) }}>
      {working && <span className="mt-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: METRO.teal, marginBottom: 4 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11, color: 'rgba(0,12,14,0.5)', marginTop: 3 }}>{hint}</span>}
    </label>
  )
}

export const input = { width: '100%', boxSizing: 'border-box', border: '1px solid rgba(0,86,105,0.3)', borderRadius: 8, padding: '7px 10px',
  fontFamily: METRO.font, fontSize: 13, color: METRO.ink, background: '#fff' }

export function Pill({ children, color = METRO.teal, solid }) {
  return (
    <span style={{ display: 'inline-block', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700,
      border: `1px solid ${color}`, background: solid ? color : 'transparent', color: solid ? '#fff' : color }}>{children}</span>
  )
}

export function Err({ error }) {
  return error ? <div role="alert" style={{ color: METRO.agencyLine, fontSize: 13, fontWeight: 600, margin: '8px 0' }}>{error}</div> : null
}

export const lineColor = (type) => (type === 'agency' ? METRO.agencyLine : METRO.nicheLine)

// F5 (item 7): the buttons that are rare, or that the app now does by itself, wait behind one small "More" button.
// A plain disclosure: click to open, click outside or Escape to close. The items are ordinary Btn buttons.
export function MoreMenu({ children, label = 'More', testid = 'more-menu', align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="mt-btn mt-btn--ghost mt-btn--small" aria-haspopup="menu" aria-expanded={open} data-testid={testid}
        onClick={() => setOpen((o) => !o)} style={{ fontFamily: METRO.font }}>{label} <span aria-hidden="true">{open ? '▴' : '▾'}</span></button>
      {open && (
        <div role="menu" className="mt-more" data-testid={`${testid}-items`} style={{ [align === 'right' ? 'right' : 'left']: 0 }} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </span>
  )
}
