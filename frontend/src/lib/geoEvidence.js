// When may "United States only" disqualify a job? (audit 2026-10-29, T20)
//
// The analyser treats a US-only location as a hard disqualifier ("Artem cannot
// legally apply"), so a wrong value turns a good job into a SKIP. On 2026-10-29 two
// Worldwide jobs were stamped "United States only" by a scrape that straddled a tab
// switch. A US-only reading now only counts as a restriction when it comes WITH
// evidence (the sentence or label it was read from) and was read within 24 hours.
// Anything else is "location unverified": the analyser is told so, and it is not a
// disqualifier.
//
// Pure functions, no React.

export const GEO_FRESH_HOURS = 24

const US_ONLY_RE = /\b(?:united states only|us only|usa only|u\.s\. only|u\.s\.a\. only)\b/i

/** Is this stored value a "United States only" restriction (verified or not)? */
export function isUsOnlyValue(value) {
  return US_ONLY_RE.test(String(value || ''))
}

/**
 * @param {object} job  a feed row (geo_restriction, geo_evidence, geo_read_at)
 * @param {number} [now] ms since epoch (injectable for tests)
 * @returns {{usOnly: boolean, verified: boolean, unverified: boolean, ageHours: number|null, why: string}}
 *   verified   - US-only WITH evidence read within 24 h: a real hard disqualifier
 *   unverified - US-only but not verified: say "location unverified", never SKIP on it
 */
export function geoVerdict(job, now = Date.now()) {
  const usOnly = isUsOnlyValue(job && job.geo_restriction)
  if (!usOnly) return { usOnly: false, verified: false, unverified: false, ageHours: null, why: 'not a US-only value' }

  const evidence = String((job && job.geo_evidence) || '').trim()
  const readAt = job && job.geo_read_at ? Date.parse(job.geo_read_at) : NaN
  const ageHours = Number.isFinite(readAt) ? (now - readAt) / 3600000 : null

  if (!evidence) return { usOnly: true, verified: false, unverified: true, ageHours, why: 'no evidence was stored with the reading' }
  if (ageHours === null) return { usOnly: true, verified: false, unverified: true, ageHours, why: 'no read time was stored' }
  if (ageHours < 0 || ageHours > GEO_FRESH_HOURS) {
    return { usOnly: true, verified: false, unverified: true, ageHours, why: `the reading is ${Math.round(ageHours)} h old (limit ${GEO_FRESH_HOURS} h)` }
  }
  return { usOnly: true, verified: true, unverified: false, ageHours, why: 'evidence present and read within 24 h' }
}

/** The "Freelancer geo restriction" value the analyser prompt is given. */
export function geoPromptValue(job, now = Date.now()) {
  const v = geoVerdict(job, now)
  if (v.unverified) {
    return 'location unverified (a "United States only" reading without fresh evidence: ' + v.why +
      '. This is NOT a restriction and NOT a disqualifier; add the flag "Location unverified: check the job page")'
  }
  return (job && job.geo_restriction) || 'none'
}
