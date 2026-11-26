// Metro opens where Oleh left it (Oleh, 26 Nov: "like DevScout: on reload the app restores the active project, not the picker").
// The side and the tab are remembered by lib/side.js; the campaign by MetroApp (falconscout.metro.campaign). This keeps the rest:
// the Leads filters and sort, and the open lead panel, per campaign. Pure (a Storage-like object is passed in), so
// tests/metro/phase3-ui.test.js runs it in Node.

export const STATE_KEY = 'falconscout.metro.state'
export const DEFAULT_FILTERS = { status: '', verdict: '', invite: '', has_email: '', q: '', enriched: '', sort: 'persona' }
const FILTER_KEYS = Object.keys(DEFAULT_FILTERS)

function readAll(storage) {
  try {
    const v = JSON.parse(storage?.getItem(STATE_KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch { return {} }
}
function writeAll(storage, v) {
  try { storage?.setItem(STATE_KEY, JSON.stringify(v)) } catch { /* private mode / quota: not remembered */ }
}

// The filters of one campaign's Leads view: only known keys, only strings; anything else falls back to the default.
export function readLeadsView(storage, campaignId) {
  const all = readAll(storage)
  const v = (all.leads || {})[String(campaignId)] || {}
  const f = { ...DEFAULT_FILTERS }
  for (const k of FILTER_KEYS) if (typeof v[k] === 'string') f[k] = v[k]
  return { filters: f, panel: Number.isInteger(v.panel) ? v.panel : null }
}

export function writeLeadsView(storage, campaignId, { filters, panel } = {}) {
  if (!campaignId) return
  const all = readAll(storage)
  const leads = { ...(all.leads || {}) }
  const cur = leads[String(campaignId)] || {}
  const next = { ...cur }
  if (filters) for (const k of FILTER_KEYS) next[k] = typeof filters[k] === 'string' ? filters[k] : DEFAULT_FILTERS[k]
  if (panel !== undefined) next.panel = Number.isInteger(panel) ? panel : null
  leads[String(campaignId)] = next
  writeAll(storage, { ...all, leads })
}

// The campaign to show: the remembered one while it exists; null (the picker) only when it is gone. `campaigns` = the loaded list
// (null while it is still loading: keep the remembered id, never flash the picker).
export function campaignToShow(rememberedId, campaigns) {
  if (!rememberedId) return null
  if (!Array.isArray(campaigns)) return rememberedId
  return campaigns.some((c) => c.id === rememberedId) ? rememberedId : null
}
