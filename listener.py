"""
Upwork job listener — Phase 1
Connects to Telegram as your user account, watches @OffersHunterBot,
and saves every job notification into a local SQLite database.

Usage:
    python listener.py

First run: Telethon will ask for your phone number and a confirmation code
(standard Telegram login flow). The session is saved locally so subsequent
runs are silent.
"""

import asyncio
import logging
import os
import re
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.tl.types import MessageEntityTextUrl, MessageEntityUrl

from db import init_db, save_job, Job
from parser import parse_message, _extract_upwork_id
from sqlalchemy import or_
from sqlalchemy.orm import Session

load_dotenv()

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ── config ────────────────────────────────────────────────────────────────────
API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
BOT_USERNAME = os.getenv("BOT_USERNAME", "OffersHunterBot")
# If set, skip the runtime entity lookup (paste the value logged on first run).
_BOT_CHAT_ID_ENV = os.getenv("BOT_CHAT_ID")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///upwork_jobs.db")
session = os.getenv("SESSION_NAME", "upwork_listener")

# ── setup ─────────────────────────────────────────────────────────────────────
engine = init_db(DATABASE_URL)
try:
    asyncio.get_running_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())
client = TelegramClient(session, API_ID, API_HASH)

# ── Last-seen message ID tracking ─────────────────────────────────────────────
# Persists across restarts so catch-up fetches exactly what was missed.
_LAST_MSG_ID_FILE = Path(__file__).parent / ".last_bot_message_id"

def _load_last_msg_id() -> int:
    try:
        return int(_LAST_MSG_ID_FILE.read_text().strip())
    except Exception:
        return 0

def _save_last_msg_id(msg_id: int) -> None:
    try:
        _LAST_MSG_ID_FILE.write_text(str(msg_id))
    except Exception as e:
        log.warning("Could not save last message id: %s", e)

# Resolved after connect in main() unless BOT_CHAT_ID env var is set.
_bot_chat_id: int | None = int(_BOT_CHAT_ID_ENV) if _BOT_CHAT_ID_ENV else None


# ── event handler ─────────────────────────────────────────────────────────────
# Single broad handler — username-based chats= filters registered at module
# load time cannot resolve the entity (client isn't connected yet), so we
# resolve the bot's numeric ID in main() and filter manually here.
@client.on(events.NewMessage(incoming=True))
async def handle_all_messages(event):
    try:
        sender = await event.get_sender()
        name = (getattr(sender, "username", None) or getattr(sender, "first_name", None) or "unknown") if sender else "unknown"
        sid = sender.id if sender else "?"
    except Exception as exc:
        name, sid = "unknown", f"err({exc})"

    is_bot_chat = (_bot_chat_id is not None and event.chat_id == _bot_chat_id)
    log.debug(
        "RAW incoming: from=%s id=%s chat_id=%s bot_chat=%s text=%s",
        name, sid, event.chat_id, is_bot_chat, repr(event.raw_text[:200]),
    )

    if is_bot_chat:
        await handle_job(event)


async def handle_job(event):
    msg = event.message
    raw_text = event.raw_text or (msg.message if msg else "") or ""
    if not raw_text.strip():
        log.debug("handle_job: bot message has no text (chat_id=%s) — skipping", event.chat_id)
        return

    entity_url = _extract_entity_url(msg) if msg else None

    if entity_url:
        log.info("Entity URL extracted: %s", entity_url)
    else:
        log.debug("No entity URL found — will rely on text-based URL extraction")

    log.info("New message from @%s  (%d chars)", BOT_USERNAME, len(raw_text))
    log.debug("Raw message:\n%s", raw_text)

    try:
        parsed = parse_message(raw_text)

        if entity_url:
            if not parsed.get("url"):
                parsed["url"] = entity_url.replace("://upwork.com/", "://www.upwork.com/")
            if not parsed.get("upwork_job_id"):
                parsed["upwork_job_id"] = _extract_upwork_id(entity_url)

        log.debug("Parsed data: %s", parsed)

        parsed["raw_message"] = raw_text
        parsed["captured_at"] = datetime.now(timezone.utc)

        inserted = save_job(engine, parsed)
        if inserted:
            log.info(
                "Saved  job_id=%-20s  title=%s",
                parsed.get("upwork_job_id") or "N/A",
                (parsed.get("title") or "")[:60],
            )
        else:
            log.info("Duplicate — skipped  job_id=%s", parsed.get("upwork_job_id"))

        # Always advance the cursor so restarts don't re-process this message
        if msg and msg.id:
            _save_last_msg_id(msg.id)

    except Exception:
        log.exception("Error processing message from @%s", BOT_USERNAME)


