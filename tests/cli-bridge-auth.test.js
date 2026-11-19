// CLI bridge auth visibility (owner report, 2026-11-19): the header CLI chip stayed green
// even after `claude`'s login expired -- the bridge's Node server is a separate liveness
// concern from whether the `claude` process it spawns can actually authenticate, and /ping
// used to report only the former. Now the bridge remembers whether its last real /ai call
// failed with an authentication-shaped error and reports that on /ping too.
//
// Pinned here, against the REAL cli-bridge.js, with the EXACT error string the owner
// reported as a fixture (never the real `claude` CLI -- FALCON_BRIDGE_CLAUDE_BIN points it
// at a tiny stub instead, so this never depends on anyone's actual login state):
//   * a fresh bridge is optimistic: authOk true, authReason null, before any call;
//   * an /ai call whose `claude` process fails with that fixture message -> authOk flips
//     to false, authReason is the short owner-facing reason, and /ai itself still reports
//     the real underlying error text (so nothing about the existing error-surfacing breaks);
//   * /ping keeps reporting the bad state on its own, with NO further /ai call -- this is
//     what lets the header chip "keep re-polling" and show red without the user doing
//     anything else;
//   * the VERY NEXT successful /ai call (the login having been fixed) flips authOk back to
//     true by itself -- no separate recovery check is needed;
//   * an unrelated failure (not an auth error) never clears or sets the auth flag.
//
// SAFETY: never binds, connects to or probes 27183 or 27184, and never spawns the real
// `claude` CLI -- only the stub script below.
//
// Run: node tests/cli-bridge-auth.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const { getFreeBridgePort } = require('./freeBridgePort');
const GOOD = 'a'.repeat(40) + 'b'.repeat(24);
const AUTH_FIXTURE = 'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude`...';

function request(port, { method = 'GET', urlPath = '/ping', headers = {}, body = null }) {
  return new Promise((res) => {
    const rq = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, timeout: 5000 }, (rs) => {
      let data = '';
      rs.on('data', (d) => { data += d; });
      rs.on('end', () => res({ status: rs.statusCode, body: data }));
    });
    rq.on('error', (e) => res({ status: 0, error: e.code, body: '' }));
    rq.on('timeout', () => { rq.destroy(); res({ status: 0, error: 'timeout', body: '' }); });
    if (body !== null) rq.write(body);
    rq.end();
  });
}

(async () => {
  // ── static: isAuthError's pattern is narrow (auth only, not a usage/session limit) ──
  const src = fs.readFileSync(path.join(ROOT, 'cli-bridge.js'), 'utf8');
  assert(/function isAuthError/.test(src), 'isAuthError exists');
  assert(/AUTH_REASON = 'login expired: run `claude` then \/login'/.test(src), 'the short owner-facing reason matches what the task asked for, verbatim');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs_bridge_auth_'));
  const scratch = path.join(tmp, 'bridge');
  fs.mkdirSync(scratch);
  fs.copyFileSync(path.join(ROOT, 'cli-bridge.js'), path.join(scratch, 'cli-bridge.js'));
  fs.copyFileSync(path.join(ROOT, 'bridge-port.js'), path.join(scratch, 'bridge-port.js'));

  // A stub "claude": call 1 prints the fixture auth error and exits 1; call 2 (and later)
  // print a normal reply and exit 0 -- simulates the login being fixed in between.
  const counterFile = path.join(tmp, 'calls.txt');
  const stubPath = path.join(tmp, 'claude_stub.js');
  fs.writeFileSync(stubPath, `
const fs = require('fs');
const counterFile = ${JSON.stringify(counterFile)};
let n = 0;
try { n = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0; } catch (e) {}
n += 1;
fs.writeFileSync(counterFile, String(n));
if (n === 1) {
  process.stdout.write(${JSON.stringify(AUTH_FIXTURE)});
  process.exit(1);
} else if (n === 2) {
  process.stdout.write('some unrelated failure, not an auth problem');
  process.exit(1);
} else {
  process.stdout.write('ok');
  process.exit(0);
}
`);
  // spawn() on Windows runs the bridge with shell:true for its own `claude` spawn, which
  // joins command + args with spaces -- "node <stub> " works the same way.
  const claudeBin = `node ${JSON.stringify(stubPath).slice(1, -1)}`;

  const freePort = await getFreeBridgePort();
  fs.writeFileSync(path.join(scratch, '.env'), `CLI_BRIDGE_PORT=${freePort}\nCLI_BRIDGE_TOKEN=${GOOD}\n`);
  const childEnv = { ...process.env, FALCON_BRIDGE_CLAUDE_BIN: claudeBin };
  delete childEnv.CLI_BRIDGE_PORT;
  delete childEnv.CLI_BRIDGE_TOKEN;
  const child = spawn(process.execPath, [path.join(scratch, 'cli-bridge.js')], { cwd: scratch, env: childEnv });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  let ping = { status: 0 };
  for (let i = 0; i < 20 && ping.status !== 200; i++) { await new Promise((r) => setTimeout(r, 300)); ping = await request(freePort, {}); }
  assert(ping.status === 200 && ping.body === '{"ok":true,"authOk":true,"authReason":null}', 'a fresh bridge is optimistic before any /ai call');

  const json = { 'Content-Type': 'application/json' };
  const ai = (prompt = 'hello') => request(freePort, {
    method: 'POST', urlPath: '/ai', headers: { ...json, 'X-Falcon-Token': GOOD }, body: JSON.stringify({ prompt }),
  });

  // call 1: the stub fails with the fixture auth error
  let r = await ai();
  assert(r.status === 500 && JSON.parse(r.body).error === AUTH_FIXTURE, `/ai still reports the real underlying error text (${r.body})`);
  ping = await request(freePort, {});
  assert(ping.body === `{"ok":true,"authOk":false,"authReason":"login expired: run \`claude\` then /login"}`,
    `/ping now reports the login problem, with no further /ai call needed: ${ping.body}`);

  // ping again with no /ai call in between -- it keeps reporting it (the "keep re-polling" requirement)
  ping = await request(freePort, {});
  assert(JSON.parse(ping.body).authOk === false, '/ping keeps reporting the bad state on its own, unprompted');

  // call 2: an UNRELATED failure (not an auth error) must not clear or further change the flag
  r = await ai();
  assert(r.status === 500 && /unrelated failure/.test(r.body), 'an unrelated failure is still reported as an error');
  ping = await request(freePort, {});
  assert(JSON.parse(ping.body).authOk === false, 'an unrelated (non-auth) failure does not clear a pending auth problem');

  // call 3: the stub now succeeds (the login was fixed) -- authOk recovers BY ITSELF
  r = await ai();
  assert(r.status === 200 && JSON.parse(r.body).content === 'ok', 'the next real call succeeds once the login is fixed');
  ping = await request(freePort, {});
  assert(ping.body === '{"ok":true,"authOk":true,"authReason":null}', 'a successful call clears the auth problem automatically -- no separate recovery check');

  await new Promise((res) => { child.once('exit', res); child.kill(); setTimeout(res, 5000); });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp cleanup must never fail the test */ }
  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
