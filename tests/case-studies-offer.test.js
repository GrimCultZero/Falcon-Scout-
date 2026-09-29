// Job 16684, third regeneration (2026-09-29). Owner: "audit is there, but where
// are case studies? Also last paragraph starts with 'Every audit I run is done
// entirely by hand, no automated tools' - so we descriobing audit without even
// offering it. We need to say that we are ready to run audit in 1 working day and
// then describe what is it".
//
// 1. Where the case studies went: generate() built the portfolio block with
//    `${job?.title || ''} ${fullDescription}` — but fullDescription is declared
//    further down the same function, so that line threw "Cannot access
//    'fullDescription' before initialization" and a silent `catch {}` swallowed
//    it. From 2026-08-10 (9a48f23) to today every letter was written without the
//    case-study portfolio, the reference templates and the case-facts block;
//    missingCaseStudy last fired 17 minutes before that commit and never again in
//    276 generations.
// 2. missingCaseStudy looked for result phrases, so a case named once inside the
//    credentials line (no paragraph, no attachment note) passed.
// 3. ensureAuditOfferLeads: the closing audit paragraph opens with the offer.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

  // ── 1. the KB block can't read a name declared after it ─────────────────
  const lines = src.split('\n');
  const genStart = lines.findIndex(l => /const generate = async/.test(l));
  const start = lines.findIndex((l, i) => i > genStart && /^      try \{/.test(l) && /cacheFresh/.test(lines[i + 1] || ''));
  const end = lines.findIndex((l, i) => i > start && /^      \} catch \(kbErr\) \{/.test(l));
  assert(genStart > 0 && start > genStart && end > start, 'located the KB context block in generate()');
  const code = lines.slice(start, end).filter(l => !/^\s*\/\//.test(l)).join('\n');
  // every const/let declared at generate()'s top level AFTER the block
  const later = new Set();
  for (let i = end + 1; i < lines.length; i++) {
    const m = lines[i].match(/^      (?:const|let) ([A-Za-z_$][\w$]*)/);
    if (m) later.add(m[1]);
    if (/^  \}$/.test(lines[i]) && i > end + 100) break;
  }
  // (local names the block declares itself — `text` in a map callback — and
  // words inside prompt strings are not reads of the later binding)
  const LOCAL_OR_PROSE = new Set(['text', 'data', 'response']);
  const used = [...later].filter(n => !LOCAL_OR_PROSE.has(n) && new RegExp(`(?<![\\w$.'"])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(code));
  assert(used.length === 0, `no name declared later in generate() is read inside the KB block (${used.join(', ') || 'none'}) — that is the 7-week bug's shape`);
  assert(/const _jobTextForCaseFilter = `\$\{job\?\.title \|\| ''\} \$\{_earlyDesc\}`/.test(src), 'the portfolio filter reads _earlyDesc');
  assert(/\} catch \(kbErr\) \{\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+console\.error\('\[Falcon\] KB context assembly failed/.test(src) && /_recordViolations\('generator', job\?\.id, \['kbContextFailed'\]\)/.test(src), 'a failure there is logged and flagged (kbContextFailed), never silent');
  assert(/\}  \/\/ end of `if \(!cacheFresh\)` block\n      \} catch \(kbErr\) \{/.test(src), 'the KB block closes on the logging catch, not a silent one');

  // ── 2. a case study is a paragraph with its note ────────────────────────
  const credLine = "12 years running Google Ads + Meta, Google Premier Partner 2026. I've done exactly this recovery work, FridgeFix appliance repair went from chaos to -92% cost per conversion and +1,405% conversions.";
  assert(!G.letterHasCaseStudy(`Opening.\n\n${credLine}\n\nArtem`), 'job 16684: FridgeFix inside the credentials line is not a case study');
  assert(G.letterHasCaseStudy('Opening.\n\nNectar Flowers (attached in profile highlights): -72% cost per conversion, +350% revenue.\n\nArtem'), 'a case paragraph with its attachment note is');
  assert(G.letterHasCaseStudy('Opening.\n\nSkin Reboot: 17.51 PMax ROAS and +693.8% revenue for a US medical-aesthetic skincare store.\n\nArtem'), 'so is a paragraph that opens with the case');
  assert(/missingCaseStudy = !letterHasCaseStudy\(text\)/.test(src), 'missingCaseStudy uses it');
  assert(/KEEP citing the relevant Google Ads case studies exactly as you would on any Google Ads job/.test(src), 'the Google Ads + Meta note says to keep the Google Ads case studies');

  // ── 3. the audit paragraph opens with the offer ─────────────────────────
  const post = 'Google Ads\nTake over and directly manage our existing Google Ads and Meta Ads accounts.';
  const p16684 = 'Every audit I run is done entirely by hand, no automated tools, no templated report. $300 flat, delivered within 1 working day, and if we end up working together ongoing, that audit fee is credited back. I\'m attaching a recent Google Ads audit sample so you can see the format and depth.';
  const r = G.ensureAuditOfferLeads(`Plan.\n\n${p16684}\n\nArtem`, { postingText: post });
  const closing = r.text.split('\n\n').slice(-2)[0];
  assert(r.inserted && closing.startsWith('I can run a full audit of your Google Ads account within 1 working day. Every audit I run is done entirely by hand'), 'job 16684: the paragraph now opens with the offer, then the description');
  assert(!/delivered within 1 working day/.test(closing) && /\$300 flat, and if we end up working together ongoing, that audit fee is credited back\./.test(closing), '…and the day is not said twice');
  assert(r.text.endsWith('\n\nArtem'), 'the sign-off stays last');
  const lone = G.ensureAuditOfferLeads("Plan.\n\nI'm attaching a sample of a recent Google Ads audit so you can see the format and depth.\n\nArtem", { postingText: post });
  assert(lone.inserted && /I can run a full audit of your Google Ads account within 1 working day\. I'm attaching a sample/.test(lone.text), 'a closing sample line with no offer gets the offer in front of it');
  const terms = G.ensureAuditOfferLeads('Plan.\n\nAudit delivered within 1 working day, flat $300. I\'m attaching a sample of a recent Google Ads audit.\n\nArtem', { postingText: post });
  assert(/within 1 working day\. Flat \$300\. I'm attaching/.test(terms.text), '"Audit delivered within 1 working day, flat $300." becomes the offer + "Flat $300."');
  const cred = G.ensureAuditOfferLeads('Plan.\n\n12 years running Google Ads, Google Premier Partner 2026. Every audit I run is done by hand, delivered within 1 working day.\n\nArtem', { postingText: post });
  assert(/^12 years running Google Ads, Google Premier Partner 2026\. I can run a full audit/m.test(cred.text), 'the offer goes before the first audit sentence, not before a credential line');
  const OFFERED = [
    'I can run a full diagnostic audit of your account within 1 working day, done by hand. I\'m attaching a sample Google Ads audit.',
    'I can complete and deliver the audit in 1 working day. I\'m attaching recent audit samples.',
    'Audit takes about 4-5 hours and I can deliver it in 1 working day once I have access.',
    'Google Ads audit (1 working day, $300 flat): conversion tracking check, query analysis.',
    'I run every audit entirely by hand and can have a full review of your account back to you within 1 working day.',
  ];
  for (const p of OFFERED) assert(!G.ensureAuditOfferLeads(`Plan.\n\n${p}\n\nArtem`, { postingText: post }).inserted, `already an offer: "${p.slice(0, 70)}"`);
  assert(!G.ensureAuditOfferLeads('Plan.\n\nEvery technical SEO audit I run is done by hand, crawl and indexation first. I\'m attaching a sample technical SEO audit.\n\nArtem', { postingText: 'SEO\nImprove our rankings.' }).inserted, 'an SEO audit paragraph is never given the 1-working-day lead (KB #416)');
  assert(!G.ensureAuditOfferLeads(`Plan.\n\n${p16684}\n\nArtem`, { postingText: 'Google Ads\nBuild our Google Ads from scratch for a new brand.' }).inserted, 'nor a launch posting (KB #450)');
  const cta = G.ensureRunningAccountAuditCta('Plan.\n\nArtem', { postingText: post });
  assert(cta.inserted && !G.ensureAuditOfferLeads(cta.text, { postingText: post }).inserted, 'the standard closing paragraph already leads with the offer — no second lead');

  // wiring
  const ctaAt = src.indexOf('const _cta = ensureRunningAccountAuditCta(text');
  const leadAt = src.indexOf('const _lead = ensureAuditOfferLeads(text, { postingText: _postingTitleDesc })');
  assert(ctaAt !== -1 && leadAt > ctaAt && leadAt - ctaAt < 1200, 'the lead runs right after the closing-audit insert');
  assert(/_recordViolations\('generator', job\?\.id, \['auditOfferLeadAutoInserted'\]\)/.test(src), '…recorded as auditOfferLeadAutoInserted');
  assert(/it OPENS with the offer itself — "I can run a full audit of your Google Ads account within 1 working day"/.test(src) && /- That paragraph OPENS with the offer itself/.test(src), 'the prompt says the same, in the RUNNING ACCOUNT note and in WHEN TO OFFER AN AUDIT');

  // ── corpus ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
  } else {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const leads = rows.filter(r => G.ensureAuditOfferLeads(r.text, { postingText: r.posting }).inserted).length;
    const noCase = rows.filter(r => !G.letterHasCaseStudy(r.text)).length;
    console.log(`\ncorpus: ${rows.length} letters — the offer lead would go on ${leads}; ${noCase} have no case study`);
    // Hand-read 2026-09-29: the 18 are closing audit paragraphs with no offer
    // anywhere in the letter (a lone sample line, "Audit delivered within 1 working
    // day, flat $300.", "Every audit I run…"), plus two pasted Upwork attachment lists.
    assert(leads >= 12 && leads <= 24, `the lead stays on letters that never offer (${leads}; 18 on 2026-09-29)`);
    assert(noCase >= 40 && noCase <= 62, `letters with no case study are the minority (${noCase}; 51 of 256 on 2026-09-29)`);
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
