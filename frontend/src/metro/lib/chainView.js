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

export const CHAIN_COLORS = { none: '#7a8a8e', written: '#1a9d5c', issues: '#F2711C', approved: '#005669', sending: '#7a5af8',
  held: '#8a6d00', stopped: '#8a3c08' }      // P3b #7: no red anywhere (issues and stopped are orange / brown)

export function chainPill(chain) {
  const state = chain?.state || 'none'
  return { state, label: chain?.label || 'not written', color: CHAIN_COLORS[state] || CHAIN_COLORS.none }
}

// P3b: what each message of a wave is FOR (DevScout's WAVE_JOBS; api/metro/writing.py)
export const JOB_LABEL = {
  intro: 'LinkedIn intro (built by code)', hook: 'Hook email (new thread)', approach: 'Approach (reply in the thread)',
  value: 'Tip for their clients (new thread)', value4: 'Tip for their clients (new thread)', pointer: 'LinkedIn pointer to the email (built by code)',
  close: 'Close (reply in the thread)',
}
// "Step 2 · Email · day 0 · Hook email (new thread)"; the pointer says its working days, a late intro "on acceptance"
export function touchHead(t) {
  const when = t.on_accept ? 'on acceptance' : t.job === 'pointer' && t.after_step != null ? `${t.working_days_after || 2} working days after step ${t.after_step}` : `day ${t.day ?? 0}`
  return [`Step ${t.step}`, t.channel === 'linkedin' ? 'LinkedIn' : 'Email', when, JOB_LABEL[t.job]].filter(Boolean).join(' · ')
}
// The panel's track line: what the wave is made of
export function trackText(track, notes = {}) {
  const four = notes?.plan?.four
  const emails = four ? '4 emails' : '3 emails'
  if (track === 'linkedin_first') return `LinkedIn intro + ${emails} + LinkedIn pointer`
  return notes?.plan?.intro_on_accept ? `${emails}; the LinkedIn intro after the acceptance` : `${emails} (not connected on LinkedIn)`
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
  add(states.issues, 'do not send as is')
  add(states.approved, 'approved')
  add(states.held, 'held (same company)')
  add(states.none, 'not written yet')
  return parts.join(', ')
}
