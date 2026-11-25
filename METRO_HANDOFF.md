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

---

### 2026-11-25 14:45 Kyiv - F1, Fixes from Oleh's first live test (items 1-10) - DONE (live Chrome and live-site runs not done)
- Model and effort used: Claude Sonnet 5.5 (claude-sonnet-5-5) in Claude Code; the effort setting is not visible to me.
- Branch / commits: metro/fix-1 (from main), merged into main and pushed.
  - dfaded7 fix(metro): F1 items 1-2 - re-import fills empty fields, stable Sales Navigator keys
  - 13e36c3 feat(metro): F1 item 3 - delete a draft campaign, remove ticked leads
  - 53ee53f fix(metro): F1 item 10 - Linked Helper week blocks LinkedIn jobs only
  - 500dacc feat(metro): F1 items 5-6 backend - explicit scopes, ids route, enriched filter
  - d2663a1 feat(metro): F1 item 9 backend - draft a niche brief from the niche and the KB's case studies (never saved)
  - af02aab feat(metro): F1 items 4-10 - front end (list refresh, scopes, Enrich next N, create button, line filter, templates), docs, tests
  - 76802a1 Merge metro/fix-1 into main (main is pushed; frontend/dist is rebuilt)
- Done (numbers = METRO_TASK.md):
  1. Re-import fills gaps: a row matching a lead in the same campaign fills every EMPTY field (name, title, headline, summary, company, location, member id, email, profile URL; a second URL form goes to the raw data), never overwrites, status only forward. Layer 0 runs again (not on a lead a person decided), the company record is made, and suppression is checked again with the new company / domain / email (a hard hit suppresses). The import summary has `filled` and `filled_fields`.
  2. Sales Navigator: the key of `/sales/people/<id>,<search>,NAME_SEARCH` drops the changing tail; rows match across files by member id (the real files share all 326).
  3. Delete: a draft campaign can be deleted (confirm pop-up with lead and import-record counts); ticked leads can be removed (confirm). Only Metro's own tables; companies and the suppression list stay; a lead with a sent message or reply is kept and reported; a non-draft campaign is refused.
  4. The Leads campaign list reloads whenever the tab is shown and after any campaign change.
  5. "What you see runs": one resolver for every card button (ticked rows, else every row the filters show, asked from the backend). Enrich, Score, queue-deep, hooks and Rescore send those ids; an explicit empty list now means nobody (before, null / empty meant the whole campaign, which was the bug).
  6. "Enrich next 20" and "Enrich next 50": best of the current filter and sort, usable, company not enriched yet, persona keep first; the number that remain is shown.
  7. The empty Leads page has a "Create campaign" button (opens the chooser in Campaigns).
  8. The header "Agency line / Niche line" are toggles that filter Campaigns and Leads; the active one is highlighted; click again for both.
  9. New campaign asks agency or niche. Agency arrives with your brief word for word (editable). Niche has "Draft the brief": the niche and the KB's case-study titles and tags go through `/claude`; the code keeps only KB tags, takes case-study titles and URLs from the KB by id, drops a pain with a figure, adds the standing do-not-claim list. Nothing is saved until Create.
  10. A Linked Helper week blocks LinkedIn jobs only (backend gate, the extension, the pop-up text); Ads Transparency, Maps / Business Profile and Ahrefs run. METRO_PLAN.md and DESIGN.md updated.
- Not done / deferred, and why:
  - Nothing was run in your Chrome. The new screens were driven in the built-in browser against a COPY of the live database (a scratch backend on port 8001; the live backend and live database were not touched; site fetchers were stubbed so no real website was visited).
  - The Linked Helper email export (Emails dialog) is still the whole shortlist, not the ticked rows: it is defined as the shortlist. Say if you want it scoped too.
  - Leads with no company cannot be enriched and are not counted in "not enriched yet".
