# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Sonnet 5.5 · Effort: high · New session: yes
Task id: F4 (header progress, one-step import, navigation, buttons, enrich order, personal emails) · Written: 2026-11-25 21:20 Kyiv

## How to work
Read CLAUDE.md, METRO_PLAN.md (especially the new section "Queued for the next fix task" at its end, and
the decision rows "CRM and reminders" and "Personal emails"), and the newest entry of METRO_HANDOFF.md (F3).
Branch metro/fix-4 from main. Start right away, no plan approval needed. Decisions and questions go into the
handoff entry. Stop and ask only if something would break a Hard rule.

## What Oleh saw on 25 Nov evening (live, after F3)
- The F3 import worked through the "Emails (Linked Helper)" dialog: 495 matched, 120 emails (70 business,
  50 personal), 161 domains set. But the lead-import dialog could not apply it ("Import 0 leads" disabled,
  0 new leads), the dialogs show raw JSON, and they do not close.
- The "Download the Linked Helper list (CSV)" download overwrote his export of the same name in his folder.
- "Score fit 495 shown" looked dead: its only sign of life is small green text. A first "Enrich next 20" click
  left no trace in the database at all; a second one started (dock at the bottom). He wants progress to be
  impossible to miss: "the most important thing".
- "Enrich next 20" spends its slots on companies with no domain (CROSS Digital, MarketingMosaicSolutions,
  name patterns + AI that is out of its weekly limit) while ~160 companies with a domain wait.

## Items (all from the queue in METRO_PLAN.md; do them all)
1. **Progress in the header.** Port DevScout's activity strip (C:\Users\syzov\baba-leada\docs\activity-strip.md,
   src/utils/activity.js and its header component) into the Metro header, fed by the existing backend
   progress (`GET /metro/progress`): visible on EVERY Metro tab and on the Falcon Scout side of the switch; one
   chip per running job (what, campaign, X of N, thin bar, current item and step), "N running" dropdown when
   more than 2; a click opens the screen where it runs; the browser tab title shows "(Enriching 7/20) Metro";
   Stop where an abort exists; a finished run's result line stays in the strip until dismissed; a failure
   always shows. The bottom dock stays as the detail view. Polling only while something runs (plus once on load).
2. **Every button shows what it did.** A shared Btn behaviour: busy state (spinner, disabled) while its
   request runs; then the result as a notice that stays until dismissed (DevScout's notice pattern), or the
   job appears in the header strip. A refused or failed request ALWAYS shows its reason. Find out why the first
   "Enrich next 20" click left no trace (lost click, error swallowed, request refused) and make that case visible.
3. **Buttons look alive.** Acid blue (about #00E5FF; Oleh's mouse cursor colour) as the highlight for the
   primary action and active states, next to IT Force teal; check contrast (dark text on the acid fill). Press
   animation on every button: down 1-2 px and back, transform only, ~120 ms; visible hover; nothing animated
   under prefers-reduced-motion.
4. **One-step import.** One Import button for every CSV (lead list, Linked Helper export, email-finder
   results): it imports straight away, then shows a plain-words summary (no JSON) with a Close button that
   closes the dialog. It stops before writing ONLY when the file looks wrong: no row matches this campaign and
   no new leads, no recognised columns, the same file already imported. Updates to existing leads always apply
   (today the lead dialog's button is disabled at 0 new leads). Merge the two dialogs into one if that is simpler.
5. **Unique download names.** Every file Metro offers for download is named with campaign, date and time, so it
   can never overwrite a file Oleh keeps.
6. **Campaign navigation.** A click on a campaign in the Campaigns list opens its leads (Leads tab, that
   campaign selected). A "Brief and settings" button on the Leads page opens the campaign page. The dropdown on
   Leads stays for switching.
7. **Enrich order.** "Enrich next N" takes companies WITH a domain and no scan first; companies with no domain
   only after those, or through "Retry domain". The button's count says how many of each it will take.
8. **Personal emails.** Decision row "Personal emails": a business address always wins; a personal one is a
   sending address only when the lead has none, still marked personal. Reverse F3's emailable() rule; tests.
9. **Company LinkedIn page.** From Linked Helper exports store the current company's LinkedIn page
   (`organization_url_1`, same current-company rule as the website) on the company, so the LinkedIn domain step
   can use it for companies still without a domain. Backfill from the import already stored if the raw data
   kept it; otherwise say so.
10. **Email verification path (decide, small).** Linked Helper emails are stored unverified and only verified or
   hand-marked addresses can be emailed. Propose in the handoff the cheapest honest path before Phase 4 (MX/DNS
   check is free; SMTP probing is not allowed from Oleh's IP), and implement the free MX check as a status
   ("domain accepts mail") if it is not there already. Do not mark anything verified on MX alone.

## Tests and checks
Unit tests for the strip's merge logic, the import's stop rules, enrich order, emailable(). See the header strip,
the busy states, the press animation and the one-step import in a real browser on a scratch backend with a COPY
of the DB (as in F2); screenshots of the strip on two tabs into the handoff. Whole suite: `node tests/run_all.mjs --python`.

## Finish
WORKLOG.md, DESIGN.md (F4 section), remove the done items from "Queued for the next fix task" in METRO_PLAN.md
(keep anything not done, with why). Commit (git add -u + new files by name, including this file), push, merge
into main, push, rebuild frontend/dist. Handoff entry in METRO_HANDOFF.md. Tell Oleh to restart falconscout.bat.
