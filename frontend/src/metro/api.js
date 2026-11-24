// Thin client for the Metro backend (/metro/*, proxied by Vite to :8000). Throws Error(detail) on a non-2xx.
export async function api(path, { method = 'GET', json, form } = {}) {
  const opts = { method }
  if (json !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(json) }
  if (form) opts.body = form
  const r = await fetch('/metro' + path, opts)
  let body = null
  try { body = await r.json() } catch { /* empty body */ }
  if (!r.ok) throw new Error((body && (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))) || `${r.status} ${r.statusText}`)
  return body
}

// text <-> list helpers for the one-item-per-line fields
export const toLines = (a) => (Array.isArray(a) ? a.join('\n') : '')
export const fromLines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean)
