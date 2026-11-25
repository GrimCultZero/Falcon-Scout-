// Metro: the outbound side of Falcon Scout. The header (wagon mark, side switch, tabs, status chips)
// and five tabs: Campaigns, Leads and Settings work from Phase 1, Senders (LinkedIn accounts) from Phase 2; CRM arrives later.
import { useEffect, useRef, useState } from 'react'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import SideSwitch from './SideSwitch.jsx'
import CampaignsTab from './components/CampaignsTab.jsx'
import LeadsTab from './components/LeadsTab.jsx'
import SettingsTab from './components/SettingsTab.jsx'
import SendersTab from './components/SendersTab.jsx'
import WeekSwitch from './components/WeekSwitch.jsx'
import ProgressDock from './components/ProgressDock.jsx'
import NoticeHost from './components/NoticeHost.jsx'
import './metro.css'
import { takePending } from './lib/nav.js'
import { METRO } from './theme.js'
import { METRO_TABS, readMetroTab, writeMetroTab } from './lib/side.js'

const loadWeekRef = { current: () => {} }
const store = typeof window !== 'undefined' ? window.localStorage : null

const COMING = {
  crm:     'A card for every lead who replied. Arrives in Phase 4.',
}
const CAMPAIGN_KEY = 'falconscout.metro.campaign'

