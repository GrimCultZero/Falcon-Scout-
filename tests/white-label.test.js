// White-label / agency framing only when the posting asks for it
// (frontend/src/lib/letterGuards.js + the generator wiring in JobDetail.jsx).
//
// Owner, 2026-09-29 (job 16678): "its reoccuring bug - approaching job as an
// agency when there is no indication from the posting to do this". A growth
// agency hiring "an experienced Google Ads specialist to join us" got "I run IT
// Force, a small agency that's been delivering Google Ads behind other agencies'
// brands for years … while you stay front-facing … zero contact with your end
// clients". The day before, job 16504 (a client with two travel brands of its
// own) got the same pitch. Three things pushed it: the CLIENT TYPE block keyed on
// "the buyer is an agency" alone, KB rules #406/#408 ("When the job posting
// explicitly mentions they are an agency, state that you work with digital
// marketing agencies as a white label partner") routed on the bare word
// "agency", and the prompt's own example of reading rules literally was that
// exact agency → white-label rule.
//
// Validated 2026-09-29 against 758 postings (the DB plus the earlier dump): 12
// ask, every one read by hand; and against 256 sent letters: 17 pitch
// white-label, 12 of them to postings that never asked.
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
  const asks = (t) => G.postingAsksForWhiteLabel(t);

  // ── the posting asks ────────────────────────────────────────────────────
  const ASKS = [
    'SEO Specialist (White Label) Manage Multiple Client Accounts',
    'This is white-label: you work under our brand, no client-facing sales.',
    "You would be doing it whitelabel for our agency - currently it's just 1 account.",
    'This is a white-label project. You work through me and do not contact the client directly.',
    "We're looking to bring on a dependable SEO subcontractor — either an individual specialist or a small team.",
    'You work with us only, with no client contact.',
    'Comfort working under our brand.',
    'White Label SEO, AEO & Paid Media Fulfillment Partner for Growing Digital Agency',
    "Looking for an ongoing, behind-the-scenes Local SEO partner to grow and defend our clients' rankings.",
    "Our clients won't know you exist — everything goes out under our name.",
  ];
  for (const s of ASKS) assert(!!asks(s), `asks: "${s.slice(0, 90)}"`);
  const a = asks('Summary\nThis is a white-label project. You work through me.');
  assert(a && a.sentence === 'This is a white-label project.', 'returns the sentence that asks, for the prompt to quote');

  // ── not asks ────────────────────────────────────────────────────────────
  const NOT_ASKS = [
    // job 16678 — an agency buyer hiring a specialist
    "Google Ads Specialist for E-commerce Product Testing (Shopping, PMax, Search) – Agency Partner\nWe're a growth agency working with Shopify brands in Europe and the US. We're looking for an experienced Google Ads specialist to join us on an ongoing basis, managing e-commerce accounts. Our clients are often early-stage brands launching new products. Provide clear reporting and recommendations to our team.",
    // job 16504 — a client with brands of its own
    "We're seeking an experienced PPC & Meta Ads specialist to manage paid advertising for two travel brands. We have an in-house team for content and creative.",
    // negated
    'Individual freelancers only. No agencies, account managers, or white-label providers.',
    'Agencies and subcontracting arrangements are not a good fit for this role.',
    'Strict Requirement: No Agencies or Middlemen. DO NOT APPLY IF YOU ARE AN AGENCY, OUTSOURCING TEAM, ACCOUNT MANAGER, OR PROJECT MANAGER.',
    // white-label as the client's own product
    'Content targeting our niche — payroll outsourcing for accountancy firms, white-label payroll, bureau services.',
    'Company operates several white-label merchant services brands.',
    // resellers, agencies wanted by a brand
    "There's no markup or reselling of ad spend.",
    'The core challenge is competing against our own resellers.',
    'We are an established ecommerce business looking for a new agency to manage and grow our paid advertising.',
    'We are a China-based Dropshipping Supplier & Fulfillment Partner helping Shopify businesses.',
    'Specialty Subcontractor Costs',
  ];
  for (const s of NOT_ASKS) assert(asks(s) === null, `not an ask: "${s.replace(/\s+/g, ' ').slice(0, 90)}"`);

  // ── the pitch, in a letter ──────────────────────────────────────────────
  const draft16678 = "SCALE\n\nI run IT Force, a small agency that's been delivering Google Ads behind other agencies' brands for years. We handle the build, test and scale work for your clients - campaigns, feed optimization, product testing on small budgets, while you stay front-facing. Clean handoffs, client-ready reporting you can present as your own, zero contact with your end clients.\n\nArtem";
  const p = G.findWhiteLabelPitch(draft16678);
  for (const want of ['I run IT Force, a small agency', "behind other agencies' brands", 'you stay front-facing', 'present as your own', 'zero contact with your end clients']) {
    assert(p.some(x => x.toLowerCase() === want.toLowerCase()), `job 16678 draft: "${want}" found`);
  }
  assert(G.findWhiteLabelPitch("I run a boutique agency (IT Force), we've delivered white-label behind other agencies' brands for years.").length >= 3, 'job 16504 letter: the pitch is found');
  const CLEAN = [
    "SCALE\n\n12 years running Google Ads, Google Premier Partner 2026. I'd run product tests on your clients' Shopify accounts and report to your team weekly.",
    'Where most dev shops hand off to a separate SEO team later, my team at IT Force wires the technical SEO into the build itself.',
    'I report to your team, not to anyone else.',
  ];
  for (const s of CLEAN) assert(G.findWhiteLabelPitch(s).length === 0, `no pitch: "${s.replace(/\s+/g, ' ').slice(0, 80)}"`);
  assert(G.findWhiteLabelPitch('A search for "payroll services UK" could be a sole trader, not an accountancy firm evaluating white-label partners.', { postingText: 'we sell white-label payroll to bureaus' }).length === 0,
    "white-label as the client's own product is the client's word, not a pitch");
  assert(G.findWhiteLabelPitch('I work with digital marketing agencies as a white label partner.', { postingText: 'No agencies, account managers, or white-label providers.' }).length === 1,
    '…but a posting that bans white-label providers does not excuse the pitch');

  // ── wiring in JobDetail.jsx ─────────────────────────────────────────────
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  assert(/const _whiteLabelAsk = postingAsksForWhiteLabel\(`\$\{job\?\.title \|\| ''\}\\n\$\{_earlyDesc\}`\)/.test(src), 'the ask is read from the title + description (no skill tags)');
  assert(/const whiteLabelFraming = isAgencyClient && !!_whiteLabelAsk/.test(src), 'white-label framing = agency buyer AND an explicit ask');
  const delAt = src.indexOf("if (!whiteLabelFraming) genScopes.delete('agency')");
  const routeAt = src.indexOf('const kbRules = rulesForGenerator(allRules, genScopes)');
  assert(delAt !== -1 && routeAt > delAt && routeAt - delAt < 200, 'the agency scope (KB #406/#408) is dropped before rule routing unless the posting asks');
  assert((src.match(/\.filter\([ep] => whiteLabelFraming \|\| !_WHITELABEL_EXAMPLE_RE\.test/g) || []).length === 2, 'both white-label few-shot filters gate on whiteLabelFraming');
  assert(!/isAgencyClient \|\| !_WHITELABEL_EXAMPLE_RE/.test(src), '…and no filter still lets white-label examples in on the agency buyer alone');
  const ct = src.indexOf('whiteLabelFraming\n          ? `CLIENT TYPE: agency / white-label');
  const sp = src.indexOf(': isAgencyClient\n          ? `CLIENT TYPE: SPECIALIST HIRE, NOT white-label', ct);
  const dc = src.indexOf(': `CLIENT TYPE: DIRECT end client.', sp);
  assert(ct !== -1 && sp > ct && dc > sp, 'CLIENT TYPE has three branches: white-label ask → agency buyer without one → direct client');
  const spBlock = src.slice(sp, dc);
  for (const banned of ['I run IT Force', 'white-label', "behind other agencies' brands", 'zero contact with your end clients']) {
    assert(spBlock.includes(banned), `the specialist branch names "${banned}" as banned`);
  }
  assert(!src.includes('Apply the white-label framing whenever the trigger word appears'), "the literal-reading example no longer teaches agency → white-label");
  assert(/white-label positioning: whether it applies is decided by the CLIENT TYPE line/.test(src), '…and says CLIENT TYPE decides white-label');
  assert(/on a white-label job \(CLIENT TYPE: agency \/ white-label\) that is "Artem's team, IT Force, delivers behind agencies' brands/.test(src), "the screening-questions section's hand-off model is scoped to white-label jobs");
  assert(/!offersCall\n\s+&& !seoPriceOffLedger\n\s+&& !unrequestedWhiteLabel/.test(src) && /unrequestedWhiteLabel && 'unrequestedWhiteLabel'/.test(src), 'unrequestedWhiteLabel is a reported check');
  assert(/_liveWhiteLabelPitch\.length > 0 && \(/.test(src), 'and a live "Fix before sending" note');

  // ── rule routing, lifted from JobDetail.jsx ─────────────────────────────
  const from = src.indexOf('function parseRuleScopes');
  const to = src.indexOf('function rulesForAnalyser');
  // jobScopes calls two letterGuards imports (running-account audit scope, negated
  // launch blanking — 2026-09-29), so the lifted copy gets them as parameters.
  const R = new Function('postingHasRunningAccount', 'blankNegatedLaunch', `${src.slice(from, to)}; return { jobScopes, rulesForGenerator }`)(G.postingHasRunningAccount, G.blankNegatedLaunch);
  const RULES = [
    { id: 406, tags: 'scope:agency', content: 'When the job posting explicitly mentions they are an agency, state that you work with digital marketing agencies as a white label partner …' },
    { id: 407, tags: 'scope:always', content: 'Include ONLY case studies that are genuinely relevant …' },
    { id: 408, tags: 'scope:agency', content: 'When a job posting states the client is an agency … treat it as a white label opportunity …' },
  ];
  const route = (posting, whiteLabelFraming) => {
    const scopes = R.jobScopes(posting)
    if (!whiteLabelFraming) scopes.delete('agency')
    return R.rulesForGenerator(RULES, scopes).map(r => r.id)
  };
  const post16678 = NOT_ASKS[0];
  assert(R.jobScopes(post16678).has('agency'), 'job 16678 sets the agency scope (the word "agency")…');
  assert(JSON.stringify(route(post16678, false)) === '[407]', '…but without an ask KB #406/#408 stay out of the prompt');
  assert(JSON.stringify(route('SEO Specialist (White Label) for our agency clients', true)) === '[406,407,408]', 'with an ask they load as before');

  // ── corpus ──────────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
  } else {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    let postingAsks = 0, pitched = 0, unasked = 0;
    for (const r of rows) {
      const ask = asks(r.posting || '');
      if (ask) postingAsks++;
      if (G.findWhiteLabelPitch(r.text, { postingText: r.posting }).length) {
        pitched++;
        if (!ask) unasked++;
      }
    }
    console.log(`\ncorpus: ${rows.length} letters — ${postingAsks} posting(s) ask for white-label, ${pitched} letter(s) pitch it, ${unasked} of them unasked`);
    // Hand-reviewed 2026-09-29: the 12 unasked pitches are all real (agency
    // buyers hiring a specialist, "must have agency experience" postings, and
    // brands); the 5 asked are "(White Label)" titles, "whitelabel for our
    // agency", "under our brand".
    assert(postingAsks >= 4 && postingAsks <= 8, `white-label asks stay rare (${postingAsks}; 5 on 2026-09-29)`);
    assert(unasked >= 10 && unasked <= 14, `the unasked pitches in sent letters are still found (${unasked}; 12 on 2026-09-29)`);
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
