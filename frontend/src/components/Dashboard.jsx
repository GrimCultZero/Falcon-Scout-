import { useCallback, useEffect, useState } from 'react'

const STATUS_COLOR = {
  sent: '#3b82f6', viewed: '#8b5cf6', replied: '#00c8d4',
  interviewing: '#06b6d4', hired: '#00d070', declined: '#ef4444',
  ghosted: '#f59e0b', expired: '#9ca3af', withdrawn: '#6b7280', draft: '#6b7280',
}

const SEND_TIME_ORDER = ['<15min', '15-60min', '1-6hr', '6-24hr', '>24hr', 'no_timestamp']
const SEND_TIME_LABEL = {
  '<15min': '< 15 min', '15-60min': '15 – 60 min', '1-6hr': '1 – 6 hr',
  '6-24hr': '6 – 24 hr', '>24hr': '> 24 hr', 'no_timestamp': 'No timestamp',
}

const FUNNEL_ORDER = ['sent', 'viewed', 'replied', 'interviewing', 'hired', 'ghosted', 'declined', 'expired', 'withdrawn', 'draft']

// ── Friendly week label ────────────────────────────────────────────────────
// Backend returns "2026-W21" style. Convert to a human-friendly "May 18 – 24"
// label using ISO week math (Monday-start).
function isoWeekToRange(weekKey) {
  if (!weekKey || typeof weekKey !== 'string') return weekKey
  const m = weekKey.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return weekKey
  const year = parseInt(m[1], 10)
  const week = parseInt(m[2], 10)
  // ISO week 1 contains the Thursday of Jan 4. Find that, then offset.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7   // Sun=7
  const week1Mon = new Date(jan4.getTime() - (jan4Day - 1) * 86400000)
  const monday = new Date(week1Mon.getTime() + (week - 1) * 7 * 86400000)
  const sunday = new Date(monday.getTime() + 6 * 86400000)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth()
  if (sameMonth) {
    return `${months[monday.getUTCMonth()]} ${monday.getUTCDate()} – ${sunday.getUTCDate()}`
  }
  return `${months[monday.getUTCMonth()]} ${monday.getUTCDate()} – ${months[sunday.getUTCMonth()]} ${sunday.getUTCDate()}`
}

