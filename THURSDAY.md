# Thursday agenda — Falcon Scout

**Created:** 2026-05-25 (after a session where we hit ~93% of weekly Pro quota).
**Pick up date:** Thursday 11:00 AM (Pro plan resets then — full session + full weekly budget available).

A fresh Claude session reading this should first re-read `CLAUDE.md` and `DESIGN.md`, then this file. The numbered items are ordered by **priority**, not size.

---

## What landed in the last session (do NOT redo)

- **Haiku flip**: `kb_shrink`, `rule_check`, `rule_distill` → `claude-haiku-4-5-20251001`. Mechanical tasks, ~7× cheaper on `kb_shrink`. **Untested quality-wise** (see item 3 below).
- **Hire detection on capture**: `_detect_status_from_capture()` + `_upsert_proposal_status()` in `api/main.py`. `/capture-conversation` now scans contract_status / cover letter / messages / raw page text for hire/interview/replied signals and promotes the linked Proposal. Fuzzy job-title match. `messages.js` sidebar scraper widened to catch "View offer", "Rate: $X/hr", "Limit: N hrs/week" — the Bannerheld signal pattern.
- **P0**: Generator past-proposals are now filtered by Outcomes status. `JobDetail.jsx::generate()` fetches `/proposals?status=hired,replied,interviewing`, builds a `winnerKeys` Set, stable-sorts `sent_proposal` KB entries so winners come first, marks them `[WINNER — got a reply / hired]` in the prompt. Backend `/proposals` now accepts comma-separated status.
- **P1 verification**: added `[stats-inject]` print in `/claude` proxy so we can confirm outcome-stats injection actually fires (or logs `SKIPPED (helper returned empty — need ≥10 resolved outcomes)`).
- **P5 cleanup**: deleted dead `extractCleanContent()` (~72 lines) from `JobDetail.jsx`.

---

## Thursday work — ordered by priority

### 1. ✅ DONE 2026-05-26: Anthropic prompt caching in `/claude` proxy

This is the biggest cost win left and is fully lossless. Handoff P2.

- **File:** `api/main.py::claude_proxy()` (around line 3154).
- **What to do:**
  - Detect when `system` is a string ≥1024 tokens (~4096 chars rough proxy).
  - Restructure into a content-block list: cacheable prefix block + dynamic suffix block.
  - Put `cache_control: { type: "ephemeral" }` on the prefix block.
  - Header `anthropic-beta: prompt-caching-2024-07-31` is no longer required (caching is GA) — verify against current Anthropic docs first.
  - The split point should be wherever the KB / rules / case studies end and the *per-call* dynamic context begins. In Falcon Scout's frontend prompts, the dynamic part starts after the existing `\n---\n` separator (jobContext, adjustments).
- **Frontend changes:** none — backend transparently splits.
- **Verification:** after one analyse → check the response `usage` field shows `cache_creation_input_tokens > 0`; trigger a regenerate within 5 min → second response should show `cache_read_input_tokens > 0`. The `[stats-inject]` log I already added will also fire so we know that path still works.
- **Acceptance:** on a 3-regenerate cycle, the 2nd and 3rd input cost drops to ~10% of cached portion. Roughly $0.03 → $0.005 per regenerate. ~85% savings on iterative work.
- **Watch out:**
  - Cache prefix must be ≥1024 tokens for Sonnet/Opus, ≥2048 for Haiku 3.5 (Haiku 4.5 limits may differ — check docs).
  - Cache TTL is 5 min ephemeral. There's also a longer 1-hour cache now (more expensive write, longer hits). Stick with ephemeral for Falcon Scout's interactive flow.
  - If cache writes exceed reads (i.e. first-call-always pattern), caching is a net LOSS. Caching only pays back on repeated calls within TTL. Should be fine — analyse+proposal+chat all repeat within iteration cycles.
  - Don't break the existing list-or-string handling for `system` in the stats-injection block right above (~line 3184). Keep both paths working.

### 2. ✅ DONE 2026-05-26: Client data backfill in standalone-proposal capture

Fixed in `/capture-standalone-proposal` — when a Job row already exists (matched by upwork_job_id or title), the endpoint now backfills `client_total_spent_detail`, `client_rating_score`, `client_review_count`, `hire_rate`, `client_jobs_posted`, `client_jobs_open`, `client_hires`, `client_active`, `client_avg_hourly_rate`, `client_hours_billed`, `client_member_since`, `client_company_size`, `client_city`, `proposals`, `interviewing`, `invites_sent`, `unanswered_invites`, `last_viewed`, `bid_high/average/low`, `payment_verified`, `phone_verified` from the scraped proposal data. Only fills NULL columns — never trample existing /enrich data. Sets `enriched_at` on first backfill so the "Enriched" filter view sees it. Log line on each backfill: `[capture-standalone-proposal] backfilled Job N fields: hire_rate, client_total_spent_detail, …`.

