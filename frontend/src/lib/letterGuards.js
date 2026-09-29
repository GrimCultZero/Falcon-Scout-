// ── Letter guards: call offers + the audit-sample mention (2026-09-24) ───────
//
// Two owner rules the prompt already states in full, both broken by the same
// draft (job 16113, 2026-09-24):
//   - Artem does not do ANY live call (analyser Rule 2, "zero exceptions") —
//     the draft asked for "Admin access … plus a quick call to confirm what
//     counts as a qualified lead on your end".
//   - an offered audit always comes with its sample — the draft quoted "$300
//     flat for the audit" and never mentioned the sample.
// Both are made certain here instead of re-asked of the model, in the same
// spirit as _ensureManualAuditClaim / _stripUnaskedRate in JobDetail.jsx. Pure
// functions: JobDetail.jsx wraps them to record telemetry.

import { casesMentioned } from './caseLedger.js'

// ── call offers ──────────────────────────────────────────────────────────────
// Offer shapes only. A bare "call" is nearly always a phone-call CONVERSION in
// these letters ("call tracking", "booked calls", "a phone call or a form
// fill") — of 58 sentences in the sent-letter corpus that mention a call or a
// meeting, one was an offer ("I'd be delighted to jump on a call with you
// guys"). So every pattern needs an offer verb, an offer frame or a
// session-only noun, never the word alone. `nounOnly` marks the patterns that
// match just a noun phrase, where "your …" means the client's own meetings.
const _CALL_OFFER_RES = [
  // "jump/hop/get on a (quick) call"
  { re: /\b(?:jump|hop|get)\s+on\s+(?:a\s+|the\s+)?(?:quick\s+|short\s+|brief\s+|\d+[- ]?min(?:ute)?s?\s+)?(?:phone\s+|video\s+|zoom\s+)?(?:call|zoom|meeting|chat)\b/i },
  // "a quick / short / 15-minute call, chat or meeting"
  { re: /\b(?:a|one)\s+(?:quick|short|brief|free|\d+[- ]?min(?:ute)?s?)\s+(?:intro(?:ductory)?\s+|discovery\s+|kick-?off\s+|strategy\s+|phone\s+|video\s+|zoom\s+)?(?:call|chat|meeting|zoom)\b/i },
  // "let's / I can / happy to … schedule / book / set up / have a call"
  { re: /\b(?:let'?s|let\s+us|we\s+(?:can|could|should)|i\s+(?:can|could|would|will)|i'?d\s+(?:love|like|be\s+(?:happy|glad|keen))\s+to|happy\s+to|glad\s+to|keen\s+to|feel\s+free\s+to)\s+(?:\w+\s+){0,2}?(?:schedule|book|set\s+up|arrange|have|do|grab|organi[sz]e)\s+(?:a|an)\s+(?:\w+\s+){0,2}?(?:call|meeting|zoom|chat)\b/i },
  // "open / available / free to (a) call", "available for a call"
  { re: /\b(?:open|available|free)\s+(?:to|for)\s+(?:a\s+)?(?:quick\s+|short\s+|brief\s+)?(?:phone\s+|video\s+|zoom\s+)?(?:call|chat|meeting|zoom)\b/i },
  // "a call with me / us"
  { re: /\b(?:call|meeting|zoom|chat)\s+with\s+(?:me|us)\b/i },
  // "on / over a call", "over Zoom", "via Google Meet"
  { re: /\b(?:on|over)\s+a\s+(?:quick\s+|short\s+)?(?:phone\s+|video\s+)?call\b(?!\s+(?:tracking|extension|conversion|asset|button|recording))/i },
  { re: /\b(?:on|over|via)\s+(?:zoom|google\s+meet|ms\s+teams|microsoft\s+teams)\b/i },
  // "I'll walk you through the findings" — a live walkthrough, which the
  // prompt bans alongside calls; not when the sentence is about the written
  // deliverable ("the report walks you through…" doesn't match at all).
  { re: /\bwalk\s+you\s+through\b/i, unlessWritten: true },
  // sessions that only ever mean a meeting with Artem
  { re: /\b(?:kick-?off|onboarding|intro(?:ductory)?)\s+(?:call|meeting|session)s?\b/i, nounOnly: true },
  { re: /\bscreen[- ]?shar(?:e|es|ing)\b/i, nounOnly: true },
  { re: /\b(?:zoom|video|teams)\s+(?:call|meeting|session)s?\b/i, nounOnly: true },
]
// Context that makes a match NOT an offer by Artem. Each one has to govern the
// matched phrase directly — "No fluff, happy to jump on a call" is still an
// offer.
//   negated      "instead of a screen-share", "without waiting on a call", "no Zoom calls"
//                (a real sent letter: "written updates so your team always has
//                current status without waiting on a call")
//   client-owned "your weekly Zoom calls" (noun-only patterns)
//   their funnel "a CTA so prospects can book a quick call", "every lead who books a quick call"
//   written      "I'll walk you through every fix in the written report"
const _NEGATED_TAIL_RE = /(?:\b(?:without|instead\s+of|rather\s+than|no\s+need\s+(?:for|to))\s+(?:[\w'-]+\s+){0,2}|\bskip(?:ping)?\s+(?:the\s+)?|\b(?:don'?t|do\s+not|won'?t|will\s+not|doesn'?t|never)\s+(?:need|require|have|do|offer|schedule|book)\s+(?:(?:a|an|the|any)\s+)?|\b(?:no|not)\s+(?:(?:a|an|the|any)\s+)?)$/i
const _CLIENT_OWNED_TAIL_RE = /\byour\s+(?:[\w-]+\s+){0,2}$/i
const _FUNNEL_TAIL_RE = /\b(?:cta|button|landing\s+page|booking\s+page|booking\s+form|calendar\s+link)\b[^.!?\n]{0,60}$|\b(?:visitors?|prospects?|leads?|customers?|buyers?|users?|patients?|homeowners?|people|clients?)\b[^.!?\n]{0,30}\b(?:book|books|booking|booked|schedule|schedules|scheduling|request|requests)\s+$/i
const _WRITTEN_RE = /\b(?:written|in\s+writing|report|document|doc|pdf)\b/i

const _ABBREV_TAIL_RE = /(?:\b[A-Z]\.[A-Z]|\be\.g|\bi\.e|\bvs|\betc|\bapprox|\bInc|\bLtd|\bCo|\bSt|\bNo|\bMr|\bMs|\bDr)$/

// Sentences of one line, keeping the whitespace after each so a line can be
// rebuilt byte-for-byte when nothing in it changes.
function _sentencePieces(line) {
  const pieces = []
  let start = 0
  const re = /[.!?]+(?=\s|$)/g
  let m
  while ((m = re.exec(line))) {
    if (_ABBREV_TAIL_RE.test(line.slice(Math.max(0, m.index - 8), m.index))) continue
    const end = m.index + m[0].length
    let next = end
    while (next < line.length && /\s/.test(line[next])) next++
    pieces.push({ text: line.slice(start, end), sep: line.slice(end, next) })
    start = next
  }
  if (start < line.length) pieces.push({ text: line.slice(start), sep: '' })
  return pieces
}

// Earliest call offer in one sentence, or null.
function _offerIn(sentence) {
  let best = null
  for (const { re, nounOnly, unlessWritten } of _CALL_OFFER_RES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    let m
    while ((m = g.exec(sentence))) {
      const before = sentence.slice(0, m.index)
      if (_NEGATED_TAIL_RE.test(before)) continue
      if (nounOnly && _CLIENT_OWNED_TAIL_RE.test(before)) continue
      if (_FUNNEL_TAIL_RE.test(before)) continue
      if (unlessWritten && _WRITTEN_RE.test(sentence)) continue
      if (((before.match(/["“”]/g) || []).length % 2) === 1) continue   // inside quoted CTA copy
      if (!best || m.index < best.index) best = { index: m.index, match: m[0] }
      break
    }
  }
  return best
}

// Every call offer left in a letter: [{ match, sentence }].
export function findCallOffers(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    for (const p of _sentencePieces(line)) {
      const o = _offerIn(p.text)
      if (o) out.push({ match: o.match, sentence: p.text.trim() })
    }
  }
  return out
}

// "…, plus a quick call to confirm X." — the call is one item in a list of
// things Artem needs. Rewritten to ask in writing when the verb is about
// getting information; otherwise the clause goes.
const _CALL_CLAUSE_RE = /(\s*,?\s+(?:plus|and|or|along\s+with|as\s+well\s+as)\s+)((?:a|one)\s+(?:quick\s+|short\s+|brief\s+|\d+[- ]?min(?:ute)?s?\s+)?(?:phone\s+|video\s+|zoom\s+)?(?:call|chat|meeting))\b(\s+to\s+([a-z]+))?([^.!?]*)([.!?]*)\s*$/i
const _WRITTEN_OK_VERBS = new Set(['confirm', 'clarify', 'define', 'agree', 'align', 'pin', 'nail', 'specify', 'outline', 'lock', 'settle', 'verify', 'check', 'map', 'list', 'flag', 'note', 'share'])
// A sentence whose whole point is the call: "Happy to hop on a quick call…",
// "If it helps, I can also jump on a call…", "Would you be open to a call?",
// "Once you share access, we can set up a short call…".
const _OFFER_FRAME_RE = /^\s*(?:(?:once|after|when|if|before|ideally|first)[^,]{0,60},\s*|(?:and|also|plus|or|then)[,\s]+)?(?:(?:i'?m|i\s+am|i'?d\s+be|i\s+would\s+be|i'?ll\s+be)\s+(?:also\s+)?(?:happy|glad|keen|open|available|free|delighted|more\s+than\s+happy)|i'?d\s+(?:love|like|welcome)|i\s+would\s+(?:love|like|welcome)|happy|glad|keen|open|available|free|delighted|let'?s|let\s+us|we\s+(?:can|could|should)|i\s+(?:can|could)\s+(?:also\s+)?(?:jump|hop|get|schedule|set\s+up|do|have|arrange|book|walk)|i'?ll\s+(?:also\s+)?walk|would\s+you|are\s+you|could\s+we|can\s+we|shall\s+we|feel\s+free|(?:a|one)\s+(?:quick|short|brief|\d+[- ]?min(?:ute)?s?)\s+(?:call|chat|meeting)|(?:jump|hop)\s+on|book|schedule)\b/i

export function stripCallOffers(text) {
  const src = String(text || '')
  const removed = [], rewritten = []
  const paras = src.split(/\n\s*\n/)
  const outParas = paras.map(para => {
    const lines = para.split('\n').map(line => {
      const pieces = _sentencePieces(line)
      let touched = false
      for (let i = 0; i < pieces.length; i++) {
        const s = pieces[i].text
        const offer = _offerIn(s)
        if (!offer) continue
        const clause = s.match(_CALL_CLAUSE_RE)
        const lead = clause ? s.slice(0, clause.index) : ''
        if (clause && clause.index <= offer.index && lead.trim().split(/\s+/).length >= 4) {
          const verb = (clause[4] || '').toLowerCase()
          const next = clause[3] && _WRITTEN_OK_VERBS.has(verb)
            ? lead + clause[1] + 'a short written note' + clause[3] + clause[5] + (clause[6] || '.')
            : lead.replace(/[\s,;:]+$/, '') + (clause[6] || '.')
          rewritten.push({ from: s.trim(), to: next.trim() })
          pieces[i] = { text: next, sep: pieces[i].sep }
          touched = true
        } else if (_OFFER_FRAME_RE.test(s)) {
          removed.push(s.trim())
          // Removing the last sentence must not leave the previous one's
          // trailing whitespace behind.
          if (i === pieces.length - 1 && i > 0) pieces[i - 1] = { text: pieces[i - 1].text, sep: '' }
          pieces.splice(i, 1)
          i--
          touched = true
        }
      }
      return touched ? pieces.map(p => p.text + p.sep).join('') : line
    })
    return lines.filter(l => l.trim() !== '').join('\n')
  })
  if (!removed.length && !rewritten.length) return { text: src, changed: false, removed, rewritten }
  const out = outParas.filter(p => p.trim() !== '').join('\n\n')
  return { text: out, changed: out !== src, removed, rewritten }
}

// ── the audit sample ─────────────────────────────────────────────────────────
// Client already had the audit done — a "review + implement" job. Offering the
// sample there reads as if the posting wasn't read. Shared with the
// missingAuditSampleMention check in JobDetail.jsx, so the two cannot drift.
export const ALREADY_AUDITED_RE = /\balready\s+(?:have\s+|had\s+)?(?:done|completed|conducted|run|performed)\s+(?:a|an|the)?\s*(?:full\s+|complete\s+)?(?:technical\s+)?(?:seo\s+)?audit\b|\balready\s+(?:have|had|has)\s+(?:a|an|the)\s+(?:technical\s+)?(?:seo\s+)?audit\b/i

// Any existing mention: "I'm attaching a sample of a recent Google Ads audit",
// "audit sample attached", "sample technical SEO audit".
const _SAMPLE_MENTION_RE = /\bsamples?\b[^.\n]{0,80}\baudits?\b|\baudits?\b[^.\n]{0,80}\bsamples?\b/i
// One deliverable per letter: a letter offering the SEO promotion plan does
// not also get the audit sample.
const _SEO_PLAN_RE = /\b(?:seo\s+(?:promotion\s+)?plan|seo\s+roadmap|promotion\s+plan)\b/i
// The audit being OFFERED: its fixed price and the word "audit" in the same
// sentence. "$300/month" is an ad budget and "$700 first month" is the
// retainer, so neither counts.
const _PPC_AUDIT_OFFER_RE = /\$300\b(?!\s*(?:\/|per\b|a\s+(?:mo|month|day|week)))[^.\n]{0,60}\baudit\b|\baudit\b[^.\n]{0,60}\$300\b(?!\s*(?:\/|per\b|a\s+(?:mo|month|day|week)))/i
const _SEO_AUDIT_OFFER_RE = /\$700\b(?!\s*(?:\/|per\b|a\s+(?:mo|month))|[^.\n]{0,30}\b(?:first|1st|setup|set-up)\s+month)[^.\n]{0,60}\baudit\b|\b(?:seo|technical|site)\s+audit\b[^.\n]{0,60}\$700\b/i
// Artem's own wording — the most-used sample sentences in his sent letters
// (33 and 9 uses respectively).
export const AUDIT_SAMPLE_SENTENCES = {
  ppc: "I'm attaching a sample of a recent Google Ads audit so you can see the format and depth.",
  seo: "I'm attaching a sample technical SEO audit so you can see the format and depth.",
  both: "I'm attaching a sample of a recent Google Ads audit and a sample technical SEO audit so you can see the format and depth.",
}

// ── what the posting asks for (2026-09-25, job 16242) ───────────────────────
// Validated against all 476 postings in the DB; every added alternative was
// read match by match (WORKLOG.md, 2026-09-25).

// Does the posting ask for a timeline? The first alternative group is the
// original inline regex from JobDetail.jsx, unchanged. It missed "timeline" as
// one item in a list of requested things — job 16242: "Please apply with a
// relevant before-and-after project example, your proposed first steps,
// timeline, and cost." — so coverHasTimeline flagged the timeline the client
// had asked for. The added shapes found 11 more genuine requests in the DB
// ("Give us a timeline and a fixed price", "Your timeline in business days",
// "confirm your fixed price and timeline"). A label followed by a colon is the
// client stating THEIR terms ("**Project Timeline & Budget:** …"), not a
// request, so it is excluded.
export const _TIMELINE_ASK_ORIGINAL_RE = /\b(rough\s+timelines?|timelines?\s+for|provide\s+(?:a\s+)?timelines?|estimated?\s+(?:timelines?|completions?|deliver(?:y|ies)|durations?)|how\s+long\s+(?:will|would|does|it|to)\b|turn[\s-]?around\s+times?|delivery\s+times?(?:frames?|lines?)?|when\s+(?:can|could|will)\s+you\s+(?:complete|finish|deliver|start|have)|time\s*frames?|timeframes?|\beta\b|how\s+(?:soon|quickly)|completion\s+times?|expected\s+(?:timelines?|durations?|completions?))\b/i
const _PRICE_WORD = '(?:costs?|budget|price|pricing|rates?|quotes?|fees?|estimates?)'
const _LIST_JOIN = '(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*|\\s*\\/\\s*|\\s*\\+\\s*)'
const _TIMELINE_ASK_ADDED_RES = [
  // "timeline, and cost" / "timeline and fixed-price quote"
  new RegExp(`\\btimelines?${_LIST_JOIN}(?:(?:the|your|a|an)\\s+)?(?:estimated\\s+|proposed\\s+|expected\\s+|total\\s+|fixed[\\s-]price\\s+)?${_PRICE_WORD}\\b(?!\\s*\\*{0,2}\\s*:)`, 'i'),
  // "fixed price and timeline" / "costs and timelines"
  new RegExp(`\\b${_PRICE_WORD}${_LIST_JOIN}(?:(?:the|your|a|an)\\s+)?(?:estimated\\s+|proposed\\s+|expected\\s+)?timelines?\\b(?!\\s*\\*{0,2}\\s*:)`, 'i'),
  // "Your timeline", "your proposed timeline", "realistic timeline"
  /\b(?:your|proposed|estimated|anticipated|approximate|realistic|suggested)\s+timelines?\b(?!\s*\*{0,2}\s*:)/i,
  // "Give us a timeline …", "share … your proposed strategy, timeline …"
  /\b(?:include|provide|share|send|give|outline|submit|propose|state|tell\s+us|let\s+us\s+know|apply\s+with)\b[^.\n?!]{0,120}\btimelines?\b(?!\s*\*{0,2}\s*:)/i,
  // "What's your timeline?"
  /\btimelines?\s*\?/i,
]
export function postingAsksForTimeline(text) {
  const t = String(text || '')
  return _TIMELINE_ASK_ORIGINAL_RE.test(t) || _TIMELINE_ASK_ADDED_RES.some(re => re.test(t))
}

// Does the posting ask for an example / case study / portfolio? Returns the
// phrase that asks (for the note under the letter), or null. On the DB, 131 of
// 476 postings ask; the matches read as genuine asks. Deliberately NOT matched:
// "for example", "e.g.", and a posting describing its OWN reporting ("reporting
// should show results by campaign").
const _EXAMPLE_ASK_RES = [
  /\bbefore[\s/-]+(?:and|&)?[\s/-]*after\b/i,
  /\b(?:an?|one|two|three|\d+)(?:\s*[-–]\s*\d+)?\s+(?:(?:relevant|recent|specific|real|concrete|similar|detailed|past|previous|brief|short|quick|good|comparable)\s+)*examples?\s+(?:of|where|when|in\s+which|from|that|you|showing)\b/i,
  /\bexamples?\s+of\s+(?:[\w'-]+\s+){0,3}?(?:work|projects?|campaigns?|results?|clients?|sites?|websites?|accounts?|stores?|audits?|successes|wins)\b/i,
  /\b(?:share|send|include|provide|show|attach|link|with|relevant|similar|recent)\b[^.\n]{0,40}\bcase\s+stud(?:y|ies)\b|\bcase\s+stud(?:y|ies)\s+(?:of|from|showing|that|where|you)\b/i,
  /\byour\s+portfolio\b|\bportfolio\s+(?:links?|samples?|examples?|of\s+(?:your|past|previous|similar|relevant)\b)|\b(?:share|send|include|provide|attach|show)\s+(?:us\s+)?(?:a\s+|your\s+)?portfolio\b/i,
  /\b(?:share|describe|tell\s+(?:us|me)\s+about|walk\s+(?:us|me)\s+through|give\s+(?:us|me))\s+(?:an?\s+|one\s+|your\s+)?(?:[\w-]+\s+){0,3}?(?:project|campaign|account|client|site|website|store|situation|time)\s+(?:where|when|that|you|in\s+which)\b/i,
  /\b(?:share|show|include|provide)\s+(?:us\s+)?(?:your\s+|some\s+)?(?:past|previous|recent|proven|measurable|real)\s+results\b/i,
  /\blinks?\s+to\s+(?:[\w'-]+\s+){0,3}?(?:sites?|websites?|stores?|projects?|examples?)\b/i,
]
export function findRequestedExample(text) {
  const t = String(text || '')
  let best = null
  for (const re of _EXAMPLE_ASK_RES) {
    const m = t.match(re)
    if (m && (!best || m.index < best.index)) best = { index: m.index, phrase: m[0] }
  }
  if (!best) return null
  // The sentence around the ask, trimmed, so the note can quote it.
  const from = Math.max(t.lastIndexOf('.', best.index) + 1, t.lastIndexOf('\n', best.index) + 1, best.index - 90)
  const endDot = t.slice(best.index).search(/[.\n?!]/)
  const to = Math.min(endDot === -1 ? t.length : best.index + endDot, best.index + best.phrase.length + 70)
  return { phrase: best.phrase, sentence: t.slice(from, to).replace(/\s+/g, ' ').trim() }
}

// Does the letter give an example — a named case, or a link to real work?
// A live URL answers a portfolio ask as well as a case study does (KB #518:
// "Live proof sites — share the URL when a client wants examples").
const _URL_RE = /\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|build|store|shop|ua|ca|de|uk|us)(?:\.[a-z]{2})?\b/i
export function letterGivesExample(text) {
  const t = String(text || '')
  return casesMentioned(t).length > 0 || _URL_RE.test(t)
}

// Is this a from-scratch LAUNCH? A negated mention is the opposite signal — job
// 16378: "improve performance rather than simply starting over from scratch" (an
// existing account) read as a launch, so wrongAuditOfferOnLaunch flagged the
// correct audit offer and launchJobMissingCTA asked for a launch CTA. Blank the
// negated phrases before the launch patterns run.
export const NEGATED_LAUNCH_RE = /\b(?:rather\s+than|instead\s+of|not|n['’]t|no\s+need\s+to|without|never|avoid(?:ing)?|(?:don['’]?t|do\s+not|does\s+not|doesn['’]?t)\s+(?:want|need)\s+to|isn['’]?t|is\s+not|are\s+not|aren['’]?t)\b[^.\n]{0,40}?\b(?:(?:start(?:ing)?|build(?:ing)?|rebuild(?:ing)?|begin(?:ning)?|launch(?:ing)?|redo(?:ing)?)\s+(?:(?:it|everything|the\s+account|over|again|all\s+over)\s+)*)?(?:from\s+(?:scratch|zero)|a\s+(?:brand[-\s]?)?new\s+(?:google\s+ads?\s+|ad\s+)?account)\b/gi
export function blankNegatedLaunch(text) {
  return String(text || '').replace(NEGATED_LAUNCH_RE, ' ')
}

// ── letter shapes the generator's checks read (2026-09-25, job 16252) ────────
// Does the letter say it attaches an AUDIT sample? Any word order, singular or
// plural, within one sentence. The old inline test only accepted "attach … sample
// … audit" and "audit … sample … attach" with singular words, so it missed 85 of
// the 173 sent letters that do attach one ("I'm attaching recent audit samples",
// "Attaching a recent technical SEO audit sample") — and missingSeoPlanOffer then
// demanded the SEO plan on top of an audit offer that was already there.
export function draftAttachesAuditSample(text) {
  return String(text || '').split('\n').some(line =>
    _sentencePieces(line).some(({ text: s }) => /\battach/i.test(s) && /\bsamples?\b/i.test(s) && /\baudits?\b/i.test(s)))
}

// Are two different case studies run together in one paragraph? (The rule: each
// case study is its own paragraph.) The old inline test counted METRICS, so one
// case quoting two figures — "Derma Solution: +1,861% organic traffic, +14,342%
// conversions" — read as crammed: 22 of its 26 corpus hits were a single case.
// A short lead-in label naming the cases that follow ("Here are some relevant
// results, FridgeFix and House Painting are:") is not cramming. Known limit: two
// ANONYMIZED cases in one paragraph go unseen (1 corpus letter) — those break the
// named-case rule anyway.
export function caseStudiesCrammed(text) {
  return String(text || '').split(/\n\s*\n/).some(p => {
    const t = p.trim()
    if (t.length <= 160 && /:\s*$/.test(t)) return false
    return casesMentioned(t).length >= 2
  })
}

// ── SEO prices (KB Rule 426) ─────────────────────────────────────────────────
// Artem's SEO prices are fixed: the technical audit is $700 flat, and it is
// included in the $1,050/month optimization retainer. Job 16242 quoted "$3,500
// flat" for "the diagnostic phase + implementation coordination + follow-up
// audit" and no check saw it: the SEO price checks only ran when the POSTING
// was classified as an audit request, and this one asked for fixes from an
// audit the client already had. This reads what the LETTER quotes instead.
// Allowed: $700 flat, $1,050/month, the posting's own fixed budget, anything
// hourly (the rate-anchor checks own those), and money that isn't Artem's
// price — case metrics, the client's budget or spend, CPC / CPA / revenue.
const _NOT_A_PRICE_NEAR_RE = /\b(?:ad\s+spend|spend|budget|revenue|sales|cpc|cpa|cpl|roas|aov|per\s+(?:lead|conversion|click|sale|order|customer|booking|call)|cost\s+per|avg|average|mrr|arr|profit|turnover|valuation|funding)\b/i
export function findOffLedgerSeoPrices(text, { postedFixed = null, postingText = '' } = {}) {
  const out = []
  const posted = Number(String(postedFixed ?? '').replace(/[^0-9.]/g, '')) || null
  // A figure the POSTING itself gives is the client's money (their budget or ad
  // spend) restated — "$1K a month only works hard if…" — never Artem's price.
  const postingAmounts = new Set([...String(postingText || '').matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b/g)]
    .map(m => parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)))
  for (const para of String(text || '').split(/\n\s*\n/)) {
    if (casesMentioned(para).length) continue          // a case's own figures
    for (const line of para.split('\n')) {
      for (const { text: s } of _sentencePieces(line)) {
        // A range ("$1,200 - $1,800") is ONE quote: the ledger prices are fixed
        // numbers, so a range is never on it.
        const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b(?:\s*(?:-|–|to)\s*\$?\s?(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b)?/g
        let m
        while ((m = re.exec(s))) {
          const num = (d, k) => parseFloat(d.replace(/,/g, '')) * (k ? 1000 : 1)
          const amount = num(m[1], m[2])
          const high = m[3] ? num(m[3], m[4]) : null
          const after = s.slice(m.index + m[0].length, m.index + m[0].length + 30)
          const around = s.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
          if (/^\s*(?:\/\s*(?:hr|hour|h)\b|per\s+hour|an\s+hour|hourly|за\s+годину)/i.test(after)) continue
          if (_NOT_A_PRICE_NEAR_RE.test(around)) continue
          const before = s.slice(Math.max(0, m.index - 40), m.index)
          if (/\byour\b/i.test(before)) continue   // their money
          // "$950/month", and "monthly around $1,200" / "Monthly retainer $950" (a real letter each)
          const monthly = /^\s*(?:\/\s*(?:mo|month)\b|per\s+month|a\s+month|monthly)/i.test(after)
            || /\b(?:monthly|per\s+month|a\s+month)\b[^$\n]{0,15}$|\bretainer\s*(?:of|at|is|:)?\s*$/i.test(before)
          if (high == null) {
            if (monthly ? amount === 1050 : amount === 700) continue
            if (posted && amount === posted) continue
            if (postingAmounts.has(amount)) continue
          }
          out.push({ amount, ...(high != null ? { high } : {}), kind: monthly ? 'monthly' : 'flat', sentence: s.trim() })
        }
      }
    }
  }
  return out
}

export function ensureAuditSampleMention(text, { postingLower = '' } = {}) {
  const src = String(text || '')
  const none = { text: src, inserted: null }
  if (!src || _SAMPLE_MENTION_RE.test(src) || _SEO_PLAN_RE.test(src)) return none
  if (postingLower && ALREADY_AUDITED_RE.test(postingLower)) return none
  const paras = src.split(/\n\s*\n/)
  const ppcIdx = paras.findIndex(p => _PPC_AUDIT_OFFER_RE.test(p))
  const seoIdx = paras.findIndex(p => _SEO_AUDIT_OFFER_RE.test(p))
  if (ppcIdx === -1 && seoIdx === -1) return none
  const kind = ppcIdx !== -1 && seoIdx !== -1 ? 'both' : ppcIdx !== -1 ? 'ppc' : 'seo'
  const idx = Math.max(ppcIdx, seoIdx)
  const p = paras[idx].trimEnd()
  paras[idx] = p + (/[.!?]$/.test(p) ? ' ' : '. ') + AUDIT_SAMPLE_SENTENCES[kind]
  return { text: paras.join('\n\n'), inserted: kind }
}

// ── agency / white-label framing (2026-09-29, jobs 16678 + 16504) ────────────
// Artem pitches himself as a white-label agency ("I run IT Force", "behind other
// agencies' brands", "zero contact with your end clients") ONLY when the posting
// asks for that arrangement. The buyer BEING an agency is not an ask: job
// 16678 ("a growth agency … looking for an experienced Google Ads
// specialist to join us") got "I run IT Force, a small agency that's been
// delivering Google Ads behind other agencies' brands for years", and job 16504
// (two travel brands of the client's own) got "white-label behind other
// agencies' brands … zero contact with your end clients".
//
// The ask, in the posting's own words. Deliberately NOT an ask: the word agency,
// "our clients", "Agency Partner" (16678's title), "looking for an agency" (a
// brand hiring an agency is a direct client — a white-label pitch is wrong there
// too), "reseller" (the DB only has "no markup or reselling of ad spend" and
// "our own resellers"), and white-label as the client's own PRODUCT
// ("white-label payroll", "white-label merchant services brands"). A negated
// sentence is the opposite signal: "No agencies, account managers, or
// white-label providers", "Agencies and subcontracting arrangements are not a
// good fit for this role".
const _WL_PRODUCT = '(?:payroll|merchant|payments?|products?|brands?|apps?|software|platforms?|solutions?|goods|supplements?|skincare|cosmetics|cards?|banking|wallets?)'
const _WL_PRODUCT_RE = new RegExp(`\\bwhite[\\s-]?label(?:ed)?[\\s-]+${_WL_PRODUCT}\\b`, 'i')
const _WHITE_LABEL_ASK_RES = [
  new RegExp(`\\bwhite[\\s-]?label(?:ed|ing)?\\b(?![\\s-]+${_WL_PRODUCT}\\b)`, 'i'),
  /\bwhitelabel\b/i,
  /\bunder\s+(?:our|my)\s+(?:own\s+)?(?:agency['’]?s?\s+)?(?:brand(?:ing)?|name|logo|banner|umbrella)\b/i,
  /\bbehind[\s-]the[\s-]scenes\b/i,
  // the client contact the posting rules out
  /\b(?:no|zero|without)\s+(?:direct\s+)?(?:client|customer)[\s-]?(?:facing|contact)\b/i,
  /\b(?:do\s+not|don['’]?t|never|won['’]?t|will\s+not|must\s+not|should\s+not|not\s+to)\s+(?:directly\s+)?(?:contact|communicate\s+with|talk\s+to|reach\s+out\s+to|speak\s+(?:to|with)|interact\s+with)\s+(?:(?:our|the|any|their)\s+(?:end[\s-]?)?|end[\s-]?)(?:clients?|customers?)\b/i,
  /\b(?:clients?|customers?)\s+(?:won['’]?t|will\s+not|wouldn['’]?t|don['’]?t|do\s+not|never|shouldn['’]?t|should\s+not|must\s+not)\s+(?:know|see|interact|talk|communicate|deal|be\s+aware|hear)\b/i,
  // "a dependable SEO subcontractor", "as a subcontractor"
  /\b(?:an?|as|our)\s+(?:[\w-]+\s+){0,2}sub-?contractors?\b/i,
  // "Paid Media Fulfillment Partner", "looking for a delivery partner"
  /\b(?:seo|ppc|sem|ads?|advertising|media|marketing|digital|web|google\s+ads)\s+(?:fulfil(?:l)?ment|delivery|outsourcing|production|execution)\s+partners?\b/i,
  /\b(?:looking\s+for|seeking|need|hire|hiring|want|searching\s+for)\s+(?:an?\s+|our\s+)?(?:[\w-]+\s+){0,3}?(?:fulfil(?:l)?ment|delivery|outsourcing|production)\s+partners?\b/i,
]
const _WHITE_LABEL_NEGATED_RE = /\b(?:no|not|never|nor)\s+(?:(?:an?|any|the)\s+)?(?:[\w-]+\s+){0,2}?(?:agenc|white[\s-]?label|sub-?contract|intermediar|middlem[ae]n)|\bnot\s+(?:a\s+)?(?:good\s+)?fit\b|\bwill\s+(?:be\s+)?(?:rejected|declined|ignored|disqualified|removed)\b|\bwon['’]?t\s+be\s+considered\b|\bdo\s+not\s+apply\b|\bdon['’]?t\s+apply\b|\b(?:individuals?|freelancers?)\s+only\b/i
export function postingAsksForWhiteLabel(text) {
  for (const line of String(text || '').split('\n')) {
    for (const { text: s } of _sentencePieces(line)) {
      if (_WHITE_LABEL_NEGATED_RE.test(s)) continue
      for (const re of _WHITE_LABEL_ASK_RES) {
        const m = s.match(re)
        if (m) return { phrase: m[0], sentence: s.replace(/\s+/g, ' ').trim() }
      }
    }
  }
  return null
}

// The pitch, in a letter: the white-label arrangement, or Artem calling himself
// an agency. Never "IT Force" or "my team" alone — web-dev letters name the
// team on purpose (KB #478, build + SEO + analytics in one engagement). When
// white-label is the client's own PRODUCT, a letter about their market says the
// word without pitching anything (a sent letter to a payroll bureau: "an
// accountancy firm evaluating white-label partners"), so the bare word is only
// counted when the posting doesn't sell it.
const _WHITE_LABEL_WORD_RES = [/\bwhite[\s-]?label(?:ed|ing)?\b/i, /\bwhitelabel\b/i]
const _WHITE_LABEL_PITCH_RES = [
  /\bbehind\s+(?:other\s+|partner\s+)?agenc(?:y|ies)['’]?s?\s+(?:own\s+)?brands?\b/i,
  /\bbehind\s+your\s+(?:agency['’]?s?\s+)?(?:brand|name|logo)\b/i,
  /\bunder\s+(?:your|their|other\s+agencies['’]?)\s+(?:agency['’]?s?\s+)?(?:own\s+)?(?:brand(?:ing)?|name|logo|banner)\b/i,
  /\b(?:zero|no|without(?:\s+any)?)\s+(?:direct\s+)?contact\s+with\s+(?:your\s+|their\s+)?(?:end[\s-]?)?clients?\b/i,
  /\bpresent\s+(?:(?:it|them|this|these|those)\s+|(?:the|my|our)\s+[\w-]+\s+)?as\s+your\s+own\b/i,
  /\byou\s+(?:stay|remain)\s+(?:front|client)[\s-]?facing\b/i,
  /\binvisible\s+(?:partner|to\s+your\s+clients)\b/i,
  /\bI\s+run\s+(?:IT\s+Force,?\s+)?(?:a|an)\s+(?:[\w-]+\s+){0,2}agency\b/i,
  /\bIT\s+Force,?\s+(?:is\s+)?(?:a|my|our)\s+(?:[\w-]+\s+){0,2}agency\b/i,
  /\b(?:my|our)\s+(?:own\s+)?agency\b/i,
]
export function findWhiteLabelPitch(text, { postingText = '' } = {}) {
  const t = String(text || '')
  const out = []
  const res = _WL_PRODUCT_RE.test(String(postingText || '')) ? _WHITE_LABEL_PITCH_RES : [..._WHITE_LABEL_WORD_RES, ..._WHITE_LABEL_PITCH_RES]
  for (const re of res) {
    const m = t.match(re)
    if (m && !out.some(o => o.toLowerCase() === m[0].toLowerCase())) out.push(m[0])
  }
  return out
}

// ── logistics the client didn't ask about (KB Rule 436, 2026-09-29) ──────────
// "Never volunteer logistics (timezone, hours, reporting cadence, availability)
// the client did not ask for." The check (moved here from JobDetail.jsx) had no
// posting side: its comment said a rewrite pass would keep the ones the client
// asked for, and that pass was deleted on 2026-09-02. So job 16684, whose posting
// lists "Your availability to start.", got "Available to start immediately"
// flagged as volunteered. Each group's patterns are the old ones, unchanged; the
// posting side is new.
const _LOGISTICS = [
  { kind: 'timezone',
    res: [/\b(?:i'?m|i\s+am|based|operate|working)\s+(?:in\s+)?(?:UTC|GMT|EST|PST|CET|EET|CST|MST)\b/i, /\btime\s*zone\s+(?:overlap|isn'?t|is\s+not|won'?t)\b/i],
    asked: /\btime\s*zones?\b|\b(?:UTC|GMT|EST|EDT|PST|PDT|CET|CEST|EET|CST|MST|AEST|BST)\b|\boverlap\b|\b(?:business|working|office)\s+hours\b/i },
  { kind: 'working hours',
    res: [/\b(?:working\s+hours?|work\s+async|async\s+(?:work|with\s+structured))\b/i, /\bdaily\s+stand-?ups?\b/i],
    asked: /\b(?:business|working|office)\s+hours\b|\basync(?:hronous(?:ly)?)?\b|\bstand-?ups?\b|\bwork(?:ing)?\s+schedule\b|\boverlap\b/i },
  { kind: 'reporting cadence',
    res: [/\bstructured\s+(?:weekly|monthly|biweekly)\s+report/i, /\b(?:weekly|monthly|biweekly)\s+(?:performance\s+)?report(?:s|ing)\s+(?:so|on|of|covering|against)\b/i],
    asked: /\b(?:weekly|monthly|bi-?weekly|daily|regular)\s+(?:reports?|reporting|updates?|summar(?:y|ies)|check-?ins?|calls?)\b|\breport(?:s|ing)?\s+(?:weekly|monthly|every|on\s+a\s+(?:weekly|monthly))\b|\bhow\s+(?:often|frequently)\b[^.?\n]{0,60}\b(?:report|update|communicat)/i },
  { kind: 'availability',
    res: [/\b(?:i'?m\s+)?available\s+(?:immediately|right\s+away|asap|now|to\s+start)\b/i, /\bcan\s+start\s+(?:immediately|right\s+away|asap|today|tomorrow|this\s+week|next\s+week)\b/i, /\b\d+\+?\s*hours?\s+(?:per|a)\s+week\s+available\b/i],
    asked: /\byour\s+availability\b|\bavailability\s+(?:to\s+start|for\s+(?:this|the)\s+(?:role|project|job))\b|\bavailable\s+to\s+(?:start|begin)\b|\b(?:when|how\s+soon)\s+(?:can|could|would)\s+you\s+(?:start|begin)\b|\bstart\s+date\b|\b(?:able|ready)\s+to\s+start\b|\bstart\s+(?:immediately|asap|right\s+away|within|this\s+week|next\s+week)\b|\bhow\s+many\s+hours\b|\bhours?\s+(?:per|a|each)\s+week\b|\bweekly\s+hours\b/i },
]
export function findUnsolicitedLogistics(text, { postingText = '' } = {}) {
  const t = String(text || '')
  const p = String(postingText || '')
  const out = []
  for (const g of _LOGISTICS) {
    if (g.asked.test(p)) continue
    for (const re of g.res) {
      const m = t.match(re)
      if (m) { out.push({ kind: g.kind, phrase: m[0] }); break }
    }
  }
  return out
}

// ── the posting turns down an audit as the deliverable (2026-09-29) ──────────
// Job 16684: "Please focus on concrete actions and implementation rather than a
// general audit or review process" — and missingAuditPriceEntirely still demanded
// the $300 audit. Two opposite shapes, read posting by posting on 758 postings:
//   declined   "not just an audit", "NOT an audit-only project", "rather than a
//              standalone CRO audit", "We do not want someone who only gives us
//              an audit document", "not looking for another audit" — they want
//              the work done; an audit is not the product.
//   NOT declined  "not a generic / standard / basic SEO audit", "not looking for
//              an automated audit" — they still want an audit, a real one, which
//              is what Artem's manual audit is.
// Bare "reviews" is never read: in these postings it is nearly always customer
// reviews ("not simply to collect more reviews", "no fake reviews").
const _AUDIT_DECLINED_RES = [
  /\bnot\s+(?:just|only|simply|merely)\s+(?:[\w-]+\s+){0,3}?(?:audits?|audit\s+(?:documents?|reports?))\b/i,
  /\bnot\s+(?:an?\s+)?audit[\s-]only\b/i,
  /\bnot\s+(?:looking\s+for|after|interested\s+in|seeking|asking\s+for|paying\s+for)\s+(?:another|an?)\s+(?:(?:seo|ppc|google\s+ads|account|site)\s+)?audits?\b/i,
  /\b(?:rather\s+than|instead\s+of)\s+(?:(?:simply|just|only)\s+)?(?:(?:send(?:ing)?|provid(?:e|ing)|deliver(?:ing)?|giv(?:e|ing))\s+(?:us\s+)?)?(?:an?\s+)?(?:(?:general|standalone|full|lengthy|formal|big|long|separate|one[\s-]off|automated)\s+)?(?:(?:seo|ppc|cro|google\s+ads|account|site|technical)\s+)?audits?\b/i,
  /\b(?:do\s+not|don['’]?t)\s+(?:want|need)\s+(?:(?:someone|anyone)\s+who\s+(?:only|just)\s+(?:gives?|provides?|sends?|delivers?)\s+(?:us\s+)?)?(?:another\s+|an?\s+)?(?:[\w-]+\s+){0,2}?(?:audits?|audit\s+documents?)\b/i,
]
export function postingDeclinesAudit(text) {
  const t = String(text || '')
  for (const re of _AUDIT_DECLINED_RES) {
    const m = t.match(re)
    if (m) return { phrase: m[0] }
  }
  return null
}

// ── Google Ads AND Meta in scope (2026-09-29) ────────────────────────────────
// Job 16684 asked to "take over and directly manage our existing Google Ads and
// Meta Ads accounts" (Meta: 3 active Sales campaigns) and the letter planned its
// 24 h / 48 h / week 1 in Google alone — Meta was never named. Meta is in scope
// when the TITLE names it, or when a sentence gives the freelancer Meta work
// ("manage Google Ads and Meta Ads campaigns") outside a nice-to-have. Not in
// scope, each seen in the DB: a nice-to-have (job 16678, "Nice to have •
// Experience with Meta Ads alongside Google"; "Nice to Have (Not Required) Meta
// Ads experience"), a maybe-later ("Possibly … adding Meta Ads"), and the
// client's own channel ("growing two brands through Meta and Google Ads, and
// we're looking for someone who can assess our Google Ads").
const _GOOGLE_ADS_RE = /\b(?:google\s+ads?|adwords|google\s+shopping|performance\s+max|pmax|google\s+ppc)\b/i
const _META_ADS_RE = /\bmeta\s+(?:ads?|advertising|campaigns?|sales\s+campaigns?|business\s+(?:manager|suite)|pixel|ads\s+manager)\b|\bfacebook\s+(?:ads?|advertising|campaigns?|pixel)\b|\binstagram\s+(?:ads?|advertising)\b|\bgoogle(?:\s+ads)?\s*(?:and|&|\+|\/)\s*meta\b|\bmeta\s*(?:and|&|\+|\/)\s*google\b/i
const _OPTIONAL_RE = /\bnice[\s-]to[\s-]haves?\b|\b(?:a|big|huge|major)\s+plus\b|\bbonus\b|\bpreferred\b|\bideally\b|\boptional\b|\bwould\s+be\s+(?:great|nice|helpful|a\s+plus)\b|\bbeneficial\b|\badvantage(?:ous)?\b|\bnot\s+required\b|\bpossibly\b|\bpotentially\b|\bin\s+the\s+future\b|\blater\s+on\b|\bdown\s+the\s+(?:line|road)\b/i
const _WORK_VERB_RE = /\b(?:manag(?:e|es|ed|ing|ement)|run(?:s|ning)?|handl(?:e|ing)|take\s+over|taking\s+over|optimi[sz](?:e|ing|ation)|scal(?:e|ing)|launch(?:ing)?|set(?:ting)?\s+up|build(?:ing)?|audit(?:ing)?|own(?:ing)?|oversee(?:ing)?|improv(?:e|ing)|execut(?:e|ing)|specialist|expert|manager|buyer)\b/i
// A short line without end punctuation is a heading; one naming a normal section
// (or ending in ":") closes a nice-to-have section, a nice-to-have heading opens one.
const _SECTION_HEADING_RE = /:\s*$|^(?:what\s+(?:you['’]?ll|you\s+will)\s+do|what\s+we['’]?re\s+looking\s+for|what\s+we\s+need|requirements?|responsibilities|key\s+responsibilities|qualifications|must[\s-]haves?|about\s+(?:us|you|the\s+(?:role|job|project|company))|how\s+to\s+apply|to\s+apply|scope|deliverables|budget|timeline|summary|the\s+(?:role|project)|your\s+role|skills|in\s+your\s+proposal|please\s+include|account\s+context|immediate\s+priority|goals?|kpis?|tools|who\s+you\s+are|ideal\s+candidate)\b/i
export function postingNamesGoogleAndMeta(text) {
  const t = String(text || '')
  if (!_GOOGLE_ADS_RE.test(t)) return false
  const [title = '', ...body] = t.split('\n')
  if (_META_ADS_RE.test(title) || /\bmeta\b/i.test(title)) return true
  let optionalSection = false
  for (const raw of body) {
    const line = raw.trim()
    if (!line) continue
    const bullet = /^(?:[•\-*–]|\d+[.)])\s*/.test(line)
    if (!bullet && line.length <= 60 && !/[.!?]\s*$/.test(line)) {
      if (_OPTIONAL_RE.test(line)) optionalSection = true
      else if (_SECTION_HEADING_RE.test(line)) optionalSection = false
    }
    if (optionalSection) continue
    for (const { text: s } of _sentencePieces(line)) {
      if (_META_ADS_RE.test(s) && _WORK_VERB_RE.test(s) && !_OPTIONAL_RE.test(s)) return true
    }
  }
  return false
}
// Does the letter name any Meta work? Meta / Facebook / Instagram as a platform,
// the Conversions API. "meta description / meta tags" are SEO and don't count.
const _META_IN_LETTER_RE = /\bmeta\b(?![\s-]*(?:descriptions?|tags?|titles?|data|keywords?|fields?|robots)\b)|\bfacebook\b|\binstagram\b|\bcapi\b|\bconversions\s+api\b/i
export function letterCoversMeta(text) {
  return _META_IN_LETTER_RE.test(String(text || ''))
}

// ── the posting says the account is already running (2026-09-29) ────────────
// Owner: "I dont understand why generator stopped offering audits as CTA in the
// end where the job posting explicitly states that accounts are already running.
// It is happening constantly." The prompt's audit rules keyed on audit / review
// vocabulary ("optimise", "fix", "our campaigns", "audit"), so a takeover posting
// ("take over and directly manage our existing Google Ads and Meta Ads accounts",
// job 16684) never counted as an existing account — and "we're not starting from
// scratch" read as a launch. This is the posting stating a live account in its
// own words. Returns the phrase that says so, or null.
const _RUNNING_ACCOUNT_RES = [
  /\bexisting\s+(?:(?:google\s+ads|google|ads?|ppc|sem|meta(?:\s+ads)?|facebook|paid|search|shopping|and|&|\/)\s+){0,5}(?:accounts?|campaigns?|setup|set[\s-]up|structure)\b/i,
  /\b(?:current|active|live|running)\s+(?:(?:google\s+ads|ppc|search|shopping|pmax|performance\s+max|ad)\s+)?(?:campaigns?|accounts?)\b/i,
  /\b(?:campaigns?|accounts?|ads)\s+(?:are|is|have\s+been|has\s+been)\s+(?:already\s+|currently\s+)?(?:running|live|active)\b/i,
  /\balready\s+(?:running|live|spending|advertising|have\s+(?:an?\s+|our\s+)?(?:google\s+ads\s+|ads?\s+)?(?:account|campaigns?))\b/i,
  /\bcurrently\s+(?:running|spending|advertising|have\s+(?:\d+|an?|two|three|four|five|several)\b)/i,
  /\b(?:take|taking)\s+over\s+(?:and\s+(?:directly\s+)?manage\s+)?(?:our|the|an?|this|my)\s+(?:existing\s+|current\s+)?(?:google\s+ads|ppc|ads?|accounts?|campaigns?|management)\b/i,
  /\bhistorical\s+(?:data|performance)\b|\baccount\s+history\b/i,
  /\bmonthly\s+(?:ad\s+)?spend\b|\b(?:ad\s+)?spend(?:ing)?\s+(?:is\s+)?(?:currently\s+)?(?:around|about|approximately|~)?\s*[$€£]\s?[\d,.]+\s?k?\s*(?:\/|per|a)\s*(?:month|mo|day)\b/i,
  /\b(?:underperform\w*|not\s+converting|wasted?\s+(?:ad\s+)?spend|(?:cpa|cpc|roas|conversions?|sales|performance)\s+(?:has|have)\s+(?:dropped|declined|increased|risen|fallen|gone\s+(?:up|down)|decreased|tanked))\b/i,
  /\b(?:optimi[sz]e|improve|fix|audit|review|restructure|clean\s+up|scale)\s+(?:our|my|the)\s+(?:existing\s+|current\s+)?(?:google\s+ads\s+|ppc\s+|ads?\s+)?(?:account|campaigns)\b/i,
  // "manage and optimize our advertising campaigns", "review and improve my Google
  // AdWords search and shopping campaigns" — THEIR campaigns, to be run on
  /\b(?:manag(?:e|ing)|optimi[sz](?:e|ing)|improv(?:e|ing)|enhanc(?:e|ing)|review(?:ing)?|audit(?:ing)?|maintain(?:ing)?)\s+(?:and\s+(?:manag|optimi[sz]|improv|maintain|enhanc)\w*\s+)?(?:our|my)\s+(?:(?:existing|current|google|adwords|ads|ppc|paid|search|shopping|advertising|ad|and|&)\s+){0,6}(?:campaigns?|accounts?|ads)\b/i,
]
const _NO_ACCOUNT_RE = /\bno\s+(?:existing|current|active|prior|previous)\s+(?:(?:google\s+ads|ad|ads|ppc)\s+)?(?:accounts?|campaigns?|data|history)\b|\b(?:don['’]?t|do\s+not)\s+(?:yet\s+)?have\s+(?:an?\s+|any\s+)?(?:(?:google\s+ads|ad|ads)\s+)?(?:account|campaigns?)\b|\bnever\s+(?:run|ran|advertised|used\s+google\s+ads)\b/i
// A launch, or a setup — the prompt's rule: "a client asking you to SET UP
// campaigns has nothing running yet to audit". Negated mentions are blanked first.
const _LAUNCH_ONLY_RE = /\b(?:from\s+scratch|from\s+zero|brand[\s-]new\s+(?:ad\s+|google\s+ads\s+)?account|zero[\s-]?pixel|launch(?:ing)?\s+(?:our|a|the)\s+(?:first|new)\b|set(?:ting)?[\s-]*up\s+(?:and\s+(?:manage|run|optimi[sz]e)\s+)?(?:(?:a|an|our|my|the|new|first|google|ads|adwords|ppc|search)\s+){1,4}(?:account|campaigns?))\b/i
export function postingHasRunningAccount(text) {
  const t = String(text || '')
  if (_NO_ACCOUNT_RE.test(t)) return null
  if (_LAUNCH_ONLY_RE.test(blankNegatedLaunch(t))) return null
  for (const re of _RUNNING_ACCOUNT_RES) {
    const m = t.match(re)
    if (m) return { phrase: m[0] }
  }
  return null
}

// Future work after the audit — the FEE STRUCTURE's "credited back" trigger — and
// its opposite, an audit-only engagement. Moved here from JobDetail.jsx unchanged
// so the check block and the closing-audit insert below share one definition.
export const ONGOING_SIGNAL_RE = /\b(?:could\s+lead\s+to|potential\s+for|possibility\s+of|may\s+lead\s+to|if\s+(?:this|it)\s+(?:works?\s+out|goes\s+well)|looking\s+for\s+a\s+long[\s-]?term|ongoing\s+(?:management|support|optimi[sz]ation|work|help|relationship|basis)|continu(?:e|ed|ing)\s+(?:to\s+)?(?:work|manage|optimi[sz]e)|\bretainer\b|long[\s-]?term\s+(?:partner|partnership|relationship|engagement|collaboration|role)|monthly\s+(?:management|retainer)|future\s+work|potential\s+long[\s-]?term|room\s+for\s+ongoing|this\s+could\s+(?:turn\s+into|become)\s+(?:ongoing|regular|recurring))\b/i
export const AUDIT_ONLY_NO_ONGOING_RE = /\b(?:one[\s-]?time|one[\s-]?off|single|standalone|isolated)\b[^.\n]{0,40}\b(?:audit|project|task|engagement|job)\b|\baudit\s+only\b|\bnot\s+(?:looking\s+for|seeking|interested\s+in|needing)\s+(?:ongoing|recurring|a\s+retainer|long[\s-]?term|monthly)\b|\bno\s+(?:ongoing|recurring|retainer|long[\s-]?term)\s+(?:work|commitment|engagement|management|help)\b|\bthis\s+is\s+(?:a\s+)?(?:one[\s-]?time|one[\s-]?off|single|standalone)\s+(?:project|job|task|engagement|audit)\b/i

// ── the closing audit offer on a running account (owner rule, 2026-09-29) ────
// Made certain rather than re-asked of the model, like the audit sample above:
// on a Google Ads posting that says its account is already running, a letter
// with no audit offer anywhere gets Artem's standard one as its last paragraph,
// right before the sign-off. Every sentence is his standing offer — by hand, no
// automated tools, 1 working day (KB #402), a recent sample attached (#404) —
// worded so the audit checks read it as complete (_MANUAL_AUDIT_CLAIM_RE, the
// sample mention, _DRAFT_COMPLIMENTARY_RE). The $300 only when the posting asks
// for pricing (owner rule, 2026-08-28); the fee credit only when it also signals
// ongoing work. A letter that already offers an audit anywhere is left alone —
// where it sits is auditOfferNotClosingCta's business, not a rewrite.
export const RUNNING_ACCOUNT_AUDIT_CTA = {
  plain: 'I can audit your Google Ads account entirely by hand, with no automated tools or templated reports, delivered within 1 working day.',
  priced: 'I can audit your Google Ads account for $300 flat, entirely by hand with no automated tools or templated reports, delivered within 1 working day.',
  credit: 'The audit fee is credited back if we move on to ongoing management.',
}
const _PPC_POSTING_RE = /\b(?:google\s+ads?|adwords|ppc|pmax|performance\s+max|google\s+shopping|paid\s+search)\b/i
// An audit OFFER in the letter, any wording — each shape from a letter Artem sent
// ("Account Audit: I will analyze…", "starting on a paid audit", "I run every audit
// entirely by hand", "I'm attaching a sample Google Ads audit"). Not the plan's own
// steps ("audit whether current conversion actions map…", "conversion-tracking
// audit complete"). Any sample + audit mention counts (_SAMPLE_MENTION_RE).
const _LETTER_OFFERS_AUDIT_RE = /\bi(?:\s+(?:can|could|would|will)|['’](?:d|ll))\s+(?:(?:start\s+with|run|do|deliver|begin\s+with|offer)\s+)?(?:a\s+|an\s+|the\s+|your\s+)?(?:(?:full|quick|manual|hands[\s-]on|complete|thorough|google\s+ads|ppc|account)\s+)*audit\b|\b(?:my|the|this|an?)\s+(?:(?:full|manual|hands[\s-]on|complete|google\s+ads|ppc|account)\s+)*audit\s+(?:is\s+done|takes|comes|covers|delivered|within|will)\b|\baudit\s+(?:delivered|within\s+1)\b|\baudit\b[^.\n]{0,60}\b(?:1|one)\s+working\s+day\b|\$300\s+flat\b|\bevery\s+audit\b|\b(?:start(?:ing)?|begin(?:ning)?)\s+(?:on|with)\s+(?:a|an|the)\s+(?:[\w-]+\s+){0,2}audit\b|^[ \t]*(?:(?:google\s+ads|ppc|account|full)\s+)*audit\s*:/im
export function ensureRunningAccountAuditCta(text, { postingText = '', asksRate = false } = {}) {
  const src = String(text || '')
  const none = { text: src, inserted: null }
  const post = String(postingText || '')
  if (!src.trim() || !_PPC_POSTING_RE.test(post) || !postingHasRunningAccount(post)) return none
  if (ALREADY_AUDITED_RE.test(post.toLowerCase()) || _LETTER_OFFERS_AUDIT_RE.test(src) || _SAMPLE_MENTION_RE.test(src)) return none
  const ongoing = ONGOING_SIGNAL_RE.test(post) && !AUDIT_ONLY_NO_ONGOING_RE.test(post)
  const para = asksRate
    ? [RUNNING_ACCOUNT_AUDIT_CTA.priced, ongoing ? RUNNING_ACCOUNT_AUDIT_CTA.credit : '', AUDIT_SAMPLE_SENTENCES.ppc].filter(Boolean).join(' ')
    : `${RUNNING_ACCOUNT_AUDIT_CTA.plain} ${AUDIT_SAMPLE_SENTENCES.ppc}`
  const paras = src.replace(/\s+$/, '').split(/\n\s*\n/)
  const last = paras.length - 1
  if (/^artem\.?$/i.test(paras[last].trim())) paras.splice(last, 0, para)
  else paras.push(para)
  return { text: paras.join('\n\n'), inserted: asksRate ? (ongoing ? 'priced+credit' : 'priced') : 'plain' }
}
