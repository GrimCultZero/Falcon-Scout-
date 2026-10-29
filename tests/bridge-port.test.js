// One configurable bridge port (audit 2026-10-29, T2).
//
// Falcon Scout's CLI bridge port used to be a literal in cli-bridge.js, App.jsx
// and eight places in api/main.py. The owner's other app (Baba Leada) owns the
// default port, so on his machine the bridge was moved by hand-editing two files
// that were then never committed -- a fresh clone got a backend that could never
// reach its own bridge. The port is now CLI_BRIDGE_PORT in .env, read by
// bridge-port.js (the bridge) and api/main.py (the backend) the same way.
//
// SAFETY OF THIS TEST: it never binds, connects to or probes 27183 or 27184.
// The resolver tests open no sockets at all. The one live-bridge test uses a
// scratch folder with its own .env and a free ephemeral port chosen by the OS,
// and refuses to run if that port were ever one of the app/Baba Leada ports.
//
// Run: node tests/bridge-port.test.js
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const { resolveBridgePortInfo, resolveBridgePort, DEFAULT_PORT } = require(path.join(ROOT, 'bridge-port.js'));
const FORBIDDEN = new Set([27183, 27184, 8000, 5180]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs_bridge_port_'));
const envWith = (text) => { const f = path.join(tmp, 'env_' + Math.random().toString(36).slice(2)); fs.writeFileSync(f, text); return f; };
const NOFILE = path.join(tmp, 'does-not-exist.env');
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

(async () => {
  // ── resolution order: .env, then environment, then default ───────────────
  assert(DEFAULT_PORT === 27183, 'the default is the original 27183, so a fresh clone behaves exactly as before');
  assert(resolveBridgePort({ envFile: NOFILE, environ: {} }) === 27183, 'nothing set -> default');
  let r = resolveBridgePortInfo({ envFile: NOFILE, environ: {} });
  assert(r.source === 'default', '…and it says the value came from the default');

  r = resolveBridgePortInfo({ envFile: envWith('CLI_BRIDGE_PORT=27184\n'), environ: {} });
  assert(r.port === 27184 && r.source === '.env', 'CLI_BRIDGE_PORT=27184 in .env -> 27184, source .env');

  r = resolveBridgePortInfo({ envFile: NOFILE, environ: { CLI_BRIDGE_PORT: '27184' } });
  assert(r.port === 27184 && r.source === 'environment', 'no .env key, set in the environment -> used');

  r = resolveBridgePortInfo({ envFile: envWith('CLI_BRIDGE_PORT=31001\n'), environ: { CLI_BRIDGE_PORT: '31002' } });
  assert(r.port === 31001, '.env WINS over the environment -- same as load_dotenv(override=True) on the Python side');

  r = resolveBridgePortInfo({ envFile: envWith('CLI_BRIDGE_PORT=\n'), environ: { CLI_BRIDGE_PORT: '31002' } });
  assert(r.port === 27183 && r.source === 'default', 'an EMPTY .env key means "unset" and does not fall through to the environment (Python does the same)');

  assert(resolveBridgePort({ envFile: envWith('# comment\nOTHER=1\n\nCLI_BRIDGE_PORT = "27184"  \r\nTAIL=x\r\n'), environ: {} }) === 27184,
    'comments, blank lines, CRLF, spaces around "=" and quotes are all handled');
  assert(resolveBridgePort({ envFile: envWith("CLI_BRIDGE_PORT='27184'\n"), environ: {} }) === 27184, 'single quotes too');
  assert(resolveBridgePort({ envFile: envWith('CLI_BRIDGE_PORT=027184\n'), environ: {} }) === 27184, 'leading zeros are tolerated');
  assert(resolveBridgePort({ envFile: envWith('MY_CLI_BRIDGE_PORT=31001\n'), environ: {} }) === 27183, 'a different key that merely ends in the name is ignored');

  // ── invalid values must STOP, never fall back to the default ─────────────
  // (the default is the port the owner's other app owns)
  for (const bad of ['abc', '27184x', '12.5', '-5', '0x10', '', ' ']) {
    if (bad.trim() === '') continue; // empty/blank = unset, covered above
    assert(throwsWith(() => resolveBridgePort({ envFile: NOFILE, environ: { CLI_BRIDGE_PORT: bad } }), /whole number/),
      `"${bad}" is rejected, not silently replaced by the default`);
  }
  assert(throwsWith(() => resolveBridgePort({ envFile: NOFILE, environ: { CLI_BRIDGE_PORT: '80' } }), /between 1024 and 65535/), 'a privileged port (80) is rejected');
  assert(throwsWith(() => resolveBridgePort({ envFile: NOFILE, environ: { CLI_BRIDGE_PORT: '70000' } }), /between 1024 and 65535/), 'a port above 65535 is rejected');
  assert(throwsWith(() => resolveBridgePort({ envFile: NOFILE, environ: { CLI_BRIDGE_PORT: '٢٧١٨٤' } }), /whole number/),
    'non-ASCII digits are rejected (Python must agree -- see test_bridge_port.py)');

  // ── no hardcoded bridge port is left in the code that talks to the bridge ─
  const walk = (dir, out = []) => {
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      if (n.name === 'node_modules' || n.name === 'dist') continue;
      const p = path.join(dir, n.name);
      if (n.isDirectory()) walk(p, out); else if (/\.(js|jsx|py)$/.test(n.name)) out.push(p);
    }
    return out;
  };
  const files = [...walk(path.join(ROOT, 'api')), ...walk(path.join(ROOT, 'frontend', 'src')), path.join(ROOT, 'cli-bridge.js')];
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((ln, i) => { if (/2718\d/.test(ln)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${ln.trim()}`); });
  }
  assert(hits.length === 1 && /api[\\/]main\.py:\d+: _BRIDGE_DEFAULT_PORT = 27183$/.test(hits[0]),
    `the ONLY port literal in api/, frontend/src and cli-bridge.js is the backend's documented default -> ${hits.join(' | ') || 'none'}`);

  // ── wiring ───────────────────────────────────────────────────────────────
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'cli-bridge.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'App.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'api', 'main.py'), 'utf8');
  assert(/require\('\.\/bridge-port'\)/.test(bridgeSrc), 'cli-bridge.js takes its port from bridge-port.js');
  assert(!/http:\/\/127\.0\.0\.1:\d+\/ping/.test(app) && /fetch\('\/ai-provider\/bridge-status'/.test(app),
    'the header chip asks the backend (/ai-provider/bridge-status); the page never fetches the bridge itself');
  assert(/@app\.get\("\/ai-provider\/bridge-status"\)/.test(main), 'the backend serves /ai-provider/bridge-status');
  assert((main.match(/_bridge_url\(/g) || []).length >= 6, 'every backend call to the bridge goes through _bridge_url()');
  assert(/load_dotenv\(ROOT \/ "\.env", override=True\)/.test(main), 'the backend loads .env with override=True, which is the precedence bridge-port.js copies');
  assert(/CLI_BRIDGE_PORT/.test(fs.readFileSync(path.join(ROOT, '.env.template'), 'utf8')), '.env.template documents CLI_BRIDGE_PORT');
  assert(!/local change on the original machine/.test(fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8')), 'INSTALL.md no longer tells people to hand-edit ports');
  const ga = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  assert(/^\* text=auto$/m.test(ga) && /^\*\.bat text eol=crlf$/m.test(ga), '.gitattributes: text=auto, and .bat files stay CRLF');

  // ── the real cli-bridge.js, in a scratch folder with its OWN .env ────────
  const scratch = path.join(tmp, 'bridge');
  fs.mkdirSync(scratch);
  fs.copyFileSync(path.join(ROOT, 'cli-bridge.js'), path.join(scratch, 'cli-bridge.js'));
  fs.copyFileSync(path.join(ROOT, 'bridge-port.js'), path.join(scratch, 'bridge-port.js'));

  fs.writeFileSync(path.join(scratch, '.env'), 'CLI_BRIDGE_PORT=not-a-port\n');
  const badRun = spawnSync(process.execPath, [path.join(scratch, 'cli-bridge.js')], { cwd: scratch, encoding: 'utf8', timeout: 15000 });
  assert(badRun.status === 1 && /CLI bridge NOT started/.test(badRun.stderr) && /whole number/.test(badRun.stderr),
    `an invalid CLI_BRIDGE_PORT stops the bridge with a clear message instead of guessing (exit ${badRun.status})`);

  const freePort = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  if (FORBIDDEN.has(freePort) || freePort < 40000) {
    assert(false, `refusing to run the live-bridge test on port ${freePort}`);
  } else {
    fs.writeFileSync(path.join(scratch, '.env'), `CLI_BRIDGE_PORT=${freePort}\n`);
    const child = spawn(process.execPath, [path.join(scratch, 'cli-bridge.js')], { cwd: scratch });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const ping = () => new Promise((res) => {
      const rq = http.get({ host: '127.0.0.1', port: freePort, path: '/ping', timeout: 1500 }, (rs) => { rs.resume(); res(rs.statusCode); });
      rq.on('error', () => res(0)); rq.on('timeout', () => { rq.destroy(); res(0); });
    });
    let code = 0;
    for (let i = 0; i < 20 && code !== 200; i++) { await new Promise((r) => setTimeout(r, 300)); code = await ping(); }
    assert(code === 200, `the real bridge, started with CLI_BRIDGE_PORT=${freePort} in its .env, answers /ping on THAT port`);
    assert(new RegExp(`running at http://127\\.0\\.0\\.1:${freePort}\\s+\\(port from \\.env\\)`).test(out), 'and logs which port it took and from where');
    // Windows will not delete a folder that a still-exiting process uses as its cwd.
    await new Promise((res) => { child.once('exit', res); child.kill(); setTimeout(res, 5000); });
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp cleanup must never fail the test */ }
  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
