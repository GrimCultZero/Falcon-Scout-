# -*- coding: utf-8 -*-
"""Bid selection signals (T12) and style variants (T13), both RECORD-ONLY (audit 2026-10-29).

Pinned, with the real /proposal-submitted handler lifted from api/main.py on a scratch DB:
  * the snapshot (ladder + capture time, applicants band, connects bid, client spend band, "audit" in the title) is
    written on create AND update, only into EMPTY fields, never overwritten; a ladder or applicants count read AFTER the
    submission is NOT taken (NULL);
  * the Dashboard numbers use the Calibration card's definitions and cell rules (same functions), with n, "low sample"
    under 30 and no rate under 10;
  * the backfill: dry run writes nothing, --apply needs a recent backup, only before-submission values, only empty fields;
  * the letter's style variant is read from its opening, carried onto the proposal at submit, immutable;
  * nothing here reads like a filter: the generator never reads these columns.
The live upwork_jobs.db is never written.

Run: python tests/test_bid_signals.py
"""
import ast
import contextlib
import importlib.util
import io
import json
import re
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "tools"))

from fastapi import HTTPException                               # noqa: E402
from sqlalchemy import create_engine                            # noqa: E402
from sqlalchemy.orm import Session                              # noqa: E402
import calibration as cal                                       # noqa: E402
import bid_signals as bs                                        # noqa: E402
import generations as gen                                       # noqa: E402
from db import Base, Job, Proposal, Generation                  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

# ── bands ────────────────────────────────────────────────────────────────────
check([bs.applicants_band(x) for x in ("Less than 5", "5 to 10", "10 to 15", "15 to 20", "20 to 50", "50+", "8", "14", "30", "75", None, "", "n/a")]
      == ["<5", "5-10", "10-15", "15-20", "20-50", "50+", "5-10", "10-15", "20-50", "50+", None, None, None], "applicants text -> a canonical band (text and bare numbers)")
check([bs.connects_band(x) for x in (0, 12, 13, 20, 21, 30, 31, 99, None, "x")] == ["<=12", "<=12", "13-20", "13-20", "21-30", "21-30", "31+", "31+", None, None], "connects bands: <=12, 13-20, 21-30, 31+")
check([bs.spend_band(*a) for a in (("$0", None), ("$400", None), ("$2,324", None), ("$23,241", None), (None, "$13K total spent"), (None, "$2.3K total spent"), (None, "$1.2M total spent"), (None, None))]
      == ["$0", "<$1K", "$1K-10K", "$10K-50K", "$10K-50K", "$1K-10K", "$50K+", None], "client spend bands, from the exact figure or the 'K total spent' text")
check(bs.title_has_audit("Google Ads Audit needed") and bs.title_has_audit("PPC AUDITOR") and not bs.title_has_audit("Google Ads manager"), 'title contains "audit"')
lad = json.dumps([{"rank": 2, "connects": 26, "age": "3 hours ago"}, {"rank": 1, "connects": 35, "age": "4 hours ago"}, {"rank": 3, "connects": 23, "age": "5 hours ago"}])
check(bs.ladder_top(lad) == 35 and bs.ladder_top("[]") is None and bs.ladder_top("junk") is None and [e["rank"] for e in bs.parse_ladder(lad)] == [1, 2, 3], "the ladder top is the rank-1 connects; junk is empty")

# ── the real handler ─────────────────────────────────────────────────────────
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
fn = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "record_proposal_submitted"][0]
fn.decorator_list = []
engine = create_engine(f"sqlite:///{Path(tempfile.mkdtemp(prefix='fs_bid_')) / 'scratch.db'}")
Base.metadata.create_all(engine)
ns = {"Session": Session, "engine": engine, "Job": Job, "Proposal": Proposal, "Generation": Generation, "HTTPException": HTTPException,
      "datetime": datetime, "timezone": timezone, "_calibration": cal, "_generations": gen, "_bid_signals": bs,
      "_is_invite_response": lambda t: False, "_serialize_proposal": lambda p: {"id": p.id}, "_snapshot_job": lambda j: "{}"}
