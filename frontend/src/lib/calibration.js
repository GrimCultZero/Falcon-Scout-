// Dashboard "Calibration" card helpers (audit 2026-10-29, T9). The numbers come from
// GET /calibration, which reads the analyser snapshots stored on proposals. A hint, not a gate.

/** "n=7" (no percentage below the backend's min_rate_n) or "23.5%". Never a rate on a tiny n. */
export function rateText(cell, which, minN = 10) {
  if (!cell || cell.n < minN) return `n=${cell ? cell.n : 0}`
  const v = which === 'open' ? cell.open_rate : cell.reply_rate
  return v == null ? `n=${cell.n}` : `${v}%`
}

/** True when a row has too few proposals to lean on (under `lowN`, default 30). */
export function isLowSample(cell, lowN = 30) {
  return !cell || cell.n < lowN
}

/** Display order for verdicts: the analyser's own order first, anything new after. */
export function verdictOrder(cells) {
  const rank = { APPLY: 0, MAYBE: 1, SKIP: 2 }
  return [...(cells || [])].sort((a, b) => (rank[a.key] ?? 9) - (rank[b.key] ?? 9) || a.key.localeCompare(b.key))
}
