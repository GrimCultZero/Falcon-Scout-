# Falcon Scout — Generator & Sync Rebuild — Handoff for the next Claude instance

**Updated:** 2026-09-30 (supersedes the 2026-09-02 version) · **Owner:** Artem Yatsuk
**Branch:** `generator-rebuild` — 53 commits ahead of `main`, all pushed to `origin`
(`https://github.com/GrimCultZero/Falcon-Scout-.git`). **`main` is untouched; nothing is merged — never merge
without asking.**
**Canonical detail:** `WORKLOG.md` (every item below has a dated entry with evidence), `DESIGN.md` §21–§23,
`CASES.md` (verified case facts). `ANTIFAB_HANDOFF.md` is the grounding-checker lineage (historical).

---

## 0. Read-me-first

1. **Repo state.** Everything of ours is committed and pushed. Two modified files are the **owner's local
   edits — never commit them:** `cli-bridge.js`, `frontend/src/App.jsx`. Stage files by name, never
   `git add -A`.
2. **Never commit real client data:** `upwork_jobs.db`, `tests/.letters.json`, `share-with-claude.md`,
   `corrections/`, `tools/_letter_features.json`, `messages_sync_debug.json`, `messages_passive_debug.json`.
   Most are gitignored; `corrections/` and `tools/_letter_features.json` are merely untracked — careful.
3. **The app is normally running:** backend `.\.venv\Scripts\uvicorn api.main:app --reload` on :8000
   (auto-reloads on save), frontend Vite on **:5180** (HMR). The Chrome extension lives in `upwork-enricher/`;
   **any extension change needs a reload at `chrome://extensions`** — its version (now **5.5**) shows up in
   `messages_sync_debug.json` → `walk_info.extension_version`, which is how you confirm he reloaded.
4. **Read §7 (working agreements) before fixing anything.**
5. **In flight when this was written:** the first passive-read test (5.4) left no trace; 5.5 reports
   every miss and re-injects itself into open tabs on reload. Artem is to reload and open a conversation
   again. See §8.1 for exactly what to check.

---

## 1. How the owner works with you

- He presses **"Share with Claude"** in the app → `share-with-claude.md` at the repo root, plus a permanent copy
  in `corrections/<ts>-job-<id>.md`. He then writes a short comment: "shared", "audit term?", "where are case
  studies?". **`share-with-claude.md` is overwritten on every share** — the newest `corrections/` file is the
  one he just meant.
- The loop that works: **analyse → state findings + proposed fixes → he says "fix" / "fix all" → fix, test,
  WORKLOG entry, commit, push → tell him what to do to see it.** He sometimes answers a question with the
  next symptom instead of "yes"; read that as a yes to the obvious fix, but ask when a real decision is his.
- He writes tersely and fast; he cares about correctness of claims (no fabrication), about the owner rules in
  §7, and about not wasting his money (no test generations, cost-aware AI calls).
- **When he says a fix of yours was wrong, revert it explicitly and say so.** It happened twice this month
  (the `missingAuditPriceEntirely` gate and the "do not pitch an audit" wording — both reverted 2026-09-29).

---

## 2. Generator architecture (what you'll touch most)

`frontend/src/components/JobDetail.jsx` → `generate()`:

1. **Job classification** (Haiku, cached per job; `_CLASSIFICATION_FIELDS` = asks_for_rate,
   is_audit_request, client_is_agency — a missing field forces re-classification).
