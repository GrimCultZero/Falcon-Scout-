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
