import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Outcomes tab — manage all sent proposals without having to remember which
// job each one belongs to. The friction-reducer described in
// DESIGN.md section 8, Phase 5 ("Outcomes tab").
//
// Default filter is "Awaiting reply" — proposals with status=sent and no
// client_reply_text yet. When a reply arrives via email or Upwork inbox,
// Artem opens this tab, scans recent sends, finds the title, pastes the
// reply into the row's textarea, and PUT-saves.

const STATUSES = [
  'sent', 'viewed', 'replied', 'interviewing',
  'hired', 'declined', 'ghosted', 'expired', 'withdrawn', 'invited',
]

const STATUS_COLOR = {
  draft: '#6b7280', sent: '#3b82f6', viewed: '#8b5cf6',
  replied: '#00c8d4', interviewing: '#06b6d4', hired: '#00d070',
  declined: '#ef4444', ghosted: '#f59e0b',
  expired: '#9ca3af', withdrawn: '#6b7280',
  invited: '#a855f7',
}

// Filter chips. 'awaiting' is a synthetic filter (status=sent AND no reply).
// 'Draft' removed — no practical use in the Outcomes workflow.
const FILTERS = [
  { key: 'awaiting',     label: 'Awaiting Response' },
  { key: 'all',          label: 'All' },
  { key: 'sent',         label: 'Sent' },
  { key: 'viewed',       label: 'Viewed' },
  { key: 'replied',      label: 'Replied' },
  { key: 'interviewing', label: 'Interviewing' },
  { key: 'hired',        label: 'Hired' },
  { key: 'declined',     label: 'Declined' },
  { key: 'ghosted',      label: 'Ghosted' },
  { key: 'expired',      label: 'Expired' },
  { key: 'withdrawn',    label: 'Withdrawn' },
  { key: 'invited',      label: 'Invited' },
]

