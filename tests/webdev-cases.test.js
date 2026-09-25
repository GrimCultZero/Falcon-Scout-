// Owner rule, 2026-09-25: "we should never choose web development case studies
// for google ads." Job 16269 (Google Ads for a Shopify gift brand) cited Casa
// Eleganza — a Shopify BUILD case — as "relevant work". Three things let it
// through: the web-dev strip only ran on chat rewrites, never on generation; its
// build-ask test matched a bare "rebuild" ("audit, rebuild, and manage
// campaigns"); and the prompt showed the whole web-dev portfolio.
//
// Scope: generation enforces the rule on GOOGLE ADS postings, as stated. SEO
// postings are left alone there — a sent SEO letter that got a reply cited GKit's
// hreflang / URL setup, which is real SEO proof. The chat-rewrite strip keeps its
// older, wider scope (PPC + SEO + feed specialists, job 12883).
//
// The strip + its gates are lifted out of JobDetail.jsx at runtime, like the other
// tests here, so this can't drift from what ships.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'JobDetail.jsx');
const DATA = path.join(__dirname, '.letters.json');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  const { CASE_LEDGER } = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'caseLedger.js')).href);
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const start = src.indexOf('const _WEBDEV_BUILD_ASK_RE');
  const fnAt = src.indexOf('function _stripOffDomainWebDevCases');
  const end = src.indexOf('\n}\n', fnAt) + 3;
  if (start === -1 || fnAt === -1 || end < fnAt) { console.log('FAIL  could not locate the web-dev strip in JobDetail.jsx'); process.exit(1); }
  const { forAds, forChat, strip } = new Function('CASE_LEDGER', `
    const console = { log() {} };
    const _recordViolations = () => {};
    ${src.slice(start, end)}
    return { forAds: _webDevCasesOffForGoogleAds, forChat: _webDevCasesOffDomain, strip: _stripOffDomainWebDevCases };
  `)(CASE_LEDGER);
  // Generation passes the Google Ads gate explicitly — confirm the chain does.
  assert(/_postingTitleDescLower, _webDevCasesOffForGoogleAds\)/.test(src), 'the generate chain calls the strip with the Google Ads gate, on title + description (no skill tags)');
  const gen = (t, p) => strip(t, p, forAds);
  const P = (s) => s.toLowerCase();

  // ── job 16269 ───────────────────────────────────────────────────────────
  const posting16269 = P('Google Ads Specialist for Shopify Brand. Looking for a Google Ads specialist to audit, rebuild, and manage campaigns for our Shopify gift brand that sells premium new-homeowner welcome kits to real estate agents and homeowners.');
  const letter16269 = 'The structure I\'d build: agent-focused campaigns separated from homeowner direct.\n\nRelevant work:\n\nCasa Eleganza (attached in profile highlights): premium furniture Shopify store, custom theme, +41% conversion on filtered pages, +28% AOV.\n\nNectar Flowers (attached in profile highlights): gifting/occasions vertical, -72% cost per conversion, +350% transaction revenue.\n\nArtem';
  assert(forAds(posting16269), 'job 16269: a Google Ads posting for a Shopify brand gets no web-dev cases ("rebuild … campaigns" is not a site build)');
  const out = gen(letter16269, posting16269);
  assert(!/Casa Eleganza/.test(out), 'job 16269: the Casa Eleganza paragraph is removed at generation');
  assert(/Relevant work:\n\nNectar Flowers/.test(out), 'the lead-in stays, because Nectar Flowers still follows it');

  // ── gates ───────────────────────────────────────────────────────────────
  assert(forAds(P('Google Ads Expert to Audit, Rebuild & Manage Our Paid Search (Search, Shopping, PMax).')), 'an account rebuild is not a site build');
  assert(forAds(P('Fix or rebuild tracking in GA4 and Google Ads for our WooCommerce store.')), '"rebuild tracking" is not a site build');
  assert(forAds(P('We need someone to manage $2k/month ad spend with PMax for our OpenCart shop.')), 'PMax / ad spend wording alone marks a Google Ads posting');
  assert(!forAds(P('Build our new Shopify store and set up Google Ads for launch.')), 'a real store build + Google Ads keeps web-dev cases (the build is part of the job)');
  assert(!forAds(P('Looking for a Shopify expert to rebuild my Shopify beauty store and run PPC.')), '"rebuild my Shopify beauty store" is still a build ask');
  const seoPosting = P('SEO Specialist for Shopify E-commerce Store: technical SEO, hreflang for US & European markets.');
  assert(!forAds(seoPosting), 'an SEO posting is left alone at generation (GKit\'s hreflang setup is real SEO proof)');
  assert(forAds(P('SEO Specialist for Shopify E-commerce Store\nShopify, SEO Backlinking, Google Ads\nSummary: SEO for our store.')), '(fed the skill-tag line, the gate WOULD fire — which is why the app passes title + description only)');
  assert(forChat(seoPosting), '…while the chat-rewrite strip keeps its older PPC + SEO scope');
  assert(!forAds(P('Shopify developer needed for theme customization and new sections.')) && !forChat(P('Shopify developer needed for theme customization and new sections.')), 'a pure web-dev posting is never touched');

  // ── strip shapes ────────────────────────────────────────────────────────
  const onlyWebDev = 'Opening.\n\nA relevant build:\n\nSMASH (attached in profile highlights): custom OpenCart theme, +217% monthly revenue.\n\nArtem';
  assert(gen(onlyWebDev, posting16269) === 'Opening.\n\nArtem', 'when the only case goes, its lead-in goes with it');
  const clean = 'Opening.\n\nNectar Flowers (attached in profile highlights): -72% cost per conversion.\n\nArtem';
  assert(gen(clean, posting16269) === clean, 'a letter with no web-dev case comes back identical');

  // ── the corpus ──────────────────────────────────────────────────────────
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const WEBDEV = /\b(?:SMASH|Game-?X|GKit|Casa\s+Eleganza)\b/;
    // The fixture's posting is title \n category \n skill tags \n description; the
    // app's gate reads title + description only, so rebuild exactly that.
    const titleAndDesc = (posting) => {
      const lines = String(posting || '').split('\n');
      const d = lines.findIndex((l, i) => i > 0 && /^Summary/.test(l));
      return [lines[0], ...(d > 0 ? lines.slice(d) : lines.slice(3))].join('\n');
    };
    let withWebDev = 0, genStripped = 0, changedOnBuild = 0;
    for (const r of rows) {
      const t = r.text || '';
      if (!WEBDEV.test(t)) continue;
      withWebDev++;
      const p = P(titleAndDesc(r.posting));
      const o = gen(t, p);
      if (o !== t) { genStripped++; console.log(`      generation strips [${r.status}] ${(r.posting || '').slice(0, 70).replace(/\s+/g, ' ')}`); }
      if (_isBuild(p) && o !== t) changedOnBuild++;
    }
    function _isBuild(p) { return !forAds(p) && !forChat(p); }
    console.log(`\ncorpus: ${withWebDev} sent letters cite a web-dev case; generation would strip it from ${genStripped} (Google Ads postings without a build ask)`);
    assert(changedOnBuild === 0, 'letters for build / web-dev postings are never touched');
  } else {
    console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
