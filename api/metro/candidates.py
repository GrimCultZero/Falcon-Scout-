"""Suppression CANDIDATES: entries proposed by Upwork-derived data, waiting for Oleh's decision.

Decision of 2026-11-24: the 494 `upwork_job` ids are NOT imported, and the domains found in the
proposals (clients' own replies and the postings they answered) are shown in Metro Settings as a list
that Oleh approves or rejects one by one. NOTHING is suppressed until a candidate is approved
(only then does it become a `metro_suppression` entry, scope company). Reading proposals only
proposes; it never adds a lead (METRO_PLAN.md hard rule: Metro never imports leads sourced from Upwork).

Rules: refreshing only ADDS pending candidates and never touches a decided one. A rejected domain is
remembered so it does not come back. An approval is final in the API (an approved entry is a safety
entry; taking one back is a deliberate manual act, not a misclick); a rejected one may still be
approved later.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import suppression as sup
from .db import MetroSuppressionCandidate, utcnow


def refresh_from_proposals(s: Session) -> dict:
    """Propose the domains named by engaged Upwork clients. Returns counts; writes pending rows only."""
    have = {(c.kind, c.value) for c in s.query(MetroSuppressionCandidate).all()}
    added = skipped = 0
    for e in sup.entries_from_proposals(s):
        if e["kind"] != "domain":
            continue                                    # the upwork_job ids are deliberately not proposed
        v = sup.normalize("domain", e["value"])
        if not v:
            continue
        if ("domain", v) in have:
            skipped += 1
            continue
        have.add(("domain", v))
        s.add(MetroSuppressionCandidate(kind="domain", value=v, source="proposals", evidence=e.get("note"),
                                        decision="pending", created_at=utcnow()))
        added += 1
    s.commit()
    return {"added": added, "already_listed": skipped}


def listing(s: Session) -> list[dict]:
    rows = s.query(MetroSuppressionCandidate).order_by(MetroSuppressionCandidate.decision.desc(),
                                                       MetroSuppressionCandidate.value).all()
    return [{"id": r.id, "kind": r.kind, "value": r.value, "source": r.source, "evidence": r.evidence,
             "decision": r.decision, "decided_at": r.decided_at.isoformat() if r.decided_at else None} for r in rows]


def decide(s: Session, cand_id: int, decision: str) -> dict:
    if decision not in ("approve", "reject"):
        raise ValueError("decision must be approve or reject")
    c = s.get(MetroSuppressionCandidate, cand_id)
    if c is None:
        raise KeyError(cand_id)
    if c.decision == "approved":
        raise ValueError("an approved entry is already on the suppression list and cannot be changed here")
    if decision == "approve":
        sup.add_entries(s, [{"kind": c.kind, "value": c.value, "reason": "upwork client (approved by Oleh)",
                             "note": c.evidence}], source="proposals (approved)")
        c.decision = "approved"
    else:
        c.decision = "rejected"
    c.decided_at = utcnow()
    s.commit()
    return {"id": c.id, "value": c.value, "decision": c.decision}
