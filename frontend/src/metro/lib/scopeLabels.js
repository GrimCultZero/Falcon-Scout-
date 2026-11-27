// P3b, Minor fixes #5 (Oleh, 27 Nov 2026): a button label says what the button will ACTUALLY process, never the rows merely shown.
// "Write hooks (495 shown, shortlisted only)" made Oleh think it wrote hooks for 495 leads; it wrote them for 8 companies (the 13
// shortlisted leads). Now: "Write hooks (13 shortlisted · 8 companies)". Pure (tests/metro/p3b-ui.test.js).

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// scopeLabel('Write hooks', { n: 13, what: 'shortlisted', companies: 8 }) -> "Write hooks (13 shortlisted · 8 companies)"
export function scopeLabel(verb, { n = 0, what = 'shown', companies = null } = {}) {
  const parts = [`${n} ${what}`]
  if (companies != null && companies !== n) parts.push(plural(companies, 'company', 'companies'))
  return `${verb} (${parts.join(' · ')})`
}

// the distinct companies among some rows (a row without a company counts as its own)
export function companiesOf(rows) {
  return new Set((rows || []).map((l) => (l.company_id ? `c${l.company_id}` : `l${l.id}`))).size
}
