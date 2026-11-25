# Metro - Build Plan for Claude Code

Agreed with Oleh on 24 Nov 2026. Live, commentable copy: https://claude.ai/artifact/KivpfVJfGd8TWbrM3ChWjk
Presentation page for the IT Force co-founders: https://claude.ai/artifact/DxLiGosUtxcHHkPyaRVTow

## Purpose and how to use it

Falcon Scout gets a second half, **Metro**: outbound to white-label agency partners and to direct clients by niche, over LinkedIn and email, built inside the existing app by adapting DevScout's tested machinery. The Upwork side keeps the name **Falcon Scout**. This plan is the brief for Claude Code; each phase ends with a check Oleh can run.

- **Repo:** `upwork-cockpit` (Falcon Scout). DevScout (`C:\Users\syzov\baba-leada`) is the source to copy from, read-only. Oleh owns both, so copying is free.
- **One phase per Claude Code session.** Start a session with: read `CLAUDE.md`, `DESIGN.md`, this file, then the phase. Do not start the next phase until the current one's acceptance checks pass.
- **Strategic changes** to anything in the decisions table go back to Oleh before code, per `CLAUDE.md`.
- Phase 0 records these decisions in a new `DESIGN.md` section, "Metro".

## Locked decisions

| Area | Decision |
| --- | --- |
| Where and name | Inside Falcon Scout as a walled-off module named **Metro**; header switch **Falcon Scout \| Metro**, each side with its own tabs. Metro's logo is a metro wagon carrying the IT Force mark; IT Force colours (ink #000c0e, teal #005669, cyan #37bbd5, ice #eaf6f9) and the Manrope typeface. Agency line colour: red #e6261f; niche line: cyan |
| DevScout code | Free to copy and adapt; pure logic and the extension are lifted with their tests; storage goes through Falcon Scout's backend |
| LinkedIn sending | Linked Helper sends connection requests; Metro sends messages after acceptance and checks replies; Linked Helper CSV (custom variables) is the fallback |
| LinkedIn safety | Alternating weeks. In a Linked Helper week no LinkedIn visits (pop-up confirm + a check that the Linked Helper program is closed); messages and reply checks are always allowed. Scraping cap 60/day default, adjustable to 80 |
| Accounts | Artem's account is the only messenger; extra accounts later are scraper-only; one Chrome profile per account |
| Email | IMAP/SMTP on the itforce.ua mailbox (hosting at Ukraine.com.ua; SPF, DKIM, DMARC pass; mail-tester 10/10); plain text; start at up to 20-30/day |
| Campaigns | Two types: Agency (US/Canada, then Europe) and Niche (one per month, with a niche brief); months alternate; a lead or company is in one active campaign at a time |
| Scoring | Layer 0 persona (CSV only) -> layer 1 business fit (domain, website scan, PageSpeed, Ads Transparency, Google Business Profile) -> layer 2 deep (Ahrefs for niche only, LinkedIn company page) |
| Emails | Linked Helper's email finder first (its Data credits), Apollo only as a fallback (decided 24 Nov); found emails are stored unverified, only verified addresses get email |
| Chain shape | Touches = number of distinct hooks, shared across channels, no fact reused (ledger); cap about 6; under 2 hooks gets a base chain of about 3 from the campaign brief |
| Channel order (agreed 24 Nov) | Sequential, never parallel. Every lead is enriched and has hooks before any message. Emails are looked up right after scoring and junk removal, while the connect campaign runs. Per-lead window: 14 days after the Linked Helper invite. Accepted by then -> LinkedIn first (about 3 messages from Artem), then email with the unused hooks if no reply. Not accepted -> email first, a longer email chain. Someone who accepts while on the email track: if they replied by email, the conversation stays on email; if they ignored the emails, they move to the combined track and get LinkedIn messages with unused hooks. Any reply on any channel stops everything else. In Linked Helper exports, "Successful" = accepted |
| Suppression (two kinds, 24 Nov) | **Hard** = never contact: IT Force clients, opt-outs, bounced addresses (the address only), approved Upwork domains. **Soft** = "previously contacted": the already_contacted list (1,817 member ids). Soft entries are excluded from any NEW invite list exported to Linked Helper, but a lead imported from our own Linked Helper campaign export keeps its invited / connected status and stays usable; its re-contact timing is governed by the cycle rules (Phase 6). Stored as `metro_suppression.strength` (`hard` / `soft`); a soft hit on a plain CSV is status `previously_contacted`, a hard hit is `suppressed` |
| Re-contact | Cycles: rest 60-90 days, new cycle only with new hooks, max 3 cycles a year; any reply, opt-out or bounce stops all channels |
| Case studies | The 89 English pages at itforce.ua/en/cases, matched by industry tag; the link is attached by code, never written by the AI |
| Offer | Direct clients: a free mini-audit. Agencies: "send a client you're struggling to deliver for" / pilot audit |
| Prices | Never in any message; enforced by a code check |
| Language, style | English only. DevScout's writing rules as the base, Artem's tone from the Upwork corpus, no deliberate typos or lowercase "i" |
| AI | Every call through the existing `/claude` proxy on the CLI bridge (subscription) |

