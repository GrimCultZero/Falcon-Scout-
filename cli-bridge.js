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

const PORT = 27182;
const HOST = '127.0.0.1';

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
      const child = spawn('claude', ['-p'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: isWin,
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

server.listen(PORT, HOST, () => {
  console.log(`Falcon Scout CLI Bridge running at http://${HOST}:${PORT}`);
  console.log('Routing /ai → claude -p stdin');
  console.log('Test: echo "reply with just: ok" | claude -p');
});
