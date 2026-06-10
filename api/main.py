from pathlib import Path
import sys
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, or_, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))  # api/ dir — for sibling imports (upwork_api)
load_dotenv(ROOT / ".env", override=True)

from db import Job, KBEntry, Proposal, TokenUsage, RuleViolation, Base  # noqa: E402
import json as _json_mod

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'upwork_jobs.db'}")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Bootstrap tables on import so the API can run standalone (without waiting
# for the listener). create_all is idempotent — no-op if everything exists.
Base.metadata.create_all(engine)

# Lightweight migrations: SQLAlchemy's create_all only adds *missing tables*,
# not missing columns on existing tables. For new columns on the Job table
# (added over time without Alembic), do an in-place ALTER TABLE if they're
# absent. Safe to re-run.
def _ensure_job_columns():
    with engine.begin() as conn:
        existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(jobs)").fetchall()}
        if "hidden_at" not in existing:
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN hidden_at DATETIME")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_jobs_hidden_at ON jobs(hidden_at)")
        if "client_already_hired" not in existing:
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN client_already_hired INTEGER")
        if "description_full" not in existing:
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN description_full TEXT")
        if "preferred_qualifications" not in existing:
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN preferred_qualifications TEXT")
        if "last_analysis_json" not in existing:
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN last_analysis_json TEXT")
        if "last_analysis_at" not in existing:
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN last_analysis_at DATETIME")
        if "source" not in existing:
            # Backfill existing rows to 'bot' (all jobs so far came via Telegram).
            conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'bot'")
            conn.exec_driver_sql("UPDATE jobs SET source='bot' WHERE source IS NULL")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_jobs_source ON jobs(source)")

        kb_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(kb_entries)").fetchall()}
        if "is_core" not in kb_cols:
            conn.exec_driver_sql("ALTER TABLE kb_entries ADD COLUMN is_core INTEGER NOT NULL DEFAULT 0")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_kb_entries_is_core ON kb_entries(is_core)")

        proposals_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(proposals)").fetchall()}
        if "bid_amount" not in proposals_cols:
            conn.exec_driver_sql("ALTER TABLE proposals ADD COLUMN bid_amount TEXT")
        if "bid_currency" not in proposals_cols:
            conn.exec_driver_sql("ALTER TABLE proposals ADD COLUMN bid_currency TEXT")
        if "submitted_at" not in proposals_cols:
            conn.exec_driver_sql("ALTER TABLE proposals ADD COLUMN submitted_at DATETIME")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_proposals_submitted_at ON proposals(submitted_at)")
        if "analysis_json" not in proposals_cols:
            conn.exec_driver_sql("ALTER TABLE proposals ADD COLUMN analysis_json TEXT")
_ensure_job_columns()


