// Falcon Scout - Bridge Content Script
// Runs on the Falcon Scout dashboard (localhost:5180; legacy 5173/5174 also matched).
// Bridges between the React page and the extension background worker.

(function () {
  // Ping/pong handshake — content scripts and the page live in isolated JS
  // worlds, so we can't share window globals. CustomEvents on the DOM DO
  // cross the boundary, so we use them as the handshake mechanism.
  //
  // Sequence:
  //   1. bridge.js dispatches 'cockpit:bridge:ready' on load (in case React already mounted)
  //   2. bridge.js also listens for 'cockpit:bridge:ping' (in case React mounts later)
  //      and responds with 'cockpit:bridge:ready'
  window.addEventListener('cockpit:bridge:ping', () => {
    window.dispatchEvent(new CustomEvent('cockpit:bridge:ready'));
  });
  window.dispatchEvent(new CustomEvent('cockpit:bridge:ready'));
  console.log('[Cockpit Bridge] Ready on', window.location.origin);
  // Page → Extension: open a silent background tab to enrich a job
  window.addEventListener('cockpit:enrich', (e) => {
    const { url } = e.detail || {};
    if (!url) return;
    chrome.runtime.sendMessage({ type: 'OPEN_BACKGROUND_TAB', url }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Cockpit Bridge] Error opening tab:', chrome.runtime.lastError.message);
        window.dispatchEvent(new CustomEvent('cockpit:enrich:error', {
          detail: { error: chrome.runtime.lastError.message }
        }));
      }
    });
  });

  // Page → Extension: open a foreground (active) tab — used by the Open
  // on Upwork / Apply on Upwork buttons. Routes through the extension so the
  // navigation is treated as first-party by Chrome (vs. cross-site from
  // localhost), which usually keeps the user's existing Upwork session cookie
  // attached and skips the re-auth login wall.
  window.addEventListener('cockpit:open-tab', (e) => {
    const { url } = e.detail || {};
    if (!url) return;
    chrome.runtime.sendMessage({ type: 'OPEN_FOREGROUND_TAB', url }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Cockpit Bridge] Error opening foreground tab:', chrome.runtime.lastError.message);
        // Fallback: regular window.open from the page itself
        window.open(url, '_blank');
      }
    });
  });

  // Page → Extension: scrape a client website for cover-letter personalisation.
  window.addEventListener('cockpit:inspect-website', (e) => {
    const { job_id, url } = e.detail || {};
    if (!job_id || !url) return;
    chrome.runtime.sendMessage({ type: 'INSPECT_WEBSITE', job_id, url }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Cockpit Bridge] INSPECT_WEBSITE error:', chrome.runtime.lastError.message);
        window.dispatchEvent(new CustomEvent('cockpit:website-inspect:error', {
          detail: { error: chrome.runtime.lastError.message }
        }));
      }
    });
  });

  // Page → Extension: open Ahrefs Site Explorer for a client domain and scrape
  // SEO health data (DR, organic traffic, backlinks) for cover letter context.
  window.addEventListener('cockpit:enrich-ahrefs', (e) => {
    const { job_id, domain } = e.detail || {};
    if (!job_id || !domain) return;
    chrome.runtime.sendMessage({ type: 'ENRICH_AHREFS', job_id, domain }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Cockpit Bridge] ENRICH_AHREFS error:', chrome.runtime.lastError.message);
        window.dispatchEvent(new CustomEvent('cockpit:ahrefs:error', {
          detail: { error: chrome.runtime.lastError.message }
        }));
      }
    });
  });

  // Page → Extension: trigger the proposals-list status sync.
  //
  // Content scripts in MV3 sometimes get `chrome.storage` as undefined even
  // when the manifest declares the storage permission (Chrome quirk depending
  // on load timing / extension reload state). To sidestep this, we forward
  // the entire sync request to the background service worker, which always
  // has full chrome.* access. Background sets the flag AND opens the tab.
  window.addEventListener('cockpit:sync-statuses', () => {
    console.log('[Cockpit Bridge] sync-statuses event received — forwarding to background');
    // Detect "Extension context invalidated" up front. After an extension
    // reload, content scripts in already-open pages are orphaned — chrome.runtime
    // becomes undefined or its calls throw synchronously. Tell the user clearly
    // instead of silently swallowing.
    if (!chrome.runtime || !chrome.runtime.id) {
      const msg = 'Extension was reloaded — hard-refresh this page (Ctrl+Shift+R) to reconnect the bridge.';
      console.warn('[Cockpit Bridge] ' + msg);
      window.dispatchEvent(new CustomEvent('cockpit:status:synced', { detail: { error: msg } }));
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'SYNC_PROPOSAL_STATUSES' }, (response) => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message || 'unknown';
          const friendly = err.includes('Extension context invalidated')
            ? 'Extension was reloaded — hard-refresh this page (Ctrl+Shift+R).'
            : err;
          console.warn('[Cockpit Bridge] sync-statuses failed:', err);
          window.dispatchEvent(new CustomEvent('cockpit:status:synced', { detail: { error: friendly } }));
          return;
        }
        console.log('[Cockpit Bridge] background ack:', response);
        if (!response || response.ok !== true) {
          window.dispatchEvent(new CustomEvent('cockpit:status:synced', {
            detail: { error: (response && response.error) || 'Background returned no ack — tab open may have failed' },
          }));
        }
      });
    } catch (err) {
      console.warn('[Cockpit Bridge] sendMessage threw:', err);
      window.dispatchEvent(new CustomEvent('cockpit:status:synced', {
        detail: { error: 'Bridge call threw: ' + (err && err.message ? err.message : err) },
      }));
    }
  });

  // Extension → Page: enrichment finished — trigger immediate data refresh
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ENRICH_COMPLETE') {
      window.dispatchEvent(new CustomEvent('cockpit:enrich:complete', {
        detail: {
          jobId:      message.jobId,
          title:      message.title,
          proposals:  message.proposals,
          hire_rate:  message.hire_rate,
          avg_rate:   message.avg_rate,
          enrichedAt: message.enrichedAt,
        }
      }));
    }
    if (message.type === 'ENRICH_FAILED') {
      window.dispatchEvent(new CustomEvent('cockpit:enrich:error', {
        detail: { error: message.error }
      }));
    }
    // Extension → Page: a conversation / proposal was saved → refresh Outcomes tab immediately
    if (message.type === 'CONVERSATION_SAVED') {
      window.dispatchEvent(new CustomEvent('cockpit:outcome:saved', {
        detail: { title: message.title }
      }));
    }
    // Extension → Page: proposal-list status sync just completed → refresh
    // the Outcomes tab so newly-viewed proposals show up immediately.
    if (message.type === 'WEBSITE_INSPECT_COMPLETE') {
      window.dispatchEvent(new CustomEvent('cockpit:website-inspect:complete', {
        detail: {
          job_id:  message.job_id,
          url:     message.url,
          summary: message.summary,
        }
      }));
    }
    if (message.type === 'AHREFS_COMPLETE') {
      window.dispatchEvent(new CustomEvent('cockpit:ahrefs:complete', {
        detail: {
          job_id:  message.job_id,
          domain:  message.domain,
          summary: message.summary,
          raw:     message.raw,
        }
      }));
    }
    if (message.type === 'PROPOSAL_STATUS_SYNCED') {
      window.dispatchEvent(new CustomEvent('cockpit:status:synced', {
        detail: {
          scanned: message.scanned,
          updated: message.updated,
          newly_viewed: message.newly_viewed,
          newly_replied: message.newly_replied,
          error: message.error || null,
          debug: message.debug || null,
        }
      }));
      // Also fire the generic outcome refresh so Outcomes refetches
      window.dispatchEvent(new CustomEvent('cockpit:outcome:saved', {
        detail: { source: 'status_sync' }
      }));
    }
  });
})();
