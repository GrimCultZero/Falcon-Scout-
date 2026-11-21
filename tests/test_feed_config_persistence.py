# -*- coding: utf-8 -*-
"""save_feed_config() preserves unknown keys (Task 0c/D5, owner 2026-11-21).

Before this fix, save_feed_config() only round-tripped keys present in
DEFAULT_FEED_CONFIG -- a save from code that doesn't know about a given key (the
Feed Settings UI, say) silently dropped anything else, including
focus_test_paused_keywords (flagged as a risk in the Task 0b report) and
focus_test itself (neither is in DEFAULT_FEED_CONFIG).

Runs against a scratch feed_config.json (monkeypatches upwork_api.FEED_CONFIG_FILE);
the live feed_config.json is never opened or written.

Run: .venv\\Scripts\\python tests\\test_feed_config_persistence.py
"""
import json
import sys
import tempfile
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

tmpdir = Path(tempfile.mkdtemp(prefix="fs_feed_cfg_"))
upwork_api.FEED_CONFIG_FILE = tmpdir / "feed_config.json"

# ── seed the file with an unknown key, as if written by an earlier task ──
seed = dict(upwork_api.DEFAULT_FEED_CONFIG)
seed["focus_test"] = {"from": "2026-11-19", "until": "2026-12-03"}
seed["focus_test_paused_keywords"] = {"note": "x", "keywords": ["shopify"]}
upwork_api.FEED_CONFIG_FILE.write_text(json.dumps(seed, indent=2), encoding="utf-8")

# A save that only knows about a DEFAULT_FEED_CONFIG field (min_hourly), the way
# the Feed Settings UI would -- it never mentions focus_test at all.
ui_style_save = {k: v for k, v in upwork_api.load_feed_config().items()
                  if k in upwork_api.DEFAULT_FEED_CONFIG}
ui_style_save["min_hourly"] = 30
result = upwork_api.save_feed_config(ui_style_save)

check(result.get("focus_test") == {"from": "2026-11-19", "until": "2026-12-03"},
      "a save that doesn't mention focus_test preserves it (the bug this fixes)")
check(result.get("focus_test_paused_keywords") == {"note": "x", "keywords": ["shopify"]},
      "...and focus_test_paused_keywords too")
check(result.get("min_hourly") == 30, "a known field the caller DID send is still updated")

on_disk = json.loads(upwork_api.FEED_CONFIG_FILE.read_text(encoding="utf-8"))
check(on_disk.get("focus_test") == {"from": "2026-11-19", "until": "2026-12-03"},
      "preserved on DISK too, not just in the return value")

# A save that explicitly changes an unknown key's value -- that value wins.
changed = dict(ui_style_save)
changed["focus_test"] = {"from": "2026-11-19", "until": "2026-12-10"}
result2 = upwork_api.save_feed_config(changed)
check(result2["focus_test"] == {"from": "2026-11-19", "until": "2026-12-10"},
      "a save that DOES set an unknown key updates it, rather than always keeping the old file value")

# A brand-new unknown key present only in the incoming cfg (never yet on disk).
brand_new = dict(ui_style_save)
brand_new["some_future_key"] = {"x": 1}
result3 = upwork_api.save_feed_config(brand_new)
check(result3.get("some_future_key") == {"x": 1}, "a brand-new unknown key from the caller is saved too")

# Known DEFAULT_FEED_CONFIG behavior is unchanged: a key NOT sent falls back to the default.
reset = upwork_api.save_feed_config({})
check(reset["min_hourly"] == upwork_api.DEFAULT_FEED_CONFIG["min_hourly"],
      "an empty save still resets a known field to its default (unchanged prior behavior)")
check(reset.get("focus_test") == {"from": "2026-11-19", "until": "2026-12-10"},
      "...but an empty save still preserves the unknown keys already on disk")

print()
print("all pass" if bad == 0 else f"{bad} FAILURES")
sys.exit(1 if bad else 0)
