"""
Backfill the database with recent messages from @OffersHunterBot.

Usage:
    python import_history.py [--limit N]

Reuses the existing Telethon session (upwork_listener.session), so no
re-authentication is required if listener.py has been run at least once.
"""

import asyncio
import argparse
import logging
import os
from datetime import timezone

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import UsernameNotOccupiedError, FloodWaitError

from db import init_db, save_job
from parser import parse_message

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
BOT_USERNAME = os.getenv("BOT_USERNAME", "OffersHunterBot")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///upwork_jobs.db")
SESSION_NAME = os.getenv("SESSION_NAME", "upwork_listener")


async def resolve_entity(client: TelegramClient):
    """Try multiple username forms until one resolves, return the entity."""
    candidates = [
        f"@{BOT_USERNAME}",
        BOT_USERNAME,
    ]
    for username in candidates:
        try:
            entity = await client.get_entity(username)
            log.info("Resolved entity via %r  →  id=%s name=%s",
                     username, entity.id, getattr(entity, "username", "?"))
            return entity
        except (UsernameNotOccupiedError, ValueError) as exc:
            log.warning("Could not resolve %r: %s", username, exc)
    return None


async def fetch_and_import(limit: int) -> None:
    engine = init_db(DATABASE_URL)

    async with TelegramClient(SESSION_NAME, API_ID, API_HASH) as client:
        # Step 1 — cache all open dialogs so Telethon knows about the bot chat.
        log.info("Caching dialogs…")
        dialogs = await client.get_dialogs()
        log.info("  %d dialog(s) cached.", len(dialogs))

        # Step 2 — resolve the bot entity.
        entity = await resolve_entity(client)
        if entity is None:
            log.error(
                "Could not resolve @%s. Make sure you have an existing conversation "
                "with this bot in your Telegram account.", BOT_USERNAME
            )
            return

        # Step 3 — iterate messages and print raw text for debugging.
        log.info("Fetching last %d message(s) from @%s …", limit, BOT_USERNAME)
        all_messages = []
        async for msg in client.iter_messages(entity, limit=limit):
            all_messages.append(msg)
            raw_text = (msg.raw_text or "").strip()
            print(f"\n── msg id={msg.id}  date={msg.date} ──")
            print(raw_text[:500] if raw_text else "<no text>")

        log.info("Retrieved %d message(s) total.", len(all_messages))

        # Step 4 — parse and save.
        found = saved = skipped = 0

        for msg in all_messages:
            raw_text = (msg.raw_text or "").strip()
            if not raw_text:
                continue

            found += 1
            parsed = parse_message(raw_text)
            parsed["raw_message"] = raw_text
            parsed["captured_at"] = msg.date.astimezone(timezone.utc).replace(tzinfo=None)

            inserted = save_job(engine, parsed)
            if inserted:
                saved += 1
                log.info(
                    "  [SAVED]  job_id=%-20s  title=%s",
                    parsed.get("upwork_job_id") or "N/A",
                    (parsed.get("title") or "")[:60],
                )
            else:
                skipped += 1
                log.info(
                    "  [SKIP]   job_id=%s (duplicate)",
                    parsed.get("upwork_job_id") or "N/A",
                )

        print()
        print(f"Messages fetched  : {len(all_messages)}")
        print(f"Non-empty texts   : {found}")
        print(f"Jobs saved        : {saved}")
        print(f"Duplicates skipped: {skipped}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Import recent OffersHunterBot history.")
    ap.add_argument(
        "--limit", type=int, default=20,
        help="Number of messages to fetch (default: 20)",
    )
    args = ap.parse_args()
    asyncio.run(fetch_and_import(args.limit))


if __name__ == "__main__":
    main()
