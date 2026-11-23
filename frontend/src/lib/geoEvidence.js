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

// Task 9.3 (owner, 2026-11-24): the API feed's mandatory preferred-location field can
// be ONE country name, or several comma-joined ("Poland, Romania, Ukraine, Argentina,
// Brazil, Pakistan") — see api/upwork_api.py's _stringify_for_text_column, which joins
// Upwork's raw list this way. Artem is based in Ukraine: a list that INCLUDES Ukraine
// means he IS eligible (not a restriction at all, never hidden or marked). A list that
// does NOT include Ukraine excludes him exactly like "United States only" excludes a
// non-US freelancer, and is shown the same way.
// Every value the OTHER writer (the extension's enrichment path, api/geo_restriction.py
// normalize_geo_value) can store always ends in the word "only", or is "Worldwide" — so
// excluding those two shapes is enough to recognise "this is the API feed's raw
// place-name list" without needing a comma (a single mandatory country, e.g. "United
// States" with no "only" suffix, must also count as restricted).
const UKRAINE_RE = /\bukraine\b/i
// The API mapping (api/upwork_api.py _map_node) always tags its own geo_restriction
// writes with evidence starting this way — gating on it means a pre-T20 garbage value
// from the OLD, unvalidated extension scraper ("Skills and Expertise", a stray label)
// is never mistaken for a place-name list just because it happens to omit "only"/
// "Worldwide"/"Ukraine".
const API_FEED_EVIDENCE_RE = /^Upwork API: mandatory preferred location\b/

/** Is this stored value a mandatory-location list/single-place value (not an "only"
 * phrase, not "Worldwide"), FROM THE API FEED specifically, that excludes Ukraine? */
export function isExcludesUkraineListValue(value, evidence) {
  const v = String(value || '').trim()
  if (!v || !API_FEED_EVIDENCE_RE.test(String(evidence || ''))) return false
  if (/\bonly\b/i.test(v) || /worldwide/i.test(v)) return false
  return !UKRAINE_RE.test(v)
}

/** Any hard geo restriction that excludes Artem (Ukraine) — "US only" wording, or an
 * API-feed mandatory-location list without Ukraine in it. */
export function isLocationRestrictedValue(value, evidence) {
  return isUsOnlyValue(value) || isExcludesUkraineListValue(value, evidence)
}

/**
 * @param {object} job  a feed row (geo_restriction, geo_evidence, geo_read_at)
 * @param {number} [now] ms since epoch (injectable for tests)
 * @returns {{usOnly: boolean, verified: boolean, unverified: boolean, ageHours: number|null, why: string}}
 *   verified   - US-only WITH evidence read within 24 h: a real hard disqualifier
 *   unverified - US-only but not verified: say "location unverified", never SKIP on it
 */
export function geoVerdict(job, now = Date.now()) {
  // "usOnly" is kept as the field name for backward compatibility, but as of Task 9.3
  // it means "any hard geo restriction excluding Ukraine" — US-only wording, or a
  // mandatory-location country list without Ukraine in it.
  const usOnly = isLocationRestrictedValue(job && job.geo_restriction, job && job.geo_evidence)
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
