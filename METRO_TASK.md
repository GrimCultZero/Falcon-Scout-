# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Sonnet 5.5 · Effort: medium · New session: yes
Task id: F3 (read Linked Helper "Data Enrichment" exports: website, company, profile, badges) · Written: 2026-11-25 19:55 Kyiv

## How to work
Read CLAUDE.md, METRO_PLAN.md and the newest entry of METRO_HANDOFF.md (F2). Branch metro/fix-3 from main.
Start right away, no plan approval needed. Anything you decide yourself or want to ask goes into the
handoff entry. Stop and ask only if something would break a Hard rule in METRO_PLAN.md.

## Why
Oleh started a Linked Helper campaign "US CAN emails" (Data Enrichment action, server-side, no LinkedIn
visits) on the same 495 TierA people, with: Email (Any), Profile info, Badges, Company data; freshness
date 2025-11-25. Its export will be a normal "Profiles downloaded from lh-Artem-Yatsuk-#535390 ..." CSV.
Today Metro reads only the email from such a file, and the company website columns are not read at all,
so the domains we just failed to find would be ignored. The real export does not exist yet; the header
of an earlier export from the same instance is known (below). Build for those columns, and log any
OTHER non-empty column the real file brings so the next run can map it.

Known Linked Helper export columns (comma or semicolon, BOM), the ones that matter here:
`member_id`, `profile_url`, `email`, `email_type`, `summary`, `industry`, `location_name`, `skills`,
`languages`, `followers`, `connections_count`, `badges_premium`, `badges_influencer`, `badges_job_seeker`,
`badges_open_link`, `badges_hiring`, `current_company`, `current_company_position`, `current_company_industry`,
`organization_1`, `organization_id_1`, `organization_url_1`, `organization_title_1`, `organization_start_1`,
`organization_end_1`, `organization_description_1`, `organization_location_1`, `organization_website_1`,
`organization_domain_1` (and _2, _3 ... for older jobs), `website_1..3` (the PERSON's sites), `twitters`,
`invited_date_iso`, `connected_at_iso`, `member_distance`. "Company data" may add more company columns
(staff count, founded, specialties, logo); their names are unknown until the file arrives.

## 1. Read the enrichment columns (both import paths)
Both the lead import (leads.py, re-import fills empty fields) and the email-results import
(emailfinder.import_results) must take these, matched by member_id / profile URL as now:
  a. **Company website / domain.** From `organization_domain_1` / `organization_website_1` (and the
     company-data columns once known) - but ONLY from the organization that is the lead's CURRENT
     company: its name matches `current_company` (company_key), `organization_end_1` is empty, or it is
     the only open position. Never from an older job, never from `website_1..3` (the person's own sites).
     Store on the company (not only when the lead has no company yet, which is the case today in
     `_fill_existing`): set `domain` when the company has none, `domain_source = "linkedhelper"`, add a
     line to the company's domain trail. First-party data, so no site check (same rule F2 set for the
     LinkedIn page and the email finder), but DO reject a parked/for-sale domain and a generic one
     (linkedin.com, facebook.com, google.com, wix/godaddy placeholders, gmail.com...).
     A company that already has a domain keeps it; a different Linked Helper domain is recorded in the
     trail as a disagreement, not applied.
  b. **Domain from a business email.** When the company still has no domain and the lead's email is
     business type (or its domain is not a free-mail provider), use the email's domain, source
     `email-domain`, trail line. Free-mail list: gmail, yahoo, hotmail, outlook, live, icloud, aol, proton,
     gmx, yandex, mail.ru, ukr.net and similar.
  c. **Email type.** Keep `email_type`; when Linked Helper returns several addresses or a personal one,
     prefer business for sending (check how emailable() and the chain export pick the address; a
     personal address may be kept but is marked, never silently used as if business). Note in the handoff
     what Linked Helper actually returned once the file is in.
  d. **Company facts**: industry (`current_company_industry` / `organization_*`), description, location,
     staff count / followers if present -> the company's fields that fit scoring and hooks already read
     (check scoring.py and hooks.py for what they use; add a field only if something will read it).
  e. **Person facts**: `summary`, `skills`, `industry`, `followers`, `connections_count` -> fill only
     when empty; the persona score is recomputed for leads whose input changed (unless a person decided it).
  f. **Badges**: store `open_profile` (from `badges_open_link`), `premium`, `hiring`, `job_seeker` (already
     read) as booleans on the lead. Show "Open Profile" as a small badge in the Leads table (an Open
     Profile can get a free InMail; nothing sends from this yet).
  g. **Anything else non-empty** that is not mapped: kept in the lead's raw_json, and the import summary
     lists those column names with counts.
  h. The dry run (as today) reports: matched / no match, emails found (business / personal), domains
     set (linkedhelper / email-domain), domains disagreeing, open profiles, company facts filled,
     unmapped columns. Applying writes the same numbers to the run's result line in the progress dock.

## 2. After the import, the domain finder skips what is now known
Companies that got a domain from 1a/1b are not sent to name patterns / AI / LinkedIn. "Enrich next N"
then runs the website scan, ads and Business Profile readings and the fit score for them as usual
(check `enrich_tried_at` and the F2 schema-4 logic do not block them).

## 3. Answers to the F2 questions (Oleh/planning chat, 25 Nov)
  1. The bridge keeps its web-enabled mode for the domain lookup. CLI is the intended default
     provider; Oleh switches the chip himself. Do not change ai_provider.json.
  2. Strict verification stays. Not now, queued: a "Confirm this site" button for near-misses.
  3. The progress dock shows runs of every campaign (as now).
  4. The two generic lines in api/main.py are accepted. Update the Hard rule in METRO_PLAN.md to say a
     generic, non-Metro pass-through in the /claude proxy is allowed.

## Tests
Unit tests with a synthetic export using the REAL header names above (comma and semicolon versions):
current-company matching (an older job's website is never taken; a person's website_1 is never taken),
free-mail emails never give a domain, existing domains are not overwritten, a disagreement is recorded,
parked/generic domains rejected, badges stored, unmapped columns listed, re-import is idempotent.
Run the whole suite (`node tests/run_all.mjs --python`).

## Finish
WORKLOG.md entry; DESIGN.md (F3 section: where a domain may come from, in order); commit (git add -u
plus new files by name, including this file); push; merge into main; push main; rebuild frontend/dist.
Then append the F3 entry to METRO_HANDOFF.md (template at its top), including what Oleh must do:
restart falconscout.bat, then when the Linked Helper export is in D:\ITForce\Metro\imports import it
into "USA CAN Agency Claude 1" (dry run first, send the summary to the planning chat).