# ── URL repair ───────────────────────────────────────────────────────────────
def _extract_entity_url(message) -> str | None:
    """
    Return the best Upwork URL found in a Telethon message.

    Priority:
      1. Inline keyboard BUTTONS — these are the "🚀 Open url" deep-link buttons
         the OffersHunterBot attaches; clicking them in Telegram lands you in the
         working authenticated Upwork view. We prefer these because the entity
         link in the title text often points to the public /freelance-jobs/apply/
         marketing URL which shows a Sign-up CTA even when you're logged in.
      2. Inline hyperlink entities (MessageEntityTextUrl) — title links etc.
      3. Plain URL entities (MessageEntityUrl) — bare upwork.com URLs in the body.
    """
    raw = message.raw_text or ""

    # 1. Inline keyboard buttons — preferred (the "Open url" button the bot attaches)
    try:
        if message.buttons:
            for row in message.buttons:
                for btn in (row if isinstance(row, list) else [row]):
                    url = getattr(btn, "url", None)
                    if url and "upwork.com" in url:
                        return url.replace("://upwork.com/", "://www.upwork.com/")
    except Exception:
        pass

    # 2. Inline hyperlink entities — fallback
    for ent in (message.entities or []):
        if isinstance(ent, MessageEntityTextUrl):
            if "upwork.com" in ent.url:
                return ent.url.replace("://upwork.com/", "://www.upwork.com/")
        elif isinstance(ent, MessageEntityUrl):
            candidate = raw[ent.offset: ent.offset + ent.length]
            if "upwork.com" in candidate:
                return candidate.replace("://upwork.com/", "://www.upwork.com/")

    return None


async def catchup_missed_jobs(engine, tg_client, bot_entity) -> None:
    """
    On startup, fetch every bot message newer than the last one we processed
    and save any jobs not yet in the database.

    Uses a persisted cursor (.last_bot_message_id file) so it fetches exactly
    what was missed — no matter how long the listener was offline.
    First-ever run falls back to last 200 messages.
    """
    last_id = _load_last_msg_id()

    if last_id:
        log.info("Catch-up: fetching messages after id=%d…", last_id)
        # reverse=True → oldest first, so we process in chronological order
        messages = []
        async for message in tg_client.iter_messages(bot_entity, min_id=last_id, reverse=True):
            messages.append(message)
    else:
        log.info("Catch-up: first run — scanning last 200 bot messages…")
        messages = []
        async for message in tg_client.iter_messages(bot_entity, limit=200):
            messages.append(message)
        messages.reverse()  # oldest first

    saved = 0
    skipped = 0
    highest_id = last_id

    for message in messages:
        raw_text = message.raw_text or (message.message if message else "") or ""
        if not raw_text.strip():
            continue
        if not any(m in raw_text for m in ['Posted On:', 'Hourly:', 'Category:', 'Keywords:']):
            continue

        try:
            parsed = parse_message(raw_text)

            url = _extract_entity_url(message)
            if url:
                if not parsed.get("url"):
                    parsed["url"] = url.replace("://upwork.com/", "://www.upwork.com/")
                if not parsed.get("upwork_job_id"):
                    parsed["upwork_job_id"] = _extract_upwork_id(url)

            parsed["raw_message"] = raw_text
            parsed["captured_at"] = message.date.replace(tzinfo=timezone.utc) if message.date else datetime.now(timezone.utc)

            inserted = save_job(engine, parsed)
            if inserted:
                saved += 1
                log.info("Catch-up saved: %s", (parsed.get("title") or "")[:60])
            else:
                skipped += 1

            if message.id > highest_id:
                highest_id = message.id

        except Exception:
            log.exception("Catch-up: error processing message id=%s", message.id)

    if highest_id > last_id:
        _save_last_msg_id(highest_id)

    log.info("Catch-up complete — %d new jobs saved, %d already existed.", saved, skipped)


