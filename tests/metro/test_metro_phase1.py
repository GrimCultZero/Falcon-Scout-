# -*- coding: utf-8 -*-
"""Metro Phase 1 (METRO_PLAN.md): campaigns, CSV import, dedup, layer 0 persona score, launch kit,
suppression candidates. SCRATCH database only; every CSV here is built in this file from SYNTHETIC
people (Example Person, example.com): no real name, email or LinkedIn URL is in git. The column
NAMES are the real Linked Helper / Sales Navigator headers (they describe a format, not a person).

Pinned:
  * column detection: Linked Helper (comma and semicolon), Sales Navigator-style, Apollo-style; an exact
    header beats a "contains" one (`email` is never read from `email_type`; `headline` never from
    `organization_title_1`; `website_1`, a person's own site, is never the company's);
  * Linked Helper status: invited / connected derived from the export's fields; an explicit
    "Successful" column means accepted;
  * layer 0: decision maker, junk patterns (freelancer, student, open to work, recruiter), geography,
    rules editable and validated;
  * import: a dry run writes nothing; re-importing the same file adds nothing; dedup by member id,
    profile URL, email, name + company; a person or company in another campaign is skipped; a
    suppressed person is kept and marked, never written to; emails from the export are marked
    linkedhelper; a source that names Upwork is refused;
  * launch checklist: dated, undoable, never blocks starting;
  * suppression candidates: nothing is suppressed until approved; the upwork_job ids are never proposed;
    no lead is ever created from Upwork data.
Run: python tests/metro/test_metro_phase1.py
"""
import io
import json
import re
import sys
import tempfile
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


