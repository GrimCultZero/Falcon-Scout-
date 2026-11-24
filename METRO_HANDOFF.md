# Metro - handoff log

Claude Code writes here at the end of EVERY Metro task. Oleh then sends "W" to the planning chat,
which reads the newest entry, checks it against METRO_PLAN.md and writes the next task.

## Rules for Claude Code
- Append a new entry at the BOTTOM. Never edit or delete earlier entries.
- Write it as the last step of the task, after tests, WORKLOG.md and the commit/push.
- Be exact and honest: what was NOT done, and anything you could not verify, matters most.
- No secrets, no lead data (names, emails, LinkedIn URLs) in this file.

## Entry template (copy it for each task)

### <YYYY-MM-DD HH:MM Kyiv> - Phase <N>, <task name> - <DONE | PARTIAL | BLOCKED>
- Model and effort used:
- Branch / commits: <branch>, <hash> <message> (one line each)
- Done: <numbered, matching the plan's step numbers>
- Not done / deferred, and why:
- Acceptance checks: <each check from METRO_PLAN.md: PASSED / FAILED / NOT RUN, with evidence>
- Tests: <suites run, counts passed/failed>
- Files changed: <paths>
- Decisions made on my own (need Oleh's OK):
- Questions for Oleh:
- What Oleh must do by hand before the next task (reload extension, restart, etc.):
- Suggested next task:

---

### 2026-11-24 20:24 Kyiv - Phase 0, Foundation and safety (steps 1, 3-8) - PARTIAL
- Model and effort used: Claude Opus 5.5 (claude-opus-5-5) in Claude Code; the effort setting is not visible to me.
- Branch / commits: metro/phase-0 (from generator-rebuild 549d68c), pushed to origin.
  - 4b33028 feat(metro): Phase 0 foundation - extension 5180-only, /metro router, header switch, metro_* tables, suppression import
  - 1985251 fix(metro): proxy /metro/ only, so /metro-wagon.svg is served by Vite, not sent to the backend
  - 666e512 chore(frontend): React 19 (19.3.1) - Metro Phase 0 step 3, alone so it can be reverted
  - 1aafe35 docs(metro): Phase 0 acceptance checks in WORKLOG.md; add METRO_PLAN.md and METRO_HANDOFF.md
- Done:
  1. Extension cross-talk: Falcon Scout Enricher 5.18 injects bridge.js and sends cockpit:* messages to port 5180 only; popup looks for 5180 only. Test-pinned.
  3. React 19.3.1, alone in 666e512; no code change needed; build ok; Upwork side checked in the browser.
  4. api/metro/ router (one mounting line in api/main.py), frontend/src/metro/, tests/metro/ (both runners include it), Vite proxy '/metro/'.
  5. Header switch Falcon Scout | Metro: no reload, App.jsx stays mounted, remembered (localStorage + #metro); five empty Metro tabs in IT Force colours, Manrope (local), wagon mark.
  6. Eleven metro_* tables with their own migrations; jobs/proposals untouched (schema identical to the pre-change backup). Live DB has the tables.
  7. Suppression import (add-only, idempotent, dry run by default). Applied: the member-id file, 1,817 ids (the plan's 1,818 counts the header line). IT Force clients: importer ready, list not received. Upwork clients: dry run only, see questions.
  8. DESIGN.md section 25 "Metro"; CLAUDE.md points to the Metro docs.
- Not done / deferred, and why:
  - Step 2 (DevScout extension rename): Oleh's, per instruction.
  - Upwork clients from proposals are not applied to the suppression list: proposals/jobs hold no client name, company or domain; the 13 domains found are of mixed quality. Needs Oleh's decision.
  - The running backend was not restarted (the session's safety check refused stopping Artem's live process), so the live app has no /metro routes yet and the live vite preview runs the old proxy config. Metro's chip shows "backend not reachable" until a restart.
  - Backend CORS still allows 5173/5174 origins (outside step 1; harmless, can be removed in a later task).
- Acceptance checks:
  - Every Upwork tab still works (feed, analysis, letter, Outcomes, Dashboard): PASSED on React 19 (live production build + dev server): feed 800 jobs, cached analyses render, a saved letter loads (2,153 chars = DB), Outcomes/KB/Dashboard/Settings render, no console errors. No new analysis or letter generated (no paid calls).
  - Both test suites pass: PASSED, 65 JS suites and 41 Python suites, 0 failing.
  - DevScout + Falcon Scout in one Chrome profile, no cross-talk in either console: NOT RUN live (needs the extension reloaded in Oleh's Chrome). Static evidence only (manifest, notifyCockpit, popup, test; DevScout's extension never reaches 5180 by itself).
  - The switch flips sides without a reload: PASSED (window marker and the open letter survive the round trip; reload stays on the side shown; #outcomes deep link shows Falcon Scout).
- Tests: node tests/run_all.mjs --python: 65 JS passed / 0 failed; 41 Python passed / 0 failed.
- Files changed: upwork-enricher/{manifest.json,background.js,bridge.js,popup.js}; api/main.py (1 line); api/metro/{__init__,db,router,suppression}.py; tools/metro_import_suppression.py; frontend/src/{main.jsx,App.jsx}; frontend/src/metro/{SideShell,SideSwitch,MetroApp}.jsx, theme.js, lib/side.js; frontend/public/metro-wagon.svg; frontend/{vite.config.js,package.json,package-lock.json}; tests/{run_all.mjs,run_all.py,extension-ports.test.js,geo-restriction.test.js,inbox-scrape.test.js}; tests/metro/{side-switch.test.js,test_metro_foundation.py}; DESIGN.md, CLAUDE.md, INSTALL.md, WORKLOG.md; METRO_PLAN.md and METRO_HANDOFF.md added.
- Decisions made on my own (need Oleh's OK):
  - Metro uses its own SQLAlchemy base and engine on the same SQLite file, so it never imports api/main.py.
  - The side is also kept in the URL (#metro): App.jsx writes its view into the hash, so without it a reload on Metro came back on Falcon Scout.
  - Manrope from the @fontsource/manrope npm package (local, no external font request).
  - metro_settings is key/value JSON; defaults: week mode metro, scrape cap 60 (max 80), test mode on for email and LinkedIn, email cap 20.
  - Two older tests now accept extension version 5.17 or later instead of exactly 5.17.
- Questions for Oleh:
  - Upwork clients in the suppression list: apply the 494 upwork_job entries only, also the 13 domains, or wait for a better key?
  - Keep React 19 (666e512) or revert it?
- What Oleh must do by hand before the next task:
  - Restart falconscout.bat (backend gets /metro, preview gets the /metro/ proxy).
  - Reload Falcon Scout Enricher at chrome://extensions (must show 5.18), hard-refresh the 5180 and 5173/5174 tabs, then check both consoles for cross-talk (acceptance check 3).
  - Rename DevScout's extension in baba-leada (step 2) and commit it with push.bat.
  - Merge metro/phase-0 when happy (it also carries generator-rebuild's unmerged commits up to 549d68c).
- Suggested next task: Phase 1 (campaigns, CSV import with DevScout's column detection, dedup against suppression and active campaigns, layer 0 persona score, Leads table), after acceptance check 3 passes and the Upwork-clients question is answered.

---
