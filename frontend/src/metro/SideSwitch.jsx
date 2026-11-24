// Header switch "Falcon Scout | Metro" (METRO_PLAN.md Phase 0, step 5). Shown in both headers;
// flipping it never reloads the page. The active half is filled: dark on Falcon Scout, teal with
// white text on Metro. Each inactive half has a slot for a small cyan attention dot (something on
// the other side needs a look); the slot always takes its space so nothing shifts when it lights.
import { METRO, FALCON_DARK } from './theme.js'

const SIDES = [
  { key: 'falcon', label: 'Falcon Scout' },
  { key: 'metro',  label: 'Metro' },
]

export default function SideSwitch({ side, onChange, attention = {} }) {
  return (
    <div role="tablist" aria-label="Falcon Scout or Metro" data-testid="side-switch"
      style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'rgba(0,0,0,0.28)',
        border: '1px solid rgba(55,187,213,0.35)', flexShrink: 0 }}>
      {SIDES.map(({ key, label }) => {
        const on = side === key
        const fill = key === 'metro' ? METRO.teal : FALCON_DARK
        const dot = !on && !!attention[key]
        return (
          <button key={key} type="button" role="tab" aria-selected={on} data-side={key}
            title="Switch side (Ctrl+M)"
            onClick={() => { if (!on) onChange(key) }}
            style={{ border: 'none', cursor: on ? 'default' : 'pointer', borderRadius: 999, padding: '5px 12px',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: METRO.font, fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
              background: on ? fill : 'transparent', color: on ? '#ffffff' : 'rgba(234,246,249,0.75)',
              transition: 'background 120ms, color 120ms' }}>
            {label}
            <span data-attention-slot={key} data-attention={dot ? 'on' : 'off'} aria-hidden={!dot}
              style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: dot ? METRO.cyan : 'transparent' }} />
          </button>
        )
      })}
    </div>
  )
}
