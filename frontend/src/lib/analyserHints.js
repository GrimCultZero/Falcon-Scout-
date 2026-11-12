// What the LETTER GENERATOR may read from the analyser (owner decision 2026-11-12).
//
// Before this, generate() asked for the stored analysis on a route that did not exist, so
// the letter never saw it, and its SKIP gate was dead code. Now the generator never refuses
// (no gate, whatever the verdict), and it may read a filtered set of the analyser's notes as
// HINTS. Of 1,759 flags across 427 stored analyses, 61% are about money and 11% about
// competition: those, the client's own statistics, the verdict and the score must never reach
// a letter (they make it hedge, or leak "rate floor" and "score 3/10" into prose). What is
// left is the scope / fit observations: what the job is mostly about, what Artem does not do,
// which tools the posting requires, a disclosure to remember. Those are useful, so they are
// passed, labelled as unverified.
//
// Pure functions, no React.

const MONEY = /\$\s?\d|\/\s?hr\b|\bper hour\b|\b(?:hourly|rates?|rate-floor|budgets?|pricing|prices?|priced|fees?|fixed|flat|floor|ceiling|avg|average|payments?|paid|pays?|spent|spend|spending|effective|retainers?)\b/i
const COMPETITION = /\b(?:boost\w*|applicants?|interviewing|connects?|shortlist\w*|competition|competitive|proposals?)\b/i
const CLIENT_STATS = /\b(?:reviews?|rating|hire rate|hires?|already hired|total spent|verified|history|jss)\b/i
const LOCATION = /\b(?:geo|geographic|location|restrictions?|timezone|time zone|country|us-based|can apply|cannot apply)\b/i
const META = /\b(?:analy[sz]er|analysed|analyzed|scores?|scored|verdict|skip|apply|maybe|disqualif\w*|hard rule|mandatory|test-week|re-analyse|assessed|auto-corrected|policy|owner)\b/i

export const MAX_HINTS = 6
export const MAX_HINT_CHARS = 240

const tidy = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f�]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Is this line safe and useful for the letter? (false = drop it) */
export function isLetterHint(line) {
  const t = tidy(line)
  if (t.length < 12) return false
  return !(MONEY.test(t) || COMPETITION.test(t) || CLIENT_STATS.test(t) || LOCATION.test(t) || META.test(t))
}

/** The usable lines of an analysis, flags first (they are the sharper ones), then reasons,
 *  then summary sentences; de-duplicated, capped. Never the verdict or the score. */
export function letterHintLines(analysis) {
  if (!analysis || typeof analysis !== 'object') return []
  const flags = Array.isArray(analysis.flags) ? analysis.flags : []
  const reasons = Array.isArray(analysis.reasons) ? analysis.reasons : []
  const summary = tidy(analysis.summary).split(/(?<=[.!?])\s+/)
  const seen = new Set()
  const out = []
  for (const raw of [...flags, ...reasons, ...summary]) {
    const t = tidy(raw)
    if (!isLetterHint(t)) continue
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t.length > MAX_HINT_CHARS ? t.slice(0, MAX_HINT_CHARS - 1).trimEnd() + '…' : t)
    if (out.length >= MAX_HINTS) break
  }
  return out
}

/** The block for the letter prompt's job context ('' when there is nothing usable). */
export function analyserHintsBlock(analysis) {
  const lines = letterHintLines(analysis)
  if (!lines.length) return ''
  return `ANALYSER NOTES (hints from a separate scoring pass: unverified, for your eyes only):
${lines.map((l) => `- ${l}`).join('\n')}
How to use them: (1) They are leads to check against the posting and the KB, never facts; the posting and the KB win on any conflict. (2) Never mention the analyser, a score, a verdict, "fit" or "skip" in the letter. (3) A note saying Artem does not do something, or lacks a tool or experience, is a CAUTION: do not claim it. Still write the full letter, lead with what he can honestly offer for this posting, and do not apologise or hedge. (4) A note naming a case study or an angle is a suggestion: use it only if the case is in the approved list and truly fits.`
}
