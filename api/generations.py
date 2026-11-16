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
import statistics
from datetime import datetime, timezone

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
