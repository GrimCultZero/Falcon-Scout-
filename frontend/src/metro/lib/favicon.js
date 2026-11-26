// The browser-tab icon follows the side (F5, item 6): Metro shows the badge (frontend/public/metro-badge.svg), Falcon Scout keeps the
// icons index.html declares. Switching never reloads; the Falcon links are taken out while Metro shows and put back after.
export const METRO_ICON = '/metro-badge.svg'
let kept = null

export function applyFavicon(doc, side) {
  const head = doc && doc.head
  if (!head) return
  const mine = head.querySelector('link[data-metro-favicon]')
  if (side === 'metro') {
    if (mine) return
    const own = [...head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
    if (!kept) kept = own
    own.forEach((l) => l.remove())
    const link = doc.createElement('link')
    link.setAttribute('rel', 'icon')
    link.setAttribute('type', 'image/svg+xml')
    link.setAttribute('href', METRO_ICON)
    link.setAttribute('data-metro-favicon', '1')
    head.appendChild(link)
  } else {
    if (mine) mine.remove()
    if (kept) { kept.forEach((l) => head.appendChild(l)); kept = null }
  }
}