exec(compile(ast.Module(body=[fn], type_ignores=[]), "main_bid", "exec"), ns)
submit = ns["record_proposal_submitted"]

T0 = datetime(2026, 11, 14, 12, 0, 0)
def add_job(**kw):
    base = dict(title="Google Ads Audit for a Shopify store", raw_message="x", source="api", proposals="20 to 50", client_spend="$13,000",
                boost_bids_json=lad, boost_bids_captured_at=T0 - timedelta(hours=2), enriched_at=T0 - timedelta(hours=1))
    base.update(kw)
    with Session(engine) as s:
        j = Job(**base); s.add(j); s.commit(); return j.id
def body(jid, amount="30", cur="Connects", sent="Hello there, here is my letter about the store.", when=T0):
    return {"job_id": jid, "bid_amount": amount, "bid_currency": cur, "submitted_at": when.strftime("%Y-%m-%dT%H:%M:%SZ"), "sent_text": sent}
def prop(jid):
    with Session(engine) as s:
        p = s.query(Proposal).filter_by(job_id=jid).first()
        return {c.name: getattr(p, c.name) for c in Proposal.__table__.columns}

j1 = add_job()
submit(body(j1))
p1 = prop(j1)
check(json.loads(p1["boost_ladder_json"])[0]["connects"] in (35, 26, 23) and p1["boost_ladder_at"] == T0 - timedelta(hours=2), "create path: the ladder and its capture time are snapshotted")
check(p1["applicants_band"] == "20-50" and p1["connects_bid"] == 30 and p1["client_spend_band"] == "$10K-50K" and p1["title_has_audit"] is True, "applicants band, connects bid, client spend band and 'audit' are snapshotted")
# the job is re-read later: new ladder, new applicants count. A second submit (update path) must not overwrite.
with Session(engine) as s:
    j = s.get(Job, j1); j.boost_bids_json = json.dumps([{"rank": 1, "connects": 99, "age": "1 minute ago"}]); j.boost_bids_captured_at = T0 + timedelta(hours=1)
    j.proposals = "50+"; j.enriched_at = T0 + timedelta(hours=1); s.commit()
submit(body(j1, amount="45", when=T0 + timedelta(hours=2)))
p1b = prop(j1)
check(p1b["boost_ladder_json"] == p1["boost_ladder_json"] and p1b["applicants_band"] == "20-50" and p1b["connects_bid"] == 30, "update path: snapshots are immutable once set (a later re-read changes nothing)")

# a ladder / applicants count read AFTER the submission is not taken
j2 = add_job(boost_bids_captured_at=T0 + timedelta(minutes=30), enriched_at=T0 + timedelta(minutes=30))
submit(body(j2))
p2 = prop(j2)
check(p2["boost_ladder_json"] is None and p2["boost_ladder_at"] is None and p2["applicants_band"] is None, "a ladder and an applicants count read AFTER the submission stay NULL")
check(p2["connects_bid"] == 30 and p2["title_has_audit"] is True, "values that do not change with time (connects bid, audit in the title) are still recorded")
check(p2["client_spend_band"] is None, "the client spend band, read after the submission, stays NULL too")
j3 = add_job(boost_bids_json=None, boost_bids_captured_at=None, proposals=None, client_spend=None, title="Google Ads manager")
submit(body(j3, amount="120", cur="USD"))
p3 = prop(j3)
check(all(p3[k] is None for k in ("boost_ladder_json", "applicants_band", "connects_bid", "client_spend_band")) and p3["title_has_audit"] is False, "no ladder, no band, a USD bid: those stay NULL; title_has_audit is False")
# an empty field is filled later (update path), a set one never is
j4 = add_job(proposals=None, enriched_at=None, boost_bids_json=None, boost_bids_captured_at=None)
submit(body(j4))
check(prop(j4)["applicants_band"] is None, "applicants unknown at first submit -> NULL")
with Session(engine) as s:
    j = s.get(Job, j4); j.proposals = "10 to 15"; j.enriched_at = T0 - timedelta(minutes=5); s.commit()
