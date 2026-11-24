# -*- coding: utf-8 -*-
"""Metro Phase 0 foundation (METRO_PLAN.md steps 4, 6, 7), on a SCRATCH database.

Pinned:
  * the router is mounted by exactly one line in api/main.py, and no other Metro code is there
    or in JobDetail.jsx; nothing in api/metro imports api/main.py;
  * all eleven metro_* tables are created with the model's columns; a column added to a model
    later is added by migrate(); init is idempotent;
  * the jobs and proposals tables are byte-for-byte the same schema before and after Metro init;
  * safe defaults: test mode on for email and LinkedIn, week mode "metro", scrape cap 60, max 80;
  * suppression: normalize() per kind; a CSV import adds, a re-import adds nothing, nothing is
    deleted; dry run writes nothing; the Upwork-clients import reads proposals (read only), adds
    one upwork_job entry per proposal and domains only from engaged proposals, never platforms;
  * the /metro routes answer through FastAPI's TestClient.
The live upwork_jobs.db is never opened.

Run: python tests/metro/test_metro_foundation.py
"""
import io
import json
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from fastapi import FastAPI                     # noqa: E402
from fastapi.testclient import TestClient      # noqa: E402
from sqlalchemy import Column, String, create_engine, text   # noqa: E402
from sqlalchemy.orm import Session             # noqa: E402

bad = 0


def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


# ── boundaries (static) ───────────────────────────────────────────────────────
main_src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
metro_lines = [ln for ln in main_src.splitlines() if re.search(r"\bmetro\b", ln, re.I)]
check(len(metro_lines) == 1 and "include_router(_metro_router)" in metro_lines[0],
      f"api/main.py has exactly one Metro line, the mount (found {len(metro_lines)})")
jd = (ROOT / "frontend" / "src" / "components" / "JobDetail.jsx").read_text(encoding="utf-8")
check(not re.search(r"metro", jd, re.I), "JobDetail.jsx has no Metro code")
for f in (ROOT / "api" / "metro").glob("*.py"):
    src = f.read_text(encoding="utf-8")
    check(not re.search(r"^\s*(from\s+(api\.)?main\s+import|import\s+(api\.)?main\b)", src, re.M),
          f"api/metro/{f.name} does not import api/main.py")

# ── scratch DB with the real jobs/proposals schema ───────────────────────────
tmp = Path(tempfile.mkdtemp(prefix="metro-test-"))
db_path = tmp / "scratch.db"
eng = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
import db as app_db                             # noqa: E402  (the app's models: jobs, proposals, ...)
app_db.Base.metadata.create_all(eng)


def schema(table):
    c = sqlite3.connect(db_path)
    try:
        return c.execute("SELECT sql FROM sqlite_master WHERE name = ?", (table,)).fetchone(), \
            c.execute(f"PRAGMA table_info({table})").fetchall()
    finally:
        c.close()


before = {t: schema(t) for t in ("jobs", "proposals")}

from metro import db as mdb                     # noqa: E402
from metro import suppression as sup            # noqa: E402

mdb.set_engine(eng)
mdb.init_db(eng)                                # twice: idempotent
names = {r[0] for r in sqlite3.connect(db_path).execute("SELECT name FROM sqlite_master WHERE type='table'")}
expected = {"metro_campaigns", "metro_companies", "metro_leads", "metro_hooks", "metro_touches", "metro_senders",
            "metro_send_log", "metro_replies", "metro_suppression", "metro_case_links", "metro_settings"}
check(expected <= names, f"all 11 metro tables exist (missing: {sorted(expected - names)})")
# Phase 1 adds two: the import audit and the Upwork-derived suppression candidates (METRO_HANDOFF, Phase 1).
check(set(mdb.METRO_TABLES) == expected | {"metro_imports", "metro_suppression_candidates"},
      "METRO_TABLES lists the 11 plan tables plus metro_imports and metro_suppression_candidates")
check({t: schema(t) for t in ("jobs", "proposals")} == before, "jobs and proposals schemas unchanged by Metro init")

