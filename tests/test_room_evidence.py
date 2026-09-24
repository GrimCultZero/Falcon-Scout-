# -*- coding: utf-8 -*-
"""Room walk v5 — resolver tests against the REAL database (read-only).

The resolver functions are lifted out of api/main.py at runtime via `ast`, so
this cannot drift from what ships, and api/main.py is never imported (importing
it builds the FastAPI app and touches the DB engine).

What matters here is not "does it match" but "does it refuse to match when the
evidence is weak or contradictory". A false match promotes the wrong proposal
to 'replied' — and, after the un-ghost fix, can do so for a ghosted one — which
corrupts exactly the outcome data the analysis depends on.

Run:  python tests/test_room_evidence.py
"""
import ast
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "upwork_jobs.db"
if not DB.exists():
    print("SKIP  upwork_jobs.db not present (it is not in the repo)")
    sys.exit(0)

# ── lift the shipped helpers ────────────────────────────────────────────────
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
WANT = {"_ROOM_TITLE_MIN_LEN", "_build_room_index", "_resolve_room_evidence"}
nodes = []
for n in tree.body:
    if isinstance(n, ast.FunctionDef) and n.name in WANT:
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT for t in n.targets):
        nodes.append(n)
got = {getattr(n, "name", None) or n.targets[0].id for n in nodes}
if got != WANT:
    print(f"FAIL  could not lift {sorted(WANT - got)} from api/main.py — renamed or moved?")
    sys.exit(1)
ns = {}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "api/main.py", "exec"), ns)
build, resolve, MIN_LEN = ns["_build_room_index"], ns["_resolve_room_evidence"], ns["_ROOM_TITLE_MIN_LEN"]

# ── the same index the endpoint builds ──────────────────────────────────────
c = sqlite3.connect(str(DB))
counts = {}
for (t,) in c.execute("select title from jobs"):
    if t and t.strip():
        k = t.strip().lower()
        counts[k] = counts.get(k, 0) + 1
pairs = c.execute("""select p.id, p.upwork_proposal_id, j.upwork_job_id, j.title
                     from proposals p join jobs j on j.id = p.job_id""").fetchall()
idx = build(pairs, counts)

def pid_for(title):
    r = c.execute("""select p.id, p.upwork_proposal_id, j.upwork_job_id from proposals p
                     join jobs j on j.id = p.job_id where lower(trim(j.title)) = lower(?)""",
                  (title,)).fetchone()
    return r

MYKOLA_T = "PPC Specialist (Google Ads) – Part-Time, Ongoing"   # proposal 222
BYRON_T = "White Label SEO Agency To Manage Multiple Clients SEO"  # proposal 248
m_id, m_up, m_job = pid_for(MYKOLA_T)
b_id, b_up, _ = pid_for(BYRON_T)

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")

# ── exact keys ──────────────────────────────────────────────────────────────
r = resolve({"room_proposal_ids": [m_up]}, idx)
check(r[:2] == (m_id, "room_proposal_id"), f"proposal id {m_up} -> proposal {m_id} via room_proposal_id  (got {r})")

r = resolve({"room_job_ids": ["~" + m_job.lstrip("~")]}, idx)
check(r[:2] == (m_id, "room_job_id"), f"job id (with ~) -> proposal {m_id} via room_job_id  (got {r})")

r = resolve({"room_titles": [MYKOLA_T]}, idx)
check(r[:2] == (m_id, "room_title"), f"exact unique title -> proposal {m_id} via room_title  (got {r})")

r = resolve({"room_titles": [MYKOLA_T.lower()]}, idx)
check(r[0] == m_id, "title match is case-insensitive")

r = resolve({"room_titles": ["3:51 PM local time", "Artem Yatsuk", BYRON_T, "Relevant campaign:"]}, idx)
check(r[:2] == (b_id, "room_title"), f"junk lines around the real title are ignored -> proposal {b_id}  (got {r})")

# Agreement: the same proposal via two paths is still ONE proposal, and the
# strongest path is reported.
r = resolve({"room_proposal_ids": [m_up], "room_titles": [MYKOLA_T]}, idx)
check(r[:2] == (m_id, "room_proposal_id"), f"id + title agreeing -> matched, strongest path reported  (got {r})")

# ── refusals — the part that protects the data ─────────────────────────────
r = resolve({"room_proposal_ids": [m_up], "room_titles": [BYRON_T]}, idx)
check(r[0] is None and set(r[2]) == {m_id, b_id},
      f"contradictory evidence (222's id + Byron's title) -> NO match, both reported  (got {r})")

generic = [(t, n) for t, n in counts.items() if n >= 2 and len(t) >= MIN_LEN]
if generic:
    t, n = sorted(generic, key=lambda x: -x[1])[0]
    r = resolve({"room_titles": [t]}, idx)
    check(r[0] is None, f"a title shared by {n} jobs ({t[:40]!r}) is refused even though it is long enough")
else:
    print("SKIP  no long duplicated title in this DB to test the uniqueness guard with")

short = [t for t, n in counts.items() if n == 1 and len(t) < MIN_LEN]
with_prop = [t for t in short if len(idx["by_title"].get(t, ())) == 1]
if with_prop:
    r = resolve({"room_titles": [with_prop[0]]}, idx)
    check(r[0] is None, f"a unique but short title ({with_prop[0]!r}, <{MIN_LEN} chars) is refused")

r = resolve({"room_titles": ["Google Ads Specialist"]}, idx)
check(r[0] is None, "the DB's most common title, 'Google Ads Specialist', never matches")

r = resolve({"room_proposal_ids": ["1234567890123456789"], "room_job_ids": ["~0199999999999999999"]}, idx)
check(r == (None, None, []), f"unknown ids -> no match, nothing ambiguous  (got {r})")

r = resolve({}, idx)
check(r == (None, None, []), "a row with no room evidence (skipped / old extension) -> no match")

r = resolve({"room_titles": [None, 42, ""]}, idx)
check(r[0] is None, "malformed title entries are ignored rather than crashing")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
