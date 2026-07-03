function formatRate(min, max) {
  if (!min && !max) return null
  if (min === max || !max) return `$${min}/hr`
  return `$${min}–$${max}/hr`
}

function getRateStyle(min, max) {
  const top = max || min || 0
  if (top >= 50) return { background: 'rgba(0,180,200,0.16)', color: '#0891b2', border: '1px solid rgba(0,180,200,0.40)' }
  if (top >= 30) return { background: 'rgba(0,180,200,0.10)', color: '#0891b2', border: '1px solid rgba(0,180,200,0.28)' }
  // below $30 ceiling — dark orange
  return { background: 'rgba(234,88,12,0.12)', color: '#c2410c', border: '1px solid rgba(234,88,12,0.35)' }
}

function getCountryCode(country) {
  if (!country) return null
  const codes = {
    'Afghanistan': 'af', 'Albania': 'al', 'Algeria': 'dz', 'Argentina': 'ar',
    'Armenia': 'am', 'Australia': 'au', 'Austria': 'at', 'Azerbaijan': 'az',
    'Bahrain': 'bh', 'Bangladesh': 'bd', 'Belarus': 'by', 'Belgium': 'be',
    'Bolivia': 'bo', 'Bosnia and Herzegovina': 'ba', 'Brazil': 'br',
    'Bulgaria': 'bg', 'Cambodia': 'kh', 'Canada': 'ca', 'Chile': 'cl',
    'China': 'cn', 'Colombia': 'co', 'Costa Rica': 'cr', 'Croatia': 'hr',
    'Cyprus': 'cy', 'Czech Republic': 'cz', 'Czechia': 'cz', 'Denmark': 'dk',
    'Dominican Republic': 'do', 'Ecuador': 'ec', 'Egypt': 'eg',
    'El Salvador': 'sv', 'Estonia': 'ee', 'Ethiopia': 'et', 'Finland': 'fi',
    'France': 'fr', 'Georgia': 'ge', 'Germany': 'de', 'Ghana': 'gh',
    'Greece': 'gr', 'Guatemala': 'gt', 'Honduras': 'hn', 'Hong Kong': 'hk',
    'Hungary': 'hu', 'India': 'in', 'Indonesia': 'id', 'Iran': 'ir',
    'Iraq': 'iq', 'Ireland': 'ie', 'Israel': 'il', 'Italy': 'it',
    'Jamaica': 'jm', 'Japan': 'jp', 'Jordan': 'jo', 'Kazakhstan': 'kz',
    'Kenya': 'ke', 'Kuwait': 'kw', 'Latvia': 'lv', 'Lebanon': 'lb',
    'Lithuania': 'lt', 'Luxembourg': 'lu', 'Malaysia': 'my', 'Mexico': 'mx',
    'Moldova': 'md', 'Morocco': 'ma', 'Myanmar': 'mm', 'Nepal': 'np',
    'Netherlands': 'nl', 'New Zealand': 'nz', 'Nicaragua': 'ni',
    'Nigeria': 'ng', 'North Macedonia': 'mk', 'Norway': 'no', 'Oman': 'om',
    'Pakistan': 'pk', 'Panama': 'pa', 'Paraguay': 'py', 'Peru': 'pe',
    'Philippines': 'ph', 'Poland': 'pl', 'Portugal': 'pt', 'Qatar': 'qa',
    'Romania': 'ro', 'Russia': 'ru', 'Saudi Arabia': 'sa', 'Serbia': 'rs',
    'Singapore': 'sg', 'Slovakia': 'sk', 'Slovenia': 'si', 'South Africa': 'za',
    'South Korea': 'kr', 'Korea': 'kr', 'Spain': 'es', 'Sri Lanka': 'lk',
    'Sweden': 'se', 'Switzerland': 'ch', 'Taiwan': 'tw', 'Tanzania': 'tz',
    'Thailand': 'th', 'Tunisia': 'tn', 'Turkey': 'tr', 'Türkiye': 'tr',
    'Uganda': 'ug', 'Ukraine': 'ua', 'United Arab Emirates': 'ae', 'UAE': 'ae',
    'United Kingdom': 'gb', 'UK': 'gb', 'United States': 'us', 'USA': 'us',
    'Uruguay': 'uy', 'Uzbekistan': 'uz', 'Venezuela': 've', 'Vietnam': 'vn',
    'Zimbabwe': 'zw',
  }
  return codes[country] || null
}