To verify: capture a new submitted proposal for an existing Job → check backend console for the backfilled-fields log line, then inspect the Job row in DB or via the analyser UI (the meta panel should now show "$N total spent", hire rate, etc.).

### 3. CHECK: KB-Shrink quality on Haiku

Just flipped from Sonnet 4.5 → Haiku 4.5. Quality risk: Haiku may drop more facts during compression than Sonnet did. Untested.

- **What to do:** open one of Artem's biggest Core KB entries, click `↓ Shrink`, eyeball the result. Cross-check:
  - All numbers, percentages, dollar amounts, dates preserved?
  - All client names / project names / tool names preserved?
  - All "unless X" / "except when Y" conditional clauses preserved?
  - Voice / structure intact?
- **Outcomes:**
  - **Quality fine** → leave Haiku in place, ~$0.20 saved already.
  - **Subtle fact loss** → revert kb_shrink to `claude-sonnet-4-5` in `api/main.py:1286` and `_record_usage("kb_shrink", "claude-sonnet-4-5", result)` on line 1300.
  - **Major fact loss** → revert AND consider lowering the shrink target % (currently aggressive).

### 4. ✅ DONE 2026-05-26: Decline detection on capture

Easy fill-out of the funnel. Currently `/capture-conversation` detects `hired` / `interviewing` / `replied`. Missing: `declined`.

- **File:** `api/main.py::_DECLINE_SIGNALS` (new — add alongside `_HIRE_SIGNALS` etc.).
- **Patterns to detect:**
  - "we went with another freelancer"
  - "we've selected someone else" / "we have selected"
  - "decided to go with"
  - "filling the role internally"
  - "no longer hiring"
  - "we've closed this position"
  - "thank you for your interest, but"
  - "best of luck with your search"
- **Rank `declined` ABOVE `replied` but BELOW `hired`** in `_STATUS_RANK` (it already is at 5, same tier as hired — leave it).
- **In `_detect_status_from_capture`:** check decline BEFORE replied so explicit rejection beats "client wrote back". Place after hire/interview checks.
- **Acceptance:** capture a conversation with one of those phrases → Proposal flips to `declined`.

### 5. ✅ DONE 2026-05-26: Duplicate KB injection in Generator system prompt

Handoff noted "duplicate injection in middle (existing)". Worth tracking down.

- **File:** `frontend/src/components/JobDetail.jsx::generate()`.
- **What to do:** read the system prompt construction, find where the KB rules / Core / examples might be injected twice. Remove the duplicate. Saves tokens AND avoids attention dilution.
- **Acceptance:** generated proposal output unchanged, but `usage.input_tokens` drops noticeably on the first call.

### 6. ✅ DONE 2026-05-26: Segmented outcome stats

Current `_build_outcome_stats_prompt_section()` reports one global reply rate. Useless for calibration.

- **File:** `api/main.py::_build_outcome_stats_prompt_section()` (around line 3097).
- **What to do:** when computing stats, also bucket by:
  - Client total spend tier ($0 / <$1k / $1k-10k / $10k-100k / $100k+)
  - Rate band (<$30/hr / $30-60 / $60+ / fixed)
  - Country bucket (US / EU / other)
- **Output shape (target):**
  ```
  RECENT OUTCOMES (last 90 days, N proposals):
  Overall: 12% reply rate · 3 hired
  By client spend tier:
    $0–1K:    4% reply, 0 hired (n=12)
    $1K–10K:  9% reply, 1 hired (n=18)
    $10K–100K: 18% reply, 1 hired (n=22)
    $100K+:   28% reply, 1 hired (n=8)
  ```
- **Gate at ≥10 resolved outcomes (current) AND ≥3 per bucket** — don't show useless single-sample buckets.

### 7. ✅ DONE 2026-05-26: Client-tier badge on Outcomes rows

Shipped in `Outcomes.jsx` row template, right under the "sent <timestamp>" line. Sources from `p.job_snapshot.{client_total_spent_detail, payment_verified, client_rating_score, client_review_count, hire_rate}`. Each badge silently omits when its field is null. Hire-rate colour: ≥80 green, ≥50 amber, <50 red. Whole row omitted when the snapshot has none of those fields (clean for older sparse proposals).

