# -*- coding: utf-8 -*-
"""The owner-approved test week, 2026-11-10 to 2026-11-17.

While feed_config.json's `test_week` block is active:
  * rows that would be dropped for unverified payment, hourly under the floor or fixed price
    under the floor are KEPT and tagged test:unverified / test:low-hourly / test:low-fixed;
  * pure web-development / design jobs are hidden and recorded as 'testweek:webdev';
  * India, the stop words, the 72 h age limit and no-keyword-in-text are UNCHANGED;
  * after the end date the block does nothing and the old rules are back, with no manual step.

The clock is injected, so "after the week" is tested without waiting for it. The live
upwork_jobs.db is never opened except read-only by the report tool test, which uses a scratch copy.

Run: .venv\\Scripts\\python tests\\test_test_week.py
"""
import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))
import upwork_api                                            # noqa: E402

bad = 0
def check(ok, msg):
    global bad
    if not ok:
        bad += 1
    print(("PASS" if ok else "FAIL") + "  " + msg)

LIVE = upwork_api.load_feed_config()
def utc(y, m, d, h=12, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)
IN_WEEK = utc(2026, 11, 12)
AFTER = utc(2026, 11, 18)
CFG = {**LIVE, "test_week": {"from": "2026-11-10", "until": "2026-11-17"}}
NOW_ISO = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")

def row(title="Google Ads Specialist", desc="We need google ads help.", **kw):
    base = {"upwork_job_id": "~x", "title": title, "description_full": desc, "payment_verified": True, "posted_date": NOW_ISO}
    base.update(kw)
    return base
def verdict(r, now, cfg=CFG):
    return upwork_api._row_passes(r, cfg, now)

