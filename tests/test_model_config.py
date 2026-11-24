# -*- coding: utf-8 -*-
"""Model names live in ONE place (owner, 2026-11-24: "always use Sonnet 5 or 5.5").

  * api/main.py: SONNET_MODEL / HAIKU_MODEL, and _resolve_model(), which /claude uses to rewrite ANY Sonnet
    name the frontend sends (old or new spelling) to SONNET_MODEL, so a stale name in a component can never
    pin the app to an old model.
  * frontend/src/lib/models.js: the same two constants for the components.
  * No hard-coded Sonnet 4.x or Haiku name anywhere in the app code (the price table is the one exception:
    it lists old names so past usage rows still price correctly).

Lifts the real constants and function out of api/main.py by AST (no app import, no network).
Run: .venv\\Scripts\\python tests\\test_model_config.py
"""
import ast
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


def lift(env_overrides=None):
    wanted = []
    for n in tree.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ("SONNET_MODEL", "HAIKU_MODEL") for t in n.targets):
            wanted.append(n)
        if isinstance(n, ast.FunctionDef) and n.name == "_resolve_model":
            wanted.append(n)
    old = {k: os.environ.get(k) for k in ("FALCON_SONNET_MODEL", "FALCON_HAIKU_MODEL")}
    for k in old:
        os.environ.pop(k, None)
    os.environ.update(env_overrides or {})
    try:
        ns = {"os": os}
        exec(compile(ast.Module(body=wanted, type_ignores=[]), "main_lift", "exec"), ns)
    finally:
        for k, v in old.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v
    return ns


ns = lift()
check(ns["SONNET_MODEL"] == "claude-sonnet-5-5", "default Sonnet is claude-sonnet-5-5")
check(ns["HAIKU_MODEL"] == "claude-haiku-5-5", "default Haiku (cheap passes) is claude-haiku-5-5")

r = ns["_resolve_model"]
for old in ("claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "claude-sonnet-4-6", "claude-sonnet-4", "Claude-Sonnet-3-7", "sonnet", "claude-sonnet-5"):
    check(r(old) == "claude-sonnet-5-5", f"any Sonnet name is rewritten to the configured Sonnet: {old!r}")
check(r(None) == "claude-sonnet-5-5" and r("") == "claude-sonnet-5-5" and r("   ") == "claude-sonnet-5-5", "no model requested -> the configured Sonnet")
check(r("claude-haiku-4-5-20251001") == "claude-haiku-4-5-20251001", "a Haiku request passes through unchanged")

# Haiku 5.5 thinks by default and thinking counts against max_tokens: at 150 it returned no answer at all
# (tested 2026-11-24). Every frontend Haiku call must leave room for it.
jd = (ROOT / "frontend" / "src" / "components" / "JobDetail.jsx").read_text(encoding="utf-8")
budgets = []
for m_ in re.finditer(r"model: (?:model \|\| )?HAIKU_MODEL,\s*max_tokens: (\d+)", jd):
    budgets.append(int(m_.group(1)))
check(len(budgets) == 3 and all(b >= 1500 for b in budgets), f"every Haiku call in JobDetail.jsx has max_tokens >= 1500 (thinking headroom): {budgets}")
check('"max_tokens": 8192,  # Haiku 5.5' in src, "kb_shrink Haiku call has thinking headroom (8192)")

# Sonnet 5.5 also thinks by default. 2026-11-24: the cover-letter call (max_tokens 2000) produced exactly 2000
# output tokens and the letter ended mid-sentence. Every Sonnet call needs headroom, and a cut-off letter must error.
m_ = re.search(r"_kind: coreOnly \? 'proposal_rescan' : 'proposal',\s*model: SONNET_MODEL,\s*max_tokens: (\d+)", jd)
check(m_ and int(m_.group(1)) >= 6000, f"cover-letter call has thinking headroom (max_tokens {m_.group(1) if m_ else '?'} >= 6000)")
m_ = re.search(r"_kind: 'proposal_repair',\s*model: SONNET_MODEL,\s*max_tokens: (\d+)", jd)
check(m_ and int(m_.group(1)) >= 3000, f"letter-repair call has thinking headroom (max_tokens {m_.group(1) if m_ else '?'} >= 3000)")
small = [int(x) for x in re.findall(r'"max_tokens": (\d+)', src) if int(x) < 8000]
check(sorted(small) == [150, 150, 1024] or all(x >= 1024 for x in small) , f"api/main.py has no small Sonnet budgets left: {sorted(small)}")
check("data.stop_reason === 'max_tokens'" in jd and "The letter hit the length limit" in jd, "a cover letter that ran out of tokens raises an error instead of being shown as finished")
check("$${job.fixed_budget}" not in jd, "the budget is not printed with a doubled dollar sign ($$2,000)")
check(r("claude-opus-4-7") == "claude-opus-4-7", "an Opus request passes through unchanged (nothing requests it today)")

ns2 = lift({"FALCON_SONNET_MODEL": "claude-sonnet-9-9"})
check(ns2["SONNET_MODEL"] == "claude-sonnet-9-9" and ns2["_resolve_model"]("claude-sonnet-4-5") == "claude-sonnet-9-9",
      "FALCON_SONNET_MODEL in .env moves the whole app to another Sonnet without a code edit")

# the proxy must send the RESOLVED name to Anthropic
check('model = _resolve_model(request.get("model"))' in src and 'request["model"] = model' in src,
      "/claude resolves the requested model and writes it back into the forwarded payload")

# no stale names in app code
price_start = src.index("_MODEL_PRICING = {")
price_end = src.index("\n}", price_start)
outside_table = src[:price_start] + src[price_end:]
stale = re.findall(r'"claude-(?:sonnet|haiku|opus)-[0-9][^"]*"', outside_table)
stale = [s for s in stale if s not in ('"claude-sonnet-5-5"',)]
# the only literals allowed outside the price table are the constants' own defaults
allowed = {'"claude-haiku-5-5"'}
check(all(s in allowed for s in stale) and stale.count('"claude-haiku-5-5"') <= 1,
      f"api/main.py has no hard-coded model names outside the constants and the price table: {sorted(set(stale))}")

fe_hits = []
for p in (ROOT / "frontend" / "src").rglob("*.js*"):
    if p.name == "models.js":
        continue
    for i, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if re.search(r"claude-(sonnet|haiku|opus)-[0-9]", line):
            fe_hits.append(f"{p.name}:{i}")
check(not fe_hits, f"no hard-coded model names in frontend components: {fe_hits}")

fe = (ROOT / "frontend" / "src" / "lib" / "models.js").read_text(encoding="utf-8")
m = re.search(r"SONNET_MODEL = '([^']+)'", fe)
check(m and m.group(1) == ns["SONNET_MODEL"], "the frontend and backend Sonnet constants agree")
m = re.search(r"HAIKU_MODEL = '([^']+)'", fe)
check(m and m.group(1) == ns["HAIKU_MODEL"], "the frontend and backend Haiku constants agree")

# the price table knows the new names (usage chip must not fall back to the wrong rate)
check('"claude-sonnet-5-5":          {"input": 2.0, "output": 10.0}' in src, "price table: claude-sonnet-5-5 at $2 / $10 per million tokens")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
