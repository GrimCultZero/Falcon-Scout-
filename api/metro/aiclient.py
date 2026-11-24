"""Metro's only way to reach an AI model: the app's own `/claude` proxy (METRO_PLAN.md hard rule: every call
goes through `/claude`, which picks the provider - API or the CLI bridge on the subscription).

The backend calls itself over HTTP, like the frontend does. `ask` is injectable in every caller, so tests
never reach a model.
"""
from __future__ import annotations

import json
import os
import re

SONNET = "claude-sonnet-5-5"        # /claude rewrites any Sonnet name to the one model name kept in api/main.py
HAIKU = "claude-haiku-5-5"          # cheap passes; thinks by default, so max_tokens needs headroom (>= 2000)


class AIError(RuntimeError):
    pass


def ask(prompt: str, *, system: str = "", model: str = SONNET, max_tokens: int = 4000, kind: str = "metro",
        base_url: str | None = None, timeout: float = 240.0) -> str:
    import httpx
    base = (base_url or os.getenv("METRO_SELF_URL") or "http://127.0.0.1:8000").rstrip("/")
    body = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}], "_kind": kind}
    if system:
        body["system"] = system
    try:
        r = httpx.post(base + "/claude", json=body, timeout=timeout)
    except Exception as e:
        raise AIError(f"/claude not reachable: {type(e).__name__}")
    if r.status_code != 200:
        raise AIError(f"/claude answered {r.status_code}: {r.text[:200]}")
    data = r.json()
    if data.get("stop_reason") == "max_tokens":
        raise AIError("the answer was cut off (max_tokens)")
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    if not text:
        raise AIError("empty answer")
    return text


def parse_json(text: str):
    """The first JSON object or array in a model answer (it may be wrapped in a code fence)."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    for opener, closer in (("{", "}"), ("[", "]")):
        a, b = t.find(opener), t.rfind(closer)
        if a != -1 and b > a:
            try:
                return json.loads(t[a:b + 1])
            except ValueError:
                continue
    raise AIError("the answer is not JSON")
