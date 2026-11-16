# -*- coding: utf-8 -*-
"""Bid selection signals (audit 2026-10-29, T12). RECORD-ONLY: nothing here filters, ranks or changes a letter.

At submit (/proposal-submitted, create and update) the proposal gets a snapshot of what the owner could see
when bidding: the boost ladder and when it was captured, the applicants band, the connects bid, the client's
spend band and whether the title says "audit". Each field is filled ONLY when empty (immutable once set), and
a value that changes over time (the ladder, the applicants count, the client's spend) is taken only if it was read BEFORE the
submission, so a later re-read never leaks into an earlier decision.

The Dashboard card groups proposals by those snapshots with the SAME open / reply definitions and the same
cell rules as the Calibration card (calibration.py): reply rate is the headline, open rate secondary, n always
shown, no rate under n = 10, "low sample" under n = 30. Selection bias: these are jobs the owner chose to apply
to, so the card is a hint, not a gate.
"""
import json
import re

import calibration as cal

APPLICANT_BANDS = ("<5", "5-10", "10-15", "15-20", "20-50", "50+")
CONNECTS_BANDS = ("<=12", "13-20", "21-30", "31+")
SPEND_BANDS = ("$0", "<$1K", "$1K-10K", "$10K-50K", "$50K+")
LADDER_STALE_HOURS = 3


def applicants_band(raw):
    """Upwork's applicants text ("Less than 5", "20 to 50", "50+", or a bare number) -> a canonical band."""
    s = str(raw or "").strip().lower().replace("–", "-")
    if not s:
        return None
    if s.startswith("less than") or s.startswith("<"):
        return "<5"
    if "+" in s:
        m = re.match(r"(\d+)", s)
        return "50+" if m and int(m.group(1)) >= 50 else None
    m = re.match(r"(\d+)\s*(?:to|-)\s*(\d+)", s)
    if m:
        lo = int(m.group(1))
        return {5: "5-10", 10: "10-15", 15: "15-20", 20: "20-50", 50: "50+"}.get(lo)
    m = re.fullmatch(r"(\d+)", s)
    if m:
        n = int(m.group(1))
        return "<5" if n < 5 else "5-10" if n < 10 else "10-15" if n < 15 else "15-20" if n < 20 else "20-50" if n < 50 else "50+"
    return None


