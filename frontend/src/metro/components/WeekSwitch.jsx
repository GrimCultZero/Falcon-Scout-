// The week-mode switch in the Metro header (METRO_PLAN.md Phase 2, step 4). The chip shows the current week;
// clicking it opens a confirm pop-up. Entering a Metro week also asks the backend whether the Linked Helper
// program is running (the Windows process list): if it is, or if the list cannot be read, the switch is refused.
// Messages and reply checks are never blocked by the week; only scraping is.
import { useState } from 'react'
import { api } from '../api.js'
import { METRO } from '../theme.js'
import { Btn, Err } from './ui.jsx'

export const WEEK_LABEL = { metro: 'Metro week', linked_helper: 'Linked Helper week' }

export default function WeekSwitch({ week, onChanged }) {
  const [open, setOpen] = useState(false)
  const [check, setCheck] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mode = week?.week_mode || 'metro'
  const target = mode === 'metro' ? 'linked_helper' : 'metro'

  const show = async () => {
    setError(''); setCheck(null); setOpen(true)
    if (target === 'metro') {
      try { setCheck(await api('/week/check')) } catch (e) { setCheck({ readable: false, linked_helper_running: [], error: e.message }) }
    }
  }
  const confirm = async () => {
    setBusy(true); setError('')
    try { await api('/week', { method: 'PUT', json: { mode: target, confirmed: true } }); setOpen(false); onChanged?.() }
    catch (e) { setError(e.message); if (target === 'metro') api('/week/check').then(setCheck).catch(() => {}) }
    finally { setBusy(false) }
  }
  const blocked = target === 'metro' && (!check || !check.readable || check.linked_helper_running.length > 0)

  return (
    <>
      <button type="button" onClick={show} data-testid="week-chip" aria-haspopup="dialog"
        title="Click to switch the week. Linked Helper weeks: no LinkedIn visits. Metro weeks: Metro may visit LinkedIn. Messages and reply checks are always allowed."
        style={{ cursor: 'pointer', border: '1px solid rgba(55,187,213,0.45)', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700,
          fontFamily: METRO.font, color: METRO.ice, background: mode === 'linked_helper' ? 'rgba(230,38,31,0.35)' : 'rgba(55,187,213,0.12)' }}>
        {WEEK_LABEL[mode]} ▾
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Switch week" data-testid="week-dialog"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,12,14,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', color: METRO.ink, borderRadius: 12, padding: '20px 24px', width: 460, maxWidth: '92vw', whiteSpace: 'normal',
            fontFamily: METRO.font, boxShadow: '0 12px 40px rgba(0,12,14,0.35)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: METRO.teal }}>Switch to a {WEEK_LABEL[target]}?</h3>
            {target === 'linked_helper' ? (
              <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 }}>
                From now on Metro hands out <b>no LinkedIn jobs at all</b>: no LinkedIn profile or company visits. Reads on other sites (Ads Transparency, Google Maps / Business Profile, Ahrefs) keep running.
                Jobs already queued wait. Linked Helper may use the account. Messages and reply checks are not affected.
              </p>
            ) : (
              <>
                <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 }}>
                  Metro may scrape again, within each account's daily cap. <b>Linked Helper must be closed first</b>: LinkedIn must not be visited by two tools at once.
                </p>
                <div data-testid="week-check" style={{ margin: '0 0 10px', padding: '8px 10px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: !check ? 'rgba(0,12,14,0.05)' : (!check.readable || check.linked_helper_running.length) ? 'rgba(230,38,31,0.1)' : 'rgba(26,157,92,0.12)',
                  color: !check ? METRO.ink : (!check.readable || check.linked_helper_running.length) ? METRO.agencyLine : '#1a7a4a' }}>
                  {!check ? 'Checking the Windows process list ...'
                    : !check.readable ? `Could not read the process list (${check.error || 'unknown'}). The switch stays refused.`
                    : check.linked_helper_running.length ? `Linked Helper is running (${check.linked_helper_running.join(', ')}). Close it, then try again.`
                    : 'Linked Helper is not running.'}
                </div>
              </>
            )}
            <Err error={error} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn kind="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
              <Btn onClick={confirm} disabled={busy || blocked} data-testid="week-confirm">Switch to {WEEK_LABEL[target]}</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
