// Thin client for the Metro backend (/metro/*, proxied by Vite to :8000). Throws Error(detail) on a non-2xx.
//
// F4 (item 2): a refused or failed request ALWAYS shows its reason. Every request that changes something (anything but a GET)
// that fails puts an error notice on screen by itself, once; the thrown error is marked `notified` so a button that also catches
// it does not say it twice. A GET that fails is left to its caller (a background refresh must not shout).
//
// P3b (Minor fixes #3, 27 Nov): a request that gets no answer is NOT proof that the backend is down. On 27 Nov the Senders tab said
// "Cannot reach the backend" while a hooks run was going and the backend was fine. Now: a GET is tried once more; then the page asks
// /metro/ping (no database, no thread) twice; only when BOTH fail does it say the backend is not running. Otherwise it says the
// backend is busy and did not answer this one request in time.
import { notify } from './lib/notices.js'

export const DOWN = 'Cannot reach the backend (is falconscout.bat running?)'
export const BUSY = 'The backend is running but did not answer this request in time (busy with a run?). Try again in a moment.'
const wait = (ms) => new Promise((res) => setTimeout(res, ms))

// true when the backend answers /metro/ping (two tries, 4 s each, 1.5 s apart). Exported for tests (fetchFn).
export async function backendUp(fetchFn = fetch, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const c = typeof AbortController !== 'undefined' ? new AbortController() : null
      const t = c ? setTimeout(() => c.abort(), 4000) : null
      const r = await fetchFn('/metro/ping', c ? { signal: c.signal } : undefined)
      if (t) clearTimeout(t)
      if (r && r.ok) return true
    } catch { /* not this time */ }
    if (i < tries - 1) await wait(1500)
  }
  return false
}

// fetch that explains a failure honestly: one more try for a GET, then a real health check before "not running".
export async function fetchOrExplain(url, opts = {}, fetchFn = fetch) {
  try { return await fetchFn(url, opts) } catch { /* below */ }
  if (!opts.method || opts.method === 'GET') {
    await wait(1200)
    try { return await fetchFn(url, opts) } catch { /* below */ }
  }
  const up = await backendUp(fetchFn)
  const err = new Error(up ? BUSY : DOWN)
  err.unreachable = !up
  throw err
}

export async function api(path, { method = 'GET', json, form, quiet = false } = {}) {
  const opts = { method }
  if (json !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(json) }
  if (form) opts.body = form
  const loud = method !== 'GET' && !quiet
  let r
  try {
    r = await fetchOrExplain('/metro' + path, opts)
  } catch (err) {
    if (loud) { notify.error(`${label(method, path)} did not run: ${err.message}`); err.notified = true }
    throw err
  }
  let body = null
  try { body = await r.json() } catch { /* empty body */ }
  if (!r.ok) {
    const reason = (body && (typeof body.detail === 'string' ? body.detail : body.detail ? JSON.stringify(body.detail) : null)) || `${r.status} ${r.statusText}`
    const err = new Error(reason)
    err.status = r.status
    if (loud) { notify.error(`${label(method, path)} was refused: ${reason}`); err.notified = true }
    throw err
  }
  return body
}

// "POST /campaigns/3/enrich" -> "enrich": the last words of the path, enough for a person to see what failed
function label(method, path) {
  const seg = String(path).split('?')[0].split('/').filter((x) => x && !/^\d+$/.test(x))
  return (seg.slice(-2).join(' ') || 'the request').replace(/-/g, ' ')
}

// text <-> list helpers for the one-item-per-line fields
export const toLines = (a) => (Array.isArray(a) ? a.join('\n') : '')
export const fromLines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean)
