# Falcon Scout — Engineering Handoff

*A practical, current-state explanation of the system for a fresh Claude Code instance. Read `DESIGN.md` first for the canonical decision log and rationale; this document covers **how it actually works today**, the **algorithms**, and the **hard problems** we keep fighting.*

**Last updated:** 2026-06-06

---

## 1. What this product is

Falcon Scout automates the front of a freelance pipeline for **Artem Yatsuk** — a Google Ads / PPC / SEO specialist (Kharkiv, Ukraine; 12 yrs; Google Premier Partner 2026; 95% JSS, Top Rated). It:

1. **Captures** Upwork job postings from a Telegram bot (`@OffersHunterBot`).
2. **Enriches** each job with client/job metadata scraped from upwork.com via a Chrome extension.
3. **Triages** jobs in a 3-column dashboard: job details · AI fit analysis · AI-generated cover letter.
4. **Grounds** every Claude call in a Knowledge Base of Artem's real case studies, rules, and past proposals — to eliminate hallucination.
5. **Tracks outcomes** (sent → viewed → replied → interviewing → hired / ghosted) and feeds win-rate stats back into scoring.

Single-user, runs entirely on Artem's Windows machine. No multi-tenant concerns, no auth.

---

## 2. Architecture & key files

| Layer | Tech | Location |
|---|---|---|
| Telegram capture | Python + Telethon | `listener.py` |
| Message parsing | Python regex | `parser.py` |
| Persistence | SQLite + SQLAlchemy | `upwork_jobs.db`, `db.py` |
| Backend API | FastAPI + Uvicorn `:8000` | `api/main.py` |
| Frontend | React + Vite `:5180` | `frontend/src/` |
| Chrome extension | Manifest V3 | `upwork-enricher/` |
| LLM | Claude (`claude-sonnet-4-5`, Haiku for enforcement) via `/claude` proxy | — |
| Launcher | `falconscout.bat` | — |

**The single most important frontend file is `frontend/src/components/JobDetail.jsx`** (~4,400 lines). It contains the entire analyser prompt, the entire generator prompt, the deterministic rule pre-checks, the inline-chat protocol, and the additional-questions logic. When something is wrong with analysis or cover letters, it is almost always here.

Other notable files:
- `frontend/src/App.jsx` — top-level layout, job feed sidebar, tab-flash notifications, sync orchestration.
- `frontend/src/components/Outcomes.jsx` — proposal funnel management, status editing, bid editing, sync-from-upwork trigger.
- `frontend/src/components/KnowledgeBase.jsx` — KB CRUD, rules, Core toggle, type/tag handling.
- `frontend/src/components/Dashboard.jsx` — week-by-week funnel stats.
- `frontend/src/components/JobList.jsx` — feed rows (rate, avg-rate, applied badges, enriched badge).
- `upwork-enricher/content.js` — scrapes job-detail pages → POST `/enrich`.
- `upwork-enricher/proposal.js` — scrapes proposal pages, captures bids at submit, scrapes the proposals-list for viewed status.
- `upwork-enricher/background.js` — service worker; opens sync tabs, routes scraped data to the backend.
- `upwork-enricher/bridge.js` — page↔extension event bridge (the dashboard dispatches `cockpit:*` CustomEvents, bridge relays to background).

**Conventions:**
- All Claude calls go through the `/claude` proxy (CORS-safe; frontend never calls Anthropic directly). The proxy reads an optional `_kind` field (`analysis`, `proposal`, `proposal_rescan`, `chat`, etc.) used for token tracking, stats injection, and prompt caching.
- Job dedup key is `upwork_job_id` (the `~01abc…` hex from the Upwork URL).
- The extension version in `manifest.json` must be bumped on every extension code change — Chrome caches the service worker aggressively and a reload won't pick up changes otherwise. (We're at 3.x.)

---

## 3. Data model (core tables)

