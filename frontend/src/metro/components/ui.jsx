// Small building blocks shared by the Metro tabs (IT Force colours, Manrope).
import { METRO } from '../theme.js'

export const card = { background: '#fff', borderRadius: 12, border: '1px solid rgba(0,86,105,0.15)', padding: '18px 20px',
  boxShadow: '0 1px 2px rgba(0,12,14,0.05)' }

export function Btn({ children, onClick, kind = 'primary', disabled, title, small, ...rest }) {
  const primary = kind === 'primary'
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} {...rest}
      style={{ border: `1px solid ${primary ? METRO.teal : 'rgba(0,86,105,0.35)'}`, borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
        padding: small ? '4px 10px' : '8px 14px', fontFamily: METRO.font, fontSize: small ? 12 : 13, fontWeight: 700,
        background: disabled ? 'rgba(0,12,14,0.06)' : primary ? METRO.teal : '#fff', color: disabled ? 'rgba(0,12,14,0.4)' : primary ? '#fff' : METRO.teal }}>
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
