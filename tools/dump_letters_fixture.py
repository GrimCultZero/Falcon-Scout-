# -*- coding: utf-8 -*-
"""Dump sent letters + their postings for tests/preview-specificity.test.js.

Writes tests/.letters.json, which is GITIGNORED on purpose: it contains real
client job postings and Artem's letters, and upwork_jobs.db is excluded from the
repo for the same reason. The test regenerates it on demand instead.
"""
import io, json, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
conn = sqlite3.connect(str(ROOT / "upwork_jobs.db"))
conn.row_factory = sqlite3.Row
rows = conn.execute("""
    SELECT p.status, p.sent_text, j.title, j.category, j.keywords, j.description_full,
           j.fixed_budget
    FROM proposals p LEFT JOIN jobs j ON j.id = p.job_id
    WHERE p.sent_text IS NOT NULL AND length(p.sent_text) > 50
""").fetchall()

out = [{
    "status": r["status"],
    "text": r["sent_text"],
    "posting": "\n".join(x for x in (r["title"], r["category"], r["keywords"], r["description_full"]) if x),
    "fixed_budget": r["fixed_budget"],
} for r in rows]

dest = ROOT / "tests" / ".letters.json"
io.open(dest, "w", encoding="utf-8").write(json.dumps(out))
print(f"wrote {dest} ({len(out)} letters)")
