# -*- coding: utf-8 -*-
"""Instrument health, backend half (audit 2026-10-29, T6).

Two multi-day blackouts went unnoticed because nothing watched the instruments.
GET /health now gives one verdict per instrument. Pinned here:

  * tools/health_report.py: every threshold, both sides of each boundary, with a
    FAKE clock (no waiting three days to see the "no messages walk" alarm);
  * the T5 follow-ups: the proposals item uses header_count / coverage, and a
    latest run that read 0 rows is flagged (amber when it is only a hand-opened
    page, red when the scraper started and saw nothing);
  * the real _health_inputs / health handler lifted out of api/main.py (that file
    is never imported by tests) and run on a scratch SQLite file: the live
    upwork_jobs.db is never opened. Acceptance from the brief: faking an old
    sync_runs.ts, or a stopped bridge, turns the item red.

Run: .venv\\Scripts\\python tests\\test_health_report.py
"""
import ast
import asyncio
import json as _json_mod
import sys
import tempfile
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import health_report as hr                                  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

NOW = datetime(2026, 11, 8, 12, 0, 0)          # naive UTC, like every DB timestamp
def ago(**kw):
    return NOW - timedelta(**kw)

GOOD_RUN = {"id": 10, "ts": ago(hours=1), "rows_scraped": 87, "header_count": 87, "coverage": 1.0, "stage": None}
def inputs(**over):
    base = {
        "feed": {"last_insert": ago(minutes=5), "auto_fetch_minutes": 5, "connected": True},
        "proposals": {"last_run": GOOD_RUN, "last_good": GOOD_RUN, "zero_row_runs_24h": 0},
        "messages": {"last_run_ts": ago(hours=1), "walks_24h": 5, "rooms_visited_24h": 3},
        "passive": {"last_at": ago(hours=3)},
        "backup": {"last_backup_at": "2026-11-08T08:00", "age_hours": 4.0, "last_error": None, "dir": "C:\\b"},
        "bridge": {"provider": "cli", "up": True, "port": 27184},
    }
    base.update(over)
    return base
def rep(hour=12, **over):
    return hr.build_report(inputs(**over), NOW, hour)
def lvl(report, key):
    return report["items"][key]["level"]

# ── all healthy ─────────────────────────────────────────────────────────────
r = rep()
check(r["overall"] == "ok" and r["problems"] == [], "everything fine -> overall ok, no problems")
check({"feed", "proposals_sync", "messages_sync", "backup", "bridge", "passive_read", "rooms_visited"} == set(r["items"]),
      "the report has every instrument the brief lists (feed, proposals, messages, passive read, rooms, backup, bridge + provider)")
check(r["items"]["bridge"]["provider"] == "cli", "the provider is reported")

# ── feed: > 30 min amber, > 120 min red, only 07-23 local ───────────────────
for mins, want in ((5, "ok"), (30, "ok"), (31, "amber"), (120, "amber"), (121, "red"), (600, "red")):
    check(lvl(rep(feed={"last_insert": ago(minutes=mins), "auto_fetch_minutes": 5, "connected": True}), "feed") == want, f"feed {mins} min old at noon -> {want}")
quiet = {"last_insert": ago(hours=10), "auto_fetch_minutes": 5, "connected": True}
check(lvl(rep(hour=3, feed=quiet), "feed") == "ok", "feed 10 h old at 03:00 -> ok (not judged at night)")
check(lvl(rep(hour=6, feed=quiet), "feed") == "ok" and lvl(rep(hour=7, feed=quiet), "feed") == "red", "the watch window opens at 07:00 sharp")
check(lvl(rep(hour=22, feed=quiet), "feed") == "red" and lvl(rep(hour=23, feed=quiet), "feed") == "ok", "…and closes at 23:00")
check(lvl(rep(feed={"last_insert": None, "auto_fetch_minutes": 5, "connected": True}), "feed") == "red", "no API job ever -> red")
check(lvl(rep(feed={"last_insert": ago(hours=9), "auto_fetch_minutes": 0, "connected": True}), "feed") == "info", "auto-fetch switched off -> info, not an alarm")
check(lvl(rep(feed={"last_insert": ago(minutes=5), "auto_fetch_minutes": 5, "connected": False}), "feed") == "red", "Upwork API not connected -> red, even with a fresh job")
it = rep(feed={"last_insert": ago(minutes=5), "auto_fetch_minutes": 5, "connected": False})["items"]["feed"]
check(it["connected"] is False and it["age_minutes"] == 5.0, "…and the item carries connected=False and the real age, so the pill can name the cause")

