# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Sonnet 5.5 · Effort: high · New session: yes
Task id: F2 (domain finder, progress bar, fixes from the 25 Nov live run) · Written: 2026-11-25 15:05 Kyiv

## How to work
Read CLAUDE.md, METRO_PLAN.md and the newest entry of METRO_HANDOFF.md. Branch metro/fix-2 from main.
Start right away, no plan approval needed. Anything you decide yourself or want to ask goes into the
handoff entry. Stop and ask only if something would break a Hard rule in METRO_PLAN.md.

## What the live run showed (campaign "USA CAN Agency Claude 1", 495 leads from TierA)
"Enrich next 20" finished, but 19 of 20 companies got NO domain, so no scan and no fit score. Only
FIREBELLY Marketing resolved (ai-lookup); its ads and Business Profile readings worked. Causes:
TierA has no company website; no emails yet; the AI lookup asks Haiku from memory with no web search
and "do not guess", so it returns null for small agencies (about 1.5 s each); the LinkedIn company page
is queued only when company.linkedin_url is known, and TierA only has the person's profile URL.
`enrich_tried_at` is now set on those 19, so "Enrich next N" skips them.

## 1. Domain finder (the main item)
Resolve a company's domain in this order, cheapest first, and accept a candidate ONLY when
`verify_domain_matches_name` passes on the fetched site (keep that rule; tighten it if needed so a
parked or for-sale page never passes):
  a. CSV / email-finder export / existing data (as now).
  b. Name patterns: from the company name build at most 6 candidates (e.g. "FIREBELLY Marketing" ->
     firebellymarketing.com, firebelly.com, firebelly-marketing.com; drop legal and generic suffix
     words such as LLC, Inc, Agency, Marketing, Digital, Group in some variants; .ca as well for
     Canadian locations). Fetch paced, stop at the first verified hit. Source label `name-pattern`.
  c. AI lookup WITH web search through the existing /claude path on the CLI bridge (check how
     cli-bridge.js and DevScout's `web: true` do it; on the API provider use the web search tool only if
     it is already enabled there; no new paid service). Sonnet, not Haiku. Same verification.
     Log the real reason when it fails (bridge error, no answer, rejected) instead of swallowing it.
  d. LinkedIn, Metro weeks only, counted against visits: a `linkedin_profile` job on the lead's
     profile reads the current company's LinkedIn URL; then the existing `linkedin_company` job reads
     the website from the company page. Queue this only for leads with persona `keep`.
Show per company in the UI why a domain is missing ("tried: name-pattern x6, ai: no answer, linkedin:
queued") and a "Retry domain" action. Migration: clear `enrich_tried_at` on companies that have no
domain, so the 19 are eligible again. Tests with stub fetchers; then one live run on a COPY of the
live DB for the 19 real companies (real site fetches are fine; report how many resolve and by which
step; no LinkedIn jobs in that run).

## 2. Progress bar (copy DevScout, adapt to Metro)
Copy DevScout's `src/components/ProgressDock.jsx` and `src/utils/progressJobs.js`
(C:\Users\syzov\baba-leada, read-only) into frontend/src/metro, restyle in Metro colours. One dock for
every long Metro action: import, enrich and "Enrich next N", score, deep readings (follow the
extension jobs as they come back), hooks, email import, and later write and send. A colour-filling bar
when the total is known, an indeterminate bar with elapsed time when not; the current item by name
("Enriching: Rank Media Agency, 7 of 20 - website scan"); ETA; Stop where an abort exists; a one-line
result at the end ("Enriched 20 - 17 domains found, 3 not found"). The backend owns progress: expose a
progress endpoint per run so the dock survives a tab reload and shows a run that is still going.

## 3. Small fixes from the same run
- Rename the buttons so it is clear which score they compute: persona (on import) vs fit
  ("Score fit N shown").
- "Enrich next 20" becomes the primary button on the Enrich card; "Enrich all shown" asks for a
  confirm above 50 leads, showing the count.
- After an enrich run, flag the leads it touched (a "just enriched" filter or sort), so they are easy
  to find in a list sorted by persona.
- The Linked Helper email export follows "what you see runs" (ticked rows, else the shown rows that are
  shortlisted), like every other button.

## Finish
Run both test suites. Write the checks in WORKLOG.md, commit (including this file), push, merge into
main if all tests pass, rebuild frontend/dist, tell Oleh to restart falconscout.bat. As the very last
step append your entry to METRO_HANDOFF.md, including the domain-finder numbers from the live copy run.