# migrate() adds a column a model gained later, only on metro_ tables
mdb.MetroCompany.__table__.append_column(Column("zz_new_col", String, nullable=True))
done = mdb.migrate(eng)
cols = {r[1] for r in sqlite3.connect(db_path).execute("PRAGMA table_info(metro_companies)")}
check("zz_new_col" in cols and len(done) == 1 and "metro_companies" in done[0], "migrate() adds a missing model column")
check(mdb.migrate(eng) == [], "migrate() is a no-op once up to date")
mdb.MetroCompany.__table__._columns.remove(mdb.MetroCompany.__table__.c.zz_new_col)
check({t: schema(t) for t in ("jobs", "proposals")} == before, "jobs and proposals schemas still unchanged after migrate")

with Session(eng) as s:
    st = mdb.read_settings(s)
check(st.get("email_test_mode") is True and st.get("linkedin_test_mode") is True, "test mode defaults ON for email and LinkedIn")
check(st.get("week_mode") == "metro" and st.get("scrape_cap_per_day") == 60 and st.get("scrape_cap_max") == 80,
      "week mode metro, scrape cap 60/day, max 80")

# ── suppression ──────────────────────────────────────────────────────────────
N = sup.normalize
for kind, raw, want in [
    ("member_id", " 922552010 ", "922552010"), ("member_id", "abc", None),
    ("email", " Jane.Doe@Example.COM ", "jane.doe@example.com"), ("email", "nope", None),
    ("profile_url", "https://www.linkedin.com/in/Jane-Doe-12/?trk=x", "linkedin.com/in/jane-doe-12"),
    ("profile_url", "https://example.com/in/x", None),
    ("domain", "https://WWW.Acme-Clinic.com/about?x=1", "acme-clinic.com"), ("domain", "localhost", None),
    ("company", "  Acme   Clinic, LLC ", "acme clinic"), ("upwork_job", "~021234abcd", "021234abcd"),
]:
    check(N(kind, raw) == want, f"normalize({kind}, {raw!r}) -> {want!r}")

csv_text = "member_id,src\n111,US invited, not accepted\n222,\"US invited, not accepted\"\n222,dup in file\nxyz,bad\n"
entries, used = sup.entries_from_csv(csv_text, default_reason="listed")
check(used == ["member_id"], "member_id column recognised")
with Session(eng) as s:
    r = sup.add_entries(s, entries, source="t.csv", dry_run=True)
    check(r.added == 2 and r.already == 1 and r.invalid == 1, f"dry run counts (got {r.as_dict()})")
    check(sup.stats(s)["total"] == 0, "dry run writes nothing")
    r = sup.add_entries(s, entries, source="t.csv")
    check(r.added == 2, "apply adds the 2 valid ids")
    r = sup.add_entries(s, entries, source="t.csv")
    check(r.added == 0 and r.already == 3, "re-import adds nothing")
    check(sup.stats(s)["total"] == 2, "nothing deleted, 2 entries")
    row = s.query(mdb.MetroSuppression).filter_by(value="222").one()
    check(row.scope == "person" and row.reason == "US invited, not accepted", "scope person, reason from the src column")

mixed = "Company Name,Website,Email,LinkedIn URL\nAcme Clinic LLC,https://acme-clinic.com,ceo@acme-clinic.com,https://linkedin.com/in/ceo-acme\n"
entries, used = sup.entries_from_csv(mixed, default_reason="IT Force client")
check(used == ["Company Name", "Email", "LinkedIn URL", "Website"], f"client-list columns recognised (got {used})")
with Session(eng) as s:
    sup.add_entries(s, entries, source="clients.csv")
    hits = sup.is_suppressed(s, email="someone.else@acme-clinic.com")
    check(any(h["kind"] == "domain" for h in hits), "an address at a suppressed domain is suppressed")
    check(sup.is_suppressed(s, profile_url="https://www.linkedin.com/in/CEO-acme/") != [], "profile URL matches however written")
    check(sup.is_suppressed(s, member_id="999") == [], "an unknown member id is not suppressed")

