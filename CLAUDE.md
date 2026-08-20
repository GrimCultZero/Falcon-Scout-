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

## Memory & persistence protocol (MANDATORY — every session, every account)

This project is on a **private GitHub repo**: `https://github.com/GrimCultZero/Falcon-Scout-`
It is the single source of truth and is meant to be worked on from **multiple Claude accounts /
iterations** without losing the thread. Follow this protocol every session:

**At session start:**
1. `git pull` to get the latest (another account/iteration may have pushed).
2. Read the four memory docs: `DESIGN.md` (decisions/architecture), `PROJECT_HANDOFF.md` (how it
   works now), `WORKLOG.md` (session-by-session narrative + chat essentials), `CASES.md` (solved
   client examples / findings).

**During & at the end of meaningful work — AUTOMATIC, do not wait to be asked:**
3. **Append the essentials of the session to `WORKLOG.md`** (what we did, why, decisions, anything
   the next iteration must know). Add solved client scenarios / findings to `CASES.md`. Put settled
   architectural decisions in `DESIGN.md`.
4. **Commit and push** (`git add -A && git commit && git push`). Keep the GitHub copy authoritative.
   This is the standing default the owner asked for — sync automatically after each meaningful chunk.

**The split that matters (the owner's instruction):**
- The **code/app is the stable core** — it changes only when doing actual development work.
- What every iteration **enriches** is the *around-the-project* knowledge: `WORKLOG.md` (chats),
  `CASES.md` (findings/cases), `DESIGN.md` (decisions), and the in-app KB. Treat these as the
  living memory; grow them, never overwrite history (append).

**Cross-account access:** any account granted access to the private repo clones it, follows this
protocol, and is instantly current. Single user → not editing simultaneously → pull-before /
push-after keeps everything in sync with no conflicts.

**NEVER commit secrets.** `.gitignore` excludes `.env`, `*.env.txt`, `*.session`,
`.upwork_token.json`, `upwork_jobs.db`, `share-with-claude.md`. If you add a new secret-bearing
file, add it to `.gitignore` BEFORE committing. GitHub push-protection is the backstop, not the plan.

### The `//save` trigger (owner-flagged context capture)

When the owner types **`//save`** (or the `/save` slash command) in chat, treat it as an explicit
instruction to capture the **latest topic discussed** into project memory:
1. **Distill the latest topic** — identify the most recent topic/thread in the conversation and
   pull out the essentials that are **useful to the project/app in general**: decisions, methods,
   findings, reusable patterns, gotchas. Skip one-off trivia, chit-chat, and abandoned dead-ends.
   Write it as a concise, dated entry (newest at the bottom). If the owner added a note
   (`//save: <note>`), weave it in.
2. **Append** it to `WORKLOG.md` (session narrative) — or to `CASES.md` if it's a solved client
   scenario / finding.
3. **Commit AND push, automatically** (`git add -A && git commit -m "context: <summary>" && git push`)
   — never pause to ask permission; pushing to GitHub is part of the trigger.
4. **Confirm** in one line: what was captured + that it's pushed.

This is the owner's "this mattered, keep it" button. It works from **any account** because this
instruction lives in `CLAUDE.md` (every instance reads it) and the files live in the repo. Never
paste raw secrets — distill, don't copy.

## Working conventions
- Tactical fixes: just make them, don't ask.
- Strategic / multi-file / multi-day work: check in before starting.
- Capture non-obvious decisions in `DESIGN.md` as they're made — that file is what survives across sessions.
- All Claude calls go through the `/claude` proxy; frontend never calls Anthropic directly.
- Job dedup key is `upwork_job_id` (the `~01abc…` ID from the Upwork URL).

## Quick start
```bash
falconscout.bat              # everything
.\.venv\Scripts\uvicorn api.main:app --reload --port 8000   # backend only
cd frontend && npm run dev                  # frontend only
python listener.py                          # listener only
```

**Backend must run from `.venv`, not a bare system Python** (confirmed 2026-08-20, after a real
multi-restart debugging session): `.venv`'s uvicorn falls back to its built-in `StatReload` (no
`watchfiles` package installed there). A bare `C:\Python314\python.exe -m uvicorn ... --reload` instead
uses `watchfiles`-based reload, whose subprocess-spawn model on Windows resets `sys.stdout`'s encoding
back to `cp1252` on every reload — even though `api/main.py` explicitly reconfigures stdout to UTF-8 at
import time — causing every `print()` containing a non-ASCII character (→, ✓, ⚠, emoji — this file has
plenty) to crash the request with `UnicodeEncodeError`. `.venv` doesn't have `watchfiles`, so it doesn't
hit this. If the backend is ever started outside `.venv`, watch for `UnicodeEncodeError: 'charmap' codec
can't encode character` in CLI-bridge or capture-logging responses — that's this exact issue recurring,
not a new bug.
