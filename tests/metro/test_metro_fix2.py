# -*- coding: utf-8 -*-
"""Metro F2 (METRO_TASK.md task F2, 25 Nov 2026): the domain finder, the progress registry, the small fixes.
A SCRATCH database, SYNTHETIC companies, stub fetchers and a stub model: nothing here reaches a network or a model.

Pinned:
  1. name patterns: at most 6 candidates, legal / generic words dropped in some, `.ca` for Canadian places;
  2. a site is accepted only when it carries the company name; a parked or for-sale page never passes;
  3. the order: stored data -> name patterns (paced, stop at the first verified hit) -> AI lookup WITH web search (Sonnet);
     the real reason of every failure is kept, and the trail reads "tried: name-pattern x6, ai: ..., linkedin: queued ...";
  4. LinkedIn (step d): queued only for persona `keep` leads, never handed out in a Linked Helper week; the profile's current
     company page and then its website complete the domain;
  5. the one-time migration makes domainless "tried" companies eligible again;
  6. progress: the backend registry (running item, step, counts, result line, stop, followed extension jobs) and its routes;
  7. the table fields (domain, why, just enriched), the filters, the retry route, and the scoped Linked Helper email export;
  8. the web flag travels /claude -> bridge, and the bridge tool list is exactly WebSearch + WebFetch.
Run: python tests/metro/test_metro_fix2.py
"""
import json
import re
import sys
import tempfile
from datetime import timedelta
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


