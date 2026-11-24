// Which side of the app is showing: Falcon Scout (Upwork) or Metro (outbound).
// Pure helpers, no React, so tests/metro/side-switch.test.js can run them in Node.
//
// Rules (METRO_PLAN.md Phase 0, step 5):
//   * the choice is remembered between visits (localStorage);
//   * the URL says which side shows: #metro is Metro; a Falcon Scout view (#jobs, #outcomes, #kb,
//     #dashboard, #settings), which App.jsx writes and the Chrome extension deep-links to, is
//     Falcon Scout, so an extension link never lands on a hidden view; no hash -> remembered side;
//   * anything unreadable falls back to Falcon Scout.

export const SIDE_KEY = 'falconscout.side'
export const METRO_TAB_KEY = 'falconscout.metro.tab'
export const SIDES = ['falcon', 'metro']
export const METRO_TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'leads',     label: 'Leads' },
  { key: 'crm',       label: 'CRM' },
  { key: 'senders',   label: 'Senders' },
  { key: 'settings',  label: 'Settings' },
]
const FALCON_HASHES = ['jobs', 'outcomes', 'kb', 'dashboard', 'settings']

export function hashForcesFalcon(hash) {
  const h = String(hash || '').replace(/^#/, '').toLowerCase()
  return FALCON_HASHES.includes(h)
}

function safeGet(storage, key) {
  try { return storage ? storage.getItem(key) : null } catch { return null }
}
function safeSet(storage, key, value) {
  try { if (storage) storage.setItem(key, value) } catch { /* private mode / quota: not remembered */ }
}

export const METRO_HASH = '#metro'

// App.jsx keeps its own view in the hash (#jobs, ...), so while Metro shows, the hash is #metro
// (set with replaceState, which fires no hashchange); flipping back restores the Falcon hash.
// A reload therefore lands on the side that was showing.
export function hashOnSwitch(currentHash, nextSide, savedFalconHash) {
  if (nextSide === 'metro') return METRO_HASH
  if (currentHash === METRO_HASH) return hashForcesFalcon(savedFalconHash) ? savedFalconHash : '#jobs'
  return currentHash
}

// Ctrl+M flips sides. Only the bare chord counts (no Shift/Alt/Meta), and a held key (auto-repeat)
// flips once, not back and forth.
export function isSwitchKey(e) {
  return !!e && !e.repeat && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    && String(e.key || '').toLowerCase() === 'm'
}

export function otherSide(side) {
  return side === 'metro' ? 'falcon' : 'metro'
}

export function readSide(storage, hash) {
  if (String(hash || '').toLowerCase() === METRO_HASH) return 'metro'
  if (hashForcesFalcon(hash)) return 'falcon'
  const v = safeGet(storage, SIDE_KEY)
  return SIDES.includes(v) ? v : 'falcon'
}

export function writeSide(storage, side) {
  if (SIDES.includes(side)) safeSet(storage, SIDE_KEY, side)
}

export function readMetroTab(storage) {
  const v = safeGet(storage, METRO_TAB_KEY)
  return METRO_TABS.some((t) => t.key === v) ? v : METRO_TABS[0].key
}

export function writeMetroTab(storage, tab) {
  if (METRO_TABS.some((t) => t.key === tab)) safeSet(storage, METRO_TAB_KEY, tab)
}
