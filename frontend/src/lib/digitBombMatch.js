// Auto Digit Bomb matcher (T22, owner request 2026-11-16). Deterministic: no model call, no network.
//
//   findAutoBomb(job, cfg?) -> { caseId, caseName, score, service, parts, ... } | null
//
// A case is eligible only if its SERVICE equals the job's service (required, else score 0: a web-dev
// case never opens an SEO letter). Score = niche (70) + market + platform + business model (30 total),
// all weights, tags and the 90 threshold in digitBombConfig.js. The numbers in the letter come from the
// case ledger only (CASE_BY_ID), never from here.
import { CASE_LEDGER } from './caseLedger.js'
import * as CONFIG from './digitBombConfig.js'

const _text = (job) => ` ${[job?.title, job?.description_full || job?.description_snippet || job?.raw_message].filter(Boolean).join('\n').toLowerCase().replace(/\s+/g, ' ')} `
const _hits = (blob, words) => words.filter(w => blob.includes(w.toLowerCase()))

function _wordHit(blob, w) {
  // short tokens (seo, geo, ppc, sem, aeo, gmc, dtc, d2c) must be whole words; longer ones are substrings
  if (w.length <= 4 && /^[a-z0-9]+$/.test(w)) return new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`).test(blob)
  return blob.includes(w)
}
const _tagsIn = (blob, map) => Object.keys(map).filter(k => map[k].some(w => _wordHit(blob, w)))

function _count(blob, w) {
  if (w.length <= 4 && /^[a-z0-9]+$/.test(w)) return (blob.match(new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`, 'g')) || []).length
  return blob.split(w).length - 1
}

/** The job's niches: only strong ones (see AUTO_BOMB.NICHE_* in the config). */
function _nicheTags(job, cfg) {
  const A = cfg.AUTO_BOMB
  const title = ` ${String(job?.title || '').toLowerCase()} `
  const body = _text(job)
  const strength = {}
  for (const [tag, words] of Object.entries(cfg.NICHE_TAGS)) {
    const inTitle = words.some(w => _wordHit(title, w))
    const mentions = words.reduce((n, w) => n + _count(body, w), 0)
    strength[tag] = (inTitle ? A.NICHE_TITLE_POINTS : 0) + Math.min(mentions, A.NICHE_BODY_CAP)
  }
  const strong = Object.keys(strength).filter(t => strength[t] >= A.NICHE_MIN_STRENGTH)
  const topSpecific = Math.max(0, ...strong.filter(t => !cfg.BROAD_NICHES.includes(t)).map(t => strength[t]))
  return strong.filter(t => cfg.BROAD_NICHES.includes(t) || strength[t] >= A.NICHE_REL_STRENGTH * topSpecific)
}

