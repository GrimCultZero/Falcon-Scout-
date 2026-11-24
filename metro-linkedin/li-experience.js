// ─────────────────────────────────────────────────────────────────────────────
//  li-experience.js - read a LinkedIn profile's Experience section: every role,
//  its dates, and which ones are CURRENT ("... - Present").
//
//  Why this exists: LinkedIn's 2026 profile page has no employer line in the
//  header except an optional chip that people can switch off, and it loads the
//  Experience section only when you scroll down to it. The page does not scroll
//  the window either: it scrolls an inner container (main#workspace). So any
//  "where does this person work now?" check has to scroll that container until
//  Experience appears, then read the dates. Used by the message sender
//  (li-page-actions.js readProfile) and by the profile scraper
//  (content-linkedin.js). One reader, so both agree.
//
//  The pure part (date ranges, turning an entry's text lines into a role) has no
//  DOM and is tested in plain Node: tests/li-sender/verify-experience.mjs.
//
//  Entry shapes seen on the live page (Nov 2026), one text line per item:
//    single role:   Title / Company · Full-time / Oct 2023 - Present · 3 yrs 2 mos / Place
//    grouped roles: Company / 5 yrs 1 mo / Title / Full-time / Jan 2022 - Present · ... / Title / Nov 2021 - Present · ...
//  Each entry (or group) also carries the company logo, <img alt="Orbx logo">,
//  which is the most reliable company name when it is there.
// ─────────────────────────────────────────────────────────────────────────────
(function (root) {
  const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec'
  // "Oct 2023 - Present", "2020 - 2022", "Mar 2019 – Jan 2021", "Oct 2023 - Present · 3 yrs"
  const RANGE = new RegExp(`^\\s*((?:(?:${MON})[a-z]*\\.?\\s+)?\\d{4})\\s*[-–—−]\\s*(present|today|now|(?:(?:${MON})[a-z]*\\.?\\s+)?\\d{4})\\b`, 'i')
  const TYPE = /^(full[- ]time|part[- ]time|self[- ]employed|freelance|contract|contractor|internship|apprenticeship|seasonal|permanent|temporary|volunteer)$/i
  const DURATION = /^(less than a year|(\d+\s*(yrs?|years?|mos?|months?)\s*)+)$/i
  const JUNK = /^(show all|see more|…\s*more|more|\+\d+ skills?)/i

  function parseRange(line) {
    const m = String(line || '').match(RANGE)
    if (!m) return null
    const present = /^(present|today|now)$/i.test(m[2])
    return { start: m[1].trim(), end: present ? 'Present' : m[2].trim(), present }
  }

  // "Orbx · Full-time" -> "Orbx"; "Full-time · 5 yrs" -> ""; "Orbx" -> "Orbx"
  function companyFromLine(line) {
    const left = String(line || '').split('·')[0].trim()
    if (!left || TYPE.test(left) || DURATION.test(left) || RANGE.test(left)) return ''
    return left
  }

  // lines: the entry's text, one item per line, blanks removed.
  // di: index of this role's date line in `lines`. logoName: from the logo alt.
  function roleFromLines(lines, di, logoName) {
    const L = (lines || []).map(s => String(s).trim()).filter(Boolean)
    const range = parseRange(L[di])
    if (!range) return null
    const logo = String(logoName || '').replace(/\s+logo$/i, '').trim()
    // Grouped: second line is only a total duration ("5 yrs 1 mo") or
    // "Full-time · 5 yrs", and the date line is not the entry's first date.
    const second = L[1] || ''
    const grouped = di > 2 && (DURATION.test(second) || (/·/.test(second) && second.split('·').every(p => TYPE.test(p.trim()) || DURATION.test(p.trim()))))
    let title = '', company = ''
    if (grouped) {
      company = logo || companyFromLine(L[0])
      for (let i = di - 1; i >= 2; i--) {
        const l = L[i]
        if (TYPE.test(l) || DURATION.test(l) || RANGE.test(l) || JUNK.test(l)) continue
        if (/·/.test(l) && l.split('·').every(p => TYPE.test(p.trim()) || DURATION.test(p.trim()))) continue
        title = l; break
      }
    } else {
      // Single role: title, then "Company · Type" (or just "Company"), then dates.
      const start = Math.max(0, di - 2)
      title = L[start] && !RANGE.test(L[start]) ? L[start] : ''
      const coLine = di - 1 > start ? L[di - 1] : ''
      company = logo || companyFromLine(coLine)
      if (!company && di - 1 === start) { title = ''; company = logo || companyFromLine(L[start]) }
    }
    return { title, company, start: range.start, end: range.end, present: range.present }
  }

  // The same role read from several nested containers, smallest first. A role inside a
  // group ("iniBuilds Ltd. / 4 yrs 5 mos / Chief Product Officer / ...") often has its own
  // small container that holds the title and dates but not the company header above it.
  // The smallest container then gives a role with no company; the next one up has the
  // header. Take the first reading that names a company, else the first reading at all.
  // cands: [{ lines, di, logo }]
  function roleFromCandidates(cands) {
    let first = null
    for (const c of cands || []) {
      const r = roleFromLines(c.lines, c.di, c.logo)
      if (!r) continue
      if (!first) first = r
      if (r.company) return r
    }
    return first
  }

  const pure = { RANGE, parseRange, companyFromLine, roleFromLines, roleFromCandidates }
  if (typeof module !== 'undefined' && module.exports) module.exports = pure
  root.__blExpPure = pure   // tests load this file as a classic script
  if (typeof document === 'undefined') return
  if (root.__blExp && root.__blExp.v === 2) return

  // ── DOM part ───────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const text = el => (el?.innerText || el?.textContent || '').trim()
  const linesOf = el => text(el).split('\n').map(s => s.trim()).filter(Boolean)

  function scroller() {
    const ws = document.querySelector('main#workspace')
    if (ws && ws.scrollHeight > ws.clientHeight + 50) return ws
    const cands = [...document.querySelectorAll('main, div')].filter(e => e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
    cands.sort((a, b) => b.scrollHeight - a.scrollHeight)
    return cands[0] || document.scrollingElement || document.documentElement
  }

  // The dedicated page /in/<slug>/details/experience/ is the reliable source:
  // the job list is its main content and renders on load, even in a background
  // tab, with no scrolling. The profile page only loads Experience lazily.
  const onDetailsPage = () => /\/details\/experience\/?/.test(location.pathname)

  function section() {
    if (onDetailsPage()) return document.querySelector('main')
    const h = [...document.querySelectorAll('main h2, main h3, h2')].find(x => /^experience$/i.test(text(x)))
    let el = h || document.querySelector('#experience')
    if (!el) return null
    for (let i = 0; i < 10 && el.parentElement; i++) {
      el = el.parentElement
      if (el.tagName === 'SECTION' || linesOf(el).some(l => RANGE.test(l))) return el
    }
    return el
  }
  const loadedSection = () => { const s = section(); return s && linesOf(s).some(l => RANGE.test(l)) ? s : null }

  // Scroll the page's real container until Experience (with dates) appears.
  async function load(maxMs = 15000) {
    const t0 = Date.now()
    if (loadedSection()) return { loaded: true, steps: 0, ms: 0, hidden: document.hidden, page: onDetailsPage() ? 'details' : 'profile' }
    if (onDetailsPage()) {
      while (Date.now() - t0 < maxMs && !loadedSection()) await sleep(300)
      await sleep(600)
      const ok = !!loadedSection()
      // Nothing dated on the page: either no roles at all, or it did not render.
      const empty = !ok && /\bexperience\b/i.test(text(document.querySelector('main')))
      return { loaded: ok, empty, steps: 0, ms: Date.now() - t0, hidden: document.hidden, page: 'details' }
    }
    const box = scroller()
    let steps = 0, last = -1, stuck = 0
    while (Date.now() - t0 < maxMs && !loadedSection()) {
      const dy = 380 + Math.round(Math.random() * 260)
      box.scrollBy(0, dy)
      if (box !== document.scrollingElement) window.scrollBy(0, dy)   // older layouts scroll the window
      steps++
      await sleep(320 + Math.round(Math.random() * 300))
      const top = box.scrollTop
      if (top === last) { if (++stuck >= 5) break } else stuck = 0
      last = top
    }
    await sleep(700)   // let the section's rows finish rendering
    return { loaded: !!loadedSection(), steps, ms: Date.now() - t0, hidden: document.hidden, page: 'profile' }
  }

  function isDateLeaf(e) {
    if (!RANGE.test(text(e))) return false
    return ![...e.children].some(c => RANGE.test(text(c)))
  }
  const logoIn = el => [...el.querySelectorAll('img')].map(i => i.alt || '').find(a => /\slogo$/i.test(a)) || ''

  // Every role in the Experience section, in page order.
  function roles() {
    const sec = loadedSection()
    if (!sec) return []
    const leaves = [...sec.querySelectorAll('*')].filter(isDateLeaf)
    const out = []
    const seenEntry = new Map()   // entry element -> how many of its date lines used so far
    for (const leaf of leaves) {
      // The entry: smallest ancestor with a company logo or company link; else 3+ lines.
      let entry = leaf
      while (entry.parentElement && entry !== sec) {
        entry = entry.parentElement
        if (logoIn(entry) || entry.querySelector('a[href*="/company/"]')) break
        if (linesOf(entry).length >= 4 && entry.parentElement === sec) break
      }
      const lines = linesOf(entry)
      const k = seenEntry.get(entry) || 0
      seenEntry.set(entry, k + 1)
      const dateIdxs = lines.map((l, i) => RANGE.test(l) ? i : -1).filter(i => i >= 0)
      const di = dateIdxs[k]
      if (di == null) continue
      // The smallest container, then each one above it (up to the section), so a role
      // whose company header sits in the group above still gets its company.
      const cands = [{ lines, di, logo: logoIn(entry) }]
      for (let up = entry.parentElement, n = 0; up && up !== sec && n < 4; up = up.parentElement, n++) {
        const ls = linesOf(up)
        const idx = ls.map((l, i) => RANGE.test(l) ? i : -1).filter(i => i >= 0)
        const order = [...up.querySelectorAll('*')].filter(isDateLeaf).indexOf(leaf)
        if (order >= 0 && idx[order] != null) cands.push({ lines: ls, di: idx[order], logo: logoIn(up) })
      }
      const r = roleFromCandidates(cands)
      if (!r || (!r.company && !r.title)) continue
      const a = entry.querySelector('a[href*="/company/"]')
      let companyUrl = ''
      try { if (a) companyUrl = new URL(a.getAttribute('href'), location.origin).href.split('?')[0].replace(/\/?$/, '/') } catch (_) { /* bad href */ }
      out.push({ ...r, companyUrl })
    }
    return out
  }

  function currentJobs() {
    const seen = new Set()
    return roles().filter(r => r.present).filter(r => {
      const k = (r.company + '|' + r.title).toLowerCase()
      if (seen.has(k)) return false
      seen.add(k); return true
    })
  }

  // One call for the extension: load, then return the current jobs.
  async function read(maxMs) {
    const ld = await load(maxMs)
    const jobs = ld.loaded ? currentJobs().map(j => ({ company: j.company, title: j.title, start: j.start, companyUrl: j.companyUrl || '' })) : []
    return { ...ld, jobs, roles: ld.loaded ? roles().length : 0 }
  }

  root.__blExp = { v: 2, ...pure, load, roles, currentJobs, read, section: loadedSection }
})(typeof self !== 'undefined' ? self : globalThis)
