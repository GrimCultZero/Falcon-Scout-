import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Falcon Scout pins port 5180 to avoid clashing with other local Vite
// projects (which default to 5173 and roll forward to 5174 etc. when busy).
// strictPort means Vite exits if 5180 is in use rather than silently
// hopping to a different port — so the URL in falconscout.bat / the
// extension / the backend CORS list stays in sync with reality.
//
// Shared between `server` (dev, `vite`/`npm run dev`) and `preview` (the
// production build served by `vite preview`, used by the daily launcher) so
// the two never drift apart — a route missing from preview.proxy would 404
// in production but work fine in dev, silently.
const PROXY = {
  '/jobs': 'http://localhost:8000',
  '/enrich': 'http://localhost:8000',
  '/claude': 'http://localhost:8000',
  '/ai-provider': 'http://localhost:8000',
  '/kb': 'http://localhost:8000',
  '/proposals': 'http://localhost:8000',
  '/chat': 'http://localhost:8000',
  '/share-with-claude': 'http://localhost:8000',
  '/usage-stats': 'http://localhost:8000',
  '/rule-violations': 'http://localhost:8000',
  '/capture-conversation': 'http://localhost:8000',
  '/capture-proposal-update': 'http://localhost:8000',
  '/capture-standalone-proposal': 'http://localhost:8000',
  '/dashboard-stats': 'http://localhost:8000',
  '/calibration': 'http://localhost:8000',
  '/generations': 'http://localhost:8000',
  '/bid-signals': 'http://localhost:8000',
  '/style-variants': 'http://localhost:8000',
  '/proposal-submitted': 'http://localhost:8000',
  '/proposal-status-sync': 'http://localhost:8000',
  '/messages-status-sync': 'http://localhost:8000',
  '/api-fetch': 'http://localhost:8000',
  '/api-feed': 'http://localhost:8000',
  '/feed-config': 'http://localhost:8000',
  '/upwork': 'http://localhost:8000',
  '/outcomes-activity': 'http://localhost:8000',
  '/backup-status': 'http://localhost:8000',
  '/health': 'http://localhost:8000',
  '/feed-drops': 'http://localhost:8000',
  '/sync-runs': 'http://localhost:8000',
  '/focus-test': 'http://localhost:8000',
  '/metro': 'http://localhost:8000',   // Metro (api/metro/router.py)
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: PROXY,
  },
  preview: {
    port: 5180,
    strictPort: true,
    proxy: PROXY,
  },
})