submit(body(j4))
check(prop(j4)["applicants_band"] == "10-15", "an EMPTY field is filled by a later submit, if the value was read before the submission")

# ── the Dashboard numbers: same method as the Calibration card ───────────────
def P(status, **kw):
    d = {"status": status, "first_reply_at": None, "boost_ladder_json": lad, "connects_bid": 40, "applicants_band": "20-50", "client_spend_band": "$1K-10K", "title_has_audit": False}
    d.update(kw)
    return d
rows = ([P("replied", connects_bid=40)] * 4 + [P("viewed", connects_bid=40)] * 3 + [P("sent", connects_bid=40)] * 3 + [P("ghosted", connects_bid=20)] * 12
        + [P("declined", connects_bid=20, first_reply_at=datetime(2026, 11, 2))] * 2)
d = bs.dashboard(rows)
dim = {x["key"]: x for x in d["dimensions"]}
above = [c for c in dim["bid_vs_ladder"]["cells"] if c["key"].startswith("bid at or above")][0]
below = [c for c in dim["bid_vs_ladder"]["cells"] if c["key"].startswith("bid below")][0]
check(above["n"] == 10 and above["replied"] == 4 and above["opened"] == 7 and above["reply_rate"] == 40.0 and above["open_rate"] == 70.0, "bid at/above the ladder top (35): n=10, reply 4/10, open 7/10")
check(below["n"] == 14 and below["replied"] == 2, "bid below the ladder top: a declined proposal with a recorded reply counts as a reply, never as opened")
check(below["opened"] == 0, "declined and ghosted are not opened (the Calibration card's rule)")
cb = {c["key"]: c for c in dim["connects_band"]["cells"]}
check(set(cb) == {"31+", "13-20"} and cb["31+"]["n"] == 10 and cb["13-20"]["n"] == 14, "connects bands <=12 / 13-20 / 21-30 / 31+")
check(dim["bid_vs_ladder"]["missing"] == 0 and bs.dashboard([P("sent", boost_ladder_json=None)])["dimensions"][0]["missing"] == 1, "proposals with no ladder snapshot are counted as 'without this snapshot', never guessed")
eq = bs.dashboard([P("replied", connects_bid=35)] * 10)["dimensions"][0]["cells"]
check(len(eq) == 1 and eq[0]["key"].startswith("bid at or above"), "a bid exactly EQUAL to the ladder top counts as at or above")
tiny = bs.dashboard([P("replied")] * 9)["dimensions"][2]["cells"][0]
check(tiny["n"] == 9 and tiny["reply_rate"] is None and tiny["open_rate"] is None and tiny["low_sample"] is True, "n = 9: no rate shown")
mid = bs.dashboard([P("replied")] * 12 + [P("sent")] * 12)["dimensions"][2]["cells"][0]
check(mid["n"] == 24 and mid["reply_rate"] == 50.0 and mid["low_sample"] is True, "n = 24: a rate, marked low sample (under 30)")
big = bs.dashboard([P("replied")] * 30)["dimensions"][2]["cells"][0]
check(big["low_sample"] is False, "n = 30 is not a low sample")
check(d["caption"].startswith("Among jobs you applied to.") and "selection bias" in d["caption"].lower() and "hint only" in d["caption"], "caption: among jobs you applied to; selection bias, hint only")
check(d["definition_note"] == cal.DEFINITION_NOTE and "first_reply_at" in d["definition_note"], "the footnote prints the Calibration card's own open and reply definitions")
# same method as the Calibration card: the totals agree on the same proposals
snap = json.dumps({"verdict": "APPLY", "score": 8, "snapshot_analysis_at": "2026-11-01T10:00:00"})
cal_total = cal.calibrate([{"analysis_json": snap, "status": r["status"], "first_reply_at": r["first_reply_at"]} for r in rows])["regimes"][0]["total"]
bs_total = [sum(c[k] for c in dim["applicants_band"]["cells"]) for k in ("n", "replied", "opened")]
check(bs_total == [cal_total["n"], cal_total["replied"], cal_total["opened"]], "totals match the Calibration card on the same proposals (n, replied, opened)")
au = {c["key"]: c for c in bs.dashboard([P("replied", title_has_audit=True)] * 3 + [P("sent", title_has_audit=False)] * 2)["dimensions"][4]["cells"]}
check(au["title has audit"]["n"] == 3 and au["no audit in title"]["n"] == 2, 'title has "audit" / not')
check(len(d["dimensions"]) == 5 and [x["key"] for x in d["dimensions"]] == ["bid_vs_ladder", "connects_band", "applicants_band", "client_spend_band", "title_audit"], "the five dimensions the owner asked for")

