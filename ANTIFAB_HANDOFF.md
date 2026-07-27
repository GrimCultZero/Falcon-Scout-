# Anti-Fabrication Rework — Handoff for the next Claude instance

**Created:** 2026-07-24 · **Status:** SCOPED, not started · **Owner:** Artem
**Canonical spec:** `DESIGN.md` **§21** (read it — this file is the operational "how to pick it up" layer; §21 is the source of truth for decisions).

---

## 0. Read-me-first (session bootstrap)

1. `git pull` (this repo is worked from multiple Claude accounts — see `CLAUDE.md` memory protocol).
2. Read `DESIGN.md` **§21** (the plan) and **§16** (the earlier hallucination-mitigation overhaul this supersedes).
3. Skim `CASES.md` (real, verified case-study figures — the ground truth you'll seed the ledger from).
4. Then read §2–§5 of THIS file and start at §6 (Step 21-A).

**Working rules (from `CLAUDE.md`):** tactical fixes — just do them; strategic/multi-file — check in first. All Claude calls go through the `/claude` proxy. Auto-commit + push after each meaningful chunk (append to `WORKLOG.md`). Never commit secrets.

---

## 1. What this is, in one paragraph

The proposal **generator** keeps shipping fabrications and structural bugs no matter how many fixes we add, because its architecture is **"generate freely, then police with regex."** We are inverting it to **"constrain → generate → verify"**: (A) turn case studies into structured **data** the model can only reference by ID, (B) add a **deterministic grounding checker** that strips any factual claim not traceable to an allowed source, (C) then **slim the bloated prompt**. This handoff tells you exactly where the problem lives in the code and how to build A→B→C without regressing a tool Artem sends from daily.

---

## 2. The finding (diagnosis) — with code evidence

The generator lives in **`frontend/src/components/JobDetail.jsx` (~6,955 lines)**. Measured facts:

- **312** prohibition phrases ("never / do not / must not…") in the system prompt.
- **~40** regex post-processors that rewrite the LLM's output.
- A second **Haiku "enforcer"** call that the code itself distrusts:
  - `JobDetail.jsx:1580` — *"the enforcer LLM (Haiku) has repeatedly IGNORED…"*
  - `JobDetail.jsx:1941` — *"The prompt rule … is unreliable, so enforce it in code."*
- The final output is assembled by a **~15-deep nested pile of `_strip*` functions** — see the literal call at **`JobDetail.jsx:5963`** and **`:6398`** (`setProposal(_unwrapFilledPlaceholders(_humanizeCasing(_stripUnaskedRate(_stripDuplicateDifferentiator(_stripKbLeak(_fixPdfCaseLabelMisattribution(…)))))))`). That single line *is* the whack-a-mole, made concrete.

**Why it can't converge** (full argument in §21.1):
1. Guards are per-instance — each new bug = a new regex matching *that exact wording*; the model rephrases and the next failure is a shape no regex anticipated.
2. The 312-prohibition prompt self-dilutes — killed fabrications resurge (e.g. Skin Reboot "$12k→$95k", killed 3+ times per `WORKLOG.md`).
3. Three drifting sources of truth: generator LLM, Haiku enforcer, regex layer.
4. **The KB/winners are used as STYLE, not a CHECKED fact source** — the model imitates the *shape* of good letters and invents plausible specifics. Nothing asks "does every claim trace to an allowed fact?"
5. **Cases are stored as prose**, so they recombine freely. `_CASE_META` (**`JobDetail.jsx:1782`**) lists 16 cases **by name-regex only**, carrying `{re, name, pdf}` and **zero metrics**. The real numbers live scattered in the prompt / KB / `CASES.md`.

**Smoking gun that proves regex won't fix it:** a `caseDuplication` violation guard *already exists* (**`JobDetail.jsx:1633`**), yet the 2026-07-24 letter still emitted the **same two case studies twice** — because the existing guard catches *crammed/adjacent* duplicates, not *two separately-labeled results blocks*. New shape → guard misses. That is the treadmill.

**The two failures on the 2026-07-24 letter** (the trigger for this rework), both un-catchable by the current approach:
- **Novel-shape fabrication:** "your Danish D2C brand **launching in Israel**" + "IL targeting", "Danish/English keywords" — the target market was **inferred from the client's Upwork account country**, which the posting never states.
- **Structural bug:** the case block was emitted **twice**.
- (Good news, and proof the direction is right: that letter had **zero fabricated metrics** — the earlier grounding contract held on numbers. The failures were exactly the classes A+B target.)

---

## 3. The plan (A → B → C)

Full detail in `DESIGN.md` §21.3–21.6. Summary:

### A. Structured case ledger (§21.3)
Cases become data. New `cases` store (a table is cleaner than a `kb_entries` sub-type — decide at build), one row per case:

`id` (slug) · `name` · `vertical` · `service` (ppc/seo/web-dev) · `attachment` (pdf/profile-highlights/none) · `metrics` (JSON array of **fixed approved strings**) · `one_liner` · `is_real` (bool)

- **Seed from real data:** the 16 names in `_CASE_META` (`JobDetail.jsx:1782`) + verified figures already in `CASES.md` (e.g. `CASES.md:138` — Skin Reboot: `+693.8% revenue`, `17.51 PMax ROAS`, overall `15.04`). **Copy every metric from an existing verified record — never invent one.** No verified figure → `metrics: []` and Artem fills it.
- **How the generator uses it:** the model may only emit a placeholder like `{{case:skin-reboot}}`; the app expands it into the canonical line (name + inline attachment label + approved one-liner + approved metrics). Consequences (all structural): metrics can't drift, verticals can't be relabeled, **a case can't appear twice** (expander dedups by ID → one results block), and the hardcoded "attachables inventory" (§16 line ~1002) is replaced by the ledger.

### B. Deterministic grounding checker (§21.4) — the core of the rework
Runs on the draft *before* it hits the textarea. Per **deterministically-checkable** claim class, extract + verify against an allowed source; strip/flag if untraceable. **A checker (pass/fail per span), NOT an LLM rewriter.**

| Claim class | Source of truth | If untraceable |
|---|---|---|
| Metrics/numbers (`+X%`, `N ROAS`, `$N`, `-N% CPA`) | the referenced case's `metrics` | strip/revert; flag `metricNotInLedger` |
| Case references | ledger IDs; each appears **once** | drop unknown / dedup; flag `caseUnknown`/`caseDuplicated` |
| **Geo/market nouns** ("launching/targeting in X") | **must appear in the job posting body** — client `country` does NOT count | strip; flag `marketNotInPosting` |
| Attachment claims ("attached as PDF", "attaching X") | must map to a cited case's ledger `attachment` | strip; flag `attachmentUnbacked` |
| Deliverable/turnaround | KB turnaround map (§20) | fold in the existing `_stripSeoAuditTurnaround` (`JobDetail.jsx:2037`) |

Every strip fires `_recordViolations('generator', …, [code])` — the same telemetry the existing guards use (call sites: `JobDetail.jsx:1633, 1873, 1885`, panel = `⚠ Top rule violations (30d)`). This makes the fabrication rate **measurable**, so C is data-driven.

### C. Prompt slim-down (§21.5)
Only after A+B are live and shadow-verified. Replace 312 prohibitions with ~10 positive rules + structured inputs. Regex net demotes to a safety layer. Verify per-rule compliance via the violation telemetry before/after.

---

## 4. Build sequence & acceptance (§21.6) — do in order

- **Step 21-A (ledger):** create the store + seed it + add the placeholder-expansion render step. Leave the prompt otherwise unchanged (accept BOTH prose and `{{case:…}}` during transition — no cutover).
  **Accept:** `{{case:skin-reboot}}` renders the canonical line w/ correct label + real metrics; emitting the same ID twice yields ONE block.
- **Step 21-B (checker) — SHADOW FIRST:** build it to **record violations without stripping**; run ~1 week on real generations.
  **Accept (shadow):** the `⚠ Top rule violations` panel shows `metricNotInLedger` / `marketNotInPosting` / `caseDuplicated` / `attachmentUnbacked` counts matching hand-review. **Then flip to enforce.**
  **Accept (enforce):** the 2026-07-24 failures (Israel market + duplicate case block) are both auto-caught.
- **Step 21-C (slim prompt):** only after B enforces cleanly.
  **Accept:** prohibitions ≤ ~40; per-letter violation rate (30d) flat-or-lower than pre-slim. If a removed rule regresses, re-add it as a **checker class (B)**, not prompt text.

---

## 5. Rollout discipline & negative space (§21.7–21.8) — DO NOT violate

- **No big-bang rewrite** of the 6,955-line file. Incremental, behind the shadow flags. The existing regex net stays live underneath the whole migration; only 21-C thins it, and only where telemetry proves coverage.
- **B is deterministic claim-classes ONLY.** No semantic LLM judge / third Claude call — that's how we got the unreliable Haiku enforcer.
- **Ledger holds only `is_real` cases with verified metrics.** No verified figure → `metrics: []`, never an invented number.
- **No embeddings/RAG** for case selection — domain/vertical tag match is enough (consistent with §9).
- **The client-account-country rule is explicit:** `marketNotInPosting` must treat enriched `client.country` as NOT a licence to name a target market. Only the posting body authorizes a geo/market claim.

---

## 6. Concrete starting points (file map)

| What | Where |
|---|---|
| Generator component (all of it) | `frontend/src/components/JobDetail.jsx` |
| `generate()` entry | `JobDetail.jsx:4258` |
| Existing case metadata (seed source) | `_CASE_META` @ `JobDetail.jsx:1782` |
| Final output assembly (the `_strip*` pile) | `JobDetail.jsx:5963` and `:6398` |
| Existing dedup guard that misses the new shape | `_recordViolations('generator', …, ['caseDuplication'])` @ `:1633` |
| Turnaround strip to fold into checker | `_stripSeoAuditTurnaround` @ `:2037` |
| Violation telemetry (reuse for new codes) | `_recordViolations(...)` — call sites `:1633, 1873, 1885` |
| Verified case figures (seed metrics from here) | `CASES.md` (e.g. `:138` Skin Reboot) |
| `/claude` proxy (server-side, `_kind` routing, caching, stats injection) | `api/main.py` — see `DESIGN.md` §13 Chunk 5/6 |
| KB / cases persistence patterns to mirror | `kb_entries` table + endpoints, `DESIGN.md` §8 Phase 2 |

**Where the ledger likely plugs in:**
- *Store:* new table in `db.py` + CRUD endpoints in `api/main.py` (mirror `kb_entries`), OR a structured `kb_entries` sub-type. A dedicated table is recommended (§21.3).
- *Expansion:* a render pass that runs on the generated draft, converting `{{case:id}}` → canonical line, in the same place the `_strip*` pile runs (`JobDetail.jsx:5963/6398`) — but as the FIRST step, before the strips.
- *Checker:* a new module (e.g. `frontend/src/lib/groundingCheck.js`) called right after expansion; returns `{cleanedText, violations[]}`; feed violations into `_recordViolations`.

---

## 7. How to verify

- **Run the app:** `falconscout.bat` (everything), or `uvicorn api.main:app --reload --port 8000` + `cd frontend && npm run dev` (:5180). Generate a proposal on a real job and inspect the output + the `⚠ Top rule violations` panel.
- **Unit-check the checker deterministically:** extract each claim-class extractor into a standalone Node script and run it against (a) the 2026-07-24 letter (should flag `marketNotInPosting` on "Israel" and `caseDuplicated` on the repeated block) and (b) a clean letter (zero flags). This is the fast loop — no server needed.
- **Regression guard:** because 21-A/B ship behind "accept both prose + placeholders" and "shadow record-only," you can land them without changing observable output until you flip enforce.

---

## 8. First-session checklist (suggested)

1. `git pull`; read `DESIGN.md` §21 + §16; skim `CASES.md`.
2. Inventory the 16 cases: for each `_CASE_META` entry, find its verified metrics in `CASES.md`/KB. Produce a seed list; mark any with no verified figure as `metrics: []` and **ask Artem** to supply them (do not invent).
3. Build **Step 21-A** (store + seed + placeholder expansion), accepting both prose and `{{case:…}}`. Verify the two acceptance criteria.
4. Append a `WORKLOG.md` entry; commit + push.
5. Only then start **21-B in shadow mode.** Do NOT flip to enforce until the telemetry matches hand-review.

**Success metric (§21.9):** the fabrication/structural-bug rate per letter (30d telemetry) trends down and stays down **without a new bespoke regex per failure shape** — new failure *shapes* get absorbed by an existing checker class or the ledger. Treadmill → wall.

---

## 9. Canonical validation example — use this letter as the Step 21-B regression test

**Job 8484** "Shopify SEO Audit & Organic Growth Strategy" (2026-07-27). A real generator output that packed **six** distinct failures, almost all in the exact claim-classes A+B target. Use it as the fixture the checker must clean; if a future build catches all six here, it's on track.

The letter's defects (all verified against the KB at analysis time):

1. **Fabricated metrics in an anonymized Skin Reboot story** — "health/wellness restricted-niche **Shopify, 2,400+ SKUs** … **18% of revenue** from **6 discontinued** pages … **12–20 referring domains** … preserved **~$47K/year**." None in the KB. Real Skin Reboot record (`CASES.md:138`): +91.58% traffic, +134.12% conv, +693.8% revenue, 17.51 ROAS — nothing else. → checker `metricNotInLedger`.
2. **Skin Reboot relabeled as "Shopify"** — a *previously-fixed* fabrication (it is NOT a Shopify store) resurging through the 312-rule prompt. → ledger `vertical`/attributes authoritative.
3. **Same case (Skin Reboot) presented twice** — once anonymized w/ fabricated numbers (para 2), once named w/ real numbers (experience block). → ledger expander dedups by ID.
4. **Casa Eleganza given two contradictory conversion numbers** — "+41% conversion on filtered pages" vs "conversions jumped 28% in 6 weeks", plus an invented "40% of organic traffic on collection pages." Real record has none of these. → `metricNotInLedger`.
5. **Duplicate "attached as PDF" label** in one Skin Reboot line (nested in a parenthetical, so `_stripDuplicateAttachmentLabel` missed it). → ledger renders the label once.
6. **Technical SEO audit promised in "2 working days"** — Rule-416 violation + implausible overcommit; `_stripSeoAuditTurnaround` missed the "Timeline:\n\nFull audit delivered in 2 working days" phrasing (no SEO noun before "audit"). → checker turnaround class.

**Tactical patch already shipped for #6** (2026-07-27): widened `_stripSeoAuditTurnaround` with `_AUDIT_TIMELINE_BLOCK_RE` (`JobDetail.jsx:~2036`) to catch the own-line "Timeline:" + "Full audit … N days" block, gated to preserve the PPC audit's required 1-day turnaround. This is a stopgap — #1–#5 still ship until Steps 21-A/B land. Do NOT treat #6's patch as "the audit-timeline problem solved"; it's one more regex on the treadmill, kept only to stop the worst claim reaching a client meanwhile.

---

## 10. Copy-paste kickoff message (start a build session with this)

> Read `CLAUDE.md`, then `ANTIFAB_HANDOFF.md` in `C:\Users\syzov\upwork-cockpit`. Do the §0 bootstrap (`git pull`; read `DESIGN.md` §21 + §16; skim `CASES.md`). Then start **Step 21-A** (the structured case ledger) per the §8 checklist: first inventory all 16 `_CASE_META` cases against their verified figures in `CASES.md`/KB and produce a seed list — for any case with no verified metric, set `metrics: []` and ask me, do NOT invent numbers. Build the ledger store + seed + the `{{case:id}}` placeholder-expansion render step, accepting BOTH prose and placeholders (no cutover). Stop at 21-A's acceptance criteria and report back — do NOT start 21-B, and when you do, it ships **shadow / record-only** first (never flip to enforce without checking in).
>
> Context: a tactical patch already shipped for one defect class (the "Timeline: Full audit in 2 working days" turnaround, §9 item #6) — treat that as a stopgap, not a fix. The job-8484 letter in §9 is your regression fixture: the finished checker (Step 21-B) must catch all six of its defects. Append to `WORKLOG.md` and commit+push after each chunk (standing protocol in `CLAUDE.md`).

Shorter, single-deliverable variant:

> Read `ANTIFAB_HANDOFF.md` in `C:\Users\syzov\upwork-cockpit` and build ONLY Step 21-A (case ledger + `{{case:id}}` expansion), seeding metrics only from verified `CASES.md`/KB records (ask me for any missing figure — never invent). Stop at 21-A's acceptance criteria and report back.