# Upwork clients from proposals (read only)
with Session(eng) as s:
    s.add_all([
        app_db.Job(id=1, raw_message="", title="Google Ads for clinic", upwork_job_id="~01aaa", client_country="United States",
                   description_full="Our site is www.smile-dental.com, ads like google.com"),
        app_db.Job(id=2, raw_message="", title="SEO audit", upwork_job_id="~01bbb", client_country="Germany",
                   description_full="see brand-x.de"),
    ])
    s.flush()
    s.add_all([
        app_db.Proposal(id=1, job_id=1, sent_text="x", status="replied", client_reply_text="Thanks! Reach me at team@smile-dental.com"),
        app_db.Proposal(id=2, job_id=2, sent_text="y", status="ghosted"),
    ])
    s.commit()
    before_rows = s.execute(text("SELECT * FROM proposals ORDER BY id")).fetchall()
    entries = sup.entries_from_proposals(s)
    kinds = sorted((e["kind"], sup.normalize(e["kind"], e["value"])) for e in entries)
    check(("upwork_job", "01aaa") in kinds and ("upwork_job", "01bbb") in kinds, "one upwork_job entry per proposal")
    check(("domain", "smile-dental.com") in kinds, "domain named by an engaged client is taken")
    check(("domain", "google.com") not in kinds, "platform domains are never taken")
    check(("domain", "brand-x.de") not in kinds, "domains from non-engaged (ghosted) proposals are not taken")
    r1 = sup.add_entries(s, entries, source="proposals")
    r2 = sup.add_entries(s, sup.entries_from_proposals(s), source="proposals")
    check(r1.added >= 3 and r2.added == 0, f"proposals import idempotent ({r1.added} then {r2.added})")
    check(s.execute(text("SELECT * FROM proposals ORDER BY id")).fetchall() == before_rows, "proposals rows unchanged")

# ── routes ───────────────────────────────────────────────────────────────────
from metro.router import router                 # noqa: E402
app = FastAPI()
app.include_router(router)
c = TestClient(app)
h = c.get("/metro/health").json()
check(h["ok"] is True and h["missing"] == [] and len(h["tables"]) == 13, "GET /metro/health ok, 13 tables")
check(c.get("/metro/settings").json()["email_test_mode"] is True, "GET /metro/settings")
total0 = c.get("/metro/suppression/stats").json()["total"]
up = c.post("/metro/suppression/import", files={"file": ("ids.csv", io.BytesIO(b"member_id\n333\n444\n"), "text/csv")})
check(up.status_code == 200 and up.json()["dry_run"] is True and up.json()["added"] == 2, "import is a dry run by default")
check(c.get("/metro/suppression/stats").json()["total"] == total0, "dry-run upload wrote nothing")
up = c.post("/metro/suppression/import?dry_run=false", files={"file": ("ids.csv", io.BytesIO(b"member_id\n333\n444\n"), "text/csv")})
check(up.json()["added"] == 2 and c.get("/metro/suppression/stats").json()["total"] == total0 + 2, "apply upload writes")
bad_up = c.post("/metro/suppression/import", files={"file": ("x.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")})
check(bad_up.status_code == 400, "a CSV with no recognised column is refused")
check(c.post("/metro/suppression/import-proposals").json()["dry_run"] is True, "proposals import is a dry run by default")

# The real 1,818-id file, when present locally (it is lead data: gitignored, absent in CI).
real = ROOT / "Claude outputs" / "already_contacted_member_ids.csv"
if real.exists():
    entries, used = sup.entries_from_csv(real.read_text(encoding="utf-8-sig"), default_reason="already contacted")
    vals = {sup.normalize("member_id", e["value"]) for e in entries}
    check(used == ["member_id"] and None not in vals, f"real file: every row is a valid member id ({len(entries)} rows, {len(vals)} distinct)")
else:
    print("SKIP  real already_contacted_member_ids.csv not present")

eng.dispose()
print(f"\n{'all passed' if not bad else str(bad) + ' FAILED'}")
sys.exit(1 if bad else 0)
