import { useCallback, useEffect, useRef, useState } from 'react'

// Knowledge Base view: list of entries on the left, editor on the right.
// See DESIGN.md sections 5, 8 (Phase 2), 12 for design rationale.
//
// Phase 2 scope: manual CRUD only. Auto-capture (sent_proposal, client_reply,
// chat_transcript) lands in later phases. The taxonomy is already wired in
// (KB_TYPES) so those flows can write to the same table without UI changes.

const KB_TYPES = [
  'manual',
  'scraped',
  'sent_proposal',
  'client_reply',
  'chat_transcript',
  'rule',
  'note',
  'case_study',
  'blog_post',
]

const TYPE_COLORS = {
  manual:          '#00c8d4',
  scraped:         '#3b82f6',
  sent_proposal:   '#a855f7',
  client_reply:    '#f59e0b',
  chat_transcript: '#ec4899',
  rule:            '#ef4444',
  note:            '#6b7280',
  case_study:      '#0ea5e9',
  blog_post:       '#00d070',
}

// Display names for KB types (DB values stay unchanged)
const TYPE_DISPLAY = {
  sent_proposal:   'cover_letter',
  client_reply:    'response',
}
const displayType = (t) => TYPE_DISPLAY[t] || t

// Compact char count like "234" / "1.2k" / "12k" / "0.3M". Used on entry rows
// so Artem can spot oversized candidates before flagging them Core.
const fmtChars = (n) => {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1) + 'M'
}

// Per-entry size is informational only — the real constraint is total Core
// size (see the Core budget meter near the ★ Core filter). Some entries are
// must-haves regardless of size, so we don't flag big ones as "bad" anymore.
//   compact : ≤ 1500  (great)
//   medium  : ≤ 5000  (fine)
//   heavy   : > 5000  (neutral — weighs more in the Core budget but not bad)
const charBucket = (n) => (n <= 1500 ? 'ok' : n <= 5000 ? 'warn' : 'heavy')
const CHAR_COLORS = {
  ok:    { bg: 'rgba(0,208,112,0.12)',  fg: '#00d070' },
  warn:  { bg: 'rgba(245,158,11,0.13)', fg: '#f59e0b' },
  heavy: { bg: 'rgba(255,255,255,0.06)', fg: 'var(--text2)' },
}

// Core total budget: ~30k chars ≈ 7.5k tokens, leaves plenty of room under
// the 30k input-tokens-per-minute rate limit even at high call frequency.
const CORE_BUDGET_CHARS = 30000

const BLANK_DRAFT = {
  id: null,
  type: 'manual',
  title: '',
  content: '',
  jobPosting: '',
  tags: '',
  source_url: '',
}

