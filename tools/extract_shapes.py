# -*- coding: utf-8 -*-
"""The letter SHAPES Artem actually sends — Step 5 (playbooks) input.

analyze_letters.py already compares STYLE features (pronouns, length, claims)
between letters that started a dialogue and ones that did not. This answers a
different question: what STRUCTURES exist in the corpus at all, how often each is
used, and how each fares — so the recurring shapes can be named and turned into
playbooks instead of being re-derived by the model from 60 prohibitions each time.

A shape here is three decisions, which is what a reader can actually hold:

    opener move   →   proof style   →   offer move

Everything is classified deterministically from the letter text; nothing is sent
to an LLM (the corpus is the owner's real sent letters and costs nothing to read).

Sample-size warning, carried over from analyze_letters.py: "replied" is a small
group and "ghosted" means no reply was DETECTED, with detection partly broken for
part of the period. Counts are printed raw next to every rate for that reason; a
shape with 3 sends and 1 reply is not a 33% shape.

Run:  .\.venv\Scripts\python tools\extract_shapes.py
Out:  tools/_letter_shapes.md   (real client letters — gitignored, never commit)
"""
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "upwork_jobs.db"
OUT = ROOT / "tools" / "_letter_shapes.md"
LEDGER = ROOT / "frontend" / "src" / "lib" / "caseLedger.js"

WIN = {"replied", "hired", "interviewing"}
LOSS = {"ghosted"}
# 'sent' and 'viewed' carry no outcome signal yet — counted in totals, excluded
# from every rate, so a fresh batch can never flatter or sink a shape.
UNDECIDED = {"sent", "viewed"}


def case_names():
    """Case names straight from CASE_LEDGER so this never drifts from the ledger."""
    src = LEDGER.read_text(encoding="utf-8")
    return sorted(set(re.findall(r"name:\s*'([^']+)'", src)), key=len, reverse=True)


CASES = case_names()
CASE_RE = re.compile("|".join(re.escape(c) for c in CASES), re.I) if CASES else None

# ── paragraph classification ────────────────────────────────────────────────
SIGNOFF_RE = re.compile(r"^\s*artem\s*[.!]?\s*$", re.I)
CRED_RE = re.compile(r"\b12\s+years\b|\bgoogle\s+premier\s+partner\b", re.I)
AGENCY_RE = re.compile(r"\bit\s*force\b|\bmy\s+team\b|\b20[-\s]person\b|\bwhite[-\s]?label\b", re.I)
AUDIT_RE = re.compile(r"\baudit\b", re.I)
PLAN_RE = re.compile(r"\bseo\s+(?:promotion\s+)?plan\b|\bpromotion\s+plan\b", re.I)
LAUNCH_RE = re.compile(r"\b5\s+working\s+days\b", re.I)
RATE_RE = re.compile(r"\$\s?\d|\b\d+\s*/\s*hr\b|\bper\s+month\b", re.I)
APPROACH_RE = re.compile(
    r"\bfirst\s+thing\s+i'?d\b|\bi'?d\s+(?:check|start|map|structure|wire|look|verify|segment|audit)\b"
    r"|\bi\s+would\s+(?:check|start|map|structure)\b", re.I)
LEADIN_RE = re.compile(r"^[^.\n]{0,70}(?:results|experience|proof|work|cases|examples|highlights)[^.\n]{0,20}:\s*$", re.I)
ANSWER_LABEL_RE = re.compile(r"^(?:\d[.)]\s|[A-Z][^.\n:]{2,45}:\s)", )
LOGISTICS_RE = re.compile(r"\bnda\b|\baccess\b|\bcapacity\b|\bavailabilit|\btime\s*zone\b|\bturnaround\b", re.I)
DIAGNOSIS_HOOK_RE = re.compile(
    r"\bthe\s+real\s+problem\b|\bmost\s+\w+\s+(?:fail|don'?t|never)\b|\bthe\s+(?:issue|gap)\s+is\b"
    r"|\bwhen\s+[^.]{0,60}(?:fires|isn'?t|doesn'?t)\b", re.I)
METRIC_START_RE = re.compile(r"^\s*[+\-−]?\s?[\$€£]?\d|^\s*\d+(?:[.,]\d+)?\s*(?:%|x\b|roas)", re.I)
# "12 years running Google Ads…" also starts with a digit, and counting it as a
# metric opener put every credential lead into the metric-led bucket — 54% of the
# corpus, which was an artifact of this regex rather than a fact about the letters.
TIME_UNIT_START_RE = re.compile(r"^\s*\d+\s*\+?\s*(?:years?|yrs?|months?|weeks?|days?|hours?)\b", re.I)


