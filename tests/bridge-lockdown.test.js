// CLI bridge lockdown (audit 2026-10-29, T3).
//
// Before T3 the bridge sent Access-Control-Allow-Origin: *, had no auth, and the
// `claude -p` it spawned had every tool (Bash, PowerShell, Read, Write, WebFetch),
// so any web page open in the browser could run prompts on Artem's subscription.
//
// Pinned here, against the REAL cli-bridge.js:
//   * no CLI_BRIDGE_TOKEN (or a short one) -> the bridge refuses to start;
//   * /ai without the token, or with a wrong one -> 401;
//   * a browser Origin other than the frontend -> 403 (also on the preflight);
//   * a non-loopback Host header (DNS rebinding) -> 403;
//   * a body over the cap -> 413;
//   * the good token passes auth (proved with a request that stops at 400
//     "missing prompt", so `claude` is never spawned and nothing is billed);
//   * the spawn arguments carry an empty tool list and dontAsk.
//
// SAFETY: never binds, connects to or probes 27183 or 27184. The live part uses a
// scratch folder with its own .env and a free ephemeral port chosen by the OS.
//
// Run: node tests/bridge-lockdown.test.js
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const { resolveBridgeToken, MIN_TOKEN_LENGTH } = require(path.join(ROOT, 'bridge-port.js'));
const FORBIDDEN = new Set([27183, 27184, 8000, 5180]);
const GOOD = 'a'.repeat(40) + 'b'.repeat(24);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs_bridge_lock_'));
const envWith = (text) => { const f = path.join(tmp, 'env_' + Math.random().toString(36).slice(2)); fs.writeFileSync(f, text); return f; };
const NOFILE = path.join(tmp, 'does-not-exist.env');
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

function request(port, { method = 'GET', urlPath = '/ping', headers = {}, body = null }) {
  return new Promise((res) => {
    const rq = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, timeout: 5000 }, (rs) => {
      let data = '';
      rs.on('data', (d) => { data += d; });
      rs.on('end', () => res({ status: rs.statusCode, headers: rs.headers, body: data }));
    });
    rq.on('error', (e) => res({ status: 0, error: e.code, body: '' }));
    rq.on('timeout', () => { rq.destroy(); res({ status: 0, error: 'timeout', body: '' }); });
    if (body !== null) rq.write(body);
    rq.end();
  });
}

