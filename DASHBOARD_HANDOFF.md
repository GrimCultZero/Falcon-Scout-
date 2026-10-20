# Dashboard & outcomes — handoff

**Written 2026-10-16.** Everything described here is committed and pushed on
`generator-rebuild` (head `37555e1`). Read this before touching
`dashboard_stats()`, proposal statuses, or the inbox sync — several of the rules
below look like bugs until you know why they are there, and two of them were
reverted once already.

Scope: the **period cards** (the SUBMITTED / VIEWED / INVITED / REPLIES / HIRED
row at the top of the Dashboard) and the outcome data behind them. The feed
changeover from @OffersHunterBot is a separate story in `WORKLOG.md`.

---

## 1. What a REPLY means

Owner, 2026-10-16, verbatim:

> we count a reply ONLY the 1-st message from a NEW client in the messages
> section. If e.g. someone replied to my cover letter a week ago and the
> conversation continues this current week (I write to him, he responds) — this
> shouldn't count as a new reply. Also, we only count new replies received this
> current week, there can't be anything from May, unless they replied this week.

Three rules follow, and all three are implemented:

1. A reply is the client's **first** message in a thread. Continuations never
   count again.
2. It belongs to the week **the client sent it**, not the week we noticed.
3. If we cannot establish that date, it belongs to **no** week. Unknown is not
   "this week".

---

## 2. Two clocks on one card — deliberate

| card | counted by | why |
|---|---|---|
| SUBMITTED | send date (`submitted_at or sent_at`) | cohort: "what I sent this week" |
| VIEWED | send date | see the warning below |
| INVITED | send date | `is_invited` flag, orthogonal to the funnel |
| REPLIES | `first_reply_at` | the event, dated when it happened |
| HIRED | `first_reply_at` | same |

`api/main.py:864` `_period()` carries the full rationale. `_ref()` (830) is the
send clock, `_event_ts()` (836) the event clock, `_in()` (853) decides window
membership.

### Do NOT move VIEWED onto an event clock

It looks inconsistent and it is tempting. It was tried and rejected:

- Only the **latest** transition timestamp is stored (`status_updated_at`);
  there is no transition history.
- So counting views by it makes a past week's VIEWED **drop** the moment an old
  proposal replies.
- That is exactly what the owner rejected on 2026-10-11 — week 41's VIEWED went
  13 → 12 when proposal 318 flipped viewed → replied. His words: *"let's not do
  that - leave views as they are and just add a reply."*
- `_REACHED_VIEWED = _POS | {"viewed"}` (827) exists for the same reason: each
  stage counts everything that **reached** it, so promotion never deducts.

`tests/test_dashboard_stages.py` asserts views stay on the send clock. If that
test fails, the fix is almost certainly not to change the test.

### The two reply rates

- `reply_rate_pct` — arrivals ÷ sends. What the card shows, so its own two
  visible numbers explain it. It mixes cohorts; it is a throughput ratio.
- `cohort_reply_rate_pct` — of proposals **sent** in the window, how many have
  since replied. The real conversion rate, stable and comparable across weeks,
  but near-zero for a week still in progress. Published in the payload, not
  currently rendered.

---

## 3. `first_reply_at` — the mechanism

`db.py:270`. Written **once**, never overwritten. That is the entire point: the
old behaviour read `status_updated_at`, which is the *latest* transition, so a
continuing conversation kept re-dating its own first reply.

Two writers, in priority order:

1. **`_first_client_message_at()`** (`api/main.py:4062`) — the earliest
   timestamp among the **client's** messages in a scraped thread. Best source.
   It may only move a stored date **earlier**; reading a thread late must never
   push a first reply forward into the week we happened to read it.
2. **`_stamp_first_reply()`** (`api/main.py:159`) — a `before_flush` hook on
   `Session`. Whatever path set the status, if it is now a reply and
   `first_reply_at` is NULL, the transition's timestamp fills it.

The hook exists because **ten** call sites move a proposal's status
(`grep -n '\.status = ' api/main.py`). Stamping by hand at each would be
forgotten within a month. If you add an eleventh, you get this for free — do not
"simplify" it back into the call sites.

