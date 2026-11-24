// Metro: the outbound side of Falcon Scout. Phase 0 shows the shell only: the header with the
// wagon mark and the side switch, and five empty tabs (Campaigns, Leads, CRM, Senders, Settings).
import { useEffect, useState } from 'react'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import SideSwitch from './SideSwitch.jsx'
import { METRO } from './theme.js'
import { METRO_TABS, readMetroTab, writeMetroTab } from './lib/side.js'

const store = typeof window !== 'undefined' ? window.localStorage : null

const COMING = {
  campaigns: 'Agency and niche campaigns, each with its brief and offer. Arrives in Phase 1.',
  leads:     'Imported leads with persona and fit scores and the pipeline (Import, Enrich, Write, Send). Phase 1.',
  crm:       'A card for every lead who replied. Phase 4.',
  senders:   "Artem's LinkedIn account, scraper accounts and the mailbox, with caps and today's counters. Phases 2, 4, 5.",
  settings:  'Week mode, caps, test mode, the suppression list. Phase 0 stores the defaults; the controls come with the phases that use them.',
}

export default function MetroApp({ side, onSideChange }) {
  const [tab, setTab] = useState(() => readMetroTab(store))
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let alive = true
    fetch('/metro/health').then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setHealth(j) })
      .catch(() => { if (alive) setHealth({ ok: false }) })
    return () => { alive = false }
  }, [])

  const pick = (key) => { setTab(key); writeMetroTab(store, key) }

  return (
    <div data-testid="metro-app" style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: METRO.ice, color: METRO.ink, fontFamily: METRO.font, overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, height: 66, padding: '0 20px 0 14px', flexShrink: 0,
        background: `linear-gradient(90deg, ${METRO.ink} 0%, ${METRO.teal} 55%, ${METRO.ink} 100%)`,
        borderBottom: `2px solid ${METRO.cyan}` }}>
        <img src="/metro-wagon.svg" alt="Metro by IT Force" style={{ height: 40, width: 'auto', display: 'block' }} />
        <div style={{ lineHeight: 1.05 }}>
          <div style={{ fontWeight: 800, fontSize: 24, color: METRO.ice, letterSpacing: '0.01em' }}>Metro</div>
          <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(234,246,249,0.6)', letterSpacing: '0.08em', marginTop: 3 }}>
            BY IT FORCE
          </div>
        </div>
        <SideSwitch side={side} onChange={onSideChange} />
        <div style={{ width: 1, height: 22, background: 'rgba(55,187,213,0.3)' }} />
        <nav style={{ display: 'flex', gap: 6 }} role="tablist" aria-label="Metro tabs">
          {METRO_TABS.map(({ key, label }) => {
            const on = tab === key
            return (
              <button key={key} type="button" role="tab" aria-selected={on} data-metro-tab={key} onClick={() => pick(key)}
                style={{ border: `1px solid ${on ? METRO.cyan : 'rgba(55,187,213,0.25)'}`, borderRadius: 8, padding: '6px 13px',
                  cursor: 'pointer', fontFamily: METRO.font, fontSize: 13, fontWeight: 700,
                  background: on ? 'rgba(55,187,213,0.18)' : 'transparent', color: on ? METRO.ice : 'rgba(234,246,249,0.7)' }}>
                {label}
              </button>
            )
          })}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'rgba(234,246,249,0.75)',
          minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <Line color={METRO.agencyLine} label="Agency line" />
          <Line color={METRO.nicheLine} label="Niche line" />
          <span title="GET /metro/health" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%',
              background: health == null ? 'rgba(234,246,249,0.4)' : health.ok ? '#3ccf7a' : METRO.agencyLine }} />
            {health == null ? 'checking' : health.ok ? `backend ok, ${health.week_mode === 'linked_helper' ? 'Linked Helper' : 'Metro'} week` : 'backend not reachable'}
          </span>
        </div>
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: 28 }}>
        {METRO_TABS.map(({ key, label }) => (
          <section key={key} data-metro-panel={key} hidden={tab !== key}
            style={{ maxWidth: 720, background: '#fff', borderRadius: 12, border: '1px solid rgba(0,86,105,0.15)',
              padding: '22px 24px', boxShadow: '0 1px 2px rgba(0,12,14,0.05)' }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: METRO.teal }}>{label}</h2>
            <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, color: 'rgba(0,12,14,0.72)' }}>{COMING[key]}</p>
            <p style={{ margin: '14px 0 0', fontSize: 12, color: 'rgba(0,12,14,0.5)' }}>Nothing here yet.</p>
          </section>
        ))}
      </main>
    </div>
  )
}

function Line({ color, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 16, height: 4, borderRadius: 2, background: color }} />{label}
    </span>
  )
}
