// Production-mode launcher (audit 2026-10-29, T14).
//
// falconscout.bat used to run the backend under `uvicorn --reload` every day (it
// hung or 500'd mid-edit at least three times) and to open a window for the dead
// Telegram listener. Now:
//   * backend WITHOUT --reload; falconscout-dev.bat is the reloading variant;
//   * no listener window (the listener itself was removed on 2026-11-09);
//   * the CLI bridge is started only when ai_provider.json says "cli" (the
//     backend's own auto-spawn covers a later switch);
//   * the T3 CLI_BRIDGE_TOKEN step is kept, and runs before anything starts;
//   * every .bat stays CRLF (cmd.exe mis-parses labels in LF batch files).
//
// This runs the REAL batch file through cmd.exe with FALCON_DRYRUN=1, which prints
// the launch lines instead of opening windows, inside a scratch folder (its own
// .env and ai_provider.json). Your real .env, database and ports are never used.
//
// Run: node tests/launcher.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p));
const text = (...p) => read(...p).toString('utf8');

if (process.platform !== 'win32') {
  console.log('SKIP  launcher tests need cmd.exe (Windows)');
  process.exit(0);
}

// ── bytes: CRLF, nothing else ───────────────────────────────────────────────
for (const f of ['falconscout.bat', 'falconscout-dev.bat', 'setup.bat']) {
  const b = read(f);
  const lf = (b.toString('latin1').match(/\n/g) || []).length;
  const crlf = (b.toString('latin1').match(/\r\n/g) || []).length;
  assert(lf > 0 && lf === crlf, `${f} is CRLF on every line (${crlf} of ${lf})`);
}
assert([...read('falconscout.bat')].every((c) => c < 128), 'falconscout.bat is plain ASCII (cmd.exe reads batch files in the OEM code page)');

// ── static shape ────────────────────────────────────────────────────────────
const bat = text('falconscout.bat').replace(/\r\n/g, '\n');
const code = bat.split('\n').filter((l) => !/^\s*REM\b/i.test(l));          // executable lines only
const codeText = code.join('\n');
assert(!/--reload/.test(codeText.replace(/set "RELOAD= --reload"/, '')), 'the daily launcher never passes --reload (only the dev argument sets it)');
assert(!/listener/i.test(codeText), 'no executable line mentions the Telegram listener');
assert(/--port 8000/.test(codeText) && /npm run dev/.test(codeText) && /node cli-bridge\.js/.test(codeText), 'backend (explicit :8000), frontend and bridge commands are all there');
const tokenAt = codeText.indexOf('ensure_bridge_token.py');
const firstLaunch = codeText.indexOf('call :launch');
assert(tokenAt > 0 && tokenAt < firstLaunch, 'the CLI_BRIDGE_TOKEN step (T3) is kept and runs BEFORE anything is launched');
assert(/cd \/d "%~dp0"/.test(codeText), 'it changes to its own folder first, so it works however it is started');
assert(/FALCON_DRYRUN/.test(bat) && /FALCON_NO_BROWSER/.test(bat), 'the test hooks exist');
assert(/@echo off\r?\n(?:.*\r?\n)*?.*call "%~dp0falconscout\.bat" dev %\*/.test(text('falconscout-dev.bat')), 'falconscout-dev.bat just calls the launcher with "dev"');
for (const f of ['listener.py', 'parser.py', 'import_history.py', 'reparse_jobs.py']) {
  assert(!fs.existsSync(path.join(ROOT, f)), `${f} is gone: the Telegram listener was removed on 2026-11-09`);
}
assert(!/telethon/i.test(text('requirements.txt')), 'telethon is no longer a requirement');
assert(!/TELEGRAM_API|BOT_USERNAME|SESSION_NAME|BOT_CHAT_ID/.test(text('.env.template')), '.env.template no longer asks for Telegram settings');

