// Geo-restriction scraper: no more false "US only" flags (audit 2026-10-29, T20).
//
// The analyser treats "United States only" as a hard disqualifier ("Artem cannot
// legally apply"), so a wrong value turns a good job into a SKIP. Evidence (report
// section 10): two Worldwide jobs (#21118, #21119) were stamped "United States only"
// at 17:29-17:30 UTC while real US-only pages were open in the same Chrome, and live
// rows hold junk such as "Skills and Expertise", "English: Strong working
// proficiency", "- Tools: Google Ads / MCC, GA4, GTM, Hub" (the label branch grabbing
// the next line).
//
// Same style as client-panel-unknown.test.js: the REAL functions are lifted out of
// upwork-enricher/content.js and fed pages. Pinned:
//   * a value comes only from the exact sentence or a header label with a KNOWN value;
//   * label-branch junk and bare mentions are null (unknown), never a value;
//   * every written value carries the evidence it came from;
//   * a reading is dropped when the URL changed while scraping, or the page's own
//     job id disagrees with the URL;
//   * the real US-only banner still yields "United States only".
//
// Run: node tests/geo-restriction.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'content.js'), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('  function getJobId()');
const to = src.indexOf('\n    return data;\n  }\n', src.indexOf('  function extractData()')) + '\n    return data;\n  }\n'.length;
const lifted = src.slice(from, to);

const ID_A = '022105234066801763360';
const ID_B = '022118856703357447301';
function env({ href = `https://www.upwork.com/jobs/~${ID_A}`, canonical = null, og = null, pageText = '' } = {}) {
  const document = {
    title: 'Some Job | Upwork',
    body: { innerText: pageText },
    querySelector: (sel) => {
      if (sel === 'link[rel="canonical"]' && canonical) return { href: canonical };
      if (sel === 'meta[property="og:url"]' && og) return { content: og };
      return null;
    },
    querySelectorAll: () => [],
  };
  const window = { location: { href } };
  const quiet = { log() {}, warn() {}, error() {} };
  return new Function('document', 'window', 'console', `${lifted}; return { extractData, parseGeoRestriction, normalizeGeoValue, sameJobProblem, pageOwnJobIds, jobIdFromUrl, GEO_PLACES };`)(document, window, quiet);
}
const geo = (text) => env().parseGeoRestriction(text);
const job = 'Meta & Google Ads Strategist\nWe need a freelancer to own Meta Ads and Google Ads.';

// ── the real US-only banner ─────────────────────────────────────────────────
let g = geo(`${job}\nOnly freelancers located in the U.S. may apply\nAbout the client`);
assert(g.geo_restriction === 'United States only', 'the REAL banner ("…located in the U.S. may apply") still yields "United States only"');
assert(g.geo_evidence === 'Only freelancers located in the U.S. may apply', `…and stores the sentence as evidence ("${g.geo_evidence}")`);
for (const [sentence, want] of [['the United States', 'United States only'], ['the US', 'United States only'], ['USA', 'United States only'], ['the UK', 'United Kingdom only'],
  ['Canada', 'Canada only'], ['North America', 'North America only'], ['the EU', 'EU only']]) {
  assert(geo(`Only freelancers located in ${sentence} may apply`).geo_restriction === want, `sentence "…located in ${sentence} may apply" -> ${want}`);
}
assert(geo('Only freelancers located in the U.S. \n may apply').geo_restriction === 'United States only', 'the sentence tolerates a wrapped line');

// ── the header label: known values only ─────────────────────────────────────
for (const [label, want] of [['Worldwide', 'Worldwide'], ['worldwide', 'Worldwide'], ['United States', 'United States'], ['US only', 'United States only'],
  ['U.S. only', 'United States only'], ['United States only', 'United States only'], ['Germany', 'Germany'], ['Europe', 'Europe'], ['North America only', 'North America only']]) {
  const r = geo(`${job}\nTalent Preferences\n${label}\nProject Type: Hourly`);
  assert(r.geo_restriction === want && /Talent Preferences -> /.test(r.geo_evidence || ''), `label value "${label}" -> ${want} (with evidence)`);
}
assert(geo('Preferred Location: Worldwide\nx').geo_restriction === 'Worldwide', 'a value on the label line itself ("Preferred Location: Worldwide")');

// ── junk is null ────────────────────────────────────────────────────────────
for (const junk of ['Skills and Expertise', 'English: Strong working proficiency', '- Tools: Google Ads / MCC, GA4, GTM, Hub', '- Monthly management fee: US$300–400.',
  '**Working commitment:** 4 hours per day,', 'Hourly', 'Experience Level', 'Entry Level', 'I am willing to travel', '']) {
  const r = geo(`${job}\nTalent Preferences\n${junk}\nMore text`);
  assert(r.geo_restriction === null && r.geo_evidence === null, `label-branch junk is NULL: "${junk.slice(0, 44)}"`);
}
assert(geo('Preferred location to start: tomorrow\nSkills and Expertise\nGoogle Ads').geo_restriction === null, 'the word "Preferred location" in prose followed by a heading is null');
assert(geo(`${job}\nWorldwide`).geo_restriction === null, 'a bare "Worldwide" with no label is null (no keyword branch any more)');
assert(geo('We want a US only agency, United States only please.').geo_restriction === null, 'a "US only" mention in the DESCRIPTION is null: it is not the page\'s own restriction');
assert(geo('').geo_restriction === null && geo(null).geo_restriction === null, 'empty page -> null');

