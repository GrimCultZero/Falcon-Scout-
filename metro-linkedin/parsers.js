// Metro LinkedIn Scraper - parsers.js
// Pure functions (no chrome.*, no DOM): they turn the TEXT of a page into the fields Metro stores. Tested in plain
// Node (tests/metro/extension-parsers.test.js). A field that cannot be read is left out, never guessed.
(function (root) {
  const num = (s) => {
    if (s == null) return null
    const t = String(s).replace(/[\s  ]/g, '')
    const suf = /([KkMm])$/.exec(t)
    if (suf) {
      const v = parseFloat(t.slice(0, -1).replace(/,/g, '.'))
      return Number.isNaN(v) ? null : Math.round(v * (suf[1].toLowerCase() === 'k' ? 1e3 : 1e6))
    }
    const n = parseFloat(t.replace(/,/g, ''))
    return Number.isNaN(n) ? null : n
  }
  const lines = (t) => String(t || '').split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)

  // ── Ahrefs Site Explorer overview (same patterns as the Upwork side's ahrefs.js, keyed by domain here) ──
  function parseAhrefs(text) {
    const m = (re) => { const x = text.match(re); return x ? x[1] : null }
    const dr = m(/\bDR\b[^0-9]{0,6}([\d.,]+)/i) || m(/Domain\s+Rating[^0-9]{0,12}([\d.,]+)/i)
    const ur = m(/\bUR\b[^0-9]{0,6}([\d.,]+)/i)
    const kw = m(/Organic\s+keywords?\s*[\r\n\s↑↓]{0,4}([\d.,\s]+[KkMm]?)/i)
    const tr = m(/Organic\s+traffic\s*[\r\n\s↑↓]{0,8}([\d.,\s]+[KkMm]?)/i)
    const bl = m(/Backlinks?\s*[\r\n\s↑↓]{0,6}([\d.,\s]+[KkMm]?)/i)
    const rd = m(/Ref(?:erring)?\.?\s*[Dd]omains?\s*[\r\n\s↑↓]{0,6}([\d.,\s]+[KkMm]?)/i)
    const out = {}
    if (dr != null) out.dr = parseFloat(dr)
    if (ur != null) out.ur = parseFloat(ur)
    if (kw != null) out.organic_keywords = num(kw)
    if (tr != null) out.organic_traffic = num(tr)
    if (bl != null) out.backlinks = num(bl)
    if (rd != null) out.ref_domains = num(rd)
    return out
  }
  function ahrefsReady(text) {
    return text.length > 600 && /\bDR\b|Domain\s+Rating/i.test(text) && /Organic\s+(keywords?|traffic)/i.test(text)
  }

  // ── Google Ads Transparency Center (adstransparency.google.com/?domain=...) ──
  function parseAdsTransparency(text) {
    const t = String(text || '')
    if (/no ads to show|couldn't find any ads|no results|we couldn.t find/i.test(t)) return { found: false, running: false, ads_count: 0 }
    const out = { found: false, running: false }
    const adv = t.match(/(?:Advertiser|Verified advertiser)\s*\n+\s*([^\n]{2,90})/i)
    if (adv) out.advertiser = adv[1].trim()
    const cnt = t.match(/(~?\s*[\d.,]+\s*[KkMm]?\+?)\s+ads?\b/i)
    if (cnt) {
      out.ads_count_text = cnt[0].trim()
      const n = num(cnt[1].replace(/[~+]/g, ''))
      if (n != null) out.ads_count = Math.round(n)
    }
    const last = t.match(/Last shown[:\s]+([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/)
    if (last) out.last_seen = last[1]
    const first = t.match(/(?:First shown|Started)[:\s]+([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/)
    if (first) out.first_seen = first[1]
    const formats = ['Text', 'Image', 'Video'].filter((f) => new RegExp(`\\b${f}\\b`).test(t))
    if (formats.length) out.formats = formats
    out.found = !!(out.advertiser || out.ads_count)
    out.running = !!out.ads_count
    return out
  }

  // ── Google Maps place panel. `info` is what the content script read from the page: { text, rating, reviews,
  //    categories, address, phone, website } where the data-item-id buttons gave the last four. ──
  function parseGbp(info) {
    info = info || {}
    const text = String(info.text || '')
    if (!text && !info.address && !info.website && !info.name) return { found: false }
    const out = { found: true }
    if (info.name) out.name = String(info.name).trim()
    let rating = info.rating != null ? Number(info.rating) : null
    let reviews = info.reviews != null ? num(info.reviews) : null
    if (rating == null || Number.isNaN(rating)) {
      const m = text.match(/\b([1-5][.,]\d)\s*\n?\s*\(?\s*([\d.,]+[KkMm]?)\s*\)?\s*(?:reviews?)?/)
      if (m) { rating = parseFloat(m[1].replace(',', '.')); reviews = reviews ?? num(m[2]) }
    }
    if (rating != null && !Number.isNaN(rating) && rating >= 1 && rating <= 5) out.rating = rating
    if (reviews != null) out.review_count = Math.round(reviews)
    if (Array.isArray(info.categories) && info.categories.length) out.categories = info.categories.map(String).slice(0, 5)
    if (info.address) out.address = String(info.address).replace(/^Address:\s*/i, '').trim()
    if (info.phone) out.phone = String(info.phone).replace(/^Phone:\s*/i, '').trim()
    if (info.website) out.website = String(info.website).replace(/^Website:\s*/i, '').trim()
    if (/\bClaim this business\b/i.test(text)) out.claimed = false
    else if (text) out.claimed = true
    return out
  }

  // ── LinkedIn company "About" page text ──
  const ABOUT_LABELS = { website: /^website$/i, industry: /^industry$/i, size: /^company size$/i, headquarters: /^headquarters$/i,
    founded: /^founded$/i, type: /^(company )?type$/i, specialties: /^specialt(?:y|ies)$/i }
  function parseCompanyAbout(text) {
    const L = lines(text)
    const out = {}
    for (let i = 0; i < L.length - 1; i++) {
      for (const [k, rx] of Object.entries(ABOUT_LABELS)) {
        if (!rx.test(L[i]) || out[k]) continue
        const v = L[i + 1]
        if (!v || Object.values(ABOUT_LABELS).some((r) => r.test(v))) continue
        out[k] = v
      }
    }
    const res = {}
    if (out.website) res.website = out.website
    if (out.industry) res.industry = out.industry
    if (out.headquarters) res.headquarters = out.headquarters
    if (out.founded) res.founded = out.founded
    if (out.type) res.company_type = out.type
    if (out.size) res.employees_range = out.size.replace(/\s*employees?$/i, '')
    if (out.specialties) res.specialties = out.specialties.split(/\s*,\s*/).filter(Boolean).slice(0, 15)
    const mem = String(text || '').match(/([\d,.]+)\s+(?:associated members|employees on LinkedIn)/i)
    if (mem) res.employees_on_linkedin = num(mem[1])
    const fol = String(text || '').match(/([\d,.]+[KkMm]?)\s+followers/i)
    if (fol) res.followers = num(fol[1])
    return res
  }

  // ── LinkedIn profile page text (best effort: LinkedIn's markup changes; the section headings do not) ──
  const SECTION_STOP = /^(about|experience|education|activity|featured|skills|licenses|projects|volunteering|interests|recommendations|languages|courses|honors|publications|people also viewed|more profiles|you might like|top skills|show all|show more)\b/i
  function parseProfileText(text) {
    const L = lines(text)
    const out = {}
    const section = (name) => {
      const i = L.findIndex((x) => x.toLowerCase() === name)
      if (i < 0) return []
      const body = []
      for (let j = i + 1; j < L.length && body.length < 40; j++) {
        if (SECTION_STOP.test(L[j]) && L[j].toLowerCase() !== name && L[j].length < 40) break
        body.push(L[j])
      }
      return body
    }
    const about = section('about').filter((x) => !/^(see more|…\s*more|show all)$/i.test(x))
    if (about.length) out.about = about.join(' ').slice(0, 1500)
    const act = section('activity').filter((x) => x.length > 12 && !/followers?$/i.test(x) && !/^(posts|comments|videos|images|articles|show all)/i.test(x))
    if (act.length) out.recent_activity = act.slice(0, 6)
    const skills = section('skills').filter((x) => x.length < 60 && !/endorsement|show all/i.test(x))
    if (skills.length) out.skills = skills.slice(0, 10)
    return out
  }

  function slugFromHref(href) {
    const m = String(href || '').match(/\/in\/([^/?#]+)/)
    return m ? decodeURIComponent(m[1]).toLowerCase() : ''
  }

  const api = { num, parseAhrefs, ahrefsReady, parseAdsTransparency, parseGbp, parseCompanyAbout, parseProfileText, slugFromHref }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.__metroParsers = api
})(typeof self !== 'undefined' ? self : globalThis)
