# -*- coding: utf-8 -*-
"""Metro F5 (METRO_TASK.md task F5, 26 Nov 2026): live-database safety, PageSpeed only for niche campaigns, the fit score without
a button, result lines that say only what happened. A SCRATCH database, SYNTHETIC people; no network, no model.

Pinned:
  1. the scratch launcher (tools/scratch_check.py) refuses the live database file (by path, by the -wal / -shm sibling, by a hard
     link), a file inside the repo, a missing file, an in-memory URL, no path at all, and the live ports; it accepts a copy outside
     the repo, and `make_live_copy` makes such a copy without touching the live file;
  2. an agency enrich run never measures PageSpeed (the fetcher is not even called); a niche run does;
  3. the agency fit score does not count a missing PageSpeed as missing data: a rule that reads it is left out of the agency's
     rules total, its coverage and its "not measured" list; a niche score still counts it;
  4. the fit score is worked out by itself: at the end of an enrich run (also a stopped one) and when a browser reading lands;
  5. result lines carry no zero counts (backend helper api/metro/lines.py).
Run: python tests/metro/test_metro_fix5.py
"""
import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from sqlalchemy import create_engine           # noqa: E402
from sqlalchemy.orm import Session             # noqa: E402

bad = 0


def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


# ═════════════ 1. the scratch launcher ═════════════
spec = importlib.util.spec_from_file_location("scratch_check", ROOT / "tools" / "scratch_check.py")
sk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sk)

work = Path(tempfile.mkdtemp(prefix="metro-f5-"))
fake_repo = work / "repo"
fake_repo.mkdir()
fake_live = fake_repo / "upwork_jobs.db"
c0 = sqlite3.connect(fake_live)
c0.execute("create table t (a)")
c0.execute("insert into t values (1)")
c0.commit()
c0.close()
outside = work / "elsewhere"
outside.mkdir()


def refused(path, **kw):
    try:
        sk.assert_scratch_db(path, root=fake_repo, live=fake_live, **kw)
        return None
    except sk.ScratchRefused as e:
        return str(e)


check(refused(str(fake_live)) is not None and "LIVE" in refused(str(fake_live)), "the live file is refused")
check(refused("sqlite:///" + fake_live.as_posix()) is not None, "a sqlite URL that names the live file is refused")
(wal := Path(str(fake_live) + "-wal")).write_bytes(b"x")
check(refused(str(wal)) is not None, "the live file's -wal sibling is refused")
check(refused(None) is not None and refused("") is not None and "COPY" in refused(""), "no path at all is refused, and the refusal says a copy is needed")
check(refused(str(outside / "nope.db")) is not None and "does not exist" in refused(str(outside / "nope.db")), "a missing file is refused (a scratch run never creates an empty database that looks fine)")
check(refused("sqlite:///:memory:") is not None and refused(":memory:") is not None, "an in-memory database is refused")
inside = fake_repo / "copy.db"
inside.write_bytes(fake_live.read_bytes())
check(refused(str(inside)) is not None and "inside the repo" in refused(str(inside)), "a copy INSIDE the repo folder is refused")
check(refused(str(outside)) is not None, "a folder is refused")
linked = outside / "linked.db"
try:
    os.link(fake_live, linked)
    check(refused(str(linked)) is not None and "LIVE" in refused(str(linked)), "a hard link to the live file is refused")
except OSError:
    print("SKIP  hard links are not available here")
good = outside / "copy.db"
good.write_bytes(fake_live.read_bytes())
ok_path = None
try:
    ok_path = sk.assert_scratch_db(str(good), root=fake_repo, live=fake_live)
except sk.ScratchRefused as e:
    print("   ", e)
check(ok_path is not None and ok_path.samefile(good), "a copy outside the repo is accepted")
check(refused(str(good)) is None and refused("sqlite:///" + good.as_posix()) is None, "the same copy is accepted as a path and as a sqlite URL")

