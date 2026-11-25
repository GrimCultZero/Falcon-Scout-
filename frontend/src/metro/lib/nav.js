// "A click opens the screen where it runs" (METRO_TASK.md F4): anything outside MetroApp (the strip on the Falcon Scout side, the
// shell) asks Metro to show a tab / campaign through here. A request that arrives before MetroApp has mounted waits for it.
let pending = null
export function requestGoto(target) {
  pending = target
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('metro-goto', { detail: target }))
}
export function takePending() { const p = pending; pending = null; return p }