# ── the backfill tool ────────────────────────────────────────────────────────
spec = importlib.util.spec_from_file_location("bf_bid", ROOT / "tools" / "backfill_bid_signals.py")
bf = importlib.util.module_from_spec(spec); spec.loader.exec_module(bf)
tdb = Path(tempfile.mkdtemp(prefix="fs_bfbid_")) / "x.db"
e2 = create_engine(f"sqlite:///{tdb}"); Base.metadata.create_all(e2)
with Session(e2) as s:
    def mk(job_kw, sub, **pkw):
        jb = dict(title="Google Ads Audit", raw_message="x", source="api"); jb.update(job_kw)
        j = Job(**jb); s.add(j); s.flush()
        s.add(Proposal(job_id=j.id, sent_text="x", status="sent", sent_at=T0, status_updated_at=T0, submitted_at=sub, bid_amount="30", bid_currency="Connects", **pkw)); s.flush()
    mk(dict(boost_bids_json=lad, boost_bids_captured_at=T0 - timedelta(hours=1), proposals="20 to 50", enriched_at=T0 - timedelta(hours=1), client_spend="$500"), T0)      # all before
    mk(dict(boost_bids_json=lad, boost_bids_captured_at=T0 + timedelta(hours=1), proposals="50+", enriched_at=T0 + timedelta(hours=1), client_spend="$500"), T0)          # ladder + band AFTER
    mk(dict(boost_bids_json=lad, boost_bids_captured_at=T0 - timedelta(hours=1), proposals="20 to 50", enriched_at=T0 - timedelta(hours=1)), T0, applicants_band="<5")     # band already set
    s.commit()
def prow(i):
    c = sqlite3.connect(tdb); r = c.execute("SELECT boost_ladder_json, boost_ladder_at, applicants_band, connects_bid, client_spend_band, title_has_audit FROM proposals WHERE id=?", (i,)).fetchone(); c.close(); return r
before = [prow(i) for i in (1, 2, 3)]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    rc = bf.main([], db=tdb)
check(rc == 0 and [prow(i) for i in (1, 2, 3)] == before and "DRY RUN" in buf.getvalue(), "the backfill is a DRY RUN by default and writes nothing")
empty = Path(tempfile.mkdtemp(prefix="fs_nobk_"))
with contextlib.redirect_stdout(buf):
    rc = bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
check(rc == 1 and [prow(i) for i in (1, 2, 3)] == before, "--apply REFUSES without a recent backup")
old = empty / "upwork_jobs-20260101-0000.db"; old.write_bytes(b"x"); t_old = time.time() - 7200; import os; os.utime(old, (t_old, t_old))
with contextlib.redirect_stdout(buf):
    rc = bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
check(rc == 1 and [prow(i) for i in (1, 2, 3)] == before, "--apply REFUSES when the newest backup is older than 60 minutes")
(empty / "upwork_jobs-20260102-0000.db").write_bytes(b"x")
with contextlib.redirect_stdout(buf):
    rc = bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
