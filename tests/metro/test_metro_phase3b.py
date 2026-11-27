# -*- coding: utf-8 -*-
"""Metro P3b (METRO_TASK.md, 27 Nov 2026): agency chains rebuilt in DevScout's WAVE shape + the Minor fixes list 1-10.
A SCRATCH database, SYNTHETIC companies and people; no network, no model (every model answer is a stand-in).

Pinned:
  W. the writing rules (port of DevScout's writingRules.js / applyWritingRules.js tests): roles, possessives, soft question lead-ins
     never twice, the built intro (no "thanks for connecting", no question, under 50 words), the pointer ("buried" + the referral
     line), working days, contractions, sentence-case subjects, and the checks: call asks, delivery details outside the approach,
     "from Ukraine", vague agency proof only, more than two names, vanity numbers, the tagline read back, both role words,
     generalisations about their clients' money, a lead-in twice, the pointer on its email's day;
  P. the plan: connected = intro + 3-4 emails + pointer (2 working days after the value email); not connected = emails only;
     invited = emails now and the intro after the acceptance; 3 emails with 2-3 usable facts, 4 with 4+;
  F. one angle and 2-3 facts: F1 = the service gap, F2 = the client niche, F3 = another kind; no vanity or role fact;
  C. the case: matched on the client niche AND the service we pitch; no match = no case; the picker lists matching cases first;
  E. the writer end to end: intro and pointer built by code (the model's are never used), the voice enforced, delivery details
     only in the approach, the case under the approach, the ledger holds exactly the facts used, the good wave passes, the bad one
     shows "Do not send as is" and cannot be approved; the intro joins the wave on acceptance; "Change case";
  Q. resumable runs (#4b): the queue survives a restart, Resume continues with the items left and never redoes a finished one;
  M. the minor fixes' logic: label counts (#5), by_click runs (#9), /ping (#3), falconscout.bat checks /health first (#4a),
     no #e6261f left in the Metro code (#7), the Metro mark files (#1, #8).
Run: python tests/metro/test_metro_phase3b.py
"""
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


