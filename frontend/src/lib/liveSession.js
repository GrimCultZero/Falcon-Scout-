// Live-session requirement (owner, 2026-11-25): Artem does not do live sessions (Rule 2), so a posting that
// requires or expects one -- training sessions, a presentation call, a screen-share walkthrough -- must never
// reach the green zone. The snapshot that prompted this (job 26103): the model's own text said "fit-based
// SKIP" for "run training sessions" and a "30-minute call", then the PPC-audit override rewrote the verdict
// to APPLY 7. Prompt rules and that override both lost to the data, so this is enforced in code, last.
//
// The ceiling is the yellow zone: MAYBE, score at most 6. A verdict the model already put lower stays lower.
// Pure functions, no I/O.

const LIVE_PATTERNS = [
  /\b(?:training|coaching|onboarding|knowledge[- ]transfer|working)\s+sessions?\b/i,
  /\b(?:live|video|zoom|google\s+meet|teams|skype)\s+(?:session|call|meeting|walk[- ]?through|training|demo|presentation|review)s?\b/i,
  /\b\d+[- ]?min(?:ute)?s?\s+(?:call|meeting|presentation|session|zoom)\b/i,
  /\bscreen[- ]?shar\w+/i,
  /\bpresent\w*\b[^.\n]{0,80}\b(?:on|in|during|via)\s+a\s+(?:call|meeting)\b/i,
  /\bwalk(?:ing)?\s+(?:me|us|them)?\s*through\b[^.\n]{0,40}\b(?:on|in)\s+a\s+call\b/i,
  /\bweekly\s+(?:call|meeting|sync)s?\b/i,
]

// The model's own flags / reasons already name it ("Rule 2", "live session", "live training").
const MODEL_FLAG = /\blive\s+(?:session|call|walk[- ]?through|training|presentation|review)|\brule\s*2\b|\bscreen[- ]?shar/i

/** The first live-session phrase in the posting, or null. */
export function liveSessionPhrase(text) {
  const s = String(text || '')
  for (const re of LIVE_PATTERNS) {
    const m = s.match(re)
    if (m) return m[0].trim()
  }
  return null
}

/** { required, phrase, source } from the posting text and, as a second source, the model's own flags. */
export function liveSessionSignal(job, parsed) {
  const text = [job && job.title, job && (job.description_full || job.description_snippet || job.description)].filter(Boolean).join('\n')
  const phrase = liveSessionPhrase(text)
  if (phrase) return { required: true, phrase, source: 'posting' }
  const flags = [...(Array.isArray(parsed && parsed.flags) ? parsed.flags : [])]
  const hit = flags.find(f => MODEL_FLAG.test(String(f)))
  if (hit) return { required: true, phrase: null, source: 'analyser' }
  return { required: false, phrase: null, source: null }
}

/** Cap a live-session job in the yellow zone. Never raises a score, never touches a lower verdict.
 *  Returns { parsed, events }. */
export function applyLiveSessionGuard(parsed, job) {
  if (!parsed || typeof parsed !== 'object') return { parsed, events: [] }
  const sig = liveSessionSignal(job, parsed)
  if (!sig.required) return { parsed, events: [] }
  const score = Number(parsed.score)
  const verdict = String(parsed.verdict || '').toUpperCase()
  const tooHigh = verdict === 'APPLY' || (Number.isFinite(score) && score > 6)
  if (!tooHigh) return { parsed, events: [] }
  const flags = Array.isArray(parsed.flags) ? [...parsed.flags] : []
  const why = sig.phrase ? `the posting asks for a live session ("${sig.phrase}")` : 'the posting requires a live session'
  flags.push(`Live session required — ${why}. Artem does not do live sessions (Rule 2), so the score is capped at 6/10 (MAYBE, yellow zone).`)
  return {
    parsed: {
      ...parsed,
      verdict: verdict === 'APPLY' ? 'MAYBE' : parsed.verdict,
      score: Number.isFinite(score) ? Math.min(score, 6) : 6,
      flags,
    },
    events: ['liveSessionCeiling'],
  }
}