// For sent_proposal entries, content is stored as:
//   ## Job Posting\n<text>\n\n## Cover Letter\n<text>
// Split it back into separate fields on load. Also accepts old "## Proposal" format.
function parseSentProposalContent(raw) {
  const match = raw.match(/^## Job Posting\n([\s\S]*?)\n\n## (?:Cover Letter|Proposal)\n([\s\S]*)$/)
  if (match) {
    return { jobPosting: match[1], content: match[2] }
  }
  return { jobPosting: '', content: raw }
}

function combineSentProposalContent(jobPosting, content) {
  if (!jobPosting.trim()) return content
  return `## Job Posting\n${jobPosting}\n\n## Cover Letter\n${content}`
}

// Phase C telemetry readout: top rule/guard checks that fired in the last 30d,
// so hardening is data-driven. Collapsible, self-contained, best-effort.
function ViolationsPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!open || data) return
    fetch('/rule-violations/stats?days=30')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
  }, [open, data])
  const Row = ({ label, items }) => (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      {(!items || !items.length) ? (
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>none recorded</div>
      ) : items.slice(0, 8).map(it => (
        <div key={it.check} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text2)', padding: '1px 0' }}>
          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{it.check}</span>
          <span style={{ fontWeight: 700, color: '#f59e0b' }}>{it.count}</span>
        </div>
      ))}
    </div>
  )
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg2)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>⚠ Top rule violations (30d)</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 10px 8px' }}>
          {!data ? <div style={{ fontSize: 10, color: 'var(--text3)' }}>loading…</div> : (
            <>
              <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 2 }}>{data.approx_runs || 0} runs · {data.total_events || 0} guard fires</div>
              <Row label="Generator" items={data.generator_top} />
              <Row label="Analyser" items={data.analyser_top} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function KnowledgeBase({ refreshTrigger = 0 }) {
  const [entries, setEntries] = useState([])
  // Backend's /chat system prompt numbers rules by id ASC. Mirror that here
  // so the UI shows the same "Rule N" Claude sees in the prompt and citations.
  // Rule badges now display the stable DB id (matches "Rule <id>" in Claude's
  // prompt after the Phase-2 routing change). No positional renumbering.
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(BLANK_DRAFT)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  // Shrink-with-AI state. shrinkResult holds the proposed replacement until
  // the user accepts (→ writes to draft.content + closes modal) or cancels.
  const [shrinking, setShrinking] = useState(false)
  const [shrinkResult, setShrinkResult] = useState(null) // {content, original_chars, shrunk_chars, ratio}
  const [shrinkError, setShrinkError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [processingFile, setProcessingFile] = useState(false)
  const [structuring, setStructuring] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null) // { entry, timerId }
  const [shareStatus, setShareStatus] = useState(null) // 'sending'|'ok'|'err'
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  // Tracks whether the user explicitly touched type / tags in the current edit session.
  // If false, save() will NOT send those fields in the PUT body so a stale draft
  // can never silently overwrite the DB values the user didn't intend to change.
  const metaTouched = useRef({ type: false, tags: false })
  // Core-only filter: when on, the list shows only entries with is_core=true.
  // Independent of typeFilter — both can be active together.
  const [coreOnly, setCoreOnly] = useState(false)
  const zipInputRef = useRef(null)
  const dragCounter = useRef(0)

  const handleZipImport = async (file) => {
    if (!file || !file.name.endsWith('.zip')) {
      setImportMsg({ kind: 'err', text: 'Please select a .zip file' })
      return
    }
    setImporting(true)
    setImportMsg({ kind: 'ok', text: `Uploading ${file.name}…` })
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/kb/bulk-import-zip', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `API ${res.status}`)
      setImportMsg({ kind: 'ok', text: `✅ Imported ${data.created} entries, skipped ${data.skipped} duplicates` })
      fetchEntries() // refresh the list
    } catch (e) {
      setImportMsg({ kind: 'err', text: '❌ ' + e.message })
    } finally {
      setImporting(false)
      if (zipInputRef.current) zipInputRef.current.value = ''
      setTimeout(() => setImportMsg(null), 8000)
    }
  }

  const handleFileDrop = async (file, resetDraft = false) => {
    setProcessingFile(true)
    setSaveMsg({ kind: 'ok', text: 'Reading file…' })
    try {
    const ext = (file.name || '').split('.').pop().toLowerCase()

    // Step 1: extract raw text
    let rawText
    if (ext === 'docx' || ext === 'pdf') {
      // PDFs: Claude reads them natively (including image-based/scanned PDFs)
      if (ext === 'pdf') setSaveMsg({ kind: 'ok', text: 'Extracting PDF with Claude… (may take up to 90s for large files)' })
      const form = new FormData()
      form.append('file', file)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 95000)
      let res
      try {
        res = await fetch('/kb/parse-file', { method: 'POST', body: form, signal: controller.signal })
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') {
          throw new Error('PDF extraction timed out (>90s). Try re-exporting from Google Docs: File → Download → PDF — make sure "Print to PDF" creates a text-based PDF, not an image scan. Or export as .docx instead.')
        }
        throw fetchErr
      } finally {
        clearTimeout(timeoutId)
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.detail || `Server error ${res.status}`)
      }
      rawText = (await res.json()).text
    } else {
      rawText = await file.text()
    }

    // Step 2: structure with Claude — delimiter-based output so long content
    // with quotes / newlines / backslashes doesn't break parsing (JSON.parse
    // previously failed on documents ~16KB+ where one character escaped wrong).
    setSaveMsg({ kind: 'ok', text: 'Structuring with AI…' })
    let title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    let content = rawText
    try {
      const claudeRes = await fetch('/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _kind: 'kb_structure',
          model: 'claude-sonnet-4-5',
          max_tokens: 8192,
          messages: [{
            role: 'user',
            content: `You are organizing content for a freelancer's knowledge base. The freelancer is Artem, a Google Ads / PPC / SEO specialist.

Given the raw document text below, do the following:
1. Write a concise, descriptive title (5–8 words, no quotes)
2. Reformat the content for maximum readability: use clear headings (## style), bullet points, short paragraphs. Preserve ALL details — do not summarize or omit anything important.
3. Add a short "## Key takeaways" section at the top (3–5 bullets) summarizing what this document is useful for.

Respond using EXACTLY this format — two sections separated by the literal marker line "===CONTENT===":

<<<TITLE>>>
<the title goes here on one line>
===CONTENT===
<the full reformatted content goes here, any length, any characters allowed, no escaping needed>

Do NOT wrap the response in markdown fences. Do NOT use JSON. Do NOT add commentary before or after.

Raw document (${file.name}):
---BEGIN RAW---
${rawText.slice(0, 60000)}
---END RAW---`,
          }],
        }),
      })
      if (claudeRes.ok) {
        const claudeData = await claudeRes.json()
        const raw = (claudeData?.content?.[0]?.text || '').trim()
        const splitIdx = raw.search(/\n\s*={3,}\s*CONTENT\s*={3,}\s*\n/i)
        if (splitIdx >= 0) {
          const titleSection = raw.slice(0, splitIdx)
          const parsedContent = raw.slice(splitIdx).replace(/^\n?\s*={3,}\s*CONTENT\s*={3,}\s*\n/i, '').trim()
          const parsedTitle = titleSection
            .replace(/<{3,}\s*TITLE\s*>{3,}/i, '')
            .split('\n').map(l => l.trim())
            .find(l => l.length > 0) || ''
          if (parsedTitle) title = parsedTitle
          if (parsedContent && parsedContent.length >= 20) content = parsedContent
        } else if (raw.length >= 20) {
          // Marker missing — use the raw response as content, keep filename title
          content = raw
        }
      }
    } catch {
      // Claude failed — fall back to raw text, title from filename
    }

    // Step 3: populate draft
    if (resetDraft) {
      setSelectedId(null)
      setDraft({ ...BLANK_DRAFT, content, title, type: 'manual' })
    } else {
      setDraft(prev => ({
        ...prev,
        content,
        title: prev.title.trim() ? prev.title : title,
      }))
    }
    setDirty(true)
    setSaveMsg(null)
    } catch (err) {
      setSaveMsg({ kind: 'err', text: String(err?.message || err || 'Unknown error') })
    } finally {
      setProcessingFile(false)
    }
  }

  // Drag counter prevents dragLeave flickering when cursor moves over child elements
  const onRootDragEnter = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    dragCounter.current += 1
    setDragOver(true)
  }
  const onRootDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onRootDragLeave = () => {
    dragCounter.current -= 1
    if (dragCounter.current === 0) setDragOver(false)
  }
  const onRootDrop = (e) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    // Support both dataTransfer.files (file system) and items (download bar)
    let file = e.dataTransfer.files?.[0]
    if (!file && e.dataTransfer.items?.[0]?.kind === 'file') {
      file = e.dataTransfer.items[0].getAsFile()
    }
    if (file) {
      handleFileDrop(file, true)
    } else {
      setSaveMsg({ kind: 'err', text: 'No file detected — try dragging from File Explorer' })
    }
  }

  const structureWithAI = async () => {
    const rawText = draft.content.trim()
    if (!rawText) return
    setStructuring(true)
    setSaveMsg({ kind: 'ok', text: 'Structuring with AI…' })
    try {
      // Delimiter-based format instead of JSON — long content fields with quotes /
      // newlines / backslashes regularly break JSON.parse (got "Unterminated string
      // at position 16550" before). Delimiters need no escaping.
      const claudeRes = await fetch('/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _kind: 'kb_structure',
          model: 'claude-sonnet-4-5',
          max_tokens: 8192,
          messages: [{
            role: 'user',
            content: `You are organising content for a freelancer's knowledge base. The freelancer is Artem, a Google Ads / PPC / SEO specialist.

Given the raw text below, do the following:
1. Write a concise, descriptive title (5–8 words, no quotes) — only if the current title is blank or very generic
2. Reformat the content for maximum readability: use clear headings (## style), bullet points, short paragraphs. Preserve ALL details — do not summarise or omit anything.
3. Add a short "## Key takeaways" section at the top (3–5 bullets) summarising what this entry is useful for.

Respond using EXACTLY this format — two sections separated by the literal marker line "===CONTENT===":

<<<TITLE>>>
<the title goes here on one line>
===CONTENT===
<the full reformatted content goes here, any length, any characters allowed, no escaping needed>

Do NOT wrap the response in markdown fences. Do NOT use JSON. Do NOT add commentary before or after.

Current title: "${draft.title.trim() || '(none)'}"

Raw text:
---BEGIN RAW---
${rawText.slice(0, 60000)}
---END RAW---`,
          }],
        }),
      })
      if (!claudeRes.ok) throw new Error('Claude API error')
      const data = await claudeRes.json()
      const raw = (data?.content?.[0]?.text || '').trim()

      // Parse: find the ===CONTENT=== marker (case-insensitive, lenient on whitespace)
      const splitIdx = raw.search(/\n\s*={3,}\s*CONTENT\s*={3,}\s*\n/i)
      let parsedTitle = ''
      let parsedContent = ''
      if (splitIdx >= 0) {
        const titleSection = raw.slice(0, splitIdx)
        parsedContent = raw.slice(splitIdx).replace(/^\n?\s*={3,}\s*CONTENT\s*={3,}\s*\n/i, '').trim()
        // Strip "<<<TITLE>>>" header line if present, then take first non-empty line
        parsedTitle = titleSection
          .replace(/<{3,}\s*TITLE\s*>{3,}/i, '')
          .split('\n')
          .map(l => l.trim())
          .find(l => l.length > 0) || ''
      } else {
        // Marker missing — fall back: treat whole response as content, keep existing title
        parsedContent = raw
      }

      if (!parsedContent || parsedContent.length < 20) {
        throw new Error(`response too short (${parsedContent.length} chars) — Claude may have failed to follow the delimiter format`)
      }

      const updates = { content: parsedContent }
      if (parsedTitle && (!draft.title.trim() || draft.title.trim().length < 5)) {
        updates.title = parsedTitle
      }
      updateDraft(updates)
      setSaveMsg({ kind: 'ok', text: 'Structured ✓' })
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveMsg({ kind: 'err', text: `Structure failed: ${e.message}` })
    } finally {
      setStructuring(false)
    }
  }

  // Friendlier error message for transient network failures (e.g. backend mid-reload).
  // Tries the fetch once; on a "Failed to fetch" TypeError, waits ~700ms and retries.
  const friendlyFetch = useCallback(async (url) => {
    const attempt = () => fetch(url)
    try {
      return await attempt()
    } catch (e) {
      // Only retry on the generic browser network TypeError, not actual HTTP errors
      if (e && e.name === 'TypeError') {
        await new Promise(r => setTimeout(r, 700))
        return attempt()
      }
      throw e
    }
  }, [])

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter)
      if (coreOnly) params.set('is_core', 'true')
      const res = await friendlyFetch('/kb?' + params.toString())
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      setEntries(data)
    } catch (e) {
      // Re-write the cryptic browser "Failed to fetch" into something users understand
      const msg = (e && e.message === 'Failed to fetch')
        ? '⚠ Backend not reachable — it may be restarting. Try again in a moment.'
        : e.message
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [query, typeFilter, coreOnly, friendlyFetch])

  // Counts for the filter pills are derived from the FULL KB (no filter applied).
  // Otherwise "all" would show only the size of the currently filtered subset.
  // `_coreChars` is the sum of all Core entries' content length — surfaced as
  // the Core budget meter, which is the actually-meaningful size constraint
  // (per-entry sizes don't matter in isolation).
  const [allCounts, setAllCounts] = useState({ all: 0, _core: 0, _coreChars: 0 })
  const fetchCounts = useCallback(async () => {
    try {
      const res = await friendlyFetch('/kb')
      if (!res.ok) return
      const data = await res.json()
      const counts = { all: data.length, _core: 0, _coreChars: 0 }
      for (const e of data) {
        counts[e.type] = (counts[e.type] || 0) + 1
        if (e.is_core) {
          counts._core += 1
          counts._coreChars += (e.content || '').length
        }
      }
      setAllCounts(counts)
    } catch {}
  }, [friendlyFetch])

  useEffect(() => { fetchEntries() }, [fetchEntries, refreshTrigger])
  // Refresh counts on mount, when external refreshTrigger fires, AND whenever the
  // entries length changes (cheap proxy for "something was added or removed").
  useEffect(() => { fetchCounts() }, [fetchCounts, refreshTrigger, entries.length])

  // When the selection changes, load that entry into the draft.
  // Note: this effect also re-fires whenever `entries` is a new reference
  // (e.g. background refetch). If the user has unsaved edits we must NOT
  // overwrite their work — the dirty flag is the guard. The fresh-selection
  // case still works because the prior selection's effect run set dirty=false.
  useEffect(() => {
    if (selectedId == null) {
      // Don't trample a fresh + New draft (startNew sets selectedId=null AND dirty=true)
      if (!dirty) {
        setDraft(BLANK_DRAFT)
      }
      return
    }
    // Same entry is selected and the user has unsaved edits → preserve them.
    // This is what stops a background entries refetch (e.g. after Save elsewhere
    // or a Core toggle that returns a new entries reference) from wiping the
    // post-Shrink draft.
    if (dirty && draft.id === selectedId) return
    const found = entries.find(e => e.id === selectedId)
    if (found) {
      const rawContent = found.content || ''
      const safeType = KB_TYPES.includes(found.type) ? found.type : 'manual'
      const isSentProposal = safeType === 'sent_proposal'
      const { jobPosting, content } = isSentProposal
        ? parseSentProposalContent(rawContent)
        : { jobPosting: '', content: rawContent }
      setDraft({
        id: found.id,
        type: safeType,
        title: found.title || '',
        content,
        jobPosting,
        tags: found.tags || '',
        source_url: found.source_url || '',
      })
      setDirty(false)
      metaTouched.current = { type: false, tags: false }
    }
  }, [selectedId, entries, dirty, draft.id])

  const updateDraft = (patch) => {
    setDraft(prev => ({ ...prev, ...patch }))
    setDirty(true)
    setSaveMsg(null)
    if ('type' in patch) metaTouched.current.type = true
    if ('tags' in patch) metaTouched.current.tags = true
  }

  const startNew = () => {
    setSelectedId(null)
    setDraft({ ...BLANK_DRAFT })
    setDirty(true)
    setSaveMsg(null)
    metaTouched.current = { type: false, tags: false }
  }

  // save() takes optional `overrides` so callers (e.g. acceptShrink) can save
  // values that aren't yet committed to draft state — bypassing the setState
  // batching delay. Without this, "accept shrink + auto-save" would save the
  // OLD content because draft hadn't re-rendered yet.
  const save = async (overrides = {}) => {
    const eff = { ...draft, ...overrides }
    if (!eff.title.trim() || !eff.content.trim()) {
      setSaveMsg({ kind: 'err', text: 'Title and content are required' })
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      const finalContent = eff.type === 'sent_proposal'
        ? combineSentProposalContent(eff.jobPosting, eff.content.trim())
        : eff.content.trim()
      const isNew = !eff.id
      const body = {
        title: eff.title.trim(),
        content: finalContent,
        source_url: (eff.source_url || '').trim() || null,
      }
      // For new entries always include type + tags.
      // For existing entries only include them if the user explicitly changed them
      // via the form — this prevents a stale draft from silently overwriting the
      // DB values the user never intended to touch (e.g. editing content on a
      // 'rule' entry whose draft somehow loaded as 'manual').
      if (isNew || metaTouched.current.type) {
        body.type = KB_TYPES.includes(eff.type) ? eff.type : 'manual'
      }
      if (isNew || metaTouched.current.tags) {
        body.tags = (eff.tags || '').trim() || null
      }
      const url = eff.id ? `/kb/${eff.id}` : '/kb'
      const method = eff.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.detail || `API ${res.status}`)
      }
      const saved = await res.json()
      await fetchEntries()
      // Refresh the Core meter — fetchCounts is otherwise only re-triggered
      // when entries.length changes (creating/deleting), so edits to existing
      // Core entries (especially shrinks) wouldn't update the chip.
      fetchCounts()
      setSelectedId(saved.id)
      setDirty(false)
      metaTouched.current = { type: false, tags: false }
      setSaveMsg({ kind: 'ok', text: eff.id ? 'Updated' : 'Created' })
    } catch (e) {
      setSaveMsg({ kind: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = (entry) => {
    // Cancel any previous pending delete immediately
    if (pendingDelete) {
      clearTimeout(pendingDelete.timerId)
      fetch(`/kb/${pendingDelete.entry.id}`, { method: 'DELETE' })
    }
    // Optimistically remove from list
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    if (selectedId === entry.id) { setSelectedId(null); setDraft(BLANK_DRAFT); setDirty(false) }
    // Schedule actual deletion after 5s
    const timerId = setTimeout(async () => {
      await fetch(`/kb/${entry.id}`, { method: 'DELETE' })
      setPendingDelete(null)
    }, 15000)
    setPendingDelete({ entry, timerId })
  }

  const undoDelete = () => {
    if (!pendingDelete) return
    clearTimeout(pendingDelete.timerId)
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id > pendingDelete.entry.id)
      const next = [...prev]
      idx === -1 ? next.push(pendingDelete.entry) : next.splice(idx, 0, pendingDelete.entry)
      return next
    })
    setPendingDelete(null)
  }

  // If component unmounts with a pending delete, fire it immediately
  useEffect(() => () => {
    if (pendingDelete) {
      clearTimeout(pendingDelete.timerId)
      fetch(`/kb/${pendingDelete.entry.id}`, { method: 'DELETE' })
    }
  }, [pendingDelete])

  // DEBUG: log every draft.content length change. Lets us confirm whether
  // setDraft is actually propagating to a re-render or being silently lost.
  useEffect(() => {
    console.log('[KB] draft state — id:', draft.id, 'content.length:', (draft.content || '').length, 'dirty:', dirty)
  }, [draft.id, draft.content, dirty])

  const remove = () => { if (draft.id) deleteEntry(entries.find(e => e.id === draft.id)) }

  // ── Shrink-with-AI ────────────────────────────────────────────────────────
  // Sends the current draft body to Claude via /kb/shrink and shows the
  // proposed replacement in a preview modal. The draft is NOT mutated until
  // the user clicks Accept — this keeps the action undoable.
  const shrinkWithAI = async () => {
    if (shrinking) return
    setShrinkError(null)
    setShrinking(true)
    try {
      // For sent_proposal, shrink the combined body (jobPosting + content);
      // we'll re-split on accept so the editor's two-textarea layout still works.
      const body = draft.type === 'sent_proposal'
        ? combineSentProposalContent(draft.jobPosting, draft.content)
        : (draft.content || '')

      if (body.length < 500) {
        setShrinking(false)
        setShrinkError('Entry is too small to shrink meaningfully.')
        return
      }

      // Target ~60% of current size, capped at the per-entry "tight" threshold (1.5k).
      // For very large entries this still gives Claude room — 60% of 10k is 6k.
      const target = Math.max(800, Math.min(1500, Math.round(body.length * 0.6)))

      const res = await fetch('/kb/shrink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: body,
          title: draft.title || '',
          type: draft.type || 'manual',
          target_chars: target,
        }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error('API ' + res.status + ': ' + txt.slice(0, 200))
      }
      const data = await res.json()
      setShrinkResult(data)
    } catch (e) {
      setShrinkError(e.message || String(e))
    } finally {
      setShrinking(false)
    }
  }

  const acceptShrink = async () => {
    if (!shrinkResult) return
    const newContent = shrinkResult.content
    // Build the overrides for save() and also update local draft so the editor
    // reflects the new content immediately. save() reads from overrides so it
    // doesn't depend on setState being flushed first.
    let overrides
    if ((draft.type || 'manual') === 'sent_proposal') {
      const parsed = parseSentProposalContent(newContent)
      overrides = { jobPosting: parsed.jobPosting, content: parsed.content }
    } else {
      overrides = { content: newContent }
    }
    // Optimistic draft update for the editor UI
    setDraft(prev => ({ ...prev, ...overrides }))
    setShrinkResult(null)
    setShrinkError(null)
    console.log('[KB] Accept shrink → new draft content length:', newContent.length)
    // Auto-persist: avoids the redundant Update click. save() refreshes the
    // entries list AND the Core meter, so the sidebar chars badge and the
    // red 32k/30k chip both reflect the shrunk size immediately.
    try {
      await save(overrides)
    } catch (e) {
      // save() already surfaces errors via setSaveMsg, but log here so we
      // know if the auto-save path itself blew up.
      console.error('[KB] Auto-save after shrink failed:', e)
    }
  }

  const cancelShrink = () => {
    setShrinkResult(null)
    setShrinkError(null)
  }

  // Flip the is_core flag on an entry. Optimistic update so the star UI feels
  // snappy; on error the list refetch repairs any drift.
  const toggleCore = async (entry) => {
    const next = !entry.is_core
    const delta = (entry.content || '').length * (next ? 1 : -1)
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, is_core: next } : e))
    setAllCounts(prev => ({
      ...prev,
      _core: (prev._core || 0) + (next ? 1 : -1),
      _coreChars: Math.max(0, (prev._coreChars || 0) + delta),
    }))
    try {
      const res = await fetch(`/kb/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_core: next }),
      })
      if (!res.ok) throw new Error('API ' + res.status)
    } catch {
      // Refetch to repair the UI on failure
      fetchEntries()
      fetchCounts()
    }
  }

  // (legacy `typeCounts` derived from filtered entries removed — see `allCounts` above)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}
      onDragEnter={onRootDragEnter}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={onRootDrop}
    >
      {/* Undo toast */}
      {pendingDelete && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 100, display: 'flex', alignItems: 'center', gap: 12,
          background: '#0d2040', color: '#e0ecf7', borderRadius: 4,
          padding: '10px 16px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          whiteSpace: 'nowrap',
        }}>
          <span>Deleted <strong>"{pendingDelete.entry.title}"</strong></span>
          <button
            onClick={undoDelete}
            style={{
              background: '#00c8d4', color: '#fff', border: 'none', borderRadius: 4,
              padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
            }}
          >Undo</button>
        </div>
      )}
      {/* LEFT: list */}
      <aside style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ViolationsPanel />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(() => {
              // When any filter is active (search query, type, or Core), show the
              // count as a filtered RESULT count ("N found of TOTAL") so it's clear
              // the number reflects a search, not the whole KB. Otherwise show the
              // plain total.
              const filtering = !!query || (typeFilter && typeFilter !== 'all') || coreOnly
              const total = allCounts.all || entries.length
              if (filtering) {
                return (
                  <span style={{ fontSize: 10, color: query ? '#00c8d4' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: query ? 700 : 400 }}>
                    {entries.length} {entries.length === 1 ? 'result' : 'results'}
                    {query ? <span style={{ color: 'var(--text3)', fontWeight: 400 }}> for “{query}”</span> : null}
                    <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · of {total}</span>
                  </span>
                )
              }
              return (
                <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </span>
              )
            })()}
            <button
              onClick={startNew}
              style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 10, fontWeight: 700, background: '#00c8d4', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit' }}
            >
              + New
            </button>
            <button
              onClick={() => zipInputRef.current && zipInputRef.current.click()}
              disabled={importing}
              title="Bulk-import a .zip of .md files"
              style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, background: importing ? 'var(--border)' : '#0ea5e9', color: importing ? 'var(--text3)' : '#fff', border: 'none', borderRadius: 4, cursor: importing ? 'default' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit' }}
            >
              {importing ? '⏳' : '⬆ ZIP'}
            </button>
            <input ref={zipInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleZipImport(e.target.files[0])} />
            <button
              onClick={async () => {
                setShareStatus('sending')
                try {
                  const selected = selectedId ? entries.find(e => e.id === selectedId) : null
                  const res = await fetch('/share-with-claude', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      kind: 'kb',
                      entry: selected || null,
                      draft: draft,
                      filter_type: typeFilter,
                      query: query,
                      list_summary: { count: entries.length },
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
              }}
              disabled={shareStatus === 'sending'}
              title="Snapshot the selected KB entry (and current draft/filter) to share-with-claude.md"
              style={{
                padding: '5px 10px', fontSize: 10, fontWeight: 700,
                background: shareStatus === 'ok' ? '#00d070'
                  : shareStatus === 'err' ? '#e05050'
                  : shareStatus === 'sending' ? 'var(--border)' : 'var(--bg)',
                color: (shareStatus === 'ok' || shareStatus === 'err') ? '#fff'
                  : shareStatus === 'sending' ? 'var(--text3)' : 'var(--text2)',
                border: '1px solid ' + (shareStatus === 'ok' ? '#00d070' : shareStatus === 'err' ? '#e05050' : 'var(--border2)'),
                borderRadius: 4, cursor: shareStatus === 'sending' ? 'wait' : 'pointer',
                textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
              }}
            >
              {shareStatus === 'sending' ? '⏳' : shareStatus === 'ok' ? '✓ shared' : shareStatus === 'err' ? '✗ failed' : '⤴ share'}
            </button>
          </div>
          {importMsg && (
            <div style={{ fontSize: 11, padding: '6px 10px', borderRadius: 4, background: importMsg.kind === 'ok' ? 'rgba(0,200,212,0.10)' : 'rgba(239,68,68,0.1)', color: importMsg.kind === 'ok' ? '#00c8d4' : '#ef4444', border: `1px solid ${importMsg.kind === 'ok' ? 'rgba(0,200,212,0.30)' : 'rgba(239,68,68,0.3)'}` }}>
              {importMsg.text}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
            <input
              type="search"
              placeholder="Search KB..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontSize: 11, padding: '8px 10px 8px 32px', borderRadius: 4, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Core toggle pill — orthogonal to type filter, both can apply together */}
            <button
              onClick={() => setCoreOnly(v => !v)}
              title="Show only Core entries — the curated subset used by Rescan & Re-write"
              style={{
                padding: '3px 10px', fontSize: 10, fontFamily: 'Inter, sans-serif', borderRadius: 20,
                border: '1px solid ' + (coreOnly ? '#f59e0b' : 'var(--border2)'),
                background: coreOnly ? 'rgba(245,158,11,0.15)' : 'var(--bg)',
                color: coreOnly ? '#f59e0b' : 'var(--text2)',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700,
              }}
            >
              ★ Core {allCounts._core ? `(${allCounts._core})` : ''}
            </button>
            {/* Core budget meter — the size that ACTUALLY matters (Core total
                gets injected on every Rescan call). Per-entry size is just an
                input to this. */}
            {allCounts._core > 0 && (() => {
              const used = allCounts._coreChars || 0
              const pct = Math.min(100, Math.round((used / CORE_BUDGET_CHARS) * 100))
              // Color escalates as Core grows: <70% green, <100% amber, ≥100% red
              const overBudget = used > CORE_BUDGET_CHARS
              const nearBudget = !overBudget && used > CORE_BUDGET_CHARS * 0.7
              const fg = overBudget ? '#ef4444' : nearBudget ? '#f59e0b' : '#00d070'
              const bg = overBudget ? 'rgba(239,68,68,0.12)' : nearBudget ? 'rgba(245,158,11,0.12)' : 'rgba(0,208,112,0.10)'
              return (
                <span
                  title={`Core total: ${used.toLocaleString()} / ${CORE_BUDGET_CHARS.toLocaleString()} chars (~${Math.round(used/4).toLocaleString()} tokens). Budget is a soft guide — over-budget Core slows Rescan and burns more tokens but won't fail.`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '3px 8px', fontSize: 10, fontFamily: 'Inter, sans-serif',
                    borderRadius: 20, border: '1px solid ' + fg + '44',
                    background: bg, color: fg, letterSpacing: '0.04em', fontWeight: 700,
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                    {fmtChars(used)} / {fmtChars(CORE_BUDGET_CHARS)}
                  </span>
                  <span style={{
                    width: 36, height: 4, borderRadius: 2,
                    background: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden',
                  }}>
                    <span style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      width: pct + '%', background: fg, transition: 'width 0.3s ease',
                    }} />
                  </span>
                </span>
              )
            })()}
            {(() => {
              // "Nothing filtered" state — used to decide whether the ALL chip
              // should look active. It now means "literally everything visible",
              // not "type filter is set to all" (the old behaviour was confusing
              // because ALL would highlight even while Core/query were filtering).
              const allCleared = typeFilter === 'all' && !coreOnly && !query
              return ['all', ...KB_TYPES].map((t) => {
                const active = t === 'all' ? allCleared : typeFilter === t
                const onClick = () => {
                  if (t === 'all') {
                    // ALL = full reset. Always clears every filter regardless
                    // of current state.
                    setTypeFilter('all')
                    setCoreOnly(false)
                    setQuery('')
                  } else if (active) {
                    // Toggle this type filter off — revert to 'all' (Core untouched)
                    setTypeFilter('all')
                  } else {
                    setTypeFilter(t)
                  }
                }
                return (
                  <button
                    key={t}
                    onClick={onClick}
                    title={t === 'all'
                      ? (active ? 'No filters applied' : 'Click to clear all filters (type, Core, search)')
                      : (active ? `Click to remove the ${displayType(t)} filter` : `Filter to ${displayType(t)}`)}
                    style={{
                      padding: '3px 8px', fontSize: 10, fontFamily: 'Inter, sans-serif', borderRadius: 20,
                      border: '1px solid ' + (active ? 'rgba(0,200,212,0.50)' : 'var(--border2)'),
                      background: active ? 'rgba(0,200,212,0.14)' : 'var(--bg)',
                      color: active ? '#00c8d4' : 'var(--text2)',
                      cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}
                  >
                    {displayType(t)} {allCounts[t] ? `(${allCounts[t]})` : ''}
                  </button>
                )
              })
            })()}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && entries.length === 0 && (
            <div style={{ padding: 24, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>Loading…</div>
          )}
          {error && (
            <div style={{ padding: 12, fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.08)', margin: 12, borderRadius: 4 }}>
              {error}
            </div>
          )}
          {!loading && entries.length === 0 && !error && (
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12, opacity: 0.3 }}>📚</div>
              <p style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
                {query || typeFilter !== 'all' ? 'No entries match.' : 'KB is empty. Click + New to add one.'}
              </p>
            </div>
          )}
          {entries.map((e) => (
            <div
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className="kb-entry-row"
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: selectedId === e.id ? 'var(--bg3, #e6f4f4)' : 'transparent',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                  padding: '2px 6px', borderRadius: 3,
                  background: (TYPE_COLORS[e.type] || '#888') + '22',
                  color: TYPE_COLORS[e.type] || '#888',
                }}>{displayType(e.type)}</span>
                {(() => {
                  const len = (e.content || '').length
                  const c = CHAR_COLORS[charBucket(len)]
                  return (
                    <span
                      title={`${len.toLocaleString()} characters — green ≤1.5k (tight), amber ≤5k (workable), red >5k (too big for Core)`}
                      style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                        background: c.bg, color: c.fg, letterSpacing: '0.04em',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >{fmtChars(len)}</span>
                  )
                })()}
                {e.is_core && (
                  <span title="Core entry — used by Rescan & Re-write" style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                    background: 'rgba(245,158,11,0.15)', color: '#f59e0b', letterSpacing: '0.08em',
                  }}>★ CORE</span>
                )}
                {e.tags && (
                  <span style={{ fontSize: 9, color: 'var(--text3)', letterSpacing: '0.04em' }}>{e.tags}</span>
                )}
                <button
                  onClick={(ev) => {
                    ev.stopPropagation()
                    // Rules are implicitly Core — don't allow toggling them off.
                    if (e.type === 'rule') return
                    toggleCore(e)
                  }}
                  title={
                    e.type === 'rule'
                      ? 'Rules are always Core (cannot be removed)'
                      : e.is_core ? 'Remove from Core' : 'Send to Core (used by Rescan & Re-write)'
                  }
                  style={{
                    marginLeft: 'auto', background: 'none', border: 'none',
                    cursor: e.type === 'rule' ? 'default' : 'pointer',
                    color: e.is_core ? '#f59e0b' : 'var(--text3)',
                    fontSize: 14, lineHeight: 1, padding: '0 3px',
                    // Always visible at low opacity for non-Core so the affordance
                    // is discoverable; full brightness on hover or when Core.
                    opacity: e.is_core ? 1 : 0.35, transition: 'opacity 0.15s, color 0.15s',
                  }}
                  className="kb-core-btn"
                >{e.is_core ? '★' : '☆'}</button>
                <button
                  onClick={(ev) => { ev.stopPropagation(); deleteEntry(e) }}
                  title="Delete"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text3)', fontSize: 14, lineHeight: 1, padding: '0 2px',
                    opacity: 0, transition: 'opacity 0.15s',
                  }}
                  className="kb-delete-btn"
                >×</button>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2, lineHeight: 1.3 }}>
                {e.type === 'rule' && (
                  <span
                    title={`Rule ${e.id} — stable KB id, matches "Rule ${e.id}" in Claude's prompt`}
                    style={{
                      display: 'inline-block', marginRight: 6,
                      fontSize: 11, fontWeight: 800, color: '#ef4444',
                      background: 'rgba(239,68,68,0.12)',
                      padding: '1px 6px', borderRadius: 3,
                      letterSpacing: '0.02em',
                    }}>#{e.id}</span>
                )}
                {e.title}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {(e.content || '').replace(/\s+/g, ' ').slice(0, 90)}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* RIGHT: editor */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        {processingFile ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text3)' }}>
            <div style={{ fontSize: 28, animation: 'spin 1s linear infinite' }}>⟳</div>
            <div style={{ fontSize: 12, color: '#00c8d4', fontWeight: 600 }}>{saveMsg?.text || 'Processing…'}</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>Claude is structuring your document</div>
          </div>
        ) : (selectedId == null && !dirty) ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', border: dragOver ? '2px dashed #00c8d4' : 'none', background: dragOver ? 'rgba(0,200,212,0.05)' : 'transparent' }}>
            {dragOver
              ? <span style={{ color: '#00c8d4', fontWeight: 700 }}>Drop file to import</span>
              : saveMsg
                ? <span style={{ fontSize: 11, color: saveMsg.kind === 'err' ? '#ef4444' : '#00c8d4', fontWeight: 600, textTransform: 'none' }}>{saveMsg.text}</span>
                : <>
                    <span>Select an entry or click + New</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>Drop .txt, .md, .docx, or .pdf — Claude will extract and structure it</span>
                  </>
            }
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Editor header */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <select
                value={draft.type}
                onChange={(e) => {
                  const newType = e.target.value
                  // If switching away from sent_proposal, merge jobPosting back into content so nothing is lost
                  if (draft.type === 'sent_proposal' && newType !== 'sent_proposal') {
                    updateDraft({ type: newType, content: combineSentProposalContent(draft.jobPosting, draft.content), jobPosting: '' })
                  } else if (newType === 'sent_proposal' && draft.type !== 'sent_proposal') {
                    // Parse existing content in case user switched to sent_proposal
                    const { jobPosting, content } = parseSentProposalContent(draft.content)
                    updateDraft({ type: newType, jobPosting, content })
                  } else {
                    updateDraft({ type: newType })
                  }
                }}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '4px 8px', fontSize: 11, fontFamily: 'inherit', color: 'var(--text)', cursor: 'pointer' }}
              >
                {KB_TYPES.map((t) => <option key={t} value={t}>{displayType(t)}</option>)}
              </select>
              <input
                type="text"
                placeholder="Title"
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
                style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '6px 10px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', color: 'var(--text)', outline: 'none' }}
              />
              {/* Send to / Remove from Core — only for saved entries; rules are
                  always Core implicitly so the button reflects that locked state. */}
              {draft.id && (() => {
                const current = entries.find(en => en.id === draft.id)
                if (!current) return null
                const isRule = (current.type || draft.type) === 'rule'
                const onCore = !!current.is_core
                return (
                  <button
                    onClick={() => { if (!isRule) toggleCore(current) }}
                    disabled={isRule}
                    title={isRule ? 'Rules are always Core' : (onCore ? 'Remove from Core' : 'Send to Core — entries here are used by Rescan & Re-write')}
                    style={{
                      padding: '6px 12px', fontSize: 11, fontWeight: 700,
                      background: onCore ? 'rgba(245,158,11,0.15)' : 'transparent',
                      color: onCore ? '#f59e0b' : 'var(--text2)',
                      border: '1px solid ' + (onCore ? '#f59e0b' : 'var(--border2)'),
                      borderRadius: 4,
                      cursor: isRule ? 'default' : 'pointer',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      fontFamily: 'inherit',
                      opacity: isRule ? 0.7 : 1,
                    }}
                  >
                    {onCore ? '★ Core' : '☆ Add to Core'}
                  </button>
                )
              })()}
              <button
                onClick={save}
                disabled={saving || !dirty}
                style={{
                  padding: '6px 14px', fontSize: 11, fontWeight: 700,
                  background: dirty && !saving ? '#00c8d4' : 'var(--border)',
                  color: dirty && !saving ? '#fff' : 'var(--text3)',
                  border: 'none', borderRadius: 4,
                  cursor: dirty && !saving ? 'pointer' : 'not-allowed',
                  textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                }}
              >
                {saving ? 'Saving…' : draft.id ? 'Update' : 'Create'}
              </button>
              {draft.id && (
                <button
                  onClick={remove}
                  style={{ padding: '6px 10px', fontSize: 11, background: 'transparent', color: '#ef4444', border: '1px solid #ef444455', borderRadius: 4, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit' }}
                >
                  Delete
                </button>
              )}
            </div>

            {/* Meta row */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
              {(() => {
                // Live count of the body the user will save — for sent_proposal
                // entries that's jobPosting + content combined.
                const len = (draft.type === 'sent_proposal'
                  ? combineSentProposalContent(draft.jobPosting, draft.content)
                  : draft.content || ''
                ).length
                const c = CHAR_COLORS[charBucket(len)]
                // Shrink is most useful on amber/red entries (≥1500 chars).
                // Below that, manual editing is faster than a Claude round-trip.
                const canShrink = len >= 1500 && !shrinking
                return (
                  <>
                    <span
                      title={`${len.toLocaleString()} characters — green ≤1.5k (tight, fine for Core), amber ≤5k (workable but consider trimming), red >5k (too big to keep in Core)`}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 3,
                        background: c.bg, color: c.fg, letterSpacing: '0.05em',
                        fontFamily: 'var(--font-mono, monospace)', flexShrink: 0,
                      }}
                    >{fmtChars(len)} chars</span>
                    <button
                      onClick={shrinkWithAI}
                      disabled={!canShrink}
                      title={
                        shrinking
                          ? 'Compressing…'
                          : len < 1500
                            ? 'Shrink is available for entries ≥1.5k chars (smaller is faster to edit by hand)'
                            : 'Compress this entry with Claude — keeps every fact, drops filler. Preview before accepting.'
                      }
                      style={{
                        padding: '3px 10px', fontSize: 10, fontWeight: 700,
                        background: shrinking ? 'rgba(0,200,212,0.10)' : canShrink ? 'transparent' : 'transparent',
                        color: shrinking ? '#00c8d4' : canShrink ? '#00c8d4' : 'var(--text3)',
                        border: '1px solid ' + (canShrink || shrinking ? 'rgba(0,200,212,0.45)' : 'var(--border)'),
                        borderRadius: 3, cursor: canShrink ? 'pointer' : 'not-allowed',
                        textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                        opacity: canShrink || shrinking ? 1 : 0.4,
                        flexShrink: 0,
                      }}
                    >{shrinking ? '⏳ shrinking…' : '↓ shrink'}</button>
                  </>
                )
              })()}
              <input
                type="text"
                placeholder="Tags (comma separated)"
                value={draft.tags}
                onChange={(e) => updateDraft({ tags: e.target.value })}
                style={{ flex: 1, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 10px', fontSize: 11, fontFamily: 'inherit', color: 'var(--text)', outline: 'none' }}
              />
              <input
                type="text"
                placeholder="Source URL (optional)"
                value={draft.source_url}
                onChange={(e) => updateDraft({ source_url: e.target.value })}
                style={{ flex: 2, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 10px', fontSize: 11, fontFamily: 'inherit', color: 'var(--text)', outline: 'none' }}
              />
              <button
                onClick={structureWithAI}
                disabled={structuring || !draft.content.trim()}
                title="Let Claude reformat this text into clean structured markdown with headings and key takeaways"
                style={{
                  padding: '5px 12px', fontSize: 10, fontWeight: 700, fontFamily: 'inherit',
                  background: structuring || !draft.content.trim() ? 'var(--bg3)' : 'rgba(0,200,212,0.10)',
                  color: structuring || !draft.content.trim() ? 'var(--text3)' : '#00c8d4',
                  border: '1px solid ' + (structuring || !draft.content.trim() ? 'var(--border)' : 'rgba(0,200,212,0.35)'),
                  borderRadius: 4, cursor: structuring || !draft.content.trim() ? 'default' : 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {structuring ? '…structuring' : '✦ Structure'}
              </button>
              {saveMsg && !processingFile && (
                <span style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 3, fontWeight: 600,
                  color: saveMsg.kind === 'ok' ? '#00d070' : '#ef4444',
                  background: (saveMsg.kind === 'ok' ? '#00d070' : '#ef4444') + '15',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{saveMsg.text}</span>
              )}
            </div>

            {/* Content editor + drop zone */}
            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {dragOver && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 10,
                  background: 'rgba(0,200,212,0.08)',
                  border: '2px dashed #00c8d4',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <span style={{ fontSize: 13, color: '#00c8d4', fontWeight: 600 }}>Drop file to import</span>
                </div>
              )}
              {draft.type === 'sent_proposal' ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Job Posting section */}
                  <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px 24px 4px', fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                      Job Posting
                    </div>
                    <textarea
                      value={draft.jobPosting}
                      onChange={(e) => updateDraft({ jobPosting: e.target.value })}
                      placeholder="Paste the original job posting here for context…"
                      spellCheck="true"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      style={{
                        height: 160, padding: '8px 24px 16px', resize: 'none', outline: 'none',
                        border: 'none', background: 'var(--bg2)', color: 'var(--text)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 12, lineHeight: 1.6, boxSizing: 'border-box', width: '100%',
                      }}
                    />
                  </div>
                  {/* Cover Letter section */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 24px 4px', flexShrink: 0, fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                      Cover Letter
                    </div>
                    <textarea
                      value={draft.content}
                      onChange={(e) => updateDraft({ content: e.target.value })}
                      placeholder="Paste the cover letter you sent…"
                      spellCheck="true"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      style={{
                        flex: 1, padding: '8px 24px 20px', resize: 'none', outline: 'none',
                        border: 'none', background: 'var(--bg)', color: 'var(--text)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 13, lineHeight: 1.6, boxSizing: 'border-box', width: '100%',
                      }}
                    />
                  </div>
                </div>
              ) : (
                <textarea
                  value={draft.content}
                  onChange={(e) => updateDraft({ content: e.target.value })}
                  placeholder="Write the knowledge here, or drop a .txt / .md file…"
                  spellCheck="true"
                  // Disable Grammarly/Wordtune/etc. — they intercept controlled
                  // textareas and can revert programmatic value changes (e.g.
                  // the Shrink accept flow) by re-emitting their own input events
                  // with the previous content. See chrome-extension Grammarly.js.
                  data-gramm="false"
                  data-gramm_editor="false"
                  data-enable-grammarly="false"
                  style={{
                    flex: 1, padding: '20px 24px', resize: 'none', outline: 'none',
                    border: 'none', background: 'var(--bg)', color: 'var(--text)',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13, lineHeight: 1.6, boxSizing: 'border-box', width: '100%',
                  }}
                />
              )}
              {/* File picker for click-to-upload */}
              <label style={{
                position: 'absolute', bottom: 12, right: 16,
                fontSize: 10, color: 'var(--text3)', cursor: 'pointer',
                background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '3px 8px', letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                ↑ Import file
                <input
                  type="file"
                  accept=".txt,.md,.csv,.json,.docx,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files[0]) handleFileDrop(e.target.files[0]) }}
                />
              </label>
            </div>
          </div>
        )}
      </main>

      {/* Shrink preview modal — appears when shrinkResult is set. */}
      {(shrinkResult || shrinkError) && (
        <div
          onClick={cancelShrink}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(6, 21, 37, 0.78)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 8, width: '100%', maxWidth: 900, maxHeight: '85vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {/* Header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#00c8d4', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                ↓ Shrink preview
              </span>
              {shrinkResult && (() => {
                const before = shrinkResult.original_chars
                const after = shrinkResult.shrunk_chars
                const saved = before - after
                const pct = before > 0 ? Math.round((saved / before) * 100) : 0
                return (
                  <span style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--font-mono, monospace)' }}>
                    {fmtChars(before)} → <strong style={{ color: '#00d070' }}>{fmtChars(after)}</strong>
                    <span style={{ marginLeft: 8, color: pct > 0 ? '#00d070' : '#f59e0b' }}>
                      {pct > 0 ? `−${pct}% (saved ${fmtChars(saved)})` : 'no reduction'}
                    </span>
                  </span>
                )
              })()}
              <button
                onClick={cancelShrink}
                style={{
                  marginLeft: 'auto', background: 'none', border: 'none',
                  color: 'var(--text3)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 4px',
                }}
                title="Close"
              >×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {shrinkError ? (
                <div style={{ color: '#ef4444', fontSize: 12, padding: 16, background: 'rgba(239,68,68,0.08)', borderRadius: 4 }}>
                  Shrink failed: {shrinkError}
                </div>
              ) : (
                <textarea
                  value={shrinkResult.content}
                  onChange={(e) => setShrinkResult(prev => prev ? { ...prev, content: e.target.value, shrunk_chars: e.target.value.length } : prev)}
                  style={{
                    width: '100%', minHeight: 360, maxHeight: '60vh',
                    background: 'var(--bg)', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    padding: 12, fontSize: 12, lineHeight: 1.6,
                    fontFamily: 'var(--font-mono, monospace)',
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  }}
                  spellCheck={false}
                />
              )}
              {shrinkResult && (
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, lineHeight: 1.5 }}>
                  Review the compressed version above — you can edit it before accepting.
                  Accept replaces the entry's content (you still need to click <strong>Update</strong> to persist).
                  Cancel keeps the original untouched.
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={cancelShrink}
                style={{
                  padding: '6px 14px', fontSize: 11, fontWeight: 700,
                  background: 'transparent', color: 'var(--text2)',
                  border: '1px solid var(--border2)', borderRadius: 4, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                }}
              >Cancel</button>
              {shrinkResult && !shrinkError && (
                <button
                  onClick={acceptShrink}
                  disabled={saving}
                  title="Replace the entry with the compressed text and save immediately"
                  style={{
                    padding: '6px 16px', fontSize: 11, fontWeight: 700,
                    background: saving ? 'var(--border)' : '#00c8d4',
                    color: '#fff',
                    border: 'none', borderRadius: 4,
                    cursor: saving ? 'wait' : 'pointer',
                    textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                  }}
                >{saving ? 'Saving…' : 'Accept & Save'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