(async () => {
  // ── token resolution ──────────────────────────────────────────────────────
  assert(MIN_TOKEN_LENGTH === 32, 'the minimum token length is 32 (tools/ensure_bridge_token.py uses the same)');
  assert(throwsWith(() => resolveBridgeToken({ envFile: NOFILE, environ: {} }), /CLI_BRIDGE_TOKEN is not set/), 'no token anywhere -> error, there is no default');
  assert(throwsWith(() => resolveBridgeToken({ envFile: envWith('CLI_BRIDGE_TOKEN=\n'), environ: { CLI_BRIDGE_TOKEN: GOOD } }), /not set/),
    'an EMPTY .env key does not fall through to the environment (same rule as the port)');
  assert(throwsWith(() => resolveBridgeToken({ envFile: envWith('CLI_BRIDGE_TOKEN=short\n'), environ: {} }), /at least 32/), 'a short token is refused');
  assert(resolveBridgeToken({ envFile: envWith(`CLI_BRIDGE_TOKEN="${GOOD}"\r\n`), environ: {} }) === GOOD, 'a quoted token in a CRLF .env is read');
  assert(resolveBridgeToken({ envFile: NOFILE, environ: { CLI_BRIDGE_TOKEN: GOOD } }) === GOOD, 'no .env key -> the process environment is used');

  // ── static: what cli-bridge.js spawns and sends ──────────────────────────
  const src = fs.readFileSync(path.join(ROOT, 'cli-bridge.js'), 'utf8');
  assert(!/Allow-Origin',\s*'\*'/.test(src), 'the wildcard Access-Control-Allow-Origin is gone');
  assert(/CLAUDE_ARGS_BASE = \['-p', '--tools', EMPTY_TOOL_LIST, '--permission-mode', 'dontAsk'/.test(src),
    'claude -p is spawned with an empty --tools list and --permission-mode dontAsk');
  assert(/EMPTY_TOOL_LIST = process\.platform === 'win32' \? '""' : ''/.test(src),
    'on Windows the empty list is a literal "" so cmd.exe does not drop it');
  assert(/spawn\('claude', \[\.\.\.CLAUDE_ARGS_BASE,/.test(src), 'the spawn uses CLAUDE_ARGS_BASE');

  // ── the real bridge refuses to start without a usable token ──────────────
  const scratch = path.join(tmp, 'bridge');
  fs.mkdirSync(scratch);
  fs.copyFileSync(path.join(ROOT, 'cli-bridge.js'), path.join(scratch, 'cli-bridge.js'));
  fs.copyFileSync(path.join(ROOT, 'bridge-port.js'), path.join(scratch, 'bridge-port.js'));
  const childEnv = { ...process.env };
  delete childEnv.CLI_BRIDGE_TOKEN;
  delete childEnv.CLI_BRIDGE_PORT;

  const freePort = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  if (FORBIDDEN.has(freePort) || freePort < 40000) {
    assert(false, `refusing to run the live-bridge test on port ${freePort}`);
  } else {
    for (const [label, envText, re] of [
      ['no token', `CLI_BRIDGE_PORT=${freePort}\n`, /CLI_BRIDGE_TOKEN is not set/],
      ['a short token', `CLI_BRIDGE_PORT=${freePort}\nCLI_BRIDGE_TOKEN=abc\n`, /at least 32/],
    ]) {
      fs.writeFileSync(path.join(scratch, '.env'), envText);
      const r = spawnSync(process.execPath, [path.join(scratch, 'cli-bridge.js')], { cwd: scratch, env: childEnv, encoding: 'utf8', timeout: 15000 });
      assert(r.status === 1 && /CLI bridge NOT started/.test(r.stderr) && re.test(r.stderr), `${label} -> the bridge does not start (exit ${r.status})`);
    }

    // ── live bridge with a good token ───────────────────────────────────────
    fs.writeFileSync(path.join(scratch, '.env'), `CLI_BRIDGE_PORT=${freePort}\nCLI_BRIDGE_TOKEN=${GOOD}\n`);
    const child = spawn(process.execPath, [path.join(scratch, 'cli-bridge.js')], { cwd: scratch, env: childEnv });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let ping = { status: 0 };
    for (let i = 0; i < 20 && ping.status !== 200; i++) { await new Promise((r) => setTimeout(r, 300)); ping = await request(freePort, {}); }
    assert(ping.status === 200 && ping.body === '{"ok":true}', '/ping answers without a token and says nothing else');
    assert(!('access-control-allow-origin' in ping.headers), 'no CORS header at all when no browser Origin is sent');

    const json = { 'Content-Type': 'application/json' };
    const emptyBody = '{}';
    let r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: json, body: emptyBody });
    assert(r.status === 401 && /X-Falcon-Token/.test(r.body), `/ai without the token -> 401 (${r.status})`);
    r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: { ...json, 'X-Falcon-Token': GOOD.slice(0, -1) + 'c' }, body: emptyBody });
    assert(r.status === 401, `/ai with a wrong token of the same length -> 401 (${r.status})`);
    r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: { ...json, 'X-Falcon-Token': 'x' }, body: emptyBody });
    assert(r.status === 401, `/ai with a short wrong token -> 401 (${r.status})`);

    r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: { ...json, 'X-Falcon-Token': GOOD }, body: emptyBody });
    assert(r.status === 400 && /missing or invalid prompt/.test(r.body), `the right token passes auth (stops at 400 "missing prompt", so claude is not spawned) (${r.status})`);

    r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: { ...json, 'X-Falcon-Token': GOOD, Origin: 'https://example.com' }, body: emptyBody });
    assert(r.status === 403 && !('access-control-allow-origin' in r.headers), `Origin https://example.com is refused even WITH the token (${r.status})`);
    r = await request(freePort, { method: 'OPTIONS', urlPath: '/ai', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } });
    assert(r.status === 403, `a CORS preflight from https://example.com is refused (${r.status})`);
    r = await request(freePort, { method: 'GET', urlPath: '/ping', headers: { Origin: 'null' } });
    assert(r.status === 403, `Origin "null" (sandboxed iframe, file://) is refused (${r.status})`);

    r = await request(freePort, { method: 'OPTIONS', urlPath: '/ai', headers: { Origin: 'http://localhost:5180', 'Access-Control-Request-Method': 'POST' } });
    assert(r.status === 204 && r.headers['access-control-allow-origin'] === 'http://localhost:5180' && /X-Falcon-Token/.test(r.headers['access-control-allow-headers'] || ''),
      `the Falcon Scout frontend origin gets its own origin back, not * (${r.status} ${r.headers['access-control-allow-origin']})`);
    r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: { ...json, Origin: 'http://127.0.0.1:5180' }, body: emptyBody });
    assert(r.status === 401, `even the allowed origin needs the token (${r.status})`);

    r = await request(freePort, { method: 'GET', urlPath: '/ping', headers: { Host: `evil.example:${freePort}` } });
    assert(r.status === 403, `a non-loopback Host header (DNS rebinding) is refused (${r.status})`);
    r = await request(freePort, { method: 'GET', urlPath: '/ping', headers: { Host: `localhost:${freePort}` } });
    assert(r.status === 200, `Host localhost:<port> is accepted (${r.status})`);

    const big = JSON.stringify({ prompt: 'x'.repeat(8 * 1024 * 1024 + 10) });
    r = await request(freePort, { method: 'POST', urlPath: '/ai', headers: { ...json, 'X-Falcon-Token': GOOD }, body: big });
    assert(r.status === 413, `a body over 8 MB is refused with 413 (${r.status})`);
    r = await request(freePort, { method: 'GET', urlPath: '/ping' });
    assert(r.status === 200, 'the bridge is still up after the oversize request');

    assert(/Locked down: \/ai needs X-Falcon-Token/.test(out) && !out.includes(GOOD), 'the startup log says it is locked down and never prints the token');
    await new Promise((res) => { child.once('exit', res); child.kill(); setTimeout(res, 5000); });
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp cleanup must never fail the test */ }
  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
