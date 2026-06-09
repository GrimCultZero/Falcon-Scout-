# Falcon Scout (by IT Force)
*(previously "Upwork Cockpit")*

Local Windows tool that captures Upwork job postings from Telegram (@OffersHunterBot), enriches them via a Chrome extension that scrapes upwork.com, and helps Artem (freelance Google Ads / PPC / SEO specialist) triage them with Claude-generated fit analysis and proposal drafts.

## Stack at a glance
- **Backend:** FastAPI + Uvicorn on `:8000` (`api/main.py`)
- **DB:** SQLite via SQLAlchemy (`db.py`, `upwork_jobs.db`)
- **Capture:** Telethon listener (`listener.py`) + regex parser (`parser.py`)
- **Frontend:** React + Vite on `:5180` (`frontend/src/`)
- **Enrichment:** Chrome extension Manifest V3 (`upwork-enricher/`)
- **LLM:** Claude (`claude-sonnet-4-5`) via `/claude` proxy
- **Launcher:** `falconscout.bat`

## Read this first
**`DESIGN.md`** at the repo root is the canonical source of truth for:
- Architecture and key files
- Current state (what works, what's broken)
- The KB-grounded analyser strategy and the no-RAG-yet decision
- The chat-window design with hybrid distillation
- The seven-phase build sequence (with acceptance criteria)
- Negative-space decisions ("what we deliberately don't do")
- Open questions, conventions, and a glossary

**Read `DESIGN.md` at the start of every session.** Do not relitigate decisions that are settled there. If a decision changes, update `DESIGN.md` as part of the same change.

## Working conventions
- Tactical fixes: just make them, don't ask.
- Strategic / multi-file / multi-day work: check in before starting.
- Capture non-obvious decisions in `DESIGN.md` as they're made — that file is what survives across sessions.
- All Claude calls go through the `/claude` proxy; frontend never calls Anthropic directly.
- Job dedup key is `upwork_job_id` (the `~01abc…` ID from the Upwork URL).

## Quick start
```bash
falconscout.bat              # everything
uvicorn api.main:app --reload --port 8000   # backend only
cd frontend && npm run dev                  # frontend only
python listener.py                          # listener only
```
