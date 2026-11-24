// Import a Linked Helper / Sales Navigator / hand-made CSV into one campaign. Always previews first
// (a dry run: nothing is written), then imports exactly what the preview showed.
import { useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err, Field, card, input } from './ui.jsx'

const ROWS = [
  ['rows_read', 'Rows read'], ['added', 'New leads'], ['duplicate', 'Already in this campaign'],
  ['updated', 'Of those, status or email updated'], ['duplicate_in_file', 'Repeated inside the file'],
  ['in_other_campaign', 'Skipped: already in another campaign'], ['company_in_other_campaign', "Skipped: company is in another campaign"],
  ['suppressed', 'Stored but marked suppressed (never written to)'], ['junk', 'Marked junk by layer 0'],
  ['invalid', 'No usable identifier (not stored)'], ['with_email', 'New leads with an email in the file'],
  ['same_name_other_profile', 'Same name and company, different profile (kept, worth a look)'],
]

export default function ImportDialog({ campaign, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (dry) => {
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const j = await api(`/campaigns/${campaign.id}/import?dry_run=${dry}&list_source=${encodeURIComponent(source)}`, { method: 'POST', form })
      if (dry) setPreview(j); else { setDone(j); onDone?.(j) }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const r = done || preview

  return (
    <div role="dialog" aria-modal="true" aria-label="Import CSV" data-testid="import-dialog"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,12,14,0.55)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ ...card, width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: METRO.teal }}>Import into {campaign.name}</h2>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(0,12,14,0.6)' }}>
          Linked Helper "Profiles downloaded" exports (comma or semicolon), Sales Navigator or hand-made lists. Columns are detected, nothing to map.
          The preview writes nothing.
        </p>
        <Field label="CSV file">
          <input type="file" accept=".csv,text/csv" data-testid="import-file"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setDone(null); setError('') }} />
        </Field>
        <Field label="List source" hint="Which Sales Navigator seat or Linked Helper instance it came from. Empty = taken from the file name.">
          <input style={input} value={source} onChange={(e) => { setSource(e.target.value); setPreview(null) }} placeholder="Sales Navigator seat A" />
        </Field>
        <Err error={error} />
        {r && (
          <div style={{ margin: '8px 0 14px' }} data-testid="import-result">
            <div style={{ fontWeight: 800, fontSize: 13, color: done ? '#1a9d5c' : METRO.teal, marginBottom: 6 }}>
              {done ? 'Imported' : 'Preview (nothing written yet)'} · {r.list_source} · delimiter "{r.delimiter}"
              {r.is_linked_helper ? ' · Linked Helper export' : ''}
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}><tbody>
              {ROWS.filter(([k]) => r[k] !== undefined && (r[k] > 0 || ['rows_read', 'added'].includes(k))).map(([k, label]) => (
                <tr key={k} style={{ borderTop: '1px solid rgba(0,86,105,0.1)' }}><td style={{ padding: '3px 0' }}>{label}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{r[k]}</td></tr>
              ))}
              <tr style={{ borderTop: '1px solid rgba(0,86,105,0.1)' }}><td style={{ padding: '3px 0' }}>Linked Helper status of new leads</td>
                <td style={{ textAlign: 'right' }}>{r.invite.connected} connected · {r.invite.invited} invited · {r.invite.none} not invited</td></tr>
              <tr style={{ borderTop: '1px solid rgba(0,86,105,0.1)' }}><td style={{ padding: '3px 0' }}>Persona score of new leads</td>
                <td style={{ textAlign: 'right' }}>{r.persona.keep} keep · {r.persona.review} review · {r.persona.junk} junk</td></tr>
            </tbody></table>
            {Object.keys(r.in_other_campaign_by || {}).length > 0 && (
              <div style={{ fontSize: 12, marginTop: 6 }}>Already in: {Object.entries(r.in_other_campaign_by).map(([n, k]) => `${n} (${k})`).join(', ')}</div>
            )}
            {r.same_file_imported_before && <div style={{ fontSize: 12, marginTop: 6, fontWeight: 700 }}>This exact file was imported into this campaign before.</div>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Btn kind="ghost" onClick={onClose}>{done ? 'Close' : 'Cancel'}</Btn>
          {!done && <Btn kind="ghost" onClick={() => send(true)} disabled={!file || busy}>Preview</Btn>}
          {!done && <Btn onClick={() => send(false)} disabled={!file || busy || !preview || preview.added === 0} data-testid="import-apply">
            {preview ? `Import ${preview.added} lead${preview.added === 1 ? '' : 's'}` : 'Import'}
          </Btn>}
        </div>
      </div>
    </div>
  )
}
