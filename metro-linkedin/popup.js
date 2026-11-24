const $ = (id) => document.getElementById(id)
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r))
async function render() {
  const { state, week } = await send({ type: 'METRO_STATUS' })
  $('on').checked = !!state.enabled
  $('prof').value = state.chrome_profile || ''
  $('week').innerHTML = week
    ? (week.week_mode === 'metro'
      ? `Metro week. Visits today: <b>${week.visits} of ${week.cap}</b>`
      : '<span class="lh">Linked Helper week: this extension does nothing.</span>')
    : '<span class="warn">Metro backend not reachable (is falconscout.bat running?)</span>'
  $('acct').innerHTML = state.sender_id
    ? `Signed in as <b>${state.account_label || state.account_ref}</b> (${state.role || 'scraper'})`
    : '<span class="warn">No account yet. Open linkedin.com/feed in this Chrome profile once; it is read from the page, no extra visit.</span>'
  const l = state.last
  $('last').textContent = l ? `${new Date(l.at).toLocaleTimeString()}: ${l.status}` : ''
}
$('on').onchange = async (e) => { await send({ type: 'METRO_SET', patch: { enabled: e.target.checked } }); render() }
$('prof').onchange = async (e) => { await send({ type: 'METRO_SET', patch: { chrome_profile: e.target.value.trim() } }) }
$('now').onclick = async () => { await send({ type: 'METRO_NOW' }); setTimeout(render, 1500) }
render()
