"""The week gate, the LinkedIn account registry and the scrape-job queue (METRO_PLAN.md Phase 2, step 4).

Fail closed. Everything an extension may do on the web is decided HERE, by the backend, never by the
extension:

  * Week mode is `metro` or `linked_helper`. In a Linked Helper week the backend hands out NO scrape job
    at all (not LinkedIn, not Ads Transparency, not Business Profile, not Ahrefs); messages and reply
    checks are another code path and are never blocked by this module.
  * Switching to a Metro week needs a confirmation AND the Linked Helper program to be closed (Windows
    process list). If the process list cannot be read, the switch is refused.
  * A LinkedIn page visit is counted BEFORE the job is handed out, and only if the account is under its
    daily cap (default 60, never above `scrape_cap_max`, itself never above HARD_MAX_VISITS). So the
    counter cannot pass the cap: a job is leased only when `visits_today < cap`, in the same transaction
    that increments the counter.
  * A lease that expires is re-queued but its visit stays counted (conservative).

Counters are per account and per Kyiv calendar day.
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
from datetime import datetime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from .db import (MetroScrapeJob, MetroSender, MetroSetting, MetroVisitLog, get_setting, put_setting, utcnow)

KYIV = ZoneInfo("Europe/Kyiv")
HARD_MAX_VISITS = 80               # a typo in Settings can never raise a daily cap past this
LINKEDIN_KINDS = ("linkedin_profile", "linkedin_company")
BROWSER_KINDS = ("ads_transparency", "gbp", "ahrefs")
ALL_KINDS = LINKEDIN_KINDS + BROWSER_KINDS
WEEK_MODES = ("metro", "linked_helper")
LEASE_MINUTES = 10
# Seconds between two jobs handed to the same account. LinkedIn pages: 30-75 s with jitter (DevScout used
# 12-30 s between pages of one lead and 30-75 s between leads); other sites: 8-20 s.
PACE = {"linkedin": (30, 75), "browser": (8, 20)}
AHREFS_PER_DAY = 15                # short batches on the shared Standard plan


def today(now: datetime | None = None) -> str:
    """The Kyiv calendar day (YYYY-MM-DD) of a naive-UTC moment (default: now)."""
    now = now or utcnow()
    return now.replace(tzinfo=ZoneInfo("UTC")).astimezone(KYIV).strftime("%Y-%m-%d")


# ───────────────────────── Linked Helper process check ─────────────────────────

def list_processes() -> list[str]:
    """Names of the running processes (lower case). Windows: `tasklist`; elsewhere: `ps`. Raises on failure."""
    if sys.platform.startswith("win"):
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=20,
                             encoding="utf-8", errors="replace", check=True).stdout
        names = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith('"'):
                names.append(line.split('","')[0].strip('"').lower())
        return names
    out = subprocess.run(["ps", "-A", "-o", "comm="], capture_output=True, text=True, timeout=20, check=True).stdout
    return [l.strip().lower() for l in out.splitlines() if l.strip()]


def linked_helper_running(s: Session, lister: Callable[[], list[str]] | None = None) -> list[str]:
    """The running processes that match the Linked Helper names in Settings. Raises when the list is unreadable."""
    wanted = [str(n).lower() for n in get_setting(s, "linked_helper_process_names", ["linked-helper.exe"])]
    procs = (lister or list_processes)()
    return sorted({p for p in procs if any(p == w or (w and w in p) for w in wanted)})


class GateError(Exception):
    def __init__(self, message: str, status: int = 409, **extra):
        super().__init__(message)
        self.status, self.extra = status, extra


def week_mode(s: Session) -> str:
    m = get_setting(s, "week_mode", "metro")
    return m if m in WEEK_MODES else "linked_helper"      # an unreadable value fails closed


def set_week_mode(s: Session, mode: str, *, confirmed: bool, lister: Callable[[], list[str]] | None = None) -> dict:
    """The header switch. Needs `confirmed` (the pop-up). Entering a Metro week also needs Linked Helper closed."""
    if mode not in WEEK_MODES:
        raise GateError("week mode must be metro or linked_helper", 400)
    if not confirmed:
        raise GateError("the week switch needs a confirmation", 400)
    current = week_mode(s)
    if mode == "metro":
        try:
            running = linked_helper_running(s, lister)
        except Exception as e:                      # cannot see the process list -> do not allow scraping
            raise GateError(f"could not read the Windows process list ({type(e).__name__}); "
                            "staying in the current week mode", 503)
        if running:
            raise GateError("Linked Helper is running (" + ", ".join(running) + "). Close it before a Metro week: "
                            "LinkedIn must not be visited by two tools at once.", 409, running=running)
    put_setting(s, "week_mode", mode)
    if mode == "linked_helper":
        # No extension job may survive the switch: leased work is cancelled, queued work waits.
        for j in s.query(MetroScrapeJob).filter(MetroScrapeJob.status == "leased").all():
            j.status, j.error, j.finished_at = "queued", "week switched to Linked Helper; waiting", None
            j.lease_until = None
    s.commit()
    return {"week_mode": mode, "changed": mode != current}


# ───────────────────────── account registry ─────────────────────────

def _cap_for(s: Session, sender: MetroSender) -> int:
    hard = min(int(get_setting(s, "scrape_cap_max", HARD_MAX_VISITS) or HARD_MAX_VISITS), HARD_MAX_VISITS)
    want = sender.daily_cap or int(get_setting(s, "scrape_cap_per_day", 60) or 60)
    return max(0, min(int(want), hard))


def _roll_day(sender: MetroSender, day: str) -> None:
    if sender.counter_date != day:
        sender.counter_date, sender.visits_today, sender.sent_today = day, 0, 0


def register_account(s: Session, *, account_ref: str, label: str | None = None, chrome_profile: str | None = None) -> MetroSender:
    """Who is signed in. Keyed by the account's profile URL / public id. A new account is a `scraper`; Oleh makes
    Artem's account the `messenger` in Settings. Holds no secrets."""
    ref = (account_ref or "").strip().lower().rstrip("/")
    if not ref:
        raise GateError("the account has no profile reference", 400)
    row = s.query(MetroSender).filter_by(kind="linkedin", account_ref=ref).first()
    if row is None:
        row = MetroSender(kind="linkedin", label=(label or ref)[:120], account_ref=ref, role="scraper",
                          chrome_profile=chrome_profile, active=True, counter_date=today(), visits_today=0, sent_today=0)
        s.add(row)
    else:
        if label:
            row.label = label[:120]
        if chrome_profile:
            row.chrome_profile = chrome_profile
    s.commit()
    return row


