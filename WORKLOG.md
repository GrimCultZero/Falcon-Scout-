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
