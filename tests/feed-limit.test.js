// The feed asks for enough rows (audit 2026-10-29, T21).
//
// GET /jobs returns 200 rows by default, about one day of API volume, while the feed keeps 72 h
// of jobs, so the list silently stopped at yesterday. The dashboard now passes an explicit limit.
//
// Run: node tests/feed-limit.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');

(async () => {
  const { FEED_LIMIT } = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'feedLimit.js')).href);
  const app = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'App.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'api', 'main.py'), 'utf8');
  const cap = Number((main.match(/limit: int = Query\(200, ge=1, le=(\d+)/) || [])[1]);

  assert(FEED_LIMIT >= 565 * 1.25, `the limit (${FEED_LIMIT}) covers the busiest 72 h so far (~565 jobs) with headroom`);
  assert(FEED_LIMIT > 200, 'it is larger than the old 200-row default');
  assert(cap >= FEED_LIMIT, `the backend accepts it (cap ${cap})`);
  assert(/import \{ FEED_LIMIT \} from '\.\/lib\/feedLimit'/.test(app) && /params\.set\('limit', String\(FEED_LIMIT\)\)/.test(app), 'fetchJobs sends limit=FEED_LIMIT on every request');
  assert(app.indexOf("params.set('limit'") < app.indexOf("fetch('/jobs?' + params.toString())"), '…before the request is made');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
