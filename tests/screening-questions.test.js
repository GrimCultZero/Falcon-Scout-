// Screening questions written inside the job description (owner request 2026-11-17).
// Fixture: job 24349, "Required Application Questions", 8 numbered questions, the screening_questions field empty,
// the posting says incomplete answers are not considered, and the letter answered 2 of 8.
//   (1) detect them in description_full when the field is empty;
//   (2) answer each in order, labelled with its number, only from the ledger and the owner's facts, nothing invented;
//       a figure that is not on record is left out of the letter and listed in a note for the owner;
//   (3) tooManyCaseStudies allows as many cases as the posting asks for (cap 5);
//   (4) say which sentence attachmentUnbacked and timingViolation matched.
// Run: node tests/screening-questions.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'frontend', 'src', 'lib');
const POSTING = fs.readFileSync(path.join(__dirname, 'fixtures', 'job24349_posting.txt'), 'utf8');
const JD = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');

(async () => {
  const S = await import(pathToFileURL(path.join(LIB, 'screeningQuestions.js')).href);
  const L = await import(pathToFileURL(path.join(LIB, 'caseLedger.js')).href);
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const gcSrc = fs.readFileSync(path.join(LIB, 'groundingCheck.js'), 'utf8')
    .replace("from './caseLedger'", `from '${pathToFileURL(path.join(LIB, 'caseLedger.js')).href}'`);
  const tmp = path.join(os.tmpdir(), `groundingCheck-sq-${process.pid}.mjs`);
  fs.writeFileSync(tmp, gcSrc);
  const { groundingCheck } = await import(pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);

  const job = { id: 24349, title: 'Expert SEO Specialist / Agency', screening_questions: null, description_full: POSTING };

  // ── (1) detection ──────────────────────────────────────────────────────────
  const sq = S.screeningFromJob(job, POSTING);
  assert(sq && sq.source === 'description' && sq.questions.length === 8, 'job 24349: all 8 questions found in the description when the field is empty');
  assert(sq.questions.map(q => q.n).join() === '1,2,3,4,5,6,7,8', 'numbered 1 to 8, in order');
  assert(sq.questions[0].title === 'Experience and Portfolio' && /How many SEO projects have you completed/.test(sq.questions[0].text) && !/^Experience and Portfolio/.test(sq.questions[0].text), 'Q1: the client\'s own title is kept apart from the question text');
  assert(/Pricing and Capacity/.test(sq.questions[7].title) && /wholesale\/white-label monthly pricing/.test(sq.questions[7].text) && /subcontractors/.test(sq.questions[7].text), 'Q8 keeps its sub-list and its closing sentence');
  assert(!sq.questions.some(q => /Important|genuine long-term partners/.test(q.text)), 'the section stops at the next heading ("Important")');
  const reqOnly = POSTING.slice(POSTING.indexOf('## Mandatory Requirements'), POSTING.indexOf('## What We Want to See'));
  assert(S.extractInlineScreening(reqOnly) === null, 'a numbered "Mandatory Requirements" list is not mistaken for questions');
  assert(S.screeningFromJob({ screening_questions: '[]' }, POSTING).questions.length === 8 && S.screeningFromJob({ screening_questions: '' }, POSTING).questions.length === 8, 'an empty field ("" or []) falls back to the description');
  const fromField = S.screeningFromJob({ screening_questions: JSON.stringify(['Do you use GA4?', 'Your rate?']) }, 'no questions here');
  assert(fromField.source === 'field' && fromField.questions.length === 2 && fromField.questions[1].n === 2, 'a filled field is used as it is');
  const variants = [
    '## Screening Questions\n\n1. Have you run Google Ads for a dental clinic?\n2. What is your reporting cadence?\n',
    'Please answer the following:\n\n**1. Tools** What tools do you use for tracking?\n\n**2. Timeline** How long does onboarding take?\n\n',
    '**Application Questions**\n\n1) How many years of experience do you have?\n\n2) Which platforms do you manage?\n\nThanks!',
  ];
  assert(variants.every(v => { const r = S.extractInlineScreening(v); return r && r.questions.length === 2; }), 'other headings and number styles work: "Screening Questions", "Please answer the following:", "Application Questions", **1.**, 1)');
  assert(S.extractInlineScreening('## Screening Questions\n\nPlease tell us about yourself.') === null && S.extractInlineScreening('1. Foo\n2. Bar') === null && S.extractInlineScreening('') === null && S.extractInlineScreening(null) === null, 'one stray line, a list with no question heading, or empty text: no questions');
  assert(S.screeningFromJob({}, 'We need an SEO expert for our store.') === null, 'a posting with no questions: nothing changes');

  // ── (2) the prompt block ───────────────────────────────────────────────────
  const block = S.screeningPromptBlock(sq);
  assert(/ANSWER EVERY ONE, IN ORDER/.test(block) && /from the job description/.test(block) && /\(8,/.test(block), 'the block says: 8 questions, from the description, answer every one in order');
  for (let n = 1; n <= 8; n++) assert(new RegExp(`\\n  ${n}\\. `).test(block), `the block lists question ${n}`);
  assert(/BEGINNING with its number/.test(block) && /"1\. Experience and Portfolio:"/.test(block) && /from 1 to 8/.test(block), 'each answer is labelled with its number (and the client\'s title)');
  assert(/OVERRIDES every other rule that says never label answers/.test(block), 'it overrides the "never label / never Q&A" rules for this posting');
  assert(/use ONLY \(a\) the approved case ledger/.test(block) && /Never invent a number, count, duration, client name, URL, result or timeframe/.test(block), 'facts only from the ledger and the owner\'s facts; nothing invented');
  assert(/write NOTHING about that figure/.test(block) && /never apologise, say you lack it, promise to send it, or leave a placeholder/.test(block), 'a figure that is not on record: say nothing, no apology, no placeholder');
  assert(/the posting asks for 5 case studies/.test(block) && /up to 5 DIFFERENT approved cases/.test(block), 'the 5 case studies the posting asks for are allowed, each once');
  assert(!/Facts not on record|Q8: wholesale/.test(block), 'the missing-facts note is NOT part of the letter prompt (it is for the owner)');
  assert(S.screeningPromptBlock(null) === '' && S.screeningPromptBlock({ questions: [] }) === '', 'no questions, no block');

  // ── (2b) coverage: the 2-of-8 failure and a full answer ────────────────────
  const twoOfEight = 'Hi,\n\nI can take this on.\n\n1. Experience and Portfolio: 12 years in technical SEO.\n\n2. Brand-New Website SEO: a new site needs indexing first.\n\nArtem';
  const c2 = S.screeningCoverage(twoOfEight, sq);
  assert(c2.answered.join() === '1,2' && c2.missing.join() === '3,4,5,6,7,8' && c2.total === 8, 'the failure shape (2 of 8) is detected: missing 3 to 8');
  const full = 'Opening.\n\n' + sq.questions.map(q => `${q.n}. ${q.title}: answer.`).join('\n\n') + '\n\nArtem';
  const cf = S.screeningCoverage(full, sq);
  assert(cf.answered.length === 8 && cf.missing.length === 0, 'a letter with 1. to 8. is complete');
  assert(S.screeningCoverage('**3.** Local SEO: ok', sq).answered.join() === '3' && S.screeningCoverage('In 2026 I did 3 things', sq).answered.length === 0, 'bold labels count; numbers inside sentences do not');

  // ── (2c) facts that are NOT on record go to the owner, not the letter ──────
  const missing = S.screeningMissingFacts(sq).map(f => `${f.n}:${f.key}`).join(',');
  assert(missing === '1:project_count,1:case_links,2:projections,5:ai_results,8:capacity,8:pricing', `job 24349 needs these facts that are not on record: ${missing}`);
  assert(!S.screeningMissingFacts(sq).some(f => [3, 4, 6, 7].includes(f.n)), 'questions the ledger and profile can answer are not flagged (3, 4, 6, 7)');
  const note = S.missingFactsNote(sq);
  assert(/Q1: total number of SEO projects/.test(note) && /Q8: how many new client accounts/.test(note) && /Q8: wholesale/.test(note), 'the note names the question and the missing fact');
  assert(S.missingFactsNote({ questions: [{ n: 1, text: 'Do you use GA4?' }] }) === '', 'nothing missing, no note');

  // ── (3) tooManyCaseStudies allows what the posting asks for, cap 5 ─────────
  assert(L.casesRequestedByPosting(POSTING) === 5, 'the posting asks for "at least 5 detailed case studies": 5');
  assert(L.casesRequestedByPosting('Please give three examples of past work') === 3 && L.casesRequestedByPosting('share 2 case studies') === 2 && L.casesRequestedByPosting('We want 20+ completed SEO projects') === 0 && L.casesRequestedByPosting('no ask here') === 0, 'three examples = 3, 2 case studies = 2, "20+ completed projects" is not a request');
  const cases = (n) => ['Skin Reboot', 'Derma Solution', 'Golden State Trailers', 'FridgeFix', 'Atlant', 'Oxytec'].slice(0, n).map(c => `${c} is a case.\n\n`).join('');
  const flags = (letter, posting) => groundingCheck(letter, { postingText: posting }).violations.includes('tooManyCaseStudies');
  assert(flags(cases(3), '') && !flags(cases(2), ''), 'default: 2 cases are fine, 3 are flagged');
  assert(!flags(cases(5), POSTING), 'job 24349: 5 distinct cases are NOT flagged (the posting asks for 5)');
  assert(flags(cases(6), POSTING), 'job 24349: 6 cases are flagged (the cap is 5)');
  assert(!flags(cases(3), 'Give three examples.') && flags(cases(4), 'Give three examples.'), 'a posting asking for three examples allows 3, not 4');
  assert(flags(cases(6), 'Please provide at least 10 case studies.') && !flags(cases(5), 'Please provide at least 10 case studies.'), 'a bigger ask is capped at 5');
  assert(flags(cases(3), 'We have 20+ completed SEO projects behind us') , 'a number of projects is not a number of cases asked for');

  // ── (4) which sentence each flag matched ───────────────────────────────────
  const wrongLabel = groundingCheck('Skin Reboot (attached in profile highlights): scaled a skincare brand to 17.51 ROAS.', { postingText: '' });
  const am = wrongLabel.matches && wrongLabel.matches.attachmentUnbacked;
  assert(wrongLabel.violations.includes('attachmentUnbacked') && am && am[0].case === 'skin-reboot' && /PDF/.test(am[0].why) && /Skin Reboot \(attached in profile highlights\)/.test(am[0].sentence), 'attachmentUnbacked reports the case, why, and the sentence it matched');
  const twice = groundingCheck('Skin Reboot (attached as PDF) (attached in profile highlights): scaled a brand.', { postingText: '' }).matches.attachmentUnbacked;
  assert(twice && /more than once/.test(twice[0].why), 'a duplicated label says so');
  const tm = groundingCheck(cases(3), { postingText: '' }).matches.tooManyCaseStudies;
  assert(tm && tm[0].allowed === 2 && tm[0].cases.length === 3, 'tooManyCaseStudies reports the cases and how many were allowed');
  assert(JSON.stringify(groundingCheck('Plain text.', { postingText: '' }).matches) === '{}', 'no violation, no matches');
  const allowedT = new Set(['1 working day', '2 working days']);
  const hits = G.timingViolationSentences('I can run the audit in 1 working day. First results show within 14 days. Setup takes 3 business days, then 2 working days for the plan.', allowedT);
  assert(hits.length === 2 && /14 days/.test(hits[0].sentence) && hits[0].phrases.join() === '14 days' && hits[1].phrases.join() === '3 business days', 'timingViolation names the sentences with a phrase the rules do not allow, and the phrase');
  assert(G.timingViolationSentences('Audit in 1 working day.', allowedT).length === 0 && G.timingViolationSentences('', allowedT).length === 0, 'allowed phrases and empty text match nothing');
  const jdRe = JD.match(/const TIMING_RE = \/(.+?)\/gi/);
  assert(jdRe && jdRe[1] === G.TIMING_PHRASE_RE_SOURCE.replace(/\\/g, '\\'), 'the phrase regex in the generator and in the lib are identical (no drift)');
  assert(/console\.warn\(`\[Falcon\] \$\{code\} matched:/.test(JD) && /console\.warn\(`\[Falcon\] timingViolation matched:/.test(JD), 'the generator prints both: attachmentUnbacked / tooManyCaseStudies and timingViolation, with the sentence');

  // ── wiring in the generator ────────────────────────────────────────────────
  assert(/const inlineScreening = screeningFromJob\(job, fullDescription\)/.test(JD), 'generate() looks for inline screening questions');
  assert(/inlineScreening \? screeningPromptBlock\(inlineScreening\) : \(applicationChecklist \? applicationChecklist\.promptBlock : ''\)/.test(JD), 'the numbered block replaces the generic checklist block (which says never label answers)');
  assert(/applicationChecklist \|\| inlineScreening \|\|/.test(JD), 'the owner\'s business-facts block is included when questions were found');
  assert(/inlineScreening \? \[\] : \(applicationChecklist\?\.items/.test(JD), 'the echoed-question check does not fight the numbered titles');
  assert(/screeningQuestionsUnanswered/.test(JD) && /data-testid="screening-note"/.test(JD) && /data-testid="screening-missing-facts"/.test(JD), 'an unanswered number is recorded, and the owner sees how many were answered and which facts are missing');
  const noteJsx = JD.slice(JD.indexOf('data-testid="screening-note"') - 100, JD.indexOf('data-testid="screening-note"') + 1800);
  assert(!/disabled=|setProposal/.test(noteJsx), 'the note never blocks and never edits the letter');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
