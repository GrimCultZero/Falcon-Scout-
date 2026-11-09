# -*- coding: utf-8 -*-
"""Replay every STORED posting through the feed's word rules, old vs new (audit T18).

For each stored posting (title + the best description we hold) it asks the two
questions the T18 brief puts to every new rule:

  gains            - postings the NEW rules pass and the OLD rules did not, with the
                     keyword or rule that did it, so each gain can be checked by eye;
  false positives  - a gain whose TITLE has no lane word at all, flagged "OFF-LANE?";
  losses           - postings the old rules passed and the new ones do not (must be 0:
                     the change is additive).

The rate, payment, age and country floors are switched off here, so only the WORD
rules (stop words, keyword-in-text, the new scoping) are compared.

Read-only: the database is opened with mode=ro and nothing is written.

LIMIT, stated plainly: the database only holds postings the old filter KEPT (about
99.6% of it). That is enough to prove nothing already kept is lost and to show the
exact gains, but it cannot measure how often a new keyword would let off-lane work
through, because the postings that would have shown that were never stored. That is
the gap feed_drops closes going forward.

Run: .venv\\Scripts\\python tools\\validate_feed_rules.py [path\\to\\upwork_jobs.db]
"""
import collections
import re
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import upwork_api  # noqa: E402

NEW_KEYWORDS = ["google tag manager", "ga4", "google analytics", "conversion tracking", "consent mode",
                "search console", "indexing", "aeo", "geo", "ai search", "llm seo",
                "local citation", "citation building", "guest post", "youtube ads",
                "google business profile", "gbp", "local search", "link insertion", "google review"]

# A title with none of these says nothing about marketing, ads, search or e-commerce.
_LANE_TITLE = re.compile(r"google|ads?\b|adwords|ppc|sem\b|seo|aeo|geo|search|shopping|pmax|performance max|"
                         r"merchant|shopify|woocommerce|wordpress|ecommerce|e-commerce|marketing|analytics|ga4|"
                         r"gtm|tracking|campaign|indexing|citation|link|backlink|youtube|business profile|gbp", re.I)


def load_postings(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    out = []
    for r in con.execute("SELECT id, source, title, description_full, description_snippet, raw_message FROM jobs"):
        out.append({"id": r["id"], "source": r["source"] or "NULL", "title": r["title"] or "",
                    "description": r["description_full"] or r["description_snippet"] or r["raw_message"] or ""})
    con.close()
    return out


def word_rules_only(cfg):
    """The same config with every floor off, so only the word rules decide."""
    return {**cfg, "min_hourly": 0, "min_fixed": 0, "payment_verified_only": False,
            "max_posting_age_hours": 0, "exclude_countries": []}


def verdict(p, cfg):
    return upwork_api._row_passes({"title": p["title"], "description_full": p["description"], "payment_verified": True}, cfg)


def validate(postings, cfg_new):
    cfg_new = word_rules_only(cfg_new)
    cfg_old = {**cfg_new, "keywords": [k for k in cfg_new["keywords"] if k not in NEW_KEYWORDS], "google_proximity": False}
    res = {"n": len(postings), "old_pass": 0, "new_pass": 0, "gains": [], "losses": [], "by_source": collections.defaultdict(collections.Counter),
           "kw": {k: {"hits": 0, "kept_before": 0, "gains": 0} for k in NEW_KEYWORDS}, "proximity": {"hits": 0, "kept_before": 0, "gains": 0},
           "tags": collections.defaultdict(list)}
    for p in postings:
        old, new = verdict(p, cfg_old) is None, verdict(p, cfg_new) is None
        res["old_pass"] += old
        res["new_pass"] += new
        src = res["by_source"][p["source"]]
        src["n"] += 1
        src["old_pass"] += old
        src["new_pass"] += new
        title, desc = p["title"].lower(), p["description"].lower()
        via = upwork_api._keyword_hit(title, desc, cfg_new)
        if new and not old:
            p["via"] = via
            res["gains"].append(p)
            src["gains"] += 1
        if old and not new:
            res["losses"].append(p)
        # per new keyword: where it matches under its own scoping, and whether the posting was kept anyway
        for k in NEW_KEYWORDS:
            if upwork_api._keyword_hit(title, desc, {**cfg_new, "keywords": [k], "google_proximity": False}):
                res["kw"][k]["hits"] += 1
                res["kw"][k]["kept_before"] += old
                res["kw"][k]["gains"] += (new and not old and via == k)
        if upwork_api._google_near_ads(title):
            res["proximity"]["hits"] += 1
            res["proximity"]["kept_before"] += old
            res["proximity"]["gains"] += (new and not old and via == "proximity")
        if new:
            tag = upwork_api.feed_tag_for({"title": p["title"]}, cfg_new)
            if tag:
                res["tags"][tag].append(p)
    return res


def report(res, show=25):
    print(f"stored postings replayed: {res['n']}")
    print(f"  OLD word rules pass: {res['old_pass']}   NEW word rules pass: {res['new_pass']}   gains: {len(res['gains'])}   losses: {len(res['losses'])}")
    print("\nby source (n / old pass / new pass / gains):")
    for s, c in sorted(res["by_source"].items()):
        print(f"  {s:10} {c['n']:5} {c['old_pass']:5} {c['new_pass']:5} {c['gains']:4}")
    print("\nGAINS (pass now, dropped before) - check each title is in-lane:")
    for p in res["gains"][:show]:
        flag = "" if _LANE_TITLE.search(p["title"]) else "   <-- OFF-LANE? title has no lane word"
        print(f"  [{p['source']:9}] via {str(p.get('via')):20} {p['title'][:78]}{flag}")
    off = [p for p in res["gains"] if not _LANE_TITLE.search(p["title"])]
    print(f"  -> {len(res['gains'])} gains, {len(off)} with an off-lane-looking title")
    print("\nLOSSES (kept before, dropped now) - must be none:")
    for p in res["losses"][:show]:
        print(f"  [{p['source']:9}] {p['title'][:90]}")
    if not res["losses"]:
        print("  none")
    print("\nper new keyword (postings matching it under its own scoping / already kept before / gains it alone brings):")
    for k, v in res["kw"].items():
        print(f"  {k:24} hits {v['hits']:4}   already kept {v['kept_before']:4}   gains {v['gains']:3}")
    v = res["proximity"]
    print(f"  {'google-near-ads (title)':24} hits {v['hits']:4}   already kept {v['kept_before']:4}   gains {v['gains']:3}")
    print("\nTAGS the feed would show on stored postings that pass (marked, not hidden):")
    for tag in ("tracking", "gbp"):
        rows = res["tags"].get(tag, [])
        print(f"  {tag}: {len(rows)}")
        for p in rows[:8]:
            print(f"      [{p['source']}] {p['title'][:84]}")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    db = Path(argv[0]) if argv else ROOT / "upwork_jobs.db"
    cfg = upwork_api.load_feed_config()
    report(validate(load_postings(db), cfg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