// ── normalizeGeoValue directly ──────────────────────────────────────────────
const { normalizeGeoValue } = env();
assert(normalizeGeoValue('x'.repeat(80)) === null && normalizeGeoValue('Worldwide\nGoogle Ads') === null, 'over-long or multi-line text is refused');
assert(normalizeGeoValue('Skills and Expertise only') === null && normalizeGeoValue('English only') === null && normalizeGeoValue('Fluent English only') === null,
  'an "only" value needs a KNOWN place: "English only" and free text are refused');
assert(geo('Only freelancers located in the United States or Canada may apply').geo_restriction === 'United States or Canada only', 'a list of known places is fine ("United States or Canada only")');
assert(geo('Only freelancers located in Narnia may apply').geo_restriction === null, 'an unknown place in the sentence is null, not guessed');
assert(normalizeGeoValue('English: Strong working proficiency') === null, 'a colon in the value is refused');

// ── extractData wiring ──────────────────────────────────────────────────────
let d = env({ pageText: `${job}\nOnly freelancers located in the U.S. may apply` }).extractData();
assert(d.geo_restriction === 'United States only' && d.geo_evidence && d.job_id === ID_A, 'extractData: US-only page -> value + evidence, job id from the URL');
d = env({ pageText: `${job}\nTalent Preferences\nSkills and Expertise` }).extractData();
assert(d.geo_restriction === null && d.geo_evidence === null, 'extractData: junk after the label -> geo_restriction null');
d = env({ pageText: `${job}\nWorldwide in scope; we are a US only company culture.` }).extractData();
assert(d.geo_restriction === null, 'extractData: prose that merely contains "Worldwide" / "US only" -> null');

// ── same job? (URL / page id) ───────────────────────────────────────────────
const e = env();
const ids = (...a) => new Set(a);
assert(e.sameJobProblem(`https://x/jobs/~${ID_A}`, `https://x/jobs/~${ID_A}?x=1`, ID_A, ids(ID_A)) === null, 'consistent: same URL id, same page id -> keep');
assert(e.sameJobProblem(`https://x/jobs/~${ID_A}`, `https://x/jobs/~${ID_B}`, ID_A, ids(ID_A)) !== null, 'the URL moved to another job while scraping -> DROP');
assert(/URL changed/.test(e.sameJobProblem(`https://x/jobs/~${ID_A}`, `https://x/jobs/~${ID_B}`, ID_A, ids())), '…with the reason');
assert(/page's own job id/.test(e.sameJobProblem(`https://x/jobs/~${ID_A}`, `https://x/jobs/~${ID_A}`, ID_A, ids(ID_B))), 'the page\'s own id (canonical / og:url) is another job -> DROP');
assert(e.sameJobProblem(`https://x/jobs/~${ID_A}`, `https://x/jobs/~${ID_A}`, ID_B, ids(ID_A)) !== null, 'the scraped job id differs from the URL the scrape started on -> DROP');
assert(e.sameJobProblem(`https://x/jobs/~${ID_A}`, `https://x/jobs/~${ID_A}`, ID_A, ids()) === null, 'no page id in the DOM: nothing to contradict the URL -> keep');
assert(e.sameJobProblem('https://x/nx/jobs/search', `https://x/jobs/~${ID_A}`, ID_A, ids(ID_A)) !== null, 'the tab had no job when scraping started but has one now -> DROP');
assert(e.sameJobProblem(`https://x/jobs/~${ID_A.toUpperCase()}`, `https://x/jobs/~${ID_A}`, ID_A, ids(ID_A)) === null, 'ids compare case-insensitively');
const mixed = env({ href: `https://www.upwork.com/jobs/~${ID_A}`, canonical: `https://www.upwork.com/jobs/~${ID_B}`, og: `https://www.upwork.com/jobs/~${ID_B}` });
assert(mixed.sameJobProblem(`https://www.upwork.com/jobs/~${ID_A}`, `https://www.upwork.com/jobs/~${ID_A}`, mixed.extractData().job_id, mixed.pageOwnJobIds()) !== null,
  'MIXED: address bar says job A, canonical/og:url say job B (a half-navigated SPA) -> DROP');
const clean = env({ canonical: `https://www.upwork.com/jobs/~${ID_A}`, og: `https://www.upwork.com/jobs/~${ID_A}` });
assert(clean.sameJobProblem(`https://www.upwork.com/jobs/~${ID_A}`, `https://www.upwork.com/jobs/~${ID_A}`, ID_A, clean.pageOwnJobIds()) === null, '…and when they agree it is kept');

// ── the shipped run() uses the guard, before sending ────────────────────────
const runSrc = src.slice(src.indexOf('  async function run()'));
assert(/const startHref = window\.location\.href;/.test(runSrc), 'run() records the tab\'s URL when the scrape STARTS');
assert(runSrc.indexOf('sameJobProblem(startHref') > 0 && runSrc.indexOf('sameJobProblem(startHref') < runSrc.indexOf("type: 'ENRICH_JOB'"), '…and checks it BEFORE the result is sent to the backend');
assert(/return;\n      \}\n\n      console\.log\('\[Cockpit\] Extracted:'/.test(runSrc), '…dropping the whole reading, not just the geo field');
assert(!/geoKeywordMatch|geoLabelMatch/.test(src), 'the old label-grabs-next-line and bare-keyword branches are gone');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'upwork-enricher', 'manifest.json'), 'utf8'));
assert(manifest.version === '5.17', `extension version 5.17 so a stale loaded extension is visible (${manifest.version})`);

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
