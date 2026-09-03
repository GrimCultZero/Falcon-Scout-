# Cover-Letter Generator Rebuild — Handoff for the next Claude instance

**Created:** 2026-09-02 · **Status:** IN PROGRESS, mid-migration · **Owner:** Artem Yatsuk
**Canonical detail:** `WORKLOG.md` — every item below has a dated entry there with full evidence.
**Related:** `DESIGN.md` §16 (hallucination mitigation), §21/§21-B (anti-fabrication, grounding checker),
§22 (classification vs rewriting). `ANTIFAB_HANDOFF.md` for the grounding-checker lineage.

---

## 0. Read-me-first

1. **Nothing in this work is committed.** `git status` shows 11 modified files and an untracked
   `corrections/` directory, ~2,553 insertions / 846 deletions on top of `f56eca5`. Do not assume a clean
   tree, and do not `git checkout` anything without reading §9.
2. Read this file, then §4 of `WORKLOG.md`'s 2026-09-02 entries for the evidence behind each claim.
3. The app is normally already running: backend `uvicorn api.main:app --reload --port 8000`, frontend
   `npm run dev` on `:5180`, both defined in `.claude/launch.json`. Backend auto-reloads on save; the
   frontend needs a browser refresh after large edits.
4. **Read §7 (working agreements) before you fix anything.** The single most likely way to damage this
   project is to helpfully patch a regex that Artem has explicitly asked you to stop patching.

---

## 1. Why this work exists

On 2026-09-01 Artem escalated, in his words:

> "I am seriously fed up of our patching process of the generator work. We've made a tone of coding and
> results are actually even worse than before — cover letter quality is dropping, messages look unnatural,
> rules are constantly being violated, I have to use chat window to make tweaks on almost every message."

He asked three questions that frame everything since:
- Does the system ever *learn* from his chat tweaks? (**No.** They were discarded. See §5.6.)
- Can it be rebuilt closer to his old Gemini chat workflow, where corrections accumulate?
- Would a thorough audit help?

He authorised a full structural audit, then approved the resulting migration plan.

**The key reframe, which he accepted:** his Gemini workflow never "learned" either — the *thread* simply
never forgot. That is accumulated context, not training, and it is reproducible with plumbing. Do not
promise him fine-tuning; that is not what is being built.

---

## 2. The diagnosis

