#!/usr/bin/env node
// Falcon Scout CLI Bridge
// Pipes Claude calls through the local `claude -p` subscription instead of
// the Anthropic API — zero per-token cost when credits run out.
//
// Usage: node cli-bridge.js
// Endpoints:
//   GET  /ping  → { ok: true }
//   POST /ai    → { prompt: string } → { content: string }

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 27182;
const HOST = '127.0.0.1';

// Run `claude` from a neutral, empty directory so it does NOT auto-discover
// and inject the project's large CLAUDE.md into every call's context (our
// prompts already carry the KB — the dev CLAUDE.md is pure wasted tokens).
// os.tmpdir()'s ancestors have no CLAUDE.md, so nothing is picked up.
const NEUTRAL_CWD = path.join(os.tmpdir(), 'falcon-bridge-cwd');
try { fs.mkdirSync(NEUTRAL_CWD, { recursive: true }); } catch (e) {}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/ai') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let prompt;
      try { prompt = JSON.parse(body).prompt; } catch { prompt = body; }

      if (!prompt || typeof prompt !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing or invalid prompt' }));
        return;
      }

      console.log(`→ ${prompt.length} chars`);

      // On Windows `claude` is a .cmd shim — Node's spawn won't resolve it
      // without shell:true. The prompt goes via stdin (not argv), so there's
      // no shell-injection surface here.
      const isWin = process.platform === 'win32';
      // --strict-mcp-config (no --mcp-config) → load zero MCP servers.
      // --disable-slash-commands → skip skill discovery.
      // cwd = neutral dir → skip project CLAUDE.md auto-injection.
      // All pure text-in/text-out; no tools needed for analyse/generate.
      const child = spawn('claude', ['-p', '--strict-mcp-config', '--disable-slash-commands'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
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
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err || `claude exited with code ${code}`).trim() }));
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
    console.error('This window can be closed; the existing bridge will keep serving.\n');
  } else {
    console.error('Bridge error:', e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Falcon Scout CLI Bridge running at http://${HOST}:${PORT}`);
  console.log(`Routing /ai → claude -p  (cwd: ${NEUTRAL_CWD})`);
  console.log('Test: echo "reply with just: ok" | claude -p');
});