export default function Dashboard({ active = false }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/dashboard-stats')
      if (!res.ok) throw new Error('API error ' + res.status)
      setStats(await res.json())
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) fetchStats()
  }, [active, fetchStats])

  if (loading && !stats) {
    return (
      <div style={styles.page}>
        <div style={{ color: 'var(--text3)', fontSize: 12, padding: 40 }}>Loading stats…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.page}>
        <div style={{ color: '#ef4444', fontSize: 12, padding: 40 }}>{error}</div>
      </div>
    )
  }

  if (!stats) return <div style={styles.page} />

  const { funnel, send_time_buckets, bid_stats, crosstab, trend, total_proposals, periods, bid_by_outcome } = stats
  const funnelTotal = total_proposals || 1

  // Funnel entries in display order, only those with count > 0
  const funnelRows = FUNNEL_ORDER
    .filter(s => (funnel[s] || 0) > 0)
    .map(s => ({ status: s, count: funnel[s] }))

  // Send-time bars — exclude no_timestamp from bar max calculation
  const stMax = Math.max(1, ...SEND_TIME_ORDER.filter(k => k !== 'no_timestamp').map(k => send_time_buckets[k] || 0))
  const stRows = SEND_TIME_ORDER.filter(k => k !== 'no_timestamp' && (send_time_buckets[k] || 0) >= 0)

  // Reply rate: (replied + interviewing + hired) / submitted. 'invited' is its
  // own metric (client invited Artem) — counted in submitted, shown separately.
  const replyable = (funnel.replied || 0) + (funnel.interviewing || 0) + (funnel.hired || 0)
  const invitedCount = funnel.invited || 0
  const submitted  = (funnel.sent || 0) + (funnel.viewed || 0) + (funnel.invited || 0) + (funnel.ghosted || 0) + (funnel.declined || 0) + replyable
  const replyRate  = submitted > 0 ? Math.round((replyable / submitted) * 100) : null

  const fmtAmt = (n) => n != null ? (n % 1 === 0 ? n.toLocaleString() : n.toFixed(0)) : '—'

  // Weekly trend — reversed so most recent week is on top (table reads top→bottom newest→oldest)
  const weeklyRows = [...(trend || [])].reverse()

  return (
    <div style={styles.page}>
      {/* Header row */}
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.pageTitle}>Dashboard</h2>
          {lastUpdated && (
            <span style={styles.updatedAt}>
              updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          style={styles.refreshBtn}
          onMouseEnter={e => e.currentTarget.style.color = '#00c8d4'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
        >
          {loading ? '…' : '↺ refresh'}
        </button>
      </div>

      {/* ── PRIMARY: period comparison (this vs last — week & month) ─────── */}
      {periods && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <PeriodPanel cur={periods.this_week} prev={periods.last_week} />
          <PeriodPanel cur={periods.this_month} prev={periods.last_month} />
        </div>
      )}

      {/* ── Bidding ──────────────────────────────────────────────────────── */}
      {bid_by_outcome && (
        <Section title="Connects" hint="all-time · connects spent per proposal">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '4px 2px' }}>
            <BidStat label="Total spent" value={(periods?.all_time?.bid_total ?? 0).toLocaleString()} sub={`${bid_by_outcome.all.count} proposals`} />
            <BidStat label="Avg / proposal" value={bid_by_outcome.all.avg != null ? bid_by_outcome.all.avg : '—'} />
            <BidStat label="Avg · replied" value={bid_by_outcome.positive.avg != null ? bid_by_outcome.positive.avg : '—'} sub={`${bid_by_outcome.positive.count} won a reply`} accent="#00c8d4" />
            <BidStat label="Avg · ghosted" value={bid_by_outcome.ghosted.avg != null ? bid_by_outcome.ghosted.avg : '—'} sub={`${bid_by_outcome.ghosted.count} ghosted`} accent="#f59e0b" />
          </div>
          {bid_by_outcome.positive.avg != null && bid_by_outcome.ghosted.avg != null && (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
              {bid_by_outcome.positive.avg > bid_by_outcome.ghosted.avg
                ? `Replied proposals used ${bid_by_outcome.positive.avg - bid_by_outcome.ghosted.avg} more connects on average — boosting may be helping.`
                : `Ghosted proposals used as many or more connects — spending more isn't buying replies.`}
            </div>
          )}
        </Section>
      )}

      {/* ── All-time totals (moved below the period panels) ──────────────── */}
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: '4px 2px 6px' }}>All time</div>
      <div style={styles.cardRow}>
        <StatCard label="Total Proposals" value={total_proposals} />
        <StatCard label="Submitted" value={submitted} />
        <StatCard label="Invited" value={invitedCount} accent="#8b5cf6" />
        <StatCard label="Got a Reply" value={replyable} accent="#00c8d4" />
        <StatCard label="Hired" value={funnel.hired || 0} accent="#00d070" />
        <StatCard label="Ghosted" value={funnel.ghosted || 0} accent="#f59e0b" />
        {replyRate !== null && (
          <StatCard label="Reply Rate" value={replyRate + '%'} accent={replyRate >= 20 ? '#00d070' : replyRate >= 10 ? '#00c8d4' : '#f59e0b'} />
        )}
      </div>

      {/* ── PRIMARY: Week-by-week table ─────────────────────────────────── */}
      <Section title="Week-by-Week Activity" hint="last 12 weeks · most recent first">
        {!weeklyRows.length ? (
          <Empty text="No weekly data yet — submit a few proposals via Upwork to see this fill in." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.weekTable}>
              <thead>
                <tr>
                  <th style={styles.weekTh}>Week</th>
                  <th style={{ ...styles.weekTh, textAlign: 'right' }}>Sent</th>
                  <th style={{ ...styles.weekTh, textAlign: 'right' }}>Viewed</th>
                  <th style={{ ...styles.weekTh, textAlign: 'right' }}>Replied</th>
                  <th style={{ ...styles.weekTh, textAlign: 'right' }}>Hired</th>
                  <th style={{ ...styles.weekTh, textAlign: 'right' }}>Ghosted</th>
                  <th style={{ ...styles.weekTh, textAlign: 'right' }}>Reply Rate</th>
                </tr>
              </thead>
              <tbody>
                {weeklyRows.map((d, i) => {
                  const rr = d.submitted > 0 ? Math.round((d.replied / d.submitted) * 100) : null
                  const rrColor = rr === null ? 'var(--text3)' : rr >= 20 ? '#00d070' : rr >= 10 ? '#00c8d4' : rr > 0 ? '#f59e0b' : '#ef4444'
                  return (
                    <tr key={d.week} style={{ background: i % 2 === 0 ? 'var(--bg2)' : 'transparent' }}>
                      <td style={{ ...styles.weekTd, fontWeight: 600 }}>
                        <div>{isoWeekToRange(d.week)}</div>
                        <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{d.week}</div>
                      </td>
                      <td style={{ ...styles.weekTd, textAlign: 'right', fontWeight: 600, color: '#3b82f6' }}>{d.submitted}</td>
                      <td style={{ ...styles.weekTd, textAlign: 'right', color: d.viewed ? '#8b5cf6' : 'var(--text3)' }}>{d.viewed || '—'}</td>
                      <td style={{ ...styles.weekTd, textAlign: 'right', fontWeight: 600, color: d.replied ? '#00c8d4' : 'var(--text3)' }}>{d.replied || '—'}</td>
                      <td style={{ ...styles.weekTd, textAlign: 'right', fontWeight: 700, color: d.hired ? '#00d070' : 'var(--text3)' }}>{d.hired || '—'}</td>
                      <td style={{ ...styles.weekTd, textAlign: 'right', color: d.ghosted ? '#f59e0b' : 'var(--text3)' }}>{d.ghosted || '—'}</td>
                      <td style={{ ...styles.weekTd, textAlign: 'right', fontWeight: 700, color: rrColor }}>
                        {rr === null ? '—' : `${rr}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── Secondary sections ──────────────────────────────────────────── */}
      <div style={styles.grid}>
        {/* Funnel */}
        <Section title="Proposal Funnel" hint={`${total_proposals} total`}>
          {funnelRows.length === 0 ? (
            <Empty text="No proposals yet" />
          ) : (
            <table style={styles.table}>
              <tbody>
                {funnelRows.map(({ status, count }) => (
                  <tr key={status}>
                    <td style={{ ...styles.td, width: 90 }}>
                      <span style={{ ...styles.statusDot, background: STATUS_COLOR[status] || '#6b7280' }} />
                      <span style={styles.statusLabel}>{status}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.barTrack}>
                        <div style={{
                          ...styles.barFill,
                          width: Math.round((count / funnelTotal) * 100) + '%',
                          background: STATUS_COLOR[status] || '#6b7280',
                        }} />
                      </div>
                    </td>
                    <td style={{ ...styles.td, ...styles.countCell }}>{count}</td>
                    <td style={{ ...styles.td, ...styles.pctCell }}>
                      {Math.round((count / funnelTotal) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Send-time distribution */}
        <Section title="Time-to-Submit" hint="from job capture to submission">
          {submitted === 0 ? (
            <Empty text="Submit proposals via Upwork to see timing data" />
          ) : (
            <table style={styles.table}>
              <tbody>
                {stRows.map(k => {
                  const count = send_time_buckets[k] || 0
                  return (
                    <tr key={k}>
                      <td style={{ ...styles.td, width: 90 }}>
                        <span style={styles.timeLabel}>{SEND_TIME_LABEL[k]}</span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.barTrack}>
                          <div style={{
                            ...styles.barFill,
                            width: Math.round((count / stMax) * 100) + '%',
                            background: k === '<15min' ? '#00d070'
                              : k === '15-60min' ? '#00c8d4'
                              : k === '1-6hr' ? '#3b82f6'
                              : k === '6-24hr' ? '#8b5cf6'
                              : '#f59e0b',
                          }} />
                        </div>
                      </td>
                      <td style={{ ...styles.td, ...styles.countCell }}>{count}</td>
                    </tr>
                  )
                })}
                {(send_time_buckets.no_timestamp || 0) > 0 && (
                  <tr>
                    <td colSpan={3} style={{ ...styles.td, color: 'var(--text3)', fontSize: 10, paddingTop: 6 }}>
                      {send_time_buckets.no_timestamp} without submission timestamp (pre-Chunk 1 proposals)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Section>

        {/* Bid stats */}
        <Section title="Bid Summary" hint="from auto-captured submissions">
          {Object.keys(bid_stats || {}).length === 0 ? (
            <Empty text="Submit a proposal on Upwork to capture bid data" />
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Currency', 'Count', 'Avg', 'Min', 'Max'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(bid_stats).map(([currency, s]) => (
                  <tr key={currency}>
                    <td style={{ ...styles.td, fontWeight: 600, color: '#00c8d4' }}>{currency}</td>
                    <td style={styles.td}>{s.count}</td>
                    <td style={styles.td}>{fmtAmt(s.average)}</td>
                    <td style={styles.td}>{fmtAmt(s.min)}</td>
                    <td style={styles.td}>{fmtAmt(s.max)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* Crosstab — full-width row below the grid */}
      <div style={{ marginTop: 20 }}>
        <Section title="Bid tier × Time-to-Submit" hint="reply rate per cell (cells need 3+ samples to show %)">
          <Crosstab data={crosstab} />
        </Section>
      </div>
    </div>
  )
}

// ── Crosstab: bid_tier × send-time bucket → reply rate / volume ─────────────
function Crosstab({ data }) {
  if (!data) return <Empty text="No crosstab data" />
  const TIERS = ['low', 'mid', 'high', 'premium', 'other']
  const TIER_LABEL = {
    low: '< $500', mid: '$500 – $2k', high: '$2k – $5k',
    premium: '$5k+', other: 'non-USD',
  }
  const BUCKETS = ['<15min', '15-60min', '1-6hr', '6-24hr', '>24hr']

  // Skip rows where every cell is empty (clean visual)
  const visibleTiers = TIERS.filter(t => BUCKETS.some(b => (data[t]?.[b]?.total || 0) > 0))
  if (!visibleTiers.length) {
    return <Empty text="Submit & track outcomes of more proposals to see this breakdown" />
  }

  const cellBg = (cell) => {
    if (!cell || cell.total === 0) return 'transparent'
    if (cell.reply_rate_pct == null) return 'var(--bg3)'
    const rr = cell.reply_rate_pct
    if (rr >= 20) return 'rgba(0,208,112,0.18)'
    if (rr >= 10) return 'rgba(0,200,212,0.15)'
    if (rr > 0)   return 'rgba(245,158,11,0.15)'
    return 'rgba(239,68,68,0.10)'
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ ...styles.table, minWidth: 540 }}>
        <thead>
          <tr>
            <th style={styles.th}></th>
            {BUCKETS.map(b => (
              <th key={b} style={{ ...styles.th, textAlign: 'center' }}>{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleTiers.map(tier => (
            <tr key={tier}>
              <td style={{ ...styles.td, fontWeight: 600, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                {TIER_LABEL[tier]}
              </td>
              {BUCKETS.map(b => {
                const cell = data[tier]?.[b] || { total: 0, replied: 0 }
                return (
                  <td
                    key={b}
                    title={`${cell.total} proposals, ${cell.replied} positive replies`}
                    style={{
                      ...styles.td,
                      textAlign: 'center',
                      background: cellBg(cell),
                      borderRadius: 3,
                      padding: '6px 4px',
                    }}
                  >
                    {cell.total === 0 ? (
                      <span style={{ color: 'var(--text3)', opacity: 0.5 }}>—</span>
                    ) : cell.reply_rate_pct != null ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#00c8d4' }}>
                          {cell.reply_rate_pct}%
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                          {cell.replied}/{cell.total}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 10, color: 'var(--text2)' }}>
                        n={cell.total}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionTitle}>{title}</span>
        {hint && <span style={styles.sectionHint}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.cardValue, color: accent || 'var(--text)' }}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </div>
  )
}

// Delta chip: cur vs prev with ▲/▼ and colour. higherIsBetter flips colours.
function Delta({ cur, prev, suffix = '', higherIsBetter = true }) {
  if (cur == null || prev == null) return null
  const d = cur - prev
  if (d === 0) return <span style={{ fontSize: 10, color: 'var(--text3)' }}>±0{suffix}</span>
  const up = d > 0
  const good = higherIsBetter ? up : !up
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: good ? '#00d070' : '#ef4444' }}>
      {up ? '▲' : '▼'}{Math.abs(d)}{suffix} vs prev
    </span>
  )
}

function PeriodPanel({ cur, prev }) {
  if (!cur) return null
  const Metric = ({ label, value, deltaCur, deltaPrev, suffix, accent, hib = true }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent || 'var(--text)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', margin: '2px 0' }}>{label}</div>
      <Delta cur={deltaCur} prev={deltaPrev} suffix={suffix} higherIsBetter={hib} />
    </div>
  )
  const rr = cur.reply_rate_pct
  const rrColor = rr == null ? 'var(--text)' : rr >= 20 ? '#00d070' : rr >= 10 ? '#00c8d4' : '#f59e0b'
  const title = cur.label + (cur.range ? `  ·  ${cur.range}` : '')
  return (
    <div style={{ ...styles.section, marginBottom: 0 }}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionTitle}>{title}</span>
        {prev && prev.label && <span style={styles.sectionHint}>vs {prev.label}</span>}
      </div>
      <div style={{ display: 'flex', gap: 14, padding: '4px 2px' }}>
        <Metric label="Submitted" value={cur.submitted} deltaCur={cur.submitted} deltaPrev={prev && prev.submitted} />
        <Metric label="Viewed" value={cur.viewed || 0} deltaCur={cur.viewed} deltaPrev={prev && prev.viewed} accent="#8b5cf6" />
        <Metric label="Invited" value={cur.invited || 0} deltaCur={cur.invited} deltaPrev={prev && prev.invited} accent="#a855f7" />
        <Metric label="Replies" value={cur.positive} deltaCur={cur.positive} deltaPrev={prev && prev.positive} accent="#00c8d4" />
        <Metric label="Hired" value={cur.hired || 0} deltaCur={cur.hired} deltaPrev={prev && prev.hired} accent="#00d070" />
        <Metric label="Reply rate" value={rr == null ? '—' : rr + '%'} accent={rrColor} deltaCur={rr} deltaPrev={prev && prev.reply_rate_pct} suffix="pt" />
        <Metric label="Connects" value={(cur.bid_total || 0).toLocaleString()} deltaCur={cur.bid_total} deltaPrev={prev && prev.bid_total} hib={false} />
      </div>
    </div>
  )
}

function BidStat({ label, value, sub, accent }) {
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: accent || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Empty({ text }) {
  return <div style={styles.empty}>{text}</div>
}

const styles = {
  page: {
    flex: 1, overflowY: 'auto', padding: '24px 28px',
    background: 'var(--bg)', color: 'var(--text)',
    fontFamily: 'Inter, sans-serif',
  },
  headerRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 20,
  },
  pageTitle: {
    margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)',
    letterSpacing: '0.01em',
  },
  updatedAt: {
    fontSize: 10, color: 'var(--text3)', letterSpacing: '0.04em',
    display: 'block', marginTop: 3,
  },
  refreshBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 11, color: 'var(--text3)', fontFamily: 'inherit',
    letterSpacing: '0.06em', padding: '2px 6px',
    transition: 'color 0.15s',
  },
  cardRow: {
    display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24,
  },
  card: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '12px 16px', minWidth: 110,
  },
  cardValue: {
    fontSize: 22, fontWeight: 700, lineHeight: 1.1, marginBottom: 4,
  },
  cardLabel: {
    fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase',
    letterSpacing: '0.07em', fontWeight: 600,
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 20, marginTop: 20,
  },
  section: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '16px 18px',
  },
  sectionHeader: {
    display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: '#00c8d4',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  sectionHint: {
    fontSize: 10, color: 'var(--text3)', letterSpacing: '0.04em',
  },
  table: {
    width: '100%', borderCollapse: 'collapse',
  },
  th: {
    fontSize: 9, color: 'var(--text2)', textTransform: 'uppercase',
    letterSpacing: '0.08em', textAlign: 'left', padding: '0 8px 8px 0',
    fontWeight: 700,
  },
  td: {
    fontSize: 11, color: 'var(--text)', padding: '4px 8px 4px 0',
    verticalAlign: 'middle',
  },
  // ── Weekly table (primary view) ──
  weekTable: {
    width: '100%', borderCollapse: 'separate', borderSpacing: 0,
  },
  weekTh: {
    fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase',
    letterSpacing: '0.08em', textAlign: 'left',
    padding: '8px 12px', fontWeight: 700,
    borderBottom: '2px solid var(--border)',
  },
  weekTd: {
    fontSize: 12, color: 'var(--text)', padding: '10px 12px',
    verticalAlign: 'middle',
    borderBottom: '1px solid var(--border)',
  },
  // ── shared bar styles ──
  statusDot: {
    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
    marginRight: 5, flexShrink: 0, verticalAlign: 'middle',
  },
  statusLabel: {
    textTransform: 'capitalize', letterSpacing: '0.02em',
  },
  timeLabel: {
    fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap',
  },
  barTrack: {
    height: 8, background: 'var(--bg3)', borderRadius: 4,
    overflow: 'hidden', minWidth: 80,
  },
  barFill: {
    height: '100%', borderRadius: 4,
    transition: 'width 0.4s ease',
  },
  countCell: {
    textAlign: 'right', width: 30, fontWeight: 700,
    color: 'var(--text)',
  },
  pctCell: {
    textAlign: 'right', width: 36,
    color: 'var(--text3)', fontSize: 10,
  },
  empty: {
    fontSize: 11, color: 'var(--text3)',
    padding: '12px 0', letterSpacing: '0.03em',
  },
}