def blocks(letter):
    out = []
    for p in re.split(r"\n\s*\n", letter):
        t = p.strip()
        if not t:
            continue
        if SIGNOFF_RE.match(t):
            out.append("signoff"); continue
        if CASE_RE and CASE_RE.search(t) and len(t) < 700:
            out.append("case"); continue
        if LEADIN_RE.match(t):
            out.append("case-leadin"); continue
        if LAUNCH_RE.search(t):
            out.append("offer-launch"); continue
        if PLAN_RE.search(t):
            out.append("offer-plan"); continue
        if AUDIT_RE.search(t):
            out.append("offer-audit"); continue
        if RATE_RE.search(t):
            out.append("rate"); continue
        if APPROACH_RE.search(t):
            out.append("approach"); continue
        if CRED_RE.search(t) and len(t) < 300:
            out.append("credential"); continue
        if AGENCY_RE.search(t):
            out.append("agency"); continue
        if ANSWER_LABEL_RE.match(t):
            out.append("answer"); continue
        if LOGISTICS_RE.search(t):
            out.append("logistics"); continue
        out.append("prose")
    return out


# A greeting carries no structural meaning, but it hides the move behind it
# ("hi - i see you're…", "hi Ray, thank you for the invite"), so strip it first.
# The name is only stripped when a comma or dash follows it ("hi Ray, thanks…").
# Without that guard the optional name group eats the first word of an ordinary
# sentence — "Hi. The challenge here isn't…" became "challenge here isn't…" and
# lost its classification.
GREETING_RE = re.compile(
    r"^\s*(?:hi|hello|hey)\b[\s,.\-–—]*(?:[A-Z][a-z]+\b\s*[,\-–—]\s*)?", re.I)
MIRROR_RE = re.compile(
    r"^(?:i\s+(?:see|saw|noticed)|saw|noticed)\s+(?:that\s+)?you\b"
    r"|^(?:seems|looks)\s+like\s+you\b", re.I)
# Asserting something about THEIR situation, rather than restating their ask.
# "Your non-branded traffic didn't vanish because…", "The challenge here isn't…",
# "The most common pattern I see with local service accounts…"
SECOND_PERSON_DIAG_RE = re.compile(
    r"^your\s+\w+|^you(?:'ve|\s+have|'re|\s+are)\s+(?:got|asking|running|looking|trying)\b"
    r"|^the\s+(?:challenge|problem|issue|gap|setup|most\s+common|real\s+)", re.I)
INVITE_RE = re.compile(r"^thank(?:s| you)[^.]{0,40}\binvit", re.I)
EXPERIENCE_RE = re.compile(
    r"^i(?:'ve|\s+have)?\s+(?:ran|run|rebuilt|scaled|built|managed|been\s+managing|work\s+with|worked|seen|spent)\b", re.I)


def opener_move(letter):
    paras = [p.strip() for p in re.split(r"\n\s*\n", letter.strip()) if p.strip()]
    first = paras[0] if paras else ""
    # Some letters open with a headline on its own line ("Mission Impossible",
    # "Luxury Without Compromise", a bare brand name). That is a packaging choice,
    # not the opening MOVE — the move is in the paragraph under it.
    if len(paras) > 1 and len(first) < 60 and not re.search(r"[.!?]\s*$", first):
        first = paras[1]
    if METRIC_START_RE.match(first) and not TIME_UNIT_START_RE.match(first):
        return "metric-led"
    body = GREETING_RE.sub("", first)
    head = body[:160]
    if INVITE_RE.match(body):
        return "invite-reply"
    # The single most common move in the corpus: restate the client's own
    # situation back to them before saying anything about Artem.
    if MIRROR_RE.match(body):
        return "mirror"
    if CASE_RE and CASE_RE.search(head) and re.search(r"\d", head):
        return "case-led"
    if CRED_RE.search(head[:80]) or re.match(r"i'?m\s+a\b", body, re.I):
        return "credential-led"
    if re.match(r"(?:i\s+run|we\s+are|we'?ve|it\s*force)", body, re.I) or AGENCY_RE.search(head):
        return "agency-led"
    if EXPERIENCE_RE.match(body):
        return "experience-led"
    if DIAGNOSIS_HOOK_RE.search(body) or SECOND_PERSON_DIAG_RE.match(body):
        return "diagnosis-led"
    if APPROACH_RE.search(body):
        return "approach-led"
    return "other"


def proof_style(bl):
    n = bl.count("case")
    return {0: "no cases", 1: "1 case"}.get(n, "2-3 cases" if n <= 3 else "4+ cases")


