# Falcon Scout — "US-only jobs disappeared from the feed": investigation report
Date: 2026-10-29. Project: Falcon Scout (Windows-local tool: Upwork job capture → Chrome-extension enrichment → AI analysis). Owner: Artem.

## 1. TL;DR
- The owner says US-only jobs used to appear (grayed out) in the feed and none have for days. **Backups confirm it**: 29 distinct US-only jobs existed, and **every one came from the Telegram bot** (@OffersHunterBot), which shut down 2026-10-15.
- The API feed that replaced the bot has never produced one. The likely cause is that Upwork does not list location-restricted jobs for a non-US freelancer account, while the bot supplied links that weren't limited by the owner's eligibility. This is a hypothesis, not proven.
- Falcon Scout's own code is not dropping them. Nothing found points to an Upwork policy change.

## 2. Background
- **Feed sources:** until Oct 15, jobs arrived from a paid Telegram bot (posting links). Since then the only source is the Upwork API, searching **as the owner's account (Ukraine-based)**. The API feed polls every 3 minutes, filtered by keyword, rate floors, payment-verified, stop words.
- **Enrichment:** a Chrome extension opens each job page and scrapes it. If the page says "Only freelancers located in the U.S. may apply", it stores `geo_restriction = "United States only"`. The UI (`JobList.jsx`) then dims the row (opacity .55, grayscale), adds a red border and a "🇺🇸 US only" badge. A "No US-only" chip hides those rows.
- **Retention:** the live database kept only the newest 200 jobs until 2026-10-15, then 2000. Older rows (except ones with proposals or stars) were deleted.

## 3. The problem as reported
The owner states, from memory, that US-only jobs used to be shown in the feed and he has not seen any for days. He asked whether Upwork changed its policy and stopped showing them. He said history was deleted but asked us to take his word. (Later evidence supports him; see 4.6.)

## 4. What we checked
1. **Live database.** 0 rows with a US-only value. *My first conclusion, "never existed", was wrong.* Reason: the live DB is a pruned window. See 4.6.
2. **Code.** The scraper regex `/Only freelancers located in (.+?) may apply/` converts the sentence to "United States only" correctly. The gray-out logic exists. `_row_passes` (the feed filter) has no location rule at all, so Falcon Scout never discards on this basis.
3. **Upwork API sweep** (as the owner's account): 739 postings over 12 search terms → **0** with a mandatory location restriction, 96 with a soft preference ("Preferred qualifications → Location"; I opened one such page, Apply stays enabled).
4. **Upwork UI**, read-only in the owner's logged-in Chrome (login confirmed by the logged-in navigation; no account details read):
   - Find Work tabs are Best matches / Most recent / Saved searches / Saved jobs / Invites. **No "U.S. Only" tab** (Upwork shows that to US-located freelancers).
   - 29 freshly opened Google Ads / SEO job pages → all labelled "Worldwide", none restricted, Apply available on all.
   - Search filters offer only client location and client time zone, nothing on freelancer location.
5. **Upwork help article** "How to verify your location for U.S.-only jobs": confirms hard US-only jobs exist (US-located, ID-verified freelancers only). It says nothing about who sees them in search, and is undated.
6. **Database backups** (five files, `upwork_jobs.db.bak-20261011…` to `…20261016…`): **29 distinct US-only jobs, all `source='bot'`**. In the Oct 11 backup, 20 of 126 enriched bot jobs from Oct 7–10 (~16%) were US-only, against **0 of 142** API jobs in the same window. Last capture: 2026-10-13 10:43. All were US clients and none had a proposal. For 19 of the 20, the stored description contains no "US only" wording, consistent with the flag coming from the page banner (which is not stored with the description); that is an inference.
7. **Direct-URL test** on five of those jobs: three still open for the owner's account and show the exact sentence "Only freelancers located in the U.S. may apply." (one shows it in the header label where "Worldwide" normally sits). One is now private and one is "no longer available". An Apply control is present on the three; I did not click it, so I don't know whether it is disabled for him.
8. **17 enriched rows with an empty location value:** three sampled, all say "This job is private". They are expired or private jobs, not hidden restrictions.
9. **US-client share** of captured jobs: steady at 38–51% per day, so jobs from US clients are unaffected.

## 5. Conclusions
**Established**
- US-only jobs really did appear in the feed, and only via the bot.
- They stopped when the bot's last batch ended (Oct 13). The API feed has never produced one.
- Upwork still uses the same wording, so the scraper and gray-out would work if such a job arrived.
- Falcon Scout is not filtering them out.

**Likely, not proven**
- Upwork excludes hard-restricted jobs from search/Find Work for a non-US account, but the job page is still viewable by direct link (see 4.7). The bot delivered links without regard to the owner's eligibility; the extension then opened them and read the banner. With the bot gone, the only feed is the owner's own eligibility-filtered search.

**Not established**
- Whether Upwork changed how search treats non-US accounts at some point (everything the owner saw earlier came via the bot, so it doesn't speak to that).
- Whose account or crawl the bot used.
- No evidence of any policy change was found.
- Practical weight: these jobs can't be applied to from a non-US account, so what was lost is informational (market signal; the owner's heuristic "US-only on PPC often means agency front").

## 6. Corrections to earlier statements in this investigation
- "There are no US-only rows in the database, ever" → **wrong**; backups hold 29.
- "I can't show a 'before'" → **wrong**; the backups provide one.

## 7. Side findings (not fixed)
1. **India leak:** the exclude rule matches the text "india", but the API labels some countries with ISO-3 codes (`IND`, `USA`, `GBR`, `AUS`). 12 Indian-client jobs got through in 10 days.
2. **Feed cap:** the UI requests no `limit`, so it shows the 200-row default, about one day of API volume.
3. **Bot chip:** filters ~170 dead rows, and the listener re-creates a `[TEST] Python / Telethon Integration` seed job on every start, which is the Bot view's newest "job".
4. **Unexplained:** two Upwork job IDs from the US-only list now sit on `source='room'` rows created by the inbox sync, with different titles and no location. Worth checking whether the owner ever replied to a US-only job.

## 8. What Cowork could double-check
- Ask Upwork support whether location-restricted jobs are excluded from search and Find Work for non-US freelancers.
- Have a US-based freelancer run the same search the same day and compare. If a US-only job appears for them and not for the owner, the hypothesis is confirmed.
- Decide whether the owner wants these jobs back in the feed. If so, the source would have to be something other than his own eligibility-filtered search (public category pages, another bot). Untested; and he couldn't apply to them regardless.
- Fix the side findings in section 7.

## 9. Evidence locations
`WORKLOG.md` entry 2026-10-29; backups `upwork_jobs.db.bak-*`; scraper `upwork-enricher/content.js` (~lines 154–170); gray-out `frontend/src/components/JobList.jsx:97`; feed filter `api/upwork_api.py` `_row_passes`; sample US-only job IDs in the Oct 11 backup: 17659, 17727, 17837, 17869, 17875.