tmp = Path(tempfile.mkdtemp(prefix="metro-f2-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import aiclient                     # noqa: E402
from metro import campaigns as camp            # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import domainfinder as df           # noqa: E402
from metro import enrich as en                 # noqa: E402
from metro import gate, progress, webscan      # noqa: E402
from metro import results as rs                # noqa: E402
from metro import scoring as sc                # noqa: E402
from metro.router import router                # noqa: E402

mdb.set_engine(eng)
app = FastAPI()
app.include_router(router)
cl = TestClient(app)
NOSLEEP = lambda x: None                       # noqa: E731

# ═════════════ 1. name patterns ═════════════
c = df.name_candidates("FIREBELLY Marketing")
check(c[:3] == ["firebellymarketing.com", "firebelly.com", "firebelly-marketing.com"], f"FIREBELLY Marketing -> the three expected guesses ({c})")
check(all(len(df.name_candidates(n)) <= 6 for n in ("A B C D E F G H", "Maple Leaf Digital Agency Group Inc", "Smith & Jones Creative Studio LLC")),
      "never more than 6 candidates")
rk = df.name_candidates("Rank Media Agency")
check("rank.com" in rk and "rankmedia.com" in rk and "rankmediaagency.com" in rk, f"generic suffix words are dropped in some variants ({rk})")
check("fixit.com" in df.name_candidates("Fix It, LLC") and "fixitllc.com" not in df.name_candidates("Fix It, LLC"), "legal words (LLC, Inc) never appear in a guess")
ca = df.name_candidates("Maple Leaf Digital Inc.", country="Canada")
check("mapleleafdigital.ca" in ca and "mapleleafdigital.com" in ca and len(ca) <= 6, f".ca as well for Canada ({ca})")
check(any(d.endswith(".ca") for d in df.name_candidates("Birch Studio", location="Toronto, Ontario, Canada")), ".ca for a Canadian location on the lead")
check(not any(d.endswith(".ca") for d in df.name_candidates("Birch Studio", location="Austin, Texas, United States")), "no .ca for a US place")
check(df.name_candidates("Digital Marketing Group") == ["digitalmarketinggroup.com", "digital-marketing-group.com"] or
      all("marketing" in d for d in df.name_candidates("Digital Marketing Group")), "a name of only generic words gives only whole-name guesses")
check(df.name_candidates("  ") == [] and df.name_candidates("X") == [], "an empty or one-letter name gives nothing")

# ═════════════ 2. verification; parked pages ═════════════
def page(title="", h1="", body="", meta=""):
    return (f"<html><head><title>{title}</title><meta name=\"description\" content=\"{meta}\"></head><body><h1>{h1}</h1>{body}</body></html>")


PARKED = page("firebelly.com", "", "<p>This domain is for sale. Make an offer on this domain.</p>")
SALE2 = page("Buy this domain", "", "<p>firebelly.com - hugedomains</p>")
GOOD = page("FireBelly Marketing | PPC agency", "Fire Belly Marketing", "<p>We run Google Ads from our Chicago office</p>")
p_good = webscan.probe_home("firebelly.com", lambda u: (200, u, GOOD))
p_full = webscan.probe_home("firebellymarketing.com", lambda u: (200, u, GOOD))
p_park = webscan.probe_home("firebelly.com", lambda u: (200, u, PARKED))
p_sale = webscan.probe_home("firebelly.com", lambda u: (200, u, SALE2))
p_host = webscan.probe_home("firebelly.com", lambda u: (200, "https://www.hugedomains.com/domain/firebelly.com", page("FireBelly Marketing")))
check(df.verify_domain_matches_name("FIREBELLY Marketing", p_full), "a real site with the name in its title passes (the guess spells the whole name)")
check(df.verify_domain_matches_name("FIREBELLY Marketing", p_good, place="Chicago, United States"), "a shortened guess (firebelly.com) passes when the lead's city is on the page")
check(not df.verify_domain_matches_name("FIREBELLY Marketing", p_good, place="Houston, Texas"), "...and not when it is not")
check(p_park["parked"] and not df.verify_domain_matches_name("FIREBELLY Marketing", p_park), "a parked / for-sale page never passes")
check(p_sale["parked"] and not df.verify_domain_matches_name("FIREBELLY Marketing", p_sale), "a registrar sale page never passes, even when it names the domain")
check(p_host["parked"] and not df.verify_domain_matches_name("FIREBELLY Marketing", p_host), "an address that ends on a parking host never passes, even with the name in the title")
check(not df.verify_domain_matches_name("Rank Media", webscan.probe_home("frankly.com", lambda u: (200, u, page("Frankly Speaking", "Frank")))),
      "a short name does not match inside another word (rank / frank)")
check(not df.verify_domain_matches_name("FIREBELLY Marketing", webscan.probe_home("x.com", lambda u: (200, u, page("Totally Different Plumbing")))),
      "a site that does not carry the name is rejected")
check(not df.verify_domain_matches_name("Digital Marketing Group", p_good), "a name with no distinctive word cannot be verified")

# one shared word is not enough (found in the live run: "CROSS Digital Marketing Agency" matched cross.com, a pen maker)
PEN = webscan.probe_home("cross.com", lambda u: (200, u, page("A.T. Cross Pen Company", "", "<p>fine writing instruments, ballpoint pens, a gift</p>", "makers of fine pens since 1846")))
check(not df.verify_domain_matches_name("CROSS Digital Marketing Agency", PEN), "REGRESSION (live run): a site that shares one word of the name but is another business (a pen maker) is rejected")
AG = webscan.probe_home("cross.example", lambda u: (200, u, page("CROSS | Growth", "CROSS", "<p>A digital marketing agency for dentists</p>")))
check(df.verify_domain_matches_name("CROSS Digital Marketing Agency", AG, strict=False), "the same name on an agency's site passes when the model found it by searching (the page also talks about marketing)")
check(not df.verify_domain_matches_name("CROSS Digital Marketing Agency", AG), "but a bare guess (cross.example) of a longer name also needs the lead's city")
MACH = webscan.probe_home("realperformance.com", lambda u: (200, u, page("Real Performance Machinery", "", "<p>Industrial machines and parts</p>")))
check(not df.verify_domain_matches_name("Real Performance Marketing", MACH, place="Houston") and not df.verify_domain_matches_name("Real Performance Marketing", MACH, strict=False),
      "REGRESSION (live run): 'Real Performance Marketing' is not a machinery company, even though both distinctive words match")
COMM = webscan.probe_home("commerce.com", lambda u: (200, u, page("Commerce | the platform", "", "<p>Ecommerce software for marketing teams, digital storefronts</p>")))
check(not df.verify_domain_matches_name("Digital Commerce Partners", COMM, place="Austin"), "REGRESSION (live run): a big brand's bare word (commerce.com) is not 'Digital Commerce Partners' without the lead's city")
CL = webscan.probe_home("birchdentalclinic.example", lambda u: (200, u, page("Birch Dental", "Birch Dental Clinic", "<p>Welcome, new patients</p>")))
check(df.verify_domain_matches_name("Birch Dental Clinic", CL), "a clinic's name is corroborated by a clinic's site")
check(not df.verify_domain_matches_name("Birch Dental Clinic", webscan.probe_home("birchdentalclinic.example", lambda u: (200, u, page("Birch Furniture", "", "<p>Oak tables</p>")))),
      "and not by a furniture shop called Birch")
SOLO = webscan.probe_home("kestrelholdings.example", lambda u: (200, u, page("Kestrel", "", "<p>Welcome to Kestrel in Chicago</p>")))
check(not df.verify_domain_matches_name("Kestrel Holdings", SOLO) and df.verify_domain_matches_name("Kestrel Holdings", SOLO, place="Greater Chicago Area, United States"),
      "a one-word name with no industry word needs the lead's city on the page")
check(df.place_words("Greater Chicago Area, United States") == ["chicago"], "the lead's place is reduced to its city word")
CCM = webscan.probe_home("clickcatalystdigital.example", lambda u: (200, "https://clickcatalystmedia.example/", page("Home - Click Catalyst Media", "", "<p>Website design, SEO and organic growth</p>")))
check(df.verify_domain_matches_name("Click Catalyst Digital Marketing Agency", CCM) and CCM["final_host"] == "clickcatalystmedia.example",
      "a guess whose label spells two distinctive words of the name passes without the city, and the redirect target is what is stored")
hit, entry = df.try_name_patterns("Click Catalyst Digital Marketing Agency", country=None, location=None, sleep=NOSLEEP,
                                  fetch=lambda u: (200, "https://www.clickcatalystmedia.com/", page("Home - Click Catalyst Media", "", "<p>Website design, SEO and organic growth</p>")) if "clickcatalystdigital.com" in u else (0, u, ""))
check(hit == "clickcatalystmedia.com" and "redirects to clickcatalystmedia.com" in " ".join(entry["notes"]), f"a pattern that redirects stores the domain the site really lives on ({hit})")
LANDER = webscan.probe_home("realperformancemarketing.com", lambda u: (200, u, "<html><script>window.onload=function(){window.location.href=\"/lander\"}</script></html>"))
check(LANDER["parked"], "a registrar's /lander redirect page counts as parked")
SCRIPTY = webscan.probe_home("x.example", lambda u: (200, u, "<html><head><title>Acme</title></head><body><script>var marketing='digital marketing agency'</script><p>Pens</p></body></html>"))
check("marketing" not in SCRIPTY["text"], "words inside scripts are not what the page says")

check(df.verify_domain_matches_name("Birch Orthodontics", webscan.probe_home("birchorthodontics.example", lambda u: (200, u, page("Birch Orthodontics | Braces", "Birch Orthodontics")))),
      "two distinctive words that both match need no further sign")

# ═════════════ company fixtures ═════════════
NOW = mdb.utcnow()


def mk_company(s, cid, name, location="Chicago, United States", verdict="keep", profile=True, country=None):
    comp = mdb.MetroCompany(name=name, name_key=re.sub(r"[^a-z0-9]", "", name.lower()), country=country)
    s.add(comp)
    s.flush()
    lead = mdb.MetroLead(campaign_id=cid, company_id=comp.id, full_name=f"Owner of {name}", first_name="Owner", last_name=name.split()[0],
                         title=f"Founder at {name}", company_name=name, location=location, status="new", persona_verdict=verdict, persona_score=70.0,
                         profile_url=(f"https://www.linkedin.com/in/owner-{comp.id}/" if profile else None), invite_status="none", raw_json="{}")
    s.add(lead)
    s.flush()
    return comp.id, lead.id


with Session(eng) as s:
    cid = camp.create(s, name="F2 test", type="agency", region="US/CA", month=None, offer=None).id
    fb_c, fb_l = mk_company(s, cid, "FIREBELLY Marketing")
    s.commit()


def run_resolve(comp_id, fetch, ask=None, use_ai=True, web=None):
    with Session(eng) as s:
        comp = s.get(mdb.MetroCompany, comp_id)
        leads = s.query(mdb.MetroLead).filter_by(company_id=comp_id).all()
        sleeps = []
        r = en.resolve_domain(s, comp, leads, fetch=fetch, ask=ask, use_ai=use_ai, sleep=lambda x: sleeps.append(x), pace=3.0, web=web)
        r["sleeps"] = sleeps
        return r


# ═════════════ 3a. name pattern: the first verified hit wins, fetches are paced ═════════════
fetched = []


def site_fetch(sites):
    def f(url):
        fetched.append(url)
        host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
        return (200, url, sites[host]) if host in sites else (0, url, "")
    return f


asked = []


def never_ask(prompt, **kw):
    asked.append(kw)
    raise AssertionError("the AI must not be asked when a name pattern verified")


r = run_resolve(fb_c, site_fetch({"firebelly.com": GOOD}), ask=never_ask)
check(r["domain"] == "firebelly.com" and r["source"] == "name-pattern", f"a verified name-pattern hit is stored with its source ({r['domain']} / {r['source']})")
check(not asked, "the AI is not asked once a pattern verified")
check(r["steps"][0]["step"] == "name-pattern" and r["steps"][0]["tried"] == 2, "it stopped at the first verified candidate (firebellymarketing.com failed, firebelly.com passed)")
check(len(r["sleeps"]) == 1 and r["sleeps"][0] == 3.0, "the guesses are fetched paced (a pause between two guesses)")

# ═════════════ 3b. parked / unrelated / taken candidates are skipped, then the AI is asked WITH web search ═════════════
with Session(eng) as s:
    comp = s.get(mdb.MetroCompany, fb_c)
    comp.domain, comp.domain_source, comp.enrich_tried_at = None, None, None
    other_c, _ = mk_company(s, cid, "Other Co Services")
    s.get(mdb.MetroCompany, other_c).domain = "firebellymarketing.com"
    s.commit()
sent = []


def ai_found(prompt, **kw):
    sent.append((prompt, kw))
    return json.dumps({"domain": "fire-belly-ads.example", "evidence": "its own site names it"})


sites = {"firebelly.com": PARKED, "firebelly-marketing.com": page("Totally Different Plumbing"),
         "fire-belly-ads.example": page("Fire Belly Marketing - Chicago PPC", "Fire Belly Marketing")}
r = run_resolve(fb_c, site_fetch(sites), ask=ai_found)
check(r["domain"] == "fire-belly-ads.example" and r["source"] == "ai-lookup", f"parked, unrelated and taken guesses fail; the AI lookup then finds it ({r['domain']})")
notes = r["steps"][0]["notes"]
check(any("already belongs" in n for n in notes) and any("parked" in n for n in notes) and any("not this company" in n for n in notes),
      f"the trail keeps the reason of each guess ({notes})")
check(sent and sent[0][1].get("web") is True and sent[0][1].get("model") == aiclient.SONNET and "claude-sonnet" in sent[0][1]["model"],
      "the AI call asks for WEB SEARCH and Sonnet (not Haiku)")
check("Search the web" in sent[0][0] and "JSON only" in sent[0][0], "the prompt tells the model to search and to answer JSON")
check(not any("haiku" in str(k).lower() for _, k in sent), "Haiku is not used for the lookup")

# the AI answers: parked, rejected, no answer, a call failure, not JSON, a directory
def reset_fb():
    with Session(eng) as s:
        comp = s.get(mdb.MetroCompany, fb_c)
        comp.domain, comp.domain_source = None, None
        s.commit()


reset_fb()
r = run_resolve(fb_c, site_fetch({"sale.example": PARKED}), ask=lambda p, **k: json.dumps({"domain": "sale.example"}))
check(r["domain"] is None and any("parked or for sale" in x for x in r["tried"]), "an AI candidate that is a for-sale page is rejected, with the reason")
r = run_resolve(fb_c, site_fetch({"plumb.example": page("Totally Different Plumbing")}), ask=lambda p, **k: json.dumps({"domain": "plumb.example"}))
check(r["domain"] is None and any("does not carry the company name" in x for x in r["tried"]), "an AI candidate whose site has another name is rejected")
r = run_resolve(fb_c, site_fetch({}), ask=lambda p, **k: json.dumps({"domain": None, "reason": "no such business found"}))
check(r["steps"][-1]["step"] == "ai" and "no answer" in r["steps"][-1]["result"] and "no such business found" in r["steps"][-1]["result"],
      "'no answer' keeps the model's own reason")


def boom(p, **k):
    raise aiclient.AIError("/claude answered 502: CLI bridge error: connect refused")


r = run_resolve(fb_c, site_fetch({}), ask=boom)
check("call failed" in r["steps"][-1]["result"] and "CLI bridge error" in r["steps"][-1]["result"], f"a bridge error is logged, not swallowed ({r['steps'][-1]['result']})")
r = run_resolve(fb_c, site_fetch({}), ask=lambda p, **k: "I could not find it, sorry")
check("not JSON" in r["steps"][-1]["result"], "an answer that is not JSON is logged as such")
r = run_resolve(fb_c, site_fetch({}), ask=lambda p, **k: json.dumps({"domain": "https://www.linkedin.com/company/firebelly"}))
check("directory or profile" in r["steps"][-1]["result"], "a LinkedIn / directory answer is refused as the company's own site")
r = run_resolve(fb_c, site_fetch({}), ask=lambda p, **k: json.dumps({"domain": "gmail.com"}))
check(r["domain"] is None, "a free-mail domain is never accepted")

# web search unavailable (API provider): the call is made WITHOUT web and the trail says why
sent.clear()
r = run_resolve(fb_c, site_fetch({}), ask=lambda p, **k: (sent.append(k) or json.dumps({"domain": None})), web=False)
check(sent and sent[0].get("web") is False and r["steps"][-1]["mode"].startswith("no web"), f"without web search the call says so and the trail records it ({r['steps'][-1]['mode']})")
ok_, why = False, ""
orig = aiclient.provider
aiclient.provider = lambda base_url=None: "api"
ok_, why = aiclient.web_search_available()
aiclient.provider = lambda base_url=None: "cli"
ok2, _ = aiclient.web_search_available()
aiclient.provider = orig
check(ok_ is False and "CLI provider" in why and ok2 is True, "web search is available only on the CLI provider")

# ═════════════ the trail text ═════════════
reset_fb()
with Session(eng) as s:
    comp = s.get(mdb.MetroCompany, fb_c)
    out = en.enrich_company(s, comp, fetch=site_fetch({}), ask=lambda p, **k: json.dumps({"domain": None, "reason": "nothing found"}), use_ai=True,
                            campaign=s.get(mdb.MetroCampaign, cid), sleep=NOSLEEP, web=True)
    why_text = out["domain_why"]
    check(why_text.startswith("tried: name-pattern x") and "ai: no answer" in why_text and "linkedin: queued the profile" in why_text, f"the UI line reads like the brief ({why_text})")
    check(en.domain_why(comp) == why_text and comp.enrich_tried_at is not None, "it is stored on the company and read back by domain_why")
    check(any(j.kind == "linkedin_profile" for j in s.query(mdb.MetroScrapeJob).all()), "a keep lead's profile job is queued")

# ═════════════ 4. LinkedIn: keep leads only; Metro weeks only; profile -> company page -> website ═════════════
with Session(eng) as s:
    nk_c, nk_l = mk_company(s, cid, "Birch Studio Collective", verdict="review")
    np_c, np_l = mk_company(s, cid, "Cedar Works Media", profile=False)
    s.commit()
with Session(eng) as s:
    for comp_id in (nk_c, np_c):
        comp = s.get(mdb.MetroCompany, comp_id)
        en.enrich_company(s, comp, fetch=site_fetch({}), ask=lambda p, **k: json.dumps({"domain": None}), campaign=s.get(mdb.MetroCampaign, cid), sleep=NOSLEEP, web=True)
    check(not any(j.lead_id in (nk_l, np_l) for j in s.query(mdb.MetroScrapeJob).all()), "no LinkedIn job for a lead that is not persona keep (or has no profile URL)")
    check("no persona-keep lead" in en.domain_why(s.get(mdb.MetroCompany, nk_c)), "and the trail says why")

with Session(eng) as s:
    gate.set_week_mode(s, "linked_helper", confirmed=True)
    snd = gate.register_account(s, account_ref="acct-f2", label="f2")
    snd_id = snd.id
    s.commit()
    nxt = gate.next_job(s, snd_id, ["linkedin_profile", "linkedin_company"])
    check(not nxt or not nxt.get("job"), "in a Linked Helper week no LinkedIn job is handed out (the domain finder only queued it)")
    n_vis = s.query(mdb.MetroVisitLog).count()
    check(n_vis == 0, "and no visit was counted")
    gate.set_week_mode(s, "metro", confirmed=True, lister=lambda: [])
    s.commit()
    job = gate.next_job(s, snd_id, ["linkedin_profile"], now=NOW + timedelta(days=0))
    check(job and job.get("job") and job["job"]["kind"] == "linkedin_profile", "in a Metro week the profile job is handed out (and counted against the visits)")
    jid = job["job"]["id"]
    out = rs.complete_job(s, jid, snd_id, result={"headline": "Founder", "current_company": "FireBelly Marketing LLC",
                                                 "current_company_url": "https://www.linkedin.com/company/firebelly-marketing/?trk=x"})
    comp = s.get(mdb.MetroCompany, fb_c)
    check(comp.linkedin_url == "https://www.linkedin.com/company/firebelly-marketing/", f"the profile names the company page ({comp.linkedin_url})")
    check(any("queued from the profile" in n for n in out["notes"]), "and the page reading is queued")
    cj = s.query(mdb.MetroScrapeJob).filter_by(kind="linkedin_company", company_id=fb_c).first()
    check(cj is not None and cj.status == "queued", "a linkedin_company job exists")

    # a profile of someone who moved on names ANOTHER company: ignored
    mv_c, mv_l = mk_company(s, cid, "Delta Roofing Partners")
    s.commit()
    en.enrich_company(s, s.get(mdb.MetroCompany, mv_c), fetch=site_fetch({}), ask=lambda p, **k: json.dumps({"domain": None}), campaign=s.get(mdb.MetroCampaign, cid), sleep=NOSLEEP, web=True)
    pj = s.query(mdb.MetroScrapeJob).filter_by(kind="linkedin_profile", lead_id=mv_l).first()
    pj.status, pj.sender_id = "leased", snd_id
    s.commit()
    out = rs.complete_job(s, pj.id, snd_id, result={"current_company": "Some Other Firm", "current_company_url": "https://www.linkedin.com/company/some-other-firm/"})
    check(s.get(mdb.MetroCompany, mv_c).linkedin_url is None and any("does not match" in n for n in out["notes"]), "a profile whose current company has another name is not used")

    cj.status, cj.sender_id = "leased", snd_id
    s.commit()
    rs.complete_job(s, cj.id, snd_id, result={"name": "Firebelly Marketing", "website": "https://www.firebellymarketing.example/"})
    comp = s.get(mdb.MetroCompany, fb_c)
    check(comp.domain == "firebellymarketing.example" and comp.domain_source == "linkedin", "the company page's website completes the domain (source linkedin)")

# ═════════════ 5. the one-time migration ═════════════
with Session(eng) as s:
    a_c, _ = mk_company(s, cid, "Alpha Roof Works")
    b_c, _ = mk_company(s, cid, "Bravo Gutters Pro")
    s.get(mdb.MetroCompany, a_c).enrich_tried_at = NOW
    s.get(mdb.MetroCompany, b_c).enrich_tried_at = NOW
    s.get(mdb.MetroCompany, b_c).domain = "bravogutters.example"
    s.query(mdb.MetroSetting).filter_by(key="f2_domainless_retry").delete()
    s.commit()
n = mdb.f2_retry_domainless(eng)
with Session(eng) as s:
    check(n >= 1 and s.get(mdb.MetroCompany, a_c).enrich_tried_at is None, f"a tried company with no domain is eligible again ({n} cleared)")
    check(s.get(mdb.MetroCompany, b_c).enrich_tried_at is not None, "a company that has a domain keeps its mark")
    s.get(mdb.MetroCompany, a_c).enrich_tried_at = NOW
    s.commit()
check(mdb.f2_retry_domainless(eng) == 0, "the migration runs once: a second start clears nothing")
with Session(eng) as s:
    check(s.get(mdb.MetroCompany, a_c).enrich_tried_at is not None, "and does not undo a later attempt")
check(mdb.SCHEMA_VERSION >= 4, "schema version 4 or later (F3 raised it to 5)")

# ═════════════ 6. progress ═════════════
progress.reset()
with Session(eng) as s:
    c2 = camp.create(s, name="F2 progress", type="agency", region="US/CA", month=None, offer=None).id
    names = ["Rank Media Agency", "Alder Pixel Works", "Maple Leaf Digital", "Elm Street Studio", "Oak Harbor Ads"]
    lead_ids = [mk_company(s, c2, n_)[1] for n_ in names]
    s.commit()
mid = []


def spy_fetch(url):
    snap = progress.snapshot()
    run_ = next((r_ for r_ in snap["runs"] if r_["kind"] == "enrich" and r_["status"] == "running"), None)
    if run_ and (run_["done"], run_["current"]) not in [(m[0], m[1]) for m in mid]:
        mid.append((run_["done"], run_["current"], run_["step"], run_["total"]))
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    if host == "rank.com":
        return 200, url, page("Rank Media Agency - PPC", "", "<p>Our Chicago team</p>")
    return 0, url, ""


res = en.start_run(c2, lead_ids, fetch=spy_fetch, get_json=lambda u: (404, {}), ask=lambda p, **k: json.dumps({"domain": None}), use_ai=True, background=False, sleep=NOSLEEP, web=True)
snap = progress.snapshot()
run_ = next(r_ for r_ in snap["runs"] if r_["kind"] == "enrich")
check(res["started"] and run_["status"] == "done" and run_["total"] == 5 and run_["done"] == 5, f"the enrich run is registered with its total and ends done ({run_['done']}/{run_['total']})")
check(re.fullmatch(r"Enriched 5 - 1 domains found, 4 not found", run_["result"] or ""), f"it ends with ONE result line ({run_['result']})")
check(mid and mid[0][1] and mid[0][2], f"while it ran the registry named the current company and the step ({mid[:2]})")
check(len({m[1] for m in mid}) >= 2 and mid[-1][0] > mid[0][0], "the done count moved from one company to the next")
check(run_["eta_s"] is None and run_["elapsed_s"] >= 0 and run_["can_stop"] is False, "a finished run has no estimate and no Stop")

# stop
progress.reset()
holder = {}


def stop_during(url):
    if not holder.get("stopped"):
        holder["stopped"] = True
        rid = next(r_["id"] for r_ in progress.snapshot()["runs"] if r_["kind"] == "enrich")
        holder["ok"] = progress.request_stop(rid)
    return 0, url, ""


with Session(eng) as s:
    for l in s.query(mdb.MetroLead).filter(mdb.MetroLead.campaign_id == c2):
        s.get(mdb.MetroCompany, l.company_id).enrich_tried_at = None
    s.commit()
en.start_run(c2, lead_ids, fetch=stop_during, get_json=lambda u: (404, {}), ask=lambda p, **k: json.dumps({"domain": None}), use_ai=True, background=False, sleep=NOSLEEP, web=True)
run_ = next(r_ for r_ in progress.snapshot()["runs"] if r_["kind"] == "enrich")
check(holder.get("ok") and run_["status"] == "stopped" and run_["done"] < 5 and "(stopped)" in run_["result"], f"Stop ends the run after the current company ({run_['result']})")
check(progress.request_stop("nope") is False, "stopping something that does not exist is refused")

# an action with no total: indeterminate (total 0), elapsed time, one result line; a failure is said
progress.reset()
with progress.track("score", "Scoring fit", campaign_id=c2) as t:
    snap = progress.snapshot()
    check(snap["running"] == 1 and snap["runs"][0]["total"] == 0 and snap["runs"][0]["can_stop"] is False, "an action with no known total is a run with total 0 (indeterminate bar, no Stop)")
    t["result"] = "Scored fit for 5 lead(s)"
check(progress.snapshot()["runs"][0]["result"] == "Scored fit for 5 lead(s)" and progress.snapshot()["running"] == 0, "it ends with its result line")
try:
    with progress.track("import", "Importing x.csv"):
        raise ValueError("bad file")
except ValueError:
    pass
fr = next(r_ for r_ in progress.snapshot()["runs"] if r_["kind"] == "import")
check(fr["status"] == "failed" and "bad file" in fr["result"], "a failed action is a failed run with the reason")

# follow the extension's jobs
progress.reset()
with Session(eng) as s:
    c3 = camp.create(s, name="F2 deep", type="agency", region="US/CA", month=None, offer=None).id
    d1, dl1 = mk_company(s, c3, "Deep One Roofing")
    d2, dl2 = mk_company(s, c3, "Deep Two Plumbing")
    for comp_id, lid in ((d1, dl1), (d2, dl2)):
        comp = s.get(mdb.MetroCompany, comp_id)
        comp.linkedin_url = f"https://www.linkedin.com/company/deep-{comp_id}/"
        l = s.get(mdb.MetroLead, lid)
        l.fit_score, l.status, l.persona_verdict = 80.0, "new", "keep"
    s.commit()
    q = en.queue_deep(s, s.get(mdb.MetroCampaign, c3), [dl1, dl2])
    check(len(q["job_ids"]) == sum(q["queued"].values()) and len(q["job_ids"]) >= 2, f"queue_deep reports the job ids it queued ({len(q['job_ids'])})")
    rid = en.follow_jobs(c3, q["job_ids"])
snap = progress.snapshot()
r_ = next(x for x in snap["runs"] if x["id"] == rid)
check(r_["status"] == "running" and r_["total"] == len(q["job_ids"]) and r_["done"] == 0 and "waiting" in r_["detail"], f"the deep run follows the jobs: 0 of {r_['total']}, '{r_['detail']}'")
with Session(eng) as s:
    gate.set_week_mode(s, "linked_helper", confirmed=True)
    s.commit()
r_ = next(x for x in progress.snapshot()["runs"] if x["id"] == rid)
check("Metro week" in r_["detail"], "in a Linked Helper week the dock says the LinkedIn readings wait for a Metro week")
with Session(eng) as s:
    for j in s.query(mdb.MetroScrapeJob).filter(mdb.MetroScrapeJob.id.in_(q["job_ids"])).all():
        j.status = "done"
    s.commit()
r_ = next(x for x in progress.snapshot()["runs"] if x["id"] == rid)
check(r_["status"] == "done" and r_["done"] == r_["total"] and r_["result"].startswith("Deep readings:"), f"when every job is back the run closes by itself ({r_['result']})")
check(en.follow_jobs(c3, []) is None, "nothing queued, nothing to follow")

# the routes
progress.reset()
rid = progress.start("enrich", "Enriching", total=10, campaign_id=c3, stop=lambda: holder.update(stop_called=True))
progress.update(rid, done=3, current="Rank Media Agency", step="website scan")
j = cl.get("/metro/progress").json()
check(j["running"] == 1 and j["runs"][0]["current"] == "Rank Media Agency" and j["runs"][0]["step"] == "website scan" and "server_now" in j, "GET /metro/progress returns the run with its current item and step (a reloaded tab can draw it)")
check(cl.get(f"/metro/progress?campaign_id={c3}").json()["running"] == 1 and cl.get("/metro/progress?campaign_id=99999").json()["running"] == 0, "it can be asked per campaign")
check(cl.post(f"/metro/progress/{rid}/stop").json() == {"stopping": True} and holder.get("stop_called"), "POST /metro/progress/<id>/stop calls the run's stop")
check(cl.post("/metro/progress/nope/stop").status_code == 409, "a run without Stop (or a finished one) answers 409")
progress.finish(rid, "Enriched 3", "stopped")

# ═════════════ 7. the table: domain, why, just enriched; filters; retry; scoped export ═════════════
progress.reset()
with Session(eng) as s:
    c4 = camp.create(s, name="F2 table", type="agency", region="US/CA", month=None, offer=None).id
    ids4 = []
    for i in range(6):
        comp_id, lid = mk_company(s, c4, f"Table Company{i} Roofing")
        ids4.append((comp_id, lid))
    s.commit()
with Session(eng) as s:
    for comp_id, lid in ids4:                       # one with a domain, others none
        pass
en.start_run(c4, [l for _, l in ids4[:3]], fetch=lambda u: (0, u, ""), get_json=lambda u: (404, {}), ask=lambda p, **k: json.dumps({"domain": None, "reason": "none"}),
             use_ai=True, background=False, sleep=NOSLEEP, web=True)
lst = cl.get(f"/metro/leads?campaign_id={c4}&limit=50").json()
rows = {l["id"]: l for l in lst["leads"]}
touched = [rows[l] for _, l in ids4[:3]]
check(all(r["just_enriched"] for r in touched) and not any(rows[l]["just_enriched"] for _, l in ids4[3:]), "the leads the last run touched are flagged just_enriched, the others not")
check(all(r["domain"] is None and r["domain_why"].startswith("tried: name-pattern") for r in touched), f"a lead with no domain carries the reason ({touched[0]['domain_why']})")
check(rows[ids4[4][1]]["domain_why"] == "not tried yet", "a company never tried says so")
rec = cl.get(f"/metro/leads?campaign_id={c4}&enriched=recent").json()
check(rec["total"] == 3 and {l["id"] for l in rec["leads"]} == {l for _, l in ids4[:3]}, "the filter enriched=recent shows exactly the last run's companies")
srt = cl.get(f"/metro/leads?campaign_id={c4}&sort=just_enriched&limit=50").json()["leads"]
check({l["id"] for l in srt[:3]} == {l for _, l in ids4[:3]}, "sort=just_enriched puts them first")
check(cl.get(f"/metro/leads?campaign_id={c4}&domain=no&limit=1").json()["total"] == 6 and cl.get(f"/metro/leads?campaign_id={c4}&domain=yes&limit=1").json()["total"] == 0,
      "the domain filter works (all 6 have none)")
check(cl.get(f"/metro/leads/ids?campaign_id={c4}&domain=no").json()["total"] == 6, "and so does the ids route")
last = json.loads(next(r for r in cl.get("/metro/settings").json().items() if r[0] == "last_enrich_run")[1] and json.dumps(cl.get("/metro/settings").json()["last_enrich_run"]))
check(last["campaign_id"] == c4 and last["companies"] == 3, "the last run is remembered (campaign and size)")

# retry domain
with Session(eng) as s:
    s.get(mdb.MetroCompany, ids4[0][0]).domain = "tablecompany0.example"
    s.commit()
r = cl.post(f"/metro/campaigns/{c4}/retry-domain", json={"lead_ids": [ids4[0][1]]}).json()
check(r["started"] is False and "already has a domain" in r["reason"], "Retry domain leaves a company that has a domain alone")
import metro.enrich as _en
orig_http = webscan.http_fetcher
webscan.http_fetcher = lambda *a, **k: (lambda url: (0, url, ""))
orig_ask = aiclient.ask
aiclient.ask = lambda p, **k: json.dumps({"domain": None, "reason": "retry"})
orig_web = aiclient.web_search_available
aiclient.web_search_available = lambda base_url=None: (True, "")
try:
    # the run is a background thread in the route; run it inline through the same function for a deterministic test
    with Session(eng) as s:
        comp1 = s.get(mdb.MetroCompany, ids4[1][0])
        comp1.enrich_tried_at = NOW
        s.commit()
    r = cl.post(f"/metro/campaigns/{c4}/retry-domain", json={"lead_ids": [ids4[1][1], ids4[2][1]]}).json()
    check(r["started"] is True and r["total"] == 2, f"Retry domain starts the finder again for the domainless companies ({r})")
    import time as _t
    for _ in range(80):
        if not en.status().get("running"):
            break
        _t.sleep(0.25)
    st = en.status()
    check(not st.get("running") and st["done"] == 2, "it goes through the same run as Enrich (progress, Stop)")
finally:
    webscan.http_fetcher, aiclient.ask, aiclient.web_search_available = orig_http, orig_ask, orig_web

# the Linked Helper email export follows "what you see runs"
with Session(eng) as s:
    for k, (comp_id, lid) in enumerate(ids4):
        l = s.get(mdb.MetroLead, lid)
        l.fit_score = 80.0 if k < 3 else 10.0
    s.commit()
allids = [l for _, l in ids4]
pv = cl.post(f"/metro/campaigns/{c4}/email-export/preview", json={"lead_ids": allids, "shortlist_only": True}).json()
check(pv["exported"] == 3, f"shown rows: only the shortlisted are exported ({pv['exported']} of 6)")
pv = cl.post(f"/metro/campaigns/{c4}/email-export/preview", json={"lead_ids": [allids[4], allids[5]], "shortlist_only": False}).json()
check(pv["exported"] == 2, "ticked rows are the person's own choice: exported even when below the line")
pv = cl.post(f"/metro/campaigns/{c4}/email-export/preview", json={"lead_ids": [], "shortlist_only": True}).json()
check(pv["exported"] == 0, "an explicit empty list exports nobody (never the whole campaign)")
resp = cl.post(f"/metro/campaigns/{c4}/email-export", json={"lead_ids": [allids[0]], "shortlist_only": True})
body = resp.content.decode("utf-8-sig")
check(resp.status_code == 200 and body.count("\n") >= 2 and f"owner-{ids4[0][0]}" in body and f"owner-{ids4[1][0]}" not in body, "the CSV holds exactly the scoped lead")
check(resp.headers.get("X-Metro-Exported") == "1", "and says how many")

# ═════════════ 8. the web flag, /claude and the bridge ═════════════
import httpx                                   # noqa: E402
posted = {}


class FakeResp:
    status_code = 200

    def json(self):
        return {"content": [{"type": "text", "text": "{}"}], "stop_reason": "end_turn"}


orig_post = httpx.post
httpx.post = lambda url, json=None, timeout=None, **k: (posted.update(url=url, body=json) or FakeResp())
try:
    aiclient.ask("hello", web=True, kind="metro_domain")
    check(posted["body"].get("_web") is True and posted["url"].endswith("/claude"), "aiclient sends `_web: true` to /claude when asked to search")
    aiclient.ask("hello")
    check("_web" not in posted["body"], "and nothing extra otherwise")
finally:
    httpx.post = orig_post
main_src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
check('web = bool(request.pop("_web", False))' in main_src and '**({"web": True} if web else {})' in main_src,
      "/claude strips `_web` before the API call and passes `web: true` to the CLI bridge only")
bridge = (ROOT / "cli-bridge.js").read_text(encoding="utf-8")
m = re.search(r"const CLAUDE_ARGS_WEB = \[([^\]]+)\]", bridge)
args = m.group(1) if m else ""
check("'--tools', 'WebSearch,WebFetch'" in args and "'--allowedTools', 'WebSearch,WebFetch'" in args and "'--permission-mode', 'dontAsk'" in args,
      "the bridge's web mode has exactly two tools: WebSearch and WebFetch, nothing else, permissions on dontAsk")
check(not re.search(r"Bash|PowerShell|Read|Write|Edit", args), "no shell, file or edit tool in the web mode")
check("(web ? CLAUDE_ARGS_WEB : CLAUDE_ARGS_BASE)" in bridge and "web = b.web === true" in bridge, "a call without `web: true` still gets NO tools")
check(re.search(r"CLAUDE_ARGS_BASE = \['-p', '--tools', EMPTY_TOOL_LIST, '--permission-mode', 'dontAsk'", bridge) is not None, "the default stays the empty tool list")

print("all passed" if not bad else f"{bad} FAILED")
sys.exit(1 if bad else 0)
