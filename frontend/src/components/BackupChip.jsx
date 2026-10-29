import { useEffect, useState } from 'react'
import { backupChipState } from '../lib/backupStatus'

// Red header chip: appears only when the database backup is missing, failed or
// older than 48 h. Healthy = renders nothing. Polls the backend once a minute --
// the endpoint just lists a folder, so it's cheap.
export default function BackupChip() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/backup-status')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (alive) setStatus(d) })
        .catch(() => { if (alive) setStatus(null) })
    load()
    const id = setInterval(load, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const state = backupChipState(status)
  if (!state) return null

  return (
    <div
      title={state.title}
      data-testid="backup-chip"
      style={{
        background: 'rgba(239,68,68,0.14)',
        border: '1px solid rgba(239,68,68,0.55)',
        color: '#ff8a8a',
        borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 700,
        fontFamily: 'Inter, sans-serif', letterSpacing: '0.02em', cursor: 'help',
        whiteSpace: 'nowrap',
      }}
    >
      ⚠ {state.label}
    </div>
  )
}
