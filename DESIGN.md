# Falcon Scout — Design Document
*(previously "Upwork Cockpit")*

**Last updated:** 2026-06-07
**Owner:** Artem Yatsuk
**Purpose of this file:** Capture every non-obvious decision, the architectural shape, the build sequence, and the negative-space choices ("we deliberately do NOT do X because Y") so future sessions can pick up without relitigating settled questions. Read this first whenever you open a new Cowork session on this project.

---

## 1. Product overview

Falcon Scout (by IT Force) is a local Windows tool that automates the front of the freelance pipeline for Artem (Google Ads / PPC / SEO specialist, 12 years experience). It:

1. Listens to Telegram bot @OffersHunterBot for new Upwork job postings and persists them.
2. Enriches each job with deep client/job metadata scraped from upwork.com via a Chrome extension.
3. Lets Artem triage jobs in a 3-column dashboard: job details, Claude-generated fit analysis, Claude-generated proposal draft.
4. (In progress) Maintains a living knowledge base of Artem's case studies, sent proposals, client replies, and outcomes, and grounds Claude's analysis + proposals in that KB to eliminate hallucination.
5. (Planned) Tracks proposal outcomes (replied / interviewing / hired / ghosted) and feeds win-rate statistics back into the analyser so historically dead-end job shapes get scored lower.

The product is single-user, runs entirely on Artem's machine, and uses Claude as the language model via the Anthropic API.

---

## 2. Architecture and stack

| Layer | Tech | Port / Path |
|---|---|---|
| Telegram capture | Python + Telethon | `listener.py` |
| Message parsing | Python (regex) | `parser.py` |
| Persistence | SQLite via SQLAlchemy | `upwork_jobs.db` |
| Backend API | FastAPI + Uvicorn | `http://localhost:8000` |
| Frontend | React + Vite | `http://localhost:5180` |
| Enrichment | Chrome extension (Manifest V3) | `upwork-enricher/` |
| LLM | Claude via Anthropic API, proxied through `/claude` | model: `claude-sonnet-4-5` |
| Launcher | `falconscout.bat` | — |

### Key files
- `api/main.py` — FastAPI app. Routes: `/jobs`, `/jobs/{id}`, `/enrich`, `/claude` (proxy).
- `db.py` — SQLAlchemy `Job` model. ~40 columns: core fields + enrichment (job details, activity, client).
- `parser.py` — Parses @OffersHunterBot messages into the Job dict.
- `listener.py` — Telethon listener, watches the bot's chat, calls `parse_message`, saves via `save_job`.
- `frontend/src/App.jsx` — Top-level layout.
- `frontend/src/components/JobList.jsx` — Left column, list of captured jobs.
- `frontend/src/components/JobDetail.jsx` — Center+right columns. Contains `AIAnalysisColumn` and `ProposalColumn`. Currently houses the entire prompt logic for analysis and proposal generation.
- `upwork-enricher/manifest.json` — Extension manifest, host permissions for upwork.com.
- `upwork-enricher/content.js` — Scrapes job detail pages, POSTs to `/enrich`.

### Conventions
- Backend reads `.env` at repo root (`ANTHROPIC_API_KEY`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `BOT_USERNAME`, `BOT_CHAT_ID`, `DATABASE_URL`, `SESSION_NAME`).
- All Claude calls go through `/claude` (CORS-safe proxy). Frontend never calls Anthropic directly.
- Job dedup key is `upwork_job_id` (the `~01abc…` ID extracted from the Upwork URL).
- The user's voice rules, profile facts, and per-call "My Rules" are currently inline in the React components' system prompts. This will change in Phase 4 (see Build Sequence).

---

## 3. Current state — what's working, what isn't

### Working
- Telegram listener boots, resolves @OffersHunterBot's chat ID, captures messages, saves to DB.
- Chrome extension scrapes both old (`/jobs/~id`) and new (`/nx/s/job-details-viewer/jobs/~id`) Upwork URL formats; manifest matches both.
- Enrichment fields land in the Job row and surface in the dashboard.
- Analysis: Claude scores APPLY / MAYBE / SKIP with reasons and red flags. Output is structured JSON parsed in the frontend.
- Proposal generation: Claude writes in Artem's voice (lowercase i, casual, no corporate signoffs, no upfront price quote, under 150 words). Custom user rules are stored in `localStorage` and appended to the system prompt.
- Three-column layout with draggable dividers; "Open on Upwork" button; My Rules panel.

