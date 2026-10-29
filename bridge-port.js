'use strict';
// Which port the Falcon Scout CLI bridge listens on -- decided in ONE place.
//
// Why this exists (audit 2026-10-29, T2): the port was a literal in three
// files. The owner's other app (Baba Leada) already uses 27183, so on his
// machine Falcon Scout was moved to 27184 -- but only half of that move was
// ever committed (api/main.py said 27184; cli-bridge.js and App.jsx said 27183
// and were edited locally). A fresh clone got a backend that could never reach
// its own bridge, and a committed 27184 would have broken every machine that
// doesn't have Baba Leada.
//
// Now: CLI_BRIDGE_PORT in .env. Unset -> 27183 (the original default).
//
// Precedence mirrors api/main.py, which loads .env with load_dotenv(override=True):
//   1. the key in .env   (even if empty -> default)
//   2. the process environment
//   3. 27183
// Keeping the two sides identical is the whole point -- if the bridge and the
// backend ever disagree, the backend would talk to whatever else owns the port.
//
// An invalid value THROWS rather than falling back to the default. Silently
// choosing 27183 would mean binding (or calling) the port another app owns.
//
// No dependencies: cli-bridge.js is launched from the repo root and has no
// node_modules, so .env is read with a few lines of parsing.

const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 27183;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** KEY=VALUE pairs from a .env file. Values are literal; surrounding quotes are stripped. */
function parseEnvFile(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return out; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * @param {{envFile?: string, environ?: object}} [opts]  injectable for tests
 * @returns {{port: number, source: '.env'|'environment'|'default'}}
 * @throws {Error} when CLI_BRIDGE_PORT is set to something that is not a usable port
 */
function resolveBridgePortInfo(opts = {}) {
  const envFile = opts.envFile || path.join(__dirname, '.env');
  const environ = opts.environ || process.env;

  const fromFile = parseEnvFile(envFile);
  let raw, source;
  if (Object.prototype.hasOwnProperty.call(fromFile, 'CLI_BRIDGE_PORT')) {
    raw = fromFile.CLI_BRIDGE_PORT; source = '.env';
  } else if (environ.CLI_BRIDGE_PORT !== undefined) {
    raw = environ.CLI_BRIDGE_PORT; source = 'environment';
  }

  const text = (raw === undefined || raw === null) ? '' : String(raw).trim();
  if (text === '') return { port: DEFAULT_PORT, source: 'default' };

  if (!/^[0-9]+$/.test(text)) {
    throw new Error(`CLI_BRIDGE_PORT must be a whole number, got "${text}"`);
  }
  const port = parseInt(text, 10);
  if (port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`CLI_BRIDGE_PORT must be between ${MIN_PORT} and ${MAX_PORT}, got ${port}`);
  }
  return { port, source };
}

function resolveBridgePort(opts) {
  return resolveBridgePortInfo(opts).port;
}

module.exports = { resolveBridgePort, resolveBridgePortInfo, parseEnvFile, DEFAULT_PORT };