2. **KB fetch + routing** — rules carry `scope:` tags; `jobScopes()` picks scopes from the posting,
   `rulesForGenerator()` filters. Negated launch wording is blanked before `launch` routes; a running account
   routes `audit`; the `agency` scope (KB #406/#408, white-label positioning) is dropped unless the posting
   asks for white-label. The same block builds the **case-study portfolio**, reference templates and past
   proposals. **Its catch now logs + flags `kbContextFailed` — keep it that way (§6.1).**
3. **Prompt** — a static cached prefix (the split marker is "=== JOB-SPECIFIC CONTENT (uncached) ===") plus
   job-specific notes in `jobContext`: RATE ANCHOR / NO PRICING, MIXED SEO + PPC, GOOGLE ADS + META, RUNNING
   ACCOUNT, ACTION OVER AUDIT, CLIENT TYPE (white-label / specialist hire / direct), the application
   checklist, the case-facts block (`renderCaseFactsBlock`).
4. **Claude call** (`claude-sonnet-4-5`; the "Rescan & Re-write" button = `coreOnly`, `_kind:
   proposal_rescan`).
5. **Strip chain** — one line, ~30 nested functions, runs **before** the checks (since 2026-09-15) so checks
   see the shipped text. Includes the grounding checker (`_gcShadow` → `lib/groundingCheck.js`,
   `GC_ENFORCE = true` since 2026-08-19).
6. **Deterministic inserts** after the chain: the running-account audit close (`ensureRunningAccountAuditCta`)
   and the offer lead (`ensureAuditOfferLeads`).
7. **Checks** — report only (the rewrite "enforcer" was deleted 2026-09-02), → `ruleFlags` under the letter
   (telemetry-only codes filtered by `_INFO_ONLY_CODES`) and `rule_violations`.
8. **Live notes** in `ProposalColumn` ("Fix before sending", attach reminder) recompute from the textarea on
   every edit.

Libraries (pure, tested): `lib/caseLedger.js` (16 cases: metrics, geo/location, periods; `fixCaseGeoClaims`),
`lib/groundingCheck.js`, `lib/letterGuards.js` (every "does the posting ask X / does the letter do Y"
detector — **rule of thumb: a detector that decides a check gets a lib function and a corpus test**).

---

## 3. Outcomes sync architecture (the other thing you'll touch)

- **Proposals leg** — background tab on `/nx/proposals/` (paginated, air3 pager) → `/proposal-status-sync`,
  logged in `sync_runs`.
- **Messages leg** — `background.js _openSyncWindow`: an unfocused window moved off-screen →
  `messages-list.js` scrapes the conversation list → `/messages-status-sync` → debug in
  `messages_sync_debug.json` (rows, match_log, redated, status_from_messages, walk_info incl. `list_diag`).
- **Room walk** — first visit to a room links it to a proposal (ids/titles cached in `chrome.storage`
  `falcon_room_obs_v1`); unread rooms are never opened (opening marks them read).
- **5.3 re-read** — rooms whose preview/time changed since the last sync (baseline `falcon_room_preview_v1`)
  are opened again to read messages. **It cannot work in the sync window:** Chrome on Windows reports an
  off-screen or covered window as hidden, and Upwork renders no conversation in a hidden page (5.3 in the
  field: 4 rooms, `rendered:false`, `vis:"hidden"`, 15 s each). 5.4 skips walking when hidden
  (`walk_skipped:"hidden"`; moved rooms stay queued).
- **5.4 passive read** — when Artem opens a conversation himself (visible page), `messages-list.js` reads it
  (read-only) and posts one row flagged `passive` → same matching and outcome reading → debug in
  `messages_passive_debug.json`. Once per room, again after 2 min while open. **5.5:** a miss is posted
  too (no rows; `walk_info.note` says why, `walk_info.rooms[0]` has the probe diag + `text_sample`); the
  room is read only after the conversation list renders; on extension reload the background injects the
  script into Upwork messages tabs already open (not sync tabs), and orphaned copies stop.
- **Backend** (`api/main.py`, `messages_status_sync`): room-evidence matching (exact paths:
  `room_proposal_id`, `room_title`, `job_id`, …); promote to `replied` (never downgrade; ghosted → replied on
  exact evidence); `_reply_seen_at` dates a change by the conversation's last activity (`last_activity_at`
  from the list row) and re-dates late-stamped replies backwards; `_signal_from_client_messages` reads the
  **client's** messages newest-first for hire / interview / decline (`_OUTCOME_FROM` — never over a hire),
  exact matches only.
- **Manual capture** (popup button) → `/capture-conversation` — a paid Claude parse; not used automatically.

---

## 4. What changed since the 2026-09-02 handoff (by theme — see the dated WORKLOG entries)

**Rebuild steps.** Enforcer deleted (09-03). Strip chain moved before checks (09-15, old §6.3 closed).
`client_is_agency` classifier (09-03). Website Inspect int64 fix (09-03).