## Architecture

One FastAPI process (`:8000`) and one SQLite file hold all Metro data, so every Chrome profile and every LinkedIn account works on the same leads and the same send log.

- Frontend `:5180`: switch Falcon Scout | Metro; Metro tabs: Campaigns, Leads, CRM, Senders, Settings.
- Backend: Upwork routes unchanged; `api/metro/` router (campaigns, leads, scoring, ledger), enrichment + chain writer with checks in code, mail sender + scheduler.
- Feeders: Linked Helper (desktop; CSVs moved by Oleh, never talks to the backend), Chrome profiles with the `metro-linkedin` extension (posts jobs and results to `:8000`).
- Outside: SQLite, `/claude` proxy (CLI bridge), itforce.ua mailbox (IMAP/SMTP), web sources (sites, PageSpeed, Ads Transparency, Google Business Profile, Ahrefs in the browser).

### Data model (new tables only)

| Table | Holds |
| --- | --- |
| `metro_campaigns` | type (agency / niche), region, status, niche or agency brief, offer |
| `metro_companies` | name, domain + where it came from, dated snapshots: website scan, PageSpeed, ads, Business Profile, Ahrefs |
| `metro_leads` | person, profile URL, member id, campaign, persona and fit scores, status, current cycle |
| `metro_hooks` | the fact, its source field, its date, the touch that used it (the ledger) |
| `metro_touches` | lead, cycle, step, channel, text, check results, scheduled / sent time, message ids |
| `metro_senders` | LinkedIn accounts and mailboxes, role (messenger / scraper), caps, today's counters |
| `metro_send_log` | every send attempt and its outcome; fail-closed |
| `metro_replies` | channel, kind (reply, auto-reply, bounce, opt-out), what it stopped |
| `metro_suppression` | person, company or address, reason, scope |
| `metro_case_links` | a KB case study's English URL and industry tags (the KB table itself is untouched) |
| `metro_settings` | week mode (Linked Helper / Metro), caps, test mode, persona rules |
| `metro_imports` | one row per CSV import into a campaign: file, source, counts per outcome (no lead data). Added in Phase 1 |
| `metro_suppression_candidates` | suppression entries proposed by Upwork-derived data, each waiting for Oleh's approve / reject. Added in Phase 1 |

### Accounts and weeks

- The backend hands scrape jobs to whichever scraper account has visits left today; message and reply jobs go only to Artem's account.
- Week mode is a switch in the Metro header. In a Linked Helper week the backend issues no LinkedIn job (profile or company page); jobs that never touch LinkedIn (Ads Transparency, Google Maps / Business Profile, Ahrefs) still run (changed 25 Nov, task F1); messages and reply checks still run.

## What to copy from DevScout, and what to rewrite

Copy logic with its tests; swap storage; rewrite everything that describes Developex. Paths are in `baba-leada`.

