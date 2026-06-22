import { useCallback, useEffect, useRef, useState } from 'react'
import Dashboard from './components/Dashboard'
import JobDetail from './components/JobDetail'
import JobList from './components/JobList'
import KnowledgeBase from './components/KnowledgeBase'
import Outcomes from './components/Outcomes'
import FeedSettings from './components/FeedSettings'

// ── Build-time debug: ring buffer of console errors/warnings + uncaught errors.
// The "🐛 Debug" button ships this to share-with-claude.md so Claude Code can
// see what went wrong without a screenshot. Installed once (HMR-guarded).
const _errLog = []
if (typeof window !== 'undefined' && !window.__falconErrHook) {
  window.__falconErrHook = true
  const fmt = (a) => a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x) } catch { return String(x) } }).join(' ').slice(0, 300)
  const push = (s) => { _errLog.push(`${new Date().toLocaleTimeString()} ${s}`); if (_errLog.length > 60) _errLog.shift() }
  const oErr = console.error.bind(console), oWarn = console.warn.bind(console)
  console.error = (...a) => { push('ERROR: ' + fmt(a)); oErr(...a) }
  console.warn = (...a) => { push('WARN: ' + fmt(a)); oWarn(...a) }
  window.addEventListener('error', e => push('UNCAUGHT: ' + (e.message || e.error || '')))
  window.addEventListener('unhandledrejection', e => push('PROMISE: ' + ((e.reason && e.reason.message) || e.reason || '')))
  window.__falconErrLog = _errLog
}