# ── Token usage tracking ─────────────────────────────────────────────────────
# Pricing per 1M tokens (USD). Numbers reflect Anthropic's published rates as
# of writing; update here if rates change. Falls back to Sonnet rates for any
# unknown model so we never crash the usage chip.
_MODEL_PRICING = {
    "claude-sonnet-4-5":          {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-5-20250929": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-6":          {"input": 3.0, "output": 15.0},
    "claude-opus-4-7":            {"input": 15.0, "output": 75.0},
    "claude-haiku-4-5-20251001":  {"input": 1.0, "output": 5.0},
}
_DEFAULT_PRICING = {"input": 3.0, "output": 15.0}


def _record_usage(kind: str, model: str, response_json: dict) -> None:
    """Insert a TokenUsage row from an Anthropic Messages API response."""
    try:
        usage = (response_json or {}).get("usage") or {}
        row = TokenUsage(
            kind=kind,
            model=(model or "unknown"),
            input_tokens=int(usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("output_tokens") or 0),
            cache_creation_input_tokens=usage.get("cache_creation_input_tokens"),
            cache_read_input_tokens=usage.get("cache_read_input_tokens"),
        )
        with Session(engine) as s:
            s.add(row)
            s.commit()
    except Exception as exc:  # never block a successful call on bookkeeping
        print(f"[usage] failed to record: {exc}")

app = FastAPI(title="Upwork Cockpit", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5180", "http://127.0.0.1:5180",   # Falcon Scout (current)
        "http://localhost:5174", "http://127.0.0.1:5174",   # legacy
        "http://localhost:5173", "http://127.0.0.1:5173",   # legacy
        # Sync v2: the proposals/messages content script POSTs status updates
        # DIRECTLY to this backend from the upwork.com tab (no background-worker
        # relay), so upwork.com must be an allowed CORS origin. Localhost is a
        # "potentially trustworthy" origin so the HTTPS→http://127.0.0.1 call is
        # NOT blocked as mixed content.
        "https://www.upwork.com",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _start_background_tasks():
    """Launch the daily ghost-sweep loop in the event loop."""
    import asyncio
    asyncio.create_task(_ghost_sweep_loop())
    print(f"[Ghost Timer] Daily background sweep scheduled (every {_GHOST_SWEEP_INTERVAL_SEC // 3600}h)")
    asyncio.create_task(_api_feed_loop())
    print("[api-feed/auto] Background auto-fetch loop started (interval from feed_config.auto_fetch_minutes)")


# ── 10-day auto-ghost timer ──────────────────────────────────────────────────
def _auto_ghost_proposals():
    """
    Mark proposals as 'ghosted' if they were submitted >10 days ago and have
    no reply. Runs on startup and can be called periodically.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=10)
    with Session(engine) as session:
        ghosted = session.query(Proposal).filter(
            Proposal.submitted_at < cutoff,
            Proposal.status == "sent",
            Proposal.client_reply_text == None
        ).all()

        for p in ghosted:
            p.status = "ghosted"
            p.status_updated_at = datetime.now(timezone.utc)
            session.add(p)

        if ghosted:
            session.commit()
            print(f"[Ghost Timer] Auto-ghosted {len(ghosted)} proposals older than 10 days with no reply")
        return len(ghosted)

_auto_ghost_proposals()


# Daily ghost sweep — runs every 24h while the backend is alive (DESIGN §13).
# The startup call above covers the "fresh launch" case; this background task
# covers long-running sessions so we don't need the user to restart for the
# 10-day rule to apply.
_GHOST_SWEEP_INTERVAL_SEC = 24 * 60 * 60  # 24 hours

async def _ghost_sweep_loop():
    import asyncio
    while True:
        try:
            await asyncio.sleep(_GHOST_SWEEP_INTERVAL_SEC)
            _auto_ghost_proposals()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[Ghost Timer] Sweep error (will retry tomorrow): {exc}")


def _upsert_api_jobs(rows):
    """Insert new API-sourced jobs (dedup on upwork_job_id). Shared by the
    on-demand /api-fetch endpoint and the background auto-fetch loop."""
    inserted, skipped = 0, 0
    with Session(engine) as session:
        for r in rows:
            uid = r.get("upwork_job_id")
            existing = (session.query(Job).filter_by(upwork_job_id=uid).first()
                        if uid else None)
            if existing:
                skipped += 1
                continue
            session.add(Job(**r))
            inserted += 1
        session.commit()
    return inserted, skipped


# Background auto-fetch — keeps the API feed current like the bot's live stream.
# Reads `auto_fetch_minutes` from feed_config each cycle (so toggling it in the
# Feed Settings panel takes effect without a restart). The fetch + DB write run
# in a threadpool so the blocking HTTP/SQLite calls never stall the event loop.
async def _api_feed_loop():
    import asyncio
    import upwork_api
    loop = asyncio.get_event_loop()
    # Small initial delay so startup isn't blocked by a first fetch.
    await asyncio.sleep(20)
    while True:
        try:
            cfg = upwork_api.load_feed_config()
            mins = int(cfg.get("auto_fetch_minutes") or 0)
            if mins <= 0:
                await asyncio.sleep(60)            # off — re-check config in a minute
                continue
            if not upwork_api.is_connected():
                await asyncio.sleep(min(mins, 5) * 60)  # not authed — wait, retry
                continue
            rows, stats = await loop.run_in_executor(None, upwork_api.fetch_and_filter, cfg)
            ins, skip = await loop.run_in_executor(None, _upsert_api_jobs, rows)
            print(f"[api-feed/auto] {stats} inserted={ins} skipped={skip}")
            await asyncio.sleep(mins * 60)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[api-feed/auto] error (retry in 5m): {exc}")
            await asyncio.sleep(300)


# ── Dashboard stats computation ───────────────────────────────────────────────
def _bid_tier(amount: float, currency: str) -> str:
    """
    Classify a bid into a tier. USD-only for now — other currencies fall into
    'other' so we don't lump EUR/INR/etc. into USD bands without FX rates.
    Tiers:
      low: < $500
      mid: $500–$1999
      high: $2000–$4999
      premium: $5000+
    """
    if not amount or (currency or "").upper() != "USD":
        return "other"
    if amount < 500: return "low"
    if amount < 2000: return "mid"
    if amount < 5000: return "high"
    return "premium"


def _time_bucket(minutes: float) -> str:
    if minutes < 15:   return "<15min"
    if minutes < 60:   return "15-60min"
    if minutes < 360:  return "1-6hr"
    if minutes < 1440: return "6-24hr"
    return ">24hr"


def _compute_dashboard_stats():
    """
    Compute aggregated proposal funnel, send-time buckets, bid stats,
    bid-tier × send-time crosstab (reply rate), and weekly trend.
    Called on-demand by the /dashboard-stats endpoint.
    """
    from collections import defaultdict

    POSITIVE_STATUSES = {"replied", "interviewing", "hired"}

    # Everything inside one session — earlier version did `session.query(Job)`
    # after the `with` block had closed, which was a latent bug.
    with Session(engine) as session:
        all_proposals = session.query(Proposal).all()
        job_map = {j.id: j for j in session.query(Job).all()}

        # ── Funnel ────────────────────────────────────────────────────────
        funnel = {}
        for status in ["sent", "viewed", "invited", "replied", "interviewing", "hired",
                       "declined", "ghosted", "expired", "withdrawn"]:
            count = sum(1 for p in all_proposals if p.status == status)
            if count > 0:
                funnel[status] = count

        # ── Send-time buckets ────────────────────────────────────────────
        send_time_buckets = {k: 0 for k in
            ["<15min", "15-60min", "1-6hr", "6-24hr", ">24hr", "no_timestamp"]}

        # Per-proposal enrichment for crosstab / trend
        enriched = []
        for p in all_proposals:
            ts = p.submitted_at
            job = job_map.get(p.job_id)
            captured = job.captured_at if job else None

            bucket = None
            if ts and captured:
                minutes = (ts - captured).total_seconds() / 60
                bucket = _time_bucket(minutes)
                send_time_buckets[bucket] += 1
            elif not ts:
                send_time_buckets["no_timestamp"] += 1
            else:
                send_time_buckets["no_timestamp"] += 1

            amount = None
            if p.bid_amount:
                try: amount = float(p.bid_amount)
                except (ValueError, TypeError): pass
            tier = _bid_tier(amount or 0, p.bid_currency or "")

            enriched.append({
                "status":     p.status,
                "submitted":  ts,
                "bid_amount": amount,
                "bid_currency": p.bid_currency,
                "tier":       tier,
                "bucket":     bucket,
            })

        # ── Bid stats ────────────────────────────────────────────────────
        bid_stats = {}
        for e in enriched:
            if e["bid_amount"] is None or not e["bid_currency"]:
                continue
            cur = e["bid_currency"]
            slot = bid_stats.setdefault(cur, {"count": 0, "total": 0.0, "min": None, "max": None})
            a = e["bid_amount"]
            slot["count"] += 1
            slot["total"] += a
            slot["min"] = a if slot["min"] is None else min(slot["min"], a)
            slot["max"] = a if slot["max"] is None else max(slot["max"], a)
        for cur in bid_stats:
            s = bid_stats[cur]
            s["average"] = (s["total"] / s["count"]) if s["count"] else 0

        # ── Crosstab: bid_tier × send-time bucket → counts + reply rate ──
        # Each cell: { sent, replied, ghosted, reply_rate_pct }
        TIERS = ["low", "mid", "high", "premium", "other"]
        BUCKETS = ["<15min", "15-60min", "1-6hr", "6-24hr", ">24hr"]
        crosstab = {tier: {b: {"total": 0, "replied": 0, "ghosted": 0, "reply_rate_pct": None}
                           for b in BUCKETS} for tier in TIERS}
        for e in enriched:
            if e["bucket"] is None:
                continue
            cell = crosstab[e["tier"]][e["bucket"]]
            cell["total"] += 1
            if e["status"] in POSITIVE_STATUSES:
                cell["replied"] += 1
            elif e["status"] == "ghosted":
                cell["ghosted"] += 1
        for tier in TIERS:
            for b in BUCKETS:
                cell = crosstab[tier][b]
                if cell["total"] >= 3:  # don't compute reply rate on tiny samples
                    cell["reply_rate_pct"] = round(100 * cell["replied"] / cell["total"])

        # ── Trend: by ISO week, count by status ──────────────────────────
        # Use submitted_at when available, else sent_at, so old proposals
        # without submission timestamps still appear in the trend.
        weekly = defaultdict(lambda: {"submitted": 0, "viewed": 0, "replied": 0, "hired": 0, "ghosted": 0})
        for p in all_proposals:
            ref = p.submitted_at or p.sent_at
            if not ref:
                continue
            iso = ref.isocalendar()  # (year, week, weekday)
            week_key = f"{iso[0]}-W{iso[1]:02d}"
            weekly[week_key]["submitted"] += 1
            # "viewed" = client viewed but not yet replied (so we don't double-count
            # by also incrementing for replied/interviewing/hired which imply view)
            if p.status == "viewed":
                weekly[week_key]["viewed"] += 1
            if p.status in POSITIVE_STATUSES:
                weekly[week_key]["replied"] += 1
            if p.status == "hired":
                weekly[week_key]["hired"] += 1
            if p.status == "ghosted":
                weekly[week_key]["ghosted"] += 1
        trend = [{"week": k, **v} for k, v in sorted(weekly.items())]
        # Cap to last 12 weeks for chart readability
        trend = trend[-12:]

        # ── Period-segmented metrics (this/last week & month, all-time) ──────
        # 'invited' is tracked as its OWN metric (not folded into replies) so the
        # period panels and the all-time cards tell the same story.
        _POS = {"replied", "interviewing", "hired"}
        now = datetime.now(timezone.utc)

        def _ref(p):
            t = p.submitted_at or p.sent_at
            if t is not None and t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            return t

        def _period(start, end):
            """Metrics for proposals whose ref-ts is in [start, end). end=None → all-time."""
            subs, viewed_c, invited_c, pos, hired_c = 0, 0, 0, 0, 0
            bid_total, bid_count = 0.0, 0
            for p in all_proposals:
                t = _ref(p)
                if start is not None and (t is None or t < start):
                    continue
                if end is not None and (t is None or t >= end):
                    continue
                subs += 1
                # 'viewed' / 'invited' = their own current-status counts.
                # 'positive' (replies) = replied/interviewing/hired only.
                if p.status == "viewed":
                    viewed_c += 1
                if p.status == "invited":
                    invited_c += 1
                if p.status in _POS:
                    pos += 1
                if p.status == "hired":
                    hired_c += 1
                if p.bid_amount:
                    try:
                        bid_total += float(p.bid_amount); bid_count += 1
                    except (ValueError, TypeError):
                        pass
            return {
                "submitted": subs,
                "viewed": viewed_c,
                "invited": invited_c,
                "positive": pos,
                "reply_rate_pct": round(100 * pos / subs) if subs else None,
                "hired": hired_c,
                "bid_total": round(bid_total),
                "bid_count": bid_count,
                "bid_avg": round(bid_total / bid_count) if bid_count else 0,
            }

        # Calendar-aligned periods: current ISO week / calendar month, plus the
        # immediately-previous one for the delta comparison.
        iso = now.isocalendar()  # (iso_year, iso_week, iso_weekday)
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0)         # Monday 00:00
        prev_week_start = week_start - timedelta(days=7)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_month_start = (month_start - timedelta(days=1)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0)

        def _fmt_range(a, b_excl):
            last = b_excl - timedelta(days=1)               # inclusive last day
            if a.month == last.month:
                return f"{a.strftime('%b')} {a.day}–{last.day}"
            return f"{a.strftime('%b')} {a.day} – {last.strftime('%b')} {last.day}"

        def _labeled(metrics, label, rng=None):
            metrics["label"] = label
            if rng:
                metrics["range"] = rng
            return metrics

        prev_iso = prev_week_start.isocalendar()
        periods = {
            "this_week":  _labeled(_period(week_start, None),
                                   f"Week {iso[1]}", _fmt_range(week_start, week_start + timedelta(days=7))),
            "last_week":  _labeled(_period(prev_week_start, week_start),
                                   f"Week {prev_iso[1]}", _fmt_range(prev_week_start, week_start)),
            "this_month": _labeled(_period(month_start, None), month_start.strftime("%B %Y")),
            "last_month": _labeled(_period(prev_month_start, month_start), prev_month_start.strftime("%B %Y")),
            "all_time":   _labeled(_period(None, None), "All time"),
        }

        # ── Bid by outcome (all-time; needs volume) — does bidding higher land? ─
        def _avg_bid_for(statuses):
            amts = []
            for p in all_proposals:
                if p.status in statuses and p.bid_amount:
                    try: amts.append(float(p.bid_amount))
                    except (ValueError, TypeError): pass
            return {"avg": round(sum(amts) / len(amts)) if amts else None, "count": len(amts)}
        bid_by_outcome = {
            "positive": _avg_bid_for(_POS),
            "ghosted":  _avg_bid_for({"ghosted"}),
            "all":      _avg_bid_for({"sent", "viewed", "invited", "replied",
                                      "interviewing", "hired", "ghosted",
                                      "declined", "expired", "withdrawn"}),
        }

    return {
        "funnel": funnel,
        "send_time_buckets": send_time_buckets,
        "bid_stats": bid_stats,
        "crosstab": crosstab,
        "trend": trend,
        "periods": periods,
        "bid_by_outcome": bid_by_outcome,
        "total_proposals": len(all_proposals),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


def _serialize(j: Job) -> dict:
    return {
        # ── Core fields ──────────────────────────────────────────────────
        "id": j.id,
        "upwork_job_id": j.upwork_job_id,
        "title": j.title or "Untitled",
        "url": j.url,
        "description_snippet": j.description_snippet,
        "hourly_rate_min": j.hourly_rate_min,
        "hourly_rate_max": j.hourly_rate_max,
        "client_country": j.client_country,
        "client_spend": j.client_spend,
        "posted_date": j.posted_date,
        "category": j.category,
        "keywords": j.keywords,
        "raw_message": j.raw_message,
        "captured_at": j.captured_at.isoformat() if j.captured_at else None,
        "avg_rate": j.avg_rate,
        "fixed_budget": j.fixed_budget,
        "source": getattr(j, "source", None) or "bot",
        # ── Enrichment: job details ──────────────────────────────────────
        "experience_level": j.experience_level,
        "hours_per_week": j.hours_per_week,
        "duration": j.duration,
        "project_type": j.project_type,
        # ── Enrichment: activity ─────────────────────────────────────────
        "connects_required": j.connects_required,
        "available_connects": j.available_connects,
        "proposals": j.proposals,
        "last_viewed": j.last_viewed,
        "interviewing": j.interviewing,
        "invites_sent": j.invites_sent,
        "unanswered_invites": j.unanswered_invites,
        "bid_high": j.bid_high,
        "bid_average": j.bid_average,
        "bid_low": j.bid_low,
        "geo_restriction": j.geo_restriction,
        # ── Enrichment: client ───────────────────────────────────────────
        "hire_rate": j.hire_rate,
        "payment_verified": j.payment_verified,
        "phone_verified": j.phone_verified,
        "client_rating_score": j.client_rating_score,
        "client_review_count": j.client_review_count,
        "client_jobs_posted": j.client_jobs_posted,
        "client_jobs_open": j.client_jobs_open,
        "client_hires": j.client_hires,
        "client_active": j.client_active,
        "client_total_spent_detail": j.client_total_spent_detail,
        "client_avg_hourly_rate": j.client_avg_hourly_rate,
        "client_hours_billed": j.client_hours_billed,
        "client_member_since": j.client_member_since,
        "client_company_size": j.client_company_size,
        "client_industry": j.client_industry,
        "client_city": j.client_city,
        "client_reviews": j.client_reviews,
        "screening_questions": j.screening_questions,
        "enriched_at": j.enriched_at.isoformat() if j.enriched_at else None,
        "hidden_at": j.hidden_at.isoformat() if j.hidden_at else None,
        "client_already_hired": j.client_already_hired,
        "description_full": j.description_full,
        "preferred_qualifications": j.preferred_qualifications,
        # Latest analyser verdict cached server-side (POST /jobs/{id}/analysis).
        # Returned as a parsed dict so the frontend doesn't need to JSON.parse.
        "last_analysis": (
            _json_mod.loads(j.last_analysis_json)
            if j.last_analysis_json else None
        ),
        "last_analysis_at": j.last_analysis_at.isoformat() if j.last_analysis_at else None,
    }


@app.get("/jobs")
def list_jobs(
    q: Optional[str] = Query(None),
    filter_type: Optional[str] = Query(None),
    source: Optional[str] = Query(None, description="Feed source filter: 'bot' | 'api' | None (all)"),
):
    with Session(engine) as session:
        stmt = select(Job).order_by(Job.captured_at.desc())

        # Feed-source toggle (Bot / API / All). 'bot' includes legacy NULL rows.
        if source == "bot":
            stmt = stmt.where(or_(Job.source == "bot", Job.source.is_(None)))
        elif source == "api":
            stmt = stmt.where(Job.source == "api")

        # Hidden visibility:
        #   filter_type == "hidden"  → only hidden jobs (for the Hidden tab)
        #   anything else            → exclude hidden jobs from the feed
        if filter_type == "hidden":
            stmt = stmt.where(Job.hidden_at.isnot(None))
        else:
            stmt = stmt.where(Job.hidden_at.is_(None))

        if q:
            term = f"%{q}%"
            stmt = stmt.where(
                or_(
                    Job.title.ilike(term),
                    Job.description_snippet.ilike(term),
                    Job.client_country.ilike(term),
                )
            )

        if filter_type:
            if filter_type == "today":
                today = datetime.now(timezone.utc).date()
                stmt = stmt.where(Job.captured_at >= today)
            elif filter_type == "high_budget":
                stmt = stmt.where(Job.hourly_rate_min > 30)
            elif filter_type == "enriched":
                # A job counts as "enriched" if the extension has populated any
                # of these fields. Mirrors the `isEnriched` check in JobList.jsx.
                stmt = stmt.where(
                    or_(
                        Job.enriched_at.isnot(None),
                        Job.connects_required.isnot(None),
                        Job.proposals.isnot(None),
                        Job.hire_rate.isnot(None),
                    )
                )
            elif filter_type == "no_us_only":
                # Exclude jobs where geo_restriction explicitly limits to US freelancers.
                # Jobs with no geo_restriction data are included (unknown = not excluded).
                stmt = stmt.where(
                    or_(
                        Job.geo_restriction.is_(None),
                        ~(
                            Job.geo_restriction.ilike("%United States only%") |
                            Job.geo_restriction.ilike("%US only%") |
                            Job.geo_restriction.ilike("%United States%only%")
                        )
                    )
                )

        jobs = session.scalars(stmt).all()
        if not jobs:
            return []
        # Batch-fetch proposal status for all returned jobs in one query
        job_ids = [j.id for j in jobs]
        proposal_rows = session.query(Proposal.job_id, Proposal.status).filter(
            Proposal.job_id.in_(job_ids)
        ).all()
        proposal_status_map = {row.job_id: row.status for row in proposal_rows}
        result = []
        for j in jobs:
            d = _serialize(j)
            d["proposal_status"] = proposal_status_map.get(j.id)
            result.append(d)
        return result


@app.get("/jobs/{job_id}")
def get_job(job_id: int):
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return _serialize(job)


@app.get("/jobs/by-upwork-id/{upwork_job_id}")
def get_job_by_upwork_id(upwork_job_id: str):
    """
    Look up a job by its Upwork job ID (the ~01abc… string from the job URL).
    Handles the ~ prefix transparently. Returns 404 if not found.

    Used by the Chrome extension's background.js to resolve an Upwork job ID
    to a database row without fetching all jobs.
    """
    clean = upwork_job_id.lstrip("~").strip()
    with Session(engine) as session:
        job = session.query(Job).filter(
            or_(
                Job.upwork_job_id == clean,
                Job.upwork_job_id == "~" + clean,
            )
        ).first()
        if not job:
            raise HTTPException(status_code=404, detail=f"Job not found: {upwork_job_id}")
        return _serialize(job)


@app.post("/share-with-claude")
def share_with_claude(data: dict):
    """
    Dump a snapshot of the current dashboard state to `share-with-claude.md`
    at the repo root. Used by the "Share with Claude" buttons on each tab
    so Claude Code can read live context without the user pasting anything.

    Supported snapshot kinds (data["kind"]):
      - "job"      (default) — selected job + analysis + proposal + both chats
      - "kb"       — selected KB entry (or filtered list) + draft state
      - "outcome"  — selected proposal record + its linked job snapshot
    """
    snap_path = ROOT / "share-with-claude.md"
    kind = (data.get("kind") or "job").lower()
    ts = data.get("snapshot_at") or datetime.now(timezone.utc).isoformat()

    # ── KB snapshot ────────────────────────────────────────────────────
    if kind == "kb":
        entry = data.get("entry") or {}
        draft = data.get("draft") or {}
        filter_type = data.get("filter_type") or "all"
        query = data.get("query") or ""
        list_summary = data.get("list_summary") or {}
        lines = [
            f"# Falcon Scout KB snapshot — {ts}",
            "",
            f"## Current filter / query",
            f"- type filter: **{filter_type}**",
            f"- search query: `{query}`" if query else "- search query: _(none)_",
            f"- entries visible: {list_summary.get('count', '?')}",
            "",
        ]
        if entry and entry.get("id"):
            lines.append(f"## Selected entry — `{entry.get('id')}`")
            lines.append(f"- title: **{entry.get('title')}**")
            lines.append(f"- type: `{entry.get('type')}`  ·  tags: `{entry.get('tags') or '—'}`")
            if entry.get("source_url"):
                lines.append(f"- source: {entry['source_url']}")
            if entry.get("job_id"):
                lines.append(f"- linked job id: {entry['job_id']}")
            lines.append(f"- created: {entry.get('created_at')}  ·  updated: {entry.get('updated_at')}")
            lines.append("")
            lines.append("### Content")
            lines.append(entry.get("content") or "_(empty)_")
            lines.append("")
        if draft and (draft.get("title") or draft.get("content")):
            lines.append("## Current draft in editor (unsaved or being edited)")
            lines.append(f"- title: {draft.get('title') or '_(blank)_'}")
            lines.append(f"- type: `{draft.get('type')}`  ·  tags: `{draft.get('tags') or '—'}`")
            lines.append("")
            lines.append("### Draft content")
            lines.append(draft.get("content") or "_(empty)_")
            lines.append("")
        text = "\n".join(lines)
        snap_path.write_text(text, encoding="utf-8")
        return {"ok": True, "path": str(snap_path), "bytes": len(text.encode("utf-8"))}

    # ── Debug snapshot (build-time helper) ─────────────────────────────
    # Lets Artem ship the live frontend state to Claude Code instead of a
    # screenshot: app/feed state, the visible rows (with computed flags), and
    # captured console errors/warnings.
    if kind == "debug":
        ctx = data.get("context") or {}
        errors = data.get("errors") or []
        rows = data.get("jobs") or []
        note = (data.get("note") or "").strip()
        lines = [
            f"# Falcon Scout DEBUG snapshot — {ts}",
            "",
            "## App state",
            f"- view: `{ctx.get('view')}`  ·  feed source: **{ctx.get('feedSource')}**",
            f"- filter: `{ctx.get('filter')}`  ·  query: `{ctx.get('query') or ''}`",
            f"- jobs visible: {ctx.get('jobCount')}  ·  selected job id: {ctx.get('selectedId')}",
            "",
        ]
        if note:
            lines += ["## Note from Artem", note, ""]
        if errors:
            lines.append(f"## Console errors / warnings (last {len(errors)})")
            for e in errors[:40]:
                lines.append(f"- {e}")
            lines.append("")
        if rows:
            lines.append(f"## Visible feed rows (first {len(rows)})")
            lines.append("| # | src | title | rate | country | enriched | applicants | verdict |")
            lines.append("|---|---|---|---|---|---|---|---|")
            for i, j in enumerate(rows, 1):
                lines.append(
                    f"| {i} | {j.get('source') or '-'} | {(j.get('title') or '')[:42]} | "
                    f"{j.get('rate') or '-'} | {j.get('country') or '-'} | "
                    f"{'YES' if j.get('enriched') else ''} | {j.get('proposals') or '-'} | "
                    f"{j.get('verdict') or '-'} |"
                )
            lines.append("")
        text = "\n".join(lines)
        snap_path.write_text(text, encoding="utf-8")
        return {"ok": True, "path": str(snap_path), "bytes": len(text.encode("utf-8"))}

    # ── Outcome / saved-proposal snapshot ─────────────────────────────
    if kind == "outcome":
        proposal = data.get("proposal_record") or {}
        job = data.get("job") or {}
        lines = [f"# Falcon Scout Outcome snapshot — {ts}", ""]
        if proposal:
            lines.append(f"## Saved proposal — id `{proposal.get('id')}`")
            lines.append(f"- status: **{proposal.get('status')}**")
            lines.append(f"- sent at: {proposal.get('sent_at')}  ·  status updated: {proposal.get('status_updated_at')}")
            if proposal.get("contract_value"):
                lines.append(f"- contract value: {proposal.get('contract_value')}")
            lines.append("")
            lines.append("### Sent cover-letter text")
            lines.append("```")
            lines.append(proposal.get("sent_text") or "")
            lines.append("```")
            lines.append("")
            if proposal.get("client_reply_text"):
                lines.append("### Client reply")
                lines.append("```")
                lines.append(proposal["client_reply_text"])
                lines.append("```")
                lines.append("")
            if proposal.get("notes"):
                lines.append(f"### Notes")
                lines.append(proposal["notes"])
                lines.append("")
        if job and job.get("id"):
            lines.append(f"## Linked job")
            lines.append(f"- title: **{job.get('title')}**")
            lines.append(f"- url: {job.get('url')}")
            lines.append(f"- rate: ${job.get('hourly_rate_min')}-${job.get('hourly_rate_max')}/hr · country: {job.get('client_country')}")
            lines.append(f"- hire rate: {job.get('hire_rate')}%  ·  already hired: {job.get('client_already_hired')}  ·  proposals: {job.get('proposals')}")
            lines.append("")
            lines.append("### Job description")
            lines.append(job.get("description_full") or job.get("raw_message") or "_(none)_")
            lines.append("")
        text = "\n".join(lines)
        snap_path.write_text(text, encoding="utf-8")
        return {"ok": True, "path": str(snap_path), "bytes": len(text.encode("utf-8"))}

    # ── Default: job snapshot ─────────────────────────────────────────
    job = data.get("job") or {}
    analysis = data.get("analysis")
    proposal = (data.get("proposal") or "").strip()
    saved = data.get("savedProposal")
    a_chat = data.get("analysisChat") or []
    p_chat = data.get("proposalChat") or []

    lines = []
    lines.append(f"# Falcon Scout snapshot — {ts}")
    lines.append("")

    # ── Job ───────────────────────────────────────────────────────────
    title = job.get("title") or "(untitled)"
    lines.append(f"## Job: {title}")
    lines.append(f"- DB id: `{job.get('id')}`  /  upwork id: `{job.get('upwork_job_id')}`")
    lines.append(f"- URL: {job.get('url')}")
    rate = (
        f"${job.get('hourly_rate_min')}-${job.get('hourly_rate_max')}/hr"
        if job.get("hourly_rate_min") else (job.get("fixed_budget") or "n/a")
    )
    lines.append(f"- Rate: {rate}  ·  Country: {job.get('client_country')}  ·  Geo restriction: {job.get('geo_restriction') or 'none'}")
    lines.append(
        f"- Client: {job.get('client_review_count', 0)} reviews / "
        f"{job.get('client_rating_score', 0)} rating · "
        f"{job.get('hire_rate', '?')}% hire rate · "
        f"spent {job.get('client_total_spent_detail') or 'unknown'} · "
        f"payment {'verified' if job.get('payment_verified') else 'NOT verified'}"
    )
    lines.append(
        f"- Activity: {job.get('proposals') or '?'} applicants · "
        f"{job.get('connects_required') or '?'} connects · "
        f"{job.get('interviewing') or 0} interviewing · "
        f"**{job.get('client_already_hired') or 0} already hired** · "
        f"{job.get('invites_sent') or 0} invites sent"
    )
    lines.append("")
    lines.append("### Full description")
    lines.append(job.get("description_full") or job.get("description_snippet") or job.get("raw_message") or "_(no description on file)_")
    lines.append("")

    # ── Analysis ──────────────────────────────────────────────────────
    if analysis:
        lines.append("## AI Analysis")
        lines.append(f"- **Verdict: {analysis.get('verdict')}**  ·  Score: **{analysis.get('score')}/10**")
        lines.append(f"- Summary: {analysis.get('summary')}")
        lines.append("- Reasons:")
        for r in (analysis.get("reasons") or []):
            lines.append(f"  - {r}")
        flags = analysis.get("flags") or []
        if flags:
            lines.append("- Flags:")
            for f in flags:
                lines.append(f"  - ⚠ {f}")
        lines.append("")
    else:
        lines.append("## AI Analysis")
        lines.append("_(no analysis run yet)_")
        lines.append("")

    # ── Analysis chat ─────────────────────────────────────────────────
    if a_chat:
        lines.append("## Analyser chat transcript")
        for m in a_chat:
            role = (m.get("role") or "").upper()
            content = m.get("content") or ""
            if content.startswith("⟳ Reworking"):
                continue
            lines.append(f"**{role}:**")
            lines.append(content)
            lines.append("")

    # ── Cover letter ──────────────────────────────────────────────────
    if proposal:
        lines.append("## Cover letter draft")
        lines.append("```")
        lines.append(proposal)
        lines.append("```")
        lines.append("")

    if saved:
        lines.append("### Saved proposal (Outcomes record)")
        lines.append(f"- Status: **{saved.get('status')}**")
        lines.append(f"- Sent at: {saved.get('sent_at')}")
        if saved.get("client_reply_text"):
            lines.append(f"- Client reply:")
            lines.append("```")
            lines.append(saved["client_reply_text"])
            lines.append("```")
        if saved.get("notes"):
            lines.append(f"- Notes: {saved['notes']}")
        lines.append("")

    if p_chat:
        lines.append("## Cover-letter chat transcript")
        for m in p_chat:
            role = (m.get("role") or "").upper()
            content = m.get("content") or ""
            if content.startswith("⟳ Reworking"):
                continue
            lines.append(f"**{role}:**")
            lines.append(content)
            lines.append("")

    text = "\n".join(lines)
    snap_path.write_text(text, encoding="utf-8")
    return {"ok": True, "path": str(snap_path), "bytes": len(text.encode("utf-8"))}


@app.post("/jobs/{job_id}/hide")
def hide_job(job_id: int):
    """Mark a job as hidden so it disappears from the default feed."""
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job.hidden_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(job)
        return _serialize(job)


@app.post("/jobs/{job_id}/unhide")
def unhide_job(job_id: int):
    """Restore a previously hidden job to the default feed."""
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job.hidden_at = None
        session.commit()
        session.refresh(job)
        return _serialize(job)


@app.post("/jobs/{job_id}/analysis")
def save_job_analysis(job_id: int, data: dict):
    """
    Upsert the most recent analyser result for a job.
    Called fire-and-forget by the frontend after each analyse / analysis_rescan
    call so that proposal-save can snapshot the contemporaneous verdict even
    when the user saves via a path that doesn't go through the React analyser
    column (e.g. auto-submit capture).

    Body: { verdict, score, summary, reasons, flags, model, ran_at }
    """
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job.last_analysis_json = _json_mod.dumps(data, ensure_ascii=False)
        job.last_analysis_at = datetime.now(timezone.utc)
        session.commit()
    return {"ok": True}


@app.post("/enrich")
def enrich_job(data: dict):
    """Receive enrichment data from the Chrome extension and update the matching job."""
    job_id_raw = data.get("job_id", "")
    url_raw = data.get("url", "")

    if not job_id_raw and not url_raw:
        raise HTTPException(status_code=400, detail="job_id or url required")

    # Normalize: strip ~ prefix
    job_id_clean = str(job_id_raw).lstrip("~").strip() if job_id_raw else ""

    with Session(engine) as session:
        job = None

        # 1. Try exact upwork_job_id match (with and without ~)
        if job_id_clean:
            job = session.query(Job).filter(
                or_(
                    Job.upwork_job_id == job_id_clean,
                    Job.upwork_job_id == "~" + job_id_clean,
                )
            ).first()

        # 2. Try URL substring match using the job id
        if not job and job_id_clean:
            all_jobs = session.query(Job).filter(Job.url.isnot(None)).all()
            for j in all_jobs:
                if j.url and job_id_clean in j.url:
                    job = j
                    break

        # 3. Try full URL match
        if not job and url_raw:
            all_jobs = session.query(Job).filter(Job.url.isnot(None)).all()
            for j in all_jobs:
                if j.url and (j.url.rstrip('/') == url_raw.rstrip('/') or
                              j.url.split('?')[0] == url_raw.split('?')[0]):
                    job = j
                    break

        # 4. Title match (bot stopped sending URLs - match against recent jobs)
        page_title = data.get("page_title", "")
        if not job and page_title:
            recent = session.query(Job).order_by(Job.captured_at.desc()).limit(100).all()
            pt_lower = page_title.lower().strip()
            for j in recent:
                if j.title and j.title.lower().strip() == pt_lower:
                    job = j
                    break
            if not job:
                pt_words = set(pt_lower.split())
                for j in recent:
                    if j.title:
                        jt_words = set(j.title.lower().split())
                        if len(pt_words & jt_words) >= min(3, len(pt_words)):
                            job = j
                            break

        if not job:
            # Job not in DB yet (browsed directly, not via Telegram bot) — create it
            page_title_for_create = page_title or (url_raw.split('/')[-1] if url_raw else "Unknown Job")
            job = Job(
                title=page_title_for_create,
                upwork_job_id=job_id_clean or None,
                url=url_raw.split('?')[0] if url_raw else None,
                raw_message=f"[enriched by extension] {page_title_for_create}",
                captured_at=datetime.now(timezone.utc),
            )
            session.add(job)
            session.flush()  # assign ID before updating fields below

        # Backfill URL and job_id from extension (bot stopped sending these)
        if url_raw and not job.url:
            job.url = url_raw.split('?')[0]
        if job_id_clean and not job.upwork_job_id:
            job.upwork_job_id = job_id_clean

        # Update all enrichment fields that were provided
        fields = [
            "experience_level", "hours_per_week", "duration", "project_type",
            "connects_required", "available_connects", "proposals",
            "last_viewed", "interviewing", "invites_sent", "unanswered_invites",
            "bid_high", "bid_average", "bid_low", "geo_restriction",
            "hire_rate", "payment_verified", "phone_verified",
            "client_rating_score", "client_review_count",
            "client_jobs_posted", "client_jobs_open",
            "client_hires", "client_active",
            "client_total_spent_detail", "client_avg_hourly_rate",
            "client_hours_billed", "client_member_since",
            "client_company_size", "client_industry", "client_city",
            "client_reviews", "screening_questions",
            "client_already_hired", "description_full", "preferred_qualifications",
        ]

        for field in fields:
            if field in data and data[field] is not None:
                setattr(job, field, data[field])

        job.enriched_at = datetime.now(timezone.utc)
        session.commit()

        return {
            "ok":         True,
            "job_id":     job.id,
            "title":      job.title,
            "proposals":  job.proposals,
            "hire_rate":  job.hire_rate,
            "avg_rate":   job.avg_rate,
            "enriched_at": job.enriched_at.isoformat() if job.enriched_at else None,
        }


# ── Knowledge Base ────────────────────────────────────────────────────────────
# See DESIGN.md sections 5, 8 (Phase 2), 12 for design rationale.

KB_VALID_TYPES = {
    "manual", "scraped", "sent_proposal", "client_reply",
    "chat_transcript", "rule", "note", "case_study", "blog_post",
}


def _serialize_kb(e: KBEntry) -> dict:
    # Rules are always-on directives, so they're implicitly Core. Surface that
    # in the API response so the UI shows the ★ CORE badge on every rule and
    # the count includes them without needing to set the flag manually.
    effective_core = bool(e.is_core) or e.type == "rule"
    return {
        "id": e.id,
        "type": e.type,
        "title": e.title,
        "content": e.content,
        "tags": e.tags,
        "source_url": e.source_url,
        "job_id": e.job_id,
        "is_core": effective_core,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


@app.get("/kb")
def list_kb_entries(
    q: Optional[str] = Query(None, description="Free-text search across title/content/tags"),
    type: Optional[str] = Query(None, description="Filter by entry type"),
    tag: Optional[str] = Query(None, description="Filter by single tag (CSV-substring match)"),
    job_id: Optional[int] = Query(None, description="Restrict to a specific job"),
    is_core: Optional[bool] = Query(None, description="If true, only Core entries; if false, only non-Core"),
    limit: Optional[int] = Query(None, description="Max entries to return (most recently updated first)"),
):
    with Session(engine) as session:
        stmt = select(KBEntry).order_by(KBEntry.updated_at.desc())
        if type:
            stmt = stmt.where(KBEntry.type == type)
        if tag:
            stmt = stmt.where(KBEntry.tags.ilike(f"%{tag}%"))
        if job_id is not None:
            stmt = stmt.where(KBEntry.job_id == job_id)
        if is_core is not None:
            if is_core:
                # Rules count as Core implicitly (they're directives), so the
                # filter is "is_core=true OR type='rule'".
                stmt = stmt.where(or_(KBEntry.is_core == True, KBEntry.type == "rule"))  # noqa: E712
            else:
                stmt = stmt.where(KBEntry.is_core == False, KBEntry.type != "rule")  # noqa: E712
        if q:
            term = f"%{q}%"
            stmt = stmt.where(
                or_(
                    KBEntry.title.ilike(term),
                    KBEntry.content.ilike(term),
                    KBEntry.tags.ilike(term),
                )
            )
        if limit and limit > 0:
            stmt = stmt.limit(limit)
        return [_serialize_kb(e) for e in session.scalars(stmt).all()]


@app.get("/kb/bundle")
def kb_bundle(
    type: Optional[str] = Query(None, description="Optional: only include this type"),
    tag: Optional[str] = Query(None, description="Optional: only include entries with this tag"),
):
    """
    Returns the concatenated KB as a single markdown blob ready to inject
    into a Claude system prompt. Lightweight (no body parsing on the client).
    """
    with Session(engine) as session:
        stmt = select(KBEntry).order_by(KBEntry.type, KBEntry.title)
        if type:
            stmt = stmt.where(KBEntry.type == type)
        if tag:
            stmt = stmt.where(KBEntry.tags.ilike(f"%{tag}%"))
        entries = list(session.scalars(stmt).all())

    if not entries:
        return {"bundle": "", "entry_count": 0}

    parts = ["# Knowledge Base"]
    for e in entries:
        header_bits = [f"## {e.title}"]
        meta_bits = [f"type: {e.type}"]
        if e.tags:
            meta_bits.append(f"tags: {e.tags}")
        if e.source_url:
            meta_bits.append(f"source: {e.source_url}")
        parts.append("\n".join(header_bits))
        parts.append("_" + " | ".join(meta_bits) + "_\n")
        parts.append((e.content or "").strip())
        parts.append("")  # blank line between entries

    return {"bundle": "\n".join(parts), "entry_count": len(entries)}


@app.get("/kb/{entry_id}")
def get_kb_entry(entry_id: int):
    with Session(engine) as session:
        e = session.get(KBEntry, entry_id)
        if not e:
            raise HTTPException(status_code=404, detail="KB entry not found")
        return _serialize_kb(e)


@app.post("/kb/parse-file")
async def parse_kb_file(file: UploadFile = File(...)):
    """Extract plain text from an uploaded file (.txt, .md, .docx, .csv, .json, .pdf)."""
    name = file.filename or ""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    raw = await file.read()
    if ext == "docx":
        try:
            import io
            from docx import Document
            doc = Document(io.BytesIO(raw))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not parse .docx: {exc}")
    elif ext == "pdf":
        # Use Claude's native PDF document API — works for both text-based and image-based PDFs
        api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")
        import base64, httpx as _httpx
        pdf_b64 = base64.standard_b64encode(raw).decode()
        try:
            async with _httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "anthropic-beta": "pdfs-2024-09-25",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 8096,
                        "messages": [{
                            "role": "user",
                            "content": [
                                {
                                    "type": "document",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "application/pdf",
                                        "data": pdf_b64,
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": (
                                        "Extract ALL text content from this PDF exactly as it appears. "
                                        "Preserve headings, bullet points, tables, and structure using markdown formatting. "
                                        "Do not summarise — output the full content verbatim. "
                                        "If the PDF contains images or screenshots with text, transcribe that text too."
                                    ),
                                },
                            ],
                        }],
                    },
                )
        except _httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="PDF extraction timed out (90s). Try a smaller or text-based PDF.")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Claude PDF extraction failed: {exc}")
        if not resp.is_success:
            raise HTTPException(status_code=502, detail=f"Claude API error {resp.status_code}: {resp.text[:300]}")
        result = resp.json()
        _record_usage("pdf_parse", "claude-sonnet-4-6", result)
        text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
        if not text.strip():
            raise HTTPException(status_code=422, detail="Claude could not extract text from this PDF")
    else:
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read file: {exc}")
    return {"text": text, "filename": name}


def _parse_md_texts(texts_iter, existing_urls: set):
    """
    Parse an iterable of (name, text) pairs from the IT Force WP export format.
    Returns (entries_to_add, skipped_count, errors_list).
    Mutates existing_urls in place so duplicates within the batch are also caught.
    """
    to_add = []
    skipped = 0
    errors = []

    for name, text in texts_iter:
        try:
            lines = text.split("\n")
            first = lines[0].strip() if lines else ""

            if "[CASE]" in first:
                entry_type = "case_study"
                raw_title = first.replace("# [CASE]", "").strip()
            elif "[BLOG]" in first:
                entry_type = "blog_post"
                raw_title = first.replace("# [BLOG]", "").strip()
            elif "[PAGE]" in first:
                entry_type = "blog_post"
                raw_title = first.replace("# [PAGE]", "").strip()
            else:
                entry_type = "blog_post"
                raw_title = first.lstrip("# ").strip() or name

            source_url = None
            category   = None
            for line in lines[1:30]:
                if line.startswith("- **URL:**"):
                    source_url = line.split("**URL:**", 1)[-1].strip()
                elif line.startswith("- **Категорія") or line.startswith("- **Category"):
                    category = line.split(":**", 1)[-1].strip()

            if source_url and source_url in existing_urls:
                skipped += 1
                continue

            type_label = "Case Study" if entry_type == "case_study" else "Blog"
            title = f"[{type_label}] {raw_title}"[:200]

            tags_parts = ["auto_imported"]
            if category:
                tags_parts.append(category[:80])

            to_add.append(KBEntry(
                type=entry_type,
                title=title,
                content=text.strip(),
                source_url=source_url,
                tags=", ".join(tags_parts),
            ))
            if source_url:
                existing_urls.add(source_url)

        except Exception as exc:
            errors.append({"file": name, "error": str(exc)})

    return to_add, skipped, errors


def _run_bulk_import(texts_iter):
    """Shared DB write for bulk import. texts_iter yields (name, text) tuples."""
    with Session(engine) as session:
        existing_urls = set(
            row[0] for row in session.execute(
                select(KBEntry.source_url).where(KBEntry.source_url.isnot(None))
            ).all()
        )
        to_add, skipped, errors = _parse_md_texts(texts_iter, existing_urls)
        for e in to_add:
            session.add(e)
        session.commit()
    return {"created": len(to_add), "skipped": skipped, "errors": errors[:20]}


@app.post("/kb/bulk-import-zip")
async def bulk_import_zip(file: UploadFile = File(...)):
    """Import a zip of .md files from the IT Force WP export."""
    import zipfile as _zip
    import io as _io

    raw = await file.read()
    try:
        zf = _zip.ZipFile(_io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Not a valid zip: {exc}")

    md_names = [n for n in zf.namelist() if n.endswith(".md")]
    if not md_names:
        raise HTTPException(status_code=422, detail="No .md files found in zip")

    def _iter():
        for n in md_names:
            yield n, zf.read(n).decode("utf-8", errors="replace")

    result = _run_bulk_import(_iter())
    result["total_files"] = len(md_names)
    return result


@app.post("/kb/bulk-import-folder")
async def bulk_import_folder(data: dict):
    """
    Import all .md files from a local folder path (recursive).
    Body: { "path": "D:/path/to/dataset-wp/uk" }
    Safe to call multiple times — deduplicates by source_url.
    """
    import glob as _glob

    folder = (data.get("path") or "").strip()
    if not folder:
        raise HTTPException(status_code=400, detail="path is required")

    folder_path = Path(folder)
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Folder not found: {folder}")

    md_files = list(folder_path.rglob("*.md"))
    if not md_files:
        raise HTTPException(status_code=422, detail="No .md files found in folder")

    def _iter():
        for p in md_files:
            yield p.name, p.read_text(encoding="utf-8", errors="replace")

    result = _run_bulk_import(_iter())
    result["total_files"] = len(md_files)
    return result


@app.post("/kb")
def create_kb_entry(data: dict):
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        raise HTTPException(status_code=400, detail="title and content are required")

    entry_type = (data.get("type") or "manual").strip()
    if entry_type not in KB_VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"type must be one of {sorted(KB_VALID_TYPES)}",
        )

    with Session(engine) as session:
        e = KBEntry(
            type=entry_type,
            title=title,
            content=content,
            tags=(data.get("tags") or None),
            source_url=(data.get("source_url") or None),
            job_id=data.get("job_id"),
            is_core=bool(data.get("is_core")),
        )
        session.add(e)
        session.commit()
        session.refresh(e)
        return _serialize_kb(e)


@app.put("/kb/{entry_id}")
def update_kb_entry(entry_id: int, data: dict):
    with Session(engine) as session:
        e = session.get(KBEntry, entry_id)
        if not e:
            raise HTTPException(status_code=404, detail="KB entry not found")

        if "type" in data:
            new_type = (data["type"] or "manual").strip()
            if new_type not in KB_VALID_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail=f"type must be one of {sorted(KB_VALID_TYPES)}",
                )
            e.type = new_type
        if "title" in data:
            new_title = (data["title"] or "").strip()
            if not new_title:
                raise HTTPException(status_code=400, detail="title cannot be empty")
            e.title = new_title
        if "content" in data:
            new_content = (data["content"] or "").strip()
            if not new_content:
                raise HTTPException(status_code=400, detail="content cannot be empty")
            e.content = new_content
        if "tags" in data:
            e.tags = (data["tags"] or None)
        if "source_url" in data:
            e.source_url = (data["source_url"] or None)
        if "job_id" in data:
            e.job_id = data["job_id"]
        if "is_core" in data:
            e.is_core = bool(data["is_core"])

        session.commit()
        session.refresh(e)
        return _serialize_kb(e)


@app.post("/kb/shrink")
async def shrink_kb_entry(data: dict):
    """
    Compress a KB entry's content with Claude while preserving every fact that
    matters for downstream analysis / proposal generation / chat grounding.

    Body:
      - content (str, required) — text to shrink
      - title   (str, optional) — for context only
      - type    (str, optional) — entry type, shapes the compression style
      - target_chars (int, optional, default 1500) — soft target for output size

    Returns: { content, original_chars, shrunk_chars, ratio }
    Does NOT persist — the frontend previews the result and the user accepts
    via the normal Save flow (so this stays an undoable, reviewable action).
    """
    import httpx as _httpx

    content = (data.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    title = (data.get("title") or "").strip()
    entry_type = (data.get("type") or "manual").strip()
    target_chars = int(data.get("target_chars") or 1500)
    target_chars = max(300, min(8000, target_chars))  # sane bounds

    api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")

    # Per-type guidance — preserves the right "shape" for each kind of entry.
    type_hint = {
        "case_study":    "preserve every metric, percentage, dollar amount, client name, vertical, tool used, timeline, and outcome",
        "sent_proposal": "preserve the cover letter's voice and opening hook; keep specific facts and numbers; drop pleasantries and filler",
        "client_reply":  "preserve the client's exact concerns, asks, and verbatim quotes that signal intent",
        "blog_post":     "preserve methodology steps, specific tactics, tool names, and any numbers; drop intros, conclusions, and SEO filler",
        "scraped":       "preserve facts, tools, and methodologies; drop marketing copy, repeated tagline phrases, and CTAs",
        "rule":          "tighten the wording without changing the rule's meaning, scope, or any condition (e.g. 'unless X')",
        "note":          "preserve every fact and insight; drop conversational scaffolding",
        "manual":        "preserve every fact, number, name, and concrete claim; drop adjectives, repeated framing, and connective filler",
    }.get(entry_type, "preserve every fact, number, name, and concrete claim; drop adjectives, repeated framing, and connective filler")

    prompt = f"""You are compressing a Knowledge Base entry used by an AI system to ground Upwork job analyses and cover-letter generation. The shorter the entry, the cheaper and faster every downstream call gets — but the entry must remain useful for grounding.

GOAL
Rewrite the entry below to target roughly {target_chars} characters (soft target, OK to be ±20%). The compressed version must remain a standalone reference document.

WHAT TO PRESERVE (non-negotiable)
- Every concrete fact: numbers, percentages, dollar amounts, dates, durations, client/project/tool names, verticals, geographies
- Every measurable outcome or result
- Every conditional clause in policies / rules ("unless", "except", "only when")
- Type-specific: {type_hint}

WHAT TO CUT
- Adjectives that don't add meaning ("amazing", "world-class", "comprehensive")
- Repeated explanations of the same point
- Marketing fluff, CTAs, taglines
- Connective filler ("furthermore", "it's important to note that", "in this section we will")
- Long narratives that become tighter as bullet lists

OUTPUT RULES
- Return ONLY the compressed markdown content. No preamble, no "Here's the compressed version", no meta-commentary.
- Prefer bullet lists over paragraphs when the original is enumeration-heavy
- Keep markdown headings if present in the original and they help structure the facts
- Never invent facts not in the source
- If the original is already at or below the target, return a lightly tightened version (don't pad)

---
Entry title: {title or '(untitled)'}
Entry type:  {entry_type}
Original length: {len(content):,} characters

ORIGINAL CONTENT:
{content}"""

    try:
        async with _httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    # Mechanical compression — Haiku is plenty. ~7× cheaper
                    # than Sonnet for the same job (handoff §"Yes to all").
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except _httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Claude API timed out (90s)")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude call failed: {exc}")

    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Claude API error {resp.status_code}: {resp.text[:300]}")

    result = resp.json()
    _record_usage("kb_shrink", "claude-haiku-4-5-20251001", result)
    shrunk = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text").strip()
    if not shrunk:
        raise HTTPException(status_code=502, detail="Claude returned empty content")

    return {
        "content": shrunk,
        "original_chars": len(content),
        "shrunk_chars": len(shrunk),
        "ratio": round(len(shrunk) / len(content), 3) if content else 0,
    }


@app.delete("/kb/{entry_id}")
def delete_kb_entry(entry_id: int):
    with Session(engine) as session:
        e = session.get(KBEntry, entry_id)
        if not e:
            raise HTTPException(status_code=404, detail="KB entry not found")
        session.delete(e)
        session.commit()
        return {"ok": True, "deleted_id": entry_id}


# ── Chat (Phase 2.5) ──────────────────────────────────────────────────────────

@app.post("/chat")
async def chat(request: dict):
    """
    Multi-turn chat with full KB context injected.
    Body: { messages: [{role, content}], job_id?: int }
    """
    import httpx
    import re as _re

    messages = request.get("messages", [])
    job_id = request.get("job_id")
    system_suffix = request.get("system_suffix", "")  # extra context / instructions from inline chats
    # core_only: when true, only inject rules + entries with is_core=true.
    # Used by "Rescan & Re-write" for a fast, cheap pass with curated context.
    core_only = bool(request.get("core_only"))

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")

    # ── Build KB bundle ────────────────────────────────────────────────────
    # Sectioned by type with priority framing so Claude treats rules as
    # directives (not background reading). Each type is rendered into its own
    # block with explicit guidance about how to use it.
    #
    # Excluded: blog_post (294 entries, too bulky for every chat call). Manual
    # entries that look like case studies / portfolio sit alongside case_study.
    _CHAT_KB_TYPES = {"rule", "feedback", "sent_proposal", "note", "manual", "case_study", "scraped", "client_reply"}
    with Session(engine) as session:
        stmt = (
            select(KBEntry)
            .where(KBEntry.type.in_(_CHAT_KB_TYPES))
            .order_by(KBEntry.type, KBEntry.title)
        )
        if core_only:
            # Rules are always included (they're directives); Core flag gates
            # everything else. Equivalent to: type='rule' OR is_core=True.
            stmt = stmt.where(or_(KBEntry.type == "rule", KBEntry.is_core == True))  # noqa: E712
        kb_entries = list(session.scalars(stmt).all())

    # Partition by intent
    rules           = [e for e in kb_entries if e.type == "rule"]
    case_studies    = [e for e in kb_entries if e.type == "case_study"]
    # Manual entries whose title looks like a portfolio/case-study artefact
    portfolio_like  = [
        e for e in kb_entries
        if e.type == "manual"
        and e.title
        and _re.search(r"case stud|portfolio|results|overview|client", e.title, _re.I)
    ]
    sent_proposals  = [e for e in kb_entries if e.type == "sent_proposal"]
    client_replies  = [e for e in kb_entries if e.type == "client_reply"]
    feedback_liked  = [e for e in kb_entries if e.type == "feedback" and e.tags and "liked" in (e.tags or "")]
    notes           = [e for e in kb_entries if e.type == "note"]
    scraped         = [e for e in kb_entries if e.type == "scraped"]
    misc_manual     = [e for e in kb_entries if e.type == "manual" and e not in portfolio_like]

    def _render(items, head_title, intro, per_item_cap=None):
        if not items:
            return ""
        out = [f"\n# {head_title}", intro, ""]
        for e in items:
            out.append(f"## {e.title}")
            if e.tags:
                out.append(f"_tags: {e.tags}_")
            content = (e.content or "").strip()
            if per_item_cap and len(content) > per_item_cap:
                content = content[:per_item_cap].rstrip() + "\n\n… [truncated]"
            out.append(content)
            out.append("")
        return "\n".join(out)

    # Build the sections in priority order — rules first so they sit near the
    # top of the system prompt where Claude weighs them most heavily.
    kb_sections = []

    if rules:
        # Rules are ordered by id (creation order) so the numbering stays
        # stable across calls and matches what the UI displays in My Rules.
        rules = sorted(rules, key=lambda r: r.id or 0)
        out = ["\n# CRITICAL RULES — read every one before responding"]
        out.append(
            "These rules are Artem's standing instructions. They override any "
            "general best-practice you might otherwise suggest. Apply them to "
            "every recommendation, every cover-letter edit, every analysis. "
            "If anything you're about to say conflicts with a rule, change "
            "your answer to comply with the rule. Do not paraphrase or weaken them.\n\n"
            "**Rule numbers are stable** — they match the My Rules panel, so when Artem "
            "says 'Rule 5' he means the 5th rule in this list. But in YOUR narration, "
            "DESCRIBE the rule by what it SAYS, never by a number you recall. Citing a "
            "number from memory ('applied Rule 27', 'this violates Rule 13') is the #1 "
            "source of hallucination here — you invent plausible-looking numbers that "
            "don't exist (there are only as many rules as appear in the list below, and "
            "KB entry IDs are NOT rule numbers). So: to reference a rule, paraphrase its "
            "content ('the no-CTA-closer rule', 'the audit-vs-launch guard'). Only state "
            "a specific number when you are literally walking the numbered list below "
            "during an explicit 'check the rules' request AND you can see that exact "
            "number in the list. If you cannot see the number in the list below, do NOT "
            "state any number.\n\n"
            "**ONLY the items in THIS section are rules.** Every other section below "
            "(case studies, notes, templates, manual entries, scraped content) is "
            "REFERENCE material — useful background, but NOT directives. Never cite "
            "a note or template as if it were a rule. Never invent rule numbers. When "
            "Artem asks you to 'check the rules', use ONLY the numbered list below — "
            "ignore everything else as a rule source."
        )
        out.append("")
        for i, r in enumerate(rules, 1):
            out.append(f"Rule {i}. {(r.content or '').strip()}")
        out.append("")
        kb_sections.append("\n".join(out))

    if case_studies or portfolio_like:
        all_cs = (portfolio_like + case_studies)[:6]  # cap count; portfolio-style first
        kb_sections.append(_render(
            all_cs,
            "Approved Case Studies & Portfolio",
            "These are the ONLY case studies you may reference, name, or suggest attaching. "
            "Never invent project names, metrics, client names, or results outside this list. "
            "If a relevant case study isn't here, say so — don't make one up.",
            per_item_cap=1200,
        ))

    if feedback_liked:
        kb_sections.append(_render(
            feedback_liked[:4],
            "Examples Artem Liked (style + reasoning to mirror)",
            "Match the voice, depth, and reasoning style shown in these examples when "
            "writing analyses or cover letters. Don't copy phrases verbatim — match the feel.",
            per_item_cap=900,
        ))

    if sent_proposals:
        kb_sections.append(_render(
            sent_proposals[:4],
            "Recent Cover Letters Artem Sent",
            "Use these as voice / structure reference for cover-letter work. "
            "Do not copy phrases verbatim — write fresh for the current job.",
            per_item_cap=600,
        ))

    if client_replies:
        kb_sections.append(_render(
            client_replies[:3],
            "Recent Client Replies",
            "How clients have responded to Artem's recent proposals. Useful for "
            "understanding what lands and what doesn't.",
            per_item_cap=500,
        ))

    if notes or misc_manual:
        kb_sections.append(_render(
            (notes + misc_manual)[:8],
            "Notes & Manual Entries",
            "Background notes Artem has captured. Reference when relevant.",
            per_item_cap=700,
        ))

    if scraped:
        # Scraped IT Force content — useful but bulky; truncate hard
        kb_sections.append(_render(
            scraped[:4],
            "IT Force Reference Material (scraped)",
            "Background reference about IT Force / Artem's professional context. "
            "Reference selectively when relevant.",
            per_item_cap=400,
        ))

    kb_text = "\n".join(kb_sections).strip()

    # Hard ceiling on total KB bytes to stay under the 30k input-tokens-per-minute
    # rate limit. ~1 token ≈ 4 chars, so 40k chars ≈ 10k tokens — leaves room for
    # job context, conversation history, and system instructions.
    _KB_MAX_CHARS = 40000
    if len(kb_text) > _KB_MAX_CHARS:
        kb_text = kb_text[:_KB_MAX_CHARS].rstrip() + "\n\n… [KB truncated to fit token budget]"

    # ── Build job context if per-job scope ─────────────────────────────────
    job_context = ""
    if job_id:
        with Session(engine) as session:
            j = session.get(Job, job_id)
            if j:
                rate = (f"${j.hourly_rate_min}–${j.hourly_rate_max}/hr"
                        if j.hourly_rate_min else j.fixed_budget or "not specified")
                job_context = "\n".join([
                    "\n## Current Job",
                    f"**Title:** {j.title}",
                    f"**Rate:** {rate}",
                    f"**Country:** {j.client_country or 'unknown'}",
                    f"**Freelancer geo restriction:** {j.geo_restriction or 'none'}",
                    f"**Category:** {j.category or 'unknown'}",
                    f"**Keywords:** {j.keywords or 'none'}",
                    f"**Client:** {j.client_review_count or 0} reviews, "
                    f"{j.client_rating_score or 0} rating, "
                    f"{j.hire_rate or '?'}% hire rate, "
                    f"payment {'verified' if j.payment_verified else 'NOT verified'}",
                    f"**Activity:** {j.proposals or '?'} proposals, "
                    f"{j.connects_required or '?'} connects",
                    f"**Description:**\n{(j.description_full or j.description_snippet or '')[:4000]}",
                ])

    # ── Assemble system prompt ─────────────────────────────────────────────
    parts = []
    if kb_text:
        parts.append(kb_text)
        parts.append("\n---\n")
        parts.append(
            "**Grounding rules (non-negotiable):**\n"
            "1. **Follow every CRITICAL RULE above.** If your draft response would "
            "contradict any rule, rewrite the response to comply. Mention which rule "
            "you're applying when it's relevant to the user's question.\n"
            "2. **Case studies must be cited verbatim from the Approved Case Studies "
            "section.** Never invent project names, metrics, percentages, client names, "
            "or results that aren't in that list. If no relevant case study exists, say "
            "\"no matching case study in the KB\" instead of fabricating one.\n"
            "3. **Use only capabilities, experience, and history that appear in the KB.** "
            "If asked about something not in the KB, say \"no record of that in the KB\" "
            "rather than guessing.\n"
            "4. **When refining a cover letter or analysis,** check it against every "
            "rule and every approved case study before responding. Treat the rules "
            "as a checklist.\n"
            "5. **NEVER invent rule violations.** When Artem asks you to 'check the "
            "rules', go through the numbered CRITICAL RULES list one by one and verify "
            "each one against the current draft. If a rule is satisfied, say so and "
            "move on. If a rule is violated, quote BOTH the rule text AND the offending "
            "line from the draft. Never cite a note, template, manual entry, or anything "
            "outside the numbered rules list as a rule. Never invent rule numbers. If you "
            "are unsure whether something is a rule, treat it as NOT a rule.\n"
            "6. **Notes, templates, and manual entries are reference, not directives.** "
            "You may suggest applying a template phrasing only if the user explicitly "
            "asks for it — never as a 'rule violation' fix.\n"
            "7. **Read rule TRIGGERS literally — never narrow them.** A rule that says "
            "'When the job posting mentions X' applies whenever X is mentioned in the "
            "posting. Do NOT add unstated qualifiers (e.g. 'mentions X *and is looking "
            "for Y*', 'mentions X *explicitly asking for Z*'). If the trigger condition "
            "as literally written is met by the posting or draft, the rule applies — "
            "full stop. The instruction in the rule's body is the RESPONSE the rule "
            "tells you to take; it is NOT an extra precondition on whether the rule "
            "applies. Example: if a rule says 'When the posting mentions they are an "
            "agency, position as a white-label partner' — the trigger is the mention of "
            "'agency', not whether the agency explicitly asks for white-label services. "
            "Apply the rule whenever the trigger word/phrase appears.\n"
            "8. **When checking a rule against a job posting, quote the posting verbatim** "
            "to justify your trigger decision. If the posting contains the rule's trigger "
            "phrase or an obvious synonym, the rule applies. If you cannot point to the "
            "literal trigger in the posting, only then can you say the rule does not apply."
        )
    if job_context:
        parts.append("\n---\n")
        parts.append(job_context)

    outcome_stats = _build_outcome_stats_prompt_section()
    if outcome_stats:
        parts.append("\n---\n")
        parts.append(outcome_stats)

    parts.append("\n---\n")
    parts.append(
        "You are a strategic assistant for Artem Yatsuk, a freelance Google Ads / "
        "PPC / SEO specialist (12 years, Google Ads expert, Shopify / ecommerce, "
        "GA4, GTM). Help him think through Upwork jobs, proposals, client situations, "
        "and build his knowledge base. Be direct, practical, and concise. "
        "Respond in the same language the user writes in.\n\n"
        "IMPORTANT: You have READ-ONLY access to the Knowledge Base shown above. "
        "You cannot save, update, or write anything to the KB or database. "
        "Never say you have saved, updated, or added anything to the KB — you cannot do that. "
        "If the user wants to save something (a refined proposal, a takeaway, a note), "
        "tell them to open the KB tab and add it manually there."
    )

    # Inline-chat callers can append extra context (analysis result, proposal draft)
    # and mode-specific instructions without overriding the KB-grounded base prompt.
    if system_suffix:
        parts.append("\n---\n")
        parts.append(system_suffix)

    system = "\n".join(parts)

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-5",
                    "max_tokens": 1500,
                    "system": system,
                    "messages": messages,
                },
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Claude API error: {response.text}",
                )
            import json as _json
            parsed = _json.loads(response.text)
            _record_usage("chat", "claude-sonnet-4-5", parsed)
            return parsed
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Claude API timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/distill")
async def chat_distill(request: dict):
    """
    Given a conversation, ask Claude to propose 1-3 KB entry candidates.
    Returns { candidates: [{title, type, tags, content}] }
    """
    import httpx
    import re as _re

    messages = request.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="messages required")

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")

    conversation_text = "\n\n".join([
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in messages
    ])

    distill_prompt = f"""Review this conversation and extract 1-3 knowledge base entries that capture the most valuable, reusable insights for future reference.

Return ONLY a JSON array — no markdown fences, no explanation, just the raw JSON.

Each entry object must have exactly these keys:
- "title": short descriptive label, max 60 chars
- "type": one of: manual, rule, note, sent_proposal, client_reply
- "tags": comma-separated tags string, or empty string
- "content": clean standalone markdown (no phrases like "in this conversation" — write as if it's a reference document)

Return [] if nothing meaningful is worth capturing.

---
Conversation:
{conversation_text}"""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-5",
                    "max_tokens": 2000,
                    "messages": [{"role": "user", "content": distill_prompt}],
                },
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Claude API error: {response.text}",
                )
            import json as _json
            data = _json.loads(response.text)
            _record_usage("distill", "claude-sonnet-4-5", data)
            text = data["content"][0]["text"]
            # Extract JSON array (handles any surrounding text)
            json_match = _re.search(r'\[[\s\S]*\]', text)
            if not json_match:
                return {"candidates": []}
            candidates = _json.loads(json_match.group())
            return {"candidates": candidates}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Proposals ────────────────────────────────────────────────────────────────
# See DESIGN.md sections 6 and 8 (Phase 5) for design.
#
# A Proposal is the unit of save-to-KB on the proposal column. Status is a
# column, not a separate KB section. Similarity matching (Phase 7) runs
# against job_snapshot_json, not the live Job row.

PROPOSAL_VALID_STATUSES = {
    "draft", "sent", "viewed", "replied", "interviewing",
    "hired", "declined", "ghosted", "expired", "withdrawn",
    "invited",   # client sent an invite and Artem applied in response
}


# The enriched-field subset we snapshot at save time. Includes:
#   - description_full   (canonical post-enrichment job description)
#   - description_snippet (truncated bot message)
#   - raw_message         (full Telegram bot capture — always present, this
#                          is the last-resort fallback for the Outcomes
#                          "📋 Job Posting" section when neither enriched
#                          description nor a proposal-page scrape is available)
# Excludes runtime metadata like enriched_at.
_SNAPSHOT_FIELDS = [
    "title", "url",
    "description_snippet", "description_full", "raw_message",
    "hourly_rate_min", "hourly_rate_max",
    "client_country", "client_spend", "posted_date", "category", "keywords",
    "avg_rate", "fixed_budget",
    "experience_level", "hours_per_week", "duration", "project_type",
    "connects_required", "proposals", "last_viewed",
    "interviewing", "invites_sent", "unanswered_invites",
    "bid_high", "bid_average", "bid_low", "geo_restriction",
    "hire_rate", "payment_verified", "phone_verified",
    "client_rating_score", "client_review_count",
    "client_jobs_posted", "client_jobs_open", "client_hires", "client_active",
    "client_total_spent_detail", "client_avg_hourly_rate",
    "client_hours_billed", "client_member_since", "client_company_size",
    "client_industry", "client_city", "client_reviews", "screening_questions",
    "preferred_qualifications",
]


def _snapshot_job(job: Job) -> str:
    """Serialize the enriched-field subset of a Job to a JSON string."""
    snap = {}
    for f in _SNAPSHOT_FIELDS:
        snap[f] = getattr(job, f, None)
    return _json_mod.dumps(snap, ensure_ascii=False, default=str)


def _serialize_proposal(p: Proposal) -> dict:
    snapshot = None
    if p.job_snapshot_json:
        try:
            snapshot = _json_mod.loads(p.job_snapshot_json)
        except Exception:
            snapshot = None
    return {
        "id": p.id,
        "job_id": p.job_id,
        "sent_text": p.sent_text,
        "status": p.status,
        "sent_at": p.sent_at.isoformat() if p.sent_at else None,
        "status_updated_at": p.status_updated_at.isoformat() if p.status_updated_at else None,
        "client_reply_text": p.client_reply_text,
        "contract_value": p.contract_value,
        "notes": p.notes,
        "job_snapshot": snapshot,
        "bid_amount": p.bid_amount,
        "bid_currency": p.bid_currency,
        "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "analysis_json": _json_mod.loads(p.analysis_json) if p.analysis_json else None,
    }


@app.get("/proposals")
def list_proposals(
    status: Optional[str] = Query(None, description="Filter by status — single or comma-separated (e.g. 'hired,replied,interviewing')"),
    job_id: Optional[int] = Query(None, description="Filter by job"),
    awaiting_reply: Optional[bool] = Query(False, description="status==sent AND no client reply"),
):
    with Session(engine) as session:
        stmt = select(Proposal).order_by(Proposal.sent_at.desc())
        if status:
            # Accept "hired" OR "hired,replied,interviewing". The Generator
            # uses the multi-status form to fetch winning proposals only.
            statuses = [s.strip() for s in status.split(",") if s.strip()]
            if len(statuses) == 1:
                stmt = stmt.where(Proposal.status == statuses[0])
            elif statuses:
                stmt = stmt.where(Proposal.status.in_(statuses))
        if job_id is not None:
            stmt = stmt.where(Proposal.job_id == job_id)
        if awaiting_reply:
            stmt = stmt.where(
                Proposal.status == "sent",
                or_(Proposal.client_reply_text.is_(None), Proposal.client_reply_text == ""),
            )
        rows = list(session.scalars(stmt).all())

        # Enrich each row with current Job data for display convenience —
        # the snapshot has its own copies, but live values are the canonical
        # source and let pre-fix proposals (whose snapshots predate the
        # description_full addition) still render the Job Posting section.
        out = []
        for p in rows:
            d = _serialize_proposal(p)
            j = session.get(Job, p.job_id)
            if j:
                d["job_title_live"] = j.title
                d["job_description_live"] = (
                    j.description_full or j.description_snippet or j.raw_message or None
                )
            else:
                d["job_title_live"] = None
                d["job_description_live"] = None
            out.append(d)
        return out


@app.get("/proposals/similar")
def similar_proposals(job_id: int = Query(..., description="ID of the job to find similar past proposals for")):
    """
    Return past proposals ranked by feature-overlap similarity to a given job.
    Scoring (weighted sum, max 8):
      +3  same Upwork top-level category
      +2  rate band overlap  (<$30 / $30-60 / $60+ / Fixed)
      +2  client spend tier overlap
      +1  country bucket overlap  (US / EU / Other)
    Returns up to 10 proposals, each with similarity_score and outcome signal.
    Only proposals with job_snapshot_json are considered.
    """
    with Session(engine) as session:
        # Load the target job
        target_job = session.get(Job, job_id)
        if not target_job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Build target feature vector
        target_snap = {
            "category":               getattr(target_job, "category", None),
            "client_total_spent_detail": getattr(target_job, "client_total_spent_detail", None),
            "client_country":         getattr(target_job, "client_country", None),
            "hourly_rate_max":        getattr(target_job, "hourly_rate_max", None),
            "hourly_rate_min":        getattr(target_job, "hourly_rate_min", None),
            "fixed_budget":           getattr(target_job, "fixed_budget", None),
        }
        t_category = (target_snap.get("category") or "").strip().lower()
        t_spend    = _spend_tier_label(_parse_spend_usd(target_snap.get("client_total_spent_detail")))
        t_rate     = _rate_band_label(target_snap)
        t_country  = _country_bucket_label(target_snap.get("client_country"))

        # Load all proposals that have a snapshot
        all_proposals = session.query(Proposal).filter(
            Proposal.job_snapshot_json.isnot(None),
            Proposal.job_id != job_id,          # exclude the target job itself
        ).all()

        # 'invited' is a positive signal too — the client picked Artem to apply,
        # which is stronger than a cold submission. Treated as winner-class
        # alongside replied/interviewing/hired.
        _POSITIVE_STATUSES = {"invited", "replied", "interviewing", "hired"}
        _COLD_STATUSES     = {"ghosted", "expired", "declined"}

        scored = []
        for p in all_proposals:
            try:
                snap = _json_mod.loads(p.job_snapshot_json)
            except Exception:
                continue

            score = 0
            p_category = (snap.get("category") or "").strip().lower()
            p_spend    = _spend_tier_label(_parse_spend_usd(snap.get("client_total_spent_detail")))
            p_rate     = _rate_band_label(snap)
            p_country  = _country_bucket_label(snap.get("client_country"))

            if t_category and p_category and t_category == p_category:
                score += 3
            if t_rate and p_rate and t_rate == p_rate:
                score += 2
            if t_spend and p_spend and t_spend == p_spend:
                score += 2
            if t_country and p_country and t_country == p_country:
                score += 1

            if score == 0:
                continue  # no overlap at all — skip

            snapshot_title = snap.get("title") or ""
            # client_reply_text is the strongest "this letter landed" signal —
            # the client actually wrote back. We send a 300-char preview so the
            # Generator can both (a) weight these as the top tier and (b) show
            # Claude the kind of response language a past letter triggered.
            reply_excerpt = (p.client_reply_text or "")[:300] if p.client_reply_text else ""
            scored.append({
                "proposal_id":      p.id,
                "job_id":           p.job_id,
                "job_title":        snapshot_title,
                "status":           p.status,
                "similarity_score": score,
                "sent_text_preview": (p.sent_text or "")[:400],
                "client_reply_text": reply_excerpt,
                "has_client_reply":  bool(reply_excerpt),
                "outcome_signal":   (
                    "positive" if p.status in _POSITIVE_STATUSES else
                    "cold"     if p.status in _COLD_STATUSES else
                    "pending"
                ),
                "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None,
            })

        # Sort by similarity desc, then prefer positive outcomes at equal score
        # 'invited' sits between replied and sent: client picked Artem (stronger
        # than a cold sent) but client has NOT yet responded post-submission
        # (weaker than replied).
        _STATUS_RANK = {"hired": 0, "interviewing": 1, "replied": 2, "invited": 3,
                        "sent": 4, "viewed": 5, "ghosted": 6, "expired": 7,
                        "declined": 8, "withdrawn": 9, "draft": 10}
        scored.sort(key=lambda x: (
            -x["similarity_score"],
            _STATUS_RANK.get(x["status"], 99),
        ))

        top = scored[:10]
        positive_count = sum(1 for r in top if r["outcome_signal"] == "positive")
        cold_count     = sum(1 for r in top if r["outcome_signal"] == "cold")

        return {
            "results":        top,
            "positive_count": positive_count,
            "cold_count":     cold_count,
            "total_matched":  len(scored),
        }


@app.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: int):
    with Session(engine) as session:
        p = session.get(Proposal, proposal_id)
        if not p:
            raise HTTPException(status_code=404, detail="Proposal not found")
        return _serialize_proposal(p)


@app.post("/proposals")
def create_proposal(data: dict):
    job_id = data.get("job_id")
    sent_text = (data.get("sent_text") or "").strip()
    if not job_id or not sent_text:
        raise HTTPException(status_code=400, detail="job_id and sent_text are required")

    status = (data.get("status") or "sent").strip()
    if status not in PROPOSAL_VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {sorted(PROPOSAL_VALID_STATUSES)}",
        )

    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        # If a proposal already exists for this job, update it instead of
        # creating a duplicate. Single proposal per job is the v1 model.
        existing = session.query(Proposal).filter_by(job_id=job_id).first()
        if existing:
            existing.sent_text = sent_text
            existing.status = status
            existing.status_updated_at = datetime.now(timezone.utc)
            # Refresh the snapshot — the user might have re-enriched and is saving again
            existing.job_snapshot_json = _snapshot_job(job)
            # analysis_json is immutable — never overwrite a snapshot that was
            # recorded at the original time of submission.
            session.commit()
            session.refresh(existing)
            return _serialize_proposal(existing)

        # Resolve analysis_json: body takes precedence; fall back to the most
        # recent analyser run cached on the Job (set by POST /jobs/{id}/analysis).
        raw_analysis = data.get("analysis_json")
        if raw_analysis:
            # Frontend sends a plain dict; serialise to string for storage.
            analysis_json_str = (
                _json_mod.dumps(raw_analysis, ensure_ascii=False)
                if isinstance(raw_analysis, dict) else str(raw_analysis)
            )
        elif job.last_analysis_json:
            analysis_json_str = job.last_analysis_json
        else:
            analysis_json_str = None

        p = Proposal(
            job_id=job_id,
            sent_text=sent_text,
            status=status,
            sent_at=datetime.now(timezone.utc),
            status_updated_at=datetime.now(timezone.utc),
            job_snapshot_json=_snapshot_job(job),
            client_reply_text=(data.get("client_reply_text") or None),
            contract_value=(data.get("contract_value") or None),
            notes=(data.get("notes") or None),
            analysis_json=analysis_json_str,
        )
        session.add(p)
        session.commit()
        session.refresh(p)
        return _serialize_proposal(p)


@app.put("/proposals/{proposal_id}")
def update_proposal(proposal_id: int, data: dict):
    with Session(engine) as session:
        p = session.get(Proposal, proposal_id)
        if not p:
            raise HTTPException(status_code=404, detail="Proposal not found")

        if "status" in data:
            new_status = (data["status"] or "").strip()
            if new_status not in PROPOSAL_VALID_STATUSES:
                raise HTTPException(
                    status_code=400,
                    detail=f"status must be one of {sorted(PROPOSAL_VALID_STATUSES)}",
                )
            p.status = new_status
            p.status_updated_at = datetime.now(timezone.utc)
        if "sent_text" in data:
            txt = (data["sent_text"] or "").strip()
            if not txt:
                raise HTTPException(status_code=400, detail="sent_text cannot be empty")
            p.sent_text = txt
        if "client_reply_text" in data:
            p.client_reply_text = (data["client_reply_text"] or None)
            # Convenience: if a reply is being added and status is still "sent",
            # bump it to "replied" automatically.
            if data["client_reply_text"] and p.status == "sent":
                p.status = "replied"
                p.status_updated_at = datetime.now(timezone.utc)
        if "contract_value" in data:
            p.contract_value = (data["contract_value"] or None)
        if "notes" in data:
            p.notes = (data["notes"] or None)
        if "bid_amount" in data:
            p.bid_amount   = (str(data["bid_amount"]).strip() if data["bid_amount"] is not None else None)
            p.bid_currency = ((data.get("bid_currency") or "USD").strip() if data["bid_amount"] is not None else None)

        session.commit()
        session.refresh(p)
        return _serialize_proposal(p)


@app.post("/proposal-submitted")
def record_proposal_submitted(data: dict):
    """
    Record an auto-captured proposal submission from the Chrome extension.
    Called when a user clicks "Submit proposal" on Upwork and we detect it.

    Args:
        job_id (int): Database job ID (not upwork_job_id)
        bid_amount (str): Bid amount as string, e.g. "4500"
        bid_currency (str): Currency code, e.g. "USD"
        submitted_at (str): ISO 8601 timestamp of submission
        sent_text (str): (optional) The proposal cover letter text
    """
    job_id = data.get("job_id")
    bid_amount = (data.get("bid_amount") or "").strip()
    bid_currency = (data.get("bid_currency") or "").strip()
    submitted_at_str = (data.get("submitted_at") or "").strip()

    if not job_id or not bid_amount or not bid_currency or not submitted_at_str:
        raise HTTPException(
            status_code=400,
            detail="job_id, bid_amount, bid_currency, and submitted_at are required"
        )

    try:
        submitted_at = datetime.fromisoformat(submitted_at_str.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid submitted_at timestamp")

    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        # Find or create proposal for this job
        existing = session.query(Proposal).filter_by(job_id=job_id).first()
        if existing:
            # Update with submission info (preserve client_reply_text, notes, etc.)
            existing.bid_amount = bid_amount
            existing.bid_currency = bid_currency
            existing.submitted_at = submitted_at
            # Overwrite the cover letter with the actual submitted text when
            # the scraper found one — the in-app draft may be slightly older
            # than what was finally sent on Upwork.
            scraped_sent_text = (data.get("sent_text") or "").strip()
            if scraped_sent_text:
                existing.sent_text = scraped_sent_text
            # Status promotion on submit:
            #   - draft → invited (if the letter is a thank-you-for-the-invite response)
            #   - draft → sent   (otherwise)
            #   - already 'sent' → 'invited' (catch case where the existing row
            #     was a placeholder created before the cover letter landed)
            if existing.status in ("draft", "sent"):
                effective_text = scraped_sent_text or existing.sent_text
                new_status = "invited" if _is_invite_response(effective_text) else (
                    "sent" if existing.status == "draft" else existing.status
                )
                if new_status != existing.status:
                    existing.status = new_status
                    existing.status_updated_at = datetime.now(timezone.utc)
            session.commit()
            session.refresh(existing)
            return _serialize_proposal(existing)

        # Create new proposal with minimal data from submission
        sent_text = (data.get("sent_text") or "").strip() or "(submitted via Upwork)"
        # Promote to 'invited' when the letter reads as a response to an invite.
        initial_status = "invited" if _is_invite_response(sent_text) else "sent"
        p = Proposal(
            job_id=job_id,
            sent_text=sent_text,
            status=initial_status,
            sent_at=datetime.now(timezone.utc),
            status_updated_at=datetime.now(timezone.utc),
            bid_amount=bid_amount,
            bid_currency=bid_currency,
            submitted_at=submitted_at,
            job_snapshot_json=_snapshot_job(job),
        )
        session.add(p)
        session.commit()
        session.refresh(p)
        return _serialize_proposal(p)


@app.delete("/proposals/{proposal_id}")
def delete_proposal(proposal_id: int):
    with Session(engine) as session:
        p = session.get(Proposal, proposal_id)
        if not p:
            raise HTTPException(status_code=404, detail="Proposal not found")
        session.delete(p)
        session.commit()
        return {"ok": True, "deleted_id": proposal_id}


@app.post("/proposal-status-sync")
def proposal_status_sync(data: dict):
    """
    Batch-update Proposal statuses from a scrape of Upwork's /nx/proposals/
    "Submitted proposals" page. Each row has:
      - upwork_job_id (optional — extracted from the job-link href)
      - job_title     (used as fallback match key)
      - viewed        (boolean — true if "Viewed by client" was shown)
      - initiated_at  (string, currently informational only)

    For each row we match a Proposal in our DB by upwork_job_id (Job → Proposal)
    first, then by job title. When viewed=true AND the Proposal's status is
    'sent' or 'draft', we promote it to 'viewed'. Existing 'replied' /
    'hired' / etc. statuses are NOT downgraded — the user (or the scrape of
    later tabs) handles those independently.
    """
    rows = data.get("rows") or []
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="`rows` must be a list")

    scanned = len(rows)
    updated = 0
    newly_viewed = 0
    not_matched = []

    # Statuses we're willing to PROMOTE to 'viewed'. Anything past 'viewed'
    # in the funnel (replied/interviewing/hired/etc.) stays put.
    _PROMOTABLE_TO_VIEWED = {"draft", "sent"}

    with Session(engine) as session:
        for row in rows:
            if not isinstance(row, dict):
                continue
            upwork_job_id = (row.get("upwork_job_id") or "").lstrip("~").strip()
            job_title = (row.get("job_title") or "").strip()
            viewed = bool(row.get("viewed"))

            # 1) Match by upwork_job_id → Job → Proposal
            matched_proposal = None
            matched_job = None
            if upwork_job_id:
                matched_job = session.query(Job).filter(
                    or_(
                        Job.upwork_job_id == upwork_job_id,
                        Job.upwork_job_id == "~" + upwork_job_id,
                    )
                ).first()
                if matched_job:
                    matched_proposal = (
                        session.query(Proposal)
                        .filter_by(job_id=matched_job.id)
                        .first()
                    )

            # 2) Fallback: match Job by exact-then-fuzzy title, then Proposal by job_id
            if not matched_proposal and job_title:
                matched_job = (
                    session.query(Job).filter(Job.title.ilike(job_title)).first()
                    or session.query(Job).filter(Job.title.ilike(f"%{job_title[:60]}%")).first()
                )
                if matched_job:
                    matched_proposal = (
                        session.query(Proposal)
                        .filter_by(job_id=matched_job.id)
                        .first()
                    )

            if not matched_proposal:
                not_matched.append({"upwork_job_id": upwork_job_id, "job_title": job_title})
                continue

            # Promote sent/draft → viewed when Upwork reports the client viewed it.
            # Never downgrade later-stage statuses.
            if viewed and matched_proposal.status in _PROMOTABLE_TO_VIEWED:
                matched_proposal.status = "viewed"
                matched_proposal.status_updated_at = datetime.now(timezone.utc)
                updated += 1
                newly_viewed += 1

        session.commit()

    return {
        "scanned": scanned,
        "updated": updated,
        "newly_viewed": newly_viewed,
        "not_matched_count": len(not_matched),
        # Cap the not_matched list in the response so a huge mismatch doesn't
        # bloat the log; the user only needs a sample for diagnosis.
        "not_matched_sample": not_matched[:10],
    }


# ── Helpers for inbox reply-matching (Upwork inbox shows client NAME, not the
# job title — so we join on the cover-letter greeting name) ──────────────────
_MSG_NONTITLE_RE = re.compile(r'^(?:\d|mon\b|tue|wed|thu|fri|sat|sun|today|yesterday)', re.I)
_MSG_STOPWORDS = {
    "llc", "ltd", "inc", "gmbh", "the", "and", "for", "you", "with", "d.o.o",
    "services", "digital", "concierge", "creative", "labs", "ventures",
    "providers", "online", "training", "agency", "marketing", "group",
    "studio", "media", "solutions", "corp", "team", "sun",
}


def _greeting_name(text: str) -> "str | None":
    """Pull the greeting first-name from a cover letter: 'Hi Susie - …' → 'susie'."""
    m = re.match(r"\s*(?:hi|hello|hey|dear)\s+([A-Za-z][A-Za-z'\-]{1,30})", (text or ""), re.I)
    return m.group(1).lower() if m else None


def _msg_identity_tokens(client_name: str, job_title: str) -> set:
    """Name tokens from the inbox row (both fields — the scraper mislabels them),
    dropping avatar initials (BF/CA), dates/timestamps, and generic company words."""
    out = set()
    for t in re.split(r"[,\s]+", f"{client_name or ''} {job_title or ''}"):
        t = t.strip().strip(".")
        if len(t) < 3:
            continue
        if re.fullmatch(r"[A-Z]{2,4}", t):      # avatar monogram like "BF"
            continue
        if re.search(r"\d", t):                  # dates / timestamps
            continue
        low = t.lower()
        if low in _MSG_STOPWORDS:
            continue
        out.add(low)
    return out


@app.post("/messages-status-sync")
def messages_status_sync(data: dict):
    """
    Batch-update Proposal statuses from a scrape of Upwork's `/nx/messages/`
    inbox. Each row has:
      - room_id, room_url      (the conversation URL)
      - client_name            (best-effort heuristic)
      - job_title              (best-effort heuristic)
      - has_unread             (bold/unread visual cue)

    A conversation EXISTING in the inbox for a job we have at sent / viewed
    / draft is strong evidence the client replied — we promote those rows
    to `replied`. We never downgrade later-stage statuses.
    """
    rows = data.get("rows") or []
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="`rows` must be a list")

    scanned = len(rows)
    updated = 0
    newly_replied = 0
    not_matched = []

    # 'invited' belongs here too: the client invited Artem, he applied, and now
    # a conversation exists in the inbox → the client wrote back → 'replied'
    # (rank 2) is a legitimate upgrade from 'invited' (rank 3). Without it, an
    # invited proposal never advances when the client actually responds.
    _PROMOTABLE_TO_REPLIED = {"draft", "sent", "viewed", "invited"}

    # Pre-compute each promotable proposal's greeting name from its cover letter
    # ("Hi Susie …" → "susie"). Upwork's inbox shows the client/company NAME (not
    # the job title), so the reliable join is: proposal greeting name ↔ a name
    # token in the inbox row. Done once, outside the row loop.
    with Session(engine) as session:
        promotable = (
            session.query(Proposal)
            .filter(Proposal.status.in_(list(_PROMOTABLE_TO_REPLIED)))
            .all()
        )
        greet_index = {}  # greeting_name -> [proposals]
        for p in promotable:
            gname = _greeting_name(p.sent_text)
            if gname:
                greet_index.setdefault(gname, []).append(p)

        for row in rows:
            if not isinstance(row, dict):
                continue
            job_title = (row.get("job_title") or "").strip()
            client_name = (row.get("client_name") or "").strip()
            upwork_job_id = (row.get("upwork_job_id") or "").lstrip("~").strip()

            proposal = None

            # 0) Strongest: upwork_job_id from the room walk (the extension now
            #    visits candidate rooms and reads the job link from each room's
            #    page — exact key, no fuzzy matching needed).
            if upwork_job_id:
                matched_job = session.query(Job).filter(
                    or_(
                        Job.upwork_job_id == upwork_job_id,
                        Job.upwork_job_id == "~" + upwork_job_id,
                    )
                ).first()
                if matched_job:
                    proposal = session.query(Proposal).filter_by(job_id=matched_job.id).first()

            # 1) Job-title match — kept for the rare case the inbox exposes a real
            #    title (mostly it doesn't; it shows the client/company name).
            if proposal is None and job_title and len(job_title) >= 5 and not _MSG_NONTITLE_RE.match(job_title):
                matched_job = (
                    session.query(Job).filter(Job.title.ilike(job_title)).first()
                    or session.query(Job).filter(Job.title.ilike(f"%{job_title[:60]}%")).first()
                )
                if matched_job:
                    proposal = session.query(Proposal).filter_by(job_id=matched_job.id).first()

            # 2) Client-name match — the reliable path. Both `client_name` and
            #    `job_title` fields can hold the conversation's name (the scraper
            #    mislabels them), so pull name tokens from BOTH, drop avatar
            #    initials/dates, and match a proposal's greeting name against them.
            #    Promote only on a UNIQUE hit to avoid mis-promoting.
            if proposal is None:
                tokens = _msg_identity_tokens(client_name, job_title)
                hits = []
                seen_ids = set()
                for tok in tokens:
                    for p in greet_index.get(tok, []):
                        if p.id not in seen_ids:
                            seen_ids.add(p.id)
                            hits.append(p)
                if len(hits) == 1:
                    proposal = hits[0]

            if proposal is None:
                not_matched.append({"job_title": job_title, "client_name": client_name})
                continue

            if proposal.status in _PROMOTABLE_TO_REPLIED:
                proposal.status = "replied"
                proposal.status_updated_at = datetime.now(timezone.utc)
                updated += 1
                newly_replied += 1

            # Store the inbox last-message preview as the card's reply text —
            # only when the client sent it last (not "You: …") and we don't
            # already have a (fuller) captured reply. A full reply comes from
            # the per-conversation capture; this is the quick bulk version.
            last_message = (row.get("last_message") or "").strip()
            last_from_client = bool(row.get("last_from_client"))
            if last_message and last_from_client and not (proposal.client_reply_text or "").strip():
                proposal.client_reply_text = last_message[:1000]

        session.commit()

    # Debug capture — dump the raw scraped rows + match outcome to a file so we
    # can see EXACTLY what the inbox gave us (client_name / job_title per row)
    # and why matching failed, without reading the fast-closing on-page banner.
    try:
        dbg = {
            "at": datetime.now(timezone.utc).isoformat(),
            "scanned": scanned,
            "newly_replied": newly_replied,
            "not_matched_count": len(not_matched),
            "rows": [
                {
                    "client_name": r.get("client_name"),
                    "job_title": r.get("job_title"),
                    "upwork_job_id": r.get("upwork_job_id"),
                    "has_unread": r.get("has_unread"),
                    "last_from_client": r.get("last_from_client"),
                    "last_message": (r.get("last_message") or "")[:120],
                }
                for r in rows if isinstance(r, dict)
            ],
            "not_matched": not_matched,
        }
        (ROOT / "messages_sync_debug.json").write_text(
            _json_mod.dumps(dbg, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as _e:
        print(f"[messages-sync] debug dump failed: {_e}")

    return {
        "scanned": scanned,
        "updated": updated,
        "newly_replied": newly_replied,
        "not_matched_count": len(not_matched),
        "not_matched_sample": not_matched[:10],
    }


# ── Outcome detection from captured messages ─────────────────────────────────
# We rank the funnel so we can promote (never downgrade) when a capture brings
# stronger evidence than the current Proposal status.
_STATUS_RANK = {
    "draft": 0, "sent": 1, "viewed": 2, "invited": 3,
    "replied": 4, "interviewing": 5, "hired": 6,
    "declined": 6, "ghosted": 6, "expired": 6, "withdrawn": 6,
}

# Regex patterns ordered hire → interviewing → replied. First-match wins. The
# blob fed in is the contract_status + cover letter + messages text from the
# capture, lower-cased once before matching.
import re as _re_mod
_HIRE_SIGNALS = [
    # An "Active contract" badge / "View contract" link in the sidebar is the
    # strongest signal — only shows when a contract is currently running.
    _re_mod.compile(r"\bactive\s+contract\b", _re_mod.I),
    _re_mod.compile(r"\bview\s+contract\b",   _re_mod.I),
    _re_mod.compile(r"\bcontract\s+(?:has\s+)?started\b", _re_mod.I),
    _re_mod.compile(r"\bcontract\s+(?:is\s+)?active\b",   _re_mod.I),
    _re_mod.compile(r"\bhired\s+you\b",       _re_mod.I),
    _re_mod.compile(r"\byou(?:'re|\s+were)\s+hired\b", _re_mod.I),
    # Agency rate-card / hourly offer pattern (Rate: $X/hr + Limit: N hrs/week)
    # almost always means the client has set up a paying contract.
    _re_mod.compile(r"rate:\s*\$\d[\d,]*(?:\.\d+)?\s*/?\s*hr", _re_mod.I),
    _re_mod.compile(r"limit:\s*\d+\s*hrs?\s*/\s*week", _re_mod.I),
    # "View offer" + a dollar amount in the same blob — common for accepted
    # offers that haven't been clicked yet but ARE active.
    _re_mod.compile(r"view\s+offer", _re_mod.I),
]

_INTERVIEW_SIGNALS = [
    _re_mod.compile(r"\binterview(?:ing)?\b",               _re_mod.I),
    _re_mod.compile(r"\bschedule\s+(?:a\s+)?call\b",        _re_mod.I),
    _re_mod.compile(r"\bjump\s+on\s+(?:a\s+)?call\b",       _re_mod.I),
    _re_mod.compile(r"\bhop\s+on\s+(?:a\s+)?call\b",        _re_mod.I),
    _re_mod.compile(r"\bzoom\s+(?:call|meeting|link)\b",    _re_mod.I),
    _re_mod.compile(r"\bgoogle\s+meet\b",                   _re_mod.I),
    _re_mod.compile(r"\bcalendly\b",                        _re_mod.I),
    _re_mod.compile(r"\bavailable\s+(?:to|for)\s+(?:a\s+)?(?:call|chat|meeting)\b", _re_mod.I),
]

_INVITE_SIGNALS = [
    # Cover-letter openings that explicitly thank/acknowledge an invite. These
    # phrases only land when the freelancer is responding to a client-sent
    # invitation (not a cold application), so detection here is high-precision.
    _re_mod.compile(r"\bthank(?:s| you)(?:\s+(?:so\s+much|very\s+much))?\s+for\s+(?:the|your|this)\s+(?:kind\s+)?(?:invite|invitation)\b", _re_mod.I),
    _re_mod.compile(r"\bthank(?:s| you)(?:\s+(?:so\s+much|very\s+much))?\s+for\s+inviting\s+me\b", _re_mod.I),
    _re_mod.compile(r"\bappreciate\s+(?:the|your|this)\s+(?:invite|invitation)\b", _re_mod.I),
    _re_mod.compile(r"\b(?:in\s+)?(?:response|responding|reply(?:ing)?)\s+to\s+your\s+(?:invite|invitation)\b", _re_mod.I),
    _re_mod.compile(r"\bgrateful\s+for\s+(?:the|your)\s+(?:invite|invitation)\b", _re_mod.I),
]

_DECLINE_SIGNALS = [
    # "We went with / chose / selected / picked someone else"
    _re_mod.compile(r"\bwent\s+with\s+(?:another|a\s+different|someone\s+else)\b", _re_mod.I),
    _re_mod.compile(r"\bselected\s+(?:another|a\s+different|someone\s+else)\b",    _re_mod.I),
    _re_mod.compile(r"\bwe(?:'ve|\s+have)\s+selected\b",                            _re_mod.I),
    _re_mod.compile(r"\bdecided\s+to\s+go\s+with\b",                               _re_mod.I),
    _re_mod.compile(r"\bchose\s+(?:another|a\s+different|someone\s+else)\b",        _re_mod.I),
    # "Filling internally / no longer hiring"
    _re_mod.compile(r"\bfilling\s+(?:this\s+role\s+)?internally\b",                _re_mod.I),
    _re_mod.compile(r"\bno\s+longer\s+(?:hiring|looking|accepting)\b",             _re_mod.I),
    # "We've closed / paused / cancelled this position"
    _re_mod.compile(r"\b(?:closed|paused|cancelled|canceled)\s+(?:this\s+)?(?:position|role|job|posting)\b", _re_mod.I),
    _re_mod.compile(r"\bwe(?:'ve|\s+have)\s+closed\s+this\b",                      _re_mod.I),
    # Polite rejections
    _re_mod.compile(r"\bthank\s+you\s+for\s+your\s+interest,?\s+but\b",            _re_mod.I),
    _re_mod.compile(r"\bbest\s+of\s+luck\s+(?:with\s+your\s+(?:search|future))\b", _re_mod.I),
    _re_mod.compile(r"\bwe(?:'ll)?\s+(?:keep|have\s+kept)\s+your\s+(?:profile|proposal)\s+on\s+file\b", _re_mod.I),
    _re_mod.compile(r"\bnot\s+(?:moving\s+forward|proceeding)\s+with\s+your\b",    _re_mod.I),
]


def _is_invite_response(sent_text: str | None) -> bool:
    """True if the cover letter text reads like a response to a client-sent
    invite (Rule for status='invited'). Tight precision — only fires on
    explicit thank-for-invite / responding-to-invite phrases."""
    if not sent_text:
        return False
    return any(rx.search(sent_text) for rx in _INVITE_SIGNALS)


def _detect_status_from_capture(*parts) -> str | None:
    """
    Detect the strongest funnel signal in a captured conversation. Returns
    one of {'hired','interviewing','declined','replied'} or None if no signal found.

    Args are joined with newlines before scanning so callers can pass
    contract_status, cover letter, messages, sidebar text etc. separately.
    Check order: hire → interview → decline → replied (explicit rejection beats
    generic "client wrote back" heuristic).
    """
    blob = "\n".join((p or "") for p in parts)
    if not blob.strip():
        return None
    if any(rx.search(blob) for rx in _HIRE_SIGNALS):
        return "hired"
    if any(rx.search(blob) for rx in _INTERVIEW_SIGNALS):
        return "interviewing"
    if any(rx.search(blob) for rx in _DECLINE_SIGNALS):
        return "declined"
    # If we got ANY conversation text at all, that's at minimum a "replied"
    # signal — the client wrote back. Use a light heuristic: at least one
    # client-attributed line.
    if _re_mod.search(r"\[\s*client\s*\]|^\s*client:\s", blob, _re_mod.I | _re_mod.M):
        return "replied"
    return None


def _upsert_proposal_status(session, job, new_status: str, source: str,
                            sent_text_hint: str | None = None,
                            client_reply_text: str | None = None):
    """
    Promote (never downgrade) a Proposal's status for the given Job, and store
    the captured client reply text on it. Creates a Proposal row if none exists.
    Returns the Proposal when ANYTHING changed (status promoted OR reply stored),
    else None.

    The reply text is set INDEPENDENTLY of the status promotion: a conversation
    capture should populate the card's response field even when the status is
    already at/past the detected one (e.g. already 'interviewing' but we just
    grabbed the reply text). Capture is treated as the source of truth for the
    reply, so it overwrites a previously-captured value.
    """
    if not job or not new_status:
        return None
    new_rank = _STATUS_RANK.get(new_status, -1)
    if new_rank < 0:
        return None
    reply = (client_reply_text or "").strip() or None
    proposal = session.query(Proposal).filter_by(job_id=job.id).first()
    if proposal:
        changed = False
        cur_rank = _STATUS_RANK.get(proposal.status or "", -1)
        if new_rank > cur_rank:
            proposal.status = new_status
            proposal.status_updated_at = datetime.now(timezone.utc)
            print(f"[capture] promoted proposal {proposal.id} → {new_status} (source: {source})")
            changed = True
        if reply and reply != (proposal.client_reply_text or ""):
            proposal.client_reply_text = reply
            print(f"[capture] stored client reply on proposal {proposal.id} ({len(reply)} chars)")
            changed = True
        return proposal if changed else None
    # No proposal yet — create one. sent_text is the captured cover letter
    # if we have it, otherwise a placeholder so the column doesn't break.
    proposal = Proposal(
        job_id=job.id,
        sent_text=(sent_text_hint or "(captured retroactively from messages — no cover letter on file)").strip(),
        status=new_status,
        client_reply_text=reply,
        sent_at=datetime.now(timezone.utc),
        status_updated_at=datetime.now(timezone.utc),
        job_snapshot_json=_snapshot_job(job),
    )
    session.add(proposal)
    session.flush()
    print(f"[capture] created retroactive proposal {proposal.id} for job {job.id} → {new_status} (source: {source})")
    return proposal


@app.post("/capture-conversation")
async def capture_conversation(data: dict):
    """
    Receive a scraped Upwork messaging conversation from the Chrome extension.
    Uses Claude to parse it into structured sections (job posting / cover letter /
    client response) and saves as a KB entry of type sent_proposal.
    Returns the saved KBEntry.
    """
    import httpx as _httpx
    import json as _json
    import re as _re

    url             = (data.get("url") or "").strip()
    room_id         = (data.get("room_id") or "").strip()
    job_title       = (data.get("job_title") or "").strip()
    raw_text        = (data.get("raw_text") or "").strip()
    dom_msgs        = data.get("messages")   # optional list of {role, text} from DOM
    client_name     = (data.get("client_name") or "").strip()
    client_company  = (data.get("client_company") or "").strip()
    contract_status = (data.get("contract_status") or "").strip()
    job_url         = (data.get("job_url") or "").strip()

    # Canonical URL: strip query params so the same room always deduplicates
    # e.g. /ab/messages/rooms/room_abc?pageTitle=...&sidebar=true → /ab/messages/rooms/room_abc
    url_for_dedup = url.split('?')[0] if url else ''

    if not raw_text and not dom_msgs:
        raise HTTPException(status_code=400, detail="raw_text or messages required")

    api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")

    # Build the text block that Claude will parse
    if dom_msgs:
        msg_block = "\n\n".join(
            f"[{'ARTEM' if m.get('role') == 'artem' else 'CLIENT'}]\n{m.get('text', '')}".strip()
            for m in dom_msgs
        )
        parse_input = f"Job title: {job_title}\n\n--- Messages ---\n{msg_block}"
    else:
        # Use raw page text. We keep the FIRST ~7k chars (cover letter + early
        # follow-ups — the part scrollToStart pinned to the top) and ALSO the
        # LAST ~3k chars (most recent exchange — useful for outcome detection
        # like "you've been hired" or rate-bump messages). This gives Claude
        # both ends of long-running threads without blowing past the 120s
        # parse budget on the full 12-14k char dump.
        if len(raw_text) > 10000:
            parse_input = raw_text[:7000] + "\n\n[... mid-thread truncated ...]\n\n" + raw_text[-3000:]
        else:
            parse_input = raw_text

    prompt = f"""You are parsing text scraped from a single Upwork messaging thread.
The user is Artem Yatsuk (freelancer). His messages appear as "You", "Artem Yatsuk", or [ARTEM].

RULES:
- Ignore any header UI text (time stamps, button labels, etc.) — focus only on message content.
- job_title: infer from the header chip or the context of the cover letter (e.g. job category/role mentioned). The pre-extracted value may be wrong — use it only if it looks like a real job title.
- cover_letter: Artem's FIRST message ONLY (his original application/proposal). Do NOT include later follow-ups.
- messages: ALL messages AFTER the cover letter, in chronological order, from BOTH parties. Format each as "[Artem]: text" or "[Client]: text". Separate with \\n---\\n. Empty string if none.
- job_posting: full original job description only if explicitly visible; otherwise empty string.

Return ONLY a valid JSON object — no markdown fences:
{{
  "job_title": "actual job title (e.g. 'Paid Ads Auditor & Performance Analyst'), inferred from conversation if needed",
  "job_posting": "full job description if visible in the thread, otherwise empty string",
  "cover_letter": "Artem's first message only",
  "messages": "[Artem]: ...\\n---\\n[Client]: ...\\n---\\n[Artem]: ... (empty string if no follow-ups)"
}}

Pre-extracted title hint (may be wrong): "{job_title}"

---
{parse_input}"""

    try:
        async with _httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-5",
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except _httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Claude parsing timed out (120s)")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude call failed: {exc}")

    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"Claude API error {resp.status_code}: {resp.text[:300]}")

    result_json = resp.json()
    _record_usage("capture", "claude-sonnet-4-5", result_json)
    text_out = "".join(
        b.get("text", "") for b in result_json.get("content", []) if b.get("type") == "text"
    )

    json_match = _re.search(r'\{[\s\S]*\}', text_out)
    if not json_match:
        raise HTTPException(status_code=502, detail="Unexpected response from Claude")

    try:
        parsed = _json.loads(json_match.group())
    except Exception:
        raise HTTPException(status_code=502, detail="Could not parse Claude JSON response")

    title        = (parsed.get("job_title") or job_title or "").strip()
    job_posting  = (parsed.get("job_posting") or "").strip()
    cover_letter = (parsed.get("cover_letter") or "").strip()
    messages_txt = (parsed.get("messages") or "").strip()

    # Cover letter is optional — for active contracts the original application may be
    # too far back in the virtual-scroll window. Always set a placeholder so the
    # section exists in the stored content and the frontend parser works correctly.
    if not cover_letter:
        cover_letter = "(Cover letter not visible — open the conversation on Upwork, scroll to the very first message, then re-capture)"

    if not title:
        scraped_at = data.get("scraped_at", "")
        title = f"Conversation {scraped_at[:10]}" if scraped_at else "Captured Conversation"

    # Preserve the bare job title BEFORE we append the " — Client Name" suffix.
    # The job-matching block below must search Jobs by the real posting title;
    # matching against the suffixed string ("… — Rashida Ali-Campbell") never
    # hits because no Job row carries the client name (this silently broke
    # status promotion on every captured reply — see job 1405).
    match_title = title

    # Suffix the client name (and company when distinct) into the KB entry
    # title so the Outcomes list reads "Job title — Client Name" at a glance.
    # Done after the placeholder fallback so even title-less captures still
    # get tagged with whoever they came from.
    # Skip if the title already contains the client name to keep re-captures
    # idempotent (otherwise we'd accumulate " — Klemen — Klemen — …").
    def _norm(s: str) -> str:
        return _re.sub(r"\s+", " ", (s or "")).strip().lower()
    _ntitle = _norm(title)
    if client_name and _norm(client_name) not in _ntitle:
        suffix = client_name
        # Only append the company if it's NOT already part of the client name
        # ("Klemen Rozman, Vivano d.o.o." sometimes scrapes as the full string
        # into client_name and an empty client_company — handle both shapes).
        if client_company and _norm(client_company) not in _norm(suffix) \
                          and _norm(client_company) not in _ntitle:
            suffix = f"{suffix}, {client_company}"
        title = f"{title} — {suffix}"

    # Build structured content in the standard sent_proposal format
    jp_section = job_posting if job_posting else f"(Job: {title})"
    if job_url:
        jp_section += f"\n\nJob URL: {job_url}"
    content = f"## Job Posting\n{jp_section}\n\n## Cover Letter\n{cover_letter}"
    if messages_txt:
        content += f"\n\n## Messages\n{messages_txt}"

    # Client info section — useful for future analysis
    activity_timeline = (data.get("activity_timeline") or "").strip()
    client_parts = []
    if client_name:        client_parts.append(f"Name: {client_name}")
    if client_company:     client_parts.append(f"Company: {client_company}")
    if contract_status:    client_parts.append(f"Contract: {contract_status}")
    if activity_timeline:  client_parts.append(f"Timeline: {activity_timeline}")
    if client_parts:
        content += f"\n\n## Client\n" + "\n".join(client_parts)

    with Session(engine) as session:
        # Upsert: match by room_id (most reliable) or canonical URL (strip query params)
        existing = None
        if room_id:
            # room_id is embedded in the URL path; match any entry whose source_url
            # contains this room_id so re-captures always update the same row
            existing = (
                session.query(KBEntry)
                .filter(KBEntry.source_url.contains(room_id))
                .order_by(KBEntry.created_at.desc())
                .first()
            )
        if not existing and url_for_dedup:
            # Fallback: match by canonical URL (no query string)
            existing = (
                session.query(KBEntry)
                .filter(KBEntry.source_url.startswith(url_for_dedup))
                .order_by(KBEntry.created_at.desc())
                .first()
            )

        if existing:
            existing.title      = title
            existing.content    = content
            existing.type       = "sent_proposal"   # fix legacy cover_letter entries
            existing.source_url = url_for_dedup or existing.source_url
            existing.updated_at = datetime.now(timezone.utc)
            kb_was_updated = True
            kb_entry = existing
        else:
            kb_entry = KBEntry(
                type="sent_proposal",
                title=title,
                content=content,
                source_url=url_for_dedup or url or None,
            )
            session.add(kb_entry)
            kb_was_updated = False

        # ── Detect outcome signal and promote the linked Proposal ────────
        # Hire signals win over interview signals which win over replied.
        # We scan: extension-supplied contract_status, the parsed cover
        # letter, the parsed messages text, AND the raw page text — that
        # catches sidebar UI labels ("View offer", "Rate: $30/hr", etc.)
        # that the Claude parser intentionally drops as UI noise.
        detected_status = _detect_status_from_capture(
            contract_status,
            activity_timeline,   # Sidebar timeline lives outside the thread DOM
                                 # so it's NOT inside raw_text — must pass it
                                 # explicitly or "Contract started: May 20" is
                                 # invisible to the detector.
            cover_letter,
            messages_txt,
            raw_text,
        )
        # Extract the CLIENT's reply text from the parsed messages so it can be
        # stored on the proposal (drives the card's "● response received" + the
        # reply field, and the [REPLY-WINNER] generator tier). messages_txt is
        # "[Artem]: …\n---\n[Client]: …\n---\n…" — pull every [Client] block.
        client_reply = ""
        if messages_txt:
            client_blocks = []
            for block in messages_txt.split("---"):
                b = block.strip()
                m = _re.match(r"^\[\s*client\s*\]\s*:?\s*(.*)$", b, _re.I | _re.S)
                if m and m.group(1).strip():
                    client_blocks.append(m.group(1).strip())
            client_reply = "\n\n".join(client_blocks).strip()

        matched_job = None
        promoted = None
        if detected_status:
            # Fuzzy-match a Job by title (exact, then substring). Use the bare
            # match_title (pre client-name suffix) — the suffixed `title` never
            # matches a Job row. job_url would be more precise but is rarely set
            # on retroactive captures.
            if match_title:
                matched_job = (
                    session.query(Job).filter(Job.title.ilike(match_title)).first()
                    or session.query(Job).filter(Job.title.ilike(f"%{match_title[:60]}%")).first()
                )
            if not matched_job and job_url:
                # Try to pull a job id out of the linked URL
                m = re.search(r"~([0-9a-zA-Z]{10,})", job_url)
                if m:
                    upwork_id = m.group(1)
                    matched_job = session.query(Job).filter(
                        or_(Job.upwork_job_id == upwork_id, Job.upwork_job_id == "~" + upwork_id)
                    ).first()
            promoted = _upsert_proposal_status(
                session, matched_job, detected_status,
                source=f"capture-conversation (signal: {detected_status})",
                sent_text_hint=cover_letter if cover_letter and len(cover_letter) > 40 else None,
                client_reply_text=client_reply or None,
            ) if matched_job else None
            if matched_job and not promoted:
                print(f"[capture-conversation] no Proposal promotion (already at or past '{detected_status}')")
            if title and not matched_job:
                print(f"[capture-conversation] no Job matched for retroactive capture: {title[:80]!r}")

        session.commit()
        session.refresh(kb_entry)
        return {
            **_serialize_kb(kb_entry),
            "_updated": kb_was_updated,
            "_detected_status": detected_status,
            "_matched_job_id": matched_job.id if matched_job else None,
            "_proposal_status_after": promoted.status if promoted else None,
            "_client_reply_chars": len(client_reply or ""),
        }


@app.post("/capture-standalone-proposal")
async def capture_standalone_proposal(data: dict):
    """
    Create or update a KB sent_proposal entry from the standalone proposal page
    (/nx/proposals/[id]). Used for active-contract conversations where the
    cover letter isn't visible in the messages thread.

    Match strategy (in order):
      1. Existing entry with this proposal URL stored
      2. Existing entry with matching job title (case-insensitive)
      3. Create a new entry
    """
    proposal = data.get("proposal") or {}
    url      = (data.get("url") or "").strip()

    job_title    = (proposal.get("job_title") or "").strip()
    cover_letter = (proposal.get("cover_letter") or "").strip()
    job_desc     = (proposal.get("job_description") or "").strip()
    upwork_job_id = (proposal.get("upwork_job_id") or "").lstrip("~").strip()

    if not job_title and not cover_letter:
        raise HTTPException(status_code=400, detail="Need at least job_title or cover_letter")

    # Title sanity check — the extension's heading walker on /nx/proposals/{id}
    # sometimes grabs the "Insights" badge or other page chrome instead of the
    # actual job title. If the captured title looks suspicious AND we have an
    # upwork_job_id, prefer looking the job up by id and using ITS title as
    # the canonical source.
    _TITLE_SUSPICIOUS_RE = re.compile(
        r"^(insights|insights\s+new|proposal\s+details|view\s+job\s+posting|posting|cover\s+letter|details|new|sent|saved|view|edit|freelancer(\s+plus(\s+new)?)?|plus(\s+new)?|premium|enterprise|business\s+plus|connects?|boost|boosted|hiring\s+activity|job\s+details|skills\s+and\s+expertise)$",
        re.IGNORECASE | re.DOTALL,
    )
    title_looks_suspicious = bool(job_title) and (
        len(job_title) < 8 or _TITLE_SUSPICIOUS_RE.match(job_title.replace("\n", " ").strip()) is not None
    )
    if title_looks_suspicious and upwork_job_id:
        with Session(engine) as _session:
            _hit = _session.query(Job).filter(
                or_(
                    Job.upwork_job_id == upwork_job_id,
                    Job.upwork_job_id == "~" + upwork_job_id,
                )
            ).first()
            if _hit and _hit.title:
                job_title = _hit.title

    # Extract proposal id from URL for matching
    proposal_id = ""
    m = re.search(r"/proposals/(\d{8,})", url)
    if m:
        proposal_id = m.group(1)

    # Eager job lookup so we can use the matched Job's stored description as
    # a fallback when proposal.js couldn't scrape one from the page. (The
    # second, definitive matched_job lookup later in the function uses the
    # same logic; this one is just for content-building.)
    _early_matched_job = None
    with Session(engine) as _s:
        if upwork_job_id:
            _early_matched_job = _s.query(Job).filter(
                or_(Job.upwork_job_id == upwork_job_id, Job.upwork_job_id == "~" + upwork_job_id)
            ).first()
        if not _early_matched_job and job_title:
            _early_matched_job = _s.query(Job).filter(Job.title.ilike(job_title)).first()
            if not _early_matched_job:
                _early_matched_job = _s.query(Job).filter(Job.title.ilike(f"%{job_title[:60]}%")).first()

    # Decide what goes into the "## Job Posting" section. Priority:
    #   1. Description scraped from this proposal page (freshest)
    #   2. Matched local Job's description_full / description_snippet / raw_message
    #   3. Last-resort placeholder so the section isn't empty
    effective_job_desc = job_desc
    if not effective_job_desc and _early_matched_job:
        effective_job_desc = (
            _early_matched_job.description_full
            or _early_matched_job.description_snippet
            or _early_matched_job.raw_message
            or ""
        ).strip()

    # Build the Job Posting section (full description + competition)
    jp_lines = [effective_job_desc] if effective_job_desc else [f"(Job: {job_title})"]
    extras = []
    if proposal.get("proposals_count"):
        extras.append(f"Proposals: {proposal['proposals_count']}")
    if proposal.get("interviewing") is not None:
        extras.append(f"Interviewing: {proposal['interviewing']}")
    if proposal.get("invites_sent") is not None:
        extras.append(f"Invites sent: {proposal['invites_sent']}")
    if proposal.get("unanswered_invites") is not None:
        extras.append(f"Unanswered invites: {proposal['unanswered_invites']}")
    if proposal.get("last_viewed"):
        extras.append(f"Last viewed: {proposal['last_viewed']}")
    if proposal.get("bid_high"):
        extras.append(
            f"Bids — High: ${proposal['bid_high']} · "
            f"Avg: ${proposal.get('bid_avg', '?')} · "
            f"Low: ${proposal.get('bid_low', '?')}"
        )
    if extras:
        jp_lines.append("")
        jp_lines.append("### Competition")
        jp_lines.extend(extras)
    job_posting_section = "\n".join(jp_lines)

    # Build the Client section
    client_lines = []
    if proposal.get("payment_verified"):
        client_lines.append("Payment: ✓ Verified")
    elif proposal.get("payment_verified") is False:
        client_lines.append("Payment: ✗ Not verified")
    if proposal.get("phone_verified"):
        client_lines.append("Phone: ✓ Verified")
    if proposal.get("client_rating"):
        client_lines.append(f"Rating: {proposal['client_rating']} ({proposal.get('client_reviews', '?')} reviews)")
    if proposal.get("hire_rate") is not None:
        client_lines.append(f"Hire rate: {proposal['hire_rate']}%")
    if proposal.get("client_jobs_posted") is not None:
        client_lines.append(f"Jobs posted: {proposal['client_jobs_posted']}")
    if proposal.get("client_jobs_open") is not None:
        client_lines.append(f"Open jobs: {proposal['client_jobs_open']}")
    if proposal.get("client_total_spent"):
        client_lines.append(f"Total spent: {proposal['client_total_spent']}")
    if proposal.get("client_hires") is not None:
        client_lines.append(f"Hires: {proposal['client_hires']} ({proposal.get('client_active', 0)} active)")
    if proposal.get("client_avg_hourly_rate"):
        client_lines.append(f"Avg hourly paid: ${proposal['client_avg_hourly_rate']}/hr")
    if proposal.get("client_hours_billed") is not None:
        client_lines.append(f"Hours billed: {proposal['client_hours_billed']}")
    if proposal.get("client_member_since"):
        client_lines.append(f"Member since: {proposal['client_member_since']}")
    if proposal.get("client_location"):
        client_lines.append(f"Location: {proposal['client_location']}")
    if proposal.get("client_company_size"):
        client_lines.append(f"Company size: {proposal['client_company_size']}")
    if proposal.get("my_bid"):
        client_lines.append(f"My bid: {proposal['my_bid']}")
    client_section = "\n".join(client_lines)

    # Assemble content
    content = f"## Job Posting\n{job_posting_section}\n\n## Cover Letter\n"
    content += cover_letter if cover_letter else "(Cover letter not captured)"
    if client_section:
        content += f"\n\n## Client\n{client_section}"

    title = job_title or "Captured Proposal"

    with Session(engine) as session:
        # Match strategies
        existing = None
        if proposal_id:
            existing = (
                session.query(KBEntry)
                .filter(KBEntry.source_url.contains(proposal_id))
                .order_by(KBEntry.created_at.desc())
                .first()
            )
        if not existing and job_title:
            existing = (
                session.query(KBEntry)
                .filter(KBEntry.type == "sent_proposal")
                .filter(KBEntry.title.ilike(job_title))
                .order_by(KBEntry.created_at.desc())
                .first()
            )

        if existing:
            # Merge: update content sections, preserve existing Messages section
            existing_messages_match = re.search(r"## Messages\n([\s\S]*?)(?=\n## |$)", existing.content or "")
            if existing_messages_match:
                content = content.replace(
                    "\n\n## Client\n",
                    f"\n\n## Messages\n{existing_messages_match.group(1).strip()}\n\n## Client\n",
                    1,
                ) if "## Client\n" in content else content + f"\n\n## Messages\n{existing_messages_match.group(1).strip()}"

            # Preserve a " — Client Name" suffix already on the existing title
            # (set by /capture-conversation when the user captured the chat
            # first). The standalone proposal page doesn't expose client name,
            # so without this we'd strip the suffix on every re-capture.
            if existing.title and " — " in existing.title and " — " not in title:
                _, _, existing_suffix = existing.title.partition(" — ")
                if existing_suffix.strip():
                    title = f"{title} — {existing_suffix.strip()}"

            existing.title      = title
            existing.content    = content
            existing.type       = "sent_proposal"
            existing.source_url = url or existing.source_url
            existing.updated_at = datetime.now(timezone.utc)
            session.commit()
            session.refresh(existing)
            kb_payload = {**_serialize_kb(existing), "_updated": True}
        else:
            e = KBEntry(
                type="sent_proposal",
                title=title,
                content=content,
                source_url=url or None,
            )
            session.add(e)
            session.commit()
            session.refresh(e)
            kb_payload = {**_serialize_kb(e), "_updated": False}

        # ── ALSO create / update a Proposal (Outcomes) row when possible ──
        # The manual-capture flow used to write only to KB, leaving Outcomes
        # empty. Now we try to match the job (upwork_job_id first, title
        # second) and create a Proposal row with status=sent so it appears
        # in the Outcomes tab immediately.
        matched_job = None
        if upwork_job_id:
            matched_job = session.query(Job).filter(
                or_(
                    Job.upwork_job_id == upwork_job_id,
                    Job.upwork_job_id == "~" + upwork_job_id,
                )
            ).first()
        if not matched_job and job_title:
            # Case-insensitive exact match first, then substring as a fallback.
            matched_job = session.query(Job).filter(Job.title.ilike(job_title)).first()
            if not matched_job:
                matched_job = session.query(Job).filter(Job.title.ilike(f"%{job_title[:60]}%")).first()

        # ── Auto-create a Job row if we couldn't match — Invite-only jobs
        # never come through the Telegram bot feed, so they have no Job row
        # in our local DB. Without one, the proposal capture would live in
        # KB but never in Outcomes. Create the Job from the scraped data so
        # the proposal is properly tracked in the funnel.
        # Guardrails: only auto-create when we have BOTH a real-looking
        # upwork_job_id (21+ chars to match Upwork's job-id format) AND
        # substantive title + description. Otherwise we risk creating
        # garbage Job rows from partial scrapes.
        if not matched_job and upwork_job_id and len(upwork_job_id) >= 18 and job_title and len(job_title) >= 8:
            print(f"[capture-standalone-proposal] auto-creating Job row for "
                  f"upwork_job_id={upwork_job_id}, title={job_title[:60]!r}")
            now = datetime.now(timezone.utc)
            job_url = f"https://www.upwork.com/jobs/~{upwork_job_id}"
            # Coerce numeric fields defensively — proposal.js may send strings
            def _as_int(v):
                try:
                    if v is None or v == "": return None
                    return int(str(v).replace(",", "").strip())
                except Exception:
                    return None
            def _as_float(v):
                try:
                    if v is None or v == "": return None
                    return float(str(v).replace(",", "").strip())
                except Exception:
                    return None
            new_job = Job(
                upwork_job_id=upwork_job_id,
                title=job_title,
                url=job_url,
                description_full=(job_desc or None),
                # Schema requires raw_message non-null — synthesise a marker
                # so it's clear this Job came from a proposal capture, not
                # a bot post.
                raw_message=f"[auto-created from proposal capture] {job_title}\n\n{job_desc or ''}".strip(),
                captured_at=now,
                enriched_at=now,
                # Client + competition data from the scrape
                payment_verified=proposal.get("payment_verified"),
                phone_verified=proposal.get("phone_verified"),
                client_rating_score=_as_float(proposal.get("client_rating")),
                client_review_count=_as_int(proposal.get("client_reviews")),
                hire_rate=_as_int(proposal.get("hire_rate")),
                client_jobs_posted=_as_int(proposal.get("client_jobs_posted")),
                client_jobs_open=_as_int(proposal.get("client_jobs_open")),
                client_hires=_as_int(proposal.get("client_hires")),
                client_active=_as_int(proposal.get("client_active")),
                client_total_spent_detail=(proposal.get("client_total_spent") or None),
                client_avg_hourly_rate=_as_float(proposal.get("client_avg_hourly_rate")),
                client_hours_billed=_as_int(proposal.get("client_hours_billed")),
                client_member_since=(proposal.get("client_member_since") or None),
                client_company_size=(proposal.get("client_company_size") or None),
                client_city=(proposal.get("client_location") or None),
                # Activity metrics
                proposals=(proposal.get("proposals_count") or None),
                interviewing=_as_int(proposal.get("interviewing")),
                invites_sent=_as_int(proposal.get("invites_sent")),
                unanswered_invites=_as_int(proposal.get("unanswered_invites")),
                last_viewed=(proposal.get("last_viewed") or None),
                bid_high=_as_float(proposal.get("bid_high")),
                bid_average=_as_float(proposal.get("bid_avg")),
                bid_low=_as_float(proposal.get("bid_low")),
            )
            session.add(new_job)
            session.flush()
            matched_job = new_job
            print(f"[capture-standalone-proposal] auto-created Job id={new_job.id}")

        # If we found a matched Job, its title is the canonical truth — the
        # extension's heading walker can produce garbage like "Insights New"
        # on the proposal-details page. Write the matched Job's title back to
        # the KB entry so it lines up with reality (otherwise re-captures
        # keep renaming the KB entry every time the page changes).
        if matched_job and matched_job.title:
            canonical_title = matched_job.title
            kb_id = kb_payload.get("id")
            if kb_id:
                kb_row = session.get(KBEntry, kb_id)
                if kb_row and kb_row.title != canonical_title:
                    kb_row.title = canonical_title
                    kb_row.updated_at = datetime.now(timezone.utc)
                    session.commit()
                    session.refresh(kb_row)
                    kb_payload = {**_serialize_kb(kb_row), "_updated": kb_payload.get("_updated", False)}

        proposal_payload = None
        if matched_job:
            sent_text = cover_letter or "(Cover letter not captured)"
            bid_amount   = (proposal.get("my_bid") or "").strip() or None
            bid_currency = (proposal.get("bid_currency") or "USD").strip() or "USD"

            # Persist the scraped job description onto the Job row when it's
            # substantive and the Job doesn't already have one. This is the
            # ONLY way to capture the original posting for jobs that were
            # never enriched — and it's what makes the "Job Posting" section
            # appear in the Outcomes UI (sourced from the snapshot).
            if job_desc and len(job_desc) > 80 and not (matched_job.description_full or "").strip():
                matched_job.description_full = job_desc
                session.flush()

            # ── Backfill client/activity columns from the scrape ────────────
            # Bug fixed 2026-05-26: when a Job row already existed (Telegram
            # bot capture), this endpoint only ever wrote `description_full`
            # to it. Scraped client_total_spent, hire_rate, client_rating etc.
            # went only into KB content text — invisible to the analyser,
            # stats, similarity matching, snapshot. Now we fill any column
            # on the Job that's currently NULL with the scraped equivalent.
            # Never OVERWRITE non-null fields — existing /enrich data wins.
            def _as_int(v):
                try:
                    if v is None or v == "": return None
                    return int(str(v).replace(",", "").strip())
                except Exception:
                    return None
            def _as_float(v):
                try:
                    if v is None or v == "": return None
                    return float(str(v).replace(",", "").strip())
                except Exception:
                    return None
            _backfill_pairs = [
                ("payment_verified",         proposal.get("payment_verified")),
                ("phone_verified",           proposal.get("phone_verified")),
                ("client_rating_score",      _as_float(proposal.get("client_rating"))),
                ("client_review_count",      _as_int(proposal.get("client_reviews"))),
                ("hire_rate",                _as_int(proposal.get("hire_rate"))),
                ("client_jobs_posted",       _as_int(proposal.get("client_jobs_posted"))),
                ("client_jobs_open",         _as_int(proposal.get("client_jobs_open"))),
                ("client_hires",             _as_int(proposal.get("client_hires"))),
                ("client_active",            _as_int(proposal.get("client_active"))),
                ("client_total_spent_detail",(proposal.get("client_total_spent") or None)),
                ("client_avg_hourly_rate",   _as_float(proposal.get("client_avg_hourly_rate"))),
                ("client_hours_billed",      _as_int(proposal.get("client_hours_billed"))),
                ("client_member_since",      (proposal.get("client_member_since") or None)),
                ("client_company_size",      (proposal.get("client_company_size") or None)),
                ("client_city",              (proposal.get("client_location") or None)),
                ("proposals",                (proposal.get("proposals_count") or None)),
                ("interviewing",             _as_int(proposal.get("interviewing"))),
                ("invites_sent",             _as_int(proposal.get("invites_sent"))),
                ("unanswered_invites",       _as_int(proposal.get("unanswered_invites"))),
                ("last_viewed",              (proposal.get("last_viewed") or None)),
                ("bid_high",                 _as_float(proposal.get("bid_high"))),
                ("bid_average",              _as_float(proposal.get("bid_avg"))),
                ("bid_low",                  _as_float(proposal.get("bid_low"))),
            ]
            backfilled = []
            for col, val in _backfill_pairs:
                if val is None or val == "":
                    continue
                current = getattr(matched_job, col, None)
                # Only fill when the column is blank — never trample real
                # enrichment data. Booleans need explicit None check because
                # False is a legitimate value we don't want to overwrite.
                if current is None or (isinstance(current, str) and not current.strip()):
                    setattr(matched_job, col, val)
                    backfilled.append(col)
            if backfilled:
                # Stamp enriched_at so downstream filters ("Enriched" view) see
                # this Job as enriched too.
                matched_job.enriched_at = matched_job.enriched_at or datetime.now(timezone.utc)
                session.flush()
                print(f"[capture-standalone-proposal] backfilled Job {matched_job.id} fields: {', '.join(backfilled)}")

            existing_p = session.query(Proposal).filter_by(job_id=matched_job.id).first()
            if existing_p:
                # Refresh cover letter first (so invite detection below sees the
                # latest text). Only when we extracted one (don't wipe a
                # manually-edited sent_text with an empty placeholder).
                if cover_letter and len(cover_letter) > 30:
                    existing_p.sent_text = cover_letter
                # Preserve status if the user has already promoted past 'sent'
                # (e.g. replied/hired). Promote draft/sent → invited when the
                # letter is a response to a client invite; otherwise draft → sent.
                if existing_p.status in ("draft", "sent"):
                    effective_text = existing_p.sent_text or ""
                    new_status = "invited" if _is_invite_response(effective_text) else (
                        "sent" if existing_p.status == "draft" else existing_p.status
                    )
                    if new_status != existing_p.status:
                        existing_p.status = new_status
                        existing_p.status_updated_at = datetime.now(timezone.utc)
                # Only set bid if not already recorded — never overwrite a
                # manually-set or stash-captured value with a page-scraped one.
                if bid_amount and existing_p.bid_amount is None:
                    existing_p.bid_amount   = bid_amount
                    existing_p.bid_currency = bid_currency
                if not existing_p.submitted_at:
                    existing_p.submitted_at = datetime.now(timezone.utc)
                existing_p.job_snapshot_json = _snapshot_job(matched_job)
                session.commit()
                session.refresh(existing_p)
                proposal_payload = _serialize_proposal(existing_p)
            else:
                now = datetime.now(timezone.utc)
                initial_status = "invited" if _is_invite_response(sent_text) else "sent"
                p = Proposal(
                    job_id=matched_job.id,
                    sent_text=sent_text,
                    status=initial_status,
                    sent_at=now,
                    submitted_at=now,
                    status_updated_at=now,
                    bid_amount=bid_amount or None,
                    bid_currency=(bid_currency if bid_amount else None),
                    job_snapshot_json=_snapshot_job(matched_job),
                )
                session.add(p)
                session.commit()
                session.refresh(p)
                proposal_payload = _serialize_proposal(p)

        # Surface backfill diagnostics so the user can SEE whether the Job
        # row actually received client data on this capture. Without this,
        # a "no log line + nothing changed" result is indistinguishable from
        # "backend not reloaded + my code never ran" — which is what hit us
        # in the 2026-05-26 Google Ads job 821 debugging cycle.
        job_state = None
        if matched_job:
            job_state = {
                "id": matched_job.id,
                "client_total_spent_detail": matched_job.client_total_spent_detail,
                "client_rating_score": matched_job.client_rating_score,
                "client_review_count": matched_job.client_review_count,
                "hire_rate": matched_job.hire_rate,
                "payment_verified": matched_job.payment_verified,
                "enriched_at": matched_job.enriched_at.isoformat() if matched_job.enriched_at else None,
            }

        return {
            **kb_payload,
            "_proposal_created": proposal_payload is not None,
            "_proposal": proposal_payload,
            "_matched_job_id": matched_job.id if matched_job else None,
            # Empty list = matched_job's fields were ALL already populated
            # (everything skipped). Missing key = code path never reached
            # (backend not reloaded → still running old code). Compare to
            # tell the difference.
            "_backfilled_fields": (backfilled if matched_job else []),
            "_job_state_after": job_state,
        }


@app.post("/capture-proposal-update")
async def capture_proposal_update(data: dict):
    """
    Merge proposal-page data into an existing KB sent_proposal entry.
    Called after the conversation has been captured and the proposal.js
    content script has scraped the "View proposal" page.

    The KB entry is matched by room_id (or kb_id as fallback). We update
    the content's sections in-place: replace the cover-letter placeholder,
    enrich the Job Posting with the full description and competition stats,
    and rewrite the Client section with all the profile data.
    """
    room_id  = (data.get("room_id") or "").strip()
    kb_id    = data.get("kb_id")
    proposal = data.get("proposal") or {}
    url      = (data.get("url") or "").strip()

    if not room_id and not kb_id:
        raise HTTPException(status_code=400, detail="room_id or kb_id required")

    with Session(engine) as session:
        # Match by kb_id first (most precise), then room_id
        entry = None
        if kb_id:
            entry = session.get(KBEntry, kb_id)
        if not entry and room_id:
            entry = (
                session.query(KBEntry)
                .filter(KBEntry.source_url.contains(room_id))
                .order_by(KBEntry.created_at.desc())
                .first()
            )
        if not entry:
            raise HTTPException(status_code=404, detail="KB entry not found")

        content = entry.content or ""

        # ── Section helpers ───────────────────────────────────────────────
        # Replace or append a markdown ## section
        def upsert_section(text: str, heading: str, new_body: str) -> str:
            pattern = re.compile(
                r"## " + re.escape(heading) + r"\n[\s\S]*?(?=\n## |$)",
                re.MULTILINE,
            )
            new_block = f"## {heading}\n{new_body.strip()}"
            if pattern.search(text):
                return pattern.sub(new_block, text, count=1)
            return text.rstrip() + "\n\n" + new_block

        # ── 1. Cover letter — replace placeholder with real text ─────────
        cover_letter = (proposal.get("cover_letter") or "").strip()
        if cover_letter and len(cover_letter) > 30:
            content = upsert_section(content, "Cover Letter", cover_letter)

        # ── 2. Job Posting — replace stub with full description + bits ──
        job_desc = (proposal.get("job_description") or "").strip()
        if job_desc and len(job_desc) > 30:
            jp_lines = [job_desc]
            extras = []
            if proposal.get("proposals_count"):
                extras.append(f"Proposals: {proposal['proposals_count']}")
            if proposal.get("interviewing") is not None:
                extras.append(f"Interviewing: {proposal['interviewing']}")
            if proposal.get("invites_sent") is not None:
                extras.append(f"Invites sent: {proposal['invites_sent']}")
            if proposal.get("unanswered_invites") is not None:
                extras.append(f"Unanswered invites: {proposal['unanswered_invites']}")
            if proposal.get("last_viewed"):
                extras.append(f"Last viewed: {proposal['last_viewed']}")
            if proposal.get("bid_high"):
                extras.append(
                    f"Bids — High: ${proposal['bid_high']} · "
                    f"Avg: ${proposal.get('bid_avg', '?')} · "
                    f"Low: ${proposal.get('bid_low', '?')}"
                )
            if extras:
                jp_lines.append("")
                jp_lines.append("### Competition")
                jp_lines.extend(extras)
            content = upsert_section(content, "Job Posting", "\n".join(jp_lines))

        # ── 3. Client — rewrite with full profile ────────────────────────
        # Extract existing Name / Company / Contract / Timeline to preserve them
        existing_client = {}
        existing_match = re.search(r"## Client\n([\s\S]*?)(?=\n## |$)", content)
        if existing_match:
            for line in existing_match.group(1).splitlines():
                kv = re.match(r"^([^:]+):\s*(.+)$", line.strip())
                if kv:
                    existing_client[kv.group(1).strip()] = kv.group(2).strip()

        client_lines = []
        def add(label, value, fmt=str):
            if value is not None and value != "":
                client_lines.append(f"{label}: {fmt(value)}")

        # Preserve any previously captured fields the proposal page doesn't show
        if "Name" in existing_client:    add("Name", existing_client["Name"])
        if "Company" in existing_client: add("Company", existing_client["Company"])

        if proposal.get("payment_verified"):
            client_lines.append("Payment: ✓ Verified")
        elif proposal.get("payment_verified") is False:
            client_lines.append("Payment: ✗ Not verified")

        if proposal.get("phone_verified"):
            client_lines.append("Phone: ✓ Verified")

        add("Rating",         f"{proposal['client_rating']} ({proposal.get('client_reviews', '?')} reviews)" if proposal.get("client_rating") else None)
        add("Hire rate",      f"{proposal['hire_rate']}%" if proposal.get("hire_rate") is not None else None)
        add("Jobs posted",    proposal.get("client_jobs_posted"))
        add("Open jobs",      proposal.get("client_jobs_open"))
        add("Total spent",    proposal.get("client_total_spent"))
        add("Hires",          f"{proposal['client_hires']} ({proposal.get('client_active', 0)} active)" if proposal.get("client_hires") is not None else None)
        add("Avg hourly paid", f"${proposal['client_avg_hourly_rate']}/hr" if proposal.get("client_avg_hourly_rate") else None)
        add("Hours billed",   proposal.get("client_hours_billed"))
        add("Member since",   proposal.get("client_member_since"))
        add("Location",       proposal.get("client_location"))
        add("Company size",   proposal.get("client_company_size"))

        # Preserve Contract + Timeline (not on proposal page)
        if "Contract" in existing_client: add("Contract", existing_client["Contract"])
        if "Timeline" in existing_client: add("Timeline", existing_client["Timeline"])

        if proposal.get("my_bid"):
            client_lines.append(f"My bid: {proposal['my_bid']}")

        if client_lines:
            content = upsert_section(content, "Client", "\n".join(client_lines))

        entry.content    = content
        entry.updated_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(entry)
        return {**_serialize_kb(entry), "_proposal_merged": True}


# ── Upwork API (OAuth2 3-legged + GraphQL probe) ─────────────────────────────
# See api/upwork_api.py. Read-only public scopes. Token persisted to
# .upwork_token.json at repo root; auto-refreshed. This is the foundation for
# the API job-feed (alternative to the Telegram bot) — additive, nothing in the
# bot/scraper paths is touched.

@app.get("/upwork/connect")
def upwork_connect():
    """Kick off the browser OAuth flow — redirects to Upwork's authorize page."""
    from fastapi.responses import RedirectResponse
    import upwork_api
    return RedirectResponse(upwork_api.build_authorize_url())


@app.get("/callback")
def upwork_callback(code: Optional[str] = Query(None), error: Optional[str] = Query(None)):
    """OAuth redirect target (matches the key's registered callback URL).
    Exchanges the code for tokens and shows a simple success/failure page."""
    from fastapi.responses import HTMLResponse
    import upwork_api
    if error:
        return HTMLResponse(f"<h2>Upwork auth error</h2><p>{error}</p>", status_code=400)
    if not code:
        return HTMLResponse("<h2>Missing ?code</h2><p>Open /upwork/connect to start.</p>", status_code=400)
    try:
        upwork_api.exchange_code(code)
    except Exception as e:
        return HTMLResponse(f"<h2>Token exchange failed</h2><pre>{e}</pre>", status_code=500)
    return HTMLResponse(
        "<h2>✓ Upwork connected</h2>"
        "<p>Token saved. You can close this tab. Next: hit "
        "<a href='/upwork/probe'>/upwork/probe</a> to see what the key can pull.</p>"
    )


@app.get("/upwork/status")
def upwork_status():
    import upwork_api
    return {"connected": upwork_api.is_connected()}


@app.get("/upwork/probe")
def upwork_probe():
    """Discovery: list root GraphQL query fields + run a sample job search.
    Returns raw JSON so we can design the feed mapping from real responses."""
    import upwork_api
    try:
        return upwork_api.probe()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/feed-config")
def get_feed_config():
    """Current Upwork API feed filter config (keywords, stop words, rate floors…)."""
    import upwork_api
    return upwork_api.load_feed_config()


@app.put("/feed-config")
def put_feed_config(data: dict):
    """Save the feed filter config (only known keys are kept)."""
    import upwork_api
    return upwork_api.save_feed_config(data or {})


@app.post("/api-fetch")
def api_fetch():
    """Pull jobs from the Upwork API using the saved Feed Settings:
    per-keyword search → merge/dedup → hard post-filter (stop words, keyword-in-text,
    rate floors, country exclude, payment) → upsert with source='api'.
    Dedup on upwork_job_id never clobbers an existing row's source."""
    import upwork_api
    try:
        rows, stats = upwork_api.fetch_and_filter()
    except upwork_api.UpworkError as e:
        raise HTTPException(status_code=400, detail=str(e))  # usually: not connected
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    inserted, skipped = _upsert_api_jobs(rows)
    print(f"[api-fetch] {stats} inserted={inserted} skipped={skipped}")
    return {"ok": True, "inserted": inserted, "skipped_existing": skipped, **stats}


@app.post("/api-feed/prune")
def api_feed_prune():
    """Re-apply the current feed filter to existing source='api' jobs and delete
    the ones that no longer pass (e.g. leftovers inserted before the filter
    existed). Never deletes a job that has a proposal attached."""
    import upwork_api
    cfg = upwork_api.load_feed_config()
    removed, kept, protected = 0, 0, 0
    with Session(engine) as session:
        api_jobs = session.query(Job).filter(Job.source == "api").all()
        for j in api_jobs:
            if session.query(Proposal).filter_by(job_id=j.id).first():
                protected += 1
                continue
            row = {
                "title": j.title,
                "description_full": j.description_full or j.description_snippet or j.raw_message,
                "hourly_rate_max": j.hourly_rate_max,
                "hourly_rate_min": j.hourly_rate_min,
                "fixed_budget": j.fixed_budget,
                "client_country": j.client_country,
                "payment_verified": j.payment_verified,
            }
            # _row_passes returns a drop-reason (truthy) when it should be removed.
            if upwork_api._row_passes(row, cfg):
                session.delete(j)
                removed += 1
            else:
                kept += 1
        session.commit()
    print(f"[api-feed/prune] removed={removed} kept={kept} protected={protected}")
    return {"ok": True, "removed": removed, "kept": kept, "protected_with_proposals": protected}


@app.get("/usage-stats")
def usage_stats():
    """
    Aggregate token usage and estimated cost over rolling 24h and current
    calendar month windows, broken out by `kind`. Used by the header chip.
    """
    now = datetime.now(timezone.utc)
    cutoff_24h = now - timedelta(hours=24)
    cutoff_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    def _bucket(rows):
        by_kind = {}
        total_in = total_out = 0
        cost = 0.0
        for r in rows:
            rates = _MODEL_PRICING.get(r.model, _DEFAULT_PRICING)
            # Cache-aware pricing:
            #   normal input  = rates["input"] per 1M tokens
            #   cache write   = 1.25× input price (25% write premium)
            #   cache read    = 0.10× input price (90% discount)
            cache_write = (r.cache_creation_input_tokens or 0) * rates["input"] * 1.25
            cache_read  = (r.cache_read_input_tokens or 0)     * rates["input"] * 0.10
            normal_in   = (r.input_tokens or 0)                * rates["input"]
            out_cost    = (r.output_tokens or 0)               * rates["output"]
            row_cost = (normal_in + cache_write + cache_read + out_cost) / 1_000_000
            cost += row_cost
            total_in += r.input_tokens or 0
            total_out += r.output_tokens or 0
            k = r.kind or "other"
            slot = by_kind.setdefault(k, {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "calls": 0})
            slot["input_tokens"] += r.input_tokens or 0
            slot["output_tokens"] += r.output_tokens or 0
            slot["cost_usd"] += row_cost
            slot["calls"] += 1
        return {
            "input_tokens": total_in,
            "output_tokens": total_out,
            "cost_usd": round(cost, 4),
            "by_kind": {k: {**v, "cost_usd": round(v["cost_usd"], 4)} for k, v in by_kind.items()},
            "calls": sum(v["calls"] for v in by_kind.values()),
        }

    with Session(engine) as session:
        rows_24h = list(session.scalars(
            select(TokenUsage).where(TokenUsage.ts >= cutoff_24h)
        ).all())
        rows_month = list(session.scalars(
            select(TokenUsage).where(TokenUsage.ts >= cutoff_month)
        ).all())

    return {
        "last_24h": _bucket(rows_24h),
        "this_month": _bucket(rows_month),
        "month_starts_at": cutoff_month.isoformat(),
        "now": now.isoformat(),
    }


@app.post("/proposals/auto-update-ghosts")
def trigger_ghost_sweep():
    """
    Manually trigger the 10-day ghost timer sweep. Marks proposals as 'ghosted'
    if submitted >10 days ago with no reply. Called on startup automatically;
    can be called via cron or scheduled task for daily runs.
    """
    count = _auto_ghost_proposals()
    return {"ghosted_count": count}


@app.get("/dashboard-stats")
def dashboard_stats():
    """
    Aggregate proposal funnel (sent/replied/hired/ghosted), send-time distribution,
    and bid statistics. Used by the Dashboard tab for funnel, crosstab, and trend views.
    """
    return _compute_dashboard_stats()


# ── Rule-violation telemetry (DESIGN.md §16, Phase C) ─────────────────────────

@app.post("/rule-violations")
def record_rule_violations(data: dict):
    """
    Record which rule/guard pre-checks fired during a generation or analysis.
    Body: { job_id?: int, surface: "generator"|"analyser", checks: [str, ...] }.
    Fire-and-forget from the frontend — best-effort, never blocks the UI.
    """
    surface = (data.get("surface") or "").strip()
    checks = data.get("checks") or []
    if surface not in ("generator", "analyser") or not isinstance(checks, list):
        raise HTTPException(status_code=400, detail="surface must be generator|analyser and checks a list")
    job_id = data.get("job_id")
    try:
        job_id = int(job_id) if job_id is not None else None
    except (ValueError, TypeError):
        job_id = None
    with Session(engine) as session:
        for name in checks:
            name = str(name).strip()
            if not name:
                continue
            session.add(RuleViolation(job_id=job_id, surface=surface, check_name=name))
        session.commit()
    return {"recorded": len([c for c in checks if str(c).strip()])}


@app.get("/rule-violations/stats")
def rule_violation_stats(days: int = Query(30, description="Look-back window in days")):
    """
    Aggregate the most-fired rule/guard checks over the last `days`, split by
    surface. Drives the 'top violations' readout so hardening is data-driven.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    with Session(engine) as session:
        rows = session.query(RuleViolation).filter(RuleViolation.ts >= cutoff).all()
    by_surface: dict = {"generator": {}, "analyser": {}}
    total_events = 0
    distinct_runs = set()
    for r in rows:
        total_events += 1
        bucket = by_surface.setdefault(r.surface, {})
        bucket[r.check_name] = bucket.get(r.check_name, 0) + 1
        # Approximate a "run" by (surface, job_id, minute) so we can count runs.
        distinct_runs.add((r.surface, r.job_id, r.ts.replace(second=0, microsecond=0) if r.ts else None))
    def _top(d):
        return sorted(({"check": k, "count": v} for k, v in d.items()), key=lambda x: -x["count"])
    return {
        "days": days,
        "total_events": total_events,
        "approx_runs": len(distinct_runs),
        "generator_top": _top(by_surface.get("generator", {})),
        "analyser_top": _top(by_surface.get("analyser", {})),
    }


# ── Helpers for segmented outcome stats ──────────────────────────────────────

def _parse_spend_usd(val) -> "float | None":
    """Parse client_total_spent_detail (e.g. '$1.2K', '$100K+', '$0') → float USD."""
    if val is None:
        return None
    s = str(val).strip().lstrip('$').replace(',', '').replace('+', '').strip()
    mult = 1.0
    if s.upper().endswith('K'):
        mult, s = 1_000.0, s[:-1]
    elif s.upper().endswith('M'):
        mult, s = 1_000_000.0, s[:-1]
    try:
        return float(s) * mult
    except (ValueError, TypeError):
        return None


def _spend_tier_label(usd) -> "str | None":
    """Bucket a USD float into a spend-tier label used in outcome stats."""
    if usd is None:
        return None
    if usd < 1.0:
        return "$0"
    if usd < 1_000:
        return "<$1K"
    if usd < 10_000:
        return "$1K–10K"     # $1K–10K
    if usd < 100_000:
        return "$10K–100K"   # $10K–100K
    return "$100K+"


def _rate_band_label(snap: dict) -> "str | None":
    """Return rate-band label from a job-snapshot dict (fixed / hourly tiers)."""
    if snap.get("fixed_budget"):
        return "Fixed"
    rate = snap.get("hourly_rate_max") or snap.get("hourly_rate_min")
    if rate is None:
        return None
    try:
        rate = float(rate)
    except (ValueError, TypeError):
        return None
    if rate < 30:
        return "<$30/hr"
    if rate <= 60:
        return "$30–60/hr"   # $30–60/hr
    return "$60+/hr"


_EU_COUNTRIES_LC = frozenset({
    "germany", "france", "netherlands", "united kingdom", "uk",
    "sweden", "norway", "denmark", "finland", "switzerland",
    "austria", "belgium", "spain", "portugal", "italy", "poland",
    "czech republic", "ireland", "luxembourg", "estonia", "latvia",
    "lithuania", "slovakia", "slovenia", "croatia", "hungary",
    "romania", "bulgaria", "greece", "cyprus", "malta",
})
_US_VARIANTS_LC = frozenset({"united states", "us", "usa", "u.s.", "u.s.a."})


def _country_bucket_label(country) -> "str | None":
    """Bucket a country string into US / EU / Other, or None if unknown."""
    if not country:
        return None
    c = str(country).strip().lower()
    if c in _US_VARIANTS_LC:
        return "US"
    if c in _EU_COUNTRIES_LC:
        return "EU"
    return "Other"


def _build_outcome_stats_prompt_section() -> str:
    """
    Build a compact outcome-stats block for injection into the /claude proxy
    system prompt (kinds: analysis, proposal, and their rescan variants).
    Graduated by sample size:
      • < 3 submitted   → empty (nothing meaningful to say)
      • 3-9 resolved    → short global line + explicit "small sample" caveat
      • >= 10 resolved  → full global + segmented breakdowns (last 90 days)
    """
    stats = _compute_dashboard_stats()
    funnel = stats.get("funnel", {})

    # Submitted = every proposal that actually went out (everything except draft).
    # The reply-rate DENOMINATOR must include viewed + invited — they are
    # submitted proposals that simply haven't resolved (previously dropped,
    # which inflated the rate).
    _NONDRAFT = {"sent", "viewed", "invited", "replied", "interviewing", "hired",
                 "ghosted", "declined", "expired", "withdrawn"}
    submitted_total = sum(funnel.get(s, 0) for s in _NONDRAFT)

    # Resolved = had a definitive outcome (engaged positively or closed cold).
    # 'invited' is a client-initiated positive signal → counts here AND below.
    _RESOLVED = {"invited", "replied", "interviewing", "hired",
                 "ghosted", "declined", "expired", "withdrawn"}
    resolved_count = sum(funnel.get(s, 0) for s in _RESOLVED)

    if submitted_total < 3:
        return ""

    # Positive outcome = client engaged: invited Artem, replied, interviewing, or hired.
    positive = (funnel.get("invited", 0) + funnel.get("replied", 0)
                + funnel.get("interviewing", 0) + funnel.get("hired", 0))
    reply_rate_pct = round((positive / submitted_total) * 100) if submitted_total > 0 else 0
    hired_count = funnel.get("hired", 0)
    small_sample = resolved_count < 10

    # Most common send-time bucket (excluding no_timestamp)
    tb = stats.get("send_time_buckets", {})
    best_bucket = max(
        (k for k in tb if k != "no_timestamp"),
        key=lambda k: tb.get(k, 0),
        default=None
    )

    # Bid average (USD preferred, first currency otherwise)
    bid_stats = stats.get("bid_stats", {})
    bid_avg_str = ""
    for currency in ("USD", *bid_stats.keys()):
        if currency in bid_stats and bid_stats[currency]["count"] > 0:
            avg = bid_stats[currency]["average"]
            bid_avg_str = f"${avg:,.0f} {currency}"
            break

    lines = [
        "\n# Artem's Proposal Outcome Stats (live data)",
        "Use these stats as calibration context when scoring this job or advising on bid / timing strategy."
        + (" NOTE: small sample so far — treat as directional, not definitive; weight lightly." if small_sample else ""),
        f"- Submitted: {submitted_total} | Positive (invited/replied/interviewing/hired): {positive} ({reply_rate_pct}%) | Hired: {hired_count}",
    ]
    if bid_avg_str:
        lines.append(f"- Average bid amount: {bid_avg_str}")
    if best_bucket and best_bucket != "no_timestamp":
        bucket_label = {
            "<15min": "under 15 minutes", "15-60min": "15–60 minutes",
            "1-6hr": "1–6 hours", "6-24hr": "6–24 hours", ">24hr": "over 24 hours",
        }.get(best_bucket, best_bucket)
        lines.append(f"- Most common time-to-submit: {bucket_label} after job capture")

    # ── Segmented stats — last 90 days ───────────────────────────────────────
    # 'invited' is a positive client-initiated signal (matches the global calc).
    _POSITIVE = {"invited", "replied", "interviewing", "hired"}
    cutoff_90d = datetime.now(timezone.utc) - timedelta(days=90)
    with Session(engine) as _s90:
        recent_rows = [
            p for p in _s90.query(Proposal).filter(
                Proposal.created_at >= cutoff_90d,
                Proposal.status.in_(list(_RESOLVED))
            ).all()
        ]

    if len(recent_rows) >= 5:
        # Parse each snapshot once into a flat annotation dict
        parsed_rows = []
        for p in recent_rows:
            snap: dict = {}
            if p.job_snapshot_json:
                try:
                    snap = _json_mod.loads(p.job_snapshot_json)
                except Exception:
                    pass
            spend_usd = _parse_spend_usd(snap.get("client_total_spent_detail"))
            parsed_rows.append({
                "pos":     p.status in _POSITIVE,
                "hired":   p.status == "hired",
                "spend":   _spend_tier_label(spend_usd),
                "rate":    _rate_band_label(snap),
                "country": _country_bucket_label(snap.get("client_country")),
            })

        _BUCKET_ORDER: dict = {
            "spend":   ["$0", "<$1K", "$1K–10K", "$10K–100K", "$100K+"],
            "rate":    ["<$30/hr", "$30–60/hr", "$60+/hr", "Fixed"],
            "country": ["US", "EU", "Other"],
        }
        _DIM_LABEL = {"spend": "client spend tier", "rate": "rate band", "country": "client country"}
        _MIN_BUCKET = 3

        for dim_key in ("spend", "rate", "country"):
            tally: dict = {}
            for row in parsed_rows:
                label = row[dim_key]
                if label is None:
                    continue
                cell = tally.setdefault(label, {"n": 0, "pos": 0, "hired": 0})
                cell["n"] += 1
                if row["pos"]:
                    cell["pos"] += 1
                if row["hired"]:
                    cell["hired"] += 1

            qualifying = {k: v for k, v in tally.items() if v["n"] >= _MIN_BUCKET}
            if not qualifying:
                continue

            ordered = [k for k in _BUCKET_ORDER[dim_key] if k in qualifying]
            total_n = sum(v["n"] for v in qualifying.values())
            dim_lines = []
            for k in ordered:
                v = qualifying[k]
                rr = round(v["pos"] / v["n"] * 100)
                dim_lines.append(f"  {k}: {rr}% reply, {v['hired']} hired (n={v['n']})")
            if dim_lines:
                lines.append(
                    f"By {_DIM_LABEL[dim_key]} (last 90 days, n={total_n}):\n"
                    + "\n".join(dim_lines)
                )

    lines.append(
        "If this job pattern historically correlates with ghosting, weigh that negatively. "
        "If it matches past wins (similar rate band, client spend, category), note it positively."
    )
    return "\n".join(lines)


@app.post("/claude")
async def claude_proxy(request: dict):
    """Proxy Claude API calls from the frontend to avoid CORS issues."""
    import httpx
    import os
    import json as json_lib

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set in .env")

    try:
        # Frontend can pass `_kind` to label the call for usage tracking.
        # Strip before forwarding to Anthropic so it doesn't reject the field.
        kind = (request.pop("_kind", None) or "other")
        model = request.get("model") or "claude-sonnet-4-5"

        # ── Outcome stats injection for Analyser / Generator (Chunk 5) ──
        # The analyser and generator build their system prompts client-side
        # and call /claude directly (not /chat), so we inject the live
        # outcome-stats section here when the call is one of those kinds.
        # Gated at ≥10 resolved outcomes inside the helper.
        _STATS_INJECT_KINDS = {"analysis", "analysis_rescan", "proposal", "proposal_rescan"}
        if kind in _STATS_INJECT_KINDS:
            stats_section = _build_outcome_stats_prompt_section()
            if stats_section:
                existing_system = request.get("system")
                suffix = "\n\n---\n" + stats_section
                # Anthropic accepts `system` as either a string or a list of
                # content blocks. Handle both — append to the trailing text.
                if isinstance(existing_system, list):
                    if existing_system and isinstance(existing_system[-1], dict) and existing_system[-1].get("type") == "text":
                        existing_system[-1]["text"] = (existing_system[-1].get("text") or "") + suffix
                    else:
                        existing_system.append({"type": "text", "text": stats_section})
                    request["system"] = existing_system
                else:
                    request["system"] = ((existing_system or "") + suffix).strip()
                # P1 verification: log so we can confirm injection actually
                # happens (handoff says it was implemented but never validated)
                print(f"[stats-inject] {kind}: appended {len(stats_section)} chars of outcome stats")
            else:
                # Helper returned empty — most likely <10 resolved outcomes yet.
                print(f"[stats-inject] {kind}: SKIPPED (helper returned empty — need ≥10 resolved outcomes)")

        # ── Prompt caching ──────────────────────────────────────────────────
        # Convert a string system prompt into two content blocks so Anthropic
        # can cache the static KB prefix (profile + rules + core + examples).
        # Minimum cacheable size: Sonnet family ≥1 024 tokens (~4 096 chars),
        #                         Haiku 4.5    ≥4 096 tokens (~16 384 chars).
        # No beta header needed — caching is GA.  TTL: 5 min ephemeral.
        #
        # Split priority (first match wins):
        #   1. "\n\nARTEM'S ADJUSTMENTS" — chat-transcript adjustments injected
        #      by the frontend start here; everything above is the static KB.
        #   2. "\n---\n"                 — stats-injection separator appended
        #      server-side; KB content lives above it.
        #   3. No separator              — entire system is static (e.g. first
        #      call, no adjustments, stats gate hasn't fired yet).
        #
        # Caching only saves money when the same prefix is re-used within 5 min
        # (cache write costs 25% more than normal input; cache read costs 10%).
        # Splitting correctly ensures adjustments (which change per turn) are
        # NOT included in the cacheable prefix — otherwise every chat turn would
        # pay the write premium with no offsetting reads.
        _cache_min = 16384 if "haiku" in model.lower() else 4096
        _sys = request.get("system")
        if isinstance(_sys, str):
            # Try splits in order of precision
            _split = _sys.find("\n\nARTEM'S ADJUSTMENTS")   # chat transcript marker
            if _split == -1:
                _split = _sys.find("\n---\n")               # stats separator
            if _split != -1:
                _static = _sys[:_split]
                _dynamic = _sys[_split:]          # keep the marker/separator in dynamic
            else:
                _static = _sys                    # entire system is static
                _dynamic = ""
            if len(_static) >= _cache_min:
                _blocks: list = [{"type": "text", "text": _static,
                                   "cache_control": {"type": "ephemeral"}}]
                if _dynamic:
                    _blocks.append({"type": "text", "text": _dynamic})
                request["system"] = _blocks
                print(f"[cache] {kind}: prefix={len(_static)}ch  dynamic={len(_dynamic)}ch  (model={model})")
            else:
                print(f"[cache] {kind}: static too short ({len(_static)}ch < {_cache_min}ch), skipped")
        elif isinstance(_sys, list) and _sys:
            # Already a list (stats-inject converted it or frontend sent blocks).
            # Cache the first block if it doesn't already have cache_control.
            _first = _sys[0]
            if isinstance(_first, dict) and not _first.get("cache_control"):
                _first_text = _first.get("text", "")
                if len(_first_text) >= _cache_min:
                    _first["cache_control"] = {"type": "ephemeral"}
                    request["system"] = _sys
                    print(f"[cache] {kind}: cached list[0] ({len(_first_text)}ch)")

        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=request,
            )
            raw = response.text
            print(f"[Claude] status={response.status_code} len={len(raw)} preview={raw[:300]}")
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Claude API error: {raw}"
                )
            import json as _json
            parsed = _json.loads(raw)
            _record_usage(kind, model, parsed)
            # Log cache results so the first post-deploy test is easy to verify.
            _u = (parsed or {}).get("usage") or {}
            _cc = _u.get("cache_creation_input_tokens") or 0
            _cr = _u.get("cache_read_input_tokens") or 0
            if _cc or _cr:
                print(f"[cache result] {kind}: write={_cc}  read={_cr}  (saved≈{round(_cr * 0.9)} tokens at cache price)")
            return parsed
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Claude API timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
