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

### 2026-11-24 21:25 Kyiv - Phase 1, Campaigns, import, persona score (steps 1-7 + Phase 0 step 5 finish) - DONE (one acceptance check PARTIAL)
- Model and effort used: Claude Sonnet 5.5 (claude-sonnet-5-5) in Claude Code; the effort setting is not visible to me.
- Branch / commits: metro/phase-1 (from metro/phase-0), pushed to origin.
  - a63c230 feat(metro): Phase 1 - campaigns, CSV import with dedup, layer 0 persona score, launch kit; finish header switch
  - d11f52e docs(metro): Phase 1 acceptance checks, DESIGN section 25 additions, METRO_PLAN hard rule (no Upwork leads)
- Done:
  - Phase 0 step 5 finished: active half dark on Falcon Scout / teal #005669 with white text on Metro; attention-dot slot on the inactive half (off); Ctrl+M; 3px cyan top edge; week-mode chip and "Visits 0 of 60" chip (display only). Checked in the browser pane.
  - METRO_PLAN.md: hard rule "Metro never imports leads sourced from Upwork"; data-model rows for the two new tables; step 7 and step 6 notes; React 19 item ticked.
  - Upwork suppression: the 494 upwork_job ids are not imported; the 13 domains are suppression candidates in Metro Settings, approve / reject one by one, nothing suppressed until approved.
  1. Campaigns: agency / niche, region, month, status, brief (who, pains, case tags, do-not-claim), offer; Campaigns tab.
  2. CSV import into a campaign with DevScout's column detection (ported to Python); preview (dry run) first, then import.
  3. Dedup by member id, profile URL, email, then name + company; against suppression and other campaigns.
  4. Layer 0 persona score from the CSV only, rules editable and validated in Settings, Rescore, "Keep anyway".
  5. Leads tab with the four pipeline cards (only Import live) and the "what you see runs" rule.
  6. Linked Helper exports, comma and semicolon: invited / connected status, emails from the export marked linkedhelper, `list_source` per import.
  7. Launch kit per campaign (profile variant, case studies, sample audits, brief, offer) and a dated launch checklist; Start campaign shows open steps.
- Not done / deferred, and why:
  - Nothing was imported into the live database (Oleh does the first real import). The Phase 1 screens were checked against a scratch backend on another port, not the live app.
  - Enrich / Write / Send cards are disabled placeholders (Phases 2, 3, 4-5). Week mode is display only, no switch yet (Phase 2 with the pop-up and Linked Helper check).
  - CRM and Senders tabs are still empty.
