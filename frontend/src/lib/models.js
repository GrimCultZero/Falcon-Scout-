// Model names for every Claude call the frontend makes: ONE place (owner, 2026-11-24: "always use Sonnet 5 or
// 5.5"). There is no moving "latest" alias, so moving to a newer Sonnet means changing SONNET_MODEL here and
// SONNET_MODEL in api/main.py (the backend also rewrites any Sonnet name it receives, so the app can never be
// pinned to an old Sonnet by a stale name in a component). Haiku runs the cheap passes and stays on 4.5.
export const SONNET_MODEL = 'claude-sonnet-5-5'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
