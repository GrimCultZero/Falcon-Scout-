// Runs every tests/*.test.js. A suite fails on a non-zero exit code OR any line starting
// with "FAIL" in its output. Corpus sections skip themselves when tests/.letters.json is
// absent (it holds real client letters and is never committed), so this passes in CI.
//
// Run: node tests/run_all.mjs [--python]     (--python also runs tests/run_all.py)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
// tests/metro/ holds Metro's suites (METRO_PLAN.md); they run with the rest.
const files = [
  ...readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort(),
  ...(existsSync(join(dir, 'metro')) ? readdirSync(join(dir, 'metro')).filter((f) => f.endsWith('.test.js')).sort().map((f) => join('metro', f)) : []),
];
const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], { encoding: 'utf8', timeout: 180000, cwd: join(dir, '..') });
  const out = (r.stdout || '') + (r.stderr || '');
  const failLines = out.split(/\r?\n/).filter((l) => /^FAIL\b/.test(l));
  const bad = r.status !== 0 || failLines.length > 0;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${f}${failLines.length ? `  (${failLines.length} FAIL lines)` : ''}${r.status !== 0 && !failLines.length ? `  (exit ${r.status})` : ''}`);
  if (bad) { failed.push(f); failLines.slice(0, 5).forEach((l) => console.log('        ' + l)); }
}
console.log(`\n${files.length} JS suites, ${failed.length} failing`);
let code = failed.length ? 1 : 0;
if (process.argv.includes('--python')) {
  const py = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? join(dir, '..', '.venv', 'Scripts', 'python.exe') : 'python3'),
    [join(dir, 'run_all.py')], { stdio: 'inherit' });
  if (py.status !== 0) code = 1;
}
process.exit(code);
