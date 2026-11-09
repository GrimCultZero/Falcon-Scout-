# -*- coding: utf-8 -*-
"""Geo restriction, backend half (audit 2026-10-29, T20).

The analyser treats "United States only" as a hard disqualifier, so a wrong stored value
turns a good job into a SKIP. Pinned here:

  * api/geo_restriction.py (the backend's copy of the scraper's rule) accepts exactly
    what the extension would write and refuses the junk the old scraper stored, and its
    place list and verdicts are IDENTICAL to the ones in upwork-enricher/content.js;
  * the real /enrich handler, lifted out of api/main.py and run on a scratch SQLite
    file, stores a value only when the rule accepts it, together with its evidence and
    read time, and refuses junk from an older extension;
  * the startup migration adds jobs.geo_evidence / geo_read_at to an existing database;
  * tools/clean_geo_junk.py nulls only junk, never a real value.

The live upwork_jobs.db is never opened.

Run: .venv\\Scripts\\python tests\\test_geo_restriction.py
"""
import ast
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tools"))

import geo_restriction as gr                                  # noqa: E402
from sqlalchemy import create_engine, or_                      # noqa: E402
from sqlalchemy.orm import Session                            # noqa: E402
from fastapi import HTTPException                              # noqa: E402
from db import Base, Job                                       # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

norm = gr.normalize_geo_value

# ── the rule ────────────────────────────────────────────────────────────────
ACCEPT = {"Worldwide": "Worldwide", "worldwide": "Worldwide", "United States": "United States", "US only": "United States only",
          "U.S. only": "United States only", "United States only": "United States only", "the United States only": "United States only",
          "Germany": "Germany", "Europe": "Europe", "North America only": "North America only", "UK only": "United Kingdom only",
          "Canada only": "Canada only", "United States or Canada only": "United States or Canada only", "the EU only": "EU only"}
for raw, want in ACCEPT.items():
    check(norm(raw) == want, f"accepted: {raw!r} -> {want!r} (got {norm(raw)!r})")
JUNK = ["Skills and Expertise", "English: Strong working proficiency", "- Tools: Google Ads / MCC, GA4, GTM, Hub",
        "- Monthly management fee: US$300–400.", "**Working commitment:** 4 hours per day,", "Hourly", "Entry Level", "English only",
        "Fluent English only", "Skills and Expertise only", "Narnia only", "", "   ", None, "x" * 80, "Worldwide\nGoogle Ads", "Experience Level"]
for raw in JUNK:
    check(norm(raw) is None, f"refused: {str(raw)[:50]!r}")

# ── identical to the JS copy in content.js ──────────────────────────────────
src = (ROOT / "upwork-enricher" / "content.js").read_text(encoding="utf-8").replace("\r\n", "\n")
m = re.search(r"const GEO_PLACES = new Set\('([^']+)'\.split\('\|'\)\);", src)
js_places = set(m.group(1).split("|")) if m else set()
check(js_places == set(gr.KNOWN_PLACES), f"the place list in content.js equals api/geo_restriction.py ({len(js_places)} places)")
a, b = src.index("  const GEO_PLACES"), src.index("  // -> { geo_restriction, geo_evidence }")
node_code = (
    "const fs=require('fs');"
    "const cases=JSON.parse(process.argv[1]);"
    "const src=fs.readFileSync(0,'utf8');"
    "eval(src + ';globalThis.__n=normalizeGeoValue;');"
    "console.log(JSON.stringify(cases.map(c=>globalThis.__n(c))));"
)
cases = list(ACCEPT) + [j for j in JUNK if j is not None]
r = subprocess.run(["node", "-e", node_code, json.dumps(cases)], input=src[a:b], capture_output=True, text=True, encoding="utf-8", timeout=30)
js_out = json.loads(r.stdout.strip() or "[]") if r.returncode == 0 else None
py_out = [norm(c) for c in cases]
check(js_out == py_out, "Python and the JS in content.js give the SAME verdict on all " + str(len(cases)) + " values"
      + ("" if js_out == py_out else f"  DIFF: {[ (c, j, p) for c, j, p in zip(cases, js_out or [], py_out) if j != p][:4]} err={r.stderr[:200]}"))

