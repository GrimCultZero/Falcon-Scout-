// The one helper for result lines the page builds (F5, item 3, Oleh 25 Nov): a line says only what happened, and a count of zero
// is never printed. The backend has the same rules in api/metro/lines.py (tests/metro/test_metro_fix5.py and resultlines.test.js
// pin both with the same cases).
//   part(3, 'lead')                 -> '3 leads'
//   part(0, 'lead')                 -> null
//   line('Removed 2 leads', part(0, 'lead', 'leads', 'kept'))  -> 'Removed 2 leads'
export const plural = (n, one, many) => `${Number(n) || 0} ${Number(n) === 1 ? one : (many || `${one}s`)}`

export function part(n, one, many, tail = '') {
  const k = Number(n) || 0
  if (k <= 0) return null
  return plural(k, one, many) + (tail ? ` ${tail}` : '')
}

export const join = (parts) => (parts || []).filter(Boolean).join(', ')

export function line(head, ...parts) {
  const tail = join(parts)
  return tail ? `${head} - ${tail}` : head
}

// "Queued for the browser: 3 company pages, 2 profiles" - only the kinds that got something; a plain sentence when none did.
export function queuedLine(queued, labels = {}) {
  const bits = Object.entries(queued || {}).map(([k, n]) => part(n, labels[k] || k.replace(/_/g, ' ')))
  const text = join(bits)
  return text ? `Queued for the browser: ${text}` : 'Nothing new to queue: every reading is fresh or already waiting'
}

// the words after "Enrich next" / "Enrich all": no counts of what the companies have, only how many it will take
export const enrichNextLabel = (n) => `Enrich next ${n}`
