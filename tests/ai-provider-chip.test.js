// Header AI-provider chip auth visibility (owner report, 2026-11-19): the chip stayed
// green after `claude`'s login expired, until the next click hit it. /ai-provider/bridge-
// status's `up` (the bridge's Node server is reachable) and `auth_ok` (the last real /ai
// call's `claude` process actually authenticated) are two different things; the chip must
// go red and say why on auth_ok === false specifically, not conflate it with "offline".
//
// Pure-function logic only (lib/aiProviderChip.js); App.jsx's AiProviderChip component is
// a thin wrapper that calls it and is not rendered here (this project tests lib functions,
// not React components, directly -- see health-strip.test.js).
//
// Run: node tests/ai-provider-chip.test.js
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const lib = (f) => import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', f)).href);

(async () => {
  const { aiProviderChipView, authReasonFromBridgeStatus } = await lib('aiProviderChip.js');

  // ── authReasonFromBridgeStatus: extracting the reason from the backend's response ──
  assert(authReasonFromBridgeStatus({ up: true, auth_ok: false, auth_reason: 'login expired: run `claude` then /login' })
    === 'login expired: run `claude` then /login', 'up + auth_ok false -> the reason passes through');
  assert(authReasonFromBridgeStatus({ up: true, auth_ok: true, auth_reason: null }) === null, 'up + auth_ok true -> no reason');
  assert(authReasonFromBridgeStatus({ up: true, auth_ok: null, auth_reason: null }) === null,
    'up but auth_ok unknown (an older bridge build) -> treated as fine, NOT a problem');
  assert(authReasonFromBridgeStatus({ up: true }) === null, 'up with no auth fields at all (an old bridge) -> no reason');
  assert(authReasonFromBridgeStatus({ up: false, auth_ok: false, auth_reason: 'x' }) === null,
    'bridge not up at all -> no auth reason (that is a different, "offline" problem)');
  assert(authReasonFromBridgeStatus({ up: false }) === null, 'bridge down -> no reason');
  assert(authReasonFromBridgeStatus(null) === null && authReasonFromBridgeStatus(undefined) === null, 'a missing/failed response -> no reason, never throws');

  // ── aiProviderChipView: what the chip shows ─────────────────────────────────
  let v = aiProviderChipView('api', false, null);
  assert(!v.isCli && v.dotColor === 'rgba(255,255,255,0.30)' && /Using Anthropic API key/.test(v.tip), 'provider api -> neutral dot, API tooltip, regardless of bridgeOk/authReason');

  v = aiProviderChipView('cli', true, null);
  assert(v.isCli && v.healthy && v.dotColor === '#00e070' && /online/.test(v.tip) && !/login/.test(v.tip), 'cli, bridge up, no auth problem -> green, "online"');

  v = aiProviderChipView('cli', false, null);
  assert(v.isCli && !v.healthy && v.dotColor === '#ef4444' && /OFFLINE/.test(v.tip) && /node cli-bridge\.js/.test(v.tip),
    'cli, bridge down -> red, the OFFLINE/restart-command tooltip (not the auth one)');

  v = aiProviderChipView('cli', true, 'login expired: run `claude` then /login');
  assert(v.isCli && !v.healthy, 'cli, bridge UP but an auth problem -> NOT healthy (this is the bug: it used to stay green here)');
  assert(v.dotColor === '#ef4444' && v.borderColor === 'rgba(239,68,68,0.35)' && v.background === 'rgba(239,68,68,0.10)', '…red dot, border and background, same as the offline case');
  assert(v.tip === 'CLI Bridge: login expired: run `claude` then /login (click to switch back to API)',
    `…and the tooltip carries the short owner-facing reason verbatim: "${v.tip}"`);

  // recovery: the exact same inputs that made it healthy before still do (no stuck state)
  v = aiProviderChipView('cli', true, null);
  assert(v.healthy, 'once authReason clears (the next real call succeeded), the chip is healthy again with no other state to reset');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
