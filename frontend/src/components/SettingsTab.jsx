import { useState } from 'react'
import FeedSettings from './FeedSettings'
import {
  getNotifySettings, saveNotifySettings, notifySupported, notifyPermission,
  requestNotifyPermission, fireTestNotification,
} from '../lib/notifications'

// Settings — a real top-level tab (promoted from the old gear-button modal).
// Two sections: desktop Notifications (new) + the API Feed filters (embedded
// FeedSettings). Notification prefs live in localStorage via the notifications lib.

function Section({ title, children }) {
  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: '18px 20px', marginBottom: 18, background: 'var(--bg)', maxWidth: 720 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: '0 0 12px' }}>{title}</h2>
      {children}
    </div>
  )
}

function NotificationSettings() {
  const [s, setS] = useState(getNotifySettings)
  const [perm, setPerm] = useState(notifyPermission())
  const supported = notifySupported()

  const patch = (p) => { const next = saveNotifySettings(p); setS(next) }

  const toggleEnabled = async (on) => {
    if (on && perm !== 'granted') {
      const res = await requestNotifyPermission()
      setPerm(res)
      if (res !== 'granted') { patch({ enabled: false }); return }
    }
    patch({ enabled: on })
  }

  const permBadge = {
    granted: { text: 'allowed', color: '#00d070' },
    denied:  { text: 'blocked in browser', color: '#ef4444' },
    default: { text: 'not yet granted', color: '#f59e0b' },
    unsupported: { text: 'unsupported browser', color: '#ef4444' },
  }[supported ? perm : 'unsupported']

  return (
    <Section title="Desktop notifications">
      <p style={{ fontSize: 11, color: 'var(--text3)', margin: '0 0 14px', lineHeight: 1.55 }}>
        A silent OS pop-up when a <b>new</b> job arrives and finishes auto-enrichment — with the title
        and essential info (rate, client, activity). Fires even when Falcon Scout is minimized or in
        another tab. Click a pop-up to jump straight to that job.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)', marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!s.enabled} disabled={!supported} onChange={e => toggleEnabled(e.target.checked)} />
        Enable desktop notifications
        <span style={{ fontSize: 10, fontWeight: 700, color: permBadge.color, marginLeft: 4 }}>
          ({permBadge.text})
        </span>
      </label>
      {perm === 'denied' && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.5 }}>
          Notifications are blocked for this site in the browser. Click the padlock in the address bar
          → Site settings → allow Notifications, then re-enable here.
        </div>
      )}

      <div style={{ opacity: s.enabled ? 1 : 0.45, pointerEvents: s.enabled ? 'auto' : 'none', marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          Which jobs
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 5, cursor: 'pointer' }}>
          <input type="radio" name="notify-mode" checked={s.mode === 'all'} onChange={() => patch({ mode: 'all' })} />
          Every new job (once enriched)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 8, cursor: 'pointer' }}>
          <input type="radio" name="notify-mode" checked={s.mode === 'worthy'} onChange={() => patch({ mode: 'worthy' })} />
          Only jobs worth a look
        </label>
        {s.mode === 'worthy' && (
          <div style={{ fontSize: 11, color: 'var(--text2)', margin: '0 0 10px 24px' }}>
            Payment-verified client AND rate ≥ $
            <input type="number" min={0} value={s.minRate ?? 30}
              onChange={e => patch({ minRate: Number(e.target.value) })}
              style={{ width: 60, margin: '0 4px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '3px 6px', fontSize: 12, color: 'var(--text)' }} />
            /hr (or rate unspecified / fixed-price — never blocked).
          </div>
        )}

        <button className="btn-secondary" style={{ fontSize: 11, padding: '5px 12px', marginTop: 4 }}
          disabled={perm !== 'granted'}
          onClick={() => fireTestNotification()}>
          Send test notification
        </button>
      </div>
    </Section>
  )
}

export default function SettingsTab() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <NotificationSettings />
      <Section title="API feed filters">
        <FeedSettings embedded onSaved={() => {}} />
      </Section>
    </div>
  )
}
