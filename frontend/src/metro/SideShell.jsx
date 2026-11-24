// Holds both sides. The Falcon Scout app (App.jsx) stays mounted while Metro shows, so flipping
// the switch loses nothing (an open job, a half-written letter, filters, scroll) and never
// reloads. Metro mounts on first visit and then stays mounted too.
import { useEffect, useRef, useState } from 'react'
import App from '../App.jsx'
import MetroApp from './MetroApp.jsx'
import SideSwitch from './SideSwitch.jsx'
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

  return (
    <>
      <div data-side-panel="falcon" style={{ display: side === 'falcon' ? 'block' : 'none', height: '100%' }}>
        <App sideSwitch={<SideSwitch side={side} onChange={change} />} />
      </div>
      {metroSeen && (
        <div data-side-panel="metro" style={{ display: side === 'metro' ? 'block' : 'none', height: '100%' }}>
          <MetroApp side={side} onSideChange={change} />
        </div>
      )}
    </>
  )
}
