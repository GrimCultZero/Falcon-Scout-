// Screening questions written INSIDE the job description (owner request 2026-11-17, job 24349).
//
// Job 24349 had a "Required Application Questions" section with 8 numbered questions, the posting said
// applications that do not answer them are not considered, and the screening_questions field was empty
// (it is empty on every enriched job: the extension never fills it). The letter answered 2 of 8.
//
//   extractInlineScreening(text)   the numbered / bolded questions of such a section, or null
//   screeningFromJob(job, text)    the field when it has questions, else the description
//   screeningPromptBlock(sq)       the prompt block: answer each in order, labelled with its number,
//                                  only from the case ledger and the owner's facts, nothing invented
//   screeningMissingFacts(sq)      the facts a question needs that are NOT on record, for the OWNER
//                                  (a note in the UI, never in the letter)
//   screeningCoverage(letter, sq)  which numbers the letter actually answers
//
// Pure functions, no React. Record-only apart from the prompt: nothing here blocks or rewrites a letter.
import { casesRequestedByPosting, CASE_BY_ID } from './caseLedger.js'
import { insertBeforeSignature, splitSignoff } from './letterGuards.js'

// A heading that introduces the questions. Markdown (## ...), bold (**...**) or a plain line, optional colon.
const HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:required\s+application\s+questions?|application\s+questions?|screening\s+questions?|questions?\s+for\s+(?:applicants|freelancers)|please\s+answer\s+(?:the\s+)?following(?:\s+questions?)?[^\n]{0,60}|answer\s+the\s+following(?:\s+questions?)?[^\n]{0,60}|to\s+apply,?\s+(?:please\s+)?answer[^\n]{0,60})\s*:?\s*(?:\*\*)?\s*\.?\s*$/i
// Where the section ends: the next markdown heading, or a bold line that is not a question
const NEXT_SECTION_RE = /^\s*#{1,6}\s+\S/
// "1. Title", "**1. Title**", "1) Title", "Q1: Title", "Question 2 - Title"
const NUMBERED_RE = /^\s*(?:\*\*)?\s*(?:q(?:uestion)?\s*)?(\d{1,2})\s*[.):\-–]\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/i

const clean = (s) => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()

/**
 * The questions of an "application questions" section in a posting, or null.
 * { heading, questions: [{ n, title, text }], casesAsked }
 * `title` is the client's own short label ("Experience and Portfolio") when the number line carries one; `text` is the full question.
 */
export function extractInlineScreening(description) {
  const lines = String(description || '').replace(/\r\n/g, '\n').split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) if (HEADING_RE.test(lines[i])) { start = i; break }
  if (start < 0) return null
  const section = []
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_SECTION_RE.test(lines[i])) break
    section.push(lines[i])
  }
  const questions = []
  let cur = null
  const flush = () => { if (cur) { cur.text = clean(cur.body.join(' ')) || cur.title; questions.push(cur); cur = null } }
  for (const raw of section) {
    const m = raw.match(NUMBERED_RE)
    if (m) {
      flush()
      const headline = clean(m[2])
      cur = { n: Number(m[1]), title: headline.endsWith('?') ? '' : headline, body: headline.endsWith('?') ? [headline] : [] }
      continue
    }
    if (!cur) continue
    const line = clean(raw)
    if (!line) continue
    if (/^[-*•]\s/.test(line) && !/\?\s*$/.test(line)) { cur.body.push(line.replace(/^[-*•]\s*/, '')); continue }
    cur.body.push(line)
  }
  flush()
  // a real list: numbers 1..k in order, at least two of them
  const ordered = questions.filter((q, i) => q.n === i + 1)
  if (ordered.length < 2 || ordered.length !== questions.length) return questions.length >= 2 && questions[0].n === 1 ? build(lines[start], questions, description) : null
  return build(lines[start], ordered, description)
}

function build(heading, questions, description) {
  return { heading: clean(heading), questions: questions.map(({ n, title, text }) => ({ n, title, text })), casesAsked: casesRequestedByPosting(description) }
}

/** Questions for a job: the stored field when it has some, else the description. { source, questions, casesAsked } | null */
export function screeningFromJob(job, description) {
  const raw = job && job.screening_questions
  if (raw && String(raw).trim() && String(raw).trim() !== '[]') {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length) {
        return { source: 'field', heading: 'screening_questions', casesAsked: casesRequestedByPosting(description),
          questions: arr.map((t, i) => ({ n: i + 1, title: '', text: clean(typeof t === 'string' ? t : (t && (t.question || t.text)) || '') })).filter(q => q.text) }
      }
    } catch (_) { /* fall through to the description */ }
  }
  const found = extractInlineScreening(description)
  return found ? { source: 'description', ...found } : null
}

