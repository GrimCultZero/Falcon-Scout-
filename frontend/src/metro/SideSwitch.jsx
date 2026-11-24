// Header switch "Falcon Scout | Metro". Shown in both headers; flipping it never reloads the page.
import { METRO } from './theme.js'

const SIDES = [
  { key: 'falcon', label: 'Falcon Scout' },
  { key: 'metro',  label: 'Metro' },
]

export default function SideSwitch({ side, onChange }) {
  return (
    <div role="tablist" aria-label="Falcon Scout or Metro" data-testid="side-switch"
      style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'rgba(0,0,0,0.28)',
        border: '1px solid rgba(55,187,213,0.35)', flexShrink: 0 }}>
      {SIDES.map(({ key, label }) => {
        const on = side === key
        return (
          <button key={key} type="button" role="tab" aria-selected={on} data-side={key}
            onClick={() => { if (!on) onChange(key) }}
            style={{ border: 'none', cursor: on ? 'default' : 'pointer', borderRadius: 999, padding: '5px 12px',
              fontFamily: METRO.font, fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
              background: on ? METRO.cyan : 'transparent', color: on ? METRO.ink : 'rgba(234,246,249,0.75)',
              transition: 'background 120ms, color 120ms' }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