The generator lives almost entirely in `frontend/src/components/JobDetail.jsx` (9,050 lines after this
session's deletions). The audit found the letter was produced by:

1. A first-pass Claude call, under ~56 prohibitions and a wall of KB rules.
2. ~26 deterministic "strip" functions nested at emit time, in **two drifted copies**.
3. A second full-price Claude call (the "enforcer") that rewrote the letter to satisfy violations.
4. Artem's chat corrections, which were thrown away.

The structural verdict, published as an artifact ("Detectors, Not Renderers",
https://claude.ai/code/artifact/109f880e-3ec3-465f-97a1-5719d4a45edb):

> The system tries to *control output with prohibitions* and then *repair the damage with more prohibitions*.
> It should instead *hand the model the right inputs* and let the checks **report** rather than rewrite.

This is the same "checker, not rewriter" principle already proven by §21-B's grounding checker.

An earlier artifact covers the pipeline/outcomes analysis ("Why August Ghosted",
https://claude.ai/code/artifact/d9e5b934-2edc-434c-8c78-e593ee643358). Its headline correction is worth
carrying: the discriminator for who replies to Artem is **client volume** ($41,400+ lifetime spend, 20+
hires), not rate. A proposed $25/hr filter would have blocked 3 of his 4 invites.

---

## 3. Migration plan — status

| # | Step | Status |
| --- | --- | --- |
| 1 | Fix `job_id` NULL in violation telemetry | **DONE, verified in production** |
| 2 | Delete dead code (49 console-only blocks) | **DONE.** Tier A remainder deliberately NOT done — see §6.1 |
| 3 | Grounding: make verified site data usable | **PARTIALLY DONE** — contract fixed; detector not built |
| 4 | Offer table + CTA slot | not started |
| 5 | Playbooks (the ~7–10 letter shapes) | not started — see §8.1, there is a fast path |
| 6 | Delete the enforcer | **DONE** |
| 7 | (reserved) | — |
| 8 | Corrections store | **DONE (capture side)** — see §5.7 |

Steps were reordered mid-session with Artem's approval: 6 was pulled ahead of the rest of 3 because the
enforcer was demonstrably making letters worse, and a detector feeding a broken rewriter is pointless.

---

## 4. What shipped this session

All verified unless stated. Each has a `WORKLOG.md` entry dated 2026-09-02.

### 4.1 Telemetry can be joined to letters again (Step 1)
301 of 1,375 generator events (21.9%) carried `job_id = NULL`, because the ~20 strip helpers are
**module-scope** and cannot see the component's `job` prop. Added module-scope `_currentJobId` +
`_setCurrentJobId()`; `_recordViolations` falls back via `jobId ?? _currentJobId ?? null` (`??` not `||`,
so a job id of 0 survives). Setter fires at both `_jobIdAtCallTime` capture points.
**Verified in production:** 28 events on 2026-09-02, `job_id IS NULL` on none.

### 4.2 Website Inspect works — for the first time ever
`website_inspected_at` was NULL on **all 445 jobs**. The feature had never once completed: a 21-digit
Upwork job id overflowed SQLite's int64 in `save_website_inspect`, raising `OverflowError` (a builtin, not
`sqlite3.OperationalError`, which is why earlier fixes missed it). Guard added in `api/main.py`.
Now confirmed end-to-end: extension → bridge → background tab → scrape → POST → DB.

### 4.3 Auto-inspect
Fires when the posting itself names a site and nothing is stored. Narrow by design: only a URL detected in
*that posting's text* (never the input box, so an automatic scrape can only hit a site the client named),
once per job per session, skipped if a summary exists, 2s debounce.
**Measured coverage before building it: 13 of 445 postings (3%) carry a usable URL** — 4% even on SEO-only
jobs. It is worth having and is *not* a general fix; do not let anyone believe otherwise.
Also fixed a precondition: `AhrefsBar` kept the **previous** client's domain on a job switch
(`setAhrefsDomain(d => d || fallback)`), which with auto-fire would have scraped the wrong company.

### 4.4 The GROUNDING CONTRACT now permits verified site data (Step 3, first half)
**This was the highest-value find.** The scrape *was* injected into the prompt — and then forbidden:

> "You have **TWO — and only two** — sources of facts … (1) the job posting … This is your **ONLY** source
> of facts about the client. **You have NOT seen their site**…" — and the contract claims to *override
> everything below*.

Two further blocks repeat it. All unconditional. So Inspect could not have changed a single letter.

Added `_hasVerifiedSiteData = !!(websiteText || ahrefsResult)` and four conditional branches, including a
new **source (3)** scoped to what each tool actually returns: the website scrape licenses stating what the
business *is/sells/serves* ("in their own words, not a category you assumed"); Ahrefs licenses citing its
organic figures verbatim; everything else — ad account, tracking, internal numbers, "any metric you
inferred rather than read" — stays banned.

Also rewrote the clause that **explicitly licensed the failure**: it used to say inferring from a domain
name "is acceptable ONLY if framed as the problem space". That is how "Mr Chef" became a recipe publisher.
It now names guessing-from-the-name as the failure mode.

**Result, verified on a real regeneration:** job 14178's letter went from chicken-tikka-masala recipe SEO to
"mr chef seasonings", "jollof rice seasoning", "nigerian chicken cubes" — all traceable to the scrape.

### 4.5 The client's own questions now reach the prompt
Three separate defects, all found on job 14178 and all validated against the full 437-posting corpus:
- `_CHECKLIST_TRIGGER_EOL_RE` allowed 40 chars between the trigger phrase and the colon; this client used
  **56**. Widened to 80 → 80→85 trigger lines, **all 5 gains genuine, zero false positives**. One gain is a
  client stating outright that unanswered applications are rejected (job 14122).
- `extractApplicationChecklist` collected exactly **one** un-bulleted line (`collected.length === 0`) while
  its own comment said "a couple". Three of four asks were dropped and the prompt then announced "this
  posting asks 1 question". Fixed with a continuation branch (≥3 words, not a sign-off). Corpus check: 92
  checklists, 75 multi-item, zero prose false-positives.
- `_postingAsksTimeline` returned **false** on "Estimated timelines" — the group's trailing `\b` kills any
  plural. Consequence was *inverted*: `coverHasTimeline = !_postingAsksTimeline && …` flipped TRUE, so the
  system **stripped timing from a letter whose client had explicitly asked for timelines**. Plurals added;
  40→44 postings, all four gains genuine.

### 4.6 Rule 402's turnaround no longer suppressed, then punished
Two independent causes, both fixed:
- A prompt block added earlier in the same session (mine) said "with NO price **and NO turnaround-day
  count** attached" whenever the posting didn't ask for a rate. Delivery commitments are not pricing.
- `COVER_TIMELINE_RE`'s audit-days pattern matches "audit … delivered in 1 working day" — the exact sentence
  Rule 402 demands. A compliant letter fired a violation and paid for an enforcer rewrite as its reward.
  Fixed by blanking the allowed phrase from a **copy** before scanning, gated on `_casePpcSignal`. Tested
  against the real extracted pattern list: 7/7.

### 4.7 The enforcer is deleted (Step 6)
~570 lines gone; bundle **535.3kb → 473.2kb**.

Evidence it was failing at its own job, three-for-three on 2026-09-02:
- job 14169 — invoked for `hasBannedOpener`; its replacement opener matched a **different** entry in the
  same `BANNED_OPENERS` array (rule 9 traded for rule 1, verified in node). Nothing caught it because
  **the checks only ever ran on the first-pass draft — the enforcer's output was never re-checked.**
- job 14177 — invoked for `hasFabricatedDiagnosis`; the claim shipped intact.
- job 14178 — deleted a case entry and left the lead-in claiming three.

And it was the most expensive thing in the system. From `token_usage`:

| kind | calls | input tokens | ~cost @ $3/$15 per M |
| --- | ---: | ---: | ---: |
| **proposal_rule_enforce** | **490** | **3,656,244** | **$15.24** |
| chat | 355 | 4,529,867 | $17.23 |
| proposal | 382 | 2,881,963 | $12.02 |
| analysis | 457 | 1,726,481 | $10.42 |

It cost **more than generating the letters it was correcting**, and fired on ~88% of generations.

Replaced by nothing, deliberately. Checks still report to telemetry; deterministic strips still run;
what they cannot fix is surfaced in a UI flag strip under the letter and carried into the share snapshot.

**Also collapsed the two strip chains into one.** They had drifted by exactly one function —
`_stripSeoAuditTurnaround` was in the fast path and missing from the post-enforcer path, so any letter that
*failed* the pre-check never had an SEO audit turnaround stripped. The survivor is the superset.

### 4.8 Smaller fixes
- `_fixCaseCountClaim` — repairs a lead-in that commits to a case count after something downstream deletes
  a case (`metricNotInLedger` did exactly that on 14178, leaving "three cases map directly" over two).
  Tested 4/4 including three false-positive shapes.
- `preEnforcerDraft` retired to a constant — with no rewrite there is no "before", and left alone it would
  have rendered a stale "Draft BEFORE the rule-compliance rewrite pass" section from localStorage.
- Auto-inspect stale-closure fix — see §6.2, it is listed as a defect because it shipped broken first.

---

## 5. Infrastructure the next instance should know about

### 5.1 Telemetry is now the primary signal
`rule_violations` (surface, job_id, check_name, ts). One batch per generation. With the enforcer gone this
is how you find out whether a change helped. Useful queries:

```sql
-- did a change reduce a family of violations?
SELECT check_name, COUNT(*) FROM rule_violations
WHERE surface='generator' AND ts >= '2026-09-02' GROUP BY 1 ORDER BY 2 DESC;

-- Step 1 regression guard: must stay 0
SELECT SUM(job_id IS NULL) FROM rule_violations WHERE ts >= date('now');

-- how often would the enforcer have fired
SELECT COUNT(*) FROM rule_violations WHERE check_name='draftNotCompliant';
```

### 5.2 `token_usage` table
`(ts, kind, model, input_tokens, output_tokens, cache_*)`. No cost column — compute at $3/$15 per M.
Use it before claiming anything about spend.

### 5.3 The share button and the corrections corpus
Artem presses "Share with Claude" in the app; it writes `share-with-claude.md` at the repo root **and**
(new this session) archives a permanent copy to `corrections/<ts>-<kind>-<jobid>.md`. It carries the job,
the analysis, the letter, both chat transcripts, and now the fired rule flags. Six entries so far.

**This is the input to Steps 3–5.** Do not let it rot, and do not build playbooks without reading it.

### 5.4 `sync_runs` table + ghost-gate
Added earlier in the session: proposal-status sync now logs each run, and `_auto_ghost_proposals()` only
ghosts when a `SyncRun` with `rows_scraped > 0` exists since the cutoff (fails OPEN if the table is
missing). Prevents a failed scrape from silently marking everything ghosted.

### 5.5 LLM job classification pilot
`_jobClassification` exists and drives `isAuditJob` (`JobDetail.jsx`, search `_jobClassification`), from
commit `f56eca5`. Regex remains the fallback. Not extended to `jobIsPpc`/`jobIsSeo`/`jobIsWebdev` — the
plan file (`.claude/plans/polished-exploring-cupcake.md`) says prove it small first.

### 5.6 Why chat tweaks never became knowledge
The cover-letter chat produces a revised letter; nothing persists the correction as training/context for
future generations. That is the gap Step 8 addresses, and the `corrections/` archive is its capture half.
The *use* half — feeding corrections back into the prompt — is **not built**.

### 5.7 Rule flags in the UI
`ruleFlags` state in `ProposalColumn`, populated from the same `_firedChecks` list that goes to telemetry,
cleared per generation, rendered as an amber strip under the letter, and included in the share snapshot
(backend renders it as its own `###` section). **See §6.3 — it currently reports pre-strip state.**

---

## 6. Known defects, unfixed — with evidence

### 6.1 Tier A dead code NOT deleted (deliberate)
The audit listed 19 never-fired checks (~76 LOC), `wrongHourlyRateAboveCeiling` (~28 LOC — but KEEP
`_QUOTED_RATE_PATTERNS`, still used), `vapeFabrication` (25 LOC), 4 dead strip functions, 4 dead judgment
checks. **Do not delete these yet.** "Never fired" came from telemetry that was 22% blind until §4.1 landed
this morning. Re-run the query against clean data after a week or two of real bidding, then decide.

### 6.2 Auto-inspect had a stale-closure bug (fixed, but read this)
The guard read `websiteText`/`websiteLoading`, neither of which was a dependency. On a job change the sync
effect resets them, but that setState is invisible until the next render — the effect ran in the same
commit, saw the *previous* job's summary, bailed, and never re-ran. **Auto-inspect was silently skipped for
every job reached from a job that already had a scrape.** Confirmed: 14177 worked (reached from a job with
none), 14176 did not (reached from 14178, which has one) and its letter then invented "the site's too thin
to rank", tripping `hasFabricatedDiagnosis`. Now guards on `job.website_summary` (the prop) alone.

### 6.3 The rule-flag strip reports PRE-STRIP state — needs an owner decision
Verified on job 14176: `missingPdfLabel` was shown to Artem but is **false** on the letter he received
(`_fixPdfCaseLabelMisattribution` had repaired it). The checks run before the strip chain — an ordering
that existed *only* because the checks fed the enforcer. A flag list with false entries manufactures
exactly the false confidence the enforcer was deleted for.

**Proposed fix (not done, needs sign-off):** move the strip chain to run **before** the check block so every
check evaluates the letter Artem actually sees. Not done blind because: the chain lives outside the try
block holding the checks; some checks may exist to catch what the strips introduce; `_gcShadow` writes its
own telemetry from inside the chain.

**Explicitly rejected:** re-testing a subset of predicates against the final text. That means duplicating
check logic, and duplicated predicates drifting apart is the most common defect class in this file — the
two strip chains, the two `_finalText` expressions, and `_MANUAL_AUDIT_CLAIM_RE`'s own comment all document
that exact failure.

Interim wording in the UI is honest but weak: "caught on the raw draft, before the deterministic strips ran".

### 6.4 The dash limiter manufactures comma splices
`_humanizeCasing` keeps the first spaced dash and rewrites every later one as a comma
(`++dashCount === 1 ? ' - ' : ', '`), implementing the "at most one spaced dash" anti-ChatGPT rule. It is
blind to what the dash was doing. Real shipped output: *"Conversion tracking, is GA4 / GTM logging the right
event…"*, *"Then the feed if you're running shopping, title/description quality…"* — five in one letter.
**Logged, not patched, on purpose:** the fix is for the first pass to write fewer dashes, not for a
post-processor to swap punctuation it cannot parse.

### 6.5 Brand names come out lowercase
"mr chef", "rex forestry", "golden state". `_extractProtectedProperNouns` reads only `description_full`;
these brands appear only in the **title** (deliberately excluded — headline casing) and in the scrape.

**I tested feeding the scrape in and rejected it, with evidence:** (a) "Mr Chef"/"Mr. Chef" is not extracted
by *any* variant — the abbreviation-with-period breaks the token pattern; (b) it would add 11 new "proper
nouns" from homepage marketing copy (`Tasty Dishes`, `Best Memories`, `Seasoning`, `Pepper`, `Fufu`,
`Ginger-Onion`) and force-capitalise them in every letter thereafter. The right fix is narrow brand
extraction from the title's own frame ("SEO for **X** website"). Not built.

### 6.6 A case study got relabelled to fit the vertical
Luxury Parfums — a perfume client — appeared as *"ecommerce seasonings/scents vertical"*. Its guard is
`/(perfume|parfum|fragrance|scent)/i`, so writing "seasonings/scents" satisfies the check literally while
defeating it. Hedging around a keyword guard is a general failure mode worth watching for.

### 6.7 Duplicate lead-ins that `_fixCaseCountClaim` misses
Job 14176: *"Experience + results:"* … case … *"Some comparable results:"* … cases. Not the orphan shape
(a case paragraph sits between them), so the repair does not fire. Same family, different shape.

### 6.8 Older, still open
- `/jobs/{id}/analysis` has **no GET route**, so `generate()`'s fetch silently 405s and the SKIP-gate it
  feeds never fires (`JobDetail.jsx`, search the analysis fetch). Real bug, deliberately kept separate.
- cli-bridge port collision between this repo and `baba-leada`.
- Upwork login needed for true view state of blackout proposals (ids 177–219) and 14 parked replies.
  **Do not attempt to log in on Artem's behalf — ask him.**

---

## 7. Working agreements with Artem — read before fixing anything

These were negotiated explicitly this session. Violating them is worse than doing nothing.

1. **Correctness bugs → fix immediately.** Fabricated claim, wrong price, mangled sentence, a mandatory
   business rule silently suppressed.
2. **Everything else → log it, do not patch it.** Tone, structure, wrong case study, length. Each ad-hoc
   regex has been making the next letter worse; that is the entire reason this rebuild exists.
3. **He shares letters via the button, plus a comment.** Ask for the *third* thing when he has it: **his
   version of the bad sentence**. Every fix in this repo so far encoded *my* guess at his intent. His
   rewrite is the ground truth Steps 3–5 must be built from.
4. **Never quote rates or retainers unless the posting asks.** His words: "We shouldnt even tell client any
   rates or retainer unless he specifically asked for it." Seven price checks are gated behind
   `_postingAsksRate` for this reason.
5. **Do not batch-generate letters to produce test data.** He bids normally; you use what that produces.
6. Do not enter credentials or log into anything for him.

---

## 8. What to do next

### 8.1 The fastest available win — playbook drafts from real data
Artem deferred this ("for now, let me just keep sending you real examples"), but the offer stands and it is
the highest-leverage move. There are **231 sent letters** in the DB (`proposals.sent_text`, >200 chars) plus a 16-entry `CASE_LEDGER`. The
clusters can be extracted deterministically (see the scenario-clustering block in the session's extract
script pattern) and shown to him as 7–10 named shapes with two or three real examples each. He judges the
*pattern* in one sitting instead of one letter at a time. That is Step 5's input, and it beats waiting weeks
for corrections to trickle in.

### 8.2 Immediate, small
- Get a decision on §6.3 (strip-before-check reorder). It is blocking the flag strip from being trustworthy.
- Watch whether letters get better or worse now the enforcer is gone. That is the live experiment. If a
  specific rule starts slipping that the enforcer used to catch, that is the signal to build a real
  detector for it — and it now has a clean surface to attach to.
- Re-query the never-fired checks (§6.1) once there is a week of clean telemetry.

### 8.3 Not yet started
Steps 4 (offer table + CTA slot), 5 (playbooks), 8's *use* half (feeding corrections back into the prompt).
An owner decision is also outstanding from the audit: **should the offer be woven into a sentence, or stand
alone as the closing line?**

---

## 9. Repo state — IMPORTANT

**Everything is uncommitted.** On top of `f56eca5`:

```
 WORKLOG.md                            | 1460 ++++++
 api/main.py                           |  224 ++-
 cli-bridge.js                         |   13 +-
 db.py                                 |   64 +-
 frontend/src/App.jsx                  |    2 +-
 frontend/src/components/Dashboard.jsx |    4 +-
 frontend/src/components/JobDetail.jsx | 1467 +++++-------
 frontend/src/components/Outcomes.jsx  |    8 +-
 upwork-enricher/background.js         |   55 +-
 upwork-enricher/bridge.js             |   26 +-
 upwork-enricher/proposal.js           |   76 +-
?? corrections/
```

Ask Artem before committing — he has not been asked yet, and the enforcer deletion is the kind of change he
may want to live with for a few days first. A revert of just that piece is a contiguous block replaced by a
comment in `JobDetail.jsx`.

The extension (`upwork-enricher/`) changed too. **Extension changes require a reload at
`chrome://extensions`** — background.js (MV3 durability + inspect-pending persistence), bridge.js
(`response.ok` checks), proposal.js (full-list scrolling).

---

## 10. Methodology — learned the hard way this session

Written down because each cost real time or shipped a real bug.

1. **Never count parentheses by eye in the strip chain.** Determine execution order by stubbing every
   function and evaluating the real expression in Node. When adding a call, take the paren shape from an
   existing correct chain rather than counting.
2. **Find block boundaries by measuring brace depth, not by reading indentation.** The first attempt at the
   enforcer deletion cut through closers belonging to blocks opened earlier and unbalanced the file.
   Guard every large deletion with assertions on the exact first and last line content.
3. **Test a regex change against the real corpus before shipping it.** All 437 postings are in the DB. Every
   regex widened this session was validated this way, and each time the false-positive count was zero —
   which is the only reason they were shipped.
4. **Verify against the real extracted pattern, not a hand-copied subset.** A hand-copied `COVER_TIMELINE_RE`
   produced one spurious failure that vanished against the real array.
5. **Test a fix before shipping it, and be willing to throw it away.** The proper-noun fix (§6.5) looked
   obvious, failed on inspection, and would have force-capitalised marketing copy in every letter.
6. **Shell quoting has corrupted content three times today.** `\\b` in a bash heredoc collapses and Python
   reads `\b` as a backspace (a regex landed in the file as literal 0x08 bytes); backticks inside
   `python -c "…"` get command-substituted and silently delete identifiers from prose. **Write prose and
   any code containing backslashes or backticks to a file with the Write tool, then append.** Build regex
   strings with `chr(92)` if they must pass through a shell.
7. **My own detector scripts have been wrong more than once.** A console-block scanner returned 0 where the
   audit said 49 (brace-matcher skipped past the region); a telemetry cross-check returned "none recorded"
   because it assumed a single-line array. When a script contradicts a careful prior finding, suspect the
   script first.
8. **Trust telemetry over reasoning about what fired.** `rule_violations` answered "why was this paragraph
   deleted" instantly in cases where reading the code gave the wrong answer.
