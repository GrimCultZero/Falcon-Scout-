# Falcon Scout — Worklog

**Purpose:** the distilled, append-only memory of what we built and learned, session by
session. Not a verbatim transcript — the *essentials*: decisions, problems solved, reusable
patterns, and notable examples. This is how a fresh Claude Code instance (any account) gets
up to speed fast.

**How to use (every session):**
- At the start, read this file + `DESIGN.md` (decisions/architecture) + `PROJECT_HANDOFF.md` (how it works).
- At meaningful points and at the end, **append** a dated entry below. Newest at the bottom.
- Keep entries tight: what changed, why, and anything a future session must know. Link to the file/section.
- Settled decisions go in `DESIGN.md`; this log is the running narrative + solved examples.

---

## 2026-06-08/09 — Analyser/generator hardening + full Upwork API integration

### Analyser & generator reliability (JobDetail.jsx)
The recurring battle is hallucination / rules getting skipped. Key fixes this session:
- **Rule-number hallucination killed.** Root cause: rules were numbered inconsistently — backend `/chat` used sequential `Rule 1..N`, the frontend analyser/generator labelled by KB id (`Rule 402`, `Rule 436`). Same rule, different number → the model invented plausible numbers. Fix: rules are now injected as plain `- content` bullets everywhere; the model references a rule by *what it says*, never by a number.
- **Fabricated diagnosis.** Added deterministic `_stripFabricatedOpener` (removes "I took a look at <domain>…" openers) + a prompt rule against describing a client's business from just a name/URL. Principle that's emerging: **anything 100% pattern-detectable gets fixed in deterministic code, not delegated to the unreliable Haiku enforcer.**
- **Audit timing** ("1 working day" PPC audit / "2 working days" SEO plan) — explicit find-and-replace instruction to the enforcer; context-aware (no audit offer on zero-pixel "launch from scratch" jobs).
- **Case-study vertical matching**, **screening-question dedup** (case studies move to the answer, out of the letter), **CTA removal** (only "artem" closes), **humanization** (mixed I/i + 1–2 deliberate typos), **max_tokens 1000→2000** (was truncating letters).

### Upwork API integration — the big build (DESIGN.md §17)
Artem was granted a **read-only public** API key. Reversed the long-standing "no Upwork API" decision.
- **OAuth**: 3-legged authorization-code only (client-credentials is denied for this key). Cloudflare blocks the default httpx UA — a browser User-Agent is required. Token in `.upwork_token.json`, auto-refreshed. Routes: `/upwork/connect`, `/callback`, `/upwork/status`, `/upwork/probe`. Module: `api/upwork_api.py`.
- **Scope reality**: job search + job/client snapshot + user + ontology work. `vendorProposals` (own proposals), `roomList` (messages), `bidsForJob`, `clientsWorkHistory` are all **permission-denied**. So the API = **capture + enrichment only**; outcomes/messages stay on the scraper. (Future: Artem could request the proposals scope via "Edit Key Details" to unlock API outcome-sync.)
- **Dual feed**: `source` column on jobs (`bot`/`api`), `/api-fetch`, sidebar toggle (All/Bot/API). API jobs carry partial data (rate, client spend, country, applicants, geo) but are **NOT** marked enriched — that badge means the extension scraped full detail. `isEnriched` is source-aware.
- **Filtering** (mirrors the bot): per-keyword search → merge/dedup → hard post-filter (stop words, keyword-in-text, rate floors, country exclude, payment). Config in `feed_config.json`, `FeedSettings.jsx` modal. KEY FINDING: the API `searchExpression` is loose OR-ish full-text, so precision comes from the post-filter, not the search.
- **Auto-refresh**: `_api_feed_loop()` pulls every `auto_fetch_minutes` (set to 3 = "live like the bot"), threadpooled, gated on connection. Frontend's 10s poll surfaces new jobs automatically.
- **Tooling**: `/api-feed/prune` (re-filter existing API jobs), 🐛 debug-share button (ships live frontend state + console errors to `share-with-claude.md`), `scripts/upwork_probe*.py`.

### Solved example — Local-SEO map-pack recovery (screening test, won via depth)
A white-label agency (Blueprint For Scale) screened Artem with: *"a client fell in rankings — how do you get them back to top 3?"* with a Local Dominator grid + site + Ahrefs.
- Used **Claude in Chrome** to pull the Local Dominator scan history live: **Mar 9 = 1.92 avg / 85% top-3 (green everywhere)** → **Jun 8 = 3.44 / 43% (east holds, west decayed to 4s)**. Pulled the site on-page via WebFetch; Ahrefs from pasted data (browser tool blocks the ahrefs domain).
- **The diagnostic insight**: periphery decays while the blocks near the pin hold = a **prominence/authority problem, not proximity** (the pin didn't move; the rankable radius shrank). Correlated with the site's collapsed organic footprint (Ahrefs: ~0 organic, lost pages).
- Captured as a reusable **Core KB note #468** ("Local SEO / Map-Pack Recovery — diagnostic method"): pull scan history → read the shape → correlate with Ahrefs → rule out fast triggers → fix NAP/schema/service-area → rebuild prominence → prove on the weekly grid.
- Lesson: for screening "how would you…" questions, pulling the *actual* data live and reading it beats any generic process answer.

### Persistence / never-lose-the-thread — DONE
Project had **no version control** — single-machine, no backup (the exact risk that lost a prior session elsewhere). Now fixed:
- `git init` + `.gitignore` (excludes `.env`, `*.env.txt`, `*.session`, `.upwork_token.json`, `upwork_jobs.db`, `share-with-claude.md`), pushed to **private GitHub repo `https://github.com/GrimCultZero/Falcon-Scout-`**. GitHub push-protection caught two stray key files (`frontend/.env.txt`, `frontend/frontend_env.txt`) — purged from history before they reached GitHub; no secret was ever exposed, no rotation needed.
- Memory docs: `DESIGN.md` (decisions), `PROJECT_HANDOFF.md` (how-it-works), `WORKLOG.md` (this — session narrative/chat essentials), `CASES.md` (solved client examples; seeded with the map-pack case).
- **Standing protocol added to `CLAUDE.md`** ("Memory & persistence protocol"): every session/account does `git pull` → read the 4 memory docs → enrich WORKLOG/CASES/DESIGN → commit+push automatically. The code is the stable core; the memory docs are what every iteration enriches. This is how a different Claude account picks up and adds to the project without losing the thread.

### Capabilities note for future sessions
- **Claude in Chrome** is connected → can drive Artem's real browser (inherits his logins) to pull data from auth'd dashboards (Local Dominator worked; Ahrefs domain is blocked by the tool's policy). `WebFetch` = public pages only. The Falcon Scout Upwork extension ≠ general browsing (Upwork-scrape only).
