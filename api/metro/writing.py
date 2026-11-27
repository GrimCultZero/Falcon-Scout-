"""Writing rules for Metro's waves (P3b, 27 Nov 2026): DevScout's `writingRules.js` + `applyWritingRules.js`
(baba-leada, Oleh's code, ported to Python) rewritten for IT Force's agency line.

Why (METRO_PLAN.md, decision "Chain shape", 27 Nov): P3's chains gave every email a new recited fact ("touches = distinct
hooks") and read like a scraper reading their site back to them. DevScout's shape is the fix:
  * ONE angle per agency, carried through the wave ("you serve clients in X / you sell Y but not Z -> we've done X -> we can be
    your behind-the-scenes Google Ads and SEO team, under your name");
  * only 2-3 real facts in the WHOLE wave: the hook email's observation, a second fact (the approach) and the close's anchor;
    every other message adds an argument, never a new recited fact;
  * every message has a fixed job (WAVE_JOBS); the delivery details live in the approach email only;
  * the human voice is made true BY CODE after the model (`apply_rules`): contractions, soft question lead-ins (never one twice
    in a wave), no em dash or "!", sentence-case subjects, the greeting and the "Artem" sign-off; the LinkedIn intro and the
    pointer to the email are BUILT here and the model never writes them;
  * `lint_wave` reads the whole wave the way the recipient would (DevScout's lintChain + lintBlockers, plus P3b's rules).
Pure: no database, no AI call, no clock. Running `apply_rules` twice gives the same text.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

# ───────────────────────── 1. One job per touch ─────────────────────────

ONE_ANGLE_RULE = ("One agency = ONE angle, carried through every message of the wave. Only 2-3 real facts in the WHOLE wave: the "
                  "hook email's observation (F1), the second fact (F2, in the approach) and the close's anchor (F3). Every other "
                  "message adds a new ARGUMENT, never a new recited fact and never a new wording of the offer. Check the premise "
                  "against the facts: if a fact contradicts the angle, say so in angle_check (verdict \"flag\").")

WAVE_JOBS = {
    "intro": "LinkedIn intro on acceptance (built by code, not written by you).",
    "hook": ("First email of the wave, a NEW thread (write a subject): the observation F1 opened with the given lead-in (one sentence, "
             "in your own words, never their tagline read back to them); one \"I\" sentence on what it usually means for an agency "
             "like theirs; one sentence on what we do tied to it (we can be their behind-the-scenes Google Ads and SEO team, under "
             "their name); one soft question about THEM. 70-110 words."),
    "approach": ("A reply in the same thread (NO subject): the second fact F2 opened with the given lead-in, then the concrete "
                 "approach. The ONLY message with delivery details: the work goes out under their name, we never contact their "
                 "client, a European time zone so the work is done overnight, and the offer (\"send us one client you're struggling "
                 "to deliver for and we'll scope it, or start with a free pilot audit\"). {case} One soft question. 80-100 words (never over 115)."),
    "value": ("A NEW thread (write a subject): one practical Google Ads or SEO tip for THEIR clients ({niche}) that they can use "
              "without us. No re-sell, no delivery details, no new fact about them. It closes this 3-email wave, so end with ONE "
              "soft way back (no question needed). 55-85 words."),
    "value4": ("A NEW thread (write a subject): one practical Google Ads or SEO tip for THEIR clients ({niche}) that they can use "
               "without us. No re-sell, no delivery details, no new fact about them. End with one soft question about how they "
               "handle it. 55-85 words."),
    "pointer": "LinkedIn pointer to the email (built by code, not written by you).",
    "close": ("A reply in the value thread (NO subject): a short close, UNDER 60 words, anchored on F3 in one short clause, no "
              "re-sell, one soft way back, graceful."),
}
WORDS_MAX = {"intro": 50, "close": 60}

# Day offsets (DevScout wave-3e-v1 / wave-4e-v1; its LinkedIn "thought" touch is not part of Metro's agency wave).
DAY = {"intro": 0, "hook": 0, "approach": 5, "value": 14, "value4": 14, "close": 21}
POINTER_WORKING_DAYS = 2


def wave_steps(*, linkedin: bool, four: bool) -> list[dict]:
    """The touches of one wave, in send order. linkedin = connected on LinkedIn (intro + pointer); four = 4 emails."""
    jobs = (["intro"] if linkedin else []) + ["hook", "approach", "value4" if four else "value"]
    if linkedin:
        jobs.append("pointer")
    if four:
        jobs.append("close")
    out, thread_of = [], {"hook": "A", "approach": "A", "value": "B", "value4": "B", "close": "B"}
    for n, j in enumerate(jobs, 1):
        st = {"step": n, "job": j, "channel": "linkedin" if j in ("intro", "pointer") else "email"}
        if j == "pointer":
            val = next(x for x in out if x["job"] in ("value", "value4"))
            st.update(day=val["day"] + POINTER_WORKING_DAYS, after_step=val["step"], working_days_after=POINTER_WORKING_DAYS)
        else:
            st["day"] = DAY[j]
        if st["channel"] == "email":
            st["thread"] = thread_of[j]
            st["reply"] = j in ("approach", "close")
        out.append(st)
    return out


def add_working_days(iso: str, n: int) -> str:
    """n working days after a date (Mon-Fri only): Friday + 2 = Tuesday. n = 0 moves a weekend date to Monday (DevScout)."""
    d = date.fromisoformat(iso)
    left = n
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


# ───────────────────────── 2. Tone pools (rotate by seed; never twice in one wave) ─────────────────────────

# Observation lead-ins, picked by the KIND of fact (DevScout's OBSERVATION_LEADINS, keyed by Metro's hook kinds).
LEADINS = {
    "hiring":      ["Noticed", "I see that"],
    "case_study":  ["Was reading about", "Was looking at"],
    "services":    ["Was looking at", "Came across"],
    "service_gap": ["Was looking at", "Noticed"],
    "clients_niche": ["Came across", "Was looking at"],
    "partner_badge": ["Saw that", "Noticed"],
    "public_voice": ["Saw that", "Read that"],
    "geography":   ["Noticed", "I see that"],
    "agency_age":  ["Came across", "Saw that"],
    "team_size":   ["Came across", "Noticed"],
    "runs_ads":    ["Noticed", "Saw that"],
    "reviews":     ["Came across", "Saw that"],
    "founder_background": ["Was reading about", "Read that"],
    "followup":    ["Coming back to", "Thinking more about", "Since my last note,"],
}
ALL_LEADINS = sorted({x for v in LEADINS.values() for x in v}, key=len, reverse=True)
SOFT_LEADINS = ["Just curious, ", "Out of curiosity, ", "I was wondering, ", "I'm curious, ", "By the way, "]
FIRST_EMAIL_BRIDGE = "So I wanted to ask:"
BRIDGES = ["So I'm curious:", "So I wanted to ask:"]
HAS_LEADIN = re.compile(r"^(So I'm curious|So I wanted to ask|Which made me wonder|I'm curious|Out of curiosity|Just curious|I was wondering|By the way)")

INTRO_OPENERS = ["Hi {first}, glad to be in your network.", "Hi {first}, good to be in your network.",
                 "{first}, glad to be in your network.", "Hi {first}, nice to be part of your network."]
INTRO_ITFORCE = [
    "We're IT Force, the behind-the-scenes Google Ads and SEO team for agencies, so {poss} {business} work is close to ours.",
    "At IT Force we're the behind-the-scenes Google Ads and SEO team for agencies, which is why {poss} {business} work caught my eye.",
    "I'm with IT Force, the behind-the-scenes Google Ads and SEO team for agencies, so {business} shops like {company} are close to our world.",
]
INTRO_ITFORCE_NICHE = [
    "We're IT Force, a Google Ads and SEO team, so {poss} work caught my eye.",
    "At IT Force we run Google Ads and SEO, which is why {company} caught my eye.",
]
INTRO_CLOSES = ["Happy to stay in touch and see where things go.", "No agenda beyond that, just glad to be in touch.",
                "Wishing you and the team a good end to the year.", "Who knows where our paths cross next.",
                "Good luck with the rest of the year."]
POINTERS = [
    "{first}, I sent you a short note by email about {topic} and wanted to make sure it didn't get buried.\n\n"
    "If it's not your area, a pointer to the right person would be great.",
    "{first}, I wrote to you by email about {topic} and didn't want it to get buried in a busy inbox.\n\n"
    "If it's not your area, a pointer to the right person would be great.",
    "{first}, a short note here: I emailed you about {topic} and didn't want it buried.\n\n"
    "If it's not your area, a pointer to the right person would be great.",
]
GENERIC_TOPIC = "Google Ads and SEO for your clients"
CLOSE_OPENERS = ["Last note from me on this.", "I'll stop here after this one.", "Closing the loop on my notes."]
OPENER_LIKE = re.compile(r"(last note|closing the loop|i['’]ll stop here|final note|stop here)", re.I)

# ───────────────────────── 3. Never write ─────────────────────────

BANNED = [
    # DevScout writingRules.js BANNED (the em dash is fixed by apply_rules and caught by chaincheck)
    "i hope this finds you well", "i wanted to reach out", "i came across your profile", "i help companies like yours", "quick question",
    "just checking in", "just following up", "circling back", "touching base", "bumping this", "did you get a chance", "did you see my message",
    "nothing to answer here", "no need to reply", "no need to answer", "no reply is fine", "sorry to bother",
    "resonat", "genuinely", "quietly", "leverage", "seamless", "game-changer", "unlock", "in today's landscape", "covers a lot of ground",
    "is rarely simple", "looking forward to networking", "let's connect and grow", "no worries either way",
    "decision makers", "decision-makers",
    # P3b (Oleh, 27 Nov): empty invitations, IT Force's line, labels for the reader
    "thanks for connecting", "thank you for connecting", "good to meet you", "nice to meet you", "following up", "follow up on my",
    "from ukraine", "ukrainian team", "based in ukraine", "in ukraine",
    "agency owners", "agency leaders", "founders like you", "owners like you", "busy agency owner",
]
CALL_ASKS = ["short call", "quick call", "15 minutes", "15-minute", "hop on a call", "jump on a call", "book a time", "calendar link",
             "calendly", "schedule a call", "a quick chat", "a call", "a meeting", "zoom"]
# Delivery details: the approach email ONLY (DevScout's DELIVERY_TERMS, IT Force's delivery model).
DELIVERY_TERMS = ["never contact", "never speak to", "won't contact", "will not contact", "don't contact", "no contact with your client",
                  "time zone", "timezone", "overnight", "pilot audit", "scope it", "struggling to deliver", "send us one client",
                  "send us a client", "send one client"]
# Task 49 blockers (DevScout lintBlockers): meeting lengths, apologies, sales hints.
MEETING_MINUTES = re.compile(r"\b\d{1,3}\s*(?:-\s*)?(?:minutes?|mins?)\b", re.I)
APOLOGY_PHRASES = ["sorry about that", "we never made it", "we didn't make it", "never got back to you", "that's on us", "a miss on our side"]
SALES_HINT_PHRASES = ["extra hands", "in case a project comes up", "if you need", "we'd be glad to help", "we could help", "we could take",
                      "take that off your hands"]
# Generalisations about THEIR clients or money written as if known (planning chat, 27 Nov: "Cases like those usually come with ad budgets").
GENERALISATIONS = ["usually come with", "come with ad budgets", "ad budgets", "big budgets", "budgets to", "must have budget",
                   "clients like those usually", "cases like those"]
VANITY = re.compile(r"\b\d[\d,.]*\s*(?:k\s+)?(?:followers?|connections?|subscribers?)\b|\b(?:followers?|connections?)\b", re.I)
WHITE_LABEL = re.compile(r"white[- ]label", re.I)
BEHIND = re.compile(r"behind[- ]the[- ]scenes", re.I)
UNDER_NAME = re.compile(r"under (?:your|the agency's|their) (?:name|brand)", re.I)
# Agency proof stays VAGUE ("we already work behind a few agencies"): no numbers, countries, durations or names.
AGENCY_PROOF = re.compile(r"\b(?:we|we've|we're|we already|we have)\b[^.?!\n]{0,60}\b(?:work(?:ed|ing)?|partner(?:ed|ing)?|deliver(?:ed|ing)?)\b"
                          r"[^.?!\n]{0,40}\bagenc(?:y|ies)\b[^.?!\n]*", re.I)
PROOF_DETAIL = re.compile(r"\d|\byears?\b|\bmonths?\b|\bsince\b|\bincluding\b|\bsuch as\b|\blike [A-Z]|\b(?:US|USA|UK|Canada|Canadian|"
                          r"American|British|Germany|German|Australia|Australian|Europe|European|Poland|Ireland|Switzerland)\b")
# A list of capitalised names: "Smile Dental, Bright Teeth and Happy Molar" (three names = one too many).
_NAME = r"[A-Z][A-Za-z0-9&'-]+(?: (?:& )?[A-Z][A-Za-z0-9&'-]+)*"
NAME_LIST = re.compile(rf"{_NAME}(?:\s*,\s*{_NAME})+(?:\s*,?\s+(?:and|or)\s+{_NAME})")
OUR_NAMES = {"Google Ads", "SEO", "PPC", "Google", "IT Force", "Artem"}
LIST_SKIP = {"I", "We", "You", "Your", "They", "Their", "It", "Hi", "So", "Just", "Out", "By", "The", "A", "An"}
OUR_WORDS = {"google", "ads", "seo", "ppc", "it", "force", "itforce", "behind-the-scenes", "white-label", "agencies", "agency", "team",
             "name", "artem", "under", "work", "clients", "client", "we're", "we've", "we'd"}
PROPER = ["Google Ads", "Google Partner", "Google Business Profile", "Google", "IT Force", "LinkedIn", "HubSpot", "Shopify", "Meta",
          "TikTok", "Amazon", "Microsoft", "Salesforce", "Klaviyo", "Semrush", "BigCommerce", "WooCommerce", "Clutch", "Instagram",
          "Facebook", "YouTube", "Canada", "Quebec", "Montreal", "Toronto", "Europe", "European", "PPC", "SEO", "B2B", "B2C", "SaaS",
          "Artem", "GA4", "AI", "US", "USA", "UK", "New York", "Los Angeles", "Texas", "California"]


# ───────────────────────── 4. Helpers ─────────────────────────

def fill(s: str, **v) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(v.get(m.group(1), m.group(0))), s)


def pick(pool: list, i: int, offset: int = 0):
    return pool[((i + offset) % len(pool) + len(pool)) % len(pool)]


def possessive(name: str) -> str:
    return name + ("'" if re.search(r"s$", name, re.I) else "'s")


CONTRACTIONS = [
    (r"\bdoes not\b", "doesn't"), (r"\bdo not\b", "don't"), (r"\bDo not\b", "Don't"), (r"\bis not\b", "isn't"), (r"\bare not\b", "aren't"),
    (r"\bit is\b", "it's"), (r"\bIt is\b", "It's"), (r"\bthat is\b", "that's"), (r"\bThat is\b", "That's"), (r"\bI am\b", "I'm"),
    (r"\bwe are\b", "we're"), (r"\bWe are\b", "We're"), (r"\byou are\b", "you're"), (r"\bYou are\b", "You're"), (r"\bwe would\b", "we'd"),
    (r"\bWe would\b", "We'd"), (r"\bI will\b", "I'll"), (r"\bwe will\b", "we'll"), (r"\bWe will\b", "We'll"), (r"\bhere is\b", "here's"),
    (r"\bHere is\b", "Here's"), (r"\bcannot\b", "can't"), (r"\bwill not\b", "won't"), (r"\bdid not\b", "didn't"), (r"\bI would\b", "I'd"),
    (r"\bI have (?=(?:been|seen|worked|built|learned|done|found|helped|noticed|read|looked|spent|had|got|made|run|delivered|heard|started|written|taken|gone|used|tried)\b)", "I've "),
    (r"\bwe have (?=(?:been|seen|worked|built|learned|done|found|helped|noticed|read|looked|spent|had|got|made|run|delivered|heard|started|written|taken|gone|used|tried)\b)", "we've "),
    (r"\bWe have (?=(?:been|seen|worked|built|learned|done|found|helped|noticed|read|looked|spent|had|got|made|run|delivered|heard|started|written|taken|gone|used|tried)\b)", "We've "),
]
_L, _R = "", ""


def protect(text: str, extra: list[str] | None = None) -> tuple[str, list[str]]:
    """Mask URLs, email addresses, quoted text, the company name and case titles while prose is rewritten."""
    saved: list[str] = []

    def keep(m):
        saved.append(m.group(0))
        return f"{_L}{len(saved) - 1}{_R}"
    t = re.sub(r"https?://\S+|www\.\S+", keep, str(text or ""), flags=re.I)
    t = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", keep, t)
    t = re.sub(r"\"[^\"\n]{1,160}\"|“[^”\n]{1,160}”", keep, t)
    for e in sorted({str(x).strip() for x in (extra or []) if x and len(str(x).strip()) >= 3}, key=len, reverse=True):
        t = re.sub(re.escape(e), keep, t)
    return t, saved


def unprotect(t: str, saved: list[str]) -> str:
    return re.sub(f"{_L}(\\d+){_R}", lambda m: saved[int(m.group(1))], t)


# A contraction is never the last word of a clause ("healthier than it is." stays) and never the stressed verb of a comparison
# ("as busy on Google as it is on social"): the P3b run wrote "than it's." and "as it's on social". "it is fine" -> "it's fine".
# Negations ("does not", "cannot") always have a verb after them and are left as they were.
_ENDS_WITH_VERB = re.compile(r"(?:is|are|am|will|would)\\b$")


def humanize(text: str, extra: list[str] | None = None) -> str:
    t, saved = protect(text, extra)
    for a, b in CONTRACTIONS:
        if _ENDS_WITH_VERB.search(a) and " not" not in a:
            a = r"(?<!than )(?<!as )" + a + r"(?=\s+[A-Za-z])"
        t = re.sub(a, b, t)
    return unprotect(t, saved)


def fix_marks(text: str, extra: list[str] | None = None) -> str:
    """No em / en dash, no "!" (the voice rule; code makes it true). Quotes, URLs and names are left alone."""
    t, saved = protect(text, extra)
    t = re.sub(r"\s*[—–―]\s*", ", ", t)
    t = re.sub(r"\s--\s", ", ", t)
    t = re.sub(r",\s*,", ",", t)
    t = re.sub(r"!+", ".", t)
    t = re.sub(r"\.\.(?!\.)", ".", t)
    t = re.sub(r"\b(?:quietly|genuinely) (?=[a-z])", "", t)        # DevScout's AI-sounding adverbs: dropped, the verb stays
    return unprotect(t, saved)


def leadin_key(q: str) -> str:
    m = HAS_LEADIN.match(str(q))
    return m.group(1).replace("So I'm curious", "I'm curious") if m else ""


def soften_question(q: str, used: set, n: int = 0) -> str:
    """A question opens with a soft lead-in, never one already used in this wave (DevScout softenQuestion)."""
    k = leadin_key(q)
    if k:
        used.add(k)
        return q
    for j in range(len(SOFT_LEADINS)):
        lead = pick(SOFT_LEADINS, n, j)
        key = lead.rstrip(", ").rstrip(",")
        if key in used:
            continue
        used.add(key)
        first = q.split(" ")[0]
        keep_case = first == "I" or bool(re.match(r"^[A-Z]{2}", first)) or first.startswith("I'")
        return lead + (q if keep_case else q[0].lower() + q[1:])
    return q


def _strip_leadin(q: str) -> str | None:
    for lead in [x.strip() for x in SOFT_LEADINS] + BRIDGES:
        if q.startswith(lead):
            rest = q[len(lead):].strip()
            return rest[0].upper() + rest[1:] if rest else None
    return None


def _sentences(p: str) -> list[str]:
    return [x for x in re.split(r"(?<=[.?!])\s+", p.strip()) if x]


def soften_final(paras: list[str], used: set, n: int, bridge: bool = False) -> list[str]:
    """The final question of a message gets a soft lead-in; a final paragraph with more than the question is split so the
    question stands alone. The FIRST email uses the bridge "So I wanted to ask:" so the soft lead-ins are left for later."""
    if not paras:
        return paras
    end = len(paras) - 1
    para = paras[end].strip()
    if not para.endswith("?"):
        return paras
    ss = _sentences(para)
    q, before = ss[-1], ss[:-1]
    k = leadin_key(q)
    if k and k in used:
        bare = _strip_leadin(q)
        if bare:
            q = bare
    k2 = leadin_key(q)
    if k2:
        used.add(k2)
    elif bridge:
        first = q.split(" ")[0]
        keep = first == "I" or bool(re.match(r"^[A-Z]{2}", first)) or first.startswith("I'")
        q = f"{FIRST_EMAIL_BRIDGE} {q if keep else q[0].lower() + q[1:]}"
        used.add(leadin_key(q))
    else:
        q = soften_question(q, used, n)
    out = list(paras)
    if before:
        out[end:end + 1] = [" ".join(before), q]
    else:
        out[end] = q
    return out


# ───────────────────────── 5. Built by code: the intro, the pointer, the subject ─────────────────────────

ROLE = [
    ("co-founder", "a co-founder of"), ("cofounder", "a co-founder of"), ("founding partner", "a founding partner at"),
    ("founder", "the founder of"), ("owner", "the owner of"), ("chief executive", "running"), ("ceo", "running"),
    ("managing director", "running"), ("managing partner", "a managing partner at"), ("president", "the president of"),
    ("principal", "the principal at"), ("chief operating", "running operations at"), ("coo", "running operations at"),
    ("chief marketing", "leading marketing at"), ("cmo", "leading marketing at"), ("chief growth", "leading growth at"),
    ("head of seo", "leading SEO at"), ("seo director", "leading SEO at"), ("director of seo", "leading SEO at"),
    ("head of paid", "leading paid media at"), ("paid media director", "leading paid media at"), ("head of growth", "leading growth at"),
    ("director of marketing", "leading marketing at"), ("marketing director", "leading marketing at"), ("head of marketing", "leading marketing at"),
    ("director of client", "leading client services at"), ("client services director", "leading client services at"),
    ("head of digital", "leading digital at"), ("digital director", "leading digital at"), ("director of operations", "running operations at"),
    ("general manager", "running"), ("partner", "a partner at"), ("vice president", "leading"), ("vp", "leading"),
]


def role_phrase(title: str | None) -> str:
    """'Founder at TISKON' -> 'the founder of'. Word-boundary match ("coo" must not match inside "cool"). '' = unknown."""
    t = str(title or "").lower()
    for k, p in ROLE:
        if re.search(rf"(?<![a-z]){re.escape(k)}(?![a-z])", t):
            return p
    return ""


BUSINESS_WORDS = {"SEO": "SEO", "paid social": "paid social", "social media": "social media", "web design / development": "web development",
                  "branding": "branding", "content": "content", "email marketing": "email marketing"}


def business_phrase(families: list[str]) -> str:
    """What the agency sells, short: 'SEO and web development' (paid search left out: that is what we add)."""
    names = [BUSINESS_WORDS[f] for f in families if f in BUSINESS_WORDS]
    if "social media" in names and "paid social" in names:      # "paid social and social media work" says social twice
        names.remove("paid social")
    if not names:
        return "marketing"
    return " and ".join(names[:2])


def _wc(t: str) -> int:
    return len(re.findall(r"\S+", t or ""))


def build_intro(*, first: str, title: str | None, company: str, families: list[str], seed: int = 0, segment: str = "agency") -> dict:
    """The LinkedIn intro (Artem's invitations were EMPTY): greeting + a rotated "glad to be in your network" line; their role;
    one line on what we do tied to their business; a rotated neutral close. No question, no pitch, under 50 words and 300
    characters. Built by code; the model never writes it. -> {text, missing}"""
    missing = [k for k, v in (("first name", first), ("company", company)) if not v]
    if missing:
        return {"text": "", "missing": missing}
    role = role_phrase(title)
    business = business_phrase(families)
    who = ""
    if role == "running":
        who = f"I see you're running {company}. "
    elif role:
        who = f"I see you're {role} {company}. "
    lines = INTRO_ITFORCE if segment == "agency" else INTRO_ITFORCE_NICHE
    # the role sentence is kept whenever any line + close fits (DevScout's limit: 50 words at most); rotation by seed
    for with_role in ((True, False) if who else (False,)):
        for k in range(len(lines)):
            for c in range(len(INTRO_CLOSES)):
                it = fill(pick(lines, seed, 1 + k), poss=possessive(company), business=business, company=company)
                text = "\n\n".join([fill(pick(INTRO_OPENERS, seed), first=first), (who if with_role else "") + it, pick(INTRO_CLOSES, seed, c)])
                if _wc(text) <= WORDS_MAX["intro"] and len(text) <= 300:
                    return {"text": text, "missing": [] if role else ["role"]}
    text = "\n\n".join([fill(pick(INTRO_OPENERS, seed), first=first), fill(lines[0], poss=possessive(company), business=business, company=company)])
    return {"text": text, "missing": [] if role else ["role"]}


def pointer_topic(subject: str | None, company: str = "") -> str:
    t = re.sub(r"^\s*(re|aw|sv|fwd?)\s*:\s*", "", str(subject or ""), flags=re.I).strip().rstrip(".?")
    if company and t.lower() == company.lower():
        t = ""
    if _wc(t) < 2:
        return ""
    first = t.split(" ")[0]
    if re.match(r"^[A-Z][a-z]*$", first) and first not in ("I",) and not any(t.startswith(p) for p in PROPER) and not (company and t.startswith(company)):
        t = t[0].lower() + t[1:]
    # "about search terms tip for food brands" needs its article: a subject built around one tip / check / idea gets "a"
    if not re.match(r"^(?:a|an|the|your|our|my|one|some|how|why|what|which|\d)\b", t, re.I) and re.search(r"\b(?:tip|check|idea|note|setting|fix|test)\b", t, re.I):
        t = ("an " if re.match(r"^[aeiou]", t, re.I) else "a ") + t
    return t


def build_pointer(*, first: str, subject: str | None, company: str = "", seed: int = 0) -> dict:
    topic = pointer_topic(subject, company)
    return {"text": fill(pick(POINTERS, seed, 2), first=first or "Hi", topic=topic or GENERIC_TOPIC), "generic": not topic}


def proper_words(*texts: str) -> set[str]:
    """Proper nouns: words written capitalised NOT at the start of a sentence in the given texts (the facts, the company)."""
    out: set[str] = set()
    for t in texts:
        for sent in _sentences(str(t or "")):
            ws = re.findall(r"[A-Za-z][A-Za-z0-9&'.-]*", sent)
            for w in ws[1:]:
                if w[0].isupper() and w.strip(".'") not in COMMON_CAPS:
                    out.add(w.strip(".'"))
    return out


# capitalised in a site's own wording ("Search, PMax and YouTube"), but common words in a subject
COMMON_CAPS = {"Search", "Services", "Service", "Marketing", "Advertising", "Digital", "Agency", "Web", "Design", "Development", "Content",
               "Social", "Media", "Email", "Strategy", "Growth", "Brand", "Branding", "Creative", "Paid", "Performance", "Partner",
               "Partners", "Business", "Solutions", "Studio", "Group", "Display", "Video", "Shopping", "Local"}


def subject_case(subject: str | None, proper: set[str] | None = None) -> str:
    """Sentence case, proper nouns capitalised: 'White-Label Google ads For tiskon Clients' -> 'White-label Google Ads for TISKON clients'
    (with TISKON among the proper words). Acronyms (SEO, PPC, B2B) are kept as written."""
    s = re.sub(r"\s+", " ", str(subject or "")).strip().rstrip(".")
    if not s:
        return s
    props = {p.lower(): p for p in PROPER}
    props.update({p.lower(): p for p in (proper or set()) if p})
    words = s.split(" ")
    lw = [re.sub(r"['’]s$", "", re.sub(r"[^a-z0-9&'’-]", "", w.lower())) for w in words]
    keep: list[str | None] = [None] * len(words)
    for p in sorted([p for p in props.values() if " " in p], key=lambda x: -len(x.split(" "))):
        pw = p.lower().split(" ")
        n = len(pw)
        for i in range(len(words) - n + 1):
            if lw[i:i + n] == pw and all(k is None for k in keep[i:i + n]):
                for j, x in enumerate(p.split(" ")):
                    keep[i + j] = x
    out = []
    for i, w in enumerate(words):
        core = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", w)
        if re.search(r"['’]s$", core):
            core = core[:-2]
        low = core.lower()
        if keep[i]:
            out.append(w.replace(core, keep[i]) if core else w)
        elif low in props and " " not in props[low]:
            out.append(w.replace(core, props[low]) if core else w)
        elif len(core) > 1 and core.isupper() and any(c.isalpha() for c in core):
            out.append(w)
        elif i == 0:
            out.append(w[:1].upper() + w[1:].lower())
        else:
            out.append(w.lower())
    return " ".join(out)


# ───────────────────────── 6. Enforced after the model (applyWritingRules) ─────────────────────────

GREETING_RX = re.compile(r"^\s*(?:hi|hello|hey|dear)\b[^\n,]*,?\s*\n+", re.I)
SIGNOFF_WORDS = r"(?:best|best regards|regards|kind regards|thanks|cheers|all the best|warm regards|talk soon)"


def split_email(body: str, sender: str = "Artem") -> list[str]:
    """The content paragraphs of an email (greeting and sign-off removed)."""
    t = str(body or "").replace("\r\n", "\n").strip()
    t = GREETING_RX.sub("", t, count=1)
    t = re.sub(r"\n\s*(?:" + SIGNOFF_WORDS + r"[,.]?\s*\n+\s*)?" + re.escape(sender) + r"\s*$", "", t, flags=re.I)
    t = re.sub(r"\n\s*" + SIGNOFF_WORDS + r"[,.]?\s*$", "", t, flags=re.I)
    return [p.strip() for p in re.split(r"\n\s*\n", t) if p.strip()]


def join_email(first: str, paras: list[str], sender: str = "Artem") -> str:
    return "\n\n".join([f"Hi {first}," if first else "Hi,"] + paras + [sender])


# A lead-in that can open a clause ("Noticed that your clients ..."); the others need an object and are left to the model.
CLAUSE_FORM = {"Noticed": "Noticed that", "Saw that": "Saw that", "Read that": "Read that", "I see that": "I see that"}


def ensure_leadin(paras: list[str], leadin: str | None, company: str, avoid: set | None = None) -> tuple[list[str], str | None]:
    """The observation of the hook email opens with a lead-in. When the model left it out and the sentence starts on THEM
    ("Your ...", "TISKON ...", "They ..."), code puts one in front ("Noticed that your ..."): the planned one when it can open a
    clause, else the first clause lead-in not used elsewhere in the wave. -> (paragraphs, the lead-in it opens with or None)"""
    if not paras:
        return paras, None
    p = paras[0]
    have = next((x for x in ALL_LEADINS if p.startswith(x)), None)
    if have:
        return paras, have
    head = p.split(" ")[0]
    if not (head in ("Your", "You", "You're", "They", "Their", "They're") or (company and p.startswith(company))):
        return paras, None
    options = ([CLAUSE_FORM[leadin]] if leadin in CLAUSE_FORM else []) + list(CLAUSE_FORM.values())
    lead = next((o for o in options if o.split(" ")[0] not in (avoid or set()) and o not in (avoid or set())), options[0])
    rest = p if (company and p.startswith(company)) else p[0].lower() + p[1:]
    out = list(paras)
    out[0] = f"{lead} {rest}"
    return out, lead


def apply_rules(touches: list[dict], *, first: str, company: str, seed: int = 0, sender: str = "Artem",
                protect_extra: list[str] | None = None, proper: set[str] | None = None, used_before: set | None = None) -> list[dict]:
    """touches: [{step, job, channel, subject, body, leadin}] in send order -> the same list with the deterministic rules made true.
    Intro and pointer are left as built. `used_before`: question lead-ins of earlier waves (never reused for the same lead)."""
    used = set(used_before or set())
    leadins_used: set = set()
    extra = [company, *(protect_extra or [])]
    out = []
    first_email = next((i for i, t in enumerate(touches) if t["channel"] == "email"), -1)
    for i, t in enumerate(touches):
        t = dict(t)
        if t["job"] in ("intro", "pointer"):
            out.append(t)
            continue
        paras = split_email(t.get("body") or "", sender)
        paras = [fix_marks(humanize(p, extra), extra) for p in paras]
        if t["job"] in ("hook", "approach"):
            paras, got = ensure_leadin(paras, t.get("leadin"), company, leadins_used)
            if got:
                leadins_used.add(got)
        if t["job"] == "close" and paras and OPENER_LIKE.search(paras[0]) and _wc(paras[0]) <= 12 and "?" not in paras[0]:
            paras[0] = pick(CLOSE_OPENERS, seed)
        paras = soften_final(paras, used, seed + i, bridge=(i == first_email))
        t["body"] = join_email(first, paras, sender)
        if t.get("subject") and not t.get("reply"):
            t["subject"] = subject_case(fix_marks(t["subject"], extra), proper)
        else:
            t["subject"] = None if t.get("reply") else t.get("subject")
        out.append(t)
    return out


# ───────────────────────── 7. Checks (lintChain + lintBlockers + P3b) ─────────────────────────

STOP = set(("a an the and or but of to in on at for with by from as is are was were be been it its it's this that these those i we you your our "
            "my me us they them their there here what which who how when where why do does did don't doesn't not no so if then than too very just "
            "also only one more most much many some any every each all can could would should will i'm i've i'd we're we've we'd you're that's "
            "there's hi thanks thank glad good last note quick thought something mention time today usually").split())
CAP_SKIP = {"Noticed", "Since", "Was", "Saw", "Came", "Thinking", "Coming", "Read", "Reading", "Looking", "Out", "Just", "By", "So", "Hi", "I",
            "It", "They", "This", "There", "That", "We", "We're", "We've", "We'd", "You", "Your", "If", "Which", "What", "How", "Who", "When",
            "Happy", "Good", "Wishing", "Last", "Closing", "One", "Here's", "Artem", "Google", "Ads", "SEO", "PPC", "IT", "Force", "LinkedIn",
            "Glad", "Nice", "No", "Would", "Is", "Do", "Does", "Are", "A", "An", "The", "In", "For", "With", "And", "But", "Or", "On", "At",
            "Here", "Here's", "Since", "Either", "Also", "Then", "Even", "Thanks", "Wishing", "Coming", "Send", "Our", "Their", "These", "Those"}


def _words(t: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9][a-z0-9\-']*", str(t).lower()) if w not in STOP and w not in OUR_WORDS and len(w) > 2]


def _pairs(t: str, names: set[str]) -> set[str]:
    w = [x for x in _words(t) if x not in names]
    return {w[k] + " " + w[k + 1] for k in range(len(w) - 1)}


def _questions(t: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.?!])\s+", str(t).replace("\n", " ")) if s.strip().endswith("?")]


def _final_question(body: str, sender: str = "Artem") -> str:
    ps = split_email(body, sender) if "\n" in str(body) else [str(body)]
    if not ps:
        return ""
    q = _sentences(ps[-1])
    return q[-1] if q and q[-1].endswith("?") else ""


def lint_message(t: dict, *, tagline_texts: list[str] | None = None, sender: str = "Artem") -> list[dict]:
    """Flags for one message of a wave: {job, channel, subject, body (model text, no case line)}."""
    flags = []
    body = str(t.get("body") or "")
    full = (str(t.get("subject") or "") + "\n" + body).replace("’", "'")
    low = full.lower()
    job = t.get("job")

    def f(rule, text):
        flags.append({"rule": rule, "text": text})
    for b in BANNED:
        if b in low:
            f("banned", f'banned phrase "{b}"')
    for c in CALL_ASKS:
        if re.search(rf"(?<![a-z]){re.escape(c)}(?![a-z])", low):
            f("call_ask", f'asks for a call or meeting ("{c}")')
    m = MEETING_MINUTES.search(full)
    if m:
        f("blocker", f'meeting length "{m.group(0)}"')
    for a in APOLOGY_PHRASES:
        if a in low:
            f("blocker", f'apology for an old miss "{a}"')
    for h in SALES_HINT_PHRASES:
        if h in low:
            f("blocker", f'sales hint "{h}"')
    for g in GENERALISATIONS:
        if g in low:
            f("generalisation", f'a generalisation about their clients written as known ("{g}")')
    if job != "approach":
        for d in DELIVERY_TERMS:
            if d in low:
                f("delivery", f'delivery detail "{d}" outside the approach email')
    if VANITY.search(full):
        f("vanity", "a vanity number or followers / connections about the person")
    if WHITE_LABEL.search(full) and BEHIND.search(full):
        f("role_wording", '"white-label" and "behind-the-scenes" in one message: use one of them')
    for sent in _sentences(body.replace("\n", " ")):
        m = AGENCY_PROOF.search(sent)
        if m and PROOF_DETAIL.search(m.group(0)):
            f("agency_proof", "agency proof must stay vague (\"we already work behind a few agencies\"): no numbers, countries, durations or names")
            break
    for m in NAME_LIST.finditer(body.replace("\n", " ")):
        names = [x.strip() for x in re.split(r",\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+", m.group(0)) if x.strip()]
        names = [x for x in names if x.split(" ")[0] not in LIST_SKIP and x not in OUR_NAMES]
        if len(names) >= 3:
            f("names_list", f"lists more than two names ({', '.join(names[:4])}): name two at most")
            break
    for tl in tagline_texts or []:
        tw = re.findall(r"[a-z0-9']+", str(tl).lower())
        bw = re.findall(r"[a-z0-9']+", low)
        grams = {" ".join(tw[k:k + 5]) for k in range(len(tw) - 4)}
        if grams and any(" ".join(bw[k:k + 5]) in grams for k in range(len(bw) - 4)):
            f("tagline", "recites their tagline or positioning line back to them")
            break
    words = _wc(body)
    if job == "intro":
        if "?" in body:
            f("intro_question", "the LinkedIn intro must not ask a question")
        if words > WORDS_MAX["intro"]:
            f("length", f"the LinkedIn intro has {words} words (50 at most)")
    if job == "close":
        content = " ".join(split_email(body, sender))
        if _wc(content) > WORDS_MAX["close"]:
            f("length", f"the close has {_wc(content)} words (60 at most)")
    if t.get("channel") == "email" and job in ("hook", "approach", "value4", "close"):
        q = _final_question(body, sender)
        if job in ("approach", "value4", "hook") and q and not HAS_LEADIN.match(q) and not re.match(r"^(Would|Does that sound|Which)", q):
            f("question", "the final question has no soft lead-in")
    if t.get("channel") == "email":
        if not re.match(r"^\s*Hi\b", body):
            f("greeting", 'an email opens with "Hi <first name>,"')
        if not re.search(re.escape(sender) + r"\s*$", body.strip()):
            f("signoff", f'an email is signed "{sender}"')
        subj = str(t.get("subject") or "")
        if subj and not t.get("reply"):
            if subj[:1].islower():
                f("subject_case", "the subject is not in sentence case")
            else:
                prop = {x.lower() for p in PROPER for x in p.split(" ")} | {x.lower() for x in str(t.get("company") or "").split(" ") if x}
                rest = [x for x in subj.split()[1:] if x.strip(".,:;").lower() not in prop and not x.isupper()]
                caps = [x for x in rest if x[:1].isupper()]
                if len(caps) >= 2 and len(caps) > len(rest) / 2:
                    f("subject_case", "the subject is in Title Case; use sentence case (proper nouns capitalised)")
    if job in ("hook", "approach") and t.get("leadin"):
        ps = split_email(body, sender)
        if ps and not any(ps[0].startswith(x) for x in ALL_LEADINS):
            f("leadin", f'the observation does not open with a lead-in (planned: "{t["leadin"]}")')
    if job in ("approach", "value", "value4", "close") and t.get("company"):
        ps = split_email(body, sender)
        head = " ".join(ps[:2]).lower()
        if ps and t["company"].lower() not in head and not re.search(r"\byour\b|\byou\b", head):
            f("this_company", "a follow-up opens on THIS company (their name or \"your ...\" in the first lines)")
    return flags


# Capitalised words that are the trade's vocabulary or the angle's niche, never a recited fact of theirs (scratch run, 27 Nov:
# "B2B" and "CRM" in a B2B tip were flagged as the hook's fact coming back)
GENERIC_CAPS = {"CRM", "B2B", "B2C", "SaaS", "ROAS", "CPA", "CPC", "CTR", "PMax", "Performance", "Max", "Shopping", "Search", "YouTube",
                "AI", "GEO", "DTC", "D2C", "E-commerce", "Ecommerce", "HVAC", "SMB", "SMBs", "Display", "Merchant", "Center", "Local"}


def lint_wave(touches: list[dict], *, names: list[str], tagline_texts: list[str] | None = None, sender: str = "Artem",
              keep_words: list[str] | None = None) -> dict:
    """The whole wave read the way the recipient would (DevScout lintChain + P3b). touches: [{step, job, channel, subject, body,
    day, leadin, company}]. -> {"by_step": {step: [flags]}, "chain": [flags]}"""
    by_step: dict[int, list[dict]] = {}
    chain: list[dict] = []
    nm = {x for n in names if n for x in [str(n).lower(), *re.split(r"[\s-]+", str(n).lower())] if x}
    for t in touches:
        by_step[t["step"]] = lint_message(t, tagline_texts=tagline_texts, sender=sender)
    text = {t["step"]: "\n".join(split_email(t["body"], sender)) if t["channel"] == "email" else t["body"] for t in touches}
    steps = [t["step"] for t in touches]
    built = {t["step"] for t in touches if t["job"] == "pointer"}
    for x in range(len(steps)):
        for y in range(x + 1, len(steps)):
            a, b = steps[x], steps[y]
            if a in built or b in built:
                continue
            shared = [p for p in _pairs(text[a], nm) if p in _pairs(text[b], nm)]
            if len(shared) >= 3:
                chain.append({"rule": "repeat", "text": f"steps {a} and {b} repeat wording ({'; '.join(sorted(shared)[:3])})"})
            for qa in _questions(text[a]):
                for qb in _questions(text[b]):
                    wa, wb = set(_words(qa)) - nm, set(_words(qb)) - nm
                    uni = wa | wb
                    if uni and len(wa & wb) / len(uni) >= 0.4:
                        chain.append({"rule": "similar_questions", "text": f"steps {a} and {b} ask similar questions"})
    # the facts of the hook and the approach must not come back later (only the close may carry its own anchor F3)
    jobs = {t["step"]: t["job"] for t in touches}
    fact_steps = [s for s in steps if jobs[s] in ("hook", "approach")]
    keep = {x.lower() for k in (keep_words or []) for x in re.split(r"[\s/&,-]+", str(k)) if x}
    later = [s for s in steps if jobs[s] in ("value", "value4", "close")]
    for fs in fact_steps:
        paras = split_email(next(t["body"] for t in touches if t["step"] == fs), sender)
        obs = paras[0] if paras else ""
        caps = {w.strip(".'") for w in re.findall(r"\b(?:[A-Z][A-Za-z0-9&-]{2,}|\d[\d,.]*%?)", obs)
                if w not in CAP_SKIP and w.lower() not in nm and w.strip(".'") not in CAP_SKIP and not any(w.startswith(p) for p in ("Google",))
                and w.strip(".'") not in GENERIC_CAPS and w.strip(".'").lower() not in keep}
        for s in later:
            hit = sorted(w for w in caps if re.search(rf"(?<![A-Za-z0-9]){re.escape(w)}(?![A-Za-z0-9])", text[s]))
            if hit:
                chain.append({"rule": "fact_reused", "text": f"step {s} reuses the fact of step {fs} ({', '.join(hit[:4])})"})
    # lead-ins: observation and question lead-ins, never the same one twice in a wave
    seen: dict[str, int] = {}
    for t in touches:
        if t["channel"] != "email":
            continue
        ps = split_email(t["body"], sender)
        lead = next((x for x in ALL_LEADINS if ps and ps[0].startswith(x)), None)
        q = _final_question(t["body"], sender)
        for k in [lead, leadin_key(q) if q else None]:
            if not k:
                continue
            key = k.rstrip(",")
            if key in seen:
                chain.append({"rule": "leadin_twice", "text": f'the lead-in "{key}" is used twice in the wave (steps {seen[key]} and {t["step"]})'})
            else:
                seen[key] = t["step"]
    for t in touches:
        if t["job"] == "pointer":
            src = next((x for x in touches if x["step"] == t.get("after_step")), None)
            if src is not None and t.get("day") is not None and src.get("day") is not None and t["day"] <= src["day"]:
                chain.append({"rule": "pointer_day", "text": f"the pointer (step {t['step']}) goes out the same day as its email (step {src['step']})"})
    seen_rules = set()
    uniq = []
    for c in chain:
        if c["text"] not in seen_rules:
            seen_rules.add(c["text"])
            uniq.append(c)
    return {"by_step": by_step, "chain": uniq}


# ───────────────────────── 8. The prompt's style block ─────────────────────────

def style_rules_text(sender: str = "Artem") -> str:
    return f"""HUMAN WRITING STYLE (DevScout's rules, Oleh 27 Nov 2026; code checks every one of them afterwards):
- {ONE_ANGLE_RULE}
- A fact is the REASON for the message, not a recital of their website. Say it in your own words, in one sentence. Never read their
  tagline or positioning line back to them, never list more than two names (clients, cases, badges), never a follower count or
  any number about the person.
- Open each fact with the lead-in given for it. Every follow-up opens on THIS company (their name or "your ...").
- Each email: what we noticed -> what it usually means for an agency like theirs (one "I" sentence, about agencies in general,
  never a claim about their clients' money or budgets) -> what we do tied to it -> ONE soft question about THEM.
- Every question opens with a soft lead-in ({' / '.join(x.strip() for x in SOFT_LEADINS)}); code adds one if you leave it out.
- Contractions always (we're, it's, don't, we've). "I" for the observation and the question, "we" for IT Force.
- Never label the reader ("agency owners", "decision makers"); write to one person. Never ask for a call or a meeting.
- Our role: "the behind-the-scenes Google Ads and SEO team for agencies, under your name"; "white-label" may be used instead (the
  approach is a good place), never both words in one message.
- Agency proof only VAGUE: "we already work behind a few agencies". No numbers, countries, durations or partner names.
- Emails: "Hi <first name>," on the first line, short paragraphs, signed "{sender}" on the last line. Subjects short, sentence case,
  proper nouns capitalised (for example "Google Ads for TISKON clients"). Plain text.
- Never: a price, a fee or a rate; a URL or a domain (a case link is added by code); an em dash or "!"; "from Ukraine";
  {', '.join(sorted({b for b in BANNED if "ukrain" not in b and b not in ("decision makers", "decision-makers")}))}; also: likely,
  probably, I'd guess, extra hands, if you need, we could help, "cases like those usually come with ad budgets"."""
