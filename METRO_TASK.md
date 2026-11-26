# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Opus 5.5 · Effort: xhigh · New session: yes
Task id: P3 (Phase 3: agency hooks done right, the chain writer, review and export; plus the small queue items) · Written: 2026-11-26 23:05 Kyiv

## How to work
Read CLAUDE.md, METRO_PLAN.md in full (Locked decisions, Phase 3, Hard rules incl. "Live database", and the whole
section "Queued for the next fix task"), DESIGN.md's Metro sections, and the newest METRO_HANDOFF.md entry (F5).
Branch metro/phase-3 from main. Start right away, no plan approval. Decisions and questions go into the handoff.
Stop and ask only if something would break a Hard rule. Browser checks ONLY through tools/scratch_check.py with a COPY.
Deadline context: on Monday 30 Nov Oleh shows his superiors a generic outreach message next to what Metro writes,
using the 13 shortlisted leads of "USA CAN Agency Claude 1". The chains must be good enough to show by then.

## Part A - hooks done right (do this first; the chains depend on it)
The hook review of 26 Nov (queue entry "Hook review") is the brief. In short:
1. Hooks are per COMPANY, written once and shared by every lead of that company (today ATAK's hooks exist 3 times).
   Keep person-level hooks separate (from the person's own data) and attach them to the lead.
2. Evidence must include the Linked Helper extras already stored: the person's summary, skills, industry, followers,
   the company description, industry and location (F3 stored them in raw_json / company facts; read them).
3. Website scan: also capture "industries we serve" / client logos alt text / case-study titles, a careers or jobs page
   (and any PPC/SEO/paid-media job on it), partner badges (Google Partner, HubSpot, Shopify, Meta...), and fix the
   "0 service pages" result on sites that clearly list services (check ATAK, GRAIN, SocialSharings on a copy).
4. Agency hook brief (campaign segment "agency"). Hooks of these kinds, each only when evidence supports it:
   - what they sell and the GAP we fill (sells SEO/web/social but no PPC, or the reverse);
   - who their clients are: a niche or business model (local services, e-commerce, B2B, medical...), from case studies,
     client lists, industries served; this picks the matching IT Force case;
   - partner badges and platforms (e.g. HubSpot Platinum, Shopify, Google Partner);
   - geography (one city / nationwide / Canada, Quebec) and time-zone value;
   - they run Google ads themselves (Ads Transparency count);
   - hiring a PPC/SEO/paid-media person (careers page or LinkedIn hiring badge);
   - team size / founder doing the delivery; agency age (founded year);
   - the founder's own background from their LinkedIn summary.
   FORBIDDEN for agency campaigns: "your site lacks a tag / pixel / call tracking / booking tool / location pages",
   "your blog is old", "your site is slow" or any audit of THEIR own site. Those kinds stay allowed for niche campaigns.
   Enforce in code (a kind/category on each hook, refused by segment), not only in the prompt. Tests.
5. Re-run hooks on the 13 shortlisted leads (on the live app this is Oleh's click; on your copy, show before/after
   hook lists per company in the handoff).

## Part B - Phase 3 as written in METRO_PLAN.md (steps 1-6), with these specifics
- Case pages: import the English case pages of itforce.ua/en/cases with URL and industry tags (step 1).
- Agency brief (step 2): use the campaign's Brief and offer (who it is for, pains, do-not-claim, offer). No prices ever.
- Company = one account: one primary contact (best persona) gets the chain; others are held as "same company"
  (shown, not written) until the primary's chain ends; a reply from anyone stops all of them.
- Chain writer (step 3): one lead per call through /claude; touches = distinct hooks split across the channels the
  lead can receive; ledger forbids reusing a hook; cap about 6; under 2 hooks = the base chain of about 3.
  Channel order (Locked decisions): connected on LinkedIn = LinkedIn first (about 3 messages) then email; not
  connected = email first. English only. Human, short, specific: no "I hope this finds you well", no em dashes,
  no exclamation marks, no buzzwords; a LinkedIn message under ~300 characters; email body under ~120 words.
  The case link is attached by code, never written by the model (DevScout's rule).
- Checks in code (step 4): no prices, no URLs from the model, no placeholders, no em dashes, banned phrases, every
  hook used must exist in the ledger, agency-forbidden hook kinds refused. A failing chain shows "Do not send as is".
- Review (step 5) with the table layout from the queue: few columns (person + company, fit, Channels: email
  business/personal/none + LinkedIn connected/invited/not + Open Profile, hooks count, Chain status). Click a row:
  side panel with a short summary, hooks with their evidence, then the chain in send order (channel, day, text),
  editable, check flags, Approve / Send anyway (stored with a date).
- Exports (step 6): Linked Helper CSV (one custom variable per LinkedIn message) and an email CSV. Unique file names.
- Write card on Leads: "Write chains (N shortlisted)" as the stage's primary button; progress in the strip.

## Part C - small queue items (cheap, do them)
- Metro opens where Oleh left it (side, tab, campaign, Leads filters and sort, open panel), like DevScout.
- Falcon Scout side shows only a running Metro chip and things that need attention, never ordinary Metro results;
  the same rule the other way.
- Header badge clipped at the left edge: fix the padding. Wagon on the dark bar: light outline by CSS (SVG unchanged).
- The ETA ("~3 min left") on the strip chip.

## Tests and checks
Unit tests for: per-company hooks, agency-forbidden kinds refused, evidence includes the Linked Helper extras, chain
checks (planted price, URL, em dash, placeholder, reused hook), channel order, one-primary-per-company, exports' columns.
On the scratch copy: write chains for the 13 shortlisted leads (model calls are real through the bridge only if Oleh's
limits allow; otherwise stub and say so). Put 3 full sample chains (different companies) into the handoff, so the
planning chat can judge them and build Monday's comparison. Whole suite: `node tests/run_all.mjs --python`.

## Finish
WORKLOG.md, DESIGN.md (Phase 3), trim done items from the queue in METRO_PLAN.md. Commit (git add -u + new files by
name, including this file), push, merge into main, push, rebuild frontend/dist. Handoff entry. Tell Oleh to restart
falconscout.bat, Ctrl+F5, click "Write hooks" again for the shortlisted leads, then "Write chains".
