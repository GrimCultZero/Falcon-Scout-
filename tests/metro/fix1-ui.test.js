// Metro fixes F1 (25 Nov 2026), the front-end and extension rules that can be checked without a browser
// (the same screens were also driven in a real browser against a copy of the live database; see WORKLOG.md):
//   4. the Leads tab reads the campaign list again whenever it is shown and after any campaign change;
//   5. "what you see runs": every card action resolves its rows in ONE place (ticked, else every row the
//      filters show, asked from the backend), sends them explicitly, and never falls back to the campaign;
//   6. "Enrich next 20 / 50" take the best-scored not-yet-enriched rows of the current filter and sort;
//   7. the empty Leads page has a Create campaign button;
//   8. the header legend is a filter (click one line, click again for both) used by Campaigns and Leads;
//   9. New campaign asks agency or niche; the agency template is the brief Oleh wrote, word for word;
//      niche campaigns have a Draft the brief button that only fills the form;
//   3. deleting a draft campaign and removing ticked leads both go through a confirm that shows counts;
//  10. the extension refuses LinkedIn jobs in a Linked Helper week and nothing else, and asks the backend
//      only for the kinds it may run.
// Run: node tests/metro/fix1-ui.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'frontend', 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8')

;(async () => {
  const app = read('MetroApp.jsx')
  const leads = read('components', 'LeadsTab.jsx')
  const camps = read('components', 'CampaignsTab.jsx')
  const enrich = read('components', 'EnrichPanel.jsx')

  // 4
  assert(/useEffect\(\(\) => \{ if \(active\) loadCampaigns\(\) \}, \[active, rev, loadCampaigns\]\)/.test(leads),
    '4: the Leads tab reloads the campaign list whenever it is shown and when the campaign list changed')
  assert(/active=\{tab === 'leads'\}/.test(app) && /rev=\{campaignsRev\}/.test(app) && /onChanged=\{campaignsChanged\}/.test(app),
    '4: MetroApp tells Leads when it is shown and when Campaigns changed something')
  assert(/const changed = async \(\) => \{ await load\(\); onChanged\?\.\(\) \}/.test(camps) && /onCreated=\{async \(c\) => \{ setCreating\(false\); await changed\(\)/.test(camps),
    '4: creating, deleting or editing a campaign announces the change')

  // 5
  assert(/const targetIds = useCallback\(async \(\) => \{\s*if \(ticked\.size\) return \[\.\.\.ticked\]\s*const r = await api\(`\/leads\/ids\?\$\{filterParams\(\)\}`\)\s*return r\.ids/.test(leads),
    '5: one resolver: ticked ids, else every id the filters show (asked from the backend)')
  assert(!/ticked\.size \? \[\.\.\.ticked\] : null/.test(leads),
    '5: Enrich no longer sends "no ids" (= the whole campaign) when nothing is ticked')
  assert(/const ids = await targetIds\(\)/.test(leads) && /await runEnrich\(ids\)/.test(leads) && /if \(!ids\.length\) \{ setNote\('Nothing to enrich in this view'\); return \}/.test(leads),
    '5: Enrich runs on the resolved ids, and on nothing when the view is empty')
  assert(/targetIds=\{targetIds\}/.test(leads) && !/json: \{\} \}/.test(enrich) && (enrich.match(/lead_ids: ids/g) || []).length >= 3,
    '5: Score, queue-deep and hooks go through the same resolved ids')
  assert(/shortlist_only: !ticked/.test(enrich), '5: hooks on rows merely shown are limited to the shortlisted; ticked rows are the person\'s own choice')
  assert(/json: \{ lead_ids: ids \} \}\)\s*\n\s*setNote\(`Rescored/.test(leads) || /rescore`, \{ method: 'POST', json: \{ lead_ids: ids \}/.test(leads), '5: Rescore is scoped too')
  assert(/if \(!ids\.length\) \{ setNote\('No leads shown, nothing to do'\); return \}/.test(enrich), '5: an empty view runs nothing, with a note')

  // 6
  assert(/enrichNext\(20\)/.test(leads) && /enrichNext\(50\)/.test(leads) && /Enrich next \$\{Math\.min\(20, remaining\)\}/.test(leads) && /Enrich next \$\{Math\.min\(50, remaining\)\}/.test(leads), '6: "Enrich next 20" and "Enrich next 50" buttons (F2: next 20 is the primary one)')
  assert(/p\.set\('status', 'new'\); p\.set\('enriched', 'no'\); p\.set\('keep_first', 'true'\); p\.set\('sort', f\.sort\); p\.set\('limit', n\)/.test(leads),
    '6: the batch is the best of the current filter and sort, usable, not enriched yet, persona keep first')
  assert(/not enriched yet in this view/.test(leads) && /data-testid="enrich-remaining"/.test(leads), '6: it shows how many remain')
  assert(/wasRunning\.current && !running\) onChanged\?\.\(\)/.test(enrich), '6: the counts are read again when a run ends')

  // 7
  assert(/data-testid="create-campaign"/.test(leads) && /onClick=\{\(\) => onCreateCampaign\?\.\(\)\}/.test(leads) && /Create campaign/.test(leads),
    '7: the empty Leads page has a Create campaign button')
  assert(/const createCampaign = \(\) => \{ setWantNew\(true\); pick\('campaigns'\) \}/.test(app) && /if \(startNew\) \{ setCreating\('choose'\)/.test(camps),
    '7: it opens the new-campaign chooser in the Campaigns tab')

  // 8
  assert(/aria-pressed=\{!!on\}/.test(app) && /toggleLine = \(k\) => setLine\(\(cur\) => \(cur === k \? null : k\)\)/.test(app),
    '8: the legend items are toggle buttons; the active one is aria-pressed, clicking it again shows both')
  assert(/line=\{line\}/.test(app) && /filter\(\(c\) => !line \|\| c\.type === line\)/.test(camps) && /campaigns\.filter\(\(c\) => !line \|\| c\.type === line\)/.test(leads),
    '8: Campaigns and Leads show only the chosen line')
  assert(/border: `1px solid \$\{on \? METRO\.cyan/.test(app) && /fontWeight: on \? 800 : 600/.test(app), '8: the active line is visibly selected')

  // 9
  assert(/data-testid=\{`choose-\$\{type\}`\}/.test(camps) && /which line\?/.test(camps), '9: New campaign asks agency or niche first')
  const tpl = await import(pathToFileURL(path.join(SRC, 'lib', 'templates.js')).href)
  const A = tpl.AGENCY_TEMPLATE
  assert(A.who === 'Owners, founders and managing partners of small digital marketing agencies (1-50 people) that sell Google Ads, SEO or web services to their own clients.',
    '9: agency template, Who: word for word')
  assert(JSON.stringify(A.pains) === JSON.stringify([
    'They sell more Google Ads and SEO work than their team can deliver',
    'A client needs deeper technical SEO or Google Ads expertise than they have in-house',
    'Hiring senior PPC or SEO specialists is slow and expensive',
    'They need reliable white-label delivery that never contacts their client']), '9: agency template, the four pains')
  assert(JSON.stringify(A.do_not_claim) === JSON.stringify([
    'Top 3% of Google Partners', 'Any number of years other than "since 2015"', 'Guaranteed results or rankings',
    'Client names without permission', 'Prices or rates']), '9: agency template, Do not claim')
  assert(A.offer === "Send us one client you're struggling to deliver for and we'll scope it, or start with a free pilot audit, delivered under your brand.",
    '9: agency template, Offer')
  assert(tpl.templateFor('agency') === A && tpl.templateFor('niche').who === '' && tpl.templateFor('niche').do_not_claim.length === 5, '9: a niche campaign starts empty but keeps the standing do-not-claim list')
  assert(/data-testid="draft-brief"/.test(camps) && /Draft the brief/.test(camps) && /\/campaigns\/draft-brief/.test(camps), '9: niche campaigns have a Draft the brief button')
  assert(/Nothing is saved until you press Create/.test(camps) && !/draft-brief[^]{0,200}method: 'PATCH'/.test(camps), '9: drafting only fills the form')

  // 3
  assert(/delete-preview/.test(camps) && /data-testid="delete-dialog"/.test(camps) && /\{del\.leads\}/.test(camps) && /\{del\.imports\}/.test(camps),
    '3: Delete campaign shows a confirm with the lead and import counts')
  assert(/c\.status === 'draft' && <Btn[^>]*data-testid="delete-campaign"/.test(camps), '3: only a draft campaign shows the delete button')
  assert(/method: 'DELETE'/.test(camps), '3: the delete is sent only from the confirm button')
  assert(/data-testid="remove-dialog"/.test(leads) && /leads\/remove/.test(leads) && /Remove \{ticked\.size\} lead/.test(leads), '3: ticked leads are removed after a confirm that shows the count')

  // 10 (extension)
  const L = require(path.join(ROOT, 'metro-linkedin', 'limits.js'))
  const li = { kind: 'linkedin_profile', target: 'https://www.linkedin.com/in/ann-acme' }
  assert(/Linked Helper week/.test(L.refuse(li, { week_mode: 'linked_helper', visits_today: 0, cap: 60 })), '10: a LinkedIn profile job is refused in a Linked Helper week')
  assert(/Linked Helper week/.test(L.refuse({ kind: 'linkedin_company', target: 'https://www.linkedin.com/company/acme/' }, { week_mode: 'linked_helper' })), '10: a LinkedIn company job is refused too')
  for (const j of [{ kind: 'ads_transparency', target: 'acme.example' }, { kind: 'gbp', target: 'Acme Dental Springfield' }, { kind: 'ahrefs', target: 'acme.example' }]) {
    assert(L.refuse(j, { week_mode: 'linked_helper', visits_today: 0, cap: 60 }) === null, `10: a ${j.kind} job still runs in a Linked Helper week`)
  }
  const bg = fs.readFileSync(path.join(ROOT, 'metro-linkedin', 'background.js'), 'utf8')
  assert(/const lhWeek = wk\.body\.week_mode !== 'metro'/.test(bg) && /JOB_KINDS\.filter\(\(k\) => !L\(\)\.LINKEDIN_KINDS\.includes\(k\)\)/.test(bg),
    '10: in a Linked Helper week the extension asks the backend only for jobs that never touch LinkedIn')
  assert(!/nothing is scraped/.test(bg), '10: the extension no longer stops dead in a Linked Helper week')
  const plan = fs.readFileSync(path.join(ROOT, 'METRO_PLAN.md'), 'utf8')
  assert(/no LinkedIn job/i.test(plan) && !/no extension job at all/.test(plan), '10: METRO_PLAN.md says what a Linked Helper week blocks now')

  console.log(bad ? `${bad} FAILED` : 'all passed')
  process.exit(bad ? 1 : 0)
})()
