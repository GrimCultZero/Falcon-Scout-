// Desktop (OS) notifications for newly-enriched jobs.
// Settings persist in localStorage; nothing here talks to the backend.
//
// Trigger model (see App.jsx): notify when a job that arrived AFTER the app was
// opened first shows up ENRICHED — so the essential info (rate, client, activity)
// is already populated. Pre-existing backlog jobs never notify.

const KEY = 'falconscout.notifySettings'
const DEFAULTS = { enabled: false, mode: 'all', minRate: 30 }   // mode: 'all' | 'worthy'

export function getNotifySettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) } }
  catch { return { ...DEFAULTS } }
}
export function saveNotifySettings(patch) {
  const next = { ...getNotifySettings(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {}
  return next
}

export function notifySupported() { return typeof window !== 'undefined' && 'Notification' in window }
export function notifyPermission() { return notifySupported() ? Notification.permission : 'unsupported' }
export async function requestNotifyPermission() {
  if (!notifySupported()) return 'unsupported'
  try { return await Notification.requestPermission() } catch { return notifyPermission() }
}

// Numeric hourly rate for the "worthy" filter. null = fixed-price / unspecified
// (treated as "don't block" — we never suppress a job just because it has no
// hourly number).
function _hourly(job) {
  const n = Number(job.hourly_rate_max || job.hourly_rate_min)
  return Number.isFinite(n) && n > 0 ? n : null
}

// "Worth a look": payment-verified client AND (rate ≥ threshold OR rate unspecified).
export function jobIsWorthy(job, settings) {
  if (!job.payment_verified) return false
  const hr = _hourly(job)
  if (hr === null) return true
  return hr >= (settings.minRate || 0)
}

export function passesNotifyFilter(job, settings) {
  return settings.mode === 'worthy' ? jobIsWorthy(job, settings) : true
}

// Compact essential-info line for the notification body.
export function notifyBody(job) {
  const parts = []
  const rate = job.hourly_rate_min
    ? `$${job.hourly_rate_min}${job.hourly_rate_max && job.hourly_rate_max !== job.hourly_rate_min ? '–' + job.hourly_rate_max : ''}/hr`
    : (job.fixed_budget ? `$${String(job.fixed_budget).replace(/^\$/, '')} fixed` : null)
  if (rate) parts.push(rate)
  if (job.client_country) parts.push(job.client_country)
  const client = []
  if (job.client_review_count) client.push(`${job.client_review_count} reviews`)
  if (job.client_rating_score)  client.push(`${job.client_rating_score}★`)
  if (job.client_spend)         client.push(job.client_spend)
  if (job.payment_verified)     client.push('verified')
  if (client.length) parts.push(client.join(', '))
  if (job.proposals) parts.push(`${job.proposals} applicants`)
  if (job.last_analysis) parts.push(`AI: ${job.last_analysis.verdict} ${job.last_analysis.score}/10`)
  return parts.join(' · ')
}

function _spawn(title, body, tag, onClick) {
  if (notifyPermission() !== 'granted') return
  try {
    const n = new Notification(title, { body, tag, silent: true, icon: '/falcon-scout-mark5.png' })
    n.onclick = () => { try { window.focus() } catch {} ; if (onClick) onClick(); try { n.close() } catch {} }
  } catch {}
}

// Fire for a batch of newly-enriched jobs: 1–3 → individual pop-ups; 4+ → one summary.
export function notifyNewJobs(newJobs, onOpenJob) {
  if (!newJobs || !newJobs.length) return
  if (newJobs.length <= 3) {
    for (const j of newJobs) {
      _spawn(j.title || 'New job', notifyBody(j), `fs-job-${j.id}`, () => onOpenJob && onOpenJob(j.id))
    }
  } else {
    const top = newJobs[0]
    _spawn(`${newJobs.length} new jobs`, `Top: ${top.title || ''}\n${notifyBody(top)}`,
           'fs-batch', () => onOpenJob && onOpenJob(top.id))
  }
}

export function fireTestNotification() {
  _spawn('Falcon Scout — test', 'Notifications are on. New enriched jobs will pop up here.', 'fs-test',
         () => { try { window.focus() } catch {} })
}