# ── the live config ─────────────────────────────────────────────────────────
head = json.loads(subprocess.run(["git", "show", "HEAD:feed_config.json"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout)
check(LIVE.get("test_week") == {"from": "2026-11-10", "until": "2026-11-17"}, "feed_config.json has the test_week block (2026-11-10 .. 2026-11-17)")
same = {k: v for k, v in LIVE.items() if k != "test_week"}
check(all(same.get(k) == v for k, v in head.items()), "every other setting is exactly what it was at HEAD (keywords, stop words, floors, India, age limit)")
check(LIVE["payment_verified_only"] is True and LIVE["min_hourly"] == 25 and LIVE["min_fixed"] == 100 and LIVE["exclude_countries"] == ["india"] and LIVE["max_posting_age_hours"] == 72,
      "the rules the week loosens are still configured (they are not removed)")
check(upwork_api.DEFAULT_FEED_CONFIG["test_week"] is None, "the default has no test week")

# ── is the week active? (inclusive dates, Europe/Kyiv) ──────────────────────
act = upwork_api.test_week_active
check(not act(CFG, utc(2026, 11, 9, 21, 0)), "Nov 9, 23:00 Kyiv: not yet")
check(act(CFG, utc(2026, 11, 9, 22, 30)), "Nov 10, 00:30 Kyiv (Nov 9 22:30 UTC): ACTIVE (the start is in Kyiv time)")
check(act(CFG, IN_WEEK), "mid-week: active")
check(act(CFG, utc(2026, 11, 17, 21, 30)), "Nov 17, 23:30 Kyiv: still active (the end date is inclusive)")
check(not act(CFG, utc(2026, 11, 17, 22, 30)), "Nov 18, 00:30 Kyiv: OVER")
check(not act(CFG, AFTER), "after the week: not active")
check(not act({**LIVE, "test_week": None}, IN_WEEK) and not act({}, IN_WEEK), "no block: never active")
check(not act({**LIVE, "test_week": {"until": "not a date"}}, IN_WEEK) and not act({**LIVE, "test_week": {"from": "x", "until": "2026-11-17"}}, IN_WEEK),
      "a malformed date never loosens the filter")
check(act({**LIVE, "test_week": {"until": "2026-11-17"}}, utc(2026, 11, 1)), "no `from`: active until the end date")

# ── the three money / payment rules: dropped normally, kept + tagged in the week ──
CASES = [("unverified payment", row(payment_verified=False), "unverified-payment", "test:unverified"),
         ("unknown payment (never read)", row(payment_verified=None), "unverified-payment", "test:unverified"),
         ("hourly under $25", row(hourly_rate_max=15, hourly_rate_min=10), "hourly<25", "test:low-hourly"),
         ("fixed under $100", row(fixed_budget="$50"), "fixed<100", "test:low-fixed")]
for name, r, old_reason, tag in CASES:
    check(verdict(r, AFTER) == old_reason, f"{name}: dropped as '{old_reason}' outside the week")
    check(verdict(r, IN_WEEK) is None, f"{name}: PASSES during the week")
    kept, _ = upwork_api._apply_filter({"~x": dict(r)}, CFG, 1)
    check(len(kept) == 1 and kept[0]["feed_tag"] == tag, f"{name}: kept with feed_tag '{tag}' (got {kept[0]['feed_tag'] if kept else None!r})")
kept, _ = upwork_api._apply_filter({"~x": row(payment_verified=False, hourly_rate_max=10)}, CFG, 1)
check(kept[0]["feed_tag"] == "test:unverified,test:low-hourly", f"a row that breaks two rules carries both tags ({kept[0]['feed_tag']})")
kept, _ = upwork_api._apply_filter({"~x": row(fixed_budget="$300", hourly_rate_max=None)}, CFG, 1)
check(kept[0]["feed_tag"] is None, "a row that breaks nothing carries no test tag")
kept, _ = upwork_api._apply_filter({"~x": row(title="Google Business Profile bad review removal", desc="x", fixed_budget="$50")}, CFG, 1)
check(kept[0]["feed_tag"] == "gbp,test:low-fixed", f"the T18 marker and a test tag combine ({kept[0]['feed_tag']})")
kept, _ = upwork_api._apply_filter({"~x": row(fixed_budget="$50")}, {**LIVE, "test_week": None}, 1)
check(kept == [], "with no test week the same row is dropped by _apply_filter")

# ── what the week must NOT change ───────────────────────────────────────────
check(verdict(row(client_country="India"), IN_WEEK) == "country:india", "India is still excluded during the week")
check(verdict(row(client_country="IND"), IN_WEEK) == "country:india", "…also as the code IND")
check((verdict(row(title="Facebook Ads Manager", desc="google ads"), IN_WEEK) or "").startswith("stopword:"), "stop words still drop (Facebook Ads Manager)")
check((verdict(row(title="Meta Ads Specialist for a Bali villa", desc="google ads"), IN_WEEK) or "").startswith("stopword:"), "…meta ads")
check((verdict(row(title="TikTok Creative Buyer", desc="google ads"), IN_WEEK) or "").startswith("stopword:"), "…TikTok")
old = (datetime.now(timezone.utc) - timedelta(hours=100)).strftime("%Y-%m-%dT%H:%M:%SZ")
check(upwork_api._row_passes(row(posted_date=old), CFG) == "posted>72h", "the 72 h age limit still drops old postings during the week")
check(verdict(row(title="Python developer", desc="django api"), IN_WEEK) == "no-keyword-in-text", "no-keyword-in-text is unchanged")
check(verdict(row(payment_verified=False, client_country="India"), IN_WEEK) == "country:india", "a row broken by India AND payment is still dropped (the loosened rule does not rescue it)")

# ── pure web-development / design jobs are hidden in the week ───────────────
HIDDEN = ["Shopify Developer needed for custom theme", "WordPress website design for a dentist", "Webflow designer for a landing page",
          "Web designer for a new brand site", "Senior developer for a Shopify store", "Shopify store development",
          "WordPress developer", "Website developer wanted (Shopify)"]
for t in HIDDEN:
    r = row(title=t, desc="We want a beautiful new site built for our company on Shopify or WordPress.")
    check(verdict(r, IN_WEEK) == "testweek:webdev", f"hidden in the week: {t}")
    check(verdict(r, AFTER) is None, f"…and NOT hidden after it: {t}")
KEPT = [("Shopify SEO Expert", "x"), ("Shopify Google Ads Specialist", "x"), ("WordPress developer for SEO migration", "x"),
        ("Webflow developer", "Must know SEO and analytics setup."), ("Shopify developer", "Also set up conversion tracking and GA4."),
        ("Web designer for PPC landing pages", "x"), ("Shopify store setup", "Plus Performance Max feed."), ("Google Ads Specialist", "x"),
        ("WordPress developer", "Local SEO for the site.")]
for t, d in KEPT:
    check(verdict(row(title=t, desc=d), IN_WEEK) is None, f"kept (lane work in the title or text): {t} / {d[:30]}")
check(verdict(row(title="Shopify developer", desc="We need GEO and AI search visibility too."), IN_WEEK) is None, "GEO / AI search in the text keeps it")
check(verdict(row(title="WordPress developer", desc="Our google tag manager is broken."), IN_WEEK) is None, "tracking (Google Tag Manager) in the text keeps it")

# ... and the hide is recorded in feed_drops
captured = []
upwork_api.set_drop_sink(lambda rows: captured.extend(rows))
seen = {"~w1": row(upwork_job_id="~w1", title="Shopify developer", desc="Build us a site."),
        "~w2": row(upwork_job_id="~w2", title="Shopify SEO Expert")}
kept, stats = upwork_api._apply_filter(seen, CFG, 2)
upwork_api.set_drop_sink(None)
check([d["upwork_job_id"] for d in captured] == ["~w1"] and captured[0]["reason"] == "testweek:webdev" and [r["upwork_job_id"] for r in kept] == ["~w2"],
      "the hidden web-dev job reaches feed_drops with reason 'testweek:webdev'; the SEO one is kept")
check(stats["drop_reasons"] == {"testweek:webdev": 1}, "…and is counted in the fetch stats")

# ── expiry is automatic: the same fetch after the week is the old behaviour ──
cfg_after = CFG
for name, r, old_reason, tag in CASES:
    check(upwork_api._row_passes(r, cfg_after, AFTER) == old_reason, f"after the week, no config change needed: {name} -> '{old_reason}'")

# ── the report tool is read-only and counts per tag ─────────────────────────
spec = importlib.util.spec_from_file_location("testweek_report", ROOT / "tools" / "testweek_report.py")
tr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tr)
tmp = Path(tempfile.mkdtemp(prefix="fs_tw_")) / "x.db"
con = sqlite3.connect(tmp)
con.executescript("""
CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, source TEXT, feed_tag TEXT, captured_at TEXT, last_analysis_at TEXT, starred_at TEXT);
CREATE TABLE proposals (id INTEGER PRIMARY KEY, job_id INTEGER, status TEXT, first_reply_at TEXT);
CREATE TABLE feed_drops (id INTEGER PRIMARY KEY, title TEXT, reason TEXT, fetched_at TEXT);
""")
J = [(1, "a", "api", "test:unverified", "2026-11-11 10:00:00", None, None), (2, "b", "api", "test:unverified", "2026-11-11 10:00:00", "2026-11-11", None),
     (3, "c", "api", "test:unverified,test:low-hourly", "2026-11-12 10:00:00", None, None), (4, "d", "api", "test:low-fixed", "2026-11-12 10:00:00", None, "2026-11-12"),
     (5, "e", "api", None, "2026-11-12 10:00:00", None, None), (6, "f", "api", "gbp", "2026-11-12 10:00:00", "2026-11-12", None),
     (7, "g", "api", "test:low-fixed", "2026-11-25 10:00:00", None, None), (8, "h", "room", "test:unverified", "2026-11-12 10:00:00", None, None)]
con.executemany("INSERT INTO jobs VALUES (?,?,?,?,?,?,?)", J)
con.executemany("INSERT INTO proposals VALUES (?,?,?,?)", [(1, 2, "sent", None), (2, 3, "replied", None), (3, 4, "hired", None), (4, 5, "sent", None), (5, 6, "interviewing", None)])
con.executemany("INSERT INTO feed_drops (title, reason, fetched_at) VALUES (?,?,?)", [("Shopify dev", "testweek:webdev", "2026-11-12 09:00:00"), ("Other", "stopword:meta ads", "2026-11-12 09:00:00"), ("Late", "testweek:webdev", "2026-11-30 09:00:00")])
con.commit(); con.close()
sha = hashlib.sha256(tmp.read_bytes()).hexdigest()
ro = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
rep = tr.build_report(ro, "2026-11-10", "2026-11-17")
ro.close()
t = rep["tags"]
check(t["test:unverified"]["shown"] == 3 and t["test:unverified"]["opened"] == 2 and t["test:unverified"]["applied"] == 2 and t["test:unverified"]["replied"] == 1,
      "test:unverified: 3 shown (jobs 1, 2, 3), 2 opened (analysed job 2, proposal job 3), 2 applied, 1 replied")
check(t["test:low-hourly"] == {"shown": 1, "opened": 1, "applied": 1, "replied": 1, "hired": 0}, "a two-tag row counts under EACH tag (low-hourly: job 3)")
check(t["test:low-fixed"] == {"shown": 1, "opened": 1, "applied": 1, "replied": 1, "hired": 1}, "test:low-fixed: starred job 4 with a hired proposal (the Nov 25 job is outside the window)")
check(rep["normal_feed"] == {"shown": 2, "opened": 2, "applied": 2, "replied": 1, "hired": 0}, "the normal feed = untagged api jobs in the window (jobs 5 and 6, 'gbp' is not a test tag)")
check(rep["webdev_hidden"]["count"] == 1 and rep["webdev_hidden"]["sample"] == ["Shopify dev"], "web-dev hides are counted inside the window only")
check(hashlib.sha256(tmp.read_bytes()).hexdigest() == sha, "the report does not change the database (byte for byte)")
text = tr.render(rep)
check("TEST WEEK REPORT" in text and "normal feed" in text and "opened" in text, "the printed report has the per-tag table and the normal-feed row")
ro = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
try:
    ro.execute("DELETE FROM jobs")
    check(False, "the read-only connection refused a write")
except sqlite3.OperationalError:
    check(True, "the report's connection mode refuses writes")
ro.close()

print(f"\n{bad} FAILURES" if bad else "\nall pass")
sys.exit(1 if bad else 0)