| Treatment | DevScout source | Becomes in Falcon Scout |
| --- | --- | --- |
| Copy as is, with tests | `src/utils/writingRules.js`, `chainMode.js` (ledger + `lintLeadChain`), `chainTemplates.js`, `sendSchedule.js`, `exclusions.js`, `optOut.js`, `placeholder.js`, `outreachSafety.js`, `replyTriage.js`, `replyKeywords.js`, `scoring.js` (CSV column detection), `profileParser.js`, `realDue.js`, `identityGate.js` | `frontend/src/metro/lib/` + `tests/metro/` |
| Copy, re-skin | `LeadsTab.jsx`, `PipelineBar.jsx`, `ProgressDock.jsx`, `progressJobs.js`, `CrmTab.jsx` + `crm*.js`, `CampaignProgress.jsx`, `UploadTab.jsx` | `frontend/src/metro/components/` |
| Copy, swap storage | `storage.js`, `crmStore.js`, `liCampaignStore.js` (same function names, IndexedDB replaced by calls to `/metro/*`) | `frontend/src/metro/lib/storage.js` |
| Fork | `extension/` (LinkedIn profile, company, jobs scrapers; website scraper; `li-limits.js`, `li-sender.js`, reply check) | new extension `metro-linkedin/`, posting to `:8000` |
| Port to Python | `gmail-sender.js` safety model (test mode, caps, gaps, fail-closed log, idempotency), `gmail-scheduler.js`, `mailSweep.js` | `api/metro/mail/` on IMAP/SMTP |
| Rewrite | `categories.js`, `CATEGORY_CONFIG`, `enrichment.js` prompt, `outreach.js` prompt, `hypothesis.js` signals, `NEVER_NAME`, pitch templates, `productDetect.js` | niche briefs, agency brief, marketing signals, IT Force prompts |
| Reuse from Falcon Scout | `ahrefs.js` (rekey from job to domain), website-inspect scraper, `groundingCheck.js`, `letterGuards.js` patterns, KB, `/claude` proxy, backup | shared |
| Leave behind | Email Wizard (Streak), event phases, Legacy/Waves/Train types, Goose gateway, `gws_com` Gmail path | not ported |

## Phases

Seven phases. After Phase 3 the first campaign can run, with sending through Linked Helper and CSV; Phases 4-6 move sending and learning into the app.

### Phase 0 - Foundation and safety

