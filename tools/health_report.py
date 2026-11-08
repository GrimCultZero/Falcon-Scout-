# -*- coding: utf-8 -*-
"""Instrument health: make silence loud (audit 2026-10-29, T6).

Two multi-day blackouts went unnoticed (Aug 14-26, Sep 4-16) because nothing
watched the instruments: the job feed, the proposals sync, the messages sync, the
backup and the CLI bridge. `sync_runs` recorded every run but nobody read it.

`build_report()` turns plain inputs into one verdict per instrument:

    ok     - healthy
    amber  - getting stale, or something is off but not lost
    red    - stopped, failed, or too old to trust
    info   - a number to look at, never an alarm (no threshold was agreed)

It does no I/O and takes the clock as an argument, so a test can fake "the last
sync was three days ago" instead of waiting three days. The backend gathers the
inputs (api/main.py: GET /health); the header strip draws the answer.

All thresholds live in the constants below, in one place, on purpose.
"""
from datetime import datetime

# ── thresholds ──────────────────────────────────────────────────────────────
# Job feed (the API poll; the Telegram bot shut down 2026-10-15). Only judged
# while Artem is plausibly working: 07:00 up to 23:00 local. The feed is bursty
# (7 gaps over 30 minutes in 3 days of data), so red needs a real hole.
FEED_AMBER_MIN = 30
FEED_RED_MIN = 120
FEED_WATCH_FROM_HOUR = 7       # inclusive
FEED_WATCH_TO_HOUR = 23        # exclusive

# Proposals sync (the Chrome extension reads Upwork's "Submitted proposals").
PROPOSALS_AMBER_HOURS = 6
PROPOSALS_RED_HOURS = 24
COVERAGE_AMBER = 0.95          # T5's acceptance bar
COVERAGE_RED = 0.8

# Messages sync (the inbox walk).
MESSAGES_AMBER_HOURS = 24
MESSAGES_RED_HOURS = 72        # "no messages walk for 3 days"

# Database backup (T1). RED matches tools/backup_db.py STALE_HOURS and the
# header chip; AMBER warns a day-and-a-quarter in, before it goes red.
BACKUP_AMBER_HOURS = 30
BACKUP_RED_HOURS = 48

# A sync run that reads 0 rows is flagged. These stages mean "the page was
# opened but no sync was started" -- Artem browsing /nx/proposals/ by hand makes
# the extension log one -- so they are amber, not red.
HARMLESS_ZERO_ROW_STAGES = ("gate-declined",)

_RANK = {"ok": 0, "info": 0, "amber": 1, "red": 2}


def _minutes(now, then):
    return (now - then).total_seconds() / 60.0


def _ago(minutes):
    """'12 min', '3.5 h', '2 d' -- short, for tooltips and pills."""
    if minutes is None:
        return "never"
    m = max(0.0, float(minutes))
    if m < 90:
        return f"{int(round(m))} min"
    h = m / 60.0
    if h < 48:
        return f"{h:.1f} h".replace(".0 h", " h")
    return f"{h / 24.0:.1f} d".replace(".0 d", " d")


def _worst(*levels):
    return max(levels, key=lambda l: _RANK.get(l, 0))


def _iso(dt):
    return dt.isoformat(timespec="seconds") if isinstance(dt, datetime) else None


def _unreadable(label, err):
    return {"level": "amber", "label": label, "reason": f"could not read this instrument's data: {err}"}


# ── one function per instrument ─────────────────────────────────────────────
def _feed(data, now_utc, local_hour):
    label = "Feed"
    if data.get("error"):
        return _unreadable(label, data["error"])
    last = data.get("last_insert")
    auto = data.get("auto_fetch_minutes")
    if auto is not None and auto <= 0:
        return {"level": "info", "label": label, "reason": "Auto-fetch is switched off in Feed settings, so no new jobs are expected.",
                "last_at": _iso(last)}
    if data.get("connected") is False:
        return {"level": "red", "label": label, "connected": False,
                "reason": "The Upwork API is not connected, so the feed cannot fetch. Reconnect it in Feed settings.",
                "age_minutes": round(_minutes(now_utc, last), 1) if last else None, "last_at": _iso(last)}
    if last is None:
        return {"level": "red", "label": label, "reason": "No job from the API feed has ever been stored."}
    age = _minutes(now_utc, last)
    out = {"label": label, "age_minutes": round(age, 1), "last_at": _iso(last)}
    if not (FEED_WATCH_FROM_HOUR <= local_hour < FEED_WATCH_TO_HOUR):
        out.update(level="ok", reason=f"Last new job {_ago(age)} ago. Not judged outside {FEED_WATCH_FROM_HOUR:02d}:00-{FEED_WATCH_TO_HOUR:02d}:00 local time.")
    elif age > FEED_RED_MIN:
        out.update(level="red", reason=f"No new job for {_ago(age)} (red after {FEED_RED_MIN} min). The feed may have stopped.")
    elif age > FEED_AMBER_MIN:
        out.update(level="amber", reason=f"No new job for {_ago(age)} (amber after {FEED_AMBER_MIN} min). The feed is bursty, so this can be a quiet spell.")
    else:
        out.update(level="ok", reason=f"Last new job {_ago(age)} ago.")
    return out


