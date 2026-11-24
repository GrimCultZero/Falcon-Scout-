"""Hooks: facts about a lead's company that a message may use (METRO_PLAN.md Phase 2, step 7).

A hook is stated only when a stored field supports it, with that field's date (SEEN). The model never sees
the web; it sees a numbered EVIDENCE list built from the stored snapshots (each item: path, value, date) and
must answer with hooks that cite evidence numbers. Then CODE decides which hooks survive:

  * every hook cites at least one evidence item that exists;
  * every number in the fact appears in the cited evidence (no invented figure, no computed one);
  * no URL, no price or currency, no hedge word (probably, likely, seems, ...), no first-person claim;
  * the fact is a single sentence of reasonable length and not a duplicate.

What survives is stored in the ledger (`metro_hooks`): the fact, the cited paths, the source reference and the
date the field was read. Hooks already used by a touch are never touched; unused ones are replaced.
The angle and the best-fit case tag come from the same answer; a case tag must be one the campaign allows.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Callable

from sqlalchemy.orm import Session

from . import aiclient
from .db import MetroCampaign, MetroCompany, MetroHook, MetroLead, utcnow

HEDGES = re.compile(r"\b(probably|likely|maybe|perhaps|might|may be|seems?|appears?|presumably|i assume|i guess|could be|"
                    r"suggests? that|i noticed that you|i saw that you)\b", re.I)
URL_RX = re.compile(r"https?://|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ca|us|uk|de|ai)\b", re.I)
PRICE_RX = re.compile(r"[$€£]|\b(usd|eur|gbp|dollars?|euros?|pounds?|per hour|/hr|an hour|\bprice|\bcosts?\b|\bfee\b|\brate of)\b", re.I)
NUM_RX = re.compile(r"\d[\d,.]*")
MAX_EVIDENCE = 60
MAX_HOOKS = 8


def _load(raw):
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def _flat(prefix: str, obj, out: list, at: str | None, ref: str | None, skip=()):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in skip:
                continue
            _flat(f"{prefix}.{k}", v, out, at, ref, skip)
    elif isinstance(obj, list):
        if obj and all(isinstance(x, (str, int, float)) for x in obj):
            out.append({"path": prefix, "value": ", ".join(str(x) for x in obj[:12]), "at": at, "ref": ref})
        else:
            for i, x in enumerate(obj[:6]):
                _flat(f"{prefix}[{i}]", x, out, at, ref, skip)
    elif obj is not None and obj != "":
        out.append({"path": prefix, "value": obj, "at": at, "ref": ref})


_SKIP_KEYS = ("ok", "scanned_at", "fetched_at", "target", "errors", "pages_read", "final_url", "url", "strategy", "status",
              "service_examples", "location_examples", "ids", "sample_url", "phones")


def build_evidence(s: Session, lead: MetroLead, company: MetroCompany | None) -> list[dict]:
    """The numbered evidence list: only stored fields, each with its date. Snapshots that failed are left out."""
    items: list[dict] = []
    if company is not None:
        for col, root in (("website_scan", "website"), ("pagespeed", "pagespeed"), ("ads", "ads"), ("gbp", "gbp"),
                          ("ahrefs", "ahrefs"), ("linkedin_page", "linkedin_company")):
            snap = _load(getattr(company, f"{col}_json"))
            at = getattr(company, f"{col}_at")
            if not (isinstance(snap, dict) and snap.get("ok")) or at is None:
                continue
            _flat(root, snap, items, at.strftime("%Y-%m-%d"), company.domain or company.name, skip=_SKIP_KEYS)
    raw = _load(lead.raw_json) or {}
    prof = raw.get("linkedin_profile")
    if isinstance(prof, dict) and prof.get("ok"):
        _flat("linkedin_profile", prof, items, (prof.get("fetched_at") or "")[:10] or None, lead.profile_url, skip=_SKIP_KEYS)
    base_at = (lead.created_at or utcnow()).strftime("%Y-%m-%d")
    for path, val in (("lead.title", lead.title), ("lead.headline", (raw.get("mapped") or {}).get("headline")),
                      ("lead.company", lead.company_name), ("lead.location", lead.location)):
        if val:
            items.append({"path": path, "value": val, "at": base_at, "ref": lead.source_file or "import"})
    items = [i for i in items if i["at"]]
    for n, it in enumerate(items[:MAX_EVIDENCE], 1):
        it["id"] = f"E{n}"
    return items[:MAX_EVIDENCE]


def _nums(text: str) -> set[str]:
    return {re.sub(r"[^\d]", "", m) for m in NUM_RX.findall(str(text)) if re.sub(r"[^\d]", "", m)}


def verify_hook(h: dict, evidence: dict[str, dict], forbidden: list[str] | None = None) -> tuple[bool, str]:
    """(ok, why not). Pure: the code-side check that decides whether a model-written hook may be stored."""
    fact = str(h.get("fact") or "").strip()
    cited = h.get("evidence")
    if not fact or len(fact) < 12 or len(fact) > 260:
        return False, "fact is empty, too short or too long"
    if not isinstance(cited, list) or not cited:
        return False, "cites no evidence"
    items = []
    for c in cited:
        it = evidence.get(str(c))
        if it is None:
            return False, f"cites {c}, which does not exist"
        items.append(it)
    for bad in forbidden or []:
        if bad and bad.lower() in fact.lower():
            return False, f"touches the campaign's do-not-claim list ({bad})"
    if URL_RX.search(fact):
        return False, "contains a URL or domain"
    if PRICE_RX.search(fact):
        return False, "mentions a price or currency"
    if HEDGES.search(fact):
        return False, "hedged or assumed wording"
    if re.search(r"\b(we|our|i|my)\b", fact, re.I) and re.search(r"\b(we|i) (?:can|will|offer|do)\b", fact, re.I):
        return False, "makes a claim about us instead of stating a fact about them"
    if fact.count(". ") >= 1 and not fact.endswith("."):
        return False, "more than one sentence"
    have = set()
    for it in items:
        have |= _nums(it["value"]) | _nums(it["at"] or "")
    for n in _nums(fact):
        if n not in have:
            return False, f"the number {n} is not in the cited evidence"
    return True, ""


PROMPT = """You prepare facts for a short outreach message from IT Force, a Google Ads / PPC / SEO and web development team, to {who}.