- Acceptance checks:
  - Re-import fills gaps: PASSED. Synthetic test (5 nameless rows + TierA-shaped rows: 5 filled, 3 added, same file again 0 and 0; a present name is never overwritten; status never goes back; a locked verdict survives). On a copy of the live DB with the REAL files: TierA first (495 added), then the real 326-row Linked Helper export: 0 added, all 326 matched by member id.
  - Delete and the redo flow in the browser: PASSED on the copy (the pop-up showed 326 leads and 1 import record; "USA CAN Claude" was created from the agency template; its brief was stored word for word).
  - What you see runs: PASSED in the browser: filter "seo" -> "Enrich 7 shown"; the request carried exactly those 7 ids. "Enrich next 20" enriched 20 companies (32 leads); the counter went 494 -> 462.
  - Line filter and Create button: PASSED in the browser. Draft the brief: PASSED live through the real `/claude` (dental clinics, US): sensible who, 3 pains, KB tags, 3 KB case studies (one, a beauty-sector Google Ads case, is a loose fit: edit it out), offer; nothing saved. Note this made one real model call through your live backend.
  - Linked Helper week: PASSED in tests (300 asks: no LinkedIn job, no visit counted; an Ads Transparency job is handed out; the extension refuses LinkedIn kinds only).
- Tests: `node tests/run_all.mjs --python`: 69 JS suites, 0 failing; 44 Python suites, 0 failing. New: tests/metro/test_metro_fix1.py (about 60 checks), tests/metro/fix1-ui.test.js. Updated: test_metro_phase2.py (Linked Helper week test), tests/no-top3-claim.test.js (see decisions).
- Files changed: api/metro/{leads,suppression,gate,db,enrich,scoring,routes_p1,routes_p2}.py; new api/metro/{removal,briefdraft}.py; frontend/src/metro/{MetroApp.jsx, components/{LeadsTab,CampaignsTab,EnrichPanel,WeekSwitch}.jsx, lib/templates.js}; metro-linkedin/{limits,background,popup}.js; METRO_PLAN.md, DESIGN.md, WORKLOG.md, METRO_TASK.md; the tests above.
- Decisions made on my own (need Oleh's OK):
  - "Top 3% of Google Partners" is in the agency template's Do not claim list, as you wrote it. A guard test forbids that text anywhere in the app's sources, so I exempted exactly two files (the template and the brief drafter); the test checks they mention it only inside the do-not-claim list.
  - New column `metro_companies.enrich_tried_at` (set whenever an enrichment pass is attempted, even with no domain), so a company that cannot be resolved is not picked again by "Enrich next N". Added by the automatic migration on the first /metro call.
  - Hooks run on rows merely shown are limited to the shortlisted; hooks on ticked rows ignore the threshold (your own choice), as before.
  - The agency template keeps "Allowed case tags" empty (your brief had none); add tags in the campaign if you want hooks to pick a case tag.
- Questions for Oleh: should the Linked Helper email export also follow the ticked / shown rows? Is the third case study in a niche draft worth restricting to a closer industry match?
- What Oleh must do by hand before the next task:
  1. Restart falconscout.bat (new routes; the new column migrates on the first /metro call).
  2. Redo the import, exactly in this order:
     a. Metro > Campaigns > open "US CAN agencies" > "Delete campaign" > confirm (it is a draft with 326 nameless leads).
     b. New campaign > Agency line > name it "USA CAN Claude", region US/CA, check the pre-filled brief, Create.
     c. Metro > Leads > Import CSV: first `Claude outputs/US_CA_agency_owners_TierA.csv` (preview, then import; expect 495 added), then the Linked Helper export(s) (`Profiles downloaded ... .csv`; they match TierA by member id, so they add nothing new, and carry the invited / connected status once Linked Helper has visited the profiles).
  3. Try "Enrich next 20" first (it scans real sites, paced) before using the bigger buttons; then Score and look at the shortlist.
- Suggested next task: the first live Chrome run (extension selectors, Linked Helper import column format), then Phase 3 (chains and export for the first live campaign) from the shortlist, hooks and `emailable()`.

---

### 2026-11-25 17:30 Kyiv - F2, Domain finder, progress dock, fixes from the 25 Nov live run - PARTIAL (everything built and tested; the AI web-search step could not be measured live: the Claude subscription hit its weekly limit)
- Model and effort used: Claude Sonnet 5.5 (claude-sonnet-5-5) in Claude Code; the effort setting is not visible to me.
- Branch / commits: metro/fix-2 (from main), merged into main and pushed.
  - cfb802b feat(metro): F2 - domain finder (name patterns, web-search AI lookup, LinkedIn), backend-owned progress dock, fixes from the 25 Nov live run
  - 11f806b Merge metro/fix-2 into main (main is pushed; frontend/dist is rebuilt)
- Done (numbers = METRO_TASK.md):
  1. Domain finder, cheapest first, each guess accepted only when its fetched site is that company: stored data / email finder / a LinkedIn page already read; **name patterns** (at most 6: whole name, distinctive part, hyphenated, legal and generic words dropped in some, `.ca` too for Canadian places; paced; first verified hit wins; source `name-pattern`); **AI lookup with web search** (Sonnet, source `ai-lookup`); **LinkedIn** (queued only for persona `keep` leads: a `linkedin_profile` job reads the current company's LinkedIn page URL, then the existing `linkedin_company` job reads the website; the week gate decides, counted against the visits, nothing runs in a Linked Helper week). Each company keeps its trail; the table shows "no domain - tried: name-pattern x6, ai: no answer (...), linkedin: queued the profile (Metro week only)" and a **Retry domain** button (per company and bulk, only for companies without a domain). Migration (schema 4, once): the companies attempted with no domain become eligible for "Enrich next N" again (19 on the copy). Failures of the AI step are logged with the real reason ("call failed: CLI bridge error: ...", "no answer (the model's reason)", "answer was not JSON", "X rejected (parked / does not carry the company name)").
  2. Progress dock: one dock for import, enrich and "Enrich next N", score fit, persona rescore, hooks, email import and the deep readings (followed as the extension returns jobs). The backend owns it (`GET /metro/progress`, `POST /metro/progress/{id}/stop`, `api/metro/progress.py`), so a reloaded tab shows a run that is still going (seen in the browser). DevScout's `ProgressDock.jsx` and `progressJobs.js` copied and restyled in Metro colours: nothing under 1 s, a filling bar with "7 of 20" and ETA, an indeterminate bar with elapsed time when the total is unknown, "Enriching: Rank Media Agency, 7 of 20 - website scan", Stop only where an abort exists (enrich, hooks), one result line ("Enriched 20 - 17 domains found, 3 not found").
  3. Small fixes: "Score fit N shown" vs "Rescore persona (N shown)" (each tooltip names the other score); "Enrich next 20" is the primary button, "Enrich all N shown" confirms above 50 and shows the count; "just enriched (last run)" filter and sort, a badge on the row and a "Show just enriched" button; the Linked Helper email export takes the ticked rows, else the shown rows that are shortlisted.
- **Live run on a COPY of the live DB (the 19 real companies, real site fetches, no LinkedIn job, no PageSpeed, no browser jobs):** name patterns resolved **6 of 19**: agencyperspective.com, bebolddigital.com, seonational.com, theprofound.agency, paidmediapros.com, clickcatalystmedia.com (titles checked by hand for the first two, plausible for the rest). With FIREBELLY (found by the AI on 25 Nov) that is 7 of 20, against 1 of 20 before. Resolved by ai-lookup: **0, not measured**: every AI call answered "You've hit your weekly limit - resets 10am (Europe/Kyiv)" (the `~/.claude-artem` subscription), so the other 13 show that error in their trail. LinkedIn step: not run on purpose (the queue logic and the week gate are tested; no job was created). 13 companies still have no domain: for most of them the name patterns found no site at all (small agencies on other domains, e.g. marriner marketing, Digital Pulp); for the others the sites found were another company or carried no name.
- Not done / deferred, and why:
  - The AI web-search step was never run live (weekly limit). The wiring is tested (request body, `/claude` -> bridge flag, the bridge's exact tool list), but whether `claude -p --tools WebSearch,WebFetch` with `--permission-mode dontAsk` really searches on this machine is UNVERIFIED.
  - The extension's new `current_company_url` was tested only on stand-ins, not on a real LinkedIn profile.
  - Progress is in memory (a backend restart forgets finished runs, and a running one dies with the process). The 1 s rule hides a run that finished inside a second; a failure is always shown.
- Acceptance checks:
  - Domain finder with stub fetchers and a stub model: PASSED (`tests/metro/test_metro_fix2.py`, about 110 checks, including a regression test for each wrong match found live).
  - Live copy run for the 19: name patterns 6 of 19; AI step NOT RUN (limit); LinkedIn NOT RUN (by design).
  - Progress dock in a real browser (scratch backend :8002 on a copy, stubbed fetchers): PASSED: running item and step named, ETA, a reload kept the run, Stop ended it with a result line; the table, the badge, Retry domain, the confirm above 50 and the scoped email dialog were seen.
- Tests: `node tests/run_all.mjs --python`: 70 JS suites, 0 failing; 45 Python suites, 0 failing. New: tests/metro/test_metro_fix2.py, tests/metro/progress-dock.test.js. Updated: tests/bridge-lockdown.test.js (the web mode), fix1-ui and metro-ui (new button wording), test_metro_phase2.py (trail wording).
- Files changed: api/metro/{domainfinder (new), progress (new), enrich, webscan, results, db, hooks, aiclient, routes_p1, routes_p2}.py; api/main.py (2 generic lines, see decisions); cli-bridge.js; metro-linkedin/{scrape.js, manifest.json 0.1.1}; frontend/src/metro/{MetroApp.jsx, components/{LeadsTab,EnrichPanel,ProgressDock (new)}.jsx, lib/progressJobs.js (new)}; METRO_PLAN.md, DESIGN.md (F2 section), WORKLOG.md, METRO_TASK.md; the tests above.
- Decisions made on my own (need Oleh's OK):
  - **The CLI bridge now has one web-enabled mode** (`web: true` in the /ai body): `claude -p --tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch --permission-mode dontAsk`, read-only, no files, no shell, no MCP. Every other call still gets the empty tool list (T3 lockdown); a test pins both. Only Metro's domain lookup sets it. A page the model fetches could try to steer it, but the only thing that leaves the call is a JSON domain, which is then checked against the real site.
  - **`api/main.py` got two generic lines** (strip `_web` from the request, pass `web: true` to the bridge) because `/claude` lives there; no Metro logic is in it. This touches the hard rule "no Metro code in main.py beyond mounting the router": it is the smallest change that lets the proxy carry the flag. Tell me if you want it moved.
  - **On the API provider there is no web search** (none is enabled in this app, and no new paid service is allowed): the step then asks Sonnet from memory and the trail says "no web (web search needs the CLI provider)". **`ai_provider.json` is `api` right now**, so until the provider is switched to CLI the lookup runs without web.
  - **A LinkedIn company page's website and an email-finder domain are stored without the site check** (first-party data, as before); only guessed domains (name patterns, the model's answer) are verified.
  - **Verification is deliberately strict** (a missed domain is cheaper than a wrong site feeding wrong hooks): the name is necessary, never sufficient; a guess that is only part of the name needs the lead's city on the page; a pattern that redirects stores the domain the site really lives on (clickcatalystdigital.com -> clickcatalystmedia.com). Expect some real companies to stay "no domain" until the AI step or LinkedIn finds them. The first live passes accepted cross.com (a pen maker), realperformance.com (machinery), commerce.com, impact.com and rank.com: that is why.
  - `last_enrich_run` (a settings key) marks "just enriched"; the filter shows the last run only.
- Questions for Oleh:
  1. May the bridge keep its web-enabled mode for the domain lookup, and should the app run on the CLI provider by default now?
  2. Is the strict verification acceptable (a third of the 19 resolve by patterns alone), or do you want a looser rule with a human "confirm this site" step?
  3. Should the progress dock show runs of other campaigns (it does now), or only the campaign on screen?
- What Oleh must do by hand before the next task:
  1. **Restart falconscout.bat** (new routes; the schema 4 migration runs on the first /metro call and re-opens the 19 companies; close the old bridge window so the backend starts the new bridge on its next CLI call).
  2. Reload the `metro-linkedin` extension at chrome://extensions (0.1.1) in each profile.
  3. Switch the AI provider to CLI (the header chip) and wait until the subscription's weekly limit resets (10am Kyiv). Then Metro > Leads: "Retry domain (N without)", and watch the dock; each company's trail says what every step did. That also answers whether the web lookup works on this machine: send me the trail of two or three companies.
  4. In a Metro week (Linked Helper closed) the LinkedIn step runs by itself for persona-keep leads of the companies still without a domain: run "Retry domain" first, then let the extension work (visits are counted).
- Suggested next task: after Oleh's real run of the web lookup and the LinkedIn step, tune the verification from the trails (which rejections were wrong), then Phase 3 (chains and export) from the shortlist, hooks and `emailable()`.
