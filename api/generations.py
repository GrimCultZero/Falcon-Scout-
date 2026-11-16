# -*- coding: utf-8 -*-
"""Generated drafts and how much the owner edits them (audit 2026-10-29, T10). RECORD-ONLY.

Every time a letter lands in the textarea (generate, rescan, chat rewrite) the frontend
posts it here; /proposal-submitted then links the latest generation made BEFORE the
submission and computes

    edit_ratio = 1 - difflib.SequenceMatcher(generated, sent_text).ratio()

0 = sent exactly as generated, 1 = nothing in common. Whitespace is collapsed on both sides
first, so line-ending / paragraph-spacing differences from the Upwork scrape are not "edits".
Nothing here is read by letter generation; the generator keeps its rules (never refuses,
never treats the analysis as a gate).

weekly_stats(): median edit ratio and the share of letters sent with under 10% edits, per ISO
week of the submission, with n; n < 30 is "low sample".
"""
import difflib
import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

KINDS = ("generate", "rescan", "chat")
LOW_SAMPLE_N = 30
LIGHT_EDIT = 0.10                      # "under 10% edits"
PLACEHOLDER_SENT = "(submitted via Upwork)"


def _norm(text) -> str:
    return " ".join(str(text or "").split())


def edit_ratio(generated, sent):
    """1 - similarity of the two texts (whitespace-collapsed), rounded to 4 places; None if either is empty."""
    a, b = _norm(generated), _norm(sent)
    if not a or not b or b == _norm(PLACEHOLDER_SENT):
        return None
    return round(1 - difflib.SequenceMatcher(None, a, b, autojunk=False).ratio(), 4)


