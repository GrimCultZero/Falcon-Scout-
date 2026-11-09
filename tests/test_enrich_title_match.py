# -*- coding: utf-8 -*-
"""A page must not be attached to ANOTHER job by a loose title match (audit 2026-10-29, T21).

/enrich used to fall back to "any of the 100 newest jobs that share 3 words with the page
title" when the page's job id was not in the database, then write the page's data and its
job id onto that other job. "Google Ads Specialist for Plumbing" landed on "Google Ads
Specialist for Roofing". That is the likely source of the stamps on unrelated jobs (report
section 10) and of job ids sitting on source='room' rows with different titles (7.4).

Pinned, running the real handler lifted out of api/main.py on a scratch SQLite file:
  * a page whose id is unknown and whose title only OVERLAPS another job's title creates its
    own job; the other job is untouched (data AND id);
  * a candidate that already has a DIFFERENT job id is never the match, even on an exact title;
  * the legitimate cases still work: an exact title on a row with no id yet (the room row)
    gets the id; a page with no id at all still matches loosely (legacy bot pages); an exact
    id match wins.
The live upwork_jobs.db is never opened.

Run: .venv\\Scripts\\python tests\\test_enrich_title_match.py
"""
import ast
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from fastapi import HTTPException                              # noqa: E402
from sqlalchemy import create_engine, or_                      # noqa: E402
from sqlalchemy.orm import Session                            # noqa: E402
import geo_restriction as gr                                   # noqa: E402
from db import Base, Job                                       # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
fn = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "enrich_job"]
fn[0].decorator_list = []
engine = create_engine(f"sqlite:///{Path(tempfile.mkdtemp(prefix='fs_enrich_')) / 'scratch.db'}")
Base.metadata.create_all(engine)
ns = {"Session": Session, "engine": engine, "Job": Job, "or_": or_, "HTTPException": HTTPException, "datetime": datetime,
      "timezone": timezone, "normalize_geo_value": gr.normalize_geo_value}
exec(compile(ast.Module(body=fn, type_ignores=[]), "main_enrich", "exec"), ns)
enrich = ns["enrich_job"]

def add(title, uid=None, source="api", **kw):
    with Session(engine) as s:
        j = Job(title=title, upwork_job_id=uid, raw_message="x", source=source, **kw)
        s.add(j); s.commit()
        return j.id
def get(jid):
    with Session(engine) as s:
        j = s.get(Job, jid)
        return {"uid": j.upwork_job_id, "proposals": j.proposals, "hire": j.hire_rate, "source": j.source, "title": j.title}
def count():
    with Session(engine) as s:
        return s.query(Job).count()
PAGE = lambda title, jid, **kw: {"job_id": jid, "page_title": title, "url": f"https://www.upwork.com/jobs/~{jid}", "proposals": "10 to 15", "hire_rate": 60, **kw}

# 1. THE BUG: id unknown, title merely overlaps another recent job
roof = add("Google Ads Specialist for Roofing", "0211111111111111111")
before = count()
enrich(PAGE("Google Ads Specialist for Plumbing", "0222222222222222222"))
check(get(roof) == {"uid": "0211111111111111111", "proposals": None, "hire": None, "source": "api", "title": "Google Ads Specialist for Roofing"},
      "a page about PLUMBING does not touch the ROOFING job: no data written, its job id unchanged")
check(count() == before + 1, "…the page got its own job instead")
with Session(engine) as s:
    mine = s.query(Job).filter(Job.upwork_job_id == "0222222222222222222").one()
check(mine.title == "Google Ads Specialist for Plumbing" and mine.source == "extension" and mine.proposals == "10 to 15", "…created from the page itself (source 'extension', its own data)")

# 2. a candidate with a DIFFERENT id is never the match, even on an exact title
other = add("Shopify SEO Expert", "0233333333333333333")
before = count()
enrich(PAGE("Shopify SEO Expert", "0244444444444444444"))
check(get(other)["uid"] == "0233333333333333333" and get(other)["proposals"] is None, "an exact-title row that already has ANOTHER job's id is not overwritten")
check(count() == before + 1, "…a new job is created for the page")

# 3. the legitimate room case: exact title, the row has no id yet -> it gets the id
room = add("AEO Expert for Backlink Building", None, source="room")
enrich(PAGE("AEO Expert for Backlink Building", "0255555555555555555"))
g = get(room)
check(g["uid"] == "0255555555555555555" and g["proposals"] == "10 to 15" and g["source"] == "room", "exact title on a row with no id yet (a room row): it is enriched and gets the id")

# 4. a page with NO id still matches loosely (legacy bot pages)
bot = add("Technical SEO audit for an ecommerce store", None, source="bot")
before = count()
enrich({"page_title": "Technical SEO audit for ecommerce", "url": "", "proposals": "5", "job_id": ""} | {"url": "https://www.upwork.com/nx/jobs/search"})
check(count() == before and get(bot)["proposals"] == "5", "a page that carried no job id still matches by word overlap (the legacy bot behaviour)")

# 5. an exact id match always wins, whatever the titles
byid = add("Totally different title", "0266666666666666666")
enrich(PAGE("Google Ads Specialist for Roofing", "0266666666666666666"))
check(get(byid)["proposals"] == "10 to 15" and get(roof)["proposals"] is None, "an exact job-id match wins over any title")
byid2 = add("Id with tilde", "~0277777777777777777")
enrich(PAGE("whatever", "~0277777777777777777"))
check(get(byid2)["proposals"] == "10 to 15", "…with or without the ~ prefix")

# 6. only the id of the right job is ever backfilled
nid = add("Brand new retainer", None, source="room")
enrich(PAGE("Brand new retainer", "0288888888888888888"))
check(get(nid)["uid"] == "0288888888888888888", "a row with no id gets exactly the id of the page that matched it exactly")
check(src.count("_other_id(j)") == 2, "both matching passes in the shipped handler skip rows that carry a different id")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
