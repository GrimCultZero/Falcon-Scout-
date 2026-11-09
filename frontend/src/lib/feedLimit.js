// How many feed rows the dashboard asks for (audit 2026-10-29, T21).
//
// GET /jobs returns 200 rows unless told otherwise, which is about one day of API
// volume, so the feed silently stopped at yesterday while the jobs it keeps (72 h) were
// all stored. The busiest 72 h so far held about 565 jobs (302 + 167 + 96 on Nov 5-7);
// 800 covers that with headroom. The backend accepts up to 2000.
export const FEED_LIMIT = 800
