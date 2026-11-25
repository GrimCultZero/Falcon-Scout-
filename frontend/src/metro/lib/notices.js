// Notices: what a button did, said where it cannot be missed (METRO_TASK.md F4, item 2). DevScout's pattern: a message that
// STAYS until the person dismisses it, in a fixed place (not a line of small text somewhere in a page that may be scrolled away).
//
// Pure store with subscribe, no React, so tests/metro/activity-strip.test.js can drive it in Node. A notice is
// { id, kind: 'ok' | 'warn' | 'error', text, detail?, at }. An error with the same text as one already shown is not stacked twice.
let seq = 0
let list = []
const subs = new Set()
const MAX = 6
const emit = () => { for (const f of subs) { try { f(list) } catch { /* a bad subscriber never breaks the others */ } } }

export const notices = {
  get: () => list,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
  push(kind, text, detail) {
    const t = String(text ?? '').trim()
    if (!t) return null
    const same = list.find((n) => n.kind === kind && n.text === t)
    if (same) { same.at = Date.now(); same.count = (same.count || 1) + 1; list = [...list]; emit(); return same.id }
    const n = { id: ++seq, kind, text: t, detail: detail || null, at: Date.now(), count: 1 }
    list = [...list, n].slice(-MAX)
    emit()
    return n.id
  },
  dismiss(id) { list = list.filter((n) => n.id !== id); emit() },
  clear() { list = []; emit() },
}

export const notify = {
  ok: (text, detail) => notices.push('ok', text, detail),
  warn: (text, detail) => notices.push('warn', text, detail),
  error: (text, detail) => notices.push('error', text, detail),
}

// What a click handler returned -> the notice to show (or null). A string is a success line; { text, kind, detail } is explicit;
// a "started: false" answer from the backend carries its reason and is a warning, never a green success.
export function noticeFromResult(v) {
  if (v == null || v === false) return null
  if (typeof v === 'string') return { kind: 'ok', text: v }
  if (typeof v === 'object' && typeof v.text === 'string') return { kind: v.kind || 'ok', text: v.text, detail: v.detail }
  return null
}

// A backend answer that says it did not do the thing ({ started: false, reason }).
export const refusal = (r, fallback = 'Nothing was started') => (r && r.started === false ? { kind: 'warn', text: r.reason || fallback } : null)
