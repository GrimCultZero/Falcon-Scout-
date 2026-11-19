// Shared by every test that spins up a REAL cli-bridge.js against a scratch port
// (bridge-lockdown.test.js, bridge-port.test.js, cli-bridge-auth.test.js).
//
// Asks the OS for a free port, then refuses anything below 40000 or in DENY_LIST --
// close enough to a real app's port (27183/27184 the bridge itself, 8000 the backend,
// 5180 the frontend) that a flaky OS port reuse could otherwise hand a test one of
// those. Windows' ephemeral range starts at 49152, so locally that guard almost never
// fires; Linux's starts much lower (~32768+), so on GitHub Actions' ubuntu-latest
// runner the very first port offered is often under 40000 and every one of these
// three tests failed on every CI run for exactly that reason (audit 2026-11-19).
// Retrying a few times (new port each time -- a closed port is handed back to the OS,
// which is free to offer a different one) fixes it without touching the 40000 floor
// or the deny-list.
//
// Never lower the 40000 guard here: it exists so these tests cannot accidentally bind
// a port close to the real app's, not just the four exact ports in DENY_LIST.
const net = require('net');

const DENY_LIST = new Set([27183, 27184, 8000, 5180]);
const MIN_PORT = 40000;
const MAX_TRIES = 50;

function once() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** A free TCP port that is >= 40000 and not in DENY_LIST, retrying up to MAX_TRIES
 * times (each attempt asks the OS for a fresh one). Throws a clear error, rather than
 * silently returning an unsafe port, if none turns up in that many tries. */
async function getFreeBridgePort() {
  for (let i = 0; i < MAX_TRIES; i++) {
    const p = await once();
    if (!DENY_LIST.has(p) && p >= MIN_PORT) return p;
  }
  throw new Error(`getFreeBridgePort: no port >= ${MIN_PORT} outside ${[...DENY_LIST]} in ${MAX_TRIES} tries`);
}

module.exports = { getFreeBridgePort, DENY_LIST, MIN_PORT };
