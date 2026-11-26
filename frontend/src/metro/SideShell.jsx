// Holds both sides. The Falcon Scout app (App.jsx) stays mounted while Metro shows, so flipping
// the switch loses nothing (an open job, a half-written letter, filters, scroll) and never
// reloads. Metro mounts on first visit and then stays mounted too.
import { useEffect, useRef, useState } from 'react'
import App from '../App.jsx'
import MetroApp from './MetroApp.jsx'
import SideSwitch from './SideSwitch.jsx'
import ActivityStrip from './components/ActivityStrip.jsx'
import { buildActivities, stripTitlePrefix, tabTitle } from './lib/activity.js'
import { applyFavicon } from './lib/favicon.js'
import { requestGoto } from './lib/nav.js'
import { useProgress } from './lib/progressStore.js'
import { readSide, writeSide, hashForcesFalcon, hashOnSwitch, isSwitchKey, otherSide } from './lib/side.js'

const store = typeof window !== 'undefined' ? window.localStorage : null

export default function SideShell() {
  const [side, setSide] = useState(() => readSide(store, window.location.hash))
  const [metroSeen, setMetroSeen] = useState(side === 'metro')
  const falconHash = useRef(hashForcesFalcon(window.location.hash) ? window.location.hash : '#jobs')

  const change = (next) => {
    const cur = window.location.hash
    if (next === 'metro' && hashForcesFalcon(cur)) falconHash.current = cur
    const target = hashOnSwitch(cur, next, falconHash.current)
    if (target !== cur) history.replaceState(null, '', target)   // no hashchange, App.jsx is not disturbed
    setSide(next)
    writeSide(store, next)
    if (next === 'metro') setMetroSeen(true)
  }

  // Landing on Metro from a remembered choice: make the URL say so, so a reload stays on Metro.
  useEffect(() => { if (side === 'metro' && window.location.hash !== '#metro') change('metro') }, [])

  // The extension deep-links to Falcon Scout views (e.g. #outcomes): show that side.
  useEffect(() => {
    const onHash = () => { if (hashForcesFalcon(window.location.hash)) change('falcon') }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Ctrl+M switches sides (keeps the latest side in a ref so the listener is registered once).
  const sideRef = useRef(side)
  sideRef.current = side
  useEffect(() => {
    const onKey = (e) => {
      if (!isSwitchKey(e)) return
      e.preventDefault()
      change(otherSide(sideRef.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // F4: the activity strip in both headers; a click on a chip opens the Metro screen where it runs (switching sides if needed).
  const goto = (where) => {
    change('metro')
    requestGoto(where || { tab: 'leads' })
  }

  // The tab icon: the badge on the Metro side, the Falcon Scout icons otherwise.
  useEffect(() => { applyFavicon(document, side) }, [side])

  // The browser tab says what runs: "(Enriching 7/20) Metro". Only the prefix is ours; whatever else sets the title (the Falcon
  // Scout new-jobs bell) is left alone and kept after it.
  const { runs, dismissed } = useProgress()
  const running = buildActivities(runs, dismissed).running
  const prefix = tabTitle(running, '')
  // On the Metro side the tab is called "Metro" (Falcon Scout's background "new jobs" bell keeps rewriting the title; a
  // MutationObserver puts ours back). On the Falcon Scout side whatever the app set is kept and only the prefix is added.
  const applied = useRef('')
  useEffect(() => {
    const apply = () => {
      const cur = document.title
      const want = side === 'metro' ? `${prefix}Metro` : prefix + stripTitlePrefix(cur, applied.current)
      applied.current = prefix
      if (cur !== want) document.title = want
    }
    apply()
    const el = document.querySelector('title')
    const mo = el ? new MutationObserver(apply) : null
    mo?.observe(el, { childList: true, characterData: true, subtree: true })
    return () => mo?.disconnect()
  }, [prefix, side])

  return (
    <>
      <div data-side-panel="falcon" style={{ display: side === 'falcon' ? 'block' : 'none', height: '100%' }}>
        <App sideSwitch={<SideSwitch side={side} onChange={change} />} activityStrip={<ActivityStrip onGo={goto} showIdle={false} />} />
      </div>
      {metroSeen && (
        <div data-side-panel="metro" style={{ display: side === 'metro' ? 'block' : 'none', height: '100%' }}>
          <MetroApp side={side} onSideChange={change} activityStrip={<ActivityStrip onGo={goto} />} />
        </div>
      )}
    </>
  )
}
