// Metro F5 (26 Nov 2026), the front-end rules that can be checked without a browser:
//   3. result lines say only what happened (lib/resultLines.js, the twin of api/metro/lines.py);
//   4. enrich labels are plain, the with / without detail is in the small line;
//   5. one place per message: a finished run's result is told by the header strip only (not the dock, not a notice);
//   2. the fit score has no button of its own (a small Rescore behind More);
//   6. the marks: the badge in the header and as the tab icon, the wagon on the bar and on empty states; the copies inlined by the
//      page are the planning chat's files, byte for byte; every animation is transform / opacity only and stops under reduced motion;
//   7. the Leads page is lighter: rare buttons behind More, long domain trails collapse, Write / Send are plain cards.
// Run: node tests/metro/fix5-ui.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.join(__dirname, '..', '..')
const FE = path.join(ROOT, 'frontend')
const M = path.join(FE, 'src', 'metro')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }
const read = (...p) => fs.readFileSync(path.join(M, ...p), 'utf8')
const imp = (...p) => import(pathToFileURL(path.join(M, ...p)).href)

;(async () => {
  const rl = await imp('lib', 'resultLines.js')

  // ── 3. result lines ──
  assert(rl.part(0, 'lead') === null && rl.part(1, 'lead') === '1 lead' && rl.part(3, 'company', 'companies') === '3 companies', 'part: zero is dropped, singular and plural')
  assert(rl.part(2, 'lead', 'leads', 'kept') === '2 leads kept', 'part: a tail follows the count')
  assert(rl.line('Removed 2 leads', rl.part(0, 'lead', 'leads', 'kept')) === 'Removed 2 leads', 'line: a zero part leaves nothing behind')
  assert(rl.line('Removed 2 leads', rl.part(1, 'lead', 'leads', 'kept')) === 'Removed 2 leads - 1 lead kept', 'line: parts follow the head after a dash')
  assert(rl.join([null, '3 a', '', '1 b']) === '3 a, 1 b', 'join drops empty parts')
  const q = rl.queuedLine({ linkedin_company: 0, ads: 3, ahrefs: 0 }, { ads: 'Ads Transparency page' })
  assert(q === 'Queued for the browser: 3 Ads Transparency pages', `queued line names only what was queued (${q})`)
  assert(/^Nothing new to queue/.test(rl.queuedLine({ a: 0, b: 0 })), 'nothing queued: a plain sentence, no zero list')
  assert(rl.enrichNextLabel(20) === 'Enrich next 20' && rl.enrichNextLabel(50) === 'Enrich next 50', 'the enrich labels are plain')
  // the page builds no string with a "${n} ..." count of its own that can print 0 in the handlers fixed in F5
  const leads = read('components', 'LeadsTab.jsx')
  const enrich = read('components', 'EnrichPanel.jsx')
  assert(!/Looking for the website of/.test(leads) && !/Enriching \$\{r\.total\} companies/.test(leads) && !/Persona rescored for/.test(leads), 'the "I started it" and "I rescored" lines are gone: the strip says it')
  assert(!/Scored fit for \$\{r\.scored\}/.test(enrich) && !/Queued for the browser: \$\{Object\.entries/.test(enrich), 'the old zero-printing lines are gone from the Enrichment card')

  // ── 4. labels and the small line ──
  assert(/const nextLabel = \(n\) => enrichNextLabel\(/.test(leads) && !/· \$\{mix\}/.test(leads), 'Enrich next N: plain label, no "· N with a domain" suffix')
  assert(/tried, not found/.test(leads) && /not tried yet/.test(leads) && !/without`\}\)/.test(leads), '"Retry domain (N tried, not found)" and "N not tried yet"')
  assert(/with a website/.test(leads) && /data-testid="enrich-remaining"/.test(leads), 'the with / without detail is in the small line')

  // ── 5. one place per message ──
  const dock = read('components', 'ProgressDock.jsx')
  assert(/filter\(\(r\) => r\.status === 'running'\)/.test(dock), 'the dock shows only what is running now: a finished result is the header strip\'s')
  const strip = read('components', 'ActivityStrip.jsx')
  assert(/data-testid="strip-result"/.test(strip), 'the strip keeps the result line until dismissed')
  const ui = read('components', 'ui.jsx')
  assert(/noticeFromResult\(v\)/.test(ui) && !/undefined: a result/.test(ui), 'a handler that returns nothing makes no notice (the strip tells it)')
  for (const [name, src, re] of [['enrich start', leads, /return undefined {10}\/\/ a run that started is told by the header strip/], ['retry domains', leads, /r\.started \? undefined : \{ kind: 'warn'/],
    ['hooks', enrich, /r\.started \? undefined : \{ kind: 'warn'/], ['email check', enrich, /r\.started \? undefined : \{ kind: 'warn', text: r\.reason \|\| 'Nothing to check'/]]) {
    assert(re.test(src), `${name}: a run that started says nothing here; a refusal is a warning notice`)
  }
  assert(/return \{ kind: 'warn', text: `Enrich did not start/.test(leads), 'a refusal still shows a notice')
  assert(!/Stop run/.test(enrich) && !/Website, PageSpeed and domains:/.test(enrich) && !/Hooks: \{hk\.done\}/.test(enrich), 'the Enrichment card no longer repeats the run (Stop and the progress line are in the strip)')

  // ── 2. fit score without a button ──
  assert(!/>Score fit \{scope\.n\}/.test(enrich) && /Rescore fit \(\{scope\.n\} \{scope\.what\}\)/.test(enrich), 'there is no "Score fit" button; "Rescore fit" is a small item')
  assert(/<MoreMenu testid="panel-more" align="right">[\s\S]*Rescore fit/.test(enrich), 'Rescore fit waits behind More')
  assert(/after every enrich run and every browser reading/.test(enrich), 'its tooltip says the score is automatic')

  // ── 7. lighter Leads page ──
  assert(/<MoreMenu testid="enrich-more">[\s\S]*data-testid="enrich-btn"[\s\S]*data-testid="retry-domains"[\s\S]*<\/MoreMenu>/.test(leads), '"Enrich all N shown" and "Retry domain" are behind More on the Enrich card')
  assert(/<MoreMenu testid="toolbar-more" align="right">[\s\S]*data-testid="rescore-btn"/.test(leads), '"Rescore persona" is behind More in the table toolbar')
  assert(/<MoreMenu testid="panel-more"/.test(enrich) && /data-testid="deep-btn"/.test(enrich), '"Queue deep readings" is behind More on the Enrichment card')
  assert(/data-testid="browser-jobs"/.test(enrich) && !/queued\.join/.test(enrich), 'the browser-jobs line is one short status (detail in its tooltip)')
  assert(/<details className="mt-trail" data-testid="domain-trail">/.test(leads) && /no website · details/.test(leads), 'a long domain trail is one line with "details"')
  assert(/<Stage n="3" title="Write"[^>]*\/>/.test(leads) && /<Stage n="4" title="Send"[^>]*\/>/.test(leads), 'Write and Send are plain cards (no disabled buttons)')
  assert(/data-testid="hooks-btn"/.test(enrich) && /data-testid="emails-btn"/.test(enrich) && /data-testid="open-import"/.test(leads) && /data-testid="enrich-next-20"/.test(leads), 'what is not moved stays: import, enrich next, hooks, emails')
  assert(/export function MoreMenu/.test(ui) && /e\.key === 'Escape'/.test(ui) && /mousedown/.test(ui), 'More closes on Escape and on a click outside')

  // ── 6. the marks ──
  for (const f of ['metro-badge.svg', 'metro-wagon.svg']) {
    const master = fs.readFileSync(path.join(FE, 'public', f))
    const copy = fs.readFileSync(path.join(M, 'assets', f))
    assert(Buffer.compare(master, copy) === 0, `${f}: the inlined copy is the planning chat's file, byte for byte`)
  }
  assert(fs.existsSync(path.join(FE, 'public', 'metro-wagon-v1.svg')) && !/wagon-v1/.test(read('components', 'Marks.jsx') + read('MetroApp.jsx') + strip), 'metro-wagon-v1.svg is kept for history and nothing uses it')
  const badge = fs.readFileSync(path.join(FE, 'public', 'metro-badge.svg'), 'utf8')
  assert((badge.match(/class="lamp"/g) || []).length === 2, 'the badge has its two headlights (class lamp)')
  const marks = read('components', 'Marks.jsx')
  assert(/\?raw/.test(marks) && /export function Badge/.test(marks) && /export function Wagon/.test(marks) && /export function Empty/.test(marks), 'Marks.jsx: Badge, Wagon, Empty')
  const app = read('MetroApp.jsx')
  assert(/<Badge running=\{anyRunning\}/.test(app) && !/metro-wagon\.svg/.test(app) && /useProgress\(\)\.runs\.some\(\(r\) => r\.status === 'running'\)/.test(app), 'the header shows the badge, whose headlights follow "something runs"')
  assert(/<Wagon width=\{26\} \/>/.test(strip) && /mt-chip-wagon/.test(strip) && /'--p': pct/.test(strip) && /is-roaming/.test(strip), 'the wagon rides the strip\'s bar (follows the percent; roams when there is no total)')
  assert(/<Empty/.test(leads) && /<Empty/.test(enrich) && /<Empty testid="coming-soon">/.test(app) && /<Empty moving>/.test(enrich), 'the wagon sits on empty states and the loading state')
  const css = read('metro.css')
  assert(/\.mt-badge\.is-running \.lamp \{ animation: mt-lamp/.test(css), 'the headlights pulse while something runs')
  // every keyframe added in F5 moves only transform or opacity
  const f5 = css.slice(css.indexOf('marks and motion (F5'))
  const frameBodies = [...f5.matchAll(/@keyframes [\w-]+ \{([^\n]*)\}/g)].map((m) => m[1])
  const used = new Set(frameBodies.flatMap((b) => [...b.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1])))
  assert([...used].every((p) => ['transform', 'opacity'].includes(p)), `the new keyframes animate only transform and opacity (${[...used].join(', ')})`)
  assert(!/transition:[^;]*(width|height|left|top|margin)/.test(f5.replace(/\.mt-chip-fill[^}]*}/g, '')), 'no layout property is transitioned by the new rules')
  const rm = f5.slice(f5.indexOf('@media (prefers-reduced-motion: reduce)'))
  for (const sel of ['.mt-badge.is-running .lamp', '.mt-chip-wagon.is-roaming', '.mt-empty-track.is-moving .mt-wagon', '.mt-switch-thumb', '[data-metro-panel]', '[data-side-panel]']) {
    assert(rm.includes(sel), `under prefers-reduced-motion: ${sel} does not move`)
  }
  assert(/\[data-metro-panel\]:not\(\[hidden\]\) \{ animation: mt-slide-in/.test(css) && /\[data-side-panel="metro"\] \{ animation: mt-slide-in/.test(css), 'tab and side changes slide in')
  const sw = read('SideSwitch.jsx')
  assert(/className="mt-switch-thumb" data-at=\{side\}/.test(sw) && /\.mt-switch-thumb\[data-at="metro"\] \{ transform: translateX\(100%\)/.test(css), 'the switch\'s filled half slides (transform)')

  // favicon: the badge on Metro, the Falcon icons back after
  const fav = await imp('lib', 'favicon.js')
  const mk = (rel, href) => { const el = { rel, href, attrs: { rel, href }, removed: false, setAttribute(k, v) { this.attrs[k] = v }, remove() { this.removed = true; head.items = head.items.filter((x) => x !== this) } }; return el }
  const head = { items: [mk('icon', '/favicon-16.png'), mk('icon', '/favicon-32.png'), mk('apple-touch-icon', '/favicon-128.png')],
    querySelectorAll(sel) { return sel.includes('icon') ? this.items.filter((x) => /icon/.test(x.attrs.rel) && !x.attrs['data-metro-favicon']) : [] },
    querySelector(sel) { return sel.includes('data-metro-favicon') ? this.items.find((x) => x.attrs['data-metro-favicon']) || null : null },
    appendChild(x) { this.items.push(x) } }
  const doc = { head, createElement: () => mk('', '') }
  fav.applyFavicon(doc, 'metro')
  const onMetro = head.items.map((x) => x.attrs.href)
  assert(onMetro.length === 1 && onMetro[0] === '/metro-badge.svg', `on Metro the tab icon is the badge and the Falcon icons are out (${onMetro})`)
  fav.applyFavicon(doc, 'metro')
  assert(head.items.length === 1, 'asking twice adds no second icon')
  fav.applyFavicon(doc, 'falcon')
  assert(head.items.map((x) => x.attrs.href).join() === '/favicon-16.png,/favicon-32.png,/favicon-128.png', 'back on Falcon Scout its own icons return')
  fav.applyFavicon(doc, 'falcon')
  assert(head.items.length === 3, 'and asking twice changes nothing')
  assert(/applyFavicon\(document, side\)/.test(read('SideShell.jsx')), 'SideShell sets the icon from the side')

  // the guard is the only way a check meets a page
  const vite = fs.readFileSync(path.join(FE, 'vite.config.js'), 'utf8')
  assert(/FALCON_BACKEND_URL/.test(vite) && /'\/metro\/': 'http:\/\/localhost:8000'/.test(vite), 'vite.config.js: the proxy target follows FALCON_BACKEND_URL (scratch launcher only); the live default stays')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
