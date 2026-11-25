// ONE import for every CSV (METRO_TASK.md F4, item 4): a lead list, a Linked Helper export (profiles or Data Enrichment),
// a Sales Navigator list, or the email finder's results coming back. No preview step: "Import" imports at once and then says
// what happened in plain words, with a Close button that closes the dialog. Only a file that looks wrong is stopped BEFORE
// anything is written (nothing in it matches this campaign, no recognised columns, the same file imported before), and then
// the dialog says why; the same-file case offers "Import anyway".
import { useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Field, card, input } from './ui.jsx'

export default function ImportDialog({ campaign, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [source, setSource] = useState('')
  const [res, setRes] = useState(null)          // the answer of /import-file: { stopped, summary, can_force, ... }

  const send = async (force = false) => {
    const form = new FormData()
    form.append('file', file)
    const j = await api(`/campaigns/${campaign.id}/import-file?list_source=${encodeURIComponent(source)}&force=${force}`, { method: 'POST', form })
    setRes(j)
    if (j.wrote) onDone?.(j)
    window.dispatchEvent(new Event('metro-progress'))
  }
  const finished = !!res && !res.stopped
  const stopped = !!res && res.stopped

  return (
    <div role="dialog" aria-modal="true" aria-label="Import CSV" data-testid="import-dialog"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,12,14,0.55)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ ...card, width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: METRO.teal }}>Import into {campaign.name}</h2>
        {!res && (
          <>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
              One button for every CSV: a lead list, a Linked Helper export (profiles or Data Enrichment, comma or semicolon), a Sales Navigator
              list, or the email finder's results. Columns are detected, nothing to map. It imports straight away and then tells you what it did;
              a file that does not fit this campaign is stopped before anything is written.
            </p>
            <Field label="CSV file">
              <input type="file" accept=".csv,text/csv" data-testid="import-file"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null) }} />
            </Field>
            <Field label="List source" hint="Which Sales Navigator seat or Linked Helper instance it came from. Empty = taken from the file name.">
              <input style={input} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Sales Navigator seat A" />
            </Field>
          </>
        )}

        {finished && (
          <div data-testid="import-result" style={{ margin: '8px 0 14px', border: '1px solid rgba(26,157,92,0.45)', borderLeft: '6px solid #1a9d5c', borderRadius: 10, padding: '10px 14px', background: 'rgba(26,157,92,0.06)' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#127a45', marginBottom: 6 }}>Imported. {res.summary.headline}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }} data-testid="import-lines">
              {res.summary.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            {res.domain_check_started && <div style={{ fontSize: 12, marginTop: 8, color: 'rgba(0,12,14,0.65)' }}>The new email addresses are being checked in the background (does the domain accept mail?). The header shows it; nothing is marked verified by it.</div>}
          </div>
        )}
        {stopped && (
          <div data-testid="import-stopped" role="alert" style={{ margin: '8px 0 14px', border: '1px solid rgba(224,161,0,0.6)', borderLeft: '6px solid #e0a100', borderRadius: 10, padding: '10px 14px', background: 'rgba(224,161,0,0.08)' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#8a6200', marginBottom: 6 }}>{res.summary.headline} Nothing was written.</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>{res.summary.lines.map((l, i) => <p key={i} style={{ margin: '0 0 4px' }}>{l}</p>)}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" onClick={onClose} data-testid="import-close">{finished || stopped ? 'Close' : 'Cancel'}</Btn>
          {stopped && res.can_force && <Btn kind="ghost" onClick={() => send(true)} data-testid="import-anyway">Import anyway</Btn>}
          {stopped && !res.can_force && <Btn kind="ghost" onClick={() => setRes(null)} data-testid="import-another">Pick another file</Btn>}
          {!res && <Btn onClick={() => send(false)} disabled={!file} data-testid="import-apply">Import</Btn>}
        </div>
      </div>
    </div>
  )
}
