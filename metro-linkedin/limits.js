// Metro LinkedIn Scraper - limits.js
// Pure rules for the extension's own second line of defence. The BACKEND decides (week mode, daily cap, pacing,
// who gets what); the extension only refuses things the backend should never have sent. Numbers are DevScout's
// (li-limits.js): a daily visit cap that Settings can never raise past HARD_MAX_VISITS.
(function (root) {
  const HARD_MAX_VISITS = 80
  const DEFAULT_VISITS = 60
  const JOB_KINDS = ['linkedin_profile', 'linkedin_company', 'ads_transparency', 'gbp', 'ahrefs']
  const LINKEDIN_KINDS = ['linkedin_profile', 'linkedin_company']
  const POLL_SECONDS = 60          // alarms below 30 s are not reliable; the backend paces within this
  const JOB_TIMEOUT_MS = 90000

  // Only these URLs may ever be opened for a job, built from the job's kind and target here, never taken from
  // the server as a ready-made URL.
  function urlFor(kind, target) {
    const t = String(target || '').trim()
    if (!t) return null
    if (kind === 'linkedin_profile') {
      const m = t.match(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9%_\-]+)\/?/i)
      return m ? `https://www.linkedin.com/in/${m[1]}/` : null
    }
    if (kind === 'linkedin_company') {
      const m = t.match(/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/company\/([A-Za-z0-9%_\-]+)\/?/i)
      return m ? `https://www.linkedin.com/company/${m[1]}/about/` : null
    }
    if (kind === 'ads_transparency') {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return null
      return `https://adstransparency.google.com/?region=anywhere&domain=${encodeURIComponent(t.toLowerCase())}`
    }
    if (kind === 'gbp') {
      if (t.length > 160) return null
      return `https://www.google.com/maps/search/${encodeURIComponent(t)}`
    }
    if (kind === 'ahrefs') {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return null
      return `https://app.ahrefs.com/site-explorer/overview?mode=subdomains&target=${encodeURIComponent(t.toLowerCase() + '/')}`
    }
    return null
  }

  // Refuse a job outright (before opening anything) when it is not one the extension should run.
  function refuse(job, state) {
    if (!job || typeof job !== 'object') return 'no job'
    if (!JOB_KINDS.includes(job.kind)) return 'unknown job kind'
    if (state && state.week_mode && state.week_mode !== 'metro') return 'Linked Helper week'
    if (LINKEDIN_KINDS.includes(job.kind) && state && Number.isFinite(state.visits_today) && Number.isFinite(state.cap)
        && state.visits_today > Math.min(state.cap, HARD_MAX_VISITS)) return 'daily visit cap'
    if (!urlFor(job.kind, job.target)) return 'target does not look right for this kind of job'
    return null
  }

  const api = { HARD_MAX_VISITS, DEFAULT_VISITS, JOB_KINDS, LINKEDIN_KINDS, POLL_SECONDS, JOB_TIMEOUT_MS, urlFor, refuse }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.__metroLimits = api
})(typeof self !== 'undefined' ? self : globalThis)
