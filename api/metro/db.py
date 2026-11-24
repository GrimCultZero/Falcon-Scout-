"""Metro storage: its own declarative base, the eleven metro_* tables, migrations, settings.

Same SQLite file as the Upwork side (one FastAPI process, one DB, METRO_PLAN.md
"Architecture"), resolved exactly the way api/main.py resolves it, but through its own
engine so nothing here imports api/main.py (hard rule: no Metro code in main.py beyond
mounting the router).

Migrations: create_all adds missing tables; `migrate()` then adds any column a model has
and the table lacks (ALTER TABLE ADD COLUMN, nullable). It only ever touches tables whose
name starts with `metro_`; the `jobs` and `proposals` tables are never altered.

Timestamps are naive UTC, like the rest of the app.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from dotenv import load_dotenv
from sqlalchemy import (Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint, create_engine, inspect)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session

ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMA_VERSION = 1


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class MetroBase(DeclarativeBase):
    pass


class MetroCampaign(MetroBase):
    __tablename__ = "metro_campaigns"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False, index=True)          # agency | niche
    region = Column(String, nullable=True)                       # e.g. US/CA, EU
    month = Column(String, nullable=True)                        # YYYY-MM (niche campaigns run one per month)
    status = Column(String, nullable=False, default="draft", index=True)  # draft | active | paused | done
    brief_json = Column(Text, nullable=True)                     # niche / agency brief: who, pains, case tags, do-not-claim
    offer = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MetroCompany(MetroBase):
    __tablename__ = "metro_companies"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, index=True)
    domain = Column(String, nullable=True, unique=True)
    domain_source = Column(String, nullable=True)                # csv | email-finder | ai-lookup | linkedin
    linkedin_url = Column(String, nullable=True, index=True)
    industry = Column(String, nullable=True)
    country = Column(String, nullable=True)
    # Dated snapshots (each JSON blob + when it was taken). Never overwritten by an older read.
    website_scan_json = Column(Text, nullable=True)
    website_scan_at = Column(DateTime, nullable=True)
    pagespeed_json = Column(Text, nullable=True)
    pagespeed_at = Column(DateTime, nullable=True)
    ads_json = Column(Text, nullable=True)
    ads_at = Column(DateTime, nullable=True)
    gbp_json = Column(Text, nullable=True)
    gbp_at = Column(DateTime, nullable=True)
    ahrefs_json = Column(Text, nullable=True)
    ahrefs_at = Column(DateTime, nullable=True)
    linkedin_page_json = Column(Text, nullable=True)
    linkedin_page_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MetroLead(MetroBase):
    __tablename__ = "metro_leads"
    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("metro_campaigns.id"), nullable=True, index=True)
    company_id = Column(Integer, ForeignKey("metro_companies.id"), nullable=True, index=True)
    full_name = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    title = Column(String, nullable=True)
    location = Column(String, nullable=True)
    profile_url = Column(String, nullable=True, index=True)
    member_id = Column(String, nullable=True, index=True)
    email = Column(String, nullable=True, index=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    email_source = Column(String, nullable=True)
    persona_score = Column(Float, nullable=True)                 # layer 0 (CSV only)
    fit_score = Column(Float, nullable=True)                     # layer 1 (business fit)
    deep_score = Column(Float, nullable=True)                    # layer 2 (Ahrefs, company page)
    score_notes_json = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="new", index=True)
    current_cycle = Column(Integer, nullable=False, default=1)
    source_file = Column(String, nullable=True)
    raw_json = Column(Text, nullable=True)                       # the imported CSV row, as read
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MetroHook(MetroBase):
    """The ledger: one stored fact, where it came from and when; the touch that used it."""
    __tablename__ = "metro_hooks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(Integer, ForeignKey("metro_leads.id"), nullable=False, index=True)
    company_id = Column(Integer, ForeignKey("metro_companies.id"), nullable=True, index=True)
    fact = Column(Text, nullable=False)
    source_field = Column(String, nullable=False)                # the stored field that supports it
    source_ref = Column(String, nullable=True)                   # URL or snapshot it was read from
    seen_at = Column(DateTime, nullable=False)                   # the fact's date (SEEN), never assumed
    kind = Column(String, nullable=True)
    cycle = Column(Integer, nullable=False, default=1)
    used_touch_id = Column(Integer, ForeignKey("metro_touches.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow)


class MetroTouch(MetroBase):
    __tablename__ = "metro_touches"
    __table_args__ = (UniqueConstraint("lead_id", "cycle", "step", "channel", name="uq_metro_touch_step"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(Integer, ForeignKey("metro_leads.id"), nullable=False, index=True)
    cycle = Column(Integer, nullable=False, default=1)
    step = Column(Integer, nullable=False)
    channel = Column(String, nullable=False)                     # linkedin | email
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    checks_json = Column(Text, nullable=True)                    # results of the code checks
    checks_passed = Column(Boolean, nullable=True)
    send_anyway_at = Column(DateTime, nullable=True)             # "Send anyway", with its date
    status = Column(String, nullable=False, default="draft", index=True)  # draft | scheduled | sent | unconfirmed | failed | cancelled
    scheduled_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    message_id = Column(String, nullable=True)
    in_reply_to = Column(String, nullable=True)
    thread_ref = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MetroSender(MetroBase):
    """LinkedIn accounts and mailboxes. Holds no secrets: passwords are never stored here."""
    __tablename__ = "metro_senders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String, nullable=False)                        # linkedin | email
    label = Column(String, nullable=False)
    account_ref = Column(String, nullable=True)                  # profile URL or mailbox address
    role = Column(String, nullable=False, default="scraper")     # messenger | scraper
    chrome_profile = Column(String, nullable=True)
    daily_cap = Column(Integer, nullable=True)
    weekly_cap = Column(Integer, nullable=True)
    hourly_cap = Column(Integer, nullable=True)
    counter_date = Column(String, nullable=True)                 # YYYY-MM-DD (Kyiv) the counters below belong to
    sent_today = Column(Integer, nullable=False, default=0)
    visits_today = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MetroSendLog(MetroBase):
    """Every send attempt and its outcome. Fail-closed: written BEFORE the send is tried."""
    __tablename__ = "metro_send_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    idempotency_key = Column(String, nullable=False, unique=True)  # lead + cycle + step + channel
    sender_id = Column(Integer, ForeignKey("metro_senders.id"), nullable=True, index=True)
    lead_id = Column(Integer, ForeignKey("metro_leads.id"), nullable=True, index=True)
    touch_id = Column(Integer, ForeignKey("metro_touches.id"), nullable=True, index=True)
    channel = Column(String, nullable=False)
    test_mode = Column(Boolean, nullable=False, default=True)
    outcome = Column(String, nullable=False, default="pending", index=True)  # pending | sent | failed | unconfirmed | refused
    detail = Column(Text, nullable=True)
    message_id = Column(String, nullable=True)
    attempted_at = Column(DateTime, default=utcnow)
    finished_at = Column(DateTime, nullable=True)


class MetroReply(MetroBase):
    __tablename__ = "metro_replies"
    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(Integer, ForeignKey("metro_leads.id"), nullable=True, index=True)
    touch_id = Column(Integer, ForeignKey("metro_touches.id"), nullable=True, index=True)
    channel = Column(String, nullable=False)
    kind = Column(String, nullable=False)                        # reply | auto_reply | bounce | opt_out
    received_at = Column(DateTime, nullable=True)
    message_id = Column(String, nullable=True)
    snippet = Column(Text, nullable=True)
    stopped_json = Column(Text, nullable=True)                   # what it stopped (channels, touches)
    created_at = Column(DateTime, default=utcnow)


class MetroSuppression(MetroBase):
    """Never write to these. Entries are added and marked, never deleted by an import."""
    __tablename__ = "metro_suppression"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_metro_suppression_kind_value"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String, nullable=False, index=True)            # member_id | profile_url | email | domain | company | upwork_job
    value = Column(String, nullable=False)                       # normalized (see suppression.normalize)
    scope = Column(String, nullable=False)                       # person | company | address
    reason = Column(String, nullable=True)
    source = Column(String, nullable=True)                       # file name or "proposals"
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class MetroCaseLink(MetroBase):
    """A KB case study's English URL and industry tags. The KB table itself is untouched."""
    __tablename__ = "metro_case_links"
    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(String, nullable=False, unique=True)
    title = Column(String, nullable=True)
    industry_tags = Column(String, nullable=True)                # comma-separated
    kb_entry_id = Column(Integer, nullable=True)                 # kb_entries.id, read-only reference
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class MetroSetting(MetroBase):
    __tablename__ = "metro_settings"
    key = Column(String, primary_key=True)
    value_json = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


