// The two Metro marks (F5, item 6). Drawn by the planning chat, kept exactly as drawn: frontend/public/metro-badge.svg and
// metro-wagon.svg are the masters (the favicon reads the first one from public). The page inlines identical copies from
// src/metro/assets so CSS can reach their parts (`.lamp` on the badge, `.speed` on the wagon); a test pins the copies to the masters.
//   Badge: the MAIN mark (Metro header, favicon). While something runs its two headlights pulse (opacity only).
//   Wagon: the secondary mark. It rides the progress bar, and sits on empty and loading states.
import badgeSvg from '../assets/metro-badge.svg?raw'
import wagonSvg from '../assets/metro-wagon.svg?raw'
import '../metro.css'

// the files carry fixed width/height; the page sizes the mark with CSS, so drop them from the inlined copy only
// (the file's own role / label go too: the wrapper below says what the mark is, or hides it when it is only decoration)
const sized = (svg) => svg.replace(/\s(width|height)="\d+"/g, '').replace(/\srole="img"\saria-label="[^"]*"/, '')
const BADGE = sized(badgeSvg)
const WAGON = sized(wagonSvg)

export function Badge({ running = false, size = 44, title = 'Metro by IT Force' }) {
  return <span className={`mt-badge${running ? ' is-running' : ''}`} style={{ width: size, height: size }} role="img" aria-label={title}
    data-testid="metro-badge" data-running={running ? 'true' : 'false'} dangerouslySetInnerHTML={{ __html: BADGE }} />
}

export function Wagon({ width = 52, className = '', style, ...rest }) {
  return <span className={`mt-wagon ${className}`.trim()} style={{ width, height: width * 64 / 130, ...style }} aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: WAGON }} {...rest} />
}

// An empty or loading state with the wagon on it: `moving` rolls it to and fro (a loading state), still otherwise.
export function Empty({ children, moving = false, testid }) {
  return (
    <div className="mt-empty" data-testid={testid}>
      <div className={`mt-empty-track${moving ? ' is-moving' : ''}`}><Wagon width={46} /></div>
      <div className="mt-empty-text">{children}</div>
    </div>
  )
}
