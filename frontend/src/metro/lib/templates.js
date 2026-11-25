// New-campaign templates (F1 item 9). "agency" arrives pre-filled with this brief; every field stays editable.
// "niche" starts empty and is drafted from the niche name with the "Draft the brief" button (never saved by itself).
export const AGENCY_TEMPLATE = {
  who: 'Owners, founders and managing partners of small digital marketing agencies (1-50 people) that sell Google Ads, SEO or web services to their own clients.',
  pains: [
    'They sell more Google Ads and SEO work than their team can deliver',
    'A client needs deeper technical SEO or Google Ads expertise than they have in-house',
    'Hiring senior PPC or SEO specialists is slow and expensive',
    'They need reliable white-label delivery that never contacts their client',
  ],
  do_not_claim: [
    'Top 3% of Google Partners',
    'Any number of years other than "since 2015"',
    'Guaranteed results or rankings',
    'Client names without permission',
    'Prices or rates',
  ],
  offer: "Send us one client you're struggling to deliver for and we'll scope it, or start with a free pilot audit, delivered under your brand.",
}

export const NICHE_TEMPLATE = { who: '', pains: [], do_not_claim: [...AGENCY_TEMPLATE.do_not_claim], offer: '' }

export const templateFor = (type) => (type === 'niche' ? NICHE_TEMPLATE : AGENCY_TEMPLATE)
