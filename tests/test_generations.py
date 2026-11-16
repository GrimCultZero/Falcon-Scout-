# -*- coding: utf-8 -*-
"""Generated drafts and the owner's edits (audit 2026-10-29, T10). RECORD-ONLY.

Acceptance, run through the REAL handlers lifted from api/main.py on a scratch DB:
generate -> edit -> submit -> the generations row shows a sensible edit_ratio.
Also pinned: a row per generate / rescan / chat; the latest generation BEFORE the submission is
the one linked (a later regeneration is not); no meaningless 1.0 from a bare submit notice;
whitespace is not an edit; the weekly median / under-10% share with n and "low sample" under 30;
and nothing that builds a letter reads the generations table.
The live upwork_jobs.db is never opened.

Run: python tests/test_generations.py
"""
import ast
import json
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from fastapi import HTTPException                               # noqa: E402
from sqlalchemy import create_engine                            # noqa: E402
from sqlalchemy.orm import Session                              # noqa: E402
import calibration as cal                                       # noqa: E402
import generations as gen                                       # noqa: E402
from db import Base, Job, Proposal, Generation                  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

LETTER = ("Hi Sam, I read your post about the Google Ads account that stopped converting in March. "
          "I would start by checking the conversion tracking, then the search terms report, then the budget split. "
          "I have fixed the same pattern for two dental clinics. Can you share the last 30 days of data?")

