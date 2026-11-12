# -*- coding: utf-8 -*-
"""GET /jobs/{id}/analysis exists and returns the stored analysis (2026-11-12).

generate() used to fetch this on a route that only accepted POST (405), so the letter generator
never saw an analysis. The GET route now exists so it can read filtered "ANALYSER NOTES" hints.
It is a plain read: it never gates anything. Runs the REAL handlers lifted out of api/main.py on
a scratch SQLite file; the live upwork_jobs.db is never opened.

Run: .venv\\Scripts\\python tests\\test_analysis_route.py
"""
import ast
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from fastapi import HTTPException                       # noqa: E402
from sqlalchemy import create_engine                    # noqa: E402
from sqlalchemy.orm import Session                      # noqa: E402
from db import Base, Job                                # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
fns = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ("get_job_analysis", "save_job_analysis")]
check(len(fns) == 2, "both the GET and the POST handler exist in api/main.py")
decos = {n.name: ast.unparse(n.decorator_list[0]) for n in fns}
check(decos.get("get_job_analysis") == "app.get('/jobs/{job_id}/analysis')" and decos.get("save_job_analysis") == "app.post('/jobs/{job_id}/analysis')",
      "GET and POST are both routed on /jobs/{job_id}/analysis")
for n in fns:
    n.decorator_list = []
engine = create_engine(f"sqlite:///{Path(tempfile.mkdtemp(prefix='fs_analysis_')) / 'scratch.db'}")
Base.metadata.create_all(engine)
ns = {"Session": Session, "engine": engine, "Job": Job, "HTTPException": HTTPException, "datetime": datetime, "timezone": timezone, "_json_mod": json}
exec(compile(ast.Module(body=fns, type_ignores=[]), "main_analysis", "exec"), ns)
get, post = ns["get_job_analysis"], ns["save_job_analysis"]

with Session(engine) as s:
    j = Job(title="Google Ads for Fashion Store", raw_message="x", source="api")
    s.add(j); s.commit()
    jid = j.id

check(get(jid) == {"analysis": None, "at": None}, "a job never analysed -> {analysis: null, at: null} (not a 404, not an error)")
A = {"verdict": "SKIP", "score": 3, "summary": "s", "reasons": ["r"], "flags": ["f"], "rules": "testweek"}
check(post(jid, A) == {"ok": True}, "POST still stores the analysis")
r = get(jid)
check(r["analysis"] == A and r["at"] and r["at"].startswith("20"), "GET returns exactly what was stored, with its timestamp")
A2 = {**A, "verdict": "APPLY", "score": 8}
post(jid, A2)
check(get(jid)["analysis"]["score"] == 8, "a newer analysis replaces the older one (the latest wins)")
try:
    get(999999)
    check(False, "an unknown job id is a 404")
except HTTPException as e:
    check(e.status_code == 404, "an unknown job id is a 404")
with Session(engine) as s:
    s.get(Job, jid).last_analysis_json = "{not json"; s.commit()
check(get(jid)["analysis"] is None, "a corrupt stored value reads as no analysis instead of crashing the generator")

print(("\n%d FAILURES" % bad) if bad else "\nall pass")
sys.exit(1 if bad else 0)
