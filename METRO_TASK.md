# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Sonnet 5.5 · Effort: medium · New session: yes
Task id: F1 (fixes from Oleh's first live test, 25 Nov) · Written: 2026-11-25 14:00 Kyiv

## Before anything
Read CLAUDE.md, METRO_PLAN.md and the newest entry of METRO_HANDOFF.md. Work on a branch metro/fix-1
from main. Show Oleh your plan as a short list and wait for his OK.

## What the live test showed
Oleh created campaign "US CAN agencies" and imported a Linked Helper export of the running campaign
"USA CAN Claude" (`Profiles downloaded ... 2026-11-25T11-45-06.118Z.csv`, 326 rows, `;`). In that export
324 of 326 rows carry only `profile_url` (Sales Navigator URL) and `member_id`: Linked Helper has not
visited those profiles yet, so names, titles, companies and locations are empty, and it is the
"Profiles to process" tab, so no invite/connect dates. All 326 member ids are in
`Claude outputs/US_CA_agency_owners_TierA.csv` (495 rows, full names, headline, company, location).
Metro now shows 326 "(no name)" leads.

## Fixes (do all; one commit per numbered item is fine)
1. Re-import fills gaps: when an imported row matches an existing lead in the campaign, fill every
   EMPTY field (name, title, headline, company, location, profile URL forms, email) from the new row;
   never overwrite a non-empty value; status still only moves forward. Report "filled" in the import
   summary. So importing TierA into the campaign fills the 326 and adds the other 169.
2. Linked Helper import accepts Sales Navigator profile URLs (`/sales/people/<id>,...`) and the
   `member_id`, and matches them to leads imported from other files by member id.
3. Delete: a campaign in `draft` can be deleted (with its leads and import records, after a confirm
   that shows the counts); and ticked leads can be removed from a campaign. Never touches other tables.
4. Leads tab bug: the campaign list does not refresh after a campaign is created in Campaigns (the
   new campaign was missing from the drop-down until F5). Refresh it whenever the Leads tab is shown
   and after any campaign change.
5. Enrich with nothing ticked must act on the rows the filters SHOW, never the whole campaign
   ("what you see runs"). Same check for Score, Write and every other card action.
6. Batch buttons on the Enrich card: "Enrich next 20" and "Enrich next 50" = the best-scored leads in
   the current filter and sort that are not enriched yet (persona `keep` first). Show how many remain.
7. Empty Leads page: a "Create campaign" button, not only a sentence pointing to the other tab.
8. Header legend "Agency line / Niche line" becomes a filter: click one to show only that type in
   Campaigns and Leads, click again for both; the active one is visibly selected.
9. Campaign templates: "New campaign" asks agency or niche; agency arrives pre-filled with this brief
   (editable):
   - Who: Owners, founders and managing partners of small digital marketing agencies (1-50 people)
     that sell Google Ads, SEO or web services to their own clients.
   - Pains: They sell more Google Ads and SEO work than their team can deliver / A client needs deeper
     technical SEO or Google Ads expertise than they have in-house / Hiring senior PPC or SEO
     specialists is slow and expensive / They need reliable white-label delivery that never contacts
     their client.
   - Do not claim: Top 3% of Google Partners / Any number of years other than "since 2015" /
     Guaranteed results or rankings / Client names without permission / Prices or rates.
   - Offer: Send us one client you're struggling to deliver for and we'll scope it, or start with a
     free pilot audit, delivered under your brand.
   Niche campaigns get a "Draft the brief" button: Oleh types the niche ("dental clinics, US"), the
   brief is drafted through /claude from the niche and IT Force's case studies for that industry,
   and Oleh edits it. Nothing is saved until he does.
10. Linked Helper week: allow extension jobs that never touch LinkedIn (Ads Transparency, Google
    Maps / Business Profile, Ahrefs); keep blocking every LinkedIn job. Update METRO_PLAN.md.

## Finish
Run both test suites (add tests for 1, 2, 3, 5, 6, 10). Write the checks in WORKLOG.md, commit
(including this file), push, merge into main if all tests pass, rebuild frontend/dist, tell Oleh to
restart falconscout.bat. Then tell Oleh in the handoff exactly how to redo the import:
delete the draft campaign, create "USA CAN Claude" (agency, US/CA), import TierA first, then the
Linked Helper export(s). As the very last step append your entry to METRO_HANDOFF.md.
