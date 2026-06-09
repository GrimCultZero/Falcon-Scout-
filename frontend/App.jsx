import { useCallback, useEffect, useState } from 'react'
import JobDetail from './components/JobDetail'
import JobList from './components/JobList'

export default function App() {
  const [jobs, setJobs] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchJobs = useCallback(async (q, f) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (f && f !== 'all') params.set('filter_type', f)
      const url = '/jobs?' + params.toString()
      const res = await fetch(url)
      if (!res.ok) throw new Error('API error ' + res.status)
      const data = await res.json()
      setJobs(data)
      if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => { fetchJobs('') }, [])
  useEffect(() => { fetchJobs(query, filter) }, [query, filter])
  useEffect(() => {
    const interval = setInterval(() => fetchJobs(query, filter), 30000)
    return () => clearInterval(interval)
  }, [query, filter, fetchJobs])

  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null

  const filters = [
    { key: 'all',         label: 'All' },
    { key: 'today',       label: 'Today' },
    { key: 'high_budget', label: '>$30/hr' },
    { key: 'no_us_only',  label: 'No US-only' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg)', color:'var(--text)', fontFamily:'var(--font-mono)', overflow:'hidden' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      <header style={{ display:'flex', alignItems:'center', gap:16, padding:'0 24px', height:52, background:'#1a3a4a', flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,0.15)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:22, height:22, background:'#2ab8b8', clipPath:'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)', flexShrink:0 }} />
          <span style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:15, color:'#fff' }}>
            Upwork<span style={{ color:'#2ab8b8' }}>Cockpit</span>
          </span>
        </div>
        <div style={{ width:1, height:20, background:'rgba(255,255,255,0.15)' }} />
        <span style={{ fontSize:11, color:'rgba(255,255,255,0.6)' }}>
          <strong style={{ color:'#2ab8b8' }}>{jobs.length}</strong> {jobs.length === 1 ? 'job' : 'jobs'} captured
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto', fontSize:10, color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background: error ? '#e74c3c' : loading ? '#2ab8b8' : '#2ecc71', boxShadow:'0 0 6px ' + (error ? '#e74c3c' : loading ? '#2ab8b8' : '#2ecc71'), animation: error ? 'none' : 'pulse 2s ease-in-out infinite' }} />
          {loading ? 'syncing' : error ? 'error' : 'live'}
        </div>
      </header>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <aside style={{ width:300, flexShrink:0, display:'flex', flexDirection:'column', borderRight:'1px solid var(--border)', background:'var(--bg2)' }}>
          <div style={{ padding:12, borderBottom:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ position:'relative' }}>
              <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', fontSize:14, pointerEvents:'none' }}>⌕</span>
              <input type="search" placeholder="Search jobs..." value={query} onChange={(e) => setQuery(e.target.value)}
                style={{ width:'100%', background:'#fff', border:'1px solid var(--border2)', color:'var(--text)', fontFamily:'var(--font-mono)', fontSize:11, padding:'8px 10px 8px 32px', borderRadius:4, outline:'none' }} />
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {filters.map(({ key, label }) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  padding:'4px 12px', fontSize:10, fontFamily:'var(--font-mono)', borderRadius:20,
                  border:'1px solid ' + (filter === key ? '#1a7a7a' : 'var(--border2)'),
                  background: filter === key ? '#1a7a7a' : '#fff',
                  color: filter === key ? '#fff' : 'var(--text2)',
                  cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.06em'
                }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {jobs.length === 0 && !loading && (
              <div style={{ padding:'48px 20px', textAlign:'center' }}>
                <div style={{ fontSize:28, marginBottom:12, opacity:0.3 }}>📡</div>
                <p style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>
                  {query || filter !== 'all' ? 'No jobs match your filters.' : 'Listening for new jobs...'}
                </p>
              </div>
            )}
            <JobList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </aside>

        <main style={{ flex:1, overflowY:'auto', background:'var(--bg)' }}>
          {selectedJob
            ? <JobDetail job={selectedJob} />
            : <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text3)', fontSize:11, letterSpacing:'0.06em', textTransform:'uppercase' }}>Select a job to view details</div>
          }
        </main>
      </div>
    </div>
  )
}
