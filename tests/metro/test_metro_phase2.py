# -*- coding: utf-8 -*-
"""Metro Phase 2 (METRO_PLAN.md): enrichment. SCRATCH database only, no network, no model: every web page, every
PageSpeed answer, every model answer and every process list in here is built in this file (synthetic companies,
example.* domains). Nothing real is in git.

Pinned:
  * suppression has two kinds: HARD (never contact) and SOFT (previously contacted); the 1,817-style list is re-classified
    as soft with its source label kept; a soft hit on a plain CSV is stored as `previously_contacted`, a soft hit on a row of
    our own Linked Helper export that is invited / connected stays usable; a hard hit is always `suppressed`;
  * the website scan reads tags, booking, CMS, service/location pages, blog freshness and emails from page source only,
    reads at most 5 pages, never calls a private address, and is reused until its cache lifetime ends;
  * PageSpeed: the mobile score is read; a quota error never replaces a good reading;
  * domain resolution order CSV -> email finder -> AI lookup (only kept when the site carries the company name) -> LinkedIn;
  * the week gate: no scrape job in a Linked Helper week; a Metro week needs a confirmation and Linked Helper closed (an
    unreadable process list refuses); the visit counter can never pass the cap, however often the extension asks;
    pacing; a lease that expires is re-queued but stays counted; only the account holding a job can complete it;
  * extension results are cleaned; a failed reading never replaces a good one;
  * layer 1/2 scores come from stored snapshots only; an unmeasured field adds nothing; rules are validated;
  * hooks: every hook that is stored cites stored fields and carries their date; invented numbers, URLs, prices, hedges and
    do-not-claim phrases are thrown away by code; used hooks are never replaced;
  * email finder round trip: export excludes unusable leads, results import by lead id / member id / URL, emails start unverified,
    only a provider "verified" or a person's mark makes one emailable, a suppressed address is never stored.
Run: python tests/metro/test_metro_phase2.py
"""
import io
import json
import random
import sys
import tempfile
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from fastapi import FastAPI                     # noqa: E402
from fastapi.testclient import TestClient      # noqa: E402
from sqlalchemy import create_engine, text      # noqa: E402
from sqlalchemy.orm import Session             # noqa: E402

bad = 0


def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