# ── proposals sync: age, header_count/coverage, 0-row flag ──────────────────
def prop(good=None, last=None, zero24=0):
    return {"last_run": last if last is not None else good, "last_good": good, "zero_row_runs_24h": zero24}
def run(hours=1, rows=87, hdr=87, cov=1.0, stage=None, rid=10):
    return {"id": rid, "ts": ago(hours=hours), "rows_scraped": rows, "header_count": hdr, "coverage": cov, "stage": stage}
for h, want in ((1, "ok"), (6, "ok"), (6.5, "amber"), (24, "amber"), (25, "red")):
    check(lvl(rep(proposals=prop(run(hours=h))), "proposals_sync") == want, f"last good sync {h} h ago -> {want}")
for cov, rows, want in ((1.0, 87, "ok"), (0.95, 83, "ok"), (0.94, 82, "amber"), (0.8, 70, "amber"), (0.79, 69, "red"), (0.2111, 19, "red")):
    it = rep(proposals=prop(run(rows=rows, hdr=87, cov=cov)))["items"]["proposals_sync"]
    check(it["level"] == want, f"coverage {cov} ({rows} of 87) -> {want}")
it = rep(proposals=prop(run(rows=19, hdr=90, cov=0.2111)))["items"]["proposals_sync"]
check("19 of 90" in it["reason"] and it["coverage"] == 0.2111 and it["header_count"] == 90, "run 554's 19 of 90 is spelled out, using header_count and coverage")
it = rep(proposals=prop(run(cov=None, hdr=None)))["items"]["proposals_sync"]
check(it["level"] == "ok" and "not recorded" in it["reason"], "a run without coverage (pre-T5) is judged on age alone and says so")
check(lvl(rep(proposals={"last_run": None, "last_good": None, "zero_row_runs_24h": 0}), "proposals_sync") == "red", "no sync ever -> red")

# the flag asked for in T6: a run that reads 0 rows
good = run(hours=2, rid=10)
hand = {"id": 11, "ts": ago(minutes=20), "rows_scraped": 0, "header_count": None, "coverage": None, "stage": "gate-declined"}
it = rep(proposals=prop(good, last=hand, zero24=1))["items"]["proposals_sync"]
check(it["level"] == "amber" and it["last_run_zero_rows"] is True and "not a failure" in it["reason"],
      "latest run read 0 rows because the page was opened by hand (gate-declined) -> amber, and says it is not a failure")
real = {"id": 12, "ts": ago(minutes=20), "rows_scraped": 0, "header_count": None, "coverage": None, "stage": "no-rows"}
it = rep(proposals=prop(good, last=real, zero24=1))["items"]["proposals_sync"]
check(it["level"] == "red" and "read 0 rows" in it["reason"] and "no-rows" in it["reason"], "latest run read 0 rows (stage no-rows) -> red, with the stage")
nostage = {"id": 13, "ts": ago(minutes=5), "rows_scraped": 0, "header_count": None, "coverage": None, "stage": None}
check(lvl(rep(proposals=prop(good, last=nostage)), "proposals_sync") == "red", "a 0-row run with no recorded stage -> red")
# a 0-row run that a later good run has replaced no longer alarms, but is still counted
later_good = run(hours=0.2, rid=14)
old_zero = {"id": 13, "ts": ago(hours=1), "rows_scraped": 0, "header_count": None, "coverage": None, "stage": "no-rows"}
it = rep(proposals=prop(later_good, last=later_good, zero24=1))["items"]["proposals_sync"]
check(it["level"] == "ok" and it["last_run_zero_rows"] is False and "1 empty run(s)" in it["reason"],
      "an empty run followed by a good one -> ok, with the empty run still mentioned")
check(rep(proposals=prop(None, last=real))["items"]["proposals_sync"]["level"] == "red", "only ever empty runs -> red")