/** The prompt block. Overrides the "never label / never Q&A / volume cap" rules for this posting only. */
export function screeningPromptBlock(sq) {
  if (!sq || !sq.questions || !sq.questions.length) return ''
  const n = sq.questions.length
  const list = sq.questions.map(q => `  ${q.n}. ${q.title ? q.title + ': ' : ''}${q.text.slice(0, 600)}`).join('\n')
  const cases = sq.casesAsked ? Math.min(5, sq.casesAsked) : 0
  return `⛔ SCREENING QUESTIONS WRITTEN IN THE POSTING (${n}, from ${sq.source === 'field' ? 'the screening-questions field' : 'the job description'}). The posting says applications that do not answer them are not considered. ANSWER EVERY ONE, IN ORDER.
FORMAT (this OVERRIDES every other rule that says never label answers, never echo the client's wording, never format as Q&A, and the case-study volume cap): after one short opening line, write one paragraph per question, in the posting's order, each BEGINNING with its number and, where the client gave one, its own short title, exactly like "1. Experience and Portfolio:". The letter must contain every label from 1 to ${n}; never skip, merge or reorder them.
THE QUESTIONS:
${list}
FACTS (non-negotiable): use ONLY (a) the approved case ledger (case names, metrics, places and periods exactly as given) and (b) ARTEM'S BUSINESS FACTS. Never invent a number, count, duration, client name, URL, result or timeframe. When a question needs a figure that is NOT on record (a total project count, how many accounts can be taken, wholesale or per-service pricing, a measured AI-search result, case-study links, expected results as numbers), write NOTHING about that figure: answer the rest of the question from what IS on record, and never apologise, say you lack it, promise to send it, or leave a placeholder. The owner is told separately which facts are missing.${cases ? `\nCASE STUDIES: the posting asks for ${cases} case studies. Across the answers cite up to ${cases} DIFFERENT approved cases, best fit first, each at most once, each with its real figures from the ledger; if fewer fit, cite fewer.` : ''}
LENGTH: each answer at most 3 short sentences (a case line counts as one), so the whole letter stays near ${Math.min(520, 120 + n * 45)} words.`
}

// ── facts a question needs that are NOT on record ─────────────────────────────
// On record: the case ledger (names, metrics, places, periods) and ARTEM'S BUSINESS FACTS (team of 20, fixed
// Google Ads / SEO fees, portfolio sites). Everything below is NOT, so the letter says nothing and the owner is told.
const MISSING = [
  { key: 'project_count', label: 'total number of SEO projects completed (and for USA / Canada clients)', re: /\bhow\s+many\b(?![^.?]{0,25}\bnew\s+client)[^.?]{0,80}\b(?:projects?|clients?|agencies|accounts|sites)\b|total\s+(?:project|client)\s+count/i },
  { key: 'case_links', label: 'links / URLs of the case studies (none on record for the SEO and Ads cases)', re: /\blinks?\s+to\b[^.?]{0,60}\b(?:case\s+stud|portfolio|work|projects?)|\bwebsite\s+url\b|\bcase\s+stud\w*\s+(?:links?|urls?)\b/i },
  { key: 'projections', label: 'your own 3 / 6 / 12-month expectations for a new site (no figures on record; the letter gives none)', re: /\bwhat\s+results\s+would\s+you\s+(?:realistically\s+)?expect\b|\bafter\s+3,\s*6\b|\brealistic(?:ally)?\s+expect/i },
  { key: 'ai_results', label: 'a measured AI-search (AEO / GEO) result (none in the case ledger)', re: /\b(?:measurable\s+results?|results?)\s+in\s+(?:ai|generative)\s+search\b|\bhave\s+you\s+produced\s+measurable\b|\bAI\s+search\b[^.?]{0,80}\b(?:examples?|measured?)\b/i },
  { key: 'capacity', label: 'how many new client accounts you can take on now', re: /\bhow\s+many\s+new\s+client\s+accounts\b|\baccommodate\b|\bcurrent\s+capacity\b|\bcapacity\b/i },
  { key: 'pricing', label: 'wholesale / white-label monthly pricing per service (the only fees on record are the fixed Google Ads / SEO fees)', re: /\b(?:wholesale|white-?label)\b[^.?]{0,40}\bpricing\b|\bmonthly\s+pricing\b|\bpricing\s+for\b|\bwhat\s+(?:do\s+you|is\s+your)\s+charge\b/i },
  { key: 'tenure', label: 'how long you have worked with agencies / white-label clients (no tenure on record)', re: /\bhow\s+long\b[^.?]{0,40}\b(?:agenc|white-?label|retainer)\w*|\bfor\s+how\s+long\b/i },
]