def offer_move(bl):
    for kind, label in (("offer-launch", "launch 5-day"), ("offer-plan", "SEO plan"), ("offer-audit", "audit")):
        if kind in bl:
            return label
    if "rate" in bl:
        return "rate only"
    return "no offer"


def main():
    con = sqlite3.connect(DB)
    rows = con.execute("""
        SELECT p.id, p.job_id, p.status, p.sent_text, COALESCE(j.title, '')
        FROM proposals p LEFT JOIN jobs j ON j.id = p.job_id
        WHERE p.sent_text IS NOT NULL AND length(p.sent_text) > 200
    """).fetchall()

    shapes = defaultdict(list)
    for pid, jid, status, letter, title in rows:
        bl = blocks(letter)
        key = (opener_move(letter), proof_style(bl), offer_move(bl))
        shapes[key].append({
            "pid": pid, "status": status, "title": title,
            "first": " ".join(letter.split())[:150],
            "spine": " > ".join([b for i, b in enumerate(bl) if i == 0 or b != bl[i - 1]]),
            "words": len(letter.split()),
        })

    ranked = sorted(shapes.items(), key=lambda kv: -len(kv[1]))
    total = len(rows)

    L = []
    L.append("# The letter shapes Artem actually sends\n")
    L.append(f"{total} sent letters, grouped by **opener move → proof style → offer move**.\n")
    L.append("`replied` counts replied + interviewing + hired. `open` is sent/viewed with no outcome yet and\n"
             "is excluded from the rate. Rates on fewer than ~15 decided letters are noise — read the counts.\n")
    L.append("\n| # | shape | sent | decided | replied | rate |")
    L.append("|---|-------|-----:|--------:|--------:|-----:|")
    for i, (key, items) in enumerate(ranked, 1):
        w = sum(1 for x in items if x["status"] in WIN)
        d = sum(1 for x in items if x["status"] in WIN | LOSS)
        rate = f"{100*w/d:.0f}%" if d >= 15 else ("—" if d == 0 else f"({w}/{d})")
        L.append(f"| {i} | {' → '.join(key)} | {len(items)} | {d} | {w} | {rate} |")

    # 75 combinations is too many to judge. The marginals are the judgeable part:
    # one decision at a time, every letter counted once.
    def marginal(title, pick):
        g = defaultdict(lambda: [0, 0, 0])  # sent, decided, replied
        for key, items in shapes.items():
            for x in items:
                row = g[pick(key)]
                row[0] += 1
                if x["status"] in WIN | LOSS:
                    row[1] += 1
                if x["status"] in WIN:
                    row[2] += 1
        L.append(f"\n### {title}\n")
        L.append("| | sent | decided | replied | rate |")
        L.append("|---|-----:|--------:|--------:|-----:|")
        for k, (s, d, w) in sorted(g.items(), key=lambda kv: -kv[1][0]):
            rate = f"{100*w/d:.0f}%" if d >= 15 else ("—" if d == 0 else f"({w}/{d})")
            L.append(f"| {k} | {s} | {d} | {w} | {rate} |")

    L.append("\n---\n\n## One decision at a time\n")
    marginal("Opener move", lambda k: k[0])
    marginal("Proof style", lambda k: k[1])
    marginal("Offer move", lambda k: k[2])

    L.append("\n---\n")
    for i, (key, items) in enumerate(ranked, 1):
        if len(items) < 3:
            continue
        w = sum(1 for x in items if x["status"] in WIN)
        d = sum(1 for x in items if x["status"] in WIN | LOSS)
        L.append(f"\n## {i}. {' → '.join(key)}")
        L.append(f"\n**{len(items)} letters** · {w} replied of {d} decided · median {sorted(x['words'] for x in items)[len(items)//2]} words\n")
        spine = Counter(x["spine"] for x in items).most_common(3)
        L.append("Most common spines:\n")
        for s, n in spine:
            L.append(f"- `{s}` ({n}×)")
        L.append("\nExamples:\n")
        ex = sorted(items, key=lambda x: (x["status"] not in WIN, -x["words"]))[:3]
        for x in ex:
            L.append(f"- **#{x['pid']}** [{x['status']}] *{x['title'][:70]}*  \n  > {x['first']}…\n")

    OUT.write_text("\n".join(L), encoding="utf-8")
    print(f"{total} letters -> {len(ranked)} shapes -> {OUT.relative_to(ROOT)}")
    for i, (key, items) in enumerate(ranked[:12], 1):
        w = sum(1 for x in items if x["status"] in WIN)
        d = sum(1 for x in items if x["status"] in WIN | LOSS)
        print(f"{i:>2}. {len(items):>3} letters  {w:>2}/{d:<3} replied   {' > '.join(key)}")


if __name__ == "__main__":
    main()
