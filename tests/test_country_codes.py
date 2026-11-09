# -*- coding: utf-8 -*-
"""The India leak (audit 2026-10-29, T21).

`exclude_countries` matches the NAME ("india"), but the Upwork API sometimes sends the
client's country as an ISO-3 code ("IND", "USA", "GBR", "AUS"). "ind" does not contain
"india", so 12 Indian-client jobs got through in 10 days (and 19 rows with "IND" are in the
database today). Pinned here: codes become names in _map_node, the filter matches on the
normalised name (so a stored legacy "IND" is caught too), real names are untouched, and the
backend's code list covers every code the frontend knows and every code in the database.

Run: .venv\\Scripts\\python tests\\test_country_codes.py
"""
import re
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import country_codes as cc          # noqa: E402
import upwork_api                    # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

n = cc.normalize_country
for raw, want in (("IND", "India"), ("ind", "India"), (" IND ", "India"), ("USA", "United States"), ("GBR", "United Kingdom"), ("AUS", "Australia"),
                  ("CAN", "Canada"), ("DEU", "Germany"), ("ARE", "United Arab Emirates"), ("PAK", "Pakistan"),
                  ("India", "India"), ("United States", "United States"), ("United Kingdom", "United Kingdom"), ("Pakistan", "Pakistan"),
                  ("ZZZ", "ZZZ"), ("", ""), (None, None), ("U", "U"), ("Ireland", "Ireland"), ("IRL", "Ireland")):
    check(n(raw) == want, f"normalize_country({raw!r}) -> {want!r} (got {n(raw)!r})")
check(n("Iraq") == "Iraq" and n("Chad") == "Chad", "real names that happen to be short are left alone")

# ── _map_node, the real function ────────────────────────────────────────────
def node(country):
    return {"ciphertext": "~0211000000000000001", "title": "Google Ads Specialist", "description": "x" * 50,
            "client": {"location": {"country": country}}}
check(upwork_api._map_node(node("IND"))["client_country"] == "India", "_map_node: 'IND' is stored as 'India'")
check(upwork_api._map_node(node("USA"))["client_country"] == "United States", "…'USA' as 'United States' (the 236 'USA' rows vs 758 'United States' become one value)")
check(upwork_api._map_node(node("United Kingdom"))["client_country"] == "United Kingdom", "…a name stays a name")
check("client_country" not in upwork_api._map_node(node(None)) or upwork_api._map_node(node(None)).get("client_country") is None, "…and a missing country stays missing")

# ── the filter ──────────────────────────────────────────────────────────────
CFG = {**upwork_api.load_feed_config(), "payment_verified_only": False, "max_posting_age_hours": 0}
check(CFG["exclude_countries"] == ["india"], "the live config excludes 'india'")
def reason(country):
    return upwork_api._row_passes({"title": "Google Ads Specialist", "description_full": "google ads", "client_country": country, "payment_verified": True}, CFG)
check(reason("India") == "country:india", "name 'India' is dropped (as before)")
check(reason("IND") == "country:india", "THE LEAK: code 'IND' is now dropped as India")
check(reason("ind") == "country:india", "…in any case")
for c in ("USA", "United States", "GBR", "AUS", "CAN", "PAK", "Ukraine", "UKR", "Indonesia", "IDN", None, ""):
    check(reason(c) is None, f"not excluded: {c!r}")
check(upwork_api._row_passes({"title": "Google Ads Specialist", "description_full": "google ads", "client_country": "IND", "payment_verified": True},
                             {**CFG, "exclude_countries": []}) is None, "with no exclusions configured, IND passes (the match is the config's, not hard-coded)")

# ── coverage: every code the frontend and the database use ───────────────────
for f in ("JobList.jsx", "JobDetail.jsx"):
    fe = set(re.findall(r"\b([A-Z]{3}):'", (ROOT / "frontend" / "src" / "components" / f).read_text(encoding="utf-8")))
    check(len(fe) > 100 and not (fe - set(cc.ALPHA3_TO_NAME)), f"every alpha-3 code in {f} ({len(fe)}) is known to the backend map")
check(all(re.fullmatch(r"[A-Z]{3}", k) and v for k, v in cc.ALPHA3_TO_NAME.items()), "the map is well formed (3 capital letters -> a name)")
db = ROOT / "upwork_jobs.db"
if db.exists():
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    codes = {r[0] for r in con.execute("SELECT DISTINCT client_country FROM jobs WHERE length(client_country)=3")}
    con.close()
    check(not (codes - set(cc.ALPHA3_TO_NAME)), f"every 3-letter country in the live database ({len(codes)} distinct) is known (read-only check)")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
