# Current Metro task

Written by the planning chat. Replaced for every new task (git history keeps the old ones).
Model: Opus 5.5 · Effort: xhigh · New session: yes
Task id: P3b (agency chains rebuilt in DevScout's Wave shape + the "Minor fixes list" 1-10) · Written: 2026-11-27 19:10 Kyiv

## How to work
Read CLAUDE.md, METRO_PLAN.md in full (new decision rows "Chain shape", "Brand refresh"; the Oleh 27 Nov lines at the
end of the queue; the section "Minor fixes list"), DESIGN.md's Phase 3 section, and the newest METRO_HANDOFF.md entry (P3).
Branch metro/phase-3b from main. Start right away, no plan approval. Decisions and questions go into the handoff.
Stop and ask only if something would break a Hard rule. Browser checks ONLY through tools/scratch_check.py with a COPY.
Deadline: Monday 30 Nov Oleh shows his superiors a generic outreach message next to Metro's. Oleh did not like P3's
chains ("AI-ish": every email recites a new fact about them). This task fixes that.

## Part A - rebuild the agency chain writer in DevScout's shape
Study first, then port (DevScout is Oleh's code, copy freely), at C:\Users\syzov\baba-leada:
`docs/writing-rules.md`, `src/utils/writingRules.js` (STEP_JOBS, WAVE_JOBS, ONE_ANGLE_RULE, OBSERVATION_LEADINS,
SOFT_LEADINS, QUESTION_BRIDGES, SOFT_ENDINGS, CLOSE_OPENERS, BANNED, CALL_ASKS, lintChain, lintBlockers, styleRulesText,
promptRules), `src/utils/applyWritingRules.js` (humanize, softenQuestion, buildLinkedInIntro, buildLinkedInPointer,
rotation by seed), `src/utils/chainTemplates.js` (wave-3e-v1 / wave-4e-v1, days, working days), `src/utils/chainRunner.js`
(one lead per call, ledger), and the real chains in its outreach output (BenQ, Acer: observation -> what it usually means ->
what we do tied to it -> one question about them).
The rules for Metro's agency line (all decided by Oleh, see METRO_PLAN.md):
1. ONE angle per agency, carried through the wave: "you serve clients in X / you sell Y but not Z -> we have done X ->
   we can be your behind-the-scenes Google Ads and SEO team, under your name". Pick the angle from the hooks (the code-derived
   service gap and the client niche first). Only 2-3 real facts in the WHOLE wave: the hook email's observation, a second
   fact, the close's anchor. The other messages add an argument, never a new recited fact. This REPLACES P3's
   "touches = distinct hooks" (drop that logic; the ledger still prevents reuse across waves).
2. Waves, not one long chain: connected on LinkedIn = LinkedIn intro + 3-4 emails + LinkedIn pointer (DevScout wave-3e /
   wave-4e, its jobs and day offsets); not connected = the same wave by email, no LinkedIn touches; invited and not
   accepted = email wave now, LinkedIn intro only after acceptance. 3 emails when the angle has 2-3 usable facts, 4 when 4+.
3. Message jobs (WAVE_JOBS): intro (built by code), hook email (observation with a lead-in, one "I" sentence on what it
   usually means for an agency like theirs, one sentence on what we do tied to it, one soft question), approach (the ONLY
   place for delivery details: under your name, we never contact your client, European time zone so work is done overnight,
   "send us one client you're struggling to deliver for and we'll scope it, or start with a free pilot audit"; the matched
   case link is attached here by code), value (a practical Google Ads / SEO tip for THEIR client niche that they can use
   without us; no re-sell), pointer (built by code: the email topic, "didn't want it buried", "If it's not your area, a
   pointer to the right person would be great."), close (short, under 60 words, one soft way back, anchored on a fact).
4. The LinkedIn intro (Artem's invitations were EMPTY): greeting + one rotated line like "glad to be in your network";
   never "thanks for connecting", "good to meet you", "following up". Then their role, one line on what we do tied to their
   business, a rotated neutral close. No question, no pitch, under 50 words. BUILT BY CODE from the role, like
   buildLinkedInIntro(); the model's text is dropped.
5. Our role wording: "the behind-the-scenes Google Ads and SEO team for agencies, under your name"; "white-label" may be used
   (e.g. in the approach), never both in one message. IT Force facts allowed: Google Ads, SEO and web development, since
   2015, behind-the-scenes / white-label for agencies, under the agency's name, never contacts their client, European time
   zone. DROP "from Ukraine". Agency proof is VAGUE only: "we already work behind a few agencies" - no numbers, countries,
   durations or partner names. No prices ever.
6. Voice, enforced by code after the model reply (port applyWritingRules): contractions; lead-ins picked by the kind of fact
   ("Noticed", "Came across", "Was reading about", "Saw that"); every question softened ("Out of curiosity,", "Just curious,",
   ...), never the same lead-in twice in a wave; "I" for observations and questions, "we" for IT Force; follow-ups open on
   THIS company; never label the reader; no call asks; DevScout's BANNED list plus P3's; no em dash, no "!".
   Never recite their tagline or positioning line back to them; never list more than two names; no vanity numbers about the
   person (followers, connections). Subjects: short, sentence case, proper nouns capitalised ("Google Ads for TISKON clients").
   Sign-off "Artem" (emails will go from a new mailbox in Artem's name; until it exists everything stays a draft).
7. Case match: by the agency's client niche AND the service (PPC / SEO), not one industry tag; a "Change case" picker in the
   lead panel (lists the matching cases first, then all).
8. Checks: port lintChain / lintBlockers (same wording twice, similar questions, the hook fact reused, a lead-in twice,
   delivery details outside the approach, banned phrases, a question in the intro, pointer on the same day as its email) on
   top of P3's chaincheck. A failing wave shows "Do not send as is".
9. Rewrite the 9 existing draft chains on the copy with the new writer (approved or sent ones are never touched; there are none).
10. Put 3 full sample waves into the handoff (TISKON, GRAIN Group, FIREBELLY Marketing), first names as <First>.

## Part B - the "Minor fixes list" in METRO_PLAN.md, items 1-10 (all of them)
1 Metro header logo = brand/metro-mark.png (front-view wagon), also the Metro favicon and intro. 2 Company logos (website
first, never an extra LinkedIn visit). 3 No false "Cannot reach the backend" during a run. 4 falconscout.bat never restarts a
running app; long runs resume after a restart and never redo finished items. 5 Labels say what they process ("Write hooks
(13 shortlisted · 8 companies)"). 6 Button hierarchy: primary acid blue, secondary lime, tertiary outline, with the approved
volume style (see docs/brand-refresh/*.dc.html: gradient sheen, inner highlight, bottom lip, shadow, lift on hover, press).
7 No red anywhere: Agency line lime #B8F82C, errors deep orange #F2711C. 8 Browser tab title and icon follow the side.
9 A run Oleh started shows a "done" chip on the other side. 10 Style points already covered by Part A.

## Tests and checks
Port DevScout's writing-rules tests where they apply. Unit tests: one angle and 2-3 facts per wave, the built intro (no
"thanks for connecting"), the pointer, delivery details only in the approach, softened questions without repeats, subject
case, "from Ukraine" refused, vague agency proof only, case match by niche + service, the minor fixes' logic (resume after
restart, label counts, colour tokens: no #e6261f left). On the scratch copy with real model calls through the bridge (if
limits allow): rewrite the 9 waves. Whole suite: `node tests/run_all.mjs --python`.

## Finish
WORKLOG.md, DESIGN.md (Phase 3b), mark done items in METRO_PLAN.md. Commit (git add -u + new files by name, incl. this file),
push, merge into main, push, rebuild frontend/dist. Handoff entry with the 3 sample waves. Tell Oleh: restart falconscout.bat,
Ctrl+F5, Write card > "Write chains" again (it rewrites the drafts), then read them in the lead panel.