def sender_dict(s: Session, r: MetroSender) -> dict:
    day = today()
    visits = r.visits_today if r.counter_date == day else 0
    return {"id": r.id, "kind": r.kind, "label": r.label, "account_ref": r.account_ref, "role": r.role,
            "chrome_profile": r.chrome_profile, "active": bool(r.active), "daily_cap": r.daily_cap,
            "cap_today": _cap_for(s, r), "visits_today": visits, "day": day}


def totals_today(s: Session) -> dict:
    """What the header chip shows: LinkedIn visits today against the cap, summed over active accounts."""
    day, visits, cap, n = today(), 0, 0, 0
    for r in s.query(MetroSender).filter_by(kind="linkedin", active=True).all():
        n += 1
        visits += r.visits_today if r.counter_date == day else 0
        cap += _cap_for(s, r)
    if n == 0:
        cap = max(0, min(int(get_setting(s, "scrape_cap_per_day", 60) or 60), HARD_MAX_VISITS))
    return {"visits": visits, "cap": cap, "account_count": n, "day": day}


def update_account(s: Session, sender_id: int, *, role: str | None = None, daily_cap: int | None = None,
                   active: bool | None = None, set_cap: bool = False) -> MetroSender:
    r = s.get(MetroSender, sender_id)
    if r is None or r.kind != "linkedin":
        raise GateError("no such LinkedIn account", 404)
    if role is not None:
        if role not in ("messenger", "scraper"):
            raise GateError("role must be messenger or scraper", 400)
        if role == "messenger":
            other = s.query(MetroSender).filter(MetroSender.kind == "linkedin", MetroSender.role == "messenger",
                                                MetroSender.id != r.id).first()
            if other is not None:
                raise GateError(f"{other.label} is already the messenger (only one account sends)", 409)
        r.role = role
    if set_cap:
        if daily_cap is not None and not (1 <= int(daily_cap) <= HARD_MAX_VISITS):
            raise GateError(f"the daily cap must be between 1 and {HARD_MAX_VISITS}", 400)
        r.daily_cap = int(daily_cap) if daily_cap is not None else None
    if active is not None:
        r.active = bool(active)
    s.commit()
    return r


# ───────────────────────── the queue ─────────────────────────

def enqueue(s: Session, kind: str, target: str, *, company_id: int | None = None, lead_id: int | None = None,
            campaign_id: int | None = None) -> MetroScrapeJob | None:
    """Queue a job unless the same (kind, target) is already queued or leased. Returns the job, or None if it already waits."""
    if kind not in ALL_KINDS:
        raise GateError(f"unknown job kind {kind}", 400)
    dup = s.query(MetroScrapeJob).filter(MetroScrapeJob.kind == kind, MetroScrapeJob.target == target,
                                         MetroScrapeJob.status.in_(("queued", "leased"))).first()
    if dup is not None:
        return None
    j = MetroScrapeJob(kind=kind, target=target, company_id=company_id, lead_id=lead_id, campaign_id=campaign_id, status="queued")
    s.add(j)
    s.flush()
    return j


