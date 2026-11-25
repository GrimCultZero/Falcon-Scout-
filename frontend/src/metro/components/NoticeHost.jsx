// Shows lib/notices.js: what each button did, until the person dismisses it. Fixed under the header, so it cannot be scrolled away.
import { useSyncExternalStore } from 'react'
import '../metro.css'
import { notices } from '../lib/notices.js'

export default function NoticeHost() {
  const list = useSyncExternalStore(notices.subscribe, notices.get, notices.get)
  if (!list.length) return null
  return (
    <div className="mt-notices" data-testid="notices">
      {list.length > 1 && <button type="button" className="mt-notice-all" onClick={() => notices.clear()} data-testid="notices-clear">Dismiss all ({list.length})</button>}
      {list.map((n) => (
        <div key={n.id} className={`mt-notice mt-notice--${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'} data-testid="notice" data-kind={n.kind}>
          <div className="mt-notice-text">
            {n.text}{n.count > 1 ? ` (x${n.count})` : ''}
            {n.detail && <span className="mt-notice-detail">{n.detail}</span>}
          </div>
          <button type="button" className="mt-notice-x" onClick={() => notices.dismiss(n.id)} aria-label="Dismiss" title="Dismiss">×</button>
        </div>
      ))}
    </div>
  )
}
