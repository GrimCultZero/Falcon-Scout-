# -*- coding: utf-8 -*-
"""The catch-up fetch saves as it goes, and the newest page comes first.

Owner, 2026-11-09: "it started to load very long ... a long time waiting before the
feed will receive any new messages", only at startup. After a launch that follows a
gap of an hour or more, the feed loop runs a deep catch-up: every keyword (36), paging
back up to 8 pages each, one request after another. Nothing was saved until the last
keyword finished, so the feed sat empty for about 3 minutes 45 seconds (the first 131
jobs of that run all landed in one minute). Now the normal newest-page fetch runs
first, and the deep pass hands rows over after each keyword.

Run: .venv\\Scripts\\python tests\\test_feed_catchup_incremental.py
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

import upwork_api  # noqa: E402

bad = 0


def assert_(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(f"{'PASS' if ok else 'FAIL'}  {msg}")


# Three keywords; two pages each. The 'beta' keyword repeats one job from 'alpha'.
PAGES = {
    ("alpha", "0"): [{"upwork_job_id": "a1", "title": "Google Ads A1"}, {"upwork_job_id": "a2", "title": "Google Ads A2"}],
    ("alpha", "2"): [{"upwork_job_id": "a3", "title": "Google Ads A3"}],
    ("beta", "0"): [{"upwork_job_id": "a2", "title": "Google Ads A2"}, {"upwork_job_id": "b1", "title": "Google Ads B1"}],
    ("beta", "2"): [],
    ("gamma", "0"): [{"upwork_job_id": "g1", "title": "Google Ads G1"}, {"upwork_job_id": "g2", "title": "Google Ads G2"}],
    ("gamma", "2"): [{"upwork_job_id": "g3", "title": "Google Ads G3"}],
}
CFG = {"keywords": ["alpha", "beta", "gamma"], "per_keyword_limit": 2, "max_posting_age_hours": 0, "stop_words": []}
CALLS = []


def fake_search(kw, per_kw, offset="0"):
    CALLS.append((kw, offset))
    return [dict(r) for r in PAGES.get((kw, str(offset)), [])], 0


upwork_api.search_jobs = fake_search

# 1) no callback: the old behaviour, same result.
kept, stats = upwork_api.fetch_and_filter_deep(CFG, max_pages=2)
ids = sorted(r["upwork_job_id"] for r in kept)
assert_(ids == ["a1", "a2", "a3", "b1", "g1", "g2", "g3"], f"without a callback the result is unchanged ({ids})")
assert_(stats.get("deep") and stats.get("pages") == 6, "stats still say deep and count the pages (an empty page counts)")

# 2) with a callback: called once per keyword, new rows only, in keyword order.
CALLS.clear()
batches = []
kept2, _ = upwork_api.fetch_and_filter_deep(CFG, max_pages=2, on_keyword=lambda rows: batches.append(sorted(r["upwork_job_id"] for r in rows)))
assert_(batches == [["a1", "a2", "a3"], ["b1"], ["g1", "g2", "g3"]],
        f"rows are handed over after each keyword, a repeat is not handed over twice ({batches})")
assert_(sorted(sum(batches, [])) == ids, "everything handed over adds up to the full result")
assert_(sorted(r["upwork_job_id"] for r in kept2) == ids, "the full result is still returned at the end")

# 3) a keyword with nothing new calls nothing.
PAGES[("beta", "0")] = [{"upwork_job_id": "a1", "title": "Google Ads A1"}]
batches.clear()
upwork_api.fetch_and_filter_deep(CFG, max_pages=2, on_keyword=lambda rows: batches.append([r["upwork_job_id"] for r in rows]))
assert_(len(batches) == 2, f"a keyword that adds nothing new does not call back ({len(batches)} calls)")

# 4) a failing callback never stops the fetch.
def boom(rows):
    raise RuntimeError("database is locked")


kept3, _ = upwork_api.fetch_and_filter_deep(CFG, max_pages=2, on_keyword=boom)
assert_(len(kept3) >= 4, "a callback that raises does not stop the paging or lose the final result")

# 5) rows the filter drops are never handed over.
PAGES[("gamma", "0")] = [{"upwork_job_id": "g1", "title": "Meta Ads Specialist"}, {"upwork_job_id": "g2", "title": "Google Ads G2"}]
CFG2 = dict(CFG, stop_words=["meta ads"])
batches.clear()
upwork_api.fetch_and_filter_deep(CFG2, max_pages=2, on_keyword=lambda rows: batches.append([r["upwork_job_id"] for r in rows]))
assert_("g1" not in sum(batches, []), "a row the feed filter drops is not saved early either")

# The loop in main.py: newest page first, then the deep pass saving as it goes.
src = (ROOT / "api" / "main.py").read_text(encoding="utf-8").replace("\r\n", "\n")
loop = src[src.index("async def _api_feed_loop():"):src.index("# ── Dashboard stats computation")]
assert_(loop.index("upwork_api.fetch_and_filter, cfg") < loop.index("fetch_and_filter_deep"),
        "the normal newest-page fetch runs before the deep pass")
assert_("on_keyword=_save_as_you_go" in loop, "the deep pass saves after each keyword")
assert_("inserted={ins + saved_early}" in loop, "the log line counts the rows saved early")
assert_("going straight to paging back" in loop, "a failed newest-page pass does not skip the catch-up")
assert_(loop.count("fetch_and_filter_deep") == 1 and "gap >= _CATCHUP_GAP_HOURS" in loop,
        "the deep pass is still only for a real gap")

print(f"\n{'ALL PASS' if not bad else f'{bad} FAILED'}")
sys.exit(1 if bad else 0)