# ── the real /enrich handler on a scratch DB ────────────────────────────────
tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "enrich_job"]
check(len(fn) == 1, "api/main.py defines enrich_job")
fn[0].decorator_list = []
tmp = Path(tempfile.mkdtemp(prefix="fs_geo_"))
engine = create_engine(f"sqlite:///{tmp / 'scratch.db'}")
Base.metadata.create_all(engine)
ns = {"Session": Session, "engine": engine, "Job": Job, "or_": or_, "HTTPException": HTTPException, "datetime": datetime, "timezone": timezone,
      "normalize_geo_value": gr.normalize_geo_value}
exec(compile(ast.Module(body=fn, type_ignores=[]), "main_enrich", "exec"), ns)
enrich = ns["enrich_job"]

def add_job(uid):
    with Session(engine) as s:
        s.add(Job(title="A job", upwork_job_id=uid, raw_message="x", source="api"))
        s.commit()
def geo_of(uid):
    with Session(engine) as s:
        j = s.query(Job).filter(Job.upwork_job_id == uid).one()
        return j.geo_restriction, j.geo_evidence, j.geo_read_at

add_job("~g1"); add_job("~g2"); add_job("~g3"); add_job("~g4")
now = datetime.now(timezone.utc).replace(tzinfo=None)
enrich({"job_id": "~g1", "geo_restriction": "United States only", "geo_evidence": "Only freelancers located in the U.S. may apply"})
v, ev, at = geo_of("~g1")
check(v == "United States only" and ev == "Only freelancers located in the U.S. may apply" and at is not None and abs((now - at).total_seconds()) < 120,
      "a valid reading is stored WITH its evidence and a read time (UTC, just now)")
enrich({"job_id": "~g2", "geo_restriction": "Skills and Expertise", "geo_evidence": "x"})
check(geo_of("~g2") == (None, None, None), "JUNK from an older extension ('Skills and Expertise') is refused: nothing stored")
enrich({"job_id": "~g2", "geo_restriction": "- Tools: Google Ads / MCC, GA4, GTM, Hub"})
check(geo_of("~g2")[0] is None, "…the live junk value too")
enrich({"job_id": "~g3", "geo_restriction": "Worldwide"})
v, ev, at = geo_of("~g3")
check(v == "Worldwide" and ev is None and at is not None, "a valid value without evidence (older extension) is stored with evidence NULL: the analyser will call it unverified")
enrich({"job_id": "~g1", "geo_restriction": None, "geo_evidence": None})
check(geo_of("~g1")[0] == "United States only", "a null reading (the page did not say) never erases what is stored")
enrich({"job_id": "~g1", "geo_restriction": "Worldwide", "geo_evidence": "Talent Preferences -> Worldwide"})
v, ev, at = geo_of("~g1")
check(v == "Worldwide" and ev == "Talent Preferences -> Worldwide", "a later reading that says Worldwide corrects a wrong US-only (the 2026-10-29 case)")
enrich({"job_id": "~g4", "geo_restriction": "Worldwide", "geo_evidence": "e" * 900})
check(len(geo_of("~g4")[1]) == 300, "evidence is capped at 300 characters")
src_main = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
check('"geo_restriction",\n            "hire_rate"' not in src_main.replace("\r\n", "\n"), "geo_restriction is no longer in the generic copy-if-not-null field list")
check('"geo_evidence": j.geo_evidence' in src_main and '"geo_read_at": (j.geo_read_at.isoformat() + "Z")' in src_main, "the job serializer sends geo_evidence and geo_read_at (UTC, with a Z)")
check("geo_evidence" in (ROOT / "api" / "upwork_api.py").read_text(encoding="utf-8"), "API-sourced rows record their evidence too")

