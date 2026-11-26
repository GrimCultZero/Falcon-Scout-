// Words and colours for the Phase 3 cells of the Leads table and the lead panel (Channels, Chain). Pure, tested in Node
// (tests/metro/phase3-ui.test.js). The backend decides the states (api/metro/chains.py chain_status, routes_p3.channels_of).

// Channels cell: { email: 'business'|'personal'|'none', email_sendable, linkedin: 'connected'|'invited'|'not', open_profile }
export function channelsText(ch) {
  if (!ch) return { email: 'email: none', linkedin: 'LinkedIn: not', extra: '' }
  const email = ch.email === 'none' ? 'email: none'
    : `email: ${ch.email}${ch.email_sendable ? '' : ` (${ch.email_status === 'invalid' ? 'invalid' : 'not checked'})`}`
  const linkedin = `LinkedIn: ${ch.linkedin === 'not' ? 'not invited' : ch.linkedin}`
  return { email, linkedin, extra: ch.open_profile ? 'Open Profile' : '' }
}

export const CHAIN_COLORS = { none: '#7a8a8e', written: '#1a9d5c', issues: '#c2410c', approved: '#005669', sending: '#7a5af8',
  held: '#8a6d00', stopped: '#b42318' }

export function chainPill(chain) {
  const state = chain?.state || 'none'
  return { state, label: chain?.label || 'not written', color: CHAIN_COLORS[state] || CHAIN_COLORS.none }
}

// "Step 2 · Email · day 3"
export function touchHead(t) {
  return `Step ${t.step} · ${t.channel === 'linkedin' ? 'LinkedIn' : 'Email'} · day ${t.day ?? 0}`
}

// The text limits the checks use (api/metro/chaincheck.py); the editor shows the count as you type.
export const LINKEDIN_MAX_CHARS = 300
export const EMAIL_MAX_WORDS = 120
export function sizeNote(channel, text) {
  const t = String(text || '')
  if (channel === 'linkedin') return { n: t.length, max: LINKEDIN_MAX_CHARS, unit: 'characters', over: t.length > LINKEDIN_MAX_CHARS }
  const n = (t.match(/\b[\w'’-]+\b/g) || []).length
  return { n, max: EMAIL_MAX_WORDS, unit: 'words', over: n > EMAIL_MAX_WORDS }
}

// The Write card's small line: "5 written, 2 with issues, 5 held (same company)"
export function chainStatesLine(states = {}) {
  const parts = []
  const add = (n, w) => { if (n > 0) parts.push(`${n} ${w}`) }
  add(states.written, 'written')
  add(states.issues, 'with issues')
  add(states.approved, 'approved')
  add(states.held, 'held (same company)')
  add(states.none, 'not written yet')
  return parts.join(', ')
}