async def refresh_apply_urls(engine, tg_client, bot_entity, limit: int = 500) -> None:
    """
    Backfill: re-scan recent bot messages and replace any stored
    /freelance-jobs/apply/ URL with the button URL the bot attaches
    (the deep-link that actually works in an authenticated session).

    Idempotent — only updates jobs whose current URL is the marketing form
    AND whose new extracted URL is genuinely different.
    """
    with Session(engine) as session:
        # Find jobs whose URL still points to the marketing apply path
        stale = session.query(Job).filter(Job.url.ilike("%/freelance-jobs/apply/%")).count()

    if stale == 0:
        log.info("URL refresh: no jobs use the marketing /freelance-jobs/apply/ URL — nothing to do.")
        return

    log.info("URL refresh: %d jobs use the marketing apply URL — scanning last %d bot messages…", stale, limit)
    updated = 0

    async for message in tg_client.iter_messages(bot_entity, limit=limit):
        # _extract_entity_url now prefers BUTTON URLs over entity URLs
        new_url = _extract_entity_url(message)
        if not new_url:
            continue
        # We only want to swap to a non-marketing URL — if the button URL itself
        # is also a /freelance-jobs/apply/ link, leave the existing value alone.
        if "/freelance-jobs/apply/" in new_url:
            continue

        new_id = _extract_upwork_id(new_url)
        title_raw = (message.raw_text or "").splitlines()[0].strip()

        with Session(engine) as session:
            job = None
            if new_id:
                job = session.query(Job).filter(
                    or_(Job.upwork_job_id == new_id, Job.upwork_job_id == "~" + new_id)
                ).first()
            if not job and title_raw:
                cands = session.query(Job).filter(Job.url.ilike("%/freelance-jobs/apply/%")).all()
                tl = title_raw.lower()
                for j in cands:
                    if j.title and j.title.lower().strip() == tl:
                        job = j; break
                if not job:
                    words = set(tl.split())
                    for j in cands:
                        if j.title:
                            common = words & set(j.title.lower().split())
                            if len(common) >= min(4, len(words)):
                                job = j; break

            if job and job.url and "/freelance-jobs/apply/" in job.url and new_url != job.url:
                old = job.url
                job.url = new_url.split("?")[0]
                if new_id and not job.upwork_job_id:
                    job.upwork_job_id = new_id
                session.commit()
                updated += 1
                log.info("URL refresh: [%s]\n  old → %s\n  new → %s", (job.title or "")[:50], old, job.url)

    log.info("URL refresh complete — %d jobs updated to the button URL.", updated)


async def repair_missing_urls(engine, tg_client, bot_entity, limit: int = 500) -> None:
    """
    Scan recent bot messages and backfill url + upwork_job_id for every DB job
    that is missing them.  Runs once at startup.
    """
    with Session(engine) as session:
        missing = session.query(Job).filter(Job.url.is_(None)).count()

    if missing == 0:
        log.info("URL repair: all jobs have URLs — nothing to do.")
        return

    log.info("URL repair: %d jobs missing URL — scanning last %d bot messages…", missing, limit)
    repaired = 0

    async for message in tg_client.iter_messages(bot_entity, limit=limit):
        url = _extract_entity_url(message)
        if not url:
            # Also try plain-text URL in message body
            m = re.search(r"https?://(?:www\.)?upwork\.com/[^\s\)\"]+", message.raw_text or "")
            if m:
                url = m.group(0).replace("://upwork.com/", "://www.upwork.com/")
        if not url:
            continue

        job_id = _extract_upwork_id(url)
        title_raw = (message.raw_text or "").splitlines()[0].strip()

        with Session(engine) as session:
            job = None

            # 1. Match by job ID (with or without ~)
            if job_id:
                job = session.query(Job).filter(
                    or_(Job.upwork_job_id == job_id, Job.upwork_job_id == "~" + job_id)
                ).first()

            # 2. Match by title on jobs that still have no URL
            if not job and title_raw:
                candidates = session.query(Job).filter(Job.url.is_(None)).all()
                tl = title_raw.lower()
                for j in candidates:
                    if j.title and j.title.lower().strip() == tl:
                        job = j
                        break
                if not job:
                    words = set(tl.split())
                    for j in candidates:
                        if j.title:
                            common = words & set(j.title.lower().split())
                            if len(common) >= min(4, len(words)):
                                job = j
                                break

            if job and not job.url:
                job.url = url.split("?")[0]
                if job_id and not job.upwork_job_id:
                    job.upwork_job_id = job_id
                session.commit()
                repaired += 1
                log.info("Repaired: [%s] → %s", job.title and job.title[:50], job.url)

    log.info("URL repair complete — %d jobs updated.", repaired)


