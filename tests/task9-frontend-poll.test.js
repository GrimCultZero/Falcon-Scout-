// Task 9.4 (owner, 2026-11-24): "confirm an OPEN Falcon Scout page shows newly
// captured jobs without a reload... if it does not refresh by itself, make it
// re-fetch every 60 seconds while visible."
//
// Finding: App.jsx ALREADY polls /jobs every 10 seconds (more frequent than the
// 60s asked for), paused while the tab is hidden (document.hidden) and caught up
// immediately on visibilitychange -- so no new polling code was needed for 9.4.
// This is a source-presence lock, not a behavior reimplementation: it fails loudly
// if that polling wiring is ever removed or weakened, since this task's whole
// point depends on it already existing.
//
// Run: node tests/task9-frontend-poll.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'App.jsx'), 'utf8');

assert(/setInterval\(poll,\s*10000\)/.test(app), 'the job list polls every 10 seconds (at or faster than the 60s Task 9.4 asks for)');
assert(/if \(document\.hidden\) return/.test(app), 'the poll is a no-op while the tab is hidden (no point burning the quota)');
assert(/addEventListener\('visibilitychange',\s*onVisible\)/.test(app) && /if \(!document\.hidden\) poll\(\)/.test(app),
  'becoming visible again catches up immediately, not waiting for the next 10s tick');
assert(/background:\s*true/.test(app), 'the poll fetches in background mode (no loading spinner, no error flash)');
assert(/if \(raw !== lastJobsPayloadRef\.current\)/.test(app),
  'a byte-identical response skips setJobs() entirely -- this is what protects scroll position, the open job, filters and a half-written letter from being reset by a poll that found nothing new');
assert(/if \(data\.length > 0 && !selectedId\) setSelectedId/.test(app),
  'the poll only auto-selects a job when NOTHING is selected yet -- it never steals the currently open job out from under the owner');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