**Owner-rule guards made certain in code** (`letterGuards.js`): no call offers (strip + check, 09-24); an
offered audit always mentions its sample (09-24); case location/timeframe checked against the ledger, places
auto-removed (09-24/09-27; Atlant states no location, Golden State Trailers only "US" — owner, 09-25);
bare SEO audit turnaround stripped (09-25); SEO prices fixed at $700 / $1,050 (09-25); never web-dev case
studies on Google Ads jobs (09-25); white-label / agency pitch only when the posting asks (09-29); running
accounts always close on the audit offer, and the offer comes first ("I can run a full audit … within 1
working day"), then the description (09-29).

**Detector fixes found on real letters:** negated "from scratch" (09-27), "signal"/"-wise" circumvention
false alarms (09-27), logistics the posting asked about (09-29), posting figures never read as case metrics —
they were deleting the sentence that named the case (09-29), audit-sample and cramming detectors (09-25),
timeline and example asks (09-25), missing case study = no case paragraph with its note (09-29).

**The big one — 2026-09-29:** from 2026-08-10 (`9a48f23`) to 2026-09-29 the prompt held **no case-study
portfolio, no reference templates and no case-facts block**: a use-before-declaration of `fullDescription`
inside the KB block threw, and a silent `catch {}` swallowed it. `missingCaseStudy` never fired in 276
generations. Fixed (`4055199`). Letters now read differently — watch them.

**KB data fixes (not in git; backups in that session's scratchpad):** KB #1 header ("Real Estate Complex",
no "(USA)"), KB #407 and #437 no longer carry the fabricated Skin Reboot "$12k to $95k" (now "+693.8%
revenue"). Proposal 238 set to `declined` by hand (Sofia Toro's decline, 09-30).

**Sync (09-16 → 09-30):** proposals pager (the list is paginated, not scrolled), messages window that never
opened (illegal bounds), un-ghosting on exact evidence, Outcomes sorted by reply time; 09-30: the list is
scraped top-down from the real room-list scroller (the sync lands on the last room opened and Upwork scrolls
to it), replies dated by the conversation, the free re-read (5.3) and the passive read (5.4).

---

## 5. Open questions waiting on the owner (don't decide these yourself)

1. **Web-dev case rule for SEO jobs** — the rule covers Google Ads postings; should SEO postings also never get
   SMASH / Game-X / GKit / Casa Eleganza? (asked 09-25; a replied SEO letter cited GKit's hreflang work).
2. **KB Rule 426** — are there other legitimate SEO prices ($900 / $950 per month, $1,200 project) or only
   $700 / $1,050? (asked 09-25)
3. **Case timeframes** — auto-remove invented ones like places? Today they're record-only; two letters on 09-29
   invented Nectar Flowers timeframes ("inside 90 days", "30 days"). New enforcement classes need his OK.
4. **Extend `CASE_LEDGER` with KB #506's real figures** — FridgeFix $0.67/conversion, Skin Reboot overall ROAS
   15.04 / 50,036 clicks, etc. `metricNotInLedger` flags them today and, under enforce, deletes their
   sentences along with genuinely invented ones.
5. **Chrome occlusion flag** (optional) — "Calculate window occlusion on Windows" set to Disabled would let
   the hidden sync window render, so the background walk could read rooms too. Unverified that his Chrome
   still has the flag. The passive read works without it.

---

## 6. Known limitations and watch list

1. **Prompt assembly must never fail silently.** The KB block's catch now records `kbContextFailed`. If you
   see it in `rule_violations`, the letter was written without the portfolio.
2. **Letters changed on 09-29** (portfolio + case facts back after seven weeks). Re-measure the case-fact drift
   (CASES.md "Finding — case locations and timeframes drift") after some real generations.
3. **Running-account detector** (`postingHasRunningAccount`) is precise, recall ~½ (it misses "manage and
   optimize Google Ads campaigns" without "our"). Vague postings rely on the prompt wording.
4. **Room reading needs a visible page** — see §3. The passive read is the working path.
5. Still open from the old handoff: the dash limiter makes comma splices (`_humanizeCasing`); brand names
   lowercase ("mr chef"); Tier-A dead code not deleted (re-query "never fired" checks on clean telemetry);
   `/jobs/{id}/analysis` GET status (verify before relying on it); cli-bridge port collision with `baba-leada`.
6. Not built: a check for unbacked volume claims ("dozens of stores" — none in the 256 sent letters so far).

---

## 7. Working agreements with Artem — read before fixing anything

Original, still binding:

1. **Correctness bugs → fix immediately.** Fabricated claim, wrong price, mangled sentence, a mandatory
   business rule silently suppressed.
2. **Everything else → log it, don't patch it** (tone, structure, length) — unless he asks.
3. He shares letters via the button plus a comment. When he has it, ask for **his version** of the bad sentence.
4. **Never quote rates or retainers unless the posting asks** (`_postingAsksRate` gates the price checks).
5. **Do not batch-generate letters** to produce test data. Validate against the corpus instead (§9).
6. Never enter credentials, log in, or act in his Upwork account.

Owner rules added this month (all enforced in code, see §4):

7. **No call offers, ever** — not a call, screen-share, walkthrough or kick-off meeting.
8. **An offered Google Ads audit:** done by hand, delivered within 1 working day (KB #402), a recent sample
   attached (#404), $300 flat only if the posting asks for pricing, credited back if ongoing work is signalled.
9. **Running account → the audit offer is the last paragraph**, and it opens with the offer, then describes it.
10. **White-label / agency framing only when the posting asks for it** — an agency buyer is not an ask.
11. **No web-dev case studies on Google Ads jobs.**
12. **Case geography:** Atlant — never a location; Golden State Trailers — "US" only; the ledger's `location`
    is what a letter may say.
13. **SEO prices:** $700 flat technical audit, $1,050/month retainer (KB Rule 426).
14. **New enforcement classes ship record-only** unless he approves enforcing them.
15. **KB content edits:** back up first, keep them minimal, tell him exactly what changed.

---

## 8. What to do next

### 8.1 Right now — check the 5.5 test
The 5.4 sync (15:02, 30 Sep) was fine: `walk_skipped: "hidden"`, list read from the top. The passive
read left no file at all (see WORKLOG 09-30 "left no trace"). After he reloads 5.5 and opens a client
conversation:
- **No `messages_passive_debug.json` at all** → the script is not running in his tab (or the backend is
  down). Ask him to press F5 on the Upwork tab and open the conversation again. If that fixes it, Upwork
  reached the page by in-app navigation from a non-messages page — content scripts only load with a page.
- **File with `rows: []`** → a miss; `walk_info.note` says which (list did not render / room did not
  render / rendered, no messages parsed / error) and `walk_info.rooms[0]` has the probe diag + `text_sample`.
- **File with one row** → `rows[0].recent_messages` should hold the thread with correct `from` (client /
  artem); `status_from_messages` lists any outcome it applied.
- If `recent_messages` is empty or mis-attributed: fix `_roomMessages` (`_MSG_TIME_RE`, `_MSG_UI_LINE_RE`,
  `_SELF_NAME_RE` in `messages-list.js`) from `text_sample`, add the real shape to `tests/inbox-scrape.test.js`.

### 8.2 Then
- Get answers to §5.
- Rebuild steps still not started: playbooks (the 7–10 letter shapes, from the 256 sent letters — the
  fastest win), the offer table, the *use* half of the corrections store (feeding his chat corrections back).

---

## 9. How to verify

```bash
for t in tests/*.test.js; do node "$t" | tail -1; done   # 16 suites
./.venv/Scripts/python tests/test_room_evidence.py
./.venv/Scripts/python tests/test_reply_dates.py
./.venv/Scripts/python tests/test_status_from_messages.py
```

Corpus sections need `tests/.letters.json` (256 sent letters with their postings; rebuilt by
`python tools/dump_letters_fixture.py` from the DB — never commit it). The DB prunes old jobs, so for posting-
side validation union a fresh dump with older ones. Useful telemetry: `rule_violations` (per generation),
`token_usage` (cost — compute at $3/$15 per M), `sync_runs`, `proposals`.

---

## 10. Methodology — learned the hard way

1. Never count parentheses by eye in the strip chain; stub and evaluate in Node.
2. Find block boundaries by brace depth, not indentation.
3. **Validate every detector against the real corpus before shipping** — postings (DB) and the owner's own
   behaviour (sent letters). Read every hit. It caught false positives every single time this month.
4. Verify against the real extracted pattern, not a hand-copied subset.
5. Test a fix, and be willing to throw it away.
6. **Shell quoting corrupts content** — heredocs collapse `\\`, `\b` becomes 0x08. Write scripts with the
   Write tool. **`sed -i` in Git Bash converts a CRLF file to LF** — `JobDetail.jsx` and `api/main.py` are
   CRLF in the working copy (the libs are LF); edit with the Edit tool and check "bare LF 0" afterwards.
7. When your own script contradicts a careful finding, suspect the script (a TDZ scan once matched its own
   comment; a regex search matched a nav link instead of the list).
8. Trust telemetry over reasoning about what fired.
9. **A `const` read before its declaration in the same function throws** — inside a try it disappears if the
   catch is silent. That is how the portfolio went missing for seven weeks. No silent catches around anything
   that builds the prompt.
10. **A generation that ran while you were mid-edit ran mixed code** — compare `rule_violations` /
    `token_usage` timestamps with your commit time before blaming (or crediting) the new code.
11. Tests that lift code from source files break when the lifted code starts calling imports — pass the
    imports in as parameters (see `white-label.test.js`, `audit-cta.test.js`).

---

## Copy-paste kickoff for the next instance

> Read `GENERATOR_REBUILD_HANDOFF.md` in `C:\Users\syzov\upwork-cockpit` (branch `generator-rebuild`), then
> the last few dated entries in `WORKLOG.md`. Start with §8.1: check `messages_passive_debug.json` from the
> conversation I opened on extension 5.5 and tell me whether the passive read parsed it.
> Don't commit `cli-bridge.js` or `frontend/src/App.jsx`.
