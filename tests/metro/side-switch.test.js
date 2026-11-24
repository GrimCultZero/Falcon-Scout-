// Falcon Scout | Metro header switch (METRO_PLAN.md Phase 0, step 5).
//   1. The side is remembered between visits; a bad or missing value means Falcon Scout.
//   2. A deep link to a Falcon Scout view (#outcomes etc., used by the extension) shows Falcon Scout.
//   3. Metro has exactly the five plan tabs, in order; the last tab is remembered.
//   4. Wiring: main.jsx renders SideShell; SideShell keeps App mounted (display toggle, no reload,
//      no remount); App.jsx renders the switch it is given and has no other Metro code;
//      MetroApp uses the IT Force colours, Manrope and the wagon mark.
// Run: node tests/metro/side-switch.test.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const SRC = path.join(__dirname, '..', '..', 'frontend', 'src')
let bad = 0
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }

function memStore(init = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }
}

;(async () => {
  const s = await import(pathToFileURL(path.join(SRC, 'metro', 'lib', 'side.js')).href)

  // 1. remembered, with a safe fallback
  assert(s.readSide(memStore(), '') === 'falcon', 'nothing stored -> Falcon Scout')
  const st = memStore()
  s.writeSide(st, 'metro')
  assert(st.getItem(s.SIDE_KEY) === 'metro' && s.readSide(st, '') === 'metro', 'Metro is remembered')
  s.writeSide(st, 'bogus')
  assert(st.getItem(s.SIDE_KEY) === 'metro', 'an unknown side is never written')
  assert(s.readSide(memStore({ [s.SIDE_KEY]: 'garbage' }), '') === 'falcon', 'a garbage value -> Falcon Scout')
  const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert(s.readSide(throwing, '') === 'falcon', 'storage that throws -> Falcon Scout, no crash')
  s.writeSide(throwing, 'metro')
  assert(true, 'writing to storage that throws does not crash')

  // 2. deep links
  for (const h of ['#outcomes', '#jobs', '#kb', '#dashboard', '#settings', 'OUTCOMES']) {
    assert(s.readSide(memStore({ [s.SIDE_KEY]: 'metro' }), h) === 'falcon', `deep link ${h} shows Falcon Scout`)
  }
  assert(s.readSide(memStore({ [s.SIDE_KEY]: 'metro' }), '#something-else') === 'metro', 'other hashes keep the remembered side')
  assert(s.readSide(memStore({ [s.SIDE_KEY]: 'falcon' }), '#metro') === 'metro', '#metro shows Metro')

  // reload stays on the side that was showing: the hash follows the switch
  assert(s.hashOnSwitch('#outcomes', 'metro', '#outcomes') === '#metro', 'to Metro: hash becomes #metro')
  assert(s.hashOnSwitch('#metro', 'falcon', '#outcomes') === '#outcomes', 'back to Falcon Scout: the saved view hash is restored')
  assert(s.hashOnSwitch('#metro', 'falcon', '') === '#jobs', 'back with nothing saved: #jobs')
  assert(s.hashOnSwitch('#kb', 'falcon', '#jobs') === '#kb', 'a Falcon hash is left alone')
  assert(s.readSide(memStore({ [s.SIDE_KEY]: 'metro' }), s.hashOnSwitch('#jobs', 'metro', '#jobs')) === 'metro',
    'reload while on Metro -> Metro (the bug where App.jsx\'s #jobs pulled it back)')
  const shellSrc = fs.readFileSync(path.join(SRC, 'metro', 'SideShell.jsx'), 'utf8')
  assert(/history\.replaceState\(null, '', target\)/.test(shellSrc) && !/location\.hash\s*=/.test(shellSrc),
    'SideShell changes the hash with replaceState only (no hashchange reaches App.jsx)')

  // 3. tabs
  assert(JSON.stringify(s.METRO_TABS.map((t) => t.label)) === JSON.stringify(['Campaigns', 'Leads', 'CRM', 'Senders', 'Settings']),
    'Metro tabs: Campaigns, Leads, CRM, Senders, Settings')
  const ts = memStore()
  assert(s.readMetroTab(ts) === 'campaigns', 'first visit opens Campaigns')
  s.writeMetroTab(ts, 'senders')
  assert(s.readMetroTab(ts) === 'senders', 'the last Metro tab is remembered')
  s.writeMetroTab(ts, 'nope')
  assert(s.readMetroTab(ts) === 'senders', 'an unknown tab is never written')

  // 4. wiring
  const main = fs.readFileSync(path.join(SRC, 'main.jsx'), 'utf8')
  assert(/import SideShell from '\.\/metro\/SideShell\.jsx'/.test(main) && /<SideShell \/>/.test(main), 'main.jsx renders SideShell')
  const shell = fs.readFileSync(path.join(SRC, 'metro', 'SideShell.jsx'), 'utf8')
  assert(/<App sideSwitch=/.test(shell), 'SideShell renders App with the switch')
  assert(!/\{side === 'falcon' && <App/.test(shell) && /display: side === 'falcon' \? 'block' : 'none'/.test(shell),
    'App stays mounted; the switch only toggles display')
  assert(!/location\.reload|window\.location\s*=|location\.href\s*=/.test(shell), 'no page reload on switch')
  const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
  assert(/export default function App\(\{ sideSwitch = null \} = \{\}\)/.test(app) && /\{sideSwitch\}/.test(app), 'App.jsx renders the switch it is given')
  assert(!/import .*metro/i.test(app), 'App.jsx imports nothing from Metro')
  const metro = fs.readFileSync(path.join(SRC, 'metro', 'MetroApp.jsx'), 'utf8') + fs.readFileSync(path.join(SRC, 'metro', 'theme.js'), 'utf8')
  for (const c of ['#000c0e', '#005669', '#37bbd5', '#eaf6f9', '#e6261f']) assert(metro.includes(c), `Metro uses IT Force colour ${c}`)
  assert(/@fontsource\/manrope/.test(metro) && /Manrope/.test(metro), 'Metro uses Manrope, served locally (@fontsource)')
  assert(/metro-wagon\.svg/.test(metro) && fs.existsSync(path.join(SRC, '..', 'public', 'metro-wagon.svg')), 'Metro header shows the wagon mark')
  const jd = fs.readFileSync(path.join(SRC, 'components', 'JobDetail.jsx'), 'utf8')
  assert(!/metro/i.test(jd), 'JobDetail.jsx has no Metro code')

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
})()