- Acceptance checks:
  - Europe Linked Helper export imports with invited/connected status and its emails: PARTIAL. Scratch DB, file `...2026-11-08T12-19-41` (130 rows, `;`): status 100 invited / 4 connected / 26 not invited, no mapping needed. That file has no emails; the August 1st-degree export has 101 of 319, kept as linkedhelper. BUT every one of the 130 rows is on the 1,817-id "already contacted" list, so all 130 import as `suppressed`. And D:\ITForce\Metro\imports is empty (the sample audits and the US_CA CSVs are in `Claude outputs`).
  - US agency list imports with zero manual column mapping: PASSED (495 rows, 495 stored: 421 keep / 73 review / 1 junk).
  - Anyone in the 1,818 list is marked suppressed, never deleted: PASSED (1,817 ids; the plan's 1,818 counts the header).
  - Re-importing the same file adds nothing: PASSED (US: added 0, duplicate 495; Europe: added 0, duplicate 130).
- Tests: node tests/run_all.mjs --python: 66 JS suites passed / 0 failed; 42 Python suites passed / 0 failed. New: tests/metro/test_metro_phase1.py (97 checks), tests/metro/metro-ui.test.js; extended side-switch.test.js and test_metro_foundation.py.
- Files changed: api/metro/{db,router}.py and new {campaigns,candidates,csvimport,leads,persona,routes_p1}.py; frontend/src/metro/{MetroApp,SideShell,SideSwitch}.jsx, theme.js, lib/side.js, new api.js and components/{CampaignsTab,LeadsTab,ImportDialog,SettingsTab,ui}.jsx; tests/metro/{side-switch.test.js,test_metro_foundation.py,test_metro_phase1.py,metro-ui.test.js}; METRO_PLAN.md, DESIGN.md, WORKLOG.md, METRO_HANDOFF.md.
- Decisions made on my own (need Oleh's OK):
  - Two tables beyond the plan's eleven: metro_imports (audit counts, no lead data) and metro_suppression_candidates; schema_version 2.
  - Column detection is Python in api/metro, not the JS lift the plan table names (dedup and suppression run server-side).
  - A campaign holds its leads and companies while its status is not `done` (draft and paused count, the plan says "active"); a finished campaign's leads are not re-imported either.
  - Starting a campaign shows the checklist and records dates but does not block on open steps.
  - Name + company is the weakest dedup key: two records with different member ids or profiles are two people (13 such pairs in the real US list), reported as same_name_other_profile.
  - LH emails are stored email_verified = false (verification is Phase 2 step 8).
  - An approved suppression candidate cannot be un-approved through the API (a rejected one can still be approved).
- Questions for Oleh:
  1. The Europe export's people are all on the already-contacted list, so importing them marks them all suppressed, including the 4 who accepted. For the channel-order decision (accepted -> LinkedIn messages) these people must stay messageable. How should a Linked Helper export of our own campaign relate to that list? Options: (a) exempt entries that came from that file when the lead's own status is invited/connected, (b) re-source the list with only the people who must never be written to, (c) leave as is. I changed nothing in code.
  2. Which file is "the current Europe export"? D:\ITForce\Metro\imports is empty; I used the 2026-11-08T12-19-41 file.
  3. Only 1 of 7 Linked Helper exports has emails. Is the email finder (Linked Helper credits or Apollo) decided yet? It affects Phase 2.
- What Oleh must do by hand before the next task:
  - Nothing is required to run. The live backend already loaded the new code and has the Phase 1 tables (empty); restart falconscout.bat to be sure and rebuild is already done (frontend/dist).
  - Import the first real list yourself: Metro > Campaigns > New campaign, then Leads > Import CSV (preview first).
  - Open Settings > Suppression list > "Look for Upwork clients' domains" and approve or reject the 13 domains.
  - Reload the 5.18 extension and check the console cross-talk (Phase 0 check 3 is still open); rename DevScout's extension (Phase 0 step 2).
  - Another process had uncommitted edits in api/main.py, JobDetail.jsx, frontend/src/lib/models.js and tests/test_model_config.py (a Haiku 5.5 switch). I did not touch or commit them.
- Suggested next task: answer question 1, then Phase 2 (domain resolution, website scan, PageSpeed, Ads Transparency, LinkedIn extension fork with the week gate).

---

### 2026-11-24 21:12 Kyiv - Phase 2, Enrichment (steps 1-8, week switch, Phase 1 answers) - PARTIAL (all code and tests done; live checks need Oleh's Chrome)
- Model and effort used: Claude Sonnet 5.5 (claude-sonnet-5-5) in Claude Code; the effort setting is not visible to me.
- Branch / commits: metro/phase-2b (from main), merged into main and pushed.
  - 9a42d71 Merge metro/phase-2 (Metro Phases 0-1) into main (Step 0; the only conflict was WORKLOG.md, both appended entries kept; the duplicate model commits changed nothing)
  - 6935a67 feat(metro): Phase 2 - enrichment (all of Phase 2 in one commit)
  - f0b8334 Merge metro/phase-2b (Metro Phase 2: enrichment) into main
- Done:
  0. Merge of Metro Phases 0-1 into main, both suites run, frontend/dist rebuilt, main pushed. Oleh must restart falconscout.bat.
  A. Phase 1 answers: suppression is hard / soft (`metro_suppression.strength`; the migration classifies the 1,817 already_contacted rows as soft with their source label kept; a soft hit on a plain CSV is status `previously_contacted`, a soft hit on an invited / connected row of our own Linked Helper export stays usable; a hard hit is `suppressed`); recorded in METRO_PLAN.md and DESIGN.md section 25. Phase 1 acceptance wording now says "USA CAN Claude" (US/Canada). Email finder = Linked Helper first, Apollo fallback.
  B. Week mode: header switch with a confirm pop-up in both directions; a Metro week is refused while `linked-helper.exe` runs (Windows process list, the name is a setting) or if the list cannot be read; in a Linked Helper week the backend hands out no extension job at all; the visits chip is the backend's counter.
  1. Domain resolution: CSV, email-finder export, AI lookup (the model only proposes; the site's title / headline must carry the company name), LinkedIn company page; the source is stored.
  2. Website scan, backend side, no browser, at most 5 pages: Google Ads / GA4 / Tag Manager / Universal Analytics / Meta pixel / LinkedIn insight tags, call tracking, booking tool / call to action / form, CMS, service and location pages, blog freshness, public emails, marketing terms.
  3. PageSpeed (Google API, mobile score, optional key typed in Settings and never returned); Ads Transparency and Google Business Profile are read in the browser by the extension, queued by the backend, paced; everything is cached per domain with lifetimes in Settings; a failed reading never replaces a good one.
  4. Extension `metro-linkedin/` (new, v0.1.0, forked from DevScout's approach, DevScout untouched): LinkedIn profile and company readers, account registry (identity read from linkedin.com/feed, no extra visit), per-account caps (default 60, max 80), the week gate enforced by the backend and repeated by the extension, Senders tab.
  5. Ahrefs rekeyed to domain, niche campaigns only, queued for the shortlist only, 15 jobs a day, run in Oleh's own browser seat.
  6. Layer 1 and layer 2 scores from editable rules (agency and niche sets, in Settings), a coverage figure, no fit score for an unmeasured lead, a shortlist view with a threshold.
  7. AI hooks through `/claude` from a numbered evidence list; code throws away hooks with invented numbers, URLs, prices, hedges, do-not-claim phrases or missing evidence ids; each stored hook carries its stored field(s), source reference and the date it was read; angle and an allowed case tag.
  8. Email-finder round trip: export the shortlist as a Linked Helper list, import Linked Helper results (Apollo CSV as fallback), emails stored `unverified`; `verified` only when the provider says so or Oleh marks it; suppressed addresses refused; a free DNS check gives `domain_ok` / `invalid`, never `verified`; `emailable()` is the one test Phase 4 must use.
- Not done / deferred, and why:
  - Nothing was run live in Chrome: the extension's LinkedIn / Google Maps / Ads Transparency / Ahrefs selectors are best effort and were tested only on synthetic page text. Expect to adjust them after the first live run.
  - The Linked Helper list importer's exact column expectations are unverified (the list has `profile_url`, names, company, title and `metro_lead_id`); the real results file shape is also unseen. Results are matched by `metro_lead_id`, member id or profile URL.
  - No real model call and no real company site were used (tests use stand-ins and local pages). The scratch UI run scanned two dead `.invalid` domains only.
  - Business Profile is read from Maps in the browser; Google's Places API (paid) was deliberately not used. No Apollo API call exists anywhere.
  - The CRM tab and everything from Phase 3 on are untouched; the Write and Send cards stay disabled.
- Acceptance checks:
  - 20-lead niche sample, every hook traces to a stored field and date: PASSED on a synthetic sample (a stand-in model that invents facts; none reached the ledger). NOT RUN with the real model and real sites.
  - No LinkedIn visit in a Linked Helper week: PASSED (140 asks with ~60 jobs queued: no job, no visit row, no counter change; the extension also refuses by itself). The pop-up refusing a Metro week was seen for real, because this machine has linked-helper.exe running.
  - Visit counter never passes the cap: PASSED (400 asks, cap 60: 60 counted; the next Kyiv day restarts; an account cap of 2 holds; above 80 is refused).
  - Live database migration: PASSED on a COPY of upwork_jobs.db (1,817 rows -> soft, source kept, 15 Metro tables, jobs untouched). The live file was not written; it migrates on the first /metro call after the backend restarts.
- Tests: node tests/run_all.mjs --python: 68 JS suites, 0 failing; 43 Python suites, 0 failing. New: tests/metro/test_metro_phase2.py (about 180 checks), extension-parsers.test.js, week-switch.test.js. Updated: test_metro_foundation.py (15 tables), metro-ui.test.js (Enrich live, Senders a real tab).
- Files changed: api/metro/{db,leads,suppression,router,routes_p1,csvimport}.py; new api/metro/{gate,webscan,pagespeed,enrich,results,scoring,hooks,emailfinder,aiclient,routes_p2}.py; tools/metro_import_suppression.py (--strength); frontend/src/metro/{MetroApp.jsx, components/{LeadsTab,SettingsTab,ImportDialog}.jsx}, new components/{WeekSwitch,SendersTab,EnrichPanel,EnrichSettings}.jsx; new metro-linkedin/ (manifest, background, limits, parsers, scrape, register, popup, li-experience, icons); METRO_PLAN.md, DESIGN.md, CLAUDE.md, WORKLOG.md, METRO_TASK.md; the tests listed above.
- Decisions made on my own (need Oleh's OK):
  - Google Business Profile is read from Maps in the browser (the official API is paid); the question was in my plan and not answered, so I used the no-cost option.
  - "Verified" email = the provider says so, or Oleh marks it; the free DNS check never verifies. A verified address is never replaced; an unverified finder result never replaces an address already held; a provider-verified one replaces an unverified one.
  - Any active LinkedIn account may take LinkedIn jobs (scrapers are not preferred in code): Artem's account is the only one that exists today and must be able to scrape. Oleh can switch it off or cap it on the Senders tab. In the plan's wording only extra accounts are scraper-only.
  - A Linked Helper week blocks ALL extension jobs (also Ads Transparency, Business Profile and Ahrefs), following the plan's "no scrape jobs at all"; the backend's own website scan and PageSpeed keep running because they make no LinkedIn visit.
  - Defaults: shortlist line 50, Ahrefs 15 jobs a day, cache lifetimes 30 / 14 / 14 / 30 / 30 / 30 days, pacing 30-75 s per LinkedIn page. The default fit rules are my first proposal and need Oleh's eye (Settings, Fit rules).
  - Two tables added (metro_scrape_jobs, metro_visit_log; schema_version 3, 15 tables).
- Questions for Oleh:
  1. Are the default fit rules (agency: names PPC / Google Ads / SEO, fresh blog, runs ads; niche: tracking gaps, slow site, few reviews, ads running) a good first guess, and is 50 the right shortlist line?
  2. Which Chrome profile is Artem's, and which would be a scraper later? Only Artem's account exists now.
  3. Does Linked Helper's list importer accept `profile_url` plus extra columns as the export has them? If not, send me the header Linked Helper wants.
- What Oleh must do by hand before the next task:
  - Restart falconscout.bat (new routes; the suppression migration runs on the first /metro call). Close Linked Helper before switching to a Metro week.
  - chrome://extensions > Developer mode > Load unpacked > the `metro-linkedin` folder, in each Chrome profile that should scrape; open linkedin.com/feed once in it; in the extension popup type a profile name and switch "Take jobs from Metro" on.
  - Metro > Senders: make Artem's account the messenger, check the caps. Metro > Settings: optionally paste a PageSpeed API key; review the fit rules.
  - Import the USA CAN Claude export into its campaign, then try Enrich on a few ticked leads, Score, look at one lead's evidence, then queue the deep readings in a Metro week.
- Suggested next task: after the live run above, fix whatever the selectors miss, then Phase 3 (chains and export for the first live campaign), starting from the shortlist, the hooks and `emailable()`.