r1, r2, r3 = prow(1), prow(2), prow(3)
check(rc == 0 and r1[0] and r1[2] == "20-50" and r1[3] == 30 and r1[4] == "<$1K" and r1[5] == 1, "--apply with a fresh backup fills a proposal whose job data predates the submission")
check(r2[0] is None and r2[1] is None and r2[2] is None and r2[4] is None and r2[3] == 30 and r2[5] == 1, "a ladder, an applicants band and a spend band read AFTER the submission stay NULL; the connects bid and the audit flag are filled")
check(r3[2] == "<5" and r3[0], "an already-set field is never overwritten")
with contextlib.redirect_stdout(buf):
    bf.main(["--apply", "--backup-dir", str(empty)], db=tdb)
check([prow(i) for i in (1, 2, 3)] == [r1, r2, r3], "running it twice changes nothing")

# ── T13: the style variant ───────────────────────────────────────────────────
HOUSE = ("I can run this diagnostic audit for NuShape. A drop like that is almost always a structural or policy break, not a gradual decline: "
         "a Merchant Center suspension, a mass product disapproval, a broken conversion tag that starved Performance Max.\n\n12 years running Google Ads.")
CRED = "12 years running Google Ads, Google Premier Partner 2026. Your shop sells serums and I have run feed-based PMax for similar stores with a $5 CPC cap and $100/day budget."
BOMB = "+693.8% revenue and 17.51 PMax ROAS for Skin Reboot, a skincare brand, on feed-based Performance Max.\n\nI can do the same for you."
BOMB2 = "I ran a luxury perfume e-commerce site to +79% traffic and +143% revenue, and took a YMYL brand from 357 users a month."
OTHER = "I see you're running PPC for several verticals and need someone who can own the full account."
check([gen.classify_variant(x) for x in (HOUSE, CRED, BOMB, BOMB2, OTHER, "", None)] == ["house-style-10-11", "credential", "digit-bomb", "digit-bomb", "other", "other", "other"],
      "the variant is read from the opening: house style, credential, digit bomb, other (a credential with money figures is still a credential)")
check(gen.classify_variant("12 years running Google Ads for vape shops, ecommerce and local services, Google Premier Partner 2026.") == "credential", "12 years next to a case-like word (vape shops) is a credential, not a Digit Bomb")
check(gen.classify_variant("Hi Sam,\n\n" + CRED) == "credential" and gen.classify_variant("Mission Impossible\n\n" + HOUSE) == "house-style-10-11", "a greeting or a headline line above the opening does not change the variant")
check(gen.with_variant({"style_variant": "digit-bomb"}, OTHER)["style_variant"] == "digit-bomb" and gen.with_variant({"style_variant": None}, HOUSE)["style_variant"] == "house-style-10-11", "a Digit Bomb written by T22 wins; otherwise the opening decides")
# agreement with the 10-07 shapes study classifier (tools/extract_shapes.py)
sp = importlib.util.spec_from_file_location("shapes", ROOT / "tools" / "extract_shapes.py")
shapes = importlib.util.module_from_spec(sp); sp.loader.exec_module(shapes)
check(shapes.opener_move(CRED) == "credential-led" and shapes.opener_move(BOMB) in ("metric-led", "case-led") and shapes.opener_move(OTHER) == "mirror",
      "the shapes-study classifier reads the same fixtures the same way (credential-led, metric / case-led, mirror)")

def gen_row(jid, text, ts):
    with Session(engine) as s:
        g = Generation(job_id=jid, kind="generate", text=text, style_variant=gen.classify_variant(text), ts=ts); s.add(g); s.commit(); return g.id