### Where the timestamps come from (extension 5.14)

Upwork renders a day divider between message groups (`Wednesday, Oct 14`) and
the time on each group header (`Sinking Birdies  12:02 PM`). Both were being
discarded — `_MSG_UI_LINE_RE` dropped dividers as UI noise and `_MSG_TIME_RE`
was used only to find where the name ended.

- `_MSG_DATE_DIVIDER_RE` — `upwork-enricher/messages-list.js:540`
- `_msgStamp(divider, time)` — `:547`, handles Today / Yesterday / explicit
  year, and rolls an undated divider back a year rather than dating a message in
  the future.
- `_roomMessages()` — `:575`, now attaches `at` to each group.

Covered by `tests/message-timestamps.test.js` (17 assertions). **These only
flow when the room walk runs — see §5.**

---

## 4. State of the data right now

362 proposals, 54 positives, 51 with a `first_reply_at`.

The backfill (2026-10-16) used the **gap** between sending and the recorded
transition, not provenance. Provenance looked like the right discriminator and
is not: `auto_captured` rows were stamped from the conversation's own
last-activity date via `_reply_seen_at()`, which is a real Upwork date, not a
discovery time.

- 51 dated from the transition stamp (gap ≤ 30 days)
- proposal **318** set to `2026-10-11` from the owner's own note recorded in
  `tests/test_dashboard_stages.py`'s header — its stamp said Oct 14, which was
  the audit follow-up
- 3 left **UNKNOWN**, threads spanning months:

| id | sent | first noticed | status |
|---|---|---|---|
| 18 | 2026-05-30 | 2026-08-10 | replied |
| 329 | 2026-05-11 | 2026-10-12 | interviewing |
| 338 | 2026-03-20 | 2026-06-04 | replied |

Those three count in all-time and in no weekly card. They will self-correct if
their rooms are ever walked, because the extension path only moves dates
earlier.

DB backups from this work: `upwork_jobs.db.bak-20261016-*-first-reply`,
`-prop318`, `-source-backfill`. All gitignored.

---

## 5. Open issues, in the order I would take them

### 5.1 A decline is being counted as a reply — needs an owner decision

Proposal **328**'s entire client message is `then we are not a fit`. An outright
rejection, counted as a positive, because `_DECLINE_SIGNALS` (`api/main.py`,
search the constant) has no pattern for it — it covers "went with someone else",
"selected another", "no longer hiring", "thank you for your interest, but".

Marking it `declined` takes week 42 from 3 replies / 20% to 2 / 13%.

Not fixed because a loose `not a fit` over-fires on hedging: *"let me know if
it's not a fit"* is normal mid-conversation, and Sinking Birdies wrote *"If not,
no problem at all"* in a message where he was still engaged. A tight pattern
anchored on the bare statement (`we are not a fit`, `this isn't a fit`) catches
328 without those. **Ask the owner before shipping it** — this is a
classification rule, and owner rule 14 says new enforcement ships record-only
until approved.

### 5.2 The room walk does not run — blocks everything in §3

```
walk_skipped: "hidden"   rooms_visited: 0
rows_scraped: 20   matched: 14   not_matched: 6
```

Chrome on Windows reports a **covered** window as hidden, Upwork renders no
conversation in a hidden page, and the walk correctly refuses rather than
burning 15s per room (`upwork-enricher/messages-list.js`, search
`walk_skipped`). Six inbox threads match no proposal at all — William Ma's among
them, which is why he has no row anywhere.

Fix is the owner's to apply: `chrome://flags/#calculate-native-window-occlusion`
→ **Disabled**, restart Chrome. Verify with `rooms_visited > 0` in the next
`sync_runs` row. Until then `first_reply_at` cannot improve beyond the backfill.

Do **not** auto-drain the queue on `visibilitychange`: the walk navigates the
tab, and doing that to a window Artem just brought forward would yank a
conversation out from under him. The passive read of the open conversation is
the deliberate compromise.

### 5.3 A one-off spike is coming from the pager fix

`status_updated_at` is when Falcon Scout **noticed** a change, not when it
happened. Normally hours apart.

