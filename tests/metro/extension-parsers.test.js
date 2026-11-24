// Metro LinkedIn Scraper (extension folder metro-linkedin/), Phase 2 step 4. What can be checked without Chrome:
//   * parsers.js: Ahrefs, Ads Transparency, Business Profile, LinkedIn company page and profile text -> fields;
//     a field that cannot be read is left out, never guessed; numbers like "2,3K" (comma = decimal before K) and "1,234" read right;
//   * limits.js: the only URLs a job may open are built here from its kind + target (never a URL from the server);
//     a Linked Helper week, a spent daily cap and a hostile target are refused before anything opens;
//   * the manifest and the code: no standing content script on LinkedIn except the read-only feed identity one,
//     the extension never clicks Connect / Follow / Message / Send, it asks the backend before every job, and it
//     refuses to run in a Linked Helper week by itself;
//   * Falcon Scout's own extension still works on 5180 only (Phase 0 rule) and is not touched by this one.
// Run: node tests/metro/extension-parsers.test.js
const fs = require('fs')
const path = require('path')
const EXT = path.join(__dirname, '..', '..', 'metro-linkedin')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8')

const P = require(path.join(EXT, 'parsers.js'))
const L = require(path.join(EXT, 'limits.js'))

// ── numbers ──
assert(P.num('2,3K') === 2300 && P.num('1,234') === 1234 && P.num('1 234') === 1234 && P.num('1.5M') === 1500000 && P.num('x') === null, 'num(): "2,3K" is 2300, "1,234" is 1234')

// ── Ahrefs ──
const AH = `Domain Rating\n12.4\nUR 8\nBacklinks\n1,234\nRef. domains\n88\nOrganic keywords\n1.2K\nOrganic traffic\n↑\n2,300\n` + 'x'.repeat(700)
const a = P.parseAhrefs(AH)
assert(a.dr === 12.4 && a.backlinks === 1234 && a.ref_domains === 88 && a.organic_keywords === 1200 && a.organic_traffic === 2300, 'Ahrefs overview text is parsed: DR, backlinks, ref domains, keywords, traffic')
assert(P.ahrefsReady(AH) && !P.ahrefsReady('Loading...'), 'Ahrefs is "ready" only when the metrics have rendered')
assert(Object.keys(P.parseAhrefs('nothing here')).length === 0, 'an Ahrefs page with no metrics gives no fields (nothing guessed)')

// ── Ads Transparency ──
const ADS = 'Advertiser\nAcme Dental LLC\n~42 ads\nLast shown: Nov 20, 2026\nFirst shown: Mar 3, 2025\nText Image Video'
const ad = P.parseAdsTransparency(ADS)
assert(ad.found && ad.running && ad.ads_count === 42 && ad.advertiser === 'Acme Dental LLC' && ad.last_seen === 'Nov 20, 2026' && ad.first_seen === 'Mar 3, 2025', 'Ads Transparency: advertiser, ad count, dates')
const none = P.parseAdsTransparency('Google Ads Transparency Center\nWe couldn\'t find any ads for this search')
assert(none.found === false && none.running === false, 'no ads is a reading (found false), not an error')

// ── Business Profile ──
const g = P.parseGbp({ name: 'Acme Dental', text: '4.1\n(37)\nDentist\nClaim this business', address: 'Address: 1 Main St', phone: 'Phone: 555 0100', website: 'Website: acme.example', categories: ['Dentist'] })
assert(g.found && g.rating === 4.1 && g.review_count === 37 && g.address === '1 Main St' && g.phone === '555 0100' && g.website === 'acme.example' && g.claimed === false, 'Business Profile: rating, reviews, address, phone, website, unclaimed')
assert(P.parseGbp({}).found === false, 'an empty panel is found:false')
const g2 = P.parseGbp({ text: 'X', rating: 6, reviews: '1,2K' })
assert(g2.rating === undefined && g2.review_count === 1200, 'an impossible rating (6) is dropped, "1,2K" reviews read as 1200')

