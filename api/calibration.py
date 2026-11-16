# -*- coding: utf-8 -*-
"""Analyser calibration (audit 2026-10-29, T9) -- RECORD-ONLY.

The analyser gives hints and never gates the generator (owner decision, 2026-11-16).
Nothing here is read by letter generation: it snapshots the verdict a proposal was sent
under, and measures afterwards how those verdicts relate to replies. A test pins that
no generator code reads `proposals.analysis_json`.

  * snapshot_text(job, submitted_at): the job's analysis, but ONLY if it was saved before
    the proposal was submitted (a contemporaneous one). Stamped with `snapshot_analysis_at`
    (the server's jobs.last_analysis_at), which is what the regime split uses.
  * fill_snapshot(proposal, job): sets proposal.analysis_json only when it is empty.
    Immutable once set.
  * calibrate(rows): reply and open rate by verdict and by score band, split by regime
    (analyser before / after 2026-11-12, never pooled). No rate under n = 10;
    n < 30 is marked "low sample".

"Reply" = proposals.first_reply_at set, or status replied / interviewing / hired.
"Opened" = the Dashboard period-card definition: status viewed, replied, interviewing or
hired. 'declined' is NOT counted as opened (no real view signal), nor is 'ghosted'.
"""
import json
from datetime import datetime, timezone

REGIME_CUTOFF = datetime(2026, 11, 12)          # naive UTC, like the DB's DateTime columns
MIN_RATE_N = 10                                  # below this: show n, no percentage
LOW_SAMPLE_N = 30                                # below this: "low sample"
POS = frozenset({"replied", "interviewing", "hired"})
REACHED_VIEWED = POS | {"viewed"}
BANDS = (("0-3", 0, 3), ("4-6", 4, 6), ("7-8", 7, 8), ("9-10", 9, 10))
DEFINITION_NOTE = ("Reply = the client's first message was recorded (first_reply_at), or the status is replied, interviewing or hired. "
                   "Opened = status viewed, replied, interviewing or hired. These are counted per proposal by outcome, so open and reply here "
                   "may differ from the Dashboard period cards, which count events inside a week.")
REGIMES = (("before", "Analyser before 2026-11-12"), ("after", "Analyser from 2026-11-12 (test-week rules)"),
           ("undated", "Snapshot has no analysis date"))


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


def snapshot_text(job, submitted_at):
    """The analysis to store for a proposal submitted at `submitted_at`, or None."""
    raw = getattr(job, "last_analysis_json", None)
    at = _naive_utc(getattr(job, "last_analysis_at", None))
    sub = _naive_utc(submitted_at)
    if not raw or at is None or sub is None or not at < sub:
        return None                              # none, undated, or made after sending: not contemporaneous
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    data["snapshot_analysis_at"] = at.isoformat()
    return json.dumps(data, ensure_ascii=False)


def fill_snapshot(proposal, job, submitted_at=None):
    """Set proposal.analysis_json if (and only if) it is empty. Returns True if it wrote."""
    if proposal.analysis_json:
        return False
    text = snapshot_text(job, submitted_at if submitted_at is not None else proposal.submitted_at)
    if not text:
        return False
    proposal.analysis_json = text
    return True


def regime_of(snap: dict) -> str:
    at = _naive_utc(snap.get("snapshot_analysis_at")) or _naive_utc(snap.get("ran_at"))
    if at is None:
        return "undated"
    return "before" if at < REGIME_CUTOFF else "after"


def band_of(score):
    try:
        s = float(score)
    except (TypeError, ValueError):
        return "unscored"
    for name, lo, hi in BANDS:
        if lo <= s < hi + 1:
            return name
    return "unscored"


def _cell(key, rows):
    n = len(rows)
    replied = sum(1 for r in rows if r["replied"])
    opened = sum(1 for r in rows if r["opened"])
    return {"key": key, "n": n, "replied": replied, "opened": opened,
            "reply_rate": round(100 * replied / n, 1) if n >= MIN_RATE_N else None,
            "open_rate": round(100 * opened / n, 1) if n >= MIN_RATE_N else None,
            "low_sample": n < LOW_SAMPLE_N}


def calibrate(proposals) -> dict:
    """proposals: iterable of dicts {analysis_json, status, first_reply_at}. Snapshots only."""
    prepared = {k: [] for k, _ in REGIMES}
    for p in proposals:
        try:
            snap = json.loads(p["analysis_json"]) if p.get("analysis_json") else None
        except (TypeError, ValueError):
            snap = None
        if not isinstance(snap, dict):
            continue
        status = p.get("status")
        prepared[regime_of(snap)].append({
            "verdict": str(snap.get("verdict") or "UNKNOWN").strip().upper(),
            "band": band_of(snap.get("score")),
            "replied": p.get("first_reply_at") is not None or status in POS,
            "opened": status in REACHED_VIEWED,
        })
    out = []
    for key, label in REGIMES:
        rows = prepared[key]
        if not rows:
            continue                              # a regime with no snapshots yet is not drawn
        verdicts = sorted({r["verdict"] for r in rows})
        bands = [b for b, _, _ in BANDS] + ["unscored"]
        out.append({"regime": key, "label": label, "n": len(rows),
                    "total": _cell("all", rows),
                    "by_verdict": [_cell(v, [r for r in rows if r["verdict"] == v]) for v in verdicts],
                    "by_band": [_cell(b, [r for r in rows if r["band"] == b]) for b in bands
                                if any(r["band"] == b for r in rows)]})
    return {"regimes": out, "cutoff": REGIME_CUTOFF.date().isoformat(),
            "min_rate_n": MIN_RATE_N, "low_sample_n": LOW_SAMPLE_N,
            "caption": "Rates are among jobs you applied to. A hint, not a gate: the analyser never blocks or steers the generator.",
            "definition_note": DEFINITION_NOTE,
            "declined_note": "Declined is not counted as opened (no real view signal), as on the Dashboard period cards; it counts as a reply only if the client's message was recorded. Ghosted is neither."}