But the pager fix in `7609409` (extension 5.13+) now reaches past page 2 — the
scrape had been reading **17 of 85** submitted proposals. The first full pass
will discover status changes on ~68 proposals nobody has looked at in weeks, and
every one gets stamped with that moment. Expect a bump in whichever week it
lands. **It is a backfill, not a good week.**

If it looks bad, the mitigation is the same gap rule used above: a first-time
detection more than ~30 days after sending is not a fresh reply, so leave it
UNKNOWN rather than dating it today.

### 5.4 "Active proposals" is still never scraped

The proposals-list scrape reads `Submitted proposals (85)` only. `Active
proposals (7)` — invites and in-discussion work — is never read, so an invite
under discussion is invisible to the dashboard. This is the oldest open item
here and the biggest remaining blind spot.

### 5.5 Room-captured jobs look odd in the tracker

`_auto_capture_from_room` creates a Job with the **client's name** as the title
when no job title can be recovered (e.g. proposal 329, "Nave Maimon, Akison
Digital Services"). They are `source='room'` since `e582e6d` and excluded from
the feed since `5a51d0b`, but they still read strangely in Outcomes.

---

## 6. Things that are correct and must not be "fixed"

- **The stacked trend chart is exclusive on purpose** (`api/main.py:791`). Its
  segments must sum to the total, so there a reply genuinely does move out of
  `viewed`. The period cards are cumulative, the trend is exclusive, and
  `tests/test_dashboard_stages.py` guards both. They disagree by design.
- **The `funnel` census is deliberately unchanged** — see `DESIGN.md`.
- **A hire needs a contract artifact, never prose** (`bb36e13`).
  `_HIRE_CONTRACT_SIGNALS` is the whole list; `\bhired\s+you\b` was deleted
  after a client wrote *"The main reason I hired you was…"* while deciding
  whether to continue, and the dashboard reported a hire. A missed hire is a
  status corrected in one click; a false hire corrupts the number the whole
  funnel is judged by. `_signal_from_client_messages()` — the path that reads
  what the client **typed** — uses contract artifacts only.
- **`Job.source` has no default** (`e582e6d`). It used to default to `"bot"`,
  which filed room/proposal/extension rows as Telegram captures and inflated the
  bot's apparent value by 16 applied jobs. Every creation site declares itself.

---

## 7. Verifying a change

```bash
# every suite — 27 JS, 9 Python; all must pass
for f in tests/*.test.js;  do node "$f"                        | tail -1; done
for f in tests/test_*.py;  do ./.venv/Scripts/python.exe -I "$f" | tail -1; done

# the live cards
curl -s http://127.0.0.1:8000/dashboard-stats | python -m json.tool | less

# which proposals a week is counting, and why
sqlite3 upwork_jobs.db "
  SELECT p.id, substr(p.first_reply_at,1,10), p.status, substr(j.title,1,46)
  FROM proposals p LEFT JOIN jobs j ON j.id=p.job_id
  WHERE p.status IN ('replied','interviewing','hired')
    AND p.first_reply_at >= '2026-10-12' AND p.first_reply_at < '2026-10-19'
  ORDER BY p.first_reply_at;"
```

The backend runs under `uvicorn --reload` and picks up `api/` edits by itself.
Extension edits need a reload at `chrome://extensions`, and the version in
`upwork-enricher/manifest.json` is pinned by `tests/inbox-scrape.test.js` — bump
both together.

**Back up `upwork_jobs.db` before any data migration.** It is gitignored and
there is no other copy.

---

## 8. Commits behind all this

| commit | what |
|---|---|
| `37555e1` | a reply is the client's FIRST message, dated when they sent it |
| `bb36e13` | a hire needs a contract, not a client's sentence |
| `7609409` | reply counted in the week it arrived; pager reaches past page 2 |
| `5a51d0b` | old inbox conversations no longer show as fresh jobs *(other instance)* |
| `e582e6d` | a row says where it came from instead of defaulting to "bot" |
| `9afa834` | old inbox threads no longer count as this week; one view no longer smears |

Narrative, with the evidence for each decision, is in `WORKLOG.md` under
2026-10-15 and 2026-10-16.
