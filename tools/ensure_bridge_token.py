# -*- coding: utf-8 -*-
"""Make sure .env has a CLI_BRIDGE_TOKEN (audit 2026-10-29, T3).

The CLI bridge (cli-bridge.js) only answers /ai when the caller sends
X-Falcon-Token equal to CLI_BRIDGE_TOKEN. The backend reads the same key, so
both sides only need it to exist. setup.bat and falconscout.bat run this before
anything starts, so an existing install picks up a token on its next launch
without re-running setup.

  * key missing, empty or shorter than 32 characters -> a new random token is
    written (an existing short value is replaced on its own line);
  * a good token is left exactly as it is;
  * the token is never printed;
  * the file's own line endings are kept; nothing else in .env changes.

Standard library only, so it runs before .venv exists.

Run: python tools/ensure_bridge_token.py [path\\to\\.env]
"""
import re
import secrets
import sys
from pathlib import Path

KEY = "CLI_BRIDGE_TOKEN"
MIN_LEN = 32  # bridge-port.js MIN_TOKEN_LENGTH

_LINE_RE = re.compile(r"^\s*" + KEY + r"\s*=(.*)$")


def _value(raw: str) -> str:
    v = raw.strip()
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        v = v[1:-1]
    return v.strip()


def ensure(env_path: Path) -> str:
    """Returns 'kept', 'added' or 'replaced'."""
    # read_bytes, not read_text: read_text turns \r\n into \n, and the rewrite
    # would then convert the whole file to LF.
    text = env_path.read_bytes().decode("utf-8") if env_path.exists() else ""
    nl = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()
    token = secrets.token_hex(32)  # 64 hex characters
    for i, ln in enumerate(lines):
        m = _LINE_RE.match(ln)
        if not m:
            continue
        if len(_value(m.group(1))) >= MIN_LEN:
            return "kept"
        lines[i] = f"{KEY}={token}"
        env_path.write_text(nl.join(lines) + nl, encoding="utf-8", newline="")
        return "replaced"
    if text and not text.endswith(("\n", "\r")):
        text += nl
    text += f"# Shared secret the backend sends to the CLI bridge (created automatically; keep it private).{nl}"
    text += f"{KEY}={token}{nl}"
    env_path.write_text(text, encoding="utf-8", newline="")
    return "added"


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    env_path = Path(argv[0]) if argv else Path(__file__).resolve().parent.parent / ".env"
    result = ensure(env_path)
    if result != "kept":
        print(f"CLI_BRIDGE_TOKEN {result} in {env_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
