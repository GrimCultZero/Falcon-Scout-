// No call offers + the audit sample (frontend/src/lib/letterGuards.js), and the
// attachment reminder (listClaimedAttachments in caseLedger.js), validated
// against the real sent-letter history.
//
// Why: job 16113 (2026-09-24) quoted "$300 flat for the audit" without the
// sample and asked for "Admin access … plus a quick call to confirm what counts
// as a qualified lead" — Artem does no calls (analyser Rule 2, zero exceptions).
// The hard part is precision: in these letters "call" is almost always a
// phone-call CONVERSION ("call tracking", "booked calls"), so the detector is
// held to zero hits on those shapes, here and across the whole corpus.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = path.join(__dirname, '..', 'frontend', 'src', 'lib');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const G = await import(pathToFileURL(path.join(LIB, 'letterGuards.js')).href);
  const L = await import(pathToFileURL(path.join(LIB, 'caseLedger.js')).href);
  const offers = (t) => G.findCallOffers(t).length;

  // ── detection: offers ───────────────────────────────────────────────────
  const OFFERS = [
    "I'd need Admin access to Google Ads + GA4/GTM, plus a quick call to confirm what counts as a qualified lead on your end.",
    "I'd be delighted to jump on a call with you guys and hear more about your launch details.",
    'Happy to hop on a quick call to go over the findings.',
    'Would you be open to a 15-minute call this week?',
    "Let's schedule a call to discuss next steps.",
    'I can walk you through the findings on a call.',
    'Week 1: kick-off call to align on goals, then the audit.',
    'We could do a Zoom call on Friday.',
    'Available for a call anytime.',
    'Happy to do a screen-share if useful.',
    'No fluff, happy to jump on a call.',
  ];
  for (const s of OFFERS) assert(offers(s) === 1, `offer caught: "${s}"`);

  // ── detection: not offers ───────────────────────────────────────────────
  const NOT_OFFERS = [
    'Proper call tracking via GTM so every lead is attributed.',
    'Booked calls are the only conversion that matters here.',
    'Where a phone call or a form fill is the only conversion.',
    'Separate the high-intent calls from low-value ones.',
    'Set up call conversion goals that dedupe repeat callers.',
    'Every lead who books a quick call is recorded in the CRM.',
    'Add a clear "Book a quick call" button above the fold.',
    'Your weekly Zoom calls with the sales team stay as they are.',
    'I run structured written updates so your team always has current status without waiting on a call.',
    'Instead of a screen-share, you get a written report you can forward.',
    'The report walks you through each fix in priority order.',
    "I'll walk you through every fix in the written report.",
  ];
  for (const s of NOT_OFFERS) assert(offers(s) === 0, `not an offer: "${s}"`);

  // ── the strip ───────────────────────────────────────────────────────────
  const s16113 = G.stripCallOffers(OFFERS[0]);
  assert(s16113.text === "I'd need Admin access to Google Ads + GA4/GTM, plus a short written note to confirm what counts as a qualified lead on your end.",
    'job 16113: "plus a quick call to confirm X" becomes a written ask, rest of the sentence kept');
  const sClause = G.stripCallOffers("I'd need Admin access to your account, plus a quick call to walk through your goals.");
  assert(sClause.text === "I'd need Admin access to your account.", 'a call clause whose verb can\'t become writing ("walk through") is cut back to the sentence before it');
  const sSentence = G.stripCallOffers('The audit covers tracking and structure. Happy to hop on a quick call to go over the findings. Delivered within 1 working day.');
  assert(sSentence.text === 'The audit covers tracking and structure. Delivered within 1 working day.', 'a sentence whose whole point is a call is removed, neighbours intact');
  const sLast = G.stripCallOffers('The audit covers tracking and structure. If it helps, I can also jump on a call to walk through it.');
  assert(sLast.text === 'The audit covers tracking and structure.', 'removing the LAST sentence leaves no trailing whitespace');
  const sPara = G.stripCallOffers('First paragraph.\n\nHappy to jump on a quick call to discuss.\n\nArtem');
  assert(sPara.text === 'First paragraph.\n\nArtem', 'a paragraph that was only a call offer disappears without leaving a blank run');
  const residual = 'Week 1: kick-off call to align on goals, then the audit.';
  const sResidual = G.stripCallOffers(residual);
  assert(sResidual.text === residual && !sResidual.changed, 'a call woven into a plan line is left alone (needs judgment) …');
  assert(offers(sResidual.text) === 1, '… and is still reported, so it reaches the UI note');
  const plain = 'Line one.\nLine two, with "quotes".\n\nSecond para - dash.\n\nArtem';
  const sPlain = G.stripCallOffers(plain);
  assert(sPlain.text === plain && !sPlain.changed, 'a letter with no offer comes back byte-for-byte identical');

  // ── the audit sample ────────────────────────────────────────────────────
  const fee16113 = "Fee:\n\n$300 flat for the audit, delivered within 1 working day. If we move to ongoing management after that, $700 first month (to implement the fixes), then $600/month for optimization and reporting. I run every audit myself, by hand — no automated tools or templated output involved.\n\nArtem";
  const a16113 = G.ensureAuditSampleMention(fee16113);
  assert(a16113.inserted === 'ppc', 'job 16113: a $300 audit with no sample gets the Google Ads sample sentence');
  assert(a16113.text.includes("templated output involved. I'm attaching a sample of a recent Google Ads audit so you can see the format and depth.\n\nArtem"),
    'it is appended to the fee paragraph, in Artem\'s own most-used wording');
  assert(G.ensureAuditSampleMention(a16113.text).inserted === null, 'idempotent: a second pass adds nothing');
  assert(G.ensureAuditSampleMention("$300 flat for the audit. I'm attaching a sample of a recent Google Ads audit so you can see the format and depth.").inserted === null,
    'an existing sample mention is left alone');
  assert(G.ensureAuditSampleMention('$300 flat for the audit.\n\nI can prepare a custom 3-month SEO promotion plan within 2 working days.').inserted === null,
    'one deliverable per letter: a letter offering the SEO promotion plan gets no audit sample');
  assert(G.ensureAuditSampleMention('$300 flat for the audit.', { postingLower: 'we already have an audit done, need someone to implement it' }).inserted === null,
    'a client who already has an audit gets no sample');
  assert(G.ensureAuditSampleMention('At a $300/month budget the audit would focus on search terms.').inserted === null, '"$300/month" is an ad budget, not the audit price');
  assert(G.ensureAuditSampleMention('$700 for the first month to implement the audit fixes, then $600/month.').inserted === null, '"$700 … first month" is the retainer, not the SEO audit');
  assert(G.ensureAuditSampleMention('$700 flat for the full technical SEO audit, delivered as a written report.').inserted === 'seo', 'a $700 technical SEO audit gets the SEO sample sentence');
  assert(G.ensureAuditSampleMention('Google Ads audit: $300 flat. Technical SEO audit: $700 flat.').inserted === 'both', 'both audits offered → one sentence naming both samples');
  assert(G.ensureAuditSampleMention('No price here, just an audit offer.').inserted === null, 'no stated audit price → nothing inserted (the check still reports it)');

  // ── the attachment reminder ─────────────────────────────────────────────
  const letter16118 = "That crawl/indexation matrix is exactly what my audit maps. I'm attaching a recent technical SEO audit sample so you can see the format and depth.\n\nDerma Solution (attached as PDF): YMYL medical aesthetics site.\n\nSkin Reboot (attached as PDF): restricted niche.\n\nLuxury Parfums (attached in profile highlights): scents.\n\nAttaching a sample SEO promotion plan so you can see the format.";
  const att = L.listClaimedAttachments(letter16118);
  assert(att.join('|') === 'Technical SEO audit sample|SEO promotion plan sample|Skin Reboot case study (PDF)|Derma Solution case study (PDF)',
    `job 16118: the reminder lists the four files the letter promises (${att.join(', ')})`);
  assert(L.listClaimedAttachments(a16113.text).join() === 'Google Ads audit sample', 'job 16113 after the insert: the Google Ads audit sample');
  assert(L.listClaimedAttachments('FridgeFix (attached in profile highlights): repair.').length === 0, 'profile-highlights cases are already on the profile — nothing to attach');

  // ── the corpus ──────────────────────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    try {
      require('child_process').execFileSync('python', [path.join(__dirname, '..', 'tools', 'dump_letters_fixture.py')], { stdio: 'inherit' });
    } catch (e) {
      console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
    }
  }
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    let found = 0, changed = 0, silentChange = 0, inserts = 0, insertWithMention = 0;
    for (const r of rows) {
      const t = r.text || '';
      const o = G.findCallOffers(t);
      found += o.length;
      o.forEach(x => console.log(`      call offer [${r.status}] "${x.match}" | ${x.sentence.slice(0, 150)}`));
      const s = G.stripCallOffers(t);
      if (s.changed) changed++;
      if (s.changed && o.length === 0) silentChange++;
      const a = G.ensureAuditSampleMention(t, { postingLower: (r.posting || '').toLowerCase() });
      if (a.inserted) {
        inserts++;
        if (/\bsamples?\b[^.\n]{0,80}\baudits?\b|\baudits?\b[^.\n]{0,80}\bsamples?\b/i.test(t)) insertWithMention++;
      }
    }
    console.log(`\ncorpus: ${rows.length} letters — ${found} call offer(s) found, ${changed} letter(s) the strip would change, ${inserts} sample insert(s)`);
    // Hand-reviewed 2026-09-24: 3 offers in 256 letters — "I'd be delighted to
    // jump on a call…", "I can walk YOU through the before/after GSC data … in a
    // follow-up", "…walk you through Google's verification flow…". A jump here
    // means the detector started reading conversions as offers.
    assert(found <= 5, `offers stay rare in real letters (${found}; 3 on 2026-09-24) — a jump means conversions are being read as offers`);
    assert(silentChange === 0, 'the strip never changes a letter in which it found no offer');
    assert(inserts >= 1 && inserts <= 3, `the sample insert fires only where the sample is missing (${inserts}; 1 of 42 audit offers on 2026-09-24)`);
    assert(insertWithMention === 0, 'and never on a letter that already mentions a sample');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
