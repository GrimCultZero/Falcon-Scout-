"""The domain finder (METRO_TASK.md F2, item 1): a company's website, cheapest step first.

  a. CSV / email-finder export / what is already stored          (enrich.resolve_domain; free)
  b. name patterns: at most 6 guesses built from the company name   source `name-pattern`; free, paced fetches
  c. an AI lookup WITH web search (Sonnet, through /claude on the CLI bridge)   source `ai-lookup`
  d. LinkedIn, Metro weeks only: the lead's profile names the current company's page, the page names the website

Every guess (b, c) is accepted ONLY when the fetched site carries the company name (`verify_domain_matches_name`)
and is not a parked / for-sale page. Every step leaves a line in the company's trail (`domain_tried_json`), so
"why is there no domain?" always has an answer on screen.

This module is pure apart from the injected `fetch` and `ask`: tests pass stand-ins, nothing here reaches a network.
"""
from __future__ import annotations

import re
import time
import unicodedata
from typing import Callable

from . import aiclient, webscan

LEGAL_WORDS = {"inc", "incorporated", "llc", "pllc", "ltd", "limited", "gmbh", "corp", "corporation", "co", "company", "lp", "llp",
               "plc", "pty", "sa", "srl", "bv", "ag", "oy", "ab"}
GENERIC_NAME_WORDS = {"inc", "llc", "ltd", "limited", "gmbh", "corp", "corporation", "co", "company", "group", "agency", "the",
                      "and", "of", "digital", "marketing", "media", "solutions", "services", "consulting", "studio", "studios",
                      "partners", "global", "international", "creative", "design", "web", "online", "clinic", "center", "centre",
                      "health", "medical", "dental", "group", "associates", "advertising", "seo", "ppc"}
MAX_PATTERNS = 6
_CA = re.compile(r"\b(canada|ontario|quebec|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|"
                 r"newfoundland|prince edward|toronto|vancouver|montreal|montr[eé]al|calgary|ottawa|edmonton|winnipeg|mississauga|"
                 r"halifax|victoria bc|hamilton, on|kitchener|london, on|brampton|surrey, bc|laval)\b", re.I)
_CA_CODES = re.compile(r"\b(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE)\b")


# ───────────────────────── names ─────────────────────────

def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii").lower()


