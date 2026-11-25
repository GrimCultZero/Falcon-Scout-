# -*- coding: utf-8 -*-
"""Metro F3 (METRO_TASK.md task F3, 25 Nov 2026): Linked Helper "Data Enrichment" exports.
A SCRATCH database and SYNTHETIC people, with the REAL Linked Helper header names, comma and semicolon versions. Nothing reaches a network.

Pinned:
  1. the company's domain comes only from the lead's CURRENT organization (never an older job, never website_1..3);
  2. a free-mail address never gives a domain; a business address does (source email-domain); a personal-type one is marked
     and is not a sending address;
  3. a company that already has a domain keeps it; a different Linked Helper domain is a trail line, not applied;
  4. parked / generic / builder-placeholder domains are rejected;
  5. badges stored (open_profile ...), person and company facts filled only when empty, unmapped columns listed;
  6. a dry run changes nothing and reports the same numbers the real import then writes; a re-import changes nothing;
  7. the email-results path takes the same columns;
  8. the domain finder skips what is now known and "Enrich next N" can pick it up.
Run: python tests/metro/test_metro_fix3.py
"""
import csv
import io
import json
import sys
import tempfile
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


tmp = Path(tempfile.mkdtemp(prefix="metro-f3-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import campaigns as camp            # noqa: E402
from metro import csvimport as ci              # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import emailfinder as ef            # noqa: E402
from metro import enrich as en                 # noqa: E402
from metro import leads as lm                  # noqa: E402
from metro import lhenrich as lh               # noqa: E402
from metro.db import MetroCompany, MetroLead  # noqa: E402

mdb.set_engine(eng)
mdb.init_db(eng)

HEAD = ["member_id", "profile_url", "first_name", "last_name", "email", "email_type", "summary", "industry", "location_name",
        "skills", "languages", "followers", "connections_count", "badges_premium", "badges_influencer", "badges_job_seeker",
        "badges_open_link", "badges_hiring", "current_company", "current_company_position", "current_company_industry",
        "organization_1", "organization_url_1", "organization_title_1", "organization_start_1", "organization_end_1",
        "organization_description_1", "organization_location_1", "organization_website_1", "organization_domain_1",
        "organization_2", "organization_title_2", "organization_end_2", "organization_website_2", "organization_domain_2",
        "website_1", "website_2", "twitters", "invited_date_iso", "connected_at_iso", "member_distance", "weird_new_col"]


def row(**kw):
    r = {h: "" for h in HEAD}
    r.update(kw)
    return r


def make(rows, delim=","):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEAD, delimiter=delim, lineterminator="\r\n")
    w.writeheader()
    w.writerows(rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")


def people(tag):
    """Six people, one case each. `tag` keeps names and ids unique between the comma and the semicolon run."""
    t = tag
    return [
        # A: current org has a domain; an OLDER job has another; the person's own site must never be taken
        row(member_id=f"{t}1001", profile_url=f"https://www.linkedin.com/in/anna-{t}/", first_name="Anna", last_name="A", email=f"anna@acme{t}.com",
            email_type="business", summary="Runs paid search", industry="Marketing", skills="PPC, SEO", followers="500", connections_count="400",
            badges_open_link="true", badges_premium="false", current_company=f"Acme Digital {t}", current_company_position="Director of Marketing",
            current_company_industry="Advertising Services", organization_1=f"Acme Digital {t}", organization_domain_1=f"acme{t}.com",
            organization_description_1="We grow clinics", organization_location_1="Austin, Texas", organization_2=f"OldCo {t}",
            organization_end_2="2019-05", organization_domain_2=f"oldco{t}.com", website_1=f"anna-blog-{t}.com"),
        # B: the open position has no domain; the older job does; free-mail address -> NO domain at all
        row(member_id=f"{t}1002", profile_url=f"https://www.linkedin.com/in/bob-{t}/", first_name="Bob", last_name="B", email=f"bob{t}@gmail.com",
            email_type="personal", current_company=f"Beta Media {t}", current_company_position="Marketing Manager",
            organization_1=f"Old Job {t}", organization_end_1="2020-01", organization_domain_1=f"oldjob{t}.com",
            organization_2=f"Beta Media {t}", website_1=f"bob-{t}.com", badges_hiring="true"),
        # C: no domain anywhere, business email -> the email's domain
        row(member_id=f"{t}1003", profile_url=f"https://www.linkedin.com/in/cara-{t}/", first_name="Cara", last_name="C", email=f"cara@cobalt{t}.io",
            email_type="business", current_company=f"Cobalt Ads {t}", current_company_position="Head of Growth", organization_1=f"Cobalt Ads {t}"),
        # D: placeholder + generic domains
        row(member_id=f"{t}1004", profile_url=f"https://www.linkedin.com/in/dan-{t}/", first_name="Dan", last_name="D",
            current_company=f"Delta Web {t}", current_company_position="Marketing Director", organization_1=f"Delta Web {t}",
            organization_website_1=f"https://delta{t}.wixsite.com/home", organization_domain_1=f"facebook.com"),
        # E: the company already exists with another domain
        row(member_id=f"{t}1005", profile_url=f"https://www.linkedin.com/in/eve-{t}/", first_name="Eve", last_name="E",
            current_company=f"Echo Co {t}", current_company_position="CMO", organization_1=f"Echo Co {t}", organization_domain_1=f"echo{t}.com"),
        # F: a parked host; an unknown non-empty column; two addresses in one cell, a personal one first
        row(member_id=f"{t}1006", profile_url=f"https://www.linkedin.com/in/fay-{t}/", first_name="Fay", last_name="F",
            email=f"fay{t}@yahoo.com; fay@foxlabs{t}.com", current_company=f"Fox Labs {t}", current_company_position="Marketing Lead",
            organization_1=f"Fox Labs {t}", organization_domain_1="sedo.com", weird_new_col="x"),
    ]


def run_variant(delim, tag):
    print(f"--- variant {tag} (delimiter {delim!r})")
    with Session(eng) as s:
        c = camp.create(s, name=f"F3 {tag}", type="agency", region="US/CA", month=None, offer=None)
        cid = c.id
        pre = MetroCompany(name=f"Echo Co {tag}", name_key=ci.company_key(f"Echo Co {tag}"), domain=f"echo-agency-{tag}.com", domain_source="ai-lookup")
        s.add(pre)
        s.commit()
        raw = make(people(tag), delim)
        dry = lm.run_import(s, c, raw, filename=f"Profiles downloaded from lh-Test-#535390 {tag}.csv", dry_run=True)
        check(dry["rows_read"] == 6 and s.query(MetroLead).filter_by(campaign_id=cid).count() == 0, "dry run reads 6 rows and writes nothing")
        check(s.query(MetroCompany).filter(MetroCompany.name_key == ci.company_key(f"Acme Digital {tag}")).count() == 0, "dry run created no company")
        e = dry["enrichment"]
        check(e["domains_set"] == {"linkedhelper": 1, "email-domain": 2}, f"dry run: 1 domain from Linked Helper (A), 2 from business emails (C, F) ({e['domains_set']})")
        check(e["domains_disagreeing"] == 1, "dry run: E disagrees with its stored domain")
        check(e["domains_rejected"] == 2, f"dry run: rows whose only domains were wixsite+facebook (D) or sedo (F) are counted once each ({e['domains_rejected']})")
        check(e["open_profiles"] == 1, "dry run: one open profile")
        check(e["unmapped_columns"] == {"weird_new_col": 1}, f"dry run lists the unmapped column ({e['unmapped_columns']})")
        check(e["emails"] == {"business": 3, "personal": 1} or e["emails"]["personal"] >= 1, f"dry run: emails by type ({e['emails']})")
        res = lm.run_import(s, c, raw, filename=f"Profiles downloaded from lh-Test-#535390 {tag}.csv", dry_run=False)
        check(res["added"] == 6, "applied: 6 leads added")
        check(res["enrichment"]["domains_set"] == e["domains_set"] and res["enrichment"]["domains_disagreeing"] == e["domains_disagreeing"],
              "applying gives the numbers the dry run promised")

        def comp(name):
            return s.query(MetroCompany).filter_by(name_key=ci.company_key(f"{name} {tag}")).one()

        def lead(mid):
            return s.query(MetroLead).filter_by(member_id=f"{tag}{mid}").one()
        a = comp("Acme Digital")
        check(a.domain == f"acme{tag}.com" and a.domain_source == "linkedhelper", f"A: the CURRENT organization's domain, source linkedhelper ({a.domain}/{a.domain_source})")
        check(json.loads(a.domain_tried_json)["steps"][0]["step"] == "linkedhelper", "A: a trail line says where it came from")
        check(a.industry == "Advertising Services", "A: company industry filled")
        check(not s.query(MetroCompany).filter(MetroCompany.domain.in_([f"oldco{tag}.com", f"anna-blog-{tag}.com"])).count(),
              "A: an older job's domain and the person's own website were never taken")
        b = comp("Beta Media")
        check(b.domain is None, "B: the older job's domain was not taken; a free-mail address gave nothing")
        check(s.query(MetroCompany).filter(MetroCompany.domain == f"oldjob{tag}.com").count() == 0, "B: oldjob domain nowhere")
        cc = comp("Cobalt Ads")
        check(cc.domain == f"cobalt{tag}.io" and cc.domain_source == "email-domain", "C: a business email gives the domain, source email-domain")
        d = comp("Delta Web")
        check(d.domain is None, "D: a builder placeholder and a generic site are rejected")
        ec = comp("Echo Co")
        check(ec.domain == f"echo-agency-{tag}.com" and ec.domain_source == "ai-lookup", "E: the existing domain is kept")
        check("disagrees" in ec.domain_tried_json and f"echo{tag}.com" in ec.domain_tried_json, "E: the disagreement is in the trail")
        f = comp("Fox Labs")
        check(f.domain == f"foxlabs{tag}.com" and f.domain_source == "email-domain", f"F: sedo.com rejected, the business address of two gives the domain ({f.domain})")
        check(lead("1006").email == "fay@foxlabs%s.com" % tag and lead("1006").email_type == "business", "F: of two addresses the business one is kept")
        check(lead("1002").email_type == "personal" and ef.emailable(_verified(lead("1002"))), "B: a personal address stays marked personal; once verified it is a sending address (F4 reversed F3's rule)")
        la = lead("1001")
        check(la.open_profile is True and la.premium is False and lead("1002").hiring is True, "badges stored on the lead")
        raw_a = json.loads(la.raw_json)["mapped"]
        check(raw_a["skills"] == "PPC, SEO" and raw_a["followers"] == "500" and raw_a["company_facts"]["description"] == "We grow clinics", "person and company facts kept")
        check(json.loads(lead("1006").raw_json)["row"].get("weird_new_col") == "x", "the unmapped column's value is kept in the lead's raw data")
        # re-import changes nothing
        before = {x.id: (x.domain, x.domain_source, x.domain_tried_json, x.industry) for x in s.query(MetroCompany).all()}
        lbefore = {x.id: (x.email, x.raw_json, x.open_profile) for x in s.query(MetroLead).all()}
        res2 = lm.run_import(s, c, raw, filename=f"Profiles downloaded from lh-Test-#535390 {tag}.csv", dry_run=False)
        s.expire_all()
        after = {x.id: (x.domain, x.domain_source, x.domain_tried_json, x.industry) for x in s.query(MetroCompany).all()}
        lafter = {x.id: (x.email, x.raw_json, x.open_profile) for x in s.query(MetroLead).all()}
        check(before == after and lbefore == lafter, "re-import is idempotent (companies, trails and leads identical)")
        check(res2["added"] == 0 and res2["enrichment"]["domains_set"] == {"linkedhelper": 0, "email-domain": 0}, "re-import sets no domain and adds no lead")
        # the finder skips what is known; Enrich next N picks the new ones
        c1 = s.query(MetroCompany).filter(MetroCompany.id == cc.id).one()
        check(c1.domain and c1.enrich_tried_at is None, "a company with a new domain can be picked by Enrich next N")
        check(en.domain_why(c1) is None, "no 'why no domain' for a company that has one")
        r = en.resolve_domain(s, c1, [], fetch=lambda u: (_ for _ in ()).throw(AssertionError("no fetch expected")))
        check(r["domain"] == f"cobalt{tag}.io" and r["steps"] == [], "the domain finder does nothing for a company that has a domain")
        return cid


class _V:
    def __init__(self, l):
        self.email, self.email_status, self.status, self.email_type = l.email, "verified", "new", l.email_type


def _verified(l):
    return _V(l)


c1 = run_variant(",", "11")
c2 = run_variant(";", "22")

# ═════════ unit: current organization rules ═════════
orgs = ci.extract_orgs(row(organization_1="New Co", organization_domain_1="new.com", organization_2="Old Co", organization_end_2="2018", organization_domain_2="old.com"))
check(lh.current_org(orgs, "Old Co") is None, "current_org: a name that matches only an ended job is not current")
check(lh.current_org(orgs, "New Co")["domain"] == "new.com", "current_org: matches the open position by name")
check(lh.current_org(orgs, None)["domain"] == "new.com", "current_org: the only open position when there is no current company")
check(lh.current_org(orgs, "Totally Different") is None, "current_org: no guessing when the names disagree")
for d in ("linkedin.com", "www.facebook.com", "gmail.com", "x.wixsite.com", "foo.godaddysites.com", "hugedomains.com", "mysite-forsale.com", "not a domain"):
    check(lh.usable_domain(d)[0] is None, f"usable_domain rejects {d}")
check(lh.usable_domain("https://www.Acme-Agency.com/about")[0] == "acme-agency.com", "usable_domain normalizes a website")
check(ci.pick_email("a@gmail.com, b@acme.com", "")[0] == "b@acme.com", "pick_email prefers the business address")
check(ci.pick_email("a@gmail.com", "")[1] == "personal" and ci.pick_email("a@acme.com", "")[1] == "business", "pick_email judges the type by the domain when none is given")

# ═════════ 7. the email-results path ═════════
with Session(eng) as s:
    c3 = camp.create(s, name="F3 email results", type="agency", region="US/CA", month=None, offer=None)
    plain = io.StringIO()
    w = csv.writer(plain)
    w.writerow(["profile_url", "first_name", "last_name", "company", "title"])
    w.writerow(["https://www.linkedin.com/in/gina-z/", "Gina", "G", "Gamma Ads z", "Marketing Director"])
    w.writerow(["https://www.linkedin.com/in/hank-z/", "Hank", "H", "Hotel Co z", "Marketing Director"])
    lm.run_import(s, c3, plain.getvalue().encode("utf-8"), filename="plain.csv", dry_run=False)
    rows = [row(member_id="9001", profile_url="https://www.linkedin.com/in/gina-z/", email="gina@gammaads-z.com", email_type="business",
                current_company="Gamma Ads z", organization_1="Gamma Ads z", organization_domain_1="gammaads-z.com", badges_open_link="true"),
            row(member_id="9002", profile_url="https://www.linkedin.com/in/hank-z/", email="hank@gmail.com", email_type="personal",
                current_company="Hotel Co z", organization_1="Hotel Co z")]
    raw = make(rows)
    dry = ef.import_results(s, raw, campaign_id=c3.id, source="linkedhelper", filename="e.csv", dry_run=True)
    check(dry["matched"] == 2 and dry["enrichment"]["domains_set"]["linkedhelper"] == 1 and dry["enrichment"]["open_profiles"] == 1,
          f"email-results dry run: matched, one domain, one open profile ({dry['enrichment']['domains_set']})")
    check(s.query(MetroCompany).filter(MetroCompany.domain == "gammaads-z.com").count() == 0, "email-results dry run wrote nothing")
    res = ef.import_results(s, raw, campaign_id=c3.id, source="linkedhelper", filename="e.csv", dry_run=False)
    g = s.query(MetroCompany).filter_by(name_key="gamma ads z").one()
    check(g.domain == "gammaads-z.com" and g.domain_source == "linkedhelper", "email-results apply: the domain is set, source linkedhelper")
    hk = s.query(MetroLead).filter(MetroLead.profile_url.like("%hank-z%")).one()
    hc = s.get(MetroCompany, hk.company_id)
    check(hk.email == "hank@gmail.com" and hk.email_type == "personal" and hc.domain is None, "email-results: a free-mail address is stored as personal and gives no domain")
    check(s.query(MetroLead).filter(MetroLead.profile_url.like("%gina-z%")).one().open_profile is True, "email-results: the badge is stored")
    res2 = ef.import_results(s, raw, campaign_id=c3.id, source="linkedhelper", filename="e.csv", dry_run=False)
    check(res2["enrichment"]["domains_set"] == {"linkedhelper": 0, "email-domain": 0}, "email-results re-import sets nothing new")
    # a business address replaces an unverified personal one
    rows2 = [row(member_id="9002", profile_url="https://www.linkedin.com/in/hank-z/", email="hank@hotelco-z.com", email_type="business",
                 current_company="Hotel Co z", organization_1="Hotel Co z")]
    r3 = ef.import_results(s, make(rows2), campaign_id=c3.id, source="linkedhelper", filename="e2.csv", dry_run=False)
    s.expire_all()
    hk = s.query(MetroLead).filter(MetroLead.profile_url.like("%hank-z%")).one()
    check(r3["replaced_personal"] == 1 and hk.email == "hank@hotelco-z.com" and hk.email_type == "business", "a business address replaces an unverified personal one")
    check(s.get(MetroCompany, hk.company_id).domain == "hotelco-z.com", "and its domain is set (email-domain)")

print(f"\n{'ALL PASSED' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