### 8. ✅ DONE 2026-05-26: Record analyser verdict on each Proposal (feedback loop primitive)

User idea (2026-05-26): when a proposal is captured (Save-to-KB or auto-submit), snapshot the analyser's verdict + score + reasons + flags alongside it. Currently predictions and outcomes are unlinked — can't compute "reply rate on APPLY/9+ vs APPLY/6 vs MAYBE", can't calibrate the analyser, can't pair (prediction, outcome) for Phase 7.

**Cost: zero extra Claude calls** — analyser already runs. Just record the result.

- **Schema:**
  - Add `Proposal.analysis_json TEXT` column — snapshot of analyser output at proposal creation time.
  - Add `Job.last_analysis_json TEXT` + `Job.last_analysis_at DATETIME` — server-side cache of the most recent analyser run for that job, so the auto-submit flow (which doesn't go through the React analyser column) can attach it.
- **Backend:**
  - New endpoint `POST /jobs/{id}/analysis` body `{verdict, score, summary, reasons, flags, model, ran_at}` → upserts `last_analysis_json` on the Job row.
  - Modify `/proposals` POST + `/proposal-submitted`: if `analysis_json` not supplied in the body, fall back to `Job.last_analysis_json`. Either way, snapshot it onto the new `Proposal.analysis_json` column. NEVER overwrite a populated `Proposal.analysis_json` on update — it's an immutable point-in-time record.
- **Frontend:**
  - JobDetail.jsx: after a successful analyse / analysis_rescan call, POST the result to `/jobs/{id}/analysis`. Fire-and-forget — no error surfaced to user, just log on failure.
  - Save-to-KB button: include the current React analysis state in the `/proposals` POST body as `analysis_json`.
  - Outcomes.jsx: tiny verdict badge on each row, format `APPLY/8` or `MAYBE/5` or `SKIP/2`. Click to expand → show reasons + flags from the time of submission.
- **Skip on retroactive captures** (`/capture-conversation` for historical conversations): there's no contemporaneous analysis to attach. Leave `Proposal.analysis_json` NULL for these. UI shows "no analysis on record" — fine.
- **Acceptance:**
  - Save a new proposal → row in `proposals` table has `analysis_json` populated.
  - Outcomes card shows the badge.
  - SQL: `SELECT json_extract(analysis_json, '$.verdict') AS verdict, status, COUNT(*) FROM proposals GROUP BY verdict, status` — produces a useful predictions-vs-outcomes table.
- **Future hook (NOT Thursday):** add a "Calibration" section to the Dashboard tab showing reply / hire rate broken down by verdict-score band, plus a "the analyser was X% accurate on jobs ≥6 score" headline metric. That's the actual payoff.

### 9. UX: Surface "+ FORM A RULE" when analyser chat looks corrective

User question 2026-05-26: "how hard to make analyser improve itself from my corrections?". Answer: the mechanism already exists ("+ FORM A RULE" button in chat → distill into rule → save to KB → auto-injected into every future analyser run). Friction problem, not capability problem. User forgets to click. Goal: auto-surface the rule-capture flow when the chat looks like the user is correcting the analyser.

- **File:** `frontend/src/components/JobDetail.jsx`, the `InlineChat` component used by the Analyser column.
- **Detection heuristic:** after each chat turn, evaluate the message history for "corrective shape":
  - At least 2 chat turns (user + assistant) with one of these patterns:
    - User message contains correction verbs: "wrong", "incorrect", "actually", "you missed", "this isn't", "shouldn't be", "you're wrong about", "ignore", "rethink", "rework"
    - User message points out a factual misreading: rate, scope, geography, status, intent (regex: `/\$\d|hourly|flat|rate|skip|disqualif|miss|misread|misinterpret/i`)
    - Assistant message in the same exchange contains an acknowledgement: "you're right", "i misread", "i see", "correction", "let me re-evaluate", "revised verdict"
  - When the heuristic fires twice in a session (single-turn slip-ups don't qualify), surface a non-blocking banner above the chat input: **"💡 Capture this lesson as a rule? Future analyses will apply it automatically. [✓ Capture] [✕ Dismiss]"**
- **On Capture click:** reuse the existing `formRuleFromChat()` (or whatever it's named — search for `rule_distill` to find it). Distill via Haiku (~$0.001), preview, accept/edit. Existing `rule_check` conflict-detection still applies.
- **Dismiss state:** remember dismissal within the session (don't re-prompt on every turn), but reset on new job selection.
- **Auto-tag:** distilled rules from this auto-flow should get tag `auto_distilled,analyser_correction` so the user can audit later via the KB filter.
- **Acceptance:**
  - Have a chat with the analyser where you correct a misread → after the 2nd corrective turn, banner appears.
  - Click ✓ Capture → existing distill flow runs → rule saved to KB with the new tag → future analyses include it (verify by checking the analyser system prompt on the next run).
  - Click ✕ Dismiss → banner stays hidden until next job.
- **Out of scope (handle later if/when needed):**
  - Per-rule auto-expiry / decay
  - Cross-rule contradiction detection beyond what `rule_check` already does
  - Auto-distill without user review (DELIBERATELY NOT DOING — see handoff conversation: rule pollution + overfitting + stale rules + hallucinated lessons are real risks)

### 9b. FIX: Proposals-list scraper only catches 7/30 rows + junk titles

Diagnostic 2026-05-28 (Submitted proposals = 30): the sync debug panel showed `scraped 7 rows` with garbage titles ("24 minutes ago", "Boost outbid", "Not boosted Learn more", "last week"). Two problems:
- **Virtualization**: only ~7-9 rows render at once; `waitForListContent`'s scroll sweep isn't loading/holding all 30. Need to scroll incrementally and accumulate rows across scroll positions (rows unmount as they leave the viewport, so scrape-as-you-scroll, dedupe by title/id).
- **Title extraction picks junk**: date/status fragments ("Boost outbid", "last week") become their own "rows" or get chosen as titles. The date-anchor + first-plausible-line heuristic is too loose for this DOM. Tighten: the real job title is the LINK text / the line that isn't a date/status/boost/ago fragment. Consider anchoring on the job-title link element instead of the date.
- **"Viewed by client" is hover-only** (confirmed: 0 indicators on plain scan). Synthetic-hover attempt added 2026-05-28 (scrapeProposalsList dispatches mouse events per row). IF that still yields 0 after testing, it's pure CSS :hover = uncaptureable headlessly → drop viewed-from-list entirely and rely on: messages-inbox sync for "replied" (stronger signal) + manual status + auto-ghost. Don't keep sinking effort into viewed-from-list if hover sim fails.

### 10. PHASE 7: Similarity retrieval ⭐ biggest quality lift, biggest effort

DESIGN.md Phase 7. ~half-day of work. Defer this to a dedicated session AFTER items 1-6 are clean.

- Deterministic feature-overlap similarity (category, vertical, rate band, spend tier, country, screening_questions). No embeddings.
- When new job arrives: compute similarity vs every past proposal. Surface top matches with their outcomes ("3 hired, 2 ghosted on similar jobs") in the Analyser AND inject the winners as in-context examples in the Generator.
- See DESIGN.md §8 Phase 7 for the full design — already specced.

---

## Items to MONITOR (no action — just check what user reports)

These are recent landings that need real-world validation:

- **Hire detection on capture** (Bannerheld case + future captures): is `[capture] promoted proposal N → hired` firing as expected? Are the regex patterns catching the right signals without false positives?
- **P0 winner-weighted generator examples**: in DevTools console, the log line `[Falcon] Generator past-proposals: N picked (M winners …)` should show ≥1 winner once the user has any hired/replied proposals. If still 0, the title-matching may be too strict.
- **`[stats-inject]` log**: needs ≥10 resolved outcomes to fire with content. Until then it'll always log `SKIPPED`. Once it fires non-empty, verify the stats text reads correctly.
- **Haiku quality on rule_check / rule_distill**: low risk, but if Artem reports a rule conflict that wasn't caught, or a distilled rule that's lower quality than before, those are the suspects.

---

## Notes on conventions

- All Claude calls go through `/claude` proxy. Frontend never calls Anthropic directly.
- Job dedup key is `upwork_job_id` (`~01abc…` from Upwork URL).
- Capture non-obvious decisions in `DESIGN.md` as part of the same change.
- Tactical fixes: just make them, don't ask. Strategic / multi-file work: check in first.
- `frontend/vite.config.js` pins port 5180 with `strictPort: true` — do not change.

## Quick start

```bash
falconscout.bat                                 # everything
uvicorn api.main:app --reload --port 8000       # backend only
cd frontend && npm run dev                      # frontend only
python listener.py                              # Telegram listener only
```