**`jobs`** — ~50 columns. Core (title, url, rates, country, captured_at) + enrichment (proposals count, hire_rate, client spend/rating/reviews, payment_verified, avg_rate, geo_restriction, preferred_qualifications, screening_questions, description_full) + cached analysis (`last_analysis_json`, `last_analysis_at`).

**`kb_entries`** — the Knowledge Base. `type` ∈ {manual, scraped, sent_proposal, client_reply, chat_transcript, rule, note, case_study, blog_post}. `is_core` boolean gates the "always-on" subset. Rules are implicitly Core. `content` is markdown.

**`proposals`** — one row per application Artem sent.
- `status` ∈ {draft, sent, viewed, replied, interviewing, hired, declined, ghosted, expired, withdrawn, **invited**}
- `bid_amount` / `bid_currency` (currency is usually `Connects` — see §7)
- `sent_text`, `client_reply_text`, `notes`, `contract_value`
- `submitted_at`, `status_updated_at`
- **`job_snapshot_json`** — critical: full JSON of the Job's enriched fields *at save time*. Similarity matching and stats run against the snapshot, not the live job (which keeps mutating via re-enrichment).

**`token_usage`** — one row per Claude call (kind, model, in/out/cache tokens) → powers the header cost chip.

---

## 4. The pipeline, end to end

1. **Capture.** `listener.py` (Telethon) watches `@OffersHunterBot`, `parser.py` regex-parses each message into a Job dict, dedups by `upwork_job_id`, saves. URL is extracted from message entities + inline keyboard buttons. On startup, `catchup_missed_jobs` + `repair_missing_urls` backfill anything missed.

2. **Enrich.** Artem opens a job → clicks Enrich. The dashboard dispatches `cockpit:enrich` → bridge → background opens the Upwork job page as a background tab → `content.js` scrapes client/activity/description → POST `/enrich` → fields merged onto the Job row (never overwriting non-null with null). Tab auto-closes.

3. **Analyse.** Claude scores APPLY / MAYBE / SKIP (0–10) with reasons + flags. Prompt = Artem profile + rules + Core KB + the job summary. Output is strict JSON, parsed in the frontend, cached server-side.

4. **Generate.** Claude writes the cover letter in Artem's voice, grounded in KB rules + Core + similarity-ranked past winners + case studies. Runs through deterministic pre-checks → optional Haiku enforcer → deterministic post-strips → textarea.

5. **Apply + capture.** Artem submits on Upwork. `proposal.js` captures the bid (Connects) at submit-time and the cover-letter text post-submit → POST creates/updates a `proposals` row with a job snapshot.

6. **Sync outcomes.** "Sync from Upwork" opens the proposals list + messages inbox as background tabs; scrapers detect "Viewed by client" and replies; statuses promote (sent→viewed, sent→replied). Pulsing dots flag new activity on the Outcomes filter chips.

7. **Feedback loop.** Once ≥10 proposals have resolved outcomes, win-rate stats are injected into the analyser/generator prompts. `/proposals/similar` surfaces "N similar jobs got a response" badges and feeds winning exemplars to the generator.

---

## 5. The analyser (scoring) algorithm

Lives in `JobDetail.jsx` `AIAnalysisColumn`. The system prompt is assembled per-call from:

- **Artem's real profile** (location, JSS, earnings, rate history $30–50/hr, Premier Partner is **PPC-only, not an SEO credential**, proven verticals).
- **CRITICAL RULES** — all KB `type=rule` entries, injected as bullets.
- **CORE KB CONTEXT** — `is_core=true` entries (case studies, red-flag patterns).
- **Liked analysis examples** (style reference).
- **The job summary** — including `avg_rate` (client's historical pay), preferred qualifications, activity.

Scoring bands (enforced in-prompt):
- **0–1** → reserved for the 4 HARD DISQUALIFIERS only (geo-locked US-only, rate ceiling < $15, unverified + <5 reviews, already-hired ≥1).
- **2–4** → SKIP for fit reasons (vertical gap with experience gate, heavy specialization Artem lacks).
- **5–6** → MAYBE.
- **7–10** → APPLY.

Notable scoring rules baked in:
- **Rate-range interpretation**: compare the *ceiling* to $30, not the floor. $15–29 ceiling → −1 + flag, not skip.
- **Fixed-budget conversion**: estimate hours from scope, compute effective hourly, compare to $30.
- **Client avg rate signal**: avg < $20/hr → −1 + flag ("budget-conscious client").
- **Preferred-qualification mismatch**: −1 per missed criterion, floored at 5. **Ukraine IS in Europe** — "Location: Europe" is NOT a mismatch (this was a real bug).
- **Rule 2 (no live sessions) over-trigger guard**: routine PPC optimization verbs ("A/B test", "rapid tests", "optimize bids") must NOT trigger the no-synchronous-work rule.
- **Outcome stats injection** (when ≥10 resolved): global reply/hire rate + segmented reply rates by spend tier / rate band / country.

---

## 6. The generator (cover letter) algorithm — and the enforcement architecture

This is the most complex and most-iterated part of the system. The generator must produce a letter that obeys dozens of Artem-specific rules. **Prompt engineering alone proved unreliable**, so there is a **three-layer enforcement model**:

### Layer 1 — Prompt (preventive)
The generator system prompt includes: voice rules, KB rules (as content bullets, NOT numbered — see §8), NO FABRICATED DIAGNOSIS section, AUDIT OFFER rules (context-dependent: existing account → audit + "1 working day" + sample; launch-from-scratch → setup plan, no audit), case-study selection (vertical match), attachments inventory (only specific approved materials exist), humanization (mixed "I"/"i", 2–4 deliberate typos), and a silent RULE COMPLIANCE GATE checklist.

### Layer 2 — Deterministic pre-checks (detection, free)
Before spending a Claude enforcer call, regexes check the draft for known failure modes:
- `timingCompliant` — extract every "N working days" from the draft; it must be a subset of the timings the rules permit (audit = 1, SEO plan = 2). "5-7 working days" → fails.
- `hasFabricatedDiagnosis` — "I took a look at…", "I checked your…", "looking at your account…".
- `hasForbiddenPhrase`, `missingPdfLabel`, `missingAuditSampleMention`, `missingCaseStudy`, `missingHighlightsPhrase`, `caseStudyDomainMismatch`, `missingSeoPlanOffer`, `wrongSeoPlanTiming`, `coverHasTimeline`, `hasUnsolicitedLogistics`, `hasFillerCloser`, `regulatedJobMissingVape`, `vapeFabrication`, `missingYearsExperience`, `ppcMissingPremierPartner`, `launchJobMissingCTA`, `irrelevantCaseOnRegulated`.
- If **all** pass → `draftCompliant` → skip the enforcer (saves ~$0.0015).

### Layer 3 — Haiku enforcer + deterministic post-strips (correction)
If any pre-check fails, the draft + a list of **specific violation instructions** are sent to a Haiku enforcer to rewrite. **The Haiku enforcer is unreliable — it routinely ignores instructions.** So for the highest-confidence, 100%-detectable failures we do **deterministic code stripping** instead, applied at every exit point (fast-path, post-enforcer, chat-rework):
- `_stripGenericCaseParagraphs` — removes consumer case studies (FridgeFix, House Painting, etc.) on regulated/YMYL jobs.
- `_stripFabricatedOpener` — removes a leading "I took a look at <domain> - <invented business description>" sentence.
- `_cleanPasteText` + `_humanizeCasing` — strips markdown/CJK, applies the human casing mix.
- `_stripLeadingNarration` — drops "here's the reworked letter" preambles that leak into `<proposal>`.

**Design principle that's emerging:** *anything 100% pattern-detectable should be fixed in deterministic code, not delegated to the enforcer LLM.* The enforcer is a fallback for genuinely semantic fixes only.

---

## 7. The Chrome extension — scraping algorithms

### Enrichment (`content.js`)
Fires on job-detail URLs. Regex-extracts client metadata from `document.body.innerText`. POSTs to `/enrich`. A popup debug panel shows what was scraped vs. what the backend stored.

### Bid capture (`proposal.js`)
**The bid IS the Connects count, not the hourly rate.** Upwork's submit button reads "Submit for 17 Connects" — that number is captured at submit-click time from the button text and stashed (`falcon_last_submit`) with the job_id. On the post-submit redirect the stash is read (< 60s old) and POSTed. Dollar hourly rate is *not* the bid and is no longer extracted (it caused wrong values from page rates/fees). `bid_currency` is usually `Connects`.

### Viewed-status sync (`proposal.js` → `buildViewedTitleSetFromHtml`)
**This is the hardest scraper and has been rewritten several times.** Upwork's proposals list links job titles to **numeric proposal IDs** (`/nx/proposals/2061…`), NOT job IDs (`~hex`). So scanning the HTML for `~hex` near "Viewed by client" always returned empty. The current approach: scan `document.body.innerHTML` for each "viewed by client" occurrence, look backward ~2500 chars, extract the nearest substantial text node (the job title), build a Set of lowercased title prefixes, then match rows by title (exact then fuzzy). The "Viewed by client" indicator is sometimes only rendered on hover / via visibility-toggled elements, so detection uses `textContent` (not `innerText`) + computed-style visibility checks + absolute Y-coordinate geometry as fallback layers.

### Sync orchestration
"Sync from Upwork" → `SYNC_PROPOSAL_STATUSES` → background opens proposals list (`?falconsync=1`) + messages inbox **as background tabs** (no focus steal). Scrapers POST to `/proposal-status-sync` (viewed) and `/messages-status-sync` (replies). Results bubble back via `PROPOSAL_STATUS_SYNCED` → `cockpit:status:synced` → Outcomes adds pulsing activity dots for `newly_viewed`/`newly_replied`.

---

## 8. Similarity matching & outcome-aware scoring

**`GET /proposals/similar?job_id=N`** (defined BEFORE `/proposals/{id}` — route order matters in FastAPI). Scores every past proposal (with a snapshot) against the target job by feature overlap:
- same category +3 · rate-band overlap +2 · spend-tier overlap +2 · country-bucket overlap +1 (max 8).

Returns top 10 sorted by score then status rank, with `positive_count` / `cold_count`. Used by:
- **Analyser badge** — "✓ N similar jobs got a response" (green) / "⚠ N similar jobs ghosted" (amber), shown when total ≥3.
- **Generator** — replaces the old flat winner-fetch; ranks past proposals by outcome (positive → unmatched → cold) and labels winners `[WINNER — replied on similar job, similarity 6/8]`.

**Outcome stats** (`_build_outcome_stats_prompt_section` in `api/main.py`) — gated at ≥10 resolved outcomes; injects global reply/hire rate + segmented breakdowns into analysis/proposal prompts via the `/claude` proxy. Below the gate it's a silent no-op.

---

## 9. The hard problems (read this section)

These are the recurring battles. A new instance will hit all of them.

### 9.1 Hallucination & rule reliability — THE central challenge
The model invents things and ignores rules. Concretely:
- **Invented rule numbers.** Root cause: the codebase numbered rules *inconsistently* — backend `/chat` numbered them sequentially (`Rule 1..N`), the frontend analyser/generator labelled them by KB id (`Rule 402`, `Rule 436`). Same rule, different number per path → the model confabulated plausible numbers ("Rule 27" when only ~21 exist). **Fix applied:** rules are now injected as plain `- content` bullets everywhere; the model is told to reference a rule by *what it says*, never by number. Numbers were the hallucination fuel.
- **Fabricated diagnosis.** The model claims it visited the site ("I took a look at acme.io") or invents the client's business model from just a company name. Covered by an in-prompt NO FABRICATED DIAGNOSIS section + a deterministic `_stripFabricatedOpener` + a rule against describing a business when the posting only gives a name/URL.
- **Rules silently skipped.** The Haiku enforcer is the weak link — it detects-then-fails-to-fix. The strategy is migrating from "ask the enforcer to fix it" toward "fix it in deterministic code wherever the pattern is 100% detectable."

### 9.2 Truncation
`max_tokens` set too low silently cut letters off mid-sentence (and masked the missing sign-off, making letters look CTA-less). Generator is now at 2000. Watch for this whenever output ends abruptly.

### 9.3 Viewed-status scraping fragility
See §7. Upwork's SPA, CSS-toggled visibility, and numeric-vs-hex IDs make this brittle. Permanently DESCOPED: full `/nx/messages/` thread scraping (DESIGN.md §6) — too complex for the payoff; only viewed + first-reply detection is in scope.

### 9.4 Bid semantics
Connects vs dollar rate confusion caused repeated wrong captures. Resolved: bid = Connects, captured from the submit button. Manual override field exists in Outcomes.

### 9.5 Case-study vertical mismatch
The generator likes to cite consumer cases (FridgeFix/House Painting) on B2B/regulated briefs. Mitigated by the case-study selection rule + deterministic stripping on regulated jobs. Underlying cause: the KB lacks B2B/SaaS/automotive case studies, so there's nothing closer to reach for.

### 9.6 Cover-letter ↔ screening-answer duplication
When the client asks "describe your experience" as a screening question, both the letter and the answer want the case studies. The additional-questions mode emits dual output (`<chat_reply>` answers + reworked `<proposal>`) and is supposed to strip the overlap from the letter. Detection (`SCREENING_Q_RE`) was broadened to catch imperative phrasings ("describe your…", "tell us about…", "share examples…"). The dedup directive now explicitly orders case studies into the answer and out of the letter.

### 9.7 Extension reload / context invalidation
After bumping the manifest version and reloading the extension, already-open Upwork tabs run an orphaned content script ("Extension context invalidated"). Always hard-refresh (Ctrl+Shift+R) the relevant tab after reloading the extension. The `#root { zoom: 1.2 }` CSS in the frontend is intentional — removing it breaks layout; do not touch.

---

## 10. How to run / debug

```bash
falconscout.bat                                   # everything
uvicorn api.main:app --reload --port 8000         # backend only
cd frontend && npm run dev                         # frontend only (Vite :5180)
python listener.py                                 # listener only
```

- **Backend console** is the source of truth for enforcement: `[stats-inject]`, `[cache]`, `[Falcon] Rule pre-check…` lines tell you which guards fired.
- **Chrome DevTools console on the Upwork tab** shows scraper diagnostics (`[Cockpit Proposal] HTML title-scan…`, `Stashed submit…`).
- **`share-with-claude.md`** at repo root is how Artem hands a job/outcome snapshot to this Claude Code instance for review — when he says "shared", read that file.
- DB: `upwork_jobs.db` at repo root. Quick inspection via `curl http://localhost:8000/jobs` / `/proposals` / `/kb`.

---

## 11. Pending / loose ends

- **Deterministic audit-timing normalizer** — the enforcer timing instruction was made explicit (passes the exact offending + allowed timings to Haiku), but a fully deterministic `_normalizeAuditTiming` code-strip was *discussed but not yet implemented*. It's the logical next step given §9.1's "fix detectable patterns in code" principle. Be careful: audit → "1 working day" but SEO plan → "2 working days", so any deterministic replace must be context-aware (anchor on the word "audit").
- **B2B / SaaS / automotive case studies** — the KB gap behind §9.5. Real content Artem must add; not a code fix.
- **Rule-numbering unification** — the bullet-injection fix removed the *hallucination* surface, but the My Rules panel, backend `/chat`, and frontend still compute rule identity differently. If numbered citations are ever reintroduced, unify on one scheme first.

---

*Canonical decisions, the seven-phase build sequence, and "what we deliberately don't do" live in `DESIGN.md`. This handoff is the operational companion — features, algorithms, and the live battle with hallucination/reliability.*