def _zero_row_reason(run):
    stage = run.get("stage")
    if stage in HARMLESS_ZERO_ROW_STAGES:
        return "amber", ("The last sync run read 0 rows (stage: gate-declined). That is what the extension logs when the "
                         "proposals page is opened by hand without a sync, so it is not a failure, but no sync has run since.")
    where = f" (stage: {stage})" if stage else ""
    return "red", f"The last sync run read 0 rows{where}. The scraper started and saw nothing."


def _proposals(data, now_utc):
    label = "Proposals"
    if data.get("error"):
        return _unreadable(label, data["error"])
    good = data.get("last_good")
    last = data.get("last_run")
    zero24 = int(data.get("zero_row_runs_24h") or 0)
    if good is None:
        reason = "No proposals sync has ever read any rows."
        if last is not None:
            lvl, why = _zero_row_reason(last)
            reason = f"No proposals sync has ever read any rows. {why}"
        return {"level": "red", "label": label, "reason": reason}

    age_h = _minutes(now_utc, good["ts"]) / 60.0
    cov = good.get("coverage")
    hdr = good.get("header_count")
    level = "ok"
    notes = []

    if age_h > PROPOSALS_RED_HOURS:
        level = "red"
        notes.append(f"The last good sync was {_ago(age_h * 60)} ago (red after {PROPOSALS_RED_HOURS} h).")
    elif age_h > PROPOSALS_AMBER_HOURS:
        level = "amber"
        notes.append(f"The last good sync was {_ago(age_h * 60)} ago (amber after {PROPOSALS_AMBER_HOURS} h).")
    else:
        notes.append(f"Last good sync {_ago(age_h * 60)} ago.")

    if cov is not None:
        read = f"{good.get('rows_scraped')} of {hdr}" if hdr else "?"
        if cov < COVERAGE_RED:
            level = _worst(level, "red")
            notes.append(f"It read only {read} proposals ({round(cov * 100)}%): under {round(COVERAGE_RED * 100)}% means a fifth of the list is unchecked.")
        elif cov < COVERAGE_AMBER:
            level = _worst(level, "amber")
            notes.append(f"It read {read} proposals ({round(cov * 100)}%), under the {round(COVERAGE_AMBER * 100)}% target.")
        else:
            notes.append(f"It read {read} proposals ({round(cov * 100)}%).")
    else:
        notes.append("Coverage is not recorded for that run.")

    # The flag asked for in T6: a run that reads 0 rows. Only the LATEST run
    # counts: once a good run follows it, it no longer says anything about now.
    zero_flag = False
    if last is not None and last.get("rows_scraped") == 0 and last["ts"] >= good["ts"]:
        zlvl, why = _zero_row_reason(last)
        level = _worst(level, zlvl)
        notes.append(why)
        zero_flag = True
    if zero24 and not zero_flag:
        notes.append(f"{zero24} empty run(s) in the last 24 h, since followed by a good one.")

    return {"level": level, "label": label, "reason": " ".join(notes), "age_minutes": round(age_h * 60, 1),
            "last_good_at": _iso(good["ts"]), "rows_scraped": good.get("rows_scraped"), "header_count": hdr,
            "coverage": cov, "last_run_rows": (last or {}).get("rows_scraped"), "last_run_at": _iso((last or {}).get("ts")),
            "last_run_zero_rows": zero_flag, "zero_row_runs_24h": zero24}


def _messages(data, now_utc):
    label = "Messages"
    if data.get("error"):
        return _unreadable(label, data["error"])
    last = data.get("last_run_ts")
    if last is None:
        return {"level": "red", "label": label, "reason": "The inbox walk has never run."}
    age_h = _minutes(now_utc, last) / 60.0
    out = {"label": label, "age_minutes": round(age_h * 60, 1), "last_at": _iso(last)}
    if age_h > MESSAGES_RED_HOURS:
        out.update(level="red", reason=f"No inbox walk for {_ago(age_h * 60)} (red after {MESSAGES_RED_HOURS // 24} days). Replies are not being detected.")
    elif age_h > MESSAGES_AMBER_HOURS:
        out.update(level="amber", reason=f"No inbox walk for {_ago(age_h * 60)} (amber after {MESSAGES_AMBER_HOURS} h).")
    else:
        out.update(level="ok", reason=f"Last inbox walk {_ago(age_h * 60)} ago.")
    return out


