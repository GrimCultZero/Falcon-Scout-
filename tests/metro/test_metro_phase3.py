# -*- coding: utf-8 -*-
"""Metro Phase 3 (METRO_TASK.md P3, 26 Nov 2026): agency hooks done right, the chain writer, review and export.
A SCRATCH database, SYNTHETIC companies and people; no network, no model (every model answer is a stand-in).

Pinned:
  A. hooks are per COMPANY (written once, shared by every lead of that company) and per PERSON; a rewrite replaces the unused
     ones and keeps a hook a sent touch used;
  B. agency-forbidden hook kinds are refused IN CODE: by kind, by the fields they cite, by their words (and by a mislabelled kind);
     niche campaigns keep them; a "hiring" hook needs a named PPC / SEO role; no inference, no he / she;
  C. the evidence includes the Linked Helper extras (summary, skills, industry, followers, company description / industry /
     location); agency evidence leaves out the site audit fields; niche counts and an empty careers page are reshaped; the
     service gap is derived by code;
  D. the website scan: services by flat slug, /capabilities/, one-page headings; industries, case studies, careers + roles,
     partner badges, client logos, founded year; a scan of the older scanner is re-read;
  E. chain checks: a planted price, URL, em dash, placeholder, reused hook, exclamation, banned phrase, over-length text, a number
     that no hook carries, an agency-forbidden hook; a clean chain passes;
  F. channel order and shape: connected = LinkedIn first (3) then email; sendable email = email first; invited without email =
     LinkedIn first, waiting; nothing = email, waiting; under 2 hooks = the base chain of 3; cap 6;
  G. one primary contact per company: the best persona, then who can be reached; a company page is never primary; a held lead is
     never written; a reply from anyone stops every touch of the company;
  H. the writer end to end (a stand-in model): the case link is attached by code, the hooks are marked used, a failing chain cannot
     be approved without Send anyway (its date is stored), an edit re-checks and clears the approval;
  I. exports: the Linked Helper CSV (one custom variable per LinkedIn message) and the email CSV, approved chains only, unique names;
  J. case pages: the listing cards parse into URL, title, industry and service tags; the best case prefers PPC / SEO, outside Ukraine;
  K. the routes (leads list cells, panel, exports refuse when nothing is approved) and the scratch launcher's METRO_SELF_URL.
Run: python tests/metro/test_metro_phase3.py
"""
import csv
import io
import json
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


