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
export function findOffLedgerSeoPrices(text, { postedFixed = null } = {}) {
  const out = []
  const posted = Number(String(postedFixed ?? '').replace(/[^0-9.]/g, '')) || null
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