export default function App() {
  // Top-level view: 'jobs' | 'outcomes' | 'kb' | 'chat'
  // See DESIGN.md sections 5, 8 (Phases 2, 2.5, 5), 12.

  // Read initial view from URL hash so the extension can deep-link us (#outcomes, #jobs, #kb)
  const viewFromHash = () => {
    const h = (window.location.hash || '').replace(/^#/, '').toLowerCase()
    if (h === 'outcomes' || h === 'jobs' || h === 'kb' || h === 'dashboard') return h
    return 'jobs'
  }
  const [view, setView] = useState(viewFromHash)
  const [kbRefresh, setKbRefresh] = useState(0)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('falconDark') === '1')

  // New-activity dot on the Outcomes nav tab. Two independent triggers so a
  // change can never be missed:
  //   1. LIVE — the cockpit:status:synced event (instant, but only fires if
  //      this tab is open the moment a sync completes).
  //   2. POLL — every 60s ask the backend for status changes since the last
  //      time the user had Outcomes open ("seen" timestamp). Catches syncs
  //      that ran while the dashboard was closed, hourly auto-syncs, manual
  //      DB edits — anything. The DB is the source of truth, not the event.
  const [outcomeActivity, setOutcomeActivity] = useState(() => localStorage.getItem('falconOutcomeActivity') === '1')
  useEffect(() => { localStorage.setItem('falconOutcomeActivity', outcomeActivity ? '1' : '0') }, [outcomeActivity])
  const _markOutcomesSeen = () => { try { localStorage.setItem('falconOutcomesSeenAt', new Date().toISOString()) } catch {} }
  useEffect(() => {
    const onSynced = (e) => {
      const d = e.detail || {}
      if ((d.newly_replied || 0) > 0 || (d.newly_viewed || 0) > 0) setOutcomeActivity(true)
    }
    window.addEventListener('cockpit:status:synced', onSynced)
    return () => window.removeEventListener('cockpit:status:synced', onSynced)
  }, [])
  // Entering Outcomes = "seen": stamp the timestamp on enter AND on leave
  // (so changes that landed while you were reading don't re-light the dot).
  useEffect(() => {
    if (view !== 'outcomes') return
    setOutcomeActivity(false)
    _markOutcomesSeen()
    return () => { _markOutcomesSeen(); setOutcomeActivity(false) }
  }, [view])
  // The poll. Also re-broadcasts as a synthetic synced event (flagged
  // _from_poll) so the filter-chip dots inside Outcomes light up too.
  useEffect(() => {
    let stop = false
    const check = async () => {
      try {
        const since = localStorage.getItem('falconOutcomesSeenAt')
          || new Date(Date.now() - 7 * 24 * 3600e3).toISOString()
        const res = await fetch('/outcomes-activity?since=' + encodeURIComponent(since))
        if (!res.ok || stop) return
        const d = await res.json()
        if ((d.total || 0) > 0) {
          setOutcomeActivity(true)
          window.dispatchEvent(new CustomEvent('cockpit:status:synced', { detail: {
            _from_poll: true,
            newly_viewed: (d.counts && d.counts.viewed) || 0,
            newly_replied: ((d.counts && d.counts.replied) || 0)
              + ((d.counts && d.counts.interviewing) || 0)
              + ((d.counts && d.counts.hired) || 0),
          }}))
        }
      } catch {}
    }
    check()
    const id = setInterval(check, 60000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  // Listen for hash changes (Chrome extension may re-point an already-open dashboard tab to #outcomes)
  useEffect(() => {
    const onHash = () => {
      const next = viewFromHash()
      setView(prev => prev === next ? prev : next)
      if (next === 'kb') setKbRefresh(v => v + 1)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Keep the hash in sync when the user clicks a tab — so reload / extension-jump stays consistent
  useEffect(() => {
    const target = '#' + view
    if (window.location.hash !== target) {
      // replaceState to avoid polluting browser history
      history.replaceState(null, '', target)
    }
  }, [view])

  useEffect(() => {
    document.documentElement.classList.toggle('dark-mode', darkMode)
    localStorage.setItem('falconDark', darkMode ? '1' : '0')
  }, [darkMode])

  // Intro splash — fires on every page load. Cold launch (first time this browser
  // session) gets the full 2 s reveal; subsequent reloads within the same session
  // get a quick 1 s flash so refreshes don't feel sluggish. The `falconSplashSeen`
  // flag in sessionStorage is what distinguishes the two; it clears when the tab
  // closes, so the next browser launch is "cold" again.
  const [showSplash, setShowSplash] = useState(true)
  const [splashReady, setSplashReady] = useState(false)
  const isReload = (typeof sessionStorage !== 'undefined') && !!sessionStorage.getItem('falconSplashSeen')
  const SPLASH_DURATION_MS = isReload ? 1050 : 2050

  useEffect(() => {
    if (!showSplash) return
    try { sessionStorage.setItem('falconSplashSeen', '1') } catch {}

    let dismissTimer
    const img = new Image()
    img.src = '/falcon-scout-mark5.png'
    const start = () => {
      // Two RAFs guarantees the browser has committed the initial paint before we animate
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setSplashReady(true)
        dismissTimer = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS)
      }))
    }
    if (img.decode) img.decode().then(start).catch(start)
    else if (img.complete) start()
    else img.onload = start

    return () => clearTimeout(dismissTimer)
  }, [showSplash, SPLASH_DURATION_MS])

  // Persisted dashboard state — filter, search query, and the currently selected
  // job survive page reloads via localStorage. Lazy useState initializers read
  // from storage once on mount; a single save effect mirrors any change back.
  const _loadDashState = () => {
    try { return JSON.parse(localStorage.getItem('falconscout.dashState') || '{}') }
    catch { return {} }
  }
  const _restored = _loadDashState()

  const [jobs, setJobs] = useState([])
  const [selectedId, setSelectedId] = useState(() => _restored.selectedId ?? null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [query, setQuery] = useState(() => _restored.query ?? '')
  const [filter, setFilter] = useState(() => _restored.filter ?? 'all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Feed source toggle: 'all' | 'bot' | 'api'. Persisted. Read via a ref inside
  // fetchJobs so we don't re-plumb every call site / fight stale closures.
  const [feedSource, setFeedSource] = useState(() => localStorage.getItem('falconFeedSource') || 'all')
  const feedSourceRef = useRef(feedSource)
  useEffect(() => { feedSourceRef.current = feedSource; localStorage.setItem('falconFeedSource', feedSource) }, [feedSource])
  const [apiFetching, setApiFetching] = useState(false)
  const [apiFetchMsg, setApiFetchMsg] = useState('')
  const [feedSettingsOpen, setFeedSettingsOpen] = useState(false)

  // Feed column width — persisted in localStorage
  const [feedWidth, setFeedWidth] = useState(() =>
    parseInt(localStorage.getItem('falconFeedWidth') || '220', 10)
  )
  const feedDragging = useRef(false)
  const feedAsideRef = useRef(null)

  // Back-to-top button for the feed list
  const feedListRef = useRef(null)
  const [feedScrolled, setFeedScrolled] = useState(false)
  useEffect(() => {
    const el = feedListRef.current
    if (!el) return
    const onScroll = () => setFeedScrolled(el.scrollTop > 150)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // ── Tab-flash notification for new jobs ──────────────────────────────────
  // When a new job arrives while the tab is in the background:
  //   • Title alternates between "🔔 N new – Falcon Scout" and the original
  //   • Favicon swaps to a bright teal badge with the count
  // Both revert immediately when the user switches back to the tab.
  const prevJobIdsRef    = useRef(null)   // null = first load, skip notification
  const newJobCountRef   = useRef(0)
  const flashIntervalRef = useRef(null)
  const origTitleRef     = useRef(document.title)

  const stopFlash = useCallback(() => {
    if (!flashIntervalRef.current) return
    clearInterval(flashIntervalRef.current)
    flashIntervalRef.current = null
    document.title = origTitleRef.current
    newJobCountRef.current = 0
    // Restore original favicon
    const link = document.querySelector("link[rel~='icon']")
    if (link && link._origHref) { link.href = link._origHref; delete link._origHref }
  }, [])

  const startFlash = useCallback((count) => {
    // Grab / create the favicon <link> and stash the original href
    let link = document.querySelector("link[rel~='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    if (!link._origHref) link._origHref = link.href || ''

    // Draw a bright teal badge favicon via canvas
    const canvas = document.createElement('canvas')
    canvas.width = 32; canvas.height = 32
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.src = '/falcon-scout-mark5.png'
    const draw = () => {
      ctx.clearRect(0, 0, 32, 32)
      try { ctx.drawImage(img, 0, 0, 32, 32) } catch {}
      // Bright teal badge circle
      ctx.beginPath()
      ctx.arc(24, 8, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#00ffaa'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      // Count digit
      const label = count > 9 ? '9+' : String(count)
      ctx.fillStyle = '#003322'
      ctx.font = `bold ${count > 9 ? 7 : 9}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 24, 8)
      link.href = canvas.toDataURL('image/png')
    }
    if (img.complete) draw(); else { img.onload = draw; img.onerror = draw }

    // Title flash (only start once per notification burst)
    if (flashIntervalRef.current) {
      // Already flashing — just update the title with the fresh count
      document.title = `🔔 ${count} new – Falcon Scout`
      return
    }
    let alt = true
    document.title = `🔔 ${count} new – Falcon Scout`
    flashIntervalRef.current = setInterval(() => {
      alt = !alt
      document.title = alt ? `🔔 ${newJobCountRef.current} new – Falcon Scout` : origTitleRef.current
    }, 900)
  }, [])

  // Stop flashing the moment the user focuses / reveals the tab
  useEffect(() => {
    const onFocus   = () => stopFlash()
    const onVisible = () => { if (document.visibilityState === 'visible') stopFlash() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      stopFlash()
    }
  }, [stopFlash])

  // Diff job IDs on every jobs update — notify only when tab is backgrounded
  useEffect(() => {
    const currentIds = new Set(jobs.map(j => j.id))
    if (prevJobIdsRef.current === null) {
      // First load — just seed the known-IDs set, never notify
      prevJobIdsRef.current = currentIds
      return
    }
    const arrivals = jobs.filter(j => !prevJobIdsRef.current.has(j.id))
    prevJobIdsRef.current = currentIds
    if (arrivals.length === 0) return
    newJobCountRef.current += arrivals.length
    if (document.hidden || !document.hasFocus()) {
      startFlash(newJobCountRef.current)
    }
  }, [jobs, startFlash])

  // Mirror filter / query / selectedId back to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem('falconscout.dashState', JSON.stringify({ filter, query, selectedId }))
    } catch {}
  }, [filter, query, selectedId])

  const fetchJobs = useCallback(async (q, f) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (f && f !== 'all') params.set('filter_type', f)
      const src = feedSourceRef.current
      if (src && src !== 'all') params.set('source', src)
      const res = await fetch('/jobs?' + params.toString())
      if (!res.ok) throw new Error('API error ' + res.status)
      const data = await res.json()
      setJobs(data)
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  // Fetch full job detail (with latest enrichment) whenever selection changes
  const fetchSelectedJob = useCallback(async (id) => {
    if (!id) { setSelectedJob(null); return }
    try {
      const res = await fetch(`/jobs/${id}`)
      // 404 = the job we restored from localStorage no longer exists.
      // Clear both the selection and the stale persisted state.
      if (res.status === 404) {
        setSelectedId(null)
        setSelectedJob(null)
        return
      }
      if (!res.ok) return
      setSelectedJob(await res.json())
    } catch {}
  }, [])

  useEffect(() => { fetchJobs(query, filter) }, [query, filter])
  // Refetch when the feed source toggle changes (ref is already updated above).
  useEffect(() => { fetchJobs(query, filter) }, [feedSource])  // eslint-disable-line react-hooks/exhaustive-deps

  // Pull fresh jobs from the Upwork API on demand.
  const fetchApiJobs = useCallback(async () => {
    setApiFetching(true)
    setApiFetchMsg('')
    try {
      const res = await fetch('/api-fetch', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || ('API ' + res.status))
      setApiFetchMsg(`+${data.inserted} new · ${data.kept} kept / ${data.dropped} filtered`)
      fetchJobs(query, filter)
    } catch (e) {
      setApiFetchMsg('✗ ' + (e.message.includes('not connected') ? 'connect at /upwork/connect' : e.message))
    } finally {
      setApiFetching(false)
      setTimeout(() => setApiFetchMsg(''), 6000)
    }
  }, [query, filter, fetchJobs])

  // Ship the live frontend state to share-with-claude.md (instead of a screenshot).
  const [debugMsg, setDebugMsg] = useState('')
  const shareDebug = useCallback(async () => {
    const rows = jobs.slice(0, 30).map(j => ({
      source: j.source,
      title: j.title,
      rate: j.hourly_rate_min ? `$${j.hourly_rate_min}-${j.hourly_rate_max}/hr` : (j.fixed_budget || ''),
      country: j.client_country,
      enriched: j.source === 'api'
        ? !!j.enriched_at
        : !!(j.enriched_at || j.connects_required || j.proposals || j.hire_rate),
      proposals: j.proposals,
      verdict: j.last_analysis ? `${j.last_analysis.verdict}/${j.last_analysis.score}` : null,
    }))
    try {
      const res = await fetch('/share-with-claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'debug',
          context: { view, feedSource, filter, query, jobCount: jobs.length, selectedId },
          jobs: rows,
          errors: (window.__falconErrLog || []).slice(-40),
        }),
      })
      setDebugMsg(res.ok ? '✓ shared' : '✗ failed')
    } catch { setDebugMsg('✗ failed') }
    setTimeout(() => setDebugMsg(''), 4000)
  }, [jobs, view, feedSource, filter, query, selectedId])

  // Poll job list every 10 s; also refresh selected job detail
  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs(query, filter)
      if (selectedId) fetchSelectedJob(selectedId)
    }, 10000)
    return () => clearInterval(interval)
  }, [query, filter, selectedId, fetchJobs, fetchSelectedJob])

  // Re-fetch detail immediately on selection change
  useEffect(() => { fetchSelectedJob(selectedId) }, [selectedId, fetchSelectedJob])

  // Enrich-aware rapid refresh.
  //
  // Two-layer approach so the feed badge updates immediately regardless of
  // whether the background→bridge→page event chain is working:
  //
  //  Layer 1 — cockpit:enrich (the button click itself, always fires in this
  //    window): start polling every 1.5 s for up to 30 s. This is the reliable
  //    path — it doesn't depend on the extension's message pipeline.
  //
  //  Layer 2 — cockpit:enrich:complete (extension → bridge → page): fire one
  //    extra refresh and stop the rapid poll early if it's still running.
  //    Falls back silently when the event chain is broken.
  useEffect(() => {
    let rapidPoll = null
    let pollCount = 0
    const MAX_POLLS = 20   // 20 × 1.5 s = 30 s max

    const stopPoll = () => {
      if (rapidPoll) { clearInterval(rapidPoll); rapidPoll = null; pollCount = 0 }
    }

    const startPoll = () => {
      stopPoll()  // clear any previous run
      pollCount = 0
      rapidPoll = setInterval(() => {
        pollCount++
        fetchJobs(query, filter)
        if (selectedId) fetchSelectedJob(selectedId)
        if (pollCount >= MAX_POLLS) stopPoll()
      }, 1500)
    }

    const onComplete = () => {
      stopPoll()
      // One final refresh to make sure we have the latest data
      fetchJobs(query, filter)
      if (selectedId) fetchSelectedJob(selectedId)
    }

    window.addEventListener('cockpit:enrich', startPoll)
    window.addEventListener('cockpit:enrich:complete', onComplete)
    window.addEventListener('cockpit:enrich:error', stopPoll)

    return () => {
      stopPoll()
      window.removeEventListener('cockpit:enrich', startPoll)
      window.removeEventListener('cockpit:enrich:complete', onComplete)
      window.removeEventListener('cockpit:enrich:error', stopPoll)
    }
  }, [selectedId, query, filter, fetchSelectedJob, fetchJobs])

  // Feed column drag-to-resize.
  // During the drag we mutate the DOM directly (zero React re-renders → no stutter).
  // React state + localStorage are updated once on mouseup.
  const onFeedDragStart = useCallback((e) => {
    e.preventDefault()
    feedDragging.current = true
    const startX = e.clientX
    const startW = feedAsideRef.current ? feedAsideRef.current.offsetWidth : feedWidth
    const onMove = (ev) => {
      if (!feedDragging.current) return
      const newW = Math.max(160, Math.min(480, startW + ev.clientX - startX))
      if (feedAsideRef.current) feedAsideRef.current.style.width = newW + 'px'
    }
    const onUp = () => {
      feedDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      // Sync React state and persist only once, after drag ends
      const finalW = feedAsideRef.current
        ? parseInt(feedAsideRef.current.style.width, 10) || feedWidth
        : feedWidth
      setFeedWidth(finalW)
      localStorage.setItem('falconFeedWidth', String(finalW))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [feedWidth])

  const filters = [
    { key: 'all',         label: 'All' },
    { key: 'today',       label: 'Today' },
    { key: 'high_budget', label: '>$30/hr' },
    { key: 'no_us_only',  label: 'No US-only' },
    { key: 'enriched',    label: 'Enriched' },
    { key: 'hidden',      label: 'Hidden' },
  ]

  // Hide / unhide a job — used by the × button on JobList cards
  const toggleHidden = useCallback(async (jobId, currentlyHidden) => {
    try {
      const res = await fetch(`/jobs/${jobId}/${currentlyHidden ? 'unhide' : 'hide'}`, { method: 'POST' })
      if (!res.ok) return
      // Optimistic: drop the job from the current list (it'll no longer match
      // the active filter unless we're in the Hidden view)
      setJobs(prev => prev.filter(j => j.id !== jobId))
      // If the hidden job was selected, clear selection
      if (selectedId === jobId) {
        setSelectedId(null)
        setSelectedJob(null)
      }
      // Background reconcile
      fetchJobs(query, filter)
    } catch {}
  }, [selectedId, query, filter, fetchJobs])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', color:'var(--text)', fontFamily:'Inter, sans-serif', overflow:'hidden' }}>
      <FeedSettings open={feedSettingsOpen} onClose={() => setFeedSettingsOpen(false)} onSaved={() => {}} />
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        /* Splash animations — only opacity & transform (GPU-composited, no layout/repaint). */
        @keyframes splashOverlay {
          0%   { opacity: 1; }
          75%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes splashLogo {
          0%   { opacity: 0; transform: translate3d(0,10px,0) scale(0.86); }
          22%  { opacity: 1; transform: translate3d(0,0,0)    scale(1); }
          78%  { opacity: 1; transform: translate3d(0,0,0)    scale(1); }
          100% { opacity: 0; transform: translate3d(0,-6px,0) scale(1.05); }
        }
        @keyframes splashGlow {
          0%   { opacity: 0; transform: scale(0.7); }
          30%  { opacity: 1; transform: scale(1); }
          75%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.15); }
        }
        @keyframes splashSweep {
          0%   { transform: translate3d(-110%,0,0); opacity: 0; }
          20%  { opacity: 0.55; }
          70%  { transform: translate3d(110%,0,0); opacity: 0; }
          100% { transform: translate3d(110%,0,0); opacity: 0; }
        }
      `}</style>

      {/* INTRO SPLASH — runs once per browser session, ~2s total.
          Animation is gated on splashReady so the image is fully decoded before the
          keyframes start. Only opacity + transform are animated (GPU compositing). */}
      {showSplash && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'radial-gradient(ellipse at center, #114c66 0%, #0d3548 45%, #061525 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: splashReady ? undefined : 1,
          animation: splashReady ? `splashOverlay ${SPLASH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards` : 'none',
          pointerEvents: 'none',
          overflow: 'hidden',
          willChange: 'opacity',
          // Force GPU compositing
          transform: 'translateZ(0)',
        }}>
          {/* Soft teal glow behind the logo — animated separately, doesn't trigger image repaint */}
          <div style={{
            position: 'absolute',
            width: 'min(70vw, 600px)',
            height: 'min(70vw, 600px)',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,200,212,0.30) 0%, rgba(0,200,212,0.10) 35%, transparent 70%)',
            animation: splashReady ? `splashGlow ${SPLASH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards` : 'none',
            opacity: splashReady ? undefined : 0,
            willChange: 'opacity, transform',
            transform: 'translateZ(0)',
            pointerEvents: 'none',
            filter: 'blur(20px)',
          }} />
          {/* sweep highlight that crosses the logo */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: '45%',
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,200,212,0.20) 50%, transparent 100%)',
            animation: splashReady ? `splashSweep ${SPLASH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards` : 'none',
            animationDelay: isReload ? '0.05s' : '0.1s',
            opacity: 0,
            willChange: 'opacity, transform',
            transform: 'translate3d(-110%, 0, 0)',
            pointerEvents: 'none',
          }} />
          <img
            src="/falcon-scout-mark5.png"
            alt="Falcon Scout"
            decoding="sync"
            draggable={false}
            style={{
              maxWidth: '60%',
              maxHeight: '55%',
              objectFit: 'contain',
              position: 'relative',
              animation: splashReady ? `splashLogo ${SPLASH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards` : 'none',
              opacity: splashReady ? undefined : 0,
              willChange: 'opacity, transform',
              transform: 'translateZ(0)',
              userSelect: 'none',
            }}
          />
        </div>
      )}


      {/* HEADER */}
      <header style={{ display:'flex', alignItems:'center', gap:14, padding:'0 20px 0 0', height:66, background:'linear-gradient(90deg, #0d3548 0%, #114c66 50%, #0d3548 100%)', flexShrink:0, boxShadow:'0 1px 0 rgba(0,200,212,0.22), 0 3px 16px rgba(0,0,0,0.30)', borderBottom:'1px solid rgba(0,200,212,0.20)' }}>

        {/* ── LOGO: Falcon Scout icon + wordmark + IT Force ── */}
        <div style={{ display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>

          {/* Falcon Scout emblem — full header height, native aspect.
              Effects (glow, drop-shadow) stripped per the cleaner-design
              pass. The heartbeat pulse (~1.4s loop with realistic double-
              thump rhythm) lives in index.css under .falcon-logo-heartbeat
              and respects prefers-reduced-motion. */}
          <img
            src="/falcon-scout-mark.png"
            alt="Falcon Scout"
            className="falcon-logo-heartbeat"
            style={{
              height: 66,
              width: 'auto',
              display: 'block',
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />

          {/* Wordmark */}
          <div>
            <div style={{ fontFamily:'Inter, sans-serif', fontWeight:800, fontSize:24, lineHeight:1.1, letterSpacing:'0.01em' }}>
              <span className="falcon-metal-text falcon-metal-white" data-text="Falcon">Falcon</span>
              <span className="falcon-metal-text falcon-metal-teal" data-text="Scout">{' Scout'}</span>
            </div>
            {/* "by" + real IT Force logo image (inverted to white) — small subtitle */}
            <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:3 }}>
              <span style={{ fontSize:8, color:'rgba(255,255,255,0.50)', fontWeight:500, letterSpacing:'0.08em' }}>by</span>
              <img
                src="/it_force_logo.png"
                alt="IT Force"
                style={{
                  height: 11,
                  width: 'auto',
                  display: 'block',
                  objectFit: 'contain',
                  filter: 'brightness(0) invert(1)',   // recolour to pure white on dark bg
                  opacity: 0.85,
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ width:1, height:22, background:'rgba(0,185,210,0.18)', marginLeft:2 }} />

        {/* View tabs */}
        <div style={{ display:'flex', gap:8 }}>
          {[
            { key:'jobs',      label:'Jobs' },
            { key:'outcomes',  label:'Outcomes' },
            { key:'kb',        label:'Knowledge Base' },
            { key:'dashboard', label:'Dashboard' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={view === key ? 'btn-tab active' : 'btn-tab'}
              onClick={() => {
                setView(key)
                if (key === 'kb') setKbRefresh(v => v + 1)
                if (key === 'outcomes') setOutcomeActivity(false)  // clear the dot on open
              }}
              style={{ position:'relative' }}
            >
              {label}
              {key === 'outcomes' && outcomeActivity && view !== 'outcomes' && (
                <span className="outcomes-activity-dot" style={{
                  position:'absolute', top:-2, right:-2, width:8, height:8,
                  borderRadius:'50%', background:'#00d070',
                }} />
              )}
            </button>
          ))}
        </div>

        <div style={{ width:1, height:22, background:'rgba(0,185,210,0.18)' }} />

        <span style={{ fontSize:11, color:'rgba(255,255,255,0.42)', fontFamily:'Inter, sans-serif' }}>
          <strong style={{ color:'#00c8d4', fontWeight:700 }}>{jobs.length}</strong>
          <span style={{ marginLeft:4 }}>{jobs.length === 1 ? 'job' : 'jobs'}</span>
        </span>

        {/* Right side: usage chip + live indicator + dark mode toggle */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginLeft:'auto' }}>
          <UsageChip />
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'rgba(255,255,255,0.32)', textTransform:'uppercase', letterSpacing:'0.09em' }}>
            <div style={{
              width:6, height:6, borderRadius:'50%',
              background: error ? '#e05050' : loading ? '#00c8d4' : '#00e070',
              boxShadow:'0 0 7px ' + (error ? '#e05050' : loading ? '#00c8d4' : '#00e070'),
              animation: error ? 'none' : 'pulse 2s ease-in-out infinite'
            }} />
            {loading ? 'syncing' : error ? 'error' : 'live'}
          </div>
          {/* Dark mode toggle */}
          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{ background:'none', border:'1px solid rgba(255,255,255,0.12)', borderRadius:3, padding:'3px 7px', cursor:'pointer', fontSize:11, color:'rgba(255,255,255,0.45)', lineHeight:1, transition:'all 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,200,212,0.40)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'}
          >
            {darkMode ? '☀' : '🌙'}
          </button>
        </div>
      </header>

      {/* BODY — all views always mounted; toggle visibility with display:none to preserve state */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* JOBS VIEW */}
        <div style={{ display: view === 'jobs' ? 'flex' : 'none', flex:1, overflow:'hidden' }}>

          {/* SIDEBAR */}
          <aside ref={feedAsideRef} style={{ width:feedWidth, flexShrink:0, display:'flex', flexDirection:'column', borderRight:'1px solid var(--border)', background:'var(--bg2)', position:'relative' }}>
            {/* Drag handle — right edge of sidebar */}
            <div
              onMouseDown={onFeedDragStart}
              style={{ position:'absolute', right:0, top:0, bottom:0, width:4, cursor:'col-resize', zIndex:10, background:'transparent', transition:'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,200,212,0.4)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            />
            <div style={{ padding:12, borderBottom:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14, pointerEvents:'none' }}>⌕</span>
                <input type="search" placeholder="Search jobs..." value={query} onChange={(e) => setQuery(e.target.value)}
                  style={{ width:'100%', background:'var(--bg3)', border:'1px solid var(--border2)', color:'var(--text)', fontFamily:'Inter, sans-serif', fontSize:11, padding:'8px 10px 8px 32px', borderRadius:4, outline:'none', boxSizing:'border-box' }} />
              </div>

              {/* Feed source toggle (All / Bot / API) + on-demand API fetch + settings */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                {/* Segmented toggle — solid, inset, clear active state */}
                <div style={{
                  display:'flex', borderRadius:7, overflow:'hidden',
                  border:'1px solid var(--border2)',
                  boxShadow:'inset 0 1px 2px rgba(0,0,0,0.10)', flexShrink:0,
                }}>
                  {[['all','All'],['bot','Bot'],['api','API']].map(([key,label], i) => {
                    const active = feedSource === key
                    return (
                      <button
                        key={key}
                        onClick={() => setFeedSource(key)}
                        title={key === 'api' ? 'Jobs pulled from the Upwork API' : key === 'bot' ? 'Jobs captured via the Telegram bot' : 'Both sources'}
                        style={{
                          padding:'4px 11px', fontSize:10, fontWeight:800, fontFamily:'Inter, sans-serif',
                          letterSpacing:'0.07em', cursor:'pointer',
                          border:'none', borderLeft: i === 0 ? 'none' : '1px solid var(--border2)',
                          background: active ? 'linear-gradient(180deg, #00d2de 0%, #00abb8 100%)' : 'var(--bg2)',
                          color: active ? '#04303a' : 'var(--text2)',
                          boxShadow: active ? 'inset 0 -2px 0 rgba(0,0,0,0.16)' : 'none',
                          transition:'background 0.12s, color 0.12s',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg3)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'var(--bg2)' }}
                      >{label}</button>
                    )
                  })}
                </div>
                {/* Fetch API — the hero action, solid gradient */}
                <button
                  onClick={fetchApiJobs}
                  disabled={apiFetching}
                  title="Pull fresh jobs from the Upwork API now"
                  style={{
                    padding:'4px 11px', fontSize:10, fontWeight:800, fontFamily:'Inter, sans-serif',
                    borderRadius:7, cursor: apiFetching ? 'default' : 'pointer', letterSpacing:'0.05em',
                    border:'1px solid ' + (apiFetching ? 'var(--border2)' : '#0091a0'),
                    background: apiFetching ? 'var(--bg3)' : 'linear-gradient(180deg, #00c8d4 0%, #009fac 100%)',
                    color: apiFetching ? 'var(--text3)' : '#ffffff',
                    boxShadow: apiFetching ? 'none' : '0 1px 3px rgba(0,140,155,0.35)',
                    flexShrink:0, transition:'filter 0.12s',
                  }}
                  onMouseEnter={e => { if (!apiFetching) e.currentTarget.style.filter = 'brightness(1.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
                >{apiFetching ? '⏳ pulling…' : '⤓ Fetch API'}</button>
                {/* Settings — solid deep-teal, clearly visible */}
                <button
                  onClick={() => setFeedSettingsOpen(true)}
                  title="API feed filter settings (keywords, stop words, rate floors)"
                  style={{
                    width:28, height:26, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    cursor:'pointer', borderRadius:7, fontSize:13, lineHeight:1,
                    border:'1px solid #0b6470',
                    background:'linear-gradient(180deg, #0b8c9c 0%, #086676 100%)',
                    color:'#ffffff', boxShadow:'0 1px 3px rgba(0,0,0,0.18)',
                    transition:'filter 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.12)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                >⚙</button>
                {apiFetchMsg && (
                  <span style={{ fontSize:9.5, color: apiFetchMsg.startsWith('✗') ? '#ef4444' : 'var(--text3)', flexShrink:1, minWidth:0 }}>
                    {apiFetchMsg}
                  </span>
                )}
                <button
                  onClick={shareDebug}
                  title="Share live feed state + console errors to Claude (instead of a screenshot)"
                  style={{
                    marginLeft:'auto', padding:'3px 8px', fontSize:11, cursor:'pointer',
                    borderRadius:5, border:'1px solid var(--border2)', background:'var(--bg3)',
                    color:'var(--text3)', lineHeight:1,
                  }}
                >🐛</button>
                {debugMsg && (
                  <span style={{ fontSize:9.5, color: debugMsg.startsWith('✗') ? '#ef4444' : '#00d070' }}>{debugMsg}</span>
                )}
              </div>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {filters.map(({ key, label }) => (
                  <button
                    key={key}
                    className={filter === key ? 'btn-filter active' : 'btn-filter'}
                    onClick={() => setFilter(key)}
                  >{label}</button>
                ))}
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                {feedScrolled ? (
                  <button
                    onClick={() => feedListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                    title="Back to top"
                    style={{
                      background: 'rgba(0,180,200,0.13)',
                      border: '1px solid rgba(0,200,212,0.32)',
                      color: '#00c8d4',
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '2px 8px',
                      cursor: 'pointer',
                      lineHeight: 1.6,
                      fontFamily: 'Inter, sans-serif',
                      letterSpacing: '0.05em',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,200,212,0.24)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,180,200,0.13)'}
                  >↑ top</button>
                ) : <span />}
                <FeedStatus jobs={jobs} />
              </div>
            </div>
            <div ref={feedListRef} style={{ flex:1, overflowY:'auto' }}>
              {jobs.length === 0 && !loading && (
                <div style={{ padding:'48px 16px', textAlign:'center' }}>
                  <div style={{ fontSize:24, marginBottom:12, opacity:0.3 }}>📡</div>
                  <p style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>
                    {query || filter !== 'all' ? 'No jobs match filters.' : 'Listening for new jobs...'}
                  </p>
                </div>
              )}
              <JobList
                jobs={jobs}
                selectedId={selectedId}
                onSelect={(id) => { setSelectedId(id); fetchSelectedJob(id) }}
                onToggleHidden={toggleHidden}
                showingHidden={filter === 'hidden'}
              />
            </div>
          </aside>

          {/* MAIN — full height, no scroll (JobDetail handles its own columns) */}
          <main style={{ flex:1, overflow:'hidden', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
            {selectedJob ? (
              <>
                <div style={{ display:'flex', justifyContent:'flex-end', gap:14, padding:'4px 12px', borderBottom:'1px solid var(--border)', background:'var(--bg2)', flexShrink:0 }}>
                  <ShareWithClaudeButton job={selectedJob} />
                  <button
                    onClick={() => fetchSelectedJob(selectedId)}
                    title="Reload enrichment data"
                    style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:11, fontFamily:'inherit', padding:'2px 6px', letterSpacing:'0.06em', transition:'color 0.15s' }}
                    onMouseEnter={e => e.target.style.color = '#00c8d4'}
                    onMouseLeave={e => e.target.style.color = 'var(--text3)'}
                  >
                    ↺ refresh
                  </button>
                </div>
                <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
                  <JobDetail job={selectedJob} />
                </div>
              </>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', flex:1, color:'var(--text3)', fontSize:11, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                Select a job to view details
              </div>
            )}
          </main>

        </div>

        {/* KB VIEW — always mounted */}
        <div style={{ display: view === 'kb' ? 'flex' : 'none', flex:1, overflow:'hidden' }}>
          <KnowledgeBase refreshTrigger={kbRefresh} />
        </div>

        {/* OUTCOMES VIEW — always mounted */}
        <div style={{ display: view === 'outcomes' ? 'flex' : 'none', flex:1, overflow:'hidden' }}>
          <Outcomes active={view === 'outcomes'} />
        </div>

        {/* DASHBOARD VIEW — always mounted */}
        <div style={{ display: view === 'dashboard' ? 'flex' : 'none', flex:1, overflow:'hidden' }}>
          <Dashboard active={view === 'dashboard'} />
        </div>

      </div>
    </div>
  )
}

// ── Feed-activity indicator ──────────────────────────────────────────────────
// Shows whether the capture bot (@OffersHunterBot via the Telethon listener) is
// actively pushing new jobs — distinct from the header's "live" dot, which only
// reflects whether the FRONTEND can reach the backend. We infer activity from
// the freshest job's captured_at: a recent capture means the pipeline is flowing.
// Self-ticks every 30s so the relative time stays current without new fetches.
function FeedStatus({ jobs }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  // Freshest captured_at across the loaded jobs (ms since epoch).
  let freshestMs = 0
  for (const j of (jobs || [])) {
    const ts = j.captured_at
    if (!ts) continue
    const norm = (ts.endsWith('Z') || ts.includes('+')) ? ts : ts + 'Z'
    const ms = new Date(norm).getTime()
    if (ms > freshestMs) freshestMs = ms
  }

  let color, glow, label, pulse
  if (!freshestMs) {
    color = '#9aa5b4'; glow = 'rgba(154,165,180,0.5)'; label = 'No jobs captured yet'; pulse = false
  } else {
    const mins = Math.max(0, Math.floor((Date.now() - freshestMs) / 60000))
    // The feed is bursty — gaps of an hour or two are normal even when the
    // bot is perfectly connected. So "live" just means a job landed within the
    // last 2 hours (strong evidence the listener is up). Only after that do we
    // downgrade to "Quiet", and after a full day to "Idle" (likely down).
    if (mins < 120) {
      // Dark emerald text with a brighter green glow halo for contrast.
      color = '#047857'; glow = 'rgba(0,220,118,0.85)'; label = 'Feed is live'; pulse = true
    } else if (mins < 24 * 60) {
      const h = Math.floor(mins / 60)
      color = '#f59e0b'; glow = 'rgba(245,158,11,0.65)'; label = `Quiet · last job ${h}h ago`; pulse = false
    } else {
      const d = Math.floor(mins / (60 * 24))
      color = '#9aa5b4'; glow = 'rgba(154,165,180,0.5)'; label = `Idle · last job ${d}d ago`; pulse = false
    }
  }

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:7, fontSize:11, color:'var(--text2)', letterSpacing:'0.02em', paddingTop:2 }}>
      <span style={{
        width:8, height:8, borderRadius:'50%', flexShrink:0,
        background:color, boxShadow:`0 0 7px ${color}`,
        animation: pulse ? 'pulse 2s ease-in-out infinite' : 'none',
      }} />
      <span style={{ fontWeight:600, color, '--glow': glow, animation:'feedTextGlow 2.4s ease-in-out infinite' }}>{label}</span>
    </div>
  )
}

// ── Share-with-Claude button ────────────────────────────────────────────────
// Click → dispatches a custom event that the JobDetail columns listen for and
// populate with their current state (analysis result, cover-letter draft, both
// chat transcripts). Then POSTs the assembled snapshot to /share-with-claude,
// which writes `share-with-claude.md` at the repo root for Claude Code to read.
function ShareWithClaudeButton({ job }) {
  const [status, setStatus] = useState(null) // 'sending' | 'ok' | 'err'

  const share = async () => {
    setStatus('sending')
    const detail = {
      analysis: null,
      analysisChat: [],
      analysisFeedback: null,
      proposal: '',
      proposalChat: [],
      proposalFeedback: null,
      savedProposal: null,
    }
    // Synchronous dispatch — listeners populate `detail` before this returns
    window.dispatchEvent(new CustomEvent('falconscout:share-with-claude', { detail }))

    try {
      const res = await fetch('/share-with-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job,
          ...detail,
          snapshot_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) throw new Error('API ' + res.status)
      setStatus('ok')
      setTimeout(() => setStatus(null), 2400)
    } catch (e) {
      console.error('Share with Claude failed:', e)
      setStatus('err')
      setTimeout(() => setStatus(null), 3000)
    }
  }

  const baseStyle = {
    background: status === 'ok' ? 'rgba(0,208,112,0.12)' : 'none',
    border: '1px solid ' + (status === 'ok' ? 'rgba(0,208,112,0.45)' : 'var(--border)'),
    color: status === 'ok' ? '#00d070' : status === 'err' ? '#e05050' : 'var(--text3)',
    cursor: status === 'sending' ? 'wait' : 'pointer',
    fontSize: 11, fontFamily: 'inherit', fontWeight: 600,
    padding: '2px 10px', borderRadius: 3, letterSpacing: '0.06em',
    transition: 'color 0.15s, border-color 0.15s, background 0.15s',
  }

  return (
    <button
      onClick={share}
      disabled={status === 'sending'}
      title="Snapshot the current job + analysis + cover letter + chats to share-with-claude.md so Claude Code can read it"
      style={baseStyle}
      onMouseEnter={e => { if (!status) e.currentTarget.style.color = '#00c8d4' }}
      onMouseLeave={e => { if (!status) e.currentTarget.style.color = 'var(--text3)' }}
    >
      {status === 'sending' ? '⏳ sharing…'
        : status === 'ok' ? '✓ shared with claude'
        : status === 'err' ? '✗ share failed'
        : '⤴ share with claude'}
    </button>
  )
}

// ── Usage chip ───────────────────────────────────────────────────────────
// Polls /usage-stats every 30s and shows compact tokens + estimated USD for
// last 24h and this month. Click to expand the per-kind breakdown.
function UsageChip() {
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ok' | 'err'
  const [open, setOpen] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/usage-stats')
      if (!res.ok) { setStatus('err'); return }
      setStats(await res.json())
      setStatus('ok')
    } catch {
      setStatus('err')
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const i = setInterval(fetchStats, 30000)
    return () => clearInterval(i)
  }, [fetchStats])

  const fmtUsd = (n) => '$' + (n ?? 0).toFixed(3)
  const fmtTokens = (n) => {
    if (!n) return '0'
    if (n < 1000) return String(n)
    if (n < 1_000_000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k'
    return (n / 1_000_000).toFixed(1) + 'M'
  }

  // Render placeholder text while loading / on error so the chip is always
  // visible — invisible-by-default was making it look like the feature was
  // missing when the backend hadn't been restarted with the new endpoint.
  if (!stats) {
    return (
      <div
        title={status === 'err' ? 'Could not reach /usage-stats — restart the backend (it added the endpoint after your last start)' : 'Loading usage…'}
        style={{
          background: status === 'err' ? 'rgba(239,68,68,0.10)' : 'rgba(0,200,212,0.06)',
          border: '1px solid ' + (status === 'err' ? 'rgba(239,68,68,0.30)' : 'rgba(0,200,212,0.20)'),
          borderRadius: 4, padding: '4px 10px', fontSize: 10, fontFamily: 'Inter, sans-serif',
          color: status === 'err' ? '#fbbf24' : 'rgba(255,255,255,0.55)',
          letterSpacing: '0.04em', lineHeight: 1.1,
        }}
      >
        {status === 'err' ? 'usage: restart backend' : 'usage: …'}
      </div>
    )
  }
  const d = stats.last_24h
  const m = stats.this_month

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Click for breakdown"
        style={{
          background: 'rgba(0,200,212,0.10)',
          border: '1px solid rgba(0,200,212,0.30)',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: 10,
          fontFamily: 'Inter, sans-serif',
          color: 'rgba(255,255,255,0.75)',
          cursor: 'pointer',
          letterSpacing: '0.04em',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          lineHeight: 1.1,
        }}
      >
        <span><span style={{ color: 'rgba(255,255,255,0.50)' }}>24h</span> <strong style={{ color: '#00c8d4' }}>{fmtUsd(d.cost_usd)}</strong></span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span><span style={{ color: 'rgba(255,255,255,0.50)' }}>mo</span> <strong style={{ color: '#00c8d4' }}>{fmtUsd(m.cost_usd)}</strong></span>
      </button>

      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute', top: '110%', right: 0, zIndex: 200,
            minWidth: 280, background: '#0d2040',
            border: '1px solid rgba(0,200,212,0.25)', borderRadius: 6,
            padding: '14px 16px', fontSize: 11, color: 'rgba(255,255,255,0.85)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', letterSpacing: '0.02em',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {[
            { label: 'Last 24 hours', data: d },
            { label: 'This month', data: m },
          ].map(({ label, data }) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#00c8d4', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6 }}>
                {label}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'rgba(255,255,255,0.55)' }}>Cost</span>
                <strong>{fmtUsd(data.cost_usd)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'rgba(255,255,255,0.55)' }}>Tokens (in / out)</span>
                <span>{fmtTokens(data.input_tokens)} / {fmtTokens(data.output_tokens)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.55)' }}>API calls</span>
                <span>{data.calls}</span>
              </div>
              {Object.entries(data.by_kind || {}).length > 0 && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, marginTop: 4 }}>
                  {Object.entries(data.by_kind).sort((a, b) => b[1].cost_usd - a[1].cost_usd).map(([kind, v]) => (
                    <div key={kind} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.60)', padding: '2px 0' }}>
                      <span>{kind}</span>
                      <span>{fmtUsd(v.cost_usd)} · {v.calls}×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
            Pricing based on published Anthropic rates · updates every 30s
          </div>
        </div>
      )}
    </div>
  )
}