function _firstPos(text, words) {
  let best = -1
  for (const w of words) {
    let i = -1
    if (w.length <= 4 && /^[a-z0-9]+$/.test(w)) { const m = new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`).exec(text); i = m ? m.index : -1 }
    else i = text.indexOf(w)
    if (i >= 0 && (best < 0 || i < best)) best = i
  }
  return best
}

/**
 * The job's PRIMARY service and why: { service, reason, titleServices, scores }.
 * service: 'ppc' | 'seo' | 'web-dev' | 'meta' | null (unknown, a tie, or an add-on only).
 */
export function serviceInfo(job, cfg = CONFIG) {
  const cls = job?.job_classification_json
  try {
    const c = typeof cls === 'string' ? JSON.parse(cls) : cls
    if (c && typeof c.service === 'string' && cfg.SERVICE_TAGS[c.service]) return { service: c.service, reason: 'stored classification', titleServices: [], scores: {} }
  } catch (_) {}
  const title = ` ${String(job?.title || '').toLowerCase()} `
  const body = _text(job)
  const scores = {}
  for (const [svc, words] of Object.entries(cfg.SERVICE_TAGS)) {
    scores[svc] = words.reduce((n, w) => n + (_wordHit(title, w) ? cfg.TITLE_WEIGHT : 0) + (_wordHit(body, w) ? 1 : 0), 0)
  }
  // services present in the TITLE, in the order they appear
  const titleServices = Object.entries(cfg.SERVICE_TAGS).map(([svc, words]) => [svc, _firstPos(title, words)])
    .filter(([, pos]) => pos >= 0).sort((a, b) => a[1] - b[1]).map(([svc]) => svc)
  if (titleServices.length) {
    const [first, second] = titleServices
    if (second && cfg.TIE_SERVICES.includes(first) && cfg.TIE_SERVICES.includes(second)) return { service: null, reason: `title names ${first} and ${second}: no single lead`, titleServices, scores }
    return { service: first, reason: titleServices.length > 1 ? `title leads with ${first} (then ${titleServices.slice(1).join(', ')})` : `title is ${first}`, titleServices, scores }
  }
  const ranked = Object.entries(scores).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  if (!ranked.length) return { service: null, reason: 'no service word', titleServices, scores }
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return { service: null, reason: 'description ties between services', titleServices, scores }
  return { service: ranked[0][0], reason: `description: ${ranked[0][0]}`, titleServices, scores }
}

/** The job's primary service: 'ppc' | 'seo' | 'web-dev' | 'meta' | null. */
export function jobService(job, cfg = CONFIG) {
  return serviceInfo(job, cfg).service
}

export function jobSignals(job, cfg = CONFIG) {
  const blob = _text(job)
  const svc = serviceInfo(job, cfg)
  const market = new Set(_tagsIn(blob, cfg.MARKET_TAGS))
  const country = String(job?.client_country || '').toLowerCase().trim()
  if (cfg.COUNTRY_MARKET[country]) market.add(cfg.COUNTRY_MARKET[country])
  return {
    service: svc.service,
    serviceReason: svc.reason,
    serviceScores: svc.scores,
    titleServices: svc.titleServices,
    niche: _nicheTags(job, cfg),
    market: [...market],
    platform: _tagsIn(blob, cfg.PLATFORM_TAGS),
    model: _tagsIn(blob, cfg.MODEL_TAGS),
  }
}

/** Score one case against the job's signals. service mismatch or unknown -> 0 (never fires). */
export function scoreCase(sig, caseRec, cfg = CONFIG) {
  const tags = cfg.CASE_TAGS[caseRec.id]
  if (!tags || !sig.service || caseRec.service !== sig.service) return { score: 0, parts: { reason: !tags ? 'no tags' : 'service differs' } }
  const W = cfg.AUTO_BOMB.WEIGHTS
  let shared = (tags.niche || []).filter(t => sig.niche.includes(t))
  // a health / wellness / skincare case needs a wellness tag in the job; "ecommerce" alone earns it nothing
  const wellnessCase = (tags.niche || []).some(n => cfg.WELLNESS_GATE.includes(n))
  if (wellnessCase && !shared.some(n => cfg.WELLNESS_GATE.includes(n))) shared = []
  const specific = shared.filter(t => !cfg.BROAD_NICHES.includes(t))
  const niche = specific.length ? W.niche : shared.length ? Math.round(W.niche * cfg.AUTO_BOMB.BROAD_NICHE_SHARE) : 0
  const market = (tags.market || []).some(m => sig.market.includes(m)) ? W.market : 0
  const platform = (tags.platform || []).some(p => sig.platform.includes(p)) ? W.platform : 0
  const model = tags.model && sig.model.includes(tags.model) ? W.model : 0
  return { score: niche + market + platform + model, parts: { niche, market, platform, model, shared } }
}

/** Every eligible case, best first. */
export function rankCases(job, cfg = CONFIG, ledger = CASE_LEDGER) {
  const sig = jobSignals(job, cfg)
  return ledger.map(c => ({ caseId: c.id, caseName: c.name, service: c.service, ...scoreCase(sig, c, cfg) }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId))
}

/** The case the Digit Bomb should open with automatically, or null (below the threshold, no case, unknown service). */
export function findAutoBomb(job, cfg = CONFIG, ledger = CASE_LEDGER) {
  const best = rankCases(job, cfg, ledger)[0]
  if (!best || best.score < cfg.AUTO_BOMB.AUTO_FIRE_AT) return null
  return { ...best, threshold: cfg.AUTO_BOMB.AUTO_FIRE_AT, signals: jobSignals(job, cfg) }
}
