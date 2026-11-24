"""Layer 0 persona score (METRO_PLAN.md Phase 1, step 4): from the CSV row ONLY, no web, no AI.

Looks at the person's title and headline (seniority and authority), whether the headline or company
points at the campaign's kind of business, where they are, and junk patterns (freelancer, student,
"open to work", recruiter ...). Every rule lives in the `persona_rules` setting (edited in Metro
Settings); DEFAULT_RULES is only the seed. The result carries its reasons, so a score is never a
black box:

    {"score": 0-100, "verdict": "keep" | "review" | "junk", "reasons": ["+40 decision maker: founder", ...]}

`junk` is a verdict, never a deletion: the lead is kept, marked, and can be restored by hand
(`persona_locked`), after which rescoring leaves it alone.
Pure functions: this module imports nothing from the rest of Metro (db.py imports it to seed).
"""
from __future__ import annotations

import copy
import re

DEFAULT_RULES = {
    "keep_threshold": 50,                 # score >= this -> keep, below -> review
    "weights": {"decision_maker": 40, "senior": 20, "relevant": 25, "geo_match": 25, "geo_miss": -25,
                "geo_unknown": 0},
    # Whole-word / phrase match, lower case, against title + headline.
    "decision_maker": ["founder", "co-founder", "cofounder", "owner", "ceo", "chief executive", "president",
                       "managing director", "managing partner", "partner", "principal", "proprietor",
                       "general manager", "head of", "director", "vp", "vice president", "cmo",
                       "chief marketing officer"],
    "senior": ["manager", "lead", "senior", "head", "strategist", "executive"],
    # Words that say the company is in the kind of business the campaign targets.
    "relevant": {
        "agency": ["agency", "marketing", "seo", "ppc", "paid media", "digital", "performance", "growth",
                   "advertising", "web design", "web development", "studio", "ecommerce", "e-commerce",
                   "google ads", "social media"],
        "niche": ["clinic", "medical", "health", "dental", "dentist", "aesthetic", "med spa", "medspa",
                  "dermatology", "cosmetic", "wellness", "surgery", "practice", "skin"],
    },
    # Location text -> region key. A campaign's `region` selects the list; unknown regions are not scored.
    "geo": {
        "US/CA": ["united states", "usa", "canada", "u.s.", "new york", "california", "texas", "florida",
                  "illinois", "washington", "massachusetts", "ontario", "british columbia", "quebec", "alberta"],
        "EU": ["united kingdom", "germany", "france", "netherlands", "spain", "italy", "ireland", "sweden",
               "poland", "belgium", "austria", "switzerland", "denmark", "norway", "finland", "portugal",
               "czech", "romania", "lithuania", "latvia", "estonia", "europe", "london", "berlin", "amsterdam"],
    },
    # Any hit marks the lead junk. Title/headline patterns:
    "junk_title": ["freelance", "freelancer", "student", "intern", "internship", "seeking", "looking for",
                   "recruiter", "talent acquisition", "headhunter", "unemployed", "between roles", "job seeker",
                   "consultant at self", "self-employed", "retired", "aspiring"],
    # Anywhere in the row's headline / summary:
    "junk_text": ["open to work", "#opentowork", "looking for new opportunities", "seeking new opportunities",
                  "actively seeking", "available for hire"],
}


def merge_rules(stored: dict | None) -> dict:
    """The stored rules over the defaults, so a missing key never breaks scoring."""
    out = copy.deepcopy(DEFAULT_RULES)
    for k, v in (stored or {}).items():
        if k in ("weights", "relevant", "geo") and isinstance(v, dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def validate_rules(rules) -> list[str]:
    """Problems with a rules object an editor is about to save (empty list = fine)."""
    errs = []
    if not isinstance(rules, dict):
        return ["rules must be an object"]
    for k in ("decision_maker", "senior", "junk_title", "junk_text"):
        v = rules.get(k)
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            errs.append(f"{k}: must be a list of text")
    for k in ("relevant", "geo"):
        v = rules.get(k)
        if not isinstance(v, dict) or not all(isinstance(x, list) and all(isinstance(y, str) for y in x) for x in v.values()):
            errs.append(f"{k}: must map a name to a list of text")
    w = rules.get("weights")
    if not isinstance(w, dict) or not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in w.values()):
        errs.append("weights: must map a name to a number")
    t = rules.get("keep_threshold")
    if not isinstance(t, (int, float)) or isinstance(t, bool) or not 0 <= t <= 100:
        errs.append("keep_threshold: a number from 0 to 100")
    return errs


def _has(text: str, terms) -> str | None:
    """The first term found in `text` as a whole word or phrase (case-insensitive), else None."""
    for t in terms:
        t = (t or "").strip().lower()
        if t and re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", text):
            return t
    return None


def _sub(text: str, terms) -> str | None:
    for t in terms:
        t = (t or "").strip().lower()
        if t and t in text:
            return t
    return None


def score_lead(lead: dict, rules: dict, *, campaign_type: str | None, region: str | None,
               job_seeker_badge: bool = False) -> dict:
    """Score one lead dict (keys: title, headline, company_name, location, summary)."""
    r = merge_rules(rules)
    w = r["weights"]
    title = (lead.get("title") or "").lower()
    headline = (lead.get("headline") or "").lower()
    who = f"{title} {headline}".strip()
    reasons: list[str] = []
    score = 0

    # Junk first: it decides the verdict whatever else the person scores.
    junk_hit = _has(who, r["junk_title"])
    text_hit = _sub(f"{headline} {(lead.get('summary') or '').lower()[:600]}", r["junk_text"])
    if job_seeker_badge:
        junk_hit = junk_hit or "open-to-work badge"
    if junk_hit or text_hit:
        why = junk_hit or f'"{text_hit}"'
        return {"score": 0, "verdict": "junk", "reasons": [f"junk: {why}"]}

    hit = _has(who, r["decision_maker"])
    if hit:
        score += w["decision_maker"]
        reasons.append(f"+{w['decision_maker']} decision maker: {hit}")
    else:
        hit = _has(who, r["senior"])
        if hit:
            score += w["senior"]
            reasons.append(f"+{w['senior']} senior: {hit}")
        else:
            reasons.append("+0 no seniority word in the title")

    rel_terms = r["relevant"].get(campaign_type or "", [])
    blob = f"{who} {(lead.get('company_name') or '').lower()}"
    hit = _sub(blob, rel_terms) if rel_terms else None
    if hit:
        score += w["relevant"]
        reasons.append(f"+{w['relevant']} relevant business: {hit}")
    elif rel_terms:
        reasons.append("+0 nothing in the title or company points at the campaign's business")

    geo_terms = r["geo"].get(region or "")
    loc = (lead.get("location") or "").lower()
    if geo_terms and loc:
        if _sub(loc, geo_terms):
            score += w["geo_match"]
            reasons.append(f"+{w['geo_match']} location in {region}")
        else:
            score += w["geo_miss"]
            reasons.append(f"{w['geo_miss']} location outside {region}")
    elif geo_terms:
        score += w["geo_unknown"]
        reasons.append("+0 no location in the file")

    score = max(0, min(100, score))
    return {"score": score, "verdict": "keep" if score >= r["keep_threshold"] else "review", "reasons": reasons}