j5 = add_job(title="Google Ads manager")
gen_row(j5, HOUSE, T0 - timedelta(hours=1))
submit(body(j5, sent=HOUSE.replace("NuShape", "the shop") + " Thanks."))
check(prop(j5)["style_variant"] == "house-style-10-11", "T13: the generation's variant is carried onto the proposal at submit")
gen_row(j5, CRED, T0 - timedelta(minutes=10))
submit(body(j5, sent=CRED))
check(prop(j5)["style_variant"] == "house-style-10-11", "T13: immutable once set (a later regeneration does not change it)")
j6 = add_job(title="Google Ads manager")
submit(body(j6, sent="A letter written without the generator, long enough to count as a real sent text."))
check(prop(j6)["style_variant"] is None, "T13: no recorded generation -> the proposal's variant stays NULL")
v = bs.variants([{"status": "replied", "first_reply_at": None, "style_variant": "house-style-10-11"}] * 12 + [{"status": "sent", "first_reply_at": None, "style_variant": "credential"}] * 5)
vc = {c["key"]: c for c in v["dimensions"][0]["cells"]}
check(vc["house-style-10-11"]["n"] == 12 and vc["house-style-10-11"]["reply_rate"] == 100.0 and vc["house-style-10-11"]["low_sample"] and vc["credential"]["reply_rate"] is None, "opened / replied by variant with n; low sample under 30; no rate under 10")

# ── columns migrate onto a copy of the real DB (read-only source) ────────────
live = ROOT / "upwork_jobs.db"
if live.exists():
    fnm = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_ensure_job_columns"][0]
    tmp = Path(tempfile.mkdtemp(prefix="fs_mig_")) / "copy.db"
    a = sqlite3.connect(f"file:{live}?mode=ro", uri=True); b = sqlite3.connect(tmp); a.backup(b); a.close(); b.close()
    mns = {"engine": create_engine(f"sqlite:///{tmp}")}
    exec(compile(ast.Module(body=[fnm], type_ignores=[]), "main_mig", "exec"), mns)
    mns["_ensure_job_columns"](); mns["_ensure_job_columns"]()
    cols = {r[1] for r in sqlite3.connect(tmp).execute("PRAGMA table_info(proposals)")}
    check({"boost_ladder_json", "boost_ladder_at", "applicants_band", "connects_bid", "client_spend_band", "title_has_audit", "style_variant"} <= cols, "the migration adds every new proposals column to a copy of the real DB (twice: idempotent)")

# ── record-only: the generator never reads these columns ─────────────────────
names = ("boost_ladder_json", "boost_ladder_at", "applicants_band", "connects_bid", "client_spend_band", "title_has_audit", "style_variant", "bid_signals", "_bid_signals")
users = set()
for f in [n for n in ast.walk(ast.parse(src)) if isinstance(n, ast.FunctionDef)]:
    for n in ast.walk(f):
        if (isinstance(n, ast.Attribute) and n.attr in names) or (isinstance(n, ast.Name) and n.id in names):
            users.add(f.name)
check(users <= {"record_proposal_submitted", "bid_signals_card", "style_variants_card", "_ensure_job_columns"}, f"in api/main.py only the submit handler, the two cards and the migration touch them (found: {sorted(users)})")
jd = (ROOT / "frontend" / "src" / "components" / "JobDetail.jsx").read_text(encoding="utf-8")
check(not re.search(r"boost_ladder_json|applicants_band|connects_bid|client_spend_band|title_has_audit|/bid-signals|/style-variants", jd), "JobDetail.jsx (the generator) never reads the snapshot columns or the cards' endpoints")
sys.path.insert(0, str(ROOT / "api"))
import upwork_api                                               # noqa: E402
check(upwork_api.DEFAULT_FEED_CONFIG.get("dim_applicants_50plus") is False and "dim_applicants_50plus" in upwork_api.DEFAULT_FEED_CONFIG, "the 50+ dim setting is OFF by default (and is a saved key: only default keys survive a save)")
check(not any("dim_applicants" in str(x) for x in (upwork_api._row_passes.__code__.co_names, upwork_api._apply_filter.__code__.co_names)), "the dim setting is not read by the feed filter: it can never remove a job")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
