from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, String, Float, DateTime, Text, Integer, Boolean, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Session


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"

    # ── Core ──────────────────────────────────────────────────────────────
    id = Column(Integer, primary_key=True, autoincrement=True)
    upwork_job_id = Column(String, unique=True, nullable=True, index=True)
    title = Column(String, nullable=True)
    url = Column(String, nullable=True)
    description_snippet = Column(Text, nullable=True)
    hourly_rate_min = Column(Float, nullable=True)
    hourly_rate_max = Column(Float, nullable=True)
    client_country = Column(String, nullable=True)
    client_spend = Column(String, nullable=True)
    posted_date = Column(String, nullable=True)
    category = Column(String, nullable=True)
    keywords = Column(String, nullable=True)
    raw_message = Column(Text, nullable=False)
    captured_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    avg_rate = Column(String, nullable=True)
    fixed_budget = Column(String, nullable=True)
    # Capture source: "bot" (Telegram @OffersHunterBot, default) or "api"
    # (Upwork GraphQL marketplace search). Lets the feed toggle between them and
    # the two be compared side by side. Dedup is still on upwork_job_id, so a job
    # seen by both keeps a single row (whichever inserted first owns `source`).
    source = Column(String, nullable=True, default="bot", index=True)

    # ── Enrichment: job details ───────────────────────────────────────────
    experience_level = Column(String, nullable=True)
    hours_per_week   = Column(String, nullable=True)
    duration         = Column(String, nullable=True)
    project_type     = Column(String, nullable=True)

    # ── Enrichment: activity ──────────────────────────────────────────────
    connects_required = Column(Integer, nullable=True)
    available_connects = Column(Integer, nullable=True)
    proposals = Column(String, nullable=True)
    last_viewed = Column(String, nullable=True)
    interviewing = Column(Integer, nullable=True)
    invites_sent = Column(Integer, nullable=True)
    unanswered_invites = Column(Integer, nullable=True)
    bid_high    = Column(Float, nullable=True)
    bid_average = Column(Float, nullable=True)
    bid_low     = Column(Float, nullable=True)
    geo_restriction = Column(String, nullable=True)
    # "Already hired: N" — count of freelancers the client has already hired for this job.
    # >0 is a strong negative signal: the client is mostly done filling the role.
    client_already_hired = Column(Integer, nullable=True)
    # Full job description scraped from the Upwork page (the bot's Telegram message
    # frequently truncates long postings — this preserves the complete text so the
    # analyser/generator never see a half-baked posting).
    description_full = Column(Text, nullable=True)
    # "Preferred qualifications" block — Upwork's SOFT filter (e.g. "Location: India").
    # Not a hard disqualifier; freelancers who don't meet it can still apply, and the
    # client sees a banner noting the gap. Captured so the analyser can flag the
    # mismatch without dropping the job's verdict to SKIP.
    preferred_qualifications = Column(Text, nullable=True)

    # ── Enrichment: client ────────────────────────────────────────────────
    hire_rate = Column(Integer, nullable=True)
    payment_verified = Column(Boolean, nullable=True)
    phone_verified = Column(Boolean, nullable=True)
    client_rating_score = Column(Float, nullable=True)
    client_review_count = Column(Integer, nullable=True)
    client_jobs_posted = Column(Integer, nullable=True)
    client_jobs_open = Column(Integer, nullable=True)
    client_hires = Column(Integer, nullable=True)
    client_active = Column(Integer, nullable=True)
    client_total_spent_detail = Column(String, nullable=True)
    client_avg_hourly_rate = Column(Float, nullable=True)
    client_hours_billed = Column(Integer, nullable=True)
    client_member_since = Column(String, nullable=True)
    client_company_size = Column(String, nullable=True)
    client_industry = Column(String, nullable=True)
    client_city = Column(String, nullable=True)
    client_reviews = Column(Text, nullable=True)
    screening_questions = Column(Text, nullable=True)
    enriched_at = Column(DateTime, nullable=True)

    # legacy field (kept for compat)
    client_rating = Column(String, nullable=True)

    # ── User actions ──────────────────────────────────────────────────────
    # Timestamp when Artem hid this job from the feed. NULL = visible. Lets him
    # dismiss noise without permanently deleting (can be restored from a Hidden
    # filter view in the dashboard).
    hidden_at = Column(DateTime, nullable=True, index=True)

    # ── Auto-enrichment bookkeeping ───────────────────────────────────────
    # The extension's background auto-enricher opens unenriched jobs in a hidden
    # Upwork tab and scrapes them. We count attempts (so a dead/expired/geo-blocked
    # URL that never POSTs back to /enrich isn't reopened forever) and stamp the
    # last attempt time (cooldown between retries). A successful scrape sets
    # enriched_at, which removes the job from the pending-enrich queue regardless.
    enrich_attempts        = Column(Integer, nullable=False, default=0)
    last_enrich_attempt_at = Column(DateTime, nullable=True)

    # ── Boost bid competition (scraped from /nx/proposals/job/~/apply/) ──────
    # JSON array of {rank, connects, age} dicts for top bidders in the
    # "Boost your proposal" table. Captured by apply.js as a second enrichment
    # pass. NULL = never captured.
    boost_bids_json        = Column(Text, nullable=True)
    boost_bids_captured_at = Column(DateTime, nullable=True)

    # ── Ahrefs Site Explorer snapshot ────────────────────────────────────
    # Scraped on demand via "Enrich with Ahrefs" button. Captures DR, organic
    # keywords, traffic, backlinks, ref. domains for the client's website so the
    # cover letter generator can personalise based on actual SEO health.
    ahrefs_domain      = Column(Text, nullable=True)
    ahrefs_summary     = Column(Text, nullable=True)
    ahrefs_data_json   = Column(Text, nullable=True)
    ahrefs_captured_at = Column(DateTime, nullable=True)

    # ── Analysis cache ────────────────────────────────────────────────────
    # Server-side cache of the most recent analyser run for this job.
    # Updated by POST /jobs/{id}/analysis (fire-and-forget from the frontend
    # after each analyse / analysis_rescan call). Used as a fallback when
    # saving a proposal without an explicit analysis_json in the request body.
    last_analysis_json = Column(Text, nullable=True)
    last_analysis_at   = Column(DateTime, nullable=True)


