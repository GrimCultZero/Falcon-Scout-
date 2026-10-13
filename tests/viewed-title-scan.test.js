// The proposals-list title-scan flags a row viewed only on an exact title.
// Owner, 2026-10-13: Upwork showed 0 viewed this week, the dashboard 5. The
// fuzzy fallback let the viewed job titled "Google ads" flag every title that
// contains "google ads" on the same page. Lifted from proposal.js.
const fs = require('fs');
const src = fs.readFileSync(String.raw`C:\Users\syzov\upwork-cockpit\upwork-enricher\proposal.js`, 'utf8')
  .replace(/\r\n/g, '\n');
const a = src.indexOf('function _titleScanSaysViewed(');
const b = src.indexOf('\n  }\n', a) + 4;
const _titleScanSaysViewed = new Function(`${src.slice(a, b)}; return _titleScanSaysViewed`)();

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

// The real page: only "Google ads" carried "Viewed by client".
const viewed = new Set(['google ads']);
check(_titleScanSaysViewed('Google ads', viewed), 'the viewed row itself');
for (const t of [
  'Senior Google Ads Specialist for Shopify E-commerce Brand',
  'Google Ads Specialist for Brand Search',
  'Google Ads Audit and Optimization Expert',
  'Google Ads PPC Specialist for E-commerce',
  'Google Ads PPC & LSA Manager Needed | Long-Term Agency Partnership',
]) check(!_titleScanSaysViewed(t, viewed), `not smeared onto "${t}"`);

// The other direction of the old fuzzy test: a longer viewed title must not flag a shorter one.
check(!_titleScanSaysViewed('Google Ads Specialist', new Set(['google ads specialist for healthcare'])),
  'a longer viewed title does not flag its prefix');
// Keys are the first 60 characters, lowercased.
const long = 'Local SEO & Google Business Profile Optimization for Pest Control Company in Los Angeles';
check(_titleScanSaysViewed(long, new Set([long.toLowerCase().slice(0, 60).trim()])), 'a long title matches its 60-char key');
check(!_titleScanSaysViewed('', viewed) && !_titleScanSaysViewed('Google ads', new Set()), 'nothing to match -> false');
// The fuzzy loop must be gone from the scrape itself.
check(!/title-scan fuzzy/.test(src), 'no fuzzy title-scan left in proposal.js');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
