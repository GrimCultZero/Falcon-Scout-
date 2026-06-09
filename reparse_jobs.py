"""
One-time script to re-parse all existing jobs from their raw_message
and update the database with fresh field values.

Run from project root:
  .\.venv\Scripts\python reparse_jobs.py
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from db import Job, init_db
from parser import parse_message

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'upwork_jobs.db'}")
engine = init_db(DATABASE_URL)

def reparse_all():
    with Session(engine) as session:
        jobs = session.query(Job).all()
        print(f"Found {len(jobs)} jobs to re-parse...\n")

        updated = 0
        skipped = 0

        for job in jobs:
            if not job.raw_message:
                print(f"  [{job.id}] No raw_message — skipping")
                skipped += 1
                continue

            parsed = parse_message(job.raw_message)

            # Update all parseable fields
            old_title = job.title

            if parsed.get("title"):
                job.title = parsed["title"]
            if parsed.get("url"):
                job.url = parsed["url"]
            if parsed.get("upwork_job_id"):
                job.upwork_job_id = parsed["upwork_job_id"]
            if parsed.get("description_snippet"):
                job.description_snippet = parsed["description_snippet"]
            if parsed.get("hourly_rate_min") is not None:
                job.hourly_rate_min = parsed["hourly_rate_min"]
            if parsed.get("hourly_rate_max") is not None:
                job.hourly_rate_max = parsed["hourly_rate_max"]
            if parsed.get("client_country"):
                job.client_country = parsed["client_country"]
            if parsed.get("client_spend"):
                job.client_spend = parsed["client_spend"]
            if parsed.get("avg_rate"):
                job.avg_rate = parsed["avg_rate"]
            if parsed.get("posted_date"):
                job.posted_date = parsed["posted_date"]
            if parsed.get("category"):
                job.category = parsed["category"]
            if parsed.get("keywords"):
                job.keywords = parsed["keywords"]
            if parsed.get("fixed_budget"):
                job.fixed_budget = parsed["fixed_budget"]

            title_display = (job.title or "Untitled")[:50]
            title_changed = old_title != job.title
            change_note = f" (title: '{old_title}' → '{job.title}')" if title_changed else ""
            print(f"  [{job.id}] ✓ {title_display}{change_note}")
            updated += 1

        session.commit()
        print(f"\nDone! Updated {updated} jobs, skipped {skipped}.")

if __name__ == "__main__":
    reparse_all()
