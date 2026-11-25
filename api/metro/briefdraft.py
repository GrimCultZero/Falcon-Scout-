"""A niche campaign's brief, DRAFTED from the niche and IT Force's own case studies (F1 item 9, 25 Nov).

Nothing is saved here: the answer goes to the form, a person edits it and presses Create. The model sees
the niche and a catalogue of the knowledge base's case studies (title and industry tags only; the KB table
is read, never written). The code then checks the answer:
  * case tags must be tags that exist in the KB (anything else is dropped and reported);
  * case studies are looked up by their KB id, so a title or URL always comes from the KB, never from the model;
  * a pain or a "who" with a digit or a percent sign in it is dropped (an assumed pain carries no figures);
  * the standing "do not claim" list is always added.
"""
from __future__ import annotations

import re
from typing import Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import aiclient

STANDING_DO_NOT_CLAIM = [
    "Top 3% of Google Partners",
    'Any number of years other than "since 2015"',
    "Guaranteed results or rankings",
    "Client names without permission",
    "Prices or rates",
]
SKIP_TAGS = {"auto_imported"}


def catalogue(s: Session) -> list[dict]:
    """The KB's case studies: id, title, tags, url. Empty when the table is not there."""
    try:
        rows = s.execute(text("SELECT id, title, tags, source_url FROM kb_entries WHERE type = 'case_study' ORDER BY id")).all()
    except Exception:
        return []
    out = []
    for r in rows:
        tags = [t.strip() for t in str(r[2] or "").split(",") if t.strip() and t.strip() not in SKIP_TAGS]
        title = re.sub(r"^\[Case Study\]\s*", "", str(r[1] or "")).replace("&#8217;", "'")
        out.append({"id": r[0], "title": title, "tags": tags, "url": r[3]})
    return out


def draft(s: Session, niche: str, region: str | None = None, *, ask: Callable[..., str] | None = None) -> dict:
    niche = (niche or "").strip()
    if not niche:
        raise ValueError("type the niche first, for example: dental clinics, US")
    ask = ask or aiclient.ask
    cat = catalogue(s)
    all_tags = sorted({t for c in cat for t in c["tags"]})
    lines = "\n".join(f"{c['id']}: {c['title']} [{', '.join(c['tags'])}]" for c in cat) or "(the knowledge base has no case studies)"
    prompt = f"""You draft the brief for an outbound LinkedIn / email campaign by IT Force, a Google Ads / PPC / SEO / web agency (since 2015).
The campaign targets decision makers in this niche: {niche}{f' ({region})' if region else ''}.

IT Force's case studies (id: title [industry tags]; titles may be in Ukrainian):
{lines}

Answer with JSON only:
{{"who": "one sentence: the decision makers and the kind of business",
 "pains": ["3 to 5 pains such businesses plausibly have that Google Ads / SEO / web work addresses; short; NO numbers, NO percentages, NO claims about IT Force"],
 "case_tags": ["up to 4 industry tags from this list that fit the niche, copied exactly: {', '.join(all_tags)}"],
 "case_ids": [ids of up to 3 case studies above that are closest to this niche; [] if none is close],
 "offer": "one sentence: a low-friction offer, for example a free mini-audit of their ads or site"}}
Do not invent case studies, clients, results or prices. If no case study fits, say so with empty lists."""
    data = aiclient.parse_json(ask(prompt, model=aiclient.SONNET, max_tokens=4000, kind="metro_brief"))
    if not isinstance(data, dict):
        raise aiclient.AIError("the answer is not a brief")
    dropped: list[str] = []
    valid_tags = set(all_tags)
    tags = []
    for t in data.get("case_tags") or []:
        if isinstance(t, str) and t in valid_tags and t not in tags:
            tags.append(t)
        else:
            dropped.append(f"tag not in the knowledge base: {t}")
    by_id = {c["id"]: c for c in cat}
    studies = []
    for i in data.get("case_ids") or []:
        c = by_id.get(i if isinstance(i, int) else (int(i) if str(i).isdigit() else None))
        if c and c["url"] and len(studies) < 3:
            studies.append({"title": c["title"], "url": c["url"]})
        else:
            dropped.append(f"case study not in the knowledge base: {i}")
    pains = []
    for p in data.get("pains") or []:
        p = str(p).strip()
        if p and not re.search(r"[0-9%]", p):
            pains.append(p)
        elif p:
            dropped.append(f"pain with a figure: {p[:60]}")
    who = str(data.get("who") or "").strip()
    if re.search(r"[0-9%]", who):
        dropped.append(f"'who' with a figure: {who[:60]}")
        who = ""
    return {"who": who, "pains": pains, "case_tags": tags, "do_not_claim": list(STANDING_DO_NOT_CLAIM),
            "offer": str(data.get("offer") or "").strip(), "case_studies": studies,
            "kb_case_studies": len(cat), "dropped": dropped, "saved": False}