# ── the migration ───────────────────────────────────────────────────────────
ae = ast.parse(src_main)
mig = [n for n in ae.body if isinstance(n, ast.FunctionDef) and n.name == "_ensure_job_columns"]
mig[0].decorator_list = []
old = tmp / "old.db"
e_old = create_engine(f"sqlite:///{old}")
Base.metadata.create_all(e_old)
con = sqlite3.connect(old)
con.execute("INSERT INTO jobs (title, upwork_job_id, raw_message, source, enrich_attempts, geo_restriction) VALUES ('Old', '~o1', 'x', 'api', 0, 'Worldwide')")
con.execute("ALTER TABLE jobs DROP COLUMN geo_evidence")
con.execute("ALTER TABLE jobs DROP COLUMN geo_read_at")
con.commit()
cols_before = {r[1] for r in con.execute("PRAGMA table_info(jobs)")}
con.close()
check("geo_evidence" not in cols_before and "geo_read_at" not in cols_before, "(setup) a pre-T20 database has neither column")
ns2 = {"engine": create_engine(f"sqlite:///{old}")}
exec(compile(ast.Module(body=mig, type_ignores=[]), "main_mig", "exec"), ns2)
ns2["_ensure_job_columns"]()
con = sqlite3.connect(old)
cols = {r[1] for r in con.execute("PRAGMA table_info(jobs)")}
row = con.execute("SELECT geo_restriction, geo_evidence, geo_read_at FROM jobs").fetchone()
con.close()
check({"geo_evidence", "geo_read_at"} <= cols and row == ("Worldwide", None, None), "the migration adds both columns and keeps the existing row (evidence NULL)")
ns2["_ensure_job_columns"]()
check(True, "…and is harmless to run twice")

# ── the cleanup tool ────────────────────────────────────────────────────────
import clean_geo_junk as cj
db = tmp / "clean.db"
e = create_engine(f"sqlite:///{db}")
Base.metadata.create_all(e)
con = sqlite3.connect(db)
rows = [("~c1", "Skills and Expertise"), ("~c2", "English: Strong working proficiency"), ("~c3", "- Tools: Google Ads / MCC, GA4, GTM, Hub"),
        ("~c4", "United States only"), ("~c5", "Worldwide"), ("~c6", "Germany"), ("~c7", "**Working commitment:** 4 hours per day,"), ("~c8", None)]
for uid, val in rows:
    con.execute("INSERT INTO jobs (title, upwork_job_id, raw_message, source, enrich_attempts, geo_restriction) VALUES (?,?,'x','api',0,?)", (f"job {uid}", uid, val))
con.commit(); con.close()
ro = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
junk = cj.find_junk(ro)
ro.close()
check({j[2] for j in junk} == {"~c1", "~c2", "~c3", "~c7"}, "find_junk picks exactly the junk values (4), never a real one")
buf_rc = cj.main(["--db", str(db)])
con = sqlite3.connect(db)
unchanged = con.execute("SELECT COUNT(*) FROM jobs WHERE geo_restriction IS NOT NULL").fetchone()[0]
con.close()
check(buf_rc == 0 and unchanged == 7, "a dry run changes nothing")
check(cj.main(["--db", str(db), "--apply", "--no-backup"]) == 0, "--apply runs")
con = sqlite3.connect(db)
after = dict(con.execute("SELECT upwork_job_id, geo_restriction FROM jobs"))
con.close()
check(all(after[k] is None for k in ("~c1", "~c2", "~c3", "~c7")), "the four junk values are NULL")
check(after["~c4"] == "United States only" and after["~c5"] == "Worldwide" and after["~c6"] == "Germany" and after["~c8"] is None, "real values (United States only, Worldwide, Germany) are untouched")
check(cj.main(["--db", str(db), "--apply", "--no-backup"]) == 0 and cj.find_junk(sqlite3.connect(db)) == [], "running it again finds nothing")
tool_src = (ROOT / "tools" / "clean_geo_junk.py").read_text(encoding="utf-8")
check("run_backup()" in tool_src and "REFUSING" in tool_src, "--apply takes a verified backup first and refuses if it fails")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