# ── test seed ─────────────────────────────────────────────────────────────────
def seed_test_job(engine) -> None:
    """Insert one fake job so the dashboard has data to display immediately."""
    test_id = "~TEST000000000000001"
    with Session(engine) as session:
        if session.query(Job).filter_by(upwork_job_id=test_id).first():
            log.info("Test job already present — skipping seed.")
            return
        session.add(Job(
            upwork_job_id=test_id,
            title="[TEST] Python / Telethon Integration",
            url="https://www.upwork.com/jobs/~TEST000000000000001",
            description_snippet="Fake seed job inserted at startup to verify dashboard rendering.",
            hourly_rate_min=30.0,
            hourly_rate_max=60.0,
            client_country="US",
            client_spend="$10k+",
            posted_date="2026-05-08",
            category="Software Development",
            keywords="python,telethon,asyncio",
            raw_message="[SEED] This is a synthetic test record.",
            captured_at=datetime.now(timezone.utc),
        ))
        session.commit()
    log.info("Seeded fake test job  job_id=%s", test_id)


# ── entrypoint ────────────────────────────────────────────────────────────────
async def main():
    global _bot_chat_id

    seed_test_job(engine)

    log.info("Connecting to Telegram…")
    await client.start()

    # get_dialogs() pre-warms the entity cache so username lookups work offline.
    # Use limit=20 to avoid a full-sync timeout on large accounts.
    log.info("Caching dialogs (limit=20)…")
    try:
        await client.get_dialogs(limit=20)
        log.info("Dialog cache warmed.")
    except Exception:
        log.exception("get_dialogs() failed — continuing without dialog cache")

    me = await client.get_me()
    log.info("Signed in as %s (@%s)", me.first_name, me.username)

    # Resolve the bot's numeric ID so the in-handler filter works reliably.
    if _bot_chat_id is None:
        log.info("Resolving @%s to a numeric chat_id…", BOT_USERNAME)
        try:
            bot_entity = await client.get_entity(BOT_USERNAME)
            _bot_chat_id = bot_entity.id
            log.info(
                "Bot resolved: @%s → chat_id=%s  "
                "(add BOT_CHAT_ID=%s to .env to skip this lookup on future runs)",
                BOT_USERNAME, _bot_chat_id, _bot_chat_id,
            )
        except Exception:
            log.exception(
                "get_entity('%s') failed — cannot filter bot messages. "
                "Set BOT_CHAT_ID=<numeric_id> in .env as a workaround.",
                BOT_USERNAME,
            )
    else:
        log.info("Using BOT_CHAT_ID=%s from env (skipping entity lookup)", _bot_chat_id)

    if _bot_chat_id is None:
        log.error("No bot chat_id available — listener will log all messages but save nothing.")
    else:
        log.info("Listening for messages from @%s (chat_id=%s) …  (Ctrl-C to stop)", BOT_USERNAME, _bot_chat_id)
        try:
            bot_entity_obj = await client.get_entity(_bot_chat_id)
            await catchup_missed_jobs(engine, client, bot_entity_obj)
            await repair_missing_urls(engine, client, bot_entity_obj)
            await refresh_apply_urls(engine, client, bot_entity_obj)
        except Exception:
            log.exception("Startup catch-up/repair failed — continuing anyway")

    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Stopped.")
    except Exception:
        log.exception("Listener crashed")