# ── messages sync: > 3 days red ─────────────────────────────────────────────
for h, want in ((2, "ok"), (24, "ok"), (25, "amber"), (72, "amber"), (73, "red")):
    check(lvl(rep(messages={"last_run_ts": ago(hours=h), "walks_24h": 0, "rooms_visited_24h": 0}), "messages_sync") == want, f"last inbox walk {h} h ago -> {want}")
check(lvl(rep(messages={"last_run_ts": None, "walks_24h": 0, "rooms_visited_24h": 0}), "messages_sync") == "red", "no inbox walk ever -> red")

# ── backup ──────────────────────────────────────────────────────────────────
def bk(**kw):
    d = {"last_backup_at": "2026-11-08T08:00", "age_hours": 4.0, "last_error": None, "dir": "C:\\b"}
    d.update(kw); return d
for h, want in ((4, "ok"), (30, "ok"), (31, "amber"), (48, "amber"), (49, "red")):
    check(lvl(rep(backup=bk(age_hours=h)), "backup") == want, f"backup {h} h old -> {want}")
check(lvl(rep(backup=bk(last_error="disk full")), "backup") == "red", "failed backup -> red")
check(lvl(rep(backup=bk(last_backup_at=None, age_hours=None)), "backup") == "red", "no backup file -> red")

# ── bridge + provider ───────────────────────────────────────────────────────
check(lvl(rep(bridge={"provider": "cli", "up": True, "port": 27184}), "bridge") == "ok", "CLI provider, bridge up -> ok")
check(lvl(rep(bridge={"provider": "cli", "up": False, "port": 27184}), "bridge") == "red", "CLI provider, bridge stopped -> RED (acceptance)")
check(lvl(rep(bridge={"provider": "api", "up": False, "port": 27184}), "bridge") == "info", "API provider, bridge stopped -> info: it is not needed")
check(lvl(rep(bridge={"provider": "cli", "up": False, "port": None, "error": "CLI_BRIDGE_PORT must be a whole number"}), "bridge") == "red", "CLI provider with an unusable port setting -> red")
check(lvl(rep(bridge={"provider": "api", "up": False, "port": None, "error": "x"}), "bridge") == "info", "…but only info if the API is the provider")

# ── info items never alarm ──────────────────────────────────────────────────
r = rep(passive={"last_at": ago(days=30)}, messages={"last_run_ts": ago(hours=1), "walks_24h": 0, "rooms_visited_24h": 0})
check(lvl(r, "passive_read") == "info" and lvl(r, "rooms_visited") == "info" and r["overall"] == "ok", "a 30-day-old passive read and 0 rooms visited do not raise an alarm")
check(rep(passive={"last_at": None})["items"]["passive_read"]["level"] == "info", "no passive read on record -> info")
check(r["items"]["rooms_visited"]["rooms_visited_24h"] == 0 and r["items"]["rooms_visited"]["walks_24h"] == 0, "rooms visited and walks in 24 h are reported as numbers")

# ── overall and error handling ──────────────────────────────────────────────
r = rep(feed={"last_insert": ago(minutes=45), "auto_fetch_minutes": 5, "connected": True}, backup=bk(age_hours=60))
check(r["overall"] == "red" and set(r["problems"]) == {"feed", "backup"}, "overall is the worst item; problems lists the amber/red ones")
r = rep(feed={"error": "OperationalError: database is locked"})
check(lvl(r, "feed") == "amber" and "database is locked" in r["items"]["feed"]["reason"] and r["overall"] == "amber",
      "an instrument whose data cannot be read is amber with the error, not a crashed endpoint")
check(hr.build_report({}, NOW, 12)["overall"] in ("amber", "red"), "an empty input does not crash and does not look healthy")

# ── the real handler, on a scratch DB ───────────────────────────────────────
from sqlalchemy import create_engine                         # noqa: E402
from sqlalchemy.orm import Session                           # noqa: E402
from db import Base, Job, SyncRun                            # noqa: E402

src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
tree = ast.parse(src)
WANT_FUNCS = {"_health_module", "_scroll_dict", "_health_inputs", "health"}
WANT_VARS = {"_health_mod", "_PASSIVE_DEBUG_FILE"}
nodes = []
for n in tree.body:
    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in WANT_FUNCS:
        n.decorator_list = []
        nodes.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t, "id", None) in WANT_VARS for t in n.targets):
        nodes.append(n)