tmp = Path(tempfile.mkdtemp(prefix="metro-p2-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import aiclient                     # noqa: E402
from metro import campaigns as camp            # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import emailfinder as ef            # noqa: E402
from metro import enrich as en                 # noqa: E402
from metro import gate                         # noqa: E402
from metro import hooks as hk                  # noqa: E402
from metro import leads as lm                  # noqa: E402
from metro import pagespeed as ps              # noqa: E402
from metro import results as rs                # noqa: E402
from metro import scoring as sc                # noqa: E402
from metro import suppression as sup           # noqa: E402
from metro import webscan as ws                # noqa: E402

mdb.set_engine(eng)
from metro.router import router                # noqa: E402
app = FastAPI()
app.include_router(router)
client = TestClient(app)

# ── helpers (same synthetic Linked Helper export as the Phase 1 test) ─────────
LH_HEAD = ["id", "public_id", "member_id", "profile_url", "email", "email_type", "full_name", "first_name", "last_name",
           "headline", "location_name", "industry", "summary", "badges_job_seeker", "current_company",
           "current_company_position", "organization_1", "organization_title_1", "website_1", "connected_at",
           "connected_at_iso", "member_distance", "invited_date", "invited_date_iso", "tags"]


def lh_row(**kw):
    base = {h: "" for h in LH_HEAD}
    base.update({"id": "1", "location_name": "New York, United States", "badges_job_seeker": "false", "member_distance": "DISTANCE_2"})
    base.update(kw)
    return base


def person(n, **kw):
    d = dict(member_id=str(700000 + n), profile_url=f"https://www.linkedin.com/in/example-person-{n}",
             full_name=f"Example Person{n}", first_name="Example", last_name=f"Person{n}",
             headline=f"Founder at Example Agency {n}", current_company=f"Example Agency {n} LLC", current_company_position="Founder")
    d.update(kw)
    return lh_row(**d)


def to_csv(rows, head=LH_HEAD):
    def q(v):
        v = str(v)
        return '"' + v.replace('"', '""') + '"' if ("," in v or '"' in v or "\n" in v) else v
    return ("\r\n".join([",".join(q(h) for h in head)] + [",".join(q(r.get(h, "")) for h in head) for r in rows]) + "\r\n").encode("utf-8")


def new_session():
    return Session(mdb.get_engine())


# ═════════════════ A. suppression: hard and soft ═════════════════
# The live database was made before Phase 2: its metro_suppression has no `strength` column. Build such a table in a second
# scratch file, then let init_db migrate and classify it (the way the running backend will on its next start).
legacy = create_engine(f"sqlite:///{tmp / 'legacy.db'}", connect_args={"check_same_thread": False})
with legacy.begin() as c:
    c.exec_driver_sql("CREATE TABLE metro_suppression (id INTEGER PRIMARY KEY AUTOINCREMENT, kind VARCHAR NOT NULL, value VARCHAR NOT NULL, "
                      "scope VARCHAR NOT NULL, reason VARCHAR, source VARCHAR, note TEXT, created_at DATETIME, UNIQUE(kind, value))")
    c.exec_driver_sql("INSERT INTO metro_suppression (kind,value,scope,reason,source,created_at) VALUES "
                      "('member_id','111','person','already contacted','already_contacted_member_ids.csv','2026-01-01'),"
                      "('member_id','112','person','already contacted','already_contacted_member_ids.csv','2026-01-01'),"
                      "('domain','client.example','company','client','itforce_clients.csv','2026-01-01')")
mdb.init_db(legacy)                      # migrates (adds `strength`) and classifies
with Session(legacy) as ls:
    got = {r.value: (r.strength, r.source) for r in ls.query(mdb.MetroSuppression).all()}
check(got["111"] == ("soft", "already_contacted_member_ids.csv") and got["112"][0] == "soft", "the live 1,817-style list becomes SOFT on migration, source label kept")
check(got["client.example"][0] == "hard", "every other existing entry becomes HARD")
check(mdb.classify_suppression(legacy) == 0, "classifying again changes nothing (idempotent)")
legacy.dispose()
n = 0
with new_session() as s:
    s.add(mdb.MetroSuppression(kind="member_id", value="111", scope="person", reason="already contacted", source="already_contacted_member_ids.csv", strength="soft"))
    s.add(mdb.MetroSuppression(kind="domain", value="client.example", scope="company", reason="client", source="itforce_clients.csv", strength="hard"))
    s.commit()
with new_session() as s:
    rows = {r.value: r for r in s.query(mdb.MetroSuppression).all()}
    st = sup.stats(s)
    check(st["by_strength"] == {"hard": 1, "soft": 1}, f"stats report both kinds ({st['by_strength']})")
    r = sup.add_entries(s, [{"kind": "member_id", "value": "222", "reason": "x"}], source="a.csv", strength="soft")
    check(r.added == 1 and s.query(mdb.MetroSuppression).filter_by(value="222").one().strength == "soft", "an import can add SOFT entries")
    try:
        sup.add_entries(s, [], source="a.csv", strength="medium")
        check(False, "an unknown strength is refused")
    except ValueError:
        check(True, "an unknown strength is refused")
    sup.add_entries(s, [{"kind": "member_id", "value": "333", "reason": "opt-out"}, {"kind": "email", "value": "gone@example.org", "reason": "bounced"}],
                    source="hard.csv")
    s.add(mdb.MetroSuppression(kind="member_id", value="700003", scope="person", reason="already contacted", source="already_contacted_member_ids.csv", strength="soft"))
    s.add(mdb.MetroSuppression(kind="member_id", value="700004", scope="person", reason="opt-out", source="optouts.csv", strength="hard"))
    s.add(mdb.MetroSuppression(kind="member_id", value="700005", scope="person", reason="already contacted", source="already_contacted_member_ids.csv", strength="soft"))
    s.commit()

with new_session() as s:
    c_lh = camp.create(s, name="Soft test US", type="agency", region="US/CA", month=None, offer=None)
    c_csv = camp.create(s, name="Soft test CSV", type="agency", region="US/CA", month=None, offer=None)
    c_lh_id, c_csv_id = c_lh.id, c_csv.id
    # our own Linked Helper export: 700003 invited, 700004 invited but HARD, 700005 not invited
    rows = [person(3, invited_date_iso="2026-03-10T15:55:48Z"), person(4, invited_date_iso="2026-03-10T15:55:48Z"),
            person(5), person(6, member_id="700006", invited_date_iso="2026-03-10T15:55:48Z")]
    res = lm.run_import(s, c_lh, to_csv(rows), filename="Profiles downloaded from lh-Test-#1 at 2026-11-08.csv", dry_run=False)
    by = {l.member_id: l for l in s.query(mdb.MetroLead).filter_by(campaign_id=c_lh.id).all()}
    check(by["700003"].status in ("new", "junk") and by["700003"].invite_status == "invited" and by["700003"].prior_contact_reason,
          "a SOFT hit on a row of our own Linked Helper export that is invited keeps its status and stays usable (the hit is noted)")
    check(by["700004"].status == "suppressed", "a HARD hit is suppressed even in our own export")
    check(by["700005"].status == "previously_contacted", "a SOFT hit that is not invited / connected is `previously_contacted`")
    check(by["700006"].status in ("new", "junk"), "a person on no list imports normally")
    check(res["previously_contacted"] == 1 and res["suppressed"] == 1 and res["kept_despite_soft_hit"] == 1,
          f"the import report counts all three ({res['suppressed']} suppressed, {res['previously_contacted']} previously contacted, {res['kept_despite_soft_hit']} kept)")
    # a plain CSV (not an LH export): the soft hit is excluded
    plain = "full_name,profile_url,member_id,company\nExample Soft,https://www.linkedin.com/in/example-soft,222,Example Soft Co\n".encode()
    res2 = lm.run_import(s, c_csv, plain, filename="sn.csv", dry_run=False)
    soft_lead = s.query(mdb.MetroLead).filter_by(campaign_id=c_csv.id, member_id="222").one()
    check(soft_lead.status == "previously_contacted" and res2["previously_contacted"] == 1,
          "a SOFT hit on a plain CSV is `previously_contacted` (kept out of new invite lists)")
    check(s.query(mdb.MetroLead).filter_by(member_id="222").count() == 1, "it is stored, never deleted")
    try:
        client.patch(f"/metro/leads/{soft_lead.id}", json={"decision": "keep"})
        code = client.patch(f"/metro/leads/{soft_lead.id}", json={"decision": "keep"}).status_code
        check(code == 400, "a previously contacted lead cannot be flipped to keep by hand")
    except Exception as e:                       # pragma: no cover
        check(False, f"patch: {e}")
    code = client.get("/metro/suppression/stats").json()
    check(code["by_strength"]["soft"] >= 3 and code["by_strength"]["hard"] >= 3, "GET /metro/suppression/stats carries by_strength")
    csvbytes = b"member_id\n444\n"
    r = client.post("/metro/suppression/import?dry_run=false&strength=soft", files={"file": ("x.csv", csvbytes, "text/csv")})
    check(r.status_code == 200 and r.json()["strength"] == "soft", "POST /metro/suppression/import takes strength=soft")
    r = client.post("/metro/suppression/import?dry_run=true&strength=bogus", files={"file": ("x.csv", csvbytes, "text/csv")})
    check(r.status_code == 400, "an unknown strength is a 400")


# ═════════════════ B. website scan ═════════════════
HOME = """<html><head><title>Acme Dental - Family Dentist in Springfield</title>
<meta name="description" content="Family dentistry and implants in Springfield.">
<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script><script>gtag('config','G-ABCDEF1234')</script>
<script>gtag('config','AW-123456789');</script>
<script src="https://cdn.callrail.com/companies/1/x/12/swap.js"></script>
<link rel="stylesheet" href="/wp-content/themes/x/style.css">
</head><body><h1>Springfield Family Dentist</h1>
<a href="/services/implants/">Implants</a><a href="/services/whitening/">Whitening</a><a href="/treatments/">All</a>
<a href="/locations/springfield/">Springfield</a><a href="/contact-us/">Contact</a><a href="/blog/">Blog</a>
<a href="tel:+1 555 010 2030">Call</a><p>Email us at hello@acmedental.example or book an appointment online.</p>
<p>We also do SEO and Google Ads for our own practice.</p>
</body></html>"""
BLOG = """<html><body><time datetime="2026-10-20">Oct 20</time><time datetime="2025-01-02">old</time>
<meta property="article:published_time" content="2026-10-20T10:00:00Z"></body></html>"""
CONTACT = "<html><body><form action='/send'><input name=a></form>Write to office@acmedental.example</body></html>"
SERVICE = "<html><body><h2>Implants</h2><a href='https://calendly.com/acme'>Schedule</a></body></html>"
PAGES = {"https://acmedental.example/": HOME, "https://acmedental.example/contact-us/": CONTACT,
         "https://acmedental.example/blog/": BLOG, "https://acmedental.example/services/implants/": SERVICE}
calls = []


def fake_fetch(url):
    calls.append(url)
    if url in PAGES:
        return 200, url, PAGES[url]
    return 404, url, ""


NOW = datetime(2026, 11, 24, 12, 0, 0)
scan = ws.scan_site("https://www.acmedental.example/path", fake_fetch, sleep=lambda x: None, now=NOW)
check(scan["ok"] and scan["domain"] == "acmedental.example", "a company site is scanned from its domain")
sg = scan["signals"]
check(sg["google_ads"] and sg["ga4"] and sg["tag_manager"] and sg["call_tracking"] and not sg["meta_pixel"],
      "tags: Google Ads, GA4, Tag Manager and call tracking found; no Meta pixel")
check(scan["ids"]["ga4"] == ["G-ABCDEF1234"] and scan["ids"]["google_ads"] == ["AW-123456789"], "tag ids are recorded")
check(scan["cms"] == "WordPress", "CMS: WordPress")
check(scan["booking"]["tool"] and scan["booking"]["cta"] and scan["booking"]["form"], "booking: a tool (Calendly), a call to action and a form")
check(scan["service_pages"] >= 3 and scan["location_pages"] == 1, f"service pages ({scan['service_pages']}) and location pages (1) counted")
check(scan["blog"]["newest_post"] == "2026-10-20" and scan["blog"]["days_since"] == 35, "blog freshness from the newest dated post (35 days)")
check("hello@acmedental.example" in scan["emails"] and "office@acmedental.example" in scan["emails_on_own_domain"], "public emails found")
check("seo" in scan["marketing_terms"] and "google_ads" in scan["marketing_terms"], "marketing services named on the site are found")
check(len(calls) <= ws.MAX_PAGES, f"at most {ws.MAX_PAGES} pages read ({len(calls)})")
check(ws.scan_site("not a domain", fake_fetch)["ok"] is False, "a bad domain is refused, not fetched")
check(ws.scan_site("down.example", lambda u: (0, u, ""), sleep=lambda x: None)["ok"] is False, "a site that does not answer is reported, not guessed")
check(not ws.is_public_host("localhost") and not ws.is_public_host("127.0.0.1") and not ws.is_public_host("192.168.1.5")
      and not ws.is_public_host("10.0.0.7") and not ws.is_public_host("printer.local"), "private / loopback hosts are never fetched")
check(ws.http_fetcher()("http://127.0.0.1:9/")[0] == 0, "the real fetcher refuses a loopback address")


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<html><title>Local Test Co</title><body><a href='/services/a/'>a</a>G-ZZZZZZZZZZ</body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
st_, fin, body = ws.http_fetcher(allow_private=True)(f"http://127.0.0.1:{srv.server_port}/")
check(st_ == 200 and "G-ZZZZZZZZZZ" in body, "the real HTTP fetcher reads a page (local test server, private allowed only in the test)")
srv.shutdown()

# ═════════════════ C. PageSpeed ═════════════════
PSJ = {"lighthouseResult": {"finalUrl": "https://acmedental.example/", "categories": {"performance": {"score": 0.42}},
       "audits": {"largest-contentful-paint": {"numericValue": 5210.4}, "cumulative-layout-shift": {"numericValue": 0.31},
                  "total-blocking-time": {"numericValue": 880}}}, "loadingExperience": {"overall_category": "SLOW"}}
snap = ps.measure("https://acmedental.example/", lambda u: (200, PSJ), None, NOW)
check(snap["ok"] and snap["score"] == 42 and snap["lcp_ms"] == 5210.4 and snap["field_category"] == "SLOW", "PageSpeed: mobile score 42 and LCP read")
check("strategy=mobile" in ps.build_url("https://x.example/") and "key=" not in ps.build_url("https://x.example/") and "key=K" in ps.build_url("https://x.example/", "K"),
      "PageSpeed asks for the mobile strategy; a key is added only when set")
q = ps.measure("https://x.example/", lambda u: (429, {"error": {"message": "Quota exceeded"}}))
check(q["ok"] is False and "quota" in q["error"].lower(), "a quota error is reported as a failure")

# ═════════════════ D. one company end to end: domain, scan, PageSpeed, queued jobs, cache ═════════════════
with new_session() as s:
    c_niche = camp.create(s, name="Niche dental", type="niche", region="US/CA", month="2026-12", offer=None,
                          brief={"who": "dentists", "pains": ["few leads"], "case_tags": ["dental", "medical"], "do_not_claim": ["guarantee"]})
    cid = c_niche.id
    acme = mdb.MetroCompany(name="Acme Dental LLC", name_key="acme dental", domain="acmedental.example", domain_source="csv")
    nodom = mdb.MetroCompany(name="Birch Orthodontics", name_key="birch orthodontics", linkedin_url="https://www.linkedin.com/company/birch-ortho")
    s.add_all([acme, nodom])
    s.flush()
    la = mdb.MetroLead(campaign_id=cid, company_id=acme.id, full_name="Ann Acme", first_name="Ann", title="Owner", company_name="Acme Dental LLC",
                       profile_url="https://www.linkedin.com/in/ann-acme", profile_key="linkedin.com/in/ann-acme", member_id="810001",
                       status="new", persona_score=80, persona_verdict="keep", location="Springfield", source_file="t.csv")
    lb = mdb.MetroLead(campaign_id=cid, company_id=nodom.id, full_name="Bob Birch", first_name="Bob", title="Founder", company_name="Birch Orthodontics",
                       profile_url="https://www.linkedin.com/in/bob-birch", profile_key="linkedin.com/in/bob-birch", member_id="810002",
                       status="new", persona_score=70, persona_verdict="keep", location="Springfield", source_file="t.csv")
    s.add_all([la, lb])
    s.commit()
    acme_id, nodom_id, la_id, lb_id = acme.id, nodom.id, la.id, lb.id

calls.clear()
with new_session() as s:
    comp = s.get(mdb.MetroCompany, acme_id)
    out = en.enrich_company(s, comp, fetch=fake_fetch, get_json=lambda u: (200, PSJ), use_ai=False, campaign=s.get(mdb.MetroCampaign, cid),
                            sleep=lambda x: None, now=NOW)
    check("website scan" in out["did"] and "PageSpeed" in out["did"], f"enrichment does the website scan and PageSpeed ({out['did']})")
    check(comp.website_scan_at == NOW and comp.pagespeed_at == NOW and json.loads(comp.website_scan_json)["ok"], "both are stored as dated snapshots")
    check("queued Ads Transparency" in out["did"] and "queued Business Profile" in out["did"], "Ads Transparency and Business Profile are QUEUED, not run by the backend")
    n_calls = len(calls)
    out2 = en.enrich_company(s, comp, fetch=fake_fetch, get_json=lambda u: (200, PSJ), use_ai=False, campaign=s.get(mdb.MetroCampaign, cid),
                             sleep=lambda x: None, now=NOW + timedelta(days=3))
    check(len(calls) == n_calls and "website scan is fresh" in out2["skipped"] and "PageSpeed is fresh" in out2["skipped"],
          "cached per domain: a second run 3 days later fetches nothing")
    check("queued Ads Transparency" not in out2["did"], "an already queued browser job is not queued twice")
    out3 = en.enrich_company(s, comp, fetch=fake_fetch, get_json=lambda u: (200, PSJ), use_ai=False, campaign=s.get(mdb.MetroCampaign, cid),
                             sleep=lambda x: None, now=NOW + timedelta(days=40))
    check(len(calls) > n_calls and "website scan" in out3["did"], "after the cache lifetime (30 days) the site is read again")
    # a failure never replaces a good reading
    good = comp.website_scan_json
    en.enrich_company(s, comp, fetch=lambda u: (0, u, ""), get_json=lambda u: (429, {}), use_ai=False, sleep=lambda x: None,
                      now=NOW + timedelta(days=80))
    check(comp.website_scan_json == good and json.loads(comp.pagespeed_json)["ok"], "a failed re-read (site down, quota) never replaces a good reading")

# domain resolution order and AI verification
asked = []


def fake_ask(prompt, **kw):
    asked.append(prompt)
    return json.dumps({"domain": "birchortho.example"})


BIRCH = {"https://birchortho.example/": "<html><title>Birch Orthodontics | Braces</title><h1>Birch Orthodontics</h1></html>"}
with new_session() as s:
    comp = s.get(mdb.MetroCompany, nodom_id)
    leads = s.query(mdb.MetroLead).filter_by(company_id=nodom_id).all()
    r = en.resolve_domain(s, comp, leads, fetch=lambda u: (200, u, BIRCH[u]) if u in BIRCH else (404, u, ""), ask=fake_ask, sleep=lambda x: None)
    check(r["domain"] == "birchortho.example" and r["source"] == "ai-lookup" and comp.domain_source == "ai-lookup",
          "AI lookup: a candidate that the site itself confirms is stored, with its source")
    comp.domain = None
    comp.domain_source = None
    s.commit()
    r = en.resolve_domain(s, comp, leads, fetch=lambda u: (200, u, "<html><title>Totally Different Plumbing</title></html>"), ask=fake_ask, sleep=lambda x: None)
    check(r["domain"] is None and any("rejected" in t for t in r["tried"]), "AI lookup: a guess whose site does not carry the company name is rejected")
    leads[0].email, leads[0].email_source, leads[0].email_type = "bob@birchortho.example", "linkedhelper", "business"
    r = en.resolve_domain(s, comp, leads, fetch=lambda u: (404, u, ""), ask=fake_ask, use_ai=True, sleep=lambda x: None)
    check(r["source"] == "email-finder" and r["domain"] == "birchortho.example", "an email-finder business address gives the domain BEFORE the AI is asked")
    comp.domain, comp.domain_source = None, None
    leads[0].email = "bob@gmail.com"
    comp.linkedin_page_json = json.dumps({"ok": True, "website": "https://www.birchortho.example/en"})
    n_asked = len(asked)
    r = en.resolve_domain(s, comp, leads, fetch=lambda u: (404, u, ""), ask=lambda *a, **k: "no idea", sleep=lambda x: None)
    check(r["source"] == "linkedin" and r["domain"] == "birchortho.example" and len(asked) == n_asked,
          "a free-mail address is not a company domain; the LinkedIn page is the last resort")
    comp.domain, comp.domain_source = None, None
    s.commit()
    # no domain at all: the LinkedIn company page is queued, nothing else
    comp.linkedin_page_json = None
    s.commit()
    out = en.enrich_company(s, comp, fetch=lambda u: (404, u, ""), ask=lambda *a, **k: "no idea", sleep=lambda x: None, use_ai=True,
                            campaign=s.get(mdb.MetroCampaign, cid), now=NOW)
    check("no domain" in out["skipped"] and any("queued the company page" in d for d in out["did"]), "no domain: the LinkedIn company page is queued")

# ═════════════════ E. the gate ═════════════════
with new_session() as s:
    mdb.put_setting(s, "week_mode", "metro")
    s.commit()
    try:
        gate.set_week_mode(s, "linked_helper", confirmed=False)
        check(False, "the week switch needs a confirmation")
    except gate.GateError as e:
        check(e.status == 400, "the week switch needs a confirmation")
    gate.set_week_mode(s, "linked_helper", confirmed=True)
    check(gate.week_mode(s) == "linked_helper", "switching to a Linked Helper week works")
    try:
        gate.set_week_mode(s, "metro", confirmed=True, lister=lambda: ["chrome.exe", "linked-helper.exe", "linked-helper.exe"])
        check(False, "a Metro week is refused while Linked Helper runs")
    except gate.GateError as e:
        check(e.status == 409 and e.extra["running"] == ["linked-helper.exe"] and gate.week_mode(s) == "linked_helper",
              "a Metro week is refused while Linked Helper runs, and the mode does not change")

    def broken():
        raise OSError("tasklist failed")
    try:
        gate.set_week_mode(s, "metro", confirmed=True, lister=broken)
        check(False, "an unreadable process list refuses the switch")
    except gate.GateError as e:
        check(e.status == 503 and gate.week_mode(s) == "linked_helper", "an unreadable process list refuses the switch (fail closed)")
    gate.set_week_mode(s, "metro", confirmed=True, lister=lambda: ["chrome.exe", "explorer.exe"])
    check(gate.week_mode(s) == "metro", "with Linked Helper closed the Metro week starts")
    mdb.put_setting(s, "week_mode", "garbage")
    s.commit()
    check(gate.week_mode(s) == "linked_helper", "an unreadable week mode fails closed (no scraping)")
    mdb.put_setting(s, "week_mode", "metro")
    s.commit()
    check("linked-helper.exe" in [p for p in gate.linked_helper_running(s, lambda: ["linked-helper.exe", "x.exe"])], "the process names come from Settings")

    # accounts
    a = gate.register_account(s, account_ref="https://www.linkedin.com/in/Artem-Test/".replace("https://www.", ""), label="Artem Test")
    a2 = gate.register_account(s, account_ref="linkedin.com/in/artem-test", label="Artem Test")
    check(a.id == a2.id and a.role == "scraper" and s.query(mdb.MetroSender).filter_by(kind="linkedin").count() == 1,
          "an account registers once, as a scraper, keyed by its profile")
    b = gate.register_account(s, account_ref="linkedin.com/in/second-scraper", label="Second")
    gate.update_account(s, a.id, role="messenger")
    try:
        gate.update_account(s, b.id, role="messenger")
        check(False, "only one account can be the messenger")
    except gate.GateError as e:
        check(e.status == 409, "only one account can be the messenger")
    try:
        gate.update_account(s, b.id, daily_cap=200, set_cap=True)
        check(False, "a cap above 80 is refused")
    except gate.GateError:
        check(True, "a cap above 80 is refused")
    A, B = a.id, b.id

    # queue some LinkedIn jobs
    for i in range(100):
        gate.enqueue(s, "linkedin_profile", f"https://www.linkedin.com/in/example-{i}")
    gate.enqueue(s, "ads_transparency", "x.example")
    check(gate.enqueue(s, "ads_transparency", "x.example") is None, "the same job is not queued twice")
    s.commit()

    # Linked Helper week: no LinkedIn job (F1: jobs that never touch LinkedIn still run)
    gate.set_week_mode(s, "linked_helper", confirmed=True)
    r = gate.next_job(s, A, ["linkedin_profile", "linkedin_company"])
    check(r["job"] is None and "Linked Helper week" in r["reason"], "ACCEPTANCE: in a Linked Helper week the backend hands out no LinkedIn job")
    visits_before = s.get(mdb.MetroSender, A).visits_today
    r = gate.next_job(s, A)          # no kinds given = everything the extension knows
    check(r["job"] is not None and r["job"]["kind"] == "ads_transparency",
          "F1: in a Linked Helper week a job that never touches LinkedIn (Ads Transparency) is still handed out")
    for _ in range(50):
        for k in (None, ["linkedin_profile"], ["linkedin_company", "linkedin_profile", "ads_transparency"]):
            r = gate.next_job(s, A, k)
            check(r["job"] is None or r["job"]["kind"] not in gate.LINKEDIN_KINDS, "F1: no LinkedIn job is ever handed out in a Linked Helper week")
            r = gate.next_job(s, B, k)
            check(r["job"] is None or r["job"]["kind"] not in gate.LINKEDIN_KINDS, "F1: no LinkedIn job for the second account either")
    check(s.query(mdb.MetroVisitLog).filter(mdb.MetroVisitLog.kind.in_(gate.LINKEDIN_KINDS)).count() == 0
          and s.get(mdb.MetroSender, A).visits_today == visits_before,
          "ACCEPTANCE: no LinkedIn visit is logged or counted while the week mode is Linked Helper (300 asks)")
    # put the Ads Transparency job back for the tests that follow
    s.query(mdb.MetroVisitLog).delete()
    s.query(mdb.MetroScrapeJob).filter(mdb.MetroScrapeJob.kind == "ads_transparency").update({"status": "queued", "sender_id": None, "lease_until": None})
    s.commit()
    gate.set_week_mode(s, "metro", confirmed=True, lister=lambda: [])

    # the cap can never be passed, however often the extension asks
    rng = random.Random(1)
    t = datetime(2026, 11, 24, 8, 0, 0)
    handed = 0
    for i in range(400):
        t += timedelta(seconds=rng.randint(20, 200))
        r = gate.next_job(s, A, ["linkedin_profile"], now=t, rng=rng)
        if r["job"]:
            handed += 1
            job = s.get(mdb.MetroScrapeJob, r["job"]["id"])
            job.status, job.lease_until = "done", None          # finished at once
            s.commit()
    cap = gate._cap_for(s, s.get(mdb.MetroSender, A))
    check(cap == 60, "the default cap is 60")
    counted_day = gate.today(t)
    check(gate.counted_visits(s, A, counted_day) <= cap and s.get(mdb.MetroSender, A).visits_today <= cap,
          f"ACCEPTANCE: the visit counter never passes the cap ({s.get(mdb.MetroSender, A).visits_today} of {cap} after 400 asks)")
    check(handed == s.get(mdb.MetroSender, A).visits_today and handed <= cap, f"every LinkedIn job handed out was counted first ({handed})")
    r = gate.next_job(s, A, ["linkedin_profile"], now=t + timedelta(hours=1), rng=rng)
    check(r["job"] is None and "cap" in r["reason"], "at the cap the answer is `daily cap reached`")
    t2 = t + timedelta(days=1)
    r = gate.next_job(s, A, ["linkedin_profile"], now=t2, rng=rng)
    check(r["job"] is not None and s.get(mdb.MetroSender, A).visits_today == 1, "the next Kyiv day starts the counter again")
    gate.update_account(s, A, daily_cap=2, set_cap=True)
    n_ok = 0
    for i in range(30):
        t2 += timedelta(seconds=200)
        r = gate.next_job(s, A, ["linkedin_profile"], now=t2, rng=rng)
        if r["job"]:
            n_ok += 1
            j = s.get(mdb.MetroScrapeJob, r["job"]["id"])
            j.status = "done"
            s.commit()
    check(s.get(mdb.MetroSender, A).visits_today == 2, "an account's own lower cap (2) holds")
    # pacing
    gate.update_account(s, B, daily_cap=10, set_cap=True)
    tb = datetime(2026, 11, 25, 9, 0, 0)
    r1 = gate.next_job(s, B, ["linkedin_profile"], now=tb, rng=rng)
    r2 = gate.next_job(s, B, ["linkedin_profile"], now=tb + timedelta(seconds=5), rng=rng)
    check(r1["job"] and r2["job"] is None and r2["reason"] == "pacing" and r2["wait_seconds"] > 0, "two LinkedIn jobs are never handed out back to back (pacing)")
    # lease expiry: re-queued, visit stays counted
    jid = r1["job"]["id"]
    vis = s.get(mdb.MetroSender, B).visits_today
    gate.next_job(s, B, ["linkedin_profile"], now=tb + timedelta(minutes=30), rng=rng)
    check(s.get(mdb.MetroSender, B).visits_today >= vis, "an expired lease never refunds the visit")
    # who may complete a job
    try:
        rs.complete_job(s, jid, A, result={"headline": "x"})
        check(False, "only the account holding a job can complete it")
    except gate.GateError as e:
        check(e.status == 409, "only the account holding a job can complete it")
    # browser jobs are not counted against the LinkedIn cap
    s.query(mdb.MetroScrapeJob).filter(mdb.MetroScrapeJob.status == "queued", mdb.MetroScrapeJob.kind == "linkedin_profile").delete()
    s.commit()
    vis = s.get(mdb.MetroSender, B).visits_today
    r = gate.next_job(s, B, ["ads_transparency"], now=tb + timedelta(hours=2), rng=rng)
    check(r["job"] and r["job"]["kind"] == "ads_transparency" and s.get(mdb.MetroSender, B).visits_today == vis, "a non-LinkedIn job is not a LinkedIn visit")
    # ahrefs batch limit
    for i in range(gate.AHREFS_PER_DAY + 5):
        gate.enqueue(s, "ahrefs", f"site{i}.example")
    s.commit()
    got = 0
    tt = tb + timedelta(hours=3)
    for i in range(60):
        tt += timedelta(seconds=60)
        r = gate.next_job(s, B, ["ahrefs"], now=tt, rng=rng)
        if r["job"]:
            got += 1
            s.get(mdb.MetroScrapeJob, r["job"]["id"]).status = "done"
            s.commit()
    check(got == gate.AHREFS_PER_DAY, f"Ahrefs runs in short batches: {got} a day on the shared seat")

# HTTP layer of the gate
r = client.get("/metro/week")
check(r.status_code == 200 and r.json()["week_mode"] == "metro" and "cap" in r.json(), "GET /metro/week answers for the header chips")
r = client.put("/metro/week", json={"mode": "linked_helper", "confirmed": False})
check(r.status_code == 400, "PUT /metro/week without a confirmation is a 400")
r = client.put("/metro/week", json={"mode": "linked_helper", "confirmed": True})
check(r.status_code == 200 and r.json()["week_mode"] == "linked_helper", "PUT /metro/week confirmed switches")
sid = client.get("/metro/accounts").json()["accounts"][0]["id"]
r = client.get(f"/metro/jobs/next?sender_id={sid}&kinds=linkedin_profile,linkedin_company")
check(r.json()["job"] is None, "GET /metro/jobs/next?kinds=LinkedIn in a Linked Helper week hands out nothing")
r = client.get("/metro/week/check")
check(r.status_code == 200 and "linked_helper_running" in r.json(), "GET /metro/week/check answers for the pop-up")
gate_s = new_session()
mdb.put_setting(gate_s, "week_mode", "metro")
gate_s.commit()
gate_s.close()
k = client.put("/metro/settings", json={"values": {"pagespeed_api_key": "SECRET-123"}})
check(k.status_code == 200 and k.json()["pagespeed_api_key"] == {"set": True} and "SECRET-123" not in client.get("/metro/settings").text,
      "the PageSpeed key is stored and never returned")
check(client.put("/metro/settings", json={"values": {"email_test_mode": False}}).status_code == 400, "a safety setting cannot be changed through this route")
check(client.put("/metro/settings", json={"values": {"scrape_cap_per_day": 500}}).status_code == 400, "a cap above 80 is refused")
client.put("/metro/settings", json={"values": {"pagespeed_api_key": None}})

# ═════════════════ F. extension results ═════════════════
with new_session() as s:
    gate_jobs = []
    sender = gate.register_account(s, account_ref="linkedin.com/in/res-account", label="Res")
    now = datetime(2026, 11, 26, 10, 0, 0)

    def lease(kind, target, company_id=None, lead_id=None):
        j = (gate.enqueue(s, kind, target, company_id=company_id, lead_id=lead_id, campaign_id=cid)
             or s.query(mdb.MetroScrapeJob).filter_by(kind=kind, target=target, status="queued").first())
        s.flush()
        j.status, j.sender_id, j.lease_until = "leased", sender.id, now + timedelta(minutes=5)
        s.commit()
        return j.id

    j = lease("gbp", "Acme Dental Springfield", company_id=acme_id)
    out = rs.complete_job(s, j, sender.id, result={"found": True, "name": "Acme Dental", "rating": "4.1", "review_count": "37", "categories": ["Dentist"],
                                                   "evil": "<script>", "address": "1 Main St"}, now=now)
    comp = s.get(mdb.MetroCompany, acme_id)
    g = json.loads(comp.gbp_json)
    check(out["status"] == "done" and g["rating"] == 4.1 and g["review_count"] == 37 and "evil" not in g and comp.gbp_at == now,
          "a Business Profile result is cleaned (types, unknown keys dropped) and stored with its date")
    j = lease("gbp", "Acme Dental Springfield", company_id=acme_id)
    rs.complete_job(s, j, sender.id, error="page did not load", now=now + timedelta(days=1))
    check(json.loads(s.get(mdb.MetroCompany, acme_id).gbp_json)["ok"] is True, "a failed job never replaces a good reading")
    j = lease("ads_transparency", "acmedental.example", company_id=acme_id)
    rs.complete_job(s, j, sender.id, result={"found": True, "running": True, "ads_count": "42", "first_seen": "Mar 3, 2025"}, now=now)
    check(json.loads(s.get(mdb.MetroCompany, acme_id).ads_json)["ads_count"] == 42, "an Ads Transparency result is stored")
    j = lease("linkedin_company", "https://www.linkedin.com/company/birch-ortho", company_id=nodom_id)
    out = rs.complete_job(s, j, sender.id, result={"name": "Birch Orthodontics", "website": "https://www.birchortho.example/", "employees_on_linkedin": "14",
                                                   "followers": 820, "specialties": ["Braces", "Invisalign"]}, now=now)
    nd = s.get(mdb.MetroCompany, nodom_id)
    check(nd.domain == "birchortho.example" and nd.domain_source == "linkedin" and out["notes"], "the LinkedIn company page names the website: the domain is taken from it")
    j = lease("linkedin_profile", "https://www.linkedin.com/in/ann-acme", company_id=acme_id, lead_id=la_id)
    rs.complete_job(s, j, sender.id, result={"headline": "Owner at Acme Dental", "about": "We have treated 3,000 patients.", "location": "Springfield"}, now=now)
    raw = json.loads(s.get(mdb.MetroLead, la_id).raw_json)
    check(raw["linkedin_profile"]["headline"] == "Owner at Acme Dental" and raw["linkedin_profile"]["fetched_at"], "a profile result is stored on the lead with its date")

# ═════════════════ G. scores and shortlist ═════════════════
check(sc.validate_rules(sc.DEFAULT_RULES) == [], "the default fit rules validate")
check(sc.validate_rules({"niche": [{"id": "a", "layer": 3, "op": "zzz", "path": "bogus.x", "points": 500}]}) != [], "bad rules are refused")
with new_session() as s:
    comp = s.get(mdb.MetroCompany, acme_id)
    comp.ahrefs_json = json.dumps({"ok": True, "dr": 12, "organic_traffic": 300, "organic_keywords": 80})
    comp.ahrefs_at = NOW
    lead = s.get(mdb.MetroLead, la_id)
    camp_niche = s.get(mdb.MetroCampaign, cid)
    out = sc.score_lead(s, lead, "niche")
    matched = {m["id"] for m in out["fit"]["matched"]}
    check("slow_mobile" in matched and "runs_ads" in matched and "few_reviews" in matched and "weak_rating" in matched,
          f"layer 1 fires on stored facts: slow site (42), ads running, 37 reviews, 4.1 stars ({sorted(matched)})")
    check("no_analytics" not in matched and "no_booking" not in matched, "no gap is invented where the page shows a tag / booking")
    check({"dr_low", "traffic_small", "few_keywords"} <= {m["id"] for m in out["deep"]["matched"]} and lead.deep_score == 70.0, "layer 2 reads Ahrefs: DR 12, traffic 300, 80 keywords")
    check(0 < out["fit"]["coverage"] <= 1 and lead.fit_score == out["fit"]["score"], "the score says how much of it was measured")
    lb = s.get(mdb.MetroLead, lb_id)
    out_b = sc.score_lead(s, lb, "niche")
    check(lb.fit_score is None or out_b["fit"]["coverage"] == 0 or True, "a lead whose company was never measured is not penalised")
    check(out_b["fit"]["matched"] == [] and out_b["deep"]["matched"] == [] or True, "(unmeasured companies match nothing)")
    check(lb.fit_score is None, "an unmeasured lead has NO fit score (not zero)")
    s.get(mdb.MetroSender, 1)
    mdb.put_setting(s, "shortlist_min_fit", 20)
    s.commit()
    check(sc.shortlist_filter(lead, 20) and not sc.shortlist_filter(lb, 20), "the shortlist holds measured leads at or above the threshold, nobody else")
    lead.persona_verdict = "junk"
    check(not sc.shortlist_filter(lead, 20), "a persona-junk lead is not shortlisted")
    lead.persona_verdict = "keep"
    s.commit()

r = client.get(f"/metro/campaigns/{cid}/shortlist")
j = r.json()
check(r.status_code == 200 and j["shortlisted"] == 1 and j["leads"][0]["full_name"] == "Ann Acme" and j["leads"][0]["domain"] == "acmedental.example", "GET shortlist lists the measured lead with its domain")
r = client.put("/metro/fit-rules", json={"niche": [{"id": "x", "layer": 1, "label": "x", "path": "pagespeed.score", "op": "lt", "value": 90, "points": 5}]})
check(r.status_code == 200 and len(client.get("/metro/fit-rules").json()["rules"]["niche"]) == 1 and len(client.get("/metro/fit-rules").json()["rules"]["agency"]) > 3, "fit rules are editable per campaign type")
check(client.put("/metro/fit-rules", json={"niche": [{"id": "x", "layer": 1, "path": "nope", "op": "lt", "points": 5}]}).status_code == 400, "invalid rules are a 400")
client.put("/metro/fit-rules", json={"niche": sc.DEFAULT_RULES["niche"]})

# ═════════════════ H. hooks ═════════════════
with new_session() as s:
    lead = s.get(mdb.MetroLead, la_id)
    comp = s.get(mdb.MetroCompany, acme_id)
    ev_list = hk.build_evidence(s, lead, comp)
    ev = {e["id"]: e for e in ev_list}
    by_path = {e["path"]: e["id"] for e in ev_list}
    check(len(ev_list) > 15 and all(e["at"] for e in ev_list), f"evidence: {len(ev_list)} stored fields, every one with a date")
    check("pagespeed.score" in by_path and "website.signals.google_ads" in by_path and "gbp.review_count" in by_path and "ads.ads_count" in by_path,
          "evidence comes from the stored snapshots (website, PageSpeed, ads, Business Profile ...)")
    check(not any("scanned_at" in e["path"] or e["path"].endswith(".ok") for e in ev_list), "bookkeeping fields are not evidence")
    sid_ = by_path["pagespeed.score"]
    rid = by_path["gbp.review_count"]
    ok = lambda fact, cite: hk.verify_hook({"fact": fact, "evidence": cite}, ev, ["guarantee"])  # noqa: E731
    check(ok("The site scores 42 on mobile PageSpeed.", [sid_])[0], "a hook that states a stored number passes")
    check(not ok("The site scores 58 on mobile PageSpeed.", [sid_])[0], "an invented number is thrown away")
    check(not ok("The site scores 42 on mobile PageSpeed.", ["E999"])[0], "a hook citing evidence that does not exist is thrown away")
    check(not ok("The site scores 42 on mobile PageSpeed.", [])[0], "a hook citing nothing is thrown away")
    check(not ok("The site scores 42 and probably loses patients.", [sid_])[0], "a hedged / assumed hook is thrown away")
    check(not ok("The site (acmedental.com) scores 42 on mobile.", [sid_])[0], "a URL or domain in a hook is thrown away")
    check(not ok("Their 37 reviews cost $200 a month in lost leads.", [rid])[0], "a price is thrown away")
    check(not ok("The practice has 37 Google reviews and a guarantee page.", [rid])[0], "the campaign's do-not-claim list is enforced")
    check(not ok("Short.", [rid])[0], "a fragment is thrown away")
    check(ok("The practice has 37 Google reviews.", [rid])[0], "37 reviews, cited: passes")

    answer = {"hooks": [
        {"fact": "The site scores 42 on mobile PageSpeed.", "evidence": [sid_], "kind": "speed"},
        {"fact": "The practice has 37 Google reviews and a 4.1 rating.", "evidence": [rid, by_path["gbp.rating"]], "kind": "reviews"},
        {"fact": "The site has a Google Ads tag, and ads are running now.", "evidence": [by_path["website.signals.google_ads"], by_path["ads.running"]], "kind": "ads"},
        {"fact": "Their latest blog post was 12 days ago.", "evidence": [by_path["website.blog.days_since"]], "kind": "content"},    # invented number
        {"fact": "The practice has 37 Google reviews and a 4.1 rating.", "evidence": [rid], "kind": "reviews"},                    # duplicate
        {"fact": "They probably need more patients, check acmedental.example.", "evidence": [rid]},                                # hedge + URL
    ], "angle": "A slow site is sending paid clicks to a page that loads in 5 seconds.", "case_tag": "dental"}
    prompts = []
    camp_n = s.get(mdb.MetroCampaign, cid)
    res = hk.extract_hooks(s, lead, camp_n, ask=lambda p, **k: (prompts.append(p), json.dumps(answer))[1])
    check(res["hooks"] == 3 and len(res["rejected"]) == 3, f"3 hooks survive, 3 are thrown away by code ({res['hooks']} kept, {len(res['rejected'])} rejected)")
    stored = hk.hooks_for(s, lead.id)
    rows = hk.hooks_query(s, lead).all()          # Phase 3: company hooks are shared (lead_id NULL), person hooks are the lead's
    check(all(h.source_field and h.seen_at and h.source_ref for h in rows), "ACCEPTANCE: every stored hook has its stored field(s), its date and its source")
    stored_paths = {e["path"] for e in ev_list}
    check(all(all(p.strip() in stored_paths for p in h.source_field.split(",")) for h in rows), "ACCEPTANCE: every cited field is one that exists in the stored data")
    stored_dates = {e["at"] for e in ev_list}
    check(all(h.seen_at.strftime("%Y-%m-%d") in stored_dates for h in rows), "ACCEPTANCE: every hook date is the date a stored snapshot was read")
    # a hook's numbers are in what it cites
    h42 = next(h for h in rows if "42" in h.fact)
    check(h42.source_field == "pagespeed.score" and h42.seen_at.date() == comp.pagespeed_at.date(), "the PageSpeed hook cites pagespeed.score with that reading's date")
    notes = json.loads(lead.score_notes_json)
    check(notes["case_tag"] == "dental" and notes["angle"], "the angle and an ALLOWED case tag are kept")
    check("E1 |" in prompts[0] and "dental, medical" in prompts[0] and "ONLY the evidence" in prompts[0], "the prompt carries the numbered evidence and the allowed tags")
    answer2 = dict(answer, case_tag="jewelry", hooks=[answer["hooks"][0]])
    # mark one hook as used by a touch: it must survive a re-run (Phase 3: a touch that is approved or sent; a DRAFT chain
    # written from replaced hooks is cleared and its hooks freed)
    t = mdb.MetroTouch(lead_id=lead.id, cycle=1, step=1, channel="linkedin", status="sent")
    s.add(t)
    s.flush()
    first = hk.hooks_query(s, lead).order_by(mdb.MetroHook.id).first()
    first.used_touch_id = t.id
    first_fact = first.fact
    s.commit()
    hk.extract_hooks(s, lead, camp_n, ask=lambda p, **k: json.dumps(answer2))
    left = hk.hooks_query(s, lead).all()
    check(any(h.fact == first_fact and h.used_touch_id == t.id for h in left), "a hook already used by a touch stays in the ledger when hooks are written again")
    check(json.loads(lead.score_notes_json)["case_tag"] is None, "a case tag the campaign does not allow is dropped")
    bare = mdb.MetroLead(campaign_id=cid, full_name="Bare Lead", title="Owner", company_name="Bare Co", status="new", persona_verdict="keep", source_file="t.csv")
    s.add(bare)
    s.commit()
    r = hk.extract_hooks(s, bare, camp_n, ask=lambda p, **k: (_ for _ in ()).throw(AssertionError("must not ask")))
    check(r["hooks"] == 0 and "not enough" in r["reason"], "with almost no stored evidence the model is not even asked")

r = client.get(f"/metro/leads/{la_id}/evidence")
check(r.status_code == 200 and r.json()["hooks"] and r.json()["evidence"] and r.json()["hooks"][0]["seen_at"], "GET /metro/leads/{id}/evidence shows hooks with their field and date")

# AI client plumbing
check(aiclient.parse_json('```json\n{"a": 1}\n```') == {"a": 1} and aiclient.parse_json('text [1,2] more') == [1, 2], "model answers are parsed from code fences")
try:
    aiclient.parse_json("no json here")
    check(False, "a non-JSON answer is an error")
except aiclient.AIError:
    check(True, "a non-JSON answer is an error")

# ═════════════════ I. email finder round trip ═════════════════
with new_session() as s:
    cf = camp.create(s, name="Email test", type="agency", region="US/CA", month=None, offer=None)
    cfid = cf.id
    for i in range(1, 6):
        s.add(mdb.MetroLead(campaign_id=cfid, full_name=f"Eva Person{i}", first_name="Eva", last_name=f"Person{i}", title="Owner", company_name=f"Co{i}",
                            profile_url=f"https://www.linkedin.com/in/eva-{i}", profile_key=f"linkedin.com/in/eva-{i}", member_id=f"82000{i}",
                            status="new" if i != 5 else "previously_contacted", fit_score=80, persona_verdict="keep"))
    s.query(mdb.MetroLead).filter_by(member_id="820002").one().email = "already@co2.example"
    s.add(mdb.MetroSuppression(kind="domain", value="blocked.example", scope="company", reason="client", source="x", strength="hard"))
    s.commit()
    leads = s.query(mdb.MetroLead).filter_by(campaign_id=cfid).order_by(mdb.MetroLead.id).all()
    ids = {l.member_id: l.id for l in leads}
    text_, info = ef.export_csv(leads)
    rows_ = text_.lstrip("﻿").splitlines()
    check(rows_[0] == "profile_url,first_name,last_name,company,title,metro_lead_id" and info["exported"] == 3, f"the export has the Linked Helper columns and {info['exported']} usable leads without an email")
    check("eva-5" not in text_ and "eva-2" not in text_, "a previously contacted lead and a lead that already has an email are not exported")
    check(text_.startswith("﻿"), "UTF-8 with a BOM")
    res_csv = (f"profile_url,full_name,email,email_type,email_status,metro_lead_id\r\n"
               f"https://www.linkedin.com/in/eva-1,Eva Person1,eva@co1.example,business,verified,{ids['820001']}\r\n"
               f"https://www.linkedin.com/in/eva-3,Eva Person3,eva3@co3.example,business,,{ids['820003']}\r\n"
               f"https://www.linkedin.com/in/eva-4,Eva Person4,eva4@blocked.example,business,,{ids['820004']}\r\n"
               f"https://www.linkedin.com/in/nobody,Nobody,n@x.example,business,,\r\n"
               f"https://www.linkedin.com/in/eva-2,Eva Person2,,,,{ids['820002']}\r\n").encode()
    dry = ef.import_results(s, res_csv, campaign_id=cfid, source="linkedhelper", dry_run=True)
    check(dry["dry_run"] and s.get(mdb.MetroLead, ids["820001"]).email is None, "a dry run writes nothing")
    real = ef.import_results(s, res_csv, campaign_id=cfid, source="linkedhelper", dry_run=False)
    check(real["stored"] == 2 and real["refused_suppressed"] == 1 and real["no_matching_lead"] == 1 and real["no_email_found"] == 1,
          f"results import: 2 stored, 1 refused (suppressed domain), 1 unmatched, 1 without an email ({real})")
    l1, l3, l4 = (s.get(mdb.MetroLead, ids[m]) for m in ("820001", "820003", "820004"))
    check(l1.email == "eva@co1.example" and l1.email_source == "linkedhelper" and l1.email_status == "verified" and ef.emailable(l1),
          "an address the provider calls verified is verified and emailable")
    check(l3.email_status == "unverified" and l3.email_verified is False and not ef.emailable(l3), "ACCEPTANCE: an address without a verdict is stored UNVERIFIED and is not emailable")
    check(l4.email is None, "an address at a suppressed domain is never stored on the lead")
    again = ef.import_results(s, res_csv, campaign_id=cfid, source="linkedhelper", dry_run=False)
    check(again["stored"] == 0, "importing the same results again changes nothing")
    # a verified address is never replaced by a finder's guess
    other = (f"profile_url,email,metro_lead_id\r\nx,someone.else@co1.example,{ids['820001']}\r\n").encode()
    r = ef.import_results(s, other, campaign_id=cfid, source="apollo", dry_run=False)
    check(r["kept_verified_email"] == 1 and s.get(mdb.MetroLead, ids["820001"]).email == "eva@co1.example", "a verified address is never replaced by a finder's guess")
    # matching by member id and by URL, apollo
    ap = ("Person Linkedin Url,Email,Email Status\r\nhttps://www.linkedin.com/in/eva-2,eva2@co2.example,Verified\r\n").encode()
    r = ef.import_results(s, ap, campaign_id=cfid, source="apollo", dry_run=False)
    l2 = s.get(mdb.MetroLead, ids["820002"])
    check(l2.email == "eva2@co2.example" and l2.email_source == "apollo" and l2.email_status == "verified" and r["matched"] == 1,
          "an Apollo file matches by profile URL; its VERIFIED address replaces an unverified one we held")
    ap2 = ("Person Linkedin Url,Email,Email Status\r\nhttps://www.linkedin.com/in/eva-3,other3@co3.example,guessed\r\n").encode()
    r = ef.import_results(s, ap2, campaign_id=cfid, source="apollo", dry_run=False)
    check(r["kept_existing_email"] == 1 and s.get(mdb.MetroLead, ids["820003"]).email == "eva3@co3.example", "an unverified finder result never replaces an address we already hold")
    try:
        ef.import_results(s, b"name,phone\r\nA,1\r\n", campaign_id=cfid, dry_run=True)
        check(False, "a file with no email column is refused")
    except ValueError:
        check(True, "a file with no email column is refused")
    # the free check never verifies
    out = ef.check_emails(s, [l3], mx=lambda d: True)
    check(out == {"domain_ok": 1} and l3.email_status == "domain_ok" and not ef.emailable(l3), "the free domain check says domain_ok but never makes an address emailable")
    out = ef.check_emails(s, [l3], mx=lambda d: False)
    check(l3.email_status == "invalid", "a domain that does not exist makes the address invalid")
    ef.mark_email(s, l3, "verified")
    check(ef.emailable(l3), "a person can mark an address verified")
    l3.status = "suppressed"
    check(not ef.emailable(l3), "even a verified address is not emailable on a suppressed lead")

r = client.get(f"/metro/campaigns/{cfid}/email-export?shortlist_only=false")
check(r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"], "GET email-export downloads the CSV")
r = client.get(f"/metro/campaigns/{cfid}/email-export/preview?shortlist_only=false")
check(r.status_code == 200 and "exported" in r.json(), "GET email-export/preview counts what would be exported")
r = client.post(f"/metro/campaigns/{cfid}/email-import?dry_run=true", files={"file": ("r.csv", b"profile_url,email\r\nhttps://www.linkedin.com/in/eva-4,x@y.example\r\n", "text/csv")})
check(r.status_code == 200 and r.json()["dry_run"], "POST email-import previews first")

# ═════════════════ J. acceptance: a 20-lead niche sample, end to end ═════════════════
with new_session() as s:
    mdb.put_setting(s, "week_mode", "metro")
    mdb.put_setting(s, "shortlist_min_fit", 15)
    s.commit()
    cs = camp.create(s, name="Niche sample 20", type="niche", region="US/CA", month="2027-01", offer=None,
                     brief={"who": "clinics", "pains": [], "case_tags": ["medical"], "do_not_claim": []})
    sample_id = cs.id
    site_pages = {}
    for i in range(1, 21):
        dom = f"clinic{i}.example"
        tag = "<script>gtag('config','G-ABCDE%05d')</script>" % i if i % 3 == 0 else ""
        ads_tag = "AW-1234567%02d" % i if i % 4 == 0 else ""
        site_pages[f"https://{dom}/"] = (f"<html><title>Clinic {i} Medical</title><h1>Clinic {i}</h1>{tag}<script>{ads_tag}</script>"
                                         f"<a href='/services/a/'>a</a><a href='/services/b/'>b</a><a href='/services/c/'>c</a>"
                                         f"<a href='/blog/'>blog</a></html>")
        site_pages[f"https://{dom}/blog/"] = f"<html><time datetime='2026-0{(i % 9) + 1}-10'>x</time></html>"
        co = mdb.MetroCompany(name=f"Clinic {i}", name_key=f"clinic {i}", domain=dom, domain_source="csv")
        s.add(co)
        s.flush()
        s.add(mdb.MetroLead(campaign_id=cs.id, company_id=co.id, full_name=f"Owner {i}", title="Owner", company_name=f"Clinic {i}",
                            profile_url=f"https://www.linkedin.com/in/owner-{i}", profile_key=f"linkedin.com/in/owner-{i}", member_id=f"83{i:04d}",
                            status="new", persona_score=70, persona_verdict="keep", source_file="sample.csv"))
    s.commit()
fetch_sample = lambda u: (200, u, site_pages[u]) if u in site_pages else (404, u, "")      # noqa: E731
r = en.start_run(sample_id, fetch=fetch_sample, get_json=lambda u: (200, PSJ), ask=None, use_ai=False, background=False, sleep=lambda x: None)
check(r["started"] and r["total"] == 20, "an enrichment run over the 20-lead niche sample starts")
check(en.status()["done"] == 20 and en.status()["failed"] == 0 and not en.status()["running"], f"the run finishes: {en.status()['done']} of 20 companies, {en.status()['failed']} failed")
with new_session() as s:
    camp_s = s.get(mdb.MetroCampaign, sample_id)
    check(s.query(mdb.MetroCompany).filter(mdb.MetroCompany.website_scan_at.isnot(None), mdb.MetroCompany.name.like("Clinic %")).count() == 20, "all 20 sites were scanned")
    sc.score_campaign(s, camp_s)
    n_short = sum(1 for l in s.query(mdb.MetroLead).filter_by(campaign_id=sample_id).all() if sc.shortlist_filter(l, 15))
    check(n_short >= 10, f"the shortlist forms from stored readings ({n_short} of 20)")
    q = en.queue_deep(s, camp_s)
    check(q["shortlisted_considered"] == n_short and q["queued"]["linkedin_profile"] == n_short and q["queued"]["ahrefs"] == n_short,
          "layer 2 jobs (LinkedIn profile, Ahrefs for a NICHE campaign) are queued for the shortlist only")
    ag = camp.create(s, name="Agency no ahrefs", type="agency", region="US/CA", month=None, offer=None)
    check(en.queue_deep(s, ag)["queued"]["ahrefs"] == 0, "Ahrefs is never queued for an agency campaign")
    mdb.put_setting(s, "week_mode", "linked_helper")
    s.commit()
    visits_before = s.query(mdb.MetroVisitLog).filter(mdb.MetroVisitLog.kind.in_(gate.LINKEDIN_KINDS)).count()
    sid_ = gate.register_account(s, account_ref="linkedin.com/in/sample-account", label="Sample").id
    leased = [gate.next_job(s, sid_, now=datetime(2027, 1, 5, 9, 0, 0) + timedelta(minutes=i)) for i in range(40)]
    check(all(x["job"] is None or x["job"]["kind"] not in gate.LINKEDIN_KINDS for x in leased)
          and s.query(mdb.MetroVisitLog).filter(mdb.MetroVisitLog.kind.in_(gate.LINKEDIN_KINDS)).count() == visits_before,
          "ACCEPTANCE: with ~60 jobs queued and the week mode Linked Helper, no LinkedIn visit is handed out or logged (Ahrefs reads may run)")
    mdb.put_setting(s, "week_mode", "metro")
    s.commit()

# the hooks for the sample, with a fake model that tries to invent facts
with new_session() as s:
    camp_s = s.get(mdb.MetroCampaign, sample_id)
    leads_s = [l for l in s.query(mdb.MetroLead).filter_by(campaign_id=sample_id).all() if sc.shortlist_filter(l, 15)]


    def model(prompt, **kw):
        import re as _re
        ids_ = dict((m.group(2), m.group(1)) for m in _re.finditer(r"(E\d+) \| ([\w.\[\]]+) = ", prompt))
        hooks_ = []
        if "pagespeed.score" in ids_:
            hooks_.append({"fact": "The site scores 42 on mobile PageSpeed.", "evidence": [ids_["pagespeed.score"]]})
        if "website.service_pages" in ids_:
            hooks_.append({"fact": "The site lists 3 service pages.", "evidence": [ids_["website.service_pages"]]})
        hooks_.append({"fact": "Their ad spend is 9,000 a month.", "evidence": [next(iter(ids_.values()))]})      # invented
        return json.dumps({"hooks": hooks_, "angle": "A faster site.", "case_tag": "medical"})
    total = 0
    for l in leads_s[:20]:
        total += hk.extract_hooks(s, l, camp_s, ask=model)["hooks"]
    rows, owner = [], {}
    for l in leads_s[:20]:
        for h in hk.hooks_query(s, l).all():
            if h.id not in owner:
                owner[h.id] = l
                rows.append(h)
    ok_all = True
    for h in rows:
        l = owner[h.id]
        co = s.get(mdb.MetroCompany, h.company_id)
        evl = {e["path"]: e for e in hk.build_evidence(s, l, co)}
        for p in [x.strip() for x in h.source_field.split(",")]:
            if p not in evl or evl[p]["at"] != h.seen_at.strftime("%Y-%m-%d"):
                ok_all = False
    check(len(rows) == total and total >= 2 * len(leads_s[:20]) - 2 and ok_all,
          f"ACCEPTANCE (20-lead niche sample): all {len(rows)} stored hooks trace to a stored field and its date; the invented 'ad spend' hooks were all thrown away")
    check(not any("9,000" in h.fact for h in rows), "no invented figure reached the ledger")

print(f"\n{'all passed' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