def _passive(data, now_utc):
    label = "Passive read"
    if data.get("error"):
        return _unreadable(label, data["error"])
    last = data.get("last_at")
    if last is None:
        return {"level": "info", "label": label, "reason": "No passive read (an open conversation read by the extension) on record."}
    age = _minutes(now_utc, last)
    return {"level": "info", "label": label, "age_minutes": round(age, 1), "last_at": _iso(last),
            "reason": f"Last passive read {_ago(age)} ago. Information only, no threshold."}


def _rooms(data):
    label = "Rooms visited"
    if data.get("error"):
        return _unreadable(label, data["error"])
    rooms = int(data.get("rooms_visited_24h") or 0)
    walks = int(data.get("walks_24h") or 0)
    return {"level": "info", "label": label, "rooms_visited_24h": rooms, "walks_24h": walks,
            "reason": f"{rooms} conversation(s) opened across {walks} inbox walk(s) in the last 24 h. Information only, no threshold."}


def _backup(data):
    label = "Backup"
    if data.get("error"):
        return _unreadable(label, data["error"])
    if data.get("last_error"):
        return {"level": "red", "label": label, "reason": f"The last backup attempt failed: {data['last_error']}"}
    age = data.get("age_hours")
    if not data.get("last_backup_at") or age is None:
        return {"level": "red", "label": label, "reason": f"No backup file found in {data.get('dir') or 'the backup folder'}. The database is the only copy of your data."}
    out = {"label": label, "age_hours": age, "last_at": data.get("last_backup_at")}
    if age > BACKUP_RED_HOURS:
        out.update(level="red", reason=f"The last backup is {_ago(age * 60)} old (red after {BACKUP_RED_HOURS} h).")
    elif age > BACKUP_AMBER_HOURS:
        out.update(level="amber", reason=f"The last backup is {_ago(age * 60)} old (amber after {BACKUP_AMBER_HOURS} h; one is expected every 24 h).")
    else:
        out.update(level="ok", reason=f"Last backup {_ago(age * 60)} ago.")
    return out


def _bridge(data):
    label = "CLI bridge"
    provider = data.get("provider")
    up = bool(data.get("up"))
    out = {"label": label, "provider": provider, "up": up, "port": data.get("port")}
    if data.get("error"):
        # A broken CLI_BRIDGE_PORT only matters if the bridge is the AI provider.
        if provider == "cli":
            out.update(level="red", reason=f"The bridge port setting is unusable: {data['error']}")
        else:
            out.update(level="info", reason=f"AI provider is the API; the bridge setting has a problem ({data['error']}) but is not in use.")
        return out
    if provider == "cli":
        if up:
            out.update(level="ok", reason="AI provider is the CLI bridge and it answers.")
        else:
            out.update(level="red", reason="AI provider is the CLI bridge but it does not answer. Analyse and Generate will fail until it is started (node cli-bridge.js).")
    else:
        out.update(level="info", reason=f"AI provider is the API; the bridge is {'up' if up else 'not running'} and not needed.")
    return out


# ── the report ──────────────────────────────────────────────────────────────
def build_report(inputs, now_utc, local_hour):
    """inputs: see api/main.py _health_inputs(). now_utc: naive UTC datetime, like
    every timestamp the database stores. local_hour: 0-23, machine local time."""
    items = {
        "feed": _feed(inputs.get("feed") or {}, now_utc, local_hour),
        "proposals_sync": _proposals(inputs.get("proposals") or {}, now_utc),
        "messages_sync": _messages(inputs.get("messages") or {}, now_utc),
        "backup": _backup(inputs.get("backup") or {}),
        "bridge": _bridge(inputs.get("bridge") or {}),
        "passive_read": _passive(inputs.get("passive") or {}, now_utc),
        "rooms_visited": _rooms(inputs.get("messages") or {}),
    }
    overall = "ok"
    problems = []
    for key, it in items.items():
        overall = _worst(overall, it["level"])
        if it["level"] in ("amber", "red"):
            problems.append(key)
    return {"generated_at": _iso(now_utc) + "Z", "overall": overall, "problems": problems, "items": items}
