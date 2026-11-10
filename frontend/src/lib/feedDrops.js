// Wording for the feed's "Filtered out" view and the feed badges (audit 2026-10-29, T18).
//
// The backend (GET /feed-drops) groups what the filter dropped by a reason string such
// as "no-keyword-in-text", "stopword:meta ads" or "hourly<25". This turns those into
// plain language, and says which groups are WHERE A MISS WOULD BE ("text": the filter
// judged the words) and which are Artem's own floors working ("policy": rate, payment,
// age, country). Pure functions, no React.

/** Plain-language label for a drop reason. */
export function describeReason(reason) {
  const r = String(reason || '')
  if (r === 'no-keyword-in-text') return 'No feed keyword in the title or description'
  if (r.startsWith('stopword:')) return `Stop word in the title: "${r.slice('stopword:'.length)}"`
  let m
  if ((m = r.match(/^hourly<(\d+)/))) return `Hourly rate under $${m[1]}`
  if ((m = r.match(/^fixed<(\d+)/))) return `Fixed price under $${m[1]}`
  if (r === 'unverified-payment') return 'Payment not verified'
  if ((m = r.match(/^posted>(\d+)h/))) return `Posted more than ${m[1]} h ago`
  if (r.startsWith('country:')) return `Excluded country: ${r.slice('country:'.length)}`
  if (r === 'testweek:webdev') return 'Test week: pure web development / design job hidden'
  return r || 'Unknown reason'
}

/** "text" groups are where an in-lane miss would show; "policy" groups are the floors. */
export function reasonKind(reason) {
  const r = String(reason || '')
  return (r.startsWith('hourly<') || r.startsWith('fixed<') || r === 'unverified-payment'
    || r.startsWith('posted>') || r.startsWith('country:')) ? 'policy' : 'text'
}

/**
 * Badge for a feed row that passed the filter only because its title is about
 * tracking or a Google Business Profile. null = no badge.
 */
export function feedTagBadge(tag) {
  if (tag === 'tracking') {
    return {
      label: 'TRACKING ONLY',
      title: 'The title is about tracking / analytics setup (GA4, Tag Manager, conversion tracking, consent mode) and does not mention Google Ads or SEO work. Passed the feed filter on purpose; check the scope before applying.',
      color: '#1d4ed8', bg: 'rgba(59,130,246,0.13)', border: 'rgba(59,130,246,0.45)',
    }
  }
  if (tag === 'gbp') {
    return {
      label: 'GBP',
      title: 'The title is about a Google Business Profile and does not mention Google Ads or SEO work. Part of this category is reputation management (review removal) rather than SEO. Passed the feed filter on purpose; check the scope before applying.',
      color: '#b45309', bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.5)',
    }
  }
  const test = {
    'test:unverified': ['TEST: UNVERIFIED', 'Test week: the client\'s payment is not verified. Normally dropped. Expect more scams and no-hire posts; skim quickly.'],
    'test:low-hourly': ['TEST: LOW HOURLY', 'Test week: the hourly rate is under the usual floor. Normally dropped.'],
    'test:low-fixed': ['TEST: LOW FIXED', 'Test week: the fixed price is under the usual floor. Normally dropped.'],
  }[tag]
  if (test) {
    return { label: test[0], title: test[1], color: '#6d28d9', bg: 'rgba(139,92,246,0.14)', border: 'rgba(139,92,246,0.5)' }
  }
  return null
}

/** A row's feed_tag can hold several comma-separated tags ("gbp,test:low-fixed"). */
export function feedTagBadges(tags) {
  return String(tags || '').split(',').map(t => t.trim()).filter(Boolean)
    .map(t => ({ tag: t, badge: feedTagBadge(t) })).filter(x => x.badge)
}
