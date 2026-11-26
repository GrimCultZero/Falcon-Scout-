# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Sonnet 5.5 · Effort: high · New session: yes
Task id: F5 (clean-up from the 25 Nov evening run, emblem and motion, auto fit score, agency without PageSpeed, live-DB safety) · Written: 2026-11-25 22:10 Kyiv

## How to work
Read CLAUDE.md, METRO_PLAN.md (decision rows "PageSpeed by segment", "Email verification", "Personal emails", and
the whole section "Queued for the next fix task" at the end), and the newest METRO_HANDOFF.md entry (F4).
Branch metro/fix-5 from main. Start right away, no plan approval. Decisions and questions go into the handoff.
Stop and ask only if something would break a Hard rule.

## FIRST: live database safety (a real incident)
The F4 browser check wrote 3 test leads (Fone Test, Ftwo Test, Fthree Test; companies 404-406; metro_imports rows
2-3 "f4-new.csv") into the LIVE database although the handoff says a copy was used. Oleh removed the 3 leads by
hand on 25 Nov; delete the 3 companies and the 2 import rows if they are still there (nothing else). Find which
step wrote to upwork_jobs.db and say so. Then make it impossible: the scratch backend/launcher used for browser
checks refuses to start unless its DB path is a copy outside the repo's live file; add that as a Hard rule in
METRO_PLAN.md. Also: never import `api.main` against the live DB from a shell (it runs the startup prune).

## Items (do them all)
1. **PageSpeed only for niche campaigns** (decision row). Agency enrich runs skip it; the agency fit score does not
   count a missing PageSpeed as missing data ("measured %" must not drop).
2. **Fit score without a button.** Score automatically at the end of every enrich run and whenever a browser
   reading (ads, Business Profile, LinkedIn page) lands. Keep only a small "Rescore" for after a rules change.
3. **Result lines say only what happened.** No zero counts anywhere: "Enriched 20 - all 20 already had a website,
   nothing new found"; "Enriched 20 - 3 new websites found, 2 still missing". One helper for all result lines.
4. **Enrich labels.** Plain "Enrich next 20" / "Enrich next 50" (no "· 20 with a domain"); the with/without detail
   goes in the small line. "Retry domain (6 without)" next to "232 without" confuses: say "Retry domain (6 tried,
   not found)" and "232 not tried yet".
5. **One place per message.** A finished run's result shows in the header strip only; the floating notice and the
   bottom dock do not repeat it (the dock keeps details on demand). Errors and refusals: notice + strip.
6. **Emblem and motion** (queue item "Emblem"): `metro-badge.svg` is the main mark in the Metro header and the Metro
   favicon; `metro-wagon.svg` rides the progress strip's bar and sits on empty and loading states. Small animations:
   headlights pulse while something runs, tab/switch changes slide, the wagon moves with the bar. Transform/opacity
   only, nothing under prefers-reduced-motion. Do not redraw the two SVGs (they are the owner's choice); you may add
   classes or split them into layers if an animation needs it.
7. **Leads page lighter (first pass).** Without changing what exists, cut what is always visible: the "Enrichment
   and shortlist" box's buttons that F5 makes automatic go away or behind a small "More" menu; the browser-jobs line
   becomes one short status; long domain trails in the table collapse to one line with "details". Report before/after
   screenshots.

## Tests and checks
Tests for: agency runs skip PageSpeed and keep measured %, auto-score triggers, the result-line helper (no zero
counts), the scratch-DB guard. Browser check ONLY on a scratch backend with a COPY (the new guard must pass), with
before/after screenshots of the Leads page and the header with the badge. Whole suite: `node tests/run_all.mjs --python`.

## Finish
WORKLOG.md, DESIGN.md (F5), trim done items from the queue in METRO_PLAN.md. Commit (git add -u + new files by name:
include frontend/public/metro-badge.svg and metro-wagon-v1.svg, which the planning chat added), push, merge into
main, push, rebuild frontend/dist. Handoff entry. Tell Oleh to restart falconscout.bat and Ctrl+F5.
