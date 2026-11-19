// What the header AI-provider chip (App.jsx AiProviderChip) should show, as a pure
// function -- extracted so the auth-visibility logic (owner report, 2026-11-19: the
// chip stayed green after `claude`'s login expired, because the bridge being UP and
// `claude` actually being logged in are two different things) is testable without
// rendering React.
//
// `bridgeOk`    - /ai-provider/bridge-status's `up` (the bridge's Node server answers).
// `authReason`  - the short reason string from that same response's auth_reason, but
//                 ONLY when auth_ok === false; null whenever the login is fine, unknown
//                 (an older bridge build), or the bridge is not CLI / not up at all.
export function aiProviderChipView(provider, bridgeOk, authReason) {
  const isCli = provider === 'cli'
  const healthy = bridgeOk && !authReason
  const dotColor = isCli ? (healthy ? '#00e070' : '#ef4444') : 'rgba(255,255,255,0.30)'
  const borderColor = isCli ? (healthy ? 'rgba(0,224,112,0.35)' : 'rgba(239,68,68,0.35)') : 'rgba(255,255,255,0.15)'
  const background = isCli ? (healthy ? 'rgba(0,224,112,0.08)' : 'rgba(239,68,68,0.10)') : 'rgba(255,255,255,0.05)'
  const tip = isCli
    ? (healthy ? 'CLI Bridge online — using claude -p subscription (click to switch back to API)'
       : authReason ? `CLI Bridge: ${authReason} (click to switch back to API)`
       : 'CLI Bridge OFFLINE — run: node cli-bridge.js  (click to switch back to API)')
    : 'Using Anthropic API key (click to switch to CLI Bridge — uses your Claude subscription, no per-token cost)'
  return { isCli, healthy, dotColor, borderColor, background, tip }
}

// From a /ai-provider/bridge-status response, the authReason aiProviderChipView wants:
// null unless the bridge is up AND explicitly reports auth_ok === false (an older
// bridge build, or one with no opinion yet, reports no auth_ok at all -- that must
// never be treated as a problem).
export function authReasonFromBridgeStatus(d) {
  return (d && d.up && d.auth_ok === false) ? d.auth_reason : null
}