/** [{ n, key, label }] for every question that needs a fact that is not on record. */
export function screeningMissingFacts(sq) {
  if (!sq || !sq.questions) return []
  const out = []
  for (const q of sq.questions) for (const m of MISSING) if (m.re.test(q.text)) out.push({ n: q.n, key: m.key, label: m.label })
  return out
}

/** One line for the owner. */
export function missingFactsNote(sq) {
  const facts = screeningMissingFacts(sq)
  if (!facts.length) return ''
  return facts.map(f => `Q${f.n}: ${f.label}`).join(' | ')
}

/** Which question numbers the letter answers: a line that BEGINS with "N." / "N)" (optionally bold). */
export function screeningCoverage(letter, sq) {
  const answered = new Set()
  for (const raw of String(letter || '').split('\n')) {
    const m = raw.match(/^\s*(?:\*\*)?(\d{1,2})\s*[.)](?:\*\*)?\s+\S/)
    if (m) answered.add(Number(m[1]))
  }
  const all = (sq && sq.questions ? sq.questions : []).map(q => q.n)
  return { answered: all.filter(n => answered.has(n)), missing: all.filter(n => !answered.has(n)), total: all.length }
}

// ── deterministic enforcement (owner, 2026-11-20): "record it" wasn't enough ──
// screeningQuestionsUnanswered and the missing-pricing-figure case both used to
// only RECORD a gap, same mistake the deleted rewrite-enforcer made for every
// OTHER kind of defect (GENERATOR_REBUILD_HANDOFF.md §4: three real letters,
// each one worse after a Claude "fix" than before, because free-form rewrites
// are not reliably correct and the rewrite was never re-checked). The
// difference here: both of these gaps have a FIXED, KNOWN-CORRECT answer
// (Golden State Trailers' own ledger figures; Artem's own fixed fee) that can
// be inserted as a literal template — no generation, no judgment call, so
// none of the three failure modes that killed the rewrite-enforcer apply.

// Job 24349 Q4's exact shape: "Describe a local SEO project...". Golden State
// Trailers is the only ledger case with real local/geo-expansion SEO work.
const LOCAL_SEO_RESULTS_Q_RE = /\blocal\s+seo\s+results?\b|\bgoogle\s+maps?\s+visibility\b|\blocal\s+organic\s+rankings?\b|\bmap[\s-]?pack\b/i

/**
 * If a numbered question asks for local-SEO results and the letter never
 * answered it, insert a templated answer built ONLY from Golden State
 * Trailers' ledger record (name, attachment, one_liner, metrics) at the
 * correct numeric position. Never fires if the question IS answered, or if
 * the ledger case is missing (nothing to template from).
 */
export function ensureLocalSeoResultsAnswer(text, sq) {
  const src = String(text || '')
  if (!sq || !sq.questions || !sq.questions.length) return { text: src, inserted: false }
  const q = sq.questions.find(q => LOCAL_SEO_RESULTS_Q_RE.test(q.text) || LOCAL_SEO_RESULTS_Q_RE.test(q.title || ''))
  if (!q) return { text: src, inserted: false }
  if (!screeningCoverage(src, sq).missing.includes(q.n)) return { text: src, inserted: false }
  const c = CASE_BY_ID['golden-state-trailers']
  if (!c) return { text: src, inserted: false }
  const attachment = c.attachment === 'pdf' ? 'attached as PDF' : 'attached in profile highlights'
  const answer = `${q.n}. ${q.title || 'Local SEO Results'}: Golden State Trailers (${attachment}), ${c.one_liner}. Results: ${(c.metrics || []).join(', ')}.`
  const paras = src.split(/\n{2,}/)
  const numOf = (p) => { const m = p.match(/^\s*(?:\*\*)?(\d{1,2})\s*[.)]/); return m ? Number(m[1]) : null }
  let insertAt = paras.length
  for (let i = 0; i < paras.length; i++) {
    const n = numOf(paras[i])
    if (n != null && n > q.n) { insertAt = i; break }
  }
  paras.splice(insertAt, 0, answer)
  return { text: paras.join('\n\n'), inserted: true }
}

