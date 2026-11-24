// Metro LinkedIn Scraper - background service worker
// Asks the local Metro backend for ONE job at a time and runs it in a background tab. The backend is the
// authority: it knows the week mode, the account's daily cap, the pacing and the queue. This file adds a second
// line of defence (limits.js refuse()) and never opens a URL it did not build itself from a job's kind + target.
importScripts('limits.js', 'parsers.js')

const BASE = 'http://127.0.0.1:8000/metro'
const ALARM = 'metro-poll'
let busy = false

const L = () => self.__metroLimits
const store = {
  get: async () => (await chrome.storage.local.get('metro')).metro || { enabled: false },
  set: async (patch) => { const cur = await store.get(); const next = { ...cur, ...patch }; await chrome.storage.local.set({ metro: next }); return next },
}

async function api(path, opts) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  let body = null
  try { body = await r.json() } catch (_) { /* empty */ }
  return { ok: r.ok, status: r.status, body }
}

function setBadge(text, color) {
  try { chrome.action.setBadgeText({ text }); if (color) chrome.action.setBadgeBackgroundColor({ color }) } catch (_) { /* no action UI */ }
}

async function note(patch) { await store.set({ last: { at: Date.now(), ...patch } }) }

function waitComplete(tabId, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('page load timed out')) }, ms)
    const on = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve() } }
    chrome.tabs.onUpdated.addListener(on)
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve() } }).catch(() => {})
  })
}

async function runJob(job) {
  const url = L().urlFor(job.kind, job.target)
  const tab = await chrome.tabs.create({ url, active: false })
  try {
    await waitComplete(tab.id, 45000)
    const files = ['parsers.js']
    if (job.kind === 'linkedin_profile') files.push('li-experience.js')
    files.push('scrape.js')
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files })
    const [res] = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (k) => window.__metroScrape(k), args: [job.kind] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('job timed out')), L().JOB_TIMEOUT_MS + 60000)),
    ])
    return res && res.result ? res.result : { ok: false, error: 'no answer from the page' }
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch (_) { /* already closed */ }
  }
}

async function tick(reason) {
  if (busy) return
  busy = true
  try {
    const st = await store.get()
    if (!st.enabled) { setBadge('', null); return }
    if (!st.sender_id) { setBadge('?', '#b36b00'); await note({ status: 'No account yet: open linkedin.com/feed in this Chrome profile once.' }); return }
    const wk = await api('/week')
    if (!wk.ok) { setBadge('!', '#e6261f'); await note({ status: 'Metro backend not reachable' }); return }
    if (wk.body.week_mode !== 'metro') { setBadge('LH', '#005669'); await note({ status: 'Linked Helper week: nothing is scraped.' }); return }
    const nx = await api(`/jobs/next?sender_id=${encodeURIComponent(st.sender_id)}&kinds=${L().JOB_KINDS.join(',')}`)
    if (!nx.ok) { setBadge('!', '#e6261f'); await note({ status: `Backend said ${nx.status}` }); return }
    const job = nx.body.job
    if (!job) { setBadge('', null); await note({ status: `Idle: ${nx.body.reason || 'no job'}`, visits: nx.body.visits_today, cap: nx.body.cap }); return }
    const why = L().refuse(job, { week_mode: wk.body.week_mode, visits_today: nx.body.visits_today, cap: nx.body.cap })
    if (why) {
      await api(`/jobs/${job.id}/result`, { method: 'POST', body: JSON.stringify({ sender_id: st.sender_id, error: `refused by the extension: ${why}` }) })
      await note({ status: `Refused job ${job.id}: ${why}` })
      return
    }
    setBadge('...', '#37bbd5')
    await note({ status: `Running ${job.kind}: ${job.target}`, job: job.id })
    let out
    try { out = await runJob(job) } catch (e) { out = { ok: false, error: String(e && e.message || e) } }
    const post = await api(`/jobs/${job.id}/result`, { method: 'POST', body: JSON.stringify(out.ok ? { sender_id: st.sender_id, result: out.result } : { sender_id: st.sender_id, error: out.error || 'failed' }) })
    await note({ status: out.ok ? `Done ${job.kind}` : `Failed ${job.kind}: ${out.error}`, job: job.id, posted: post.ok, visits: nx.body.visits_today, cap: nx.body.cap })
    setBadge('', null)
  } catch (e) {
    await note({ status: `Error: ${e && e.message}` })
  } finally {
    busy = false
  }
}

async function ensureAlarm() {
  const a = await chrome.alarms.get(ALARM)
  if (!a) await chrome.alarms.create(ALARM, { periodInMinutes: 1 })
}

chrome.runtime.onInstalled.addListener(ensureAlarm)
chrome.runtime.onStartup.addListener(ensureAlarm)
chrome.alarms.onAlarm.addListener((al) => { if (al.name === ALARM) tick('alarm') })

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'METRO_ME') {
      const st = await store.get()
      const r = await api('/accounts/register', { method: 'POST', body: JSON.stringify({
        account_ref: `linkedin.com/in/${msg.slug}`, label: msg.name, chrome_profile: st.chrome_profile || null }) })
      if (r.ok) await store.set({ sender_id: r.body.id, account_ref: r.body.account_ref, account_label: r.body.label, role: r.body.role })
      sendResponse({ ok: r.ok })
    } else if (msg.type === 'METRO_STATUS') {
      const st = await store.get()
      const wk = await api('/week').catch(() => ({ ok: false }))
      sendResponse({ state: st, week: wk.ok ? wk.body : null })
    } else if (msg.type === 'METRO_SET') {
      await store.set(msg.patch || {})
      if (msg.patch && msg.patch.enabled) tick('enabled')
      sendResponse({ ok: true })
    } else if (msg.type === 'METRO_NOW') {
      tick('manual'); sendResponse({ ok: true })
    } else sendResponse({ ok: false })
  })()
  return true
})
