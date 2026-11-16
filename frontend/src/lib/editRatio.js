// "Edits before sending" card helpers (T10). Numbers come from GET /generations/stats.

/** Median edit ratio as a percentage ("12%"); "-" when there is no data. */
export function editPct(cell) {
  if (!cell || !cell.n || cell.median_edit_ratio == null) return '-'
  return `${Math.round(cell.median_edit_ratio * 100)}%`
}

/** Share of letters sent with under 10% edits ("40%"); "-" when there is no data. */
export function sharePct(cell) {
  if (!cell || !cell.n || cell.under10_share == null) return '-'
  return `${Math.round(cell.under10_share)}%`
}
