// Bid selection signals, display side (audit 2026-10-29, T12 + T13). Record-only: these helpers only FORMAT numbers
// the app already holds. Nothing here filters a job, ranks a job or changes a letter.

// ── applicants band (Upwork's text: "Less than 5", "20 to 50", "50+", or a bare number) ──
export const APPLICANT_BANDS = ['<5', '5-10', '10-15', '15-20', '20-50', '50+']

export function applicantsBand(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/–/g, '-')
  if (!s) return null
  if (s.startsWith('less than') || s.startsWith('<')) return '<5'
  if (s.includes('+')) { const m = s.match(/^(\d+)/); return m && Number(m[1]) >= 50 ? '50+' : null }
  let m = s.match(/^(\d+)\s*(?:to|-)\s*(\d+)/)
  if (m) return { 5: '5-10', 10: '10-15', 15: '15-20', 20: '20-50', 50: '50+' }[Number(m[1])] || null
  m = s.match(/^(\d+)$/)
  if (m) { const n = Number(m[1]); return n < 5 ? '<5' : n < 10 ? '5-10' : n < 15 ? '10-15' : n < 20 ? '15-20' : n < 50 ? '20-50' : '50+' }
  return null
}

/** Parse a DB / ISO timestamp. The backend stores UTC without a zone suffix, so a bare one is read as UTC. */
export function parseTs(ts) {
  let s = String(ts ?? '').trim().replace(' ', 'T')
  if (!s) return NaN
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z'
  return Date.parse(s)
}

/** How long ago an ISO / DB timestamp was, in words ("12 min ago", "3 h ago"); '' when unknown. */
export function agoText(ts, now = Date.now()) {
  if (!ts) return ''
  const t = parseTs(ts)
  if (Number.isNaN(t)) return ''
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

/** The applicants chip for a feed card: band, when it was read, and the colour. null when never read. */
export function applicantsChip(job, now = Date.now()) {
  const band = applicantsBand(job && job.proposals)
  if (!band) return null
  const read = agoText(job.enriched_at || job.captured_at, now)
  const hot = band === '50+'
  return {
    band,
    label: `${band.replace('-', '–')} applicants`,
    read: read ? `read ${read}` : 'read time unknown',
    title: `Applicants: ${job.proposals}${read ? ` · read ${read}` : ''}. The count changes while the job is open; it is refreshed when you press Apply.`,
    color: hot ? '#ef4444' : band === '20-50' ? '#f59e0b' : 'var(--text2)',
    hot,
  }
}

/** True when the owner's optional "dim 50+ applicants" setting says to fade this card. Display only, never a filter. */
export function shouldDim(job, cfg) {
  return !!(cfg && cfg.dim_applicants_50plus) && applicantsBand(job && job.proposals) === '50+'
}

// ── the boost ladder helper: the numbers only, no recommendation ─────────────────
export const LADDER_STALE_HOURS = 3

/**
 * The current ladder for a job: rows, when it was captured, its age, whether it is stale (older than 3 h), and the
 * connects held by ranks 1, 2 and 3. To sit above a rank you would bid more than its connects; the app says nothing more.
 */
export function ladderView(job, now = Date.now()) {
  const rows = Array.isArray(job && job.boost_bids) ? job.boost_bids.filter(b => b && Number.isFinite(Number(b.rank)) && Number.isFinite(Number(b.connects))) : []
  if (!rows.length) return null
  const raw = job.boost_bids_captured_at
  const cap = raw ? parseTs(raw) : NaN
  const ageHours = Number.isNaN(cap) ? null : Math.max(0, (now - cap) / 3600000)
  const byRank = (r) => { const e = rows.find(b => Number(b.rank) === r); return e ? Number(e.connects) : null }
  return {
    rows: [...rows].sort((a, b) => a.rank - b.rank),
    capturedAt: Number.isNaN(cap) ? null : new Date(cap).toISOString(),
    ageText: Number.isNaN(cap) ? 'capture time unknown' : agoText(raw, now),
    stale: ageHours == null ? true : ageHours > LADDER_STALE_HOURS,
    rank1: byRank(1), rank2: byRank(2), rank3: byRank(3),
  }
}

// ── T13: the first ~180 characters of the letter must hold 4+ posting-specific words ──
// SAME constants and word rules as the generation-time check in JobDetail.jsx (previewNotSpecific); a test keeps them equal.
export const PREVIEW_CHARS = 180
export const PREVIEW_MIN_SPECIFIC = 4
export const PREVIEW_GENERIC_TEXT =
  'google ads adwords sem ppc paid search marketing digital campaign campaigns ' +
  'year years experience premier partner specialist expert agency team client clients ' +
  'business businesses company website site online traffic revenue growth grow scale ' +
  'scaling management manage managing service services strategy strategies process ' +
  'work working help need needs want looking about with your their this that from ' +
  'have here what when where which will would could should more most just also than'
const GENERIC = new Set(PREVIEW_GENERIC_TEXT.split(' '))
const wordSet = (s) => new Set((String(s || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter(w => !GENERIC.has(w)))

/** { words, count, notSpecific } for the letter's preview window against the posting text. */
export function previewCheck(letter, postingLower) {
  const posting = wordSet(postingLower)
  const words = [...wordSet(String(letter || '').trim().slice(0, PREVIEW_CHARS))].filter(w => posting.has(w))
  return { words, count: words.length, notSpecific: words.length < PREVIEW_MIN_SPECIFIC }
}
