// Two detectors behind false flags on job 16252 (2026-09-25), now in
// frontend/src/lib/letterGuards.js:
//
//   draftAttachesAuditSample — the old inline test only accepted two word orders
//     with singular words, so it missed 85 of the 173 sent letters that attach an
//     audit sample ("I'm attaching recent audit samples", "Attaching a recent
//     technical SEO audit sample"), and missingSeoPlanOffer demanded the SEO plan
//     on top of an audit offer that was already in the letter.
//   caseStudiesCrammed — the old inline test counted METRICS, so one case quoting
//     two figures read as "crammed": 22 of its 26 corpus hits were a single case.
//     It now counts case NAMES per paragraph, which is what its own header said.
//
// The old logic is reproduced verbatim below so the corpus section can show the
// before/after on real letters.
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
  const A = (s) => G.draftAttachesAuditSample(s);
  const C = (s) => G.caseStudiesCrammed(s);

  // ── audit-sample attachment ─────────────────────────────────────────────
  assert(A('Attaching a recent technical SEO audit sample so you can see the format and depth.'), 'job 16252: "Attaching a recent technical SEO audit sample" (attach … audit … sample)');
  assert(A("I'm attaching samples of recent audits so you can see the format and depth."), 'plurals: "attaching samples of recent audits"');
  assert(A('Sample audit attached.'), '"Sample audit attached." (sample … audit … attach)');
  assert(A("I'm attaching a sample of a recent Google Ads audit so you can see the format and depth."), 'the old canonical order still counts');
  assert(!A('Attaching a sample SEO promotion plan so you can see the format.'), 'the SEO plan sample is not an audit sample');
  assert(!A('FridgeFix (attached in profile highlights): started with a full account audit.'), 'a case label plus the word "audit" is not a sample');
  assert(!A('I attach every finding to a ticket. The audit sample below explains it.'), 'the three words must share one sentence');

  // ── case-study cramming ─────────────────────────────────────────────────
  assert(!C('Derma Solution (attached as PDF): YMYL medical aesthetics, +1,861% organic traffic, +14,342% conversions.'), 'job 16252: ONE case with two figures is not crammed');
  assert(C('FridgeFix (attached in profile highlights): -92% cost per conversion. House Painting (attached in profile highlights): 7.3% CTR.'), 'two cases in one paragraph are crammed');
  assert(!C('Here are some relevant results, FridgeFix and House Painting are:\n\nFridgeFix (attached in profile highlights): -92%.\n\nHouse Painting (attached in profile highlights): 7.3% CTR.'), 'a short lead-in label naming the cases that follow is not cramming');
  assert(!C('FridgeFix (attached in profile highlights): -92%.\n\nNectar Flowers (attached in profile highlights): -72%.'), 'one case per paragraph passes');
  assert(C('Atlant and Real Estate Complex aside, Nectar Flowers (attached in profile highlights) cut CPC 67%.'), '"Real Estate Complex" is recognized as Atlant (KB #1\'s header) — Atlant + Nectar Flowers here');
  assert(L.casesMentioned('Real Estate Complex (attached in profile highlights): +56.51% conversions.').join() === 'atlant', 'casesMentioned maps "Real Estate Complex" to atlant');

  // ── the corpus: before vs after ─────────────────────────────────────────
  if (!fs.existsSync(DATA)) {
    try {
      require('child_process').execFileSync('python', [path.join(__dirname, '..', 'tools', 'dump_letters_fixture.py')], { stdio: 'inherit' });
    } catch (e) {
      console.log('SKIP  corpus section — no corpus (run: python tools/dump_letters_fixture.py; it needs upwork_jobs.db)');
    }
  }
  if (fs.existsSync(DATA)) {
    const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const oldAttach = (t) => /\battach(?:ing|ed)?\b[^.]{0,60}\bsample\b[^.]{0,80}\baudit\b/i.test(t) || /\baudit\b[^.]{0,60}\bsample\b[^.]{0,60}\battach/i.test(t);
    const metricRe = /\d+(?:[.,]\d+)?(?:\s*%|\s*×|\s*roas\b|\s*k\/month|\s*k\s+(?:month|revenue))/gi;
    const oldCrammed = (t) => { const mm = [...t.matchAll(metricRe)]; return mm.length >= 2 && !t.slice(mm[0].index, mm[mm.length - 1].index).includes('\n\n'); };
    let oa = 0, na = 0, lostA = 0, oc = 0, nc = 0;
    for (const r of rows) {
      const t = r.text || '';
      const o = oldAttach(t), n = A(t);
      if (o) oa++; if (n) na++; if (o && !n) lostA++;
      if (oldCrammed(t)) oc++; if (C(t)) nc++;
    }
    console.log(`\ncorpus: audit-sample attached — old ${oa}, new ${na}; crammed — old ${oc}, new ${nc}`);
    assert(lostA === 0, `the new attachment detector finds every letter the old one did (lost ${lostA})`);
    assert(na >= 165, `and the ones it missed: ${na} of ${rows.length} letters attach an audit sample (173 on 2026-09-25; old detector ${oa})`);
    assert(nc <= 12, `cramming flags stay rare and real (${nc}; 8 on 2026-09-25, down from ${oc} metric-count hits)`);
  }

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL  test crashed:', e && e.stack || e); process.exit(1); });
