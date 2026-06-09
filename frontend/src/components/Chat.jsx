import { useCallback, useEffect, useRef, useState } from 'react'

const KB_TYPES = ['manual', 'rule', 'note', 'sent_proposal', 'client_reply']

export default function Chat({ job = null }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  // candidates: null = idle, [] = all done, [...] = reviewing
  const [candidates, setCandidates] = useState(null)
  const [distilling, setDistilling] = useState(false)
  const [savingTranscript, setSavingTranscript] = useState(false)
  const [flashMsg, setFlashMsg] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // Focus input on mount / job change
  useEffect(() => {
    inputRef.current?.focus()
  }, [job])

  const flash = (msg, color = '#10b981') => {
    setFlashMsg({ msg, color })
    setTimeout(() => setFlashMsg(null), 3000)
  }

  // ── Send message ───────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)
    setError(null)

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          job_id: job?.id ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `API ${res.status}`)
      const assistantText = (data.content || []).map(b => b.text || '').join('')
      setMessages(prev => [...prev, { role: 'assistant', content: assistantText }])
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }, [input, messages, sending, job])

  // ── Distill conversation to KB candidates ──────────────────────────────────
  const distill = async () => {
    if (messages.length === 0 || distilling) return
    setDistilling(true)
    setCandidates(null)
    setError(null)
    try {
      const res = await fetch('/chat/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `API ${res.status}`)
      const list = (data.candidates || []).map((c, i) => ({
        ...c, _key: i, _saving: false, _saved: false,
      }))
      setCandidates(list)
      if (list.length === 0) flash('Nothing worth capturing found', '#f59e0b')
    } catch (e) {
      setError(e.message)
    } finally {
      setDistilling(false)
    }
  }

  // ── Save full transcript to KB ─────────────────────────────────────────────
  const saveTranscript = async () => {
    if (messages.length === 0 || savingTranscript) return
    setSavingTranscript(true)
    try {
      const body = messages
        .map(m => `**${m.role === 'user' ? 'Artem' : 'Claude'}:** ${m.content}`)
        .join('\n\n')
      const title = job
        ? `Chat: ${(job.title || 'Job').slice(0, 50)} · ${new Date().toLocaleDateString()}`
        : `Chat session · ${new Date().toLocaleDateString()}`
      const res = await fetch('/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'chat_transcript',
          title,
          content: body,
          tags: job ? `job-${job.id}` : 'global',
          job_id: job?.id ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `API ${res.status}`)
      flash('Transcript saved to KB')
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingTranscript(false)
    }
  }

  // ── Candidate actions ──────────────────────────────────────────────────────
  const updateCandidate = (idx, patch) =>
    setCandidates(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))

  const acceptCandidate = async (idx) => {
    const c = candidates[idx]
    updateCandidate(idx, { _saving: true })
    try {
      const res = await fetch('/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: c.type || 'manual',
          title: c.title,
          content: c.content,
          tags: c.tags || null,
          job_id: job?.id ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `API ${res.status}`)
      updateCandidate(idx, { _saving: false, _saved: true })
    } catch (e) {
      updateCandidate(idx, { _saving: false })
      setError(e.message)
    }
  }

  const rejectCandidate = (idx) =>
    setCandidates(prev => prev.filter((_, i) => i !== idx))

  const newChat = () => {
    setMessages([])
    setCandidates(null)
    setError(null)
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const isGlobal = !job

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>

      {/* ── HEADER ── */}
      <div style={{
        padding: '10px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)', display: 'flex', alignItems: 'center',
        gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: '#14b8a6', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, flexShrink: 0 }}>
          {isGlobal ? '💬 Teach Mode' : '💬 Job Chat'}
        </span>
        {job && (
          <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {job.title}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, marginLeft: isGlobal ? 'auto' : 0, flexShrink: 0 }}>
          {messages.length > 0 && (
            <>
              <button
                onClick={distill}
                disabled={distilling}
                style={{
                  padding: '5px 12px', fontSize: 10, fontWeight: 700,
                  background: distilling ? 'var(--border)' : '#7c3aed',
                  color: distilling ? 'var(--text3)' : '#fff',
                  border: 'none', borderRadius: 4,
                  cursor: distilling ? 'default' : 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                }}
              >
                {distilling ? 'Distilling…' : '✦ Distill to KB'}
              </button>
              <button
                onClick={saveTranscript}
                disabled={savingTranscript}
                style={{
                  padding: '5px 10px', fontSize: 10,
                  background: 'transparent', color: 'var(--text3)',
                  border: '1px solid var(--border2)', borderRadius: 4,
                  cursor: savingTranscript ? 'default' : 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                }}
              >
                {savingTranscript ? 'Saving…' : 'Save transcript'}
              </button>
            </>
          )}
          <button
            onClick={newChat}
            style={{
              padding: '5px 10px', fontSize: 10,
              background: 'transparent', color: 'var(--text3)',
              border: '1px solid var(--border2)', borderRadius: 4,
              cursor: 'pointer', textTransform: 'uppercase',
              letterSpacing: '0.06em', fontFamily: 'inherit',
            }}
          >
            New chat
          </button>
        </div>
        {flashMsg && (
          <span style={{
            fontSize: 10, color: flashMsg.color,
            textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
          }}>
            {flashMsg.msg}
          </span>
        )}
      </div>

      {/* ── BODY: messages + distill panel ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text3)' }}>
              <div style={{ fontSize: 30, marginBottom: 14, opacity: 0.35 }}>💬</div>
              <p style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 8, color: 'var(--text2)' }}>
                {isGlobal
                  ? 'Teach mode — dump knowledge, refine case studies, articulate methodology.'
                  : 'Ask anything about this job, iterate on a cover letter, or debrief an outcome.'}
              </p>
              <p style={{ fontSize: 11, lineHeight: 1.7, opacity: 0.7 }}>
                The full Knowledge Base is loaded into every message.<br />
                Click <strong style={{ color: '#7c3aed' }}>✦ Distill to KB</strong> after chatting to extract reusable insights.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: m.role === 'user' ? '#1a3a4a' : '#14b8a6',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#fff',
              }}>
                {m.role === 'user' ? 'A' : 'C'}
              </div>
              {/* Bubble */}
              <div style={{
                maxWidth: '78%',
                background: m.role === 'user' ? 'var(--bg3)' : 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: m.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                padding: '10px 14px',
                fontSize: 13, lineHeight: 1.65, color: 'var(--text)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#00c8d4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>C</div>
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px', padding: '12px 16px' }}>
                <svg width="32" height="10" viewBox="0 0 48 16">
                  <circle cx="8" cy="8" r="4" fill="#14b8a6">
                    <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0s" repeatCount="indefinite"/>
                  </circle>
                  <circle cx="24" cy="8" r="4" fill="#14b8a6">
                    <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.2s" repeatCount="indefinite"/>
                  </circle>
                  <circle cx="40" cy="8" r="4" fill="#14b8a6">
                    <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.4s" repeatCount="indefinite"/>
                  </circle>
                </svg>
              </div>
            </div>
          )}

          {error && (
            <div style={{
              fontSize: 11, color: '#ef4444',
              background: 'rgba(239,68,68,0.08)', padding: '8px 12px',
              borderRadius: 4, border: '1px solid rgba(239,68,68,0.2)',
            }}>
              ✗ {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Distill candidates panel ── */}
        {candidates !== null && candidates.length > 0 && (
          <div style={{
            width: 360, flexShrink: 0, borderLeft: '1px solid var(--border)',
            background: 'var(--bg2)', overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              <span style={{ fontSize: 10, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                ✦ KB Candidates
              </span>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                {candidates.filter(c => !c._saved).length} left
              </span>
              <button
                onClick={() => setCandidates(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 16, lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {candidates.map((c, idx) => (
                <div
                  key={c._key}
                  style={{
                    background: c._saved ? 'rgba(16,185,129,0.06)' : 'var(--bg)',
                    border: `1px solid ${c._saved ? '#10b98155' : 'var(--border)'}`,
                    borderRadius: 6, padding: 12,
                    opacity: c._saved ? 0.65 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  {c._saved ? (
                    <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>✓ Saved to KB</div>
                  ) : (
                    <>
                      {/* Type + tags row */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <select
                          value={c.type}
                          onChange={e => updateCandidate(idx, { type: e.target.value })}
                          style={{
                            background: 'var(--bg3)', border: '1px solid var(--border2)',
                            borderRadius: 4, padding: '3px 6px',
                            fontSize: 10, fontFamily: 'inherit', color: 'var(--text)',
                          }}
                        >
                          {KB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <input
                          value={c.tags || ''}
                          onChange={e => updateCandidate(idx, { tags: e.target.value })}
                          placeholder="tags (comma separated)"
                          style={{
                            flex: 1, background: 'var(--bg3)', border: '1px solid var(--border2)',
                            borderRadius: 4, padding: '3px 8px',
                            fontSize: 10, fontFamily: 'inherit', color: 'var(--text)', outline: 'none',
                          }}
                        />
                      </div>
                      {/* Title */}
                      <input
                        value={c.title}
                        onChange={e => updateCandidate(idx, { title: e.target.value })}
                        placeholder="Title"
                        style={{
                          width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)',
                          borderRadius: 4, padding: '5px 8px', marginBottom: 8,
                          fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                          color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                        }}
                      />
                      {/* Content */}
                      <textarea
                        value={c.content}
                        onChange={e => updateCandidate(idx, { content: e.target.value })}
                        rows={5}
                        style={{
                          width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)',
                          borderRadius: 4, padding: '6px 8px', marginBottom: 10,
                          fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          color: 'var(--text)', outline: 'none', resize: 'vertical',
                          lineHeight: 1.55, boxSizing: 'border-box',
                        }}
                      />
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => acceptCandidate(idx)}
                          disabled={c._saving}
                          style={{
                            flex: 1, padding: '6px 0', fontSize: 10, fontWeight: 700,
                            background: c._saving ? 'var(--border)' : '#10b981',
                            color: c._saving ? 'var(--text3)' : '#fff',
                            border: 'none', borderRadius: 4,
                            cursor: c._saving ? 'default' : 'pointer',
                            textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
                          }}
                        >
                          {c._saving ? 'Saving…' : '✓ Accept'}
                        </button>
                        <button
                          onClick={() => rejectCandidate(idx)}
                          style={{
                            padding: '6px 12px', fontSize: 11, fontWeight: 700,
                            background: 'transparent', color: '#ef4444',
                            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4,
                            cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          ✗
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── INPUT AREA ── */}
      <div style={{
        padding: '12px 20px', borderTop: '1px solid var(--border)',
        background: 'var(--bg2)', flexShrink: 0,
        display: 'flex', gap: 10, alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={
            isGlobal
              ? 'Teach something… (Ctrl+Enter to send)'
              : 'Ask about this job… (Ctrl+Enter to send)'
          }
          rows={3}
          disabled={sending}
          style={{
            flex: 1, padding: '10px 14px', resize: 'none', outline: 'none',
            background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 6,
            fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.5,
            color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          style={{
            padding: '10px 22px', fontSize: 12, fontWeight: 700,
            background: sending || !input.trim() ? 'var(--border)' : '#14b8a6',
            color: sending || !input.trim() ? 'var(--text3)' : '#fff',
            border: 'none', borderRadius: 6,
            cursor: sending || !input.trim() ? 'default' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'inherit',
            alignSelf: 'stretch',
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