def _naive_utc(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def clean_kind(kind) -> str:
    k = str(kind or "").strip().lower()
    return k if k in KINDS else "generate"


def clean_checks(checks) -> str:
    """fired_checks stored as a JSON list of strings."""
    if not isinstance(checks, list):
        checks = []
    return json.dumps([str(c).strip() for c in checks if str(c).strip()][:200], ensure_ascii=False)


def clean_bomb(data) -> dict:
    """T22: the Digit Bomb facts of a generation: ledger case id, auto match score (None when armed by hand)
    and the style variant. Anything missing or malformed is simply NULL."""
    case = str((data or {}).get("digit_bomb_case") or "").strip()[:60] or None
    try:
        score = int((data or {}).get("digit_bomb_score"))
    except (TypeError, ValueError):
        score = None
    if not case:
        return {"digit_bomb_case": None, "digit_bomb_score": None, "style_variant": None}
    variant = str((data or {}).get("style_variant") or "digit-bomb").strip()[:40] or "digit-bomb"
    return {"digit_bomb_case": case, "digit_bomb_score": score, "style_variant": variant}


# ── T13: the style variant, read deterministically from the letter's OPENING ──────────────────────────
# Reuses the opening moves of tools/extract_shapes.py (the 2026-10-07 shapes study): metric-led / case-led,
# credential-led, diagnosis-led / approach-led. No model call. Three variants plus "other":
#   digit-bomb         the letter opens with a number or a named case with a figure (metric-led / case-led)
#   credential         "12 years running Google Ads ..." / "I'm a ..." opens the letter
#   house-style-10-11  the 2026-10-11 house style: take the job in one sentence, then a differential diagnosis of
#                      named candidate causes (diagnosis-led / approach-led, or "I can run ..." + "almost always ...")
#   other              anything else (a mirror of the posting, an invite reply, ...), kept so n is honest
VARIANTS = ("house-style-10-11", "credential", "digit-bomb", "other")
_LEDGER = Path(__file__).resolve().parent.parent / "frontend" / "src" / "lib" / "caseLedger.js"
_CASE_RE = None
_YEARS_RE = re.compile(r"\b\d+\s*\+?\s*(?:years?|yrs?)\b", re.I)
_YEAR4_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_FIGURE_RE = re.compile(r"\d[\d,.]*\s*(?:%|x\b|roas)", re.I)


def _case_re():
    global _CASE_RE
    if _CASE_RE is None:
        try:
            names = sorted(set(re.findall(r"name:\s*'([^']+)'", _LEDGER.read_text(encoding="utf-8"))), key=len, reverse=True)
        except OSError:
            names = []
        _CASE_RE = re.compile("|".join(re.escape(n) for n in names), re.I) if names else re.compile(r"(?!x)x")
    return _CASE_RE


_CRED_RE = re.compile(r"\b12\s+years\b|\bgoogle\s+premier\s+partner\b", re.I)
_METRIC_START_RE = re.compile(r"^\s*[+\-−]?\s?[$€£]?\d|^\s*\d+(?:[.,]\d+)?\s*(?:%|x\b|roas)", re.I)
_TIME_UNIT_START_RE = re.compile(r"^\s*\d+\s*\+?\s*(?:years?|yrs?|months?|weeks?|days?|hours?)\b", re.I)
_GREETING_RE = re.compile(r"^\s*(?:hi|hello|hey)\b[\s,.\-–—]*(?:[A-Z][a-z]+\b\s*[,\-–—]\s*)?", re.I)
_DIAGNOSIS_HOOK_RE = re.compile(
    r"\bthe\s+real\s+problem\b|\bmost\s+\w+\s+(?:fail|don'?t|never)\b|\bthe\s+(?:issue|gap)\s+is\b"
    r"|\bwhen\s+[^.]{0,60}(?:fires|isn'?t|doesn'?t)\b", re.I)
_SECOND_PERSON_DIAG_RE = re.compile(
    r"^your\s+\w+|^you(?:'ve|\s+have|'re|\s+are)\s+(?:got|asking|running|looking|trying)\b"
    r"|^the\s+(?:challenge|problem|issue|gap|setup|most\s+common|real\s+)", re.I)
_APPROACH_RE = re.compile(
    r"\bfirst\s+thing\s+i'?d\b|\bi'?d\s+(?:check|start|map|structure|wire|look|verify|segment|audit)\b"
    r"|\bi\s+would\s+(?:check|start|map|structure)\b", re.I)
_OFFER_TAKE_RE = re.compile(r"^(?:i\s+can|i\s+will|i'?ll|i'?d\s+be\s+glad\s+to|happy\s+to)\s+(?:run|do|take|start|handle|audit|review|diagnose|build|fix)\b", re.I)
_CANDIDATE_CUE_RE = re.compile(r"almost\s+always|\busually\b|most\s+often|\bcandidates?\b|the\s+real\s+problem|most\s+common|\btypically\b", re.I)


def classify_variant(letter) -> str:
    """The style variant of a letter, from its opening alone (see the table above)."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", str(letter or "").strip()) if p.strip()]
    first = paras[0] if paras else ""
    if len(paras) > 1 and len(first) < 60 and not re.search(r"[.!?]\s*$", first):
        first = paras[1]                       # a headline line is packaging, not the move
    if not first:
        return "other"
    if _METRIC_START_RE.match(first) and not _TIME_UNIT_START_RE.match(first):
        return "digit-bomb"
    body = _GREETING_RE.sub("", first)
    head = body[:160]
    # "12 years" is a credential, not a figure: strip it before looking for numbers
    figures = _YEAR4_RE.sub("", _YEARS_RE.sub("", head))      # ...and so is a calendar year ("Premier Partner 2026")
    if _case_re().search(head) and re.search(r"\d", figures):
        return "digit-bomb"
    if _CRED_RE.search(head[:80]) or re.match(r"i'?m\s+a\b", body, re.I):
        return "credential"
    if len(_FIGURE_RE.findall(figures)) >= 2:       # two or more results figures (%, x, ROAS) in the opening
        return "digit-bomb"
    if _DIAGNOSIS_HOOK_RE.search(body) or _SECOND_PERSON_DIAG_RE.match(body) or _APPROACH_RE.search(body):
        return "house-style-10-11"
    if _OFFER_TAKE_RE.match(body) and _CANDIDATE_CUE_RE.search(first[:450]):
        return "house-style-10-11"
    return "other"


def with_variant(bomb_fields: dict, text) -> dict:
    """clean_bomb's fields plus the letter's style variant: a Digit Bomb case wins (T22 writes it), else the opening decides."""
    out = dict(bomb_fields)
    if not out.get("style_variant"):
        out["style_variant"] = classify_variant(text)
    return out


def link_latest(session, Generation, proposal, submitted_at=None):
    """Link the latest generation for the proposal's job that was made before the submission,
    and compute its edit_ratio against the proposal's sent text. Returns the Generation or None.
    Idempotent: re-running (an update of the same proposal) recomputes against the current text."""
    q = session.query(Generation).filter_by(job_id=proposal.job_id)
    sub = _naive_utc(submitted_at if submitted_at is not None else proposal.submitted_at)
    gens = q.order_by(Generation.ts.desc(), Generation.id.desc()).all()
    gen = next((g for g in gens if sub is None or (_naive_utc(g.ts) is not None and _naive_utc(g.ts) <= sub)), None)
    if gen is None:
        return None
    ratio = edit_ratio(gen.text, proposal.sent_text)
    if ratio is None:                  # no real sent text yet (a bare submit notice): do not link a meaningless 1.0
        return None
    for other in gens:                 # one proposal <-> one generation
        if other.proposal_id == proposal.id and other.id != gen.id:
            other.proposal_id, other.edit_ratio = None, None
    gen.proposal_id = proposal.id
    gen.edit_ratio = ratio
    if gen.style_variant and getattr(proposal, "style_variant", None) is None:
        proposal.style_variant = gen.style_variant      # T13: carried onto the proposal at submit, immutable once set
    return gen


def weekly_stats(rows):
    """rows: iterable of (submitted_at, edit_ratio) for linked generations."""
    weeks = {}
    allr = []
    for sub, r in rows:
        s = _naive_utc(sub)
        if s is None or r is None:
            continue
        iso = s.isocalendar()
        weeks.setdefault(f"{iso[0]}-W{iso[1]:02d}", []).append(float(r))
        allr.append(float(r))

    def cell(key, rs):
        n = len(rs)
        return {"key": key, "n": n, "median_edit_ratio": round(statistics.median(rs), 4) if n else None,
                "under10_n": sum(1 for r in rs if r < LIGHT_EDIT),
                "under10_share": round(100 * sum(1 for r in rs if r < LIGHT_EDIT) / n, 1) if n else None,
                "low_sample": n < LOW_SAMPLE_N}
    return {"weeks": [cell(k, v) for k, v in sorted(weeks.items())][-12:], "all": cell("all", allr),
            "low_sample_n": LOW_SAMPLE_N,
            "note": "edit ratio = 1 - similarity of the generated draft and the letter you sent (0 = sent as generated); "
                    "whitespace is ignored. Only letters with a recorded draft and a captured sent text are counted."}
