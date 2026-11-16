// Replays the auto Digit Bomb matcher over jobs read from stdin (JSON array). No model call, no network.
// Used by tools/digit_bomb_replay.py:  python tools/digit_bomb_replay.py [--days 7] [--examples N|all] [--previous 22798,22961,...]
import { rankCases, findAutoBomb, jobSignals } from '../frontend/src/lib/digitBombMatch.js'
import * as CONFIG from '../frontend/src/lib/digitBombConfig.js'

const input = JSON.parse(await new Promise((res) => { let b = ''; process.stdin.on('data', d => b += d); process.stdin.on('end', () => res(b || '[]')) }))
const nExamples = process.argv[2] === 'all' ? Infinity : Number(process.argv[2] || 5)
const previous = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean)
const fired = [], near = []
const byService = {}
for (const job of input) {
  const sig = jobSignals(job)
  byService[sig.service || 'unknown'] = (byService[sig.service || 'unknown'] || 0) + 1
  const hit = findAutoBomb(job)
  if (hit) fired.push({ job, hit })
  else { const top = rankCases(job)[0]; if (top && top.score >= CONFIG.AUTO_BOMB.AUTO_FIRE_AT - 15) near.push({ job, top }) }
}
const line = (j) => `#${j.id} "${String(j.title).slice(0, 110)}"`
console.log(`jobs replayed: ${input.length}   threshold: ${CONFIG.AUTO_BOMB.AUTO_FIRE_AT}`)
console.log(`would AUTO-FIRE: ${fired.length} (${input.length ? (100 * fired.length / input.length).toFixed(1) : 0}%)`)
console.log('job service split:', JSON.stringify(byService))
const perCase = {}; fired.forEach(f => { perCase[f.hit.caseId] = (perCase[f.hit.caseId] || 0) + 1 })
console.log('fires per case:', JSON.stringify(perCase))
console.log(`\nJOBS THAT FIRE (${Math.min(nExamples, fired.length)} of ${fired.length}):`)
fired.slice(0, nExamples).forEach(({ job, hit }) => {
  const s = hit.signals
  console.log(`  ${line(job)}\n    -> ${hit.caseName} (${hit.service}), total ${hit.score}\n` +
    `       service: ${s.service} score ${s.serviceScores[s.service] ?? 0}; ${s.serviceReason}\n` +
    `       niche: ${hit.parts.niche}/70 via ${JSON.stringify(hit.parts.shared)}; job niches ${JSON.stringify(s.niche)}\n` +
    `       market ${hit.parts.market}, platform ${hit.parts.platform}, model ${hit.parts.model}`)
})
if (previous.length) {
  const ids = new Set(fired.map(f => String(f.job.id)))
  const stopped = previous.filter(id => !ids.has(id)), kept = previous.filter(id => ids.has(id))
  console.log(`\nPREVIOUS FIRES: ${previous.length}; still fire: ${JSON.stringify(kept)}; stopped: ${JSON.stringify(stopped)}`)
  const byId = new Map(input.map(j => [String(j.id), j]))
  for (const id of stopped) {
    const j = byId.get(id); if (!j) continue
    const s = jobSignals(j), top = rankCases(j)[0]
    console.log(`  stopped ${line(j)}\n     service now: ${s.service || 'none'} (${s.serviceReason}); best case now: ${top ? `${top.caseName} ${top.score}` : 'none'}`)
  }
  const newOnes = fired.filter(f => !previous.includes(String(f.job.id)))
  console.log(`  newly firing (not in the previous 8): ${newOnes.length ? newOnes.map(f => '#' + f.job.id).join(', ') : 'none'}`)
}
