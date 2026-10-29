# -*- coding: utf-8 -*-
"""The backend half of the one-setting bridge port (audit 2026-10-29, T2).

The CLI bridge's port is CLI_BRIDGE_PORT in .env. Two programs must read it the
same way or the backend talks to the wrong place: bridge-port.js (the bridge)
and api/main.py (the backend). The Baba Leada collision that caused all this is
exactly such a disagreement -- the owner's other app owns the default port, and a
backend that guesses it would send job postings and client details to that app.

Pinned here:
  * the real _bridge_port/_bridge_url/get_bridge_status lifted out of api/main.py
    (main.py is never imported by tests) behave as specified;
  * for every input in a table, Python and the Node resolver give the SAME answer
    -- the same port, or both refuse;
  * an invalid value raises (never falls back to the default) and the status route
    reports it instead of hiding it;
  * the backend calls the bridge only through _bridge_url().

SAFETY: no sockets are opened. 27183 and 27184 are never contacted.

Run: .venv\\Scripts\\python tests\\test_bridge_port.py
"""
import ast
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

WANT_FUNCS = {"_bridge_port", "_bridge_url", "get_bridge_status"}
WANT_VARS = {"_BRIDGE_DEFAULT_PORT"}
nodes = []
for n in tree.body:
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in WANT_FUNCS:
        n.decorator_list = []                      # drop @app.get -- there is no app here
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT_VARS for t in n.targets):
        nodes.append(n)
got = {getattr(n, "name", None) or n.targets[0].id for n in nodes}
if got != (WANT_FUNCS | WANT_VARS):
    print(f"FAIL  could not lift the bridge helpers from api/main.py (found {sorted(got)})")
    sys.exit(1)

# stand-ins for what the route calls, so no socket is ever opened
calls = {"pings": 0}
async def _fake_ping():
    calls["pings"] += 1
    return True
ns = {"os": os, "_ping_cli_bridge": _fake_ping}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_helpers", "exec"), ns)
bridge_port, bridge_url, get_status = ns["_bridge_port"], ns["_bridge_url"], ns["get_bridge_status"]

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

def with_env(value):
    """Run bridge_port() with CLI_BRIDGE_PORT set (or removed when value is None)."""
    old = os.environ.get("CLI_BRIDGE_PORT")
    try:
        if value is None:
            os.environ.pop("CLI_BRIDGE_PORT", None)
        else:
            os.environ["CLI_BRIDGE_PORT"] = value
        try:
            return bridge_port()
        except ValueError:
            return "ERR"
    finally:
        if old is None:
            os.environ.pop("CLI_BRIDGE_PORT", None)
        else:
            os.environ["CLI_BRIDGE_PORT"] = old

# ── the helpers behave ──────────────────────────────────────────────────────
check(ns["_BRIDGE_DEFAULT_PORT"] == 27183, "the default is the original 27183, so a fresh clone behaves exactly as before")
check(with_env(None) == 27183, "unset -> default")
check(with_env("") == 27183 and with_env("   ") == 27183, "empty or blank -> default (same as unset)")
check(with_env("27184") == 27184 and with_env(" 27184 ") == 27184 and with_env("027184") == 27184, "27184, padded or zero-led -> 27184")
os.environ["CLI_BRIDGE_PORT"] = "27184"
check(bridge_url("/ai") == "http://127.0.0.1:27184/ai" and bridge_url() == "http://127.0.0.1:27184",
      "_bridge_url builds the address from the setting, always on loopback")
os.environ.pop("CLI_BRIDGE_PORT", None)
check(bridge_url("/ping") == "http://127.0.0.1:27183/ping", "with the setting removed, everything uses 27183 (computed, no request made)")

# ── Python and Node must agree on every input ───────────────────────────────
table = [None, "", "27184", " 27184 ", "027184", "31001", "abc", "27184x", "12.5", "-5", "0x10",
         "80", "1023", "1024", "65535", "65536", "70000", "٢٧١٨٤", "²⁷"]
node_code = (
    "const r=require(process.env.FS_BP_MODULE);"
    "const v=process.env.FS_BP_VALUE;"
    "const environ = v === '__UNSET__' ? {} : {CLI_BRIDGE_PORT: v};"
    "try{console.log(r.resolveBridgePort({envFile: process.env.FS_BP_NOFILE, environ}))}"
    "catch(e){console.log('ERR')}"
)
mismatch = []
node_ok = True
for v in table:
    py = with_env(v)
    env = dict(os.environ, FS_BP_MODULE=str(ROOT / "bridge-port.js"), FS_BP_VALUE="__UNSET__" if v is None else v,
               FS_BP_NOFILE=str(ROOT / "tests" / "_no_such_env_file"))
    env.pop("CLI_BRIDGE_PORT", None)
    try:
        out = subprocess.run(["node", "-e", node_code], capture_output=True, text=True, env=env, timeout=20, encoding="utf-8")
        js = out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        node_ok = False
        break
    if str(py) != js:
        mismatch.append((v, py, js))
if node_ok:
    check(not mismatch, f"Python and Node agree on all {len(table)} inputs -- same port or both refuse"
                        + (f"  MISMATCH: {mismatch}" if mismatch else ""))
else:
    check(False, "node is required to cross-check the two resolvers")

for v in ("abc", "80", "70000", "٢٧١٨٤", "²⁷"):
    check(with_env(v) == "ERR", f'"{v}" raises in the backend -- it never falls back to the default')

# ── the status route ────────────────────────────────────────────────────────
os.environ["CLI_BRIDGE_PORT"] = "27184"
calls["pings"] = 0
res = asyncio.run(get_status())
check(res == {"up": True, "port": 27184} and calls["pings"] == 1, f"valid setting -> pings once and reports it: {res}")
os.environ["CLI_BRIDGE_PORT"] = "nonsense"
calls["pings"] = 0
res = asyncio.run(get_status())
check(res["up"] is False and res["port"] is None and "whole number" in res["error"] and calls["pings"] == 0,
      "invalid setting -> reported as an error and NO ping is sent anywhere")
os.environ.pop("CLI_BRIDGE_PORT", None)

# ── nothing else in the backend knows the port ──────────────────────────────
check("2718" not in src.replace("_BRIDGE_DEFAULT_PORT = 27183", ""), "api/main.py has no other port literal")
call_sites = src.count("_bridge_url(") - 1          # minus the definition
check(call_sites == 6, f"the backend reaches the bridge through _bridge_url() at all 6 places that used a literal (found {call_sites})")
# The only other loopback addresses in main.py are the CORS allow-list for the
# FRONTEND (5180 current, 5174/5173 legacy). They are not the bridge, and T2 must
# not touch any other port.
other = [ln.strip() for ln in src.splitlines() if "127.0.0.1:" in ln
         and "_bridge_port()" not in ln                         # the helper itself
         and not any(f"127.0.0.1:{p}" in ln for p in (5180, 5174, 5173))]
check(not other, "no hand-built loopback address remains except the helper and the frontend CORS origins"
                 + (f"  LEFTOVER: {other}" if other else ""))
check('load_dotenv(ROOT / ".env", override=True)' in src, ".env is loaded with override=True, so .env wins over the shell (bridge-port.js does the same)")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
