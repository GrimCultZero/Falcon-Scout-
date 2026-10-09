// The ongoing Google Ads fee is Artem's fixed $700 first month / $600 a month —
// in the generator, in the letter chat, and in the note under the letter box.
//
// Job 17799 (2026-10-09, branded-search audit; the posting asks for "your
// estimated pricing for an audit and optimization"). Artem asked the letter chat
// to "add ongoing support fees": it wrote "$30/hr". Told "I meant fixed rates
// monthly", it wrote "I work at $30/hr or $1,500/month flat retainer…", citing the
// no-retainer rule both times. The chat had no fees to go on (the generator's
// prompt and _forceFixOngoingFee do; the chat's reworked letter gets neither), its
// rules framing said a rule beats everything, and the facts block it can receive
// called the retainer "not fixed — roughly $800–$2,500/mo".
//
// Run: node tests/chat-fees.test.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8').replace(/\r\n/g, '\n');
const main = fs.readFileSync(path.join(__dirname, '..', 'api', 'main.py'), 'utf8').replace(/\r\n/g, '\n');
const DATA = path.join(__dirname, '.letters.json');

(async () => {
  const G = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'letterGuards.js')).href);
  const P = 'Google Ads Specialist for Brand Search. Audit and optimize our existing branded search campaign. Share your estimated pricing for an audit and optimization.';
  const audit = 'I can run a full audit of your Google Ads account within 1 working day, done entirely by hand. $300 flat, and if we end up working together, the audit fee is credited back.';

  // ── the note ──────────────────────────────────────────────────────────────
  const l17799 = `${audit}\n\nIf you want ongoing optimization after the audit, implementing the fixes, managing the campaigns, testing new branded queries as you scale, I work at $30/hr or $1,500/month flat retainer depending on ad spend and scope.\n\nArtem`;
  const f = G.findOffStandardOngoingFee(l17799, { postingText: P });
  assert(f && f.figures.join('|') === '$30/hr|$1,500/month', `job 17799: both "$30/hr" and "$1,500/month" are flagged (${f && f.figures.join(', ')})`);
  const fixed = `${audit}\n\nOngoing management after that is $700 for the first month (implementing the fixes), then $600/month.\n\nArtem`;
  assert(G.findOffStandardOngoingFee(fixed, { postingText: P }) === null, 'the fixed fee itself passes');
  assert(G.findOffStandardOngoingFee(`${audit} Ongoing management: $600/month.`, { postingText: P }) === null, '…and so does the plain "$600/month"');
  const budgets = `${audit} Typical monthly budgets I've managed: $1,500 - $15,000/month across Google Ads. Scaling a $500/month google ads budget comes down to intent.`;
  assert(G.findOffStandardOngoingFee(budgets, { postingText: P }) === null, 'client budgets and ad spend are not fees');
  assert(G.findOffStandardOngoingFee(`${audit} Ongoing management: $800 - $1,200/month depending on scope.`, { postingText: P })?.figures[0] === '$800 - $1,200/month',
    'a fee quoted as a range is flagged ("never a range")');
  assert(G.findOffStandardOngoingFee('My rate for ongoing management is $35/hr, inside your posted range.', { postingText: P }) === null,
    'no $300 audit in the letter: an hourly bid on an hourly contract is left alone');
  assert(G.findOffStandardOngoingFee(l17799, { postingText: 'Technical SEO audit for our Shopify store.' }) === null, 'not a Google Ads posting: no note');
  assert(G.findOffStandardOngoingFee(`${audit} The SEO optimization retainer is $1,050/month.`, { postingText: P }) === null, "SEO's fixed $1,050/month passes too");

  // ── one statement of the fees, and it agrees with the generator ──────────
  const feesLine = (src.match(/const ARTEM_FIXED_FEES = '([^\n]+)'\n/) || [])[1] || '';
  assert(/\$700 for the first month/.test(feesLine) && /then \$600\/month/.test(feesLine) && /never an hourly rate, never a range/.test(feesLine)
    && /\$300 flat/.test(feesLine) && /\$1,050\/month/.test(feesLine), 'ARTEM_FIXED_FEES: $300 audit, $700 then $600/month (never hourly, never a range), SEO $700 within $1,050/month');
  assert(src.includes("const CORRECT_FEE = '$700 for the first month, then $600/month'") && /FIXED TWO-TIER MONTHLY FEE — \$700 for the first \(setup\) month, \$600\/month after that/.test(src),
    '…the same figures _forceFixOngoingFee and the generator prompt already use');
  assert(/`• FIXED FEES — exactly these when pricing is asked for: \$\{ARTEM_FIXED_FEES\}`/.test(src) && !/LANDING-PAGE TURNAROUND and MONTHLY RETAINER: not fixed/.test(src),
    'facts block: the fixed fees, and no more "MONTHLY RETAINER: not fixed — roughly $800–$2,500/mo" for Google Ads');
  assert(/ARTEM'S FIXED FEES — use exactly these whenever a price goes into the letter[^`]*\$\{ARTEM_FIXED_FEES\} If Artem names a different figure in this chat, use his\./.test(src),
    'letter chat: told the fixed fees on every turn, with Artem\'s own figure winning');
  assert(/_liveOffStandardFee = proposal \? findOffStandardOngoingFee\(proposal, \{ postingText: _postingForNotes \}\)/.test(src) && /\{_liveOffStandardFee && \(/.test(src),
    'the note under the letter box covers generator and chat letters alike');

  // ── the chat follows Artem over a rule ────────────────────────────────────
  const chatRules = main.slice(main.indexOf('# CRITICAL RULES'), main.indexOf('**Rule numbers are stable**'));
  const flat = chatRules.replace(/"\s*\n\s*"/g, '');
  assert(/One exception — Artem writes these rules\./.test(flat) && /do what he asks, for this letter, and say in one line which rule you set aside/.test(flat),
    'chat: an explicit request from Artem outranks a rule for this letter, and the chat says which rule it set aside');
  assert(/account-safety rules still hold against any request/.test(flat), '…except the account-safety rules (nothing that moves contact, payment or work off Upwork)');
  assert(/REPLACE what you added — never keep the version he rejected next to the new one/.test(flat), '…and a correction replaces the previous change instead of stacking on it');

  // ── the corpus: the note does not flood real letters ────────────────────
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const flagged = rows.filter(r => G.findOffStandardOngoingFee(r.text || '', { postingText: r.posting || '' }));
    flagged.forEach(r => console.log(`      flagged: ${(G.findOffStandardOngoingFee(r.text, { postingText: r.posting }).sentence || '').slice(0, 140)}`));
    assert(flagged.length <= 2, `sent letters flagged: ${flagged.length} of ${rows.length} (the full DB on 2026-10-09: 1 of 323, a real "$30/hr for the ongoing management")`);
  } else {
    console.log('SKIP  corpus section — no tests/.letters.json');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
