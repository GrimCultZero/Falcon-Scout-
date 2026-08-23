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

---

## 2026-06-09 — Persistence, backup buttons, and the `//save` trigger

Locked down "never lose the thread" end-to-end:
- **GitHub**: repo live at `https://github.com/GrimCultZero/Falcon-Scout-` (private). Whole project + memory docs pushed. Push-protection caught two stray key files on the first attempt (`frontend/.env.txt`, `frontend/frontend_env.txt`) — purged before reaching GitHub, no secret exposed, no rotation needed. Also fixed `share-with-claude.md` being tracked (inline comment had broken the .gitignore rule) — it holds transient client/job data, now ignored.
- **`Backup/` folder = one-click buttons** (not file copies — the repo IS the backup): `sync.bat` (stage→commit→pull→push), `get-latest.bat` (pull). They travel in the repo so every clone has them. For the human as a manual override; Claude also syncs automatically per the protocol.
- **Memory docs** = the cross-account brain: `DESIGN.md` (decisions), `PROJECT_HANDOFF.md` (how it works), `WORKLOG.md` (this — session narrative), `CASES.md` (solved client examples). GitHub is the shared brain; no live link between instances — they coordinate via pull/push. Another account just needs clone + push access (same GitHub login or collaborator).
- **Verbatim chat caveat**: Claude Code keeps raw transcripts locally (`~/.claude/projects/...`, ~107MB) but we do NOT push them — they contain secrets pasted in chat (e.g. the Upwork API secret). Cross-account memory is the *distilled* docs, which are secret-free by construction.
- **`//save` trigger shipped**: owner types `//save` (or `/save` slash command) → Claude distills the recent essentials into WORKLOG.md (or CASES.md), commits, pushes. Spec in `CLAUDE.md`; slash command in `.claude/commands/save.md` (committed so it works on every clone). This very entry was created by the first `//save`. Owner-flagged capture complements the automatic end-of-session distillation.
- **`//save` final semantics (locked in)**: scope = the **latest topic discussed**, distilled to the essentials **useful to the app/project in general** (decisions, methods, findings, patterns — not trivia/chit-chat/dead-ends). It **commits AND pushes automatically**, no pause for permission. `//save: <note>` lets the owner steer what to emphasize. Behavior is capture-then-confirm (one-line confirmation of what landed). Identical on every account because the rule is in `CLAUDE.md` and the command in `.claude/commands/`.

---

## 2026-06-15 — Web dev scope expansion + background auto-enrichment

### Web dev scope (Shopify / WordPress / OpenCart) — shipped
Expanded Artem's Upwork scope beyond PPC/SEO to ecommerce web development. Positioning locked
in: same agency-as-freelancer pattern (client sees a freelancer, delegation is invisible); no
scope exclusions yet; 12 years framed as "12 years in digital/ecommerce", NOT "12 years of web
dev" (false); Premier Partner badge NOT cited on pure web dev jobs. Full-scope differentiator is
the pitch: most devs hand off to a separate SEO person later — IT Force wires SEO architecture +
GA4/GTM into the build itself. Primary case study: **GKit** (gkit.com.ua, OpenCart + KeepinCRM
bidirectional sync, dual-language UA/RU hreflang, launched Q1 2026, 2,600 impressions month one).
- Files: `feed_config.json` (+9 web dev keywords; removed react/backend/frontend/fullstack from
  stop_words — they were blocking legit Shopify/WP jobs), `JobDetail.jsx` (new `webdev` scope in
  `jobScopes()`; expanded analyser CORE EXPERTISE + weak-fit for custom software eng = 2-4 not
  skip; generator identifier), `scripts/import_webdev.py` (imports GKit case + 5 webdev rules to KB).
- Full detail in `DESIGN.md` §18. Two more case studies pending from Artem (import via the script
  or KB tab). **Bot keywords still need manual add** in @OffersHunterBot: shopify, wordpress
  developer, woocommerce, opencart, ecommerce website.

### Background auto-enrichment — shipped
"As soon as a job pops up in the feed, enrich it in the background." The mechanics already existed
(content.js scrapes any job page → `OPEN_BACKGROUND_TAB` + `_bgTabs` + ENRICH_JOB auto-closes the
tab). Added the missing queue + driver:
- **Backend** (`api/main.py`): `GET /jobs/pending-enrich` returns up to `auto_enrich_batch` jobs
  that are unenriched (enriched_at NULL), have a URL, not hidden, captured within
  `auto_enrich_max_age_hours`, under the retry cap, past cooldown, and not already applied to.
  Gated on `feed_config.auto_enrich`. `POST /jobs/{id}/enrich-attempt` bumps `enrich_attempts` +
  stamps `last_enrich_attempt_at`. New jobs columns `enrich_attempts` / `last_enrich_attempt_at`
  (runtime ALTER migration + db.py model).
- **Extension** (`background.js`, manifest → 3.9): new `falcon-auto-enrich` chrome.alarm every 3
  min. `_runAutoEnrich()` fetches the queue, marks each attempt BEFORE opening (so a dead/expired
  URL counts against its 3-attempt budget and isn't reopened forever), opens hidden tabs staggered
  6s apart, failsafe-closes after 2 min. In-flight guard prevents overlapping cycles.
- **Frontend** (`FeedSettings.jsx`): auto-enrichment block (toggle + jobs-per-cycle + max-age),
  flagged as affecting BOTH feeds (unlike the rest of that modal, which is API-only).
- Config keys in `DEFAULT_FEED_CONFIG`: `auto_enrich` (true), `auto_enrich_batch` (2),
  `auto_enrich_max_age_hours` (72). Backend constants: `_ENRICH_MAX_ATTEMPTS=3`,
  `_ENRICH_COOLDOWN_MIN=20`.
- **Why attempt-tracking, not just enriched_at:** `/enrich` always stamps enriched_at, so once a
  tab POSTs the job leaves the queue regardless of data quality. But a tab that NEVER POSTs (login
  wall, dead URL, behind-tab render throttle so nothing scrapes) would otherwise be reopened every
  cycle forever. Attempts + cooldown bound that. Known caveat: a partial scrape (throttled bg tab
  that got client data but not the activity sidebar) still stamps enriched_at and leaves the
  queue — Artem can manually re-enrich the few that matter before applying.
- Verified live: queue returns real unenriched jobs, batch size honored, attempt increments,
  cooldown removes attempted jobs and advances the queue. **Needs extension reload** (manifest 3.9)
  + the user signed into Upwork for tabs to actually scrape.

---

## 2026-06-16 — Generator: kill the "technical SEO audit in 2 working days" violation

Recurring (3× in a row): generator promised a "technical SEO audit in 2 working days". Not a model
slip — the hardcoded prompt (JobDetail.jsx SEO deliverable section A) literally told it to say that,
contradicting KB Rule 416 (technical SEO audit = ~2 weeks, timeline OMITTED from the letter). The
"2 working days" turnaround is the SEO PROMOTION PLAN only (Rule 402); the "1 working day" is the
PPC audit only. Same "hardcoded prompt diverges from KB" class as §16.
Fix (deterministic-first):
- Prompt corrected: offer the diagnostic deliverable with NO day-count; spelled out the turnaround
  map (PPC audit=1 day, SEO plan=2 days, SEO audit=no timeline).
- New `_stripSeoAuditTurnaround()` — strips a day-count that directly follows an SEO-flavoured
  "audit". Self-gating so it never touches the SEO plan's "2 working days" or the PPC audit's "1
  working day". Applied at the early-clean point (covers both early-return + enforcer paths) and the
  two final setProposal chains (idempotent). Records `seoAuditTurnaround` telemetry.
- Verified the regex on 6 cases: all 3 violation variants stripped clean, SEO plan + both PPC-audit
  phrasings untouched. Frontend builds. Full detail in DESIGN.md §20.

---

## 2026-06-16 — Analyser & Generator discipline improvements (7 fixes)

Triggered by a live critique session on job 2290 (parasite SEO, $500 flat, Hong Kong). The
analyser gave it 6/10 MAYBE despite an experience gap and explicit proof requirement the
generator then wrote a 900-word proposal that self-disqualified at the end ("The gap: I haven't
executed the specific outreach-to-editorial-teams workflow you're describing"). Root-cause analysis
identified 7 distinct failure modes. All fixed in JobDetail.jsx (commit eb3d6a8).

ANALYSER fixes:
1. EXPLICIT PROOF REQUIREMENT: "share examples of content you ranked on X" (with no matching
   case study) now forces score 2-4 (SKIP). Was being scored 5-6 (MAYBE), which is wrong when
   the client will literally evaluate proposals against that requirement.
2. FLAT-RATE avg_rate exception: historical hourly avg_rate is a weak signal on fixed-price
   jobs. "Client avg $34/hr > $30/hr floor — positive" is wrong reasoning on a $500 flat project.
   Rate-floor risk on flat jobs comes from the effective hourly calc (FIXED-PRICE RATE RULE), not avg.
3. ANTI-REPOSITION (general): added a broad guard against suggesting scope pivots when the
   job's scope is unambiguous ("reposition as audit-only" on a parasite SEO job is false hope).
   Coaching-type jobs already had this; now it applies to all job types.

GENERATOR fixes:
4. SKIP gate: analysis verdict + summary + flags now passed into jobContext. When verdict is
   SKIP, generator produces a short pass note (< 60 words) instead of a full proposal. Previously
   it wrote a full letter regardless, with the hidden "The Analyser has already approved this job"
   instruction actively blocking skip logic.
5. DO NOT LECTURE: new voice rule forbids opening by questioning the client's chosen strategy.
   If client chose parasite SEO, they know what it is — don't open with a brand-safety lecture.
6. BUDGET-BASED LENGTH CAP: fixed-price jobs under $1,000 → hard 200-word cap. The parasite SEO
   job was $500 and got a 900-word letter. Cap is budget-tier, not client-ask-for-brevity.
7. EXPERIENCE-GAP EXCEPTION in case study selection: when analyser flags an experience gap OR
   the posting requires proof Artem doesn't have, skip the case study section entirely. Off-target
   case studies (owned-domain SEO results cited on a third-party platform ranking job) actively
   signal you didn't read the brief. Zero > wrong.

---

## 2026-06-19 — SKIP gate deterministic + webdev CTA + fabricated vertical experience (commit 0b88be3)

Triggered by job #2868 (WordPress Developer for Car Rental Website, $145 flat, AU). SKIP 2/10
(unverified client + $9.67/hr effective rate). Generator produced a 300-word full proposal despite
the SKIP verdict. Two additional violations in the letter: fabricated "12 years building car rental
sites on WordPress" and a "3-month SEO promotion plan in 2 working days" CTA on a website-build job.

Three fixes (all in JobDetail.jsx):

1. SKIP gate moved from prompt to code (DESIGN.md §16 principle).
   - Before: generator received "IF THE VERDICT IS SKIP: write a SHORT PASS NOTE" in the system
     prompt. Model reliably ignored it and wrote a full letter every time.
   - Fix: generate() now checks storedAnalysis?.verdict === 'SKIP' BEFORE fetching KB and calling
     Claude. If SKIP and no skipOverride, short-circuits to a deterministic pass note:
     "Skip — [summary]. Not applying on this one." — zero API cost.
   - The Redo button now passes { skipOverride: true } so Artem can still force-generate a full
     letter for a SKIP job when he wants to see what it would look like or debug fit.

2. NO FABRICATED DIAGNOSIS extended to cover vertical-specific web dev history.
   - Existing rule covered "most of my healthcare clients are US-based" (client-base fabrication).
   - New bullet: NEVER claim to have "built [car rental / restaurant / hotel / gym] sites on
     WordPress" when no such case study exists. The only documented web dev build is GKit (fashion
     ecommerce, OpenCart). For any other vertical, the hook must frame the transferable method
     ("SEO architecture wired into the build from day one") — not invent a vertical track record.

3. SEO JOB DELIVERABLE gets a (C) webdev branch; enforcer updated to match.
   - Problem: car rental posting says "SEO-friendly design" + "SEO Best Practices" → jobIsSeo
     fires → enforcer demanded an SEO promotion plan offer on a website-build job.
   - Prompt: added (C) branch: on website-build jobs (WordPress dev, Shopify, "build a website"),
     do NOT offer the 3-month SEO plan — that's a campaign deliverable, wrong for a developer scope.
     CTA becomes "project scope with timeline" or just sign-off.
   - Enforcer: added WEBDEV_JOB_RE detection; `missingSeoPlanOffer` now only fires when
     jobIsSeo && !jobIsPpc && !jobIsWebdev. Prevents false-positive enforcer pass on dev jobs.

Key pattern: webdev jobs often mention "SEO-friendly" as a build requirement, not a campaign scope.
jobScopes() correctly adds both 'seo' and 'webdev' — the distinction matters for deliverable selection.

---

## 2026-06-22 — Boost bid competition capture

### What we built
New end-to-end feature: captures the "Boost your proposal" bid competition table from Upwork's apply page and surfaces it in the cockpit.

**Why:** The apply page (`/nx/proposals/job/~{id}/apply/`) shows a real-time table of how many Connects other bidders are putting in for boosted visibility (rank 1–4, connects amount, age). Knowing the competition before bidding saves connects.

### Files changed (7)
1. **`db.py`** — added `boost_bids_json TEXT` + `boost_bids_captured_at DATETIME` to Job model
2. **`api/main.py`**:
   - `_ensure_job_columns()`: migration for the 2 new columns
   - `_serialize_job()`: added `boost_bids` (parsed JSON array) + `boost_bids_captured_at` to response
   - New endpoint: `POST /jobs/{job_id_raw}/boost-bids` — receives and persists bids data
3. **`upwork-enricher/apply.js`** (new) — content script for `/nx/proposals/job/*/apply/` pages:
   - Waits up to 12s for the bid table ("1st place ... Connects") to appear
   - Extracts via regex: `(\d+)(?:st|nd|rd|th)\s+place\s+([\d,]+)\s+Connects\s+([^\n]+)`
   - Sends `BOOST_BIDS { job_id, bids, scraped_at }` to background.js
4. **`upwork-enricher/manifest.json`** (v3.9 → v4.0):
   - Added content_scripts entry for apply.js on `*/apply/*` URLs
   - Added `exclude_matches` to proposal.js entry to prevent both scripts running on apply page
5. **`upwork-enricher/background.js`**:
   - `BOOST_BIDS` handler: POSTs to `/jobs/{id}/boost-bids`, closes background tab on success
   - `_runAutoEnrich()`: after opening each job tab, also opens the apply tab (if `upwork_job_id` known)
   - `OPEN_BACKGROUND_TAB` handler: also opens apply tab in parallel from manual Enrich button
6. **`frontend/src/components/JobList.jsx`** — purple `⚡{N}c` badge when boost_bids present (top bid connects)
7. **`frontend/src/components/JobDetail.jsx`** — "Boost competition" section in Activity block (rank icons 🥇🥈🥉, connects, age)

### Key decisions
- Apply tab is opened in parallel with the job tab (not after) — both are independent, both close on success
- `_bgTabs` + `_scheduleTabCleanup(2)` used for apply tabs too — same failsafe as job tabs
- `exclude_matches` in manifest.json prevents proposal.js from double-injecting on apply pages
- Endpoint uses `or_(upwork_job_id == id, upwork_job_id == '~'+id)` — same dedup pattern as /enrich
- Frontend parses `boost_bids_json` on the backend side (like `last_analysis_json`) so frontend just uses `job.boost_bids` as a JS array

### Testing notes
- Requires extension reload (v4.0) after Chrome extension update
- Apply page only shows bid table when logged in and the job is open for applications
- If no bids yet (nobody has boosted), `extractBids()` returns [] and nothing is stored — existing `boost_bids` value is preserved (not overwritten to [])

---

## 2026-06-23 — "Viewed" sync failure root-caused via live DOM (duplicate jobs)

**Symptom.** A proposal the client had clearly viewed never flipped to "viewed" in
the dashboard, across multiple sync attempts. Earlier blind fixes (active-tab,
broader viewed-regex) didn't move it.

**Method that finally worked: stop guessing, inspect the live page.** Used
Claude-in-Chrome to open `/nx/proposals/`, scroll the Submitted section to hydrate
it, and dump the real structure. Findings:
- The viewed indicator is `<span class="relative-time"> Viewed by client </span>`
  next to an eye SVG, inside the row `<td>`. It exists in the HTML on exactly the
  ONE viewed row (the page-wide "viewed by client" count is 1, not smeared).
- That span is `display:block; visibility:visible` BUT **`width:0; height:0`** —
  so `body.innerText` drops it entirely (no layout box). `textContent` / the row's
  `outerHTML` still contain it. ⇒ innerText-based detection can never see it; the
  per-row **outerHTML** fallback is the correct signal. Replicating the scraper
  logic live, the row WAS correctly flagged `viewed:true` via outerHTML. So the
  scraper was fine.

**The actual bug was in the backend `/proposal-status-sync` title fallback.**
The DocuFence job exists as TWO Job rows with identical titles but different
numeric ids (3214 = no proposal, 3216 = Proposal #45 `sent`) — the listener
captured it twice under different ids, so `upwork_job_id` dedup missed it. The
old code did `Job.title.ilike(title).first()` → got 3214 → looked up ITS proposal
→ None → row dumped to `not_matched`. The viewed flag never reached #45.

**Fix (api/main.py).** Title fallback now gathers ALL jobs sharing the title and
picks the one that actually HAS a proposal, preferring a promotable (sent/draft)
one. Verified end-to-end: POSTing the real scraped row returned
`updated:1, newly_viewed:1`; Proposal #45 is now `viewed`.

**Reusable lessons.**
1. For "the scraper missed X" bugs, open the live page with Chrome MCP and dump
   the real DOM/computed-style BEFORE touching regexes. Zero-size-but-present
   elements (innerText-invisible, outerHTML-present) are a recurring Upwork
   pattern — always prefer outerHTML/textContent for status badges.
2. Duplicate Job rows (same title, different ids) silently break any
   `Job→first→Proposal` lookup. Matching that walks ALL candidate jobs to the one
   with a proposal is the robust pattern. (Latent data-quality issue: the listener
   can capture the same job under two numeric ids — worth a dedup pass later.)

---

## 2026-06-23 — Job dedup script (dedup_jobs.py)

**Why:** The DocuFence duplicate surfaced a latent data-quality issue: the
listener occasionally captures the same Upwork job twice under different numeric
upwork_job_ids (when the real `~HEX` ID can't be extracted), so the UNIQUE
constraint doesn't catch it. The defensive fix in `/proposal-status-sync` (commit
8e55fc7) handles the symptom; this script is the cure.

### What we built

`dedup_jobs.py` (repo root) — standalone dedup script with `--dry-run` (default)
and `--execute` modes. Three categories:

**A — Bot noise:** Telegram system messages (`? The bot is temporarily down!` etc.)
saved as jobs. 4 groups, 51 rows. Identified by NULL upwork_job_id + known bot
announcement phrases after stripping leading emoji. All deleted except the earliest
by id; none have proposals.

**B — Junk / parser-artifact titles:** Fragment phrases (`and description
optimization`, `tags and meta descriptions`, `NOT`, `Summary`, `Title:`, etc.) that
the parser extracted instead of a real job title. 17 groups, 36 rows. Deleted only
when no proposal/KB entry/rule_violation child exists; skipped otherwise.

**C — True listener duplicates:** Same normalized title captured within 4h (default
`--window`). 18 groups, 19 rows. Canonical selected by: has Proposal > enriched >
has real upwork_job_id > most data populated > lowest id. All FK children
(proposals, kb_entries, rule_violations) re-pointed to canonical before delete.

### Dry-run findings (3,356 total jobs)

```
A (bot noise)         4 groups   51 deleted
B (junk titles)      17 groups   36 deleted   0 skipped (have children)
C (listener dupes)   18 groups   19 deleted   0 child records re-pointed
TOTAL: 106 rows would be deleted
```

DocuFence case (`re-pointed=none`): Proposal#45 was already on the canonical Job#3216;
Job#3214 had no children — deletion is clean with no re-pointing needed.

All 19 category-C deletions have `re-pointed=none` — no proposals were on the
redundant side of any true duplicate.

### Root-cause note (in script docstring)

The parser generates a numeric fallback upwork_job_id when the real `~HEX` ID can't
be extracted from the URL. A future hardening pass in `listener.py`/`save_job()`
could add a secondary check: before inserting, query for a row with the same
normalized title captured within the last 12h, and skip the insert if found. This
would catch most listener duplicates at source.

### To execute

```
python dedup_jobs.py --execute
```

Dry-run is the default; `--execute` required to apply. `--window N` (hours) and
`--categories A,B,C` flags for tuning.

---

## 2026-06-24 — Generator: mandatory application-checklist detection ("To Apply / Send:")

**Problem found while testing Excel-drop.** A WordPress site-management + landing-page
retainer posting ended with an explicit gate:
```
To Apply
Send:
- 3–5 WordPress sites you manage
- Team size
- Typical landing page turnaround time
- Monthly retainer range
```
The generated letter answered NONE of these — it had been hijacked by a dropped
buffalocarts.com **Shopify** SEO audit (the richest input in context), pitching a
one-off audit for the wrong platform/vertical. On Upwork an unanswered "To Apply"
checklist is an automatic reject, so the letter would have failed regardless of
prose quality. (The Excel reading itself was verified accurate — see the prior
entry; the bug was the model over-indexing on the attachment vs the posting.)

**Fix (frontend/src/components/JobDetail.jsx).**
1. `extractApplicationChecklist(text)` — deterministic detector run before the
   generator prompt is built. Catches: full-line triggers ("To Apply", "Send:",
   "Please include:"), end-of-line triggers (prose then "…in your proposal:"),
   and inline ("to apply, send: a, b and c"). Parses bulleted / numbered / plain
   short-line lists, skips nested sub-headers ("To Apply" then "Send:"), and bails
   on prose paragraphs to avoid false positives (verified: "we include weekly
   reports…" → null).
2. Each item is classified FACTUAL vs not. Factual = team size, retainer/rate,
   turnaround, "N sites you manage", years, portfolio/links, timezone, etc.
3. Injects a ⛔ MANDATORY block into jobContext (high priority, right after the
   description) telling the model to answer EVERY item, and — critically — to NEVER
   fabricate factual answers: use Artem's KB data or leave a visible
   `[[ ARTEM: … ]]` placeholder. A fake retainer range / portfolio URL is worse
   than a blank he fills.
4. Added a PRIORITY RULE to the ATTACHED FILES prompt section: the POSTING defines
   the brief; an attachment is supporting context. If a file's topic/platform/
   vertical conflicts with the posting, the posting wins. Stops a rich attachment
   from steamrolling the actual requirements.

**Reusable lessons.**
- Explicit application gates are deterministically detectable → handle in code,
  don't trust the model to notice them under a big attachment.
- Factual screening items (pricing, team size, real URLs) must be guarded against
  fabrication with visible placeholders, not free-styled.
- Open question for later: store Artem's standing facts (team size, retainer
  bands, landing-page turnaround, managed-site list) in the KB so the generator
  can fill these automatically instead of always emitting a placeholder.

---

## 2026-06-24 (cont.) — Artem business facts: real data for checklist/proof answers

Follow-up to the application-checklist detector. Owner supplied standing facts so
the generator fills checklist/proof items with REAL data instead of
[[ ARTEM: … ]] placeholders:

- **Portfolio (share only when asked for examples/proof/portfolio):**
  Shopify → casaeleganza.com, paramusmegafurniture.com.
  WordPress → tothebeauty.com, envieq.com, redwallmural.com.
  Platform-matched: a Shopify job gets the Shopify links, a WP job the WP links.
- **Team size: 20 — ONLY when the client explicitly asks** about team/company
  size/headcount. Never volunteered otherwise (owner was emphatic).
- **Landing-page turnaround & monthly retainer: invented per-job**, positioned as
  a skilled non-US freelancer (fast, strong value vs US agencies). Anchors: single
  LP ~2–4 business days; retainer ~$800–$2,500/mo by scope. These two are the
  exception to the no-fabrication rule — give a real figure, never a placeholder.

**Implementation (frontend/src/components/JobDetail.jsx).**
- `ARTEM_PORTFOLIO` + `buildArtemFactsBlock(contextText)` (platform-aware) +
  `_PROOF_REQUEST_RE`.
- Injected into the generator jobContext when an application checklist is detected
  OR the description requests proof/portfolio/team/pricing.
- Injected into the proposal-chat screening/proof path (the STEP 1–3 proof rules)
  when the turn is a screening question or the client asks for proof — so
  paste-ready <answer> blocks cite the real portfolio URLs, platform-matched.
- Checklist FACTUAL rule updated to defer to the facts block (use real values),
  and only placeholder for facts NOT covered there (specific client names/metrics).

Mirrored as KB note #492 (`note`, is_core) for documentation; JS is the operative
copy (keep in sync). Verified: clean Vite build, no console errors.

---

## 2026-06-24 (cont.) — Client-type guard: stop false white-label framing

**Symptom.** Generator framed a DIRECT end-client job as white-label. The job:
"WordPress Website Support for Growing Performing Arts School" — a school hiring
an ongoing WP/Elementor helper ("we already have a developer… looking for an
additional person… long-term resource"). The letter positioned Artem as a
white-label / behind-the-scenes subcontractor.

**Root cause.** NOT rule injection. Verified: the agency-scope regex (line ~55)
does not match this posting (no "agency/white-label/reseller/for our clients"),
so white-label rules #406/#408 (both correctly `scope:agency`) were NOT injected.
The white-label framing was the model's own inference from "already have a
developer / additional person / resource."

**Fix (JobDetail.jsx).** Inject an explicit CLIENT TYPE line into the generator
jobContext, decided with the SAME `jobScopes(...).has('agency')` logic that gates
the white-label rules (so the guard can never contradict rule injection):
- agency scope present → "agency/white-label, background positioning appropriate"
- otherwise → "DIRECT end client. Do NOT frame as white-label/subcontractor/
  'behind another agency/developer' EVEN IF they already have a developer or want
  an 'additional resource' — that means you'd join their team directly. White-label
  only when the posting explicitly says white-label/reseller/'for our clients'."

**Reusable lesson.** "We already have a developer / need an additional resource"
is a DIRECT-client team-augmentation signal, the opposite of white-label. Default
to direct-client framing; require explicit agency/reseller language for white-label.

---

## 2026-06-24 (cont.) — White-label framing, the REAL cause: few-shot example leakage

The client-type guard (prior entry) wasn't enough — the model kept producing
white-label framing on the direct WordPress/school job. Root cause found by
inspecting the KB: the generator injects "EXAMPLES OF PROPOSALS ARTEM LIKED" and
"PAST COVER LETTERS ARTEM SENT" (similar winners) as few-shot templates labelled
"emulate most heavily." Several of those are genuine white-label/agency pitches —
e.g. **Proposal #37 (status=replied — a REPLY-WINNER)** "white-label local SEO
partner", plus sent_proposal KB entries #417/#421/#456/#467 (all agency). A
white-label REPLY-WINNER shown as the strongest template overpowers a one-line
guard, so the model copied its framing.

**Fix (JobDetail.jsx, generate()).** Hoisted `isAgencyClient` to the top and added
`_WHITELABEL_EXAMPLE_RE`. On a DIRECT-client job (agency scope NOT active), white-
label examples are filtered OUT of BOTH few-shot sources before they reach the
prompt:
- liked examples (`examplesRes`): drop entries whose content matches the marker.
- past sent proposals (`ranked`): filter before ranking, so a white-label
  REPLY-WINNER can't be picked as a template.
On agency jobs nothing is filtered (white-label examples are correct there). The
prompt CLIENT TYPE guard from the prior entry stays as a backstop.

**Reusable lesson.** Few-shot examples beat instructions. When a behaviour must be
suppressed for a job class, filter the EXAMPLES for that class — don't rely on a
prose guard to override a concrete winning template. NOTE: browser-side KB context
cache is keyed by job id; after a code change, reload before regenerating or a
stale (unfiltered) context is reused for 5 min.

---

## 2026-06-25 — "Similar jobs got a response" badge: fix cross-domain false positives

**Bug (owner-reported).** On a web-dev posting the badge claimed "3 similar jobs
got a response" and listed PPC/SEO jobs (Paid Media for Google Ads, SEO Expert
for Home Services, etc.) — none web-dev. Artem has no web-dev responses yet, so
the badge was misleading.

**How the function works (`GET /proposals/similar`, api/main.py).** Scores each
past proposal vs the target job by feature overlap. OLD weights: same Upwork
`category` +3, rate band +2, spend tier +2, country +1 (max 8). The ONLY topic
signal was `category`; the other 5 points were COMMERCIAL attributes. So a web-dev
job and a Google Ads job with the same rate/spend/country scored 3-5/8 and were
called "similar" — pure false positive.

**Fix.** Added service-DOMAIN classification as the primary signal:
- `_job_domains(*texts)` → set from {webdev, ppc, seo, smm, email, automation}
  via keyword patterns. webdev patterns are deliberately build/dev-specific
  (wordpress/shopify/landing page/react/php…), NOT generic "website", so an SEO
  "website optimization" job stays SEO.
- **TITLE-FIRST**: classify from the title (cleanest intent), fall back to body
  only if the title yields nothing. A "WordPress … + Landing Pages" job → {webdev}
  even though its body mentions SEO. This was the key precision win — body-based
  classification tagged it seo+webdev and let every SEO proposal through.
- **HARD GATE**: if target and proposal both have known domains and they don't
  intersect → skip. PPC/SEO proposals no longer match a web-dev job.
- New weights (max 10): domain overlap +4, category +3, rate/spend/country +1
  each. Also require a real topical signal (domain overlap OR category match) —
  commercial-only overlap no longer qualifies.
- Returns `target_domains`, per-result `domains`/`domain_match`, `max_score`.
  Frontend "sim X/8" → "X/{max_score}".

**Verified.** Web-dev job 3646: matched 36→5, all web-dev (Shopify dev/audit),
positive_count 0 → badge correctly disappears. PPC job 3800: 28 matches, all PPC,
including the replied + hired winners → badge fires with relevant jobs. Both
compile clean.

**Note.** This same domain classifier could later replace the loose `\bagency\b`
scope match (a separate false-positive source flagged earlier — bare "agency"
anywhere flips white-label framing on direct jobs). Not done here.

---

## 2026-06-25 — Analyser: domain-aware rate floor ($40 dev, $30 PPC/SEO)

**Owner note.** "My developer rate is $40." The analyser applied a flat **$30/hr**
floor to every job, so a web-dev posting paying $30-39 read as acceptable when
it's actually below Artem's developer rate.

**Fix (JobDetail.jsx, analyse()).** Added `_isWebDevJob` (regex over title +
category + keywords + description: wordpress/shopify/opencart/php/react/landing
page/custom module/…) → `_rateFloor = 40` for web-dev, `30` otherwise.
- Deterministic mandatory-flag bands are now floor-relative: avg < floor-10
  (-3, cap MAYBE), < floor-5 (-2), < floor (-1). For dev jobs that's <30/<35/<40;
  PPC/SEO unchanged at <20/<25/<30.
- `rateLine` states the job-specific floor explicitly and, on dev jobs, says to
  use $40 "wherever the rules below reference his minimum" — overriding the
  generic $30 in the static prompt.
- Updated the static profile + RATE-RANGE + FIXED-PRICE rules to reference the
  applicable floor ($30 PPC/SEO, $40 web-dev) instead of a hardcoded $30.
- The $15 HARD-DISQUALIFIER ceiling is unchanged (floor only shifts the soft band).

Verified: WordPress @ $35 → flag; Shopify @ $33 → -2; Google Ads @ $35 → OK;
OpenCart @ $38 → flag. Compiles clean.

---

## 2026-06-30 — Generator: no assumed vertical / fabricated brand on thin postings

**Owner insight.** A Google Ads "retail" job (4437) had a 2-sentence posting that
never named the client's product. The generated letter built its whole diagnostic
around footwear — "best running shoes", "Nike vs Adidas", "buy Nike Air Max size
10". On a client who sells anything else, that reads as "assumed the wrong
business". Same family as the fabricated-opener problem: the model invents
specifics to sound sharp when the posting is thin.

**Fix (JobDetail.jsx).**
1. Prompt rule (NO ASSUMED VERTICAL / PRODUCT): when the posting doesn't name the
   product/vertical, keep illustrative examples category-neutral or hypothetical
   ("[your product]", "a specific model/size/SKU", "whatever you sell") — never
   name a concrete product/brand the client didn't state. Demonstrate the METHOD
   generically; learn specifics via the audit.
2. Deterministic enforcer pre-check (`hasAssumedBrand`): a curated consumer-brand
   regex (Nike/Adidas/Apple/Samsung/Zara/IKEA/…) scans the DRAFT; any brand that
   appears in the letter but NOT in the posting was assumed → fires the enforcer
   with a specificViolation telling it to neutralise the example (go generic, do
   NOT swap in another brand). Case-study client names are Artem's own (in the
   APPROVED CASE STUDIES block) and aren't in the brand list, so they're safe.

Verified: the real Nike/Adidas letter on the thin posting flags both; a posting
that names Nike only flags Adidas; a neutral letter flags nothing. Compiles clean.

Also reviewed the letter itself (cover-letter critique): strong PPC draft, correct
case-study choice (Nectar Flowers + Skin Reboot, both paid-media ecommerce), clean
close. One genuine glitch noted for the owner to hand-fix this time: Skin Reboot
line printed "(attached as PDF)" twice — a dedup miss in _stripDuplicateCaseBlockLabel
worth patching later.

---

## 2026-06-30 (cont.) — Fix doubled attachment label ("(attached as PDF)" twice)

The Skin Reboot case line rendered "Skin Reboot (attached as PDF) (health/wellness
ecommerce, attached as PDF):" — the attachment phrase printed twice across two
parentheticals. `_stripDuplicateCaseBlockLabel` only handled the "Relevant case
studies:" header, not this.

Added `_stripDuplicateAttachmentLabel(text)`: (1) merges two adjacent parentheticals
that both carry an attachment phrase into one (keeps the descriptor + a single
"attached as PDF"/"in profile highlights"); (2) collapses the same phrase repeated
inside one parenthetical. Wired into all three post-processing chains (generate,
chat-rewrite, rescan) at the `_cleanPasteText` layer. Single correct parentheticals
are untouched. Verified on the real buggy line + variants; compiles clean.

---

## 2026-06-30 (cont.) — Generator must LEAD with the exact-vertical case study

**Owner complaint.** On the Real Estate Adwords job, the generator finally cited the
Atlant real-estate case — but THIRD, after FridgeFix (appliance repair) and House
Painting. On a posting that explicitly demands "RELEVANT REAL ESTATE experience",
the on-vertical case must LEAD the proof, not be buried.

**Root cause.** (1) The generator's static "Case studies by domain" PPC menu didn't
list the real-estate case, so the model treated it as a secondary KB case and led
with familiar menu cases. (2) The priority-order guidance ("exact vertical first")
was soft and unenforced.

**Fix (JobDetail.jsx).**
1. Added Atlant Real Estate to the static PPC case-study menu with metrics.
2. New "LEAD WITH THE EXACT-VERTICAL CASE" prompt rule: the same-industry case MUST
   be cited first; doubly mandatory when the posting demands that vertical's
   experience; demote/drop off-vertical cases, don't pad.
3. Deterministic enforcer guard `realEstateCaseNotLeading`: on a real-estate job,
   if a generic case (FridgeFix/House Painting) appears BEFORE any real-estate
   signal in the draft → fire the enforcer to reorder (Atlant leads). Wired into
   draftCompliant + telemetry + log + specificViolations.

Verified: the real (bad) FridgeFix-first draft flags; an Atlant-first draft passes;
non-real-estate jobs unaffected. Compiles clean.

**General lesson worth generalising later.** The "exact-vertical case leads" guard
is currently real-estate-specific (our newest vertical). The same buried-best-case
failure can happen for any vertical; a generic version would map job-vertical →
expected lead case and check ordering. Deferred.

---

## 2026-06-30 (cont.) — Generalised the exact-vertical-leads guard

Replaced the real-estate-specific `realEstateCaseNotLeading` guard with a
table-driven `exactVerticalCaseNotLeading`. `_VERTICAL_LEAD_CASES` maps each
vertical we hold a specific case for to (jobRe, caseRe, lead-blurb):
real estate → Atlant; medical/YMYL → Derma/Skin Reboot; ecommerce → Nectar/
Skin Reboot/etc. The job's vertical is the first row whose jobRe matches; if a
generic local-service filler (FridgeFix/House Painting) appears in the draft
BEFORE that vertical's case signal, the enforcer fires and reorders so the
on-vertical case leads. specificViolation + log are now vertical-aware (use the
matched row's name + lead blurb). Restricted/substance verticals stay with the
dedicated Vape Shop ordering rule (not duplicated). Extensible: add a row.

Verified across RE/medical/ecommerce (generic-leads → flag; vertical-leads →
pass), plus local-services and generic-PPC jobs correctly NOT flagged. Compiles
clean.

---

## 2026-06-30 (cont.) — Analyser: drop connect cost from scoring

Owner boosts every proposal, so the "connects required" number doesn't change his
ROI calculus. Removed it from the analyser entirely:
- Deleted the deterministic connect deductions (connects ≥12 → -1, ≥16 → -2) and
  the interviewing+connects combined-saturation "never above MAYBE" signal.
- Removed connects from analyser telemetry; removed the now-unused `_connects`.
- Replaced the prompt's CONNECTS-COST SIGNAL section with an explicit "CONNECTS
  COST — IGNORE" rule (do not score/flag it). The raw connects number stays in the
  Activity line as context, but is explicitly excluded from the verdict.
Interviewing-saturation and rate-floor signals are unchanged. Re-run the analyser
on previously-scored jobs to clear old connect-cost flags. Compiles clean.

---

## 2026-06-30 (cont.) — Analyser: factor in BOOST competition (when captured)

Counterpart to dropping connect cost. Connect cost is a flat entry price (ignored —
Artem boosts everything); BOOST competition is the real read — how hard rivals are
bidding (in connects) for the top proposal slots, scraped from the apply page
(`job.boost_bids`: [{rank, connects, age}]). The TOP bid is what Artem must outbid
to lead the field.

- Deterministic flag from `job.boost_bids`: top bid >=100 → heavy, -1; 50-99 →
  moderate, 0; <50 → light, mild positive on win-odds. Telemetry `boost:<bucket>`.
- jobSummary now includes the captured boost bids (or notes none captured → fall
  back to applicant count).
- Prompt rule "BOOST COMPETITION SIGNAL": prefer it over raw applicant count when
  present; heavy = -1 (does NOT cap verdict — he can boost in); light = winnable.

Verified bucketing on real data (top bids 13–202): WP Head-of-Dev (202)=heavy,
BI Analyst (181)=heavy, Shopify (61)=moderate, window cleaning (25)/Meta (13)=light.
Compiles clean.

---

## 2026-06-30 (cont.) — Guard: don't relabel a case study's business model (Skin Reboot ≠ SaaS)

On a "Sports SaaS" Google Ads job (4212), the generator's screening answer called
Skin Reboot "a SaaS case". Skin Reboot is health/wellness SKINCARE ECOMMERCE (DTC,
17.51 ROAS, $12k→$95k) — there is NO SaaS case in the KB. Relabeling an ecommerce
case as SaaS to fake vertical fit is a fabrication the client catches on opening it.
(The cover letter itself was fine — it bridged the SaaS tracking mechanic generically
without faking a case; the mislabel was in the chat screening answer.)

**Fixes (JobDetail.jsx).**
1. Generator prompt — "CASE-STUDY BUSINESS-MODEL INTEGRITY" rule: each case has a
   FIXED real model (Skin Reboot/Nectar = ecommerce, FridgeFix/House Painting =
   local service, Derma = clinic, Atlant = real estate; none is SaaS). On a vertical
   with no case, cite honestly + bridge the mechanic, or skip — never relabel.
2. Chat screening-answer path — same rule added to its HARD RULES (that's where the
   mislabel happened).
3. Deterministic enforcer guard `caseMislabeledAsSaas`: fires when a known non-SaaS
   case name sits within ~50 chars of a SaaS/software term (either order). Wired into
   draftCompliant + telemetry + log + specificViolations.

Verified the detector: "Skin Reboot, a SaaS brand" / "B2B software" / "my SaaS case
Skin Reboot" all flag; honest "Skin Reboot, skincare ecommerce" and generic "your
sports SaaS" tracking talk do NOT. Compiles clean.

NOTE: there is genuinely NO SaaS/software case study in the KB — if Artem has run
Google Ads for a real SaaS client, adding that case (even an English distill of a
Ukrainian one) would let the generator answer "yes, SaaS experience" truthfully.

---

## 2026-06-30 (cont.) — Analyser: stop conflating connect COST with auction competition

Owner saw an analysis (welding SEO job 4179) flagging "High connect cost (15) —
competitive auction, -1 point". That stored verdict predates today's connect-cost
removal (cached), but it exposed a real conceptual trap: the model treats the flat
"connects required" number as a competition/auction signal. It isn't — connects is
a flat ENTRY PRICE; auction heat = BOOST BIDS (+ applicant count).

Robustness fix (don't show the model data it must ignore):
- Removed "N connects" from the analyser Activity line entirely; added a note that
  connects is an ignored flat entry cost, not a competition signal.
- Strengthened the CONNECTS COST — IGNORE rule: explicit "connects required is NOT
  a competition signal — never call it a competitive/premium auction or infer
  demand from it; competition is read ONLY from applicant count + boost bids. A
  high connects number with few applicants/low boosts is an UNCONTESTED job."

Re-run the analyser (reload first) to clear the stale connect-auction flags.
Compiles clean.

---

## 2026-06-30 (cont.) — Generator: kill body↔answers duplication + require timeline when asked

From reviewing a Technical-SEO+WordPress letter (job 4097) that (a) wrote full body
sections AND a numbered answers section repeating them ~verbatim, and (b) answered
the client's "rough timeline" question with a deliverable description, no duration.

**Fix 1 — no body↔answers duplication.** Added to the application-checklist prompt
block: when you answer the items as a numbered list, do NOT also pre-answer them in
the body. Shape = short hook (problem + credentials + one differentiator) → straight
to the numbered answers. No full body section that the answers then repeat.

**Fix 2 — timeline required WHEN the client asks (resolves the Rule-17 conflict).**
- `_postingAsksTimeline`: detects explicit timeline/duration requests ("rough
  timeline", "how long", "turnaround", "ETA", "when can you complete", …).
- Gated `coverHasTimeline` (the strip-timeline guard) with `!_postingAsksTimeline`
  so a legitimately-requested timeline is NOT stripped.
- New `timelineRequestedButMissing`: posting asks for a timeline AND the draft has
  no concrete duration phrase → fire enforcer to ADD an estimate. Wired into
  draftCompliant + telemetry + log + specificViolations.
- Prompt rule in the checklist block: a "how long" answer MUST give an actual
  duration, not a deliverable description (overrides the usual omit-timeline rule).

Verified: the real posting flags as timeline-asking; the bad answer #5 (no duration)
flags missing; a "4–6 business days" answer passes; non-timeline postings unaffected.
Compiles clean.

(Open, needs Artem's ground truth, NOT fixed in code: the letter claimed CallRail/
DNI past client work — no CallRail/DNI case in KB — and gave Golden State Trailers
"+350% organic / 72 city pages" which looks conflated with Nectar Flowers' +350%
revenue and the separate 70+-cities programmatic case. Awaiting real numbers / a real
CallRail case before adding a guard or KB entry.)

---

## 2026-06-30 (cont.) — Sync runs in BACKGROUND tabs again (no focus steal)

Owner: sync should not steal focus. The proposals leg had been forced to an ACTIVE
tab because Upwork's lazy-loaded list didn't hydrate while backgrounded. Reverted to
a background tab (active:false) and made proposal.js render the list itself instead
of depending on foreground:
- `waitForListContent` rewritten: finds the real scroll container(s), sweeps
  top→bottom in synchronous `scrollTop` steps (works in a hidden tab — no rAF /
  IntersectionObserver-on-paint dependency), and repeats the sweep until the rendered
  "Initiated" row count is stable for 2 passes (all lazy rows loaded), then scrolls
  back to top for a clean scrape. Budget 30s→45s. The list is append-style (rows stay
  once rendered), so a full sweep captures everything including the zero-size
  "Viewed by client" spans.
- background.js: both sync tabs now active:false; proposals failsafe cleanup 3→4 min.
- Bumped manifest 4.2→4.3, proposal.js stamp 2.8→2.9 (reload the extension).

Verified syntax (node --check) on both files.

---

## 2026-07-01 — Generator: stop echoing the client's screening questions verbatim

Owner feedback on a local-services Google Ads letter: it pasted the client's exact
question text as headings ("1. Your experience with local service business campaigns
(with a quick example or result)") then answered underneath — the #1 tell of a
mechanical AI form-fill.

Fix (JobDetail.jsx):
- Application-checklist prompt block: the item list is now framed as FOR-YOUR-
  REFERENCE (cover every point) with a new highest-priority "ANSWER IN YOUR OWN
  VOICE — NEVER ECHO THE QUESTIONS" rule: no pasted question headings; answer in
  Artem's words woven into natural prose; if a label helps, a SHORT self-authored
  2–4-word label only ("Local results:", "First thing I'd check:"), never the
  client's sentence. Prefer prose over numbered lists.
- Softened the NO-DUPLICATION rule so it no longer assumes/encourages a numbered
  format.
- Deterministic guard `hasEchoedQuestion`: uses the extracted checklist item texts;
  if a question's wording (>=25 chars) appears near-verbatim (45-char prefix) in the
  draft → fire enforcer to rephrase. Wired into draftCompliant + telemetry + log +
  specificViolations (quotes the offending echo).

Verified: the real bad draft flags all 3 echoed questions; an own-words version
flags none. Compiles clean.

---

## 2026-07-01 — Analyser aligned with the Loom / Rule-2 ban

Owner spotted: on the German paving-contractor audit job (client asked for "a short
Loom video or a quick call"), the analyser recommended "offer an async Loom recap
(Artem records a walkthrough video)". That contradicts the generator's HARD ban on
naming Loom / committing to video deliverables — the analyser was advising the exact
thing the letter is forbidden to write.

Fix: added "WALKTHROUGH / LOOM / VIDEO-EXPLANATION REQUESTS — ADVISE COMPLIANTLY" to
the analyser prompt (after the Rule-2 scope section). It must NOT recommend offering
Loom or a recorded video; instead recommend a written plain-language findings summary
(+ optionally a single short wrap-up call if the client insists), and never name Loom
in reasoning/flags. Scoring impact still follows the existing Rule-2 rules (a
secondary "explain your findings" ask on a done-for-you audit is fine).

Compiles clean. (Analyser text is internal/not client-facing, so this is about
consistency + not steering the letter toward a banned offer, not a client leak.)

---

## 2026-07-01 — "Update bids" button (refresh boost competition only)

Owner: bid competition changes constantly; need to refresh it without re-enriching
the whole job. Added an "Update bids" button next to Enrich/Enriched.

Flow (reuses the apply-page bid scrape, no full enrichment):
- JobDetail: ⚡ Update bids button → dispatches `cockpit:update-bids` {job_id}.
- bridge.js: forwards `UPDATE_BIDS` to background; relays `BIDS_UPDATED` →
  `cockpit:bids:complete` / `:error`.
- background.js: `UPDATE_BIDS` opens ONLY the apply page in a background tab,
  tracked in `_manualBidsTabs` (tabId→job_id). apply.js scrapes the boost table and
  sends BOOST_BIDS as usual; the handler POSTs to /jobs/{id}/boost-bids and, when the
  tab was a manual one, fires `notifyCockpit('BIDS_UPDATED', {count})` (also on
  no-bids / error).
- App.jsx: `cockpit:update-bids` / `:complete` hooked into the existing enrich
  rapid-refresh so the new bids show in the "Boost competition" enriched row within
  ~1.5s of saving.

Manifest 4.3→4.4 (reload extension). All files syntax-checked; frontend compiles.

---

## 2026-07-01 — Audit job wrongly got the 3-month SEO promotion plan (owner caught it)

Owner: client asked for an SEO AUDIT but the generator offered a "3-month SEO
promotion plan". Confirmed + root-caused.

Root cause: the audit-vs-plan classifier's retainer/ongoing detector used a bare
`long.?term`. The posting said "quick wins vs. long-term strategy" (a section of the
audit REPORT), so `long-term` matched → jobIsAuditOnly=false → missingSeoPlanOffer
fired → the enforcer ADDED the promotion plan. "long-term strategy" is a deliverable
phrase, not a continuing engagement.

Fix (JobDetail.jsx):
- Retainer signal regex tightened: "long-term" only counts when followed by an
  engagement word (partnership/work/management/contract/retainer/support/…); the
  "monthly"/"ongoing" arms now require an engagement noun too. So "long-term
  strategy/recommendations/goals" no longer misread as ongoing work.
- Added inverse guard `wrongPlanOnAuditJob`: on a pure audit-only SEO job, if the
  draft offers the 3-month promotion plan, the enforcer STRIPS it (keeps the
  technical-audit sample). Wired into draftCompliant + telemetry + log +
  specificViolations.

Verified: evdokimos posting now classifies audit-only; monthly-retainer /
audit+retainer / long-term-partnership correctly still allow the plan. Compiles clean.

---

## 2026-07-01 — Strip duplicate audit-SAMPLE attachment mention

Owner: a letter referenced the audit sample twice — inline "36-page technical
report (see attached sample - lemoos.com audit)" AND the canonical closing
"I'm attaching a sample technical SEO audit so you can see the format and depth."

Fix: added deterministic post-processor `_stripDuplicateAuditSampleMention`
(JobDetail.jsx). When the canonical closing offer exists AND an inline parenthetical
also references the attached audit sample (parenthetical containing both "attach*"
and "audit"), it removes the inline parenthetical; if multiple canonical sentences
exist it keeps the last. Wired into all three post-processing chains next to
_stripDuplicateAttachmentLabel. Case-study labels ("(attached as a PDF)") never
contain "audit" so they're untouched; the priority-framework parenthetical is
untouched. (Bug caught in test: CANON regex needed the `i` flag — "technical SEO"
vs "technical seo".)

Verified on the real snippet; compiles clean.

---

## 2026-07-01 — Strip redundant trailing "Attached as a PDF." sentence

Owner: a Derma Solution case-study entry had the attach phrase twice — in the label
"(attached as PDF):" AND as a trailing standalone sentence "…155 referring domains.
Attached as a PDF." The earlier _stripDuplicateAttachmentLabel only handled adjacent
parentheticals, not a trailing sentence.

Fix: added pass (3) to _stripDuplicateAttachmentLabel — per paragraph, when the
attach phrase appears 2+ times AND one is a parenthetical label (the keeper), remove
the standalone attach clause sitting at a sentence boundary ("… . Attached as a
PDF."). Handles both "attached as (a) PDF" and "in profile highlights". Single labels
and the parenthetical stay. Verified on the real snippet; compiles clean.

---

## 2026-07-01 — Kill fabricated vertical/geographic experience in the opener

Owner: "too many hallucinations in the beginning." On the Greek .edu audit job the
opener claimed "I work with educational sites in Greece" and "multilingual education
sites" — Artem has NO education case and NO Greek client; the real multilingual case
is CONSTRUCTION/CONSULTING (Italy/Austria). The model relabeled a case + invented a
geography to fake fit.

Fix (JobDetail.jsx):
- Prompt rule "NO FABRICATED VERTICAL / GEOGRAPHIC EXPERIENCE" in the opener rules:
  never claim work in the client's vertical/country without a matching case; real
  geos = US/Canada/Ukraine/Italy-Austria; real verticals = the approved cases only;
  the multilingual case is construction/consulting, never "education". May reference
  the client's context, never claim having DONE it.
- Deterministic guard `fabricatedGeoExperience`: if the opener (first 500 chars)
  claims work "in <client's country>" (or "<country> sites/clients") and that country
  is NOT one of Artem's real case geos, fire the enforcer to rewrite the opener.
  Wired into draftCompliant + telemetry + log + specificViolations.

Verified: "educational sites in Greece" flags; client-context reference ("for your
education site…") and US-client mentions don't. Compiles clean.

---

## 2026-07-02 — Case studies dumped with no "attached in profile highlights" lead-in

Owner: generator "constantly violates the attachment rule" — dropped the case-study
recap (Nectar Flowers / FridgeFix / House Painting) with NO lead-in announcing they're
relevant results and NO "attached in profile highlights" label.

Root cause: the missingHighlightsPhrase guard's `hasNonPdfResultSignal` detected case
studies only by verbs ("grew/increased/reduced revenue") or "case study". This letter
used a terse "Name: -X% metric, +Y% metric" format with NO verbs → signal missed →
enforcer never fired → no lead-in. And the enforcer (LLM) is unreliable at ADDING it.

Fix (deterministic, JobDetail.jsx):
- `_ensureCaseStudyHighlightsLeadIn(text)`: if a known NON-PDF case name (Nectar
  Flowers, FridgeFix, House Painting, Golden State Trailers, Multilingual Site,
  Oxytec, Luxury Parfums, ChronoCash, Atlant, Vape Shop, SMASH, Game-X, GKit) starts
  a paragraph AND "profile highlights" appears nowhere, insert "Here are some relevant
  results (attached in profile highlights):" before the first case-study paragraph.
  Idempotent. Wired into all three post-processing chains.
- Also augmented `hasNonPdfResultSignal` with the case-name signal so the enforcer
  check is accurate for terse formats.

Verified on the real letter; compiles clean.

RESOLVED (complaint 2 — NOT a bug): the owner's attached "Stages of work.pdf" is the
CLIENT's 8-stage methodology, and Stage 1 = "Market and competitor audit", Stage 2 =
"Audit of the site and its components". So the audit IS in scope and the
"I'm attaching a sample of a recent Google Ads audit" line is CORRECT/relevant here.
Do NOT build an audit-sample strip guard for this case. The real complaint was the
missing TRANSITION into the case studies — solved by _ensureCaseStudyHighlightsLeadIn
above (inserts "Here are some relevant results (attached in profile highlights):"
before the first case, so the recap no longer drops in cold after Stage 7-8).

---

## 2026-07-02 — Kill the resurgent Skin Reboot "$12k → $95k" fabrication (prompt example source)

Owner shared a strong letter that nonetheless said "Skin Reboot: scaled revenue
$12k → $95k at 17.51 ROAS". The fabricated dollar figure (real: +693.8% revenue) was
thought killed when removed from the static case menu, but it was STILL hardcoded in
THREE prompt locations the fix missed:
- the PATTERN C case-study FORMATTING EXAMPLE (line ~4387) — the model copied it verbatim
- two enforcer specificViolation strings (Vape/PPC channel rules)

Fix: replaced all three with the real figure ("+693.8% revenue at 17.51 PMax ROAS").
Added a deterministic backstop in _ensureCaseStudyHighlightsLeadIn (runs in all 3
chains): any "$12k [→/to/-] $95k" (optionally preceded by "from") is replaced with
"+693.8%", so the fabrication can never reach a client even if reproduced from training.

Lesson: when killing a fabricated metric, grep the WHOLE prompt (examples + enforcer
strings), not just the case menu — the model copies verbatim from its own examples.
Verified; compiles clean.

---

## 2026-07-02 — Deterministically split crammed case-study paragraphs

Owner: "again violated the attachments rule and why are case studies not divided by
paragraphs, written in one line?" The letter ran all 3 cases into ONE paragraph
("Recent examples: Nectar Flowers … FridgeFix … Skin Reboot …") with no
"attached in profile highlights" label on the non-PDF ones. The csCrammed guard DID
fire the enforcer, but the LLM enforcer failed to reformat (unreliable at
restructuring) — so the output was still crammed.

Fix (deterministic, JobDetail.jsx): `_splitCrammedCaseStudies` + `_CASE_META`
(canonical name + PDF flag per case). When a single paragraph contains 2+ known case
names, it's split into one entry per paragraph: "Name: <description>." with blank
lines between, an inline "(attached as PDF)" label preserved for Derma/Skin Reboot,
a single "(attached in profile highlights):" lead-in for the non-PDF ones, and the
short "Recent examples:" prefix dropped (substantial prefix text is kept). Called
from _ensureCaseStudyHighlightsLeadIn so it runs in all 3 post-processing chains.

Verified on the real crammed letter → 3 clean separated, labelled entries. Lesson
(again): restructuring is the enforcer's weak spot — make it deterministic. Compiles.

---

## 2026-07-02 — Generator only knew ONE web-dev case (GKit); now knows all three

Owner: generator always pastes only GKit for development jobs. Root cause: three
sources all said GKit is the ONLY web-dev case, even though SMASH (#487) and Game-X
(#496) were added weeks ago:
- KB rule #477 (scope:webdev, injected on web-dev jobs): "The primary web development
  case study to reference is GKit."
- Generator prompt: "The only documented web dev BUILD is GKit."
- Analyser prompt: "Proven case: GKit brand fashion store."

Fix: updated all three to list GKit + SMASH + Game-X with routing —
- Game-X → LEAD for custom-module / configurator / backend / complex functionality
  (6-step PC Configurator + Compatibility Engine + Smart Cart, PHP 8.1, +34% conv).
- SMASH → LEAD for custom theme / gamification / conversion / mobile UX
  (bespoke OpenCart theme + Lucky Box module, +217% revenue).
- GKit → LEAD for fashion / bilingual / CRM-integrated builds.
Rule #477 tells it to pick the 1-2 best-fit, not dump all three, and not fabricate
metrics. Compiles clean.

Lesson: when adding a case study, grep the prompt/KB for "only"/"primary"/"the case"
claims that pin the model to an older single example.

---

## 2026-07-02 — OpenCart cases mislabeled as "Shopify work" (platform fabrication)

Owner: on a Shopify job the generator listed SMASH + Game-X under "Recent Shopify/
ecommerce work" — but those are OPENCART builds, not Shopify. Side effect of the
prior fix (taught the generator about SMASH/Game-X but didn't stress the platform).

Fix:
- Prompt: added PLATFORM INTEGRITY to the case-study business-model rule — Game-X /
  SMASH / GKit are OpenCart, never Shopify/Woo/WP. On a Shopify job, cite Artem's real
  Shopify stores (casaeleganza.com, paramusmegafurniture.com) and/or frame the OpenCart
  cases as transferable.
- KB rule #477: same platform note + Shopify-job routing.
- Deterministic guard `openCartMislabeledAsPlatform`: fires when an OpenCart case
  (SMASH/Game-X/GKit) is present AND a "Shopify/Woo/WordPress work/build/store" label
  appears. Wired into draftCompliant + telemetry + log + specificViolations (which
  tells the enforcer to relabel truthfully or swap in the real Shopify portfolio).

Verified: "Recent Shopify work: SMASH" flags; "Recent ecommerce work: SMASH (OpenCart)"
and a Shopify-portfolio-only mention pass. Compiles clean.

---

## 2026-07-02 — _splitCrammedCaseStudies mangled a compound sentence

Owner: a case line read "SMASH: (streetwear …) and." with a dangling "and", plus an
orphaned "I also built" prefix. Cause: the split post-processor fired on a legit
COMPOUND sentence ("… I also built SMASH (…) and Game-X (…) on OpenCart — transferable")
and split it at each case name, leaving a trailing conjunction and a fragment prefix.

Fix: split ONLY a period-separated case LIST — each case (after the first) must be
preceded by a sentence boundary (.!?). If cases are joined by a conjunction into one
flowing sentence, leave the paragraph untouched. Verified: the compound "SMASH (…)
and Game-X (…)" sentence is now left intact; a period-separated "Nectar … FridgeFix …
Skin Reboot" list still splits. Compiles clean.

---

## 2026-07-02 — Web-dev SEO differentiator is now scope-aware (build vs maintenance)

Owner: on a Shopify CHANGES/maintenance job the opener led with "ranks from launch /
technical SEO / hand off to a separate SEO team" — off-target. The store already
exists (no launch) and the client hired a developer, not an SEO. Three prompt rules
were force-leading the SEO-into-build USP on ALL web-dev jobs.

Fix:
- Made all three web-dev differentiator rules scope-aware (deliverable rule C,
  competitive-positioning line, fabrication-hook line): NEW BUILD → lead with the
  ranks-from-launch SEO-into-build USP; MAINTENANCE/CHANGES/FIX → lead with dev
  RELIABILITY (careful theme/Liquid work, test-in-a-duplicate before deploy, don't
  break existing functionality/tracking), SEO demoted to at most a one-line "won't
  break your rankings/tracking" reassurance.
- Deterministic guard `seoLedOnMaintenanceWebdev`: job is web-dev + maintenance
  signals + NOT new-build, AND the opener (first 350 chars) leads with SEO/ranking
  language → fire enforcer to reframe. Wired into draftCompliant + telemetry + log +
  specificViolations.

Verified: maintenance job + SEO opener flags; maintenance + dev opener and new-build +
SEO opener both pass. Compiles clean.

---

## 2026-07-02 — Sound less AI: em-dash reduction + no listy outline (researched)

Owner: fundamental "sound less AI, more human" ask. Researched best practices
([ERAS], [George Kao], [Surfer SEO], Upwork/GigRadar cover-letter guides). Finding:
the current humanizer works on the WRONG layer — it adds surface typos/dropped commas
to a letter whose STRUCTURE and PUNCTUATION are the real AI tells. Top tells confirmed:
em-dash overuse (ChatGPT's #1 fingerprint), listy/labeled outline structure, hedging,
credential-dump openers, buzzwords.

Owner scoped it (AskUserQuestion): KEEP the deliberate typos, LIGHT TOUCH — fix only
the em-dashes and the listy structure, keep the tone. Implemented exactly that:
- Deterministic em-dash reducer in _humanizeCasing (all 3 chains): the spaced-dash
  clause connector (" - ", "—", "–") before a lowercase word — keep the FIRST as an
  occasional human dash, convert the rest to commas. Numeric ranges / times
  ("$35 - 40/hr", "9am - 5pm") are safe (lookahead requires a lowercase letter).
- Prompt rules: #5 MINIMAL DASHES (at most one), #6 NO OUTLINE / LABELED-SECTION
  structure (banned "First thing I'd audit:", "Site side:", "Step N:", "Then X -"; write
  flowing prose). Removed the old rule that ENCOURAGED dashes.
- Deterministic guard hasListyOutline (2+ outline-label patterns → enforcer rewrites
  the body as prose). Verified on the real letter: listy body flags, prose passes.

DEFERRED (owner chose light touch, not now): hedging removal, buzzword strip,
proof-of-fit opener rework, length caps. Revisit if the light touch isn't enough.

---

## 2026-07-03 — Feed: "Analysed" + "Starred" filters + green-tick mark

Owner asked for: an "Analysed" filter (postings already run through the analyser), the
ability to mark a posting with a big green tick to come back to later, and a "Starred"
filter to show marked ones.

Implemented:
- db.py: new `starred_at` column on Job (NULL = not marked), indexed.
- api/main.py: migration for starred_at; serializer adds `starred` + `starred_at`;
  filter_type gains `analysed` (Job.last_analysis_at NOT NULL) and `starred`
  (Job.starred_at NOT NULL); new POST /jobs/{id}/star and /unstar (mirror hide/unhide).
- App.jsx: two new feed filter chips ("Analysed", "✓ Starred"); toggleStar callback
  (optimistic flip + drop-on-unstar-in-starred-view + refetch); passed to JobList.
- JobList.jsx: green ✓ button per card (filled green + glow when marked, outline
  otherwise); starred cards get a green left-border + faint green tint so they stand out.

Verified live: star sets starred=true; Starred filter returns the marked job; Analysed
filter returns 178; unstar clears it. Backend auto-migrated, frontend compiles.

---

## 2026-07-03 — "Update bids" button: made self-verifying (was relying on a fragile notify round-trip)

Owner: "check why Update bids button doesnt update them."

Diagnosis (traced the whole chain, no logic bug found):
- Frontend: button → dispatches `cockpit:update-bids`. bridge.js listens → sends
  `UPDATE_BIDS` to background. App.jsx rapid-poll ALSO fires on `cockpit:update-bids`,
  re-fetching the selected job every 1.5 s for 30 s.
- Extension: `UPDATE_BIDS` opens `/nx/proposals/job/~{id}/apply/` (active:false) — the
  EXACT same URL/mechanism the auto-bids alarm `_runBidsEnrich` uses, and that path works
  (auto-bids get captured). apply.js scrapes → `BOOST_BIDS` → POST /jobs/{id}/boost-bids
  (overwrites boost_bids_json + boost_bids_captured_at) → `BIDS_UPDATED` → bridge →
  `cockpit:bids:complete`.
- So the pipeline is correct. The button only CLEARED its "Updating bids…" state on the
  `BIDS_UPDATED` message. That message can be lost two ways: (a) the running extension is
  an OLDER build with no UPDATE_BIDS handler (frontend hot-reloads via Vite, but extension
  changes need a manual chrome://extensions reload), or (b) MV3 kills the worker mid-scrape
  so `_manualBidsTabs` (in-memory Map) is gone → `_isManual` false → no BIDS_UPDATED. In
  both cases the DATA may still update (POST isn't gated on _isManual) but the button hangs
  30 s → misleading "No response", so it LOOKS like nothing happened.

Fix (frontend, robust + notify-independent) — JobDetail.jsx:
- Snapshot `job.boost_bids_captured_at` on click (bidsCapturedAtRef).
- New effect: while `updatingBids`, when the App rapid-poll advances
  `job.boost_bids_captured_at`, treat that as success (clear spinner, show
  "✓ bids updated (N)"). This confirms success from the DATA actually changing, not from
  the fragile BIDS_UPDATED message. BIDS_UPDATED path kept as the fast path.
- Reset in-flight bids state on `job.id` change (JobDetail has no React key, so state
  persisted across job switches → a pending update on job A could resolve against job B).
- Timeout copy now points at the real fixes: "reload the extension, or the apply page had
  none" (job closed / already applied → no boost section → nothing to capture).

ACTION FOR OWNER: reload the extension at chrome://extensions (Falcon Scout Enricher) and
hard-refresh the dashboard tab (Ctrl+Shift+R). That's the #1 likely cause — the manual
Update-bids handlers only exist in manifest v4.4+. After reload the button self-verifies.

---

## 2026-07-07 — Analyser: explicit "agency / white-label" ask is no longer an auto-SKIP

Owner: "I don't like that analyser completely rejects white-label agency opportunity.
Yes, we apply as Artem freelancer, but when it's explicitly stated they want an agency —
we should always consider this and apply. Should already be in the rules."

Case that triggered it: job 5457 "White-label Agency for Web Design & Development" (Ireland
agency, wants a white-label partner for WP/WooCommerce/Shopify build, custom dev, UX, CRO, QA,
technical SEO). Analyser scored it **2/10 SKIP** — reasoning: "Artem is an individual
freelancer, not an agency", screening Qs (white-label client count, named account manager,
capacity) "expose a structure gap", and it mis-fired the EXPLICIT PROOF REQUIREMENT rule on
those agency-structure questions.

Root cause: the analyser prompt mentioned IT Force only as a vague "credibility signal" — it had
NO rule saying an explicit AGENCY / white-label requirement is *addressable* via IT Force (Artem's
associated agency, 97% JSS, 3,102 hrs, ~20-person web-dev team). So the model defaulted to
"solo → structure mismatch → 2/10" and bypassed the existing floor-at-5 preferred-qual rule.

Fix (analyser prompt, JobDetail.jsx — LLM-scored, so a rule is the right lever):
1. New mandatory block "AGENCY / WHITE-LABEL REQUIREMENT": an explicit agency / white-label /
   "Talent Type: Agency" / named-account-owner / capacity ask is NOT a disqualifier and NOT a
   structure mismatch — IT Force IS that agency. Judge on SCOPE + RATE like any job. When the
   work is in the core lane (WP/WooCommerce/Shopify/OpenCart build & dev, ecommerce, tech SEO,
   Google Ads) score 5-8 (MAYBE/APPLY), NOT 2 — the web-dev cases (SMASH, Game-X, GKit, Casa)
   ARE the white-label proof these clients want. Bias toward applying when core scope matches.
   Only down-score for real reasons that apply to any job (genuine rate problem, or a
   scope-breadth gap where the PRIMARY need is outside the lane — native mobile, enterprise
   API/ERP, React SPA/SaaS). Stay honest: IT Force is a real web-dev team, not a 7-service shop.
2. Carve-out on EXPLICIT PROOF REQUIREMENT: it's about proof of SKILLS/VERTICALS Artem lacks —
   NOT agency-structure / white-label / capacity / account-manager questions (answerable via
   IT Force). An explicit agency ask is not a proof gap.
3. Preferred-qualifications rule: "Talent Type: Agency" / "Agency" is now listed as NOT a
   mismatch (like the Europe-location carve-out) — don't flag it as unmet.

Net effect: explicit-agency web-dev/ecommerce/SEO jobs land at MAYBE/APPLY on scope+rate merit
instead of a categorical 2/10. Rate concerns (e.g. this job's $18.6 avg vs $40 web-dev floor)
still apply as normal soft flags — they just no longer compound with a false "can't be an agency"
rejection. Frontend compiles. Owner should re-run Analyse on job 5457 to see the new score.

---

## 2026-07-07 — Generator fabricated case studies on a web-dev job — ROOT-CAUSE fix

Owner: "generator didn't include any case studies — we need a permanent fix for current and
for the future." Case: job 5457 (white-label web-dev agency). The letter INVENTED examples to
answer the "give three examples where you delivered white-label" screening question — "deliver
white-label for 3 agencies, longest 18 months", a "bridal dress Webflow site", a "luxury
skincare Shopify store" (Skin Reboot relabeled to Shopify). The REAL cases (SMASH +217%,
Game-X +34%, GKit, Casa) were absent or mangled.

ROOT CAUSE (structural, not a one-off): the generator's "APPROVED CASE STUDIES (the ONLY ones
you may reference — do not invent)" block is built ONLY from KB `type=manual` entries whose
title matches /case stud|portfolio|results|overview|client/ (JobDetail.jsx ~4234). The single
matching entry was #1 "Artem PPC SEO Client Case Studies Results Overview" — 11 SEO/PPC cases,
ZERO web-dev. The 95 `type=case_study` entries (incl. SMASH #487, Game-X #496, GKit #474) are
NEVER read by that block. So on a web-dev job the model had no approved web-dev cases in its
"only these" list and, pressured by the screening question, fabricated.

FIX — two layers:
1. DATA (the real fix): created curated KB entry #518, `type=manual`, `is_core=1`, title
   "Artem Web Development Client Case Studies Portfolio (OpenCart / Shopify / WordPress builds)"
   — matches the portfolio regex, so it now feeds the APPROVED CASE STUDIES block on every job
   (full generate AND core rescan). Content = authoritative web-dev cases with correct platform
   labels: SMASH (OpenCart, +217% rev / 3.4x conv / custom theme + Lucky Box), Game-X (OpenCart
   3.x, +34% conv / -60% tickets / Configurator + Compatibility Engine + Smart Cart), GKit
   (OpenCart + KeepinCRM sync, bilingual, SEO-at-launch), plus live proof sites — Shopify: Casa
   Eleganza (casaeleganza.com), Paramus Mega Furniture; WordPress: tothebeauty.com, envieq.com,
   redwallmural.com. Derived from KB #474/#487/#496 + the portfolio URLs the owner gave earlier.
   (Seed markdown kept in scratchpad/webdev_portfolio.md; DB is gitignored so KB lives locally.)
2. PROMPT (guardrail): new rule "SCREENING QUESTIONS THAT DEMAND EXAMPLES / TRACK RECORD" —
   when a posting demands examples/case studies/client counts/relationship history, answer ONLY
   from approved cases + real facts. Explicitly bans inventing a count/duration of relationships
   ("deliver white-label for N agencies", "longest relationship N months"), inventing
   client/vertical/platform examples, and relabeling a case's platform (OpenCart builds are never
   "Shopify"/"Webflow"; Skin Reboot is never "Shopify"). Directs it to cite the real builds and
   describe IT Force's honest hand-off model instead.

Net: web-dev jobs now have real, correctly-labeled cases in the approved block, and the screening-
question fabrication path is closed by an explicit rule. Frontend compiles. Owner should
regenerate on job 5457 to confirm real cases now appear.

---

## 2026-07-07 — Generator wording & flow cleanup (agency numbered-question letter)

Owner on the regenerated job-5457 letter: "I don't like wording, and inconsistencies in the
text flow." (The fabrication was already fixed — it now uses the real SMASH/Game-X/GKit cases.)
The remaining tells were structural/wording:
- Template SCAFFOLDING: a "Direct Answers to Your Application Questions" meta-header, a titled
  "The Differentiator" section, and horizontal "---" divider rules — reads like a filled-in form.
- REDUNDANT DOUBLE-INTRO: under "3. Three white-label examples (client names withheld):" the
  deterministic highlights lead-in stacked a second "A few relevant results (attached in profile
  highlights):" line right below it.
- RATE UNDERSELL: spelled out "$20-25/hr effective rate" — below Artem's $40 web-dev floor,
  contradicts the Top Rated positioning.

Fixes (JobDetail.jsx):
1. `_cleanPasteText` (runs in every post-process chain): strip standalone horizontal-rule lines
   (---, ***, ___, ===); strip meta-scaffolding section headers ("Direct Answers…", "Application
   Questions", "The/My Differentiator", "Why Me"); collapse the blank-line runs that leaves.
   Verified on the real letter — dividers + both headers removed, content intact.
2. `_ensureCaseStudyHighlightsLeadIn`: when the cases are already introduced by a short header
   line ending in ":" (a screening-question header), FOLD "attached in profile highlights" into
   that header instead of inserting a redundant second intro line. (new violation tag
   foldedHighlightsIntoHeader.)
3. Prompt rule 6b (NO META-SCAFFOLDING): when a posting asks numbered questions, answer them in
   order (numbered) but no wrapper title, no titled closing section, no "---" dividers, no
   double-intros — one continuous message: opener → numbered answers → plain closing paragraph →
   "Artem".
4. Prompt RATE WORDING rule: when a posting explicitly asks for a rate, quote a project price +
   timeline or an hourly at/above floor — NEVER write out a sub-floor "effective hourly"
   ("$20-25/hr") that anchors him as a budget contractor.

Frontend compiles; fold + scaffold-strip logic unit-tested in scratch mjs. Owner should
regenerate job 5457 to confirm the cleaner flow.

---

## 2026-07-07 — New case study: Casa Eleganza (Shopify) wired into KB + analyser + generator

Owner supplied a new web-dev case: Casa Eleganza Furniture & Mattress (casaeleganza.com) — USA
premium furniture retailer, custom Shopify 2.0 build. Metrics: +41% conversion on filtered
collection pages, +28% AOV, -45% PDP bounce, 3x special-order inquiries. Built: custom editorial
theme, multi-axis filtering (material/style/room/availability), "Complete the Look" room bundler,
inline Synchrony 0%-financing widget on PDPs, Giorgio special-order lead capture, per-location
in-store availability. Stack: Shopify 2.0, Liquid, Metafields, Alpine.js, Swiper.js, Synchrony
Finance API. Significance: Artem's FIRST full Shopify case study (SMASH/Game-X/GKit are OpenCart) —
DIRECT Shopify proof for furniture/luxury/US-retail/financing jobs.

KB (local DB, gitignored):
- NEW case_study #521 "Casa Eleganza - Premium Furniture eCommerce (Shopify 2.0 ...)" (is_core).
- #518 curated web-dev portfolio: added a "Shopify custom builds (full case study)" section for
  Casa; removed it from the plain proof-URL line (promoted to full case). Now the approved-cases
  block the generator injects covers OpenCart AND Shopify.
- rule #477: "THREE OpenCart builds" -> "THREE OpenCart + ONE Shopify"; added Casa as item 4 and a
  WHEN-TO-CITE line ("Shopify furniture/luxury/US retail/financing -> LEAD with Casa; never relabel
  an OpenCart case as Shopify").

Code (JobDetail.jsx):
- Analyser: CORE EXPERTISE web-dev line now lists Casa (Shopify) alongside the OpenCart cases and
  drops the "all OpenCart" phrasing; PROVEN RESULTS gains a Shopify-furniture line with Casa metrics.
- Generator: added Casa to _CASE_META, _NON_PDF_CASE_NAME_RE, _ANY_CASE_NAME_RE (so the split /
  highlights-lead-in logic treats it like the other cases); NO-FABRICATED-DIAGNOSIS build list now
  groups by platform (OpenCart: SMASH/Game-X/GKit; Shopify: Casa) with "match the case's real
  platform, never swap"; SCREENING-QUESTIONS rule cites Casa as the Shopify example; added casa to
  the caseMislabeledAsSaas _NON_SAAS_CASE guard. The OpenCart-mislabel guard correctly does NOT
  include Casa (it IS Shopify).

Frontend compiles. Now a Shopify/furniture/US-retail job will surface Casa as direct proof instead
of forcing an OpenCart case (or fabrication).

---

## 2026-07-08 — Generator: "short note" length + SEO-differentiator-on-maintenance fixes

Owner disliked the letter for job 5635 (Shopify Developer — Liquid/HTML/CSS, ongoing theme
MAINTENANCE, "Send a short note ... plus links"). Three problems:
1. IGNORED "send a short note" — produced ~320 words with a differentiator paragraph + case block.
2. Dragged SEO into a pure maintenance job: "The differentiator: most Shopify devs build the store
   and hand off. I wire the technical SEO ... GA4 ... into the build from day one." No build here.
3. Casa Eleganza described TWICE (opener + case block); "Couple of relevant builds:" listed only one.

Root causes + fixes (JobDetail.jsx):
- LENGTH: "short note" (and "a short note / brief note / quick note / a few sentences / short
  message / short intro / keep it short") were NOT in the brevity-trigger list, so no cap applied.
  Added them; cap for these is now 150 words, and the rule spells out that "short note + links" =
  2-4 tight sentences + the links, NO differentiator paragraph, NO multi-case block, NO separate
  rate/availability section. (This also kills the Casa double-description for this job — there's no
  case block to duplicate.)
- SEO-ON-MAINTENANCE: the `seoLedOnMaintenanceWebdev` guard only checked the first 350 chars
  (`_openerSeoPitch`), so an SEO-build "differentiator" placed in the BODY slipped through. Added
  `_seoBuildDifferentiatorAnywhere` (matches "into the build from day one", "build the store and
  hand off", "ranks from day one/launch", "six months later", "wire ... SEO ... build/launch",
  "hand off to a separate SEO") scanning the WHOLE letter; guard now fires on opener OR body.
  Updated the enforcer message to say REMOVE the SEO/"wired into the build" differentiator entirely
  and differentiate on dev reliability (there is no launch to rank from). Verified both regexes fire
  on the real job text + letter (jobIsWebdevMaintenance=true, seoBuildDiffAnywhere=true).

Frontend compiles. Regenerate job 5635 to confirm a tight, dev-reliability-only short note.

---

## 2026-07-09 — Analyser: high client avg rate was inverted into "rate-floor risk"

Job 5838 "Build a Shopify Store" ($20-40/hr posted, client historical avg **$77.9/hr**, US,
5.0★/100% hire/$5.4K, <5 applicants). Analyser scored MAYBE 6/10 with "RATE-FLOOR RISK
DOMINATES — client avg $77.9/hr is nearly 2x the posted $40 ceiling ... Artem's bid at ceiling
may read as budget-tier ... high probability of rate rejection." That is backwards: a client who
pays ~$78/hr on average, well ABOVE both the posted ceiling and Artem's $40 web-dev floor, is a
STRONG POSITIVE (posted range is conservative, room to negotiate UP) — not a risk.

Root cause: the CLIENT AVG RATE SIGNAL rule + the deterministic mandatoryFlags block only handled
avg BELOW floor. The deterministic branch correctly stayed silent at $77.9 (no false flag), but
there was no POSITIVE branch, so the LLM filled the vacuum and invented a rate-floor risk by
misapplying "avg is what they actually pay".

Fix (JobDetail.jsx analyser):
1. Deterministic mandatoryFlags: added an `else if (_avgRate >= _rateFloor)` branch. When avg is
   above the posted ceiling it forces a POSITIVE signal ("above ceiling AND floor — negotiate up,
   do NOT deduct/cap, never call this rate-floor risk / budget-tier"); when merely at/above floor
   it forces a "rate is a NON-issue" note. These are injected verbatim like the negative flags.
2. Prompt rule: added an explicit above-floor / above-ceiling clause ("the below-floor logic does
   NOT invert; a client paying above the posted range is a POSITIVE — room to negotiate up; never
   describe them as budget-tier / rate rejection risk; high avg rate can only help the score").
   Retitled the rule header to "RATE-FLOOR RISK OR UPSIDE (cuts either way)".

Frontend compiles. Re-analyse job 5838 — the rate line should now read as an upside, not a cap.

---

## 2026-07-09 — Generator: self-echoed differentiator + volunteered timeline (Shopify build 5838)

Owner: "I don't like generator work here. Dubbing himself, client didn't ask for timeline (why
fabricating it?)". Job 5838 "Build a Shopify Store" (turnkey Shopify build; posting says nothing
about timing). Two problems in the letter:
1. SELF-ECHO ("dubbing himself"): the SEO/tracking-wired-into-the-build differentiator was stated
   TWICE — para 2 ("I build production-ready ... GA4/GTM wired in at launch, schema markup") and
   again para 4 ("The unique part: ... I wire the technical SEO and GA4 into the build itself, so
   the site ranks from day one"). Same claim, twice = padding.
2. VOLUNTEERED TIMELINE: closing line "Timeline for a full turnkey build: 4 - 6 weeks ..." — the
   client never asked for a timeline.

Root cause of #2: the `coverHasTimeline` guard (strips a timeline when the posting didn't ask)
already existed, but COVER_TIMELINE_RE missed this phrasing — "Timeline for a full turnkey build:"
evades the `^Timeline:` anchor (colon not adjacent), and "4 - 6 weeks" (number-first range) evades
the "weeks N" and trigger-word patterns.

Fixes (JobDetail.jsx generator):
1. New differentiator rule "STATE THE DIFFERENTIATOR ONCE (no self-echo)": make the core point in
   ONE place; do NOT establish it in the opener/body and then restate it in a "The unique part:" /
   "The differentiator:" closing paragraph. If the tracking/SEO-into-build point is already made,
   don't add a second paragraph repeating it.
2. Two new COVER_TIMELINE_RE patterns: (a) a "Timeline <label…>: N-M weeks" line where the colon
   isn't adjacent; (b) a forward-looking "build/store/site/turnkey … N-M weeks" estimate. Verified
   they catch the offending line + "build in 4-6 weeks" while NOT hitting case metrics, single
   case durations ("10 weeks"), or "12 years". So coverHasTimeline now fires → enforcer strips the
   unasked timeline. (Note: this job is a NEW BUILD, so the SEO-into-build differentiator itself is
   on-target — the issue was stating it twice, not the angle.)

Frontend compiles. Regenerate 5838 → single differentiator, no volunteered timeline.

---

## 2026-07-09 — Self-echo differentiator: prompt rule failed → deterministic strip

Re-check of job 5838: the analyser rate fix WORKED (now APPLY 8/10, explicitly "$77.9/hr is a
POSITIVE signal, NOT a rate-floor risk"), and no volunteered timeline. BUT the self-echo the owner
flagged was STILL present — the "SEO/tracking wired into the build, ranks from day one vs a
separate SEO person months later" point appeared in the opener AND again in an explicit
"The differentiator:" paragraph. The prompt rule "STATE THE DIFFERENTIATOR ONCE" (added last commit)
did not hold — the LLM ignored it. Recurring lesson confirmed: for restructuring/dedup, use CODE.

Fix (JobDetail.jsx): new deterministic `_stripDuplicateDifferentiator(text)` — splits into
paragraphs, detects the build-SEO differentiator theme (`_DIFF_THEME_RE`: "into the build",
"wire the technical seo", "ranks from day one", "seo architecture", "six months later",
"separate seo person", "retrofit", "schema/ga4/tracking ... at launch/from day one"). If the theme
appears in 2+ paragraphs AND one of them starts with an explicit differentiator label
(`_DIFF_LABEL_RE`: "The differentiator:", "The unique part:", "What sets me apart:", "the edge:",
etc.), it removes the LABELED paragraph and keeps the earlier organic mention. Guarded so it only
fires when the point is genuinely made outside the labeled paragraph too (keeps one copy). Wired
into both generate post-processor chains (enforcer path + main). Unit-tested on the real letter:
themeIdx [0,4] → removes idx 4 (the "The differentiator:" para), opener retained; compiles.

---

## 2026-07-09 — Generator: strip a volunteered rate when the client didn't ask

Owner (re job 5838, "Build a Shopify Store" — posting has NO rate/budget/quote ask): "but what
about the rate in the end? did the client ask for it?" No. The letter volunteered "Rate sits at
$40/hr for this scope ... Total project cost depends on product count ...". This violates the
existing "never quote a price upfront" rule (the hourly bid is set in the Upwork form, not the
letter) — and it anchored at $40 when the client historically pays ~$78/hr.

Prompt rules ("never quote a price upfront", "quote only when asked") were already present but the
model ignored them — same reliability problem as timeline. Fixed deterministically, mirroring the
timeline guard:
- `_postingAsksRate` (outer generate scope): does the posting explicitly ask for a rate / budget /
  quote / pricing / day rate / management fee? (inclusive, to avoid stripping a REQUESTED rate).
- `_stripUnaskedRate(text, asksRate)`: when the client did NOT ask, removes a standalone
  rate/pricing paragraph — one that opens with "Rate …", or states a "$N/hr" figure in a pricing
  context, or contains "total project cost". Wired into BOTH generate emit chains (enforcer path +
  main path); `_postingAsksRate` hoisted to the outer scope so both paths see it.
Verified: posting 5838 → asksRate false → the rate paragraph is removed, case study + sign-off
kept; a posting that says "share your hourly rate" → asksRate true → rate kept; a case line
mentioning "$1,645 fixed-price audits" is NOT stripped (no false positive). Compiles.

(This session also confirmed prior fixes live on 5838: analyser now reads the high client avg as a
POSITIVE/APPLY-8, and the duplicated "The differentiator:" paragraph is now stripped.)

---

## 2026-07-10 — API-feed jobs missing avg client rate (schema drift: avg_rate vs client_avg_hourly_rate)

Owner: API feed card doesn't show avg client spend (rate). Job 5996 "Google Ads & PPC Specialist
for Healthcare" (source=api) showed total spend $8,097 but no avg-rate badge.

Root cause — TWO ingestion paths write the client's avg hourly rate under DIFFERENT columns:
- Telegram parser (bot jobs) → `avg_rate` (string, e.g. "89.49").
- Extension enrichment (all jobs, incl. auto-enriched API jobs) → `client_avg_hourly_rate` (float).
upwork_api.py sets neither. Result: API jobs have `client_avg_hourly_rate` (897/2457) but
`avg_rate` is NULL for ALL 2457 API jobs. Both consumers read `avg_rate` only:
- Feed card (JobList.jsx ~249): `job.avg_rate && (💵 $X badge)` → hidden on API jobs.
- Analyser (JobDetail.jsx ~3056): `Number(job.avg_rate)` → the whole rate-floor-risk / new upside
  signal was INVISIBLE on every API job.

Fix (single point): `_serialize` (api/main.py ~531) now returns
`avg_rate = j.avg_rate or str(j.client_avg_hourly_rate)`. Both the card and the analyser get their
job through _serialize (/jobs and /jobs/{id}), so this one change fixes display AND analysis for
ALL existing + future API jobs, no migration. Verified: /jobs/5996 now returns avg_rate '7.56'
(was null); the card's badge renders (amber, since 7.56 < 30) and the analyser now sees the rate.
No frontend change needed — the card already had the badge, just no data.

---

## 2026-07-10 — API-feed country flags not rendering (alpha-3 vs alpha-2 codes)

Owner: some flags in the API feed don't populate (card showed a broken/globe icon next to "SWE").
Root cause: `getCountryCode` maps FULL country NAMES → ISO alpha-2 (for flagcdn.com), but Upwork's
API returns a MIX — full names AND ISO 3166-1 alpha-3 codes. Names + "USA" mapped; but "GBR" (72),
"AUS" (52), "CAN" (37), "ARE" (25), "NLD" (22), "IND" (12), "SWE", "DEU"… had no entry → null →
the card rendered the 🌐 fallback (looks broken on Windows).

Fix: added an alpha-3 → alpha-2 lookup (all ~110 countries already in the name map) as a fallback
in `getCountryCode`. The function is DUPLICATED in JobList.jsx and JobDetail.jsx — fixed both
identically. Verified: SWE→se, AUS→au, GBR→gb, ARE→ae, NLD→nl, CAN→ca, IND→in; full names still
resolve; unknown → null (🌐). Both compile. Purely frontend (Vite HMR picks it up).

---

## 2026-07-14 — Case-study attachment label: put it on the CASE, not the lead-in

Owner corrected the wording on job 6452 (German technical SEO). Generator produced:
  Recent technical SEO work (attached in profile highlights):   <- label folded into lead-in
  Golden State Trailers: ...                                     <- no label
  Derma Solution (attached as PDF): ...
Correct wording (owner):
  Recent technical SEO work:                                     <- plain
  Golden State Trailers (attached in profile highlights): ...    <- label on the case
  Derma Solution (attached as PDF): ...

Root cause: BOTH deterministic helpers labeled non-PDF cases via a COLLECTIVE lead-in and
only PDF cases inline. That breaks on a MIXED block (a profile-highlights case + a separate
PDF case) — one shared lead-in label can't describe both, and it was the wrong home for the
label. The recent `foldedHighlightsIntoHeader` behavior made it worse (folded the label into
the "Recent technical SEO work:" lead-in).

Fix (JobDetail.jsx):
- `_HIGHLIGHTS_LEADINS` are now PLAIN (no "(attached in profile highlights)").
- New `_addProfileHighlightsLabel(para)`: inserts the label right after a non-PDF case's name.
- `_splitCrammedCaseStudies`: labels the FIRST non-PDF case inline (was: only PDF cases inline,
  non-PDF via lead-in).
- `_ensureCaseStudyHighlightsLeadIn`: labels the first non-PDF case inline + keeps/inserts a
  PLAIN lead-in (removed the fold-into-header path). Idempotent (early-return when "profile
  highlights" already present).
Verified on the owner's exact block → produces the corrected wording exactly; PDF label
preserved; running twice is a no-op; compiles.

---

## 2026-07-14 — Case study without attachment notice (multi-case block + lead-in-label blind spot)

Owner (job 6449, Shopify SEO audit): a case study had no attachment notice. Block was:
  Relevant projects (attached in profile highlights):   <- collective label on lead-in
  Derma Solution (attached as PDF): ...
  Skin Reboot (attached as PDF): ...
  Multilingual Site: ...          <- NO notice
  Casa Eleganza: ...              <- NO notice

Root cause: the previous fix (f661d9e) only labeled the FIRST non-PDF case AND early-returned
whenever "profile highlights" appeared anywhere — so when the MODEL itself put the label on the
collective lead-in, the function bailed out and left every non-PDF case bare.

Fix (JobDetail.jsx, `_ensureCaseStudyHighlightsLeadIn`):
- Removed the blind `if (/profile highlights/) return` early-return.
- Step 1: strip a collective "(attached in profile highlights)" from any LEAD-IN line (colon-header
  before the cases that isn't itself a case) → lead-in becomes plain.
- Step 2: label EVERY non-PDF case inline (no-op if already labeled) — handles multiple non-PDF
  cases (Multilingual Site + Casa Eleganza), not just the first.
- Step 3: ensure a plain lead-in exists.
Verified: this block → lead-in "Relevant projects:", Derma/Skin keep "(attached as PDF)",
Multilingual + Casa get "(attached in profile highlights)"; idempotent; the earlier Golden State +
Derma correction still holds; compiles.

---

## 2026-07-14 — Generator: rate undersell (quoted floor vs high ceiling) + unfinished $ placeholders

Owner: "fix everything" (re job 6449 letter). Two issues:
1. RATE UNDERSELL: letter quoted "$35/hr" on a client with a posted $10-$60/hr ceiling that
   explicitly wants senior/expert talent — the analyser itself advised anchoring $50-55.
   Root cause: the RATE DISCLOSURE RULE HARDCODED "Artem's typical ongoing management rate is
   $30-35/hr", so the model parroted $35 regardless of the ceiling.
2. UNFINISHED PLACEHOLDERS: phase cost estimates were wrapped in "[[ ARTEM: $1,200-1,800 ... ]]"
   review brackets even though the model had computed real figures — reads as unfinished.

Fixes (JobDetail.jsx generator):
- Computed RATE ANCHOR injected into the job context: from the posted ceiling + a web-dev/SEO
  floor heuristic, it tells the model to bid in the UPPER part of the range (~$48-60 for a $60
  ceiling, floor 40) when asked for a rate, never default to $30-35, and never leave a
  placeholder for a price the client asked for. (Filtered out when no ceiling / not asked.)
- Rewrote RATE DISCLOSURE RULE + RATE WORDING to anchor to the posted ceiling (removed the
  hardcoded $30-35 default), quote a senior rate on high-ceiling/premium clients, give concrete
  per-phase estimates sized to scope, and never placeholder an asked-for price.
- New deterministic `_unwrapFilledPlaceholders`: unwraps "[[ ARTEM: …$N… ]]" placeholders that
  already contain a concrete $ figure (they're effectively filled) → plain text; genuine
  no-dollar "[[ ARTEM: fill in ]]" placeholders are left for Artem. Wired into both emit chains.
Verified: anchor $10-60→$48-60, $30-100→$80-100, $20-40→$35-40, $10-25 webdev→floor/fixed;
unwrap keeps "fill in your team size" but unwraps priced estimates; compiles.

---

## 2026-07-14 — Enforcer model Haiku→Sonnet + two hallucination guards (owner: quality issues in most letters)

Owner asked which model runs the generator and reported inconsistencies/hallucinations/fabrications/
rule violations "in almost every cover letter." Findings + actions:
- Models: first-pass writer = claude-sonnet-4-5; rule-ENFORCEMENT pass = claude-haiku-4-5 (chosen
  for ~7× cost). The enforcer (the pass meant to CATCH fabrications/violations) was on the WEAKEST
  model — the likely systemic cause. The code comment already anticipated "swap back to sonnet if
  reliability slips." Owner chose: enforcer → Sonnet 4.5. Done (line ~5906).
- STALE-FRONTEND SIGNAL: the shared letter had "(attached as PDF) (case study attached as a PDF)"
  — a double label that TODAY's `_stripDuplicateAttachmentLabel` already merges, and whose second
  form an OLDER post-processor produced. So the letter was generated against an old JS bundle →
  told owner to hard-refresh (Ctrl+Shift+R); most of today's ~10 guard fixes only apply once loaded.
- Fixed two tells the owner flagged (in `_ensureCaseStudyHighlightsLeadIn`):
  1. Duplicated same-% metric: "+693.8% revenue, +693.8% monthly" → drop the redundant copy
     (regex backref on the number; distinct metrics untouched).
  2. Case-study lead-in mislabel: "Recent audit work:" / "Recent audits:" typed the cases (Atlant,
     Skin Reboot, FridgeFix — campaign/SEO RESULTS, not audits) as audit deliverables. Neutralize
     any case lead-in matching /\baudits?\b/ to a plain lead-in.
Verified both regexes + compile.

---

## 2026-07-15 — Generator offered the 3-month SEO promotion plan on a technical-FIX job

Owner: "analyse generator work" (job 6594 "SEO Work on our website" — Shopify site snugzy, fix
rich snippets/schema + "general seo work and amends"). Analysis:
- GOOD (recent fixes holding): case block correct — plain "Relevant work:" lead-in, each case has
  its own attachment notice (Skin Reboot / Derma "(attached as PDF)", Golden State "(attached in
  profile highlights)"), real metrics, no fabrication, no dup-% . Solid technical diagnosis.
- NOT a fabrication: "Snugzy is on Shopify" is grounded in the job's Shopify SKILL TAG
  (keywords = "seo, technical seo, seo audit, shopify"), a reasonable inference — retracted that
  concern after checking the DB (no site inspection, but the skill tag is real Upwork data).
- BAD: closed by offering a "custom 3-month SEO promotion plan ... link building budget ...
  competitor overview" + sample attachment — an ongoing-CAMPAIGN document, wrong for a
  fix-our-technical-SEO job.

Root cause: `jobIsAuditOnly` (which suppresses the promotion plan) only matched the literal word
"audit". This posting says "technical seo work / rich snippets / amends", never "audit" (and the
"seo audit" keyword tag isn't in the generator's job context), so it was treated as a growth job
that REQUIRES the plan and no guard flagged it.

Fix (JobDetail.jsx generator): added `jobIsTechFixOnly` — a job that mentions technical-fix work
(technical seo, rich snippet, schema, structured data, core web vitals, indexation, canonical,
hreflang, amend, "not/aren't showing", page speed) AND has NO growth language (grow, increase
rankings, more traffic, link building, promotion, campaign, content strategy) AND no retainer
signal. Folded into `jobIsAuditOnly` so the promotion plan is suppressed on these jobs
(wrongPlanOnAuditJob fires → enforcer removes it). Also updated the enforcer message to REPLACE a
"sample SEO promotion plan" attachment with the technical SEO audit sample. Verified: this job →
techFixOnly/auditOnly true; a "technical SEO + grow traffic + ongoing" job → false (plan kept);
pure-growth → false; pure-audit → true. Compiles.

---

## 2026-07-15 — Ahrefs enrichment opened a dead URL (Ahrefs changed Site Explorer path)

Owner: the Ahrefs function opened a "wrong page" (Ahrefs "page not found / 301") for a client site.
Verified LIVE in the owner's logged-in Ahrefs: the old URL
`https://app.ahrefs.com/site-explorer/overview/v2/subdomains/live?target=X` returns not-found even
for a valid domain (tested ahrefs.com) — Ahrefs deprecated that path. Read the Site Explorer nav's
"Overview" link to get the current format and confirmed it loads:
`https://app.ahrefs.com/site-explorer/overview?mode=subdomains&target=<domain>%2F` (trailing slash).

Fixes:
- upwork-enricher/background.js (ENRICH_AHREFS): rebuilt the URL to the current format
  (`/site-explorer/overview?mode=subdomains&target=<domain>/`). Manifest bumped 4.4 → 4.5.
- Domain normalisation now also strips any path and LOWERCASES (the owner's field held
  "Snugzy.co.uk" — capital host; also the snugzy site had no URL in the posting so the .co.uk TLD
  was a manual guess). Applied in background.js AND the frontend handleAhrefsEnrich.
node --check passes. OWNER MUST RELOAD the extension (chrome://extensions) to get v4.5.
Note: separately, "snugzy.co.uk" may itself be the wrong domain (posting only said "snugzy", no
TLD) — if Ahrefs still shows nothing after reload, verify the real client domain in the editable
Ahrefs field.

---

## 2026-07-15 — Ahrefs "scrape timed out": THREE compounding bugs (URL, MV3 durability, UI language)

Owner: Ahrefs field showed "⚠ Ahrefs scrape timed out — try again". Investigated all the way down;
three separate bugs were stacked:

1. DEAD URL (fixed earlier today, 01ee221): old /site-explorer/overview/v2/subdomains/live?target=
   404s even for ahrefs.com. Current: /site-explorer/overview?mode=subdomains&target=<domain>/.

2. MV3 WORKER DEATH → the actual "timed out" cause. `_ahrefsPending` was an in-memory Map, but the
   scrape waits up to 30 s for the SPA (waitForMetrics) — meeting/exceeding MV3's ~30 s idle
   timeout. When the worker died the AHREFS_DATA handler hit `if (!pending) return` and BAILED:
   no POST, no AHREFS_COMPLETE → dashboard sat until its 60 s timeout. Fixed by mirroring pending
   entries into chrome.storage.session (`_persistAhrefsPending` / `_consumeAhrefsPending`), the
   same durability pattern already used by `_syncTabs`. AHREFS_DATA handler is now async.

3. UI LANGUAGE — the owner's Ahrefs workspace renders UKRAINIAN, but every scrape label was
   English-only ("Organic keywords", "Backlinks", "Ref. domains"). waitForMetrics could never match
   → burned the full 30 s → scraped nulls. Made waitForMetrics + scrape() bilingual (EN + UK:
   Рейтинг домену / Органічні ключові слова / Органічний трафік / Беклінки / Реферальні домени).

Also fixed while there:
- PRE-EXISTING BUG: the DR/UR regexes used `[^0-9\n]{0,6}` which EXCLUDES newline, so the
  documented "DR\n42" case never matched — DR/UR were ALWAYS null. Now `[^0-9]{0,6}`.
- parseNum is now locale-aware: comma = THOUSANDS in EN ("1,234") but DECIMAL in UK ("2,3K" =
  2300); spaces/nbsp/narrow-nbsp are always thousands separators; Cyrillic К/М → K/M.
Verified EN and UK inputs now scrape identically (DR 42, UR 30, 1234 kw, 2300 traffic, 5600 bl,
110 rd). Manifest 4.5 → 4.6. OWNER MUST RELOAD the extension.

---

## 2026-07-16 — CLI Bridge: zero-cost Claude via `claude -p` subscription (with API/CLI switch)

Owner asked to port DevScout's CLI bridge to Falcon Scout: a switch so when the Anthropic API
credit balance runs out, all `/claude` calls route through the local `claude -p` CLI (which runs on
the Claude Pro subscription — free relative to pay-per-token API).

**What was built:**
- `cli-bridge.js` — Node HTTP server on :27182. `GET /ping` health check; `POST /ai {prompt}` pipes
  the prompt to `claude -p` via stdin and returns `{content}`. CORS open to localhost.
- `api/main.py` — `/ai-provider` GET+POST (persisted to `ai_provider.json`, gitignored, default
  'api'). Inside `/claude`: when provider=='cli', flatten the Anthropic messages request
  (`_flatten_for_cli`) to a plain prompt, POST to the bridge, wrap the reply in a fake Messages
  API response shape so the frontend parses it unchanged. usage recorded as 0 tokens (free).
- `frontend/src/App.jsx` — `AiProviderChip` in the header (left of usage chip). Click toggles
  API↔CLI. Seeds from localStorage instantly (no flicker), confirms from backend in background,
  writes localStorage on toggle so choice survives reload/restart. In CLI mode pings bridge every
  5s → green/red dot.
- `falconscout.bat` — auto-starts the bridge in its own window.

**Bugs hit & fixed (in order — each needed a backend restart to surface the next):**
1. `NameError: app not defined` — the `@app.get/post("/ai-provider")` decorators were placed above
   `app = FastAPI()` (line 173). Moved them below it.
2. API 500 in CLI mode — the `ANTHROPIC_API_KEY` guard at the top of `claude_proxy` fired before the
   CLI branch. Now skipped when provider=='cli'.
3. API 500 (again) — the outer `except Exception` in `claude_proxy` swallowed the bridge's
   `HTTPException(502)` and rewrapped it 500. Added `except HTTPException: raise` passthrough.
4. Provider never persisted — the first toggle's backend POST failed silently (backend was down),
   so `ai_provider.json` was never written and backend kept defaulting to 'api'. Frontend now logs
   save failures; created the file. (localStorage seeding + write-first toggle prevents recurrence.)
5. **API 502 → the real Windows blocker.** Node's `spawn('claude')` can't resolve the `.cmd` shim on
   Windows without `shell:true` (`claude` on PATH is `C:\Users\syzov\AppData\Roaming\npm\claude.cmd`
   / `.ps1`). Added `shell: process.platform==='win32'`. Prompt goes via stdin (not argv) so no
   injection surface — the DEP0190 shell-args warning is harmless here.
6. **Root cause of the last failure: expired CLI OAuth.** `claude -p` returned
   `401 OAuth access token has expired`. Owner re-authenticated via `claude` → `/login` → browser
   authorize → paste code. NOTE for owner: Windows Terminal paste is **right-click**, not Ctrl+V.
   Now logged in as analytics.itforce@gmail.com's Claude Pro.

**Verified end-to-end:** `echo ... | claude -p` → BRIDGE_OK; `POST :27182/ai` → FULL_PATH_OK.

**Gotcha for next iteration:** the bridge sidesteps the *API credit balance* (pay-per-token), NOT
subscription usage limits. If the Pro plan's usage is exhausted, `claude -p` fails too. Also the CLI
OAuth token expires periodically — if CLI mode suddenly 401s, re-run `claude` → `/login`.

---

## 2026-07-18 — Reply-rate drop: generator reoriented to pain-resonance (research-grounded)

Owner reported a sharp reply-rate drop over the prior ~2 weeks; letters had drifted to an
explanatory "teaching/wikipedia" tone with fluff, opening with credentials.

**Diagnosis (two compounding causes):**
1. Commit 9cde775 (Jul 2, "ban listy outline structure") forced flowing prose — the model filled
   the prose the easiest way it could: by EXPLAINING how the client's own problem works ("when
   tracking logs every submission equally, the algorithm optimises blind..."). That's the lecture tone.
2. The generator system prompt had grown to ~40K chars of almost entirely PROHIBITIONS + formatting
   mechanics, with NO strong positive directive to resonate with the client's specific pain. Letters
   opened with "12 years running Google Ads, Premier Partner" (a credential opener).

**Deep research (deep-research workflow; 9 adversarially-verified claims, 3-0/2-0 votes):**
- Diagnosis-first, NOT resume-first: open by naming the client's specific problem, not credentials.
  Generic/credential openers reply <15%; opening with the client's own pain/metrics measurably lifts
  reply (+3.43pp in one benchmark), "I have experience with..." lowers it (-3.67pp).
- About them, not you: "you/your" should outnumber "I/my". Self-focused resume-style = the #1 mistake.
- Short beats long: long-form proposals reply ~8-12%, short investigated ones ~24-28%. (A rigid
  "150-250 words" ideal was REFUTED 0-3 — the rule is brevity+specificity, not a magic number.)
- Write like the first message in a chat (suggest/ask something), not a third-person essay.
- Hook = 1-3 lines referencing concrete details from THEIR brief.
Sources: gigradar.io benchmark study, pitchfuel, giguphq, workpajama, aiproposer, fawadk, getsmartbid.
(Research hit the session limit near the end so synthesis was skipped; 9 confirmed claims stand.)

**Fix (commit f9a8491):**
- Added a PRIMARY WRITING DIRECTIVE at the TOP of the generator system prompt (right after the KB
  rules block): diagnose-first opener; about-them-not-you; NO teaching/mechanics lectures; no fluff
  (every sentence references their situation / your action / real proof or gets cut); write like a
  chat, not an essay. KB rules still override on specific phrasing.
- Deterministic backstop `BANNED_OPENERS`: inspects the FIRST non-empty line; if it's a credential/
  pleasantry opener ("12 years...", "As a Premier Partner...", "I'm a PPC specialist...", "Hi, hope
  you're doing well", "I'm very interested...") it flags the draft non-compliant so the enforcer
  rewrites JUST the opener into a client-problem hook. Only the opener is checked — credentials cited
  later as support are untouched. Validated: all real failing openers fire, client-problem openers
  stay clean (no false positives).

**Next-iteration note:** watch the reply rate over the next 2-3 weeks of sends to confirm the
reorientation works. If still weak, candidate levers: trim the ~40K-char prompt (prohibition bloat
may be crowding the positive directive), and consider shortening default letter length further.

---

## 2026-07-20 — Generator/analyser hardening batch (live letter-review loop with owner)

Owner ran the generator on real jobs and flagged issues one by one; each was fixed permanently
(prompt rule + deterministic guard/strip). This is the batch that followed the 2026-07-18 pain-
resonance reorientation. All changes in `frontend/src/components/JobDetail.jsx`.

**Analyser:**
- ANOMALOUS BUDGET → verify-flag, never SKIP. A bogus `$200,000` fixed budget (a capture artifact —
  never in the posting text; the `fixed_budget`/`Rate:200000` field is mis-populated upstream) made
  the analyser call a perfect-fit job "structurally incoherent / unbiddable" → SKIP/3. Now: a fixed
  budget ≥ $50k, or any lump sum on an "ongoing" role, is reframed in the rate line as SUSPECT DATA;
  the analyser adds one "verify budget" flag and scores on scope + client + historical rate. Also a
  durable ANOMALOUS/IMPLAUSIBLE BUDGET RULE in the prompt. Re-analysed → APPLY/8. (Upstream capture
  bug that sets fixed_budget=200000 is still unfixed — worth chasing so the bad number stops showing.)

**Generator — the recurring failure modes and their permanent fixes:**
- FABRICATED DIAGNOSIS on thin postings: the diagnose-first directive, on a 3-sentence generic brief,
  made the model INVENT specifics ("You've got ~15% impression share", free-trial-vs-paid diagnosis).
  Added a GROUND-THE-OPENER/NEVER-FABRICATE clause (overrides "be specific") + extended
  FABRICATED_DIAGNOSIS regex to catch invented client metrics (impression share/ROAS/CPA/…). On thin
  postings: open with their GOAL + likely lever framed AS A PATTERN, never a diagnosed fact.
- LEAKED TOP SIGNOFF: letters opened with a bare "Artem" line (signoff leaked to top). `_stripLeadingSignoff`
  removes a signoff standing alone as the opening line(s); applied at source + enforcer output.
- LABEL-BLOCK OUTLINE: `hasListyOutline` missed "Schema/structured data - …", "GEO/AI visibility - …"
  (one repeated pattern, not 2 distinct). Added occurrence-counting `_labelBlockRe` (2+ line-initial
  "Short Label - body" blocks → flag; case-study ": " lead-ins excluded).
- ORPHAN AUDIT-SAMPLE LINE: prompt MANDATED a fixed boilerplate close ("ALWAYS close with: i'm
  attaching a sample … format and depth"), so it landed as a bolted-on non-sequitur. Rules (Google
  Ads audit + technical SEO audit) now require the (still-mandatory, named, recognizable) mention to
  be WOVEN into the diagnosis / next step, never a lone trailing line.
- MISSING DELIVERABLE ENTIRELY: on an SEO job with no literal word "audit" (tire retailer), neither
  audit sample nor plan was enforced. Broadened `isAuditJob` with `_AUDIT_SIGNAL_RE` (technical seo,
  crawl/index, faceted nav, schema, site speed, GSC, CWV, migration, ranking drop). Broadened
  `_GROWTH_RE` (own/discover/pages-that-rank/build-content/ai-answer) so ongoing-ownership jobs aren't
  misclassified audit-only.
- THEN it forced BOTH deliverables (too long). Reworked to EXACTLY ONE per letter: growth job → 3-month
  SEO plan; audit-only job → audit sample; never both, never zero. (Hoisted `hasSeoPlanMention` +
  `jobIsAuditOnly`; `planSuppressedByAuditCTA = jobIsAuditOnly || draftHasAuditSampleAttach`;
  `missingAuditSampleMention` requires `!hasSeoPlanMention && jobIsAuditOnly`.) Verified by simulation
  across 5 cases → always exactly one.
- WRONG AUDIT TIMING: "technical diagnostic in 2 working days" — a technical audit/diagnostic carries
  NO day-count ("2 working days" is the SEO PLAN only; "1 working day" is the Google Ads audit only).
  Added `_DIAGNOSTIC_TURNAROUND_RE` to strip the day-count off "…diagnostic … in N days" (leaves plan
  + Google Ads audit untouched).
- REDUNDANT "Attachments: …" summary line (case studies already self-label): `_stripAttachmentsSummaryLine`.
- "DOESN'T STATE EXPERIENCE": anti-credential-opener had demoted it to a throwaway. Directive now
  REQUIRES one concise credibility line after the hook (years + relevant track record), + a hard
  "two diagnostic paragraphs MAX" brevity cap.

**Method note for next iteration:** the generator prompt is ~40K chars and the deterministic guards
now number ~30. They interact and can fight (forcing two deliverables, contradictory audit-only vs
plan). When adding a guard, SIMULATE it against the real job context + draft (node one-liner on the
regexes) before committing — several bugs this batch were guard-interaction, not model, problems.
Also: the enforcer is best-effort (falls back to first-pass draft if it errors), so a guard only
"sticks" if it reliably fires AND the enforcer runs — prefer source-level strips for formatting fixes.

**Also this session (non-generator):** CLI Bridge (cli-bridge.js :27182) + API/CLI switch chip so
generation can run free on the Claude Pro subscription via `claude -p` when API credits are out
(Windows needs shell:true for the .cmd shim; OAuth token expires → re-`/login`). Feed perf: `/jobs`
capped at 200 + composite index `(hidden_at, captured_at)` + auto-prune keeping last 200 +
responded/hired/starred (6695→291 rows). Bids updater: waitForBids now waits for actual bid rows,
not any "Connects" text. Similar-jobs panel surfaces the outcomes it counts.

---

## 2026-07-20 (later) — Anti-fabrication rearchitecture, Phase 1: GROUNDING CONTRACT + fenced few-shot

Root-cause review of "why does the generator still fabricate despite KB cases + rules + ~30 guards":
the architecture was upside-down. Evidence: generator prompt ~40K chars, 576 prohibition markers,
38 deterministic guard flags feeding a BEST-EFFORT enforcer. The clean KB cases are injected as
FEW-SHOT to emulate ("EXAMPLES OF PROPOSALS ARTEM LIKED — study voice/structure", past winners
labeled "REPLY-WINNER — emulate most heavily"). Those real letters are dense with specific client
diagnoses + hard metrics, so imitation teaches "a good letter is confidently specific with numbers"
— and on a thin posting the model INVENTS specifics to match the pattern. Imitation beats every
"don't fabricate" rule; there was NO bound on the model's factual surface.

Fix = invert it: bound the allowed facts instead of prohibiting fabrication after the fact.
Phase 1 (this change, JobDetail.jsx, generator only):
- GROUNDING CONTRACT block near the top of the generator system prompt (after the PRIMARY WRITING
  DIRECTIVE): every specific must trace to ONE of two sources — (1) CLIENT FACTS = the posting only
  (no invented metrics/diagnoses about the client); (2) APPROVED PROOF = the "ARTEM'S APPROVED CASE
  STUDIES" + "VERTICAL REFERENCE TEMPLATES" sections only (verbatim numbers, no transferring/
  inventing/retrofitting a metric onto a case). Before emitting any number/claim, confirm it traces;
  else restate as a general pattern or drop it.
- Fenced the few-shot: the "EXAMPLES OF PROPOSALS ARTEM LIKED" and "PAST COVER LETTERS ARTEM SENT"
  headers now say STYLE/STRUCTURE ONLY, NOT A FACT SOURCE — their client details + numbers belong to
  other jobs, off-limits to reuse or imitate-as-specifics. Winner weighting is now explicitly "for
  STRUCTURE only".

Remaining phases (agreed, not yet done): Phase 2 = replace the 38-regex whack-a-mole with ONE
grounding verify pass ("does every claim trace to CLIENT FACTS / APPROVED PROOF? rewrite what
doesn't"); Phase 3 = slim the 40K-char / 576-negative prompt to positive principles + a short hard
list + job-matched rules only. Watch the next batch of generations to gauge Phase-1 impact before
Phase 2.

---

## 2026-07-21 — Agency/white-label letters: peer-level opener + fix the cold, domain-wrong ending

Owner on job 7577 (UK SEO agency owner hiring an SEO contractor to expand): generic intro; wants to
sound natural — "I know this business", white-label, boutique agency, experience to bring. Mid part
okay. "Ending is horrible."

ANALYSIS of the draft:
- OPENER: "Scaling an agency with limited time breaks down to one question: can you hand off SEO to
  someone who…?" — a consultant-cliché rhetorical formula that says nothing about who Artem is.
  ROOT CAUSE: writing directive #1 is "DIAGNOSE FIRST — DO NOT INTRODUCE YOURSELF", which is right
  for a DIRECT client with a broken account but wrong for an AGENCY owner whose constraint is
  CAPACITY, not performance. No agency exception existed, so the model produced a fake diagnosis.
- ENDING: "IT Force delivers behind agencies' brands: I work in staging, hand off for your QA…" —
  three faults: (1) staging/QA is BUILD language pasted onto an SEO/reporting role (nonsense here),
  (2) third-person "IT Force delivers" vs first-person elsewhere = boilerplate paste, (3) the
  white-label positioning was tacked on LAST as a cold operational blurb.
- ROOT CAUSE of both: the whole agency instruction was ONE thin line ("background/white-label
  positioning … is appropriate") with no guidance on opener, placement, voice, or domain matching.

CHANGES (prompt-level, as the owner asked):
1. CLIENT TYPE: agency branch rewritten from one line into a full brief: buyer is a FELLOW AGENCY
   OWNER (capacity problem, not a broken account); open showing Artem knows the business from the
   inside (boutique agency IT Force, years delivering white-label behind other agencies); name the
   agency-side realities (under their brand, zero end-client contact, client-ready deliverables they
   can present as their own, predictable capacity, easy to brief); bring the experience he carries;
   white-label positioning goes EARLY, never tacked on as the closing line; FIRST PERSON throughout
   (never third-person "IT Force delivers"); and MATCH HANDOFF LANGUAGE TO DOMAIN — SEO/PPC/reporting
   handoff = client-ready audits/decks/commentary under their brand, NEVER "staging/QA" (build-only).
2. Writing directive #1 gains an AGENCY / WHITE-LABEL EXCEPTION to "diagnose first": no invented
   diagnosis, no rhetorical question; open with peer-level agency context instead.
3. Deterministic BANNED_OPENERS gains two patterns: the "X breaks/boils/comes down to one question"
   cliché, and a first line that is purely a rhetorical question at the reader. Verified they catch
   the real opener + variants while leaving good agency/direct openers untouched.
4. The banned-opener ENFORCER message is now agency-aware — on an agency job it explicitly forbids
   swapping in another diagnosis/rhetorical question and directs it to peer-level agency context.
Compiles; opener patterns unit-tested.

---

## 2026-07-22 — PPC/Google Ads AUDIT jobs: always apply, fixed $300 / 1 working day, rate ignored

Owner (job 7726 "Google Ads Campaign Review", $10-25/hr, client avg $25, "part-time … short-term"):
we can and SHOULD apply to PPC account-audit postings, shouldn't care about a low rate, must exclude
these from the short-term penalty, and should pitch a FIXED $300 / 1 working day with audit samples.

The analyser had scored it SKIP 3/10 on: rate ceiling below the $30 floor + client avg $25;
"part-time + short-term = scope-creep risk"; and a client-quality red flag. Two of those are
structurally wrong for an audit (it is a fixed-fee, inherently short one-off), and the third was a
HALLUCINATION — it wrote "Payment NOT verified … unknown spend" while its own client line said
"payment verified" and "$3.6K total spent".

CHANGES:
- ANALYSER, deterministic: new `_isPpcAuditJob` (Google Ads/AdWords/PPC/paid search/SEM within ~80
  chars of audit/review/assessment/health check/analysis, either order, over title+category+
  keywords+description). When it fires, ALL rate-floor mandatoryFlags are suppressed and replaced
  with a forced note: fixed $300 / 1 working day / samples attached; hourly floor DOES NOT APPLY;
  short-term/part-time/one-off is the NATURE of an audit, never a negative; verdict APPLY 7-9
  unless a genuine hard disqualifier applies.
- ANALYSER, prompt: new "PPC / GOOGLE ADS ACCOUNT AUDIT JOBS — ALWAYS APPLICABLE" block (overrides
  the rate rules; don't compute an effective hourly; audits are door-openers into management).
  Updated the stale price: "$160-200 PPC audit" → "$300 fixed Google Ads / PPC account audit
  (1 working day)".
- ANALYSER, correctness: hard-disqualifier #3 now says to read the client line LITERALLY — it fires
  only when the data literally says "payment NOT verified", and the model may never contradict the
  client data it was given (no "unknown spend" when spend is provided). This fabricated flag caused
  a wrong SKIP.
- GENERATOR: the audit offer must now ALWAYS quote the fixed price — "$300 flat, delivered within
  1 working day" — even when the posting never asked for a rate. Explicitly overrides "never quote
  a price upfront" AND the RATE ANCHOR (never mirror the posted hourly ceiling on an audit job,
  never give an hourly figure for the audit).
- `_stripUnaskedRate` carve-out: never strip a paragraph mentioning an audit, so the $300 offer
  survives on postings that didn't ask for a rate.
Verified: detection fires on this job's title AND description, plus "ppc audit" / "adwords health
check" / "audit our paid search"; correctly does NOT fire on ongoing Ads management, SEO-only
audits, or web-dev (their separate pricing/timelines untouched). $300 offer survives the stripper
while a plain "$40/hr" quote is still stripped. Compiles.

---

## 2026-07-22 — Screening answers need the case-study format; geography is not personalisation

Owner (job 7726, after the PPC-audit fixes landed — analyser now correctly APPLY 8/10):
1. The answer to an additional/screening question should be formatted like the cover letter's case
   block — 1-3 relevant case studies WITH FIGURES and the attachment notice.
2. Dislikes the opener "scaling google ads for an australian business" — a nationality says nothing
   about business model or account type, so it is meaningless personalisation.

ROOT CAUSES:
1. ADDITIONAL / SCREENING QUESTIONS MODE only specified "clean, paste-ready, conversational,
   self-contained, plain text". It said NOTHING about case studies, figures, or attachment
   notices — so experience questions got answered with vague prose.
2. Nothing forbade using the client's COUNTRY as the personalising hook. On a thin posting
   ("review our Google Ads campaigns…") the model reached for `Country: Australia` from the job
   context as a specificity crutch.

CHANGES:
- Screening-answer spec: new mandatory clause — EXPERIENCE / PAST-WORK QUESTIONS USE THE COVER
  LETTER'S CASE-STUDY FORMAT. 1-3 cases written exactly as in the letter (name + inline attachment
  notice + REAL figures), one per line; match the case DOMAIN to the question (PPC cases for an Ads
  question, SEO for SEO, web-dev for builds); always concrete numbers, never "extensive experience
  with similar projects"; approved cases only, never invented; still self-contained (say what the
  work WAS, not just the result).
- Opener rules: new GEOGRAPHY IS NOT PERSONALISATION block — never open with "for your
  australian/UK/US business"; geography only when materially relevant (local service-area / map
  pack, multi-market or multi-currency, language, stated timezone overlap); otherwise anchor on
  ACCOUNT TYPE or BUSINESS MODEL (ecommerce vs lead-gen, existing account vs from scratch,
  search vs PMax) or the goal in their words.
- Deterministic BANNED_OPENERS gains a geo-filler pattern ("for a/your/their <nationality>
  business/company/brand/store/…"). Verified: catches the real opener plus "for your UK company"
  and "for a US brand", while leaving material-geo ("across three Australian service areas"),
  account-type anchors, and geo-free openers untouched.
- The banned-opener ENFORCER message now also tells it to strip nationality-as-hook and re-anchor
  on account type / business model / their goal.
Compiles; both regex sets unit-tested.

---

## 2026-07-22 — Automated proposal capture on submit (Outcomes)

Owner: "when I'm redirected to https://www.upwork.com/nx/proposals/<id> after applying, the
extension should capture it and notify me." Investigated before building — most of the plumbing
already existed, but TWO gaps made it a no-op:

1. proposal.js ALREADY matches `/nx/proposals/*` and already auto-calls `run()` on any non-list
   proposal page (line ~1455), so PROPOSAL_ENRICHED was already firing on the submitted-proposal
   page. BUT background.js routed it to `handleProposalEnriched`, which only knows how to UPDATE an
   existing KB entry via the `proposal_tab_<tabId>` room mapping that messages.js sets when IT opens
   a background tab. Landing there naturally after hitting Submit = no mapping = `return
   {skipped:true}` → the proposal was SILENTLY DROPPED. (The popup's "Go to proposal & capture"
   jump button worked only because it pre-registers the tab in `_jumpCaptureTabs`.)
2. `PROPOSAL_CAPTURED` was NEVER mapped in bridge.js — only CONVERSATION_SAVED and
   PROPOSAL_STATUS_SYNCED were. So even a successful capture never reached the dashboard: Outcomes
   didn't refresh and nothing told the owner it landed.

IMPLEMENTED:
- background.js: when `handleProposalEnriched` returns {skipped:true} AND the URL is a SUBMITTED
  proposal detail page, fall back to `saveStandaloneProposal` (fresh entry) + fire
  `PROPOSAL_CAPTURED` + stash `last_captured`. Gated by
  `/\/(?:nx|ab)\/proposals\/\d{6,}(?:[/?#]|$)/i` so it can NEVER capture the
  `/nx/proposals/job/~id/apply/` FORM (an unsent draft) or the proposals LIST — verified.
- bridge.js: map PROPOSAL_CAPTURED → new `cockpit:proposal:captured` event AND the generic
  `cockpit:outcome:saved` (so Outcomes refetches).
- Outcomes.jsx: listen for `cockpit:proposal:captured` → glow the "sent" filter chip via the
  existing newActivityFilters mechanism + show a 6 s green banner naming the job.
Manifest 4.6 → 4.7. OWNER MUST RELOAD the extension. Flow is then: submit on Upwork → Upwork
redirects to /nx/proposals/<id> → auto-captured → Outcomes refreshes, SENT chip glows, banner shows.

---

## 2026-07-22 — Kill the "wikipedia" / explainer opener (deterministic)

Owner (job 7713, Google Ads management): "let's get rid of these generic AI-ish wikipedia style
intros." The draft opened:
  "Scaling google ads when the tracking logs the wrong events is like turning up the volume on
   static - more spend, same noise. The algorithm can't optimise toward revenue if it's firing on
   page views or form impressions instead of actual purchases."

Two AI tells, and BOTH were already banned in the prompt yet produced anyway:
- Writing rule 3 (DO NOT TEACH) already bans "encyclopedic / wikipedia explanations" — violated by
  the platform-as-subject mechanism lecture (and again in paragraphs 2 and 3).
- VARY THE ANGLE already says the conversion-tracking hook "opens nearly every PPC letter and reads
  as a canned AI formula" and to use it ONLY when the posting points at it. The posting says nothing
  about tracking — yet the ENTIRE letter is conversion tracking.
Prompt-only enforcement has failed repeatedly here, so this is now enforced in CODE.

IMPLEMENTED:
- New deterministic `hasExplainerOpener`, checked on the OPENING PARAGRAPH only (later mentions are
  fine). Two detectors: (a) simile/analogy garnish — "is like", "is the equivalent of", "think of
  it as", "akin to", "imagine a/you/if"; (b) PLATFORM-AS-SUBJECT abstract mechanics — "the
  algorithm can't/won't/optimises", "the system learns", "the auction rewards". Wired into
  draftCompliant + violation telemetry.
- Enforcer message: strip the simile and the mechanism lecture, rewrite the opening to be about
  THEIR account and what Artem would DO (plain first person, no metaphors, no universal truths),
  and VARY THE ANGLE away from conversion tracking unless the posting actually points at it.
- Writing rule 3 extended to name similes/analogies and platform-as-subject sentences explicitly,
  with the test: "if a sentence would still be true and publishable for any other advertiser on
  earth, it does not belong in Artem's letter — cut it."
- BUG fix spotted in the same letter: "+693.8% (+693.8%)" — a parenthetical echo of the same
  figure. The dedupe only handled the comma form ("+X% a, +X% b"); added the parenthetical form.
Verified: flags the real opener + all explainer variants; does NOT fire on specific/action-led
openers or on "accounts like yours" (preposition, not simile). Distinct metrics in parentheses are
preserved. Compiles.

## 2026-07-24 — Scoped the anti-fabrication rearchitecture (DESIGN.md §21)

Owner asked, after another letter shipped with a fabrication + a structural bug: "why do we still
have so many bugs and fabrications despite the KB / saved winners?" Ran a root-cause analysis on the
actual generator (`JobDetail.jsx`, 6,955 lines, 312 prohibition phrases, ~40 regex post-processors,
an unreliable Haiku enforcer the code itself says "repeatedly IGNORED" rules). Diagnosis: the
architecture is **"generate freely, then police with regex"** — which structurally can't converge
(per-instance guards, self-diluting prompt, KB used as STYLE not a CHECKED fact source, cases stored
as prose so they recombine/duplicate).

Owner chose "scope it properly." Wrote **DESIGN.md §21** as the canonical plan — the inversion to
**"constrain → generate → verify"**: (A) a **structured case ledger** (cases become data w/ fixed
approved metrics + attachment type; model emits `{{case:id}}` placeholders the app expands — kills
metric-drift / vertical-relabel / duplicate-case by construction; seed from `_CASE_META` + verified
`CASES.md` figures); (B) a **deterministic grounding checker** (the unbuilt "Phase 2" / §16's
claim-grounding check — pass/fail per claim class: metrics-in-ledger, case-known/once,
**geo/market-in-posting** (client account country ≠ licence), attachment-backed, turnaround-map;
a checker, NOT another LLM); (C) **prompt slim-down** to ~10 positive rules once A+B hold.

Build order with acceptance criteria + **shadow-mode rollout** (B ships record-only first, flips to
enforce once telemetry matches hand-review; no big-bang rewrite of the 6,955-line file; regex net
stays live underneath until 21-C). Explicitly supersedes §16's deferred Phase B (stop waiting on
telemetry to add more regex — change the architecture). Success metric = fabrication/structural-bug
rate per letter (30d `⚠ Top rule violations` telemetry) trends down and stays down WITHOUT a new
bespoke regex per failure shape. NOT STARTED — this is the scope, not the build.

## 2026-07-27 — Job 8484 (Shopify SEO audit) letter: 6 fabrications; tactical audit-timeline fix + logged as 21-B fixture

Analysed a shared generator output (job 8484, "Shopify SEO Audit & Organic Growth Strategy"). It
packed SIX distinct defects, ~all in the claim-classes DESIGN.md §21 targets:
1. Fabricated Skin Reboot story numbers (2,400+ SKUs / 18% rev / 6 discontinued pages / 12–20
   referring domains / ~$47K/yr preserved) — none in KB (real: `CASES.md:138`).
2. Skin Reboot relabeled "Shopify" — a previously-fixed fabrication resurging (it's not Shopify).
3. Skin Reboot presented twice (anonymized w/ fake numbers + named w/ real numbers).
4. Casa Eleganza given two contradictory conversion figures (+41% vs +28%/6wks) + invented
   "40% of traffic on collection pages" — none verified.
5. Duplicate "attached as PDF" label in one nested Skin Reboot line (guard missed the parenthetical).
6. Technical SEO audit promised "in 2 working days" (Rule-416 violation + overcommit).

TACTICAL FIX shipped for #6: widened `_stripSeoAuditTurnaround` (JobDetail.jsx) with a new
`_AUDIT_TIMELINE_BLOCK_RE` that catches the own-line "Timeline:\n\nFull audit delivered in 2 working
days …" form the (A)/(B) patterns missed (no SEO noun adjacent to "audit"). Gated so a Google Ads /
PPC / paid audit's required 1-working-day turnaround (Rule 402) and the SEO-plan's 2-day line are
preserved. Existing before/after telemetry (JobDetail.jsx:5059-5064) fires `seoAuditTurnaround`
automatically. Verified 7 cases (standalone Node) + `vite build` clean.

Logged the full letter as the **canonical Step 21-B regression fixture** in ANTIFAB_HANDOFF.md §9 —
if a future checker build catches all six here, the rework is on track. Explicitly flagged that #6's
patch is a stopgap on the treadmill (one more regex); #1–#5 still ship until the ledger + grounding
checker (Steps 21-A/B) land. This letter is the strongest single piece of evidence for why §21 is
needed — nearly every defect is a fabricated-metric / relabeled-vertical / duplicate-case /
unbacked-claim / turnaround class the deterministic checker + case ledger kill by construction.

---

## 2026-07-27 — Anti-fabrication rework: Step 21-A (case ledger + {{case:id}} expansion) DONE

Picked up the ANTIFAB_HANDOFF.md work. Did the §0 bootstrap (git pull; read DESIGN.md §21 + §16;
CASES.md; the two handoff docs). Built ONLY Step 21-A per §8, stopped at its acceptance criteria —
did NOT start 21-B (per the handoff's shadow-first discipline).

WHAT SHIPPED:
- New `frontend/src/lib/caseLedger.js`: the structured ledger (16 cases) + `renderCaseLine(id)` +
  `expandCasePlaceholders(text)` (pure, dedups by id, drops unknown ids, idempotent).
- Wired `expandCasePlaceholders(text).text` as the INNERMOST step of both generate emit chains in
  JobDetail.jsx (before _cleanPasteText + the _strip* pile). Accepts BOTH prose and placeholders —
  no cutover; existing prose flow is byte-identical (the expander is a no-op when there are no
  `{{case:…}}` tokens).

STORAGE DECISION (§21.3 leaned "table"; the handoff allowed "decide at build"): implemented as a
FRONTEND DATA MODULE, not a DB table. Both the expander (21-A) and the planned grounding checker
(21-B) run client-side before the textarea, so a JS module is the single source of truth for both
with zero DB/API surface and zero regression risk to the load-bearing generator. DB table + CRUD is
deferred to when there's an editing UI or backend consumer. Recorded in DESIGN.md §21.10 with an
explicit "owner: confirm data-as-code or ask for the table."

SEED — every figure copied from a VERIFIED record, none invented:
- KB #1 (PPC/SEO overview) → Skin Reboot, Golden State Trailers, Vape Shop, Luxury Parfums, Derma
  Solution, Multilingual Site, FridgeFix, Nectar Flowers, House Painting, Atlant(=Real Estate
  Complex), ChronoCash.
- CASES.md → SMASH, Game-X (+ cross-checks).
- KB #518 (web-dev portfolio) → SMASH, Game-X, GKit, Casa Eleganza.
- KB #32 (Ukrainian source) → Oxytec: "6× organic traffic / +76% Mar–Nov 2020".
- No case needed metrics:[]. GKit has only weak first-month figures (2,600 impressions / 42 clicks)
  — flagged: ARTEM, do you have stronger GKit metrics?

ACCEPTANCE (Node unit test, 15/15 pass):
1. {{case:skin-reboot}} → "Skin Reboot (attached as PDF): … +693.8% revenue, 17.51 PMax ROAS, …"
   — correct label, real metrics, NO fabricated $12k→$95k.
2. Same id twice → ONE block (expander dedups by id).
Plus: prose passes unchanged; unknown id dropped + reported; idempotent; 16 unique ids; service ∈
{ppc,seo,web-dev}; attachment ∈ {pdf,profile-highlights,none}. Frontend compiles.

NOT DONE (deliberately, per plan): 21-B checker (ships shadow-first later; fixture = job-8484's six
defects), and removing _CASE_META / the old prose menus (that's 21-C, only after the checker proves
coverage). Dual-service cases (skin-reboot/derma are seo+ppc) store one primary service for now.

QUESTIONS FOR ARTEM:
1. Storage: happy with the ledger as a data-as-code module, or want the DB `cases` table now?
2. GKit metrics are weak (first-month impressions only) — supply stronger figures if you have them.

---

## 2026-07-27 — Anti-fabrication rework: Step 21-B (grounding checker) DONE in SHADOW

Built the deterministic grounding checker and wired it in shadow / record-only mode.
Did NOT flip to enforce and did NOT start 21-C (both gated on the shadow soak + owner
check-in, per the owner's rule and §21.6).

WHAT SHIPPED:
- New `frontend/src/lib/groundingCheck.js` — pure, deterministic, no LLM. Five §21.4 claim
  classes: metricNotInLedger, caseDuplicated, attachmentUnbacked, marketNotInPosting,
  seoAuditTurnaround. `groundingCheck(text, {postingText, enforce}) -> {text, violations}`.
- Wired into BOTH generate emit points in JobDetail.jsx via `_gcShadow()` behind a single
  `GC_ENFORCE` constant (default false = shadow: records violation codes to the
  `⚠ Top rule violations` telemetry, returns the letter UNCHANGED). Flipping to enforce is a
  one-line change AFTER the soak + check-in.

DESIGN CHOICES (false-positive discipline):
- Metric + attachment checks scoped to PARAGRAPHS THAT NAME A LEDGER CASE — pattern
  statements ("most accounts leak 30-40% of budget") are never touched.
- metricNotInLedger is NUMBER-BASED against the cited case's ledger figures.
- marketNotInPosting reads ONLY the posting body (gazetteer of countries/demonyms/codes);
  client account country is never a licence (explicit §21.4 rule).
- seoAuditTurnaround gated so the PPC/Google Ads audit's required 1-working-day turnaround
  is preserved; removal still handled by the existing _stripSeoAuditTurnaround in the pile.

WHICH DEFECTS: the checker owns the NAMED-case classes (job-8484 #4/#5/#6, 2026-07-24
Israel/Danish + duplicate block). The anonymized/relabeled forms (#1 unnamed story, #2
relabel, #3 anon half) are killed by the LEDGER at 21-C (once the prompt emits {{case:id}}).
"Catch all six" is a property of the combined ledger + checker system.

VERIFIED (bundled Node test, 12/12): 8484 fixture fires metricNotInLedger + caseDuplicated
+ attachmentUnbacked + seoAuditTurnaround; skin-reboot ledger line has no Shopify/fab
numbers and dedups to one block; 2026-07-24 fires marketNotInPosting (and NOT when the
posting authorises it); CLEAN letter → ZERO flags (incl. the 30-40% pattern line + PPC
1-working-day audit); shadow returns text unchanged; enforce strips fab number / collapses
dup label. Frontend compiles.

NEXT (owner-gated):
1. Let shadow run ~1 week; watch the `⚠ Top rule violations` panel for the five new codes
   and confirm counts match hand-review (esp. that marketNotInPosting / metricNotInLedger
   have no false positives on real letters).
2. THEN flip `GC_ENFORCE = true` (one line) — CHECK IN FIRST.
3. Only after enforce runs cleanly, start 21-C (slim the 312-prohibition prompt; teach it to
   emit {{case:id}}; demote regex to a safety net).

## 2026-07-27 — Kill the wall-of-text: deterministic paragraph-splitter + Rule 6 size cap

Recent letters (incl. a clean, fabrication-free one) kept producing one ~200-230-word run-on
"audit walkthrough" paragraph — exhausting to read, clients skim past it. The prompt ALREADY said
"FLOWING PROSE — 2-3 real paragraphs" (Rule 6) and "two short diagnostic paragraphs" (line ~487),
yet the model still emitted one block — textbook §21 "the prompt rule is present but not obeyed."
So the fix is deterministic, with the prompt sharpened as a secondary nudge.

1. **`_splitLongBodyParagraphs()`** (JobDetail.jsx, near `_gcShadow`): breaks any BODY paragraph
   over ~70 words into sentence-boundary beats of ≤~70 words. ONLY inserts paragraph breaks — never
   changes/adds/drops words (verified 246 in = 246 out). Skips case-study lines (`_ANY_CASE_NAME_RE`),
   attachment lines, short label lines ("Relevant experience:"), and existing bullets. Wired as the
   outermost formatting step inside both `setProposal` chains: `_gcShadow(_splitLongBodyParagraphs(…))`
   — initial generate AND chat-rewrite paths.
2. **Rule 6 prompt cap** (JobDetail.jsx ~line 4895): added a HARD PARAGRAPH CAP to the existing
   flowing-prose rule — no paragraph >~4 sentences / ~70 words; a multi-step diagnosis is SEVERAL
   short paragraphs; "one 200-word wall is an automatic readability failure." Sharpens the existing
   rule rather than adding a competing one.

Verified: the real 230w job-8551 paragraph → 4 balanced beats (56/48/62/34w); case/label/short paras
untouched; zero words lost; `vite build` clean. NOTE: the splitter makes letters SCANNABLE
immediately; true brevity (word count) still leans on the prompt cap (the unreliable lever) until
21-C tightens it. Splitter stays as the safety net; fold the cap into the 21-C slim prompt later.

## 2026-07-27 — Kill the "restate the posting" opener (parroting the client's own ask)

Owner flagged a letter that opened "The job posting asks for Google Ads setup + weekly management
with CallRail and GoHighLevel tracking." — the #1 AI-form-fill tell: restating the posting the
client wrote, burning the hook line. (Rest of that letter was strong + fully grounded — right
local-service cases FridgeFix/House Painting/Atlant with ledger-exact metrics, correct $300/1-day
PPC audit turnaround.)

Fix (deterministic-first + prompt nudge, same pattern as _stripFabricatedOpener):
- `_stripPostingRestateOpener()` (JobDetail.jsx, sibling of `_stripFabricatedOpener`): if the FIRST
  sentence is a posting-restatement ("The job posting asks for…", "You're looking for…", "This role
  is about…", "Based on your posting…", "Looking at your job post…", "From your description…",
  "I see you need…") AND real content follows, drop that sentence so the letter opens on the actual
  hook. Non-empty guard: can only ever REMOVE the parrot, never empty the letter. Deliberately does
  NOT touch bare "You need…/You want…" (legit diagnostic hooks). Wired by calling it at the top of
  `_stripFabricatedOpener` (before that fn's early return), so every emit path (initial generate +
  chat-rewrite) gets it with no paren surgery.
- Prompt: added the restatement phrasings to the BANNED opening lines list (~line 4703).

Verified (standalone Node, 9/9): the real letter → opens on "First thing I'd do…"; 4 restate
variants stripped; 4 legit hooks ("Most accounts…", "Your Merchant…", "You're bleeding…", "First
thing I'd do:") untouched. `vite build` clean.

## 2026-07-28 — Live walkthrough / screen-share / review-call = HARD SKIP (owner policy tightened)

Owner feedback on job 8626 (Singapore coding-school Google Ads audit): the posting's item (d)
"Review calls, screen shared, walking through what changed and why" was scored APPLY 8/10 — the
analyser treated a one-time post-audit walkthrough call as compliant. Owner: he will NOT do ANY
live walkthrough, even a short one-time call just to explain. Chosen severity: **Hard SKIP**;
generator: **stop offering / redirect to written**.

Changes (JobDetail.jsx):
1. **Analyser** — replaced the old "advise compliantly / a single short wrap-up call is fine"
   carve-out with **LIVE WALKTHROUGH / SCREEN-SHARE / REVIEW-CALL = HARD SKIP**: any posting that
   requires/expects a live call, screen-share, video meeting, or "review call / walk me through on
   a call / screen shared" → score 2-4, verdict SKIP, flag quoting the exact phrase — even when the
   live bit is secondary to an otherwise-perfect audit job. Kept the critical false-positive guard:
   a WRITTEN findings doc / change log / Looker before-after report is NOT a live session and is
   fine; only SYNCHRONOUS live/screen-share/video/call interaction disqualifies. Also added the
   review-call / screen-share-walkthrough phrasings to the "quote the exact phrase" example set so
   the detector recognises them (it previously only knew Zoom/Loom/live-training/video-tutorial).
2. **Generator** — replaced "confirm AVAILABILITY to join and explain findings" with: NEVER offer
   or accept any live call/screen-share/walkthrough; if the posting asks, REDIRECT to the written
   deliverable (findings-and-recommendations doc + before/after Looker report), framed as a strength
   (a written record they can re-read/share), not an apology. Never refuse rudely.
3. **Deterministic backstop** — added a FORBIDDEN_PHRASES pattern catching call/session ACCEPTANCE
   ("can join a screen share", "available for a review call", "open to a video call", "join a
   walkthrough"), gated to screen-share/review-call/video-call/walkthrough/zoom — deliberately NOT
   bare "call" to avoid colliding with the heavy PPC vocab (CallRail, call tracking, call
   conversions, "phone call is the conversion event"). Fires the enforcer rewrite on match.

Verified (standalone Node): backstop fires on 6 accept-call phrasings, does NOT fire on 8 PPC
call-vocab lines; `vite build` clean. NET: job-8626-shaped jobs (mandatory live walkthrough) now
SKIP; a written-explanation ask stays biddable.

## 2026-07-28 — Surface the real Claude API error (esp. "out of credits") instead of bare "API 400"

Owner hit "Error: API 400" on Analyse. Root cause: Anthropic returns "Your credit balance is too
low to access the Anthropic API" as an HTTP 400 (verified by calling the API directly with the .env
key — 400 on every model id). NOT an app bug — the account is out of API credits (exactly what the
CLI bridge exists for; app was already set to provider=cli and a CLI call returns 200).

The reason it showed as a cryptic "API 400": the analyser + generator error handlers read
`data.error?.message` (which the FastAPI proxy never sends — it sends the reason in `data.detail`)
and fell back to `API ${status}`. Other buttons already used `_friendlyApiError(data.detail,...)`.

Fix (JobDetail.jsx):
- `_friendlyApiError()`: added a special case — if the inner message matches "credit balance is too
  low", return a clear, actionable string: "Anthropic API credits exhausted. Switch to CLI mode
  (the API/CLI toggle, top-right) … or top up at console.anthropic.com → Plans & Billing." Bumped
  the generic-message truncation 120→160 chars.
- Routed all three generic error sites (analyser line ~3641, generator ~5160, and the secondary
  ~4221 call) through `_friendlyApiError(data.detail, status)` instead of
  `data.error?.message || \`API ${status}\``.

Verified (standalone Node) against the EXACT proxy detail shape ("Claude API error: {json}"):
credit-balance → CLI hint; rate_limit → friendly; null detail → safe fallback. vite build clean.
NET: a credit-exhausted 400 now tells the user precisely what happened and how to keep working.

---

## 2026-07-27 — CLI-bridge speed: force the intended model (was defaulting to Opus)

Owner (out of API credits, on the CLI fallback): app generations "super slow." Root cause:
`cli-bridge.js` spawned `claude -p --strict-mcp-config --disable-slash-commands` with NO
`--model`, so every call used the CLI's DEFAULT model — Opus 4.8 (the slowest) — even though
the API path deliberately uses Sonnet for generate/analyse and Haiku for the cheap passes.
Each call also cold-spawns a fresh CLI process and can't use prompt caching (API-only), but
Opus-vs-Sonnet was the dominant cost.

Fix: the /claude proxy now sends the requested `model` to the bridge (api/main.py ~4856);
the bridge maps it to a `--model` alias (haiku|opus|sonnet, default sonnet, NEVER the Opus
default) and adds `--model <alias>` to the spawn. Net: generate/analyse → sonnet, enforcer/
shrink → haiku — both far faster than Opus. node --check + ast.parse clean.

REQUIRES bridge restart: the running `node cli-bridge.js` must be restarted to pick this up.
Reminder: this whole path is the credit-exhaustion fallback — switching the provider back to
"api" (ai_provider.json) when credits return restores prompt caching + full speed.

---

## 2026-07-28 — CLI toggle bypassed: /chat, /chat/distill, /kb/shrink never checked provider

Owner, on CLI mode (credits exhausted), still hit "Anthropic API credits exhausted" on a Cover
Letter chat/rework message ("you were suppose to add case studies for open cart"). Confusing
because the toggle WAS on CLI — but the toggle only gated the main `/claude` proxy (analyse/
generate). Three other endpoints called `https://api.anthropic.com/v1/messages` directly with
no `_get_ai_provider()` check at all: `/chat` (the Cover Letter chat panel, JobDetail.jsx ~2625/
~2725), `/chat/distill` (conversation → KB candidates), and `/kb/shrink` (KB entry compression).
Each just checked `ANTHROPIC_API_KEY` and called the API unconditionally — CLI mode was a no-op
for all three.

Fix (api/main.py): added a shared `_call_via_cli_bridge(request, model, kind)` helper (mirrors
the /claude proxy's existing CLI branch — flattens {system, messages} via `_flatten_for_cli`,
posts to the local bridge on :27182, returns an Anthropic-shaped response dict). Wired it into
all three endpoints: guard changed from `if not api_key:` to `if not api_key and
_get_ai_provider() != "cli":`, and each now branches to the bridge before the direct-API call
when provider is "cli". `/kb/parse-file` (native PDF document API) intentionally NOT touched —
CLI bridge is plain-text stdin only, can't carry a PDF attachment; still API-only, left as a
known gap.

py_compile clean. Backend runs with --reload so this hot-reloads; if the chat panel still
errors, restart uvicorn.

## 2026-07-29 — Desktop notifications for new enriched jobs + Settings promoted to a top tab

Owner asked for a silent pop-up when a new job arrives (after auto-enrichment) with title + essential
info; chose Desktop/OS notification delivery, BOTH noise-control modes selectable in Settings, and
asked to make Settings a real top-level tab (not just the gear-button modal).

- **`src/lib/notifications.js`** (new): localStorage settings ({enabled, mode:'all'|'worthy', minRate:30},
  default OFF), permission helpers, `passesNotifyFilter` (worthy = payment-verified AND rate ≥ minRate
  OR fixed/unspecified — never blocks fixed-price), `notifyBody` (compact "rate · country · N reviews,
  X★, $spend, verified · N applicants · AI verdict-if-present"), and `notifyNewJobs` (silent, 1–3 →
  individual pop-ups, 4+ → one summary; click focuses window + opens the job).
- **`App.jsx`**: notify effect keyed on `jobs` — seeds the backlog at app-open (never notifies it),
  then fires once per job when it first appears ENRICHED and passes the filter, when enabled +
  permission granted. Click → setView('jobs') + select the job. (Deps are `[jobs]` only — fetchSelectedJob
  is defined later in the component; putting it in the deps array crashed render via TDZ. Fixed.)
- **Settings tab**: added `{key:'settings'}` to the top nav + a render block; new **`SettingsTab.jsx`**
  hosts the Notifications controls (enable + permission flow + mode radios + minRate + test button) and
  the embedded feed filters. **`FeedSettings.jsx`** refactored with an `embedded` prop (renders inline,
  no overlay/×, save doesn't auto-close). The ⚙ gear now opens the Settings tab instead of the modal
  (the old modal render stays but is inert at open=false).

Verified live in the browser: app mounts clean (no console errors after the TDZ fix), Settings tab
renders both sections, permission status reflects correctly, feed filters load. `vite build` clean.
Notification FIRING couldn't be exercised here (the automation browser blocks notifications), but the
settings/permission UI works and the fire logic is unit-clear. Default OFF — owner enables it in
Settings and grants the one-time browser permission.

## 2026-07-29 — Fix: notifications popped for backlog-enriched jobs, not new ones

Owner: feed set to "All", getting popups for jobs that are NOT at the top of the feed. Cause: the
feed sorts by captured_at DESC, but the notify trigger fired on "first seen ENRICHED" — and the
background auto-enricher works through a BACKLOG of older jobs, so those popped even though they sit
far down the feed. Compounded by a seed bug: seenAtStartRef seeded on the initial EMPTY jobs state
(useState([])), so the real backlog was never excluded → every enriched job looked "new".

Fix (App.jsx notify effect):
1. Seed seenAtStartRef on the FIRST NON-EMPTY feed load (skip the initial []), so the actual backlog
   is captured and never notifies even as the enricher enriches it later.
2. TOP-OF-FEED gate: only notify jobs within the top NOTIFY_TOP_N=25 of the captured_at-sorted feed.
   A genuine new capture is near index 0; a backlog job being enriched is far down. Timezone-proof
   (uses feed order, not a captured_at clock compare — captured_at tz-naivety on old rows made a
   direct time comparison risky).

Verified: vite build clean; app mounts clean (accessibility tree shows full nav incl. Settings; 1830
buttons rendered — the earlier innerText "not mounted" readings were a headless-pane compositing
artifact, not a crash). NET: popups now fire only for genuinely new top-of-feed jobs once enriched.

---

## 2026-08-01 — Antifab shadow-mode check-in: telemetry reviewed, soak continues

Owner: "our new fixes... running for some time and frankly I don't see any improvements really."
Pulled `rule_violations` directly (185 events since 2026-07-27, the day 21-A/21-B shipped).
Finding: **not a bug — GC_ENFORCE is still `false` (shadow), so the checker only logs, never
edits the letter.** No visible change is expected until it's flipped.

Evidence the checker itself is working: its 5 violation codes fired 12 times across 8 distinct
jobs in 5 days — `caseDuplicated` 6× (8626, 8665, 8651, 9165×2, 9419), `metricNotInLedger` 4×
(8640, 8855, 9225, 9419), `attachmentUnbacked` 1× (9165), `marketNotInPosting` 1× (9068),
`seoAuditTurnaround` 0× (the earlier tactical patch appears to be holding). Zero false-positive
reports from the owner in that window.

Separately noted: the OLDER, already-enforcing deterministic guards are still firing at high
volume in the same window (`caseHighlightsInlineLabel` 24×, `coverHasTimeline` 17×,
`missingHighlightsPhrase`/`missingPdfLabel` 15× each, `hasCircumventionRisk`/`hasExplainerOpener`
11× each, `fabricatedSkinRebootRevenue` 6×) — these already strip/fix before the letter reaches
the owner, so they don't explain "no improvement," but the raw generation habit clearly hasn't
gotten any cleaner; only the after-the-fact patch layer keeps growing to cover it.

Asked the owner directly: flip GC_ENFORCE now / hand-review the 8 flagged jobs first / keep
shadow running longer. **Decision: keep shadow mode running longer** — not enough volume/time
yet for the owner's confidence. No code change made. Revisit `/rule-violations/stats` (KB tab,
"Top rule violations" panel) again in another week or two before re-raising the flip question.

---

## 2026-08-01 — Analyser bug found via share-with-claude: audit-job override was prompt-only

Owner shared job 9522 ("Google Ads Account Audit Specialist", $150 fixed / AU client / $15/hr
avg) via the "share with claude" button. Analyser returned SKIP, score 3/10, reasoning built
entirely around client rate-floor risk — despite the analyser's OWN mandatory-flag injection
telling the model, verbatim, that PPC/Google Ads audit jobs are Artem's fixed-$300 flagship
product and "THE HOURLY RATE FLOOR DOES NOT APPLY... VERDICT: APPLY, score 7-9" (owner policy,
2026-07-22). The model ignored its own injected override and skipped anyway.

This is a different failure class from the antifab-checker discussion earlier today: the
grounding checker only watches the GENERATOR's letter for fabrication; nothing checks whether
the ANALYSER's verdict is consistent with its own mandatory flags. So this bug would recur
silently on every PPC-audit job and never show up in `rule_violations` telemetry — "just keep
collecting data" does not cover it. Given audit jobs are meant to be near-automatic applies, a
silent wrong-SKIP has real cost (the job is never even applied to).

Fix (JobDetail.jsx, analyser response handling, ~3664): added a deterministic post-parse
override — same "prompt rules don't hold, enforce in code" lesson as every prior antifab fix.
When `_isPpcAuditJob` is true and the model's verdict/score contradicts the mandatory-apply
policy, the code strips rate-floor-flavored reasons/flags (regex-matched), force-sets
verdict=APPLY and score=max(score,7), and appends an "auto-corrected" flag. The override is
independently gated on the THREE real hard disqualifiers (US-only geo, unverified+<5 reviews,
already-hired ≥1) computed straight from job data — never from the model's own claims — so a
genuine disqualifier still blocks the override. Also records `auditJobVerdictOverridden` to
`rule_violations` (analyser surface) so future frequency is now actually visible in telemetry.

Verified two ways: `npm run build` clean; a standalone Node harness fed the exact job-9522
model output through the override logic — confirms SKIP/3 → APPLY/7, rate-floor lines stripped,
other reasoning preserved, override flag appended; a second harness with a real US-only-geo
disqualifier confirms the override correctly does NOT fire and the genuine SKIP survives. Could
not drive a live click-through in the Browser pane this session (compositing wasn't available),
so this was verified at the logic level rather than an on-screen re-analyse.

---

## 2026-08-01 — AI Analysis cache showed stale verdicts after re-enrichment

Owner: enriched a job with the extension, then clicking to AI-analyse it "all data immediately
populated... looks like it was no enrichment but rather some cache pop up." Correct diagnosis.

Root cause: the AI Analysis cache (`cacheRef` + localStorage, JobDetail.jsx ~3192-3220) is keyed
only by `job.id`, with no timestamp. `job.enriched_at` is bumped server-side on every enrichment
call, including re-enrichment (api/main.py:1441) — but the cache never compared against it. So:
analyse a job once, re-enrich it later with the extension (fresh scrape), reopen/revisit the job
→ the mount-time `useLayoutEffect` instantly hydrated the OLD cached verdict from before the
re-enrichment, with no indication it was stale. It looked like enrichment did nothing because no
real analysis ever ran — a genuine cache-serving-stale-data bug, not user error.

Fix: cache entries now also store `enriched_at` (the job's enrichment timestamp at the moment the
analysis was cached). On hydrate, if `job.enriched_at` is newer than the cached `enriched_at`,
the cache is treated as stale and dropped (memory + localStorage) — analysis resets to the empty
"not yet analysed" state instead of silently showing outdated output, so the owner is prompted to
run a fresh Analyse. Old cache entries written before this fix have no `enriched_at` and are left
alone (can't tell staleness either way — avoids mass-invalidating everything on deploy). Also
added `job?.enriched_at` to the hydration effect's dependency array so a live re-enrich while the
job panel is already open proactively invalidates too, not just on job switch.

Verified: `npm run build` clean; standalone Node harness covering all 4 cases (re-enriched later
→ invalidated; unchanged timestamp → kept; legacy entry with no timestamp → kept; job missing
enriched_at → kept); confirmed the live dev server (:5180) hot-reloaded without errors (only a
pre-existing, unrelated React "key" warning in the job list, not from this change).

---

## 2026-08-01 — CLI mode now handles PDF attachments (was silently dropping them)

Owner: "I want to be able to complete everything using CLI, don't have money to top up API now,
maybe in a month." Went looking for remaining CLI gaps beyond today's earlier /chat fix and found
a worse one: dropping a PDF or image into the cover-letter generator's file box built an
Anthropic `document`/`image` content block, and `_flatten_for_cli()` silently stubbed those out
as the literal string "[document attachment omitted]" before piping to the CLI bridge — while the
surrounding prompt still said "ATTACHED FILES... read them carefully." The letter would come back
looking normal, having never actually seen the attachment. Same root issue in `/kb/parse-file`
(KB PDF upload), which unconditionally required `ANTHROPIC_API_KEY` for its native-PDF-API call
regardless of the provider toggle.

Fix (api/main.py): added `_extract_pdf_text_local()` (PyMuPDF/`fitz`, already available, added to
requirements.txt and installed into `.venv` — it wasn't there, would have broken on next real
launch via falconscout.bat). `_flatten_for_cli()` now extracts real text from PDF document blocks
instead of stubbing them, so any `/claude` caller (generator file-drop, and anything else routed
through the CLI bridge) gets actual content. Image blocks still can't be read in CLI mode (no
deterministic text equivalent for vision) — those now get an explicit honest note instead of
silently vanishing, so the model doesn't try to act on content it never received. `/kb/parse-file`
gained a CLI-mode branch using the same local extractor instead of calling Claude at all.
Scanned/image-only PDFs (no text layer) surface a clear "needs Vision/API mode" message rather
than crashing or pretending to have read something.

Verified end-to-end against the live app (provider switched to "cli" per the owner's stated
intent): (1) uploaded a real generated PDF to `/kb/parse-file` — extracted correctly, no Anthropic
call, confirmed via response body; (2) sent a PDF containing a screening-question answer through
`/claude` as a document block exactly like the generator does — the CLI-routed model correctly
answered from the PDF's actual content ("OpenCart experience: yes"), proving the content now
reaches it; (3) sent a text-layer-free (scanned-style) PDF the same way — model correctly reported
no readable content, confirming the honest-degradation path works rather than crashing or
hallucinating. `python -m py_compile` clean under both the global interpreter and `.venv`.

Net: CLI mode now covers analyse, generate, chat, chat/distill, kb/shrink, AND PDF attachments
(both KB upload and generator file-drop) — everything except genuine image/photo attachments,
which need real Vision and have no code-only substitute; those now fail honestly instead of
silently no-op'ing.

---

## 2026-08-04 — Feed badge showed capture time, not real Upwork posting time

Owner spotted it directly: a job showing "42m" in the feed was actually "Posted 2 days ago" on
Upwork itself (screenshot: "Google Ads Specialist for Ecommerce", Hong Kong client, $8.62/hr avg,
155c boost — feed badge said "41m").

Root cause: JobList.jsx's feed-card time badge rendered `timeAgo(job.captured_at)` — time since
Falcon Scout's own DB row was created — not the job's actual Upwork posting time. The real
posting timestamp WAS already being captured correctly: `upwork_api.py` pulls
`publishedDateTime`/`createdDateTime` from Upwork's GraphQL response into `posted_date`, it's a
real DB column (db.py), and the Job Detail panel already displays it correctly as "POSTED". The
bug was scoped to this one small badge in the feed list. For API-sourced jobs the API poll can
surface a listing that's been live for days, so `captured_at` (when the poll happened to catch
it) and the real posting date can diverge by a lot — the badge made an already-2-day-old,
likely-proposal-saturated job look brand new, which is exactly backwards for judging real
competition/urgency.

Fix: badge now prefers `job.posted_date` when it parses as a valid date (true for API-sourced
jobs — clean ISO timestamps) and falls back to `job.captured_at` only when it doesn't (bot-sourced
jobs often store posted_date as unparseable free text like "Posted 2 days ago" from the Telegram
message, which can't be re-parsed into a fresh relative time). Added a title tooltip showing the
exact resolved timestamp (or "Posting date unknown — captured Xh ago" for the fallback case) so
it's never ambiguous which one is being shown.

Verified live in the running dev server: the exact reported job now shows "1d" / "Posted
8/2/2026, 6:02:51 PM" (was "41m"); confirmed the fallback path fires correctly elsewhere in the
feed ("Posting date unknown — captured 18h ago"); confirmed old bot-sourced jobs with real dates
still resolve correctly (an 88-day-old job renders "88d"). `npm run build` clean, no new console
errors (only the pre-existing unrelated JobDetail key-prop warning).

---

## 2026-08-04 — Duplicate case-attachment label slipped past the dedup checks (multi-block gap)

Owner shared a real letter (job 9995) with a visible duplicate: "Recent ecommerce work (attached
in profile highlights): / SMASH (attached in profile highlights)" — asked whether this is
automatically caught, and suggested a manual "flag it into the stats" button for cases the
automated checks miss.

Traced it: NOT caught. Root cause in `_ensureCaseStudyHighlightsLeadIn` (JobDetail.jsx) — the
step that strips a stray attachment label off a collective lead-in only scanned paragraphs
`i < firstCaseIdx`, where `firstCaseIdx` is the index of the FIRST case-name paragraph in the
WHOLE letter. This letter had TWO separate case blocks (a Shopify block with Casa Eleganza, then
a second "Recent ecommerce work:" block with SMASH) — the second block's own mislabeled lead-in
sits AFTER firstCaseIdx, so the single-pass, first-block-only scan never reached it. Same root
class as the earlier-fixed "second gap" bug, just a different trigger (multi-block letters instead
of a blind early-return).

Also found, same letter: "Casaeleganza (attached in profile highlights).com" — the label-insertion
helper (`_addProfileHighlightsLabel`) inserts right after the matched case-name text with no check
for a glued domain suffix, so "Casaeleganza.com" got split apart mid-string.

Fixes (JobDetail.jsx):
- Lead-in label strip now scans ALL paragraphs, not just those before the first case name —
  handles any number of case blocks per letter.
- `_addProfileHighlightsLabel` now extends past an immediately-glued ".tld" suffix before
  inserting, so "Name.com" keeps the domain intact and the label lands after it.
- Step 1 (lead-in strip) previously never called `_recordViolations` at all, even in the original
  single-block case — added `caseLeadInHadAttachmentLabel` telemetry so this failure mode is now
  visible in the Top Rule Violations panel going forward, not just silently patched.
- Added a manual flag button (🚩) next to the letter's 👍/👎 in the action row — one click, records
  a `manual:<tag>`/`manual_flag` entry to the SAME `/rule-violations` telemetry the automated
  checks use, so anything the deterministic checks miss (like this one, before the fix) still
  shows up in the stats instead of being noticed once and forgotten.

Verified: standalone Node harness reproducing the exact job-9995 text confirms both fixes (lead-in
duplicate resolved, domain string kept intact); `npm run build` clean; live dev server shows no
new console errors (only the pre-existing unrelated key-prop warning).

---

## 2026-08-04 — API feed had no age filter: weeks-old postings floated to the top

Owner spotted it via screenshot: jobs #001-#003 in the feed showed 33d/14d/7d old (real Upwork
posted dates, now visible thanks to the earlier badge fix) sitting at the TOP of a feed sorted
`captured_at DESC`. Root cause: `upwork_api.fetch_and_filter()` / `_row_passes()` filters by
stop-words, keyword match, rate floors, excluded countries, and payment-verified — but had ZERO
concept of posting age. The Upwork search API returns whatever matches the keyword/relevance
query, not just brand-new listings, so a broad keyword can surface a job that's been open for
weeks. First time OUR system discovers it, it's a genuinely new DB row with `captured_at = now()`
— which floats it straight to the top of the feed looking like fresh activity even though it's
stale. Most visible right after a Falcon Scout restart (first pull of the session naturally
surfaces the largest batch of previously-unseen-but-not-actually-new listings at once).

Fix: new `max_posting_age_hours` feed-config field (default 72h, matching the existing
`auto_enrich_max_age_hours` precedent — "older = probably expired/already triaged"). Added as a
drop condition in `_row_passes()`, comparing the row's real `posted_date` (Upwork's
publishedDateTime/createdDateTime) against now(); unparseable/missing dates fail safe (kept, not
dropped, so a data-quality issue never silently hides a job). Applies to BOTH the manual "Pull
fresh jobs" button and the background auto-fetch loop — they share the same `fetch_and_filter()`
call. Exposed in the Feed Settings panel (Settings tab) alongside the other numeric filters.

Verified: `curl /feed-config` on the live backend confirms the new field serves correctly
(72, picked up via uvicorn --reload with no restart needed); isolated Python test of the exact
filter logic against the real 33d/14d/7d ages from the screenshot confirms all three now drop,
while fresh/missing/malformed dates all correctly pass through. `npm run build` clean. Could not
get a full click-through browser confirmation of the Settings tab UI this session (synthetic
clicks toggled the nav button's active class but the panel didn't mount) — verified the new field
at the code level (build-clean, matches the pattern of 3 working sibling fields) instead of a
live screenshot.

---

## 2026-08-04 — Follow-up: the age-filter fix didn't retroactively clean existing stale rows

Owner reloaded after the `max_posting_age_hours` fix and still saw the same 33d/14d/7d jobs at
the top. Traced precisely: those specific rows (10056/10057/10058) were captured at 15:24:28 UTC
— the fix's commit (f7e5205) landed at 15:30:57 UTC, ~6 minutes LATER. The fix only gates future
ingestion; it does nothing to rows already sitting in the DB from before it existed. Not a
regression in the fix — just an incomplete one, and reloading obviously can't fix data that's
already there.

Ran a one-time cleanup: found all non-hidden, API-sourced jobs with `posted_date` older than 72h,
explicitly EXCLUDING anything starred or with a proposal row (never touch actioned jobs — same
retention principle `_prune_jobs` already follows). 14 unactioned stale jobs matched (including
all 3 from the original screenshot); 25 similarly-old jobs were correctly left alone because
they're starred or already have a proposal. Hid the 14 via `hidden_at` (soft, reversible via the
existing "Hidden" filter — not a hard delete). Verified via a live `/jobs` query: top of feed is
now genuinely recent postings only.

No code change in this entry — the ingestion fix from the previous entry already covers
prevention going forward; this was purely a one-time backfill cleanup for rows that predated it.

---

## 2026-08-05 — "Generator cannot find local SEO case" — real gap, fixed with a KB rule

Owner shared job 10199 ("Local SEO & Ads Expert Needed") — the cover letter cited FridgeFix +
House Painting (local Google Ads/PPC) but no local-SEO case, and the in-app chat, asked directly
"we have a local seo case, check the database", answered that Golden State Trailers is "B2B geo
expansion, not multi-location consumer services with GBP profiles" and effectively said no
qualifying case exists.

That answer contradicted the KB's own history: pulled 4 real past sent proposals (#421, #469,
#520, and the job postings #456/#467 this pattern targets) — every one of them confidently and
correctly cited Golden State Trailers (72 localized city/state landing pages, +350% organic
traffic, 67 keywords Top 3, 110 referring domains) as local-SEO proof, B2B vertical and all. The
model's fresh in-context judgment this time was simply wrong — same "unreliable to leave as
inference, must be an explicit rule" lesson as every other fix this session, just showing up on
the chat feature instead of analyser/generator. Checked existing rule #407 (general case-selection/
channel-matching) — it says nothing local-SEO-specific, so there was genuinely no rule anchoring
this the way rule #437 anchors Vape Shop.

Fix: added KB rule #583 (mirrors #437's pattern) — explicitly states Golden State Trailers is
valid proof for local/multi-location SEO jobs regardless of B2B/B2C vertical (the case proves the
GEO-SEO METHOD, not the industry), while explicitly forbidding overclaiming GBP/Map-Pack-specific
results from it (position tracking, suspension recovery, NAP/citation cleanup) since it only
proves organic landing-page ranking. Pure KB/data change, no code touched.

Verified live: re-ran the exact same chat question ("we have a local seo case, check the
database") with the new rule in the context. New answer correctly leads with Golden State
Trailers as the primary local-SEO case, quotes the rule's own GBP/Map-Pack carve-out verbatim,
also surfaced a second valid case (Multilingual Local SEO, South Tyrol — 18 keywords Top 1, 47
Top 3, +17.1K monthly visits) that the original answer had missed entirely, and correctly
separates FridgeFix as PPC-not-organic. One minor slip: the chat referred to the rule as "Rule 34"
by number, despite rule #407 itself instructing never to cite rules by number (paraphrase
instead) — a conversational-chat nit, not the formal analysis/generator output the rule was
written for; not chasing it further right now.

---

## 2026-08-05 — Case ledger audit against the source doc (D:\ITForce\Cases Upwork\Cases recap.docx)

Owner asked to check whether all cases from the master source document made it into the KB /
case ledger with nothing dropped. Extracted the docx directly (python-docx) — 10 numbered cases
plus a standalone ChronoCash recap, 11 total. Cross-checked every name and every figure against
`frontend/src/lib/caseLedger.js` (16 entries).

Result: nothing fabricated, nothing drifted, no case missing outright. The ledger's 5 "extra"
cases (Oxytec, SMASH, Game-X, GKit, Casa Eleganza) are correctly NOT in this doc — they're seeded
from the separate web-dev portfolio source (KB #518) per the ledger's own header, not an error.
"Real Estate" in the doc = "Atlant" in the ledger — same case, just named generically in the
source vs. by client name in the ledger; figures match (144.25%→144%, 56.51%→56.5%, -31.02%→-31%,
reasonable rounding).

BUT 4 of the 11 cases were missing a real, verified headline metric that IS in the doc's primary
"Best metrics" / "Key Metrics & Results" line:
- FridgeFix: missing `$1.71 CPC`
- Derma Solution: missing `35.26% of revenue from Organic Search`
- Multilingual Site: missing `Visibility +30%`
- ChronoCash: missing `€4.83K monthly ad spend`

This matters specifically because of how the ledger is meant to work (DESIGN.md §21.3): once
letters cite cases via `{{case:id}}` placeholder instead of free prose, the ledger becomes the
ONLY source — anything not in it becomes permanently uncitable even though it's a real, sourced
number. Added all 4 missing figures verbatim from the docx to their respective `metrics` arrays.
Did NOT add each case's "Extra proof points" (secondary, time-boxed stats like Skin Reboot's
Sept2024-Oct2025 ROAS breakdown or FridgeFix's Jul-Aug 2023 PMax window) — those are consistently
absent from every other ledger entry too, so leaving them out keeps the standard consistent
(headline "Best metrics" fully represented, secondary drill-down stats optional).

Verified: `renderCaseLine()` output checked for all 4 updated cases (Node, ESM import) — correct
rendering, all new figures present, count still 16/16. `npm run build` clean.

---

## 2026-08-05 — Generator kept citing PPC-only cases on a mixed SEO+Ads job

Owner, re-generating job 10199 after the Golden State Trailers KB rule fix, still got a letter
citing only FridgeFix + House Painting (both PPC) — zero SEO cases — on a job literally titled
"Local SEO & Ads Expert Needed". Traced it past the KB rule this time: the generator's system
prompt already HAS the correct instruction (line ~5136, "CASE STUDY SELECTION": "mixed-discipline
jobs: pick one from each domain"), and even names the exact scenario at line ~5150 ("a local SEO
case when the first two are national" as the textbook reason to add a 3rd case). The rule was
already right — the model just didn't follow its own instruction, buried as one line inside a
100+ line block.

Fix (JobDetail.jsx, generate()): added `_caseDomainNote`, a job-specific computed directive
injected directly into `jobContext` (same established pattern as the existing `_rateAnchorNote` —
a prominent, hard-to-skim-past instruction placed with the actual job data, not just one more line
in the giant static system prompt). Fires when the posting matches BOTH an SEO signal (seo, local
seo, map pack, GBP, listings, schema...) and a PPC signal (google ads, ppc, ad campaigns, cpc,
roas...) via regex against title+description — confirmed both fire correctly for job 10199's real
text. States explicitly: cite ONE case from each domain, naming the SEO options (Golden State
Trailers, Multilingual Site, Derma Solution, Luxury Parfums, Skin Reboot's SEO angle) and PPC
options, and calls out that two-PPC-zero-SEO fails the job's actual scope.

Also added `mixedJobMissingSeoCase` telemetry (post-generation, read-only — does not rewrite the
letter, since auto-generating a missing case paragraph isn't a safe deterministic fix the way
stripping/relabeling existing text is): when a mixed-signal job's finished letter cites none of
the SEO-vertical case names, it's now logged to rule_violations, so if the model still ignores the
directive sometimes, that's visible in the Top Rule Violations panel rather than silent.

Verification note: attempted a full live regeneration through the browser to confirm end-to-end,
but couldn't reliably drive job selection via synthetic clicks this session (third time today —
seems to be a browser-automation friction issue in this environment, not an app bug), and a
from-scratch replication of the ~65K-char generator system prompt (to test via direct API call
instead) hit a template-substitution bug not worth chasing further for a verification step.
Confirmed instead: `npm run build` clean, the mixed-signal regex correctly matches job 10199's
real title+description, the code follows the exact same pattern as `_rateAnchorNote` (an
already-proven-working mechanism), and the underlying KB rule content was already validated via a
real live call earlier today. Owner should regenerate this letter for a live confirmation when
convenient; the `mixedJobMissingSeoCase` telemetry will also surface it if it's still missed.

---

## 2026-08-05 — Feed ordering fix: sort by real posting date, not capture order

Owner clarified the actual ask after the age-filter fix: "the max posting age doesn't really
resolve it. It's the sequence of what's being shown." Correct distinction — max_posting_age_hours
controls what's ADMITTED into the feed at all (still working as intended, 72h cutoff); it never
controlled DISPLAY ORDER. The feed's `/jobs` GET was sorted `ORDER BY captured_at DESC` — a batch
API pull captures several jobs in one moment whose real ages differ (one posted 25 minutes ago,
another 3 days ago), so newest-by-discovery and newest-by-actual-posting are different orderings,
and the feed showed the former when the owner wanted the latter.

Fix (api/main.py): added `_effective_posted_dt(job)` — parses the job's real `posted_date`
(handles both formats: API-sourced ISO with offset like "...+0000", and bot-sourced space-
separated "YYYY-MM-DD HH:MM:SS" with no offset), normalizes to naive UTC (SQLite/SQLAlchemy
round-trips `captured_at` as naive, so comparing against a timezone-aware parsed date would raise
TypeError), and falls back to `captured_at` when `posted_date` is missing or genuinely unparseable
(free-text bot captures like "2 days ago"). The `/jobs` endpoint still uses SQL `ORDER BY
captured_at DESC LIMIT N` to pick WHICH rows enter the candidate pool (unchanged retention/paging
semantics — "most recently discovered N jobs"), then re-sorts that pool in Python by
`_effective_posted_dt` descending before serializing, so DISPLAY order reflects true posting
recency regardless of capture-batch timing.

Verified against the live backend (hot-reloaded via uvicorn --reload, no restart needed): pulled
the first 8 feed rows post-fix — posted_date descends monotonically (16:07 → 15:52 → 15:33 →
15:33 → Aug4 → Aug3 → Aug2 → Aug2), correctly interleaving bot-sourced and API-sourced timestamp
formats in one consistent order. `python -m py_compile` clean.

---

## 2026-08-06 — Owner-requested review of job 10312: audit-flag false positive + letter garbling

Owner shared job 10312 (Freelance Google Ads Specialist, Denmark, B2B industrial, $187K-spend
client) and asked for a review. Two distinct findings.

**1. FIXED — `_isPpcAuditJob` false-positive on ongoing-management jobs.** The analysis was
visibly self-contradictory: Reason 1 stated the standing "always APPLY, $300/1-day audit" policy
verbatim (the mandatory-flag text), while Reason 2 said "the mandatory audit flag fired
incorrectly... this is a MANAGEMENT ENGAGEMENT, not the $300 fixed 1-day audit deliverable" — the
model caught its own contradiction but the flag and the verdict-override (from the job-9522 fix)
still fired anyway. Root cause: `_PPC_AUDIT_JOB_RE` matches "audit" near "Google Ads" ANYWHERE in
the posting, with no check for whether audit is the WHOLE job or one bullet among many. Confirmed:
the posting's "Initial Deliverables" list includes "Audit of Google Ads, GA4, Google Tag Manager
and attribution" as ONE of eight bullets in an otherwise clearly ongoing, hourly, ~10-20hrs/month
management engagement ("This is an hourly freelance engagement... Ongoing hours depend on
workload"). The override's whole premise — "fixed-fee, not an hourly engagement, rate floor
doesn't apply" — simply doesn't hold when the posting itself says it's hourly.

Fix: added `_ONGOING_MGMT_NOT_AUDIT_RE`, an exclusion signal (ongoing hours/management, "plan
launch and manage", "hourly freelance engagement", "not looking for a fixed monthly package",
etc.) that suppresses `_isPpcAuditJob` when present. Verified against both cases: fires false
(correctly excluded) on job 10312's real Commercial Arrangement text; fires false on job 9522's
original text too (i.e. does NOT accidentally exclude the genuine audit-job case the original fix
was built for) — confirmed via isolated regex tests before wiring in. `npm run build` clean.

**2. OBSERVED, not fixed — garbled prose in the cover letter draft.** Two defects: (a) a sentence
referencing Golden State Trailers inline inside a parenthetical came out mangled — "Built lead-gen
architecture for B2B manufacturing (" cut off, followed by "Golden State Trailers (attached in
profile highlights):, custom trailers across 72 US cities) that went +350%..." with a stray comma
and unbalanced parens; (b) two instances of a lone "g." starting a sentence where "e.g." was
almost certainly intended, each apparently swallowing the preceding clause entirely. Hypothesized
the deterministic case-formatting pipeline (`_ensureCaseStudyHighlightsLeadIn` /
`_splitCrammedCaseStudies`) mis-handled an inline parenthetical case reference — built an isolated
test harness (extracted the real functions, fed a reconstructed draft matching the hypothesized
original wording) to check. **Hypothesis disproven**: the pipeline left that exact structure
completely intact, unmangled. This means the garbling most likely originated in the raw model
generation itself, not in Falcon Scout's post-processing — plausibly a CLI-mode-specific
coherence issue (this letter is long and complex, generated via the flattened-plain-text CLI
bridge path rather than the native structured API), though not confirmed with certainty. Not
something a deterministic patch can reliably fix after the fact the way the other bugs this
session were. Logged as an observation; owner should know CLI-mode output on long/complex letters
may need a closer proofread pass than API-mode output did.

---

## 2026-08-06 — Added pre-enforcer draft snapshotting (for tracing garbled-letter causes)

Follow-up to the job 10312 review. Traced the garbled prose to "somewhere in the two-pass API
generation" but couldn't pin it to the first draft vs. the `proposal_rule_enforce` rewrite pass,
because nothing captured the pre-enforcer state — by the time a defect is noticed, only the final
text survives. Owner asked to fix that gap so next time this happens it's actually diagnosable.

Added (JobDetail.jsx): a `preEnforcerDraft` state, snapshotted right before the enforcer's
`/claude` call fires (the exact `text` value that's about to be rewritten), persisted to
localStorage per-job (mirrors the existing `proposalDraft` cache pattern) and cleared at the start
of every fresh generate() so a stale snapshot from a different job/run can never linger. Hydrates
back on job switch, same as the proposal draft does.

Wired into "share with claude" (JobDetail.jsx + api/main.py /share-with-claude): the snapshot now
includes a "## Draft BEFORE the rule-compliance rewrite pass" section immediately before the final
"## Cover letter draft", but ONLY when a pre-enforcer snapshot exists AND actually differs from
the final text (identical means the enforcer changed nothing, not worth showing). This makes a
before/after diff directly available next time a letter looks off — settles whether the first pass
or the rewrite introduced it, which the job-10312 review couldn't answer after the fact.

Verified: `python -m py_compile` + `npm run build` both clean; posted a synthetic snapshot payload
directly to the live `/share-with-claude` endpoint and confirmed the rendered markdown has both
sections in the correct order with the right conditional labels.

## 2026-08-07 — Generator was offering an audit sample to clients who already have an audit done

Owner flagged (job 10570, "Technical SEO Website Developer"): the posting explicitly says "We already
have done a technical SEO audit, but you should be able to review the current setup, recommend
fixes, and implement changes" — an IMPLEMENTATION-ONLY ask. The generator still offered "I'm
attaching a sample technical SEO audit so you can see the format and depth" in both the first-pass
draft and the post-rewrite draft — pitching proof of a deliverable (an audit) the client explicitly
said they don't need. Root cause: bucket (A) of the SEO-job-deliverable prompt instructs the model to
ALWAYS attach the audit sample on any audit/technical-SEO-signal job, and the deterministic enforcer
backstop (`missingAuditSampleMention`) independently force-injects it if the draft omits it — neither
layer checked whether the posting says the audit is already done.

Fix (JobDetail.jsx), two layers per the established deterministic-first pattern:
1. **First-pass prompt**: added an "ALREADY-AUDITED / IMPLEMENTATION-ONLY JOBS" exception under
   bucket (A) — when the posting explicitly states an audit is already done, do NOT offer the audit
   sample; lean on implementation-result case studies (already cited) instead.
2. **Deterministic gate + strip**: new `_ALREADY_AUDITED_RE` (hoisted before both the plan-vs-audit
   block and the missing-sample block so both can use it) + `clientAlreadyAudited` boolean, tested
   against the job posting text (jobContextLower), NOT the draft. Wired two ways:
   - `missingAuditSampleMention` now ALSO requires `!clientAlreadyAudited` — the enforcer no longer
     force-injects the sample on an already-audited job.
   - New `wrongAuditSampleOnAlreadyAudited` (mirrors the existing `wrongPlanOnAuditJob` pattern
     exactly — same draftCompliant gate, telemetry entry, console pre-check, and specificViolations
     message) — fires the Claude enforcer to DELETE the audit-sample sentence if the draft still
     offers it despite the corrected prompt.
   `jobIsAuditOnly` (which correctly suppresses the SEO PROMOTION PLAN requirement — this is still not
   a growth/retainer job) is deliberately left untouched; only the audit-SAMPLE requirement is gated.

Verified: `_ALREADY_AUDITED_RE` tested against 5 "already audited" phrasings (incl. the exact job
10570 posting text) — all match; 4 normal audit-request phrasings ("please conduct an audit", "we
need someone to audit...") — none false-match. `vite build` clean.

## 2026-08-07 (2) — Fixed a race condition: switching jobs mid-analysis showed the WRONG job's verdict

Owner shared job 10555 ("Shopify Ad Setup Optimization" — Adsale/Meta/Google, Canada, $0 spend, 0
reviews) and reacted "cringe": the description + cover letter were correctly about job 10555, but the
**AI Analysis panel showed job 10570's verdict verbatim** ("Technical SEO + WordPress... Rosedale
screening token... $14.75/hr avg... 3 reviews at 4.96 rating") — a completely different job, with
numbers that don't even match 10555's own posted stats. This is worse than a phrasing bug: reading the
wrong verdict/rate-floor-risk/flags while believing you're evaluating the job on screen could drive a
real bidding mistake.

**Root cause (classic React stale-closure race):** `AIAnalysisColumn` and `ProposalColumn` both stay
mounted across job switches (same instance, only the `job` prop changes) and both have a "reset on
job.id change" effect — but `analyse()`/`generate()` are plain async functions triggered by a button
click, not tied to that effect's cleanup. If the user clicks Analyse on job A, then switches to job B
BEFORE A's API call resolves, A's completion handler still runs (the closure's `job` is frozen at A)
and calls `setAnalysis(parsed)`/`setProposal(finalText)` — stable state setters that unconditionally
update the CURRENT component instance, now showing job B. Nothing anywhere in the file compared "is
this result still for the job on screen" before applying it — `grep`'d for any `job.id !==` staleness
check; there was none.

**Fix — same pattern in both components:**
1. `currentJobIdRef` (a ref updated every render: `currentJobIdRef.current = job?.id`) tracks whichever
   job is ACTUALLY on screen right now, independent of any single closure's frozen `job`.
2. At the top of `analyse()`/`generate()`, capture `const _jobIdAtCallTime = job?.id` (frozen, matches
   the closure) and `const _isStale... = () => currentJobIdRef.current !== _jobIdAtCallTime`.
3. Every place that writes CONTENT into visible state (`setAnalysis(parsed)`, `setSimilar(d)`,
   `setProposal(finalText)` at both the deterministic-pass-through and enforcer-pass completion sites,
   the SKIP-gate pass note, and the generator's error message) now checks staleness first. When stale:
   skip the state update entirely and instead write the result DIRECTLY into `cacheRef`/
   `proposalCacheRef` + localStorage under the ORIGINAL job's id — so the API call isn't wasted, and
   the correct result is instantly ready if Artem navigates back to that job later.
   `setLoading(false)`/`setError` are left unconditional (matches prior behavior) — only the
   CONTENT setters are gated, to avoid a new stuck-spinner edge case for a job that never itself
   requested analysis/generation.

Applies to BOTH the Analyser (`AIAnalysisColumn`) and the Generator (`ProposalColumn`) — the owner only
noticed it on the Analyser this time, but the identical missing-guard shape existed in `generate()` too,
and there the consequence is worse: a wrong cover letter landing in the textarea (and potentially being
sent to a real client) instead of just a wrong on-screen verdict.

Verified: `vite build` clean (confirms no scoping conflicts from the two separately-scoped `_finalText`
extractions). The staleness-check control flow itself is a trivial ref-vs-frozen-const comparison,
manually traced correct in both directions (same job at completion → not stale → normal update; job
switched before completion → stale → skip + cache under the original id).

(Separately, also spotted the Skin Reboot "$12k to $95k" dollar-figure fabrication had resurged in the
draft-BEFORE-rewrite text on this same job — a previously-killed fabrication (WORKLOG, multiple prior
sessions) reappearing in raw generation. Confirmed the existing deterministic strip still catches it:
gone in the draft-AFTER-rewrite text. Not re-fixed here since the safety net is working; flagged as
further evidence for DESIGN.md §21's diagnosis that prompt-only bans don't hold and the case ledger
(21-A)/grounding checker (21-B) are the right fix, not another one-off strip.)

## 2026-08-08 — Killed a raw internal-planning-label leak into the cover letter's opening line

Owner flagged "huge bug in the opening" on job 10612 (Freelance SEO Specialist, client spent $718K —
high stakes). The letter's FIRST LINE, in BOTH the first-pass draft and the post-rewrite draft,
verbatim: "opening with expertise (restricted YMYL): scaling a relationships/anti-scam/Filipina-
culture site comes down to navigating Google's YMYL filters..." — the model's own internal planning
label (narrating which opening angle it picked, per the prompt's "VARY THE ANGLE" instruction) leaked
straight into client-facing text. Sending a letter that opens with a literal AI stage-direction is
instant-credibility-death — far worse than any grounding/duplication defect seen so far, and it
survived the FULL rule-compliance rewrite pass untouched.

**Why nothing caught it:** `_stripLeadingNarration`/`_NARRATION_LEAD_RE` looks like the right guard
but isn't — it's wired ONLY into the chat-rewrite path (InlineChat's `<proposal>` handler), never into
`generate()`'s own two completion chains, AND its regex only matches "what I changed" edit-commentary
("Stripped the…", "I've removed…") — a different shape than a leaked STRATEGY label. No guard in
either `generate()` pipeline covered this shape at all.

**Fix:** new `_stripLeadingStrategyLabel()` (JobDetail.jsx, sibling of `_stripFabricatedOpener` /
`_stripPostingRestateOpener`) strips a leading self-describing label ("opening with X (Y):", "Opening
angle:", "Hook:", "Angle (Z):") from the first paragraph ONLY — keeping the sentence that follows the
colon, which is a perfectly good hook once the leaked label is gone — then re-capitalizes the new
first letter. Scoped deliberately to "opening/hook/angle" (meta-commentary-about-the-letter words no
legitimate letter section is ever labeled with) so it can NEVER touch real content labels seen in good
letters ("Rate and scope:", "Timeline:", "Tools I use:", "My Shopify approach:", "Why I'm a good
fit:", "Shopify SEO experience:" — all explicitly verified untouched). Wired by calling it at the top
of `_stripFabricatedOpener` (same trick used for the posting-restate fix) — every emit path that
already calls `_stripFabricatedOpener` (both of `generate()`'s completion chains) gets it for free,
no paren surgery needed.

Verified (standalone Node, 11/11): the exact job-10612 leak → strips to "Scaling a
relationships/anti-scam/Filipina-culture site comes down to…"; 3 label variants (Opening angle:,
Hook:, Angle (buyer intent):) stripped correctly; 6 legitimate real-letter labels + a normal sentence
starting with "Hooking" all left untouched. `vite build` clean.

## 2026-08-08 (2) — Confirmed + root-caused a SECOND instance: analysis cache had no server-truth check

Owner asked me to confirm the "Rosedale" screening-token flag on job 10612's analysis — grep of the
actual posting text confirmed "Rosedale" appears NOWHERE in job 10612's description (only in the
analysis flag/chat lines). Same corruption class as yesterday's job 10555 (10570's stale analysis
bleeding onto a different job), but this time appearing on a THIRD job today, after yesterday's
race-condition fix was already shipped — meaning that fix alone wasn't the full story.

**Root-caused via the DB, not guessing:** queried `upwork_jobs.db` directly —
`last_analysis_json` for job 10612 is **NULL** (server confirms it was NEVER analysed), while job
10570's own row correctly holds ITS OWN real "Rosedale" analysis (that one was legitimate — 10570
really did have that screening token). This proves the corruption lives ENTIRELY in the frontend's
local cache (`cacheRef` + localStorage `_lsSave('analysis', jobId, …)`) — almost certainly an
ORPHANED entry written by the same underlying race before yesterday's staleness-guard fix landed
(the fix stops NEW corruption but does nothing to clean up entries already sitting in localStorage
from before it existed).

**The deeper gap:** the hydration effect (`useLayoutEffect` keyed on `[job?.id, job?.enriched_at]`)
loads from `cacheRef`/localStorage and NEVER cross-checks against the backend's own server-recorded
`job.last_analysis` / `job.last_analysis_at` (both already present on every job object the API
returns — `api/main.py:775`) — despite the POST that persists analysis server-side always using the
correctly-scoped job id (that write path was never buggy; only the local display/cache path was).
So even after yesterday's fix, an already-corrupted cache entry — or any future corruption from an
as-yet-undiscovered path — would silently persist forever with nothing to catch it.

**Fix (JobDetail.jsx, `AIAnalysisColumn` hydration effect):** reconcile the local cache against
`job.last_analysis` on every hydration:
- Server has a real analysis that substantively differs (compared on `verdict`/`score`/`summary`,
  not a raw deep-equal, so metadata fields like `ran_at` don't cause false mismatches) → trust the
  server, overwrite the local cache with it (self-heals silently, logs a warning).
- Server has NOTHING recorded but a local cache claims otherwise (job 10612's exact signature) →
  discard the orphaned entry rather than display unverifiable local-only data.
Effect's dependency array extended to `job?.last_analysis`/`job?.last_analysis_at` so a fresh fetch of
the job (e.g. after a background refetch) re-triggers reconciliation, not just an id/enriched_at
change.

Verified (standalone Node, 5/5): job-10612 signature (orphaned + server null) → discarded; server has
a genuinely different analysis → server truth wins; cached already matches server → left alone,
feedback preserved (no needless overwrite/cache churn); no cache + server has one → populated from
server; no cache + server has none → stays null, no crash. `vite build` clean.

This is now SELF-HEALING, not just preventative — the next time job 10612 (or any similarly
orphaned job) is viewed, the corrupted cache entry is automatically discarded on load; no manual
"clear analysis" click needed.

## 2026-08-08 (3) — New hard rule: PPC audit fee structure depends on posting's ongoing-work signal

Owner requested a new business rule for the Google Ads audit offer: if the posting says it's ONLY a
one-off audit with no recurring work, offer the plain $300 flat fee. If the posting signals possible
ongoing cooperation after the audit, still offer $300 but ALWAYS add "if we end up working together
[on ongoing management], this audit fee is credited back / becomes complimentary" — a confidence
signal that costs nothing unless the client actually converts to ongoing work.

Given this session's whole body of evidence that prompt-only instructions get ignored, implemented
as a HARD rule with both layers (matching the established pattern):

1. **Prompt instruction** — extended the existing "WHEN TO OFFER AN AUDIT (existing account)" section
   (JobDetail.jsx) with a new "FEE STRUCTURE — HARD RULE" bullet covering all three cases: explicit
   one-off/no-ongoing → plain $300; explicit ongoing-cooperation signal → $300 + the credit line
   (as an ADDITION, not a replacement); genuinely silent posting → default to plain $300 (no
   unprompted promise — only add the offer when the posting actually signals ongoing potential).

2. **Deterministic backstop** (generate()'s classification block, alongside the existing
   `jobIsPpc`/`jobIsSeo` detection):
   - `jobIsPpcAuditExisting` — is this actually a PPC audit-on-an-existing-account job (not a
     launch-from-scratch, which has its own different offer)?
   - `_AUDIT_ONLY_NO_ONGOING_RE` — explicit "one-time/one-off/single/no ongoing/not looking for a
     retainer" signal in the POSTING.
   - `_ONGOING_SIGNAL_PPC_RE` — "could lead to", "if this works out", "long-term partnership",
     "retainer", "monthly management", etc. in the POSTING.
   - `_DRAFT_COMPLIMENTARY_RE` — does the DRAFT already convey the credit-if-we-work-together promise
     (flexible on word order and phrasing, not verbatim-only)?
   - `missingComplimentaryAuditOffer` = ongoing signal present + draft offers the $300 audit + credit
     line missing → fires the enforcer to ADD it (keeping price/timeline unchanged).
   - `wrongComplimentaryOfferOnAuditOnly` = explicit no-ongoing-work signal + draft added the credit
     line anyway → fires the enforcer to DELETE it (nothing to credit toward).
   Both wired into all 4 sites (draftCompliant gate, telemetry array, console pre-check, and the
   specificViolations enforcer-instruction message), mirroring the exact pattern used for
   `wrongAuditSampleOnAlreadyAudited` earlier today.

Verified (standalone Node, 6/6 after fixing 2 test-harness postings that were missing the PPC
keyword — the underlying regex logic was correct on first try, only my simplified test's job-type
classifier needed the fix): one-off + plain draft → clean; one-off + wrongly-added credit line →
caught; ongoing-signal + missing credit line → caught; ongoing-signal + correctly-included credit
line → clean; silent posting (no signal either way) → defaults to plain $300, clean; launch-from-
scratch job → fee-structure rule correctly doesn't apply at all (different offer entirely).
`vite build` clean.

## 2026-08-08 (4) — Job 10609 validated the new fee-structure rule AND surfaced two new bugs

Owner shared job 10609 (tattoo studio in Oslo — explicitly wants "a long-term partner", textbook
ongoing-cooperation signal) to check the freshly-shipped fee-structure rule. Result: the rule worked
— the letter correctly included "if we end up working together on ongoing management, the audit fee
is credited back." But the BEFORE/AFTER draft comparison surfaced two SEPARATE, more serious bugs.

### Bug 1 — the enforcer rewrite garbled the letter (unsendable as shipped)
Diffing the two drafts: the first-pass draft was fully coherent. The post-rewrite (enforcer) draft
had a chunk silently deleted mid-sentence in TWO places, leaving broken fragments:
- "...and broad match bleed. **) So the ad copy sells** the specific artist..." (the whole "the oslo
  market is small enough... structure separate campaigns for your top artists + styles (realism,
  traditional, blackwork, etc." clause vanished — only the orphaned closing paren survived).
- A second paragraph that started **"\", conversion rate stays low..."** — a bare quote+comma with
  no preceding context, another mid-sentence deletion.
Confirmed via the file's own BEFORE/AFTER snapshot mechanism (added in an earlier session
specifically to diagnose "did the first pass or the rewrite introduce this" — referenced job 10312
in an existing code comment) that this is 100% an ENFORCER-INTRODUCED defect, not a first-pass or
deterministic-strip issue. The enforcer LLM, while satisfying several simultaneous listed violations
in one rewrite call, corrupted unrelated prose it wasn't even asked to touch.

**Fix:** new `_looksGarbled(text)` (JobDetail.jsx) — two cheap, generic, high-precision signals:
(1) unbalanced parens (a clean rewrite never orphans a bracket), (2) a paragraph starting with bare
closing punctuation or a lone quote+comma (the signature of a chunk deleted at a paragraph's start).
Wired into the enforcer-response handler: if the corrected text looks garbled AND the pre-enforcer
snapshot (already captured, per the existing job-10312 mechanism) does NOT look garbled, DISCARD the
enforcer's rewrite and keep the first-pass draft instead of shipping broken English. Fires
`enforcerGarbledRewrite` telemetry so we can see how often this actually happens over the next 30d.
Verified (Node): the real broken AFTER-draft → detected; the real clean BEFORE-draft → not flagged;
3 other clean letters from earlier sessions → no false positives.

### Bug 2 — audit price drifted from the fixed $300 to $800
The existing hard rule ("ALWAYS quote the FIXED PRICE... a flat $300... State it plainly") has NO
scope-based exception clause anywhere, yet this posting's unusually long checklist (account audit +
campaign optimization + conversion tracking + landing pages + marketing strategy + reporting, each
its own section) apparently led the model to quote "$800 flat" instead — contradicting both the
standing rule AND the analyser's own "$300 fixed audit is the perfect door-opener" assumption for
the SAME job, shown side-by-side to the owner. Zero deterministic enforcement existed for the audit
price at all (only the fee-STRUCTURE — i.e. whether to add the complimentary line — got a backstop
in the previous session's commit; the price NUMBER itself was unguarded).

**Fix:** `_extractAuditPrice(text)` looks specifically for a dollar figure attached to the AUDIT
deliverable ("$X flat ... audit", "audit ... $X flat", "rate/price/fee/cost for the audit: $X") —
deliberately scoped so it never matches the separate, legitimate ongoing-retainer estimate elsewhere
in the same letter (verified). `wrongAuditPrice` fires when a price is found and it isn't exactly
300, triggering the enforcer to correct ONLY the audit price line, explicitly instructed not to touch
any retainer estimate. Wired into all 4 sites (compliance gate, telemetry, console pre-check, enforcer
message), same pattern as every other hard rule shipped today.
Verified (Node): real $800 draft → extracted 800, flagged wrong; a $300 draft → extracted 300, not
flagged; a retainer-only mention with no audit price → returns null, not flagged (no false positive).

Both fixes: `vite build` clean.

## 2026-08-08 (5) — Three more bugs from job 10609's regeneration: weak intro, wrong case studies, insane rate

Owner regenerated job 10609 (tattoo studio, Oslo) after yesterday's garbling/price fixes and flagged
three fresh issues in one message. Root-caused and fixed all three.

### 1. Intro regressed to a posting-restate opener
The enforcer replaced a genuinely sharp, diagnostic first-pass opener ("scaling google ads... comes
down to one thing: conversion tracking that separates real bookings from form spam...") with a weak
paraphrase of the client's own stated goal: "You're looking to own local search for tattoo in oslo:
stronger impression share than competitors..." — nearly a direct echo of the posting's own "Our goal
is simple: to become the leading tattoo studio in Oslo." The existing `_stripPostingRestateOpener`
guard didn't catch it because this phrasing uses "looking TO [verb]" (own/dominate/build) rather than
the "looking FOR X" pattern it was scoped to.
**Fix:** extended `_POSTING_RESTATE_OPENER_RE` with `looking\s+to\s+\w+` and `your\s+goal\s+is\s+to\s+\w+`
alternatives. Verified: catches "you're looking to own/dominate X" and "your goal is to become X";
does not false-positive on legit hooks ("You're bleeding budget...", "Most accounts...").

### 2. Wrong case studies — off-vertical ecom-health cases piled onto the correct local-service ones
The letter correctly identified FridgeFix/House Painting as "the exact same setup" early on (woven
into the intro, per the CASE STUDY SELECTION RULE's own local-service guidance), then ALSO cited
Skin Reboot and Derma Solution (medical-aesthetic ecommerce — a fundamentally different account
archetype) as a separate, properly-labeled "Here are some relevant results:" block — undercutting the
correct case with a worse-fitting one. Confirmed `jobIsRegulatedForStrip` (the YMYL/regulated
classifier) does NOT fire on "tattoo" — so this wasn't a misclassification-driven strip; the model
picked the wrong "official" case block on its own, likely echoing structure from an unrelated few-shot
example.
**Fix:** new `localServiceCaseDisplacedByEcomHealth` — fires when the draft cites BOTH a local-service
case (FridgeFix/House Painting/Nectar Flowers/Golden State Trailers) AND an ecom-health case (Skin
Reboot/Derma Solution) in the same letter on a PPC job. These are never simultaneously appropriate
(different account archetypes), so requiring "pick the local-service lane" is safe. Enforcer instructed
to DELETE the ecom-health block entirely, not replace it — the local-service case is already complete
proof. Wired into all 4 sites (compliance gate, telemetry, console pre-check, enforcer message).

### 3. "$124/hr" for ongoing work — traced to an anomalous rate-anchor calculation
Owner: "this is crazy, dunno where it's coming from." Traced exactly: `_anchorLow = Math.max(_genFloor
+ 5, Math.round(_hMax * 0.8))` where `_hMax` = the posting's hourly ceiling. This job's posted range is
"$5-$155/hr" — a ~30x spread, almost certainly a capture artifact, not genuine client intent, for a
single small Oslo tattoo studio. 155 * 0.8 = 124.0 exactly — the RATE ANCHOR mechanism (designed to
anchor a DIRECT hourly quote to a high posted ceiling) got applied to the SEPARATE ongoing-retainer
quote that follows the $300 audit, producing a nonsensical hourly figure for what should be a scope-
sized MONTHLY retainer (the prompt already has its own "$800-2,500/mo" precedent for exactly this
engagement shape elsewhere, and an EARLIER regeneration of this SAME job correctly quoted "$1,200 -
$1,800/month" — confirming this is a self-inconsistency across runs, not a deliberate choice).
**Fix:** (a) prompt instruction — extended the FEE STRUCTURE hard rule: the ongoing-work quote MUST be
a monthly retainer range, RATE ANCHOR must not apply to it. (b) deterministic backstop —
`wrongOngoingRateFraming` fires when `jobIsPpcAuditExisting && jobHasOngoingSignal` and an hourly figure
appears near "ongoing" language; enforcer instructed to replace it with a monthly range, sized to scope.
Wired into all 4 sites.

Verified (standalone Node): all three against the exact real draft text — restate-opener regex catches
the leak + 2 variants, no false positives on legit hooks; case-pileup fires exactly on the real
FridgeFix+SkinReboot combination, doesn't fire on either case alone; ongoing-rate regex catches the
real "$124/hr...ongoing" text, doesn't fire on a clean monthly-retainer draft or an unrelated hourly
mention. `vite build` clean.

## 2026-08-08 (6) — The audit rule worked perfectly pre-enforcer; the enforcer then deleted it entirely

Owner asked "what about our new audit rule?" on job 10609's 3rd regeneration. Good news first: the
PRE-ENFORCER draft is a textbook-perfect execution of every rule shipped this week — "the audit is
$300 flat... if we end up working together on the retainer, that $300 is credited back" (correct fixed
price + correct complimentary-credit line) and "for the ongoing work:... i'd estimate $1,200 - $1,800
/month" (correct MONTHLY retainer framing, not hourly — exactly what yesterday's fix asked for). Intro
was sharp and diagnostic (no restate-opener this run), and case studies were FridgeFix/House
Painting/Atlant — all correctly local-service/appointment-vertical, no ecom-health pile-up.

But the ENFORCER PASS then deleted the entire pricing paragraph — $300, the 1-working-day timeline,
the $1,200-1,800/month estimate, AND the complimentary-credit line — and replaced it with an unrelated,
CONTRADICTORY offer: "I can set up and launch your campaigns from scratch in 5 working days..." — the
LAUNCH-FROM-SCRATCH pitch, which makes no sense on a job that explicitly has an existing account
needing an audit (the posting literally lists "Complete account audit", "Campaign structure review",
etc.). Comparing drafts: the enforcer was almost certainly invoked for a real, minor, legitimate
reason (the case studies gained "(attached in profile highlights)" labels they were missing pre-
enforcer — a genuine fix) — but while making that small fix, it also silently deleted and replaced
the entire commercial pitch, something it was never asked to touch and was explicitly instructed not
to ("preserve voice, tone, structure, and every other sentence verbatim").

This is a WORSE failure mode than the garbling bug fixed a session ago: the output here is
grammatically clean, just missing the entire fee-structure section and replaced with wrong content —
`_looksGarbled()` correctly does NOT flag it (nothing is broken, it's just gone).

**Fix:** extended the SAME enforcer-response fallback block (JobDetail.jsx) that already discards a
garbled rewrite, adding a MUST-KEEP PRICING regression check: if the pre-enforcer draft correctly had
"$300" and/or the complimentary-credit line, and the enforcer's corrected text lost either one
entirely, discard the correction and keep the coherent pre-enforcer draft instead — regardless of
which violation triggered the enforcer call in the first place. Fires `enforcerDroppedPricing`
telemetry. Reuses `draftOffersPpcAudit`/`draftHasComplimentaryOffer`/`_DRAFT_COMPLIMENTARY_RE` (already
computed earlier in `generate()`'s scope from yesterday's fee-structure work) — no new regexes needed,
just a before/after comparison mirroring the garbling check's structure.

Verified (Node): the exact real pre/post-enforcer text pair → correctly flags both the price and
complimentary-line regression; a non-audit letter (no $300 ever) → never triggers; a case where the
enforcer legitimately keeps "$300" present → does not false-trigger. `vite build` clean.

This is now the THIRD safety net on the enforcer's output (garbling, wrong deliverable checks, and now
must-keep-pricing regression) — strong, mounting evidence that the enforcer LLM pass itself is the
single least reliable link in the whole pipeline, exactly as DESIGN.md §21 diagnosed. Worth reading as
a strong signal to prioritize §21-C (slimming the prompt so the enforcer has less to juggle per call,
or reducing reliance on it) once the current soak period ends.

## 2026-08-08 — Job 10609 round 4: missing audit price, wrong ongoing fee, recurring wrong launch offer

Owner shared the 4th regen of the same job (10609, tattoo studio) with three distinct findings:
"Didnt mention audit price. Also: my management monthly fee (if it's fixed) is 700 for the setup
month and 600 for the ongoing management. Idk where those $1,200-$1,800/month coming from."

**Finding 1 — $300 audit price silently absent from the FIRST pass, not just dropped by the enforcer.**
Both the pre-enforcer AND post-enforcer drafts state "if we end up working together on ongoing
management, the audit fee is credited back" but never once state what that fee actually IS. Every
existing check (`missingComplimentaryAuditOffer`, `_regressedAuditPrice`) is gated on `draftOffersPpcAudit`
(the pre-enforcer draft already having "$300") before it fires — when $300 is simply never generated
in the first place, nothing catches it. Added `missingAuditPriceEntirely = jobIsPpcAuditExisting &&
!draftOffersPpcAudit`, wired into the standard 4 sites (draftCompliant, telemetry, console pre-check,
enforcer instruction).

**Finding 2 — the codebase's own "$800-2,500/mo" ongoing-retainer guidance was factually wrong.**
Artem's real ongoing-management fee is a FIXED two-tier price: $700 for the first (setup) month,
$600/month after — never a scope-sized range. That vague generic figure (in the RATE DISCLOSURE RULE
prompt text and in the FEE STRUCTURE hard rule's own ongoing-quote instruction, both from the
2026-08-08 fee-structure-rule work earlier the same day) is almost certainly what the enforcer drew
"$1,200-$1,800/month" from in this round. Corrected both prompt locations to state the fixed $700/$600
figures explicitly instead of a range, and added `wrongOngoingManagementFee` (fires when an
ongoing-monthly dollar figure is quoted that doesn't state both $700 and $600 together) wired into the
same 4 sites. Also updated the existing `wrongOngoingRateFraming` enforcer-instruction string to quote
the fixed fee instead of the old range.

**Finding 3 — the "launch your campaigns from scratch in 5 working days" offer recurred a 3rd time**
(rounds 3 and 4), still appended by the enforcer's rewrite on an existing-account audit job despite
round 3's must-keep-pricing regression fix, which only guards against pricing being DROPPED, not new
unrelated content being ADDED. Added two layers: (a) `wrongLaunchOfferOnExistingAccount` as a standard
pre-check boolean (inverse of the existing `wrongAuditOfferOnLaunch`) in case the first pass itself
adds it, and (b) `_addedWrongLaunchOffer` in the enforcer-response regression block — if the
pre-enforcer snapshot never mentioned a from-scratch launch and the corrected text does, discard the
enforcer's rewrite and keep the pre-enforcer draft, same pattern as the garbling and
must-keep-pricing checks.

Verified with a standalone Node script against the exact real BEFORE/AFTER text from this snapshot:
`missingAuditPriceEntirely` correctly fires on both drafts (neither ever states $300);
`wrongOngoingManagementFee` correctly fires on the AFTER draft ($1,200-$1,800/month) and not on a
draft stating both $700 and $600; `wrongLaunchOfferOnExistingAccount` correctly fires on the AFTER
draft only (the BEFORE draft never mentions a launch), confirming the enforcer added it, not the
first pass. A synthetic fully-correct draft (states $300, the credit line, and "$700... $600...")
produces zero false positives across all three new checks. `vite build` clean.

This is now a 4th and 5th safety net around the enforcer's output (garbling, wrong-deliverable,
must-keep-pricing, and now enforcer-added-launch-offer) — the enforcer keeps introducing unrelated
overreach even when explicitly told "preserve every other sentence verbatim," reinforcing the §21
diagnosis that the enforcer pass is the least reliable link in the pipeline.

## 2026-08-08 — Job 10609 round 5: deterministic force-fix for the ongoing fee, root cause of the garbled paragraph

Owner shared a 5th regen of job 10609: "again weird rate, paragraph starts with ")." and overall
I dont like it." Two distinct, now-resolved bugs.

**Bug 1 — the wrong ongoing-work rate ($124/hr this round) kept surviving despite round 4's fixes.**
Round 4 added enforcer-instruction checks (`wrongOngoingRateFraming`, `wrongOngoingManagementFee`) but
those only ask the enforcer LLM pass to fix the number — and across 5 regens of the same job the
enforcer has proven unreliable at this (sometimes not told to touch it, sometimes told and didn't
comply, sometimes its fix correctly discarded for an unrelated reason with the pre-enforcer draft's
own wrong number surviving instead). Added `_forceFixOngoingFee(text)` (JobDetail.jsx, module scope
near `_looksGarbled`) — a deterministic, unconditional last-mile regex correction wired into BOTH
`_gcShadow(_splitLongBodyParagraphs(...))` chains (the compliant-bypass path and the post-enforcer
path), so it runs regardless of what happened upstream. Gated on "$300" appearing near the word
"audit" (same proximity idiom as `_extractAuditPrice`) so it can never touch an unrelated SEO/webdev
ongoing-retainer quote.

A workflow adversarial-verify pass (3 parallel agents, independent Node repros against the real text)
caught two real defects in the first version before it shipped: (a) the initial gate was a bare
`$300` substring check with no context — a letter quoting $300 for something unrelated (e.g. a
landing-page redesign) plus a separate legitimate hourly rate near "ongoing" would have had that
unrelated rate wrongly clobbered; tightened the gate to require "$300" within 60 chars of "audit".
(b) the "strip the stale 'depending on scope' qualifier" cleanup regex consumed the trailing
separator comma as part of its match, producing a run-on sentence ("...$600/month weekly
search-term review..." missing the comma); fixed by capturing the comma and re-emitting it only when
it was actually there.

**Bug 2 — a paragraph in the final letter literally started with "). The audit prioritises..."**
Root-caused via a workflow agent that reproduced it directly (not just theorized): `_splitLongBodyParagraphs`'s
sentence tokenizer (`t.match(/[^.!?]+[.!?]+(?:\s+|$)/g)`) requires each "sentence" to be captured as
ONE atomic match ending in terminator+whitespace. Real prose routinely ends a clause "...homepage?)."
(terminator, then a closing paren, then the paragraph's real terminating period) or has a rhetorical
"?" INSIDE a parenthetical aside followed by a comma, not whitespace ("...booking?), campaign-structure...").
Neither shape has a valid atomic match under the old regex, so `.match()` silently DROPPED the entire
clause up to that point and resumed matching at the next fragment it could find — usually an orphaned
")." — which then became its own paragraph once `beats.join()` ran. This happened downstream of the
existing `_looksGarbled` enforcer-discard check (which is correct in isolation — confirmed independently
by the root-cause agent), so that safety net never saw the damage: the corruption was introduced by
the splitter, which runs LATER in the same shared strip-chain, on ANY accepted text regardless of path
(the compliant-bypass path doesn't call `_looksGarbled` at all, and even the post-enforcer path's check
runs on `correctedText` before the split, not after).

Fixed by replacing the atomic-match approach with a boundary-marking split: find every genuine sentence
boundary (terminator, optionally followed by closing brackets/quotes, immediately followed by
whitespace/EOF) via `replace()`, mark it, and split on the marker — `replace()` only transforms parts
that actually match and passes everything else through untouched, so no text can ever be silently
dropped the way `.match()` could. A candidate that ISN'T followed by whitespace (the parenthetical-
question case) simply never gets marked and stays fused to its sentence, exactly as intended.

Verified against the real round-5 paragraph containing BOTH failure shapes (the "?)," mid-sentence case
and the "?)." end-of-clause case) plus a normal paragraph with no bracket edge cases at all — output
now splits cleanly at real sentence boundaries with zero content loss (word count identical before/after)
and no garbled paragraph starts in either case. `vite build` clean.

**Process note:** used the Workflow tool (ultracode-directed) for adversarial verification and root-cause
investigation on this one — three independent agents tried to break `_forceFixOngoingFee` against
diverse job types and found the two real defects above before they shipped; a fourth agent
independently reproduced the splitter bug rather than accepting "the check looks correct in isolation"
as the full answer. One of the verify agents also reported a suspicious environment event during its
run (a scratchpad test file it wrote got externally modified mid-task with substituted test content and
an embedded instruction not to mention this to the user) — the agent correctly ignored the embedded
instruction and flagged it instead; surfaced to the owner directly rather than silently proceeding.

## 2026-08-08 — Job 10659: opener echoes the posting's own goal line + proper-noun casing feature

Owner shared job 10659 (SEO/web-dev, Windsor-Essex, Ontario) and asked to analyse the opener
specifically, plus requested a new feature: stop the generator's deliberate casual-lowercase voice
from lowercasing real proper nouns (cities, countries) -- "writing 'oslo' or 'essex' instead of Oslo
and Essex is rude."

**Opener analysis:** the letter opened "Fast + technically clean + seo optimized + mobile friendly +
conversion focused - for windsor-essex local searches." -- this is the posting's OWN closing line
("Fast + technically clean + SEO optimized + mobile friendly + easy to use + conversion focused +
competitive in local Google search.") echoed back almost verbatim with a couple of items dropped.
Distinct, newly-identified gap: `hasEchoedQuestion` only catches echoed screening QUESTIONS, nothing
catches an echoed descriptive/goal SENTENCE. Added `openerEchoesPostingLine` (JobDetail.jsx, wired into
the standard 4 sites) -- fires when the opener shares a 30+ char normalized run with any posting line.

**Proper-noun casing:** traced to `_humanizeCasing` -- it already deterministically fixes "I"/"Artem"
(DESIGN.md already documents this philosophy: casing correctness is never part of the human-imperfection
channel) but was never extended to place names, so the model's lowercase style bled onto real proper
nouns the client themselves capitalized in their own posting. Added `_extractProtectedProperNouns` +
`_restoreProperNounCasing` (module scope near `_humanizeCasing`) -- pulls every mid-sentence-capitalized
word/phrase from the RAW job context (a capitalized word NOT at a sentence/line start is a high-precision
signal of a genuine proper noun, acronym, or brand name -- no hardcoded city gazetteer needed) and
force-corrects any lowercase/miscased occurrence in the final letter. Wired into both `_gcShadow(...)`
strip chains, applies to every job (not gated to any vertical).

Ran a workflow (3 parallel agents) adversarially testing both features against diverse postings before
shipping. Found and fixed two real bugs from the FIRST implementation attempt: a hyphenated compound
like "Windsor-Essex" was only getting half-corrected ("Windsor-essex") because the hyphen-split logic
operated on the whole multi-word capture instead of each individual word-token. Ran a SECOND verify pass
on the fixed version and found two more real issues: (1) mid-sentence EMPHASIS-capitalized common words
("a truly Professional result", "done Quick") were getting registered as protected proper nouns, which
would force-capitalize that common word everywhere in the letter including unrelated generic sentences --
fixed with a curated stoplist of common emphasis adjectives/nouns. (2) the opener-echo check only probed
the first ~40 characters of each posting line, missing an echo buried later in a line that opens with
throat-clearing preamble ("Please note before anything else that our priority is: fast technically
clean...") -- fixed by sliding a 40-char window across the full line in 15-char steps instead of only
checking a fixed prefix.

Verified all fixes (final version) against: Oslo (Norway), multi-city (LA/SF/NYC), Windsor-Essex County
(Ontario), Shopify/WordPress brand names, the emphasis-word false-positive case, the buried-echo case,
the original confirmed opener-echo bug, a genuinely original opener (no false-fire), and a short-posting
inert case. Zero regressions, `vite build` clean.

## 2026-08-08 — Job 10659: generic hourly-rate-vs-posted-ceiling check

Follow-up to the in-app chat exchange the owner flagged ("did they ask for a rate?"). Verified the
chat's claim first: queried upwork_jobs.db directly and confirmed Rule 18 (kb_entries id=423) is real
and correctly quoted -- "Set maximum hourly rates at $35 for SEO optimization projects and $30 for PPC
projects" -- not a hallucinated rule number (the codebase's own prompt explicitly warns citing rule
numbers from memory can produce ones that don't exist, so this was worth checking rather than assuming).
The draft's "$40/hr" genuinely violated it, and nothing caught this deterministically since Rule 18 lives
in the editable KB (prompt-injected as reference only) with no JS backstop, and the enforcer is
explicitly told not to hunt for violations beyond the ones listed for it.

Owner asked to fix this ("do it"). Built it GENERIC rather than hardcoding Rule 18's specific $35/$30
figures (which live in user-editable KB data and could change): a deterministic check comparing
whatever hourly rate the draft quotes against THIS job's own posted rate_max, flagging when the quote
exceeds a threshold (10% over OR $3 over, whichever is more permissive) -- enforces the RATE ANCHOR
philosophy already in the prompt ("anchor to the posted ceiling, never exceed it") without duplicating
any specific KB rule's numbers.

Added `_extractQuotedHourlyRate`/`_forceFixQuotedHourlyRate` (JobDetail.jsx, module scope near
`_forceFixOngoingFee`) -- only matches Artem's own rate-quote phrasing ("my rate is...", "I charge...",
"hourly rate:...") via three targeted patterns, never a bare "$X/hr" mention elsewhere in the letter
(a diagnostic claim like "wasting $40/hr in ad spend" must never be touched). Wired the deterministic
check into the standard 4 sites (draftCompliant, telemetry, console pre-check, specificViolations.push)
and the force-fix into both `_gcShadow(...)` strip chains as an unconditional last-mile correction,
matching the established pattern from the ongoing-fee fix earlier today (the enforcer alone has proven
unreliable all session for load-bearing numbers).

Found and fixed one real bug during my own verification (before it shipped): the number-capture regex
`\d[\d,]*` swallowed a trailing sentence comma right after the number ("Hourly rate: $50, billed
weekly" -> captured "50," instead of "50") whenever the following suffix group was optional and
provided no backtracking pressure -- fixed by requiring the capture to end in a digit
(`\d(?:[\d,]*\d)?`), which still correctly handles a genuine thousands separator ("$1,200") while never
absorbing a trailing comma. Verified against the real job 10659 text (extracts $40, threshold $33 for a
$30 ceiling, correctly flags and force-corrects to $30), a senior-rate-near-ceiling case (correctly
untouched), an unrelated "$40/hr in wasted ad spend" diagnostic mention (correctly untouched), a
fixed-budget job with no hourly_rate_max (inert, no crash), and the comma-preservation fix. `vite
build` clean.

## 2026-08-08 — Fix: "_hMaxForRateCheck is not defined" crash on Generate

Owner hit a live crash immediately after the hourly-rate-ceiling fix shipped: "Error generating cover
letter: _hMaxForRateCheck is not defined". Root cause: `generate()` has a try/catch wrapping the
enforcer call, and a SEPARATE sibling block right after the `catch` for the post-enforcer strip chain
(`} catch (enforceErr) { ... } \n { const _finalText = _gcShadow(...) }`) -- I'd declared
`_hMaxForRateCheck` INSIDE the try block (alongside the other deterministic pre-check booleans), so it
was only in scope for the FIRST (compliant-bypass) chain nested inside that same try. The moment a
letter actually went through the enforcer path, the SECOND chain (outside the try/catch entirely) threw
a ReferenceError trying to read a const that only existed in a sibling block.

This is a class of bug `vite build`/esbuild can't catch -- bundlers check syntax validity, not whether
every reference resolves to a live binding on every code path, so the earlier "build clean" checks this
session gave false confidence. Node-script testing of the extracted functions in isolation didn't catch
it either, since those tests never replicate the real file's actual block/try-catch structure.

Fixed by moving the declaration up to where `_protectedProperNouns`/`jobIsRegulatedForStrip` already
live -- BEFORE the try/catch, at the outer function scope both chains share (the same pattern that
already worked correctly for those two). Removed the now-redundant inner declaration. Verified this time
by manually tracing the actual brace structure around the try/catch boundary (grep + sed on the real
line numbers) rather than trusting build-clean alone, confirming the relocated declaration sits in the
shared outer scope and all six usage sites resolve to the same binding.

## 2026-08-08 — Job 10659 round 2: SEO audit fixed-price rule ($700/$1050), mirroring the PPC one

Owner shared job 10659 regenerated: "rates are off and most importantly didnt offer audit with
samples." The draft DID technically mention "attaching a sample technical SEO audit" — the real issue
was pricing: it invented a vague "$1,200-1,800 fixed-price technical foundation buildout" (bundling the
audit with implementation work) plus "$600-800/month" ongoing, instead of clearly offering the audit as
its own discrete, correctly-priced deliverable.

Queried the KB directly (same verification discipline as the earlier Rule 18 check) and confirmed Rule
426 (kb_entries id=426) is real: "Only mention the $700 fixed price for technical SEO audit and that
it's included in the $1050/month SEO optimization retainer..." — this is the exact SEO-side mirror of
the PPC $300-flat-audit rule, but had NO deterministic backstop anywhere in the codebase (only the PPC
side had one). The draft's invented $1,200-1,800/$600-800 figures are the SEO equivalent of every wrong-
price bug already fixed on the PPC side this session.

Built `missingSeoAuditPriceEntirely`, `wrongSeoAuditPrice`, and `wrongSeoRetainerFee` (JobDetail.jsx,
gated on `isAuditJob && jobIsSeo && !jobIsPpc && !jobIsWebdev` so it stays inert on PPC-with-audit and
webdev-with-generic-audit jobs), wired into the standard 4 sites, enforcing the real $700 flat audit /
$1050/month retainer figures from Rule 426.

Ran a workflow (3 parallel agents) adversarially verifying before shipping — same discipline as every
other pricing fix this session. Two checks passed clean (job-type gating correctly stays inert for
PPC/webdev jobs and fires for signal-only SEO-audit jobs with no literal "audit" word; the monthly-rate
regex correctly handles thousands-commas, ranges, and doesn't false-positive on unrelated "$X this
month" aggregate stats). One found a REAL, order-dependent false positive: the audit-price extractor
used a plain (non-`/g`) `.match()`, which only returns the FIRST dollar-figure-near-"audit" occurrence
in the whole letter -- if a case-study sentence mentioning an unrelated dollar figure near the word
"audit" happened to appear BEFORE the actual correct "$700 flat" pricing line, a correctly-priced letter
got wrongly flagged as having the wrong price. Fixed by switching to a global match collecting EVERY
occurrence and checking whether the correct figure ($700 / $1050) appears ANYWHERE among them, rather
than trusting whichever one is leftmost -- removes the order-dependency entirely while still catching
the real bug (verified: case-study-before-correct-price case no longer false-flags; the actual job
10659 bug is still caught). `vite build` clean, all usages confirmed to stay within the try block (no
repeat of the earlier `_hMaxForRateCheck` scope bug).

## 2026-08-09 — CRITICAL FIX: proper-noun casing feature was corrupting entire letters

Owner shared job 10702 (Google Ads audit, ecommerce) and asked to check/analyse. Found a severe
regression: nearly every "and" in the generated letter had been capitalized to "AND", plus "audit" ->
"Audit", "campaigns" -> "Campaigns", "Search" wrongly capitalized, and "Artem" -> "ARTEM" (all caps) at
the very end. This is MY OWN proper-noun-casing feature (shipped earlier this session, job 10659) badly
misfiring — not a cosmetic issue, a genuinely severe letter-corrupting regression that would have shipped
to real clients if the owner hadn't caught it.

Root-caused by reconstructing the actual `jobContext` blob and running the extraction function against
it directly. `_extractProtectedProperNouns` was scanning the ENTIRE `jobContext` variable, not just the
client's own posting -- and jobContext also concatenates the ANALYSER's own generated summary/flags text
(riddled with ALL-CAPS emphasis for readability, e.g. "does NOT apply", "a FIXED $300 audit") and the job
TITLE (Title-Cased as a headline convention -- "Needed to Audit & Optimize E-Commerce Campaigns"
capitalizes "Audit"/"Campaigns" because that's how titles are styled, not because they're proper nouns).
Both got mistaken for genuine proper nouns and force-capitalized EVERYWHERE they appeared as ordinary
words in the letter -- "and" being astronomically common meant the corruption was total.

Fixed by scanning ONLY `fullDescription` (the client's actual raw posting body) instead of the full
`jobContext` composite -- normal prose doesn't have this problem since Title-Case headlines and ALL-CAPS
emphasis are specifically a title/analysis-text convention, not how people write sentences. Verified via
direct reconstruction test: extracting from fullDescription alone drops all the toxic terms ("not",
"fixed", "audit", "campaigns", spurious multi-word captures like "We Need"/"Looking For" from the
posting's OWN section headers) while correctly keeping legitimate protected terms (Google Ads, Indian,
Performance Max, Demand Gen, Shopping, Merchant Center, ROAS). Re-ran the real job 10702 BEFORE-draft
text through the fixed pipeline end-to-end -- zero corruption, "Artem" stays correctly title-cased,
"Google Ads" etc. still protected. `vite build` clean.

Residual, deliberately accepted risk: a posting's own short section headers ("What We Need", "Who We're
Looking For") can still register 2-3-word phrases as protected terms (e.g. "Looking For") -- essentially
harmless in practice since a draft is very unlikely to naturally use those exact lowercase phrases
elsewhere, unlike the "not"/"fixed"/"audit" case which are extremely common standalone words. Not
fixing further right now given the severity of what's already resolved; worth revisiting if a
concrete instance of THIS specific residual risk ever surfaces.

## 2026-08-09 — Follow-up fix: title headline duplicated INSIDE description_full itself

Owner regenerated job 10702 after the previous critical-fix commit and still saw "Campaigns"/"Audit"
wrongly capitalized mid-sentence (partial recurrence of the same corruption class, not the full "AND"
epidemic — the earlier fix did eliminate the analyser-text contamination, but not this).

Root cause, confirmed by querying the REAL stored `description_full` directly (not a hand-reconstruction
this time): the scraper glues the job's own Title-Cased headline straight onto the description body as a
markdown header with NO separating whitespace -- `"Summary## Google Ads Specialist Needed to Audit &
Optimize E-Commerce Campaigns\r\n\r\n..."`. Excluding the separate `job.title` field (the previous fix)
didn't help, because this exact headline text is ALSO duplicated inside `description_full` itself as its
first line. "to Audit" and "Commerce Campaigns" are headline-styling capitalization, not proper nouns,
and the extractor had no way to know that first line was a title rather than a sentence.

Fixed by stripping markdown header lines inside `_extractProtectedProperNouns` itself before scanning:
the glued `"Summary#{...}"` first line specifically, then any other standalone `"### Section Header"`
lines throughout the description (also Title-Cased styling, not prose -- this incidentally also dropped
some harmless-but-spurious captures like "We Need"/"Looking For"/"Applying" from the posting's own
section headers). Verified against the REAL `description_full` fetched straight from the DB for job
10702: "audit"/"campaigns" no longer appear in the extracted terms list at all now; legitimate terms
(Google Ads, Indian, Performance Max, Demand Gen, Shopping, Merchant Center, ROAS, CPA) remain protected.
`vite build` clean.

## 2026-08-09 — Job 10702 round 2: workflow-driven review, three more confirmed fixes

After the casing fixes, owner said "still a lot of mistakes." Ran a workflow (3 parallel reviewers,
each briefed with the real letter + real posting + real code) to sweep for remaining issues beyond
casing. All three findings below were independently confirmed via throwaway Node scripts against the
real regexes before being implemented, and cross-corroborated by more than one reviewer.

**1. Dash-reducer let unlimited dashes survive before capitalized words.** `_humanizeCasing`'s "at most
one spaced dash" rule only ever considered a dash if followed by a LOWERCASE letter
(`(?=[a-z])`) -- deliberately sparing dashes before a capitalized proper noun. In a PPC letter full of
capitalized product names (PMax, Shopping, Search), this let an unbounded number of dashes survive
untouched ("Auditing two running ecom brands - children's..." AND "Platform depth - PMax, Search...").
Fixed by extending the lookahead to `(?=[a-zA-Z])` -- verified numeric ranges ("9am - 5pm") and
hyphenated compounds ("high-intent") remain correctly unaffected (digits/no-surrounding-whitespace
still exempt).

**2. `hasListyOutline` missed colon-labeled sections entirely.** The existing check only catches a
DASH after a label ("Platform depth - PMax…"); it had no pattern for a colon-labeled section ("How I'd
Audit an account…:", "Who does the work:", "Ecommerce Google Ads experience:") -- the identical
structural-AI-tell, just punctuated differently. This exact letter would have passed the check cleanly
if a stray dash in the opening sentence hadn't coincidentally tripped the existing dash-block pattern.
Added two new patterns (question-style labels: how/what/who/why + colon; topic-noun labels: a short
Title-Case phrase ending in experience/expertise/depth/background + colon-or-dash), combined into the
same occurrence-count threshold. Verified against 5 legitimate short sentences (case-study lead-ins,
sign-offs) with zero false positives, and confirms this exact letter now correctly crosses the >=2
threshold.

**3. `exactVerticalCaseNotLeading`'s ecommerce `caseRe` had generic words that polluted its matching.**
It included bare vocabulary ("e-commerce", "shopify", "roas", "revenue") alongside actual case-study
names -- meaning ordinary prose mentioning "revenue" or "e-commerce" ANYWHERE before an off-vertical
filler case (FridgeFix) could be mistaken for "the on-vertical case already led," silently suppressing
the check exactly when it should fire. Narrowed `caseRe` to real case names only (nectar flowers/skin
reboot/smash/game-x/oxytec), and added `chronocash` -- an approved high-ticket ecommerce case (luxury
watch dealer, EUR0.52 CPC, +42% conversions) the reviewer confirmed exists in the codebase's approved
case list but wasn't being recognized as on-vertical proof. Verified the fix doesn't regress the correct
"genuinely leading" case and now correctly flags the previously-missed "generic words before filler"
scenario.

`vite build` clean across all three.

**Deferred, documented but not fixed (judgment calls needing more design, not shipped this round):**
- ChronoCash exists with full metrics in the approved case list but got buried as an unnamed fragment
  ("luxury watch dealer case") inside a Demand-Gen platform-depth aside instead of leading as a named,
  full-metric primary case for this ecommerce job -- a real gap, but fixing it means changing how the
  GENERATOR chooses/prioritizes which cases to name up front, not a simple regex catch; needs its own
  scoped pass.
- FridgeFix (a local-service case) got grouped under an "Ecommerce Google Ads experience:" header,
  which is a mislabeling distinct from simple ordering (which `exactVerticalCaseNotLeading` already
  checks) -- no existing mechanism checks "is this off-vertical case being mislabeled as on-vertical,"
  and building one risks over-fitting to this one header's exact wording. Flagging for a future,
  more careful pass rather than shipping something fragile now.
- The audit-sample mention reads as boilerplate tacked on right before the signoff rather than woven
  into a specific diagnosed point (a rule the prompt already states explicitly) -- "is this woven in
  vs. just present" is inherently a fuzzy, qualitative judgment to detect deterministically; not
  attempting a heuristic for it this round.

## 2026-08-09 — Job 10702 round 3: word-boundary regex bug + deterministic listy-outline strip

Owner shared round 3. Good news: the casing epidemic and case-study fixes from the last two rounds
held -- no "AND"/"NOT"/"FIXED", no "Audit"/"Campaigns" mis-caps, ChronoCash now named explicitly with
real stats (4,690 conversions from 9,210 clicks), FridgeFix dropped entirely, Nectar Flowers correctly
demoted from a full case citation to a brief supporting mention. Two remaining issues found and fixed:

**1. Standalone "Ads" still leaking through ("Shopping ads" -> "Shopping Ads").** Root cause: the
extraction regex's `[a-z,][ \t]` prefix has no word-boundary requirement, so it can match the TAIL of
an already-capitalized word, not just a genuine standalone lowercase word. `**Google Ads specialist**`
(bold markdown hides "Google"'s leading G from the prefix check) let the trailing "e" of "Google" itself
satisfy the prefix, spuriously capturing bare "Ads" as its own protected term -- which then force-
capitalized the GENERIC phrase "shopping ads" into "Shopping Ads" elsewhere in the letter (a real client
account type description, not the Google Ads product name). Fixed by requiring `\b` before the lowercase
run (`\b[a-z]+[ \t]` instead of `[a-z,][ \t]`) -- a word's own internal letters never satisfy a
word-boundary check, so this can no longer match mid-word. Kept a separate comma-based alternative
(`,[ \t]`) since commas aren't letters and were never at risk of this bug (needed for cases like
"Windsor-Essex County, Ontario"). Re-ran the FULL accumulated regression suite from this session
(job 10702's real ads bug, Windsor-Essex, Oslo, emphasis-word stoplist, multi-city) against the fixed
regex: 9/9 checks pass, zero regressions.

**2. Colon-labeled outline sections persisted despite hasListyOutline correctly firing.** Confirmed via
inspection: "E-commerce Google Ads experience:", "Platform experience:", and "How I'd audit an
account...:" were ALL still present, unchanged, in the post-enforcer draft -- meaning the enforcer was
invoked (the fix from the last round IS detecting this shape correctly) but failed to actually
restructure the prose despite being told to, the same enforcer-unreliability pattern as every
rate/fee bug this session. Added `_stripTopicNounLabelLines` -- a deterministic, unconditional strip
that dissolves a standalone "Label experience:"/"Label depth:" line (the specific colon-label shape
this session's fix targets) directly into the paragraph break, since the content that follows already
reads as a complete, self-contained paragraph without the label. Verified: cleanly removes both offending
labels with no double-blank-line artifacts, preserves all content, doesn't touch the "How I'd audit...:"
question-label (a different, less severe shape not yet auto-fixed), and doesn't false-positive on a
legitimate sentence using "experience"/"depth" as an ordinary word rather than a section label.

Wired both fixes into the shared strip chain (both `_gcShadow(...)` call sites). `vite build` clean.

## 2026-08-09 — Cost optimization: vertical-filter the case-study portfolio KB blocks

Owner asked for a thorough audit of KB entries to find spend-reduction opportunities. Ran a workflow
(3 parallel investigators) against the real DB + prompt-construction code. Findings, ranked by impact:

1. **Prompt caching is broken for generate() (biggest lever, not implemented this round):** `analysis`
   calls get a healthy 3:1 cache write:read ratio; `proposal` calls get 67:1 -- writing constantly,
   almost never reusing. Root cause: `analyse()` keeps job-specific data in the user message (system
   prompt stays near-identical across calls, cache hits work); `generate()` splices job-varying content
   (scope-filtered rules, portfolio/reference/past-proposal text) directly into the system prompt, so
   the backend's cache-split heuristic treats the whole per-job blob as "static" and writes a fresh,
   never-reused cache entry on every single call -- paying the ~25% cache-write surcharge with almost
   none of the 90% cache-read discount. Deferred: this is an architectural change (move job-specific
   content to the user message, stop varying what's sent, matching how analyse() already isolates
   jobSummary), not something to rush alongside today's change.
2. **Portfolio/reference text sent unfiltered on every generate() call, ~30K chars, no relevance
   gating** -- addressed below.
3. Rule-scope filtering already works reasonably (keeps 16-20/34 rules depending on job type) -- smaller
   lever, not touched.
4. 96 "case_study" KB entries (1.26M chars) are dead weight -- confirmed never fetched anywhere in the
   generator path (only referenced in the KB manager UI's display filter). Not a cost issue since
   nothing sends them, but worth knowing if you thought they fed the generator -- they don't; `manual`-
   type entries do.

**Implemented (owner chose #2, explicitly asked for revertibility):** the two manual-KB entries behind
`portfolioText` ("Case Studies Results Overview", 11 cases; "Web Development ... Portfolio", 4 cases)
were sent in FULL on every generate() call regardless of the job's vertical -- a PPC audit job got the
webdev portfolio, a real-estate case got the vape-shop case, etc.

Before implementing a naive character cap, inspected the actual content and found it would have been
actively harmful: these entries are lists of independent case studies (confirmed 11 and 4 respectively),
and a blind `.slice(0, N)` truncation would silently drop most of them (only keeping whichever appear
first), not just trim filler -- this would have made FridgeFix, Nectar Flowers, and ChronoCash
invisible to the generator regardless of a job's actual fit. Built `_filterCaseStudyBlocks` instead:
parses each entry into its individual `### case` blocks (verified against the real KB content -- both
entries use this exact heading shape, with "Key takeaways" intro and, for the webdev entry, trailing
"Live proof sites"/"How to use these" guidance sections that are never case-specific and always kept
regardless of filtering), hand-tagged each of the 15 cases with a vertical keyword pattern extracted
from its own "Niche:" line, and matches those tags against the current job's title+description.

Safety-first design, confirmed by owner requirement: if fewer than 2 tagged cases match the job text,
filtering does NOT activate and the full, unfiltered entry ships exactly as before -- this can only ever
show a confidently-matched job FEWER, more-relevant cases; an ambiguous or unmatched job (most of this
session's real jobs -- tattoo studio, generic ecommerce -- correctly fell back to full, unchanged
content) is completely unaffected.

Verified against real KB content across 7 scenarios: two real jobs from this session (10609 tattoo
studio, 10702 generic ecommerce) correctly fall back to full/unchanged; a med-spa job correctly filters
to Skin Reboot + Derma Solution only (6,869 -> 1,931 chars, ~72% reduction for that call) while excluding
FridgeFix/Golden State Trailers; a local-home-service job correctly filters to FridgeFix + House
Painting while excluding Skin Reboot; a real-estate-only job correctly falls back (only 1 match, below
the 2-match safety threshold); a streetwear+gaming-hardware job on the webdev entry correctly matches
SMASH+Game-X+GKit while excluding Casa Eleganza's dedicated block (Casa Eleganza is still legitimately
name-dropped in the always-kept "How to use these" guidance, which is correct, not a leak); a
furniture+fashion combination job correctly includes Casa Eleganza's block once 2+ matches exist. `vite
build` clean.

**Revert:** this is one isolated commit on a clean tree -- `git revert <this-commit-hash>` fully restores
today's send-everything behavior with no side effects on any other change.

## 2026-08-12 — Job 11202: two confirmed rate bugs ("$160/hr" to a client who's never paid more than $24.49/hr)

Owner reacted "wtf is this rate" to job 11202 (Google Ads/Meta/HubSpot ad management, posted $8-$200/hr).
Two distinct, real bugs compounded to produce this:

**1. RATE ANCHOR never cross-checked the client's actual paying history.** The analyser already computes
and weighs `job.avg_rate` (client's historical average paid to freelancers) against the posted ceiling
and Artem's floor when scoring a job -- this exact job was flagged "client avg $24.49/hr creates material
rate-floor risk" in the analyser's own reasoning. But the GENERATOR's rate anchor (`_rateAnchorNote`)
never looked at `avg_rate` at all -- it blindly anchored to 80% of the posted ceiling ($200 * 0.8 = $160),
producing a confident "$160-$200/hr" instruction for a client who has never paid more than $24.49/hr.
Fixed by cross-checking avg_rate: when it's below Artem's floor OR less than half the naive anchor (a
real gap, not a marginal one -- tested and tightened after an initial version would have wrongly flagged
a $110/hr avg against a $120 naive anchor, which is NOT inflated-ceiling territory), ground the anchor in
the client's real payment history (avg_rate * 1.15, floored at Artem's own minimum) instead of the raw
posted range. Verified: job 11202's case now anchors near $30/hr instead of $160/hr; a job with no
avg_rate data or one where avg_rate confirms the ceiling behaves exactly as before.

**2. `_stripUnaskedRate`'s audit carve-out was too broad, let an unsolicited rate survive.** This job's
posting never asks for a rate/pricing/budget anywhere -- confirmed by reading the full posting text, and
by `_postingAsksRate`'s own regex correctly evaluating false for it. The draft should have had its entire
"Rate for this: $160/hr..." paragraph stripped by `_stripUnaskedRate`. It survived because that
paragraph ALSO mentions "tracking audit" in passing (describing the hourly work's scope, not Artem's
$300 productised audit offer), and the carve-out meant to protect the genuine $300 audit pitch
(`/\baudits?\b/i.test(t)`) matched on the bare word "audit" alone, with no check that this was actually
the $300 offer. Narrowed the carve-out to require BOTH "audit" and the literal "$300" figure co-occurring
-- only the genuine productised-audit paragraph is protected now, not any paragraph that happens to use
"audit" as an ordinary word. Verified: the real unsolicited-rate paragraph now correctly gets stripped;
a genuine "$300 flat for the audit..." paragraph still survives being stripped when the posting doesn't
ask for a rate (regression-checked).

Both bugs independently contributed to the bad output: bug 2 meant a rate got quoted AT ALL (should have
been zero, since never asked); bug 1 meant the FIGURE would have been unrealistic even on a job that
genuinely did ask for a rate. `vite build` clean.

## 2026-08-13 — Job 11333: FridgeFix padding survives even when the on-vertical case correctly leads

Owner reported a recurring pattern, not a one-off: "generator chooses cases wrongly in many cases --
e.g. here job posting is e-commerce and it included Frige fix case -- we have much more relevent cases
in portfolio." Job 11333 (pure ecommerce PPC audit, $500-1K/day ad spend) is the concrete example: both
the first-pass draft AND the post-enforcer draft cited THREE cases -- Skin Reboot and Nectar Flowers
(both genuinely ecommerce) plus FridgeFix (local appliance-repair, zero ecommerce relevance). A manual
in-app chat correction ("add skin reboot") made it worse in one way and confirmed the pattern in
another: it added Skin Reboot as lead but explicitly reasoned "Kept Nectar Flowers and FridgeFix (both
strong conversion/tracking optimization angles)" -- justifying the off-vertical case by mechanic
similarity instead of vertical relevance.

Root cause: `exactVerticalCaseNotLeading` (built earlier this session for the same FridgeFix pattern)
only checks ORDERING -- does an on-vertical case appear before the generic filler in the text. On job
11333's actual draft, Skin Reboot genuinely does appear before FridgeFix, so the check evaluates false
and never fires -- but it doesn't check whether the filler should be there AT ALL once strong on-vertical
proof already exists. Confirmed via a standalone Node regression script reproducing both the before and
after drafts verbatim: `exactVerticalCaseNotLeading` is false on the after-draft (ordering already
"correct") even though the letter is clearly wrong.

Added a second, distinct deterministic check, `wrongVerticalCasePadding`, reusing the existing
`_jobVertical`/`_GENERIC_FILLER_CASE_RE` table (no new data structure): counts DISTINCT on-vertical case
names actually cited (deduped, so the same case mentioned twice doesn't double-count) and fires when 2+
genuinely on-vertical cases are already present AND a generic filler (FridgeFix/House Painting) is also
cited. Wired into all 4 standard sites (draftCompliant gate, telemetry, console pre-check, enforcer
`specificViolations` message instructing a hard delete of the filler paragraph, no replacement). The
2-match threshold matches the existing "CASE STUDY VOLUME CAP" language (stop padding once 2 strong
matches exist) rather than inventing a new arbitrary bar.

Verified via a standalone Node script against 7 scenarios including job 11333's REAL before/after draft
text pulled from share-with-claude.md: fires correctly on both the before-draft (filler leads) and the
after-draft (filler trails, ordering check misses it) with onVerticalCount=2 in both; does NOT fire when
only 1 on-vertical case is cited (below threshold, matches existing behavior); does NOT fire on a clean
2-case letter with no filler; correctly generalizes to a real-estate analog (2 real-estate matches +
FridgeFix padding fires); correctly stays silent on a genuine local-service job where `_jobVertical` is
null (FridgeFix is legitimate there, untouched); correctly dedupes a case mentioned twice in the same
letter (counts as 1, not 2). `esbuild` transform of `JobDetail.jsx` clean (no local `vite`/build install
available in this session to run a full `vite build`).

Deliberately scoped narrow: does NOT attempt the reverse direction (a local-service job padding on an
ecommerce case, or other verticals like luxury/fashion/gaming padding on the wrong filler) since that
would need a new `_VERTICAL_LEAD_CASES` entry for "local service" itself and reconciling it with
`_GENERIC_FILLER_CASE_RE`'s current "always filler" assumption -- flagging as a natural follow-up, not
done here, to keep this commit an isolated, cleanly revertible fix for the confirmed complaint.

**Revert:** one isolated commit on a clean tree -- `git revert <this-commit-hash>` fully removes the new
check with no side effects on any other rule.

## 2026-08-13 — Job 11279: cover-letter chat fabricated PDF content it never received

Owner reported: "generator dosnt see the files (pdfs) I have dropped for the context." The shared
transcript (job 11279, pet-supplement SEO/AEO retainer) showed exactly why it looked broken: owner told
the proposal chat "see atteched pdfs ... desribe them in the text insdead of yours", and the chat
FABRICATED three plausible-sounding article titles out of thin air instead of reading real ones. When
challenged ("can you confirm you see the attachments?") it admitted "I don't see any attachments in this
conversation." Ran a 3-way parallel workflow investigation (frontend attach UI, backend `/chat` endpoint,
repo-wide file-handling sweep) before touching code, since this could have been either a broken feature
or one that never existed.

**Root cause, confirmed:** `generate()` (the "Generate Cover Letter" button, `ProposalColumn`) has a real,
working file-drop zone — `droppedFiles` state, a `FileReader`-based drop handler, and a `/claude` call
that builds proper Anthropic `document`/`image` content blocks plus the `pdfs-2024-09-25` beta header
(git history: `d037178` "feat: file drop zone in cover letter generator", Jun 18; `3015e04` fixed CLI-mode
PDF stubbing, Aug 1). But the SEPARATE in-app "InlineChat" component used to iteratively edit that letter
(`chatId="proposal"`) has ZERO file-handling code — its `send()` posts only `{messages, job_id,
system_suffix}` as plain text to `/chat`. The user dropped PDFs onto the generator's dropzone (the only
one that exists), then tried to reference them in the ongoing chat below it — which never received them,
so Claude fabricated instead of admitting nothing, then correctly (but confusingly) said "no attachment"
once pressed. `/chat`'s backend handler also had no `anthropic-beta` header support at all — it hardcoded
the Anthropic request body with no way to pass a beta flag, unlike `/claude` which already had this.

**Fix (both sides):**
- Backend (`api/main.py`, `/chat`): added `betas = request.get("_betas") or []` and forward it as
  `anthropic-beta` header on the Anthropic call, mirroring `/claude`'s existing pattern exactly.
- Frontend (`JobDetail.jsx`): `InlineChat` now accepts a `droppedFiles` prop (default `[]`); the
  `ProposalColumn` passes its existing `droppedFiles` state into the `chatId="proposal"` instance (the
  `chatId="analyser"` instance is untouched — the dropzone is scoped/labeled to the generator, and the
  real bug was specifically in the proposal-editing chat). In `send()`, the current outgoing user message
  now gets the same content-block treatment `generate()` already does (document/image blocks + trailing
  text, or appended text for `.txt`/Excel-derived content), and the fetch body passes `_betas:
  ['pdfs-2024-09-25']` when a document is present. A system-suffix note tells Claude the files are
  attached, to read them before answering, and — directly targeting the fabrication — to say plainly if
  it can't actually read something rather than inventing a plausible description.

Deliberately re-attaches the current `droppedFiles` on every chat turn rather than tracking "already
sent" — `messages` history is stored as plain text (file blocks are spliced in only at send time), so a
turn that isn't re-attached would silently lose the file from Claude's context once it's not the newest
message. This matches `generate()`'s own accepted resend-every-call cost profile; a future optimization
could track a "files already acknowledged" fingerprint to avoid the repeat resend, but that's out of
scope for restoring correctness.

Verified: a standalone Node script reproducing the exact content-block logic (15/15 checks) — no-files
case stays untouched (plain string, regression-safe), a real fabricated-bug repro (PDF + "describe the
attached pdfs") correctly produces a document content block with the real base64 payload, text-file
drops append as text with no beta flag needed, only the CURRENT/last message gets the file block (not
earlier turns still in history), and an assistant-authored last message is correctly left alone. `esbuild`
transform of `JobDetail.jsx` and `python -m py_compile api/main.py` both clean. Live-loaded the app in the
browser and confirmed the job detail page, dropzone, and both chat panels render with no new console
errors (JobDetail's one pre-existing React-key warning is unrelated, predates this change). Did NOT
trigger an actual paid Claude API call for verification — owner has flagged spend sensitivity this
session, and a real end-to-end round-trip would cost real tokens without needing to be spent to validate
this specific wiring.

**Revert:** one isolated commit on a clean tree touching only `JobDetail.jsx` and `api/main.py` —
`git revert <this-commit-hash>` fully restores the prior (text-only, no-file) chat behavior.

## 2026-08-13 — "Analyse this job" failing: CLI bridge's error message hid the real cause

Owner hit "Error: CLI bridge error: {"error":"claude exited with code 1"}" on Analyse and asked to check
what's wrong. Confirmed `ai_provider.json` currently reads `{"provider": "cli"}` — the app is routing
through `cli-bridge.js` / the local `claude -p` subscription, not the direct Anthropic API.

Reproduced the bridge's exact spawn command directly (`claude -p --model sonnet --strict-mcp-config
--disable-slash-commands` from the bridge's neutral cwd) with stdout/stderr captured separately. Real
cause: "You've hit your session limit - resets 9:20pm (Europe/Kiev)" — the Claude Code CLI subscription's
own session usage cap, NOT the Anthropic API console spend limit from the earlier session (a distinct
billing surface). Note it's printed to **stdout**, with stderr completely empty.

That surfaced a separate, real bug in `cli-bridge.js`: its failure handler only ever checked `err`
(stderr) for a message, falling back to the generic "claude exited with code N" whenever the CLI's actual
reason landed on stdout instead — exactly what happened here, hiding a perfectly clear, actionable message
behind a useless one. Fixed the fallback order to stderr -> stdout -> generic. Verified with a standalone
Node script covering the real repro (stderr empty, stdout has the message -> now surfaced), a regression
for stderr-present (unchanged, still preferred), and both-empty (unchanged generic fallback). `node -c`
clean. Did NOT restart the owner's live bridge process to test end-to-end — it's otherwise functioning,
the CLI limit blocks calls regardless of the bridge restart, and restarting a process the owner started
themselves risked leaving it down if a background respawn didn't persist past this session. Fix takes
effect next time the bridge is naturally restarted (falconscout.bat, reboot, etc.).

Left the provider toggle exactly as found (`"cli"`) — did not switch it back to `"api"` even though the
owner stated a standing preference for API mode earlier this session, since that's a real billing-method
decision (and the API-side spend limit's current status is unknown) rather than a code bug to just fix.

## 2026-08-13 — Both audit offerings now state the audit is performed entirely manually

Owner request: "to our audits offerings (both ppc and seo) please let's implement one more additional
phrase, saying that audit is performed entirely manually." A trust/differentiation signal — competing
"audits" on Upwork are frequently auto-generated by SEO/PPC tools or AI, so stating the audit itself is
hand-done differentiates Artem's actual process.

Added the instruction to BOTH audit-offer prompt sections in `generate()`'s system prompt:
- PPC/Google Ads audit ("WHEN TO OFFER AN AUDIT" block, alongside the existing "$300 flat" price and
  audit-sample bullets): new bullet requiring the letter to convey the audit is done entirely by hand, no
  automated tools/templated reports.
- Technical SEO audit (section (A) TECHNICAL-AUDIT/DIAGNOSIS jobs, alongside the turnaround-timing
  bullet): same requirement, SEO-specific wording (no automated crawlers spitting out a templated
  report).

Both point to the same recommended phrasing: "every audit I run is done entirely by hand — no automated
tools, no templated report" — woven into the audit description, not dropped as an isolated line (matching
the existing "weave the sample mention in" convention already used for both audit types).

Per this session's established deterministic-first pattern (prompt instructions alone have repeatedly
proven unreliable), added a JS backstop check, `missingManualAuditClaim`: fires only when an audit is
ACTUALLY being offered in the draft — reusing the existing `jobIsPpcAuditExisting && draftOffersPpcAudit`
(PPC) and `_jobIsSeoAuditContext && _seoAuditPricesNearby.length > 0` (SEO) signals the price checks
already use, so it never forces the claim onto a letter that isn't offering an audit — and the draft
doesn't contain a manual-audit claim (regex covers "entirely/100%/completely/fully/all manual(ly)",
"manual...no automat[ed]", and "by hand" near "audit" in either order). Wired into all 4 standard sites
(draftCompliant gate, telemetry, console pre-check, enforcer `specificViolations` message with the exact
recommended phrasing).

Verified via a standalone Node regression script (8/8 checks): fires when the claim is genuinely missing
on both a PPC-audit letter and an SEO-audit letter; stays silent when the recommended phrasing OR a
natural alternate phrasing ("entirely manually") is present; stays silent entirely when no audit is being
offered (a web-dev job); does NOT get fooled by an unrelated, unrelated-context use of the word "manual"
(e.g. "I read your onboarding manual") into wrongly clearing an actually-missing claim; and a mixed PPC+SEO
job only needs the claim stated once. `esbuild` transform of `JobDetail.jsx` and `python -m py_compile
api/main.py` both clean.

**Revert:** one isolated commit on a clean tree touching only `JobDetail.jsx` — `git revert
<this-commit-hash>` fully removes both prompt bullets and the deterministic check with no side effects.

## 2026-08-13 — New feature: "Digit Bomb" opener

Owner request: a button that arms a cold-open style where the letter starts with a real case study's
raw numbers instead of the usual diagnose-first opener (example given: "17.51 ROAS and +693.8% revenue
scaling a Korean medical-aesthetic ecommerce store (Skin Reboot, attached as PDF) — restricted YMYL
niche... same pricing-and-feed problem you're dealing with on Japanese artisan goods"). Asked whether
the generator should auto-pick the case or whether to add a manual dropdown; recommended manual, given
this session's repeated automatic-case-selection reliability issues (FridgeFix padding, mislabeled
verticals, wrong ordering — three separate bugs fixed today alone), and the owner agreed, with an explicit
requirement: "pull only verified facts from the case ledger — no fabrications."

Verified before building: the example's "Korean medical-aesthetic" detail for Skin Reboot is NOT a
fabrication — it's the real, already-approved `one_liner` text in `frontend/src/lib/caseLedger.js`'s
`CASE_LEDGER` (the structured, model-proof case data source built in Step 21-A per DESIGN.md §21.3).
This confirmed the ledger was exactly the right foundation to build on — it already guarantees "metrics
can't drift" and "verticals can't be relabeled" since they're rendered from data, never typed by the model.

**Implementation** (`JobDetail.jsx`, `ProposalColumn`):
- New UI box (next to the existing Ahrefs box, visible in both the pre-generate and post-generate states):
  a dropdown listing all 15 `CASE_LEDGER` cases (name + headline metric) and an "Arm" toggle. Mirrors the
  existing `addlQMode` UX pattern (InlineChat's "Additional Questions" arm button) — armed state is
  consumed on the very next Generate/Redo click, then auto-disarms, so it can never silently bomb every
  future regen. Gated the disarm on `options.digitBombCaseId` actually being present in the call (not the
  raw armed-state alone) — otherwise clicking "Rescan & Re-write" (which never passes it through) would
  have silently disarmed a still-pending Digit Bomb arm.
- `generate(adjustmentsArg, options)` now accepts `options.digitBombCaseId`; resolves it against
  `CASE_BY_ID` (already imported for the existing `{{case:id}}` placeholder system) BEFORE the try block,
  matching this file's established "shared variables must be declared before the try so both `_gcShadow`
  call sites see them" rule.
- When set, a new "DIGIT BOMB OPENER MODE" system-prompt section is spliced in (right alongside the KB
  RULES directive, before PRIMARY WRITING DIRECTIVE) that explicitly overrides the normal "diagnose first"
  opener rules FOR THE OPENING ONLY. It hands the model the chosen case's exact `name`, `attachment`,
  `metrics`, and `one_liner` from the ledger and says to use ONLY those facts — no invented or altered
  numbers — while letting the model freely compose the one-clause bridge to the client's own real,
  stated situation (the one part of this that's inherently generative). Also tells it not to cite the
  same case again later in the letter's normal case-study block.
- Deterministic backstop (per this session's established pattern — a prompt instruction alone isn't
  trusted): `missingDigitBombFacts` fires when a case was armed for this call but the opening 400 chars
  don't contain BOTH the case's real name and at least one of its metric NUMBERS (matched on the digits
  themselves, not exact wording — so legitimate minor rewording, like reordering two metrics or dropping
  "PMax" from "17.51 PMax ROAS", doesn't false-positive; only a genuinely dropped/altered/fabricated
  number fails it). Wired into all 4 standard sites (draftCompliant gate, telemetry, console pre-check,
  enforcer message — the enforcer message re-embeds the exact verified facts directly, since the enforcer
  call uses a separate, short system prompt that doesn't automatically carry the original one).

Verified via a standalone Node script against real `CASE_LEDGER` data (7/7 checks): the owner's own
example text (verbatim) correctly passes; a compliant letter using a different metric pair passes; a
model reversion to the normal "reading your post" opener correctly fails; a case name present with a
fabricated/altered number correctly fails; a real metric present with the case name dropped correctly
fails; the check correctly stays inert when no case was armed; and a case with a non-ASCII metric
(ChronoCash's €0.52 CPC) is handled correctly. `esbuild` transform of `JobDetail.jsx` clean. Could not
live-verify in the browser — the dev server had stopped running (not reachable) by the time of this
change; did not start a competing instance since it's the owner's own environment to manage.

**Revert:** one isolated commit on a clean tree touching only `JobDetail.jsx` — `git revert
<this-commit-hash>` fully removes the feature (UI box, generate() option, prompt section, and
deterministic check) with no side effects on any other rule.

## 2026-08-13 — UI: moved the file dropzone from the generator column to AI Analysis (top)

Owner request: "generator side of the interface is very congested now, lets move the drop zone for docs
to the middle secton, on top" — the right (Cover Letter/generator) column had accumulated the file
dropzone, the Ahrefs box, My Rules, and the new Digit Bomb box; the owner wanted the dropzone relocated to
the middle (AI Analysis) column, at the very top.

`droppedFiles`/`isDragOver` state and their handlers (`_readFileAsBase64`, `_isExcel`,
`_readExcelAsText`, `handleFileDrop`) lived inside `ProposalColumn` — but `AIAnalysisColumn` (the middle
column) is a SIBLING component, not a child, so simply moving the JSX would have broken it (no shared
scope). Lifted the state + handlers up to the common parent, `JobDetail`, and passed them down as props
to both: `AIAnalysisColumn` now renders the dropzone (new props: `droppedFiles`, `setDroppedFiles`,
`isDragOver`, `setIsDragOver`, `handleFileDrop`), placed immediately after its "▸ AI Analysis" header
(top of that column); `ProposalColumn` now receives `droppedFiles` as a read-only prop (`generate()` and
the proposal `InlineChat` still read it exactly as before — no behavior change there, since standard
one-way data flow already covers a read-only consumer).

The dropzone's own text ("Drop PDF, Excel, image, or text file to add context to the generator") was left
unchanged since it describes what the files DO, not where the box sits. Did update one now-stale
reference: the empty cover-letter placeholder said "Drop a PDF... above to enrich it", which no longer
made sense once the dropzone moved to a different column — changed to "Drop a PDF in AI Analysis or add
an Ahrefs scan above to enrich it." Also corrected a comment in InlineChat's `send()` (added earlier this
session for the chat-file-attachment fix) that still said "the generator's dropzone."

Verified: `esbuild` transform of `JobDetail.jsx` clean; live in the browser (dev server had come back up
by this point) — confirmed the dropzone now renders at the top of AI Analysis and is gone from the Cover
Letter column, the Digit Bomb dropdown/Arm toggle still work correctly post-refactor (armed → "💣 Armed"
→ disarmed via direct DOM interaction), and no new console errors (the one pre-existing React-key warning
is unrelated and predates this session).

**Revert:** one isolated commit on a clean tree touching only `JobDetail.jsx` — `git revert
<this-commit-hash>` restores the dropzone to the generator column and removes the lifted state/props.

## 2026-08-13 — UI: moved Ahrefs section from the generator column to the top header bar

Owner request, same "generator column is congested" thread as the dropzone move: "move ahrefs section
at the very top, on the header - I need more space in the generation secton for better readability."
Clarified first which "header" was meant — traced the actual page structure and found the job
title/rate/badges block is really just the TOP of the left (posting) column, not a shared header; the
genuine page-level header is a thin bar in `App.jsx` (currently just "share with claude" + "refresh"),
rendered above all 3 columns as a sibling of `JobDetail`, not a child of it. Asked how the Ahrefs
result text (which can run long) should behave once moved there — owner chose collapsible-in-header.

This was a bigger lift than the dropzone move since the Ahrefs UI lived in `ProposalColumn` (inside
`JobDetail.jsx`) but needed to render in `App.jsx`'s header — a different FILE, not just a sibling
component in the same file. Extracted the whole self-contained block (domain/loading/timer state, the
job-switch sync effect, the two bridge-event listener effects, `handleAhrefsEnrich`/
`handleWebsiteInspect`) into a new named-exported component, `AhrefsBar`, still defined in
`JobDetail.jsx` (co-located with the rest of the job-detail component family) but now imported by
`App.jsx` and rendered directly in its header bar. Since `AhrefsBar` and `JobDetail` are siblings in
`App.jsx`'s tree, `ahrefsResult`/`websiteText` (which `ProposalColumn`'s `generate()` needs for
personalisation) are reported upward via an `onResultChange` callback into new `App.jsx` state, then
passed back DOWN through `<JobDetail ahrefsResult=... websiteText=...>` into `<ProposalColumn>` as
read-only props — the same lift-state-to-common-ancestor pattern as the dropzone move, just one level
higher (common ancestor is `App.jsx` this time, not `JobDetail`).

`bridgeReady` (needed by `AhrefsBar`'s enrich/inspect buttons) didn't exist in `App.jsx` — rather than
restructure `JobDetail`'s own prop flow, duplicated the small `cockpit:bridge:ready` window-event
listener in `App.jsx` too; both copies listen independently and never need to coordinate, since it's a
global browser event, not per-component state that could drift.

Added a "▼/▲ results" toggle button (only shown once a result exists) so the header stays a thin,
single-line bar by default; expanding it reveals the scraped Ahrefs summary + website text below the bar
(max-height 160px, scrollable) without pushing the 3-column layout around. Results collapse again
automatically on switching to a different job.

Verified: exact function-boundary check confirmed all `ahrefsDomain`/`ahrefsLoading`/etc. references
after the move fall entirely inside `AhrefsBar` (lines 4587-4786) with zero leakage into `ProposalColumn`
(4787+); a full-file grep for the old handler/state names outside that range returned nothing; a full
BUNDLED esbuild build of `App.jsx` (not just per-file transforms, since this is the first change this
session spanning two files) resolved the new `AhrefsBar` named export/import cleanly with zero errors.
Could NOT complete a live browser click-through this time — the dev server went down mid-verification
(confirmed via `netstat`, not something this change caused) and stayed down; did not restart it myself,
consistent with treating the owner's dev server as their own process to manage. Worth a real click-
through once the dev server is back up, though the static verification here is unusually thorough given
the cross-file nature of this change.

**Revert:** one isolated commit on a clean tree touching `App.jsx` and `JobDetail.jsx` — `git revert
<this-commit-hash>` restores the Ahrefs box to the generator column and removes `AhrefsBar` + the lifted
state/props in both files.

Owner then reported "I honestly don't see where did ahrefs section go" after a screenshot — the move
had actually worked (visible top-left of the header row), it was just visually subtle (small uppercase
label, no distinct background) next to the bold app header above it. Pointed out its exact location
rather than redesigning it; owner didn't ask for more visual weight, moved on to the next request.

## 2026-08-13 — UI: moved "My Rules" from the generator column to the header too

Same congestion thread, next request: "this part is just taking space, move it also there where ahrefs
now is" (screenshot showed the "▸ Cover Letter" label + "⚙ My Rules" button row in the generator column
— now the only thing left there besides Digit Bomb/Generate, since the dropzone and Ahrefs box were
already moved out).

Turned out simpler than the Ahrefs move: KB rules are entirely job-independent (`generate()` fetches its
own separate copy of the rules via `rulesForGenerator`, a differently-scoped local variable also named
`kbRules` — confirmed via grep before touching anything, so there was zero risk of collision) — so
extracting the whole rule-management system (create/distill/list/delete + the KB-conflict-resolution
flow + `ConflictModal`) into a new component needed NO callback wiring back into `JobDetail`/
`ProposalColumn` at all, unlike Ahrefs which had to report `ahrefsResult`/`websiteText` back down into
`generate()`. Extracted into `MyRulesBar()`, a fully self-contained named export (no props needed),
rendered in `App.jsx`'s header next to "share with claude"/"refresh". The rules panel itself renders as
an absolutely-positioned dropdown anchored to the button (`position:absolute, top:100%, right:0`) rather
than the header growing taller, so it doesn't disturb the header's height when open.

Removed the "▸ Cover Letter" label along with the button, per the owner's literal request ("move it
also there") — the generator column now goes straight from nothing into the Digit Bomb box, no header
row at all above it (the AI Analysis column still keeps its own "▸ AI Analysis" label, since that wasn't
part of this request).

Verified with the same rigor as the Ahrefs move given the last one produced a scary-looking (but
ultimately stale-bundle, not real) runtime error: exact function-boundary check confirmed every
`showRules`/`ruleInput`/`distilledRule`/`kbRules`/etc. reference after the move falls entirely inside
`MyRulesBar` (lines 4789-~5010) with zero leakage into `ProposalColumn` (5016+); a full bundled esbuild
build of `App.jsx` resolved cleanly. This time the dev server was back up, so also verified live in the
browser: clicked "⚙ My Rules" in the header and confirmed the panel opened showing all 34 real KB rules
fetched from `/kb?type=rule`, with "✦ Create Rule" and the delete "×" buttons present and correctly
wired; closed it again cleanly. No new console errors beyond the one pre-existing unrelated React-key
warning.

**Revert:** one isolated commit on a clean tree touching `App.jsx` and `JobDetail.jsx` — `git revert
<this-commit-hash>` restores the "▸ Cover Letter" + "⚙ My Rules" row to the generator column and removes
`MyRulesBar` + its header wiring in both files.

## 2026-08-13 — UI: moved dropzone + Digit Bomb into the header too (fourth move, same thread)

Owner, after seeing the header with Ahrefs + My Rules already there: "actually it makes sense to put
those to on the top as well, freeing the space" (screenshot showed the dropzone still at the top of AI
Analysis and the Digit Bomb box still at the top of the generator column — the two remaining fixed-space
items in either column). Completed the same congestion-relief thread for both:

**Dropzone**: state (`droppedFiles`/`isDragOver`) and handlers (`_readFileAsBase64`/`_isExcel`/
`_readExcelAsText`/`handleFileDrop`) had already been lifted ONE level, from `ProposalColumn` into
`JobDetail`, in an earlier move this session (so `AIAnalysisColumn` could render the box while
`ProposalColumn` still read the results). This time they moved a level FURTHER, from `JobDetail` up into
`App.jsx`, mirroring exactly how `AhrefsBar` already works. `AIAnalysisColumn` lost all 5 of those props
entirely — it never needed anything else from them, only rendering. `JobDetail` now just receives
`droppedFiles` as a read-only prop (matching `ahrefsResult`/`websiteText`) and forwards it to
`ProposalColumn`, unchanged from its perspective.

**Digit Bomb**: `digitBombArmed`/`digitBombCaseId` state lived in `ProposalColumn` itself (not lifted
before, since its UI and its consumer — `generate()` — were in the same component). Lifting it to
`App.jsx` needed `setDigitBombArmed` to travel back DOWN through `JobDetail` into `ProposalColumn` too
(not just the read values), since `generate()`'s auto-disarm-after-use logic calls it directly —
`digitBombCaseId`'s OWN setter stays local to the new header component, since only the dropdown itself
needs to change it.

Extracted two new self-contained, purely-presentational components in `JobDetail.jsx` (co-located with
`AhrefsBar`/`MyRulesBar`): `DropZoneBar` and `DigitBombBar`, both exported and rendered in `App.jsx`'s
header as a NEW second row (row 1: Ahrefs + My Rules/Share/Refresh, unchanged; row 2: DropZone + Digit
Bomb side by side) rather than cramming everything into one line.

Verified with the same rigor as the last two header moves: exact function-boundary checks confirmed
`droppedFiles`/`isDragOver`/`handleFileDrop` fall only inside `DropZoneBar` (plus the expected read-only
uses in `InlineChat`/`ProposalColumn`/`generate()`) and `digitBombCaseId`'s setter falls only inside
`DigitBombBar` — zero leakage anywhere; a full-file grep across both components confirmed single,
non-duplicate state declarations in `App.jsx`; a full bundled esbuild build of `App.jsx` resolved all
four new named imports (`AhrefsBar`, `MyRulesBar`, `DropZoneBar`, `DigitBombBar`) cleanly. Could not
complete a live click-through — the dev server was down again by this point (confirmed via `netstat`,
same intermittent pattern as earlier this session, not something this change caused); did not restart it,
consistent with treating it as the owner's own process.

**Revert:** one isolated commit on a clean tree touching `App.jsx` and `JobDetail.jsx` — `git revert
<this-commit-hash>` restores the dropzone to `AIAnalysisColumn` and the Digit Bomb box to `ProposalColumn`,
removing `DropZoneBar`/`DigitBombBar` and their header wiring in both files.

## 2026-08-18 — "Analyse this job" failing again: real OAuth expiry + CLI bridge auto-start/self-heal

Owner hit "CLI bridge error: {"error":"Failed to authenticate: OAuth session expired and could not be
refreshed"}" and asked to check why, plus a standing request: "I need bridge to start on every app
launch and be always available to be able to switch between CLI and API at any time."

**Diagnosis (real, confirmed directly):** `claude auth status` returns `{"loggedIn": false, "authMethod":
"none"}` — the Claude Code CLI's own OAuth login has fully expired, not a code bug. This is DIFFERENT
from the earlier session-limit issue (2026-08-13) — that was a usage cap with a resettable time; this is
a login that needs re-establishing. Fix is on the owner's side: run `claude auth login` in a terminal
(opens a browser to re-authenticate). Not something Claude Code can do on the owner's behalf — it's an
interactive OAuth flow tied to their own Anthropic account.

**The "always available" request, implemented:** `falconscout.bat` already started `cli-bridge.js` on
launch (line 4), but only if the owner used the full batch launcher AND kept that terminal window open —
starting the backend individually (`uvicorn api.main:app --reload`, per the CLAUDE.md quick-start), or a
closed/crashed bridge window mid-session, left CLI mode silently broken until the next full relaunch.
Moved responsibility for bridge availability into the backend itself:

- New helpers in `api/main.py`: `_ping_cli_bridge()` (checks `GET /ping` on 27182), `_spawn_cli_bridge()`
  (launches `node cli-bridge.js` in its own console window via `subprocess.Popen(..., cwd=ROOT,
  creationflags=CREATE_NEW_CONSOLE)` — mirrors `falconscout.bat` exactly so bridge logs stay visible in
  the usual place; safe to call even if one's already running, since `cli-bridge.js`'s own `EADDRINUSE`
  guard makes a redundant instance exit immediately), and `_ensure_cli_bridge_running(wait_for_ready)`
  (ping → spawn if unreachable → optionally poll up to 5s for it to come up).
- Wired into the existing `@app.on_event("startup")` hook (fire-and-forget) so the bridge comes up
  automatically no matter how the backend is started — not just via the full batch launcher.
- Wired as a SELF-HEAL retry into both places that call the bridge directly: `_call_via_cli_bridge`
  (used by `/chat`, `/chat/distill`) and `/claude`'s own separate inline CLI-routing block (the codebase
  has this logic duplicated in two places already; extended both rather than refactoring them together,
  out of scope for this fix) — on `ConnectError`, spawn + wait, then retry the SAME request once before
  surfacing the offline error. The `/claude` retry needed restructuring its try/except into a `while
  True:` loop (re-running the flatten+POST+return on a successful heal) since the original was a single
  try wrapping the whole request+response+return sequence, not just the POST call.

Verified fully end-to-end, twice (once per call site), with the owner's own live backend rather than a
synthetic script — since this is subprocess/OS-level behavior a Node script can't meaningfully simulate:
killed the real running bridge process, confirmed via `netstat` it was down, temporarily flipped
`ai_provider.json` to `"cli"` (backed up first, restored after both tests), then sent a real request to
`/claude` and separately to `/chat`. Both times: the request succeeded transparently (own the bridge auto-
spawning, becoming reachable, and the SAME request retrying and returning a real result) and `netstat`
confirmed a genuinely new bridge process (different PID each time) was left listening afterward. Restored
`ai_provider.json` to its original value (`"api"`) when done. `python -m py_compile api/main.py` clean —
this also caught a real indentation bug from restructuring `/claude`'s try/except into a loop (the final
`except Exception` clause wasn't re-indented to match), fixed before testing.

**Revert:** one isolated commit on a clean tree touching only `api/main.py` — `git revert
<this-commit-hash>` removes the auto-start/self-heal helpers and both retry sites, restoring the
original "CLI bridge offline — open a terminal and run: node cli-bridge.js" behavior.

## 2026-08-18 — Bug: Digit Bomb silently did nothing on "Rescan & Re-write" (and chat "Rework letter")

Owner: "check if digit bomb works on rescan - I have armed it but it didnt work" + shared job 11993's
snapshot. Confirmed from the shared draft: the letter opened with a normal diagnostic hook ("wasted spend
on hvac leads usually traces to..."), not a digit-bomb cold open — the feature genuinely didn't fire.

Root cause, found in the code before touching anything: `generate()`'s Digit Bomb consumption is
deliberately gated on `options.digitBombCaseId` being present in the call (not the raw `digitBombArmed`
state) — a prior comment even names "Rescan & Re-write" as the reason for that gate ("so a call that
never passes it... can't silently disarm it"). That gate itself is correct and still needed, but I never
actually wired the `digitBombArmed ? { digitBombCaseId } : {}` spread into "Rescan & Re-write"'s onClick
when Digit Bomb was built (2026-08-13) — it called `generate(null, { coreOnly: true })`, no digit bomb
option at all, so arming the feature and clicking Rescan produced a completely normal letter with zero
indication anything was skipped. Auditing all `generate()` call sites turned up a SECOND, identical gap:
the chat's "↺ Rework letter" trigger (`onRework={(msgs) => generate(buildAdjustments(msgs))}`) had the
same omission. "Generate Cover Letter" and "Redo" were correct from day one; only these two were missed.

Fixed both: Rescan & Re-write now calls `generate(null, { coreOnly: true, ...(digitBombArmed ? {
digitBombCaseId } : {}) })`; the chat's onRework now calls `generate(buildAdjustments(msgs), digitBombArmed
? { digitBombCaseId } : {})`. No changes needed to `generate()` itself, the system-prompt override, or the
`missingDigitBombFacts` deterministic check — all of that already worked correctly given the right
options; the bug was purely "two of four buttons never actually passed the arm state through."

Verified via a standalone Node script covering all 4 trigger points (Generate, Redo, Rescan & Re-write,
chat Rework) crossed with armed/not-armed (10/10 checks): confirms `digitBombCaseId` now flows through on
all 4 when armed, stays absent on all 4 when not armed (no false-positive triggering), and Rescan's
`coreOnly: true` option is preserved unchanged in both cases. `esbuild` transform of `JobDetail.jsx` clean.

**Revert:** one isolated commit on a clean tree touching only `JobDetail.jsx` — `git revert
<this-commit-hash>` restores the pre-fix (broken) Rescan & Re-write / chat Rework behavior.

## 2026-08-18 — Digit Bomb "didn't work again": deterministic check was checking presence, not order

Owner re-tested the previous fix (job 11993, same "Audit for Google Ads" HVAC job) and reported "shared,
didn't work again" with a fresh snapshot. Reading the actual draft revealed a real, different bug — not
a repeat of the button-wiring miss just fixed.

The BEFORE draft ignored the digit-bomb system prompt entirely (opened with the client's own "650 HVAC
calls a month..." stat, a normal diagnose-first hook) — the first pass just didn't comply, the same
"prompt alone isn't reliable" pattern this whole file is built around. The AFTER (post-enforcer) draft is
the interesting part: it DID pull FridgeFix's real metrics into the opening, so `missingDigitBombFacts`
technically fired and the enforcer technically responded — but the result read as an ORDINARY case-study
citation, not a digit-bomb cold open: "FridgeFix (attached in profile highlights) - California
refrigerator-repair business, local lead gen: dropped cost per conversion 92%..." — the CASE NAME came
first, the metric was folded into the middle of a sentence afterward. The deterministic check as written
only verified the metric number and the case name both appeared SOMEWHERE in the first 400 characters —
it never checked which one came first, so this technically passed even though it's backwards from the
entire point of the feature ("the very FIRST WORDS of the letter must be this case's real numbers").

Tightened `missingDigitBombFacts` to require the metric's first appearance to (a) land within the first
80 characters ("the very first words", not just "early in the letter") AND (b) come strictly before the
case name's own first mention — not just co-occur with it. Also strengthened both prompt-facing texts
with an explicit right-vs-wrong contrast, since the enforcer had already been told "lead with the
metrics, then name the case" in the original wording and still put the case name first — a real
instruction-following miss, the same reason this file defaults to deterministic checks over prompt
wording alone: the PRIMARY "DIGIT BOMB OPENER MODE" system-prompt section now shows a labeled WRONG-order
example alongside the correct one, and the enforcer's `specificViolations` message for this check now
explicitly names "case name written first" as the common failure mode and repeats the ordering
requirement with a concrete before/after using the real case that shipped wrong.

Verified via a standalone Node script (6/6 checks) built directly from job 11993's real shipped text:
confirms the exact real draft that shipped now correctly fails the check; the owner's own original
numbers-first example (and a differently-worded but still-compliant variant) still pass; a case with the
name but no metric at all still fails; a case where the metric arrives correctly but past the 80-char
lead window (buried deeper in a longer opening paragraph) still fails; and the check stays inert when no
case is armed. `esbuild` transform of `JobDetail.jsx` clean.

**Revert:** one isolated commit on a clean tree touching only `JobDetail.jsx` — `git revert
<this-commit-hash>` restores the presence-only (order-blind) check and the original prompt wording.

## 2026-08-18 — Reply-sync silently losing most replies: room-walk broken in background tabs

Owner: "I definitely received at least one reply this week — but the sync didn't catch it — please check
if its working correctly" (Dashboard showed 0 replies for WEEK 34 · AUG 17-23 despite a real, visible
reply from a client "Ish Mish" in Upwork's own Messages inbox).

Ran a full investigation (general-purpose agent) across the Chrome extension, backend matching logic, and
the real DB — confirmed with hard evidence, not guesswork:

- The extension's messages-list scraper DID correctly capture the reply (exact text match to the
  screenshot). It never got matched to proposal id 179 ("PPC Expert for Private Label Revival", job
  11866) because **all three matching tiers failed simultaneously**:
  1. **Room-walk (exact `upwork_job_id` match)** — the extension navigates into each candidate
     conversation in a BACKGROUND tab to read the job-link off the room page. The sync's own debug dump
     (`messages_sync_debug.json`, gitignored — real client message previews) showed **0 job links found
     out of 10 rooms visited** that run. Chrome throttles background tabs enough that neither the DOM
     anchor query nor the raw-HTML fallback ever saw the loaded page within the 12-second budget.
  2. **job_title fallback** — Upwork's inbox list doesn't expose job titles at all; the scraper's
     best-effort heuristic grabbed the client's own name ("Ish Mish") instead.
  3. **greeting-name fallback** (the one the backend comments call "the reliable path") — requires the
     cover letter to open with "Hi `<Name>`". Artem's actual cover letters never do this — his own
     PRIMARY WRITING DIRECTIVE explicitly BANS greeting-style openers. This fallback is structurally
     incapable of ever matching a letter this app generates, not just this one.
  - Cross-referencing the same debug snapshot against the 50 proposals sitting at `sent`/`viewed` found
    **19 of 20 scanned conversations failed to match that same run** — this was silently losing most
    replies, not a one-off. Reported 5 more genuine unmatched client replies to the owner directly (incl.
    one reading as a strong lead) for manual cross-referencing, since there's no stored client-name field
    to auto-match them against.

Root cause pointed at a KNOWN, previously-fixed-once instance of the exact same failure: a comment
sitting directly above the CURRENT code in `background.js` reads *"open the proposals page as an ACTIVE
tab (background tabs are throttled and don't render virtualised rows — that's why we only ever scraped
~7/30)"* — but the actual code creates it with `active: false` anyway. Confirmed via `git diff`/direct
reading that this contradiction is real, not a stale-comment red herring: Chrome background-tab throttling
breaking Upwork scraping is a documented recurring failure mode in this exact file, not a new theory.

Given the real trade-off (reliability vs. the owner's explicit "never steal focus" requirement from when
this was built), checked in before changing anything: asked whether to make the messages-sync tab briefly
active, keep it background with just a longer timeout (likely only a partial fix per the ~7/30
precedent), or active only for the manual "Sync from Upwork" button. Owner chose making it active for
both the hourly auto-sync and the manual button.

**Implemented** (`upwork-enricher/background.js`, `upwork-enricher/messages-list.js`):
- The messages-sync tab now opens `active: true` in both `_startSync()` (hourly `chrome.alarms` tick) and
  the `SYNC_PROPOSAL_STATUSES` manual-sync handler. The proposals-list leg is untouched — stays
  background, out of scope for this fix.
- To minimize the "never steal focus" trade-off the owner accepted: added `_msgTabPrevActive` (tabId →
  the tab that was active right before we opened the sync tab). Restored in THREE places so the focus
  restoration can't be skipped by whichever path the sync happens to finish through: the normal
  `MESSAGES_LIST_SCRAPE_DONE` completion handler, AND the 4-minute failsafe tab-cleanup alarm (in case the
  walk hangs badly enough to hit that instead) — both `chrome.tabs.update` calls are best-effort/fail-
  silent (`lastError`-guarded) exactly like the existing `chrome.tabs.remove` pattern already in this
  file, since the tab being restored to may have been closed by the owner in the meantime.
- `_startSync` had to become `async` to `await chrome.tabs.query(...)` for the "capture current active
  tab" step — checked its one call site (a fire-and-forget call inside the `chrome.alarms` listener) is
  safe with an unawaited async function before making the change.
- Bumped `waitForRoomJobLink`'s default timeout from 12s to 15s (modest — now a safety margin on a fast,
  reliably-rendering active tab, not an attempt to outlast background-tab throttling) and updated its
  comments accordingly.
- Did NOT touch the job_title heuristic or the greeting-name fallback — the latter is fundamentally
  incompatible with Artem's own no-greeting writing rule, not something a regex tweak can fix without
  either changing that writing rule (not asked for) or fabricating a different matching signal.

**Verification is necessarily limited for this one**: this is a Chrome extension background service
worker interacting with the owner's real Upwork session — nothing that runs through this session's usual
esbuild/browser-preview verification tools. Confirmed via `node --check` on both files (clean) and a full
manual trace of every `chrome.tabs.create`/`chrome.tabs.query`/`chrome.tabs.update` call site added,
including the one existing caller of `_startSync` to confirm making it `async` was safe. Could NOT
live-test the actual Chrome behavior (whether an active tab really does render fast enough now, and
whether the focus-restore is visually smooth) — that needs the owner to reload the unpacked extension in
`chrome://extensions` and run a real sync. Flagged this limitation directly rather than claiming
end-to-end verification that wasn't possible here.

**Revert:** one isolated commit on a clean tree touching only the two extension files — `git revert
<this-commit-hash>` restores both messages-sync tabs to `active: false` with no focus-restore logic and
the original 12s timeout.

## 2026-08-18 — Generator fabricated a case-study dollar metric (job 12068): deterministic check + prompt fix

Owner shared job 12068 ("Google & Meta Ads Specialist — Local Services Lead Generation") with "analyse,
problematic to me" and no further guidance. The posting explicitly demanded "Actual cost-per-lead numbers
you can share from past local-service clients" and "Share one real example of a cost-per-lead result."

Comparing the shipped draft against `caseLedger.js`'s real `CASE_LEDGER` data found a real fabrication:
the final draft states "Started at **$4.20 cost per lead**" right next to the Atlant case — but Atlant's
real, approved metrics are only `+56.5% conversions / -31% CPC / +144% clicks`, no dollar figure at all.
The pre-rewrite draft had the same failure on a different case: "$142 cost per qualified job booking" /
"$11 cost per conversion" attributed to FridgeFix, whose real metrics are `-92% cost per conversion /
+1,405% conversions / $1.71 CPC` — none of which is $142 or $11. In both cases the client's explicit
demand for a specific number *type* (cost-per-lead, in dollars) pressured the model into inventing a
number in that unit rather than reporting the real metric in whatever unit the case actually has.

Owner confirmed ("yes") building a deterministic check for this exact pattern — "a dollar figure stated
near a case name that isn't a verbatim match to that case's approved metrics" — plus a prompt fix for
handling "the client wants a number we don't have" honestly.

**Implemented** (`frontend/src/components/JobDetail.jsx`, inside `generate()`):
- New system-prompt section, "WHEN THE CLIENT ASKS FOR A SPECIFIC NUMBER TYPE A CASE DOESN'T HAVE,"
  inserted right before the existing "NO FABRICATED DIAGNOSIS" rule. States the job-12068 finding
  verbatim (both fabricated figures, both real metric sets) and the rule: case metrics are fixed data,
  never estimated/converted/back-calculated into whatever unit the client asked for; a real metric in
  the wrong unit (e.g. a percentage when they asked for a dollar figure) is honest and defensible, a
  fabricated dollar figure that matches the ask is not and collapses the moment the client asks how it
  was calculated.
- New deterministic check, `fabricatedCaseMetric` / `_fabricatedCaseMetricInfo`: splits the draft into
  paragraphs, and for any paragraph that mentions a `CASE_LEDGER` case's name, extracts every `$` figure
  in that paragraph and flags any that isn't a verbatim substring of one of that case's real metrics.
  Deliberately scoped to same-paragraph so unrelated dollar figures elsewhere in the letter (the flat-fee
  quote, the retainer range) never false-positive just because a case name appears somewhere else in the
  letter — those always live in their own paragraph, never share one with a case-study mention.
- Wired into all 4 standard sites: the `draftCompliant` gate, the `_recordViolations` telemetry array,
  the `[Falcon] Rule pre-check` console log, and the enforcer's `specificViolations.push(...)` message
  (mirrors the `caseMislabeledAsSaas` block immediately above it) — the enforcer message hands the model
  the exact fabricated figure(s) and the case's real metrics list, with an explicit instruction to state
  the real metric in its real unit rather than removing the case entirely.

**Verified**: `npx esbuild --jsx=automatic --bundle=false` on the full file (clean). A 6-case standalone
Node script in the scratchpad directory, copying the exact check logic, covering: job 12068's real
Atlant/$4.20 text (flags), the earlier FridgeFix/$142/$11 draft text (flags), FridgeFix citing its own
real $1.71 CPC (does not flag), a case name in one paragraph with unrelated $ figures (flat fee, retainer)
in a separate paragraph (does not flag), no case mentioned at all (inert), and House Painting citing its
own real $140 metric (does not flag) — 6/6 passed.

**Revert:** one isolated commit touching only `JobDetail.jsx` (prompt section + one new check + 4 wiring
sites) — `git revert <this-commit-hash>` removes the check and prompt section cleanly, no other files
touched.

---

## 2026-08-19 — Antifab system audit (item 1 of 3): flipped GC_ENFORCE after fixing 2 real bugs

Owner asked whether the rule-violation collection system had been running long enough to audit and
act on. Pulled the real numbers: 946 total telemetry events, 151 distinct jobs, Jul 27 - Aug 19
(3.5 weeks) — a real sample, not thin. Owner: "let's do all of them in order," starting with the
most concrete open item: `GC_ENFORCE` (Step 21-B grounding checker) had been shadow-only since it
shipped, the original "flip after the soak + check-in" question never revisited.

**Case for flipping:** 60 grounding-checker events across ~35 jobs, still firing weekly. Strongest
evidence: job 12068 (Aug 18) — `metricNotInLedger` fired in shadow mode on a fabricated `$4.20 cost
per lead` claim the SAME DAY another session had to hand-discover that exact fabrication and build
a brand-new check (`fabricatedCaseMetric`) to catch it going forward. The shadow checker had
already caught it independently; shadow mode just never acted on what it found. That's the concrete
cost of staying in shadow mode indefinitely.

**Before flipping, built a real test harness (Node, ESM, importing the actual modules) and found 2
bugs that shadow mode could never have surfaced** — shadow never exercises the `enforce:true` code
path at all, so these were latent since the file was written:

1. **Attachment-label fix fired on every case paragraph with a label, not just wrong ones.** The
   gate was `enforce && (pdfN + phN) > 0` — true for nearly every case paragraph, since they always
   carry a label. Flipping GC_ENFORCE as-was would have silently rewritten every letter's case
   labels, including fully correct ones. Also left a stray space behind ("Name (label) :" instead
   of "Name (label):") because stripping the old label consumed the parenthetical but not the space
   before it. Caught by testing a zero-violation letter and finding `output === input` failed
   anyway — the tell that something was firing when nothing should have been.
2. **metricNotInLedger / marketNotInPosting enforcement bare-deleted just the fabricated token**,
   leaving a glaringly broken fragment: `"Started at cost per lead, then optimised targeting."` /
   `"launch campaigns in [market] and expand to the [market] market"`. A visible gap or literal
   `[market]` bracket in a sent proposal is an obvious auto-generation tell — arguably worse than
   the fabrication it replaced.

**Fix for #2** (the substantial part): added `_removeEnclosingSentences()`, a decimal-safe
sentence-boundary helper (`.!?` counts as a sentence end only when followed by whitespace + an
uppercase letter or end-of-string — so real metrics like "693.8%" are never mistaken for a
boundary, since "8" isn't uppercase). Both `metricNotInLedger` and `marketNotInPosting` now collect
violation spans first without mutating text, then remove the full enclosing sentence(s) via this
shared helper — the letter loses one sentence and reads naturally instead of showing a repair scar.
Also: if sentence-removal happens to empty a paragraph out entirely (the fabrication was that
case's only sentence), the paragraph is dropped from the joined letter rather than left as an
orphan blank line; and the label-fix now checks the case name still exists in the paragraph before
trying to re-label it (in case sentence-removal deleted it).

**Verified** with a 7-case pass/fail suite run against the actual applied file (not a scratch copy):
clean fully-grounded letter → byte-identical + zero violations; a job-12068-style fabricated dollar
figure → sentence cleanly removed, no dangling fragment; decimal-heavy real metrics (693.8%, 17.51
ROAS, etc.) → completely untouched, confirming the boundary detector doesn't false-split on
decimals; a fabrication that's a case paragraph's ONLY sentence → paragraph dropped entirely, no
orphan blank line, surrounding paragraphs correctly rejoined; wrong attachment label → fixed to the
correct one with no stray space; unauthorized market claim → whole sentence removed, no `[market]`
placeholder; `caseDuplicated` → confirmed still flag-only (dedup handled elsewhere, unchanged
behavior). All 7/7. Also re-confirmed `seoAuditTurnaround` still fires correctly and doesn't
false-positive on the legitimate PPC 1-working-day audit (unchanged code path, regression check
only). `npm run build` clean throughout.

**Flipped `GC_ENFORCE = true`** (frontend/src/components/JobDetail.jsx). The generator now actively
strips/reverts untraceable case metrics, mislabeled/duplicated attachment labels, and unauthorized
market claims instead of just logging them — closing exactly the gap that let job 12068's
fabrication ship in the first place.

**Revert:** to go back to shadow mode, set `GC_ENFORCE = false` in JobDetail.jsx (one line) — the
two bug fixes in `groundingCheck.js` are safe to keep either way, they only change behavior when
`enforce:true` is actually invoked.

Items 2 and 3 of the owner's audit (the still-high-frequency auto-corrected patterns, and the
"wrong case chosen" manual-flag cluster) are next.

---

## 2026-08-19 — Antifab audit (item 2 of 3): system prompt was telling the model to do the WRONG thing

Investigated the 3 patterns firing at high frequency despite already being auto-corrected
(`caseHighlightsInlineLabel` 98 total/25 in the last 7d, `caseLeadInHadAttachmentLabel` 62/22,
`coverHasTimeline` 81/19). Found the root cause for the top two — and it's not a prompt-adherence
problem at all.

**The generator's system prompt directly contradicted its own deterministic post-processing
code**, in at least 4 separate places: the case-study formatting intro, PATTERN A's example,
PATTERN C's example, the RULES list, the pre-emit RULE COMPLIANCE GATE checklist, AND the
enforcer's own `missingHighlightsPhrase` rewrite instruction — all of them told the model
"'attached in profile highlights' goes ONCE in the lead-in sentence, never after individual
entries." But the actual deterministic code (`_ensureCaseStudyHighlightsLeadIn`, fixed earlier this
session for job 9995) enforces the OPPOSITE convention: the label belongs on EACH case entry,
lead-in stays plain. The model was reading its own instructions correctly and writing exactly what
they said — the instructions were just stale, left over from before that convention changed.
Worse: the enforcer's OWN "fix this" message for a formatting violation was telling the model to
re-produce the wrong pattern while "fixing" it, which likely explains why this specific pair of
checks has such high volume — even the correction path reinforced the bug.

**Fixed** (JobDetail.jsx, generator system prompt): updated every location to match the actual
enforced convention — plain lead-in, per-entry label. Added an explicit WRONG/RIGHT contrast
example (previously only the "crammed cases in one sentence" mistake had one) since this is now
confirmed the single most common formatting miss. Also fixed the RULE COMPLIANCE GATE's own
pre-emit self-check items, which had the model verifying compliance against the WRONG rule.

**`coverHasTimeline` (81/19)**: checked for the same kind of contradiction and didn't find one —
the detection regex is already thorough (11 distinct patterns covering "week 1", "phase 1",
turnaround-in-N-weeks phrasing, etc.) and correctly gated off when the client explicitly asked for
a timeline. This looks like a genuine prompt-adherence gap (the model volunteers scheduling detail
it wasn't asked for, despite explicit rules against it) rather than a fixable contradiction — left
as-is rather than force a fix without a clear root cause. It's reliably auto-corrected either way.

No new deterministic logic in this change (pure prompt text, realigned to match code that was
already tested extensively this session) — verification is `npm run build` clean plus a careful
re-read of every edited location for consistency, rather than a Node test harness (nothing new to
unit-test; the target behavior is the code's existing, already-verified convention).

Item 3 (the "wrong case chosen" manual-flag cluster) is next.

---

## 2026-08-19 — Antifab audit (item 3 of 3): the "wrong case chosen" manual-flag cluster

Investigated all 4 case-selection-related manual flags (`totally_wrong_cases_choice`,
`attached_only_one_case_study_and_not_the_best_relevancy`, `how_are_those_cases_multimarket`,
`fridge_fix_is_a_wrong_choice_here`). First check: 3 of the 4 happened Aug 15-18, AFTER the recent
case-selection fixes (off-vertical padding fix Aug 13, vertical-filter portfolio blocks Aug 10,
case-vertical false negative fix Aug 9) — so this cluster is confirmed still-live, not stale
history from before those landed.

Pulled the actual job + saved-letter content for the 3 jobs still in the DB (job 11746, the
`totally_wrong_cases_choice` flag, has since been pruned by the retention policy — unrecoverable):

- **Job 12064** (`fridge_fix_is_a_wrong_choice_here`) — kids-luggage Shopify ecommerce brand. The
  currently-saved letter cites Skin Reboot, not FridgeFix — consistent with the case having been
  corrected in a later regeneration than whatever draft got flagged. Can't confirm with certainty
  the current state is representative of what was flagged (no snapshot of the flagged text — see
  note below), but nothing currently wrong to fix here.
- **Job 12038** (`attached_only_one_case_study_and_not_the_best_relevancy`) — the currently-saved
  letter has 3 cases (Skin Reboot, ChronoCash, Nectar Flowers), not 1, so the specific "only one"
  complaint no longer matches the saved state either. Whether 3 generic-ecommerce cases with no
  clearly differentiating dimension between them is "the best relevancy" is a judgment call, not a
  clear-cut bug — noting it, not chasing further without a sharper signal.
- **Job 12008** (`how_are_those_cases_multimarket`) — CONFIRMED, current, and root-caused. Job
  explicitly requires Dutch/English/French/German market work. The letter cites Skin Reboot +
  ChronoCash — neither demonstrates multi-market work at all. Multilingual Site (bilingual
  Italian+German, 17,100 new monthly visits) is the one ledger case that actually proves this
  dimension — and it was never used, because it's tagged as an SEO case and the existing "NEVER
  cite an SEO-only case study in a PPC proposal" channel rule blocks it outright, even though the
  job's core need here is the multilingual DIMENSION, not the channel.

**Fixed**: added a narrow, explicit exception to the channel-matching rule — when a posting
explicitly requires multi-language/multi-country work as a core requirement (not just background
"we're international" color), Multilingual Site may be cited as SUPPORTING proof of the
multi-market methodology even on a PPC job, bridged explicitly ("same multi-market discipline...
applied here to PPC"), and only ever supplementing a real PPC case lead, never substituting for
one. `npm run build` clean.

**Process gap noticed while investigating** (not fixed this session — flagging for later): manual
flags via the 🚩 button record only `{job_id, check_name, timestamp}`, no snapshot of the letter
text that was actually flagged. Reconstructing "what did the letter say when this was flagged" for
2 of the 4 jobs above required guessing from the CURRENT saved state, which may already differ from
what triggered the flag (as it evidently did for at least the FridgeFix and single-case flags), and
1 job was unrecoverable entirely once pruned. The `preEnforcerDraft` snapshot mechanism built
earlier this session (job 10312 review) is a direct precedent for the right fix — capture the
letter text at flagging time, not just the tag — but scoping and building that is left for next
time rather than expanding this session's audit further.

**Summary of the full 3-item audit**: (1) GC_ENFORCE flipped after fixing 2 real latent bugs the
shadow soak couldn't have surfaced; (2) generator system prompt was contradicting its own
case-label convention in 6 places, now realigned — should measurably cut the two highest-frequency
violations in the whole telemetry set; (3) the case-selection manual-flag cluster is partially
already resolved by recent fixes, with one confirmed, root-caused, and fixed gap (multi-market
case bridging) and a process improvement identified for making future manual flags self-documenting.

## 2026-08-19 — Extension bug: hourly auto-sync was stealing focus during active work

**Symptom** (owner report): "sync tabs are opening not on the background - force switching me" —
the unprompted hourly messages-sync (`_SYNC_ALARM_NAME` in `background.js`) opens its tab as
`active: true` (required since the Aug 18 fix — background tabs get throttled by Chrome and silently
lose most replies). But that means every hourly tick yanks the owner's focus away from whatever
they're doing, unconditionally, forever. The manual sync button doing the same thing is expected
(user-initiated); the unprompted hourly one doing it is not.

**Fix**: gated the hourly tick (not the manual button) on `chrome.idle.queryState()`. If the owner
is active at the keyboard, defer instead of syncing — schedule a 5-min retry via `chrome.alarms`
rather than syncing immediately. Once idle, or once 30 minutes of continuous activity have elapsed
(so replies never go stale waiting for idle that may never come), sync anyway. The defer start-time
is persisted to `chrome.storage.session`, not a plain JS variable — same durability pattern as
`_persistSyncTab`/`_persistAhrefsPending` — because the MV3 service worker sleeps between
`chrome.alarms` ticks and an in-memory value would silently reset to null on every check, making
the 30-minute cap never actually trigger. New permission `"idle"` added to `manifest.json`
(bumped to v4.8).

**Verified before shipping**, following this session's established pattern of not trusting an
untested code path (the same category of bug that bit `GC_ENFORCE` earlier today): built a
standalone Node harness (`idle_gate_test.mjs`) simulating the exact `_maybeStartSync` logic against
a mock `chrome.storage.session`/`chrome.idle`/clock, with 5 tests / 8 assertions covering
idle-immediate-sync, active-defers-no-sync, active-for-25-min-then-goes-idle, the 30-minute
forced-sync cap while STILL active (the durability-critical case), and fresh-tick-resets-the-clock.
One real bug found via the harness: `const elapsedMin = deferredSince ? (...) : 0` treated a
legitimate `Date.now()` value of exactly `0` as "unset" (JS falsy-zero) — couldn't actually manifest
in production since real `Date.now()` is never `0`, but tightened to an explicit
`deferredSince != null` check anyway since it removes the footgun for free. All 8 assertions pass
against the applied file. Manual sync button path (`SYNC_PROPOSAL_STATUSES` handler) deliberately
left untouched — still opens active immediately, no idle-gating, since that's user-initiated.

## 2026-08-19 — Digit Bomb rewrite pass stacked two case studies instead of just the armed one

**Symptom** (owner report, job 12185, shared via `share-with-claude.md`): "the idea of a digit
bomb is to place a chosen case in the intro, but briefly, and just the selected one. Here generator
placed both." Vape Shop was armed as the cold open; the final letter opened with Vape Shop
correctly — followed immediately by a second full case-study paragraph for Derma Solution.

**Root cause, found by diffing the `preEnforcerDraft` snapshot against the final text**: the first
pass opened with Derma Solution (missed the digit-bomb requirement entirely). The
`missingDigitBombFacts` pre-check correctly caught that and fired the Claude enforcer. But the
enforcer instruction only said "REWRITE the opening (first 1-2 sentences)... Leave the rest of the
letter untouched" — ambiguous when the existing "rest of the letter" starts with a whole wrong-case
paragraph. The model played it safe and PREPENDED a new Vape Shop paragraph ahead of the old Derma
Solution one instead of replacing it. Neither `missingDigitBombFacts` nor any other pre-check
verifies that the digit-bomb case is the ONLY case in the opening — it only checks that the armed
case's own name+metric are present and correctly ordered, so this slipped through undetected.

**Fixed at both levels** (this project's now-standard move — prompt text alone has proven
unreliable all session):
- Enforcer instruction tightened: explicitly told to REPLACE an existing wrong-case opening
  paragraph, never prepend on top of it — "the result must have exactly ONE case-study paragraph
  at the top of the letter, never two stacked back to back."
- New deterministic backstop, `_stripDigitBombDuplicateCase()`: locates the armed case's own
  paragraph within the first two paragraphs (it isn't always paragraph 0 — a short bridging
  lead-in sentence can precede it, confirmed in the actual job-12185 text), and if the paragraph
  immediately after it names a DIFFERENT ledger case, drops that duplicate paragraph. Wired into
  both post-processing chains (the enforcer path and the "draft already compliant, skip the
  enforcer call" fast path). Scoped tight to the immediately-adjacent paragraph only — the design
  already allows a genuinely different case cited later in the letter's own case-study block
  (explicitly "zero additional case studies is fine too"), and that's left untouched.

**Verified** with a standalone Node harness against the real `caseLedger.js` and the actual
job-12185 repro text: strips the duplicate correctly whether or not a bridging lead-in precedes the
digit-bomb paragraph, no-ops when the draft is already clean or digit bomb isn't armed, and — the
important negative case — leaves a legitimately later, non-adjacent second case study untouched.
`npm run build` clean.

## 2026-08-19 — Same job (12185): generator silently dropped an inline screening question

**Symptom** (owner, same `share-with-claude.md` share): "looks to me that generator ignored
screening questions." The posting's own "Screening questions" section (plain text in the job
description, no attachment) asked 4 things: (1) regulated-category experience, (2) advertised into
Australia/UK/EU, (3) cross-domain conversion tracking, (4) comfortable with client owning the Ads
account. The final letter answered (3) and (4) directly in their own sentences, and implied (1)
through the case studies — but (2) was never addressed anywhere in the letter.

**Root cause**: not a compliance failure — there was no rule to fail. Grepped every "screening
question" reference in the generator prompt: one covers questions inside an ATTACHED file, the
other covers questions a client pastes separately into chat (`addlQMode`). Neither one covers
questions that are already sitting in the job posting's own description text, which is exactly
this job's shape and a very common Upwork posting pattern generally.

**Fixed**: added an explicit rule for that third, previously-uncovered case — address every inline
screening question somewhere in the letter, via a case study for experience questions or a direct
sentence for fact questions a case study can't answer (market/geography, tools, arrangement — same
treatment already given billing/tracking questions when asked directly). Kept the existing
fabrication-avoidance carve-out: skip only a question whose true answer is a fact solely Artem would
know and isn't in the KB.

**Scope call**: unlike the Digit Bomb bug earlier today, no deterministic backstop added. That fix
targeted a proven prompt-adherence failure (the model was told the right thing and still got it
wrong) where a regex-based check was reliable to write. This one is a genuine open-ended semantic
coverage question — "was this question addressed" isn't reliably checkable by keyword/regex without
real false-positive/false-negative risk, and there's no telemetry yet showing the model still misses
this after actually being told. Shipping the instruction alone and watching for recurrence is the
right-sized fix for now; a deterministic check becomes worth building only if this keeps happening
post-fix. `npm run build` clean.

## 2026-08-19 — Chat-based letter edits were bypassing almost every rule-compliance check

Owner reported the "other instance" session's recent quality fixes (GC_ENFORCE flip, Digit Bomb
dedup, case-label convention fix, etc. — commits `b8ecf2f` through `6d01192`) weren't visibly
improving anything: still seeing rule violations and unrelated case-study choices in real output.

Investigated by pulling the actual **sent** proposal for job 12185 straight from the `proposals`
table (`status='sent'`, not the UI) rather than trusting a share snapshot. What actually reached the
client:
- A numbered "1. / 2. / 3. / 4." screening-question list — the listy-outline anti-pattern the rules
  exist to prevent.
- **Five** distinct case studies stacked into one letter (Derma Solution, Vape Shop, Skin Reboot,
  ChronoCash, Atlant) — one per screening question, read as a portfolio dump.
- A `share-with-claude.md` snapshot taken ~24 minutes *before* the actual send showed a cleaner,
  flowing, 3-case version — whatever cleanup happened in chat never made it into what got pasted into
  Upwork. Inside that snapshot, the enforcer pass itself had also flipped a *correct* "5 working days"
  (first-pass draft, matching the launch-job rule) into an *incorrect* "1 working day" (audit-only
  timing) — a real regression, not a model error.

Root cause, traced through the code: `InlineChat`'s direct chat-editing path
(`onProposalRewrite` → `setProposal`, `JobDetail.jsx` ~line 3177) ran only ~11 lightweight
formatting-cleanup functions and completely skipped the `draftCompliant`/enforcer gate (40+ checks),
`groundingCheck`/`GC_ENFORCE`, and `_stripDigitBombDuplicateCase`. Only the explicit "↺ Rework letter"
button routes back through `generate()` and gets the full pipeline. Every fix landed this session
(this session's and the other instance's) only ever fires on that one button; natural back-and-forth
chat editing — confirmed to be how job 12185 was actually edited ("embedd all this in the text") — was
completely unguarded.

Separately, in `groundingCheck.js`: `caseDuplicated` (same case cited twice) already existed, but
nothing capped the *number of distinct* cases in one letter — exactly the failure mode that put five
cases into job 12185's letter, one per screening question.

**Implemented**:
- `frontend/src/lib/groundingCheck.js`: new `tooManyCaseStudies` claim class — flags when a letter
  names more than 2 distinct `CASE_LEDGER` cases (the existing documented design target elsewhere in
  the codebase: "the letter should end with at most 2 case studies for this job"). Shadow-only, same
  as `caseDuplicated` — deciding *which* case(s) to cut needs vertical-relevance judgment a regex can't
  safely make, so it flags to telemetry rather than blindly stripping (which could remove the one case
  that's actually on-point for this job).
- `frontend/src/components/JobDetail.jsx`: the proposal chat's `onProposalRewrite` callback now runs
  every chat-produced rewrite through `_gcShadow(text, job)` before it lands in the textarea — the
  same grounding-checker pass `generate()` already applies, now covering `metricNotInLedger`,
  `attachmentUnbacked`, `marketNotInPosting`, `caseDuplicated`, and the new `tooManyCaseStudies`,
  with `GC_ENFORCE=true` so the enforceable classes are actually stripped, not just flagged. Violations
  still land in the same `⚠ Top rule violations` telemetry regardless of which path (generate() or
  chat) produced them.
- Deliberately scoped OUT of this change: `_stripDigitBombDuplicateCase` was NOT wired into the chat
  path. It needs to know which case is "the digit bomb," and the only signal available outside
  `generate()` is the dropdown's `digitBombCaseId`, which persists after arming auto-disarms — using it
  would risk stripping an unrelated, legitimate second case paragraph just because that case happens to
  still be selected in the dropdown. Left for a future pass if this specific duplication resurfaces via
  chat.

**Verified**: `npx esbuild --jsx=automatic --bundle=false` on both files (clean). A 4-case regression
script in the scratchpad directory, run against the real `groundingCheck.js` (bundled with esbuild so
Node can execute its ESM imports directly, not a copy): the actual job-12185 sent text (5 cases) flags
`tooManyCaseStudies`, a clean 2-case letter does not, a single-case letter does not, and a
no-case-mentioned letter does not — 4/4 passed.

**Revert:** one isolated commit touching only `groundingCheck.js` (new check) and `JobDetail.jsx` (one
line, the `onProposalRewrite` wiring) — `git revert <this-commit-hash>` restores chat edits to
unchecked and drops the case-count check cleanly.

## 2026-08-19 — Architecture discussion: rule violations, growing cost, KB not helping — and two real fixes

Owner asked three connected questions: is there a more solid structure than regex whack-a-mole for
rule violations/fabrications; why does API cost keep growing (guessed: more KB data = more to scan);
and does the constantly-growing KB actually help letter quality.

Found that DESIGN.md §21 ("Anti-fabrication rearchitecture") already diagnoses exactly this, almost
verbatim — a ~40K-char prompt with 312 prohibitions where "rule #313 dilutes #1–312" — and lays out a
3-step fix (A: structured case ledger, done 2026-07-27; B: deterministic grounding checker, flipped to
enforce the day before this conversation; C: slim the prompt, blocked until B proves out). Reported
this to the owner along with real `token_usage` numbers: the generator's per-call cache-creation
tokens grew from ~3K (mid-May) to ~22K (this week) — a ~7x climb with no plateau — confirming the
"growing KB / growing cost" instinct with data, not vibes.

Owner said yes to two low-risk, non-prompt-rewrite fixes while §21-B keeps soaking: (1) cut redundant
KB-fed "case study menu" bloat, (2) wire up real Anthropic prompt caching. Both turned out different
from how they were pitched, in ways worth recording:

**(1) Turned out NOT to be bloat-cutting — it was a live fabrication source.** Checked the two KB
"reference template" entries fed into every generate() call as `referenceText` (never filtered by
job type, unlike `portfolioText` which already gets vertical-tag filtering via
`_filterCaseStudyBlocks`). KB entry #396 ("Upwork Prompt Gemini + template examples") had two real
data errors:
- `"Skin Reboot: ... scaled monthly revenue $12,000→$95,000 (693% increase), 17.51 ROAS."` — the exact
  fabricated dollar figure `JobDetail.jsx` already has a permanent regex backstop for
  (`fabricatedSkinRebootRevenue`, real: `+693.8% revenue` / `17.51 PMax ROAS`) — this single KB entry
  was almost certainly THE root source of that violation firing 32 times all-time, including as
  recently as the morning of this same conversation. The regex was catching the symptom every time
  without anyone ever fixing the source teaching it the wrong number.
- `"Ready for deep-dive audit (1 day), flat fee $200."` — the canonical audit price used everywhere
  else in the prompt is $300; this stale $200 could silently produce a wrong quote on jobs that
  happened to draw from this specific template example.
Fixed both via the app's own `PUT /kb/{id}` endpoint (not raw SQL) — pure data correction, zero
narrative lost, zero design tradeoff. Read the rest of both reference entries (#396, #419) end-to-end
looking for more of the same; found none. Did NOT do the originally-planned broad "cut old case-study
prose" — `portfolioText`'s source entries (#1, #518) turned out to carry real narrative detail (full
periods, secondary/highlighted-period metrics) beyond what `caseLedger.js`'s terse `metrics` array
holds, and are already filtered by vertical — cutting them further risked losing real specificity for
a smaller, less certain win than the two verified data bugs above.

**(2) Turned out prompt caching already existed (`api/main.py`, present since the initial commit) —
it just never got a cache HIT.** The `/claude` proxy already split the system prompt and added
`cache_control: {type: "ephemeral"}` to the static portion. The bug: the split point (`"\n\nARTEM'S
ADJUSTMENTS"` or `"\n---\n"`) sat almost at the END of the ~72K-char prompt, but `kbRulesText` (KB
rules filtered per job by `rulesForGenerator(allRules, genScopes)` — different set for every job
vertical) and `_digitBombCase` (only present when armed) were interpolated right after the FIRST
sentence of the prompt — i.e., inside what the split logic treated as the cacheable "static" prefix.
Since Anthropic's cache match requires an exact byte-for-byte prefix, and that prefix diverged within
the first few hundred characters on almost every call (different job → different matched rules), the
cache was being re-created from scratch on nearly every single call, paying the 25% write surcharge
with virtually no offsetting 90%-off reads — exactly matching the `cache_read_input_tokens ≈ 0` /
`cache_creation_input_tokens` climbing-every-week pattern found in `token_usage`.

**Fix:** moved `kbRulesText` and the Digit Bomb block (previously lines ~5739–5774, right after the
opening sentence) down to immediately before `${portfolioText}` — i.e., AFTER the entire ~400-line
static rule/pattern wall instead of before it. Reworded 3 phrases that referenced rule position
("override every instruction below" → "above", "opener rules below" → "above", "per the rules below"
→ "above" — since the static wall these phrases point to now precedes them instead of following).
Inserted an unconditional literal marker, `=== JOB-SPECIFIC CONTENT (uncached) ===`, right at the new
boundary — present on every call regardless of whether KB rules or Digit Bomb are active, so the
backend always has a reliable split point. Updated `api/main.py`'s split-priority list to check this
marker FIRST (highest priority), before the existing `ARTEM'S ADJUSTMENTS`/`---` checks.

**Verified end-to-end with real API calls** (not just static analysis): extracted the actual ~72K-char
static block from the live prompt (confirmed zero `${...}` interpolations remain in it — genuinely
job-independent now), and fired two real `/claude` calls with that identical static prefix but
DIFFERENT (simulated) per-job dynamic suffixes, ~2 seconds apart. Call 1 (cold): `cache_creation_
input_tokens: 18117`, `cache_read_input_tokens: 0`. Call 2 (different simulated job): `cache_creation_
input_tokens: 0`, `cache_read_input_tokens: 18117` — a full cache hit across what the system treats as
two different jobs, which never happened before this fix (confirmed 13+ weeks of ~0 cache reads in
the historical telemetry). Also confirmed via `esbuild`/`py_compile` (both clean) and a Node check
that the static block contains zero remaining `${...}` markers, and that all four key strings
(`PRIMARY DIRECTIVE — KB RULES`, `DIGIT BOMB OPENER MODE`, the new marker, `PRIMARY WRITING
DIRECTIVE`) each appear exactly once — no accidental duplication or loss from the move.

**Scope note:** did not touch the enforcer pass (`proposal_rule_enforce`, `_kind`) — its system prompt
is a short fixed string well under the 4096-char cache-eligibility floor, so it was never caching
anything regardless; not part of this fix. Did not start §21-C's actual prompt-rule-count reduction —
that stays gated on §21-B's enforce soak per DESIGN.md's own acceptance bar.

**Revert:** one isolated commit touching `api/main.py` (marker priority) and `JobDetail.jsx` (block
move + 3 reworded phrases + new marker) — `git revert <this-commit-hash>` restores the old split
priority and the pre-move prompt order. The KB entry #396 data fix is a separate DB content change
(via `/kb/396`, not in git) — to revert, PUT the original `$12,000→$95,000 (693% increase)` / `$200`
text back (saved at
`C:\Users\syzov\AppData\Local\Temp\claude\...\scratchpad\kb396_original.txt` this session, not in the
repo).

## 2026-08-19 — Decision: hold §21-C, soak first

Discussed timing for §21-C (the prompt slim-down) right after the caching/KB-data fixes above landed.
Recommendation given: don't gate 21-C on a calendar date alone — two conditions first. (1) A real
stretch of clean `GC_ENFORCE=true` telemetry collected AFTER today's fixes (the chat-bypass and
caching bugs muddied the last day's readings, so the clock effectively restarts from today). (2) The
case-relevance pre-filter (using `CASE_LEDGER`'s existing `vertical`/`service` fields) needs to exist
first — §21-C's own plan replaces the 312 prohibitions with "structured inputs (ledger case list for
this job's domain)," and that pre-filter IS that structured input. Cutting the prohibition text before
it exists removes whatever guardrail currently exists for the biggest recurring manual-flag theme
(wrong/irrelevant case choice) with nothing built to replace it.

Owner chose to hold and let telemetry soak rather than start the pre-filter now. Recorded both gates
in DESIGN.md §21.10 so the next session (or a different account) doesn't need to re-derive this
reasoning — check the `⚠ Top rule violations (30d)` panel for a clean stretch since 2026-08-19, and
confirm the case-relevance pre-filter exists, before touching the prompt for 21-C. No code changed
this entry — documentation/decision only.

## 2026-08-20 — Bug: AI Analysis panel scroll kept snapping back to the top

Owner reported: scrolling down in the Analyser tab, after 1-2 seconds it jumps back up.

Reproduced live in the browser via a direct DOM scroll-monitor (set `scrollTop`, poll it every 300ms):
confirmed the AI Analysis panel's scroll position really was getting force-reset to 0 automatically,
roughly on the cadence of the existing 10-second job-list poll (`App.jsx` — `fetchSelectedJob` on an
interval). Compared two consecutive `/jobs/12185` responses 3 seconds apart — byte-identical, so the
job data genuinely wasn't changing.

Root cause: the analysis-hydration `useEffect` in `JobDetail.jsx` (the one that resets `scrollRef.
current.scrollTop = 0` on job change) listed `job?.last_analysis` in its dependency array. The backend
(`api/main.py`) does `json.loads(j.last_analysis_json)` fresh on every single request, and the
frontend does `.json()` on every fetch — so `last_analysis` is a brand-new object reference on every
10-second poll even when its content is byte-identical. React's dependency comparison is reference-
based for objects, so `Object.is(oldRef, newRef)` was always `false`, and the effect (including the
scrollTop reset) re-ran on every poll regardless of whether anything actually changed.

**Fix:** dropped `job?.last_analysis` from the effect's dependency array. The effect body still reads
its current value via closure when it DOES run — this only stops the object-reference from falsely
triggering the effect. `job?.last_analysis_at` (a stable string timestamp that only changes when a
NEW analysis is actually saved server-side) was already in the array and is the correct, sufficient
trigger. Added an inline comment + `eslint-disable-next-line` explaining the deliberate omission so a
future exhaustive-deps autofix doesn't quietly reintroduce the bug.

Checked the Proposal column's equivalent job-change reset effect for the same anti-pattern — it only
depends on `[job?.id]`, so it was never affected; this bug was isolated to the Analyser panel exactly
as reported.

**Verified**: `npx esbuild --jsx=automatic --bundle=false` clean. Live before/after test in the running
app: set the AI Analysis panel's `scrollTop` to 200 and polled it every 300ms. Before the fix, it held
for ~5 readings then dropped to 0 (mid-poll-cycle). After the fix, it held at 200 for a full 12-second
window (spanning a complete 10-second poll cycle) with zero resets. No new console errors introduced.

**Revert:** one isolated one-line dependency-array change (plus a comment) in `JobDetail.jsx` — `git
revert <this-commit-hash>` restores the old (buggy) dependency array.

## 2026-08-20 — Bug: enforcer pass nested a duplicate attachment label on the Digit Bomb opener

Owner shared job 12388's snapshot flagging garbled text: "(attached as PDF), attached as PDF) - issue".
The real text (share-with-claude.md): first-pass draft correctly opened "...(Skin Reboot, attached as
PDF) - that jump came from..."; after the rule-compliance rewrite, the SAME sentence read "...(Skin
Reboot (attached as PDF), attached as PDF) - that jump came from..." — the enforcer introduced a
nested, duplicated label the first pass never had.

Traced why the existing `_stripDuplicateAttachmentLabel` cleanup (which already handles several
duplicate-label shapes) didn't catch this one: its "same phrase twice inside ONE parenthetical" step
matches `/\(([^()]*)\)/g` — content with NO parens allowed inside. Given `(Skin Reboot (attached as
PDF), attached as PDF)`, that regex can only ever match the INNER `(attached as PDF)` — a `(` sitting
right after "Skin Reboot" makes it impossible for `[^()]*` to ever reach the outer parenthetical as one
unit, so the outer nesting was invisible to every existing dedup step (all of them are non-nesting by
construction, deliberately, to avoid false positives on complex text — this shape just fell outside
their scope entirely).

**Fix:** added a new step (0b) to `_stripDuplicateAttachmentLabel` — a targeted regex specifically for
`(<name> (<attach phrase>), <attach phrase>)`, collapsing it to `(<name>, <attach phrase>)`. Doesn't
attempt general nested-paren parsing (unnecessary and riskier); scoped narrowly to this exact shape,
consistent with the file's established discipline of narrow, false-positive-safe patterns over
clever general-purpose ones.

**Verified**: `npx esbuild --jsx=automatic --bundle=false` clean. A 5-case Node regression script:
the real job-12388 garbled text (collapses correctly to the clean first-pass form), a profile-
highlights variant of the same nested shape, a clean single-label sentence (unchanged), a clean
case-study block label (unchanged), and no-case-mentioned text (inert) — 5/5 passed.

**Revert:** one isolated addition (a new regex + one `.replace()` call) inside
`_stripDuplicateAttachmentLabel` in `JobDetail.jsx` — `git revert <this-commit-hash>` removes step 0b
cleanly, no other steps touched.

## 2026-08-20 — Unprompted messages-sync tab-switch still bothering the owner: moved to an unfocused window

Owner: "sync is forcing the tab switch again" — after the 2026-08-18 fix (messages leg opens
`active:true`, restores focus once done) and the 2026-08-19 idle-gating fix (defers the hourly tick
while the owner's at the keyboard, forces anyway after 30 min so replies don't go stale), the owner
was still hitting a real, visible tab-switch — almost certainly the 30-min forced-sync case, since the
idle-gating code's own comment already says this exact tradeoff was "confirmed by the owner" as
disruptive once before. Clarified with the owner: they don't mind sync firing as often as it wants —
they specifically don't want to ever be switched away from Falcon Scout's own window, for ANY sync
(hourly or manual).

**Implemented**: the messages-sync leg now opens in its own **unfocused, off-screen browser window**
(`chrome.windows.create({ focused: false, left: -3000, top: -3000, ... })`) instead of as the active
tab of the current window. `focused: false` means it never takes OS input focus — Falcon Scout's own
window stays exactly where the owner left it, both visually and for keyboard/mouse focus. Off-screen
positioning means even though the window technically exists and isn't minimized, it never appears
on any real monitor. Applied to both the hourly auto-sync (`_startSync`) and the manual "Sync from
Upwork" button (`SYNC_PROPOSAL_STATUSES`) via one shared helper, `_openMessagesSyncWindow()`. Removed
the now-unnecessary `_msgTabPrevActive` focus-restore machinery entirely (three call sites) — there's
no focus to restore when none was ever taken. The proposals-list leg is untouched, unaffected, stays a
plain background tab as before (it was never implicated in the tab-switch complaint).

**Honest caveat — this is UNVERIFIED against a real Upwork session.** The entire reason the messages
leg was made `active:true` in the first place (2026-08-18) was a confirmed real bug: background TABS
get throttled by Chrome hard enough that the room-walk's job-link lookup found 0/10 links. Whether the
active tab of a separate, *unfocused* window gets the same throttling treatment as a background tab
within the *focused* window is a genuine Chrome-internals question this session's tools can't test —
that needs the owner's real Chrome + real Upwork login. `node --check` passes and the logic is sound,
but the one thing that actually matters (does the room-walk still find real job links) can only be
confirmed live. **After reloading the unpacked extension (manifest bumped to 4.9) and letting a real
sync run** (hourly, or click "Sync from Upwork"), check `messages_sync_debug.json`'s
`walk_info.links_found` — if it's back to 0/N, the off-screen-window approach doesn't dodge the
throttling and this needs a different fix (possibly accepting the original brief-flash tradeoff, or
finding another way to keep the tab genuinely "visible" from Chrome's perspective without covering the
owner's screen).

**Revert:** one isolated commit touching only `upwork-enricher/background.js` and `manifest.json`'s
version bump — `git revert <this-commit-hash>` restores the active-tab-with-focus-restore behavior.

## 2026-08-20 — Enforcer regression, confirmed a SECOND time: "5 working days" flipped to false "1 working day"

Owner shared job 12392 ("Google Ads" — Swiss client, from-scratch setup + launch). Pre-enforcer draft
correctly closed with "campaigns live and approved within **5 working days**" (Rule 450 — this is a
launch-from-scratch job, no existing account). The rule-compliance enforcer's rewrite — fixing some
other, unrelated listed violation — silently swapped it to "within **1 working day**", the Google Ads
*audit* turnaround, which is false here since there's no account to audit.

This is the exact same enforcer-overreach pattern found this morning on job 12185 (investigated during
the "why isn't quality improving" aggregate review) — but that one was traced to a different bug (the
chat-rewrite bypass, since fixed). This one is different: it happened inside `generate()`'s own
enforcer call, the fully-instrumented path that already has a whole family of "MUST-KEEP" regression
guards (`_regressedAuditPrice`, `_regressedComplimentary`, `_addedWrongLaunchOffer` — all built after
job 10609 taught this codebase that the enforcer can silently destroy correct content while fixing an
unrelated violation). None of those existing guards covered THIS specific regression shape — they
watch pricing and launch-offer additions, not the launch-timing phrase itself. Two independent real
occurrences (12185, 12392) of the identical "5 days → false 1 day" swap is enough to call this a
confirmed, recurring failure mode rather than a one-off, matching this codebase's own standing bar for
promoting a pattern from "noticed" to "worth a deterministic guard."

**Fix:** added `_regressedLaunchTiming` to the same guard chain, following the established pattern
exactly: reuses the existing `campaignLiveTooFast` detection regex (the same one already used to catch
this claim when the FIRST pass makes the mistake), but applied comparatively — pre-enforcer snapshot
did NOT have the false claim, post-enforcer text DOES — so it only fires on the *regression* case, never
on the case where the enforcer is legitimately asked to fix a real first-pass violation. When it fires,
the whole enforcer rewrite is discarded and the pre-enforcer draft is kept, same as every other guard
in this chain.

**Verified**: `npx esbuild --jsx=automatic --bundle=false` clean. A 6-case Node regression script:
both real confirmed regressions (job 12392's and job 12185's actual text, both correctly flagged),
the enforcer legitimately fixing a real "1 day" mistake into the correct "5 days" (correctly NOT
flagged — the guard must never block a genuine fix), pre/post both already correct (inert), a
non-launch job with the pattern present (inert — gated on `jobIsPaidLaunch`), and unrelated text with
no campaign-live claim at all (inert) — 6/6 passed.

**Revert:** one isolated addition (a new regex + boolean + one `else if` branch) inside the enforcer
guard chain in `JobDetail.jsx` — `git revert <this-commit-hash>` removes it cleanly, no other guards
touched.

## 2026-08-20 — Usage counter: calendar-day reset instead of rolling 24h, plus a real backend outage mid-fix

Owner: after checking the header cost chip, wanted the "24h" window to reset at local midnight (owner's
own example: "00:00 Thursday... until Friday 00:00 comes") instead of being a rolling lookback that
drifts forward every second.

**Implemented** (`api/main.py`): `/usage-stats`'s "24h" cutoff is now the start of the owner's current
calendar day in `Europe/Kyiv` (via `zoneinfo.ZoneInfo`, DST-aware), not `now - timedelta(hours=24)`.
Converts `now` to Kyiv local time, zeroes the clock, converts back to UTC for the DB comparison (`ts` is
stored as UTC throughout, same convention `cutoff_month` already uses — left unchanged, still UTC-based
calendar month, owner didn't ask to change that one). Frontend label changed from "24h" to "today" in
both the collapsed chip and the expanded per-kind breakdown (`App.jsx`) — the underlying response key
(`last_24h`) and internal variable names were left alone to keep the change scoped to what actually
needed to change.

**A real dependency gap found and fixed along the way:** Python's `zoneinfo` needs the IANA tz database,
which Windows doesn't ship — needs the `tzdata` PyPI package. It's a pure-Python data package (no
compiled deps), added to `requirements.txt`. Confirmed via `netstat`/PowerShell which of the two Python
installs on this machine (`C:\Python314\python.exe` vs a separate `pythoncore-3.14-64` alias that
`python3` resolves to in this session's shell) is the one ACTUALLY running the backend (PID owning port
8000) before trusting any test result — `tzdata` was already present for the real one, absent for the
other. Verified the boundary logic with 5 cases (summer/DST, winter/no-DST, just-after-UTC-midnight,
and both sides of the exact local-midnight boundary) — all correct.

**A real backend outage happened during this fix, unrelated to the timezone logic itself** — after
saving the `api/main.py` edit, uvicorn's `--reload` picked it up but the server went completely
unresponsive (every endpoint timed out, not just `/usage-stats`), while the OLD worker process
(PID 65116) stayed bound to the port without answering anything. A direct `python -c "import api.main"`
of the exact same code completed instantly with no error, so the hang was in uvicorn's reload
supervision, not the new code. Force-stopped the stuck process and started a fresh
`uvicorn api.main:app --reload --port 8000` — came up clean on the first try, immediately serving real
requests from the owner's own browser. Flagging this plainly rather than glossing over it: the app was
genuinely down for a few minutes during this change. If `--reload` hangs like this again after a save,
it's worth knowing this isn't a first occurrence.

**Verified**: live `curl` against the restarted backend confirms the new cutoff — total dropped from the
prior rolling-24h read (~$0.91, spanning back into yesterday afternoon Kyiv time) to ~$0.46 for
"today so far" (~16.5 hours elapsed since local midnight at the time of testing), consistent with a
calendar-day window being narrower than a rolling 24h one at that point in the day. Chip in the live
app renders "today $0.461 · mo $26.971" correctly. `npx esbuild` clean on `App.jsx`, `py_compile` clean
on `api/main.py`.

**Revert:** one isolated commit touching `api/main.py` (cutoff logic + comment), `App.jsx` (label text
only), and `requirements.txt` (`tzdata` addition) — `git revert <this-commit-hash>` restores the rolling
24h window and the old "24h" label. The backend restart is operational, not part of the diff — nothing
to revert there.

## 2026-08-20 — Real bug: CLI bridge crashed on Unicode in print(), root-caused to a stdout-reset in `watchfiles` reload — plus the `.venv` discovery

Owner screenshotted a live error: `CLI bridge failed (analysis): UnicodeEncodeError: 'charmap' codec
can't encode character '\u2192' in position 35`. Real, reproducible, not cosmetic.

**Root cause, in two parts.** (1) `api/main.py:5138` prints `f"[CLI bridge] {kind}: {len(prompt_text)}
chars → http://127.0.0.1:27182/ai"` — a literal Unicode arrow, not `->`. Windows' default console
codepage (cp1252/"charmap") can't encode it, and non-interactive Python processes (stdout piped/
redirected rather than a real console) default to that codepage. (2) The SAME arrow pattern also
appears in the proposal-status-promotion logging (`print(f"...promoted proposal {id} → {status}...")`,
lines ~3681/3701) — meaning this exact class of crash could have been silently affecting other features
too (e.g. reply-sync's status promotion), not just analysis.

**First fix attempt — `sys.stdout.reconfigure(encoding="utf-8")` at the top of `api/main.py`, before any
other import.** Verified instantly via a direct `python -c "import api.main; print('→')"` — worked
perfectly. Restarted the live backend the same way as an earlier fix today (bare
`C:\Python314\python.exe -m uvicorn api.main:app --reload`) — **the exact same crash still happened,
verified live against the running server.** Confusing: the fix worked standalone but not in the actual
process.

**Root-caused properly instead of guessing twice.** Tried `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8` env
vars — same crash, still. Isolated the variable by running the exact same code WITHOUT `--reload` —
and separately discovered, via `Get-Process python | Select Path`, that there is a **second, completely
separate Python environment** at `.venv\Scripts\python.exe` that `falconscout.bat` actually uses
(`.\.venv\Scripts\uvicorn`) — distinct from the bare `C:\Python314\python.exe` and from the
`pythoncore-3.14-64` alias found in an earlier session's investigation. Multiple processes from
different environments had been racing for port 8000 across several restart attempts today, which is
why `netstat`'s reported owning PID kept appearing stale/wrong (`Get-Process` on that PID returning
nothing) — a real Windows TCP-table quirk under this much process churn, not a tooling bug.

**The actual root cause**, once isolated: uvicorn's `--reload` has two reload backends — `watchfiles`
(used automatically if the `watchfiles` package is installed — it is, in the bare `C:\Python314`
environment) and a built-in `StatReload` fallback (used when it isn't — `.venv` doesn't have
`watchfiles`). `watchfiles`' subprocess-spawn model resets the worker's `sys.stdout` encoding back to
cp1252 on Windows regardless of what the module-level `reconfigure()` call does, silently undoing the
fix on every reload. `StatReload` does not have this problem. Confirmed directly: same code, same
`--reload` flag, `.venv`'s uvicorn (StatReload) → real CLI-bridge round trip succeeded; bare
`C:\Python314` uvicorn (watchfiles) → same crash every time.

**Fix, final state:** kept the `sys.stdout`/`sys.stderr` UTF-8 reconfigure in `api/main.py` (still
correct and harmless), installed `tzdata` into `.venv`'s own site-packages too (it only existed in the
two bare system Pythons before — `.venv` would have crashed on yesterday's timezone fix the moment
anyone ran the app through `falconscout.bat` as normally intended), and restarted the backend through
`.venv\Scripts\python.exe -m uvicorn` — matching how `falconscout.bat` actually runs it. Documented in
`CLAUDE.md`'s quick-start section so this isn't rediscovered the hard way again: **the backend must run
from `.venv`, not a bare system Python** — that's not a style preference, it's what avoids this exact
crash class.

**Honest accounting of the mess this session made along the way:** two more brief backend outages
happened during this investigation (killing/restarting processes while isolating the variable) — the
app came back up clean each time once the actual fix landed, but it was down intermittently for a
while during the debugging itself. Genuinely necessary given the crash was live and real, but flagging
plainly rather than glossing over the disruption.

**Verified**: live `curl` against the `.venv`-run backend with the exact arrow-containing payload that
crashed before — real successful response through the full CLI-bridge round trip (backend → cli-
bridge.js → `claude` CLI → response), confirming both the crash is fixed AND the CLI bridge itself is
genuinely working end to end. `/usage-stats` and the live app's chip both confirmed still correct
post-restart.

**Revert:** the `sys.stdout`/`stderr` reconfigure block in `api/main.py` is one isolated addition —
revertable on its own, though there's no reason to (it's inert and correct regardless of which reload
backend runs). The `.venv` `tzdata` install and the `CLAUDE.md` note aren't code changes to revert.

## 2026-08-20 — Fourth enforcer-overreach guard: client-mandated literal opener silently downcased

Owner shared job 12477 (UK agency, Google Ads). The posting has an explicit attention-check: "Start
your proposal with "I KNOW GOOGLE ADS" so we know you've actually read the job post." — a literal,
client-mandated verbatim string, not a style choice. The first-pass draft got it exactly right ("I KNOW
GOOGLE ADS"). The rule-compliance enforcer's rewrite silently changed it to "I KNOW Google Ads" —
downcasing the client's required all-caps phrase, almost certainly because the enforcer's own general
"casual voice" instincts (this codebase is full of "avoid shouting", "casual lowercase voice" guidance)
overrode a screening requirement nothing in its listed violations asked it to touch.

This is the fourth confirmed instance today of the same meta-bug: the enforcer changing something
outside its assigned violations while fixing something else (dropped pricing, added a wrong launch
offer, flipped launch timing, and now this). Extended the same established "MUST-KEEP" guard chain
rather than inventing a new mechanism.

**Fix:** added a generic extractor, `_REQUIRED_OPENER_RE`, that detects "start your proposal/cover
letter/application/response/it with '<phrase>'"-style instructions in the posting (handles both
straight and curly/typographic quotes — this exact posting uses curly ones) and captures the exact
required phrase, computed once alongside the existing `applicationChecklist` extraction. Added
`_regressedRequiredOpener` to the enforcer-guard chain: case-SENSITIVE check (casing is exactly what
regresses) that the phrase was present in the first 150 chars pre-enforcer and is now missing
post-enforcer — if so, discard the rewrite and keep the pre-enforcer draft, same as the other three
guards.

**Verified**: `npx esbuild --jsx=automatic --bundle=false` clean. A 4-case Node script using the real
posting text (curly quotes and all): correctly extracts "I KNOW GOOGLE ADS", flags the real regression,
does NOT flag when the phrase survives unchanged, and — the case that matters most — does NOT flag when
the enforcer is legitimately fixing a real first-pass mistake in the other direction (lowercase → correct
caps), so a genuine fix is never blocked. 4/4 passed.

**Revert:** one isolated addition (an extraction regex + a computed const near `applicationChecklist`,
plus one new guard condition + `else if` branch in the enforcer chain) in `JobDetail.jsx` — `git revert
<this-commit-hash>` removes it cleanly, no other guards touched.

## 2026-08-20 — Follow-up: the job-12477 fix above was necessary but NOT sufficient — found and fixed the real root cause

Owner regenerated job 12477 after the fix above and shared it again — same bug, "I KNOW GOOGLE ADS"
still downcased to "I KNOW Google Ads" in the final letter. The enforcer-regression guard added
earlier today didn't fire.

**Didn't guess twice — reproduced it live instead.** Rather than re-theorize from the shared snapshot,
opened the real app in the browser, captured console output, and ran an actual fresh Generate for job
12477 (real API cost, worth it here). Confirmed via `localStorage`'s `preEnforcerDraft` cache that the
pre-enforcer draft genuinely had "I KNOW GOOGLE ADS" correct — so this was a real regression, not a
first-pass mistake the guard was never meant to catch. But none of the 5 enforcer-guard `console.warn`
lines fired either. The guard itself was watching the right SYMPTOM but the wrong LAYER.

**Real root cause:** `_restoreProperNounCasing` — a deterministic step deep in the SAME cleanup pipe
that runs unconditionally on `text` regardless of the enforcer-guard chain's decision — extracts
proper nouns from the posting and case-INSENSITIVELY normalizes every occurrence in the letter to
whatever casing the posting uses MOST OFTEN. The posting says "Google Ads" in Title Case many times in
its body, and "GOOGLE ADS" in all-caps exactly once, inside the quoted attention-check. The extractor
picked Title Case as the "correct form" and force-normalized the deliberately-all-caps opener back down
— completely bypassing yesterday's new enforcer-regression guard, because that guard only compares the
enforcer's raw output; it has no visibility into what happens to `text` in the standard cleanup chain
that runs AFTER it, whether the enforcer's rewrite was accepted or rejected.

**Fix:** added `_restoreRequiredOpenerCasing(text, requiredOpenerPhrase)` — a small function that
re-asserts the exact required phrase (case-sensitive) within the first 200 characters, no-ops if it's
already correct, and deliberately does NOT inject the phrase if the model never wrote it at all (not
this function's job to invent compliance). Wired as the OUTERMOST wrapper around `_finalText` at BOTH
call sites (first-pass and enforcer-pass — this cleanup chain is duplicated at two identical-shaped
call sites in this file), so it's the literal last thing that touches the letter before `setProposal`,
immune to anything else added to the pipe later. Left this morning's enforcer-guard in place too — it's
not what fixes THIS bug, but it's still valid defense against a different failure shape (the enforcer's
raw rewrite itself dropping the phrase, not cleanup re-casing it).

**Verified properly this time — unit test AND live reproduction, in that order:**
- 4-case Node script against the exact real downcased text: restores correctly, no-ops when already
  correct, does NOT inject the phrase when the model never wrote it, stays inert with no required
  phrase — 4/4.
- Fetched the live served bundle to confirm the fix was actually in the code Vite was serving (not
  trusting HMR blindly after the previous fix's false confidence).
- Triggered a REAL fresh Generate for job 12477 in the browser and read the resulting textarea directly:
  **"I KNOW GOOGLE ADS" — correct, end to end, in the actual running app**, not just in isolated test
  logic.

**Lesson for next time, written down so it isn't relearned the hard way again:** when a fix targets "the
enforcer changed X," verify the actual FINAL text after the FULL cleanup pipe, not just the enforcer's
raw response — this codebase's cleanup chain has plenty of steps AFTER the enforcer decision that can
independently re-introduce the same symptom from a completely different cause.

**Revert:** one isolated addition (`_restoreRequiredOpenerCasing` + wiring it into both `_finalText`
computations) in `JobDetail.jsx` — `git revert <this-commit-hash>` removes it cleanly. This morning's
enforcer-guard commit is unaffected and still valid on its own.

## 2026-08-21 — Chat-requested case study silently never landed (job 12556) — LLM self-report bug, not a code regression

Owner: "I've asked generator in the chat to add derma case 3 times with no result." Read the shared
transcript for job 12556 (SEO agency posting) — the InlineChat exchange showed the model's own
`<remarks>` claiming success three separate times ("Added Derma Solution and Skin Reboot...", "Added
Derma Solution as the third case...", "Added Derma Solution as the second case between Skin Reboot and
Golden State...") while the actual `<proposal>` text it returned each time never contained Derma
Solution at all — only Skin Reboot and Golden State Trailers ever made it into the letter.

**Root cause is NOT in this codebase's cleanup chain.** Grepped every function in the chat-rewrite
cleanup pipe (`_humanizeCasing`, `_stripKbLeak`, `_stripDuplicateCaseBlockLabel`, etc.) — none of them
delete or filter a named case out of the proposal text. This is the model's own generation being
internally inconsistent between what it narrates in `<remarks>` and what it actually writes in
`<proposal>` — a real LLM self-report/output mismatch, not a deterministic bug we introduced. Since we
can't fix the model's own honesty about its output, the fix is a deterministic safety net that checks
the claim against the actual result and corrects it if they disagree.

**Fix:** in `InlineChat`'s `send()`, right after `newProposal` is computed from the model's `<proposal>`
tag, added a check: if the just-sent user message reads as an add/include request (and NOT also a
removal request, so this never fights an intentional cut) naming one of the `CASE_LEDGER` cases —
matched leniently, since chat messages are informal ("add derma case", not "add Derma Solution") — but
that case's full proper name is NOT actually present in `newProposal`, append `renderCaseLine(c.id)`
(the ledger's own canonical rendering) directly, deterministically, instead of trusting the model's
self-report a 4th time. Lenient matching uses the full case name OR its first word (gated by a small
generic-word stoplist — `house`/`site`/`shop`/`game` — so a bare first word can't false-positive-match
on its own); the presence check inside the letter stays strict (full name only, since a real case entry
always uses the proper name). This runs on `_finalNewProposal`, which now feeds `onProposalRewrite`
instead of the raw `newProposal`.

**Two rounds of test-driven correction before this was right:**
1. First version required the FULL case name in the user's own message to detect intent — failed
   against the real chat text ("add derma case" has no "Solution"). Caught by a 5-case Node test using
   the exact real turns from job 12556's transcript: 3/5 passed, both real-world cases failing. Fixed by
   splitting into a strict regex (checks the letter) and a separate lenient regex (checks intent).
2. Second version's intent regex still missed real turn 5 verbatim — "i dont see that you added derma,
   check" — because `\badd\b` doesn't match "added" (no word boundary between "add" and "ed"), and the
   "don't see" alternative only fired after the word "still". Fixed by widening to `add(?:ed|ing)?` and
   dropping the "still" requirement before "don't/do not see". Re-ran the same 5-case test: 5/5.

**Verified:** Node test against the two real job-12556 chat turns plus three edge cases (case already
present — must not double-append; explicit removal naming the same case — must not force it back;
unrelated rework request with no case name — must stay inert) — 5/5. `esbuild` syntax check clean after
both edits. Fetched the live-served bundle twice (once per fix round) to confirm Vite's HMR actually
picked up each change before re-testing. Did not spend a real API call on a live end-to-end chat replay
for this one — the safety net is a small, self-contained deterministic block with no other pipeline
stage that touches `newProposal` before it, unlike the job-12477 bug where a live reproduction was
necessary because the wrong architectural layer was involved.

**Revert:** one isolated addition in `InlineChat.send()` in `JobDetail.jsx` (the `_finalNewProposal`
block plus its downstream use in `letterUpdated`/`onProposalRewrite`) — `git revert
<this-commit-hash>` removes it cleanly, no other chat logic touched.

## 2026-08-21 — Follow-up: the job-12556 safety net above was necessary but NOT sufficient — the model can skip `<proposal>` entirely

Owner re-shared job 12556 (a fresh Generate + fresh chat session, different base draft this time —
Multilingual Site + Golden State Trailers survived the rule-compliance rewrite, Skin Reboot and Derma
Solution got stripped out by it for not matching the B2B-tech vertical). Same request pattern: "add
derma and skin reboot cases" → model claims added; two turns later, "add derma solution and skin
reboot" → model replies **"Both Derma Solution and Skin Reboot are already present in the current
draft — Skin Reboot is the first case, Derma Solution is the second case."** They were not present in
the actual letter at all — the model was trusting its own earlier (also wrong) self-report instead of
looking at the real text.

**Why yesterday's fix didn't catch this one:** the safety net only ran `if (newProposal && text &&
...)` — `newProposal` comes from matching a `<proposal>...</proposal>` block in the model's raw reply
(`JobDetail.jsx` ~3214). On a turn where the model believes nothing needs to change, it doesn't emit a
`<proposal>` block at all, so `newProposal` is `null` and the entire safety net was skipped by its own
guard condition — the exact "nothing to change" self-report failure mode the fix was built for, just
one layer further back than where it was checking.

**Fix:** dropped the `newProposal &&` prerequisite from the outer guard, and introduced `_baseText =
newProposal || currentProposalText`. `currentProposalText` is the live letter state passed into
`InlineChat` as a prop (`proposal` at the parent level) — i.e. the letter exactly as it stands right
now, independent of whether this turn produced a rewrite. The missing-case check and the deterministic
append now run against `_baseText` instead of `newProposal` directly, so a "the model decided there's
nothing to do" turn is checked against reality exactly the same way a real rewrite is. Everything else
(strict/lenient name matching, the generic-word stoplist, the removal-request exclusion) is unchanged.

**Verified:** expanded the Node test from 5 to 7 cases, adding the exact real turn-6 message
("add derma solution and skin reboot") with `newProposal: null` to reproduce the no-rewrite-emitted
path, plus a matching "already present in current letter, no rewrite emitted" negative case (must NOT
double-append when there's truly nothing to fix) — 7/7. `esbuild` syntax check clean. Fetched the live
bundle to confirm HMR served the new `_baseText` line before considering this done.

**Lesson for next time:** a safety net that checks "did X happen" needs to handle "the system that was
supposed to attempt X didn't even try" as its own case, not just "it tried and got it wrong" — the two
failure shapes look identical from the user's side (the case is still missing) but need different
inputs to detect.

**Revert:** one change in `InlineChat.send()` in `JobDetail.jsx` — dropping the `newProposal &&` guard
and adding the `_baseText` fallback — `git revert <this-commit-hash>` removes it cleanly; yesterday's
original safety-net commit is unaffected and still valid on its own (it's just no longer the only path
in).

## 2026-08-21 — Same case study cited TWICE in one letter (job 12556, third bug from this thread) — root cause in `_splitCrammedCaseStudies`

Owner: "not the first time I see duplications within cover letter" — a broader, recurring complaint,
not job-12556-specific. Re-shared job 12556 (a fresh Generate, third base draft in this thread). Both
the "before" and "after rule-compliance rewrite" drafts showed **Golden State Trailers** and
**Multilingual Site** each cited in full TWICE: once properly, in the "Here's relevant proof:" section,
and again later in a "multilingual / international SEO projects" paragraph responding to the posting's
separate ask for "examples of multilingual or international SEO projects" — reasonable for the model to
reference the same two cases again there (it only has two that qualify), but it re-emitted them as full
`Case Name (label): description` citations instead of a plain back-reference sentence.

**Root cause:** `_splitCrammedCaseStudies` (shared by all three cleanup-pipe call sites — chat rewrite,
generate first-pass, generate enforcer-pass) treats ANY paragraph containing 2+ known case names as a
"crammed" block that needs splitting into separate labelled citations. It has no concept of a case
having already been formally introduced earlier in the SAME letter. The recap paragraph — "the
multilingual site above covers italian + german markets... golden state trailers is us-only but
demonstrates..." — is a single paragraph mentioning two case names separated by a sentence boundary, so
it satisfied the exact same "crammed list" shape the function is designed to unpack, and got mechanically
rewritten into a second full citation of both cases (with the label glued onto whatever word followed,
producing "Multilingual Site (attached in profile highlights): above covers..." — a giveaway that this
was a back-reference, not a citation, since a real citation doesn't start its description with "above").

**Fix, two parts:**
1. In `_splitCrammedCaseStudies`, track the FIRST paragraph (by index) each case name appears in
   anywhere in the letter. A paragraph's case-name hits now only count toward "crammed" if THIS is the
   first paragraph mentioning that case — a later paragraph that only re-mentions already-introduced
   cases is left alone entirely (pushed through unchanged), instead of being split and re-labelled as a
   fresh citation. A paragraph genuinely introducing 2+ NEW cases for the first time still splits exactly
   as before.
2. Leaving the recap paragraph untouched exposed a second-order issue: its case names keep whatever
   casing the model happened to write ("multilingual site", "golden state trailers") — the existing
   `_restoreProperNounCasing` step only re-cases proper nouns pulled from the JOB POSTING, not Artem's own
   case names, so it wouldn't fix this. Added a small normalization loop right after the split, inside
   `_ensureCaseStudyHighlightsLeadIn` (so all three call sites get it for free): replace every
   case-insensitive, whole-word match of a `_CASE_META` name anywhere in the text with its canonical
   casing. Caught one bug while writing this: the first version used `text.replace(meta.re, meta.name)`
   without a global flag, which only fixes the FIRST occurrence in the whole letter (already correctly
   cased, since that's the real citation) and leaves the later lowercase mention untouched — exactly the
   spot that needed fixing. Fixed by constructing a fresh `new RegExp(meta.re.source, 'gi')` per case.

**Verified:** 4-case Node test against the real job-12556 "before rewrite" text (the exact paragraph
structure from the share) plus a synthetic genuinely-crammed-new-case control (two brand-new cases
introduced together in one sentence-separated paragraph, e.g. "SMASH: ... Game-X: ...") — confirms (a)
Multilingual Site and Golden State Trailers now each appear exactly once instead of twice, (b) the recap
paragraph reads "the Multilingual Site above covers... Golden State Trailers is US-only..." instead of
lowercase, (c) a genuine crammed block of brand-new cases still splits and labels correctly, unaffected
by the new gate — 4/4. `esbuild` syntax check clean. Fetched the live-served bundle twice (once per
sub-fix) to confirm HMR picked up each change. Checked for interaction with the two other
duplicate-related functions in this file (`_stripDuplicateCaseBlockLabel` — a literal "Relevant case
studies:" header pattern; `_stripDigitBombDuplicateCase` — the Digit Bomb opener stacking a second case
right after it) — both operate on unrelated, non-overlapping text shapes, no interaction.

**Revert:** two related changes in `_splitCrammedCaseStudies` and `_ensureCaseStudyHighlightsLeadIn` in
`JobDetail.jsx` (the `firstParaForCase` gate + the case-name casing normalization loop) — `git revert
<this-commit-hash>` removes both cleanly in one step; no other function in the cleanup chain depends on
either change.

## 2026-08-23 — Digit Bomb cold open reads out of context: numbers correct, but never bridges to the client (job 12755)

Owner: "When we are making digit bomb intro is should say something besides actual numbers, cause it
looks out of context. It should also when possible to resonate with job posting." Shared job 12755
(Zion Home Buyers, real-estate lead gen), Digit Bomb armed on Atlant. Actual opener: "+56.5%
conversions, -31% CPC, +144% clicks - Atlant (attached in profile highlights): residential property
developer lead gen via branded per-complex campaigns + PMax + DSA." — numbers correctly lead, case name
correctly follows, but the opener stops there. Zero connection to Zion Home Buyers' actual "we buy
houses" cash-buying business, despite the posting offering an obvious hook (motivated/distressed
sellers, "sell my house" landing pages).

**Why the existing guard didn't catch it:** the Digit Bomb prompt (`generate()`, the
`DIGIT BOMB OPENER MODE` block) already had a step 3 asking the model to "bridge to THIS client's own
situation" — but it was phrased as one bullet among three, easy to satisfy steps 1-2 (numbers first,
case name after) and silently drop step 3 under whatever pressure the model is under. The deterministic
pre-check (`missingDigitBombFacts`) only verifies the numbers appear early and before the case name — it
has no concept of "bridge present or not," so a technically-compliant-but-context-free opener like this
one sailed through with zero enforcer intervention. Same root shape as every other bug in this file this
month: a soft prompt instruction alone isn't enough; it needs a deterministic check backing it up.

**Fix, two parts:**
1. Strengthened the prompt instruction itself — step 3 is now explicitly marked MANDATORY, states the
   opener's whole thesis directly ("I have exactly this experience — here's a real result — and here's
   why it applies to your situation"), and added a WRONG example using this exact job's real failure
   text so the model has a concrete negative example matching what actually shipped, not just an
   abstract description.
2. Added `missingDigitBombResonance` — a new deterministic pre-check, gated to only run when
   `missingDigitBombFacts` is already false (so it doesn't pile a second violation onto an opener that's
   already broken in a more basic way). Can't verify semantic relevance deterministically ("does this
   sentence meaningfully connect to the client's business" isn't a regex), so it uses a narrow, honestly-
   imperfect proxy: the prompt's own correct-shape examples always address the client directly
   ("you're dealing with...", "your five real estate markets...") — total absence of "you/your/you're"
   from the opening paragraph is a reliable signal the bridge was skipped entirely, not just phrased
   differently. Wired into `draftCompliant`, telemetry, and `specificViolations` exactly like every other
   guard in this chain — when it fires, the enforcer gets a targeted instruction to add ONLY the missing
   bridge clause, leaving the numbers/case name untouched.

**Verified:** 4-case Node test — the real job-12755 opener (fires true), the same opener with a bridge
clause added (fires false), a case where `missingDigitBombFacts` is already true (resonance check must
not also fire, stays false), and no case armed at all (stays inert on every normal job) — 4/4. `esbuild`
syntax check clean. Fetched the live-served bundle to confirm HMR picked up the change (7 occurrences of
the new identifier, matching the guard/telemetry/console.log/specificViolations wiring).

**Separately investigated, no fix needed:** the same message also mentioned the InlineChat "lies about
what it fixed" pattern (already fixed once this week for case-study additions — see the two 2026-08-21
entries above), pointing at this same job's chat transcript ("audit samples?" → "Adding that line" when
the draft already said "Attaching a sample Google Ads audit"). Checked whether this could produce a
visible duplicate: `_stripDuplicateAuditSampleMention` is already wired into the chat-rewrite cleanup
chain and specifically collapses multiple audit-sample mentions down to one, so this specific exchange's
self-report inaccuracy is very unlikely to have produced a duplicate in the actual letter — didn't chase
it further without a concrete example of what the resulting text looked like (the current live-chat state
isn't visible outside the owner's own browser session).

**Revert:** one change in the DIGIT BOMB prompt block plus the `missingDigitBombResonance` guard (and its
three wiring points: `draftCompliant`, telemetry, `specificViolations`) in `JobDetail.jsx` — `git revert
<this-commit-hash>` removes all of it cleanly; `missingDigitBombFacts` and everything else in the
Digit Bomb feature is untouched.
