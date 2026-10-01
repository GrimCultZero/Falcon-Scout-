# Falcon Scout — Session Handoff

**Written:** 2026-10-01 · **Branch:** `generator-rebuild` @ `a41301d` · **Owner:** Artem Yatsuk
**Verified at the time of writing:** 18 JS + 3 Python suites pass; branch in sync with `origin`;
60 commits ahead of `main`.

This is the **pick-up-and-go** doc: current state, what's uncommitted, what's open, what's next.
It deliberately does **not** restate architecture — that lives in the docs below.

---

## 0. Which doc is which (read in this order)

| File | What it is | Freshness |
| --- | --- | --- |
| **this file** | Current state, uncommitted work, open issues, next steps | 2026-10-01 |
| `GENERATOR_REBUILD_HANDOFF.md` | **The deep one.** Generator + sync architecture, owner rules, methodology | 2026-09-30, still accurate |
| `WORKLOG.md` | Dated narrative, every claim's evidence (9,150 lines — read the last few entries) | 2026-09-30 |
| `DESIGN.md` | Settled architecture decisions (§21–§23 = anti-fabrication) | current |
| `CASES.md` | Verified case-study facts and findings | current |
| `CLAUDE.md` | Protocol: pull at start, append to WORKLOG, commit+push, never commit secrets | current |
| `PROJECT_HANDOFF.md` | How the app works end to end | background |
| `ANTIFAB_HANDOFF.md` | Grounding-checker lineage | **historical** |
| `THURSDAY.md` | Agenda from 2026-05-25 | **stale — ignore unless doing archaeology** |

**`main` is untouched. Nothing is merged. Never merge without asking.**

---

## 1. Current state

**Repo.** Everything of ours is committed and pushed to `origin/generator-rebuild`. Working tree holds only
the owner's two local edits (§2) and untracked client data (§2).

**Tests — all green, run today:**
```bash
for t in tests/*.test.js; do node "$t" | tail -1; done   # 18 suites
./.venv/Scripts/python tests/test_room_evidence.py
./.venv/Scripts/python tests/test_reply_dates.py
./.venv/Scripts/python tests/test_status_from_messages.py
```

