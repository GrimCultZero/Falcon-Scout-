# -*- coding: utf-8 -*-
"""Task 9.1/9.3 (owner, 2026-11-24): api/upwork_api.py's _map_node row mapping must
never hand a list/dict straight to a String DB column. Root cause of the "feed only
updates after a restart" bug: Upwork's preferredFreelancerLocation can come back as
a list (observed live: ['Poland', 'Romania', 'Ukraine', 'Argentina', 'Brazil',
'Pakistan']), and a list handed to sqlite3 fails to bind at all, aborting the WHOLE
insert batch for that cycle (see WORKLOG.md 2026-11-24 and api/main.py's
_upsert_api_jobs, tested separately in test_focus_filter_wiring.py / test_feed_filter.py).

Pinned here, against the real _map_node (never reimplemented):
  - a list preferredFreelancerLocation is joined into a plain string, mandatory=True
  - a single-string preferredFreelancerLocation passes through unchanged
  - no preferredFreelancerLocation -> no geo_restriction at all
  - a dict value (not observed, but possible) is JSON-encoded, not passed raw

Run: .venv\\Scripts\\python tests\\test_upwork_api_mapping.py
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

import upwork_api  # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)


def node(pref_loc=None, pref_mand=False, **extra):
    return {"ciphertext": "~test123", "title": "Some Job", "description": "desc",
            "preferredFreelancerLocation": pref_loc,
            "preferredFreelancerLocationMandatory": pref_mand, **extra}


# ── _stringify_for_text_column: the normalization helper itself ────────────────
check(upwork_api._stringify_for_text_column(["Poland", "Ukraine"]) == "Poland, Ukraine",
      "a list is joined into a plain comma-separated string")
check(upwork_api._stringify_for_text_column(["United States"]) == "United States",
      "a single-element list still comes out as a plain string, not a 1-item repr")
check(upwork_api._stringify_for_text_column([]) is None, "an empty list normalizes to None, not ''")
check(upwork_api._stringify_for_text_column({"a": 1}) == '{"a": 1}', "a dict is JSON-encoded")
check(upwork_api._stringify_for_text_column("Germany") == "Germany", "a plain string passes through unchanged")
check(upwork_api._stringify_for_text_column(None) is None, "None stays None")

# ── _map_node: the real mapping, end to end ─────────────────────────────────────
r = upwork_api._map_node(node(["Poland", "Romania", "Ukraine", "Argentina", "Brazil", "Pakistan"], True))
check(r["geo_restriction"] == "Poland, Romania, Ukraine, Argentina, Brazil, Pakistan",
      f"the exact live-observed list maps to a plain joined string, not a list: {r.get('geo_restriction')!r}")
check(isinstance(r["geo_restriction"], str), "geo_restriction is always a str, never a list/dict (what a String column can bind)")

r2 = upwork_api._map_node(node("United States", True))
check(r2["geo_restriction"] == "United States", "a single mandatory country as a plain string is unaffected")

r3 = upwork_api._map_node(node(None, False))
check("geo_restriction" not in r3, "no preferred location -> no geo_restriction key at all (None values are dropped)")

r4 = upwork_api._map_node(node(["Poland", "Ukraine"], False))  # not mandatory
check("geo_restriction" not in r4 and r4.get("preferred_qualifications") == "Location: Poland, Ukraine",
      "a NON-mandatory list is a soft preference, not a geo_restriction -- and is also a plain string there")

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