// ── run the real batch file in a scratch folder ─────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs_launcher_'));
fs.mkdirSync(path.join(tmp, 'tools'));
fs.mkdirSync(path.join(tmp, 'frontend'));
for (const f of ['falconscout.bat', 'falconscout-dev.bat']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
fs.copyFileSync(path.join(ROOT, 'tools', 'ensure_bridge_token.py'), path.join(tmp, 'tools', 'ensure_bridge_token.py'));
// the token step uses .venv\Scripts\python.exe; point a junction at the real venv
fs.symlinkSync(path.join(ROOT, '.venv'), path.join(tmp, '.venv'), 'junction');

const TOKEN = 'a'.repeat(64);
const setup = ({ provider, env }) => {
  const p = (f) => path.join(tmp, f);
  for (const f of ['ai_provider.json', '.env']) { try { fs.rmSync(p(f)); } catch (e) { /* absent */ } }
  if (provider !== undefined) fs.writeFileSync(p('ai_provider.json'), provider);
  if (env !== undefined) fs.writeFileSync(p('.env'), env);
};
const run = (bat_, args = [], cwd = tmp) => {
  const r = spawnSync('cmd.exe', ['/d', '/c', path.join(tmp, bat_), ...args], {
    cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, FALCON_DRYRUN: '1' },
  });
  const launches = (r.stdout || '').split(/\r?\n/).map((l) => l.match(/^LAUNCH \[(.*?)\] in \[(.*?)\] : (.*)$/)).filter(Boolean)
    .map((m) => ({ title: m[1], dir: m[2].replace(/[\\/]\.?$/, ''), cmd: m[3] }));
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', launches };
};
const names = (r) => r.launches.map((l) => l.title.replace('Falcon Scout - ', '')).join(' | ');
const ENV_OK = `ANTHROPIC_API_KEY=x\r\nCLI_BRIDGE_TOKEN=${TOKEN}\r\n`;

let r;
setup({ provider: '{"provider": "cli"}', env: ENV_OK });
r = run('falconscout.bat');
assert(r.status === 0 && names(r) === 'CLI Bridge | Backend | Frontend', `provider cli -> bridge, backend, frontend, in that order (got: ${names(r)}; exit ${r.status})`);
assert(r.launches[1] && r.launches[1].cmd === '.\\.venv\\Scripts\\uvicorn api.main:app --port 8000', `the backend command has no --reload: "${r.launches[1] && r.launches[1].cmd}"`);
assert(r.launches[2] && /frontend$/.test(r.launches[2].dir) && r.launches[2].cmd === 'npm run dev', 'the frontend starts in frontend\\ with npm run dev');
assert(r.launches[0] && r.launches[0].cmd === 'node cli-bridge.js', 'the bridge command is unchanged');
assert(!/listener/i.test(r.out), 'nothing about the listener is launched or printed');

setup({ provider: '{"provider":"cli"}', env: ENV_OK });
assert(names(run('falconscout.bat')) === 'CLI Bridge | Backend | Frontend', 'the same without a space in the JSON ({"provider":"cli"})');
setup({ provider: '{\n  "provider": "cli"\n}\n', env: ENV_OK });
assert(names(run('falconscout.bat')) === 'CLI Bridge | Backend | Frontend', '…and pretty-printed across lines');

setup({ provider: '{"provider": "api"}', env: ENV_OK });
r = run('falconscout.bat');
assert(names(r) === 'Backend | Frontend', `provider api -> NO bridge window (got: ${names(r)})`);
setup({ env: ENV_OK });
assert(names(run('falconscout.bat')) === 'Backend | Frontend', 'no ai_provider.json -> API (the backend default) -> no bridge window');
setup({ provider: '{"provider": "cli", "note": "x"}', env: ENV_OK });
assert(names(run('falconscout.bat')) === 'CLI Bridge | Backend | Frontend', 'extra keys in the file do not matter');
setup({ provider: '{"provider": "api", "client": "cliff"}', env: ENV_OK });
assert(names(run('falconscout.bat')) === 'Backend | Frontend', 'a value that merely contains "cli" ("cliff") does not start the bridge');

