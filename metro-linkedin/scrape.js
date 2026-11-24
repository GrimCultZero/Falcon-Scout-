// Metro LinkedIn Scraper - scrape.js
// Injected into a job's tab by the background (never a standing content script). Defines
// window.__metroScrape(kind, target) -> Promise<{ ok, result?, error? }>. It READS the page: it scrolls (the way a
// person reading would) but clicks nothing that sends, connects, follows or messages.
(function () {
  if (window.__metroScrape) return
  const P = () => self.__metroParsers
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const text = () => (document.body ? document.body.innerText : '')
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

  async function waitFor(pred, maxMs, step = 700) {
    const end = Date.now() + maxMs
    while (Date.now() < end) {
      try { const v = pred(); if (v) return v } catch (_) { /* keep waiting */ }
      await sleep(step)
    }
    return null
  }
  async function scrollDown(steps) {
    const box = document.querySelector('main#workspace') || document.scrollingElement
    for (let i = 0; i < steps; i++) {
      box.scrollBy ? box.scrollBy(0, Math.round(window.innerHeight * 0.8)) : window.scrollBy(0, Math.round(window.innerHeight * 0.8))
      await sleep(600 + Math.random() * 500)
    }
  }
  const walled = () => /sign in|join now|authwall|checkpoint/i.test(location.href) || /Join LinkedIn|Sign in to view/i.test(text().slice(0, 600))
  const limited = () => /commercial use limit|you.?ve reached the (weekly|monthly) limit/i.test(text())

  // ───────── LinkedIn profile ─────────
  async function profile() {
    if (walled()) return { ok: false, error: 'LinkedIn showed a sign-in wall' }
    if (limited()) return { ok: false, error: 'LinkedIn commercial use limit reached' }
    const h1 = await waitFor(() => document.querySelector('h1'), 20000)
    if (!h1) return { ok: false, error: 'profile did not load' }
    await sleep(1500)
    await scrollDown(6)
    if (window.__blExp) { try { await window.__blExp.load(12000) } catch (_) { /* experience stays unread */ } }
    const out = P().parseProfileText(text())
    const topCard = h1.closest('section') || h1.parentElement
    const topLines = norm(topCard ? topCard.innerText : '').split(/\s{2,}|\n/).map(norm).filter(Boolean)
    const headline = [...(topCard ? topCard.querySelectorAll('.text-body-medium, [data-generated-suggestion-target]') : [])].map((e) => norm(e.textContent)).find((t) => t.length > 3)
    if (headline) out.headline = headline.slice(0, 300)
    const loc = [...(topCard ? topCard.querySelectorAll('.text-body-small') : [])].map((e) => norm(e.textContent)).find((t) => /,/.test(t) && t.length < 100 && !/followers|connections/i.test(t))
    if (loc) out.location = loc
    if (window.__blExp) {
      try {
        const cur = window.__blExp.currentJobs ? window.__blExp.currentJobs() : []
        const roles = window.__blExp.roles ? window.__blExp.roles() : []
        if (cur && cur[0]) { out.current_role = norm(cur[0].title || ''); out.current_company = norm(cur[0].company || '') }
        if (roles && roles.length) out.experience = roles.slice(0, 8).map((r) => norm(`${r.title || ''} at ${r.company || ''} (${r.range || r.dates || ''})`))
      } catch (_) { /* experience stays unread */ }
    }
    const conn = text().match(/([\d,+]+)\s+connections?/i)
    if (conn) out.connections = conn[1]
    return Object.keys(out).length ? { ok: true, result: out } : { ok: false, error: 'nothing readable on the profile' }
  }

  // ───────── LinkedIn company about page ─────────
  async function company() {
    if (walled()) return { ok: false, error: 'LinkedIn showed a sign-in wall' }
    if (limited()) return { ok: false, error: 'LinkedIn commercial use limit reached' }
    const ok = await waitFor(() => /Overview|About|Website|Industry/.test(text()) && document.querySelector('h1'), 20000)
    if (!ok) return { ok: false, error: 'company page did not load' }
    await sleep(1500)
    await scrollDown(3)
    const out = P().parseCompanyAbout(text())
    const h1 = document.querySelector('h1')
    if (h1) out.name = norm(h1.textContent).slice(0, 160)
    const about = document.querySelector('section p, .org-page-details-module__card-spacing p')
    if (about) out.about = norm(about.textContent).slice(0, 1500)
    return Object.keys(out).length > 1 ? { ok: true, result: out } : { ok: false, error: 'nothing readable on the company page' }
  }

  // ───────── Google Ads Transparency ─────────
  async function ads() {
    const ready = await waitFor(() => /ads?\b|advertiser|no ads to show|couldn.?t find/i.test(text()) && text().length > 400, 30000)
    if (!ready) return { ok: false, error: 'Ads Transparency did not load' }
    await sleep(3500)                        // the result count renders after the first paint
    return { ok: true, result: P().parseAdsTransparency(text()) }
  }

  // ───────── Google Business Profile (Maps) ─────────
  async function gbp() {
    await waitFor(() => document.querySelector('button[data-item-id], a.hfpxzc, h1'), 25000)
    await sleep(2000)
    if (!document.querySelector('button[data-item-id]')) {         // a result list: open the first place (a read, not an action)
      const first = document.querySelector('a.hfpxzc')
      if (!first) return { ok: true, result: { found: false } }
      first.click()
      await waitFor(() => document.querySelector('button[data-item-id]'), 15000)
      await sleep(1500)
    }
    const btn = (sel) => { const e = document.querySelector(sel); return e ? norm(e.getAttribute('aria-label') || e.textContent) : null }
    const info = {
      text: text(), name: norm((document.querySelector('h1') || {}).textContent || ''),
      address: btn('button[data-item-id="address"]'), phone: btn('button[data-item-id^="phone"]'),
      website: btn('a[data-item-id="authority"]') || btn('button[data-item-id="authority"]'),
      categories: [...document.querySelectorAll('button[jsaction*="category"]')].map((e) => norm(e.textContent)).filter(Boolean),
    }
    const star = document.querySelector('div.F7nice span[aria-hidden="true"]')
    if (star) info.rating = parseFloat(norm(star.textContent).replace(',', '.'))
    const rev = document.querySelector('div.F7nice span[aria-label*="review"]')
    if (rev) info.reviews = (norm(rev.getAttribute('aria-label')).match(/[\d.,]+/) || [])[0]
    return { ok: true, result: P().parseGbp(info) }
  }

  // ───────── Ahrefs ─────────
  async function ahrefs() {
    const t = await waitFor(() => (P().ahrefsReady(text()) ? text() : null), 40000, 1000)
    if (!t) return { ok: false, error: 'Ahrefs overview did not render (signed in? seat free?)' }
    const out = P().parseAhrefs(t)
    const d = new URLSearchParams(location.search).get('target') || ''
    out.domain = d.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    return { ok: true, result: out }
  }

  window.__metroScrape = async (kind) => {
    try {
      if (kind === 'linkedin_profile') return await profile()
      if (kind === 'linkedin_company') return await company()
      if (kind === 'ads_transparency') return await ads()
      if (kind === 'gbp') return await gbp()
      if (kind === 'ahrefs') return await ahrefs()
      return { ok: false, error: 'unknown kind' }
    } catch (e) {
      return { ok: false, error: `scrape crashed: ${e && e.message}` }
    }
  }
})()
