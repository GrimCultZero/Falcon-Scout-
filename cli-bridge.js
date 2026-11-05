#!/usr/bin/env node
// Falcon Scout CLI Bridge
// Pipes Claude calls through the local `claude -p` subscription instead of
// the Anthropic API — zero per-token cost when credits run out.
//
// Usage: node cli-bridge.js
// Endpoints:
//   GET  /ping  → { ok: true }                       (no token needed; says nothing)
//   POST /ai    → { prompt: string } → { content: string }   (needs X-Falcon-Token)
//
// Lockdown (audit 2026-10-29, T3). The bridge runs `claude -p` on Artem's own
// subscription, so before T3 any web page he had open could POST a prompt to it
// (it sent Access-Control-Allow-Origin: * and had no auth), and the CLI it spawned
// had every tool: Bash, PowerShell, Read, Write, WebFetch. Now:
//   - only the backend talks to it: /ai needs the X-Falcon-Token header, which
//     must equal CLI_BRIDGE_TOKEN from .env (the browser never calls the bridge);
//   - a browser request from any origin except the Falcon Scout frontend is refused,
//     and so is any Host other than loopback (blocks DNS-rebinding pages);
//   - the request body is capped;
//   - `claude -p` is spawned with an EMPTY tool list (--tools "") and
//     --permission-mode dontAsk, so a prompt cannot read files or run commands.

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// The port comes from CLI_BRIDGE_PORT in .env (see bridge-port.js for the default
// and for why it is a setting and not a literal). api/main.py reads the same key,
// so the bridge and the backend can never disagree. An invalid value stops the
// bridge instead of guessing: a guess could mean taking another app's port.
const { resolveBridgePortInfo, resolveBridgeToken } = require('./bridge-port');
let PORT, PORT_SOURCE, TOKEN;
try {
  ({ port: PORT, source: PORT_SOURCE } = resolveBridgePortInfo());
  TOKEN = resolveBridgeToken();
} catch (e) {
  console.error(`\nCLI bridge NOT started: ${e.message}\n`);
  process.exit(1);
}
const HOST = '127.0.0.1';
const TOKEN_BUF = Buffer.from(TOKEN, 'utf8');

// The Falcon Scout frontend (Vite dev server). The page does not call the bridge
// since T2, but if it ever does, these are the only origins allowed to.
const ALLOWED_ORIGINS = new Set(['http://localhost:5180', 'http://127.0.0.1:5180']);
// A page on evil.com that re-points its own DNS name at 127.0.0.1 still sends
// "Host: evil.com:<port>", so only loopback Host headers are accepted.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Real prompts are well under 1 MB (the analyser's KB-grounded prompt is the
// largest). 8 MB leaves room for a long PDF's extracted text and still stops
// a caller from making the bridge buffer an unbounded body.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// `claude -p` gets NO tools. Analyse, generate and chat are text in, text out.
// On Windows `claude` is a .cmd shim run through cmd.exe, which joins argv with
// spaces: a bare '' would vanish and --tools would swallow the next flag, so the
// empty list is passed as a literal "" there (verified: the CLI's init event
// then reports tools = []). --permission-mode dontAsk is the second lock: any
// tool call that is not pre-approved is denied instead of prompted for.
const EMPTY_TOOL_LIST = process.platform === 'win32' ? '""' : '';
const CLAUDE_ARGS_BASE = ['-p', '--tools', EMPTY_TOOL_LIST, '--permission-mode', 'dontAsk',
  '--strict-mcp-config', '--disable-slash-commands'];