// dev variant
setup({ provider: '{"provider": "api"}', env: ENV_OK });
r = run('falconscout-dev.bat');
assert(r.status === 0 && r.launches.length === 2 && r.launches[0].cmd === '.\\.venv\\Scripts\\uvicorn api.main:app --port 8000 --reload', `falconscout-dev.bat -> backend WITH --reload ("${r.launches[0] && r.launches[0].cmd}")`);
assert(/reload/i.test(r.launches[0].title), '…and its window title says so');
setup({ provider: '{"provider": "cli"}', env: ENV_OK });
assert(names(run('falconscout-dev.bat')) === 'CLI Bridge | Backend --reload | Frontend', 'the dev variant follows the same bridge rule');
r = run('falconscout.bat', ['dev']);
assert(/--reload$/.test(r.launches.find((l) => /Backend/.test(l.title)).cmd), '"falconscout.bat dev" is the same thing');

// works from another folder (double-click, shortcut, scheduled task)
r = run('falconscout.bat', [], os.tmpdir());
assert(r.launches.length === 3 && r.launches.every((l) => l.dir.toLowerCase().startsWith(tmp.toLowerCase())), 'started from another folder it still launches from its own');

// T3 token step
setup({ provider: '{"provider": "api"}', env: 'ANTHROPIC_API_KEY=x\r\n' });
r = run('falconscout.bat');
const envAfter = fs.readFileSync(path.join(tmp, '.env'), 'utf8');
const m = envAfter.match(/^CLI_BRIDGE_TOKEN=([0-9a-f]{64})\r?$/m);
assert(!!m && !r.out.includes(m[1]) && !r.err.includes(m[1]), 'a missing CLI_BRIDGE_TOKEN is created at launch and never printed');
assert(envAfter.startsWith('ANTHROPIC_API_KEY=x\r\n'), '…and the rest of .env is untouched');
setup({ provider: '{"provider": "api"}', env: ENV_OK });
run('falconscout.bat');
assert(fs.readFileSync(path.join(tmp, '.env'), 'utf8') === ENV_OK, 'an existing token is left byte for byte as it was');
setup({ provider: '{"provider": "api"}' });
r = run('falconscout.bat');
assert(r.status === 0 && names(r) === 'Backend | Frontend' && !fs.existsSync(path.join(tmp, '.env')), 'no .env at all: the launcher does not crash and does not invent one');

// ── docs say the same thing ─────────────────────────────────────────────────
const install = text('INSTALL.md').replace(/\r\n/g, '\n');
const claude = text('CLAUDE.md').replace(/\r\n/g, '\n');
const _mv = JSON.parse(text('upwork-enricher', 'manifest.json')).version;
assert(install.includes(`Falcon Scout Enricher ${_mv}`) && !/Enricher 5\.1[0-5]/.test(install), `INSTALL.md names the manifest's extension version (${_mv})`);
assert(!/Opens four windows/.test(install) && /falconscout-dev\.bat/.test(install) && /no auto-reload|without .{0,12}reload/i.test(install), 'INSTALL.md describes the three-window, no-reload launcher and the dev variant');
assert(/no Telegram listener any more/i.test(install) && !/python listener\.py/.test(install), 'INSTALL.md says there is no Telegram listener and no longer shows its command');
assert(/falconscout-dev\.bat/.test(claude) && /listener[\s\S]{0,120}removed on 2026-11-09/i.test(claude) && !/python listener\.py/.test(claude), "CLAUDE.md's quick start lists the dev launcher, says the listener was removed, and no longer shows its command");

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the junction target must never be followed */ }
assert(fs.existsSync(path.join(ROOT, '.venv', 'Scripts', 'python.exe')), 'cleanup left the real .venv alone');

console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
process.exit(bad ? 1 : 0);