EVIDENCE (the only things you may rely on; each has an id, a stored field path, its value and the date it was read):
{evidence}

Write up to {max_hooks} HOOKS: short, true observations about THEM that a message could open with.
Rules, all enforced by code afterwards (a hook that breaks one is thrown away):
- Use ONLY the evidence. Every hook lists the evidence ids it rests on. Do not use anything else you know.
- Use only numbers that appear in the cited evidence; do not compute, round or convert them.
- One plain sentence about the company or the person, in the third person ("The site ...", "Their ..."), not about us.
- "false" for a tag means it was not visible in the page source; say "not visible in the page source", never "does not use".
- No URLs, no prices, no guesses (no "probably", "seems", "likely").
- Prefer hooks that are specific and checkable by the reader over generic ones.
Also give:
- "angle": one sentence, the single most promising reason to write to them, based on the hooks.
- "case_tag": the one best-fitting tag from this list, or null: {tags}.

Answer with JSON only:
{{"hooks": [{{"fact": "...", "evidence": ["E1"], "kind": "tracking|speed|ads|reviews|content|team|role|site|growth"}}], "angle": "...", "case_tag": null}}"""


def extract_hooks(s: Session, lead: MetroLead, campaign: MetroCampaign, *, ask: Callable[..., str] | None = None) -> dict:
    """Step 7 for one lead. Stores the surviving hooks in the ledger and the angle + case tag in the lead's notes."""
    ask = ask or aiclient.ask
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    ev_list = build_evidence(s, lead, company)
    if sum(1 for e in ev_list if not e["path"].startswith("lead.")) < 2:      # the CSV fields alone are not enough to say anything
        return {"lead_id": lead.id, "hooks": 0, "reason": "not enough stored evidence", "rejected": []}
    ev = {e["id"]: e for e in ev_list}
    brief = json.loads(campaign.brief_json) if getattr(campaign, "brief_json", None) else {}
    tags = [str(t) for t in (brief.get("case_tags") or [])]
    who = (f"{lead.full_name or 'a lead'}, {lead.title or 'a decision maker'} at {lead.company_name or 'their company'}")
    lines = "\n".join(f"{e['id']} | {e['path']} = {e['value']} | read {e['at']}" for e in ev_list)
    prompt = PROMPT.format(who=who, evidence=lines, max_hooks=MAX_HOOKS, tags=", ".join(tags) if tags else "none (use null)")
    data = aiclient.parse_json(ask(prompt, model=aiclient.SONNET, max_tokens=6000, kind="metro_hooks"))
    if not isinstance(data, dict):
        raise aiclient.AIError("unexpected answer shape")
    kept, rejected, seen_facts = [], [], set()
    for h in (data.get("hooks") or [])[:MAX_HOOKS * 2]:
        if not isinstance(h, dict):
            continue
        ok, why = verify_hook(h, ev, [str(x) for x in (brief.get('do_not_claim') or [])])
        key = re.sub(r"\W+", " ", str(h.get("fact") or "").lower()).strip()
        if ok and key in seen_facts:
            ok, why = False, "duplicate"
        if not ok:
            rejected.append({"fact": str(h.get("fact"))[:160], "why": why})
            continue
        seen_facts.add(key)
        kept.append(h)
        if len(kept) >= MAX_HOOKS:
            break

    # replace the unused hooks of this cycle; used ones belong to the ledger and stay
    for old in s.query(MetroHook).filter(MetroHook.lead_id == lead.id, MetroHook.cycle == lead.current_cycle,
                                         MetroHook.used_touch_id.is_(None)).all():
        s.delete(old)
    s.flush()
    for h in kept:
        cited = [ev[str(c)] for c in h["evidence"]]
        s.add(MetroHook(lead_id=lead.id, company_id=lead.company_id, fact=str(h["fact"]).strip(),
                        source_field=", ".join(dict.fromkeys(c["path"] for c in cited)),
                        source_ref=str(cited[0].get("ref") or "")[:300],
                        seen_at=datetime.strptime(min(c["at"] for c in cited), "%Y-%m-%d"),
                        kind=str(h.get("kind") or "")[:40] or None, cycle=lead.current_cycle))
    notes = json.loads(lead.score_notes_json or "{}")
    angle = str(data.get("angle") or "").strip()[:300]
    ct = data.get("case_tag")
    notes["angle"] = angle if angle and not URL_RX.search(angle) and not PRICE_RX.search(angle) else None
    notes["case_tag"] = ct if isinstance(ct, str) and ct in tags else None
    notes["hooks_at"] = utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    lead.score_notes_json = json.dumps(notes, ensure_ascii=False)
    lead.enriched_at = utcnow()
    s.commit()
    return {"lead_id": lead.id, "hooks": len(kept), "rejected": rejected, "angle": notes["angle"], "case_tag": notes["case_tag"]}


