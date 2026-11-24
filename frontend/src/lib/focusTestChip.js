// Header "Hidden by focus: N" chip (SEO/GEO/Google Ads focus test, owner 2026-11-19).
// Pure state-decision logic, extracted so it's testable without rendering React --
// same pattern as backupStatus.js's backupChipState.

/** @param {{active: boolean, hidden_count: number}|null} status  GET /focus-test/status */
export function focusTestChipState(status) {
  if (!status || !status.active) return null
  const count = Number(status.hidden_count) || 0
  return {
    label: `Hidden by focus: ${count}`,
    title: count > 0
      ? `SEO/GEO/Google Ads focus filter is on. It has hidden ${count} off-lane job${count === 1 ? '' : 's'} so far — click to review and rescue any of them.`
      : 'SEO/GEO/Google Ads focus filter is on. It has not hidden anything yet.',
  }
}
