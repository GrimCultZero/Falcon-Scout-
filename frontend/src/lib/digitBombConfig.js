// ── Auto Digit Bomb: the numbers the owner can tune (T22, 2026-11-16) ─────────────────────────────
// ONE small file. The matcher (digitBombMatch.js) has no numbers or word lists of its own.
//
// Score 0-100 = niche (70) + the three secondary signals (30). The service must be the same
// ("required"): if it differs the score is 0 and the bomb never fires. At AUTO_FIRE_AT or more the
// letter opens with that case's own numbers from the case ledger; below it the generator is unchanged.

export const AUTO_BOMB = {
  AUTO_FIRE_AT: 90,
  WEIGHTS: { niche: 70, market: 10, platform: 10, model: 10 },
  // Niche: a SPECIFIC tag shared with the case earns the full weight; a BROAD tag only (e.g. both are
  // "ecommerce") earns BROAD_NICHE_SHARE of it, which can never reach AUTO_FIRE_AT on its own.
  BROAD_NICHE_SHARE: 0.5,
  // A niche counts for the JOB only if it is strong: a keyword in the TITLE, or the description mentions it
  // NICHE_MIN_STRENGTH times (a title hit is worth NICHE_TITLE_POINTS; each description mention 1, up to
  // NICHE_BODY_CAP per niche). Among the SPECIFIC niches, one weaker than NICHE_REL_STRENGTH x the strongest is
  // dropped, so a floral designer that mentions "beauty" once is a florist job, not a beauty job.
  NICHE_MIN_STRENGTH: 3,
  NICHE_TITLE_POINTS: 3,
  NICHE_BODY_CAP: 5,
  NICHE_REL_STRENGTH: 0.5,
}

// Service of the JOB, from the title (x TITLE_WEIGHT) and description. The strongest wins; a tie, or
// no signal at all, means "unknown" and the bomb stays off. Values are the ledger's `service` field,
// plus 'meta' (no case uses it, so a Meta-only job never opens with a Google Ads case).
export const TITLE_WEIGHT = 3
// PRIMARY deliverable (2026-11-16): the service is the one the TITLE leads with, i.e. whose keyword appears
// first. A title led by web design / redesign / development is a web-dev job, and one led by Meta / social is a
// meta job, even if SEO or Google Ads follow as add-ons, so an SEO or Ads case cannot fire for it. Google Ads and
// SEO together in a title (neither web-dev nor meta before them) is a tie: unknown, no bomb. With no service word
// in the title, the description decides (strongest wins, a tie is unknown).
export const TIE_SERVICES = ['ppc', 'seo']
export const SERVICE_TAGS = {
  ppc: ['google ads', 'adwords', 'ppc', 'performance max', 'pmax', 'google shopping', 'shopping ads', 'search ads', 'paid search', 'sem', 'youtube ads', 'demand gen campaign'],
  seo: ['seo', 'geo', 'aeo', 'ai search', 'search engine optimi', 'technical seo', 'local seo', 'link building', 'backlink', 'organic traffic'],
  'web-dev': ['web developer', 'website developer', 'web development', 'website development', 'wordpress', 'webflow', 'opencart', 'shopify developer', 'shopify theme', 'shopify store build', 'custom module', 'build a website', 'web design', 'website design', 'redesign', 'ux/ui', 'ui/ux', 'front-end', 'frontend'],
  // Meta / social: a job LED by these never fires a Google Ads case (rule 2 of the 2026-11-16 tightening).
  meta: ['meta ads', 'meta,', 'meta &', 'meta and', 'facebook', 'instagram', 'tiktok', 'linkedin ads', 'snapchat', 'paid social', 'social ads', 'social media ads', 'social media'],
}

// Niche tags of the JOB (keywords in the title + description). BROAD tags are wide groups.
export const BROAD_NICHES = ['ecommerce', 'local-services', 'b2b', 'health']
export const NICHE_TAGS = {
  skincare: ['skincare', 'skin care', 'serum', 'moisturi', 'dermat', 'anti-aging', 'cosmeceutical'],
  'beauty-wellness': ['beauty', 'cosmetic', 'makeup', 'med spa', 'medspa', 'spa ', 'salon', 'wellness', 'aesthetic', 'skincare', 'skin care', 'hair care', 'haircare'],
  health: ['clinic', 'medical', 'healthcare', 'dental', 'dentist', 'supplement', 'pharma', 'patient', 'doctor', 'therapy'],
  ecommerce: ['shopify', 'woocommerce', 'ecommerce', 'e-commerce', 'online store', 'webshop', 'dtc', 'd2c', 'direct-to-consumer', 'product feed', 'merchant center'],
  'local-services': ['plumb', 'roofing', 'hvac', 'painting', 'painter', 'contractor', 'appliance repair', 'home service', 'near me', 'cleaning service', 'locksmith', 'local service', 'lead gen'],
  b2b: ['saas', 'b2b', 'enterprise', 'software', 'manufactur', 'industrial', 'equipment', 'wholesale'],
  'real-estate': ['real estate', 'realtor', 'property developer', 'residential complex', 'homes for sale'],
  luxury: ['luxury brand', 'luxury goods', 'luxury watch', 'jewelry', 'jewellery', 'watches', 'perfume', 'fragrance', 'parfum'],
  florist: ['florist', 'flowers', 'floral'],
  fashion: ['fashion', 'apparel', 'clothing', 'streetwear', 'footwear'],
  furniture: ['furniture', 'sofa', 'home decor'],
  restricted: ['vape', 'e-cigarette', 'cbd', 'kratom'],
}