cp = sk.make_live_copy(outside / "made", live=fake_live)
conn = sqlite3.connect(cp)
check(cp.is_file() and conn.execute("select a from t").fetchone() == (1,), "make_live_copy copies the data (SQLite backup API)")
conn.close()
check(refused(str(cp)) is None, "a copy made by make_live_copy passes the guard")
check(not sk._same_file(cp, fake_live), "and it is another file")

for bp, fp, word in ((8000, 5190, "8000"), (8001, 5180, "5180"), (8001, 8001, "different")):
    try:
        sk.check_ports(bp, fp)
        check(False, f"the port pair {bp}/{fp} is refused")
    except sk.ScratchRefused as e:
        check(word in str(e), f"the port pair {bp}/{fp} is refused ({e})")
check(sk.check_ports(sk.DEFAULT_BACKEND_PORT, sk.DEFAULT_FRONTEND_PORT) is None, "the default ports are the scratch ones (8001 / 5190)")

# the real launcher, as a process: nothing is started, the exit code says refused. The REAL live path is only named, never opened.
PY = sys.executable


def launch(*args):
    return subprocess.run([PY, str(ROOT / "tools" / "scratch_check.py"), *args], capture_output=True, text=True, cwd=str(work), timeout=60)


r = launch("--check-only", "--db", str(ROOT / "upwork_jobs.db"))
check(r.returncode == 2 and "REFUSED" in r.stderr and "LIVE" in r.stderr, f"the launcher refuses the repo's live database (exit {r.returncode})")
r = launch("--check-only", "--db", "upwork_jobs.db")
check(r.returncode == 2, "a bare 'upwork_jobs.db' is refused too (not found or the live one)")
r = launch("--check-only")
check(r.returncode == 2 and "COPY" in r.stderr, "no database given: refused")
r = launch("--check-only", "--db", str(good), "--backend-port", "8000")
check(r.returncode == 2 and "8000" in r.stderr, "the live backend port is refused")
r = launch("--check-only", "--db", str(good))
check(r.returncode == 0 and "guard passed" in r.stdout, f"a copy outside the repo passes the launcher's guard ({r.returncode})")
r = launch("--check-only", "--db", str(good), "--copy-live")
check(r.returncode == 2, "--db and --copy-live together are refused")
# THE ROOT CAUSE found while building this launcher: api/main.py runs load_dotenv(.env, override=True), and .env names the live
# database, so an environment variable alone never made a "scratch" backend scratch. Proven here in a fresh interpreter, WITHOUT
# importing the app (importing it runs the live startup prune): the real .env overrides a plain variable, and not a pinned one.
probe = r'''
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("sk", sys.argv[1]); sk = importlib.util.module_from_spec(spec); spec.loader.exec_module(sk)
import dotenv
url = "sqlite:///C:/scratch-probe/copy.db"
os.environ["DATABASE_URL"] = url
dotenv.load_dotenv(sk.ROOT / ".env", override=True)
plain = os.environ.get("DATABASE_URL") == url
os.environ["DATABASE_URL"] = url
sk._pin_database_url(url)
dotenv.load_dotenv(sk.ROOT / ".env", override=True)
print("PLAIN_KEPT" if plain else "PLAIN_OVERRIDDEN", "PINNED_KEPT" if os.environ.get("DATABASE_URL") == url else "PINNED_LOST", "APP_IMPORTED" if "api.main" in sys.modules else "APP_NOT_IMPORTED")
'''
pr = subprocess.run([PY, "-I", "-c", probe, str(ROOT / "tools" / "scratch_check.py")], capture_output=True, text=True, timeout=60)
if (ROOT / ".env").is_file() and "DATABASE_URL=" in (ROOT / ".env").read_text(encoding="utf-8", errors="replace"):
    check("PLAIN_OVERRIDDEN" in pr.stdout, f"HAZARD CONFIRMED: .env overrides a plain DATABASE_URL variable ({pr.stdout.strip()})")
    check("PINNED_KEPT" in pr.stdout and "APP_NOT_IMPORTED" in pr.stdout, "and the launcher's pin keeps the copy against the real .env, without importing the app")
else:
    print("SKIP  no .env with a DATABASE_URL here; the pin is tested against a stand-in below")
