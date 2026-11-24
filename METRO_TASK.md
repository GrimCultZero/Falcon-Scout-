# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Sonnet 5.5 · Effort: high · New session: yes
Task id: P2 (merge + Phase 2) · Written: 2026-11-24 22:10 Kyiv

## Before anything
Read CLAUDE.md, DESIGN.md, WORKLOG.md, METRO_PLAN.md and the newest entry of METRO_HANDOFF.md
(METRO_PLAN.md and METRO_HANDOFF.md are on branch metro/phase-2; the folder may be on another branch).
Show Oleh your plan as a short list and wait for his OK before changing anything.

## Step 0 - merge Metro into main
Earlier two sessions worked in this folder at once; nothing is lost. main has the Upwork model commits
(549d68c, 6583a59, 1bdaad0); metro/phase-2 has Metro Phases 0-1 plus duplicate copies of two of those
model commits (66eb19e, 654e883). Check out main and merge metro/phase-2 into it. The duplicates carry
the same changes and should merge cleanly; if any conflict is not trivially identical, stop and report.
Run both test suites, rebuild frontend/dist, push main. Tell Oleh to restart falconscout.bat.
From now on all work starts from main. Create metro/phase-2b from main for the rest of this task.

## Answers to the Phase 1 questions
1. Split suppression into two kinds; record it in METRO_PLAN.md and DESIGN.md.
   - Hard (never contact): IT Force clients, opt-outs, bounced addresses (address only), approved Upwork domains.
   - Soft "previously contacted": the already_contacted list (1,817). Excluded from any new invite list
     exported to Linked Helper; but a lead imported from our own Linked Helper campaign export keeps its
     invited/connected status and stays usable; its re-contact timing is governed by the cycle rules (Phase 6).
     Re-classify the existing entries; keep their source labels.
2. The current campaign is "USA CAN Claude" (US/Canada), not Europe. Fix the Phase 1 acceptance wording;
   Oleh imports its export himself.
3. Email finder: Linked Helper first (its Data credits), Apollo only as a fallback. Phase 2 step 8 is the
   Linked Helper round trip: export the shortlist's profile URLs in a Linked Helper import format, import
   its results, store emails as unverified until checked.

## Then Phase 2, steps 1-8 (METRO_PLAN.md)
Including the week-mode switch in the Metro header with the confirm pop-up and the check that the
Linked Helper program is not running (Windows process list). Paced and cached per domain; no LinkedIn
visit in a Linked Helper week; no paid service without Oleh's OK. Ahrefs: Oleh's own Standard seat in
the browser, short batches.

## Finish
Run both test suites; write Phase 2's acceptance checks in WORKLOG.md; commit (including this file);
push; merge into main if all tests pass; as the very last step append your entry to METRO_HANDOFF.md.
