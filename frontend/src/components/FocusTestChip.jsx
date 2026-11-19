import { useEffect, useState } from 'react'
import { focusTestChipState } from '../lib/focusTestChip'

// Header chip for the SEO/GEO/Google Ads focus test (owner, 2026-11-19..2026-12-03):
// renders only while feed_config.json's focus_test block is active (GET
// /focus-test/status says so — it checks the Kyiv-time window itself, same rule as
// test_week, so this chip disappears on its own once the block expires, no manual
// step). Click opens the existing Hidden tab (every hidden job, focus-hidden ones
// included) so the owner can review and /unhide (rescue) any of them.
export default function FocusTestChip({ onOpen }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/focus-test/status')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (alive) setStatus(d) })
        .catch(() => { if (alive) setStatus(null) })
    load()
    const id = setInterval(load, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const state = focusTestChipState(status)
  if (!state) return null

  return (
    <button
      onClick={onOpen}
      title={state.title}
      data-testid="focus-test-chip"
      style={{
        background: 'rgba(168,85,247,0.12)',
        border: '1px solid rgba(168,85,247,0.45)',
        color: '#c4a3fa',
        borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 700,
        fontFamily: 'Inter, sans-serif', letterSpacing: '0.02em', cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      🎯 {state.label}
    </button>
  )
}