def connects_band(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return "<=12" if n <= 12 else "13-20" if n <= 20 else "21-30" if n <= 30 else "31+"


def _dollars(text):
    m = re.search(r"\$\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?", str(text or ""))
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    return v * {"k": 1_000, "m": 1_000_000}.get((m.group(2) or "").lower(), 1)


def spend_band(client_spend, detail=None):
    """The client's total spend as a band, from the exact figure when there is one, else the "$13K total spent" text."""
    v = _dollars(client_spend)
    if v is None:
        v = _dollars(detail)
    if v is None:
        return None
    return "$0" if v <= 0 else "<$1K" if v < 1_000 else "$1K-10K" if v < 10_000 else "$10K-50K" if v < 50_000 else "$50K+"


def title_has_audit(title):
    return bool(re.search(r"audit", str(title or ""), re.I))


def parse_ladder(raw):
    """boost_bids_json -> [{rank, connects, age}] sorted by rank, or []."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return []
    out = []
    for e in data if isinstance(data, list) else []:
        try:
            out.append({"rank": int(e["rank"]), "connects": int(e["connects"]), "age": e.get("age")})
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda e: e["rank"])


def ladder_top(raw):
    """The connects of the rank-1 bid, or None."""
    for e in parse_ladder(raw):
        if e["rank"] == 1:
            return e["connects"]
    return None


def connects_bid_of(proposal):
    """The connects the owner bid: bid_amount when its currency is Connects."""
    if str(getattr(proposal, "bid_currency", "") or "").strip().lower() != "connects":
        return None
    m = re.fullmatch(r"\d+", str(getattr(proposal, "bid_amount", "") or "").strip())
    return int(m.group(0)) if m else None


def snapshot_values(job, proposal, submitted_at):
    """What the proposal should record. A time-varying value is included only if it was read before the submission."""
    sub = cal._naive_utc(submitted_at)
    out = {}
    cap = cal._naive_utc(getattr(job, "boost_bids_captured_at", None))
    if getattr(job, "boost_bids_json", None) and parse_ladder(job.boost_bids_json) and cap is not None and sub is not None and cap < sub:
        out["boost_ladder_json"] = job.boost_bids_json
        out["boost_ladder_at"] = job.boost_bids_captured_at
    # the applicants count and the client's spend are scraped by the same enrich: only a read BEFORE the submission counts
    read = cal._naive_utc(getattr(job, "enriched_at", None))
    read_before = read is not None and sub is not None and read < sub
    band = applicants_band(getattr(job, "proposals", None))
    if band and read_before:
        out["applicants_band"] = band
    bid = connects_bid_of(proposal)
    if bid is not None:
        out["connects_bid"] = bid
    sb = spend_band(getattr(job, "client_spend", None), getattr(job, "client_total_spent_detail", None))
    if sb and read_before:
        out["client_spend_band"] = sb
    out["title_has_audit"] = title_has_audit(getattr(job, "title", None))
    return out


def fill_snapshot(proposal, job, submitted_at=None):
    """Set the snapshot fields that are still empty. Returns the names it wrote."""
    wrote = []
    sub = submitted_at if submitted_at is not None else getattr(proposal, "submitted_at", None)
    for name, value in snapshot_values(job, proposal, sub).items():
        if getattr(proposal, name, None) is None:
            setattr(proposal, name, value)
            wrote.append(name)
    return wrote


# ── the Dashboard card ───────────────────────────────────────────────────────

def _row(p):
    status = p.get("status")
    return {"replied": p.get("first_reply_at") is not None or status in cal.POS, "opened": status in cal.REACHED_VIEWED}


def _dimension(key, label, order, rows, keyfn, note=None):
    groups = {k: [] for k in order}
    missing = 0
    for p in rows:
        k = keyfn(p)
        if k is None:
            missing += 1
        else:
            groups.setdefault(k, []).append(_row(p))
    cells = [cal._cell(k, v) for k, v in groups.items() if v]
    return {"key": key, "label": label, "cells": cells, "missing": missing, "note": note}


def _bid_vs_ladder(p):
    top = ladder_top(p.get("boost_ladder_json"))
    bid = p.get("connects_bid")
    if top is None or bid is None:
        return None
    return "bid at or above the ladder top" if bid >= top else "bid below the ladder top"


def dashboard(proposals):
    """proposals: iterable of dicts with status, first_reply_at and the snapshot fields."""
    rows = list(proposals)
    dims = [
        _dimension("bid_vs_ladder", "Bid vs the boost ladder's top (rank 1)", ("bid at or above the ladder top", "bid below the ladder top"), rows, _bid_vs_ladder),
        _dimension("connects_band", "Connects bid", CONNECTS_BANDS, rows, lambda p: connects_band(p.get("connects_bid"))),
        _dimension("applicants_band", "Applicants when you applied", APPLICANT_BANDS, rows, lambda p: p.get("applicants_band")),
        _dimension("client_spend_band", "Client's total spend", SPEND_BANDS, rows, lambda p: p.get("client_spend_band")),
        _dimension("title_audit", 'Title contains "audit"', ("title has audit", "no audit in title"), rows,
                   lambda p: None if p.get("title_has_audit") is None else ("title has audit" if p.get("title_has_audit") else "no audit in title")),
    ]
    return {"dimensions": dims, "n_proposals": len(rows), "min_rate_n": cal.MIN_RATE_N, "low_sample_n": cal.LOW_SAMPLE_N,
            "caption": "Among jobs you applied to. Selection bias: you chose these jobs, so this is a hint only, not a filter.",
            "definition_note": cal.DEFINITION_NOTE}


VARIANTS = ("house-style-10-11", "credential", "digit-bomb", "other")


def variants(proposals):
    """T13: opened and replied by the style variant carried onto the proposal."""
    rows = list(proposals)
    dim = _dimension("style_variant", "Letter style (from the opening)", VARIANTS, rows, lambda p: p.get("style_variant"))
    return {"dimensions": [dim], "n_proposals": len(rows), "min_rate_n": cal.MIN_RATE_N, "low_sample_n": cal.LOW_SAMPLE_N,
            "caption": "Among letters you sent. The variant is read from the opening of the letter the generator wrote; selection bias applies, hint only.",
            "definition_note": cal.DEFINITION_NOTE}