class KBEntry(Base):
    """
    Knowledge Base entry. Single table backs every kind of knowledge the
    analyser / proposal generator / chat draws from:
      - manual notes
      - scraped pages (itforce.ua etc.)
      - sent proposals (auto-captured)
      - client replies
      - distilled chat takeaways
      - canonical user rules

    See DESIGN.md sections 5, 8 (Phase 2), and 12 for the full design.
    """

    __tablename__ = "kb_entries"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    # one of: manual | scraped | sent_proposal | client_reply | chat_transcript | rule | note
    type        = Column(String, nullable=False, default="manual", index=True)
    title       = Column(String, nullable=False)
    content     = Column(Text, nullable=False)
    # simple comma-separated tags for v1 (e.g. "ecom,pmax,case-study")
    tags        = Column(String, nullable=True, index=True)
    source_url  = Column(String, nullable=True)
    # nullable FK so proposal/reply entries can link back to the job they came from
    job_id      = Column(Integer, ForeignKey("jobs.id"), nullable=True, index=True)
    # Core flag: entries marked "core" are the always-on subset used by the
    # Rescan & Re-write action. Lets Artem curate a tight prompt-context without
    # the full KB blob. Rules are core by definition and always injected.
    is_core     = Column(Boolean, nullable=False, default=False, index=True)
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Proposal(Base):
    """
    A proposal Artem wrote and saved for a specific Upwork job, with full
    outcome tracking. See DESIGN.md sections 6 and 8 (Phase 5) for design.

    job_snapshot_json captures the enriched Job state at the moment of save;
    the live Job row will continue to evolve (re-enrichments etc.), but the
    snapshot is what made this proposal contextually appropriate, so all
    similarity matching in Phase 7 runs against the snapshot.
    """

    __tablename__ = "proposals"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    job_id             = Column(Integer, ForeignKey("jobs.id"), nullable=False, index=True)
    sent_text          = Column(Text, nullable=False)
    # one of: draft | sent | viewed | replied | interviewing | hired
    #       | declined | ghosted | expired | withdrawn
    status             = Column(String, nullable=False, default="sent", index=True)
    sent_at            = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    status_updated_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    client_reply_text  = Column(Text, nullable=True)
    contract_value     = Column(String, nullable=True)
    notes              = Column(Text, nullable=True)
    # JSON-serialized snapshot of the Job's enriched fields at save time.
    # Stored as TEXT to keep SQLite-friendly; api/main.py handles parse/dump.
    job_snapshot_json  = Column(Text, nullable=True)
    # Auto-captured from Upwork submit: bid amount (e.g. "4500") and currency (e.g. "USD")
    bid_amount         = Column(String, nullable=True)
    bid_currency       = Column(String, nullable=True)
    # When proposal was submitted on Upwork (captured from submit button detection)
    submitted_at       = Column(DateTime, nullable=True, index=True)
    # Point-in-time snapshot of the analyser's verdict at proposal creation.
    # Immutable once set — never overwrite on update. Schema mirrors the
    # Analyser JSON response plus model/ran_at metadata:
    #   {"verdict":"APPLY","score":8,"summary":"...","reasons":[...],"flags":[...],"model":"...","ran_at":"..."}
    # NULL for historical captures where no contemporaneous analysis ran.
    analysis_json      = Column(Text, nullable=True)
    created_at         = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at         = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class TokenUsage(Base):
    """
    One row per successful Claude API call. Used by the header usage chip to
    surface tokens and cost over the last 24h / current month. See DESIGN.md.
    """

    __tablename__ = "token_usage"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    ts             = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    # Logical source of the call: "analysis" | "proposal" | "chat" | "distill"
    # | "capture" | "pdf_parse" | "other"
    kind           = Column(String, nullable=False, index=True)
    model          = Column(String, nullable=False)
    input_tokens   = Column(Integer, nullable=False, default=0)
    output_tokens  = Column(Integer, nullable=False, default=0)
    # Cache hits / writes — captured when Anthropic returns them, so future
    # pricing analysis can break them out separately.
    cache_creation_input_tokens = Column(Integer, nullable=True)
    cache_read_input_tokens     = Column(Integer, nullable=True)


class RuleViolation(Base):
    """
    Telemetry: one row per rule/guard that FIRED during a generation or
    analysis (DESIGN.md §16, Phase C). Lets us see which rules actually get
    violated most, so hardening is data-driven instead of reactive.
    """

    __tablename__ = "rule_violations"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    ts         = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    job_id     = Column(Integer, nullable=True, index=True)
    # "generator" | "analyser"
    surface    = Column(String, nullable=False, index=True)
    # The pre-check / guard name, e.g. "wrongAuditOfferOnLaunch",
    # "irrelevantCaseOnRegulated", "vapeOnPpcOnlyJob", or an analyser flag key.
    check_name = Column(String, nullable=False, index=True)


def init_db(database_url: str):
    engine = create_engine(database_url, echo=False)
    Base.metadata.create_all(engine)
    return engine


def save_job(engine, job_data: dict) -> bool:
    """Insert a job record. Returns True if inserted, False if duplicate."""
    with Session(engine) as session:
        upwork_id = job_data.get("upwork_job_id")
        if upwork_id:
            exists = session.query(Job).filter_by(upwork_job_id=upwork_id).first()
            if exists:
                return False
        job = Job(**job_data)
        session.add(job)
        session.commit()
        return True