1. Fix the extension cross-talk: Falcon Scout Enricher must stop injecting `bridge.js` into ports 5173/5174 (DevScout) and stop broadcasting to tabs on those ports; limit it to 5180. Bump the manifest version.
2. Rename DevScout's extension from "Falcon Scout" to "DevScout Scraper" (in `baba-leada`, a one-line manifest change; Oleh commits it there with `push.bat`).
3. Upgrade the Falcon Scout frontend to React 19, alone, then run the Upwork side end to end. (Open question to Oleh in the doc; if he says no, keep React 18 and adapt copied components instead.)
4. Create `api/metro/` as its own FastAPI router (mounted with one line in `main.py`), `frontend/src/metro/`, `tests/metro/`.
5. Header switch (approved by Oleh 24 Nov 2026):
    - A **two-part segmented switch "Falcon Scout | Metro" right after the logo**, current side filled (Falcon Scout: dark fill; Metro: teal #005669 with white text). Not a single toggle button at the end of the header.
    - **The header changes identity with the side:** Falcon Scout keeps its existing logo (`frontend/public/falcon-scout-mark.png` family, as today); Metro shows the wagon logo `frontend/public/metro-wagon.svg` and a 3px cyan (#37bbd5) top edge, teal accents, Manrope.
    - The tabs after the switch belong to the current side: Falcon Scout keeps its tabs; Metro shows empty tabs Leads, Campaigns, CRM, Senders, Settings.
    - The right end of the header keeps each side's own status chips: Falcon Scout's existing chips; on Metro the week mode chip ("Linked Helper week" / "Metro week") and "Visits N of cap" (placeholders until Phase 2).
    - A small cyan dot on the other side's half of the switch when something there needs attention (wired in later phases; the slot exists now).
    - Each side remembers its last tab; the current side is remembered between visits; Ctrl+M switches sides. Switching never reloads the page.
6. New tables (data model above) with migrations; nothing in `jobs` or `proposals` changes.
7. Suppression list import: `Claude outputs/already_contacted_member_ids.csv` (1,818), existing IT Force clients (from Artem, when available), Upwork clients from the `proposals` table (changed 24 Nov: the 494 `upwork_job` ids are NOT imported; the 13 domains found are listed in Metro Settings as candidates that Oleh approves or rejects one by one, and nothing is suppressed until approved).
8. `DESIGN.md` gets a "Metro" section with the locked decisions.

**Accept when:** every Upwork tab still works (feed, analysis, letter, Outcomes, Dashboard); both test suites pass; opening DevScout and Falcon Scout in one Chrome profile shows no cross-talk in either console; the switch flips sides without a reload.

### Phase 1 - Campaigns, import, persona scoring

1. Campaigns: type (agency / niche), region, status, niche brief (who, assumed pains, allowed case tags, do-not-claim list, offer).
2. Import a Linked Helper or Sales Navigator CSV into a campaign, using DevScout's column detection.
3. Dedup: by LinkedIn member id / profile URL, then email, then name + company; against the suppression list and every active campaign (a lead and its company are in one active campaign only).
4. Layer 0 persona score from the CSV only: title, seniority, geography, junk patterns (freelancer, student, "open to work", recruiters). Rules editable in Settings.
5. Leads table with the pipeline cards (Import -> Enrich -> Write -> Send) and DevScout's "what you see runs" rule.
6. Linked Helper exports (agreed 24 Nov): import Linked Helper "Profiles downloaded" CSVs (both comma- and semicolon-delimited) with their campaign status (invited / connected); emails present in the export (1st-degree contact info) are used first and marked `source = linkedhelper`, so the paid finder runs only on the rest. Every imported list keeps a `source` field (which Sales Navigator seat / Linked Helper instance it came from). The "Profiles downloaded" files carry no status column, so the status is derived: invited = the invite date is filled; connected (accepted) = `connected_at` is filled or the member is DISTANCE_1; a file that does have an explicit status column uses it, "Successful" = accepted.
7. Campaign launch kit (agreed 24 Nov): each campaign stores the "package" it runs with: Artem's LinkedIn profile variant (headline, About, banner, featured items), the case studies and sample audits it may use, the brief and the offer. Starting a campaign shows a checklist of the manual steps (profile switched, featured items swapped, "share profile updates with network" off) and records when each was done. Metro never edits LinkedIn itself.

**Accept when:** the current campaign's Linked Helper export ("USA CAN Claude", US/Canada; Oleh imports it himself) imports with invited/connected status and its emails; the US agency list (`Claude outputs/US_CA_agency_owners_TierA.csv`) imports with zero manual column mapping; anyone in the 1,818 list is marked suppressed, never deleted; re-importing the same file adds nothing.

### Phase 2 - Enrichment

1. Domain resolution per company, in order: CSV, email-finder export, name patterns (at most 6 guesses, fetched and verified), AI web lookup (Sonnet with web search), LinkedIn (profile -> company page, Metro weeks only). Store the source. (Changed 25 Nov, F2: the first live run resolved 1 of 20 with a no-web Haiku guess; every guess is accepted only when its site is that company; see DESIGN.md section 25.)
2. Website scan (no LinkedIn visits): Google Ads tag, GA4, Tag Manager, Meta pixel, call tracking, booking form, CMS, services and location pages, blog freshness, public emails.
3. PageSpeed (Google's API, mobile score), Google Ads Transparency (running ads, since when), Google Business Profile (rating, review count, categories); paced, cached per domain.
4. Forked LinkedIn extension: profile and company scraping, account registry (who is signed in), per-account caps (default 60, max 80), the Linked Helper week gate.
5. Ahrefs: rekey `ahrefs.js` from job id to domain; niche campaigns only; short batches (Standard plan, shared seats).
6. Layer 1 and 2 scores; shortlist view.
7. AI enrichment through `/claude`: extract **hooks** as facts, each with its source field and date (SEEN), never assumed; plus angle and best-fit case tag.
8. Email-finder round trip: export the shortlist's profile URLs; import Linked Helper / Apollo results; keep only verified addresses for email.

**Phase 2 as built (24 Nov, Oleh's answers):**
- Week mode: a switch in the Metro header with a confirm pop-up in both directions. Entering a Metro week also checks the Windows process list for Linked Helper (`linked-helper.exe`, a setting); a running Linked Helper or an unreadable list refuses the switch. In a Linked Helper week the backend hands out **no LinkedIn job** (profile or company page); Ads Transparency, Google Maps / Business Profile and Ahrefs jobs still run, because they never touch LinkedIn (changed 25 Nov, F1; Phase 2 first blocked every extension job). The extension repeats the check by itself and asks the backend only for the kinds it may run. The backend's own website scan and PageSpeed make no LinkedIn visit and are not affected.
- Each LinkedIn visit is counted **before** the job is handed out, per account and Kyiv day; the default cap is 60 and no setting can raise it above 80. Jobs are paced (30-75 s between LinkedIn pages) and Ahrefs runs in short batches (15 a day on the shared Standard seat, Oleh's own seat in his browser).
- Website scan and PageSpeed run on the backend (paced, cached per domain, lifetimes in Settings). Ads Transparency, Business Profile, Ahrefs and the LinkedIn pages are read in Oleh's Chrome by the new `metro-linkedin/` extension (Google Business Profile is read from Maps in the browser; Google's Places API is a paid service and is not used). Domain resolution: CSV, email finder, AI lookup (the model only proposes; the site must carry the company name), LinkedIn company page.
- Hooks are written through `/claude` from a numbered evidence list of stored fields; code throws away any hook with an invented number, a URL, a price, hedged wording, a do-not-claim phrase or an evidence id that does not exist.
- Email finder round trip: export the shortlist as a Linked Helper list, import its results (an Apollo CSV as the fallback; no Apollo API call is made); emails start `unverified`; only a provider "verified" or Oleh's mark makes one emailable; a free DNS check can say `domain_ok` but never `verified`.

**Accept when:** on a 20-lead niche sample, every hook shown traces to a stored field and date; no LinkedIn visit happens while the week mode is "Linked Helper"; the visit counter never passes the cap.

### Phase 3 - Chains and export (first live campaign)

1. Import the 89 English case pages from itforce.ua/en/cases with URL and industry tags; Ukrainian-only cases stay unlinked background.
2. Agency brief and the first niche brief (Medicine / Health / Aesthetics).
3. Chain writer, one lead per call: touches = distinct hooks, split across the channels the lead can receive, ledger forbids reuse, cap about 6; under 2 hooks gets the base chain of about 3.
4. Checks in code (DevScout's `lintChain` + Falcon Scout's grounding): no prices, no URLs written by the AI, no placeholders, no em dashes, banned phrases, a hook must exist in the lead's data. A failing chain shows "Do not send as is".
5. Review drawer per lead; "Send anyway" with a stored date.
6. Exports: Linked Helper CSV with one custom variable per LinkedIn message; email CSV.

**Accept when:** 10 real leads per segment produce chains Oleh would send after light edits; the price and URL checks catch planted test cases; the Linked Helper import shows the right message per person on one test profile.

### Phase 4 - Email sending and replies

1. IMAP/SMTP sender with DevScout's safety model: test mode on by default, per-run limit, daily cap, 60-180 s gaps, stop at first error, fail-closed send log, idempotent per lead + step.
2. Own Message-ID per email; follow-ups reply with In-Reply-To / References; copy saved to Sent via IMAP.
3. Scheduler (Kyiv time, only while the app runs).
4. Inbox sweep: replies, bounces (address-level), auto-replies (not replies), opt-outs; any reply stops every channel for that person.
5. CRM card on reply.
6. Pre-campaign seed test: one email to a check address; refuse to start if it lands in spam.

**Accept when:** in test mode, a 3-email chain to Oleh's own addresses threads correctly in Gmail; a planted bounce and an out-of-office are classified right; a reply stops the rest.

### Phase 5 - LinkedIn messaging from Artem's account

1. Acceptance detection: import Linked Helper's export, or the extension reads new connections (decide in the phase).
2. DevScout's sender: caps (20/day, 60/week, 3/hour, 9-18 weekdays), refuse if any earlier conversation, crash = unconfirmed and never retried; allowed in both week modes.
3. Reply check through the Messages page (0 profile visits).
4. First live send = one watched message.

**Accept when:** one watched message goes out correctly; a reply on LinkedIn stops the email track and vice versa.

### Phase 6 - Cycles and learning

1. Rest 60-90 days, re-scrape and re-enrich, new cycle only with unused hooks, max 3 a year.
2. Results per campaign and per hypothesis (DevScout's counting rules: no winner under 100 contacts each).
3. Mini-audit draft from stored enrichment, for the team to finish.

**Accept when:** a lead with no new hooks is not re-contacted; a reused fact is refused by the ledger.

## Hard rules for Claude Code

These hold in every phase; breaking one means stopping and asking Oleh.

**Boundaries**
- No Metro code in `api/main.py` beyond mounting the router, and none in `JobDetail.jsx`. Shared helpers are extracted into small modules, never imported from those two files.
- Never change the `jobs` or `proposals` tables or the Upwork feed.
- `baba-leada` is read-only except the Phase 0 extension rename.
- **Metro never imports leads sourced from Upwork** (jobs, proposals, Upwork clients). Upwork-derived data may only *propose* suppression entries (for example client domains), which Oleh approves or rejects one by one in Metro Settings; nothing is suppressed until approved.

**Safety (fail closed)**
- Nothing is ever sent without an explicit button press and confirm; test mode is on by default for email and LinkedIn.
- No LinkedIn visit while the week mode is "Linked Helper"; no visit past the account's daily cap; the cap is checked before a visit is counted.
- A damaged send log refuses all sending; a crash mid-send is "unconfirmed" and never retried.
- A suppressed person or company is never written to; a bounce suppresses the address only, a reply or client mark the whole company.
- No message contains a price, an AI-written URL or an unfilled placeholder; the checks run in code, not only in the prompt.
- A hook is stated only when a stored field supports it (with its date); an assumed fact is never written as a fact.
- AI calls go only through `/claude`; no new paid service is called without Oleh's OK.

**Data and secrets**
- Mailbox password, API keys and tokens are entered by Oleh in Settings; never typed, logged or committed.
- Lead data (CSVs, exports, scraped pages) stays out of git; add any new data file to `.gitignore` before the first commit.

**Docs and process (Falcon Scout's protocol)**
- Read `DESIGN.md`, `PROJECT_HANDOFF.md`, `WORKLOG.md` at session start; append to `WORKLOG.md` and update `DESIGN.md` at the end.
- Commit with `git add -u` plus new files by name; never `git add -A`.
- Each phase ends with its acceptance checks written down as passed or failed, with evidence, in `WORKLOG.md`.
- **Every task ends with an entry in `METRO_HANDOFF.md`** (template at the top of that file), appended at the bottom, as the very last step after the commit and push. Oleh relays it to the planning chat by sending "W".

## Open items

None blocks Phases 0-2; the first two must be settled before Phases 3-4.

- [ ] **Email sender identity** - all as Artem from a new mailbox in his name, or Oleh on email? (Oleh asks Artem.) A new mailbox starts at 5-10 a day for the first two weeks.
- [ ] **Hosting daily sending limit** at Ukraine.com.ua (Artem or the hosting panel).
- [ ] **Linked Helper email credits** included in Pro, and how many a month; else Apollo plan.
- [ ] **Ahrefs seat** for Oleh (Standard has 3 seats).
- [ ] **Existing IT Force client list** for suppression (Artem).
- [ ] **Agency proof**: 1-2 anonymised white-label write-ups, or the one-pager's numbers as a page on itforce.ua; the one-pager's LinkedIn call to action to match the sender.
- [ ] **Next niche** after Medicine / Health / Aesthetics, ranked by contract value and IT Force's strength.
- [x] **React 19 upgrade** (Phase 0 step 3) - kept (Oleh, 24 Nov).
- [ ] **Email volume research** - on request.
