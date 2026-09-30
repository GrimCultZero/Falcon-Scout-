// Falcon Scout - Messages-inbox list scraper
//
// Runs on Upwork's messages UI. On Upwork, the "inbox" is actually a
// /messages/rooms/<id> page with a LEFT SIDEBAR listing all conversations
// (Upwork auto-redirects /messages/rooms/ → /messages/rooms/<first-id>).
//
// When the sync flow opens this page in a tracked background tab:
//   1. Wait for the sidebar conversation list to render
//   2. Scroll from the TOP down, scraping at every step (virtualised rows —
//      see collectConversationRows)
//   3. For each conversation row, extract:
//        - room_id, room_url
//        - job_title   (best-effort — usually shown as the subtitle)
//        - client_name (best-effort — the visible "from" name)
//        - has_unread  (bold row / unread badge present)
//   4. Send the batch to the background worker → POSTs to backend
//      /messages-status-sync → promotes matching Proposal rows from
//      sent/viewed/draft → replied.
//
// Coexists with messages.js (which handles single-room capture) — both
// listen to chrome.runtime.onMessage for different message types.

(function () {
  'use strict';

  function isMessagesPage() {
    // Any /messages or /(nx|ab)/messages path, including /rooms/<id>.
    // We rely on ASK_AUTO_SYNC tab tracking (NOT URL alone) to decide
    // whether to actually scrape — manual visits don't trigger sync.
    const p = window.location.pathname;
    return /^\/(nx\/|ab\/)?messages\b/.test(p);
  }

  if (!isMessagesPage()) return; // not our page; bail silently

  console.log('[Cockpit Messages-List] Loaded on', window.location.href);

  // Locate the LEFT SIDEBAR that holds the conversation list. The sidebar is
  // a scrollable container; we find it by looking up from a room anchor for
  // the closest ancestor with overflow-y set to auto/scroll.
  // The conversation list = the scroller shared by the most ROOM links. Not "the
  // first link's scroller": the first /messages/rooms/ link on the page is the
  // left nav's "Messages" item, which has none (5.3's list_diag, 2026-09-30:
  // groups {none: 1, div.rooms-panel-room-list.rooms-panel-items: 20}) — so the
  // list was never scrolled at all.
  const _ROOM_HREF_RE = /\/messages\/rooms\/(?:room[_~])?[A-Za-z0-9_~-]+/i;
  function findSidebarContainer() {
    const counts = new Map();
    for (const a of document.querySelectorAll('a[href*="/messages/rooms/"]')) {
      if (!_ROOM_HREF_RE.test(a.getAttribute('href') || '')) continue;
      const sc = _scrollablesUp(a)[0];
      if (sc) counts.set(sc, (counts.get(sc) || 0) + 1);
    }
    let best = null, n = 0;
    for (const [el, c] of counts) if (c > n) { best = el; n = c; }
    return best;
  }
  // Every scrollable ancestor of a node, nearest first. The list can sit more
  // than 10 levels above a row, and an outer panel can be scrolled too.
  function _scrollablesUp(node) {
    const out = [];
    for (let el = node && node.parentElement, i = 0; el && el !== document.documentElement && i < 25; el = el.parentElement, i++) {
      const s = window.getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) out.push(el);
    }
    return out;
  }

  // What the list looked like, for messages_sync_debug.json (walk_info.list_diag).
  // Added 2026-09-30: a sync that reloaded to 5.2 still read 20 older, mostly
  // contract conversations and none of the five newest — the page shape has to be
  // seen to be fixed. Structure only, plus the first rows' own identity lines.
  function _listDiag() {
    const anchors = [...document.querySelectorAll('a[href*="/messages/rooms/"]')];
    const groups = {};
    for (const a of anchors) {
      const sc = _scrollablesUp(a)[0];
      const key = sc ? `${sc.tagName.toLowerCase()}.${String(sc.className || '').split(/\s+/).slice(0, 2).join('.')}`.slice(0, 70) : 'none';
      groups[key] = (groups[key] || 0) + 1;
    }
    const sb = findSidebarContainer();
    const pressed = [...document.querySelectorAll('[aria-pressed="true"],[aria-selected="true"],[aria-current="page"],[aria-current="true"]')]
      .map(e => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 10);
    const first = anchors.slice(0, 8).map(a => {
      let c = a; for (let i = 0; i < 6 && c; i++) { if ((c.innerText || '').trim().split('\n').length >= 2) break; c = c.parentElement; }
      return (c && c.innerText || '').trim().split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 90);
    });
    return {
      url: location.pathname + location.search.slice(0, 60),
      anchors: anchors.length, groups,
      sidebar: sb ? { top: Math.round(sb.scrollTop), height: sb.scrollHeight, client: sb.clientHeight } : null,
      pressed, first_rows: first,
    };
  }

  // Only waits for the list to exist. The scrolling that used to live here is in
  // collectConversationRows, which scrapes as it scrolls.
  async function waitForListContent(maxMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (document.querySelectorAll('a[href*="/messages/rooms/"]').length > 0) {
        await new Promise(r => setTimeout(r, 700));   // settle
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.warn('[Cockpit Messages-List] No conversation rows found within', maxMs, 'ms');
    return false;
  }

  // Collect rows TOP-DOWN, scraping at every scroll step. The list is
  // virtualised: only rows near the visible window exist in the DOM. The old
  // flow scrolled to the BOTTOM and scraped once, so it saw the oldest loaded
  // conversations and none of the newest — on 2026-09-30 both morning syncs read
  // 20 conversations from Jul 2026 back to 2025. Sofia Toro's decline from the
  // night before was not among them, and a July Galactic Fed thread was matched
  // and promoted instead, landing on top of Outcomes. Start at the top, keep
  // first-seen order (newest first), and leave the list back at the top.
  // Returns the rows; the list's shape before and after lands in LIST_DIAG.
  let LIST_DIAG = null;
  async function collectConversationRows() {
    const before = _listDiag();
    // The list and every scrollable layer above it back to the top. The sync lands
    // on the LAST ROOM opened — often an old one the walk just visited — and Upwork
    // scrolls the list to show it, so without this the rows read are the ones
    // around that room (the 30 Sep morning syncs read Jul 2026 back to 2025).
    const sidebar = findSidebarContainer();
    if (sidebar) for (const el of [sidebar, ..._scrollablesUp(sidebar)]) el.scrollTop = 0;
    await new Promise(r => setTimeout(r, 900));
    const byRoom = new Map();
    const add = () => { for (const r of scrapeConversationList()) if (!byRoom.has(r.room_id)) byRoom.set(r.room_id, r); };
    add();
    const atTop = _listDiag();
    if (sidebar) {
      for (let step = 1; step <= 4; step++) {
        sidebar.scrollTop = Math.round(sidebar.scrollHeight * step / 4);
        await new Promise(r => setTimeout(r, 600));
        add();
      }
      sidebar.scrollTop = 0;
    }
    LIST_DIAG = { before, at_top: atTop, rows_collected: byRoom.size };
    return [...byRoom.values()];
  }

  // The row's time/date line → ISO timestamp of the conversation's last activity.
  // Upwork shows "7:57 PM" (today), "Yesterday", a weekday name (this week), or
  // "9/22/26" (M/D/YY). A date with no time is taken at local noon. Null when the
  // row has none — the backend then uses the sync time, as it always did.
  const _WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function _listWhen(lines, now = new Date()) {
    for (const raw of lines.slice(0, 5)) {
      const ln = String(raw || '').trim().toLowerCase();
      let m = ln.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
      if (m) {
        let h = Number(m[1]) % 12; if (m[3] === 'pm') h += 12;
        const d = new Date(now); d.setHours(h, Number(m[2]), 0, 0);
        return d.toISOString();
      }
      if (ln === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return d.toISOString(); }
      const wd = _WEEKDAYS.indexOf(ln);
      if (wd !== -1) {
        const d = new Date(now); d.setHours(12, 0, 0, 0);
        const back = ((d.getDay() - wd + 7) % 7) || 7;   // most recent past one, never today
        d.setDate(d.getDate() - back);
        return d.toISOString();
      }
      m = ln.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
      if (m) {
        const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        const d = new Date(y, Number(m[1]) - 1, Number(m[2]), 12, 0, 0, 0);
        return isNaN(d) ? null : d.toISOString();
      }
    }
    return null;
  }

  function scrapeConversationList() {
    const rows = [];
    // Each conversation row contains an anchor linking to /messages/rooms/<id>.
    // We pick the OUTERMOST useful container by walking up until we hit
    // something that contains substantive text (client name + last message
    // preview) so we can detect the unread state and grab the job title.
    const anchors = document.querySelectorAll('a[href*="/messages/rooms/"]');
    const seenRooms = new Set();
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const roomMatch = href.match(/\/messages\/rooms\/(?:room[_~])?([A-Za-z0-9_~-]+)/i);
      if (!roomMatch) continue;
      const room_id = roomMatch[1];
      if (seenRooms.has(room_id)) continue;
      seenRooms.add(room_id);

      // Walk up to the row container — usually the LI / DIV holding both
      // the anchor and its sibling rich content.
      let container = a;
      for (let i = 0; i < 6 && container; i++) {
        const txt = (container.innerText || '').trim();
        // A real row container has at least: client name + message preview
        if (txt.length > 50 && txt.split('\n').length >= 2) break;
        container = container.parentElement;
      }
      if (!container) continue;

      const rowText = (container.innerText || '').trim();
      // The first line is typically the client name; second line is usually
      // a timestamp or subtitle; later lines are the message preview.
      const lines = rowText.split('\n').map(s => s.trim()).filter(Boolean);
      const client_name = lines[0] || '';
      // Job title — often shown as the second visible line or as a separate
      // subtitle. Heuristic: pick a line that isn't a date/time and isn't
      // a generic preview phrase.
      let job_title = '';
      for (let i = 1; i < Math.min(lines.length, 5); i++) {
        const ln = lines[i];
        if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(ln)) continue;     // timestamps
        if (/^(yesterday|today|\d+\s+(min|hour|day|week|month)s?\s+ago)$/i.test(ln)) continue;
        // weekday / M/D/YY date lines ("Thursday", "3/26/26") were read as job titles
        if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(ln)) continue;
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(ln)) continue;
        if (ln.length < 5 || ln.length > 200) continue;
        if (/^(typing|you:|delivered|read|sent)\b/i.test(ln)) continue;
        job_title = ln;
        break;
      }

      // Last-message preview = the bottom line of the row (the snippet Upwork
      // shows). If it starts with "You:" the freelancer sent last (not a fresh
      // client reply); otherwise treat it as the client's latest message text.
      let last_message = '';
      let last_from_client = false;
      const lastLine = lines[lines.length - 1] || '';
      if (lastLine && lastLine.length > 1 && lastLine.length < 400 &&
          !/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(lastLine)) {
        if (/^you\s*:/i.test(lastLine)) {
          last_message = lastLine.replace(/^you\s*:\s*/i, '').trim();
          last_from_client = false;
        } else {
          // Strip a leading "Name:" prefix if present, keep the message body.
          last_message = lastLine.replace(/^[^:]{1,40}:\s*/, '').trim() || lastLine.trim();
          last_from_client = true;
        }
      }

      // Unread heuristic: look for visual cues on the container
      //   - explicit "unread" aria-label or class
      //   - bold font weight on the row text (computed)
      //   - a badge/dot visible
      let has_unread = false;
      const aria = (container.getAttribute('aria-label') || '').toLowerCase();
      if (/unread/.test(aria)) has_unread = true;
      if (!has_unread) {
        const classList = (container.className || '').toString().toLowerCase();
        if (/unread/.test(classList)) has_unread = true;
      }
      if (!has_unread) {
        // Bold font-weight on the first text element is a strong signal
        const fw = window.getComputedStyle(container).fontWeight;
        if (parseInt(fw, 10) >= 600) has_unread = true;
      }

      rows.push({
        room_id,
        room_url: 'https://www.upwork.com' + (href.startsWith('/') ? href : '/' + href),
        client_name,
        job_title,
        has_unread,
        last_message,
        last_from_client,
        // when the conversation last moved — the backend dates a late-found reply
        // by this instead of by the sync (a July reply found today sorted as new)
        last_activity_at: _listWhen(lines),
      });
    }
    return rows;
  }

  // ── Sync v2: ?falconsync=1 marker → scrape → DIRECT POST → on-page banner ──
  // Same reliable pattern as proposal.js (no cross-tab relay, which was the
  // unreliable part). The marker is in the URL so it survives MV3 worker death.
  const FALCON_API_BASE = 'http://127.0.0.1:8000';

  function falconSyncMarkerPresent() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('falconsync') === '1') {
        try { sessionStorage.setItem('falcon_msg_sync', '1'); } catch (_) {}
        return true;
      }
    } catch (_) {}
    try { return sessionStorage.getItem('falcon_msg_sync') === '1'; } catch (_) { return false; }
  }

  async function falconSyncRequested() {
    if (falconSyncMarkerPresent()) return true;
    // Fallback: durable tab-id set (covers Upwork stripping the query on redirect).
    try {
      const resp = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'ASK_AUTO_SYNC' }, (r) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(r);
        });
      });
      return !!(resp && resp.shouldSync);
    } catch (_) { return false; }
  }

  function clearMarker() {
    try { sessionStorage.removeItem('falcon_msg_sync'); } catch (_) {}
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('falconsync')) {
        url.searchParams.delete('falconsync');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (_) {}
  }

  function showBanner({ phase, scraped, result, error, rows, note }) {
    let el = document.getElementById('falcon-msgsync-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'falcon-msgsync-banner';
      el.style.cssText = [
        'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
        'width:340px', 'max-width:90vw', 'padding:16px 18px',
        'background:#0b1f17', 'color:#d8ffe9', 'border:2px solid #1fd672',
        'border-radius:12px', 'box-shadow:0 12px 40px rgba(0,0,0,.55)',
        'font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif',
      ].join(';');
      document.body.appendChild(el);
    }
    const ok = phase === 'done' && !error;
    const headColor = error ? '#ff8a8a' : ok ? '#1fd672' : '#ffd479';
    const title = error ? 'Falcon Reply Sync — error'
      : phase === 'scraping' ? 'Falcon Reply Sync — scraping inbox…'
      : phase === 'walking' ? 'Falcon Reply Sync — reading conversations…'
      : phase === 'posting' ? 'Falcon Reply Sync — saving…'
      : 'Falcon Reply Sync — done';
    const lines = [];
    if (note) lines.push(note);
    if (typeof scraped === 'number') lines.push(`Conversations scanned: <b>${scraped}</b>`);
    if (result) {
      lines.push(`Promoted to “replied”: <b>${result.newly_replied ?? result.updated ?? 0}</b>`);
      if (result.not_matched_count) lines.push(`Unmatched: ${result.not_matched_count}`);
    }
    if (error) lines.push(`<span style="color:#ff8a8a">${String(error).slice(0,300)}</span>`);
    let rowsHtml = '';
    if (rows && rows.length) {
      const items = rows.slice(0, 30).map(r =>
        `<li style="margin:1px 0">${(r.has_unread ? '● ' : '')}${String(r.job_title || r.client_name || '?').replace(/</g,'&lt;').slice(0,70)}</li>`
      ).join('');
      rowsHtml = `<details style="margin-top:8px"><summary style="cursor:pointer;color:#9fe9c2">conversations (${rows.length})</summary><ul style="margin:6px 0 0;padding-left:18px;max-height:200px;overflow:auto">${items}</ul></details>`;
    }
    el.innerHTML =
      `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
         <strong style="color:${headColor};font-size:14px">${title}</strong>
         <button id="falcon-msgsync-close" style="background:none;border:none;color:#7fae97;font-size:18px;cursor:pointer;line-height:1">×</button>
       </div>
       <div>${lines.map(l => `<div style="margin:2px 0">${l}</div>`).join('')}</div>
       ${rowsHtml}
       ${ok ? '<div style="margin-top:10px;color:#7fae97;font-size:12px">Reply statuses updated.</div>' : ''}`;
    const closeBtn = document.getElementById('falcon-msgsync-close');
    if (closeBtn) closeBtn.onclick = () => el.remove();
  }

  async function postDirect(rows, walkInfo) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    // walk_info makes the backend debug dump self-diagnosing: it records the
    // RUNNING extension version (catches stale-extension confusion for good)
    // and what the room walk actually did.
    let version = null;
    try { version = chrome.runtime.getManifest().version; } catch (_) {}
    const walk_info = { extension_version: version, ...(walkInfo || {}) };
    let resp;
    try {
      resp = await fetch(`${FALCON_API_BASE}/messages-status-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, walk_info }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('backend did not respond within 15s (is it running on :8000?)');
      throw new Error('could not reach backend on http://127.0.0.1:8000 — ' + (e && e.message || e));
    } finally { clearTimeout(timer); }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error('API ' + resp.status + ': ' + t.slice(0, 200));
    }
    return resp.json();
  }

  // Tell the background worker we're done so it CLOSES this (background) tab
  // and notifies the dashboard (lights the Outcomes activity dots). Every exit.
  const _done = (result) => {
    try { chrome.runtime.sendMessage({ type: 'MESSAGES_LIST_SCRAPE_DONE', result: result || {} }, () => void chrome.runtime.lastError); } catch (_) {}
  };

  // ── Room walk ──────────────────────────────────────────────────────────────
  // The inbox LIST shows a name and sometimes the job title — but often a date
  // in its place ("9/16/26"), and client names never appear in job postings or
  // in Artem's letters. So the list alone cannot say which proposal a
  // conversation belongs to. The ROOM page can: its header carries the job
  // title, and its markup may carry the proposal or job id. So we visit rooms in
  // this same tab and record what each one CONTAINS.
  //
  // Division of labour (v5, 2026-09-24): the extension OBSERVES, the backend
  // RESOLVES. Observations (ids + header-title candidates) are cached per room
  // id in chrome.storage.local — a room never changes which job it belongs to,
  // so each room is walked once instead of every sync, and a proposal captured
  // later still gets matched from the cached observation.
  //
  // What v4 got wrong, per the 2026-09-24 debug dump:
  //   * It looked ONLY for /jobs/~ links. Byron Rennie's room — a known proposal
  //     room (proposal 248) — was visited and had none. The single signal it
  //     searched for is the signal proposal rooms lack.
  //   * It walked only rooms where the CLIENT spoke last or which were unread.
  //     The moment Artem answers — which he does fast on a hot lead — the room
  //     leaves the walk. Mykola (UNIHOST), with a call booked, was 'skipped' for
  //     exactly that reason, and was caught only because Upwork happened to
  //     show his job title in the list row.
  //
  // Each navigation reloads this content script, so walk state lives in
  // sessionStorage and the walk resumes on every load until the queue drains.
  const QUEUE_KEY = 'falcon_room_walk';
  const loadQueue  = () => { try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || 'null'); } catch (_) { return null; } };
  const saveQueue  = (q) => { try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (_) {} };
  const clearQueue = () => { try { sessionStorage.removeItem(QUEUE_KEY); } catch (_) {} };

  // Bump PROBE_VERSION whenever probeRoom's extraction changes, so observations
  // cached by an older probe are re-collected instead of trusted forever.
  const ROOM_OBS_KEY  = 'falcon_room_obs_v1';
  const PROBE_VERSION = 2;
  const EMPTY_TTL_MS  = 3 * 24 * 3600 * 1000;   // re-check "saw nothing" rooms after 3 days
  const WALK_CAP      = 8;                        // rooms per sync — each one is a page load

  function loadRoomObs() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(ROOM_OBS_KEY, (v) => {
          void chrome.runtime.lastError;
          resolve((v && v[ROOM_OBS_KEY]) || {});
        });
      } catch (_) { resolve({}); }
    });
  }
  function saveRoomObs(obs) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({ [ROOM_OBS_KEY]: obs }, () => { void chrome.runtime.lastError; resolve(); });
      } catch (_) { resolve(); }
    });
  }
  function obsUsable(o) {
    if (!o || o.v !== PROBE_VERSION) return false;
    if (o.empty) return (Date.now() - (o.at || 0)) < EMPTY_TTL_MS;
    return true;
  }

  // ── Re-reading conversations that moved (2026-09-30) ──────────────────────
  // The walk above opens a room once, to link it to its proposal; after that the
  // sync only ever saw the inbox preview line. So Sofia Toro's decline ("We've
  // selected another candidate", 29 Sep) was never read: Artem replied a minute
  // later, the preview became his, and the room stayed cached. Now a room whose
  // preview or time changed since the last sync is opened again — never an unread
  // one, opening marks it read — and its latest messages go to the backend, which
  // reads the client's for a decline / interview / hire. Free: no AI call, only
  // page loads, capped per sync. With no baseline yet (the first sync on 5.3),
  // rooms active in the last 7 days are read once.
  const PREVIEW_KEY = 'falcon_room_preview_v1';
  const REREAD_CAP = 4;
  const REREAD_BACKFILL_MS = 7 * 24 * 3600 * 1000;
  function loadPreviews() {
    return new Promise(resolve => {
      try { chrome.storage.local.get(PREVIEW_KEY, (v) => { void chrome.runtime.lastError; resolve((v && v[PREVIEW_KEY]) || {}); }); }
      catch (_) { resolve({}); }
    });
  }
  function savePreviews(p) {
    return new Promise(resolve => {
      try { chrome.storage.local.set({ [PREVIEW_KEY]: p }, () => { void chrome.runtime.lastError; resolve(); }); }
      catch (_) { resolve(); }
    });
  }
  function _previewSig(r) { return `${r.last_message || ''}|${r.last_activity_at || ''}`; }
  // Rooms to open again: already linked (the first-visit walk handles the rest),
  // not unread, and moved since the last sync — or, with no baseline, recent.
  function _rereadCandidates(rows, previews, isObserved, now = Date.now()) {
    return rows.filter(r => {
      if (r.has_unread || !isObserved(r.room_id)) return false;
      const prev = previews[r.room_id];
      if (prev) return prev.sig !== _previewSig(r);
      const t = Date.parse(r.last_activity_at || '');
      return Number.isFinite(t) && now - t < REREAD_BACKFILL_MS;
    });
  }
  // New baselines: every row except one still waiting to be read — unread (read
  // it first), or moved but not read this time (over the cap, or didn't render).
  function _nextPreviews(previews, rows, pendingIds, now = Date.now()) {
    const out = { ...previews };
    for (const r of rows) {
      if (r.has_unread || pendingIds.has(r.room_id)) continue;
      out[r.room_id] = { sig: _previewSig(r), at: now };
    }
    return out;
  }

  // The open room's messages, oldest first: [{ from: 'client' | 'artem', name,
  // text }]. Upwork puts each message group under a "<Name>  <time>" header
  // ("Sofia Toro  7:56 PM") — one line or two in innerText. Everything up to the
  // next header belongs to it. Artem is his own name or "You"; anyone else is the
  // client. Date dividers, file cards, "View proposal" and avatar initials drop.
  const _MSG_TIME_RE = /(\d{1,2}:\d{2}\s*(?:AM|PM))\s*$/i;
  const _MSG_UI_LINE_RE = /^(?:view (?:proposal|contract|offer|details|job post)|\d+ files?|\d+(?:\.\d+)?\s*(?:KB|MB|GB)|\S+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|zip|csv)|today|yesterday|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+[a-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|send a message.*|\d{1,2}:\d{2}\s*(?:am|pm)\s+local time|edited|seen|delivered)$/i;
  const _SELF_NAME_RE = /^(?:artem(?:\s+yatsuk)?|you)$/i;
  function _roomMessages(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const groups = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const m = ln.match(_MSG_TIME_RE);
      let name = null;
      if (m) {
        const before = ln.slice(0, m.index).replace(/[\s·•|–—-]+$/, '').trim();
        if (before && before.length <= 60 && !/[.!?,:;]$/.test(before)) name = before;
        else if (!before && i > 0 && lines[i - 1].length <= 60 && !_MSG_UI_LINE_RE.test(lines[i - 1])) {
          name = lines[i - 1];
          if (cur && cur.lines[cur.lines.length - 1] === name) cur.lines.pop();
        }
      }
      if (name) { cur = { from: _SELF_NAME_RE.test(name) ? 'artem' : 'client', name, lines: [] }; groups.push(cur); continue; }
      if (!cur || _MSG_UI_LINE_RE.test(ln) || /^[A-Z]{2,3}$/.test(ln)) continue;
      cur.lines.push(ln);
    }
    return groups.map(g => ({ from: g.from, name: g.name, text: g.lines.join('\n') })).filter(g => g.text);
  }

  // Identity fragments (person / company names) from a list row, for telling
  // THIS room apart from the rest. When client_name is just the avatar initials
  // ("BL", "DM") the scraper has put the real name into job_title, so use that.
  // Otherwise job_title may hold the ACTUAL job title — and treating a job title
  // as a name is how the first cut of this filtered the room's own title out as
  // "the client's name line" (caught by tests/room-probe.test.js, 2026-09-24).
  // Dates, short fragments and "David M"-style abbreviated stubs are dropped.
  function _nameFrags(row) {
    const cn = String(row.client_name || '').trim();
    const identity = /^[A-Z]{1,3}$/.test(cn) ? String(row.job_title || '') : cn;
    return identity.split(',').map(s => s.trim())
      .filter(s => s.length >= 6
        && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)
        && !/^\S+ \S\.?$/.test(s));
  }

  // The room page ALSO renders the conversation list in a sidebar, and that
  // list carries every OTHER conversation's name and title. Anything collected
  // from the whole document can therefore belong to a different room. So scope
  // to the main panel: start at the compose editor (only the open room has one)
  // and keep the largest ancestor that still mentions at most ONE other
  // conversation. The sidebar mentions all of them. Counted per CONVERSATION,
  // not per name fragment, so "Sofia Toro" and "Speedrack West" are one sighting.
  function _roomMainPanel(otherRowsFrags) {
    const compose = document.querySelector('[contenteditable="true"]');
    if (!compose) return null;
    let best = null;
    for (let el = compose; el && el !== document.body; el = el.parentElement) {
      const txt = el.innerText || '';
      if (otherRowsFrags.filter(frags => frags.some(n => txt.includes(n))).length > 1) break;
      best = el;
    }
    return best;
  }

  // Ids inside the panel. The proposal id is the best key available — exact,
  // and stored on every proposal since submission capture landed. The room's
  // "View proposal" link is known to point at a workroom MODAL rather than at
  // /nx/proposals/<id> (see messages.js findViewDetailsUrl), so the modal's
  // query string is searched too. `;` is accepted before a query key because
  // outerHTML encodes `&` as `&amp;`.
  const _JOB_RE  = /\/(?:nx\/|ab\/)?(?:jobs?|proposals\/job)\/~([0-9a-zA-Z]{16,})/i;
  const _PROP_RE = /\/(?:nx|ab)\/proposals\/(\d{10,})/i;
  const _QS_RE   = /[?&;](?:proposal|proposalId|proposal_id|proposalUid)=(\d{10,})/i;
  function _collectIds(root) {
    const job = new Set(), prop = new Set();
    const kinds = { anchors: 0, jobs: 0, proposals: 0, workroom: 0, contracts: 0, offers: 0 };
    for (const a of root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      kinds.anchors++;
      if (/\/jobs?\/~|\/proposals\/job\/~/i.test(href)) kinds.jobs++;
      if (/proposal/i.test(href)) kinds.proposals++;
      if (/\/workroom\//i.test(href)) kinds.workroom++;
      if (/\/contracts?\//i.test(href)) kinds.contracts++;
      if (/\/offers?\//i.test(href)) kinds.offers++;
      let m = href.match(_JOB_RE);  if (m) job.add(m[1]);
      m = href.match(_PROP_RE);     if (m) prop.add(m[1]);
      m = href.match(_QS_RE);       if (m) prop.add(m[1]);
    }
    const html = root.outerHTML || '';
    for (const m of html.matchAll(new RegExp(_JOB_RE.source, 'gi')))  job.add(m[1]);
    for (const m of html.matchAll(new RegExp(_PROP_RE.source, 'gi'))) prop.add(m[1]);
    for (const m of html.matchAll(new RegExp(_QS_RE.source, 'gi')))   prop.add(m[1]);
    return { job_ids: [...job].slice(0, 5), proposal_ids: [...prop].slice(0, 5), kinds };
  }

  // Lines that are never a job title.
  const _NOT_TITLE = /^(\d{1,2}:\d{2}\s*(am|pm)?(\s+local time)?|.*\blocal time|view (proposal|contract|offer|details|job post)|proposal submitted|search messages|meeting recaps|client profile|people|files and links|personal notepad|messages|unread|favorites|today|yesterday|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;

  // Header-title candidates from the top of the panel. The BACKEND decides
  // which, if any, is really a job title, by exact comparison against the
  // titles it knows — so this deliberately offers a few candidate lines rather
  // than guessing which single line is the title. A header rendered as
  // "3:51 PM local time · PPC Specialist …" has its time prefix stripped, and
  // every line is also split on its separators, so the title can stand alone.
  // The unsplit line is still offered, for titles that contain a "|" or "·".
  const _TIME_PREFIX = /^\d{1,2}:\d{2}\s*(?:am|pm)?\s*(?:local time)?\s*[·•|]?\s*/i;
  function _titleCandidates(panel, selfNames) {
    const out = [];
    const lines = (panel.innerText || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 25);
    for (const raw of lines) {
      const line = raw.replace(_TIME_PREFIX, '');
      for (const seg of [line, ...line.split(/\s*[·•|]\s*|\s{2,}/)]) {
        const s = seg.trim();
        if (s.length < 12 || s.length > 150 || _NOT_TITLE.test(s)) continue;
        if (selfNames.some(n => s.startsWith(n))) continue;   // the client's own name line
        if (!out.includes(s)) out.push(s);
        if (out.length >= 12) return out;
      }
    }
    return out;
  }

  // Visit-time probe. Waits for the room to render (compose editor present),
  // collects ids + title candidates, stops early once an id turns up or 3s after
  // render when there is nothing left to wait for; hard cap 15s. Also returns a
  // diagnostic record that lands in the backend's messages_sync_debug.json, so
  // a miss says WHY — never rendered? sidebar not excluded? no ids in the
  // markup? — instead of a bare "0 links found".
  async function probeRoom(q, cur) {
    const t0 = Date.now();
    const rows = q.rows || [];
    const self = rows.find(r => r.room_id === cur.room_id) || {};
    const selfNames = _nameFrags(self);
    // One entry per OTHER conversation (deduped — the same client can own two
    // rooms, e.g. Balagan), minus anything shared with this room's identity.
    const seen = new Set();
    const otherRowsFrags = rows
      .filter(r => r.room_id !== cur.room_id)
      .map(r => _nameFrags(r).filter(n => !selfNames.includes(n)))
      .filter(f => f.length && !seen.has(f.join('|')) && seen.add(f.join('|')));

    let renderedAt = null, panel = null, titles = [];
    let got = { job_ids: [], proposal_ids: [], kinds: {} };
    while (Date.now() - t0 < 15000) {
      panel = _roomMainPanel(otherRowsFrags);
      if (panel) {
        if (renderedAt === null) renderedAt = Date.now();
        got = _collectIds(panel);
        titles = _titleCandidates(panel, selfNames);
        if (got.job_ids.length || got.proposal_ids.length) break;
        if (Date.now() - renderedAt > 3000) break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // READ-ONLY rooms: the page loads but offers no compose editor, so the panel
    // anchor never appears. Seen 2026-09-24 on a Feb-2026 conversation that
    // failed three syncs running — the third with the window visible and a
    // proposal reference present in the page, so it had loaded; it simply had
    // nothing to type into. Without this, such a room costs 15s on EVERY sync
    // forever and never resolves. Concluded only after the full 15s (one room
    // took 9.7s to render, so a shorter cut-off would misfile slow rooms), only
    // while the window is visible (a hidden window proves nothing), and only
    // once the conversation list itself has loaded. Nothing is extracted from
    // such a room — without the panel anchor there is no safe way to keep the
    // sidebar out — it is just cached as empty, retried on the 3-day TTL.
    const readonly = renderedAt === null
      && document.visibilityState === 'visible'
      && document.querySelectorAll('a[href*="/messages/rooms/"]').length >= 3;

    // Messages: the probe stops as soon as an id turns up, which can be before the
    // thread has finished rendering. For a re-read room — the messages are the
    // point — wait until the panel text stops growing (max 5s).
    let messages = [];
    if (panel) {
      if (cur.reread) {
        let last = -1;
        for (let t = Date.now(); Date.now() - t < 5000;) {
          const len = (panel.innerText || '').length;
          if (len === last) break;
          last = len;
          await new Promise(r => setTimeout(r, 800));
        }
      }
      messages = _roomMessages(panel.innerText).slice(-8);
    }
    // One text sample per sync, from the first re-read room, so a parse miss can
    // be seen and fixed (local debug file only).
    let textSample = null;
    if (panel && cur.reread && !q.sampled) {
      const ls = (panel.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      textSample = { head: ls.slice(0, 12).map(s => s.slice(0, 90)), tail: ls.slice(-24).map(s => s.slice(0, 90)) };
      q.sampled = true;
    }

    const doc = document.documentElement.outerHTML || '';
    const count = (re) => (doc.match(re) || []).length;
    return {
      rendered: renderedAt !== null,
      observed: renderedAt !== null || readonly,   // what caching keys on
      job_ids: got.job_ids, proposal_ids: got.proposal_ids, titles,
      messages,
      diag: {
        reread: !!cur.reread,
        n_msgs: messages.length,
        n_client_msgs: messages.filter(m => m.from === 'client').length,
        last_client: (messages.filter(m => m.from === 'client').pop() || {}).text?.slice(0, 80) || null,
        ...(textSample ? { text_sample: textSample } : {}),
        room: String(cur.room_id).slice(-10),
        vis: document.visibilityState,
        rendered: renderedAt !== null,
        readonly,
        has_textarea: !!document.querySelector('textarea'),
        ms: Date.now() - t0,
        panel_chars: panel ? (panel.innerText || '').length : 0,
        kinds: got.kinds,
        n_job: got.job_ids.length, n_prop: got.proposal_ids.length, n_title: titles.length,
        // Whole-document counts: diagnostic only, never used for matching.
        doc_prop_refs: count(/\/(?:nx|ab)\/proposals\/\d{10,}/gi),
        doc_job_refs: count(/\/jobs?\/~[0-9a-zA-Z]{16,}/gi),
        doc_propid_json: count(/["']proposal[_-]?id["']\s*:\s*["']?\d{10,}/gi),
        title_sample: titles.slice(0, 3).map(t => t.slice(0, 60)),
      },
    };
  }

  // Attach observations to a list row — fresh from this walk, else cached.
  function attachObs(r, fresh, cached) {
    const o = (fresh && fresh.observed) ? fresh : (obsUsable(cached) ? cached : null);
    if (!o) return { ...r, walk: fresh ? 'visited-unrendered' : 'skipped' };
    return {
      ...r,
      upwork_job_id: r.upwork_job_id || (o.job_ids || [])[0] || null,   // legacy exact path
      room_job_ids: o.job_ids || [],
      room_proposal_ids: o.proposal_ids || [],
      room_titles: o.titles || [],
      walk: fresh ? 'visited' : 'cached',
      // the latest messages, when this sync opened the room (first visit or re-read)
      ...(fresh && fresh.messages && fresh.messages.length ? { recent_messages: fresh.messages } : {}),
    };
  }

  async function postAndFinish(rows, walkInfo) {
    const note = walkInfo && walkInfo.rooms_visited
      ? `Read ${walkInfo.rooms_visited} conversation(s); ${walkInfo.rooms_cached || 0} already known.`
      : undefined;
    showBanner({ phase: 'posting', scraped: rows.length, rows, note });
    try {
      const result = await postDirect(rows, walkInfo);
      console.log('[Cockpit Messages-List] direct POST result:', result);
      showBanner({ phase: 'done', scraped: rows.length, result, rows });
      _done(result);
    } catch (e) {
      console.error('[Cockpit Messages-List] direct POST failed:', e);
      showBanner({ phase: 'done', scraped: rows.length, rows, error: 'save failed: ' + (e && e.message || e) });
      _done({ scanned: rows.length, error: 'save failed: ' + (e && e.message || e) });
    }
  }

  async function finishWalk(q) {
    const byRoom = q.results || {};
    const obs = await loadRoomObs();
    for (const [room_id, res] of Object.entries(byRoom)) {
      // Cache only what an OBSERVED room showed: one that rendered, or one that
      // loaded read-only (cached as empty, so retried on the 3-day TTL rather
      // than every sync). One that never loaded told us nothing, so it stays
      // uncached and is retried on the next sync.
      if (res && res.observed) {
        obs[room_id] = {
          v: PROBE_VERSION, at: Date.now(),
          job_ids: res.job_ids, proposal_ids: res.proposal_ids, titles: res.titles,
          empty: !(res.job_ids.length || res.proposal_ids.length || res.titles.length),
        };
      }
    }
    await saveRoomObs(obs);
    clearQueue();
    const rows = (q.rows || []).map(r => attachObs(r, byRoom[r.room_id], obs[r.room_id]));
    // Preview baselines: a moved room that wasn't read (over the cap, or it never
    // rendered) keeps its old one, so the next sync picks it up.
    const readOk = new Set(Object.entries(byRoom).filter(([, res]) => res && res.observed).map(([id]) => id));
    const pending = new Set((q.reread_all || []).filter(id => !readOk.has(id)));
    await savePreviews(_nextPreviews(await loadPreviews(), q.rows || [], pending));
    const walked = Object.values(byRoom);
    const walkInfo = {
      probe_version: PROBE_VERSION,
      rooms_visited: walked.length,
      rooms_cached: rows.filter(r => r.walk === 'cached').length,
      links_found: walked.filter(x => x && (x.job_ids.length || x.proposal_ids.length)).length,
      rooms_with_titles: walked.filter(x => x && x.titles.length).length,
      rooms_reread: (q.reread_ids || []).filter(id => readOk.has(id)).length,
      reread_pending: pending.size,
      stopped_hidden: !!q.stopped_hidden,
      deferred_unread: q.deferred_unread || 0,
      attempts: q.attempts || 0,
      rooms: walked.map(x => x && x.diag).filter(Boolean),
      list_diag: q.list_diag || null,
    };
    console.log('[Cockpit Messages-List] room walk done:', walkInfo);
    await postAndFinish(rows, walkInfo);
  }

  async function stepWalk(q) {
    // Crash/redirect guard: every load mid-walk counts as an attempt; if we've
    // reloaded far more times than rooms, stop walking and post what we have.
    q.attempts = (q.attempts || 0) + 1;
    saveQueue(q);
    if (q.attempts > q.queue.length * 2 + 5) { await finishWalk(q); return; }

    const cur = q.queue[q.index];
    showBanner({ phase: 'walking', note: `Reading conversation ${q.index + 1} of ${q.queue.length}…` });
    q.results[cur.room_id] = await probeRoom(q, cur);
    q.index++;
    // A room that never rendered in a HIDDEN window: the rest won't either (Upwork
    // doesn't render a conversation in a hidden page — 5.3's four re-reads each
    // timed out at 15s with vis "hidden"). Stop instead of spending 15s on each.
    if (!q.results[cur.room_id].rendered && document.visibilityState === 'hidden') {
      q.stopped_hidden = true;
      await finishWalk(q);
      return;
    }
    if (q.index < q.queue.length) {
      saveQueue(q);
      window.location.href = q.queue[q.index].room_url;   // next room (reloads script; queue resumes)
      return;
    }
    await finishWalk(q);
  }

  // ── Passive read: the conversation Artem has open (2026-09-30) ────────────
  // The sync's own window is hidden — moved off-screen, or covered by Falcon
  // Scout, which Chrome on Windows reports the same way — and Upwork renders no
  // conversation in a hidden page, so the walk cannot read rooms (5.3: four
  // re-reads, 15s each, vis "hidden", nothing read). But Artem opens a
  // conversation to read what a client wrote — Sofia Toro's decline included —
  // and THAT page is visible. So read it then and send it to the backend exactly
  // as the walk would. Read-only: nothing on Upwork is clicked, typed or changed.
  // Re-read at most every 2 minutes while it stays open (a reply can arrive
  // live); a room that won't render is tried twice, then left alone.
  //
  // 5.5: a miss is reported too (no rows, just the probe's diagnostics and text
  // sample — nothing is matched or changed), because 5.4 failed silently and left
  // no trace. The room is probed only once the conversation list has rendered:
  // the list is what keeps OTHER conversations' names and ids out of this room's
  // reading, and without it the whole page — sidebar included — would count.
  const _PASSIVE_REREAD_MS = 2 * 60 * 1000;
  const _PASSIVE_LIST_WAIT = 10;   // ticks (3s each) to wait for the list
  const _passive = new Map();   // room_id -> { at, tries, busy, waits }
  let _passiveTimer = null;
  const _passiveMiss = (note, diag) => postDirect([], {
    passive: true, probe_version: PROBE_VERSION, note, page: location.pathname,
    ...(diag ? { rooms: [diag] } : {}),
  }).catch(() => {});
  async function passiveReadCurrentRoom() {
    // Orphaned copy (the extension was reloaded under this page): stop; the
    // background injects a fresh copy into open messages tabs on reload.
    if (!(chrome.runtime && chrome.runtime.id)) { clearInterval(_passiveTimer); return; }
    const m = location.pathname.match(/\/messages\/rooms\/(?:room[_~])?([A-Za-z0-9_~-]+)/i);
    if (!m || document.visibilityState !== 'visible') return;
    const room_id = m[1];
    const st = _passive.get(room_id) || { at: 0, tries: 0, busy: false, waits: 0 };
    if (st.busy || st.tries >= 2 || Date.now() - st.at < _PASSIVE_REREAD_MS) return;
    st.busy = true; _passive.set(room_id, st);
    try {
      const rows = scrapeConversationList();
      if (rows.filter(r => r.room_id !== room_id).length < 3) {
        if (++st.waits === _PASSIVE_LIST_WAIT) {
          st.tries = 2;
          await _passiveMiss(`conversation list did not render (${rows.length} row(s) after ${_PASSIVE_LIST_WAIT * 3}s)`);
        }
        return;
      }
      const res = await probeRoom({ rows }, { room_id, reread: true });
      if (!location.pathname.includes(room_id)) return;              // Artem moved on meanwhile
      if (!res.rendered || !res.messages.length) {
        st.tries++;
        await _passiveMiss(res.rendered ? 'rendered, no messages parsed' : 'room did not render', res.diag);
        return;
      }
      const self = rows.find(r => r.room_id === room_id) || { room_id, room_url: location.href.split('?')[0] };
      const row = {
        ...self, walk: 'passive',
        upwork_job_id: self.upwork_job_id || res.job_ids[0] || null,
        room_job_ids: res.job_ids, room_proposal_ids: res.proposal_ids, room_titles: res.titles,
        recent_messages: res.messages,
      };
      const result = await postDirect([row], { passive: true, probe_version: PROBE_VERSION, rooms: [res.diag] });
      st.at = Date.now(); st.tries = 0;
      console.log('[Cockpit Messages-List] passive read of the open conversation saved:', result);
    } catch (e) {
      st.tries++;
      console.warn('[Cockpit Messages-List] passive read not saved:', e && e.message);
      await _passiveMiss('error: ' + String(e && e.message || e).slice(0, 200));   // unless the backend itself is down
    } finally {
      st.busy = false;
    }
  }
  function startPassiveReader() {
    _passiveTimer = setInterval(passiveReadCurrentRoom, 3000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') passiveReadCurrentRoom(); });
    passiveReadCurrentRoom();
  }

  (async () => {
    // Mid-walk? We navigated here as part of the room walk — resume it.
    const pending = loadQueue();
    if (pending && pending.state === 'walking') {
      console.log('[Cockpit Messages-List] resuming room walk at', pending.index + 1, '/', pending.queue.length);
      await stepWalk(pending);
      return;
    }

    const requested = await falconSyncRequested();
    console.log('[Cockpit Messages-List] falconsync requested:', requested, 'path:', window.location.pathname + window.location.search);
    // Not a sync run: Artem browsing his messages — read what he opens.
    if (!requested) { startPassiveReader(); return; }
    clearMarker();
    showBanner({ phase: 'scraping' });

    const ok = await waitForListContent();
    if (!ok) { showBanner({ phase: 'done', error: 'inbox list did not render' }); _done({ scanned: 0, error: 'inbox list did not render' }); return; }
    const rows = await collectConversationRows();
    console.log('[Cockpit Messages-List] Scraped', rows.length, 'conversation rows');
    if (!rows.length) { showBanner({ phase: 'done', scraped: 0, rows, error: 'no conversations scraped' }); _done({ scanned: 0, error: 'no conversations scraped' }); return; }

    // Walk every room we have no usable observation for — REGARDLESS of who
    // spoke last (v4 walked only client-last / unread rooms, which drops a
    // conversation out of the walk the moment Artem answers it). Most recent
    // first; capped per sync, and the rest are picked up by the next one.
    //
    // UNREAD rooms are deferred, not walked. Opening a conversation generally
    // marks it read, so walking one could clear the unread marker on a client's
    // new message before Artem has seen it — and the client may see it as read.
    // The tool must never change what Artem or his client sees in Upwork. v4
    // walked unread rooms on every sync; here they are simply picked up on the
    // first sync after Artem opens them himself. The cost is small: a new reply
    // whose inbox row already shows its job title is matched without any walk.
    const obs = await loadRoomObs();
    const previews = await loadPreviews();
    const unobserved = rows.filter(r => !obsUsable(obs[r.room_id]));
    const deferredUnread = unobserved.filter(r => r.has_unread).length;
    // Moved rooms first (a new client message may be waiting in one), then first
    // visits, within the same per-sync page-load cap.
    const changed = _rereadCandidates(rows, previews, (id) => obsUsable(obs[id]));
    const reread = changed.slice(0, REREAD_CAP);
    const firstVisits = unobserved.filter(r => !r.has_unread).slice(0, Math.max(0, WALK_CAP - reread.length));
    const queue = [
      ...reread.map(c => ({ room_id: c.room_id, room_url: c.room_url, reread: true })),
      ...firstVisits.map(c => ({ room_id: c.room_id, room_url: c.room_url })),
    ];
    // Hidden window (covered, or moved off-screen — Chrome's occlusion tracking
    // marks both hidden): no room will render, so don't walk. The moved rooms keep
    // their old baselines and are read by the first sync that can render them.
    if (queue.length && document.visibilityState === 'hidden') {
      console.log('[Cockpit Messages-List] window hidden — not walking', queue.length, 'room(s); they stay queued');
      await savePreviews(_nextPreviews(previews, rows, new Set(changed.map(r => r.room_id))));
      const enrichedH = rows.map(r => attachObs(r, null, obs[r.room_id]));
      await postAndFinish(enrichedH, {
        probe_version: PROBE_VERSION, rooms_visited: 0, links_found: 0, attempts: 0,
        rooms_cached: enrichedH.filter(r => r.walk === 'cached').length, rooms: [],
        rooms_reread: 0, reread_pending: changed.length, walk_skipped: 'hidden', walk_waiting: queue.length,
        deferred_unread: deferredUnread,
        list_diag: LIST_DIAG,
      });
      return;
    }
    if (queue.length) {
      console.log('[Cockpit Messages-List] walking', queue.length, 'room(s):', reread.length, 'moved since the last sync,',
                  firstVisits.length, 'not yet observed;', deferredUnread, 'unread room(s) deferred until read');
      const q = {
        state: 'walking', index: 0, attempts: 0, queue,
        rows, results: {}, deferred_unread: deferredUnread,
        reread_ids: reread.map(r => r.room_id), reread_all: changed.map(r => r.room_id),
        list_diag: LIST_DIAG,
      };
      saveQueue(q);
      window.location.href = q.queue[0].room_url;
      return;
    }

    // Every room already observed and none moved — send the cached observations.
    await savePreviews(_nextPreviews(previews, rows, new Set()));
    const enriched = rows.map(r => attachObs(r, null, obs[r.room_id]));
    await postAndFinish(enriched, {
      probe_version: PROBE_VERSION, rooms_visited: 0, links_found: 0, attempts: 0,
      rooms_cached: enriched.filter(r => r.walk === 'cached').length, rooms: [],
      rooms_reread: 0, reread_pending: 0,
      deferred_unread: deferredUnread,
      list_diag: LIST_DIAG,
    });
  })();
})();