tmp = Path(tempfile.mkdtemp(prefix="metro-p1-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import csvimport as ci              # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import persona as pe                # noqa: E402
from metro import leads as lm                  # noqa: E402
from metro import campaigns as camp            # noqa: E402
from metro import candidates as cand           # noqa: E402
from metro import suppression as sup           # noqa: E402

mdb.set_engine(eng)

# ── synthetic Linked Helper export ────────────────────────────────────────────
LH_HEAD = ["id", "public_id", "member_id", "profile_url", "email", "email_type", "full_name", "first_name", "last_name",
           "headline", "location_name", "industry", "summary", "badges_job_seeker", "current_company",
           "current_company_position", "organization_1", "organization_title_1", "website_1", "connected_at",
           "connected_at_iso", "member_distance", "invited_date", "invited_date_iso", "tags"]


def lh_row(**kw):
    base = {"id": "1", "public_id": "", "member_id": "", "profile_url": "", "email": "", "email_type": "", "full_name": "",
            "first_name": "", "last_name": "", "headline": "", "location_name": "New York, United States", "industry": "",
            "summary": "", "badges_job_seeker": "false", "current_company": "", "current_company_position": "",
            "organization_1": "", "organization_title_1": "", "website_1": "", "connected_at": "", "connected_at_iso": "",
            "member_distance": "DISTANCE_2", "invited_date": "", "invited_date_iso": "", "tags": ""}
    base.update(kw)
    return base


def person(n, **kw):
    d = dict(member_id=str(900000 + n), profile_url=f"https://www.linkedin.com/in/example-person-{n}",
             full_name=f"Example Person{n}", first_name="Example", last_name=f"Person{n}",
             headline=f"Founder at Example Agency {n}", current_company=f"Example Agency {n} LLC",
             current_company_position="Founder")
    d.update(kw)
    return lh_row(**d)


def to_csv(rows, delim=",", head=LH_HEAD, bom=True, enc="utf-8"):
    def q(v):
        v = str(v)
        return '"' + v.replace('"', '""') + '"' if (delim in v or '"' in v or "\n" in v) else v
    lines = [delim.join(q(h) for h in head)] + [delim.join(q(r.get(h, "")) for h in head) for r in rows]
    b = ("\r\n".join(lines) + "\r\n").encode(enc)
    return (b"\xef\xbb\xbf" + b) if bom and enc == "utf-8" else b


# ── 1. reading and column detection ───────────────────────────────────────────
rows, headers, d = ci.read_csv(to_csv([person(1)], ","))
check(d == "," and len(rows) == 1 and headers[0] == "id", "comma-delimited with a BOM reads")
rows, headers, d = ci.read_csv(to_csv([person(1)], ";"))
check(d == ";" and rows[0]["full_name"] == "Example Person1", "semicolon-delimited reads")
rows, _, _ = ci.read_csv("full_name,headline\nJos\xe9 Example,Owner\n".encode("cp1252"))
check(rows[0]["full_name"] == "Jos\xe9 Example", "a cp1252 file is decoded, not mangled")
cols = ci.detect_cols(LH_HEAD)
check(cols["email"] == "email" and cols["email_type"] == "email_type", "email is read from `email`, not `email_type`")
check(cols["headline"] == "headline" and cols["url"] == "profile_url" and cols["company"] == "current_company",
      "headline / profile URL / company columns found")
check(cols["website"] is None, "a person's own site (website_1) is never the company website")
check(cols["invited_iso"] == "invited_date_iso" and cols["connected_iso"] == "connected_at_iso", "Linked Helper date columns found")
check(ci.detect_cols(["x", "organization_title_1"])["headline"] is None, "headline is never read from organization_title_1")
sn = ci.detect_cols(["profile_url", "full_name", "headline", "current_company", "location_name", "member_id"])
check(all(sn[k] for k in ("url", "name", "headline", "company", "location", "member_id")),
      "Sales Navigator-style export maps with no manual step")
ap = ci.detect_cols(["First Name", "Last Name", "Title", "Company", "Email", "Person Linkedin Url", "Website"])
check(ap["first"] == "First Name" and ap["headline"] == "Title" and ap["url"] == "Person Linkedin Url"
      and ap["email"] == "Email" and ap["website"] == "Website", "Apollo-style export maps")

# ── 2. Linked Helper status ───────────────────────────────────────────────────
def st(**kw):
    r = person(1, **kw)
    return ci.normalize_row(r, ci.detect_cols(LH_HEAD))

n = st()
check(n["invite_status"] == "none", "no invite date, distance 2 -> none")
n = st(invited_date_iso="2026-03-10T15:55:48.424Z", invited_date="10 March")
check(n["invite_status"] == "invited" and n["invited_at"].year == 2026, "an invite date -> invited")
n = st(invited_date_iso="2026-03-10T15:55:48.424Z", member_distance="DISTANCE_1", connected_at="2026.03.24")
check(n["invite_status"] == "connected" and n["connected_at"].day == 24, "connected_at / DISTANCE_1 -> connected, date kept")
check(st(member_distance="DISTANCE_1")["invite_status"] == "connected", "DISTANCE_1 alone -> connected (already 1st degree)")
sh = LH_HEAD + ["status"]
c2 = ci.detect_cols(sh)
r = dict(person(1), status="Successful")
check(ci.normalize_row(r, c2)["invite_status"] == "connected", 'an explicit status "Successful" means accepted')
r = dict(person(1), status="Pending", invited_date_iso="2026-03-10T15:55:48Z")
check(ci.normalize_row(r, c2)["invite_status"] == "invited", 'status "Pending" -> invited')

# ── 3. layer 0 persona ────────────────────────────────────────────────────────
R = pe.DEFAULT_RULES
def sc(title="", headline="", company="", location="New York, United States", summary="", campaign="agency", region="US/CA", badge=False):
    return pe.score_lead({"title": title, "headline": headline, "company_name": company, "location": location, "summary": summary},
                         R, campaign_type=campaign, region=region, job_seeker_badge=badge)

a = sc("Founder", "Founder at Example Digital Marketing Agency", "Example Agency")
check(a["verdict"] == "keep" and a["score"] >= 90, f"US agency founder keeps ({a['score']})")
check(all(isinstance(x, str) and x for x in a["reasons"]) and len(a["reasons"]) >= 3, "the score carries its reasons")
check(sc("Freelance SEO Consultant", "Freelancer")["verdict"] == "junk", "freelancer -> junk")
check(sc("Marketing student", "Student at State University")["verdict"] == "junk", "student -> junk")
check(sc("Owner", "Owner. #OpenToWork", "Example Agency")["verdict"] == "junk", "open to work in the headline -> junk")
check(sc("Owner", "Owner", "Example Agency", badge=True)["verdict"] == "junk", "the open-to-work badge -> junk")
check(sc("Technical Recruiter", "Recruiter at Example Agency")["verdict"] == "junk", "recruiter -> junk")
check(sc("Owner", "International consultant at Example Agency")["verdict"] != "junk", '"intern" does not match inside "International"')
out = sc("Founder", "Founder at Example Agency", "Example Agency", location="Berlin, Germany")
check(out["score"] < a["score"], "location outside the campaign region scores lower")
check(sc("Founder", "Founder", "Example Agency", location="", region="US/CA")["verdict"] in ("keep", "review"), "no location is not junk")
n_ = sc("Practice Manager", "Practice Manager at Example Dental Clinic", "Example Dental Clinic", campaign="niche")
check(n_["score"] >= 45, f"niche campaigns use the niche business words ({n_['score']})")
check(pe.validate_rules(R) == [] and pe.validate_rules({"junk_title": "x"}) != [] and pe.validate_rules([]) != [],
      "rules are validated before they are saved")

# ── 4. campaigns and the launch kit ───────────────────────────────────────────
with Session(eng) as s:
    ca = camp.create(s, name="US agencies", type="agency", region="US/CA", month=None, offer="pilot audit",
                     brief={"who": "agency owners", "pains": "delivery capacity\nmargins", "case_tags": ["ppc"], "do_not_claim": ["rankings"]})
    check(ca.status == "draft", "a new campaign is a draft")
    d = camp.to_dict(s, ca)
    check(d["brief"]["pains"] == ["delivery capacity", "margins"] and d["checklist_total"] == 3 and d["checklist_open"] == 3,
          "brief lists are cleaned; the launch checklist has its 3 manual steps, all open")
    for bad_args in ({"name": "", "type": "agency"}, {"name": "x", "type": "other"}, {"name": "x", "type": "niche", "month": "2026-13"}):
        try:
            camp.create(s, **{"region": None, "month": None, "offer": None, **bad_args}); ok = False
        except ValueError:
            ok = True
        check(ok, f"create refuses {bad_args}")
    try:
        camp.update(s, ca, {"status": "active"}); ok = False
    except ValueError:
        ok = True
    check(ok, "status cannot be set to active directly: Start campaign shows the checklist")
    cl = camp.set_check(s, ca, "profile_switched", True)
    it = next(i for i in cl["items"] if i["key"] == "profile_switched")
    check(it["done_at"] and cl["history"][-1]["action"] == "done", "a checklist step records when it was done")
    cl = camp.set_check(s, ca, "profile_switched", False)
    check(next(i for i in cl["items"] if i["key"] == "profile_switched")["done_at"] is None and len(cl["history"]) == 2,
          "a step can be undone; the history keeps both events")
    camp.start(s, ca)
    d = camp.to_dict(s, ca)
    check(d["status"] == "active" and d["started_at"] and d["checklist_open"] == 3, "starting works with open steps, and shows them (never blocks)")
    cb = camp.create(s, name="EU agencies", type="agency", region="EU", month=None, offer=None)
    cn = camp.create(s, name="Medicine Dec", type="niche", region="US/CA", month="2026-12", offer="free mini-audit")
    ca_id, cb_id, cn_id = ca.id, cb.id, cn.id

# ── 5. import ─────────────────────────────────────────────────────────────────
def run(cid, raw, name="lh-Example-Instance-#111 at 2026.csv", dry=False, **kw):
    with Session(eng) as s:
        return lm.run_import(s, s.get(mdb.MetroCampaign, cid), raw, filename=name, dry_run=dry, **kw)


def n_leads(cid=None):
    with Session(eng) as s:
        q = s.query(mdb.MetroLead)
        return (q.filter_by(campaign_id=cid) if cid else q).count()


batch = [
    person(1, invited_date_iso="2026-03-10T15:55:48Z", email="p1@example-agency1.com", email_type="business"),
    person(2, member_distance="DISTANCE_1", connected_at="2026.03.24", invited_date_iso="2026-03-10T15:55:48Z"),
    person(3),
    person(4, headline="Freelance PPC consultant", current_company="Freelance", current_company_position="Freelancer"),
    person(5, location_name="Berlin, Germany"),
    person(6, member_id="", profile_url="", email="", full_name="", first_name="", last_name=""),                    # nothing to identify
    person(3),                                                                            # same person twice in the file
]
raw = to_csv(batch, ";")
dry = run(ca_id, raw, dry=True)
check(n_leads() == 0, "a dry run writes nothing")
check(dry["rows_read"] == 7 and dry["added"] == 5 and dry["invalid"] == 1 and dry["duplicate_in_file"] == 1,
      f"dry run counts: 7 rows, 5 new, 1 invalid, 1 duplicate in file (got {dry['added']}/{dry['invalid']}/{dry['duplicate_in_file']})")
real = run(ca_id, raw)
check(real["added"] == 5 and n_leads(ca_id) == 5 and real["import_id"], "the real import adds the same 5")
check(real["invite"] == {"none": 3, "invited": 1, "connected": 1} and real["with_email"] == 1, f"invite states and email counted ({real['invite']})")
check(real["junk"] == 1 and real["persona"]["junk"] == 1, "the freelancer is marked junk")
with Session(eng) as s:
    l1 = s.query(mdb.MetroLead).filter_by(member_id="900001").one()
    check(l1.email == "p1@example-agency1.com" and l1.email_source == "linkedhelper" and l1.email_verified is False,
          "an email from the export is used first, marked linkedhelper, not yet verified")
    check(l1.list_source == "Linked Helper Example Instance #111" and l1.invite_status == "invited", "list source label and status stored")
    l4 = s.query(mdb.MetroLead).filter_by(member_id="900004").one()
    check(l4.status == "junk" and "junk" in json.loads(l4.score_notes_json)["persona"]["reasons"][0], "a junk lead is kept (not deleted) with its reason")
    check(s.query(mdb.MetroImport).count() == 1 and "Person" not in (s.query(mdb.MetroImport).one().result_json or ""),
          "the import audit row holds counts, no lead names")
again = run(ca_id, raw)
check(again["added"] == 0 and again["updated"] == 0 and again["duplicate"] == 5 and n_leads(ca_id) == 5,
      f"re-importing the same file adds nothing (added {again['added']}, updated {again['updated']})")
check(again["same_file_imported_before"] is True, "the repeat is recognised as the same file")

# status only moves forward
fwd = [person(3, invited_date_iso="2026-04-01T10:00:00Z", member_distance="DISTANCE_1", connected_at="2026.04.05", email="p3@example-agency3.com")]
r2 = run(ca_id, to_csv(fwd))
check(r2["added"] == 0 and r2["updated"] == 1, "a later export of the same person updates their status")
with Session(eng) as s:
    l3 = s.query(mdb.MetroLead).filter_by(member_id="900003").one()
    check(l3.invite_status == "connected" and l3.email == "p3@example-agency3.com", "none -> connected, a missing email filled")
back = [person(3, invited_date_iso="", member_distance="DISTANCE_3", email="")]
check(run(ca_id, to_csv(back))["updated"] == 0, "status never moves backwards")

# dedup keys: profile URL only, email only, name + company only
with Session(eng) as s:
    base = n_leads()
variants = [
    person(1, member_id=""),                                                                   # profile URL matches
    person(2, member_id="", profile_url="", email="p2@example-agency2.com", full_name="Other Human", first_name="Other", last_name="Human", current_company="Other Co"),   # no key in common -> new person
    person(7, member_id="", profile_url="", email="p1@example-agency1.com", full_name="Someone Else", current_company="Elsewhere Inc"),   # email matches p1
    person(8, member_id="", profile_url="", full_name="Example Person5", current_company="Example Agency 5 LLC"),   # name + company matches p5
]
rv = run(ca_id, to_csv(variants))
check(rv["duplicate"] == 3 and rv["added"] == 1, f"dedup by profile URL, email, name + company (dup {rv['duplicate']}, new {rv['added']})")

# name + company is the weakest key: two different LinkedIn accounts are two people
twins = [person(20, full_name="Same Name", current_company="Twin Co"), person(21, full_name="Same Name", current_company="Twin Co")]
rt = run(ca_id, to_csv(twins))
check(rt["added"] == 2 and rt["same_name_other_profile"] >= 1 and rt["duplicate_in_file"] == 0,
      "same name at the same company but different member ids / profiles: both kept, and counted for a human to look at")
rt2 = run(ca_id, to_csv([person(22, full_name="Same Name", current_company="Twin Co", member_id="", profile_url="")]))
check(rt2["duplicate"] == 1 and rt2["added"] == 0, "same name + company with no member id or profile to tell them apart is a duplicate")

# other campaign: same person, same company
cross = [person(1), person(50, current_company="Example Agency 2 LLC", full_name="Colleague Two", member_id="900050",
                       profile_url="https://www.linkedin.com/in/example-person-50"), person(60)]
rc = run(cb_id, to_csv(cross))
check(rc["in_other_campaign"] == 1 and rc["in_other_campaign_by"] == {"US agencies": 1}, "a person already in another campaign is skipped")
check(rc["company_in_other_campaign"] == 1 and rc["added"] == 1, "a colleague of a company already in another campaign is skipped too")
with Session(eng) as s:
    cp_id = camp.create(s, name="Paused one", type="agency", region="US/CA", month=None, offer=None).id
with Session(eng) as s:
    s.get(mdb.MetroCampaign, ca_id).status = "paused"
    s.commit()
check(run(cp_id, to_csv([person(3)]), dry=True)["in_other_campaign"] == 1, "a paused campaign still holds its leads")
with Session(eng) as s:
    s.get(mdb.MetroCampaign, ca_id).status = "done"
    s.commit()
check(run(cp_id, to_csv([person(3)]), dry=True)["in_other_campaign"] == 1, "a finished campaign's leads are not re-imported either")
with Session(eng) as s:
    s.get(mdb.MetroCampaign, ca_id).status = "active"
    s.commit()

# suppression: marked, never deleted
with Session(eng) as s:
    sup.add_entries(s, [{"kind": "member_id", "value": "900101", "reason": "already contacted"},
                        {"kind": "domain", "value": "blocked-co.com", "reason": "client"},
                        {"kind": "company", "value": "Client Studio Inc", "reason": "client"},
                        {"kind": "email", "value": "dead@example.org", "reason": "bounce"}], source="t")
sl = [person(101), person(102, email="x@blocked-co.com"), person(103, current_company="Client Studio, Inc."),
      person(104, email="dead@example.org"), person(105, current_company="Fine Co")]
rs = run(cn_id, to_csv(sl))
check(rs["suppressed"] == 4 and rs["added"] == 5, f"4 suppressed people are stored and marked, not skipped (got {rs['suppressed']})")
with Session(eng) as s:
    got = {l.member_id: l for l in s.query(mdb.MetroLead).filter_by(campaign_id=cn_id).all()}
    check(all(got[m].status == "suppressed" and got[m].suppressed_reason for m in ("900101", "900102", "900103", "900104")),
          "each carries status suppressed and its reason")
    check(got["900105"].status == "new", "a person not on the list is a normal lead")
sid = None
with Session(eng) as s:
    sid = s.query(mdb.MetroLead).filter_by(member_id="900101").one().id
from metro.router import router                # noqa: E402
app = FastAPI()
app.include_router(router)
c = TestClient(app)
check(c.patch(f"/metro/leads/{sid}", json={"decision": "keep"}).status_code == 400, "a suppressed lead cannot be un-suppressed from the leads table")

# Upwork is refused as a source
for src_name, src_label in (("upwork_clients.csv", None), ("x.csv", "Upwork export")):
    try:
        run(cn_id, to_csv([person(300)]), name=src_name, list_source=src_label, dry=True); ok = False
    except ValueError as e:
        ok = "Upwork" in str(e)
    check(ok, f"a source that names Upwork is refused ({src_name!r}, {src_label!r})")
try:
    run(cn_id, b"foo,bar\n1,2\n"); ok = False
except ValueError:
    ok = True
check(ok, "a CSV with no recognisable identity column is refused")

# ── 6. rescore, rules, keep anyway ────────────────────────────────────────────
with Session(eng) as s:
    junk = s.query(mdb.MetroLead).filter_by(member_id="900004").one()
    jid = junk.id
r = c.patch(f"/metro/leads/{jid}", json={"decision": "keep"}).json()
check(r["status"] == "new" and r["persona_locked"] is True, '"keep anyway" restores a junk lead and locks the decision')
rules = c.get("/metro/persona-rules").json()["rules"]
rules["junk_title"] = rules["junk_title"] + ["founder"]
check(c.put("/metro/persona-rules", json=rules).status_code == 200, "rules save through the API")
check(c.put("/metro/persona-rules", json={"junk_title": "x"}).status_code == 400, "bad rules are refused")
resc = c.post(f"/metro/campaigns/{ca_id}/rescore").json()
with Session(eng) as s:
    founders = s.query(mdb.MetroLead).filter_by(campaign_id=ca_id, status="junk").count()
    check(founders >= 3 and s.get(mdb.MetroLead, jid).status == "new", f"rescoring applies the new rules; the locked lead stays ({founders} junk now)")
rules["junk_title"].remove("founder")
c.put("/metro/persona-rules", json=rules)
c.post(f"/metro/campaigns/{ca_id}/rescore")
with Session(eng) as s:
    check(s.query(mdb.MetroLead).filter_by(campaign_id=ca_id, status="junk").count() == 0, "putting the rule back and rescoring restores them")

# ── 7. API ────────────────────────────────────────────────────────────────────
r = c.post("/metro/campaigns", json={"name": "API camp", "type": "niche", "month": "2027-01"})
check(r.status_code == 200 and r.json()["status"] == "draft", "POST /metro/campaigns")
aid = r.json()["id"]
check(c.post("/metro/campaigns", json={"name": "", "type": "niche"}).status_code == 400, "an empty name is a 400")
check(c.get("/metro/campaigns/999").status_code == 404, "an unknown campaign is a 404")
up = c.post(f"/metro/campaigns/{aid}/import", files={"file": ("lh-Artem-X-#1 at z.csv", io.BytesIO(to_csv([person(700), person(701)])), "text/csv")})
check(up.status_code == 200 and up.json()["dry_run"] is True and n_leads(aid) == 0, "the upload is a dry run by default")
up = c.post(f"/metro/campaigns/{aid}/import?dry_run=false&list_source=Seat%20A", files={"file": ("a.csv", io.BytesIO(to_csv([person(700), person(701)])), "text/csv")})
check(up.json()["added"] == 2 and up.json()["list_source"] == "Seat A", "the real import takes the list source you typed")
lst = c.get(f"/metro/leads?campaign_id={aid}&q=person700").json()
check(lst["total"] == 1 and lst["leads"][0]["list_source"] == "Seat A" and lst["counts"].get("new") == 2, "GET /metro/leads filters and counts")
pl = c.get(f"/metro/campaigns/{aid}/pipeline").json()
check(pl["import"]["leads"] == 2 and pl["enrich"]["ready"] == 2 and pl["write"]["live"] is True and pl["write"]["ready"] == 0
      and pl["send"]["live"] is False and pl["send"]["ready"] == 0,
      "pipeline cards: Import live, Enrich counts the ready leads, Write live from Phase 3 (nothing shortlisted yet), Send not live yet")
check(c.get(f"/metro/campaigns/{aid}/imports").json()["imports"][0]["result"]["added"] == 2, "import history keeps its counts")
check(c.post(f"/metro/campaigns/{aid}/start").json()["status"] == "active", "POST start")
ck = c.post(f"/metro/campaigns/{aid}/checklist/featured_swapped", json={"done": True}).json()
check(ck["checklist_open"] == 2 and c.post(f"/metro/campaigns/{aid}/checklist/nope", json={"done": True}).status_code == 404,
      "checklist step done through the API; an unknown step is a 404")

# ── 8. Upwork-derived suppression candidates ──────────────────────────────────
with Session(eng) as s:
    s.add_all([
        app_db.Job(id=1, raw_message="", title="Ads for a clinic", upwork_job_id="~01aaa", client_country="United States",
                   description_full="Our site is www.smile-dental.com and google.com"),
        app_db.Job(id=2, raw_message="", title="SEO", upwork_job_id="~01bbb", client_country="Germany", description_full="brand-x.de"),
    ])
    s.flush()
    s.add_all([app_db.Proposal(id=1, job_id=1, sent_text="x", status="replied", client_reply_text="write to team@smile-dental.com"),
               app_db.Proposal(id=2, job_id=2, sent_text="y", status="hired", client_reply_text="we are at keep-this.com")])
    s.commit()
    supp0 = s.query(mdb.MetroSuppression).count()
    r1 = cand.refresh_from_proposals(s)
    check(r1["added"] == 3, f"refresh proposes the domains named by engaged clients ({r1})")
    check(s.query(mdb.MetroSuppression).count() == supp0, "proposing suppresses NOTHING")
    check(not any(x["kind"] == "upwork_job" for x in cand.listing(s)) and s.query(mdb.MetroSuppression).filter_by(kind="upwork_job").count() == 0,
          "the upwork_job ids are not proposed and not imported")
    check(cand.refresh_from_proposals(s)["added"] == 0, "refresh is idempotent")
    lst = {x["value"]: x for x in cand.listing(s)}
    check({"smile-dental.com", "keep-this.com", "brand-x.de"} == set(lst), "candidate list has the domains")
    cid_a, cid_r = lst["smile-dental.com"]["id"], lst["keep-this.com"]["id"]
    cand.decide(s, cid_r, "reject")
    check(s.query(mdb.MetroSuppression).filter_by(kind="domain", value="keep-this.com").count() == 0, "a rejected domain is not suppressed")
    cand.refresh_from_proposals(s)
    check(next(x for x in cand.listing(s) if x["value"] == "keep-this.com")["decision"] == "rejected", "a rejection is remembered across refreshes")
    cand.decide(s, cid_a, "approve")
    e = s.query(mdb.MetroSuppression).filter_by(kind="domain", value="smile-dental.com").one()
    check(e.scope == "company", "an approved domain becomes a company-scope suppression entry")
    try:
        cand.decide(s, cid_a, "reject"); ok = False
    except ValueError:
        ok = True
    check(ok, "an approved entry cannot be flipped back through the API")
    check(s.query(mdb.MetroLead).count() == n_leads(), "no lead was created from Upwork data")
check(c.get("/metro/suppression/candidates").status_code == 200 and c.post("/metro/suppression/candidates/refresh").status_code == 200,
      "candidate routes answer")
rr = c.post(f"/metro/suppression/candidates/{cid_r}/decision", json={"decision": "approve"})
check(rr.status_code == 200 and rr.json()["decision"] == "approved", "a rejected candidate can still be approved later")

# ── 9. boundaries (static) ────────────────────────────────────────────────────
for f in ("leads.py", "csvimport.py", "persona.py", "campaigns.py", "routes_p1.py"):
    src = (ROOT / "api" / "metro" / f).read_text(encoding="utf-8")
    code = re.sub(r'""".*?"""', "", src, flags=re.S)
    check(not re.search(r"\b(FROM|JOIN)\s+(jobs|proposals)\b|app_db|from\s+db\s+import|import\s+db\b", code, re.I),
          f"api/metro/{f} never reads jobs or proposals (no lead comes from Upwork)")

print("all passed" if not bad else f"{bad} FAILED")
sys.exit(1 if bad else 0)
