// Falcon Scout Enricher talks only to the Falcon Scout dashboard on port 5180
// (Metro Phase 0, step 1, 2026-11-24).
//
// Ports 5173 / 5174 belong to DevScout (C:\Users\syzov\baba-leada). Before this the
// enricher injected bridge.js into DevScout's pages and broadcast cockpit:* messages
// to its tabs, so the two apps' consoles showed each other's traffic.
//
// Pinned here, statically (no browser):
//   * no file in upwork-enricher/ names port 5173 or 5174 in a URL;
//   * bridge.js is injected only on localhost:5180 and 127.0.0.1:5180;
//   * notifyCockpit filters tabs through _isCockpitUrl, which accepts only 5180 origins
//     (and not a look-alike such as :51800 or a DevScout tab);
//   * popup.js looks for the dashboard only on 5180.
//
// Run: node tests/extension-ports.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const EXT = path.join(__dirname, '..', 'upwork-enricher');

const files = fs.readdirSync(EXT).filter((f) => /\.(js|json|html)$/.test(f));
const portUrl = /(localhost|127\.0\.0\.1):517[34]\b/;
for (const f of files) {
  const text = fs.readFileSync(path.join(EXT, f), 'utf8');
  assert(!portUrl.test(text), `${f} names no 5173/5174 URL`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const bridgeEntries = manifest.content_scripts.filter((c) => c.js.includes('bridge.js'));
assert(bridgeEntries.length === 1, 'bridge.js has exactly one content_scripts entry');
const matches = (bridgeEntries[0] || { matches: [] }).matches.slice().sort();
assert(JSON.stringify(matches) === JSON.stringify(['http://127.0.0.1:5180/*', 'http://localhost:5180/*']),
  `bridge.js matches only 5180 (got ${JSON.stringify(matches)})`);
const [maj, min] = manifest.version.split('.').map(Number);
assert(maj > 5 || (maj === 5 && min >= 18), `manifest version bumped to >= 5.18 (got ${manifest.version})`);

// Pull _isCockpitUrl + COCKPIT_ORIGINS out of background.js and run them.
const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const start = bg.indexOf('const COCKPIT_ORIGINS');
const end = bg.indexOf('function notifyCockpit');
assert(start > 0 && end > start, 'background.js defines COCKPIT_ORIGINS and _isCockpitUrl before notifyCockpit');
const ctx = {};
vm.runInNewContext(bg.slice(start, end) + '\nthis.f = _isCockpitUrl;', ctx);
const isCockpit = ctx.f;
const cases = [
  ['http://localhost:5180/', true],
  ['http://localhost:5180/#outcomes', true],
  ['http://127.0.0.1:5180/?x=1', true],
  ['http://localhost:5180', true],
  ['http://localhost:5173/', false],
  ['http://127.0.0.1:5174/#leads', false],
  ['http://localhost:51800/', false],
  ['https://www.upwork.com/nx/proposals/', false],
  ['', false],
  [undefined, false],
];
for (const [url, want] of cases) assert(isCockpit(url) === want, `_isCockpitUrl(${JSON.stringify(url)}) === ${want}`);
const notify = bg.slice(end, bg.indexOf('\n}\n', end));
assert(/_isCockpitUrl\(tab\.url\)/.test(notify), 'notifyCockpit filters tabs with _isCockpitUrl');

const popup = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');
const dash = popup.slice(popup.indexOf('const DASHBOARD_URLS'), popup.indexOf('];', popup.indexOf('const DASHBOARD_URLS')));
assert(/localhost:5180/.test(dash) && /127\.0\.0\.1:5180/.test(dash) && !/517[34]/.test(dash), 'popup DASHBOARD_URLS is 5180 only');

console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
