// Falcon Scout - Messages-inbox list scraper
//
// Runs on Upwork's messages UI. On Upwork, the "inbox" is actually a
// /messages/rooms/<id> page with a LEFT SIDEBAR listing all conversations
// (Upwork auto-redirects /messages/rooms/ → /messages/rooms/<first-id>).
//
// When the sync flow opens this page in a tracked background tab:
//   1. Wait for the sidebar conversation list to render
//   2. Scroll to hydrate virtualised rows
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
  function findSidebarContainer() {
    const anchors = document.querySelectorAll('a[href*="/messages/rooms/"]');
    if (!anchors.length) return null;
    let node = anchors[0];
    for (let i = 0; i < 10 && node; i++) {
      const style = window.getComputedStyle(node);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  async function waitForListContent(maxMs = 25000) {
    const start = Date.now();
    let scrollAttempts = 0;
    while (Date.now() - start < maxMs) {
      const anchors = document.querySelectorAll('a[href*="/messages/rooms/"]');
      if (anchors.length > 0) {
        // Found at least one — try to scroll the sidebar to hydrate any
        // virtualised rows further down the list.
        const sidebar = findSidebarContainer();
        if (sidebar && scrollAttempts < 4) {
          sidebar.scrollTop = sidebar.scrollHeight * (scrollAttempts + 1) / 4;
          scrollAttempts++;
          await new Promise(r => setTimeout(r, 600));
          continue;
        }
        // If we couldn't find a sidebar, scroll the page instead
        if (!sidebar && scrollAttempts < 3) {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          scrollAttempts++;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        // Final settle
        await new Promise(r => setTimeout(r, 700));
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.warn('[Cockpit Messages-List] No conversation rows found within', maxMs, 'ms');
    return false;
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

  function showBanner({ phase, scraped, result, error, rows }) {
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
      : phase === 'posting' ? 'Falcon Reply Sync — saving…'
      : 'Falcon Reply Sync — done';
    const lines = [];
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

  async function postDirect(rows) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(`${FALCON_API_BASE}/messages-status-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
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

  (async () => {
    const requested = await falconSyncRequested();
    console.log('[Cockpit Messages-List] falconsync requested:', requested, 'path:', window.location.pathname + window.location.search);
    if (!requested) return;
    clearMarker();
    showBanner({ phase: 'scraping' });

    const ok = await waitForListContent();
    if (!ok) { showBanner({ phase: 'done', error: 'inbox list did not render' }); return; }
    const rows = scrapeConversationList();
    console.log('[Cockpit Messages-List] Scraped', rows.length, 'conversation rows');
    showBanner({ phase: 'posting', scraped: rows.length, rows });
    if (!rows.length) { showBanner({ phase: 'done', scraped: 0, rows, error: 'no conversations scraped' }); return; }

    try {
      const result = await postDirect(rows);
      console.log('[Cockpit Messages-List] direct POST result:', result);
      showBanner({ phase: 'done', scraped: rows.length, result, rows });
    } catch (e) {
      console.error('[Cockpit Messages-List] direct POST failed:', e);
      showBanner({ phase: 'done', scraped: rows.length, rows, error: 'save failed: ' + (e && e.message || e) });
    }
  })();
})();