def name_words(name: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", _fold(name)) if w]


def name_tokens(name: str) -> list[str]:
    """The distinctive words of a company name (3+ letters, not a legal or generic word)."""
    return [t for t in name_words(name) if len(t) >= 3 and t not in GENERIC_NAME_WORDS]


def is_canadian(country: str | None, location: str | None) -> bool:
    c = (country or "").strip().lower()
    if c in ("canada", "ca", "can"):
        return True
    loc = location or ""
    if _CA.search(loc):
        return True
    return bool(re.search(r",\s*(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE)\s*$", loc.strip()))     # "Barrie, ON"


def name_candidates(name: str, *, country: str | None = None, location: str | None = None, limit: int = MAX_PATTERNS) -> list[str]:
    """At most `limit` domains a company with this name might own: the whole name joined, the distinctive part alone,
    hyphenated forms, with the legal and generic words dropped in some variants. `.ca` as well for Canadian places.
    "FIREBELLY Marketing" -> firebellymarketing.com, firebelly.com, firebelly-marketing.com."""
    words = name_words(name)
    legal_free = [w for w in words if w not in LEGAL_WORDS]
    distinct = [w for w in legal_free if w not in GENERIC_NAME_WORDS and len(w) >= 2]
    bases: list[str] = []

    def add(b: str):
        b = b.strip("-")
        if len(b.replace("-", "")) >= 3 and b not in bases and b not in GENERIC_NAME_WORDS:
            bases.append(b)

    add("".join(legal_free))                                   # firebellymarketing
    if distinct:
        add("".join(distinct))                                 # firebelly
    if len(legal_free) > 1:
        add("-".join(legal_free))                              # firebelly-marketing
    if distinct and legal_free:
        # the distinctive words plus the first generic word after them ("rank" + "media" -> rankmedia)
        first = legal_free.index(distinct[0])
        after = [w for w in legal_free[first + 1:] if w in GENERIC_NAME_WORDS][:1]
        if after:
            add("".join(distinct[:2]) + after[0] if len(distinct) > 1 else distinct[0] + after[0])
    if len(distinct) > 2:
        add("".join(distinct[:2]))
    if len(distinct) > 1:
        add("-".join(distinct))
    ca = is_canadian(country, location)
    out: list[str] = []
    if ca:                                                      # .com and .ca side by side for the best two bases
        for b in bases[:2]:
            out += [f"{b}.com", f"{b}.ca"]
        for b in bases[2:]:
            out += [f"{b}.com", f"{b}.ca"]
    else:
        out = [f"{b}.com" for b in bases]
    seen, final = set(), []
    for d in out:
        if d not in seen:
            seen.add(d)
            final.append(d)
    return final[:limit]


# ───────────────────────── the one rule: the site carries the name ─────────────────────────

# What the generic words of a name say about the business, and what the same business's site would then say.
_AGENCY_NAME = {"digital", "marketing", "media", "advertising", "seo", "ppc", "creative", "design", "web", "online", "agency", "studio", "studios"}
_HEALTH_NAME = {"clinic", "center", "centre", "health", "medical", "dental"}
_AGENCY_SITE = re.compile(r"marketing|advertis|\bseo\b|\bppc\b|digital|\bmedia\b|brand|creative|web ?design|agency|social media|google ads|paid search|lead gen|websites?\b", re.I)
_HEALTH_SITE = re.compile(r"dental|dentist|medical|clinic|health|patient|doctor|physician|therapy|orthodont|surgery|wellness|care\b", re.I)
_PLACE_STOP = {"greater", "area", "metropolitan", "metro", "region", "united", "states", "county", "the", "and", "city"}


def place_words(location: str | None) -> list[str]:
    """The distinctive words of a lead's place ("Greater Chicago Area, United States" -> ["chicago"])."""
    first = _fold(location or "").split(",")[0]
    return [w for w in re.split(r"[^a-z]+", first) if len(w) >= 4 and w not in _PLACE_STOP]


def full_name_labels(name: str) -> set[str]:
    """The domain labels that spell the WHOLE name (legal words aside): firebellymarketing, firebelly-marketing."""
    w = [x for x in name_words(name) if x not in LEGAL_WORDS]
    return {"".join(w), "-".join(w)} - {""}


def verify_domain_matches_name(name: str, scan: dict, *, place: str | None = None, strict: bool = True) -> bool:
    """True when the fetched site plausibly belongs to THIS company. The name is necessary, never sufficient
    (found in the first live run: "CROSS Digital Marketing" matched cross.com, a pen maker; "Real Performance
    Marketing" matched a machinery company; "Digital Commerce Partners" matched commerce.com):
      1. a distinctive word of the name is in the site's title, headline or description (a whole word, or, for a word
         of five letters or more, inside the run-together text so "Fire Belly" matches "firebelly");
      2. if the name says what the business does (marketing, agency, digital ... / clinic, dental, medical ...), the
         page talks about that too: a marketing agency's site mentions marketing, a clinic's mentions patients or care;
      3. a second sign it is the same company: two distinctive words of the name match, or the page talks about what
         the name says it does, or it names the lead's city;
      4. `strict` (guesses built from the name): a guess that is only PART of the name (rank.com for "Rank Media
         Agency") also needs the lead's city on the page, because short common words belong to somebody else. A
         label that spells two or more distinctive words of the name (clickcatalystdigital.com) is not that.
         `strict=False` is for an address the model found by searching the web with its evidence.
    A parked or for-sale page NEVER passes. The domain itself is not evidence: it is the guess being checked."""
    toks = name_tokens(name)
    if not toks or not scan or not scan.get("ok") or scan.get("parked"):
        return False
    head = _fold(" ".join(str(scan.get(k) or "") for k in ("title", "h1", "meta_description")).lower())
    words = set(re.split(r"[^a-z0-9]+", head))
    compact = re.sub(r"[^a-z0-9]", "", head)
    hit = [t for t in toks[:3] if t in words or (len(t) >= 5 and t in compact)]
    if not hit:
        return False
    body = _fold(head + " " + str(scan.get("text") or ""))
    ww = set(name_words(name))
    fam_needed = bool(ww & _AGENCY_NAME or ww & _HEALTH_NAME)
    fam_ok = bool((ww & _AGENCY_NAME and _AGENCY_SITE.search(body)) or (ww & _HEALTH_NAME and _HEALTH_SITE.search(body)))
    if fam_needed and not fam_ok:
        return False
    place_ok = any(re.search(rf"\b{re.escape(w)}", body) for w in place_words(place))
    strong_name = len(toks) >= 2 and len(hit) >= 2
    if not (strong_name or fam_ok or place_ok):
        return False
    if strict:
        label = str(scan.get("domain") or "").split(".")[0]
        multi_word_label = len(toks) >= 2 and all(t in label for t in toks[:3])      # clickcatalystdigital.com for "Click Catalyst ..."
        if label and label not in full_name_labels(name) and not multi_word_label and not place_ok:
            return False
    return True


# ───────────────────────── step b: name patterns ─────────────────────────

def try_name_patterns(name: str, *, country: str | None, location: str | None, fetch: webscan.Fetcher,
                      taken: Callable[[str], bool] = lambda d: False, sleep: Callable[[float], None] = time.sleep,
                      pace: float = 3.0, limit: int = MAX_PATTERNS) -> tuple[str | None, dict]:
    """Fetch the guessed home pages one after another (paced), stop at the first one that is verified.
    Returns (domain or None, a trail entry {step, tried, hits, result})."""
    cands = name_candidates(name, country=country, location=location, limit=limit)
    notes, hit = [], None
    for i, dom in enumerate(cands):
        if taken(dom):
            notes.append(f"{dom}: already belongs to another company")
            continue
        if i:
            sleep(pace)
        p = webscan.probe_home(dom, fetch)
        if not p.get("ok"):
            notes.append(f"{dom}: no site")
            continue
        if p.get("parked"):
            notes.append(f"{dom}: parked or for sale")
            continue
        if verify_domain_matches_name(name, p, place=location):
            final = p.get("final_host") or dom
            hit = final if final != dom and not taken(final) else dom
            notes.append(f"{dom}: site carries the name" + (f" (it redirects to {final})" if final != dom else ""))
            break
        notes.append(f"{dom}: a site, but not this company")
    entry = {"step": "name-pattern", "candidates": len(cands), "tried": len(notes),
             "result": f"found {hit}" if hit else ("no candidates" if not cands else "none verified"), "notes": notes}
    return hit, entry


# ───────────────────────── step c: AI lookup with web search ─────────────────────────

def _ai_prompt(name: str, country: str | None, title: str | None, location: str | None, web: bool) -> str:
    ctx = [f"Company: {name}"]
    if country:
        ctx.append(f"Country: {country}")
    if location:
        ctx.append(f"Place: {location}")
    if title:
        ctx.append(f"A person who works there: {title}")
    how = ("Search the web for it and open the site to confirm it belongs to this company (right name, right kind of "
           "business, right place). " if web else "Answer from what you know. ")
    return (f"Find the official website of this small business.\n" + "\n".join(ctx) + "\n\n" + how +
            "Do not give a directory, a social profile, a listing or a registrar page: only the company's own site. "
            "Answer with JSON only, no other text: {\"domain\": \"example.com\", \"evidence\": \"one short line: what you saw\"} "
            "or {\"domain\": null, \"reason\": \"one short line\"} when you could not find it.")


def ai_lookup(name: str, *, country: str | None, location: str | None, title: str | None, ask: Callable[..., str],
              web: bool) -> tuple[str | None, str]:
    """(candidate domain or None, the real reason when None). Never raises: a failure is a sentence, not a swallowed error."""
    prompt = _ai_prompt(name, country, title, location, web)
    try:
        text = ask(prompt, model=aiclient.SONNET, max_tokens=4000, kind="metro_domain", web=web, timeout=240.0)
    except Exception as e:                                       # the bridge being down is a reason, not a silent null
        msg = str(e) or type(e).__name__
        return None, f"call failed: {msg[:160]}"
    try:
        data = aiclient.parse_json(text)
    except Exception:
        return None, f"answer was not JSON ({str(text)[:80]!r})"
    if not isinstance(data, dict):
        return None, "answer was not an object"
    raw = data.get("domain")
    if not raw:
        return None, f"no answer ({str(data.get('reason') or 'model found nothing')[:120]})"
    n = webscan.normalize_site(str(raw))
    if not n:
        return None, f"answer {str(raw)[:60]!r} is not a domain"
    d = n[0]
    from .enrich import FREE_MAIL
    if d in FREE_MAIL or d.endswith(("linkedin.com", "facebook.com", "wikipedia.org", "yelp.com", "instagram.com", "twitter.com",
                                    "x.com", "crunchbase.com", "zoominfo.com", "bbb.org", "clutch.co", "yellowpages.com")):
        return None, f"answer {d} is a directory or profile, not the company's own site"
    return d, "ok"


# ───────────────────────── the trail (what the UI says when a domain is missing) ─────────────────────────

def trail_text(steps: list[dict]) -> str:
    """One line for the table: "tried: name-pattern x6, ai: no answer, linkedin: queued"."""
    if not steps:
        return "not tried yet"
    parts = []
    for s in steps:
        st = s.get("step")
        if st == "name-pattern":
            parts.append(f"name-pattern x{s.get('tried', 0)}" + ("" if s.get("result") != "none verified" else ""))
        elif st == "ai":
            parts.append(f"ai: {s.get('result')}")
        elif st == "linkedin":
            parts.append(f"linkedin: {s.get('result')}")
        elif st == "email-finder":
            parts.append("email-finder: " + str(s.get("result")))
        else:
            parts.append(f"{st}: {s.get('result')}")
    return "tried: " + ", ".join(parts)
