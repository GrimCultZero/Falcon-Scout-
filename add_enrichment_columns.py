"""
Migration: adds all enrichment columns to the jobs table.
Run from project root:
  .\.venv\Scripts\python add_enrichment_columns.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "upwork_jobs.db"

NEW_COLUMNS = [
    ("experience_level",          "TEXT"),
    ("hours_per_week",            "TEXT"),
    ("duration",                  "TEXT"),
    ("project_type",              "TEXT"),
    ("bid_high",                  "REAL"),
    ("bid_average",               "REAL"),
    ("bid_low",                   "REAL"),
    ("connects_required",         "INTEGER"),
    ("available_connects",        "INTEGER"),
    ("proposals",                 "TEXT"),
    ("last_viewed",               "TEXT"),
    ("interviewing",              "INTEGER"),
    ("invites_sent",              "INTEGER"),
    ("unanswered_invites",        "INTEGER"),
    ("payment_verified",          "INTEGER"),
    ("phone_verified",            "INTEGER"),
    ("hire_rate",                 "INTEGER"),
    ("client_rating_score",       "REAL"),
    ("client_review_count",       "INTEGER"),
    ("client_jobs_posted",        "INTEGER"),
    ("client_jobs_open",          "INTEGER"),
    ("client_hires",              "INTEGER"),
    ("client_active",             "INTEGER"),
    ("client_total_spent_detail", "TEXT"),
    ("client_avg_hourly_rate",    "REAL"),
    ("client_hours_billed",       "INTEGER"),
    ("client_company_size",       "TEXT"),
    ("client_industry",           "TEXT"),
    ("client_member_since",       "TEXT"),
    ("client_city",               "TEXT"),
    ("client_reviews",            "TEXT"),
    ("screening_questions",       "TEXT"),
    ("avg_rate",                  "TEXT"),
    ("fixed_budget",              "TEXT"),
    ("enriched_at",               "TEXT"),
]

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()
existing = [row[1] for row in cur.execute("PRAGMA table_info(jobs)")]

added = 0
for col_name, col_type in NEW_COLUMNS:
    if col_name not in existing:
        cur.execute(f"ALTER TABLE jobs ADD COLUMN {col_name} {col_type}")
        print(f"  + Added: {col_name}")
        added += 1
    else:
        print(f"  . Exists: {col_name}")

conn.commit()
conn.close()
print(f"\nDone. Added {added} new columns.")