tmp = Path(tempfile.mkdtemp(prefix="metro-p3b-"))
eng = create_engine(f"sqlite:///{tmp / 'scratch.db'}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402
app_db.Base.metadata.create_all(eng)

from metro import cases as cs                  # noqa: E402
from metro import chains as ch                 # noqa: E402
from metro import db as mdb                    # noqa: E402
from metro import progress                     # noqa: E402
from metro import runqueue as rq               # noqa: E402
from metro import writing as w                 # noqa: E402

mdb.set_engine(eng)
from metro.router import router                # noqa: E402
app = FastAPI()
app.include_router(router)
client = TestClient(app)
S = lambda: Session(mdb.get_engine())           # noqa: E731
DAY = datetime(2026, 11, 27, 12, 0, 0)

# ═════════════ W. the writing rules ═════════════
check(w.role_phrase("Founder & CEO") == "the founder of", "role: founder first")
check(w.role_phrase("Co-Founder at X") == "a co-founder of", "role: co-founder")
check(w.role_phrase("CEO") == "running" and w.role_phrase("Managing Director") == "running", "role: CEO / MD = running")
check(w.role_phrase("Head of SEO") == "leading SEO at", "role: head of SEO")
check(w.role_phrase("Cool Person") == "", "role: 'coo' never matches inside 'Cool'; unknown = ''")
check(w.possessive("TISKON") == "TISKON's" and w.possessive("Baal & Spots") == "Baal & Spots'", "possessives")
used = set()
q1 = w.soften_question("How do you handle paid search today?", used, 0)
q2 = w.soften_question("Who runs SEO for your clients?", used, 0)
check(any(q1.startswith(x) for x in w.SOFT_LEADINS) and q1.split(",")[0] != q2.split(",")[0], "soft lead-ins, never the same one twice in a wave")
check(w.soften_question("I'm curious, how many?", set(), 0) == "I'm curious, how many?", "an existing lead-in is kept")
check("PPC" in w.soften_question("PPC is handled how?", set(), 0), "an acronym first word keeps its case")
intros = [w.build_intro(first="Ann", title="Founder", company="Bright Pixel", families=["SEO", "web design / development"], seed=i)["text"] for i in range(6)]
check(all("thanks for connecting" not in x.lower() and "good to meet you" not in x.lower() and "following up" not in x.lower() for x in intros),
      "the intro never says thanks for connecting / good to meet you / following up (the invitations were EMPTY)")
check(all("network" in x.split("\n")[0] for x in intros), "the intro opens with a rotated 'glad / good to be in your network' line")
check(all("?" not in x and len(x.split()) <= 50 and len(x) <= 300 for x in intros), "the intro: no question, 50 words at most (DevScout), under 300 characters")
check(all("the founder of Bright Pixel" in x for x in intros) and len(set(intros)) >= 3, "the intro names the role and rotates by seed")
check(all("behind-the-scenes Google Ads and SEO team for agencies" in x for x in intros), "the intro says our role in Oleh's words")
check(w.lint_message({"job": "intro", "channel": "linkedin", "body": intros[0]}) == [], "a built intro passes its own checks")
check(any(f["rule"] == "intro_question" for f in w.lint_message({"job": "intro", "channel": "linkedin", "body": "Hi Ann.\n\nWhat are you working on?"})),
      "a question in the intro is caught")
pt = w.build_pointer(first="Ann", subject="A Google Ads tip for dental clients", seed=0)
check("buried" in pt["text"] and "If it's not your area, a pointer to the right person would be great." in pt["text"]
      and "a Google Ads tip for dental clients" in pt["text"] and not pt["generic"], "the pointer: the email topic, 'buried', the referral line")
check(w.build_pointer(first="Ann", subject="", seed=0)["generic"], "no usable subject: a generic topic, and it says so")
check(w.add_working_days("2026-12-11", 2) == "2026-12-15" and w.add_working_days("2026-12-10", 2) == "2026-12-14", "working days (Friday + 2 = Tuesday)")
check(w.humanize('We are sure it is fine and "we are the best" at https://x.example/it-is/') ==
      "We're sure it's fine and \"we are the best\" at https://x.example/it-is/", "contractions, never in quotes or URLs")
check(w.humanize("It looks healthier than it is.") == "It looks healthier than it is." and w.humanize("as busy on Google as it is on social") == "as busy on Google as it is on social"
      and w.humanize("It is fine and we are here.") == "It's fine and we're here.", "no contraction at the end of a clause or in a comparison (the run wrote 'than it's.')")
check(w.fix_marks("Your clients — mostly dental! Great.") == "Your clients, mostly dental. Great.", "no em dash, no '!' (fixed by code)")
check(w.subject_case("White-Label Google ads For tiskon Clients", {"TISKON"}) == "White-label Google Ads for TISKON clients", "subject: sentence case, proper nouns capitalised")
check(w.subject_case("google ads for grain group food brands", {"GRAIN Group"}) == "Google Ads for GRAIN Group food brands", "subject: a multi-word company name")


def rules(body, job="hook", subject="Google Ads for Bright Pixel clients", **kw):
    return {f["rule"] for f in w.lint_message({"job": job, "channel": "email", "subject": subject, "body": body, **kw})}


OK_BODY = "Hi Ann,\n\nNoticed that your services stop at SEO and web design.\n\nSo I wanted to ask: do your clients ever ask for paid search?\n\nArtem"
check(rules(OK_BODY) == set(), f"a clean hook email passes ({rules(OK_BODY)})")
check("call_ask" in rules(OK_BODY.replace("paid search?", "paid search? Happy to book a time.")), "a call ask is caught")
check("delivery" in rules(OK_BODY.replace("web design.", "web design. We never contact your client."), job="value4")
      and "delivery" not in rules(OK_BODY.replace("web design.", "web design. We never contact your client."), job="approach"),
      "delivery details: only in the approach email")
check("banned" in rules(OK_BODY.replace("web design.", "web design. We're a team from Ukraine.")), '"from Ukraine" is refused')
check("agency_proof" in rules(OK_BODY.replace("web design.", "web design. We already work behind 12 agencies in the US.")), "agency proof with a number / country is caught")
check("agency_proof" not in rules(OK_BODY.replace("web design.", "web design. We already work behind a few agencies.")), "vague agency proof is fine")
check("names_list" in rules(OK_BODY.replace("web design.", "web design for Smile Dental, Bright Teeth and Happy Molar.")), "more than two names is caught")
check("vanity" in rules(OK_BODY.replace("web design.", "web design, and you have 1,200 followers.")), "a vanity number about the person is caught")
check("tagline" in rules(OK_BODY.replace("web design.", "web design. You do SEO and web design for dentists."), tagline_texts=["Bright Pixel - SEO and Web Design for Dentists"]) or
      "tagline" in {f["rule"] for f in w.lint_message({"job": "hook", "channel": "email", "subject": "x y", "body": OK_BODY.replace("web design.", "web design. You do SEO and web design for dentists."), "leadin": None}, tagline_texts=["Bright Pixel - SEO and Web Design for Dentists"])},
      "their tagline read back is caught")
check("role_wording" in rules(OK_BODY.replace("web design.", "web design. We're a white-label, behind-the-scenes team.")), "white-label AND behind-the-scenes in one message is caught")
check("generalisation" in rules(OK_BODY.replace("web design.", "web design. Cases like those usually come with ad budgets.")), "the 'cases like those usually come with ad budgets' generalisation is caught")
check("subject_case" in rules(OK_BODY, subject="White Label Google Ads For Your Clients"), "a Title Case subject is caught")
check("signoff" in rules(OK_BODY.replace("\n\nArtem", "")), "an email not signed Artem is caught")
lw = w.lint_wave([
    {"step": 1, "job": "hook", "channel": "email", "subject": "a b c", "body": "Hi Ann,\n\nNoticed that your clients are dental.\n\nJust curious, who runs PPC?\n\nArtem", "day": 0},
    {"step": 2, "job": "approach", "channel": "email", "reply": True, "subject": None, "body": "Hi Ann,\n\nNoticed that you're in Austin.\n\nJust curious, who runs SEO?\n\nArtem", "day": 5},
    {"step": 3, "job": "value", "channel": "email", "subject": "d e f", "body": "Hi Ann,\n\nA tip for Austin clinics: split brand and non-brand.\n\nArtem", "day": 14},
    {"step": 4, "job": "pointer", "channel": "linkedin", "subject": None, "body": "Ann, x buried.", "day": 14, "after_step": 3}], names=["Ann", "Bright Pixel"])
rl = {c["rule"] for c in lw["chain"]}
check("leadin_twice" in rl, "a lead-in used twice in the wave is caught")
check("fact_reused" in rl, "a fact of the approach coming back in the tip is caught")
check("pointer_day" in rl, "the pointer on the same day as its email is caught")

# ═════════════ synthetic data ═════════════
SCAN = {"ok": True, "version": 2, "domain": "brightpixel.example", "services": ["Local SEO", "Technical SEO", "Web Design", "Social Media Management", "Branding"],
        "marketing_terms": ["seo", "web_design", "social_media"], "industries": ["Dental", "Legal"], "niches": {"dental": 14, "legal": 6},
        "case_studies": ["Smile Dental"], "partners": ["HubSpot Platinum Partner"], "founded_year": 2012,
        "title": "Bright Pixel - SEO and Web Design for Dentists", "meta_description": "We grow dental practices.", "h1": "Dental marketing"}

with S() as s:
    agency = mdb.MetroCampaign(name="Agency test", type="agency", status="active", brief_json=json.dumps({"do_not_claim": ["Guaranteed results"]}),
                               offer="Send us one client you're struggling to deliver for, or start with a free pilot audit.")
    s.add(agency)
    s.flush()
    co = mdb.MetroCompany(name="Bright Pixel", name_key="brightpixel", domain="brightpixel.example", website_scan_json=json.dumps(SCAN), website_scan_at=DAY)
    co2 = mdb.MetroCompany(name="Lone Agency", name_key="loneagency", domain="lone.example",
                           website_scan_json=json.dumps(dict(SCAN, domain="lone.example", niches={"legal": 3}, industries=["Legal"])), website_scan_at=DAY)
    co3 = mdb.MetroCompany(name="Third Co", name_key="thirdco", domain="third.example", website_scan_json=json.dumps(dict(SCAN, domain="third.example")), website_scan_at=DAY)
    s.add_all([co, co2, co3])
    s.flush()

    def lead(name, title, company, **kw):
        l = mdb.MetroLead(campaign_id=agency.id, company_id=company.id, full_name=name, first_name=name.split()[0], last_name=name.split()[-1],
                          title=title, company_name=company.name, status="new", persona_score=70, persona_verdict="keep", fit_score=70,
                          profile_url=f"https://www.linkedin.com/in/{name.lower().replace(' ', '-')}", source_file="t.csv", created_at=DAY, **kw)
        s.add(l)
        s.flush()
        return l.id
    ann = lead("Ann Example", "Founder at Bright Pixel", co, invite_status="connected", email="ann@brightpixel.example", email_status="domain_ok", email_type="business")
    cara = lead("Cara Lone", "CEO at Lone Agency", co2, invite_status="none", email="cara@lone.example", email_status="domain_ok", email_type="business")
    dan = lead("Dan Third", "Managing Partner", co3, invite_status="invited", email="dan@third.example", email_status="domain_ok", email_type="business")

    def hook(company, fact, kind, path, lead_id=None, scope="company"):
        s.add(mdb.MetroHook(company_id=company.id, lead_id=lead_id, fact=fact, kind=kind, source_field=path, seen_at=DAY, scope=scope, campaign_id=agency.id,
                            evidence_json=json.dumps([{"id": "E1", "path": path, "value": "x", "at": "2026-11-27"}])))
    hook(co, "They sell Local SEO, Technical SEO, Web Design, Social Media and Branding, and nothing in paid search.", "service_gap", "website.services")
    hook(co, "Their clients are mostly dental practices, then law firms.", "clients_niche", "website.niches")
    hook(co, "They carry the HubSpot Platinum Partner badge.", "partner_badge", "website.partners")
    hook(co, "They have been in business since 2012.", "agency_age", "website.founded_year")
    hook(co, "Founder at Bright Pixel.", "role", "person.title", lead_id=ann, scope="person")
    hook(co, "They have 1200 followers on LinkedIn.", "public_voice", "person.followers", lead_id=ann, scope="person")
    hook(co2, "Their clients are mostly law firms.", "clients_niche", "website.niches")
    hook(co2, "They carry the HubSpot Platinum Partner badge.", "partner_badge", "website.partners")
    hook(co3, "They sell Local SEO and Web Design, and nothing in paid search.", "service_gap", "website.services")
    hook(co3, "Their clients are mostly dental practices.", "clients_niche", "website.niches")
    hook(co3, "They are based in Austin, Texas.", "geography", "linkedin_company.location")
    for url, title, ind, svc, country in [
            ("https://itforce.ua/en/cases/dental-ppc/", "Google Ads for a dental clinic", "Dentistry, Local business", "PPC contextual advertising", "Poland"),
            ("https://itforce.ua/en/cases/dental-seo/", "SEO promotion for a dental clinic website", "Dentistry, Local business, SEO search promotion", None, "Ukraine"),
            ("https://itforce.ua/en/cases/flowers/", "Contextual advertising for a flower shop in Canada", "Flowers / Gifts, Online stores", "PPC contextual advertising", "Canada"),
            ("https://itforce.ua/en/cases/legal-seo/", "SEO promotion for a company providing legal services", "B2B, Legal services, SEO search promotion", None, "Ukraine")]:
        s.add(mdb.MetroCaseLink(url=url, title=title, industry_tags=ind, service_tags=svc, country=country))
    s.commit()
    AG, CO, CO2, CO3 = agency.id, co.id, co2.id, co3.id

# ═════════════ P. the plan ═════════════
L = lambda **kw: mdb.MetroLead(status="new", **kw)  # noqa: E731
p = ch.plan(L(invite_status="connected", email="a@b.example", email_status="domain_ok"), 4)
check([x["job"] for x in p["steps"]] == ["intro", "hook", "approach", "value4", "pointer", "close"], f"connected, 4+ facts: intro + 4 emails + pointer ({[x['job'] for x in p['steps']]})")
ptr = next(x for x in p["steps"] if x["job"] == "pointer")
val = next(x for x in p["steps"] if x["job"] == "value4")
check(ptr["after_step"] == val["step"] and ptr["working_days_after"] == 2 and ptr["day"] > val["day"], "the pointer: 2 working days after the value email, never the same day")
p = ch.plan(L(invite_status="connected", email="a@b.example", email_status="domain_ok"), 3)
check([x["job"] for x in p["steps"]] == ["intro", "hook", "approach", "value", "pointer"], "connected, 2-3 facts: intro + 3 emails + pointer")
p = ch.plan(L(invite_status="none", email="a@b.example", email_status="domain_ok"), 3)
check(all(x["channel"] == "email" for x in p["steps"]) and len(p["steps"]) == 3, "not connected: the same wave by email, no LinkedIn touch")
p = ch.plan(L(invite_status="invited", email="a@b.example", email_status="domain_ok"), 4)
check(all(x["channel"] == "email" for x in p["steps"]) and p["intro_on_accept"], "invited, not accepted: the email wave now, the intro after the acceptance")
check([x["day"] for x in p["steps"]] == [0, 5, 14, 21], "DevScout's day offsets (0 / 5 / 14 / 21)")
check(all(not x.get("reply") for x in p["steps"] if x["job"] in ("hook", "value4")) and all(x.get("reply") for x in p["steps"] if x["job"] in ("approach", "close")),
      "threads: the approach replies to the hook, the close to the value email")

# ═════════════ F. one angle, 2-3 facts ═════════════
with S() as s:
    la = s.get(mdb.MetroLead, ann)
    ctx = ch.wave_context(s, la, s.get(mdb.MetroCampaign, AG))
kinds = [h.kind for h in ctx["facts"]]
check(kinds[:2] == ["service_gap", "clients_niche"] and len(ctx["facts"]) == 3, f"F1 = the service gap, F2 = the client niche, F3 another kind ({kinds})")
check(not any("followers" in h.fact for h in ctx["facts"]) and "role" not in kinds, "no vanity number and no bare role is ever a fact")
check(ctx["plan"]["four"] and ctx["angle"]["service"] == "Google Ads" and ctx["angle"]["niche"] == "dental", f"4 usable facts = 4 emails; the angle pitches Google Ads to a dental SEO shop ({ctx['angle']})")
check(len(set(x.split(" ")[0] for x in ctx["leadins"])) == len(ctx["leadins"]), f"one lead-in per fact, never the same word twice ({ctx['leadins']})")

# ═════════════ C. the case ═════════════
check(ctx["case"] and ctx["case"]["url"].endswith("/dental-ppc/"), "the case: their client niche (dental) AND the service we pitch (PPC)")
with S() as s:
    check(cs.best_match(s, ["fitness"], {"ppc"}) is None, "no niche match: no case at all (never a flower shop for a dental agency)")
    check(cs.best_match(s, ["legal"], {"ppc"}) is None and cs.best_match(s, ["legal"], {"seo"})["url"].endswith("/legal-seo/"),
          "niche without the service = no case; niche + service = that case")
    opts = ch.case_options(s, s.get(mdb.MetroLead, ann))
check(opts["matching"] and opts["matching"][0]["url"].endswith("/dental-ppc/") and len(opts["matching"]) + len(opts["others"]) == 4,
      "the picker lists the matching cases first, then all the others")
check(cs.case_services({"title": "SEO promotion for a dental clinic website", "industry_tags": ["SEO search promotion"], "service_tags": []}) == {"seo"},
      "a case's service is read from 'SEO search promotion' and the title")


# ═════════════ E. the writer end to end ═════════════
def wave_model(bad=False, calls=None):
    def m(prompt, **kw):
        if calls is not None:
            calls.append(prompt)
        first = re.search(r"THE PERSON: (\w+)", prompt).group(1)
        leadins = re.findall(r'opened with "([^"]+?) \.\.\."', prompt)
        jobs = re.findall(r"^  (hook|approach|value|close) \(", prompt, re.M)
        out = [{"job": "intro", "body": "Hi, thanks for connecting! Quick question?"}]          # the model's intro is never used
        for j in jobs:
            if j == "hook":
                body = (f"Hi {first},\n\n{leadins[0]} your service pages: local SEO, web design and social, and no paid search among them.\n\n"
                        f"In my experience, agencies that sell SEO get asked about Google Ads sooner or later. We can be your behind-the-scenes "
                        f"Google Ads and SEO team, under your name.\n\nDo your clients ever ask you for paid search?\n\nArtem")
                if bad:
                    body = body.replace("sooner or later.", "sooner or later. We're a team from Ukraine, and we already work behind 12 agencies in the US. "
                                        "You have 1200 followers. Let's book a time — soon!")
                out.append({"job": "hook", "subject": "google ads For Bright Pixel Clients" if not bad else "Google Ads", "body": body})
            elif j == "approach":
                body = (f"Hi {first},\n\n{leadins[1] if len(leadins) > 1 else 'Noticed'} your client list, mostly dental practices. We've done "
                        f"Google Ads for dental clinics, so here's a similar project of ours.\n\nThe work goes out under your name and we never contact your "
                        f"client. We're in a European time zone, so the work is done overnight. If it helps, send us one client you're struggling "
                        f"to deliver for and we'll scope it, or we can start with a free pilot audit.\n\nWould one dental client be a good place to start?\n\nArtem")
                out.append({"job": "approach", "subject": None, "body": body})
            elif j == "value":
                body = (f"Hi {first},\n\nOne thing that works for dental practices in Google Ads: a separate campaign for emergency searches, with "
                        f"call-only ads during opening hours. Your team can set it up in an afternoon.\n\nHow do you handle emergency searches for "
                        f"your clients today?\n\nArtem")
                if bad:
                    body = body.replace("in an afternoon.", "in an afternoon, and we never contact your client.")
                out.append({"job": "value", "subject": "a Google Ads tip for dental clients", "body": body})
            elif j == "close":
                body = (f"Hi {first},\n\nComing back to your HubSpot Platinum badge: if a client of yours ever needs paid search next to it, "
                        f"I'm around. Thanks for reading, and all the best to the team.\n\nArtem")
                out.append({"job": "close", "subject": None, "body": body})
        return json.dumps({"angle_check": {"verdict": "ok", "note": "none"}, "touches": out})
    return m


calls = []
with S() as s:
    la = s.get(mdb.MetroLead, ann)
    r = ch.write_chain(s, la, s.get(mdb.MetroCampaign, AG), ask=wave_model(calls=calls))
    v = ch.chain_view(s, la)
check(r["written"] and r["emails"] == 4 and len(calls) == 1, f"ann (connected, 4 facts): ONE model call, a 4-email wave ({r})")
jobs = [t["job"] for t in v["touches"]]
check(jobs == ["intro", "hook", "approach", "value4", "pointer", "close"], f"the wave in send order ({jobs})")
intro = v["touches"][0]["body"]
check("thanks for connecting" not in intro.lower() and "?" not in intro and "the founder of Bright Pixel" in intro, "the intro is BUILT by code (the model's 'thanks for connecting' is dropped)")
pointer = next(t for t in v["touches"] if t["job"] == "pointer")["body"]
check("a Google Ads tip for dental clients" in pointer and "buried" in pointer, "the pointer is built by code, its topic from the value email's subject")
hook_t = next(t for t in v["touches"] if t["job"] == "hook")
check(hook_t["subject"] == "Google Ads for Bright Pixel clients", f"the subject: sentence case, proper nouns kept ({hook_t['subject']})")
check(hook_t["text"].endswith("\n\nArtem") and hook_t["text"].startswith("Hi Ann,"), "greeting and the 'Artem' sign-off")
qs = [re.findall(r"[^.\n]*\?", t["text"])[-1].strip() for t in v["touches"] if t["channel"] == "email" and "?" in t["text"]]
heads = [w.leadin_key(q) or q.split(" ")[0] for q in qs]
check(qs[0].startswith("So I wanted to ask:") and len(set(heads)) == len(heads), f"questions softened (the first with the bridge), never the same lead-in twice ({heads})")
appr = next(t for t in v["touches"] if t["job"] == "approach")
check(appr["case"] and appr["case"]["url"].endswith("/dental-ppc/") and appr["body"].endswith("https://itforce.ua/en/cases/dental-ppc/")
      and "itforce.ua" not in appr["text"] and appr["subject"] is None, "the case is attached by code under the approach email (a reply: no subject)")
others = [t for t in v["touches"] if t["job"] != "approach"]
check(not any(d in t["text"].lower() for t in others for d in w.DELIVERY_TERMS), "delivery details live in the approach email only")
with S() as s:
    held = s.query(mdb.MetroHook).filter(mdb.MetroHook.used_touch_id.isnot(None)).all()
check(len(held) == 3 and {h.kind for h in held} == {"service_gap", "clients_niche", "partner_badge"},
      f"the ledger holds exactly the 3 facts the wave uses ({[h.kind for h in held]}); the 4th stays for the next wave")
print("   flags:", [(t["step"], [f["text"] for f in t["checks"]]) for t in v["touches"] if t["checks"]], v["notes"].get("chain_flags"))
check(all(t["checks_passed"] for t in v["touches"]) and v["notes"]["ok"] and v["status"]["state"] == "written", "the good wave passes every check")
prompt = calls[0]
check("F1 (service_gap)" in prompt and "F2 (clients_niche)" in prompt and "F3 (partner_badge)" in prompt and "agency_age" not in prompt.split("THE WAVE")[0].split("FACTS")[1],
      "the prompt gives the model the 3 facts only (not every hook)")
check("from ukraine" not in prompt.lower().replace('"from ukraine"', "") and "white-label" in prompt.lower(), "IT Force is never 'from Ukraine' in the prompt")

with S() as s:                                   # the bad wave
    la = s.get(mdb.MetroLead, ann)
    r = ch.write_chain(s, la, s.get(mdb.MetroCampaign, AG), ask=wave_model(bad=True))
    v = ch.chain_view(s, la)
allr = {f["rule"] for t in v["touches"] for f in t["checks"]} | {f["rule"] for f in v["notes"]["chain_flags"]}
check({"banned", "agency_proof", "vanity", "call_ask", "delivery"} <= allr, f"the planted mistakes are caught ({sorted(allr)})")
hook_t = next(t for t in v["touches"] if t["job"] == "hook")
check("—" not in hook_t["text"] and "!" not in hook_t["text"], "the em dash and '!' were fixed by code before the checks")
check(not r["ok"] and v["status"]["state"] == "issues" and v["status"]["label"].startswith("Do not send as is"), "a failing wave says 'Do not send as is'")
with S() as s:
    try:
        ch.approve(s, s.get(mdb.MetroLead, ann))
        refused = False
    except ValueError:
        refused = True
check(refused, "a failing wave cannot be approved without Send anyway")
with S() as s:
    held2 = s.query(mdb.MetroHook).filter(mdb.MetroHook.used_touch_id.isnot(None)).count()
print("   held after the rewrite:", held2)
check(held2 == 3, "a rewrite frees the old draft's facts and holds the new ones (no pile-up)")

with S() as s:                                   # Cara: not connected, 2 facts -> 3 emails, no LinkedIn
    lc = s.get(mdb.MetroLead, cara)
    r = ch.write_chain(s, lc, s.get(mdb.MetroCampaign, AG), ask=wave_model())
    vc = ch.chain_view(s, lc)
check(r["written"] and r["emails"] == 3 and all(t["channel"] == "email" for t in vc["touches"]) and len(vc["touches"]) == 3,
      f"cara (not connected, 2 facts): 3 emails, no LinkedIn touch ({[t['job'] for t in vc['touches']]})")
check(not any(t["case"] for t in vc["touches"]) and vc["notes"]["case_note"], "no PPC case for her legal clients: no case, and the panel says why")
with S() as s:                                   # Dan: invited -> email wave now, the intro on acceptance
    ld = s.get(mdb.MetroLead, dan)
    ch.write_chain(s, ld, s.get(mdb.MetroCampaign, AG), ask=wave_model())
    before = [t.channel for t in s.query(mdb.MetroTouch).filter_by(lead_id=dan).all()]
    ld.invite_status = "connected"
    s.commit()
pan = client.get(f"/metro/leads/{dan}/panel").json()
check(set(before) == {"email"} and pan["chain"]["touches"][0]["job"] == "intro" and pan["chain"]["touches"][0]["step"] == 0
      and pan["chain"]["touches"][0]["on_accept"], "invited: emails only; once he accepts, the built intro joins the wave (step 0, on acceptance)")
check("thanks for connecting" not in pan["chain"]["touches"][0]["body"].lower(), "the late intro is the built one too")

# "Change case"
r = client.get(f"/metro/leads/{cara}/cases").json()
legal = next(c for c in r["matching"] + r["others"] if c["url"].endswith("/legal-seo/"))
r = client.post(f"/metro/leads/{cara}/chain/case", json={"case_id": legal["id"]}).json()
appr = next(t for t in r["chain"]["touches"] if t["job"] == "approach")
check(r["attached"] and appr["body"].endswith("/legal-seo/") and appr["case"]["id"] == legal["id"], "'Change case' puts the picked case under the approach email")
with S() as s:
    lc = s.get(mdb.MetroLead, cara)
    check(lc.case_choice_id == legal["id"], "the hand pick is kept for later rewrites")
    ch.write_chain(s, lc, s.get(mdb.MetroCampaign, AG), ask=wave_model())
    appr2 = [t for t in ch.chain_view(s, lc)["touches"] if t["job"] == "approach"][0]
check(appr2["case"] and appr2["case"]["id"] == legal["id"], "a rewrite keeps the hand-picked case")

# approved waves are never touched by a rewrite
with S() as s:
    lc = s.get(mdb.MetroLead, cara)
    ch.approve(s, lc, send_anyway=True)
    r = ch.write_chain(s, lc, s.get(mdb.MetroCampaign, AG), ask=lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not ask")))
check(not r["written"] and "approved" in r["reason"], "an approved wave is never rewritten (the model is not even asked)")

# the email export threads the replies
text = client.get(f"/metro/campaigns/{AG}/export/email").text
check("Re: " in text, "the email export gives a reply its thread's subject (Re: ...)")

# ═════════════ R. what the real run on the copy taught (27 Nov) ═════════════
from metro import chaincheck as cc               # noqa: E402
from metro import hooks as hk                    # noqa: E402
with S() as s:
    s.add(mdb.MetroHook(company_id=CO, fact="They position themselves as 'the dental growth partner for modern practices'.", kind="services",
                        source_field="website.title", seen_at=DAY, scope="company", campaign_id=AG))
    s.commit()
    hs = ch.available_hooks(s, s.get(mdb.MetroLead, ann), "agency")
check(not any("position themselves" in h.fact for h in ch.usable_facts(hs)), "a positioning line is never a fact to recite (the run's closes read it back)")


class _H:
    def __init__(self, fact, kind):
        self.fact, self.kind, self.source_field, self.scope, self.id = fact, kind, "website.services", "company", 0


with S() as s:
    a = ch.angle_of(s.get(mdb.MetroCompany, CO), s.get(mdb.MetroLead, ann), [], "agency",
                    all_hooks=[_H("They list Search engine marketing, Digital Advertising and SEO Services.", "services")])
check(a["service"] == "Google Ads and SEO" and "no paid search" not in a["text"] and "capacity" in a["text"],
      f"a services hook naming SEM means they already sell paid search: the angle is capacity, not a gap ({a['text']})")
tip = {"job": "value4", "channel": "email", "subject": "A Google Ads tip", "body": "Hi Ann,\n\nCheck the trial-signup cost per lead.\n\nArtem", "hook_ids": []}
check(not any(f["rule"] == "price" for f in cc.check_touch(tip, lead_first="Ann", hooks={}, used_elsewhere=set(), segment="agency", allowed_numbers=set())),
      "'cost per lead' in a PPC tip is not a price")
tip["body"] = tip["body"].replace("cost per lead", "cost, about $40")
check(any(f["rule"] == "price" for f in cc.check_touch(tip, lead_first="Ann", hooks={}, used_elsewhere=set(), segment="agency", allowed_numbers=set())),
      "...but a currency in the tip still is")
check(w.subject_case("SEO for operatic's real estate clients", {"Operatic"}) == "SEO for Operatic's real estate clients", "a possessive company name keeps its capital")
lw2 = w.lint_wave([
    {"step": 1, "job": "hook", "channel": "email", "subject": "a b", "body": "Hi Ann,\n\nNoticed that most of your clients are B2B companies.\n\nSo I wanted to ask: who runs PPC?\n\nArtem", "day": 0},
    {"step": 2, "job": "value4", "channel": "email", "subject": "c d", "body": "Hi Ann,\n\nHere's a tip for B2B accounts: import CRM stages as conversions.\n\nJust curious, do you?\n\nArtem", "day": 14}],
    names=["Ann"], keep_words=["b2b"])
check(not any(c["rule"] == "fact_reused" for c in lw2["chain"]), "the niche word (B2B) and trade words (CRM, Here's) in the tip are not a reused fact")
check(w.fix_marks("those clicks quietly eat the budget") == "those clicks eat the budget", "'quietly' (DevScout's banned adverb) is dropped by code")
with S() as s:                                    # an old-shape (P3) draft of a lead with no facts does not linger
    l0 = mdb.MetroLead(campaign_id=AG, full_name="Eve Nohooks", first_name="Eve", company_name="Empty Co", status="new", persona_score=70,
                       fit_score=70, chain_written_at=DAY, chain_json=json.dumps({"plan": {"steps": []}}), account_role="primary")
    s.add(l0)
    s.flush()
    s.add(mdb.MetroTouch(lead_id=l0.id, cycle=1, step=1, channel="linkedin", body="Hi Eve, thanks for connecting. We're a team from Ukraine.", status="draft"))
    s.commit()
    r = ch.write_chain(s, l0, s.get(mdb.MetroCampaign, AG), ask=lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not ask")))
    left = s.query(mdb.MetroTouch).filter_by(lead_id=l0.id).count()
check(not r["written"] and "old P3 draft" in r["reason"] and left == 0, f"no usable facts: no wave, and the old P3 draft is removed ({r['reason']})")
with S() as s:
    s.add(mdb.MetroCaseLink(url="https://itforce.ua/en/cases/pub/", title="Promotion of a pub", industry_tags="Alcohol-related topics, Local business",
                            service_tags="PPC contextual advertising", country="Switzerland"))
    s.add(mdb.MetroCaseLink(url="https://itforce.ua/en/cases/drinks-store/", title="Google Ads for a drinks store", industry_tags="Alcohol-related topics",
                            service_tags="PPC contextual advertising", country="Ukraine"))
    s.commit()
    best = cs.best_match(s, ["food & beverage"], {"ppc"})
check(best and best["url"].endswith("/drinks-store/"), f"a food-brand agency gets the drinks store, not the local pub ({best and best['url']})")
with S() as s:
    check(cs.best_match(s, ["franchise / multi-location"], {"ppc"}) is None, "no automatic case through the generic 'Local business' tag alone")

# ═════════════ Q. resumable runs (#4b) ═════════════
qid = rq.begin("chains", AG, [ann, cara, dan], label="Writing chains")
rq.item_done(qid, ann)
check(rq.mark_interrupted(mdb.get_engine()) >= 1, "a restart marks the run that was going as interrupted")
its = rq.interrupted(AG)
mine = next(x for x in its if x["queue_id"] == qid)
check(mine["status"] == "interrupted" and mine["done"] == 1 and mine["total"] == 3 and mine["can_resume"] and "1 of 3" in mine["result"],
      f"the strip gets it with Resume ({mine['result']})")
seen_args = {}
orig = ch.start_chains_run
ch.start_chains_run = lambda cid, ids, **kw: (seen_args.update(cid=cid, ids=ids), {"started": True})[1]
try:
    r = client.post(f"/metro/runs/{qid}/resume").json()
finally:
    ch.start_chains_run = orig
check(r["started"] and seen_args == {"cid": AG, "ids": [cara, dan]}, f"Resume continues with the items left, never the finished one ({seen_args})")
check(client.post(f"/metro/runs/{qid}/resume").status_code == 409, "a resumed run cannot be resumed twice")
snap = client.get("/metro/progress").json()
check(not any(x.get("queue_id") == qid for x in snap["runs"]), "a resumed run leaves the strip")
qid2 = rq.begin("hooks", AG, [[str(CO), [ann]], [str(CO2), [cara]]], label="Writing hooks")
rq.mark_interrupted(mdb.get_engine())
check(client.post(f"/metro/runs/{qid2}/dismiss").status_code == 200 and not any(x.get("queue_id") == qid2 for x in client.get("/metro/progress").json()["runs"]),
      "an interrupted run can be dismissed")

# ═════════════ M. the minor fixes' logic ═════════════
summ = client.get(f"/metro/campaigns/{AG}/chains/summary").json()
check(summ["shortlisted"] == 4 and summ["companies"] == 4 and summ["hook_companies"] == 3, f"the Write card counts what it will process (#5: {summ})")
rid = progress.start("enrich", "Enriching", total=1, by_click=True)
check(any(x["id"] == rid and x["by_click"] for x in progress.snapshot()["runs"]), "a run started by a click says so (#9: its 'done' shows on the other side)")
check(client.get("/metro/ping").json() == {"ok": True}, "/metro/ping answers without the database (#3)")
bat = (ROOT / "falconscout.bat").read_text(encoding="utf-8")
check("/health" in bat and ":5180" in bat and "already running" in bat.lower(), "falconscout.bat checks /health on :8000 and :5180 first and only opens the browser (#4a)")
red = [str(p.relative_to(ROOT)) for p in (ROOT / "frontend" / "src" / "metro").rglob("*") if p.is_file() and p.suffix in (".js", ".jsx", ".css", ".svg")
       and re.search(r"#e6261f", p.read_text(encoding="utf-8", errors="replace"), re.I)]
check(red == [], f"no #e6261f left in the Metro code (#7: {red})")
check((ROOT / "frontend" / "public" / "brand" / "metro-mark.png").exists(), "the approved Metro mark is in public/brand (#1)")
fav = (ROOT / "frontend" / "src" / "metro" / "lib" / "favicon.js").read_text(encoding="utf-8")
check("/brand/metro-mark.png" in fav, "the Metro tab icon is the approved mark (#1, #8)")

print(f"\n{'all passed' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