def hooks_for(s: Session, lead_id: int) -> list[dict]:
    rows = s.query(MetroHook).filter_by(lead_id=lead_id).order_by(MetroHook.id).all()
    return [{"id": h.id, "fact": h.fact, "source_field": h.source_field, "source_ref": h.source_ref,
             "seen_at": h.seen_at.strftime("%Y-%m-%d") if h.seen_at else None, "kind": h.kind, "cycle": h.cycle,
             "used": h.used_touch_id is not None} for h in rows]


# ───────────────────────── a batch over the shortlist (background; one at a time) ─────────────────────────

import threading  # noqa: E402

from .db import get_engine  # noqa: E402


class HooksRun:
    lock = threading.Lock()
    state: dict = {"running": False}


def hooks_status() -> dict:
    return dict(HooksRun.state)


def start_hooks_run(campaign_id: int, lead_ids: list[int], *, ask=None, background: bool = True) -> dict:
    with HooksRun.lock:
        if HooksRun.state.get("running"):
            return {"started": False, "reason": "a run is already going", **HooksRun.state}
        HooksRun.state = {"running": True, "campaign_id": campaign_id, "total": len(lead_ids), "done": 0, "failed": 0,
                          "hooks": 0, "rejected": 0, "log": []}

    def work():
        try:
            for lid in lead_ids:
                with Session(get_engine()) as s:
                    lead, camp = s.get(MetroLead, lid), s.get(MetroCampaign, campaign_id)
                    try:
                        r = extract_hooks(s, lead, camp, ask=ask)
                        HooksRun.state["hooks"] += r["hooks"]
                        HooksRun.state["rejected"] += len(r.get("rejected", []))
                    except Exception as e:
                        s.rollback()
                        HooksRun.state["failed"] += 1
                        HooksRun.state["log"] = (HooksRun.state["log"] + [{"lead_id": lid, "error": f"{type(e).__name__}: {e}"[:200]}])[-20:]
                HooksRun.state["done"] += 1
        finally:
            HooksRun.state["running"] = False

    if background:
        threading.Thread(target=work, name="metro-hooks", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(lead_ids)}