got = {getattr(n, "name", None) or n.targets[0].id for n in nodes}
if got != (WANT_FUNCS | WANT_VARS):
    print(f"FAIL  could not lift the health handler from api/main.py (missing {sorted((WANT_FUNCS | WANT_VARS) - got)})")
    sys.exit(1)

tmp = Path(tempfile.mkdtemp(prefix="fs_health_"))
engine = create_engine(f"sqlite:///{tmp / 'scratch.db'}")
Base.metadata.create_all(engine)

fake_upwork_api = types.ModuleType("upwork_api")
fake_upwork_api.load_feed_config = lambda: {"auto_fetch_minutes": 5}
fake_upwork_api.is_connected = lambda: True
sys.modules["upwork_api"] = fake_upwork_api

state = {"provider": "cli", "up": True, "port_error": None}
async def fake_ping():
    return state["up"]
def fake_port():
    if state["port_error"]:
        raise ValueError(state["port_error"])
    return 49999
backup_stub = types.SimpleNamespace(backup_status=lambda: {"last_backup_at": "2026-11-08T08:00", "age_hours": 3.0, "last_error": None, "dir": "C:\\b"})

ns = {"Session": Session, "engine": engine, "Job": Job, "SyncRun": SyncRun, "datetime": datetime, "timedelta": timedelta,
      "timezone": timezone, "_json_mod": _json_mod, "ROOT": ROOT, "Path": Path,
      "_backup_module": lambda: backup_stub, "_get_ai_provider": lambda: state["provider"],
      "_ping_cli_bridge": fake_ping, "_bridge_port": fake_port}
exec(compile(ast.Module(body=nodes, type_ignores=[]), "main_health", "exec"), ns)
ns["_PASSIVE_DEBUG_FILE"] = tmp / "messages_passive_debug.json"      # never the real file

def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)
def call_health():
    return asyncio.run(ns["health"]())
def add(session, leg, ts, rows, **kw):
    session.add(SyncRun(leg=leg, ts=ts, rows_scraped=rows, matched=rows, not_matched=0, newly_viewed=0, **kw))

with Session(engine) as s:
    n = utcnow()
    s.add(Job(title="fresh", upwork_job_id="~aaaa", raw_message="x", source="api", captured_at=n - timedelta(minutes=2)))
    s.add(Job(title="old bot", upwork_job_id="~bbbb", raw_message="x", source="bot", captured_at=n - timedelta(minutes=1)))
    add(s, "proposals-list", n - timedelta(minutes=30), 87, header_count=87, coverage=1.0)
    add(s, "messages-list", n - timedelta(hours=1), 20, scroll_json=_json_mod.dumps({"rooms_visited": 4}))
    add(s, "messages-list", n - timedelta(hours=2), 20, scroll_json=_json_mod.dumps({"rooms_visited": 3}))
    add(s, "messages-list", n - timedelta(hours=30), 20, scroll_json=_json_mod.dumps({"rooms_visited": 9}))
    s.commit()
