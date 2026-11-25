# -*- coding: utf-8 -*-
"""Metro F4 (METRO_TASK.md task F4, 25 Nov 2026): one-step import, unique download names, enrich order, personal emails,
company LinkedIn pages, the email domain check as a run. A SCRATCH database, SYNTHETIC people; no network, no model.

Pinned:
  1. download names carry campaign, what it is, date AND time, so they never collide; the export routes send them;
  2. personal emails: a business address always wins (even over a verified personal one, the old one is kept in raw data),
     a personal address is a sending address only once verified and only because the lead has no other;
  3. the current company's LinkedIn page (`organization_url_1`) is stored from an import, never an older job's, never a school
     or a person; the one-time backfill restores it from the rows already stored;
  4. "Enrich next N" takes companies WITH a domain and no scan first; the count on the button is what the run takes;
  5. the ONE import: it writes at once, answers in words (no JSON), applies updates to existing leads, and stops before writing
     only when the file looks wrong (no columns / nothing matches and nothing would be added / the same file again, which
     `force` overrides); the email finder's results go through the same call;
  6. the free domain check is a progress run, marks domain_ok / invalid, never verified, leaves verified addresses alone;
  7. progress runs carry the campaign name for the header strip.
Run: python tests/metro/test_metro_fix4.py
"""
import csv
import io
import json
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from fastapi import FastAPI                     # noqa: E402
from fastapi.testclient import TestClient      # noqa: E402
from sqlalchemy import create_engine           # noqa: E402
from sqlalchemy.orm import Session             # noqa: E402

bad = 0


def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


