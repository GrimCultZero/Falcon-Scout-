// Thin client for the Metro backend (/metro/*, proxied by Vite to :8000). Throws Error(detail) on a non-2xx.
//
// F4 (item 2): a refused or failed request ALWAYS shows its reason. Every request that changes something (anything but a GET)
// that fails puts an error notice on screen by itself, once; the thrown error is marked `notified` so a button that also catches
// it does not say it twice. A GET that fails is left to its caller (a background refresh must not shout).
import { notify } from './lib/notices.js'

export async function api(path, { method = 'GET', json, form, quiet = false } = {}) {
  const opts = { method }
  if (json !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(json) }
  if (form) opts.body = form
  const loud = method !== 'GET' && !quiet
  let r
  try {
    r = await fetch('/metro' + path, opts)
  } catch (e) {
    const err = new Error('Cannot reach the backend (is falconscout.bat running?)')
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