**The last two commits** (both landed after the 2026-09-30 handoff refresh, so that doc doesn't cover them):

- `61f3ea7` — **an armed Digit Bomb no longer loses to past letters' openings.** Job 16872: Skin Reboot armed
  twice, both letters opened with FridgeFix, copying a past letter's opening sentence near-verbatim. While a
  bomb is armed, `_dropPastLetterOpenings` strips each past letter's first paragraph and a "DIGIT BOMB — LAST
  CHECK" block restates the armed case before FINAL OUTPUT FORMAT. Unarmed letters are unchanged.
  `tests/digit-bomb-openings.test.js`, 10/10.
- `a41301d` — **woven call offers are rewritten, not just reported.** Owner on job 16869: "offering kick off
  call - should never do it". `offersCall` fired but `stripCallOffers` missed both instances. Session nouns
  widened (kick-off, onboarding, handover, walkthrough, wrap-up…, deliberately *not* discovery/strategy — in
  537 real letters every such match was the client's own funnel); a call woven mid-sentence now becomes its
  written counterpart in place. `tests/letter-guards.test.js`, 63/63.

**App runtime.** Backend `.\.venv\Scripts\uvicorn api.main:app --reload` on :8000 (auto-reloads), frontend Vite
on :5180 (HMR), Chrome extension **5.7** in `upwork-enricher/` — **extension changes need a reload at
`chrome://extensions`**; confirm the version landed via `messages_sync_debug.json` → `walk_info.extension_version`.

**The live experiment** (carried from the 09-30 handoff §8.1, not re-verified today): the **passive messages
read** works as of extension 5.5 — when Artem opens an Upwork conversation himself, `messages-list.js` reads it
read-only and posts one row. 5.6 ends the thread at the client's card; 5.7 stopped the job-page reader writing
"payment not verified" for a panel it couldn't see. This is the thing to check first — see §5.

---

## 2. Uncommitted and untracked — and what to do with it

**Two modified files. These are the owner's local edits. NEVER commit them.**

| File | Change | Why |
| --- | --- | --- |
| `cli-bridge.js` | `PORT = 27183` → `27184` | Port collision with his other project (`baba-leada`) running its own bridge on 27183 |
| `frontend/src/App.jsx` | bridge ping URL → `127.0.0.1:27184` | Must match the line above or the UI shows the bridge offline |

They are consistent with each other, so the app works locally. They're local-only because 27183 is still the
committed default. Leave them alone.

**Untracked — real client data, never commit:**
- `corrections/` — 43 files, one per "Share with Claude" press (newest: `20260930T134127-job-16878.md`)
- `tools/_letter_features.json`

Also never commit (mostly gitignored, but check): `upwork_jobs.db`, `tests/.letters.json`,
`share-with-claude.md`, `messages_sync_debug.json`, `messages_passive_debug.json`.

**→ Stage files by name. Never `git add -A`.**

---

## 3. Operational gotchas (not recorded in any other doc)

**The CLI bridge "is not starting" is usually an auth problem, not a bridge problem.** Diagnosed 2026-09-17:

- The bridge runs `claude -p` under an **isolated profile**, `CLAUDE_CONFIG_DIR=~/.claude-artem`, so calls bill
  to Artem's own subscription rather than whatever account owns the machine's default `~/.claude`.
- That profile needs its **own** `/login`. It had been recreated and never authenticated, so every request came
  back `{"error":"Not logged in - Please run /login"}` — which surfaces in the UI as a generic *CLI bridge
  error* and reads exactly like the bridge failing to start. The bridge was running fine the whole time.
- **Fix** (must be a real terminal — typing this into a Claude Code chat box does nothing):
  ```powershell
  $env:CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-artem"
  claude          # then /login inside it, approve in the browser
  ```
- **Check it without guessing** — this is exactly what the bridge does:
  ```powershell
  $env:CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-artem"
  "reply with just: ok" | claude -p --model sonnet --strict-mcp-config --disable-slash-commands
  Invoke-RestMethod -Uri "http://127.0.0.1:27184/ai" -Method Post -ContentType "application/json" `
    -Body '{"prompt":"reply with just: ok","model":"sonnet"}'
  ```
- `falconscout.bat` starts the bridge in its own window. If the port is already held, `cli-bridge.js` prints an
  EADDRINUSE message and exits 1 — the window stays open (`cmd /k`), so that message is visible, not silent.

---

## 4. Open issues

### 4.1 Waiting on the owner — do not decide these yourself
Carried forward unchanged from `GENERATOR_REBUILD_HANDOFF.md` §5; nothing since has resolved them.

1. **Web-dev cases on SEO jobs** — the ban covers Google Ads postings. Should SEO postings also never get
   SMASH / Game-X / GKit / Casa Eleganza? (asked 09-25; a *replied* SEO letter cited GKit's hreflang work)
2. **KB Rule 426** — are $900/$950 per month or $1,200 project legitimate SEO prices, or only $700 / $1,050?
3. **Case timeframes** — auto-remove invented ones the way places are removed? Record-only today; two letters
   on 09-29 invented Nectar Flowers timeframes. New enforcement classes need his OK (owner rule 14).
4. **Extend `CASE_LEDGER` with KB #506's real figures** (FridgeFix $0.67/conversion, Skin Reboot ROAS 15.04…).
   `metricNotInLedger` flags them today; under enforce it would delete those sentences.
5. **Chrome occlusion flag** (optional) — disabling "Calculate window occlusion on Windows" would let the hidden
   sync window render so the background walk could read rooms. The passive read works without it.

### 4.2 Watch list
- **Letters changed on 2026-09-29.** From 2026-08-10 to 2026-09-29 the prompt carried **no case-study portfolio,
  no reference templates, no case-facts block** — a use-before-declaration inside a silent `catch {}`.
  `missingCaseStudy` never fired across 276 generations. Fixed in `4055199`. **Re-measure the case-fact drift**
  (CASES.md, "case locations and timeframes drift") now that real generations have the portfolio again.
- `kbContextFailed` in `rule_violations` means a letter was written without the portfolio. Keep that flag.
- **Running-account detector** is precise but ~½ recall (misses "manage and optimize Google Ads campaigns"
  without "our"). Vague postings fall back to prompt wording.
- Room reading needs a **visible** page — the passive read is the only working path (see §3 of the deep handoff).
- Long-standing, unfixed: `_humanizeCasing`'s dash limiter manufactures comma splices; brand names come out
  lowercase ("mr chef"); Tier-A dead code still not deleted (re-query "never fired" checks on clean telemetry);
  `/jobs/{id}/analysis` GET status unverified.
- Not built: a check for unbacked volume claims ("dozens of stores") — zero occurrences in 256 sent letters.

---

## 5. Next steps

1. **First thing: check the passive read.** Ask Artem to open a conversation on Upwork, then read
   `messages_passive_debug.json`:
   - **no file** → script isn't running in his tab (or backend down). Ask for F5 on the Upwork tab and reopen
     the conversation. If that fixes it, Upwork reached the page by in-app navigation — content scripts only
     load with a page load.
   - **`rows: []`** → a miss; `walk_info.note` says which, `walk_info.rooms[0]` carries the probe diag +
     `text_sample`.
   - **one row** → `rows[0].recent_messages` should hold the thread with correct `from` (client / artem).
     If empty or mis-attributed, fix `_roomMessages` (`_MSG_TIME_RE`, `_MSG_UI_LINE_RE`, `_SELF_NAME_RE` in
     `messages-list.js`) from `text_sample` and add the real shape to `tests/inbox-scrape.test.js`.
2. **Get answers to §4.1** when he's responsive — several are blocking enforcement work.
3. **Rebuild steps still not started**, in order of value:
   - **Playbooks** — the 7–10 letter shapes, extracted from the 256 sent letters. The fastest remaining win.
   - The **offer table** + CTA slot.
   - The ***use*** half of the corrections store — feeding his chat corrections back into the prompt. The
     capture half has been running since 09-02 and has 43 files sitting there unused.

---

## 6. Working agreements — the ones most costly to get wrong

Full list in `GENERATOR_REBUILD_HANDOFF.md` §7. The ones a fresh instance breaks first:

- **Correctness bugs → fix immediately. Everything else (tone, structure, length) → log it, don't patch it.**
  Ad-hoc regexes making the next letter worse is the entire reason for this rebuild.
- **Never quote rates or retainers unless the posting asks.**
- **No call offers, ever** — no call, screen-share, walkthrough or kick-off.
- **New enforcement classes ship record-only** unless he approves enforcing them.
- **Do not batch-generate letters** to make test data — validate against the corpus instead.
- **Never log into, or act in, his Upwork account.**
- When he says a fix of yours was wrong, **revert it explicitly and say so.**

**Methodology that has paid for itself** (full list in §10 of the deep handoff): validate every detector against
the real corpus before shipping and read every hit; `sed -i` in Git Bash converts CRLF files to LF
(`JobDetail.jsx`, `api/main.py` are CRLF — use the Edit tool); no silent catches around anything that builds
the prompt; trust telemetry over reasoning about what fired.

---

## Copy-paste kickoff for the next instance

> Read `SESSION_HANDOFF.md` in `C:\Users\syzov\upwork-cockpit` (branch `generator-rebuild`), then
> `GENERATOR_REBUILD_HANDOFF.md` and the last few dated entries in `WORKLOG.md`. Start with §5.1: check
> `messages_passive_debug.json` from the last conversation I opened (extension 5.7) and tell me whether the
> passive read parsed it cleanly. Don't commit `cli-bridge.js` or `frontend/src/App.jsx`.
