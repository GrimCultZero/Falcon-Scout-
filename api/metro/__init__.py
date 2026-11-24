"""Metro: the outbound lead-gen side of Falcon Scout (METRO_PLAN.md).

Walled off from the Upwork side: Metro code lives in api/metro/, frontend/src/metro/ and
tests/metro/. api/main.py only mounts `router` (one line); nothing here imports api/main.py.
Metro tables all start with `metro_` and are created and migrated by api/metro/db.py; the
`jobs` and `proposals` tables are never written by Metro (proposals are only read, by the
suppression import).
"""
