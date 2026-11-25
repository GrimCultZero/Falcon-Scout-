# -*- coding: utf-8 -*-
"""Metro fixes F1 (METRO_TASK.md task F1, 25 Nov 2026), on a SCRATCH database, SYNTHETIC people only.

Pinned:
  1. re-importing into a campaign FILLS every empty field of a lead it already holds (name, title, company,
     location, headline, URL forms, email), never overwrites a value that is there, status only moves
     forward, and the summary says how many were filled; layer 0 and the suppression check run again;
  2. Sales Navigator profile URLs (`/sales/people/<id>,<search>,NAME_SEARCH`) get a stable key (the part
     after the comma is dropped) and rows match across files by member id;
  3. a draft campaign can be deleted with its leads and import records (counts first); ticked leads can be
     removed; a lead with a sent message is kept; other tables, the suppression list and companies stay.
Run: python tests/metro/test_metro_fix1.py
"""
import json
import sys
import tempfile
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


tmp = Path(tempfile.mkdtemp(prefix="metro-f1-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import csvimport as ci              # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import leads as lm                  # noqa: E402
from metro import campaigns as camp            # noqa: E402
from metro import suppression as sup           # noqa: E402

mdb.set_engine(eng)


def csv_of(head, rows, delim=","):
    def q(v):
        v = str(v)
        return '"' + v.replace('"', '""') + '"' if (delim in v or '"' in v) else v
    lines = [delim.join(head)] + [delim.join(q(r.get(h, "")) for h in head) for r in rows]
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def SN(n, extra=",JWJg,NAME_SEARCH"):
    return f"https://www.linkedin.com/sales/people/ACwAAExample{n}{extra}/"


TIER_A_HEAD = ["profile_url", "full_name", "headline", "current_company", "location_name", "member_id"]
# the real Linked Helper "Profiles to process" shape: ids and a Sales Navigator URL, nothing else
LH_HEAD = ["id", "id_type", "member_id", "sn_hash_id", "lh_id", "profile_url", "add_to_target_date_iso"]


def tier_a(i):
    return {"profile_url": SN(i, ",XyZ1,NAME_SEARCH"), "full_name": f"Example Person{i}", "headline": f"Founder at Example Agency {i}",
            "current_company": f"Example Agency {i}", "location_name": "Chicago, United States", "member_id": str(700000 + i)}


def lh_empty(i):
    return {"id": str(700000 + i), "id_type": "member-id", "member_id": str(700000 + i), "sn_hash_id": f"ACwAAExample{i},JWJg,NAME_SEARCH",
            "lh_id": str(6000 + i), "profile_url": SN(i), "add_to_target_date_iso": "2026-11-10T15:23:21.780Z"}


# -- 2. Sales Navigator keys -------------------------------------------------
k1, k2 = sup.normalize("profile_url", SN(1)), sup.normalize("profile_url", SN(1, ",ZZZZ,NAME_SEARCH"))
check(k1 == k2 == "linkedin.com/sales/people/acwaaexample1", f"the Sales Navigator key ignores the search suffix ({k1})")
check(sup.normalize("profile_url", "https://www.linkedin.com/in/Example-Person/") == "linkedin.com/in/example-person", "a normal /in/ URL is unchanged")
rows, headers, _ = ci.read_csv(csv_of(LH_HEAD, [lh_empty(1)]))
cols = ci.detect_cols(headers)
n = ci.normalize_row(rows[0], cols)
check(n["member_id"] == "700001" and n["profile_key"] == k1 and n["full_name"] is None,
      "a Linked Helper to-process row reads: member id and Sales Navigator URL, no name")

# -- 1. re-import fills gaps -------------------------------------------------
with Session(eng) as s:
    c_lh = camp.create(s, name="Fill test", type="agency", region="US/CA", month=None, offer=None).id


def run(cid, raw, name, dry=False):
    with Session(eng) as s:
        return lm.run_import(s, s.get(mdb.MetroCampaign, cid), raw, filename=name, dry_run=dry)


r = run(c_lh, csv_of(LH_HEAD, [lh_empty(i) for i in range(1, 6)]), "lh-Example-#1 to process.csv")
check(r["added"] == 5 and r["filled"] == 0, "the empty Linked Helper rows import as 5 nameless leads")
with Session(eng) as s:
    check(all(l.full_name is None for l in s.query(mdb.MetroLead).filter_by(campaign_id=c_lh)), "they have no names")
    l1_id = s.query(mdb.MetroLead).filter_by(member_id="700001").one().id
rows_a = [tier_a(i) for i in range(1, 9)]
d = run(c_lh, csv_of(TIER_A_HEAD, rows_a), "TierA.csv", dry=True)
check(d["filled"] == 5 and d["added"] == 3 and d["duplicate"] == 5, f"dry run: 5 filled, 3 new ({d['filled']} / {d['added']})")
with Session(eng) as s:
    check(all(l.full_name is None for l in s.query(mdb.MetroLead).filter_by(campaign_id=c_lh).all()), "a dry run writes nothing")
r = run(c_lh, csv_of(TIER_A_HEAD, rows_a), "TierA.csv")
check(r["filled"] == 5 and r["added"] == 3, "ACCEPTANCE: importing TierA fills the 5 and adds the other 3")
ff = r["filled_fields"]
check(ff.get("name") == 5 and ff.get("company") == 5 and ff.get("location") == 5, f"the summary says which fields were filled ({ff})")
with Session(eng) as s:
    l1 = s.get(mdb.MetroLead, l1_id)
    check(l1.full_name == "Example Person1" and l1.company_name == "Example Agency 1" and l1.location.startswith("Chicago")
          and l1.title == "Founder at Example Agency 1", "the nameless lead now has its name, company, location and title")
    check(l1.company_id is not None, "and a company record")
    mapped = json.loads(l1.raw_json)["mapped"]
    check(mapped["headline"] == "Founder at Example Agency 1" and mapped.get("sales_url"),
          "the headline and the Sales Navigator URL are kept in the raw data")
    check(l1.persona_verdict in ("keep", "review", "junk") and l1.persona_score is not None and l1.status in ("new", "junk"),
          "layer 0 ran again")
    check(s.query(mdb.MetroLead).filter_by(campaign_id=c_lh).count() == 8, "8 leads, no duplicates")
r = run(c_lh, csv_of(TIER_A_HEAD, rows_a), "TierA.csv")
check(r["filled"] == 0 and r["added"] == 0, "the same file again fills and adds nothing")

# never overwrite, status only forward, email fill
LH_FULL = LH_HEAD + ["full_name", "headline", "email", "invited_date_iso"]
row = {**lh_empty(2), "full_name": "A Different Name", "headline": "Something else", "email": "p2@example-agency.test",
       "invited_date_iso": "2026-11-12T10:00:00.000Z"}
r = run(c_lh, csv_of(LH_FULL, [row]), "lh-Example-#1 downloaded.csv")
with Session(eng) as s:
    l2 = s.query(mdb.MetroLead).filter_by(member_id="700002").one()
    check(l2.full_name == "Example Person2", "a name that is already there is never overwritten")
    check(l2.email == "p2@example-agency.test" and l2.invite_status == "invited" and l2.invited_at,
          "an empty email is filled and the status moved forward")
    check(r["filled"] == 1 and r["filled_fields"] == {"email": 1}, f"only the email was filled ({r['filled_fields']})")
run(c_lh, csv_of(LH_FULL, [{**lh_empty(2), "full_name": "", "invited_date_iso": ""}]), "lh-Example-#1 again.csv")
with Session(eng) as s:
    check(s.query(mdb.MetroLead).filter_by(member_id="700002").one().invite_status == "invited", "status never moves backwards")

# a person's own decision survives a fill
with Session(eng) as s:
    c2 = camp.create(s, name="Lock test", type="agency", region="US/CA", month=None, offer=None).id
run(c2, csv_of(["member_id", "profile_url"], [{"member_id": "710001", "profile_url": SN(91)}]), "x.csv")
with Session(eng) as s:
    l = s.query(mdb.MetroLead).filter_by(member_id="710001").one()
    l.persona_locked, l.status = True, "junk"
    s.commit()
run(c2, csv_of(TIER_A_HEAD, [{**tier_a(91), "member_id": "710001"}]), "TierA2.csv")
with Session(eng) as s:
    l = s.query(mdb.MetroLead).filter_by(member_id="710001").one()
    check(l.full_name == "Example Person91" and l.status == "junk" and l.persona_locked,
          "a person's own decision (locked junk) survives a fill")

# a company that is a client is found only after the fill: hard suppression applies to the filled lead
with Session(eng) as s:
    sup.add_entries(s, [{"kind": "company", "value": "Example Agency 93", "scope": "company", "reason": "client"}],
                    source="test", strength="hard")
    s.commit()
    c5 = camp.create(s, name="Suppress after fill", type="agency", region="US/CA", month=None, offer=None).id
run(c5, csv_of(["member_id", "profile_url"], [{"member_id": "700093", "profile_url": SN(93)}]), "y.csv")
run(c5, csv_of(TIER_A_HEAD, [tier_a(93)]), "TierA3.csv")
with Session(eng) as s:
    l = s.query(mdb.MetroLead).filter_by(member_id="700093").one()
    check(l.status == "suppressed" and l.suppressed_reason, "a lead whose company turns out to be on the hard list is suppressed once the company is filled in")

# -- 3. delete a draft campaign, remove ticked leads --------------------------
from metro.router import router                # noqa: E402
app = FastAPI()
app.include_router(router)
cl = TestClient(app)
with Session(eng) as s:
    n_sup = s.query(mdb.MetroSuppression).count()
    n_comp = s.query(mdb.MetroCompany).count()
    ids = [l.id for l in s.query(mdb.MetroLead).filter_by(campaign_id=c_lh).order_by(mdb.MetroLead.id).all()]
    s.add(mdb.MetroHook(lead_id=ids[0], fact="x", source_field="f", seen_at=mdb.utcnow()))
    s.add(mdb.MetroTouch(lead_id=ids[1], cycle=1, step=1, channel="linkedin", status="draft"))
    s.add(mdb.MetroTouch(lead_id=ids[3], cycle=1, step=1, channel="linkedin", status="sent"))
    s.commit()
pv = cl.get(f"/metro/campaigns/{c_lh}/delete-preview").json()
check(pv["leads"] == 8 and pv["imports"] >= 4 and pv["hooks"] == 1 and pv["touches"] == 2 and pv["deletable"], f"the preview shows the counts ({pv})")
r = cl.post(f"/metro/campaigns/{c_lh}/leads/remove", json={"lead_ids": [ids[0], ids[2], ids[3], 99999], "dry_run": True}).json()
check(r == {"asked": 4, "removed": 2, "not_in_campaign": 1, "kept_with_history": 1, "dry_run": True}, f"remove (dry run) reports ({r})")
with Session(eng) as s:
    check(s.query(mdb.MetroLead).filter_by(campaign_id=c_lh).count() == 8, "a dry run removes nothing")
r = cl.post(f"/metro/campaigns/{c_lh}/leads/remove", json={"lead_ids": [ids[0], ids[2], ids[3]]}).json()
with Session(eng) as s:
    left = {l.id for l in s.query(mdb.MetroLead).filter_by(campaign_id=c_lh).all()}
    check(r["removed"] == 2 and r["kept_with_history"] == 1 and ids[0] not in left and ids[2] not in left and ids[3] in left,
          "ticked leads are removed; the one with a sent message stays")
    check(s.query(mdb.MetroHook).filter_by(lead_id=ids[0]).count() == 0, "a removed lead's hooks go with it")
check(cl.delete(f"/metro/campaigns/{c_lh}").status_code == 409, "a draft campaign holding a lead with a sent message is not deleted")
with Session(eng) as s:
    s.query(mdb.MetroTouch).filter_by(lead_id=ids[3]).delete()
    s.commit()
with Session(eng) as s:
    c3 = camp.create(s, name="Active one", type="agency", region="US/CA", month=None, offer=None)
    camp.start(s, c3)
    c3_id = c3.id
check(cl.delete(f"/metro/campaigns/{c3_id}").status_code == 409, "an active campaign cannot be deleted")
r = cl.delete(f"/metro/campaigns/{c_lh}")
check(r.status_code == 200 and r.json()["deleted"] and r.json()["leads"] == 6, f"the draft is deleted with its leads ({r.json()})")
with Session(eng) as s:
    check(s.get(mdb.MetroCampaign, c_lh) is None and s.query(mdb.MetroLead).filter_by(campaign_id=c_lh).count() == 0
          and s.query(mdb.MetroImport).filter_by(campaign_id=c_lh).count() == 0, "campaign, leads and import records are gone")
    check(s.query(mdb.MetroSuppression).count() == n_sup and s.query(mdb.MetroCompany).count() == n_comp,
          "the suppression list and the companies are untouched")
    check(s.get(mdb.MetroCampaign, c2) is not None and s.query(mdb.MetroLead).filter_by(campaign_id=c2).count() == 1,
          "another campaign is untouched")
with Session(eng) as s:
    c4 = camp.create(s, name="Redo", type="agency", region="US/CA", month=None, offer=None).id
r1 = run(c4, csv_of(TIER_A_HEAD, rows_a), "TierA.csv")
r2 = run(c4, csv_of(LH_HEAD, [lh_empty(i) for i in range(1, 6)]), "lh to process.csv")
check(r1["added"] >= 7 and r2["added"] == 0 and r2["duplicate"] >= 4,
      f"redo: TierA first, then the Linked Helper rows match by member id ({r1['added']} added, {r2['duplicate']} matched)")


# -- 5 and 6. what you see runs; batches of the best not yet enriched ----------
from metro import enrich as en                 # noqa: E402
from metro import scoring as sc                # noqa: E402

TIER = [tier_a(i) for i in range(101, 131)]
for i, r_ in enumerate(TIER):                  # a mix of titles so the persona verdicts differ
    r_["headline"] = "Founder at " + r_["current_company"] if i % 3 else "Student at " + r_["current_company"]
with Session(eng) as s:
    c6 = camp.create(s, name="Batch test", type="agency", region="US/CA", month=None, offer=None).id
run(c6, csv_of(TIER_A_HEAD, TIER), "TierA-30.csv")
q = f"/metro/leads?campaign_id={c6}"
allr = cl.get(q + "&limit=500").json()
check(allr["total"] == 30, "30 leads in the batch campaign")
ids_all = cl.get(f"/metro/leads/ids?campaign_id={c6}").json()
check(ids_all["total"] == 30 and len(ids_all["ids"]) == 30 and not ids_all["truncated"], "the ids route returns every id the filters show")
kept = cl.get(f"/metro/leads/ids?campaign_id={c6}&verdict=keep").json()
check(0 < kept["total"] < 30 and set(kept["ids"]) <= set(ids_all["ids"]), f"it follows the filters ({kept['total']} keep)")

# an explicit EMPTY list must act on nothing, never on the whole campaign
with Session(eng) as s:
    check(sc.score_campaign(s, s.get(mdb.MetroCampaign, c6), lead_ids=[])["scored"] == 0, "score with an empty scope scores nothing (not the whole campaign)")
    check(sc.score_campaign(s, s.get(mdb.MetroCampaign, c6), lead_ids=ids_all["ids"][:4])["scored"] == 4, "score with a scope runs on those leads")
check(en.start_run(c6, [], fetch=lambda u: (404, u, ""), get_json=lambda u: (404, u, ""), ask=None, use_ai=False, background=False,
                   sleep=lambda x: None)["total"] == 0, "enrich with an empty scope runs on no company (not the whole campaign)")
r = cl.post(f"/metro/campaigns/{c6}/deep", json={"lead_ids": []}).json()
check(r["shortlisted_considered"] == 0, "queue-deep with an empty scope considers nobody")
r = cl.post(f"/metro/campaigns/{c6}/hooks", json={"lead_ids": []}).json()
check(r.get("started") is False, "hooks with an empty scope start nothing")
r = cl.post(f"/metro/campaigns/{c6}/rescore", json={"lead_ids": []}).json()
check(r in ({}, {"changed": 0}) or sum(r.values()) == 0, "rescore with an empty scope touches nothing")
sc_ids = ids_all["ids"][:5]
st_ = en.start_run(c6, sc_ids, fetch=lambda u: (404, u, ""), get_json=lambda u: (404, u, ""), ask=None, use_ai=False, background=False,
                   sleep=lambda x: None)
check(st_["total"] <= 5, f"enrich with 5 ids runs on at most those 5 companies ({st_['total']})")

# "Enrich next N": the best-scored not enriched yet, keep first, in the chosen sort
rem0 = cl.get(f"/metro/leads?campaign_id={c6}&status=new&enriched=no&limit=1").json()["total"]
nxt = cl.get(f"/metro/leads?campaign_id={c6}&status=new&enriched=no&keep_first=true&sort=persona&limit=7").json()["leads"]
check(len(nxt) == 7 and all(l["status"] == "new" for l in nxt), "the batch takes the next 7 usable leads that are not enriched yet")
verd = [l["persona_verdict"] for l in nxt]
check(verd == sorted(verd, key=lambda v: v != "keep"), f"persona keep comes first ({verd})")
sc_ = [l["persona_score"] for l in nxt if l["persona_verdict"] == "keep"]
check(sc_ == sorted(sc_, reverse=True), "and within that, the best score first")
done = en.start_run(c6, [l["id"] for l in nxt], fetch=lambda u: (404, u, ""), get_json=lambda u: (404, u, ""), ask=None, use_ai=False,
                    background=False, sleep=lambda x: None)
rem1 = cl.get(f"/metro/leads?campaign_id={c6}&status=new&enriched=no&limit=1").json()["total"]
check(done["total"] == 7 and rem1 == rem0 - 7, f"after the batch {rem1} remain ({rem0} - 7); the same companies are never picked again")
nxt2 = cl.get(f"/metro/leads?campaign_id={c6}&status=new&enriched=no&keep_first=true&limit=7").json()["leads"]
check(not ({l["id"] for l in nxt} & {l["id"] for l in nxt2}), "the next batch holds different leads")
yes = cl.get(f"/metro/leads?campaign_id={c6}&enriched=yes&limit=500").json()["total"]
check(yes >= 7, f"enriched=yes lists the ones already tried ({yes})")


# -- 9. the niche brief is drafted, checked, and never saved ----------------------
from metro import briefdraft as bd             # noqa: E402
from sqlalchemy import text as sqltext          # noqa: E402

with Session(eng) as s:
    s.execute(sqltext("INSERT INTO kb_entries (type, title, content, tags, source_url, is_core) VALUES "
                      "('case_study', '[Case Study] SEO for a dental clinic', 'x', 'auto_imported, SEO, Dentistry', 'https://itforce.ua/cases/dental/', 0),"
                      "('case_study', '[Case Study] Ads for a flower shop', 'x', 'auto_imported, PPC, Flowers', 'https://itforce.ua/cases/flowers/', 0),"
                      "('note', 'not a case', 'x', 'Secret', NULL, 0)"))
    s.commit()
    cat = bd.catalogue(s)
    check(len(cat) == 2 and cat[0]["tags"] == ["SEO", "Dentistry"] and cat[0]["title"] == "SEO for a dental clinic", "the catalogue reads the KB's case studies only")
    ids_ = {c["title"]: c["id"] for c in cat}
    seen_prompt = []

    def fake_ask(prompt, **kw):
        seen_prompt.append(prompt)
        return json.dumps({"who": "Owners of dental clinics", "pains": ["Few new patients from search", "Ads that burn budget", "Cut 40% of costs"],
                           "case_tags": ["Dentistry", "Invented Tag"], "case_ids": [ids_["SEO for a dental clinic"], 99999],
                           "offer": "A free mini-audit of your Google Ads"})
    n_camp = s.query(mdb.MetroCampaign).count()
    d_ = bd.draft(s, "dental clinics, US", "US/CA", ask=fake_ask)
    check("dental clinics, US" in seen_prompt[0] and "SEO for a dental clinic" in seen_prompt[0], "the model is given the niche and the case studies")
    check(d_["case_tags"] == ["Dentistry"], "a tag that is not in the KB is dropped")
    check(d_["case_studies"] == [{"title": "SEO for a dental clinic", "url": "https://itforce.ua/cases/dental/"}], "case studies come from the KB by id; an unknown id is dropped")
    check(d_["pains"] == ["Few new patients from search", "Ads that burn budget"], "a pain with a figure is dropped")
    check(set(bd.STANDING_DO_NOT_CLAIM) <= set(d_["do_not_claim"]) and d_["saved"] is False and len(d_["dropped"]) == 3,
          f"the standing do-not-claim list is added; the drops are reported ({len(d_['dropped'])})")
    check(s.query(mdb.MetroCampaign).count() == n_camp, "nothing is saved by drafting")
    try:
        bd.draft(s, "  ", ask=fake_ask)
        ok_ = False
    except ValueError:
        ok_ = True
    check(ok_, "an empty niche is refused before any model call")

print("all passed" if not bad else f"{bad} FAILED")
sys.exit(1 if bad else 0)