METRO_TABLES = sorted(MetroBase.metadata.tables)

# Safe defaults (METRO_PLAN.md locked decisions): test mode ON for both channels, Metro week,
# scraping cap 60/day (adjustable to at most 80). Seeded only when the key is absent.
DEFAULT_SETTINGS = {
    "week_mode": "metro",              # metro | linked_helper (no scraping in a Linked Helper week)
    "scrape_cap_per_day": 60,
    "scrape_cap_max": 80,
    "email_test_mode": True,
    "linkedin_test_mode": True,
    "email_daily_cap": 20,
    "schema_version": SCHEMA_VERSION,
}


def _database_url() -> str:
    load_dotenv(ROOT / ".env", override=False)
    return os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'upwork_jobs.db'}")


_engine: Engine | None = None
_lock = Lock()


def get_engine() -> Engine:
    """The Metro engine, created (and the schema brought up to date) on first use."""
    global _engine
    with _lock:
        if _engine is None:
            eng = create_engine(_database_url(), connect_args={"check_same_thread": False})
            init_db(eng)
            _engine = eng
        return _engine


def set_engine(eng: Engine) -> None:
    """Point Metro at another database (tests use a scratch file). Initializes it."""
    global _engine
    with _lock:
        init_db(eng)
        _engine = eng


def migrate(eng: Engine) -> list[str]:
    """Add model columns missing from existing metro_* tables. Returns the ALTERs it ran."""
    done = []
    insp = inspect(eng)
    with eng.begin() as conn:
        for name, table in MetroBase.metadata.tables.items():
            assert name.startswith("metro_"), name          # never touch another table
            if not insp.has_table(name):
                continue
            have = {c["name"] for c in insp.get_columns(name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = f'ALTER TABLE "{name}" ADD COLUMN "{col.name}" {col.type.compile(eng.dialect)}'
                conn.exec_driver_sql(ddl)
                done.append(ddl)
    return done


def init_db(eng: Engine) -> None:
    MetroBase.metadata.create_all(eng)
    migrate(eng)
    with Session(eng) as s:
        for key, value in DEFAULT_SETTINGS.items():
            if s.get(MetroSetting, key) is None:
                s.add(MetroSetting(key=key, value_json=json.dumps(value)))
        row = s.get(MetroSetting, "schema_version")
        if json.loads(row.value_json) != SCHEMA_VERSION:
            row.value_json = json.dumps(SCHEMA_VERSION)
        s.commit()


def read_settings(s: Session) -> dict:
    return {r.key: json.loads(r.value_json) for r in s.query(MetroSetting).all()}