# ── the ratio ────────────────────────────────────────────────────────────────
check(gen.edit_ratio(LETTER, LETTER) == 0.0, "sent exactly as generated -> edit ratio 0")
check(gen.edit_ratio(LETTER, LETTER.replace(" ", "  ").replace(". ", ".\r\n\r\n")) == 0.0, "whitespace and line-ending differences are not edits")
small = gen.edit_ratio(LETTER, LETTER.replace("Hi Sam", "Hello Sam"))
check(0 < small < 0.05, f"one word changed -> a small ratio ({small})")
half = gen.edit_ratio(LETTER, LETTER[: len(LETTER) // 2] + " Totally different second half about website redesign and branding services we offer to many clients.")
check(0.3 < half < 0.8, f"half rewritten -> a middling ratio ({half})")
check(gen.edit_ratio(LETTER, "Completely unrelated words here.") > 0.8, "an unrelated letter -> a ratio near 1")
check(gen.edit_ratio("", LETTER) is None and gen.edit_ratio(LETTER, "") is None and gen.edit_ratio(LETTER, "(submitted via Upwork)") is None, "no draft, no sent text, or the bare-notice placeholder -> no ratio (never a meaningless 1.0)")
check(gen.clean_kind("rescan") == "rescan" and gen.clean_kind("chat") == "chat" and gen.clean_kind("junk") == "generate" and gen.clean_kind(None) == "generate", "kinds are generate / rescan / chat; anything else is 'generate'")
check(json.loads(gen.clean_checks(["a", "", " b "])) == ["a", "b"] and gen.clean_checks("x") == "[]", "fired_checks is stored as a JSON list")

# ── the real handlers on a scratch DB ────────────────────────────────────────
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
body = ast.parse(src).body
def lift(name):
    f = [n for n in body if isinstance(n, ast.FunctionDef) and n.name == name][0]
    f.decorator_list = []
    return f
engine = create_engine(f"sqlite:///{Path(tempfile.mkdtemp(prefix='fs_gen_')) / 'scratch.db'}")
Base.metadata.create_all(engine)
ns = {"Session": Session, "engine": engine, "Job": Job, "Proposal": Proposal, "Generation": Generation, "HTTPException": HTTPException,
      "datetime": datetime, "timezone": timezone, "_calibration": cal, "_generations": gen, "_is_invite_response": lambda t: False,
      "_serialize_proposal": lambda p: {"id": p.id}, "_snapshot_job": lambda j: "{}", "_get_ai_provider": lambda: "cli"}
exec(compile(ast.Module(body=[lift("record_generation"), lift("record_proposal_submitted"), lift("generation_stats")], type_ignores=[]), "main_gen", "exec"), ns)
record, submit, stats = ns["record_generation"], ns["record_proposal_submitted"], ns["generation_stats"]

def add_job():
    with Session(engine) as s:
        j = Job(title="t", raw_message="x", source="api"); s.add(j); s.commit(); return j.id
def set_ts(gid, when):
    with Session(engine) as s:
        g = s.get(Generation, gid); g.ts = when; s.commit()
def row(gid):
    with Session(engine) as s:
        g = s.get(Generation, gid)
        return {c.name: getattr(g, c.name) for c in Generation.__table__.columns}
T0 = datetime(2026, 11, 14, 12, 0, 0)
def body_for(jid, text, when):
    d = {"job_id": jid, "bid_amount": "10", "bid_currency": "USD", "submitted_at": when.strftime("%Y-%m-%dT%H:%M:%SZ")}
    if text is not None:
        d["sent_text"] = text
    return d

j = add_job()
g1 = record({"job_id": j, "kind": "generate", "model": "claude-sonnet-4-5", "text": LETTER, "fired_checks": ["a", "b"]})["id"]
r = row(g1)
check(r["kind"] == "generate" and r["model"] == "claude-sonnet-4-5" and r["provider"] == "cli" and r["text"] == LETTER and json.loads(r["fired_checks"]) == ["a", "b"], "a generation row stores kind, model, the server's provider, text and fired checks")
check(r["digit_bomb_case"] is None and r["style_variant"] is None and r["proposal_id"] is None and r["edit_ratio"] is None, "digit_bomb_case and style_variant stay NULL (T13 / T22); nothing is linked yet")
g2 = record({"job_id": j, "kind": "rescan", "text": LETTER + " (rescanned)"})["id"]
g3 = record({"job_id": j, "kind": "chat", "text": LETTER.replace("Hi Sam", "Hello Sam")})["id"]
check({row(g2)["kind"], row(g3)["kind"]} == {"rescan", "chat"}, "rescan and chat rewrites are recorded as their own kinds")
for g, when in ((g1, T0 - timedelta(hours=3)), (g2, T0 - timedelta(hours=2)), (g3, T0 - timedelta(hours=1))):
    set_ts(g, when)
for bad_body in ({"job_id": j, "text": ""}, {"text": "x"}, {"job_id": 99999, "text": "x"}):
    try:
        record(bad_body); check(False, f"bad body rejected: {bad_body}")
    except HTTPException as e:
        check(e.status_code in (400, 404), f"bad body rejected ({e.status_code}): {list(bad_body)}")

# generate -> edit -> submit
edited = LETTER.replace("Hi Sam", "Hello Sam").replace("Can you share", "Could you send me")
g4 = record({"job_id": j, "kind": "generate", "text": LETTER + " LATER"})["id"]                    # regenerated AFTER sending
set_ts(g4, T0 + timedelta(hours=5))
submit(body_for(j, edited, T0))
linked = [row(g) for g in (g1, g2, g3, g4)]
check([x["proposal_id"] is not None for x in linked] == [False, False, True, False], "the latest generation BEFORE the submission is linked; an earlier one and a later regeneration are not")
check(linked[2]["edit_ratio"] is not None and 0.0 < linked[2]["edit_ratio"] < 0.12, f"ACCEPTANCE: generate, edit, submit -> a sensible edit_ratio ({linked[2]['edit_ratio']})")
submit(body_for(j, LETTER.replace("Hi Sam", "Hello Sam"), T0))                                       # the same proposal, sent text corrected
check(row(g3)["edit_ratio"] == 0.0 and row(g1)["proposal_id"] is None, "re-submitting recomputes against the current sent text, still one linked generation")

j2 = add_job()
g5 = record({"job_id": j2, "kind": "generate", "text": LETTER})["id"]
set_ts(g5, T0 - timedelta(hours=1))
submit(body_for(j2, None, T0))
check(row(g5)["proposal_id"] is None and row(g5)["edit_ratio"] is None, "a bare submit notice (no scraped text) does not link a meaningless ratio")
j3 = add_job()
submit(body_for(j3, edited, T0))
with Session(engine) as s:
    check(s.query(Proposal).filter_by(job_id=j3).count() == 1 and s.query(Generation).filter_by(job_id=j3).count() == 0, "a job with no recorded generation still submits normally, nothing linked")
j4 = add_job()
g6 = record({"job_id": j4, "kind": "generate", "text": LETTER})["id"]
set_ts(g6, T0 - timedelta(hours=1))
submit(body_for(j4, None, T0))                                                                        # create path, no text
submit(body_for(j4, LETTER, T0))                                                                      # later notice with the text, update path
check(row(g6)["edit_ratio"] == 0.0, "create then update: the ratio appears once the sent text is captured")

# ── T22: the auto Digit Bomb is recorded with the letter ─────────────────────
jb = add_job()
gb = record({"job_id": jb, "kind": "generate", "text": LETTER, "digit_bomb_case": "skin-reboot", "digit_bomb_score": 100, "style_variant": "digit-bomb"})["id"]
rb = row(gb)
check(rb["digit_bomb_case"] == "skin-reboot" and rb["digit_bomb_score"] == 100 and rb["style_variant"] == "digit-bomb", "T22: an auto-bomb letter stores the case id, the match score and style_variant 'digit-bomb'")
gh = record({"job_id": jb, "kind": "generate", "text": LETTER + " by hand", "digit_bomb_case": "fridgefix"})["id"]
rh = row(gh)
check(rh["digit_bomb_case"] == "fridgefix" and rh["digit_bomb_score"] is None and rh["style_variant"] == "digit-bomb", "a bomb armed by hand: case id and variant, no score")
gn = record({"job_id": jb, "kind": "generate", "text": LETTER + " plain"})["id"]
rn = row(gn)
check(rn["digit_bomb_case"] is None and rn["digit_bomb_score"] is None and rn["style_variant"] is None, "a letter with no bomb leaves all three NULL")
gj = record({"job_id": jb, "kind": "generate", "text": LETTER + " junk", "digit_bomb_case": "", "digit_bomb_score": "abc", "style_variant": "x"})["id"]
check(row(gj)["digit_bomb_case"] is None and row(gj)["style_variant"] is None, "no case id -> no variant either (junk is ignored)")
check(gen.clean_bomb({"digit_bomb_case": "atlant", "digit_bomb_score": "93"})["digit_bomb_score"] == 93, "the score is stored as a whole number")

# ── the card's numbers ───────────────────────────────────────────────────────
rows = [(datetime(2026, 11, 10, 9), 0.05)] * 3 + [(datetime(2026, 11, 11, 9), 0.30)] * 2 + [(datetime(2026, 11, 17, 9), 0.0)]
st = gen.weekly_stats(rows)
w = {c["key"]: c for c in st["weeks"]}
check(set(w) == {"2026-W46", "2026-W47"} and w["2026-W46"]["n"] == 5 and w["2026-W46"]["median_edit_ratio"] == 0.05, "median edit ratio per ISO week of the submission, with n")
check(w["2026-W46"]["under10_n"] == 3 and w["2026-W46"]["under10_share"] == 60.0 and w["2026-W47"]["under10_share"] == 100.0, "share sent with under 10% edits")
check(all(c["low_sample"] for c in st["weeks"]) and st["all"]["n"] == 6, "n < 30 is a low sample")
big = gen.weekly_stats([(datetime(2026, 11, 10), 0.2)] * 30)
check(big["all"]["low_sample"] is False and big["all"]["n"] == 30, "n >= 30 is not a low sample")
check(gen.weekly_stats([])["all"]["n"] == 0 and gen.weekly_stats([])["weeks"] == [], "no data -> an empty card, no crash")
live = stats()
check(live["all"]["n"] == 2, f"the real /generations/stats reads the linked rows only (n={live['all']['n']})")

# ── record-only: nothing that builds a letter reads the table ────────────────
fn = [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef)]
users = set()
for f in fn:
    for n in ast.walk(f):
        if (isinstance(n, ast.Name) and n.id in ("Generation", "_generations")):
            users.add(f.name)
check(users <= {"record_generation", "record_proposal_submitted", "generation_stats"}, f"in api/main.py only the record / submit / stats handlers touch generations (found: {sorted(users)})")
others = [p.name for p in (ROOT / "api").glob("*.py") if p.name not in ("main.py", "generations.py", "db.py") and re.search(r"\bGeneration\b|\bgenerations\b", p.read_text(encoding="utf-8"))]
check(not others, f"no other backend module reads it (found: {others})")
jd = (ROOT / "frontend" / "src" / "components" / "JobDetail.jsx").read_text(encoding="utf-8")
reads = re.findall(r"fetch\('/generations[^']*'(?:,\s*\{[^}]*\})?", jd)
check(reads and all("POST" in r for r in reads), f"the generator only WRITES /generations (POST); it never fetches it ({len(reads)} call)")
check(len(re.findall(r"_recordGeneration\(", jd)) == 3, "exactly three hooks: the function itself is defined once, called from generate/rescan and from the chat rewrite")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