(tmp / "messages_passive_debug.json").write_text(_json_mod.dumps({"at": (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()}), encoding="utf-8")

hour_now = datetime.now().hour
r = call_health()
check(r["items"]["proposals_sync"]["level"] == "ok" and r["items"]["proposals_sync"]["coverage"] == 1.0 and r["items"]["proposals_sync"]["header_count"] == 87,
      "handler: a fresh sync with coverage 1.0 reads ok, from the T5 columns")
check(r["items"]["feed"]["level"] == "ok" or not (7 <= hour_now < 23), "handler: a 2-minute-old API job reads ok")
check(r["items"]["feed"].get("age_minutes", 99) < 5, "handler: the feed age comes from the newest source='api' job, not the newer 'bot' one")
check(r["items"]["messages_sync"]["level"] == "ok", "handler: messages walk 1 h ago -> ok")
check(r["items"]["rooms_visited"]["rooms_visited_24h"] == 7 and r["items"]["rooms_visited"]["walks_24h"] == 2,
      "handler: rooms_visited counts the last 24 h only (4 + 3, not the 9 from 30 h ago)")
check(r["items"]["passive_read"]["age_minutes"] is not None and 290 < r["items"]["passive_read"]["age_minutes"] < 310, "handler: last passive read comes from the debug file (5 h ago)")
check(r["items"]["bridge"]["level"] == "ok" and r["items"]["bridge"]["port"] == 49999, "handler: bridge up -> ok")

# acceptance 1: stop the bridge
state["up"] = False
r = call_health()
check(r["items"]["bridge"]["level"] == "red" and "bridge" in r["problems"] and r["overall"] == "red", "ACCEPTANCE: stopping the bridge turns it red on the very next call")
state["up"] = True
state["port_error"] = "CLI_BRIDGE_PORT must be a whole number, got \"abc\""
r = call_health()
check(r["items"]["bridge"]["level"] == "red" and "whole number" in r["items"]["bridge"]["reason"], "handler: an unusable bridge port is reported, not hidden")
state["port_error"] = None
state["provider"] = "api"; state["up"] = False
check(call_health()["items"]["bridge"]["level"] == "info", "handler: API provider with no bridge -> info")
state["provider"] = "cli"; state["up"] = True

# acceptance 2: fake an old sync_runs.ts
with Session(engine) as s:
    s.query(SyncRun).filter(SyncRun.leg == "proposals-list").update({SyncRun.ts: utcnow() - timedelta(hours=30)})
    s.commit()
r = call_health()
check(r["items"]["proposals_sync"]["level"] == "red" and "proposals_sync" in r["problems"], "ACCEPTANCE: a proposals sync_runs row faked 30 h old turns the item red")
with Session(engine) as s:
    s.query(SyncRun).filter(SyncRun.leg == "messages-list").update({SyncRun.ts: utcnow() - timedelta(days=4)})
    s.commit()
r = call_health()
check(r["items"]["messages_sync"]["level"] == "red", "ACCEPTANCE: the inbox walks faked 4 days old turn it red")

# a 0-row run, as the extension logs one when the page is opened by hand
with Session(engine) as s:
    n = utcnow()
    add(s, "proposals-list", n - timedelta(hours=1), 87, header_count=87, coverage=1.0)
    add(s, "proposals-list", n - timedelta(minutes=2), 0, scroll_json=_json_mod.dumps({"failed": True, "stage": "gate-declined"}))
    s.commit()
r = call_health()
it = r["items"]["proposals_sync"]
check(it["level"] == "amber" and it["last_run_zero_rows"] is True and "gate-declined" in it["reason"] and it["zero_row_runs_24h"] == 1,
      "handler: a 0-row run reads its stage from scroll_json and is flagged amber")
with Session(engine) as s:
    add(s, "proposals-list", utcnow() - timedelta(minutes=1), 0, scroll_json=_json_mod.dumps({"failed": True, "stage": "no-rows"}))
    s.commit()
check(call_health()["items"]["proposals_sync"]["level"] == "red", "handler: a real failure stage (no-rows) is red")
with Session(engine) as s:
    add(s, "proposals-list", utcnow(), 87, header_count=87, coverage=1.0)
    s.commit()
check(call_health()["items"]["proposals_sync"]["level"] == "ok", "handler: the next good sync clears the flag")

# robustness: a broken source degrades one item, not the endpoint
ns["_PASSIVE_DEBUG_FILE"] = tmp / "bad.json"
(tmp / "bad.json").write_text("{not json", encoding="utf-8")
r = call_health()
check(r["items"]["passive_read"]["level"] == "amber" and "could not read" in r["items"]["passive_read"]["reason"] and r["items"]["feed"]["level"] in ("ok", "amber", "red"),
      "handler: an unreadable passive-read file degrades that item only")
ns["_backup_module"] = lambda: (_ for _ in ()).throw(RuntimeError("backup folder offline"))
r = call_health()
check(r["items"]["backup"]["level"] == "amber" and "backup folder offline" in r["items"]["backup"]["reason"], "handler: a backup module error degrades that item only")

# wiring in the shipped file
check('@app.get("/health")' in src and "tools\" / \"health_report.py\"" in src.replace("'", '"'), "main.py serves GET /health from tools/health_report.py")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
