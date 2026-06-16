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
