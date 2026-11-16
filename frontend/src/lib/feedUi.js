// Display preferences from the saved feed config (T12): read once, refreshed when Feed Settings saves.
// Display only: nothing here removes a job from the feed.
import { useEffect, useState } from 'react'

export const FEED_CONFIG_SAVED_EVENT = 'falcon:feed-config-saved'

export function useFeedUi() {
  const [cfg, setCfg] = useState({ dim_applicants_50plus: false })
  useEffect(() => {
    let alive = true
    const load = () => fetch('/feed-config').then(r => r.ok ? r.json() : null).then(c => { if (alive && c) setCfg(c) }).catch(() => {})
    load()
    window.addEventListener(FEED_CONFIG_SAVED_EVENT, load)
    return () => { alive = false; window.removeEventListener(FEED_CONFIG_SAVED_EVENT, load) }
  }, [])
  return cfg
}