function timeAgo(isoString) {
  if (!isoString) return ''
  // Append Z if no timezone info so JS treats it as UTC
  const normalized = isoString.endsWith('Z') || isoString.includes('+') ? isoString : isoString + 'Z'
  const diff = Date.now() - new Date(normalized).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default function JobList({ jobs, selectedId, onSelect, onToggleHidden, onToggleStar, showingHidden }) {
  return (
    <div>
      {jobs.map((job, i) => {
        const rate = formatRate(job.hourly_rate_min, job.hourly_rate_max)
        const rateStyle = getRateStyle(job.hourly_rate_min, job.hourly_rate_max)
        const isSelected = job.id === selectedId
        const isUsOnly = job.geo_restriction && /United States only|US only/i.test(job.geo_restriction)
        // "Enriched" = the extension scraped full detail. For API-sourced jobs,
        // `proposals` is provided natively by the API, so the old heuristic
        // would mark every API job enriched. Require an explicit enriched_at
        // (set only when the extension runs) for API jobs.
        const isEnriched = job.source === 'api'
          ? !!job.enriched_at
          : !!(job.enriched_at || job.connects_required || job.proposals || job.hire_rate)
        const analysis = job.last_analysis || null
        const verdictColor = analysis
          ? ({ APPLY: '#00c8d4', MAYBE: '#f59e0b', SKIP: '#ef4444' }[analysis.verdict] || '#888')
          : null
        const isStarred = !!job.starred

        return (
          <div
            key={job.id}
            onClick={() => onSelect(job.id)}
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              // US-only = hard disqualifier for Artem (Ukraine). Flag the whole
              // card red + grayed-out so it's an obvious skip at a glance.
              borderLeft: `2px solid ${isUsOnly ? '#ef4444' : isStarred ? '#00d070' : isSelected ? '#00c8d4' : 'transparent'}`,
              background: isUsOnly
                ? 'rgba(239,68,68,0.09)'
                : isStarred ? 'rgba(0,208,112,0.07)'
                : isSelected ? 'rgba(0,200,212,0.08)' : 'transparent',
              opacity: isUsOnly ? 0.55 : 1,
              filter: isUsOnly ? 'grayscale(0.65)' : 'none',
              cursor: 'pointer',
              transition: 'background 0.1s, opacity 0.1s',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
                #{String(i + 1).padStart(3, '0')}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {/* Analyser verdict badge — only shown once an analysis has been run */}
                {analysis && verdictColor && (
                  <span
                    title={analysis.summary || `${analysis.verdict} score ${analysis.score}`}
                    style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '3px 8px', borderRadius: 3,
                      background: verdictColor + '22', color: verdictColor,
                      border: `1px solid ${verdictColor}44`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {analysis.verdict}/{analysis.score}
                  </span>
                )}
                {/* Enriched badge — glowing mint green, matches the Enriched button */}
                {isEnriched && (
                  <img
                    src="/falcon-scout-mark5.png"
                    alt="Enriched"
                    title={`Enriched${job.enriched_at ? ' • ' + new Date(job.enriched_at).toLocaleString() : ''}`}
                    style={{
                      height: 28,
                      width: 'auto',
                      display: 'block',
                      objectFit: 'contain',
                      // Green logo with a DARKER, more visible green glow halo
                      // around it (deeper emerald drop-shadows) so the badge
                      // stands out strongly against the light feed background.
                      filter: [
                        'brightness(0) invert(1)',
                        'sepia(1) saturate(8) hue-rotate(90deg) brightness(1.05)',
                        'drop-shadow(0 0 1px rgba(5,120,70,0.5))',
                        'drop-shadow(0 0 4px rgba(4,100,58,0.32))',
                        'drop-shadow(0 0 8px rgba(6,78,59,0.2))',
                      ].join(' '),
                      flexShrink: 0,
                    }}
                  />
                )}
                {/* Star / mark button — big green tick to flag a job to come back to */}
                {onToggleStar && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleStar(job.id, isStarred) }}
                    title={isStarred ? 'Unmark' : 'Mark to come back to'}
                    style={{
                      background: isStarred ? '#00d070' : 'transparent',
                      border: `1px solid ${isStarred ? '#00d070' : 'var(--border)'}`,
                      color: isStarred ? '#fff' : 'var(--text3)',
                      width: 22, height: 22, borderRadius: 3,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 15, fontWeight: 800, lineHeight: 1, fontFamily: 'inherit',
                      cursor: 'pointer', flexShrink: 0,
                      boxShadow: isStarred ? '0 0 6px rgba(0,208,112,0.5)' : 'none',
                      transition: 'color 0.12s, border-color 0.12s, background 0.12s',
                    }}
                    onMouseEnter={(e) => {
                      if (isStarred) return
                      e.currentTarget.style.color = '#00d070'
                      e.currentTarget.style.borderColor = 'rgba(0,208,112,0.5)'
                      e.currentTarget.style.background = 'rgba(0,208,112,0.08)'
                    }}
                    onMouseLeave={(e) => {
                      if (isStarred) return
                      e.currentTarget.style.color = 'var(--text3)'
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    ✓
                  </button>
                )}
                {onToggleHidden && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleHidden(job.id, showingHidden) }}
                    title={showingHidden ? 'Restore to feed' : 'Hide from feed'}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text3)',
                      width: 22, height: 22,
                      borderRadius: 3,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, lineHeight: 1, fontFamily: 'inherit',
                      cursor: 'pointer', flexShrink: 0,
                      transition: 'color 0.12s, border-color 0.12s, background 0.12s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = showingHidden ? '#00c8d4' : '#e05050'
                      e.currentTarget.style.borderColor = showingHidden ? 'rgba(0,200,212,0.5)' : 'rgba(224,80,80,0.5)'
                      e.currentTarget.style.background = showingHidden ? 'rgba(0,200,212,0.08)' : 'rgba(224,80,80,0.08)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text3)'
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {showingHidden ? '↺' : '×'}
                  </button>
                )}
              </div>
            </div>
            <div style={{
              fontSize: 14, fontFamily: 'var(--font-display)', fontWeight: 700,
              color: isSelected ? '#00c8d4' : 'var(--text)', lineHeight: 1.45, marginBottom: 7,
            }}>
              {job.title || 'Untitled'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              {rate && (
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '3px 7px', borderRadius: 3, ...rateStyle }}>
                  {rate}
                </span>
              )}
              {isUsOnly && (
                <span title={job.geo_restriction} style={{ fontSize: 11, fontWeight: 700, padding: '3px 7px', borderRadius: 3, background: 'rgba(239,68,68,0.13)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.35)', letterSpacing: '0.04em' }}>
                  🇺🇸 US only
                </span>
              )}
              {job.client_country && (
                <span style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {(() => {
                    const code = getCountryCode(job.client_country)
                    return code
                      ? <img src={`https://flagcdn.com/20x15/${code}.png`} srcSet={`https://flagcdn.com/40x30/${code}.png 2x`} width="20" height="15" alt={job.client_country} style={{ display:'inline-block', verticalAlign:'middle', borderRadius:1, flexShrink:0 }} />
                      : <span>🌐</span>
                  })()}
                  {job.client_country}
                </span>
              )}
              {job.client_spend && (
                <span style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {job.client_spend}
                </span>
              )}
              {/* Avg rate badge — client's historical pay rate */}
              {job.avg_rate && (() => {
                const n = parseFloat(String(job.avg_rate).replace(/[^0-9.]/g, '')) || 0
                const color = n > 45 ? '#00e070' : n >= 30 ? '#00c8d4' : '#f59e0b'
                const bg    = n > 45 ? 'rgba(0,224,112,0.10)' : n >= 30 ? 'rgba(0,200,212,0.10)' : 'rgba(245,158,11,0.10)'
                return (
                  <span title="Client avg hourly rate paid" style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: bg, color, border: `1px solid ${color}44` }}>
                    💵 ${job.avg_rate}
                  </span>
                )
              })()}
              {/* Boost bid badge — top connect bid from the apply page */}
              {job.boost_bids && job.boost_bids.length > 0 && (
                <span
                  title={`Boost top bid: ${job.boost_bids[0].connects} connects (${job.boost_bids[0].age})`}
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.10)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.28)', letterSpacing: '0.02em', flexShrink: 0 }}
                >
                  ⚡{job.boost_bids[0].connects}c
                </span>
              )}
              {/* Applied badge — shown when a proposal exists in Outcomes */}
              {job.proposal_status && (
                <span title={`Proposal status: ${job.proposal_status}`} style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  background: job.proposal_status === 'hired'      ? 'rgba(0,208,112,0.15)'
                            : job.proposal_status === 'replied' || job.proposal_status === 'interviewing' ? 'rgba(0,200,212,0.12)'
                            : job.proposal_status === 'invited'    ? 'rgba(168,85,247,0.12)'
                            : 'rgba(255,255,255,0.07)',
                  color:      job.proposal_status === 'hired'      ? '#00d070'
                            : job.proposal_status === 'replied' || job.proposal_status === 'interviewing' ? '#00c8d4'
                            : job.proposal_status === 'invited'    ? '#a855f7'
                            : 'var(--text3)',
                  border: '1px solid currentColor',
                }}>
                  {job.proposal_status === 'sent' || job.proposal_status === 'viewed' ? 'applied' : job.proposal_status}
                </span>
              )}
              {/* Relative capture time — e.g. "3h ago" */}
              <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                {timeAgo(job.captured_at)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