// Secondary signals of the JOB.
export const MARKET_TAGS = {
  us: ['united states', ' usa', 'u.s.', ' us-based', 'us based', 'american', 'north america'],
  canada: ['canada', 'canadian', 'ottawa', 'toronto'],
  europe: ['europe', 'european', 'germany', 'german', 'italy', 'italian', 'france', 'spain', 'netherlands', 'poland', ' eu '],
  uk: ['united kingdom', ' uk ', 'british', 'london'],
}
// client country (job.client_country / job.geo_restriction) -> market
export const COUNTRY_MARKET = { 'united states': 'us', usa: 'us', us: 'us', canada: 'canada', 'united kingdom': 'uk', uk: 'uk', germany: 'europe', italy: 'europe', france: 'europe', spain: 'europe', netherlands: 'europe', poland: 'europe' }
export const PLATFORM_TAGS = {
  pmax: ['performance max', 'pmax'],
  shopping: ['shopping', 'merchant center', 'product feed', 'gmc'],
  search: ['search campaign', 'search ads', 'paid search', 'keyword'],
  video: ['youtube', 'video campaign', 'demand gen campaign'],
  analytics: ['ga4', 'tag manager', 'gtm', 'conversion tracking', 'enhanced conversions'],
}
export const MODEL_TAGS = {
  ecommerce: ['shopify', 'woocommerce', 'ecommerce', 'e-commerce', 'online store', 'dtc', 'd2c', 'product feed', 'merchant center', 'shopping'],
  'lead-gen': ['lead gen', 'leads', 'local service', 'appointments', 'bookings', 'quote requests', 'call tracking'],
  b2b: ['saas', 'b2b', 'enterprise', 'manufactur', 'industrial', 'wholesale'],
}

// What each ledger case IS, in the same tags. `niche` lists specific tags first; the matcher treats
// BROAD_NICHES as broad. A case with no entry here can never auto-fire. market/platform/model are
// copied from the ledger record (geo, one_liner, metrics), nothing else.
// A case whose niche is health / wellness / skincare needs one of THESE tags in the job. "Ecommerce" alone (a store
// that happens to sell something) earns such a case no niche points at all.
export const WELLNESS_GATE = ['skincare', 'beauty-wellness', 'health']

export const CASE_TAGS = {
  'skin-reboot':          { niche: ['skincare', 'beauty-wellness', 'ecommerce', 'health'], market: ['us'], platform: ['pmax', 'shopping', 'analytics'], model: 'ecommerce' },
  'derma-solution':       { niche: ['skincare', 'beauty-wellness', 'health'], market: ['us'], platform: [], model: 'lead-gen' },
  'golden-state-trailers': { niche: ['b2b'], market: ['us'], platform: [], model: 'b2b' },
  'nectar-flowers':       { niche: ['florist', 'ecommerce'], market: ['canada'], platform: ['shopping', 'search'], model: 'ecommerce' },
  fridgefix:              { niche: ['local-services'], market: ['us'], platform: ['pmax', 'search', 'analytics'], model: 'lead-gen' },
  'house-painting':       { niche: ['local-services'], market: ['us'], platform: ['pmax', 'search'], model: 'lead-gen' },
  'multilingual-site':    { niche: ['local-services'], market: ['europe'], platform: [], model: 'lead-gen' },
  oxytec:                 { niche: ['b2b'], market: ['europe'], platform: [], model: 'b2b' },
  'luxury-parfums':       { niche: ['luxury', 'beauty-wellness', 'ecommerce'], market: [], platform: [], model: 'ecommerce' },
  chronocash:             { niche: ['luxury', 'ecommerce'], market: ['europe'], platform: ['pmax', 'video'], model: 'lead-gen' },
  atlant:                 { niche: ['real-estate'], market: [], platform: ['pmax', 'video'], model: 'lead-gen' },
  'vape-shop':            { niche: ['restricted', 'ecommerce'], market: [], platform: [], model: 'ecommerce' },
  smash:                  { niche: ['fashion', 'ecommerce'], market: [], platform: [], model: 'ecommerce' },
  'game-x':               { niche: ['ecommerce'], market: [], platform: [], model: 'ecommerce' },
  gkit:                   { niche: ['fashion', 'ecommerce'], market: [], platform: [], model: 'ecommerce' },
  'casa-eleganza':        { niche: ['furniture', 'ecommerce'], market: ['us'], platform: [], model: 'ecommerce' },
}