launcher = (ROOT / "tools" / "scratch_check.py").read_text(encoding="utf-8")
check(re.search(r"_pin_database_url\(url\)\s+import api\.main as main_mod", launcher) is not None, "the pin runs BEFORE the app is imported")
check("on_startup.clear()" in launcher and "FALCON_BACKEND_URL" in launcher and "_verify_after_import" in launcher,
      "the launcher drops the background loops, points the page's proxy at the scratch backend and re-checks the engines after the import")
vite = (ROOT / "frontend" / "vite.config.js").read_text(encoding="utf-8")
check("process.env.FALCON_BACKEND_URL || 'http://localhost:8000'" in vite and "Object.keys(PROXY_LIVE).map" in vite,
      "vite.config.js: every proxied route follows FALCON_BACKEND_URL, and falls back to the live backend")
plan = (ROOT / "METRO_PLAN.md").read_text(encoding="utf-8")
check("**Live database (added 26 Nov, F5" in plan and "tools/scratch_check.py" in plan and "Never import `api.main`" in plan, "METRO_PLAN.md carries the Hard rule")

# ═════════════ the app side, on a scratch database ═════════════
tmp = Path(tempfile.mkdtemp(prefix="metro-f5-db-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import campaigns as camp            # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import enrich as en                 # noqa: E402
from metro import gate, lines, progress, results as rs, scoring as sc   # noqa: E402

mdb.set_engine(eng)
mdb.init_db(eng)
NOSLEEP = lambda x: None                       # noqa: E731

HOME = ("<html><head><title>Acme</title><meta name=\"description\" content=\"Google Ads and SEO agency\"></head><body><h1>Acme</h1>"
        "<p>We run Google Ads (PPC) and SEO for clinics. White label partner programme.</p></body></html>")


def site_fetch(url):
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    return (200, url, HOME) if host.endswith(".example") else (0, url, "")


def mk(s, cid, name, domain):
    comp = mdb.MetroCompany(name=name, name_key=re.sub(r"[^a-z0-9]", "", name.lower()), domain=domain, domain_source="csv")
    s.add(comp)
    s.flush()
    lead = mdb.MetroLead(campaign_id=cid, company_id=comp.id, full_name=f"Owner of {name}", first_name="Owner", last_name=name,
                         title="Founder", company_name=name, location="Chicago, United States", status="new", persona_verdict="keep",
                         persona_score=70.0, profile_url=f"https://www.linkedin.com/in/owner-{comp.id}/", invite_status="none", raw_json="{}")
    s.add(lead)
    s.flush()
    return comp.id, lead.id


with Session(eng) as s:
    ag = camp.create(s, name="F5 agency", type="agency", region="US/CA", month=None, offer=None).id
    ni = camp.create(s, name="F5 niche", type="niche", region="US", month=None, offer=None).id
    ag_c, ag_l = mk(s, ag, "Alpha", "alpha.example")
    ni_c, ni_l = mk(s, ni, "Beta", "beta.example")
    s.commit()

# ═════════════ 2. PageSpeed only for niche ═════════════
asked_ps = []


def spy_ps(url):
    asked_ps.append(url)
    return 200, {"lighthouseResult": {"categories": {"performance": {"score": 0.42}}, "audits": {}, "finalUrl": url}}


with Session(eng) as s:
    out = en.enrich_company(s, s.get(mdb.MetroCompany, ag_c), fetch=site_fetch, get_json=spy_ps, campaign=s.get(mdb.MetroCampaign, ag), sleep=NOSLEEP, use_ai=False)
    ag_comp = s.get(mdb.MetroCompany, ag_c)
    check(asked_ps == [] and ag_comp.pagespeed_json is None and ag_comp.pagespeed_at is None, "an agency enrich never asks the PageSpeed API and stores no reading")
    check(not any("PageSpeed" in x for x in out["did"] + out["skipped"]), f"and the run's own log does not mention PageSpeed ({out['did']})")
    check(any("website scan" in x for x in out["did"]), "the website scan still ran for the agency company")
    out = en.enrich_company(s, s.get(mdb.MetroCompany, ni_c), fetch=site_fetch, get_json=spy_ps, campaign=s.get(mdb.MetroCampaign, ni), sleep=NOSLEEP, use_ai=False)
    ni_comp = s.get(mdb.MetroCompany, ni_c)
    check(len(asked_ps) == 1 and ni_comp.pagespeed_json and json.loads(ni_comp.pagespeed_json)["score"] == 42, "a niche enrich measures PageSpeed (once) and stores the score")
    check(en.pagespeed_wanted(s.get(mdb.MetroCampaign, ag)) is False and en.pagespeed_wanted(s.get(mdb.MetroCampaign, ni)) is True and en.pagespeed_wanted(None) is True,
          "pagespeed_wanted: agency no, niche yes, no campaign keeps the old behaviour")

# a whole run, as the button starts it: an agency run touches no PageSpeed even for fresh companies
with Session(eng) as s:
    c3, l3 = mk(s, ag, "Gamma", "gamma.example")
    s.commit()
asked_ps.clear()
en.start_run(ag, [l3], fetch=site_fetch, get_json=spy_ps, use_ai=False, background=False, sleep=NOSLEEP)
check(asked_ps == [], "an agency RUN (start_run) never asks the PageSpeed API")

# ═════════════ 3. the agency fit does not count a missing PageSpeed ═════════════
rules_with_ps = {"agency": [dict(r) for r in sc.DEFAULT_RULES["agency"]] +
                 [sc._r("ps_slow", 1, "Mobile PageSpeed below 50", "pagespeed.score", "lt", 50, 15), sc._r("ps_mid", 1, "Mobile PageSpeed 50-69", "pagespeed.score_mid", "true", None, 6)],
                 "niche": sc.DEFAULT_RULES["niche"]}
with Session(eng) as s:
    base_ag = sc.score_lead(s, s.get(mdb.MetroLead, ag_l), "agency", rules=sc.merge_rules(None))
    ps_ag = sc.score_lead(s, s.get(mdb.MetroLead, ag_l), "agency", rules=rules_with_ps)
    check(base_ag["fit"]["coverage"] == ps_ag["fit"]["coverage"] and base_ag["fit"]["rules"] == ps_ag["fit"]["rules"],
          f"agency: two PageSpeed rules added by hand change neither the rules total nor the measured share ({base_ag['fit']['rules']} rules, {ps_ag['fit']['coverage']:.0%})")
    check(not any("pagespeed" in u["path"] for u in ps_ag["fit"]["not_measured"]), "agency: PageSpeed is not listed under 'not measured'")
    no_site = mdb.MetroLead(campaign_id=ag, company_id=None, full_name="x", status="new", raw_json="{}")
    s.add(no_site)
    s.flush()
    # a niche company with no PageSpeed reading DOES count the rule as not measured (the niche side is unchanged)
    s.get(mdb.MetroCompany, ni_c).pagespeed_json = None
    ni_unscored = sc.score_lead(s, s.get(mdb.MetroLead, ni_l), "niche", rules=sc.merge_rules(None))
    check(any("pagespeed" in u["path"] for u in ni_unscored["fit"]["not_measured"]), "niche: a missing PageSpeed is still 'not measured'")
    s.rollback()
check(sc.SEGMENT_SKIPPED_ROOTS == {"agency": ("pagespeed",)}, "the segment rule is one named constant in scoring.py")

# ═════════════ 4. the fit score without a button ═════════════
with Session(eng) as s:
    for l in s.query(mdb.MetroLead).all():
        l.fit_score, l.deep_score, l.score_notes_json = None, None, None
    s.commit()
en.start_run(ag, [l3], fetch=site_fetch, get_json=spy_ps, use_ai=False, background=False, sleep=NOSLEEP)
with Session(eng) as s:
    l = s.get(mdb.MetroLead, l3)
    check(l.fit_score is not None and l.fit_score > 0, f"an enrich run ends by scoring the leads it touched (fit {l.fit_score})")
    check(json.loads(l.score_notes_json)["fit"]["at"], "the score is dated")
    other = s.get(mdb.MetroLead, ni_l)
    check(other.fit_score is None, "a lead the run did not touch is not scored by it")

# a stopped run scores what it did
with Session(eng) as s:
    c4, l4 = mk(s, ag, "Delta", "delta.example")
    c5, l5 = mk(s, ag, "Epsilon", "epsilon.example")
    s.commit()
calls = []


def stop_after_first(url):
    calls.append(url)
    en.stop()
    return site_fetch(url)


en.start_run(ag, [l4, l5], fetch=stop_after_first, get_json=spy_ps, use_ai=False, background=False, sleep=NOSLEEP)
with Session(eng) as s:
    s4, s5 = s.get(mdb.MetroLead, l4), s.get(mdb.MetroLead, l5)
    check(s4.fit_score is not None and s5.fit_score is None, "a stopped run scores the company it finished and not the one it never reached")
run_ = max((r for r in progress.snapshot()["runs"] if r["kind"] == "enrich"), key=lambda r: r["started_at"])
check(run_["status"] == "stopped" and "(stopped)" in run_["result"], f"and ends 'stopped' with one result line ({run_['result']})")

# a browser reading that lands scores at once
NOW = mdb.utcnow()
with Session(eng) as s:
    SID = gate.register_account(s, account_ref="linkedin.com/in/f5-account", label="F5").id
    s.get(mdb.MetroLead, ag_l).fit_score = None
    s.get(mdb.MetroCompany, ag_c).website_scan_json = json.dumps({"ok": True, "signals": {}, "marketing_terms": ["ppc"], "service_pages": 0})
    s.commit()


def lease(kind, target, company_id=None, lead_id=None):
    with Session(eng) as s:
        j = (gate.enqueue(s, kind, target, company_id=company_id, lead_id=lead_id, campaign_id=ag)
             or s.query(mdb.MetroScrapeJob).filter_by(kind=kind, target=target, status="queued").first())
        s.flush()
        j.status, j.sender_id, j.lease_until = "leased", SID, NOW + timedelta(minutes=5)
        s.commit()
        return j.id


def complete(jid, **kw):
    with Session(eng) as s:
        return rs.complete_job(s, jid, SID, **kw)


def lead_fit():
    with Session(eng) as s:
        l = s.get(mdb.MetroLead, ag_l)
        return l.fit_score, json.loads(l.score_notes_json or "{}")


check(lead_fit()[0] is None, "(setup) the lead has no fit score yet")
out = complete(lease("ads_transparency", "alpha.example", company_id=ag_c), result={"found": True, "running": True, "ads_count": 3})
fit, notes = lead_fit()
check(fit is not None and any(m["id"] == "runs_ads" for m in notes["fit"]["matched"]),
      f"an Ads Transparency reading scores the company's leads at once, and the new evidence counts (fit {fit})")
check(any("fit score updated" in n for n in out["notes"]), "the job's answer says the score was updated")
with Session(eng) as s:
    s.get(mdb.MetroLead, ag_l).fit_score = None
    s.commit()
complete(lease("gbp", "Alpha Chicago", company_id=ag_c), error="page did not load")
check(lead_fit()[0] is None, "a failed reading does not trigger scoring")
complete(lease("linkedin_profile", "https://www.linkedin.com/in/owner-1/", company_id=ag_c, lead_id=ag_l), result={"headline": "Founder"})
check(lead_fit()[0] is not None, "a LinkedIn profile reading scores the lead too")

# a scoring crash never fails a finished job, nor a finished run
orig = sc.score_companies


def boom(*a, **k):
    raise RuntimeError("rules are broken")


sc.score_companies = boom
out = complete(lease("ads_transparency", "alpha-two.example", company_id=ag_c), result={"found": False})
check(out["status"] == "done", "a scoring error does not fail the job (the reading is saved)")
with Session(eng) as s:
    c6, l6 = mk(s, ag, "Zeta", "zeta.example")
    s.commit()
en.start_run(ag, [l6], fetch=site_fetch, get_json=spy_ps, use_ai=False, background=False, sleep=NOSLEEP)
sc.score_companies = orig
run_ = max((r for r in progress.snapshot()["runs"] if r["kind"] == "enrich"), key=lambda r: r["started_at"])
check(run_["status"] == "done" and run_["result"].startswith("Enriched 1"), f"a scoring error does not turn a finished run into a failed one ({run_['status']}: {run_['result']})")

# the Rescore endpoint is still there, for after a rules change
from fastapi import FastAPI                     # noqa: E402
from fastapi.testclient import TestClient      # noqa: E402
from metro.router import router                # noqa: E402
app = FastAPI()
app.include_router(router)
cl = TestClient(app)
rr = cl.post(f"/metro/campaigns/{ag}/score", json={"lead_ids": [ag_l]})
check(rr.status_code == 200 and rr.json()["scored"] == 1, "the small Rescore still works on the leads it is given")

# ═════════════ 5. result lines: no zero counts ═════════════
check(lines.part(0, "lead") is None and lines.part(1, "lead") == "1 lead" and lines.part(3, "company", "companies") == "3 companies", "part: zero is dropped, singular and plural")
check(lines.line("Removed 2 leads", lines.part(0, "lead", tail="kept")) == "Removed 2 leads", "line: a zero part leaves nothing behind (no trailing dash)")
EL = lines.enrich_line
check(EL(done=20, total=20, found=0, had=20, missing=0) == "Enriched 20 - all 20 already had a website, nothing new found", "the task's own example 1")
check(EL(done=20, total=20, found=3, had=15, missing=2) == "Enriched 20 - 3 new websites found, 2 still missing", "the task's own example 2")
check(EL(done=5, total=50, found=0, had=0, missing=5, stopped=True) == "Enriched 5 of 50 (stopped) - nothing new found, 5 still missing", "a stopped run says so, once")
check(EL(done=4, total=4, found=1, had=2, missing=0, failed=1) == "Enriched 4 - 1 new website found, 1 failed", "a failure is said, a zero 'missing' is not")
check(EL(done=20, total=20, found=0, had=12, missing=0) == "Enriched 20 - 12 companies already had a website, nothing new found", "some already had a website (not all): the count is said")
check(EL(done=0, total=20, found=0, had=0, missing=0, stopped=True) == "Enrich stopped before any company was done", "stopped before the first company")
samples = [EL(done=n, total=n + k, found=f, had=h, missing=m, failed=fl, stopped=bool(k)) for n in (1, 3, 20) for k in (0, 5) for f in (0, 2) for h in (0, 4)
           for m in (0, 1) for fl in (0, 1)]
zero = [x for x in samples if re.search(r"(^|[ ,(])0 [a-z]", x)]
check(not zero, f"no enrich line out of {len(samples)} combinations prints a zero count ({zero[:2]})")
from metro import leads as leadsmod            # noqa: E402
el = leadsmod.enrichment_line({"domains_set": {"linkedhelper": 0, "email-domain": 0}, "domains_disagreeing": 0, "open_profiles": 0, "company_facts_filled": 0,
                               "company_pages": 0, "unmapped_columns": {}})
check(not re.search(r"(^|[ ,])0 ", el), f"the Linked Helper data line with nothing in it prints no zero ({el!r})")
el2 = leadsmod.enrichment_line({"domains_set": {"linkedhelper": 4, "email-domain": 0}, "domains_disagreeing": 0, "open_profiles": 2, "company_facts_filled": 0,
                                "company_pages": 170, "unmapped_columns": {"a": 1}})
check(el2 == "4 domains from Linked Helper, 2 open profiles, 170 company LinkedIn pages, 1 unmapped column", f"and one with data says just that ({el2!r})")

# a real run's lines on the progress registry: scoring, deep readings, hooks
check(re.fullmatch(r"Deep readings - 4 pages read", lines.line("Deep readings", lines.part(4, "page", tail="read") or "nothing could be read", lines.part(0, "failed", "failed"))), "deep readings line")

print(f"\n{'ALL PASSED' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