export default function Outcomes({ active = false }) {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  // Per-row pending edits so users can type before clicking Save
  const [edits, setEdits] = useState({})  // { [proposalId]: { status, reply, notes, sent_text } }
  const [savingId, setSavingId] = useState(null)
  const [rowMsg, setRowMsg] = useState({})  // { [proposalId]: {kind, text} }
  const [shareStatus, setShareStatus] = useState(null) // 'sending'|'ok'|'err'
  // Status-sync from Upwork's Submitted-proposals list
  const [syncStatus, setSyncStatus] = useState(null) // null|'opening'|'scraping'|{ok, scanned, updated, newly_viewed}|{err, msg}
  // Timestamp of the most recent successful sync — persisted to localStorage
  // so it survives reloads and tab switches.
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    try {
      const v = localStorage.getItem('falconscout.lastSyncedAt')
      return v ? new Date(v) : null
    } catch { return null }
  })
  // Bump this counter every 30s so the "X ago" relative text recomputes
  // without needing to wire each filter chip into a timer of its own.
  const [_relativeNowTick, _setRelativeNowTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => _setRelativeNowTick(v => v + 1), 30000)
    return () => clearInterval(id)
  }, [])
  // Format a timestamp as "X minutes/hours/days ago", coarse-grained.
  const formatRelativeTime = (dt) => {
    if (!dt) return null
    const now = Date.now()
    const diffMs = now - dt.getTime()
    if (diffMs < 0) return 'just now'
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} min ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
    return dt.toLocaleDateString()
  }
  // Persist on every successful sync — fires for BOTH manual and hourly auto.
  useEffect(() => {
    const onAnySync = (e) => {
      const d = e.detail || {}
      if (d._from_poll) return  // activity poll re-broadcast, not a real sync
      if (d.error) return
      const now = new Date()
      setLastSyncedAt(now)
      try { localStorage.setItem('falconscout.lastSyncedAt', now.toISOString()) } catch {}
    }
    window.addEventListener('cockpit:status:synced', onAnySync)
    return () => window.removeEventListener('cockpit:status:synced', onAnySync)
  }, [])
  // Filter keys that have NEW activity since the user last clicked them.
  // Persisted to localStorage so the glow survives across reloads — only
  // clearing when the user actually clicks the corresponding filter chip.
  const [newActivityFilters, setNewActivityFilters] = useState(() => {
    try {
      const raw = localStorage.getItem('falconscout.newActivityFilters')
      const arr = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(arr) ? arr : [])
    } catch { return new Set() }
  })
  // Persist + helper setters
  const persistNewActivity = (set) => {
    try {
      localStorage.setItem('falconscout.newActivityFilters', JSON.stringify([...set]))
    } catch {}
  }
  const addNewActivity = (filterKey) => {
    setNewActivityFilters(prev => {
      if (prev.has(filterKey)) return prev
      const next = new Set(prev)
      next.add(filterKey)
      persistNewActivity(next)
      return next
    })
  }
  const clearNewActivity = (filterKey) => {
    setNewActivityFilters(prev => {
      if (!prev.has(filterKey)) return prev
      const next = new Set(prev)
      next.delete(filterKey)
      persistNewActivity(next)
      return next
    })
  }
  // Track whether the extension bridge has acknowledged itself. Same
  // mechanism used by JobDetail's enrich button.
  const [bridgeReady, setBridgeReady] = useState(false)
  useEffect(() => {
    const onReady = () => setBridgeReady(true)
    window.addEventListener('cockpit:bridge:ready', onReady)
    window.dispatchEvent(new CustomEvent('cockpit:bridge:ping'))
    return () => window.removeEventListener('cockpit:bridge:ready', onReady)
  }, [])

  // Passive listener for ANY sync completion (manual or auto-alarm) — even
  // when the user isn't actively watching. Marks the corresponding filter
  // chip(s) as having new activity, which renders as a green pulsing glow
  // until the user clicks the chip.
  useEffect(() => {
    const onPassiveSync = (e) => {
      const d = e.detail || {}
      if ((d.newly_viewed || 0) > 0) addNewActivity('viewed')
      if ((d.newly_replied || 0) > 0) addNewActivity('replied')
    }
    window.addEventListener('cockpit:status:synced', onPassiveSync)
    return () => window.removeEventListener('cockpit:status:synced', onPassiveSync)
  }, [])

  // Trigger the proposals-list scrape via the extension bridge.
  // The frontend can't touch chrome.storage directly (only extension
  // contexts can), so we dispatch a custom event that bridge.js picks up.
  // The bridge sets the auto-sync flag in chrome.storage and opens the
  // Upwork proposals page. proposal.js sees the flag on load, scrapes,
  // POSTs to /proposal-status-sync, and emits a result event back here.
  const syncFromUpwork = () => {
    console.log('[Outcomes] syncFromUpwork clicked. bridgeReady =', bridgeReady)
    if (!bridgeReady) {
      console.warn('[Outcomes] bridge not ready — extension content script (bridge.js) is not loaded on this page. Reload the extension at chrome://extensions, then hard-refresh this tab.')
      setSyncStatus({ err: true, msg: 'Extension not connected — reload it at chrome://extensions' })
      setTimeout(() => setSyncStatus(null), 5000)
      return
    }
    console.log('[Outcomes] dispatching cockpit:sync-statuses')
    setSyncStatus('opening')
    // Sync v2: BOTH legs now self-report on their own Upwork tabs via green
    // on-page banners and POST straight to the backend — no cross-tab relay
    // (that was the unreliable part). So the dashboard no longer waits on a
    // relay event; it just confirms the tabs opened and points to the banners.
    // The Outcomes list refreshes from the backend so promoted statuses appear
    // here within a few seconds anyway.
    window.dispatchEvent(new CustomEvent('cockpit:sync-statuses'))
    setTimeout(() => setSyncStatus({ ok: true, banner: true }), 800)
    // Refresh the list a few times so newly-promoted statuses surface here
    // without a manual reload, then clear the banner.
    // The messages leg can walk up to 10 rooms (~2 min) — keep refreshing long
    // enough for late promotions to land here without a manual reload.
    const refreshes = [4000, 9000, 15000, 30000, 60000, 90000, 130000]
    refreshes.forEach(ms => setTimeout(() => { try { fetchProposals() } catch (_) {} }, ms))
    setTimeout(() => setSyncStatus(null), 22000)
  }

  // Snapshot the currently expanded proposal (or first one in view) to
  // share-with-claude.md so Claude Code can read this outcome on request.
  const shareWithClaude = async () => {
    setShareStatus('sending')
    try {
      const targetId = expandedId || (proposals[0] && proposals[0].id) || null
      const target = targetId ? proposals.find(p => p.id === targetId) : null

      // If linked to a job, fetch the full job record so the snapshot has
      // the description + enrichment alongside the proposal text.
      let jobPayload = null
      if (target && target.job_id) {
        try {
          const jRes = await fetch(`/jobs/${target.job_id}`)
          if (jRes.ok) jobPayload = await jRes.json()
        } catch {}
      }
      const res = await fetch('/share-with-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'outcome',
          proposal_record: target,
          job: jobPayload,
          snapshot_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) throw new Error('API ' + res.status)
      setShareStatus('ok')
      setTimeout(() => setShareStatus(null), 2400)
    } catch (e) {
      setShareStatus('err')
      setTimeout(() => setShareStatus(null), 3000)
    }
  }

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter === 'awaiting') {
        params.set('awaiting_reply', 'true')
      } else if (filter !== 'all') {
        params.set('status', filter)
      }
      // Fetch /proposals and KB sent_proposal entries in parallel.
      // We always fetch KB now (not only on sent/awaiting/all) because the
      // KB row status is INFERRED below — a KB row's effective status can be
      // replied / hired / interviewing depending on its captured content.
      const [res, kbRes] = await Promise.all([
        fetch('/proposals?' + params.toString()),
        fetch('/kb?type=sent_proposal'),
      ])
      if (!res.ok) throw new Error('API ' + res.status)
      const dataRaw = await res.json()
      // Surface the original job posting so the Outcomes expander can render
      // the "📋 Job Posting" section for proposal rows. Source priority:
      //   1. Snapshot's description_full (canonical — saved at proposal time)
      //   2. Live Job row's description (from /proposals enrichment) — handles
      //      proposals saved BEFORE description_full was added to the snapshot
      //   3. Snapshot's description_snippet (truncated bot message — fallback)
      const data = dataRaw.map(p => {
        const snap = p.job_snapshot || {}
        // Source priority for the "📋 Job Posting" section:
        //   1. snap.description_full   — enriched Upwork posting (best)
        //   2. p.job_description_live  — live Job row (handles pre-fix snaps)
        //   3. snap.description_snippet — truncated bot message
        //   4. snap.raw_message        — full Telegram capture (always present)
        const posting = (
          snap.description_full ||
          p.job_description_live ||
          snap.description_snippet ||
          snap.raw_message ||
          ''
        ).trim()
        return posting ? { ...p, _job_posting: posting } : p
      })

      // Normalise KB sent_proposal entries to look like proposal rows
      let kbRows = []
      if (kbRes && kbRes.ok) {
        const kbEntries = await kbRes.json()
        kbRows = kbEntries.map(e => {
          const raw = e.content || ''
          // Parse sections by splitting on \n## (avoids multiline regex pitfalls)
          const sections = {}
          const chunks = raw.split(/\n(?=## )/)
          chunks.forEach(chunk => {
            const nl = chunk.indexOf('\n')
            if (nl === -1) return
            const heading = chunk.slice(0, nl).replace(/^## /, '').trim().toLowerCase()
            sections[heading] = chunk.slice(nl + 1).trim()
          })
          // Also handle first chunk that starts with ##
          if (raw.startsWith('## ')) {
            const nl = raw.indexOf('\n')
            const heading = raw.slice(3, nl).trim().toLowerCase()
            if (!(heading in sections)) {
              const rest = raw.slice(nl + 1)
              const nextSection = rest.indexOf('\n## ')
              sections[heading] = (nextSection === -1 ? rest : rest.slice(0, nextSection)).trim()
            }
          }
          const jobPosting  = sections['job posting'] || ''
          // Use the section value even if empty — fallback to raw only if section missing entirely
          const coverLetter = ('cover letter' in sections)
            ? sections['cover letter']
            : ('proposal' in sections ? sections['proposal'] : raw)
          const messages    = sections['messages'] || sections['client response'] || null
          const clientRaw   = sections['client'] || ''
          // Parse client section key:value lines
          const clientInfo = {}
          clientRaw.split('\n').forEach(line => {
            const kv = line.match(/^([^:]+):\s*(.+)$/)
            if (kv) clientInfo[kv[1].trim().toLowerCase()] = kv[2].trim()
          })
          // Infer status from captured data so the badge shows the real
          // funnel position instead of a generic "kb entry" label.
          // Signal ladder (strongest first):
          //   1. Client section has "Contract: <active|hired|started|view contract>" → hired
          //      ("View contract" is the visible label of the sidebar link Upwork
          //      shows when an active contract exists — if there's no contract,
          //      that link reads "View proposal" instead. So "view contract"
          //      literally implies a contract is in place.)
          //   2. Client section "Timeline:" mentions "Contract started/offered/
          //      accepted" or "Hired" → hired. Upwork's activity timeline in
          //      the sidebar is the authoritative funnel record — if it says
          //      a contract started, the engagement is real even when no
          //      explicit "Contract:" badge was scraped.
          //   3. Messages reference "you've been hired" / "contract started" → hired
          //   4. Messages or client_reply_text exists → replied
          //   5. Default → sent
          const contractStr = (clientInfo['contract'] || '').toLowerCase()
          const timelineStr = (clientInfo['timeline'] || '').toLowerCase()
          const allMsgsLower = (messages || '').toLowerCase()
          let inferredStatus = 'sent'
          if (
            /\b(active|hired|started|in\s+progress|ongoing|view\s+contract)\b/.test(contractStr) ||
            /(contract\s+(started|offered|accepted)|hired)/.test(timelineStr) ||
            /(you'?ve\s+been\s+hired|contract\s+started|offer\s+accepted|hired\s+you|let'?s\s+get\s+started)/.test(allMsgsLower)
          ) {
            inferredStatus = 'hired'
          } else if (
            /\b(interview|interviewing|let'?s\s+(set\s+up|schedule)\s+a\s+(call|meeting))\b/.test(allMsgsLower)
          ) {
            inferredStatus = 'interviewing'
          } else if (messages) {
            inferredStatus = 'replied'
          }
          // Append " — Client Name" to the displayed title when the captured
          // Client section has a name and the stored title doesn't already
          // include it. Lets older KB entries (saved before the backend started
          // baking the suffix into the title at capture time) show the client
          // name in the row without requiring a re-capture.
          const displayTitle = (() => {
            const baseTitle = (e.title || '').trim()
            const cn = (clientInfo['name'] || '').trim()
            const cc = (clientInfo['company'] || '').trim()
            if (!cn) return baseTitle
            const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim()
            const nt = norm(baseTitle)
            if (norm(cn) && nt.includes(norm(cn))) return baseTitle
            let suffix = cn
            if (cc && !norm(suffix).includes(norm(cc)) && !nt.includes(norm(cc))) {
              suffix = `${cn}, ${cc}`
            }
            return baseTitle ? `${baseTitle} — ${suffix}` : suffix
          })()
          return {
            _source: 'kb',
            id: `kb-${e.id}`,
            _kbId: e.id,
            _sourceUrl: e.source_url || null,
            job_title_live: displayTitle,
            status: inferredStatus,
            sent_at: e.created_at,
            sent_text: coverLetter,
            _job_posting: jobPosting,
            _messages: messages,
            _client: clientInfo,
            client_reply_text: messages || null,
            notes: null,
          }
        })
        // For "awaiting" filter, only include KB rows that have no reply (all of them since they have no reply field)
        // For status filters other than 'all'/'sent'/'awaiting', kbRes is null so kbRows stays []
      }

      // Apply the active filter to KB rows on the client (the backend
      // /proposals endpoint already filtered by status server-side).
      let filteredKbRows = kbRows
      if (filter === 'awaiting') {
        filteredKbRows = kbRows.filter(r => !r.client_reply_text)
      } else if (filter !== 'all') {
        filteredKbRows = kbRows.filter(r => r.status === filter)
      }
      // Merge: proposals first (have proper sent_at), then KB rows not already in proposals list
      // Deduplicate by job title in case a proposal was saved both ways
      const titles = new Set(data.map(p => (p.job_title_live || '').toLowerCase()))
      const uniqueKbRows = filteredKbRows.filter(r => !titles.has((r.job_title_live || '').toLowerCase()))
      setProposals([...data, ...uniqueKbRows])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchProposals() }, [fetchProposals])
  // Re-fetch whenever the Outcomes tab becomes visible (captures happen while on other tabs)
  const prevActive = useRef(false)
  useEffect(() => {
    if (active && !prevActive.current) fetchProposals()
    prevActive.current = active
  }, [active, fetchProposals])
  // Auto-refresh when the extension signals a new capture was saved (regardless of active tab)
  useEffect(() => {
    const handler = () => fetchProposals()
    window.addEventListener('cockpit:outcome:saved', handler)
    return () => window.removeEventListener('cockpit:outcome:saved', handler)
  }, [fetchProposals])
  // Self-healing refresh: re-fetch whenever the dashboard window/tab regains
  // focus. Captures happen in a SEPARATE Upwork browser tab — when the user
  // switches back here, the in-app `active` prop hasn't changed (they never
  // left the Outcomes tab) and the extension's CONVERSATION_SAVED event may
  // have been missed (dashboard tab not loaded with bridge.js at capture
  // time). Re-fetching on focus guarantees a freshly-promoted status (e.g.
  // sent → replied) shows up without a manual Ctrl+F5. Gated on `active` so
  // we don't fetch when the user is on a different in-app tab.
  useEffect(() => {
    if (!active) return
    const refresh = () => { if (document.visibilityState === 'visible') fetchProposals() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [active, fetchProposals])

  const getEdit = (p, key) => {
    const e = edits[p.id]
    if (e && key in e) return e[key]
    if (key === 'status') return p.status
    if (key === 'reply') return p.client_reply_text || ''
    if (key === 'notes') return p.notes || ''
    if (key === 'sent_text') return p.sent_text || ''
    if (key === 'bid') return p.bid_amount != null ? String(p.bid_amount) : ''
    if (key === 'bid_currency') return p.bid_currency || 'USD'
    return ''
  }

  const setEdit = (id, key, value) => {
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }))
  }

  const hasUnsavedEdits = (p) => {
    const e = edits[p.id]
    if (!e) return false
    if (e.status != null && e.status !== p.status) return true
    if (e.reply != null && e.reply !== (p.client_reply_text || '')) return true
    if (e.notes != null && e.notes !== (p.notes || '')) return true
    if (e.sent_text != null && e.sent_text !== (p.sent_text || '')) return true
    if (e.bid != null && e.bid !== (p.bid_amount != null ? String(p.bid_amount) : '')) return true
    if (e.bid_currency != null && e.bid_currency !== (p.bid_currency || 'USD')) return true
    return false
  }

  const [deletingId, setDeletingId] = useState(null)

  // Compute the best Upwork URL to open for a given row.
  // Priority:
  //   1. KB rows have `_sourceUrl` — usually the proposal/messages page
  //      where the capture came from. Most accurate, opens exactly where
  //      the user last saw the entry.
  //   2. Proposal rows: use `job_snapshot.url` (the Upwork job URL captured
  //      at proposal-save time). Falls back to building from upwork_job_id.
  //   3. If we have an upwork_job_id but no URL, build `/jobs/~ID` as
  //      the canonical job page.
  const getRowUpworkUrl = (p) => {
    if (p._sourceUrl) return p._sourceUrl
    const snap = p.job_snapshot || {}
    if (snap.url) return snap.url
    // Try to reconstruct from any ~ID we have around
    const id = (snap.upwork_job_id || '').replace(/^~/, '')
    if (id) return `https://www.upwork.com/jobs/~${id}`
    return null
  }

  const openRowOnUpwork = (p) => {
    const url = getRowUpworkUrl(p)
    if (!url) return
    if (bridgeReady) {
      // Route through the extension bridge — first-party navigation, keeps
      // the user's Upwork session cookie attached (vs. cross-site window.open
      // from localhost which can hit re-auth walls).
      window.dispatchEvent(new CustomEvent('cockpit:open-tab', { detail: { url } }))
    } else {
      window.open(url, '_blank')
    }
  }

  const deleteRow = async (p) => {
    if (!window.confirm(`Delete "${p.job_title_live || `Job #${p.job_id}`}"? This cannot be undone.`)) return
    setDeletingId(p.id)
    try {
      const url = p._source === 'kb' ? `/kb/${p._kbId}` : `/proposals/${p.id}`
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) throw new Error('API ' + res.status)
      setProposals(prev => prev.filter(x => x.id !== p.id))
      if (expandedId === p.id) setExpandedId(null)
    } catch (e) {
      setRowMsg(m => ({ ...m, [p.id]: { kind: 'err', text: e.message } }))
    } finally {
      setDeletingId(null)
    }
  }

  const saveRow = async (p) => {
    setSavingId(p.id)
    setRowMsg(m => ({ ...m, [p.id]: null }))
    try {
      const bidVal = getEdit(p, 'bid').trim()
      const body = {
        status: getEdit(p, 'status'),
        client_reply_text: getEdit(p, 'reply') || null,
        notes: getEdit(p, 'notes') || null,
        sent_text: getEdit(p, 'sent_text'),
        bid_amount: bidVal || null,
        bid_currency: bidVal ? (getEdit(p, 'bid_currency') || 'USD') : null,
      }
      const res = await fetch(`/proposals/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'API ' + res.status)
      }
      // Clear edits for this row and refresh list
      setEdits(prev => { const n = { ...prev }; delete n[p.id]; return n })
      setRowMsg(m => ({ ...m, [p.id]: { kind: 'ok', text: 'Saved' } }))
      await fetchProposals()
      setTimeout(() => {
        setRowMsg(m => { const n = { ...m }; delete n[p.id]; return n })
      }, 2500)
    } catch (e) {
      setRowMsg(m => ({ ...m, [p.id]: { kind: 'err', text: e.message } }))
    } finally {
      setSavingId(null)
    }
  }

  const filterCounts = useMemo(() => {
    // We only know counts for what's currently loaded; this is a hint, not authoritative
    return null
  }, [proposals])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Filter bar */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {proposals.length} {proposals.length === 1 ? 'cover letter' : 'cover letters'}
        </span>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {FILTERS.map(({ key, label }) => {
            const hasNew = newActivityFilters.has(key)
            const isActive = filter === key
            return (
              <button
                key={key}
                onClick={() => {
                  setFilter(key)
                  // Clear glow as soon as the user acknowledges by clicking
                  if (hasNew) clearNewActivity(key)
                }}
                className={hasNew ? 'falcon-filter-glow' : undefined}
                style={{
                  padding: '3px 10px', fontSize: 10, fontFamily: 'inherit', borderRadius: 20,
                  border: '1px solid ' + (
                    hasNew ? '#00d070'
                    : isActive ? 'rgba(0,200,212,0.50)'
                    : 'var(--border2)'
                  ),
                  background: hasNew
                    ? 'rgba(0,208,112,0.18)'
                    : isActive ? 'rgba(0,200,212,0.14)' : 'var(--bg)',
                  color: hasNew ? '#00d070' : isActive ? '#00c8d4' : 'var(--text2)',
                  cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
                  fontWeight: hasNew ? 700 : 'normal',
                  position: 'relative',
                }}
              >
                {label}
                {hasNew && (
                  <span className="outcomes-activity-dot" style={{
                    position: 'absolute', top: -3, right: -3,
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#00d070',
                  }} />
                )}
              </button>
            )
          })}
        </div>
        {/* "Last synced X ago" indicator — to the left of the sync button.
            Hidden until the first successful sync; re-renders relative time
            every 30s via the _relativeNowTick counter. */}
        {lastSyncedAt && (() => {
          void _relativeNowTick  // re-evaluate when the tick changes
          return (
            <span
              title={`Last synced: ${lastSyncedAt.toLocaleString()}`}
              style={{
                marginLeft: 'auto',
                fontSize: 10, color: 'var(--text3)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}
            >
              last synced {formatRelativeTime(lastSyncedAt)}
            </span>
          )
        })()}
        {/* When the indicator isn't yet shown (never synced), this empty
            spacer claims the auto-margin so the sync button still sits on
            the right. */}
        {!lastSyncedAt && <span style={{ marginLeft: 'auto' }} />}
        {/* Sync statuses from Upwork's Submitted-proposals + messages
            inbox pages — both open as background tabs via the extension
            bridge, scrape, and batch-update matching Proposal rows.
            See DESIGN.md Phase 6. */}
        <button
          onClick={syncFromUpwork}
          disabled={syncStatus === 'opening' || syncStatus === 'scraping'}
          title="Open Upwork's Submitted-proposals page and bulk-update viewed statuses"
          style={{
            padding: '4px 12px', fontSize: 10, fontWeight: 700,
            background: (syncStatus && syncStatus.ok) ? '#00d070'
              : (syncStatus && syncStatus.err) ? '#e05050'
              : (syncStatus === 'opening' || syncStatus === 'scraping') ? 'var(--border)'
              : 'rgba(0,200,212,0.10)',
            color: (syncStatus && (syncStatus.ok || syncStatus.err)) ? '#fff'
              : (syncStatus === 'opening' || syncStatus === 'scraping') ? 'var(--text3)'
              : '#00c8d4',
            border: '1px solid ' + (
              (syncStatus && syncStatus.ok) ? '#00d070'
              : (syncStatus && syncStatus.err) ? '#e05050'
              : 'rgba(0,200,212,0.40)'
            ),
            borderRadius: 4,
            cursor: (syncStatus === 'opening' || syncStatus === 'scraping') ? 'wait' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
          }}
        >
          {syncStatus === 'opening' ? '⏳ opening upwork…'
            : syncStatus === 'scraping' ? '⏳ scraping statuses…'
            : (syncStatus && syncStatus.ok) ? (() => {
                const bits = []
                if (syncStatus.newly_replied) bits.push(`${syncStatus.newly_replied} new repl${syncStatus.newly_replied === 1 ? 'y' : 'ies'}`)
                return bits.length ? `✓ synced — ${bits.join(', ')}` : `✓ synced`
              })()
            : (syncStatus && syncStatus.err) ? `✗ ${syncStatus.msg}`
            : '🔄 sync from upwork'}
        </button>
        <button
          onClick={shareWithClaude}
          disabled={shareStatus === 'sending' || proposals.length === 0}
          title="Snapshot the currently expanded proposal (or the first in view) to share-with-claude.md"
          style={{
            padding: '4px 12px', fontSize: 10, fontWeight: 700,
            background: shareStatus === 'ok' ? '#00d070'
              : shareStatus === 'err' ? '#e05050'
              : shareStatus === 'sending' ? 'var(--border)'
              : 'var(--bg)',
            color: (shareStatus === 'ok' || shareStatus === 'err') ? '#fff'
              : shareStatus === 'sending' ? 'var(--text3)' : 'var(--text2)',
            border: '1px solid ' + (
              shareStatus === 'ok' ? '#00d070'
              : shareStatus === 'err' ? '#e05050'
              : 'var(--border2)'
            ),
            borderRadius: 4, cursor: shareStatus === 'sending' ? 'wait' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
          }}
        >
          {shareStatus === 'sending' ? '⏳ sharing…'
            : shareStatus === 'ok' ? '✓ shared'
            : shareStatus === 'err' ? '✗ failed'
            : '⤴ share with claude'}
        </button>
      </div>

      {/* Sync status panel. Sync v2: the proposals/"viewed" leg now reports on
          the Upwork tab itself (green on-page banner) — that's where the scrape
          counts and matched/promoted numbers appear, no F12 or dashboard relay
          needed. This panel just confirms the messages (reply) leg + points the
          user to that tab. Has an × to dismiss. */}
      {syncStatus && typeof syncStatus === 'object' && (syncStatus.ok || syncStatus.err) && (
        <div style={{
          margin: '0 16px 8px', padding: '8px 12px', borderRadius: 6,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--font-mono, monospace)',
          lineHeight: 1.6, position: 'relative',
        }}>
          <button
            onClick={() => setSyncStatus(null)}
            title="Dismiss"
            style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
          >×</button>
          {syncStatus.err ? (
            <div style={{ color: '#ef4444' }}>⚠ {syncStatus.msg}</div>
          ) : (
            <>
              <div style={{ color: '#00c8d4', fontWeight: 700, marginBottom: 4 }}>
                SYNC RUNNING — both legs report on the opened Upwork tabs
              </div>
              <div style={{ color: 'var(--text2)' }}>
                Two Upwork tabs just opened, each with its own <b>green banner</b> (top-right):
                the <b>proposals</b> tab shows “viewed-by-client” counts, and the <b>messages</b>
                tab shows reply detection (conversations scanned + promoted to “replied”).
              </div>
              <div style={{ color: 'var(--text3)', marginTop: 4 }}>
                This list refreshes automatically as statuses update.
              </div>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && proposals.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>Loading…</div>
        )}
        {error && (
          <div style={{ margin: 20, padding: 12, fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 4 }}>{error}</div>
        )}
        {!loading && proposals.length === 0 && !error && (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>📬</div>
            <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
              {filter === 'awaiting'
                ? 'No cover letters are awaiting a response right now. Save a cover letter from a job to start tracking outcomes.'
                : `No cover letters with status "${filter}".`}
            </p>
          </div>
        )}

        {proposals.map(p => {
          const expanded = expandedId === p.id
          const isKb = p._source === 'kb'
          const title = p.job_title_live || (p.job_snapshot && p.job_snapshot.title) || `Job #${p.job_id}`
          const dirty = !isKb && hasUnsavedEdits(p)
          const msg = rowMsg[p.id]
          return (
            <div key={p.id} style={{ borderBottom: '1px solid var(--border)', background: expanded ? 'var(--bg2)' : 'transparent' }}>
              {/* Row header */}
              <div
                onClick={() => setExpandedId(expanded ? null : p.id)}
                style={{ padding: '12px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                {/* Status badge — uses the row's actual status (inferred for
                    KB rows from captured client/contract markers, real for
                    Proposal rows). The "captured from Upwork Messages" /
                    "from Knowledge Base" subtitle already conveys the source,
                    no need to repeat it here. */}
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                  padding: '3px 8px', borderRadius: 3, minWidth: 70, textAlign: 'center',
                  background: (STATUS_COLOR[p.status] || '#888') + '22',
                  color: (STATUS_COLOR[p.status] || '#888'),
                }}>{p.status}</span>
                {/* Analyser verdict badge — shows verdict+score at time of submission.
                    Only rendered when analysis_json was captured (new proposals). */}
                {p.analysis_json && (() => {
                  const a = p.analysis_json
                  const vc = { APPLY: '#00c8d4', MAYBE: '#f59e0b', SKIP: '#ef4444' }[a.verdict] || '#888'
                  return (
                    <span
                      title={a.summary ? `At submission: ${a.summary}` : 'Analyser verdict at time of submission'}
                      style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                        padding: '3px 7px', borderRadius: 3, cursor: 'default',
                        background: vc + '22', color: vc, whiteSpace: 'nowrap',
                      }}
                    >
                      {a.verdict}/{a.score}
                    </span>
                  )
                })()}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                    {isKb
                      ? (p._sourceUrl && /upwork\.com\/(nx\/|ab\/)?messages\/rooms/.test(p._sourceUrl)
                          ? '📩 captured from Upwork Messages'
                          : 'from Knowledge Base')
                      : `sent ${p.sent_at ? new Date(p.sent_at).toLocaleString() : '—'}`
                    }
                    {p.bid_amount && (
                      <span style={{ marginLeft: 8, color: '#00c8d4', fontWeight: 600 }}>
                        · {p.bid_amount} Connects
                      </span>
                    )}
                    {p.client_reply_text ? <span style={{ color: '#00c8d4', marginLeft: 8 }}>● response received</span> : null}
                  </div>
                  {/* Client tier badge row — sourced from job_snapshot. Each
                      badge silently omitted when its field is null so older
                      proposals with sparse snapshots stay clean. */}
                  {(() => {
                    const snap = p.job_snapshot || {}
                    const spent = snap.client_total_spent_detail
                    const hr = snap.hire_rate
                    const rating = snap.client_rating_score
                    const reviews = snap.client_review_count
                    const pay = snap.payment_verified
                    if (!spent && hr == null && !rating && pay == null) return null
                    // Hire-rate colour: ≥80 green, ≥50 amber, <50 red
                    const hrColor = hr == null ? 'var(--text3)'
                      : hr >= 80 ? '#00d070'
                      : hr >= 50 ? '#f59e0b'
                      : '#ef4444'
                    return (
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        {spent && <span title="Client total spent">💰 {spent.replace(/\s*total\s*spent\s*$/i, '')}</span>}
                        {pay === true && <span style={{ color: '#00d070' }} title="Payment verified">✓ Payment</span>}
                        {pay === false && <span style={{ color: '#ef4444' }} title="Payment NOT verified">✗ Payment</span>}
                        {rating != null && <span title={`${reviews ?? '?'} reviews`}>⭐ {rating}{reviews != null ? ` (${reviews})` : ''}</span>}
                        {hr != null && <span style={{ color: hrColor }} title="Client hire rate">{hr}% hire rate</span>}
                      </div>
                    )
                  })()}
                </div>
                {/* Open this row on Upwork — preferred source: KB sourceUrl
                    (proposal page, messages thread), else the Job's URL.
                    Routes through the extension bridge so the user's Upwork
                    session is preserved (avoids re-auth wall). */}
                {getRowUpworkUrl(p) && (
                  <button
                    onClick={e => { e.stopPropagation(); openRowOnUpwork(p) }}
                    title={bridgeReady
                      ? `Open on Upwork: ${getRowUpworkUrl(p)}`
                      : 'Open on Upwork (extension not connected — may require login)'}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text3)', fontSize: 13, padding: '0 6px',
                      lineHeight: 1, opacity: 0.55, transition: 'opacity 0.15s, color 0.15s',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#00c8d4' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = 0.55; e.currentTarget.style.color = 'var(--text3)' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                      <path d="M7 7h10v10"/><path d="M7 17 17 7"/>
                    </svg>
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); deleteRow(p) }}
                  disabled={deletingId === p.id}
                  title={isKb ? 'Delete from Knowledge Base' : 'Delete cover letter'}
                  style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 15, padding: '0 4px', lineHeight: 1, opacity: 0.5, transition: 'opacity 0.15s, color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = '#ef4444' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = 0.5; e.currentTarget.style.color = 'var(--text3)' }}
                >
                  {deletingId === p.id ? '…' : '×'}
                </button>
                <span style={{ fontSize: 14, color: 'var(--text3)', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▸</span>
              </div>

              {/* Expanded panel */}
              {expanded && (
                <div style={{ padding: '4px 20px 18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {isKb ? (
                    // KB entry — four-section read-only card
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

                      {/* ── Source info bar ──────────────────────────────── */}
                      <div style={{ fontSize: 10, color: '#a855f7', background: '#a855f711', border: '1px solid #a855f733', borderRadius: 6, padding: '6px 10px', marginBottom: 12 }}>
                        {p._sourceUrl && /upwork\.com\/(nx\/|ab\/)?messages\/rooms/.test(p._sourceUrl)
                          ? <>📩 Captured from <a href={p._sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#a855f7' }}>Upwork Messages</a> · re-capture by opening that conversation and clicking the extension</>
                          : <>Stored in Knowledge Base · edit in the <strong>Knowledge Base</strong> tab</>
                        }
                      </div>

                      {/* ── Section: Job Posting ─────────────────────────── */}
                      {p._job_posting && !p._job_posting.startsWith('(Job:') && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#f59e0b' }}>📋 Job Posting</span>
                            <div style={{ flex: 1, height: 1, background: '#f59e0b33' }} />
                          </div>
                          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 6, lineHeight: 1.65, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{p._job_posting}</div>
                        </div>
                      )}

                      {/* ── Section: Client Profile ──────────────────────── */}
                      {p._client && Object.keys(p._client).length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#06b6d4' }}>👤 Client</span>
                            <div style={{ flex: 1, height: 1, background: '#06b6d433' }} />
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {Object.entries(p._client).map(([k, v]) => (
                              <div key={k} style={{ background: '#f0fdfe', border: '1px solid #06b6d433', borderRadius: 5, padding: '5px 10px', fontSize: 11, maxWidth: '100%' }}>
                                <span style={{ color: '#0891b2', marginRight: 5, textTransform: 'capitalize', fontWeight: 600 }}>{k}:</span>
                                <span style={{ color: '#0f172a', fontWeight: 400 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Section: Cover Letter ────────────────────────── */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#00c8d4' }}>✉️ Cover Letter</span>
                          <div style={{ flex: 1, height: 1, background: '#00c8d433' }} />
                        </div>
                        <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text2)', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 6, lineHeight: 1.65, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>{p.sent_text}</div>
                      </div>

                      {/* ── Section: Messages ────────────────────────────── */}
                      {p._messages && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#a855f7' }}>💬 Messages</span>
                            <div style={{ flex: 1, height: 1, background: '#a855f733' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto', padding: '4px 2px' }}>
                            {p._messages.split(/\n---\n/).map((msg, i) => {
                              const isArtem = /^\[Artem\]/i.test(msg)
                              const text = msg.replace(/^\[(Artem|Client)\]:\s*/i, '').trim()
                              return (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isArtem ? 'flex-end' : 'flex-start' }}>
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                                    marginBottom: 3, color: isArtem ? '#0284c7' : '#64748b',
                                    paddingLeft: isArtem ? 0 : 4, paddingRight: isArtem ? 4 : 0,
                                  }}>
                                    {isArtem ? 'Artem' : 'Client'}
                                  </span>
                                  <div style={{
                                    padding: '8px 12px', fontSize: 11, lineHeight: 1.65, maxWidth: '88%',
                                    borderRadius: isArtem ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                                    background: isArtem ? '#0ea5e9' : '#f1f5f9',
                                    border: `1px solid ${isArtem ? '#0284c7' : '#e2e8f0'}`,
                                    color: isArtem ? '#fff' : '#1e293b',
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  }}>
                                    {text}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  ) : (
                    // Regular /proposals entry — fully editable
                    <>
                      {/* Status + Bid + Save row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</label>
                        <select
                          value={getEdit(p, 'status')}
                          onChange={e => setEdit(p.id, 'status', e.target.value)}
                          style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', color: 'var(--text)', cursor: 'pointer' }}
                        >
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginLeft: 6 }}>Bid</label>
                        <input
                          type="text"
                          value={getEdit(p, 'bid')}
                          onChange={e => setEdit(p.id, 'bid', e.target.value)}
                          placeholder="Connects"
                          style={{ width: 70, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', color: 'var(--text)', outline: 'none' }}
                        />
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>Connects</span>
                        <div style={{ flex: 1 }} />
                        {msg && (
                          <span style={{
                            fontSize: 10, padding: '3px 8px', borderRadius: 3, fontWeight: 600,
                            color: msg.kind === 'ok' ? '#00d070' : '#ef4444',
                            background: (msg.kind === 'ok' ? '#00d070' : '#ef4444') + '15',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                          }}>{msg.text}</span>
                        )}
                        <button
                          onClick={() => saveRow(p)}
                          disabled={!dirty || savingId === p.id}
                          style={{
                            padding: '6px 14px', fontSize: 11, fontWeight: 700,
                            background: dirty && savingId !== p.id ? '#00c8d4' : 'var(--border)',
                            color: dirty && savingId !== p.id ? '#fff' : 'var(--text3)',
                            border: 'none', borderRadius: 4,
                            cursor: dirty && savingId !== p.id ? 'pointer' : 'not-allowed',
                            textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                          }}
                        >
                          {savingId === p.id ? 'Saving…' : 'Save'}
                        </button>
                      </div>

                      {/* Analyser verdict snapshot — shown when analysis_json was
                          recorded at proposal creation time. Immutable point-in-
                          time record; never reflects post-submission re-analyses. */}
                      {p.analysis_json && (() => {
                        const a = p.analysis_json
                        const vc = { APPLY: '#00c8d4', MAYBE: '#f59e0b', SKIP: '#ef4444' }[a.verdict] || '#888'
                        return (
                          <div style={{ background: vc + '0d', border: `1px solid ${vc}33`, borderRadius: 6, padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: a.summary || (a.reasons && a.reasons.length) || (a.flags && a.flags.length) ? 8 : 0 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)' }}>🤖 Analysis at submission</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: vc }}>{a.verdict}/{a.score}</span>
                              {a.model && <span style={{ fontSize: 9, color: 'var(--text3)', opacity: 0.6 }}>{a.model}</span>}
                            </div>
                            {a.summary && <div style={{ fontSize: 11, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 }}>{a.summary}</div>}
                            {a.reasons && a.reasons.length > 0 && (
                              <ul style={{ margin: '0 0 6px 0', paddingLeft: 16, fontSize: 11, color: 'var(--text3)', lineHeight: 1.55 }}>
                                {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
                              </ul>
                            )}
                            {a.flags && a.flags.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {a.flags.map((f, i) => (
                                  <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: '#f59e0b22', color: '#f59e0b', fontWeight: 600 }}>⚑ {f}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      {/* Job Posting — read-only, sourced from the Job snapshot
                          taken at capture-time (or live Job row as fallback).
                          Skipped if no description is available (no point
                          showing an empty box). */}
                      {p._job_posting && !p._job_posting.startsWith('(Job:') && (
                        <div>
                          <label style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4, fontWeight: 700 }}>📋 Job Posting</label>
                          <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text)', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 4, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflowY: 'auto' }}>
                            {p._job_posting}
                          </div>
                        </div>
                      )}

                      {/* Client Response */}
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Client Response</label>
                        <textarea
                          value={getEdit(p, 'reply')}
                          onChange={e => setEdit(p.id, 'reply', e.target.value)}
                          placeholder="Paste the client's response here..."
                          style={{ width: '100%', minHeight: 70, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>

                      {/* Notes */}
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Notes</label>
                        <textarea
                          value={getEdit(p, 'notes')}
                          onChange={e => setEdit(p.id, 'notes', e.target.value)}
                          placeholder="What's worth remembering about this one..."
                          style={{ width: '100%', minHeight: 50, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>

                      {/* Proposal text */}
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Cover Letter</label>
                        <textarea
                          value={getEdit(p, 'sent_text')}
                          onChange={e => setEdit(p.id, 'sent_text', e.target.value)}
                          style={{ width: '100%', minHeight: 130, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 4, padding: '10px 12px', fontSize: 11, color: 'var(--text2)', fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
