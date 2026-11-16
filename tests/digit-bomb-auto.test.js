// Auto Digit Bomb on a close case match (audit 2026-10-29, T22 rule 1; owner request 2026-11-16).
// Deterministic matcher, no model call. Run: node tests/digit-bomb-auto.test.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const lib = (f) => pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', f)).href;
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

(async () => {
  const M = await import(lib('digitBombMatch.js'));
  const CONFIG = await import(lib('digitBombConfig.js'));
  const { CASE_LEDGER, CASE_BY_ID } = await import(lib('caseLedger.js'));
  const { findAutoBomb, rankCases, jobSignals, jobService, serviceInfo } = M;

  const SKIN = { title: 'Google Ads expert for DTC skincare brand', description_full: 'Shopify store selling serums to US customers. Need Performance Max and Shopping campaigns, GA4 tracking.', client_country: 'United States' };
  const SPA = { title: 'Google Ads manager - wellness spa', description_full: 'Med spa and wellness clinic, aesthetic treatments. Lead gen, bookings. USA. Performance Max.', client_country: 'United States' };
  const SAAS = { title: 'Google Ads for B2B SaaS', description_full: 'We sell software to enterprise teams. Need search campaigns.', client_country: 'United States' };
  const SEO_SKIN = { title: 'SEO specialist for skincare brand', description_full: 'Shopify skincare store, US. Technical SEO and link building.', client_country: 'United States' };

  // ── fires: the matching case, its own ledger numbers ──────────────────────
  const a = findAutoBomb(SKIN);
  assert(a && a.caseId === 'skin-reboot' && a.score >= 90, `a Google Ads job for DTC skincare auto-fires Skin Reboot (score ${a && a.score})`);
  assert(CASE_BY_ID[a.caseId].metrics.includes('+693.8% revenue') && CASE_BY_ID[a.caseId].metrics.includes('17.51 PMax ROAS'), "the numbers come from that case's own ledger record");
  const b = findAutoBomb(SPA);
  assert(b && b.caseId === 'skin-reboot', `a Google Ads job in beauty / wellness auto-fires Skin Reboot (score ${b && b.score})`);

  // ── does not fire ─────────────────────────────────────────────────────────
  assert(findAutoBomb(SAAS) === null, 'Google Ads for B2B SaaS: no auto bomb (no close case)');
  assert(findAutoBomb(SEO_SKIN) === null || CASE_BY_ID[findAutoBomb(SEO_SKIN).caseId].service === 'seo', 'an SEO job never gets a Google Ads case');
  const ppcOnly = CASE_LEDGER.filter(c => c.service === 'ppc');
  assert(findAutoBomb(SEO_SKIN, CONFIG, ppcOnly) === null && rankCases(SEO_SKIN, CONFIG, ppcOnly).length === 0, 'an SEO job with only Google Ads cases available: score 0, no bomb');
  assert(rankCases(SEO_SKIN).every(r => r.service === 'seo'), 'every case ranked for an SEO job is an SEO case');
  const WEB = { title: 'Shopify developer for furniture store', description_full: 'Build a custom Shopify theme with filtering for our US furniture store.', client_country: 'United States' };
  assert(rankCases(WEB).every(r => r.service === 'web-dev'), 'a web-development job is only ever matched to web-dev cases');
  assert(rankCases(SKIN).every(r => r.service === 'ppc') && !rankCases(SKIN).some(r => r.service === 'web-dev'), 'a web-dev case never opens a Google Ads letter');
  const META = { title: 'Meta Ads expert for skincare brand', description_full: 'Facebook and Instagram ads for our Shopify skincare store, US.', client_country: 'United States' };
  assert(jobService(META) === 'meta' && findAutoBomb(META) === null, 'a Meta-only job: no case has that service, so no bomb');
  const BOTH = { title: 'Google Ads and SEO for skincare brand', description_full: 'Shopify skincare store, US.', client_country: 'United States' };
  assert(jobService(BOTH) === null && findAutoBomb(BOTH) === null, 'two services tied in the title: unknown, no bomb');
  assert(findAutoBomb({ title: 'Data entry assistant', description_full: 'Type numbers into a spreadsheet.' }) === null && findAutoBomb({}) === null && findAutoBomb(null) === null, 'no case found / empty job -> null (the normal letter)');
  assert(findAutoBomb(SKIN, CONFIG, []) === null, 'an empty ledger -> null');

  // ── the threshold: exactly 90 fires, 89 does not ───────────────────────────
  const withCfg = (over) => ({ ...CONFIG, AUTO_BOMB: { ...CONFIG.AUTO_BOMB, ...over, WEIGHTS: { ...CONFIG.AUTO_BOMB.WEIGHTS, ...(over.WEIGHTS || {}) } } });
  const spa90 = rankCases(SPA)[0].score;
  assert(spa90 === 90, `the spa job scores exactly 90 with the shipped weights (${spa90})`);
  assert(findAutoBomb(SPA, withCfg({})) !== null, 'score exactly 90 fires');
  assert(findAutoBomb(SPA, withCfg({ WEIGHTS: { platform: 9 } })) === null && rankCases(SPA, withCfg({ WEIGHTS: { platform: 9 } }))[0].score === 89, 'score 89 does not fire');
  assert(findAutoBomb(SPA, withCfg({ AUTO_FIRE_AT: 91 })) === null && findAutoBomb(SPA, withCfg({ AUTO_FIRE_AT: 85 })) !== null, 'the threshold is one tunable number');
  assert(CONFIG.AUTO_BOMB.AUTO_FIRE_AT === 90 && CONFIG.AUTO_BOMB.WEIGHTS.niche === 70 && Object.values(CONFIG.AUTO_BOMB.WEIGHTS).reduce((x, y) => x + y, 0) === 100, 'shipped config: threshold 90, niche 70, weights sum to 100');

  // ── niche carries the weight; a broad niche alone can never fire ───────────
  const BROAD = { title: 'Google Ads for our online store', description_full: 'Shopify store, we sell mugs in the US. Performance Max, Shopping, GA4.', client_country: 'United States' };
  const top = rankCases(BROAD)[0];
  assert(top && top.score < 90 && findAutoBomb(BROAD) === null, `a generic ecommerce job matches only broadly and does not fire (best ${top && top.score})`);
  assert(CASE_LEDGER.every(c => CONFIG.CASE_TAGS[c.id]), 'every ledger case has tags in the config');

  // ── tightening 2026-11-16 (1): the service must be the job's PRIMARY deliverable ──────────────
  const desc = 'Spa and skincare brand selling serums to US customers on Shopify. Performance Max and Shopping, GA4 tracking.'
  const REDESIGN = { title: 'Shopify Prestige Expert – Full Luxury Website Redesign, SEO & Ecommerce Optimisation', description_full: desc, client_country: 'United States' };
  assert(jobService(REDESIGN) === 'web-dev' && findAutoBomb(REDESIGN) === null && rankCases(REDESIGN).every(r => r.service === 'web-dev'), 'a title led by website redesign is a web-dev job: no SEO or Ads case can fire for it');
  const REDESIGN_ADS = { title: 'Website redesign plus Google Ads for skincare brand', description_full: desc, client_country: 'United States' };
  assert(jobService(REDESIGN_ADS) === 'web-dev' && findAutoBomb(REDESIGN_ADS) === null, 'redesign first, Google Ads as an add-on: the Ads case does not fire');
  const DEV_SEO = { title: 'WordPress developer who also knows SEO for a skincare store', description_full: desc, client_country: 'United States' };
  assert(jobService(DEV_SEO) === 'web-dev' && findAutoBomb(DEV_SEO) === null, 'web development first, SEO as an add-on: no SEO case');
  const ADS_FIRST = { title: 'Google Ads manager for skincare brand (site already built, light website fixes)', description_full: desc, client_country: 'United States' };
  assert(jobService(ADS_FIRST) === 'ppc' && findAutoBomb(ADS_FIRST) && findAutoBomb(ADS_FIRST).caseId === 'skin-reboot', 'control: Google Ads first still fires its case');
  assert(jobService({ title: 'SEO audit and website redesign for a spa', description_full: desc }) === 'seo', 'SEO first, redesign as an add-on: the lead is SEO');
  assert(serviceInfo(REDESIGN).reason.includes('leads with web-dev'), 'the reason says which service the title leads with');

  // ── (2): for a Google Ads case, Google Ads must LEAD ──────────────────────────────────────────
  const META_LED = { title: 'Meta, TikTok & Google Ads specialist for skincare brand', description_full: desc, client_country: 'United States' };
  assert(jobService(META_LED) === 'meta' && findAutoBomb(META_LED) === null, 'Meta / TikTok first, Google Ads later: no Google Ads case');
  const PAID_MEDIA = { title: 'Paid Media Specialist: Meta, Google, TikTok and LinkedIn Ads for Lead Gen', description_full: desc, client_country: 'United States' };
  assert(jobService(PAID_MEDIA) === 'meta' && findAutoBomb(PAID_MEDIA) === null, 'a social-ads title with no explicit Google Ads keyword is a meta job');
  const SOCIAL = { title: 'Social media ads manager for a skincare brand', description_full: desc, client_country: 'United States' };
  assert(jobService(SOCIAL) === 'meta' && findAutoBomb(SOCIAL) === null, 'a social-media-led job does not fire');
  const ADS_THEN_META = { title: 'Google Ads and Meta Ads manager for skincare brand', description_full: desc, client_country: 'United States' };
  assert(jobService(ADS_THEN_META) === 'ppc' && findAutoBomb(ADS_THEN_META) && findAutoBomb(ADS_THEN_META).caseId === 'skin-reboot', 'control: Google Ads first, Meta second: the Google Ads case may fire');
  assert(serviceInfo(META_LED).reason.includes('leads with meta'), 'the reason names the leading service');
  assert(jobService({ title: 'Google Ads and SEO for skincare brand', description_full: desc }) === null, 'Google Ads and SEO together stay a tie (unknown)');

  // ── (3): "e-commerce" alone is not a niche match for a health-and-wellness case ──────────────
  const MUGS = { title: 'Google Ads for our online store', description_full: 'Shopify store, we sell mugs in the US. Performance Max, Shopping, GA4.', client_country: 'United States' };
  const skinForMugs = rankCases(MUGS, CONFIG, CASE_LEDGER).find(r => r.caseId === 'skin-reboot');
  assert(!skinForMugs || skinForMugs.parts.niche === 0, 'an e-commerce-only job earns Skin Reboot no niche points');
  const derma = rankCases({ title: 'SEO for our Shopify store', description_full: 'We sell mugs on Shopify, US. Technical SEO, SEO content, ecommerce SEO.' }).find(r => r.caseId === 'derma-solution');
  assert(!derma || derma.parts.niche === 0, 'same for the health-and-wellness SEO case');
  const casaOnWeb = rankCases({ title: 'Shopify developer for our online store', description_full: 'Custom Shopify theme for our US ecommerce store.', client_country: 'United States' }).find(r => r.caseId === 'casa-eleganza');
  assert(casaOnWeb && casaOnWeb.parts.niche === Math.round(CONFIG.AUTO_BOMB.WEIGHTS.niche * CONFIG.AUTO_BOMB.BROAD_NICHE_SHARE), 'a non-wellness case still gets its broad e-commerce credit (the gate is for wellness cases only)');
  const SUPPLEMENTS = { title: 'Google Ads for supplement store', description_full: 'Health supplements, patient-friendly store on Shopify, US. Performance Max.', client_country: 'United States' };
  const skinForSupp = rankCases(SUPPLEMENTS).find(r => r.caseId === 'skin-reboot');
  assert(skinForSupp && skinForSupp.parts.niche > 0 && findAutoBomb(SUPPLEMENTS) === null, 'a real health tag still counts, but only half: it does not reach 90 on its own');
  assert(CONFIG.WELLNESS_GATE.includes('skincare') && CONFIG.WELLNESS_GATE.includes('beauty-wellness') && CONFIG.WELLNESS_GATE.includes('health') && !CONFIG.WELLNESS_GATE.includes('ecommerce'), 'the gate list lives in the config');

  // ── the matcher has no numbers or word lists of its own ────────────────────
  const code = read('frontend', 'src', 'lib', 'digitBombMatch.js').replace(/\/\/.*$/gm, '');
  assert(!/\b(?:70|90|100)\b/.test(code) && /from '\.\/digitBombConfig\.js'/.test(code), 'weights, threshold and tag lists live only in digitBombConfig.js');
  assert(jobSignals({ title: 'x', job_classification_json: JSON.stringify({ service: 'seo' }) }).service === 'seo', 'a stored classification that names a service wins over the keyword rules');
  assert(jobSignals({ title: 'Google Ads', job_classification_json: JSON.stringify({ asks_for_rate: false, is_audit_request: true }) }).service === 'ppc', "today's stored classification has no service: the keyword rules are the fallback");

  // ── wiring in the generator ────────────────────────────────────────────────
  const jd = read('frontend', 'src', 'components', 'JobDetail.jsx');
  assert(/const _autoBomb = \(!_manualBombCase && !autoBombOff\) \? findAutoBomb\(job\) : null/.test(jd) && /const _digitBombCase = _manualBombCase \|\| \(_autoBomb \? CASE_BY_ID\[_autoBomb\.caseId\] : null\)/.test(jd), 'a case picked by hand wins; auto only when none was picked and auto is not switched off');
  assert(/Digit Bomb: auto, case \$\{autoBombPreview\.caseName\}, match \$\{autoBombPreview\.score\}%/.test(jd) && /Turn off for this letter/.test(jd) && /setAutoBombOff\(o => !o\)/.test(jd), 'the note "Digit Bomb: auto, case X, match N%" has a one-click off switch');
  assert(/useEffect\(\(\) => \{ setAutoBombOff\(false\) \}, \[job\?\.id\]\)/.test(jd), 'the off switch is per letter (it comes back for the next job)');
  assert(/_digitBombCase \? \{ case: _digitBombCase\.id, score: _autoBomb \? _autoBomb\.score : null \} : null/.test(jd), 'the generation record gets the case id and the auto score');
  assert(!/findAutoBomb|digitBombMatch/.test(read('frontend', 'src', 'lib', 'letterGuards.js')), 'no model call and no guard depends on the matcher');
  assert(/_digitBombCase\.metrics\.join\(', '\)/.test(jd), "the bomb prompt is built from the case's ledger metrics (unchanged)");

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL  test crashed: ' + (e && e.stack || e)); process.exit(1); });
