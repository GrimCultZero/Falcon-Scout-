// The browser-tab icon follows the side (F5, item 6; P3b Minor fixes #1 and #8): Metro shows the approved Metro mark
// (frontend/public/brand/metro-mark.png), Falcon Scout keeps the icons index.html declares. Switching never reloads; the Falcon links
// are taken out while Metro shows and put back after. Falcon Scout's new-jobs bell redraws "the" icon link: while Metro shows, a watcher
// puts the Metro mark back (the bell's count belongs to the Falcon Scout title, not to the Metro tab icon).
export const METRO_ICON = '/brand/metro-mark.png'
let kept = null
let guard = null

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
    link.setAttribute('type', 'image/png')
    link.setAttribute('href', METRO_ICON)
    link.setAttribute('data-metro-favicon', '1')
    head.appendChild(link)
    if (typeof MutationObserver !== 'undefined') {
      guard = new MutationObserver(() => { if (link.getAttribute('href') !== METRO_ICON) link.setAttribute('href', METRO_ICON) })
      guard.observe(link, { attributes: true, attributeFilter: ['href'] })
    }
  } else {
    if (guard) { guard.disconnect(); guard = null }
    if (mine) mine.remove()
    if (kept) { kept.forEach((l) => head.appendChild(l)); kept = null }
  }
}