// ── LinkedIn company about page ──
const CO = `Overview\nWebsite\nhttps://www.birchortho.example\nIndustry\nMedical Practices\nCompany size\n11-50 employees\nHeadquarters\nSpringfield, IL\nFounded\n2009\nSpecialties\nBraces, Invisalign, Orthodontics\n820 followers\n14 associated members`
const co = P.parseCompanyAbout(CO)
assert(co.website === 'https://www.birchortho.example' && co.industry === 'Medical Practices' && co.employees_range === '11-50' && co.headquarters === 'Springfield, IL' && co.founded === '2009', 'company page: website, industry, size, headquarters, founded')
assert(co.specialties.length === 3 && co.followers === 820 && co.employees_on_linkedin === 14, 'company page: specialties, followers, members on LinkedIn')

// ── LinkedIn profile text ──
const PR = `Ann Acme\nOwner at Acme Dental\nAbout\nI run a family practice in Springfield.\nSee more\nActivity\n1,200 followers\nA post about our new clinic opening this spring\nShow all\nExperience\nOwner\nSkills\nImplants\nWhitening`
const pr = P.parseProfileText(PR)
assert(/family practice/.test(pr.about) && !/See more/.test(pr.about), 'profile: About read, "See more" dropped')
assert(pr.recent_activity && pr.recent_activity.some((x) => /new clinic/.test(x)), 'profile: recent activity read')
assert(P.slugFromHref('https://www.linkedin.com/in/Ann-Acme/?x=1') === 'ann-acme', 'profile slug from a link')

// ── limits: URLs a job may open ──
assert(L.urlFor('linkedin_profile', 'https://www.linkedin.com/in/ann-acme') === 'https://www.linkedin.com/in/ann-acme/', 'profile URL is rebuilt from the slug')
assert(L.urlFor('linkedin_profile', 'https://evil.example/in/ann') === null && L.urlFor('linkedin_profile', 'https://www.linkedin.com/messaging/') === null, 'a non-profile URL is refused')
assert(L.urlFor('linkedin_company', 'linkedin.com/company/birch-ortho') === 'https://www.linkedin.com/company/birch-ortho/about/', 'company URL goes to the About page')
assert(L.urlFor('ads_transparency', 'Acme.Example') === 'https://adstransparency.google.com/?region=anywhere&domain=acme.example', 'Ads Transparency URL is built from the domain')
assert(L.urlFor('ads_transparency', 'x.example/evil?x=1') === null && L.urlFor('ahrefs', 'http://evil') === null, 'a domain job refuses anything that is not a bare domain')
assert(/^https:\/\/app\.ahrefs\.com\/site-explorer\/overview\?mode=subdomains&target=acme\.example%2F$/.test(L.urlFor('ahrefs', 'acme.example')), 'Ahrefs URL is the Site Explorer overview of the domain')
assert(L.urlFor('gbp', 'Acme Dental Springfield').startsWith('https://www.google.com/maps/search/Acme%20Dental') && L.urlFor('gbp', 'x'.repeat(200)) === null, 'Business Profile URL is a Maps search; an absurd query is refused')
assert(L.urlFor('whatever', 'x') === null, 'an unknown job kind has no URL')