tmp = Path(tempfile.mkdtemp(prefix="metro-p3-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import accounts                     # noqa: E402
from metro import cases as cs                  # noqa: E402
from metro import chaincheck as cc             # noqa: E402
from metro import chains as ch                 # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import enrich as en                 # noqa: E402
from metro import evidence as evm              # noqa: E402
from metro import exports as ex                # noqa: E402
from metro import hooks as hk                  # noqa: E402
from metro import webscan as ws                # noqa: E402

mdb.set_engine(eng)
from metro.router import router                # noqa: E402
app = FastAPI()
app.include_router(router)
client = TestClient(app)
S = lambda: Session(mdb.get_engine())           # noqa: E731
DAY = datetime(2026, 11, 26, 12, 0, 0)

# ── synthetic data ─────────────────────────────────────────────────────────
SCAN = {"ok": True, "version": 2, "domain": "brightpixel.example", "signals": {"google_ads": False, "meta_pixel": False, "call_tracking": False},
        "booking": {"tool": False, "cta": True, "form": True}, "cms": "WordPress", "service_pages": 0, "location_pages": 0,
        "blog": {"found": True, "newest_post": "2024-01-02", "days_since": 700, "dated_posts": 2},
        "marketing_terms": ["seo", "web_design", "social_media"],
        "services": ["Local SEO", "Technical SEO", "Web Design", "Social Media Management", "Branding"],
        "industries": ["Dental", "Legal"], "niches": {"dental": 14, "legal": 6}, "case_studies": ["Smile Dental: 3x leads"],
        "partners": ["HubSpot Platinum Partner", "HubSpot Partner"], "client_logos": ["Smile Dental"], "founded_year": 2012,
        "team_size_text": ["team of 9"], "geo_phrases": [], "careers": {"found": True, "read": True, "url": "x", "ppc_seo_roles": []},
        "title": "Bright Pixel - SEO and Web Design for Dentists", "meta_description": "We grow dental practices.", "h1": "Dental marketing"}
ROW_FACTS = {"description": "Bright Pixel helps dental practices grow with SEO and websites.", "location": "Austin, Texas, United States",
             "industry": "Marketing & Advertising"}

with S() as s:
    agency = mdb.MetroCampaign(name="Agency test", type="agency", status="active",
                               brief_json=json.dumps({"who": "agency owners", "pains": ["too much PPC work"], "case_tags": [],
                                                      "do_not_claim": ["Top 3% of Google Partners", "Guaranteed results"]}),
                               offer="Send us one client you're struggling to deliver for, or start with a free pilot audit.")
    niche = mdb.MetroCampaign(name="Niche test", type="niche", status="active", brief_json=json.dumps({"case_tags": ["dental"]}))
    s.add_all([agency, niche])
    s.flush()
    co = mdb.MetroCompany(name="Bright Pixel", name_key="brightpixel", domain="brightpixel.example", industry="Marketing & Advertising",
                          website_scan_json=json.dumps(SCAN), website_scan_at=DAY,
                          pagespeed_json=json.dumps({"ok": True, "score": 41}), pagespeed_at=DAY,
                          ads_json=json.dumps({"ok": True, "running": True, "ads_count": 12}), ads_at=DAY)
    co2 = mdb.MetroCompany(name="Lone Agency", name_key="loneagency", domain="lone.example",
                           website_scan_json=json.dumps(dict(SCAN, domain="lone.example")), website_scan_at=DAY)
    s.add_all([co, co2])
    s.flush()

    def lead(name, title, company, persona=65, **kw):
        raw = {"mapped": {"headline": title, "summary": f"{name} has run agencies for 15 years, mostly SEO for dentists.",
                          "skills": "SEO : 40,Web Design : 22,Leadership : 3", "industry": "Marketing & Advertising", "followers": "1200",
                          "company_facts": ROW_FACTS},
               "row": {"organization_start_1": "2012-04", "position_description_1": "Runs delivery and sales."}}
        l = mdb.MetroLead(campaign_id=kw.pop("campaign_id", agency.id), company_id=company.id, full_name=name, first_name=name.split()[0],
                          last_name=name.split()[-1], title=title, company_name=company.name, location="Austin, Texas",
                          profile_url=f"https://www.linkedin.com/in/{name.lower().replace(' ', '-')}", status="new", persona_score=persona,
                          persona_verdict="keep", fit_score=70, raw_json=json.dumps(raw), source_file="t.csv", created_at=DAY, **kw)
        s.add(l)
        s.flush()
        return l.id

    ann = lead("Ann Example", "Founder at Bright Pixel", co, persona=80, invite_status="invited")
    bob = lead("Bob Example", "Head of SEO at Bright Pixel", co, persona=60, invite_status="connected")
    page = lead("Bright Pixel", "Owner at Bright Pixel", co, persona=90)                 # a company page posing as a person
    cara = lead("Cara Lone", "CEO at Lone Agency", co2, persona=70, email="cara@lone.example", email_status="domain_ok", email_type="business")
    s.commit()
    CO, CO2, AG, NI = co.id, co2.id, agency.id, niche.id

# ═════════════ C. evidence ═════════════
with S() as s:
    l, c = s.get(mdb.MetroLead, ann), s.get(mdb.MetroCompany, CO)
    ag = {e["path"]: e for e in evm.company_evidence(c, hk.colleagues(s, l), "agency")}
    ni = {e["path"]: e for e in evm.company_evidence(c, hk.colleagues(s, l), "niche")}
    pe = {e["path"]: e for e in evm.person_evidence(l)}
check(all(p in pe for p in ("person.summary", "person.skills", "person.industry", "person.followers", "person.position_description",
                            "person.current_position_since")), "person evidence carries the Linked Helper extras (summary, skills, industry, followers, position)")
check(pe["person.skills"]["value"] == "SEO, Web Design, Leadership", "skills are names, most endorsed first, without the counts")
check(all(p in ag for p in ("linkedhelper.company.description", "linkedhelper.company.location", "linkedhelper.company.industry")),
      "company evidence carries the Linked Helper company facts (description, location, industry)")
check(not any(evm.is_agency_skipped(p) for p in ag) and "website.signals.google_ads" not in ag and "pagespeed.score" not in ag
      and "website.blog.days_since" not in ag and "website.service_pages" not in ag,
      "agency evidence leaves out every site-audit field (tags, booking, blog, service / location page counts, PageSpeed)")
check("website.signals.google_ads" in ni and "pagespeed.score" in ni, "niche evidence keeps them")
check("website.services" in ag and "website.partners" in ag and "website.case_studies" in ag and "website.founded_year" in ag,
      "agency evidence has what they sell, badges, case studies, founding year")
check(ag["website.niches"]["value"] == "dental (named most often), legal" and "14" not in ag["website.niches"]["value"],
      "niche WORD COUNTS are not evidence (they read as client counts); the names, most mentioned first, are")
check(ag["website.partners"]["value"] == "HubSpot Platinum Partner", "a tierless HubSpot badge goes when the tier is named")
check(not any(p.startswith("website.careers") for p in ag), "a careers page that names no PPC / SEO role says nothing")
gap = ag.get("derived.service_gap", {}).get("value", "")
check("paid search / Google Ads" in gap and "SEO" in gap.split("cover")[1].split(";")[0], f"the service gap is derived by code: {gap}")
check(evm.service_gap({"ok": True, "services": ["PPC", "Google Ads", "SEO audits"], "marketing_terms": []}) is None, "no gap when both are sold")
check(evm.service_gap({"ok": True, "services": ["PPC", "Social Media", "Web Design"], "marketing_terms": ["seo"]}).endswith(
    "SEO (the word SEO appears elsewhere in the text)."), "the reverse gap, honest about the word elsewhere in the text")

# ═════════════ B. agency-forbidden kinds, in code ═════════════
evd = {"E1": {"path": "website.services", "value": "Local SEO, Web Design", "at": "2026-11-26"},
       "E2": {"path": "website.signals.google_ads", "value": False, "at": "2026-11-26"},
       "E3": {"path": "website.careers.ppc_seo_roles", "value": "PPC Specialist", "at": "2026-11-26"},
       "E4": {"path": "website.careers.url", "value": "x", "at": "2026-11-26"},
       "E5": {"path": "ads.ads_count", "value": 12, "at": "2026-11-26"}}
vh = lambda fact, cite, kind, seg="agency": hk.verify_hook({"fact": fact, "evidence": cite, "kind": kind}, evd, [], seg)  # noqa: E731
check(not vh("A Google Ads tag is not visible in the page source.", ["E2"], "site_tracking")[0], "agency: a site_tracking hook is refused")
check(not vh("A Google Ads tag is not visible on their site.", ["E2"], "services")[0], "agency: a mislabelled audit hook is refused by the field it cites")
check(not vh("Their site has 0 location pages for Austin.", ["E1"], "services")[0], "agency: audit WORDS are refused whatever the kind")
check(not vh("Their newest blog post is old and stale now.", ["E1"], "services")[0], "agency: stale-blog wording is refused")
check(vh("A Google Ads tag is not visible in the page source.", ["E2"], "site_tracking", "niche")[0], "niche: the same audit hook is allowed")
check(vh("They sell Local SEO and Web Design.", ["E1"], "services")[0], "agency: a what-they-sell hook passes")
check(not vh("They sell Local SEO and Web Design.", ["E1"], "nonsense")[0], "an unknown kind is refused")
check(not vh("They have a careers page, so they are recruiting.", ["E4"], "hiring")[0], "a hiring hook without a named role is refused")
check(vh("They are hiring a PPC Specialist.", ["E3"], "hiring")[0], "a hiring hook that names the role passes")
check(not vh("They sell Local SEO, so they need Google Ads help.", ["E1"], "service_gap")[0], "an inference ('so they need') is refused")
check(not vh("She sells Local SEO and Web Design.", ["E1"], "services")[0], "he / she is refused (a hook says they / their)")
check(vh("They are running 12 ads themselves.", ["E5"], "runs_ads")[0], "runs_ads rests on the Ads Transparency reading")
check(hk.agency_hook_refusal("The site has no call tracking.", "services", ["website.services"]) is not None,
      "a stored hook is re-checked for agency use (the chain checks call it)")

# ═════════════ A. per-company hooks ═════════════
calls = []


def hooks_model(prompt, **kw):
    calls.append(prompt)
    import re
    e = dict((m.group(2), m.group(1)) for m in re.finditer(r"(E\d+) \| ([\w.\[\]-]+) = ", prompt))
    p1 = re.findall(r"(P1\.\d+) \| person\.summary", prompt)
    p2 = re.findall(r"(P2\.\d+) \| person\.summary", prompt)
    return json.dumps({
        "company_hooks": [
            {"fact": "They sell Local SEO, Technical SEO and Web Design to their clients.", "evidence": [e["website.services"]], "kind": "services"},
            {"fact": "They carry the HubSpot Platinum Partner badge.", "evidence": [e["website.partners"]], "kind": "partner_badge"},
            {"fact": "Their clients are mostly dental practices.", "evidence": [e["website.niches"]], "kind": "clients_niche"},
            {"fact": "They have been in business since 2012.", "evidence": [e["website.founded_year"]], "kind": "agency_age"},
            {"fact": "A Meta pixel is not visible in the page source.", "evidence": [e["website.services"]], "kind": "site_tracking"},
        ],
        "people": {"P1": [{"fact": "They have run agencies for 15 years, mostly SEO for dentists.", "evidence": p1, "kind": "founder_background"}],
                   "P2": [{"fact": "They have run agencies for 15 years, mostly SEO for dentists, as the SEO head.", "evidence": p2, "kind": "founder_background"}]},
        "angle": "A dental SEO agency with no paid search: a white-label PPC partner fills the gap.", "case_tag": "Medicine / Health / Aesthetics"})


with S() as s:
    s.add(mdb.MetroCaseLink(url="https://itforce.ua/en/cases/dentistry-ppc/", title="Google Ads for a dental clinic",
                            industry_tags="Medicine / Health / Aesthetics, Dentistry", service_tags="PPC contextual advertising", country="Poland"))
    s.commit()
    camp_a = s.get(mdb.MetroCampaign, AG)
    la, lb = s.get(mdb.MetroLead, ann), s.get(mdb.MetroLead, bob)
    r = hk.write_company_hooks(s, s.get(mdb.MetroCompany, CO), [la, lb], camp_a, ask=hooks_model)
    comp_rows = s.query(mdb.MetroHook).filter_by(company_id=CO, scope="company").all()
check(len(calls) == 1, "ONE model call for the company and its two leads")
check(r["company_hooks"] == 4 and len(comp_rows) == 4 and all(h.lead_id is None for h in comp_rows),
      f"company hooks are stored ONCE, with no lead ({len(comp_rows)} rows); the audit hook was thrown away")
check(any("site_tracking" in x["why"] or "not allowed" in x["why"] for x in r["rejected"]), "the rejected list says why")
with S() as s:
    ha, hb = hk.hooks_for(s, ann), hk.hooks_for(s, bob)
    hp = hk.hooks_for(s, page)
check(len([h for h in ha if h["scope"] == "company"]) == 4 and len([h for h in hb if h["scope"] == "company"]) == 4
      and len([h for h in hp if h["scope"] == "company"]) == 4, "every lead of the company sees the same 4 company hooks (even one not asked)")
check(len([h for h in ha if h["scope"] == "person"]) == 1 and len([h for h in hb if h["scope"] == "person"]) == 1
      and [h["fact"] for h in ha if h["scope"] == "person"] != [h["fact"] for h in hb if h["scope"] == "person"], "person hooks are separate, from the person's own data")
check(all(h["evidence"] and h["evidence"][0]["at"] == "2026-11-26" for h in ha), "every hook keeps its cited evidence with the date")
with S() as s:
    notes = json.loads(s.get(mdb.MetroLead, page).score_notes_json)
check(notes["case_tag"] == "Medicine / Health / Aesthetics", "the case tag (one of the imported case pages' tags) is the company's: every colleague gets it")
with S() as s:
    counts = hk.hook_counts(s, [s.get(mdb.MetroLead, i) for i in (ann, bob, page)])
check(counts == {ann: 5, bob: 5, page: 4}, f"hook counts per lead = company + own ({counts})")

# a rewrite keeps a hook a SENT touch used and replaces the rest
with S() as s:
    t = mdb.MetroTouch(lead_id=ann, cycle=1, step=9, channel="email", status="sent", body="x")
    s.add(t)
    s.flush()
    keep = s.query(mdb.MetroHook).filter_by(company_id=CO, scope="company").first()
    keep.used_touch_id, kept_fact = t.id, keep.fact
    t_id, keep_id = t.id, keep.id
    s.commit()
    calls.clear()
    hk.write_company_hooks(s, s.get(mdb.MetroCompany, CO), [s.get(mdb.MetroLead, ann)], s.get(mdb.MetroCampaign, AG), ask=hooks_model)
    rows = s.query(mdb.MetroHook).filter_by(company_id=CO, scope="company").all()
check(len(rows) == 5 and sum(1 for h in rows if h.fact == kept_fact) == 2, "a rewrite: the sent-used hook stays, the unused ones are replaced (no pile-up)")
with S() as s:
    s.query(mdb.MetroHook).filter(mdb.MetroHook.used_touch_id == t_id).update({mdb.MetroHook.used_touch_id: None})
    s.query(mdb.MetroTouch).filter_by(id=t_id).delete()
    s.query(mdb.MetroHook).filter_by(company_id=CO, scope="company").filter(mdb.MetroHook.id == keep_id).delete()
    s.commit()

# ═════════════ D. website scan ═════════════
HOME = """<html><head><title>Acme Agency | B2B marketing</title></head><body>
<nav><a href="/search-engine-optimization">SEO</a><a href="/hubspot-services">HubSpot services</a><a href="/capabilities/digital-media/google-ads">Google Ads: Search, PMax</a>
<a href="/our-work">Our work</a><a href="/case-studies/acme-dental">Acme Dental: 3x leads</a><a href="/industries/">Industries</a>
<a href="/industries/healthcare/">Healthcare</a><a href="/careers/">Careers</a><a href="/blog/post-1">A post</a><a href="/privacy-policy">Privacy</a>
<a href="/about">About</a><a href="https://www.google.com/partners/agency?id=1">badge</a></nav>
<img src="/img/hubspot-platinum.png" alt="HubSpot Platinum Partner"><img src="/logos/client-smile.png" alt="Smile Dental logo" class="client-logo">
<p>Since 2009 we have helped dental practices and law firms nationwide grow. Our team of 14 marketers.</p></body></html>"""
ONEPAGE = """<html><body><h2>Services</h2><h3>Search Engine Optimization</h3><h3>Email Marketing</h3><h3>Paid Advertising</h3>
<h3>Social Media Marketing</h3><a href="#services">More</a></body></html>"""
a = ws.analyze_page(HOME, "https://acme.example/")
ag_ = a["agency"]
check({"Search engine optimization", "HubSpot services", "Google Ads: Search, PMax"} <= set(ag_["services"]), f"services from flat slugs and /capabilities/: {ag_['services']}")
check(len(a["service_links"]) == 3, f"those count as service pages ({len(a['service_links'])}), the old rule found 0")
check(ag_["case_studies"] == ["Acme Dental: 3x leads"] and ag_["work_index"] == "https://acme.example/our-work", "case studies and the work index")
check(ag_["industries"] == ["Healthcare"] and ag_["industry_index"], "industries pages")
check(ag_["careers_url"] == "https://acme.example/careers/", "the careers page")
check("HubSpot Platinum Partner" in ag_["partners"] and "Google Partner" in ag_["partners"], f"partner badges: {ag_['partners']}")
check(ag_["client_logos"] == ["Smile Dental"], f"client logos from alt texts: {ag_['client_logos']}")
check(ag_["founded_year"] == 2009 and ag_["team_size_text"] == ["team of 14"], "founded year and team size")
check("dental" in ag_["niches"] and "legal" in ag_["niches"], "niches from the text")
check(any("nationwide" in g for g in ag_["geo_phrases"]), "a 'nationwide' phrase")
op = ws.analyze_page(ONEPAGE, "https://one.example/")["agency"]
check({"Search Engine Optimization", "Paid Advertising", "Email Marketing"} <= set(op["services"]), "a one-page site: the services are its headings")
check(ws.find_roles("Open roles: PPC Specialist (remote), Senior SEO Manager, Office Manager") == ["PPC Specialist", "Senior SEO Manager"],
      "PPC / SEO roles on a careers page")
check(ws.classify_path("/blog/seo-tips") is None and ws.classify_path("/privacy-policy") is None and ws.classify_path("/about") is None,
      "blog posts, privacy and about pages are not services")
pages = {"/": HOME, "/careers/": "<h1>Careers</h1><p>We are hiring a Paid Search Strategist and a designer.</p>"}
fetch = lambda url: ((200, url, pages[url.replace("https://acme.example", "")]) if url.replace("https://acme.example", "") in pages else (404, url, ""))  # noqa: E731
scan = ws.scan_site("acme.example", fetch, sleep=lambda x: None)
check(scan["version"] == ws.SCAN_VERSION and scan["careers"]["ppc_seo_roles"] == ["Paid Search Strategist"], "the scan reads the careers page and its roles")
check(not ws.scan_current(json.dumps({"ok": True})) and ws.scan_current(json.dumps(scan)), "a scan of the older scanner is not current")
with S() as s:                                   # enrich re-reads an old-version scan even inside its cache lifetime
    c = s.get(mdb.MetroCompany, CO2)
    c.website_scan_json = json.dumps({"ok": True, "domain": "lone.example"})
    c.website_scan_at = mdb.utcnow()
    s.commit()
    seen = []
    en.enrich_company(s, c, fetch=lambda u: (seen.append(u), (200, u, HOME))[1], queue_browser_jobs=False, sleep=lambda x: None, use_ai=False)
    check(seen and ws.scan_current(c.website_scan_json), "enrich re-reads a fresh scan made by the older scanner")
    c.website_scan_json = json.dumps(dict(SCAN, domain="lone.example"))
    s.commit()

# ═════════════ E. chain checks ═════════════
LEDGER = {1: {"fact": "They sell Local SEO and Web Design.", "kind": "services", "paths": ["website.services"]},
          2: {"fact": "They have been in business since 2012.", "kind": "agency_age", "paths": ["website.founded_year"]},
          3: {"fact": "A Meta pixel is not visible.", "kind": "site_tracking", "paths": ["website.signals.meta_pixel"]}}


def flags(body, *, channel="email", subject="seo for your clients", hook_ids=(1,), seg="agency", used=()):
    return [f["rule"] for f in cc.check_touch({"channel": channel, "subject": subject if channel == "email" else None, "body": body,
                                                "hook_ids": list(hook_ids)}, lead_first="Ann", hooks=LEDGER, used_elsewhere=set(used),
                                               segment=seg, allowed_numbers={"2015"})]


GOOD = "Hi Ann,\n\nYou sell Local SEO and web design, and I didn't see paid search on the list. We run Google Ads for agencies under their brand, since 2015.\n\nWould a white-label PPC partner be useful?\n\nArtem"
check(flags(GOOD) == [], f"a clean email passes ({flags(GOOD)})")
check("price" in flags(GOOD.replace("useful?", "useful at $40 an hour?")), "a planted price is caught")
check("url" in flags(GOOD + "\nhttps://itforce.ua/en/cases/x/") and "url" in flags(GOOD.replace("Artem", "see itforce.ua")), "a planted URL or domain is caught")
check("dash" in flags(GOOD.replace(", and I", " — and I")), "an em dash is caught")
check("placeholder" in flags(GOOD.replace("Hi Ann", "Hi {first_name}")) and "placeholder" in flags(GOOD.replace("Artem", "[Your Name]")),
      "unfilled placeholders are caught")
check("exclamation" in flags(GOOD.replace("useful?", "useful!")), "an exclamation mark is caught")
check("banned" in flags("Hi Ann,\n\nI hope this finds you well. " + GOOD[9:]), "a banned phrase is caught")
check("lowercase_i" in flags(GOOD.replace("I didn't", "i didn't")), "a lowercase i is caught")
check("hook_reused" in flags(GOOD, used=(1,)), "a hook another touch holds is caught")
check("hook_missing" in flags(GOOD, hook_ids=(99,)), "a hook that is not in the ledger is caught")
check("agency_kind" in flags(GOOD, hook_ids=(3,)), "an agency-forbidden hook is caught")
check("agency_kind" not in flags(GOOD, hook_ids=(3,), seg="niche"), "niche: the same hook is fine")
check("number" in flags(GOOD.replace("since 2015", "since 2015 with 40 people")), "a number no hook carries is caught")
check("number" not in flags(GOOD.replace("since 2015", "since 2015, and you since 2012"), hook_ids=(1, 2)), "a number a cited hook carries is fine")
LEDGER[4] = {"fact": "They have been Co-Founder since 2021.06.", "kind": "role", "paths": ["person.current_position_since"]}
check("number" not in flags(GOOD.replace("since 2015", "since 2015, and you since 2021"), hook_ids=(1, 4)),
      "a hook's '2021.06' lets the message say 'since 2021' (found in the live run)")
check("length" in flags(GOOD + " word" * 120), "an email over 120 words is caught")
check("length" in flags("Hi Ann, " + "x" * 300, channel="linkedin", subject=None), "a LinkedIn message over 300 characters is caught")
check("subject" in flags(GOOD, subject=""), "an email without a subject is caught")
check("name" in flags(GOOD.replace("Hi Ann", "Hi Anna")), "a greeting to the wrong name is caught")
check("language" in flags(GOOD.replace("Artem", "Артем")), "non-English text is caught")
chk = cc.check_chain([{"step": 1, "channel": "email", "subject": "a", "body": GOOD, "hook_ids": [1]},
                      {"step": 2, "channel": "email", "subject": "b", "body": GOOD, "hook_ids": [1]}],
                     lead_first="Ann", hooks=LEDGER, other_leads_used=set(), segment="agency", allowed_numbers={"2015"}, plan_channels=["email", "email"])
check(not chk["ok"] and any(f["rule"] == "hook_reused" for f in chk["flags"]), "the same hook in two steps fails the chain")

# ═════════════ F. channel order and shape ═════════════
L = lambda **kw: mdb.MetroLead(status="new", **kw)  # noqa: E731
p = ch.plan(L(invite_status="connected", email="a@b.example", email_status="domain_ok"), 6)
check([x["channel"] for x in p["steps"]] == ["linkedin"] * 3 + ["email"] * 3 and p["track"] == "linkedin_first",
      "connected: LinkedIn first (3 messages), then email")
check(p["steps"][3]["day"] > p["steps"][2]["day"], "the email track starts after the last LinkedIn message")
p = ch.plan(L(invite_status="invited", email="a@b.example", email_status="domain_ok"), 4)
check([x["channel"] for x in p["steps"]] == ["email"] * 4 and p["waiting"] is None, "not connected with a sendable address: email first")
p = ch.plan(L(invite_status="invited"), 4)
check(p["track"] == "linkedin_first" and p["waiting"] and "acceptance" in p["waiting"], "invited, no address: LinkedIn first, waiting for the acceptance")
p = ch.plan(L(invite_status="none"), 4)
check(p["track"] == "email_first" and "email address" in p["waiting"], "neither: the email plan, waiting for an address")
check(len(ch.plan(L(invite_status="none"), 1)["steps"]) == 3 and ch.plan(L(invite_status="none"), 1)["base"], "under 2 hooks: the base chain of 3")
check(len(ch.plan(L(invite_status="none"), 9)["steps"]) == 6, "never more than 6 touches")
check(len(ch.plan(L(invite_status="none"), 4)["steps"]) == 4, "touches = number of distinct hooks")

# ═════════════ G. one primary per company ═════════════
with S() as s:
    groups = accounts.assign(s, [s.get(mdb.MetroLead, ann)])
    roles = {l.id: l.account_role for l in groups[CO]}
check(roles == {ann: "primary", bob: "held", page: "held"}, f"the best persona is primary; a company page (persona 90) never is ({roles})")
with S() as s:
    s.get(mdb.MetroLead, ann).persona_score = 60       # a tie on persona: who can be reached decides (connected beats invited)
    s.commit()
    accounts.assign(s, [s.get(mdb.MetroLead, ann)])
    check(s.get(mdb.MetroLead, bob).account_role == "primary", "a tie on persona: the connected colleague is primary")
    s.get(mdb.MetroLead, ann).persona_score = 80
    s.commit()
    accounts.assign(s, [s.get(mdb.MetroLead, ann)])
    s.commit()
    r = ch.write_chain(s, s.get(mdb.MetroLead, bob), s.get(mdb.MetroCampaign, AG), ask=lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not ask")))
check(not r["written"] and "held" in r["reason"], "a held lead is never written (the model is not even asked)")

# ═════════════ H. the writer, end to end ═════════════


def chain_model(bad=False):
    def m(prompt, **kw):
        import re
        steps = [(int(a), b) for a, b in re.findall(r"step (\d+): (LinkedIn message|email)", prompt)]
        keys = re.findall(r"^(H\d+) \(", prompt, re.M)
        first = re.search(r"THE PERSON: (\w+)", prompt).group(1)
        out = []
        for i, (n, kind) in enumerate(steps):
            hook = [keys[i]] if i < len(keys) else []
            if kind == "LinkedIn message":
                body = f"{first}, thanks for connecting. You sell Local SEO and web design for dental practices. Would a white-label PPC partner help?"
            else:
                body = f"Hi {first},\n\nYou carry the HubSpot Platinum badge and sell SEO and web design. We run Google Ads for agencies under their brand since 2015.\n\nWould that fill a gap for you?\n\nArtem"
            if bad and n == 1:
                body += " It costs $30 an hour — see itforce.ua!"
            out.append({"step": n, "channel": "linkedin" if kind.startswith("LinkedIn") else "email",
                        "subject": None if kind.startswith("LinkedIn") else f"white-label ppc, step {n}" if False else "white-label ppc for your clients",
                        "body": body, "hooks": hook})
        return json.dumps({"touches": out, "summary": "A dental SEO agency with no paid search."})
    return m


with S() as s:
    lead_a = s.get(mdb.MetroLead, ann)
    r = ch.write_chain(s, lead_a, s.get(mdb.MetroCampaign, AG), ask=chain_model())
    view = ch.chain_view(s, lead_a)
check(r["written"] and r["track"] == "linkedin_first" and r["touches"] == 5, f"ann (invited, no email, 5 hooks): 5 touches, LinkedIn first ({r})")
check(view["status"]["state"] in ("written", "issues"), f"the chain cell says written or issues ({view['status']})")
case_t = [t for t in view["touches"] if t["case"]]
check(len(case_t) == 1 and case_t[0]["body"].endswith("https://itforce.ua/en/cases/dentistry-ppc/") and "itforce.ua" not in case_t[0]["text"],
      "the case link is attached BY CODE to one touch (under the text); the model's text carries none")
check(case_t[0]["step"] == 4, "the case goes on the first email after step 1")
with S() as s:
    used = s.query(mdb.MetroHook).filter(mdb.MetroHook.used_touch_id.isnot(None)).count()
check(used == 5, f"the ledger: every hook a touch uses is marked used by it ({used})")
print("   flags:", [(t["step"], [f["text"] for f in t["checks"]]) for t in view["touches"] if t["checks"]], view["notes"].get("chain_flags"))
check(all(t["checks_passed"] for t in view["touches"]) and view["notes"]["ok"], "a clean stand-in chain passes every check")
with S() as s:
    lb_ = s.get(mdb.MetroLead, bob)
    other = ch.available_hooks(s, lb_, "agency")
check(all(h.scope == "person" for h in other), "a colleague cannot use the company hooks the primary's chain holds")

with S() as s:                                   # a failing chain
    lead_a = s.get(mdb.MetroLead, ann)
    r = ch.write_chain(s, lead_a, s.get(mdb.MetroCampaign, AG), ask=chain_model(bad=True))
    v = ch.chain_view(s, lead_a)
    t1 = v["touches"][0]
check(not r["ok"] and {"price", "url", "dash", "exclamation"} <= {f["rule"] for f in t1["checks"]}, f"a planted price, URL, dash and '!' fail step 1 ({[f['rule'] for f in t1['checks']]})")
check(v["status"]["state"] == "issues", "the chain cell says issues ('Do not send as is')")
with S() as s:
    lead_a = s.get(mdb.MetroLead, ann)
    try:
        ch.approve(s, lead_a)
        refused = False
    except ValueError:
        refused = True
    check(refused, "a failing chain cannot be approved without Send anyway")
    ch.approve(s, lead_a, send_anyway=True)
    tt = s.query(mdb.MetroTouch).filter_by(lead_id=ann).order_by(mdb.MetroTouch.step).all()
    check(lead_a.chain_approved_at and tt[0].send_anyway_at and not tt[1].send_anyway_at, "Send anyway stores its date on the failing touch only")
    res = ch.edit_touch(s, tt[0], body="Ann, thanks for connecting. You sell Local SEO and web design for dental practices. Would a white-label PPC partner help?")
    check(res["ok"] and s.get(mdb.MetroLead, ann).chain_approved_at is None and tt[0].send_anyway_at is None,
          "an edit re-runs the checks (now clean) and clears the approval")
    ch.approve(s, s.get(mdb.MetroLead, ann))
    check(ch.chain_status(s, s.get(mdb.MetroLead, ann))["state"] == "approved", "a clean chain is approved with Approve")

with S() as s:                                   # Cara: one lead at her company, a sendable address -> email first
    lc = s.get(mdb.MetroLead, cara)
    hk.write_company_hooks(s, s.get(mdb.MetroCompany, CO2), [lc], s.get(mdb.MetroCampaign, AG), ask=hooks_model)
    r = ch.write_chain(s, lc, s.get(mdb.MetroCampaign, AG), ask=chain_model())
    check(r["track"] == "email_first" and all(t.channel == "email" for t in s.query(mdb.MetroTouch).filter_by(lead_id=cara)), "a sendable email: every touch is an email")
    vv = ch.chain_view(s, lc)
    print("   cara flags:", [(t["step"], [f["text"] for f in t["checks"]]) for t in vv["touches"] if t["checks"]], vv["notes"].get("chain_flags"))
    ch.approve(s, lc)

# ═════════════ I. exports ═════════════
with S() as s:
    text, info = ex.linkedhelper_csv(s, AG)
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
check(info["leads"] == 1 and rows[0]["metro_lead_id"] == str(ann), f"Linked Helper CSV: the approved lead with LinkedIn messages ({info})")
check(all(k in rows[0] for k in ("profile_url", "first_name", "metro_message_1", "metro_message_2", "metro_message_3", "metro_day_1")),
      "one custom variable per LinkedIn message (metro_message_1..3) and its day")
check(rows[0]["metro_message_1"].startswith("Ann, thanks for connecting"), "the message text is the approved one")
with S() as s:
    text, info = ex.email_csv(s, AG)
    erows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
check(list(erows[0].keys()) == ex.EMAIL_COLUMNS, f"email CSV columns: {list(erows[0].keys())}")
check(info["leads"] == 1 and {r["metro_lead_id"] for r in erows} == {str(cara)} and info["no_sendable_address"] == 1,
      f"email CSV: only leads with a sendable address; the approved lead without one is counted out ({info})")
check([int(r["step"]) for r in erows] == sorted(int(r["step"]) for r in erows), "emails in send order")
check(not any(r["metro_lead_id"] in (str(bob), str(page)) for r in rows + erows), "held colleagues are never exported")
r1 = client.get(f"/metro/campaigns/{AG}/export/linkedhelper")
r2 = client.get(f"/metro/campaigns/{AG}/export/email")
n1 = r1.headers.get("X-Metro-Filename", "")
check(r1.status_code == 200 and r2.status_code == 200 and n1.startswith("metro_agency-test_linked-helper-messages_") and n1 != r2.headers.get("X-Metro-Filename"),
      "the export routes give unique names (campaign, what, date and time)")
check(client.get(f"/metro/campaigns/{NI}/export/linkedhelper").status_code == 409, "nothing approved: the export is refused with a reason")

# ═════════════ J. case pages ═════════════
CARD = """<div class="case__item" case-id="1"><a href="https://itforce.ua/en/cases/google-ads-for-a-dental-clinic/" class="case__item-content"></a>
<div class="case__additional-country-name">Poland</div>
<a href="https://itforce.ua/en/cases/google-ads-for-a-dental-clinic/" class="case__item-link">Google Ads for a dental clinic</a>
<div class="case__term"><a href="https://itforce.ua/en/cases/dentistry/" class="case__item-category">Dentistry</a>
<a href="https://itforce.ua/en/cases/ppc/" class="case__item-category">PPC contextual advertising</a></div>
<div class="case__additional-task">More patients from search.</div></div>
<div class="case__item" case-id="2"><a href="https://itforce.ua/en/cases/seo-for-a-ukrainian-dentist/" class="case__item-link">SEO for a dentist</a>
<div class="case__additional-country-name">Ukraine</div><div class="case__term"><a href="#" class="case__item-category">Dentistry</a>
<a href="#" class="case__item-category">SMM</a></div></div><a href="/en/cases/page/9/">9</a>"""
got = cs.parse_listing(CARD)
check(len(got) == 2 and got[0]["industry_tags"] == ["Dentistry"] and got[0]["service_tags"] == ["PPC contextual advertising"]
      and got[0]["country"] == "Poland" and got[0]["task"] == "More patients from search.", "a listing card: URL, title, industry and service tags, country, task")
check(cs.last_page(CARD) == 9, "the listing's last page number")
with S() as s:
    cs.store(s, got)
    again = cs.store(s, got)
    best = cs.best_case(s, "Dentistry")
check(again["added"] == 0 and again["updated"] == 0, "storing the same cards again adds nothing")
check(best and best["url"].endswith("google-ads-for-a-dental-clinic/"), "the best case: a PPC case outside Ukraine wins")
with S() as s:
    check(cs.best_case(s, "Space travel") is None, "no matching tag: no case link at all")

# ═════════════ G2. a reply stops every channel for the company ═════════════
with S() as s:
    r = accounts.stop_company(s, s.get(mdb.MetroLead, bob), "replied by email")
    s.commit()
    left = s.query(mdb.MetroTouch).filter(mdb.MetroTouch.lead_id.in_([ann, bob, page]), mdb.MetroTouch.status != "cancelled").count()
    check(r["touches_cancelled"] >= 5 and left == 0 and s.get(mdb.MetroLead, ann).stopped_reason.startswith("replied by email (a colleague"),
          "a reply from a held colleague stops the primary's whole chain too")
    check(ch.chain_status(s, s.get(mdb.MetroLead, ann))["state"] == "stopped", "the chain cell says stopped")

# ═════════════ K. routes and the scratch launcher ═════════════
lst = client.get(f"/metro/leads?campaign_id={AG}").json()
row = next(x for x in lst["leads"] if x["id"] == cara)
check(row["channels"]["email"] == "business" and row["channels"]["email_sendable"] and row["channels"]["linkedin"] == "not"
      and row["hooks"] >= 1 and row["chain"]["state"] == "approved", f"the leads list carries Channels, hooks and Chain ({row['channels']}, {row['chain']})")
pan = client.get(f"/metro/leads/{cara}/panel").json()
check(pan["lead"]["segment"] == "agency" and pan["hooks"] and pan["chain"]["touches"] and pan["company"]["service_gap"],
      "the panel: summary, hooks with evidence, the chain")
summ = client.get(f"/metro/campaigns/{AG}/chains/summary").json()
check(summ["companies"] == 2 and summ["shortlisted"] == 4, f"the Write card: shortlisted leads and companies ({summ})")
src = (ROOT / "tools" / "scratch_check.py").read_text(encoding="utf-8")
check('os.environ["METRO_SELF_URL"] = f"http://127.0.0.1:{args.backend_port}"' in src,
      "the scratch launcher points Metro's model calls at ITSELF, never the live :8000")

print(f"\n{'all passed' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