export default function MetroApp({ side, onSideChange, activityStrip = null }) {
  const [tab, setTab] = useState(() => readMetroTab(store))
  const [health, setHealth] = useState(null)
  const [week, setWeek] = useState(null)
  const [seen, setSeen] = useState(() => new Set([readMetroTab(store)]))
  const [campaignId, setCampaignId] = useState(() => Number(store?.getItem(CAMPAIGN_KEY)) || null)
  // F1: the header legend is a filter (null = both lines); campaignsRev says "the campaign list changed"
  // (Leads reloads it); wantNew asks the Campaigns tab to open its new-campaign form.
  const [line, setLine] = useState(null)
  const [campaignsRev, setCampaignsRev] = useState(0)
  const [wantNew, setWantNew] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/metro/health').then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setHealth(j) })
      .catch(() => { if (alive) setHealth({ ok: false }) })
    const loadWeek = () => fetch('/metro/week').then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setWeek(j) }).catch(() => {})
    loadWeek()
    loadWeekRef.current = loadWeek
    const t = setInterval(loadWeek, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const pick = (key) => { setTab(key); writeMetroTab(store, key); setSeen((x) => new Set(x).add(key)) }
  const chooseCampaign = (id) => { setCampaignId(id); try { store?.setItem(CAMPAIGN_KEY, id ? String(id) : '') } catch { /* not remembered */ } }
  const openLeads = (id) => { chooseCampaign(id); pick('leads') }
  const openBrief = (id) => { chooseCampaign(id); pick('campaigns') }
  // F4: a click on the header strip (from either side of the switch) asks for a tab and campaign through lib/nav.js
  const gotoRef = useRef(null)
  gotoRef.current = (t) => { if (!t) return; if (t.campaignId) chooseCampaign(t.campaignId); pick(t.tab || 'leads') }
  useEffect(() => {
    const first = takePending()
    if (first) gotoRef.current(first)
    const h = (e) => { takePending(); gotoRef.current(e.detail) }
    window.addEventListener('metro-goto', h)
    return () => window.removeEventListener('metro-goto', h)
  }, [])
  const campaignsChanged = () => setCampaignsRev((x) => x + 1)
  const createCampaign = () => { setWantNew(true); pick('campaigns') }
  const toggleLine = (k) => setLine((cur) => (cur === k ? null : k))

  return (
    <div data-testid="metro-app" style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: METRO.ice, color: METRO.ink, fontFamily: METRO.font, overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, height: 66, boxSizing: 'border-box', padding: '0 20px 0 14px', flexShrink: 0,
        background: `linear-gradient(90deg, ${METRO.ink} 0%, ${METRO.teal} 55%, ${METRO.ink} 100%)`,
        borderTop: `3px solid ${METRO.cyan}`, borderBottom: '1px solid rgba(55,187,213,0.35)' }}>
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
              <button key={key} type="button" role="tab" aria-selected={on} data-metro-tab={key} onClick={() => pick(key)} className="mt-tab"
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
          <WeekSwitch week={week} onChanged={() => loadWeekRef.current()} />
          <Chip testid="visits-chip" title="LinkedIn profile and company visits today against the daily cap, summed over active accounts. Counted before a visit is handed out, so it can never pass the cap.">
            Visits {week?.visits ?? 0} of {week?.cap ?? 60}
          </Chip>
          <span title="GET /metro/health" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%',
              background: health == null ? 'rgba(234,246,249,0.4)' : health.ok ? '#3ccf7a' : METRO.agencyLine }} />
            {health == null ? 'checking' : health.ok ? 'backend ok' : 'backend not reachable'}
          </span>
          <Line color={METRO.agencyLine} label="Agency line" on={line === 'agency'} dim={line === 'niche'} onClick={() => toggleLine('agency')} />
          <Line color={METRO.nicheLine} label="Niche line" on={line === 'niche'} dim={line === 'agency'} onClick={() => toggleLine('niche')} />
        </div>
      </header>
      {/* F4: what is running now, on every tab (the same strip sits under the Falcon Scout header) */}
      <div data-testid="metro-strip-slot" style={{ flexShrink: 0 }}>{activityStrip}</div>

      <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {METRO_TABS.map(({ key, label }) => (
          <section key={key} data-metro-panel={key} hidden={tab !== key}>
            {seen.has(key) && key === 'campaigns' && <CampaignsTab selected={campaignId} openCampaign={chooseCampaign} onOpenLeads={openLeads} line={line} onChanged={campaignsChanged}
              startNew={wantNew} onStartedNew={() => setWantNew(false)} />}
            {seen.has(key) && key === 'leads' && <LeadsTab campaignId={campaignId} onCampaign={chooseCampaign} line={line} active={tab === 'leads'} rev={campaignsRev}
              onCreateCampaign={createCampaign} onOpenBrief={openBrief} />}
            {seen.has(key) && key === 'settings' && <SettingsTab />}
            {seen.has(key) && key === 'senders' && <SendersTab />}
            {COMING[key] && (
              <div style={{ maxWidth: 720, background: '#fff', borderRadius: 12, border: '1px solid rgba(0,86,105,0.15)',
                padding: '22px 24px', boxShadow: '0 1px 2px rgba(0,12,14,0.05)' }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: METRO.teal }}>{label}</h2>
                <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, color: 'rgba(0,12,14,0.72)' }}>{COMING[key]}</p>
                <p style={{ margin: '14px 0 0', fontSize: 12, color: 'rgba(0,12,14,0.5)' }}>Nothing here yet.</p>
              </div>
            )}
          </section>
        ))}
      </main>
      <ProgressDock />
      <NoticeHost />
    </div>
  )
}

function Chip({ children, title, testid }) {
  return (
    <span title={title} data-testid={testid}
      style={{ border: '1px solid rgba(55,187,213,0.45)', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700,
        color: METRO.ice, background: 'rgba(55,187,213,0.12)' }}>{children}</span>
  )
}

function Line({ color, label, on, dim, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!on} data-testid={`line-${label.split(' ')[0].toLowerCase()}`}
      title={on ? 'Showing only this line. Click again to show both.' : 'Click to show only this line in Campaigns and Leads.'}
      style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: METRO.font, fontSize: 11,
        color: 'inherit', padding: '3px 9px', borderRadius: 999, opacity: dim ? 0.45 : 1,
        border: `1px solid ${on ? METRO.cyan : 'transparent'}`, background: on ? 'rgba(55,187,213,0.18)' : 'transparent',
        fontWeight: on ? 800 : 600 }}>
      <span style={{ width: 16, height: 4, borderRadius: 2, background: color }} />{label}
    </button>
  )
}