// ── limits: refusing a job ──
const job = { kind: 'linkedin_profile', target: 'https://www.linkedin.com/in/ann-acme' }
assert(L.refuse(job, { week_mode: 'metro', visits_today: 3, cap: 60 }) === null, 'a good job in a Metro week is accepted')
assert(/Linked Helper week/.test(L.refuse(job, { week_mode: 'linked_helper', visits_today: 0, cap: 60 })), 'ACCEPTANCE: the extension refuses a job in a Linked Helper week by itself')
assert(/cap/.test(L.refuse(job, { week_mode: 'metro', visits_today: 61, cap: 60 })) && /cap/.test(L.refuse(job, { week_mode: 'metro', visits_today: 90, cap: 200 })), 'a spent daily cap refuses, and no cap can exceed 80')
assert(L.refuse({ kind: 'ahrefs', target: 'acme.example' }, { week_mode: 'metro', visits_today: 99, cap: 60 }) === null, 'a non-LinkedIn job is not stopped by the LinkedIn cap')
assert(L.refuse({ kind: 'delete_account', target: 'x' }, {}) !== null && L.refuse(null, {}) !== null && L.refuse({ kind: 'gbp', target: '' }, {}) !== null, 'unknown kinds, no job and an empty target are refused')
assert(L.HARD_MAX_VISITS === 80 && L.DEFAULT_VISITS === 60, 'caps: default 60, hard maximum 80')

// ── manifest and code ──
const man = JSON.parse(read('manifest.json'))
assert(man.manifest_version === 3 && /^0\./.test(man.version) && man.name === 'Metro LinkedIn Scraper', 'manifest v3, its own name and version')
const cs = man.content_scripts || []
assert(cs.length === 1 && JSON.stringify(cs[0].matches) === JSON.stringify(['https://www.linkedin.com/feed/*']) && cs[0].js.includes('register.js') && !cs[0].js.includes('scrape.js'),
  'the only standing content script is the read-only identity reader on linkedin.com/feed (a page the person opened)')
assert(!man.host_permissions.some((h) => /upwork\.com|:5173|:5174|:5180|<all_urls>|https:\/\/\*\/\*/.test(h)), 'no Upwork, no dev-server ports, no <all_urls>')
assert(man.host_permissions.includes('http://127.0.0.1:8000/*') && man.permissions.every((p) => ['tabs', 'storage', 'scripting', 'alarms'].includes(p)), 'talks to the local backend only; four plain permissions')
const bg = read('background.js')
assert(/api\('\/week'\)/.test(bg) && /week_mode !== 'metro'/.test(bg), 'the background asks the backend for the week before every job and stops in a Linked Helper week')
assert(/jobs\/next\?sender_id=/.test(bg) && /L\(\)\.refuse\(job/.test(bg) && /L\(\)\.urlFor\(job\.kind, job\.target\)/.test(bg), 'every job comes from /jobs/next, passes refuse(), and its URL is built locally')
assert(!/job\.url/.test(bg), 'a URL supplied by the server is never opened')
assert(/if \(!st\.enabled\)/.test(bg) && !/enabled: true/.test(bg), 'the extension is off until a person switches it on')
assert(/busy/.test(bg) && /periodInMinutes: 1/.test(bg), 'one job at a time, polled once a minute (the backend paces)')
const sc = read('scrape.js')
assert(!/\.click\(\)/.test(sc.replace(/first\.click\(\)/, '')) && /first\.click\(\)/.test(sc), 'the only click in the scraper is opening the first Maps result (a read)')
assert(!/querySelector\([^)]*(connect|follow|message-?button|send)/i.test(sc), 'the scraper never looks for a Connect / Follow / Message / Send button')
assert(!/fetch\(|XMLHttpRequest|sendBeacon/.test(sc), 'the scraper makes no network request of its own')
const reg = read('register.js')
assert(!/\.click\(|fetch\(/.test(reg) && /METRO_ME/.test(reg), 'the identity reader only reads and tells the background')
assert(read('popup.html').includes('Take jobs from Metro') && /id="on"/.test(read('popup.html')), 'the popup has the on/off switch')

// ── Falcon Scout's own extension is untouched by Phase 2 ──
const fs5 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'upwork-enricher', 'manifest.json'), 'utf8'))
assert(!/metro/i.test(JSON.stringify(fs5)), 'the Falcon Scout Enricher manifest does not mention Metro')

console.log(`\n${bad ? bad + ' FAILED' : 'all passed'}`)
process.exit(bad ? 1 : 0)