def _expire_leases(s: Session, now: datetime) -> int:
    n = 0
    for j in s.query(MetroScrapeJob).filter(MetroScrapeJob.status == "leased", MetroScrapeJob.lease_until < now).all():
        j.status, j.lease_until, j.error = "queued", None, "lease expired; queued again (its visit stays counted)"
        n += 1
    return n


def next_job(s: Session, sender_id: int, kinds: list[str] | None = None, *, now: datetime | None = None,
             rng: random.Random | None = None) -> dict:
    """What an extension may do next. Returns {"job": {...}} or {"job": None, "reason": ..., "wait_seconds": n}."""
    now = now or utcnow()
    rng = rng or random
    sender = s.get(MetroSender, sender_id)
    if sender is None or sender.kind != "linkedin" or not sender.active:
        return {"job": None, "reason": "unknown or inactive account"}
    mode = week_mode(s)
    if mode != "metro":
        return {"job": None, "reason": "Linked Helper week: no scrape jobs", "week_mode": mode}
    day = today(now)
    _roll_day(sender, day)
    _expire_leases(s, now)
    allowed = [k for k in (kinds or ALL_KINDS) if k in ALL_KINDS]

    # pacing: the gap since this account's last handed-out job
    last = s.query(MetroVisitLog).filter_by(sender_id=sender.id).order_by(MetroVisitLog.id.desc()).first()
    last_at = last.at if last else None

    cap = _cap_for(s, sender)
    q = s.query(MetroScrapeJob).filter(MetroScrapeJob.status == "queued", MetroScrapeJob.kind.in_(allowed)).order_by(MetroScrapeJob.id)
    ahrefs_today = (s.query(MetroScrapeJob).filter(MetroScrapeJob.kind == "ahrefs", MetroScrapeJob.status.in_(("leased", "done", "failed")))
                    .filter(MetroScrapeJob.created_at >= now - timedelta(hours=24)).count())
    pick, skipped = None, []
    for j in q.limit(200).all():
        if j.kind in LINKEDIN_KINDS and sender.visits_today >= cap:
            if "cap" not in skipped:
                skipped.append("cap")
            continue
        if j.kind == "ahrefs" and ahrefs_today >= AHREFS_PER_DAY:
            if "ahrefs" not in skipped:
                skipped.append("ahrefs")
            continue
        pick = j
        break
    if pick is None:
        s.commit()
        why = ("daily cap reached" if "cap" in skipped else
               "Ahrefs batch limit for today reached" if "ahrefs" in skipped else "queue empty")
        return {"job": None, "reason": why, "visits_today": sender.visits_today, "cap": cap}

    lo, hi = PACE["linkedin" if pick.kind in LINKEDIN_KINDS else "browser"]
    gap = rng.uniform(lo, hi)
    if last_at is not None and (now - last_at).total_seconds() < gap:
        wait = int(gap - (now - last_at).total_seconds()) + 1
        s.commit()
        return {"job": None, "reason": "pacing", "wait_seconds": wait, "visits_today": sender.visits_today, "cap": cap}

    # Reserve: check the cap, count the visit and lease the job in ONE transaction.
    if pick.kind in LINKEDIN_KINDS:
        if sender.visits_today >= cap:
            s.commit()
            return {"job": None, "reason": "daily cap reached", "visits_today": sender.visits_today, "cap": cap}
        sender.visits_today += 1
        s.add(MetroVisitLog(sender_id=sender.id, job_id=pick.id, kind=pick.kind, target=pick.target, day=day,
                            week_mode=mode, at=now))
    else:
        s.add(MetroVisitLog(sender_id=sender.id, job_id=pick.id, kind=pick.kind, target=pick.target, day=day,
                            week_mode=mode, at=now))     # logged for pacing; not a LinkedIn visit, not counted against the cap
    pick.status, pick.sender_id, pick.lease_until, pick.error = "leased", sender.id, now + timedelta(minutes=LEASE_MINUTES), None
    s.commit()
    return {"job": {"id": pick.id, "kind": pick.kind, "target": pick.target, "company_id": pick.company_id,
                    "lead_id": pick.lead_id}, "visits_today": sender.visits_today, "cap": cap}


def counted_visits(s: Session, sender_id: int, day: str | None = None) -> int:
    """LinkedIn visits recorded in the audit log for an account on a day (kinds that count against the cap)."""
    return (s.query(MetroVisitLog).filter(MetroVisitLog.sender_id == sender_id, MetroVisitLog.day == (day or today()),
                                          MetroVisitLog.kind.in_(LINKEDIN_KINDS)).count())