// Mirrors screeningQuestions.js's own 'pricing' MISSING key — a question
// asking for a wholesale/per-service pricing BREAKDOWN Artem doesn't have.
// Artem's REAL fixed fees (kept in sync by hand with JobDetail.jsx's
// ARTEM_FIXED_FEES — the operative copy; this is a literal, deterministic
// insert, never a generated figure) still answer the PART of the question
// that's real: what a single service actually costs.
const _PRICING_Q_RE = /\b(?:wholesale|white-?label)\b[^.?]{0,40}\bpricing\b|\bmonthly\s+pricing\b|\bpricing\s+for\b|\bwhat\s+(?:do\s+you|is\s+your)\s+charge\b/i
/**
 * If a numbered question asks for pricing and the letter's answer states NO
 * real figure anywhere ($1,050 / $700 / $600), append the one real figure
 * that applies to this job's service (SEO and/or Google Ads) to that
 * question's existing paragraph. Never invents a per-service breakdown Artem
 * doesn't have — only states what IS on record.
 */
export function ensurePricingFigureWhenAsked(text, sq, { isSeoJob = false, isPpcJob = false } = {}) {
  const src = String(text || '')
  if (!sq || !sq.questions || !sq.questions.length) return { text: src, inserted: false }
  if (/\$1,050|\$700\b|\$600\b/.test(src)) return { text: src, inserted: false }
  const q = sq.questions.find(q => _PRICING_Q_RE.test(q.text))
  if (!q) return { text: src, inserted: false }
  const fact = isSeoJob && !isPpcJob
    ? 'For SEO, the flat rate is $1,050/month, all inclusive.'
    : (isPpcJob && !isSeoJob
        ? 'For Google Ads, it is $700 for the first month (full setup), then $600/month.'
        : 'SEO is $1,050/month, all inclusive; Google Ads is $700 for the first month (full setup), then $600/month.')
  const paras = src.split(/\n{2,}/)
  const startRe = new RegExp(`^\\s*(?:\\*\\*)?${q.n}\\s*[.)]`)
  const idx = paras.findIndex(p => startRe.test(p))
  let out
  if (idx !== -1) {
    paras[idx] = paras[idx].replace(/\s*$/, '') + ' ' + fact
    out = paras.join('\n\n')
  } else {
    // Task 1 item 2 (owner, 2026-11-21): never append after the signature.
    // The question paragraph wasn't found (e.g. its number line didn't match
    // exactly) -- fall back to the LAST PARAGRAPH BEFORE THE SIGNATURE, never
    // a raw append that can land after "Artem" if that's the trimmed text's
    // last line.
    out = insertBeforeSignature(src, fact)
  }
  return { text: out, inserted: true }
}

// ── Task 1 item 1 (owner, 2026-11-21): insert the repair call's answers ──────
/**
 * Insert several already-formatted "N. ..." answer paragraphs into `text` at
 * their correct numeric position (relative to the existing numbered
 * paragraphs) -- same splice-by-number logic ensureLocalSeoResultsAnswer uses
 * for its one templated insert, generalized to any number of entries from the
 * ONE targeted repair call JobDetail.jsx makes when screeningCoverage() finds
 * a numbered question the letter never answered.
 */
export function insertNumberedAnswers(text, entries) {
  const src = String(text || '')
  if (!entries || !entries.length) return src
  // Split the sign-off off the WHOLE string first (never just "is the last
  // paragraph exactly the sign-off?" — a real letter often runs the sign-off
  // onto the SAME paragraph as the previous sentence with a single newline,
  // e.g. "...all inclusive.\nArtem", confirmed on a real job-24349
  // regeneration: Q8's repaired answer landed after "Artem" because the old
  // paragraph-boundary check never saw a signoff-only paragraph to protect).
  const { body, signoff } = splitSignoff(src)
  const paras = body ? body.split(/\n{2,}/) : []
  const numOf = (p) => { const m = p.match(/^\s*(?:\*\*)?(\d{1,2})\s*[.)]/); return m ? Number(m[1]) : null }
  for (const { n, text: answer } of [...entries].sort((a, b) => a.n - b.n)) {
    let insertAt = paras.length
    for (let i = 0; i < paras.length; i++) {
      const pn = numOf(paras[i])
      if (pn != null && pn > n) { insertAt = i; break }
    }
    paras.splice(insertAt, 0, answer)
  }
  const newBody = paras.join('\n\n')
  return signoff ? newBody + signoff : newBody
}