tmp = Path(tempfile.mkdtemp(prefix="metro-f4-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import campaigns as camp            # noqa: E402
from metro import csvimport as ci              # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import emailfinder as ef            # noqa: E402
from metro import enrich as en                 # noqa: E402
from metro import filenames, importer, progress   # noqa: E402
from metro import lhenrich as lh               # noqa: E402
from metro.db import MetroCompany, MetroImport, MetroLead   # noqa: E402
from metro.router import router                # noqa: E402

mdb.set_engine(eng)
mdb.init_db(eng)
importer.AUTO_MX = False
app = FastAPI()
app.include_router(router)
cl = TestClient(app)


def csv_bytes(header, rows, delim=","):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=delim, lineterminator="\r\n")
    w.writerow(header)
    w.writerows(rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")


# ───────────────────────── 1. download names ─────────────────────────
a = filenames.download_name("USA CAN Agency Claude 1", "Linked Helper email list", now=datetime(2026, 11, 25, 21, 5, 9))
b = filenames.download_name("USA CAN Agency Claude 1", "Linked Helper email list", now=datetime(2026, 11, 25, 21, 5, 10))
check(a == "metro_usa-can-agency-claude-1_linked-helper-email-list_2026-11-25_210509.csv", f"name = campaign + what + date + time ({a})")
check(a != b, "a second download one second later has another name")
check(filenames.download_name("", "x", now=datetime(2026, 1, 1)).startswith("metro_campaign_x_2026-01-01_"), "an empty campaign name still gives a usable name")
check(re.fullmatch(r"[A-Za-z0-9_.-]+", filenames.download_name("Ünï/cödé: \"q\"", "a b", now=datetime(2026, 1, 1))) is not None, "no character that breaks a file name or a header")

with Session(eng) as s:
    c1 = camp.create(s, name="Export Test", type="agency", region="US/CA", month=None, offer=None)
    c1_id = c1.id
    s.add(MetroLead(campaign_id=c1_id, full_name="P One", status="new", profile_url="https://www.linkedin.com/in/p-one/", persona_verdict="keep", persona_score=80))
    s.commit()
r1 = cl.post(f"/metro/campaigns/{c1_id}/email-export", json={"lead_ids": [1], "shortlist_only": False})
cd = r1.headers.get("content-disposition", "")
check(r1.status_code == 200 and re.search(r'filename="metro_export-test_linked-helper-email-list_\d{4}-\d{2}-\d{2}_\d{6}\.csv"', cd) is not None, f"the scoped export route sends the unique name ({cd})")
check("metro-email-finder-campaign" not in cd, "the old fixed name is gone")
r2 = cl.get(f"/metro/campaigns/{c1_id}/email-export?shortlist_only=false")
check(re.search(r'filename="metro_export-test_', r2.headers.get("content-disposition", "")) is not None, "the older GET export route uses it too")

# ───────────────────────── 2. personal emails ─────────────────────────
class L:  # a lead stand-in for emailable()
    def __init__(self, email, status, typ, st="new"):
        self.email, self.email_status, self.email_type, self.status = email, status, typ, st


check(ef.emailable(L("a@gmail.com", "verified", "personal")), "a verified PERSONAL address is a sending address (F4 reversed F3)")
check(not ef.emailable(L("a@gmail.com", "unverified", "personal")) and not ef.emailable(L("a@gmail.com", "domain_ok", "personal")), "an unverified personal address is not")
check(ef.emailable(L("a@acme.com", "verified", "business")) and not ef.emailable(L("a@acme.com", "verified", "business", "junk")), "business: verified and usable lead")
check(ef.email_kind(L("a@gmail.com", None, "personal")) == "personal" and ef.email_kind(L("a@acme.com", None, None)) == "business" and ef.email_kind(L(None, None, None)) is None, "email_kind")

with Session(eng) as s:
    c2 = camp.create(s, name="Personal Mail", type="agency", region="US/CA", month=None, offer=None)
    c2_id = c2.id
    comp = MetroCompany(name="Hotelco", name_key="hotelco")
    s.add(comp)
    s.flush()
    lead = MetroLead(campaign_id=c2_id, company_id=comp.id, full_name="Hank H", status="new", profile_url="https://www.linkedin.com/in/hank-h/",
                     profile_key="linkedin.com/in/hank-h", member_id="777", email="hank@gmail.com", email_type="personal", email_status="verified", email_verified=True,
                     persona_verdict="keep", persona_score=50)
    s.add(lead)
    s.commit()
    lead_id = lead.id
    # a business address found later replaces even a VERIFIED personal one; the old address is kept in the raw data
    raw = csv_bytes(["member_id", "profile_url", "email", "email_type"], [["777", "https://www.linkedin.com/in/hank-h/", "hank@hotelco.com", "business"]])
    r = ef.import_results(s, raw.replace(b"member_id", b"member_id"), campaign_id=c2_id, source="linkedhelper", filename="r.csv", dry_run=False)
    s.expire_all()
    h = s.get(MetroLead, lead_id)
    check(r["replaced_personal"] == 1 and h.email == "hank@hotelco.com" and h.email_type == "business", "email results: a business address replaces a verified personal one")
    check(h.email_status == "unverified" and not h.email_verified and not ef.emailable(h), "the new address starts unverified (the old status was about the old address)")
    check("hank@gmail.com" in json.loads(h.raw_json)["mapped"]["other_emails"], "the replaced personal address is kept in the lead's raw data")
    # and the other way round: a personal address never replaces a business one
    raw2 = csv_bytes(["member_id", "profile_url", "email", "email_type"], [["777", "https://www.linkedin.com/in/hank-h/", "hank@gmail.com", "personal"]])
    r = ef.import_results(s, raw2, campaign_id=c2_id, source="linkedhelper", filename="r2.csv", dry_run=False)
    s.expire_all()
    check(s.get(MetroLead, lead_id).email == "hank@hotelco.com", "a personal address never replaces a business one")
    # the lead-list path does the same (a business address in a re-imported export replaces the personal one)
    lead2 = MetroLead(campaign_id=c2_id, full_name="Ivy I", status="new", profile_url="https://www.linkedin.com/in/ivy-i/", profile_key="linkedin.com/in/ivy-i",
                      member_id="778", email="ivy@yahoo.com", email_type="personal", email_status="verified", email_verified=True, persona_verdict="keep", persona_score=50)
    s.add(lead2)
    s.commit()
    raw3 = csv_bytes(["member_id", "profile_url", "first_name", "last_name", "email", "email_type"],
                     [["778", "https://www.linkedin.com/in/ivy-i/", "Ivy", "I", "ivy@ivyco.com", "business"]])
    import metro.leads as lm
    lm.run_import(s, s.get(type(c2), c2_id), raw3, filename="ivy.csv", dry_run=False)
    s.expire_all()
    iv = s.query(MetroLead).filter_by(member_id="778").one()
    check(iv.email == "ivy@ivyco.com" and iv.email_type == "business" and iv.email_status == "unverified", "lead import: a business address replaces a verified personal one, starts unverified")
    check("ivy@yahoo.com" in json.loads(iv.raw_json)["mapped"]["other_emails"], "and the old one is kept")

# ───────────────────────── 3. the company's LinkedIn page ─────────────────────────
check(lh.company_page("https://www.linkedin.com/company/acme-digital/") == "https://www.linkedin.com/company/acme-digital/", "company_page: the normal form")
check(lh.company_page("http://linkedin.com/company/acme-digital?trk=x") == "https://www.linkedin.com/company/acme-digital/", "company_page: http, no www, a query string are normalised")
check(lh.company_page("https://www.linkedin.com/school/mit/") is None and lh.company_page("https://www.linkedin.com/in/someone/") is None
      and lh.company_page("https://www.linkedin.com/company/unavailable/") is None and lh.company_page("") is None and lh.company_page(None) is None,
      "company_page: a school, a person, 'unavailable', an empty cell are not company pages")

HEAD = ["member_id", "profile_url", "first_name", "last_name", "email", "email_type", "current_company", "organization_1", "organization_url_1",
        "organization_end_1", "organization_2", "organization_url_2", "organization_end_2", "organization_domain_1"]
with Session(eng) as s:
    c3 = camp.create(s, name="Pages", type="agency", region="US/CA", month=None, offer=None)
    c3_id = c3.id
    rows = [
        ["301", "https://www.linkedin.com/in/amy-p/", "Amy", "P", "", "", "Pagely One", "Pagely One", "https://www.linkedin.com/company/pagely-one/", "", "Old Job", "https://www.linkedin.com/company/old-job/", "2019-01", "pagely1.com"],
        # the current company's page is empty, only an OLDER job has one: nothing is taken
        ["302", "https://www.linkedin.com/in/ben-p/", "Ben", "P", "", "", "Pagely Two", "Pagely Two", "", "", "Old Job Two", "https://www.linkedin.com/company/old-job-2/", "2018-06", ""],
        # a school page for the current organization: not a company page
        ["303", "https://www.linkedin.com/in/cat-p/", "Cat", "P", "", "", "Pagely Three", "Pagely Three", "https://www.linkedin.com/school/pagely-three/", "", "", "", "", ""],
    ]
    dry = lm.run_import(s, c3, csv_bytes(HEAD, rows), filename="pages.csv", dry_run=True)
    check(dry["enrichment"]["company_pages"] == 1, f"dry run counts 1 company page ({dry['enrichment']['company_pages']})")
    check(s.query(MetroCompany).filter(MetroCompany.linkedin_url.isnot(None)).count() == 0, "dry run stores nothing")
    lm.run_import(s, c3, csv_bytes(HEAD, rows), filename="pages.csv", dry_run=False)
    s.expire_all()
    pages = {c.name: c.linkedin_url for c in s.query(MetroCompany).filter(MetroCompany.name.like("Pagely%")).all()}
    check(pages.get("Pagely One") == "https://www.linkedin.com/company/pagely-one/", "the current company's page is stored")
    check(pages.get("Pagely Two") is None and pages.get("Pagely Three") is None, "an older job's page and a school page are never taken")
    check(not any("old-job" in (v or "") for v in pages.values()), "no page of an older job anywhere")
    co = s.query(MetroCompany).filter_by(name="Pagely One").one()
    check("company page" in (co.domain_tried_json or ""), "the trail says where the page came from")
    # the one-time backfill: clear the page and the marker, run the migration again
    co.linkedin_url = None
    s.commit()
    from sqlalchemy import text
    with eng.begin() as conn:
        conn.execute(text("DELETE FROM metro_settings WHERE key='f4_company_pages'"))
    res = mdb.f4_company_pages(eng)
    with Session(eng) as s2:
        again = s2.query(MetroCompany).filter_by(name="Pagely One").one().linkedin_url
    check(again == "https://www.linkedin.com/company/pagely-one/" and res and res["pages_set"] >= 1, f"the backfill restores the page from the stored row ({res})")
    check(mdb.f4_company_pages(eng) is None, "and runs only once")

# ───────────────────────── 4. enrich order ─────────────────────────
with Session(eng) as s:
    c4 = camp.create(s, name="Order", type="agency", region="US/CA", month=None, offer=None)
    c4_id = c4.id

    def mk(name, domain, persona, verdict="keep", scanned=False, tried=False):
        co = MetroCompany(name=name, name_key=ci.company_key(name), domain=domain, domain_source="csv" if domain else None,
                          website_scan_at=mdb.utcnow() if scanned else None, enrich_tried_at=mdb.utcnow() if tried else None)
        s.add(co)
        s.flush()
        l = MetroLead(campaign_id=c4_id, company_id=co.id, full_name=f"Lead {name}", company_name=name, status="new", persona_score=persona, persona_verdict=verdict,
                      profile_url=f"https://www.linkedin.com/in/{name.lower()}/")
        s.add(l)
        s.flush()
        return l.id
    ids = {
        "NoDomHigh": mk("NoDomHigh", None, 95),
        "DomLow": mk("DomLow", "domlow.com", 20),
        "DomMid": mk("DomMid", "dommid.com", 55),
        "NoDomMid": mk("NoDomMid", None, 60),
        "Scanned": mk("Scanned", "scanned.com", 99, scanned=True),
        "TriedNoDom": mk("TriedNoDom", None, 70, tried=True),
        "DomReview": mk("DomReview", "domreview.com", 90, verdict="review"),
    }
    s.commit()
    name_of = {v: k for k, v in ids.items()}
    order = [s.get(MetroCompany, cid).name for cid in en._company_ids(s, c4_id, None)]
    check(order[:3] == ["DomReview", "DomMid", "DomLow"] and order[3] == "Scanned" and order[4:] == ["NoDomHigh", "TriedNoDom", "NoDomMid"],
          f"a run takes: domain and no scan, then domain with a scan, then no domain; best persona first inside a group ({order})")
    check(order.index("DomLow") < order.index("NoDomHigh"), "a company with a domain and persona 20 goes before one with no domain and persona 95")

r = cl.get(f"/metro/campaigns/{c4_id}/enrich-next?ns=2,3,20&take=2").json()
picked = [name_of[i] for i in r["lead_ids"]]
check(picked == ["DomMid", "DomLow"], f"the first 2 companies have a domain; persona keep first, then best score ({picked})")
check(r["plan"] == {"n": 2, "companies": 2, "with_domain": 2, "without_domain": 0}, f"the plan for 2 says 2 with a domain, 0 without ({r['plan']})")
check(r["plans"]["3"]["with_domain"] == 3 and r["plans"]["3"]["without_domain"] == 0, "the plan for 3 is still all with a domain")
check(r["plans"]["20"] == {"n": 20, "companies": 5, "with_domain": 3, "without_domain": 2}, f"the plan for 20: all that is left, 3 with a domain + 2 without ({r['plans']['20']})")
check(r["pool"] == {"companies": 5, "with_domain": 3, "without_domain": 2}, f"the pool: 3 companies with a domain wait, 2 without ({r['pool']})")
# (the scanned company and the tried one are not "not enriched yet": they are not in the pool)
r4 = cl.get(f"/metro/campaigns/{c4_id}/enrich-next?ns=20&take=4").json()
check([name_of[i] for i in r4["lead_ids"]] == ["DomMid", "DomLow", "DomReview", "NoDomHigh"], f"the companies with no domain come after all those with one ({[name_of[i] for i in r4['lead_ids']]})")
check(r4["plan"] == {"n": 4, "companies": 4, "with_domain": 3, "without_domain": 1}, "and the plan says 3 with a domain + 1 without")
rv = cl.get(f"/metro/campaigns/{c4_id}/enrich-next?ns=20&verdict=review").json()
check(rv["pool"]["companies"] == 1, "the filters of the page narrow the pool")
check(cl.get("/metro/campaigns/99999/enrich-next").status_code == 404, "an unknown campaign is a 404, not a crash")

# ───────────────────────── 5. the one import ─────────────────────────
LH = ["member_id", "profile_url", "first_name", "last_name", "headline", "current_company", "email", "email_type"]
def lh_rows(n0, n):
    return [[str(n0 + i), f"https://www.linkedin.com/in/imp-{n0 + i}/", f"Imp{n0 + i}", "Person", "Founder and CEO", f"ImpCo {n0 + i}", "", ""] for i in range(n)]


with Session(eng) as s:
    c5 = camp.create(s, name="One Import", type="agency", region="US/CA", month=None, offer=None)
    c5_id = c5.id
    c5b = camp.create(s, name="Other Campaign", type="agency", region="US/CA", month=None, offer=None)
    c5b_id = c5b.id
    raw = csv_bytes(LH, lh_rows(5000, 6))
    out = importer.import_file(s, c5, raw, filename="first.csv")
    check(out["stopped"] is False and out["wrote"] is True and out["kind"] == "leads", "a lead list imports at once, with no preview")
    check(s.query(MetroLead).filter_by(campaign_id=c5_id).count() == 6, "the leads are stored")
    txt = json.dumps(out["summary"])
    check("{" not in out["summary"]["headline"] and not any("{" in l or "}" in l for l in out["summary"]["lines"]), "the summary is words, not JSON")
    check("6 rows read" in out["summary"]["headline"] and any("6 new leads added" in l for l in out["summary"]["lines"]), f"it says what happened ({out['summary']['lines'][:2]})")
    # the same file again: stopped before writing, can be forced
    n_imports = s.query(MetroImport).filter_by(campaign_id=c5_id).count()
    out2 = importer.import_file(s, c5, raw, filename="first.csv")
    check(out2["stopped"] and out2["stop_kind"] == "same_file" and out2["can_force"] and not out2["wrote"], "the same file again is stopped, and can be forced")
    check(s.query(MetroImport).filter_by(campaign_id=c5_id).count() == n_imports, "nothing was written by the stop")
    out3 = importer.import_file(s, c5, raw, filename="first.csv", force=True)
    check(out3["stopped"] is False and out3["wrote"], "force imports it anyway")
    # an update file: every row already exists, but it fills a missing email -> must APPLY (the old dialog disabled its button at 0 new leads)
    rows_up = lh_rows(5000, 6)
    for r_ in rows_up:
        r_[6], r_[7] = f"{r_[2].lower()}@impco.com", "business"
    out4 = importer.import_file(s, c5, csv_bytes(LH, rows_up), filename="update.csv")
    check(out4["stopped"] is False and out4["wrote"] and out4["result"]["added"] == 0 and out4["result"]["duplicate"] == 6, "a file with 0 new leads but 6 matches is imported (updates always apply)")
    check(s.query(MetroLead).filter(MetroLead.campaign_id == c5_id, MetroLead.email.isnot(None)).count() == 6, "and the emails were filled")
    check(any("matched leads already in this campaign" in l and "filled in" in l for l in out4["summary"]["lines"]), f"the summary says so in words ({out4['summary']['lines'][:2]})")
    # no recognised columns
    out5 = importer.import_file(s, c5, csv_bytes(["foo", "bar"], [["1", "2"]]), filename="junk.csv")
    check(out5["stopped"] and out5["stop_kind"] == "no_columns" and "foo" in out5["summary"]["lines"][0], f"no recognised columns: stopped, and it names the columns ({out5['summary']['lines'][0][:80]})")
    # nothing matches this campaign and nothing would be added: everyone is in another campaign
    out6 = importer.import_file(s, c5b, csv_bytes(LH, lh_rows(5000, 6)), filename="elsewhere.csv")
    check(out6["stopped"] and out6["stop_kind"] == "no_match" and not out6["can_force"] and "another campaign" in out6["summary"]["lines"][0], f"rows that all belong to another campaign: stopped ({out6['summary']['lines'][0][:90]})")
    check(s.query(MetroLead).filter_by(campaign_id=c5b_id).count() == 0, "and nothing was written")
    # the email finder's results through the same call
    lids = [l.id for l in s.query(MetroLead).filter_by(campaign_id=c5_id).order_by(MetroLead.id).limit(3).all()]
    for l in s.query(MetroLead).filter(MetroLead.id.in_(lids)).all():
        l.email, l.email_type, l.email_status = None, None, None
    s.commit()
    res_file = csv_bytes(["profile_url", "first_name", "last_name", "company", "title", "metro_lead_id", "email", "email_status"],
                         [[f"https://www.linkedin.com/in/imp-{5000 + i}/", "x", "y", "z", "t", str(lids[i]), f"found{i}@impco{i}.com", "verified" if i == 0 else ""] for i in range(3)])
    check(importer.kind_of(["profile_url", "metro_lead_id", "email"]) == "email-results" and importer.kind_of(LH) == "leads", "the shape decides: metro_lead_id = the finder's results")
    out7 = importer.import_file(s, c5, res_file, filename="results.csv")
    s.expire_all()
    check(out7["kind"] == "email-results" and out7["wrote"] and out7["result"]["stored"] == 3, f"the finder's results import through the same call ({out7['result']['stored']} stored)")
    check({l.email_status for l in s.query(MetroLead).filter(MetroLead.id.in_(lids)).all()} == {"verified", "unverified"}, "provider 'verified' is kept, the rest is unverified")
    check(any("3 email addresses stored" in l for l in out7["summary"]["lines"]), f"and it says so ({out7['summary']['lines'][:1]})")
    out8 = importer.import_file(s, c5, res_file, filename="results.csv")
    check(out8["stopped"] and out8["stop_kind"] == "same_file", "the same results file again is stopped too")
    out9 = importer.import_file(s, c5, csv_bytes(["profile_url", "metro_lead_id", "email"], [["https://www.linkedin.com/in/nobody/", "99999", "n@x.com"]]), filename="strangers.csv")
    check(out9["stopped"] and out9["stop_kind"] == "no_match", "results that match no lead of this campaign: stopped")
    # through the route (multipart), as the dialog calls it
    rr = cl.post(f"/metro/campaigns/{c5_id}/import-file?force=false", files={"file": ("more.csv", csv_bytes(LH, lh_rows(7000, 3)), "text/csv")})
    j = rr.json()
    check(rr.status_code == 200 and j["wrote"] and j["summary"]["headline"].startswith("more.csv: 3 rows read"), "the route imports and answers with the summary")
    rr2 = cl.post(f"/metro/campaigns/{c5_id}/import-file", files={"file": ("more.csv", csv_bytes(LH, lh_rows(7000, 3)), "text/csv")})
    check(rr2.status_code == 200 and rr2.json()["stopped"] and rr2.json()["stop_kind"] == "same_file", "and stops the same file over HTTP")
    runs = progress.snapshot()["runs"]
    check(any(r_["kind"] == "import" and r_["status"] == "done" and "first.csv" in (r_["result"] or "") for r_ in runs), "a written import leaves its result line for the strip")

# ───────────────────────── 6. the domain check as a run ─────────────────────────
with Session(eng) as s:
    c6 = camp.create(s, name="Domain Check", type="agency", region="US/CA", month=None, offer=None)
    c6_id = c6.id
    for i, (em, st) in enumerate([("a@good.com", None), ("b@good.com", "unverified"), ("c@gone.example", None), ("d@verified.com", "verified"),
                                   ("e@flaky.com", None), ("not-an-email", None), ("f@judged.com", "domain_ok")]):
        s.add(MetroLead(campaign_id=c6_id, full_name=f"M{i}", status="new", email=em, email_status=st, email_verified=(st == "verified")))
    s.commit()
seen_domains = []
def stub_mx(dom):
    seen_domains.append(dom)
    return {"good.com": True, "gone.example": False, "flaky.com": None, "verified.com": True, "judged.com": True}.get(dom)
res = ef.start_mx_check(c6_id, mx=stub_mx, background=False, workers=2)
check(res["started"] and res["total"] == 4, f"the check covers each distinct domain once ({res})")
check("verified.com" not in seen_domains, "a verified address is not looked up at all")
with Session(eng) as s:
    by = {l.email: l.email_status for l in s.query(MetroLead).filter_by(campaign_id=c6_id).all()}
check(by["a@good.com"] == "domain_ok" and by["b@good.com"] == "domain_ok", "a domain that accepts mail -> domain_ok")
check(by["c@gone.example"] == "invalid" and by["not-an-email"] == "invalid", "a domain that does not exist, and a malformed address -> invalid")
check(by["e@flaky.com"] in (None, "unverified"), "a domain that could not be checked is left as it was")
check(by["d@verified.com"] == "verified" and "verified" not in {v for k, v in by.items() if k != "d@verified.com"}, "verified stays verified, and nothing else became verified")
run = [r_ for r_ in progress.snapshot()["runs"] if r_["kind"] == "mx-check"][0]
check(run["status"] == "done" and "Nothing is marked verified" in run["result"] and run["campaign_id"] == c6_id, f"it is a progress run with a result line ({run['result'][:80]}...)")
seen_domains.clear()
res2 = ef.start_mx_check(c6_id, mx=stub_mx, background=False, include_checked=False)
check(sorted(seen_domains) == ["flaky.com"], f"the automatic run after an import leaves judged addresses alone ({seen_domains})")

# ───────────────────────── 7. progress carries the campaign name ─────────────────────────
progress.reset()
rid = progress.start("enrich", "Enriching", total=3, campaign_id=c6_id)
snap = cl.get("/metro/progress").json()
check(snap["runs"][0]["campaign_name"] == "Domain Check", "a run in /progress carries its campaign's name")
progress.finish(rid, "Done")

print(f"\n{'ALL PASSED' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
