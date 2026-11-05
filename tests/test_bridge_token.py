# -*- coding: utf-8 -*-
"""CLI bridge token: the backend half and the .env helper (audit 2026-10-29, T3).

Pinned here:
  * tools/ensure_bridge_token.py adds a token when missing, replaces an empty or
    short one, keeps a good one, keeps the file's CRLF line endings, changes no
    other line and never prints the token;
  * the real _bridge_headers lifted out of api/main.py (main.py is never imported
    by tests) sends X-Falcon-Token and refuses to run without a token;
  * every backend POST to the bridge's /ai sends those headers.

SAFETY: no sockets are opened. The real .env is never touched.

Run: .venv\\Scripts\\python tests\\test_bridge_token.py
"""
import ast
import contextlib
import io
import os
import re
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import ensure_bridge_token as ebt  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

def token_in(text):
    m = re.search(r"^CLI_BRIDGE_TOKEN=(.*)$", text, re.M)
    return m.group(1).strip() if m else None

tmp = Path(tempfile.mkdtemp(prefix="fs_bridge_token_"))

# ── ensure_bridge_token ─────────────────────────────────────────────────────
env = tmp / "a.env"
env.write_bytes(b"ANTHROPIC_API_KEY=sk-x\r\nCLI_BRIDGE_PORT=27184\r\n")
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    res = ebt.ensure(env)
    ebt.main([str(env)])
raw = env.read_bytes()
text = raw.decode("utf-8")
tok = token_in(text.replace("\r", ""))
check(res == "added" and tok and len(tok) == 64 and re.fullmatch(r"[0-9a-f]{64}", tok), "missing -> a 64-hex-character token is added")
check(b"\n" not in raw.replace(b"\r\n", b""), "the file keeps CRLF on every line (no bare LF added)")
check(text.startswith("ANTHROPIC_API_KEY=sk-x\r\nCLI_BRIDGE_PORT=27184\r\n"), "the existing lines are unchanged")
check(tok not in buf.getvalue(), "the token is never printed")
before = env.read_bytes()
check(ebt.ensure(env) == "kept" and env.read_bytes() == before, "a good token is kept byte for byte")

env2 = tmp / "b.env"
env2.write_text("A=1\nCLI_BRIDGE_TOKEN=\nB=2\n", encoding="utf-8", newline="")
check(ebt.ensure(env2) == "replaced", "an empty key is replaced")
t2 = env2.read_text(encoding="utf-8")
check(t2.startswith("A=1\nCLI_BRIDGE_TOKEN=") and t2.endswith("\nB=2\n") and len(token_in(t2)) == 64 and t2.count("CLI_BRIDGE_TOKEN") == 1,
      "…in place, on its own line, LF file stays LF, other lines untouched")

env3 = tmp / "c.env"
env3.write_text('CLI_BRIDGE_TOKEN="short"\n', encoding="utf-8")
check(ebt.ensure(env3) == "replaced" and len(token_in(env3.read_text(encoding="utf-8"))) == 64, "a token under 32 characters is replaced")

env4 = tmp / "d.env"
env4.write_text("# CLI_BRIDGE_TOKEN=\nX=1", encoding="utf-8")
check(ebt.ensure(env4) == "added" and env4.read_text(encoding="utf-8").startswith("# CLI_BRIDGE_TOKEN=\nX=1\n"),
      "a commented-out key does not count, and a file without a final newline gets one before the new key")

# ── _bridge_headers in api/main.py ──────────────────────────────────────────
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_bridge_headers"]
check(len(fn) == 1, "api/main.py defines _bridge_headers")
class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail
ns = {"os": os, "HTTPException": HTTPException}
exec(compile(ast.Module(body=fn, type_ignores=[]), "main_helpers", "exec"), ns)
headers = ns["_bridge_headers"]
old = os.environ.get("CLI_BRIDGE_TOKEN")
try:
    os.environ["CLI_BRIDGE_TOKEN"] = "  " + "k" * 40 + " "
    check(headers() == {"X-Falcon-Token": "k" * 40}, "the token from the environment is sent as X-Falcon-Token, trimmed")
    os.environ["CLI_BRIDGE_TOKEN"] = '"' + "q" * 40 + '"'
    check(headers() == {"X-Falcon-Token": "q" * 40}, "surrounding quotes are stripped, like bridge-port.js does")
    for v in (None, "", "   "):
        if v is None:
            os.environ.pop("CLI_BRIDGE_TOKEN", None)
        else:
            os.environ["CLI_BRIDGE_TOKEN"] = v
        try:
            headers()
            check(False, f"token {v!r} -> should refuse")
        except HTTPException as e:
            check(e.status_code == 502 and "CLI_BRIDGE_TOKEN" in e.detail, f"token {v!r} -> a clear 502, no call is made")
finally:
    if old is None:
        os.environ.pop("CLI_BRIDGE_TOKEN", None)
    else:
        os.environ["CLI_BRIDGE_TOKEN"] = old

posts = re.findall(r"\.post\(_bridge_url\(\"/ai\"\)[^\n]*(?:\n[^\n]*)?", src)
check(len(posts) == 3 and all("headers=" in p for p in posts), f"all {len(posts)} backend POSTs to /ai send the token headers")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