### Outstanding bugs / friction
1. ~~**Telegram URL extraction is broken.**~~ **Fixed** in `listener.py` via `_extract_entity_url(message)` which checks `MessageEntityTextUrl`, `MessageEntityUrl`, and `message.buttons` (Telethon's accessor over `reply_markup`). URLs are normalized to `www.upwork.com`. Bonus mechanisms shipped alongside:
   - `catchup_missed_jobs` — on startup, fetches every bot message newer than the persisted cursor in `.last_bot_message_id` and saves any not yet in the DB. First run falls back to last 200. Ensures zero data loss across restarts.
   - `repair_missing_urls` — one-shot backfill: scans last 500 bot messages, extracts URLs, matches existing DB rows by job_id or fuzzy title overlap, fills `url` and `upwork_job_id`. Runs on each startup; no-op if all jobs have URLs.
2. **`/enrich` fallback for title-matching is brittle.** Because URLs were historically missing, the extension's `api/main.py` step 4 (3-word title-overlap heuristic) is still in place. Now that new jobs reliably get URLs and `repair_missing_urls` backfills old ones, the title-matching fallback should be hit much less often. Keep it as a safety net but expect ID/URL matching to dominate.
3. **"Open on Upwork" fallback search URL is wrong.** Path is `/nx/jobs/search/` but Upwork's actual search lives at `/nx/search/jobs/`. Inconsequential post-fix because the search fallback path almost never triggers now, but worth correcting opportunistically.
4. **My Rules persistence.** Rules live in `localStorage`, so they evaporate if the browser is cleared. Should move to DB once we have a settings table (or fold into `kb_entries` with `type=rule`).

### Pending fix definitions

**Listener URL extraction (Phase 1 of the build sequence below):**

```python
# In listener.py, alongside handle_job

from telethon.tl.types import (
    KeyboardButtonUrl, MessageEntityTextUrl,
    ReplyInlineMarkup,
)

def _extract_message_urls(msg) -> list[str]:
    urls = []
    # 1. Inline keyboard buttons (the "Open url" rocket button)
    rm = getattr(msg, "reply_markup", None)
    if isinstance(rm, ReplyInlineMarkup):
        for row in rm.rows:
            for btn in row.buttons:
                if isinstance(btn, KeyboardButtonUrl) and btn.url:
                    urls.append(btn.url)
    # 2. Message entities (hyperlinks on the title)
    for ent in (msg.entities or []):
        if isinstance(ent, MessageEntityTextUrl) and ent.url:
            urls.append(ent.url)
    return urls
```

Then in `handle_job`, after `parse_message(raw_text)`, if `parsed["url"]` is empty, fill from the first Upwork URL in `_extract_message_urls(event.message)` and re-derive `upwork_job_id` via `parser._extract_upwork_id`.

---

## 4. Strategic direction — knowledge-base-grounded analyser

### The thesis
The current analyser scores jobs using a 4-line profile in the system prompt. Proposals are written from a voice rules block. Neither references real Artem data. The result: Claude fills the gaps from its priors (= hallucinates). The fix is to ground every Claude call in a Knowledge Base containing real material — case studies, sent proposals, client replies, methodologies — and instruct Claude to refuse to invent claims not present in the KB.

### Misconception cleared up
Claude is **not** going to the internet in the current setup. There's no web tool wired into `/claude`. The hallucinations we see come from the model confabulating from training data when the prompt is thin. A KB fixes that, but the threat model is "fills gaps from priors" not "wanders off."

### Reframe on how proposals should use the KB
The KB is **context for composition**, not a phrase bank to copy from. Concretely:
- When generating a proposal, retrieve the 3–5 most similar past situations (similar job type, vertical, problem shape) and pass them to Claude as in-context examples.
- Claude composes a fresh proposal grounded in that material — it draws on patterns and real outcomes but does not lift lines verbatim.

Why not copy-paste:
- Clients on the same platform sometimes recognize boilerplate.
- Upwork's anti-spam can flag repetitive text across proposals.
- Lifted lines stop sounding like Artem and start sounding like a template.

### Scale and the no-RAG-yet decision
At current scale (single user, dozens of jobs/day, growing case study corpus), the entire KB fits in Sonnet's 200K-token context. We will **inject the whole KB (or a tag-filtered slice) into the system prompt on every call**. No embeddings, no vector store, no RAG library. We revisit only if the KB outgrows roughly 80K tokens, which is many months out.

### Anti-hallucination prompt instruction
Every Claude call that uses the KB must include (or equivalent):
> "Use only facts, claims, and case studies that appear in the KB above. If asked to support a point and the KB does not contain it, say 'no record of that' instead of inventing. Do not assume capabilities, results, or experience that are not explicitly stated."

---

## 5. The Knowledge Base — content sources

### Bulk import (one-time)
- **itforce.ua** — full crawl. Case studies, articles, methodologies, service descriptions, "how we approach X" pages. Saved as KB entries with `type=scraped`, tagged by topic, with `source_url` preserved.

### Continuous capture (automated where possible)
- **Every sent proposal** — when "Generate proposal" is clicked and the result is used (we need a "mark as sent" action), save the final text as a KB entry of `type=sent_proposal`, linked to `job_id`.
- **Proposal outcomes** — status updates from scraping `/nx/proposals/` (see Section 6). Updates the `status` field on the corresponding proposal record.

### Continuous capture (manual, weekly cadence acceptable)
- **Client replies** — Artem pastes them into a textarea on the job card. Saved as `type=client_reply`, linked to `job_id` and the corresponding sent proposal.
- **Ongoing chat threads** — Artem pastes longer conversations weekly. Same path.
- **Free-form notes / lessons learned** — text editor in the KB tab. Saved as `type=manual`.

### Manual additions Artem should seed at launch
Before the analyser/proposal generator can lean on the KB, it needs minimum content:
- About-me / capabilities (services, depth in each, what he refuses)
- Pricing logic per service type and minimums
- Tools and why (e.g. "I use Optmyzr for scripts, not Adalysis because…")
- Red-flag patterns he's learned ("US-only on PPC often means agency-front")
- Verticals he's strong / weak in
- 5–10 of his best past winning proposals (with context and outcome if known)

Without seed content, the KB tab is a feature with nothing useful inside. This is on Artem, not on code.

---

## 6. Outcome data — definition and capture

### What "outcome data" means
Anything that tells us whether a proposal moved a client toward hiring or died. Three levels of granularity:

**Minimum viable (binary):** Did the client reply, yes or no. Reply rates are ~10–20% platform-wide, so this single bit already discriminates strongly.

**Ordinal (the funnel) — what we will actually track:**
- `draft` — generated but not yet sent
- `sent` — submitted to client
- `viewed` — client opened the proposal (Upwork surfaces this)
- `replied` — client sent a message back
- `interviewing` — Upwork interview started
- `hired` — contract awarded
- `declined` — explicit rejection
- `ghosted` — replied once then stopped
- `expired` — job closed / proposal expired without reply
- `withdrawn` — Artem pulled it

**Qualitative (upside, where capturable):**
- Text of the client's first reply
- Whether client pushed back on rate
- Contract value if hired
- Free-form notes

### What's scrapable from Upwork
The Chrome extension can extend to three new surfaces, in order of value/effort:

1. **`/nx/proposals/` (the list page)** — every proposal's current status badge. **Highest value, lowest effort.** One content script, fires on visit, scrapes the table, POSTs each row to `/proposal-status`. Artem visits the page once a day; statuses update automatically. **Build this.**
2. **Individual proposal detail page** — cover letter text and the client's first reply if visible. Fires on visit. Captures the qualitative layer for free. **Build this.**
3. **`/nx/messages/` (threads)** — full conversation. Each room is its own SPA with infinite scroll and lazy hydration. **Permanently descoped — see decision below.**

### What stays manual
- Final outcome corrections when scrape misses (e.g., off-platform hires)

This hybrid is the explicit decision: scrape what's cheap, no Upwork API dependency.

### ❌ Client chat scanning — permanently descoped (decided 2026-05-30)

The outcome-aware scoring and generator use cases only need three things per proposal:
1. Job features (category, rate, spend tier, country) — in job snapshot
2. Outcome status (replied/hired/ghosted) — tracked via proposals table
3. Cover letter text — saved at submit time

None of that requires the client chat thread. Reading `/nx/messages/` was originally planned for a "learn from every conversation" vision, but for the concrete use cases now built (stats injection into analyser, similarity-ranked past proposals for generator), the chat is noise — you learn that a client ghosted from the status update, not from reading their silence.

The `/nx/messages/` scraper is the most complex piece of the extension (infinite scroll, lazy SPA hydration, per-room routing) with the worst effort-to-signal ratio. It is explicitly not going to be built.

If Artem wants to capture a particularly valuable client reply or conversation insight, the path is: paste it manually into a KB entry of `type=client_reply` or `type=note`. That's sufficient — the distillation flow (Phase 2.5 chat window) can then turn it into a KB entry. Automated scraping of every message thread adds complexity with no measurable improvement to proposal quality at current scale.

---

## 7. Analyser feedback loop — outcome-aware scoring

### Approach
**Do not train an ML model.** Volume is too low for it to converge, and a learned-weight model is opaque to debug. Instead: compute simple win-rate statistics over the historical proposals + outcomes, bucketed by job features. Inject those stats into the analysis prompt as plain language. Let Claude factor them into the verdict like any other piece of context.

### Feature buckets to track
- Country (e.g. US, EU, other)
- Rate band (e.g. <$30/hr, $30–60, $60–100, >$100, fixed)
- Client total spend tier (e.g. $0, <$1k, $1k–10k, $10k–100k, $100k+)
- Payment verified (Y/N)
- Has screening questions (Y/N)
- Category (top-level)
- Proposals already submitted on the job at capture time (low / medium / high)

For each bucket combination with ≥N samples (N=5 to start), compute:
- Reply rate = `replied / sent`
- Hire rate = `hired / sent`
- Baseline reply rate (Artem's overall) for reference

### Wire-up
In the analysis call's system prompt, after the KB block:
> "Historical patterns for similar jobs (from Artem's own outcome data): country=US, rate $30–60/hr, client spend $10k–100k → 8% reply rate vs 23% baseline. Weigh this when judging APPLY/MAYBE/SKIP."

Claude already produces a numeric score, so it's well-suited to nudge the score down for cold buckets and up for hot ones.

### Why this is right for the scale
- Transparent: Artem can read the stats himself.
- Debuggable: bad scores are traceable to a specific bucket's signal.
- Self-correcting in days, not months.
- Zero new infrastructure.

---

## 8. Build sequence (seven phases)

Each phase has standalone value. We can stop after any phase and the system is strictly better than before. We tackle phases in order; do not skip ahead because dependencies stack.

### Phase 1 — Fix the listener URL extraction ✅ DONE
- Shipped in `listener.py` via `_extract_entity_url(message)` covering entities + inline buttons.
- Bonus mechanisms also shipped: `catchup_missed_jobs` (no-loss restart via persisted cursor) and `repair_missing_urls` (one-shot backfill on startup for jobs with NULL url).
- **Verified by:** next captured Telegram job has `url` and `upwork_job_id` populated; "Open on Upwork" opens the direct job page; existing NULL-url DB rows get backfilled on startup.

### Phase 2 — KB foundation
- New table `kb_entries`:
  | column | type | notes |
  |---|---|---|
  | `id` | INT PK | |
  | `type` | TEXT | `manual` / `scraped` / `sent_proposal` / `client_reply` / `note` |
  | `title` | TEXT | short label |
  | `content` | TEXT | markdown body |
  | `tags` | TEXT | comma-separated, simple for v1 |
  | `source_url` | TEXT nullable | |
  | `job_id` | INT FK nullable | links proposal/reply entries to a Job |
  | `created_at` | DATETIME | |
  | `updated_at` | DATETIME | |
- New endpoints in `api/main.py`:
  - `GET /kb` (list with optional `?type=` and `?tag=` filters)
  - `GET /kb/{id}`
  - `POST /kb` (create)
  - `PUT /kb/{id}` (update)
  - `DELETE /kb/{id}`
  - `GET /kb/bundle` returns the concatenated KB markdown ready to inject into a system prompt (parameterized by type/tag filters)
- Frontend "Knowledge Base" tab:
  - List view (search, filter by type/tag)
  - Markdown editor (textarea is fine for v1; can add a previewer)
  - Bulk-paste flow for manual entries
- **Acceptance:** Artem can add, edit, delete entries; `/kb/bundle` returns a coherent markdown blob.

### Phase 2.5 — Chat window (teach mode + per-job consultation)

Inserted between KB foundation and bulk import because the chat is the primary mechanism for *populating* the KB with high-quality seed content before automated scraping. Without it, KB curation is just typing into a textarea, which produces worse content than guided dialog.

#### Two scopes
- **Global "teach mode" chat** — no specific job loaded. For methodology articulation, case study capture, freeform knowledge dumps.
- **Per-job chat** — opened from any job card. Auto-loads the job + KB bundle. For deeper consultation than the canned analyser, multi-turn proposal iteration, and outcome debriefs.

Same underlying chat engine; the difference is the context loaded into the system prompt.

#### Hybrid distillation flow (the critical design choice)
We do **not** auto-save chat transcripts — that creates the same noise-corpus problem as auto-saving proposals without outcomes. Instead:

1. Conversation happens with full KB context loaded.
2. User clicks **"Distill to KB"** at any point.
3. Claude reviews the conversation and proposes 1–3 candidate KB entries — each with suggested `title`, `tags`, `type`, and clean `content` extracted from the dialog.
4. User reviews each candidate: accept, edit-then-accept, or reject.
5. Accepted candidates POST to `/kb` as new entries.

The chat itself remains ephemeral by default. Optionally a user can also click "Save full transcript" if they want raw history, saved as `type=chat_transcript`.

#### Use cases this unlocks (ranked by leverage)
1. KB curation / teach mode — fastest path to substantive KB content.
2. Multi-turn proposal iteration — "shorter," "less salesy," "lead with the dashboard insight."
3. Per-job deep consultation — beyond what the canned analyser surfaces.
4. Outcome debriefs — "client X replied this, didn't hire, extract the lesson."
5. KB rubber-ducking — "what's our pricing for a Shopify audit?" tests KB completeness.

#### Schema additions
Optional `chat_sessions` table (only if we keep transcripts):
| column | type | notes |
|---|---|---|
| `id` | INT PK | |
| `scope` | TEXT | `global` or `job` |
| `job_id` | INT FK nullable | set when scope=job |
| `messages_json` | TEXT | full conversation as JSON array |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

For v1 we can defer this table and keep chats only in-memory unless the user clicks "Save full transcript" (which would create a `kb_entries` row with `type=chat_transcript` and `content` = the rendered conversation).

#### Endpoints
- `POST /chat` — proxies to `/claude` but injects KB bundle into the system prompt and threads conversation history.
- `POST /chat/distill` — given a conversation, asks Claude to propose KB entry candidates; returns a JSON array of `{title, tags, type, content}` suggestions.
- (If `chat_sessions` is built) `GET/POST/PUT/DELETE /chat-sessions`.

#### Anti-hallucination still applies
Same system-prompt clause as analysis and proposal calls: "use only KB facts; say 'no record of that' otherwise." The chat is not exempt — it's the place where hallucination is most tempting and most damaging because it might propagate into a KB entry.

#### Internet access decision
The chat does **not** turn on web search by default. If we want it, we wire Anthropic's web-search tool into the `/chat` endpoint with a manual "🌐 search the web for this" toggle the user activates per query. Default off; otherwise Claude reaches for it reflexively and erodes the KB-grounding discipline.

**Acceptance:** Artem can hold a multi-turn conversation with the full KB loaded; can click "Distill to KB" and get reviewable entry candidates; can open a per-job chat that knows the job context.

### Phase 3 — itforce.ua bulk import
- One-off script `scripts/import_itforce.py`.
- Crawl sitemap or hand-curated URL list.
- For each page, extract title, body (strip nav/footer), POST to `/kb` with `type=scraped`, tags inferred from URL path / category, `source_url` preserved.
- **Acceptance:** all case studies and key articles from itforce.ua are queryable in the KB tab.

### Phase 4 — Wire KB into analyser and proposal generator
- Server-side: new helper that fetches KB bundle (default: all entries; can later filter by tags relevant to the job's category/keywords).
- Modify the analyser and proposal Claude calls so the KB bundle is **prepended to the system prompt**, before the existing instructions.
- Add the anti-hallucination instruction (Section 4).
- Move the user's "My Rules" out of `localStorage` and into the `kb_entries` table (or a small `settings` table), so they survive browser clears and are part of the KB by default.
- **Acceptance:** Analysis cites real case studies; proposals reference real numbers / past work; Claude says "no record of that" when asked about facts not in the KB.

### Phase 5 — Save-to-KB + outcome capture (refined 2026-05-18)

The unit of capture is the `proposals` row, *not* a separate KB section per status. Status is a column we filter on; entries never "move" between sections. The KB Tab will show proposals via a filter chip rather than treating "successful replies" as a different table.

#### Schema — `proposals` table
| column | type | notes |
|---|---|---|
| `id` | INT PK | |
| `job_id` | INT FK → jobs.id | the job this proposal was written for |
| `sent_text` | TEXT | the final proposal as Artem saved it (possibly hand-tweaked from the Generator's output) |
| `sent_at` | DATETIME nullable | when Save-to-KB was clicked (treat = "sent" for practical purposes) |
| `status` | TEXT | enum: `draft \| sent \| viewed \| replied \| interviewing \| hired \| declined \| ghosted \| expired \| withdrawn` |
| `status_updated_at` | DATETIME | |
| `client_reply_text` | TEXT nullable | first client reply, pasted or scraped |
| `contract_value` | TEXT nullable | if hired |
| `notes` | TEXT nullable | freeform, used for "why I'm proud of this," "what landed," etc. |
| `job_snapshot_json` | TEXT | **critical:** full JSON of the Job row's enriched fields at the moment Save-to-KB was clicked. The job row itself keeps evolving (re-enrichments, archives); this snapshot is what made the proposal contextually appropriate, so similarity matching later runs against the snapshot, not the live job. |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

#### Endpoints
- `POST /proposals` — create. Body: `{job_id, sent_text, status (default "sent")}`. Server-side: pull the current Job row, serialize the enriched-field subset, store as `job_snapshot_json`.
- `GET /proposals` — list with filters: `?status=`, `?job_id=`, `?awaiting_reply=true` (= `status==sent` and no `client_reply_text`).
- `GET /proposals/{id}`
- `PUT /proposals/{id}` — partial update. Supports `status`, `client_reply_text`, `contract_value`, `notes`, and edits to `sent_text` if user wants.

#### UI surfaces
1. **ProposalColumn (job detail view)** — after the user generates and tweaks a proposal:
   - **"Save to KB"** button. Posts to `/proposals` with the current text + `status=sent`. Server captures the snapshot.
   - After save: the column now shows the saved record with a **status dropdown**, a **"Paste client reply"** textarea, and a **notes** textarea. Edits PUT back to the same row.
   - If a proposal already exists for this job, ProposalColumn loads it instead of generating fresh.

2. **Outcomes tab (new top-level tab in the header)** — for managing replies without having to remember which job they belong to.
   - List of all proposals, default-filtered to **Awaiting reply** (`status=sent`, no reply text).
   - Filter chips: `All | Draft | Sent | Awaiting reply | Replied | Interviewing | Hired | Declined | Ghosted`.
   - Each row shows: job title, status badge, sent date, proposal preview.
   - Click expands inline: full proposal text, status dropdown, "Paste client reply" textarea, notes, save button.
   - This is the friction-reducer: when Artem gets a reply via email or Upwork inbox, he opens this tab, scans recent sends, finds the title, pastes the reply.

3. **Jobs sidebar — filter chip "Sent"** — adds a quick way to find jobs that already have a proposal attached (defers to the existing filter mechanism).

#### Why we don't ALSO write to `kb_entries`
We discussed dual-writing every proposal as a `kb_entries` row of `type=sent_proposal`. Decision: don't. Single source of truth in `proposals`. The `/kb/bundle` endpoint (and any future retrieval) reads from both tables and unions them in the bundle output. Reasons: (1) avoids sync issues if Artem edits a proposal; (2) status updates are atomic on one row; (3) the unified bundle is cheap to construct; (4) the KB tab can show proposals via a "Show proposals" toggle without us materializing them as separate KB rows.

#### Acceptance
- Every proposal Artem clicks Save-to-KB on lands in `proposals` with a job snapshot.
- ProposalColumn becomes a working record-keeper: status, reply, notes.
- The Outcomes tab lists all sent proposals, defaults to "Awaiting reply," and lets him paste replies in a few clicks without leaving the dashboard.
- `/kb/bundle` includes proposal entries (rendered with status, job snapshot summary, reply, notes) so the Analyser and Generator (Phase 4 wiring) can lean on them.

### Phase 6 — Scrape proposal statuses
- Extend `upwork-enricher`:
  - New content script matching `https://www.upwork.com/nx/proposals/*`.
  - On page-load (after React hydration), walk the proposals table, extract each row's job link / title / status badge / submitted-at, POST a list to a new `/proposal-status` endpoint.
  - New content script for individual proposal detail page — captures cover letter text (for back-fill of older proposals not generated via the app) and the client's first reply.
- New endpoint `POST /proposal-status` — receives the list, fuzz-matches each entry to an existing `proposals` row by `job_id` + `sent_at` proximity, updates `status` and `status_updated_at`.
- **Acceptance:** Artem opens the proposals page once a day; statuses auto-update for every tracked proposal.

### Phase 7 — Similarity retrieval + outcome-aware scoring (refined 2026-05-18)

This phase closes the loop: when a new job arrives, the system actively retrieves past proposals that resemble it and uses them to both (a) calibrate the Analyser's score, and (b) seed the Generator's writing style with proven exemplars. We do **not** train an ML model; we use cheap deterministic similarity over the job_snapshot_json fields plus simple win-rate stats.

#### Similarity model (deterministic, no embeddings)
For each new job, compute a similarity score against every past `proposals` row using a small set of features extracted from `job_snapshot_json`:
- Same Upwork category (top-level)
- Same vertical inferred from keywords/title (e.g. ecom, saas, agency)
- Rate band overlap (`<$30 / $30-60 / $60-100 / >$100 / fixed`)
- Client total spend tier (`$0 / <$1k / $1k-10k / $10k-100k / $100k+`)
- Has-screening-questions (Y/N)
- Country bucket (`US / EU / other`)

Simple weighted sum gives a similarity score. Top-K with `status >= replied` are retrieved.

If/when this gets noisy (probably 100+ proposals in), we revisit with embeddings — but not before. See negative-space decisions.

#### Generator: in-context examples (the "similar style and context" mechanism)
When the Proposal Generator is called for a new job:
1. Compute similarity vs. all past proposals.
2. Pick top 3–5 with `status >= replied` (prefer `hired > interviewing > replied`).
3. Inject them into the Generator's system prompt as labeled examples, e.g.:
   > "Here are past proposals on similar jobs and their outcomes. Match the voice and structure — do NOT copy phrases verbatim.
   > **Example 1** (HIRED, $4.5k contract, ecom PMax client, US, $30k spend tier): [proposal text]
   > **Example 2** (REPLIED, declined ultimately, similar vertical): [proposal text] …"
4. Claude composes a fresh draft grounded in these patterns.

This is in-context learning from Artem's own corpus. It's strictly stronger than templating because: examples carry outcome labels (so Claude weights winners more), multiple examples blend stylistic patterns rather than locking to one template, and a fresh composition can't be detected as boilerplate.

#### Analyser: similarity flag + win-rate context
On every job analysis:
1. Run the same similarity match.
2. If matches with `status >= replied` exist:
   - **UI:** badge on the job card: "Got a response on N similar jobs" with hover/click revealing titles + outcomes.
   - **Prompt:** inject "You got responses on N similar jobs in the past. Weigh this positively." plus optional reply rate / hire rate from the matched cluster.
3. If matches all `ghosted/expired` and N≥3:
   - Badge: "N similar jobs ghosted — be cautious."
   - Prompt: "This shape of job has historically been a dead end for you. Apply extra skepticism."

This is the feedback loop visible end-to-end. No scheduler needed — similarity + stats are cheap to compute on-demand per analysis.

#### Aggregate win-rate stats (lighter than the per-job similarity)
Side endpoint for the Outcomes tab dashboard: `GET /outcome-stats` returns global counts grouped by status (sent / replied / hired / ghosted) plus reply-rate by feature bucket (country × rate band × spend tier). Used for the at-a-glance summary in the UI, not for analysis decisions. Daily / weekly recompute is unnecessary — these are O(N) over the proposals table.

#### Acceptance
- New jobs that match past wins surface a visible "similar job got a response" badge.
- Generated proposals on those jobs visibly draw on the winning examples' patterns.
- Cold-bucket jobs get systematically lower scores from the Analyser.
- The user can audit *why* a score moved by inspecting which past proposals were retrieved as similar.

---

## 9. Negative-space decisions (what we are deliberately NOT doing)

These are settled. Don't reopen unless something fundamental changes.

- **No vector embeddings / RAG at current scale.** Sonnet handles the whole KB in context. Premature complexity otherwise.
- **No ML training for the outcome feedback loop.** Simple stats injected into the prompt. Opaque models are bad for a tool Artem needs to trust and debug.
- **No copy-pasting lines from past proposals into new ones.** KB is composition context, not a phrase bank. (Section 4 reframe.)
- **No auto-save of proposals without an outcome-capture mechanism.** Unlabeled corpus = noise; KB has to grow with feedback or it makes the system worse.
- ~~**No Upwork API integration.**~~ **REVERSED 2026-06-08** — Artem was granted a read-only public API key. Probed and integrated as an additive second feed source. See §17 for the full scope findings. (The API covers capture + enrichment only; outcomes/messages remain scraper-based because those scopes were denied.)
- **No `/nx/messages/` scraper — ever.** Permanently descoped 2026-05-30. The outcome-aware scoring and generator only need job features + outcome status + cover letter text, all of which are already captured. Reading full chat threads is the most complex extension work (infinite scroll, per-room SPA routing) with the worst effort-to-signal ratio. If a specific reply is worth capturing, Artem pastes it as a `client_reply` KB entry manually.
- **No Markdown formatting in `event.raw_text`.** We extract URLs from `reply_markup` + `entities`, not by switching Telethon to markdown mode (more brittle, depends on bot formatting).
- **No third-party analytics / observability for v1.** Local app, single user, FastAPI logs are enough.
- **No auto-saving of chat transcripts to the KB.** Use the hybrid distillation flow instead. Saving every chat verbatim creates the same noise-corpus problem as auto-saving proposals without outcomes.
- **No web search tool enabled by default in the chat or anywhere else.** If/when we add Anthropic's web search, it ships behind a manual per-query toggle. The whole point of the KB is to be the first-class source; reflexive web search would erode that discipline.
- **No expectation that Claude "learns" from the chat.** Each API call is stateless; no fine-tuning happens locally. The only mechanism by which a conversation makes the system smarter is the distillation step that writes new KB entries. Be explicit about this in any UI copy so the user model stays accurate.
- **No separate KB "sections" per proposal status.** Status is a column on the `proposals` row; the UI filters by it; nothing is moved between tables. A proposal that gets a reply doesn't migrate — its status changes from `sent` to `replied` and the filter view shifts.
- **No template substitution for proposal generation.** When the Generator needs to lean on past wins, it does so by injecting 3–5 labeled exemplars into the system prompt as in-context examples (Phase 7). Claude composes a fresh draft from those patterns. We do not look up a single past proposal, do find-and-replace on the variables, and call it done. That path produces boilerplate that loses Artem's voice and is detectable as repetitive.
- **No dual-write of proposals into `kb_entries`.** A saved proposal is one row in `proposals`. The `/kb/bundle` endpoint reads from both tables and unions the output. Single source of truth, no sync bugs, edits stay atomic.
- **No ML-based similarity for v1.** Deterministic feature-overlap (category + vertical + rate band + spend tier + screening + country) is enough at small scale. Embeddings come in only when we have 100+ proposals and feature-overlap noise becomes evident.
- **No external billing/analytics dashboard for token usage.** A local `token_usage` table plus a header chip (`/usage-stats`) is enough at this scale. Pricing rates are hard-coded per model in `_MODEL_PRICING`; update them when Anthropic changes prices. We track input/output/cache tokens per call but don't break cache out in the chip — keep the surface compact.
- **No auto-save / no full-context chat in the Generator.** The proposal-column chat uses a split-response protocol: Claude returns `<remarks>` (chat-visible) and `<proposal>` (replaces the top textarea). Every message in this chat refreshes the draft. The analyser-column chat is unchanged — it's a free-form discussion.
- **No automatic Core promotion.** Entries become Core only when Artem explicitly toggles the star in the KB tab. Rules are *always* injected (they're directives by definition) and Core is the "always-on" layer above that.

---

## 10. Conversation discipline for future sessions

- Strategy discussion and implementation happen in the **same Cowork session**, grounded in the actual repo (`C:\Users\syzov\upwork-cockpit\`).
- Non-obvious decisions get written here (`DESIGN.md`) as they're made.
- For tactical fixes (small code changes), Artem's standing instruction is: **just make the fix, don't ask.**
- For strategic / multi-file / multi-day work, check in before starting.
- When in doubt about the URL of a code path, read the actual file rather than reasoning from memory.

---

## 11. Open questions still to decide

- **KB tag taxonomy.** Free-form CSV strings work for v1, but eventually we'll want a canonical set (e.g. `vertical:ecom`, `service:pmax`, `outcome:hired`). Defer until we have ~50+ entries and can see what tags emerge naturally.
- **KB editor UX.** Plain `<textarea>` for v1. Decision on whether to add a Markdown previewer / structured form (e.g. case study template) can wait until Artem starts populating and tells us what feels clunky.
- **How aggressively to filter the KB before injection.** For now: inject the whole bundle. If/when prompts get too long or analysis quality drops, add tag-filtering keyed off the job's category/keywords.
- **Whether to capture screenshots of Upwork pages for audit.** Probably not needed; flag for later if scrape regressions become hard to diagnose.

---

## 12. Chat window — design reference

(Full build details in Phase 2.5 of Section 8. This section is the standing reference for *why* the chat exists and *how* it interacts with the KB. Read this before changing chat behavior.)

### Why it exists
The chat is the primary high-bandwidth input channel into the KB. Free-typing into a markdown textarea produces worse content than guided dialog with Claude asking follow-up questions. The chat is therefore not a side feature — it's how the KB grows past its seed contents.

### How "teaching" actually works
Claude does not learn from conversation. Each API call is stateless. The only way a conversation makes future analyses or proposals smarter is via the distillation step: chat → distilled KB entry → injected into future system prompts. There is no fine-tuning, no model memory, no implicit improvement. If a user expects "the model is learning from me," correct that expectation: the **KB** is learning; the model is doing the writing.

### Token economics — be honest
KB injection uses more tokens than letting Claude reason from priors, not fewer. The value of the KB path is groundedness and anti-hallucination, not cost savings. We pay tokens to buy accuracy.

### Internet access
Off by default everywhere. If we add Anthropic's web-search tool, it ships behind a manual per-query toggle (UI: "🌐 search the web for this"). Default-on web search would teach Claude to skip the KB and pollute outputs with arbitrary internet content.

### Distillation prompt sketch
When the user clicks "Distill to KB," we POST the conversation to `/chat/distill`. The system prompt for that call asks Claude to:
1. Identify any new facts, methodology details, case study fragments, or insights surfaced in the conversation.
2. Group them into 1–3 coherent candidate KB entries.
3. For each candidate return strict JSON: `{title, type, tags, content}` — content as clean markdown, written in third-person or first-person consistently, with no chat artifacts ("you mentioned earlier...").
4. Do not invent: if a claim is not supported by the conversation, leave it out.

Frontend renders each candidate in a review panel; user can edit `content`, change `tags`, change `type`, or reject before approving.

### Scopes
- **Global teach mode:** no job context, full KB in system prompt. For methodology / case study capture.
- **Per-job chat:** job row + full KB in system prompt. For consultation, proposal iteration, outcome debrief.

Both call the same `/chat` endpoint with different `context` payloads.

### Why the hybrid distillation flow specifically
- Auto-save everything → noise corpus.
- Manual "save this chat" → user forgets, content rots.
- Hybrid distillation → user stays in flow, Claude does the structuring work, user only approves clean candidates. Highest signal-to-noise ratio.

---

## 12.5 Core Entries, Rescan & Re-write, Token usage (added 2026-05-23)

### Core Entries
- `kb_entries.is_core` boolean column gates the "always-on" subset of the KB. Rules are always injected regardless of this flag (they're directives by definition); Core is the layer above that for case studies, notes, exemplar proposals.
- `GET /kb?is_core=true` and the **★ Core** filter chip in the KB tab surface the Core subset. Each entry row has a star toggle (`PUT /kb/{id}` with `{is_core: bool}`).
- Use Core for: a tight, curated context that's small enough to inject every time without burning tokens. Use the full KB elsewhere (initial generate, chat, etc.) when accuracy matters more than speed.

### Rescan & Re-write / Rescan & Re-analyse
- Buttons in the proposal column (Rescan & Re-write) and analyser column (Rescan & Re-analyse) action rows.
- Generator: `generate(null, { coreOnly: true })` fetches only rules + `is_core=true` entries instead of the full KB.
- Analyser: `analyse(null, { coreOnly: true })` fetches the same Core subset but skips the style-example layer (analysis_liked feedback) for a leaner pass.
- Default `analyse()` always layers Core entries on top of rules + style examples — Core is the always-on subset by definition, so it should be present in any analysis pass, not just Rescan.
- Tagged in usage tracking as `proposal_rescan` and `analysis_rescan` respectively, so we can see how often the fast path is used vs. the full regenerate/analyse.

### Unified Core (not split per consumer)
- One Core list serves both the Generator and the Analyser. Considered splitting into Analyser-Core / Generator-Core but rejected: most entries are dual-purpose (case studies, vertical strengths, client red flags) and forcing a 3-way decision (analysis-only / proposal-only / both) on every entry is pure friction with marginal token savings.
- Escape hatch if confusion shows up later: add a single optional `core_scope` tag (analysis / proposal / unset = both). Defer until we feel the pain.

### Generator chat — split response protocol
- The proposal-column InlineChat receives `onProposalRewrite` and `currentProposalText` props. When set, the chat asks Claude for a strict `<remarks>...</remarks><proposal>...</proposal>` format and routes them: remarks render in chat, proposal text replaces the top textarea.
- The frontend skips the textarea swap when the new proposal is byte-identical to the current draft — so chatting about a question doesn't cause a no-op churn.
- The analyser-column chat is unchanged.

### Token / cost tracking
- `token_usage` table records one row per successful Claude API call: `kind` (analysis / proposal / proposal_rescan / chat / distill / capture / pdf_parse / rule_check / rule_distill / kb_structure / other), model, input/output tokens, cache tokens.
- Every Claude call is instrumented: `/chat`, `/chat/distill`, `/capture-conversation`, `/kb/parse-file`, and the generic `/claude` proxy (which uses the optional `_kind` body field stripped before forwarding to Anthropic).
- `GET /usage-stats` aggregates rolling 24h and current-calendar-month windows, returning per-kind breakdowns and total USD.
- Header chip polls every 30s and shows `24h $X.XX · mo $X.XX`. Click for the per-kind breakdown.
- Pricing rates live in `_MODEL_PRICING` and are USD per 1M tokens — update there when Anthropic changes prices.

### Rule numbering
- Rules are sorted by `id` ASC in both the backend `/chat` system prompt and the frontend My Rules panel. Display is `Rule N` where N = position in that sorted list.
- The system prompt explicitly tells Claude the numbers are stable and quotable. When Artem says "check Rule 5", Claude looks at the 5th rule.

### Chat persistence (Generator + Analyser)
- Chat transcripts are kept per-job in `localStorage` under `falconscout.chat.<chatId>.<jobId>`.
- The persistence implementation uses a `useState` lazy initializer for restore (not a `useEffect`) and an inline save inside the `setMessages` wrapper (not a `useEffect`). This avoids a React 18 Strict Mode race where the double-invoked save effect was wiping storage with the initial `[]` state before the restore effect could run.

---

## 13. Proposal outcome tracking + Dashboard (added 2026-05-23)

### Chunk 1 — Auto-capture on submit
- `proposals` table gains: `bid_amount TEXT`, `bid_currency TEXT`, `submitted_at DATETIME`.
- **Handshake design** (matters because no single URL has both job_id and bid):
  1. **Application form** (`/nx/proposals/job/~JOB_ID`): `proposal.js`'s `setupSubmitListener()` captures clicks on the Submit/Send button (only text "Submit", "Submit proposal", "Send" — excludes "Save as draft"). Stashes a single global record `{ job_id, job_url, job_title, timestamp }` under `falcon_last_submit` in `chrome.storage.local`. Single key, not per-job — there's only ever one submit in flight.
  2. **Post-submit redirect** (`/nx/proposals/` or `/nx/proposals/<numeric_id>`): `handlePostSubmitCapture()` reads the stash, checks age < 60 s, then scrapes the page for the user's own bid (multiple regex patterns ordered from most specific to least) and the cover-letter text. Sends `PROPOSAL_SUBMITTED` to background with `{ upwork_job_id, bid_amount, bid_currency, submitted_at, sent_text }`.
- Why a single global key, not per-job: the post-submit URLs don't contain the Upwork `~JOB_ID`, so a per-job lookup would always fail. The application form URL DOES have the job id, so we capture it at submit-click time and carry it forward in storage.
- Background `recordProposalSubmitted()`: looks up the job by `upwork_job_id` (handles `~` prefix variance), POSTs to `/proposal-submitted`.
- `POST /proposal-submitted`: creates or updates the proposal row (one proposal per job in v1). When the scraper supplied `sent_text`, overwrites the in-app draft so the saved row reflects what was actually submitted. If status was `draft`, upgrades it to `sent`.
- **Constraint**: only works for jobs that already exist in the local DB (i.e. came through the Telegram listener first). Submitting to a job not in `jobs` table returns 404 from the background script.

### Chunk 2 — 10-day ghost timer
- `_auto_ghost_proposals()` in `api/main.py`: finds proposals with `status=sent`, `submitted_at < now - 10 days`, and no `client_reply_text`. Flips them to `status=ghosted` and updates `status_updated_at`.
- Runs **on every backend startup** AND **every 24h** via `_ghost_sweep_loop()` registered as a startup `asyncio.create_task` — so long-running sessions don't need a restart for the 10-day rule to take effect.
- `POST /proposals/auto-update-ghosts`: manual trigger endpoint (for testing or external cron).

### Chunk 3 — Send-time + bid tracking
- `_compute_dashboard_stats()` computes:
  - **Funnel**: count by status (sent / replied / hired / ghosted / …).
  - **Send-time buckets**: `<15min / 15-60min / 1-6hr / 6-24hr / >24hr` based on `submitted_at - job.captured_at`. Proposals with missing timestamps fall into `no_timestamp`.
  - **Bid stats**: per-currency count, min, max, average.
- `GET /dashboard-stats`: exposes the above payload. Called on-demand by the Dashboard tab.

### Chunk 4 — Dashboard tab
- New `frontend/src/components/Dashboard.jsx` — fetches `/dashboard-stats` on tab activation.
- Sections:
  - Summary stat cards (total, submitted, replies, hired, ghosted, reply rate %)
  - Funnel horizontal bars per status, sized as % of total
  - Time-to-submit bar chart (coloured by bucket: green fast → amber slow)
  - Bid summary table per currency
  - **Crosstab**: bid tier × send-time bucket → reply rate (heat-mapped cells; cells need ≥3 samples before the % shows, otherwise just the volume `n=X`)
  - **Weekly trend**: stacked bars showing submitted / replied / hired per ISO week, capped at the last 12 weeks
- Bid tiers (USD-only): `<$500 / $500–2k / $2k–5k / $5k+ / non-USD`. Other currencies bucketed as `other` until we add FX rates.
- Tab added to App.jsx alongside Jobs / Outcomes / KB. Hash `#dashboard` deep-links to it.
- No chart library — CSS bars + an HTML grid for the crosstab.

### Chunk 5 — Aggregate stats injection into prompts
- `_build_outcome_stats_prompt_section()` in `api/main.py`: calls `_compute_dashboard_stats()`, counts resolved outcomes (ghosted/declined/replied/interviewing/hired/expired/withdrawn). Returns `""` if count < 10 — not enough signal.
- When ≥ 10, builds a 4–5 line section with: reply rate %, hired count, avg bid, most common send-time bucket, and a directive for Claude to use the data when scoring the job.
- **Injection points** (both paths covered):
  - The `/claude` proxy injects the section into the `system` field when `_kind ∈ { analysis, analysis_rescan, proposal, proposal_rescan }` — these are the calls made by the Analyser and Generator columns in `JobDetail.jsx`. Handles both string and content-block-array forms of `system`.
  - The `/chat` endpoint (used by inline analyser/generator chat windows) injects the section between job context and the persona paragraph.
- Gate rationale: below 10 resolved proposals, rates are noisy. Above 10, the calibration is meaningful. No UI changes needed — the section appears transparently.

### Chunk 6 — Anthropic prompt caching (2026-05-26)
- GA feature — no beta header required.
- Implemented in `/claude` proxy (`api/main.py::claude_proxy()`) immediately after the stats-injection block, before the httpx call.
- **Minimum cacheable sizes:** Sonnet family ≥ 1 024 tokens (~4 096 chars), Haiku 4.5 ≥ 4 096 tokens (~16 384 chars). Only Sonnet calls (analysis, proposal) will typically hit the minimum given the large KB system prompts; Haiku calls (rule_enforce, kb_shrink, etc.) have small prompts that safely fall below the threshold.
- **Split strategy** (first match wins, executed left-to-right):
  1. `"\n\nARTEM'S ADJUSTMENTS"` — the chat-transcript injection marker from `buildAdjustments()` in `JobDetail.jsx`. Everything above this is the static KB prefix. This split must come first because including chat adjustments in the cached prefix would create a unique prefix per chat turn, causing a cache write premium on every turn with no offsetting reads.
  2. `"\n---\n"` — the separator appended by the server-side stats-injection (`"\n\n---\n" + stats_section`). Stats change as outcomes accumulate, so they stay in the non-cached block.
  3. No separator found → entire `system` string is static (first call, no adjustments, stats gate hasn't fired) → cache the whole thing as a single block.
- **Cost mechanics:** cache write = 1.25× input price, cache read = 0.10× input price. `_bucket()` in `token_usage_stats` uses these rates so the usage chip stays accurate.
- **Verification signals in backend console:**
  - `[cache] analysis: prefix=Xch  dynamic=Ych` — caching block found a prefix long enough to cache.
  - `[cache result] analysis: write=N  read=M` — Anthropic's response confirms the cache action.
  - On a Regenerate within 5 min: `read > 0` confirms the hit.
- **Lossless:** no prompt content is changed or removed, just restructured into Anthropic's content-block list format.

---

## 13.5 Outcomes → Analyser feedback loop — implementation handoff

*Added 2026-05-29. Written for a cold session that hasn't seen the prior conversation. Read Section 7 and Phase 7 of Section 8 first for strategic context.*

### What is already built (do not rebuild)

**`_build_outcome_stats_prompt_section()` in `api/main.py` (lines ~3339–3450)**
Computes and returns a multi-line stats block for injection into analysis/proposal system prompts. Covers:
- Global all-time reply rate, hire count, average bid, most common time-to-submit bucket.
- Segmented breakdowns (last 90 days, buckets with n ≥ 3 only) by: client spend tier, rate band ($0–30 / $30–60 / $60–100 / $100+), country bucket (US / EU / other).

Injection is live in `api/main.py::claude_proxy()` (~line 3493). It fires for `_kind ∈ {analysis, analysis_rescan, proposal, proposal_rescan}`. The suffix `"\n\n---\n" + stats_section` is appended to the system prompt; the `"\n---\n"` separator is the prompt-caching split point (keeps the stats block out of the cached prefix since it changes as outcomes accumulate).

**Gate:** function returns `""` when resolved outcome count < 10. "Resolved" = `{ghosted, declined, replied, interviewing, hired, expired, withdrawn}`. Below 10 the injection is a no-op and the backend prints `[stats-inject] {kind}: SKIPPED (helper returned empty — need ≥10 resolved outcomes)`.

**Verification signals in backend console:**
- `[stats-inject] analysis: appended N chars of outcome stats` → injection fired.
- `[stats-inject] analysis: SKIPPED (helper returned empty — need ≥10 resolved outcomes)` → not enough data yet.

**What you need to do to activate it:** nothing — it activates automatically once ≥10 proposals have a resolved status in the `proposals` table. Keep Outcomes updated daily (the Chrome extension scrapes `/nx/proposals/` statuses; Artem visits the page once a day to trigger scraping).

---

### Level 1 — Already live, pending data volume

**Status:** ✅ Built. Waiting for ≥10 resolved outcomes in the DB.

**To verify once data is available:**
1. Open the backend console while clicking Analyse on any job.
2. Should see: `[stats-inject] analysis: appended N chars of outcome stats`.
3. The analysis JSON `flags` or `summary` should reference reply rate or outcome patterns.
4. If you see SKIPPED: `SELECT status, count(*) FROM proposals GROUP BY status;` to count resolved rows — need ≥10 across ghosted/declined/replied/interviewing/hired/expired/withdrawn.

**If you want to lower the gate for testing:**
Change `if resolved_count < 10:` to `if resolved_count < 3:` temporarily in `_build_outcome_stats_prompt_section()`. Revert after validation.

---

### Level 2 — Bucketed pattern signal

**Status:** ✅ Also already built — the segmented breakdown (spend tier × rate band × country, last 90 days, n≥3 per bucket) is inside `_build_outcome_stats_prompt_section()`, computed from `recent_rows` starting at line ~3408.

The output format looks like:
```
Segmented reply rates (last 90 days, buckets ≥3 proposals):
- Client spend $10k–100k: 28% reply rate (n=7)
- Rate band $30–60/hr: 22% reply rate (n=9)
- Country US: 18% reply rate (n=11)
```

Claude reads this and adjusts its verdict/score for the current job accordingly — if the current job matches a cold bucket (e.g. client spend $0, rate <$30) it should score lower; if it matches a hot bucket (e.g. US client, $30–60/hr) it should score higher.

**What is NOT yet built (genuine Phase 7 work, ~1 day):**

**Per-job similarity matching** — the "this job looks like 3 past jobs, 2 of which got replies" badge and the retrieval of winning proposals as Generator examples. This is the high-value remaining work. Spec is in Phase 7, Section 8. Concrete next steps:

1. **`GET /proposals/similar?job_id=N`** in `api/main.py`:
   - Load target job's snapshot fields: `category`, `hourly_rate_max`, `client_total_spent_detail`, `client_country`, `keywords`.
   - For each past proposal row that has `job_snapshot_json`, score similarity as a weighted sum:
     - Same Upwork top-level category: +3
     - Rate band overlap (both in same $0–30 / $30–60 / $60–100 / $100+ bucket): +2
     - Same spend tier: +2
     - Same country bucket: +1
   - Return top 5 sorted by score descending, with their `status`, `sent_text` preview, and `job_snapshot_json.title`.

2. **UI badge** in `JobDetail.jsx` `AIAnalysisColumn`:
   - After `analyse()` completes, fire `GET /proposals/similar?job_id={job.id}`.
   - If results include ≥1 with `status ∈ {replied, interviewing, hired}`: show green badge "✓ N similar jobs got a response".
   - If results are all `ghosted/expired` and n≥3: show amber badge "⚠ N similar jobs ghosted".
   - No badge if < 3 similar proposals exist (not enough signal).

3. **Generator injection** in `JobDetail.jsx` `ProposalColumn`:
   - Same `/proposals/similar` call made before `generate()`.
   - Inject winning examples (prefer hired > replied > interviewing) into the Generator system prompt as labeled past proposals.
   - Already wired in the Generator at line ~2715 via `fetch('/proposals?status=hired,replied,interviewing')` — that's a flat fetch, not similarity-filtered. The Phase 7 upgrade is to replace that flat fetch with the similarity-ranked one.

**Acceptance for Phase 7:**
- New job matching a past "US client, $30–60/hr, SEO" cluster shows the green badge.
- Clicking the badge shows which past jobs matched.
- Proposed cover letter on that job silently draws on the winning proposal's structure.
- A job matching only ghosted clusters gets the amber badge and a slightly lower score.

---

### Summary table

| Feature | Status | Activates when |
|---|---|---|
| Global reply/hire rate injected into analyser | ✅ Built | ≥10 resolved outcomes |
| Segmented breakdown by spend/rate/country | ✅ Built | ≥10 resolved outcomes + ≥3 per bucket |
| Per-job similarity matching | ❌ Not built | Phase 7 work (~1 day) |
| "Similar job got a response" badge | ❌ Not built | Needs similarity endpoint first |
| Generator uses similarity-ranked past proposals | ❌ Not built | Needs similarity endpoint first |

---

## 13. Cheat sheet — common commands

```bash
# Start everything
falconscout.bat

# Backend only
uvicorn api.main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev

# Listener only
python listener.py
```

DB lives at `upwork_jobs.db` in the repo root unless `DATABASE_URL` is overridden.

---

## 14. Session handoff — 2026-05-29

*Written at context limit. Everything here was built or changed in this session. Read this before touching any of the files below.*

---

### Changes shipped this session

#### Analyser — Artem's profile
`frontend/src/components/JobDetail.jsx` — analyser system prompt rewritten with full real profile:
- 95% JSS, Top Rated, $100K+ earned, 68 jobs, 2,509 hours.
- ITForce agency: 97% JSS, 3,102 hours.
- Rate history: $30/hr floor, recent contracts $35–50/hr.
- Google Premier Partner 2026 is **PPC-only** — not an SEO credential. Two explicit notes in the prompt prevent Claude citing it on SEO jobs.
- Proven verticals: medical/YMYL, local services, ecommerce, Google Merchant Center.
- Competitive positioning: Top Rated + Premier Partner reduces the penalty for 20–50-applicant pools.

#### Analyser — scoring fixes
- **Location/Europe bug fixed**: Ukraine IS in Europe. "Location: Europe" preferred qualification no longer triggers a mismatch penalty. Both the profile section and the preferred-qualifications rule explicitly state this.
- **Client avg rate signal**: if `avg_rate < $20/hr` → subtract 1 point + add flag "Client avg rate $X/hr suggests budget-conscious client." `avg_rate` is now included in `jobSummary` sent to the analyser.

#### Generator — closing line
Removed `"happy to answer questions"` from allowed closings. Rule now says: sign off as "artem" only. Explicitly blacklists "happy to answer questions", "i work async", "communication will be efficient" as forbidden filler.

#### UI — Feed / Outcomes
- **Back-to-top button** in feed sidebar: appears when scrolled > 150px, positioned inline left of FeedStatus. Smooth scroll on click.
- **FeedStatus** always rendered (removed conditional show/hide that caused a pop on filter switch). Status row uses `opacity` transition — removed that too after it still popped. Always visible now.
- **Tab flash notification**: when a new job arrives while the tab is backgrounded, the title alternates `🔔 N new – Falcon Scout` and the favicon gets a bright teal badge with count. Stops instantly on focus/visibilitychange. Implemented in `App.jsx` with `prevJobIdsRef`, `newJobCountRef`, `flashIntervalRef`.

#### KB — tags/type preservation on save
`frontend/src/components/KnowledgeBase.jsx`:
- Added `metaTouched` ref `{ type: false, tags: false }`. Set to true only when user explicitly changes those fields via the form.
- `save()` only sends `type` and `tags` in PUT body if the user actually touched them. Prevents a stale draft from silently overwriting DB type/tags (which caused KB entry 402 to silently downgrade from `type: rule` to `type: manual`).
- Entry 402 restored to `type: rule`.

#### Similarity matching — built and live
`api/main.py` — new endpoint `GET /proposals/similar?job_id=N`:
- Scores all past proposals against the target job by: category (+3), rate band (+2), spend tier (+2), country bucket (+1). Max score 8.
- Returns top 10 sorted by score desc then status rank (hired > replied > etc).
- Returns `{ results, positive_count, cold_count, total_matched }`.
- Route is defined BEFORE `GET /proposals/{proposal_id}` — order matters for FastAPI.

`frontend/src/components/JobDetail.jsx` — `AIAnalysisColumn`:
- After `setAnalysis(parsed)`, fires `GET /proposals/similar?job_id=N` (fire-and-forget).
- `similar` state holds the response. `similarOpen` toggles the detail list.
- Badge renders below the verdict card when `total_matched >= 3` AND `positive_count >= 1` (green) OR `cold_count >= 3` (amber). Click expands a list with status badge, title, similarity score.
- Resets on re-analyse.

`frontend/src/components/JobDetail.jsx` — Generator:
- The flat `fetch('/proposals?status=hired,replied,interviewing')` winner fetch replaced with `fetch('/proposals/similar?job_id=N')`.
- Past proposals from similar jobs sorted first by outcome_signal (positive → unmatched → cold), then status rank, then similarity score.
- Labels in the prompt: `[WINNER — replied on similar job, similarity 6/8]`.

#### background.js — double-notify fix
`upwork-enricher/background.js` — `PROPOSALS_LIST_SCRAPE_DONE` handler:
- `ranBackendSync` now correctly checks both `r.scanned` (0-rows path) AND `r.result.scanned` (>0-rows path). Previously `r.result.scanned` was always undefined at the top level, so `ranBackendSync` was always false → backend sync AND PROPOSALS_LIST_SCRAPE_DONE both fired notifyCockpit → duplicate events confusing the frontend.

---

### Sync v2 (2026-05-29) — URL-marker trigger + direct POST + on-page banner (CURRENT)

After 50+ iterations the proposals/"viewed" leg never delivered its result or
debug to the dashboard. Diagnosis: the architecture was the bug, not the
scraper. The result travelled scrape → background worker → cross-tab relay →
dashboard, with the proposals tab opened **inactive**. Three fragile hops:
1. MV3 service-worker death mid-flight wiped in-flight state.
2. Background/inactive tabs are render-throttled → only ~7/30 virtualised rows
   ever hydrated.
3. The cross-tab `notifyCockpit` relay dropped messages silently.

**The redesign removes all three hops:**
- `background.js` `SYNC_PROPOSAL_STATUSES` opens the proposals page as an
  **ACTIVE** tab at `…/nx/proposals/?falconsync=1`. Active = all rows render.
  The `?falconsync=1` marker lives in the URL, so it survives worker death.
- `proposal.js` detects the marker (`falconSyncRequested()`; falls back to the
  persisted `chrome.storage.session` tab-id set via `ASK_AUTO_SYNC` if Upwork
  strips the query on redirect), scrapes, then **fetch()-POSTs the rows
  STRAIGHT to `http://127.0.0.1:8000/proposal-status-sync`** — no worker, no
  relay. (HTTPS upwork.com → http://127.0.0.1 is allowed: localhost is a
  "potentially trustworthy" origin, and the backend now CORS-allows
  `https://www.upwork.com` — see `api/main.py` `allow_origins`.)
- `proposal.js` `showSyncBanner()` paints a green fixed banner top-right on the
  Upwork tab itself: rows scraped, viewed count, matched/promoted count, plus a
  collapsible row list. **The result is visible without F12 or the dashboard.**
- The messages (reply-detection) leg is unchanged — still opened inactive and
  routed through the relay; it's the only leg that fires `cockpit:status:synced`,
  so the dashboard panel now just confirms that leg and points the user to the
  Upwork-tab banner for the proposals result.
- Extension/manifest bumped to **1.9**; `proposal.js` build stamp `1.9`.

Files: `api/main.py` (CORS + OPTIONS), `upwork-enricher/background.js`
(SYNC_PROPOSAL_STATUSES rewrite), `upwork-enricher/proposal.js`
(`falconSyncRequested`/`postSyncDirect`/`showSyncBanner` + auto-fire IIFE
rewrite; deleted the `PROPOSALS_LIST_SCRAPE_DONE`/`shouldSync` relay path),
`frontend/src/components/Outcomes.jsx` (`syncFromUpwork` now completes on the
messages leg, panel points to the banner), `manifest.json` (1.9).

**To verify**: reload extension at chrome://extensions, restart backend (CORS),
hard-refresh dashboard, click "Sync from Upwork". The proposals tab opens
active, renders all rows, shows the green banner with counts.

**Local Network Access prompt (Chrome)**: because the page now POSTs to
http://127.0.0.1, Chrome shows a one-time "www.upwork.com wants to Access other
apps and services on this device" prompt → click **Allow**. (Until allowed, the
fetch hangs → the 15s `AbortController` timeout in `postSyncDirect` surfaces a
clear error instead of a frozen "saving…".)

**v2.1 — viewed-detection made CONSERVATIVE (2026-05-29, ground truth in hand):**
First real run (after Allow) anchored 10/10 rows correctly via the "Initiated"
label, but flagged **all 10** viewed and wrongly promoted 8 in the DB. The
self-diagnosing banner gave the answer: `viewed_phrase_count: 1` — "viewed by
client" appears in the page HTML exactly ONCE, and none of the row samples
contained it. The old "broad" layers (walk-up-2-ancestors, geometric/synthetic
-hover, page-wide HTML-scan proximity) smeared that single hit across every row.
- **Fix**: viewed is now flagged ONLY when the phrase is inside a row's OWN
  container subtree (Layer 1 innerText + Layer 2 outerHTML). Removed the hover
  sweep, geometric layer, walk-up layer, and HTML-scan cross-check. Under-
  detecting is acceptable; corrupting the DB is not.
- **Cleanup**: reverted the 8 false `viewed` rows (identical batch timestamp)
  back to `sent` via a one-off SQL update.
- **Title filter**: also rejects relative timestamps, "Boosted/Not boosted/
  Learn more", and "General Profile" (fixed the "Not boosted Learn more" title).
- **Open question**: with the phrase appearing once page-wide and in no row, the
  proposals LIST page may simply not expose per-row "viewed" state in static
  HTML (it may be a hidden template/legend, an eye-icon, or only on the proposal
  DETAIL page). Next: have Artem identify what the viewed indicator actually
  looks like on his screen + which proposals show it, then capture that row's
  outerHTML to find the precise signal. Until then viewed-sync will catch 0–1.

---

### Historical / superseded: viewed-status sync (pre-v2)

**The problem**: Upwork shows "Viewed by client" on 2 proposals (Shopify Ecommerce SEO Expert, Google PPC — IDs 10 and 6 in our `proposals` table). All 14 proposals remain `status: sent` after sync.

**What's been tried and ruled out**:
1. `innerText` scan → empty for hidden elements.
2. `textContent` + `getComputedStyle` visibility check → implemented in `_collectViewedYs()` but still 0 indicators found. Root cause unclear — may be CSS `content:` rendering, off-screen elements, or a DOM structure where the viewed indicator is a sibling outside the walked container.
3. Hover simulation (`mouseover`/`mouseenter` events) → row is scrolled into view before hover, but still 0 indicators after. Upwork may use CSS `:hover` which synthetic events can't trigger reliably.

**Current state (extension v1.6, not yet confirmed working)**:
- `buildViewedIdSetFromHtml()` added to `proposal.js` — scans full `document.body.innerHTML` for job `~HEX_IDs` that appear within ±600 chars of "viewed by client" text. This is DOM-structure/CSS-agnostic.
- Result is `viewedIdSet` (Set of hex IDs). If a row's extracted `upwork_job_id` is in this set, it's marked viewed regardless of DOM layer results.
- Console log: `[Cockpit Proposal] HTML-scan viewed IDs: N [...]` — if N=0, the text literally doesn't appear in the raw HTML → Upwork renders it via CSS `content:` (pseudo-element, not accessible from JS at all).

**If HTML-scan also returns 0** (next session should check this first):
The viewed indicator is rendered via CSS `::after`/`::before` content or canvas. The only JS-accessible path is `window.getComputedStyle(el, '::after').content`. Approach: find the eye-icon element's computed pseudo-element style and check if it encodes a "viewed" state.

Alternative: intercept the Upwork fetch call that returns proposal data. Inject a `<script>` into page context to wrap `window.fetch`, listen for API responses containing proposal data with a `viewed` flag, and `postMessage` it back to the content script. This is the most reliable approach but requires `"world": "MAIN"` injection (allowed in Manifest V3 via `chrome.scripting.executeScript` with `world: "MAIN"`).

**Files changed for viewed-status debugging**:
- `upwork-enricher/proposal.js` — `_collectViewedYs()` rewritten (textContent + visibility), `buildViewedIdSetFromHtml()` added, hover sweep scrolls into view, all Y coords are absolute (window.scrollY added).
- `upwork-enricher/background.js` — `ranBackendSync` fixed.
- `upwork-enricher/manifest.json` — version bumped to 1.6.

---

### Pending tasks (for next session)

1. **Confirm whether HTML-scan detects viewed IDs** — open the Upwork proposals page, sync, check Chrome DevTools console for `[Cockpit Proposal] HTML-scan viewed IDs:`. If count > 0, viewed sync is fixed. If 0, the text isn't in HTML at all and a fetch-interceptor approach is needed.

2. **Outcomes data volume** — similarity badge and stats injection both need resolved outcomes (viewed/replied/ghosted). Currently all 14 proposals are `sent`. Keep marking outcomes daily to accumulate signal.

3. **Cover letter closer** — "Looking forward to working with you." still appears in proposal ID 15 (`SEO & Google Ads Specialist for Home Builder`). This isn't the "happy to answer" line but similar filler. Check if a KB rule covers it or add one.

4. **DESIGN.md last updated date** — currently says 2026-05-23. Update to 2026-05-29.

---

## 16. Rule-application overhaul — hallucination mitigation (2026-06-04, IN PROGRESS)

**Problem:** Near-every cover letter and analysis had at least one rule violation. Root-cause review of the rule-application code found:

1. **Always-on rule dump (the #1 driver).** All 27 KB rules were injected flat into every generator first pass, every Haiku enforcer pass, AND every analyser call — regardless of job type. ~3,200 tokens of mostly-irrelevant rules per call. The ~8 relevant rules competed for attention with ~19 confusers (SEO rules on PPC jobs, audit rules on launch jobs, etc.). This is what produced "offered an audit on a launch job", "cited a PPC case on an SEO job", etc.
2. **Most rules were prompt-only.** Only ~18 conditions had a deterministic regex pre-check; every other rule relied on first-pass priming = a coin-flip per letter.
3. **The "narrow" enforcer wasn't narrow** — Haiku got all 27 rules again.
4. **Analyser got all 23 generator rules as pure noise** (write lowercase, attach PDFs, no filler closers…) — irrelevant to scoring.
5. **Reactive rule growth = negative spiral.** Each miss → add a rule → more dilution → more misses (~20→27 rules in a week).
6. **No telemetry** — no data on which rules fail most.
7. **Positional rule numbers drift** — "Rule 17" = 17th-by-id; inserting a rule shifts every higher number; hard-coded references in violation messages silently mispoint.

**Solution plan (A–F, approved full scope):**
- **A. Conditional rule routing** — classify the job once into scopes, inject only matching + always-on rules. *(highest leverage)*
- **B. Expand deterministic checks** — anything pattern-detectable becomes a regex; prompt carries only judgment rules.
- **C. Violation telemetry** — persist every pre-check fire per job; surface top-violated rules.
- **D. Truly-narrow enforcer** — pass only violated + scoped rules to Haiku.
- **E. Stable rule IDs** — reference by DB id everywhere; kill positional drift.
- **F. Analyser verification** — extend forced-flag pre-computation + score-vs-flags consistency check.

**Scope vocabulary:** `always | ppc | seo | audit | launch | regulated | agency | analyser`. Stored as `scope:<name>` entries in the existing `kb_entries.tags` column (no migration). Borderline rules → `always` (under-applying = missed violation = the expensive failure; over-applying just costs minor dilution).

**Phase 1 DONE (2026-06-04):** All 27 rules classified and tagged in DB.
- **always (12):** 5, 397, 398, 400, 403, 407, 415, 423, 427, 436, 438, 439
- **analyser (4):** 2, 3, 411, 446
- **ppc:** 405 · **seo:** 426, 430 · **agency:** 406, 408 · **regulated:** 437
- **multi:** 401(seo,audit), 404(ppc,audit), 402(ppc,seo,audit), 416(seo,ppc,audit), 450(launch,ppc)
- Effect once routing lands: generator drops from flat 23 → ~13–17 by job type (cross-domain confusers removed); analyser drops from 27 → 4.

**Known classifier gap to fix in Phase 2 (A):** the regulated-vertical detector (`REGULATED_VERTICAL_RE`, rule 437) does NOT match "peptide", "bio-hacking", "skincare", "aesthetic", "med-spa", "cosmetic", "YMYL" — the bio-hacking job (id 1309) would not trigger `regulated`. Widen the classifier's regulated keyword set.

**Phase 2 DONE (2026-06-04) — routing live + stable IDs (A + E + most of D):**
- Module-level helpers in `JobDetail.jsx`: `parseRuleScopes()`, `jobScopes(text)` (keyword classifier, regulated set widened to catch peptide/bio-hacking/aesthetic/skincare/med-spa/YMYL), `rulesForGenerator(rules, scopes)`, `rulesForAnalyser(rules)`.
- Wired into all 3 injection sites: generator first pass, Haiku enforcer, analyser. Each logs `N/total rules after scope routing`.
- **Analyser now gets only the 4 analyser-scoped rules** (was all 27) — biggest single de-noise.
- Generator per-job-type counts (verified): PPC-mgmt 13, PPC-audit 17, SEO-mgmt 15, SEO-audit 18, bio-hack-launch 15 (was a flat 23). Cross-domain confusers dropped.
- **E (stable IDs):** all 3 prompts now number rules by DB id (`Rule ${r.id}`); KB panel badge shows `#<id>`; removed positional `ruleNumberById`. Prompt "Rule N" now literally matches the panel. Fixed a stale `447`→`450` reference in the launch-audit violation message.
- Tag refinement: audit rules (401, 404, 416) → `audit`-only; 402 → `audit,seo`; 450 → `launch`. So audit rules no longer leak onto non-audit same-domain jobs.
- `npx vite build` passes.

**Phase F DONE (2026-06-04) — analyser hardening:**
- **Explicit rate descriptor** in the analyser context (`JobDetail.jsx`): instead of a bare "Rate: $120", it now states HOURLY vs FIXED-PRICE vs NOT-SPECIFIED outright from `hourly_rate_*` / `fixed_budget` / `project_type`, with the matching rule to apply. Kills the "invented $120 flat / speculated £120/hr" hallucination — the analyser never has to infer rate type.
- **Anti-capitulation grounding rule** in the analyser chat `systemSuffix`: when Artem challenges a data point, the model must CITE the exact stored field, never fabricate alternatives to seem agreeable. A bare challenge is not new information. (Triggered by: analyser caving under "where do you see $120 flat?" and inventing "could be £120/hr" — when the data unambiguously had `fixed_budget=120`, `project_type=One-time`, capture "Budget: $120".)

**Phase C DONE (2026-06-04) — violation telemetry:**
- New `RuleViolation` table (`db.py`) + `POST /rule-violations` (record) + `GET /rule-violations/stats?days=N` (aggregate top checks by surface). Table auto-creates via `create_all`.
- `JobDetail.jsx`: `_recordViolations(surface, jobId, checks)` fire-and-forget; wired into the generator (records all ~21 guard booleans right after `draftCompliant`) and the analyser (records the avg-rate/interviewing/connects threshold keys).
- **Surface:** `ViolationsPanel` in `KnowledgeBase.jsx` — collapsible "⚠ Top rule violations (30d)" readout at the top of the My Rules panel, showing the most-fired generator + analyser checks with counts. Turns hardening from reactive ("user finds a problem") into data-driven ("top-3 failure modes").
- Endpoints smoke-tested end-to-end (record → aggregate). Both builds pass.

**⚠ Footgun noticed (not yet fixed):** `.env` sets `DATABASE_URL=sqlite:///upwork_jobs.db` — a RELATIVE path, so the backend's DB depends on its launch CWD. A stray empty `frontend/upwork_jobs.db` exists from a run that started in `frontend/`. The real DB is `./upwork_jobs.db` (1321 jobs). Consider switching `.env` to the absolute path (main.py's default already uses `ROOT / 'upwork_jobs.db'`) to prevent split-brain, and delete the empty `frontend/upwork_jobs.db`.

**Phase D DONE (2026-06-04) — enforcer focused:** rewrote the enforcer INSTRUCTIONS so it fixes EXACTLY the deterministic SPECIFIC VIOLATIONS and treats the RULES section as reference-only ("do NOT go hunting for other rule violations, do NOT re-evaluate the whole draft, output exactly ONE version, first char = first word of the letter"). This directly attacks the over-production we saw (doubled letter, narration leak): the enforcer no longer freelances rule applications or emits second versions. (Chose this over literally passing only the violated rules — same intent, less risk of dropping a rule needed for a judgment fix.)

**Footgun FIXED:** `.env` `DATABASE_URL` switched to the absolute path `sqlite:///C:/Users/syzov/upwork-cockpit/upwork_jobs.db`; deleted the empty stray `frontend/upwork_jobs.db`. (Backend needs a restart to pick up the new URL — resolves to the same file it already used, so no data change, just no more split-brain risk.)

**Phase B — DEFERRED BY DESIGN (not skipped):** "expand deterministic checks" is now intentionally gated on the Phase-C telemetry. Building more speculative regex guards before data shows what's actually failing would repeat the reactive-firefighting loop this overhaul was meant to end. The deterministic-first net is already broad (markdown, dashes, CJK, casing, filler closers, timelines, fabrication, audit-on-launch, irrelevant/channel-mismatched cases, credentials, launch CTA). NEXT B target = whatever tops the "⚠ Top rule violations (30d)" panel after a few days of real use.

**A–F overhaul status: COMPLETE.** A (routing) ✓, B (deferred-by-design, telemetry-gated) ✓, C (telemetry) ✓, D (focused enforcer) ✓, E (stable IDs) ✓, F (analyser hardening) ✓.

**Outcomes stats fixes DONE (2026-06-04) — `_build_outcome_stats_prompt_section`:**
- **Denominator bug:** reply-rate base now = all submitted (`_NONDRAFT` incl. viewed + invited). Was `resolved + sent`, dropping viewed/invited and inflating the rate. (Live funnel: 31 submitted vs the old wrong 23.)
- **`invited` now positive** in both global `positive` and segmented `_POSITIVE` — matches its winner-class status in routing.
- **Graduated gate:** `<3 submitted` → empty; `3-9 resolved` → short global line + "small sample, weight lightly" caveat; `>=10 resolved` → full segmented. Was a hard `<10 resolved → empty` that kept the engine DORMANT (only 2 resolved). Now emits at real volume — verified it produces "Submitted: 31 | Positive 4 (13%)" instead of nothing.

**Sync v2 extended to the MESSAGES (reply) leg (2026-06-05):** the messages-inbox leg was still on the old relay (background `MESSAGES_STATUS_SYNC` → cross-tab `cockpit:status:synced`) and kept returning "0 new". Rebuilt it to the same reliable pattern as the proposals leg:
- `background.js`: messages tab now opens with `?falconsync=1` and `active:true` (DOM scrape of the conversation list needs rendering; the proposals leg stays `active:false` because it's a raw-HTML scan).
- `messages-list.js` (v2): detects the `falconsync` marker (URL → sessionStorage stash → ASK_AUTO_SYNC fallback), scrapes the inbox, **POSTs directly to `/messages-status-sync`**, shows its own green on-page banner. No relay. Also scrapes the last-message preview + a `last_from_client` flag.
- `/messages-status-sync`: stores the inbox `last_message` preview as `client_reply_text` (only when the client sent last AND no fuller captured reply exists). Full reply text still comes from the per-conversation `/capture-conversation`.
- `Outcomes.jsx`: `syncFromUpwork` no longer waits on a relay event (neither leg uses it now). It just confirms the tabs opened, points to the two banners, and auto-refreshes the list 3× so promoted statuses surface without a manual reload.
- Extension → v3.4. Both legs are now "one shot, self-reporting, direct-POST."
- ⚠ Requires uvicorn restart + extension reload to take effect (recurring gotcha this session: the running backend has been stale).

Also wired this session: `_upsert_proposal_status` now stores `client_reply_text` (so a captured reply populates the card, not just the status); `_PROMOTABLE_TO_REPLIED` and `_STATUS_RANK` now include `invited`; messages.js v3.3 client_name blacklist (no more "Proposal submitted" as the client).

**NEXT BIG PHASE — KB-grounded asset manifest + claim-grounding (agenda, 2026-06-06):**
Root pattern behind every fabrication/miss this session: the generator's belief about "what Artem has" diverges from the KB. Two directions — (a) KB has it but the hardcoded prompt inventory doesn't → generator can't use it (the technical-SEO audit sample, KB entry 419, was forbidden because it wasn't in the prompt list); (b) KB lacks it → generator invents it (70+-city map pack, SGE recovery, "proven migration recovery"). The attachables/credentials inventory is a hardcoded prompt block — a static exception that breaks the "KB-grounded" design and must be patched by hand each time (we did exactly that for the audit sample).
Fix (the highest-leverage remaining work — dissolves the whole class instead of whack-a-mole):
  1. **KB-derived asset manifest:** tag real assets in the KB (case-study PDFs, SEO audit sample, PPC audit sample, promotion-plan sample) as an `asset` type / `asset:*` tags; inject THAT as the authoritative "what you can attach/cite" list at generate-time; delete the hardcoded ATTACHMENTS & SAMPLES block. Add an asset to the KB → instantly usable; no asset → nothing to claim.
  2. **Claim-grounding check (deterministic):** verify every "i'm attaching X" / cited case maps to a real manifest asset → strip if not (kills fabricated attachments/cases); flag if the job clearly needs a manifest asset the draft omits (catches misses like today's audit sample).
  Net: generator can only claim what the KB backs, and uses everything the KB provides; adding/removing assets becomes pure KB data entry. Multi-file (~few hours). Start with part 1 alone if scoping down.

**Post-overhaul recommendation (2026-06-04):** stop adding speculative features. Use the tool for several days so (a) the `⚠ Top rule violations` telemetry shows the real top failure modes (→ targeted Phase B), and (b) the now-live Outcomes stats accumulate resolved proposals. Both turn future work data-driven instead of reactive. Also: load real local-SEO/GBP case studies into the KB — the generator is currently blind there (surfaced when it had no grounded local case and an earlier hand-generation fabricated a "70+ city map pack" case that does not exist).

### Cover-letter cleaning pipeline — DETERMINISTIC-FIRST principle (2026-06-04)

**Hard-won lesson:** the Haiku rule-enforcer (the second Claude pass) is UNRELIABLE for mechanical fixes. Across many iterations it repeatedly ignored explicit "delete this paragraph" / "remove this phrase" instructions. Conclusion, now the governing rule:

> **If a violation is 100% pattern-detectable, repair it in CODE, never delegate the fix to the LLM enforcer.** Detect with regex → fix with regex. Reserve the LLM enforcer ONLY for genuinely judgment-based rewrites (reframing a claim, bridging a vertical gap), never for deletions/substitutions a regex can do.

**The pipeline.** Every cover-letter output (BOTH the rule-pre-check-passed early-return path AND the post-enforcer path — they must stay in sync) runs this ordered chain before `setProposal`:

```
_cleanPasteText( text )                         // markdown strip, em/en-dash→hyphen,
                                                 // CJK/non-Latin script strip, space cleanup
  → _stripGenericCaseParagraphs( …, isReg )      // on regulated/YMYL jobs, delete paragraphs
                                                 // leading with a generic-consumer case name
  → _humanizeCasing( … )                          // always-correct "I", "Artem", sentence/line
                                                 // starts; skip-list for iOS/eCommerce/etc.
  → .trim()
```

- **`_cleanPasteText`** also runs once on the first-pass draft (before the enforcer) AND again here on the final text — it's idempotent. This guarantees cleanup even when the enforcer introduces or fails to remove an artifact. Shared with chat/screening-answer output.
  - **CJK strip rationale:** the letter is English-only, so any Chinese/Japanese/Korean/fullwidth char is ALWAYS a Sonnet token glitch (observed: "審査" emitted for "review/scrutiny"). Stripped unconditionally; doubled spaces + pre-punctuation spaces collapsed.
- **`_humanizeCasing` philosophy:** casing is NEVER where human imperfection lives. Uniform lowercase "i"/"artem" is an AI tell, not a typo. Casing is always corrected deterministically; the hand-typed feel comes solely from the prompt's typo/punctuation/rhythm channel (dialled to 1–2 per letter). The old "use capital I 40–60% of the time" prompt rule was DELETED.

**Deterministic guards added this session** (detect in the enforcer pre-check; many also fixed in-code): `wrongAuditOfferOnLaunch`, `launchJobMissingCTA` (Rule 450 "5 working days" launch CTA), `irrelevantCaseOnRegulated` + the in-code `_stripGenericCaseParagraphs`, `vapeOnPpcOnlyJob` (Vape is an SEO case — channel-mismatch on pure-PPC), `missingYearsExperience` / `ppcMissingPremierPartner` (Rule 439). Regulated-vertical detection widened to peptide/bio-hacking/skincare/aesthetic/med-spa/cosmetic/YMYL across both the routing classifier and `REGULATED_VERTICAL_RE`.

**KB rule changes this session:** 407 rewritten (relevance-over-quantity, never pad, channel-match, restricted→restricted-only cases); 437 + channel caveat (Vape only on SEO-inclusive jobs); 450 + "5 working days" launch CTA; sign-off "artem"→"Artem" everywhere.

---

## 17. Conversation-capture status promotion + Outcomes refresh (2026-06-07)

Three bugs surfaced while capturing a real client reply (Rashida Ali-Campbell, job 1405, "Google ad campaign for nonprofit"): the capture detected the reply but the proposal never moved off `sent`, and the Outcomes tab kept showing the stale status.

### Bug 1 — client-name suffix poisoned the job match (THE root cause). FIXED.
`/capture-conversation` in `api/main.py` builds the KB title, then appends `" — <Client Name>"` (so the Outcomes row reads "Job — Client"). The job-matching block ran *after* that mutation and searched `Job.title.ilike(title)` / `ilike("%"+title[:60]+"%")` using the **suffixed** string — no Job row carries the client name, so the match silently returned `null`. With no matched Job, `_upsert_proposal_status` was never called, so the detected `replied` signal was dropped on **every** captured reply.
- **Fix:** snapshot the bare title into `match_title` *before* the suffix is appended, and match against `match_title`. Verified: suffixed → no match; bare → matches job 1405. Proposal 33 promoted `sent → replied`, reply text stored.
- **Note:** `/capture-standalone-proposal` was already correct (it matches by `upwork_job_id`/title before any suffixing) — only the conversation endpoint had the bug.

### Bug 2 — misleading "backend has old code" debug. FIXED.
The popup debug panel (`upwork-enricher/popup.js`, `formatDebugInfo`) rendered fields from `/capture-standalone-proposal` (`_proposal_created`, `_backfilled_fields`) against a `/capture-conversation` response, which never returns them → a permanent false "`_backfilled_fields: <MISSING — backend has old code, restart uvicorn>`" warning plus `_proposal_created: false` even on a successful promotion. Now the renderer detects the flow (presence of `_detected_status`/`_client_reply_chars` = conversation capture) and shows the right diagnostics: `_detected_status`, `_proposal_status_after`, `_client_reply_chars`, plus a clear "⚠ No Job matched → status NOT updated" when `_matched_job_id` is null.

### Bug 3 — Outcomes tab showed stale status after capture. FIXED (focus-refetch only).
Captures happen in a separate Upwork browser tab. The Outcomes list only re-fetched on (a) in-app tab switch (`active` prop) or (b) the extension's `CONVERSATION_SAVED` → `cockpit:outcome:saved` event — but if the user was already sitting on the Outcomes tab and `bridge.js` wasn't live on the dashboard tab at capture time, neither fired, so the row kept its old `sent` badge.
- **Fix:** `Outcomes.jsx` now also re-fetches on `window` `focus` / `document` `visibilitychange` (gated on `active`), so switching back from the Upwork tab self-heals the list. No manual Ctrl+F5.
- **Deferred by user choice (real but separate):** (i) `⤴ share with claude` snapshots the expanded-or-first row, so it silently grabbed an unrelated proposal (#34, mytender.io) — should confirm/indicate its target. (ii) A captured conversation writes BOTH a `/proposals` row and a KB `sent_proposal` row; the client-name suffix defeats the title-based dedup in `fetchProposals`, so the same thread can appear twice in Outcomes.

---

## 15. Glossary

- **Job** — A captured Upwork job posting (one row in `jobs`).
- **Enrichment** — Extra fields scraped from upwork.com by the Chrome extension and merged into the existing Job row.
- **Proposal** — A specific application Artem sent for a job, with its own status lifecycle.
- **KB entry** — A unit of knowledge in the KB: a case study, a sent proposal, a client reply, an article, a freeform note, a distilled chat takeaway.
- **Outcome** — The current status of a proposal in the funnel (sent → viewed → replied → … → hired/ghosted).
- **Feature bucket** — A combination of job attributes (country, rate band, client spend tier, …) used to compute historical win rates.
- **Anti-hallucination instruction** — The system-prompt clause that forces Claude to only cite facts present in the KB.
- **Distillation** — The flow where Claude reviews a chat conversation and proposes candidate KB entries for user approval. The mechanism by which chat conversations actually make the system smarter.
- **Teach mode** — Global-scope chat (no specific job loaded) used for KB curation.
- **Per-job chat** — Job-scope chat that auto-loads the job row + KB into the system prompt, used for consultation and proposal iteration.

---

## 17. Upwork API integration — probe findings & plan (2026-06-08)

Artem was granted a **read-only public API key** ("Upwork Personal Cockpit"). We probed it
exhaustively (`scripts/upwork_probe.py`, `scripts/upwork_probe2.py`; OAuth + GraphQL client
in `api/upwork_api.py`; routes `/upwork/connect`, `/callback`, `/upwork/status`, `/upwork/probe`).

### Auth
- **3-legged authorization-code only.** Client-credentials (2-legged) returns `unauthorized_client`.
- Cloudflare fronts upwork.com and 403s the default httpx User-Agent — a browser UA is required on every call.
- Token saved to `.upwork_token.json` (repo root, gitignore-worthy), auto-refreshed.
- Endpoints: authorize `https://www.upwork.com/ab/account-security/oauth2/authorize`,
  token `https://www.upwork.com/api/v3/oauth2/token`, GraphQL `https://api.upwork.com/graphql`.
  Callback `http://localhost:8000/callback`.

### What the key CAN do (confirmed by live calls)
- `marketplaceJobPostingsSearch(marketPlaceJobFilter, searchType, sortAttributes)` — **works**, 3,152
  results for "google ads". `searchType: USER_JOBS_SEARCH`, `sortAttributes:[{field:RECENCY}]`.
- `user` — works (returns Artem's account).
- Per-job node type `MarketplaceJobPostingSearchResult` returns (maps ~1:1 to the `jobs` table):
  id, title, description (FULL, untruncated), ciphertext (`~02…`), createdDateTime/publishedDateTime,
  amount (Money, fixed), hourlyBudgetMin/Max (Money), weeklyBudget, duration, engagement,
  experienceLevel, category, subcategory, skills, occupations, totalApplicants (proposals count),
  freelancersToHire/totalFreelancersToHire, premium, enterprise, preferredFreelancerLocation(+Mandatory)
  (= geo restriction), `applied` (bool — whether Artem already applied), and `client` info
  (totalSpent, totalHires, totalReviews, verificationStatus, location.country).

### What the key CANNOT do (permission-denied at call time)
- `vendorProposals` (own proposals + statuses) → **denied**. So **outcome-sync via API is NOT possible** —
  the viewed-status scraper stays.
- `ApplicationsBidStats` (avg/min/max bid on a job) → **denied** (field-level scope block inside an
  otherwise-allowed query). And no field anywhere exposes the client's **avg hourly rate PAID** —
  that signal remains extension-only (the 💵 badge can't show on API jobs).
- RICH SEARCH (added 2026-06-10): the allowed search node carries far more than first mapped —
  `client.totalFeedback` (rating), `client.totalPostedJobs` (→ hire_rate = hires/posted),
  `job.activityStat.jobActivity` (invitesSent, totalInvitedToInterview, totalHired per job =
  the ALREADY-HIRED disqualifier, totalUnansweredInvites), `skills{prettyName}` (→ keywords).
  All now mapped in `_map_node`; API jobs arrive with near-extension-level enrichment in ONE call.
  Still extension-only: avg rate paid, connects_required, screening questions, client city/member-since.
- `roomList` / `room` (messages) → denied. Reply detection stays on the scraper.
- `bidsForJob` (top-4 competitor bids) → denied.
- `clientsWorkHistory` → denied.
These exist in the schema (introspection lists everything) but are gated by oauth2 scopes.

### Server-side filters available (`MarketplaceJobFilter`)
searchExpression_eq / titleExpression_eq / skillExpression_eq (keywords), categoryIds_any,
subcategoryIds_any, occupationIds_any, ontologySkillIds_all, jobType_eq (ContractType),
workload_eq, duration_any, clientHiresRange_eq, clientFeedBackRange_eq, budgetRange_eq,
verifiedPaymentOnly_eq, previousClients_eq, experienceLevel_eq, locations_any / visitorCountry_eq,
daysPosted_eq, proposalRange_eq, pagination_eq.
→ Almost the entire bot filter set pushes server-side. Only **stop-words** and **avg-rate floor**
need our backend post-filter (avg hourly rate paid is not in the search client node).

### Plan: additive dual feed — Steps 1-2 SHIPPED 2026-06-08
1. ✅ `source` column on `jobs` (`'bot'` default / `'api'`), dedup on `upwork_job_id`. Migration backfills legacy rows to `bot`.
2. ✅ `api/upwork_api.py` `search_jobs(expr, first, after)` + `_map_node` → Job columns. Pagination needs `after:"0"` (upstream encodes paging as `{after};{first}`, a null after 500s). `POST /api-fetch` upserts with `source='api'`.
   IMPORTANT: API jobs carry **partial structured data** (rate, client spend/reviews/verification, country, applicants, geo, category) — enough to analyse, but they are NOT marked "enriched". That badge means the extension scraped FULL detail (hire rate, avg rate, client reviews, screening questions, connects). API jobs get `enriched_at=NULL`; `isEnriched` in JobList.jsx is source-aware (API jobs need an explicit extension Enrich to qualify). [Early bug: stamping enriched_at made every API row show the enriched badge — fixed.]
   - ✅ Frontend: feed toggle (All/Bot/API) + "⤓ Fetch API" button in the sidebar. Vite proxy needs `/api-fetch` + `/upwork` entries (added).
3. ✅ SHIPPED: Feed Settings (keywords, stop-words, rate floors, exclude-countries, payment-verified, require-keyword-in-text) in `feed_config.json` (seeded from the bot). `GET/PUT /feed-config`; `FeedSettings.jsx` modal (⚙ button by the feed toggle). `/api-fetch` now: per-keyword search → merge/dedup → `_row_passes` post-filter → upsert; returns drop-reason stats.
   KEY FINDING: the API `searchExpression` is loose OR-ish full-text ("ppc" and "google ads" return the same top jobs; multi-term/`OR` broadens to junk). So precision comes from the post-filter (`require_keyword_in_text` + stop words), not the search. Per-keyword searches give breadth; the filter gives precision — mirrors the bot.
   Live result: 16 kw → 320 raw → 167 unique → 46 kept / 121 dropped (facebook:20, no-keyword-in-text:42, linkedin:8, fixed<100:11, hourly<25:6, …).
Nothing in the bot/scraper/analyser/generator paths changes.

### Auto-refresh — SHIPPED 2026-06-08
`_api_feed_loop()` (api/main.py, registered on startup next to the ghost-sweep) pulls+filters+upserts
on `feed_config.auto_fetch_minutes` (default **3 min** ≈ "live like the bot"; 0 = manual only). Reads
the interval each cycle so Feed Settings changes apply without restart; runs fetch+DB in a threadpool
so it never stalls the event loop; gated on `is_connected()`; errors back off 5 min. The frontend's
existing 10s `/jobs` poll surfaces new auto-fetched jobs automatically — no manual ⤓ Fetch needed.
`POST /api-feed/prune` re-applies the filter to existing API jobs (deletes leftovers; protects jobs
with proposals). API client spend is mapped to both `client_total_spent_detail` and `client_spend`
(so it renders in the feed row like bot jobs). Inherent gaps vs bot: no avg-rate signal (API limit),
poll cadence vs real-time push.

### Future option
The denials are scope-gated, not account-gated. Artem can **"Edit Key Details"** to request the
proposals + messages scopes; if granted, `vendorProposals` would unlock **API-native outcome sync**
(retiring the worst scraper). Historically those scopes are harder to get — build on what works now.
