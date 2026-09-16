# -*- coding: utf-8 -*-
"""Structural comparison of cover letters that started a dialogue vs those that did not.

Every measure here is computed the same way for both groups, so the comparison is
like-for-like. The output is deliberately raw counts plus rates: with only 16
replies, anything presented as a clean percentage invites more confidence than
the sample can carry.

A note on the control group: "ghosted" means no response was DETECTED, and
detection was partly broken (see the export's data-quality sheet). Some ghosts
were probably viewed. That biases the control group toward looking worse than it
is, so differences found here are, if anything, understated.
"""
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "upwork_jobs.db"

WIN = {"replied", "hired", "interviewing"}
LOSS = {"ghosted"}

STOP = set("""a an the and or but if then than that this these those of in on at to for with from by as is are
was were be been being it its it's i i'm my me we our you your yours they them their he she his her have has
had do does did not no so up out about into over after before can could would should will just also more most
some any all each other new get make need want like time work working help need needed""".split())


def wordset(t):
    return {w for w in re.findall(r"[a-z][a-z0-9\-]{2,}", (t or "").lower()) if w not in STOP}


def features(letter, posting, questions):
    L = letter or ""
    low = L.lower()
    w = L.split()
    n = len(w) or 1

    # Client-facing vs self-facing pronouns. A letter that talks mostly about
    # the freelancer reads as a CV; one that talks about the client reads as a
    # plan. This is the single most repeated piece of advice in the wild, so it
    # is worth measuring rather than assuming.
    you = len(re.findall(r"\b(you|your|yours|you're)\b", low))
    me = len(re.findall(r"\b(i|i'm|i've|my|mine|me)\b", low))

    pw, lw = wordset(posting), wordset(low)
    overlap = len(pw & lw) / len(pw) if pw else 0.0

    return {
        "words": len(w),
        "questions": L.count("?"),
        "you_per_100w": round(you / n * 100, 2),
        "me_per_100w": round(me / n * 100, 2),
        "you_vs_me": round(you / me, 2) if me else None,
        # Concrete outcome numbers ("+143% revenue", "33 keywords Top 1")
        "pct_claims": len(re.findall(r"[+-]?\d[\d,\.]*\s?%", L)),
        "has_case_numbers": bool(re.search(r"[+-]?\d[\d,\.]*\s?%", L)),
        # A named, bounded first step the client can say yes to
        "offers_trial": bool(re.search(r"\b(free|no charge|no cost|trial|sample|first .{0,20}free|"
                                       r"before you commit|at no charge|on me)\b", low)),
        "offers_audit": bool(re.search(r"\baudit\b", low)),
        "mentions_price": bool(re.search(r"[$€£]\s?\d|\b\d+\s?(usd|eur|per hour|/hr|hourly)\b", low)),
        "mentions_timeline": bool(re.search(r"\b(within|by (mon|tue|wed|thu|fri|next)|turnaround|"
                                            r"\d+\s?(hours|days|weeks)|same day|this week)\b", low)),
        "asks_question": L.rstrip().endswith("?") or L.count("?") > 0,
        "posting_overlap": round(overlap, 3),
        "opens_with_i": bool(re.match(r"\s*(i|i'm|i've|my)\b", low)),
        "opens_with_you": bool(re.match(r"\s*(you|your)\b", low)),
        "has_greeting": bool(re.match(r"\s*(hi|hello|hey|dear|good (morning|afternoon))\b", low)),
        "answered_screening": bool(questions) and bool(re.search(r"\b(answers? below|in the answers|below)\b", low)),
        "first_12_words": " ".join(w[:12]),
    }


def main():
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT p.id, p.status, p.sent_text, p.sent_at, p.bid_amount,
               j.title, j.description_full, j.screening_questions,
               j.hourly_rate_min, j.hourly_rate_max, j.fixed_budget, j.bid_average
        FROM proposals p LEFT JOIN jobs j ON j.id = p.job_id
        WHERE p.sent_text IS NOT NULL AND length(p.sent_text) > 50
    """).fetchall()

    groups = {"WIN": [], "LOSS": []}
    for r in rows:
        g = "WIN" if r["status"] in WIN else ("LOSS" if r["status"] in LOSS else None)
        if not g:
            continue
        f = features(r["sent_text"], r["description_full"], r["screening_questions"])
        f["_id"] = r["id"]
        f["_title"] = r["title"]
        f["_status"] = r["status"]
        f["_bid"] = r["bid_amount"]
        f["_rate_lo"] = r["hourly_rate_min"]
        f["_rate_hi"] = r["hourly_rate_max"]
        f["_bid_avg"] = r["bid_average"]
        groups[g].append(f)

    W, L = groups["WIN"], groups["LOSS"]
    print(f"dialogue started (replied/interviewing/hired): {len(W)}")
    print(f"no response detected (ghosted):                {len(L)}")
    print()

    def avg(rs, k):
        vals = [r[k] for r in rs if isinstance(r.get(k), (int, float))]
        return sum(vals) / len(vals) if vals else 0.0

    def rate(rs, k):
        vals = [1 for r in rs if r.get(k)]
        return len(vals) / len(rs) * 100 if rs else 0.0

    NUMERIC = ["words", "questions", "you_per_100w", "me_per_100w", "pct_claims", "posting_overlap"]
    BOOLEAN = ["has_case_numbers", "offers_trial", "offers_audit", "mentions_price",
               "mentions_timeline", "asks_question", "opens_with_i", "opens_with_you",
               "has_greeting", "answered_screening"]

    print(f"{'measure':22} {'DIALOGUE':>12} {'GHOSTED':>12}   delta")
    print("-" * 64)
    for k in NUMERIC:
        a, b = avg(W, k), avg(L, k)
        d = a - b
        flag = "  <<<" if b and abs(d) / max(b, 0.01) > 0.25 else ""
        print(f"{k:22} {a:12.2f} {b:12.2f}   {d:+7.2f}{flag}")
    print()
    for k in BOOLEAN:
        a, b = rate(W, k), rate(L, k)
        d = a - b
        flag = "  <<<" if abs(d) >= 12 else ""
        print(f"{k:22} {a:11.0f}% {b:11.0f}%   {d:+6.0f}pp{flag}")

    print()
    print("=== how every dialogue letter opened ===")
    for r in sorted(W, key=lambda x: x["_id"]):
        print(f"  [{r['_status']:8}] {r['first_12_words'][:88]}")

    print()
    print("=== 12 ghosted openings, for contrast ===")
    for r in sorted(L, key=lambda x: -x["_id"])[:12]:
        print(f"  {r['first_12_words'][:88]}")

    out = ROOT / "tools" / "_letter_features.json"
    out.write_text(json.dumps({"win": W, "loss": L}, indent=1, default=str), encoding="utf-8")
    print(f"\nfeature dump: {out}")


if __name__ == "__main__":
    main()