function tokenOk(req) {
  const got = req.headers['x-falcon-token'];
  if (typeof got !== 'string' || !got) return false;
  const buf = Buffer.from(got, 'utf8');
  return buf.length === TOKEN_BUF.length && crypto.timingSafeEqual(buf, TOKEN_BUF);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Run `claude` from a neutral, empty directory so it does NOT auto-discover
// and inject the project's large CLAUDE.md into every call's context (our
// prompts already carry the KB — the dev CLAUDE.md is pure wasted tokens).
// os.tmpdir()'s ancestors have no CLAUDE.md, so nothing is picked up.
const NEUTRAL_CWD = path.join(os.tmpdir(), 'falcon-bridge-cwd');
try { fs.mkdirSync(NEUTRAL_CWD, { recursive: true }); } catch (e) {}

// Artem's own Claude subscription, isolated from whatever account is logged
// into the machine's default ~/.claude profile (a different account) — so
// this bridge always bills/runs against his account, never anyone else's.
// One-time setup in a terminal:
//   $env:CLAUDE_CONFIG_DIR = "<this path>"
//   claude auth login --claudeai
const ARTEM_CONFIG_DIR = path.join(os.homedir(), '.claude-artem');

const server = http.createServer((req, res) => {
  // Loopback Host only (see ALLOWED_HOSTS).
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    console.warn(`[refused] Host "${req.headers.host}"`);
    sendJson(res, 403, { error: 'forbidden host' });
    return;
  }
  // Browsers always send Origin on cross-origin fetches. The backend (httpx)
  // sends none. Anything that names an origin other than the frontend is refused.
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (!ALLOWED_ORIGINS.has(origin)) {
      console.warn(`[refused] Origin "${origin}"`);
      sendJson(res, 403, { error: 'forbidden origin' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Falcon-Token');
  }

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // /ping stays token-free: it tells the backend "something is listening" and
  // returns nothing else. Keeping it open means a token mismatch shows up as a
  // clear 401 on /ai instead of the backend respawning bridge windows forever.
  if (req.method === 'GET' && req.url === '/ping') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && req.url === '/ai') {
    if (!tokenOk(req)) {
      console.warn('[refused] /ai without a valid X-Falcon-Token');
      sendJson(res, 401, {
        error: 'CLI bridge: missing or wrong X-Falcon-Token. The backend and the bridge must read the same '
             + 'CLI_BRIDGE_TOKEN from .env -- if you just changed it, close the bridge window and restart the backend.',
      });
      req.resume();
      return;
    }
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: `request body over ${MAX_BODY_BYTES} bytes` });
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', chunk => {
      if (tooBig) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        chunks.length = 0;
        sendJson(res, 413, { error: `request body over ${MAX_BODY_BYTES} bytes` });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return;
      const body = Buffer.concat(chunks).toString('utf8');
      let prompt, reqModel;
      try { const b = JSON.parse(body); prompt = b.prompt; reqModel = b.model; } catch { prompt = body; }

      if (!prompt || typeof prompt !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing or invalid prompt' }));
        return;
      }

      // SPEED: force the model the caller intended instead of the CLI's default
      // (which is whatever Claude Code is set to — often Opus, the slowest). The
      // app asks for Sonnet on generate/analyse and Haiku on the cheap passes;
      // map to a CLI alias so those run fast. Never fall back to the Opus default.
      const modelAlias = /haiku/i.test(reqModel || '') ? 'haiku'
                       : /opus/i.test(reqModel || '') ? 'opus'
                       : 'sonnet';
      console.log(`→ ${prompt.length} chars  model=${modelAlias}${reqModel ? ` (req ${reqModel})` : ''}`);

      // On Windows `claude` is a .cmd shim — Node's spawn won't resolve it
      // without shell:true. The prompt goes via stdin (not argv), so there's
      // no shell-injection surface here.
      const isWin = process.platform === 'win32';
      // --tools "" + --permission-mode dontAsk → no tools at all (see CLAUDE_ARGS_BASE).
      // --strict-mcp-config (no --mcp-config) → load zero MCP servers.
      // --disable-slash-commands → skip skill discovery.
      // cwd = neutral dir → skip project CLAUDE.md auto-injection.
      // All pure text-in/text-out; no tools needed for analyse/generate.
      const child = spawn('claude', [...CLAUDE_ARGS_BASE, '--model', modelAlias], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CONFIG_DIR: ARTEM_CONFIG_DIR },
        shell: isWin,
        cwd: NEUTRAL_CWD,
      });

      let out = '';
      let err = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });

      child.stdin.write(prompt, 'utf8');
      child.stdin.end();

      child.on('close', code => {
        console.log(`← ${out.length} chars  exit=${code}`);
        if (err) console.error('[stderr]', err.slice(0, 300));

        if (code !== 0 || !out.trim()) {
          // The CLI's actual error/status text (e.g. a session-limit message)
          // often lands on STDOUT, not stderr -- confirmed via direct repro:
          // "You've hit your session limit · resets ..." printed to stdout
          // with stderr completely empty. Previously that meant `err` was ''
          // and this fell back to the useless generic "exited with code N",
          // hiding the real reason. Prefer stderr, then stdout, then generic.
          const message = (err && err.trim()) || (out && out.trim()) || `claude exited with code ${code}`;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: out.trim() }));
      });

      child.on('error', e => {
        console.error('[spawn error]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: e.code === 'ENOENT'
            ? '`claude` command not found — install Claude Code and make sure it is on PATH'
            : e.message,
        }));
      });
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — a CLI bridge is probably already running.`);
    console.error('This window can be closed; the existing bridge will keep serving.');
    console.error('(If ANOTHER app owns this port, set a different CLI_BRIDGE_PORT in .env and restart the backend.)\n');
  } else {
    console.error('Bridge error:', e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Falcon Scout CLI Bridge running at http://${HOST}:${PORT}  (port from ${PORT_SOURCE})`);
  console.log(`Routing /ai → claude -p with no tools  (cwd: ${NEUTRAL_CWD})`);
  console.log('Locked down: /ai needs X-Falcon-Token (CLI_BRIDGE_TOKEN in .env); only loopback hosts and the Falcon Scout origin');
  console.log(`Using isolated account profile: ${ARTEM_CONFIG_DIR}`);
  console.log('Test: echo "reply with just: ok" | claude -p');
});
