// Falcon Scout Enricher - Background Service Worker
const API_BASE = 'http://127.0.0.1:8000';

// Track tabs opened as silent background enrichment tabs
const _bgTabs = new Set();
// Track tabs opened by the "Sync from Upwork" flow — proposal.js asks us
// whether it should auto-trigger the list scrape, and we answer yes for
// these tab ids (then remove them so subsequent loads don't re-fire).
//
// CRITICAL: also mirror to chrome.storage.session. MV3 kills the service
// worker aggressively; if it restarts between opening the sync tab and
// proposal.js asking ASK_AUTO_SYNC, the in-memory Set is wiped → shouldSync
// returns false → the proposals leg never scrapes → no debug ever reaches the
// dashboard. storage.session persists across worker restarts (cleared on
// browser close), so it's the durable source of truth.
const _syncTabs = new Set();
const _SYNC_TABS_KEY = 'falcon_sync_tab_ids';

async function _persistSyncTab(tabId) {
  if (tabId == null) return;
  _syncTabs.add(tabId);
  try {
    const cur = (await chrome.storage.session.get(_SYNC_TABS_KEY))[_SYNC_TABS_KEY] || [];
    if (!cur.includes(tabId)) {
      cur.push(tabId);
      await chrome.storage.session.set({ [_SYNC_TABS_KEY]: cur });
    }
  } catch (e) { console.warn('[Cockpit BG] _persistSyncTab failed:', e && e.message); }
}

// Returns true if this tab was opened for sync, and consumes it (so a manual
// reload of the same tab doesn't re-fire). Checks both the fast in-memory Set
// AND the durable storage.session copy.
async function _consumeSyncTab(tabId) {
  if (tabId == null) return false;
  let hit = _syncTabs.has(tabId);
  _syncTabs.delete(tabId);
  try {
    const cur = (await chrome.storage.session.get(_SYNC_TABS_KEY))[_SYNC_TABS_KEY] || [];
    if (cur.includes(tabId)) {
      hit = true;
      await chrome.storage.session.set({ [_SYNC_TABS_KEY]: cur.filter(id => id !== tabId) });
    }
  } catch (e) { console.warn('[Cockpit BG] _consumeSyncTab failed:', e && e.message); }
  return hit;
}
// Track tabs opened by the popup's "Go to proposal & capture" jump button.
// When proposal.js auto-fires PROPOSAL_ENRICHED on these tabs we route the
// data to /capture-standalone-proposal (fresh KB entry) instead of the
// default /capture-proposal-update path (which needs a pre-existing entry).
const _jumpCaptureTabs = new Set();

// ── Periodic auto-sync — fires every hour via chrome.alarms ──────────────
// chrome.alarms survives service-worker sleep/wake cycles (vs. setInterval
// which gets killed when the SW idles). Opens background tabs to Upwork's
// proposals page + messages inbox; the content scripts scrape and the
// failsafe alarm closes the tabs. Free: pure local scraping, no API tokens.
const _SYNC_ALARM_NAME = 'falcon-status-sync';
const _SYNC_PERIOD_MINUTES = 60;  // hourly

// ── Background auto-enrichment ────────────────────────────────────────────
// Polls the backend for jobs that haven't been enriched yet and silently opens
// each in a hidden Upwork tab. content.js scrapes on load and POSTs to /enrich;
// the existing ENRICH_JOB handler closes the tab (it's in _bgTabs). The backend
// gates the queue on feed_config.auto_enrich and bounds batch size, so this is
// self-limiting — once the feed is caught up, the queue returns [] and nothing
// opens. chrome.alarms (not setInterval) so it survives MV3 worker sleep.
const _AUTO_ENRICH_ALARM = 'falcon-auto-enrich';
const _AUTO_ENRICH_PERIOD_MINUTES = 3;
const _AUTO_ENRICH_STAGGER_MS = 6000;  // gap between opening each tab in a batch
let _autoEnrichInFlight = false;        // prevent overlapping cycles

function _startSync(source) {
  console.log('[Cockpit BG] auto-sync triggered:', source);
  // Open BOTH the proposals list (for view-status detection) AND the
  // messages inbox (for reply detection) as background tabs. Each content
  // script asks us via ASK_AUTO_SYNC whether to fire — we say yes for
  // tracked tabs only.
  // Same v2 URL-marker pattern as the manual sync button, so both paths behave
  // identically (marker survives MV3 worker death; ASK_AUTO_SYNC is the fallback).
  const SYNC_URLS = [
    'https://www.upwork.com/nx/proposals/?falconsync=1',
    'https://www.upwork.com/ab/messages/rooms/?falconsync=1',
  ];
  for (const url of SYNC_URLS) {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (tab && tab.id) {
        _persistSyncTab(tab.id);   // durable across MV3 worker restarts
        _scheduleTabCleanup(tab.id, 4);  // failsafe — never leave a zombie tab
        console.log('[Cockpit BG] auto-sync tab opened:', tab.id, url);
      }
    });
  }
}

// (Re)create the alarm on extension start. chrome.alarms.create overwrites
// any existing alarm with the same name, so this is idempotent.
function _registerAlarms() {
  chrome.alarms.create(_SYNC_ALARM_NAME, {
    delayInMinutes: _SYNC_PERIOD_MINUTES,
    periodInMinutes: _SYNC_PERIOD_MINUTES,
  });
  chrome.alarms.create(_AUTO_ENRICH_ALARM, {
    delayInMinutes: 0.5,                          // first sweep ~30s after load
    periodInMinutes: _AUTO_ENRICH_PERIOD_MINUTES,
  });
  console.log('[Cockpit BG] alarms registered — sync every', _SYNC_PERIOD_MINUTES,
    'min, auto-enrich every', _AUTO_ENRICH_PERIOD_MINUTES, 'min');
}
chrome.runtime.onInstalled.addListener(_registerAlarms);
chrome.runtime.onStartup.addListener(_registerAlarms);

// Failsafe: any sync tab still open N minutes after creation gets force-closed.
// chrome.alarms survives MV3 service-worker death (a setTimeout wouldn't), so a
// stuck walk / dead content script can never leave a zombie Upwork tab behind.
const _TAB_CLEANUP_PREFIX = 'falcon-close-tab-';
function _scheduleTabCleanup(tabId, minutes = 3) {
  try {
    chrome.alarms.create(_TAB_CLEANUP_PREFIX + tabId, { delayInMinutes: minutes });
  } catch (e) {
    console.warn('[Cockpit BG] could not schedule tab cleanup:', e && e.message);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(_TAB_CLEANUP_PREFIX)) {
    const tabId = parseInt(alarm.name.slice(_TAB_CLEANUP_PREFIX.length), 10);
    if (!Number.isNaN(tabId)) {
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
          // Already closed (the normal case) — nothing to do.
        } else {
          console.warn('[Cockpit BG] failsafe closed stuck sync tab', tabId);
        }
      });
      _syncTabs.delete(tabId);
      _bgTabs.delete(tabId);
    }
    return;
  }
  if (alarm.name === _AUTO_ENRICH_ALARM) {
    _runAutoEnrich();
    return;
  }
  if (alarm.name !== _SYNC_ALARM_NAME) return;
  _startSync('chrome.alarms 12h tick');
});

// Fetch the pending-enrich queue and open each job in a hidden tab. The backend
// already gates (auto_enrich flag), bounds (batch size, recency, attempts), and
// applies a cooldown — so we just open what it returns, staggered. Marking the
// attempt BEFORE opening means a tab that dies (login wall, dead URL) still
// counts against the retry budget and won't be reopened every cycle.
async function _runAutoEnrich() {
  if (_autoEnrichInFlight) {
    console.log('[Cockpit BG] auto-enrich: previous cycle still in flight, skipping');
    return;
  }
  _autoEnrichInFlight = true;
  try {
    let jobs;
    try {
      const resp = await fetch(`${API_BASE}/jobs/pending-enrich`);
      if (!resp.ok) { console.warn('[Cockpit BG] auto-enrich: backend', resp.status); return; }
      jobs = await resp.json();
    } catch (e) {
      // Backend not running — silent, this is expected when the app is off.
      return;
    }
    if (!Array.isArray(jobs) || jobs.length === 0) return;
    console.log('[Cockpit BG] auto-enrich: opening', jobs.length, 'hidden tab(s)');

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (!job || !job.url) continue;
      // Count the attempt up front (survives tab death).
      try {
        await fetch(`${API_BASE}/jobs/${job.id}/enrich-attempt`, { method: 'POST' });
      } catch (e) { /* non-fatal — open the tab anyway */ }

      chrome.tabs.create({ url: job.url, active: false }, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.id) {
          console.warn('[Cockpit BG] auto-enrich: tab open failed:',
            chrome.runtime.lastError && chrome.runtime.lastError.message);
          return;
        }
        _bgTabs.add(tab.id);             // ENRICH_JOB handler closes it on success
        _scheduleTabCleanup(tab.id, 2);  // failsafe close after 2 min if it hangs
        console.log('[Cockpit BG] auto-enrich tab', tab.id, '→', job.title || job.url);
      });

      // Also open the apply page to capture boost bid competition, if we have the job id.
      const rawId = (job.upwork_job_id || '').replace(/^~/, '');
      if (rawId) {
        const applyUrl = `https://www.upwork.com/nx/proposals/job/~${rawId}/apply/`;
        chrome.tabs.create({ url: applyUrl, active: false }, (applyTab) => {
          if (chrome.runtime.lastError || !applyTab || !applyTab.id) return;
          _bgTabs.add(applyTab.id);
          _scheduleTabCleanup(applyTab.id, 2);
          console.log('[Cockpit BG] auto-enrich apply tab', applyTab.id, '→', applyUrl);
        });
      }

      if (i < jobs.length - 1) {
        await new Promise(r => setTimeout(r, _AUTO_ENRICH_STAGGER_MS));
      }
    }
  } finally {
    _autoEnrichInFlight = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Enrich job (from content.js) ──────────────────────────────────────────
  if (message.type === 'ENRICH_JOB' && message.data) {
    enrichJob(message.data)
      .then(result => {
        sendResponse({ ok: true, result });
        notifyCockpit('ENRICH_COMPLETE', {
          jobId:      result.job_id,
          title:      result.title || null,
          proposals:  result.proposals || null,
          hire_rate:  result.hire_rate || null,
          avg_rate:   result.avg_rate || null,
          enrichedAt: result.enriched_at || null,
        });
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
        notifyCockpit('ENRICH_FAILED', { error: err.message });
      })
      .finally(() => {
        // Close the tab if it was opened as a background enrichment tab
        if (sender.tab && _bgTabs.has(sender.tab.id)) {
          _bgTabs.delete(sender.tab.id);
          chrome.tabs.remove(sender.tab.id);
        }
      });
    return true; // keep channel open for async response
  }

  // ── Save boost bid competition data (from apply.js) ──────────────────────
  if (message.type === 'BOOST_BIDS' && message.job_id) {
    const jobId = String(message.job_id).replace(/^~/, '');
    fetch(`${API_BASE}/jobs/${jobId}/boost-bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bids: message.bids || [], scraped_at: message.scraped_at }),
    })
      .then(r => r.json())
      .then(result => {
        sendResponse({ ok: true, result });
        console.log('[Cockpit BG] Boost bids saved for ~' + jobId + ':', result);
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
        console.error('[Cockpit BG] Boost bids save error:', err);
      })
      .finally(() => {
        if (sender.tab && _bgTabs.has(sender.tab.id)) {
          _bgTabs.delete(sender.tab.id);
          chrome.tabs.remove(sender.tab.id);
        }
      });
    return true; // keep channel open for async response
  }

  // ── Open a background (inactive) tab to silently enrich a job ────────────
  if (message.type === 'OPEN_BACKGROUND_TAB' && message.url) {
    chrome.tabs.create({ url: message.url, active: false }, (tab) => {
      _bgTabs.add(tab.id);
      sendResponse({ ok: true, tabId: tab.id });
    });
    // Also open apply page to capture boost bids in parallel
    const idMatch = message.url.match(/~([0-9a-f]{16,})/i);
    if (idMatch) {
      const applyUrl = `https://www.upwork.com/nx/proposals/job/~${idMatch[1]}/apply/`;
      chrome.tabs.create({ url: applyUrl, active: false }, (applyTab) => {
        if (chrome.runtime.lastError || !applyTab || !applyTab.id) return;
        _bgTabs.add(applyTab.id);
        _scheduleTabCleanup(applyTab.id, 2);
      });
    }
    return true;
  }

  // ── Open a foreground (active) tab — used by the Open/Apply on Upwork
  // buttons. Routed through the extension because tabs created via
  // `chrome.tabs.create` are first-party navigations from Chrome's POV, which
  // generally avoids the cross-site cookie restrictions (SameSite, CHIPS)
  // that bite when window.open is called from localhost:5180 → upwork.com.
  // The user's existing Upwork session cookie is much more likely to be sent.
  if (message.type === 'OPEN_FOREGROUND_TAB' && message.url) {
    chrome.tabs.create({ url: message.url, active: true }, (tab) => {
      sendResponse({ ok: true, tabId: tab.id });
    });
    return true;
  }

  // ── Navigate the current tab to a standalone /proposals/{id} page AND
  //    auto-capture it as a fresh standalone proposal when proposal.js
  //    auto-fires its scrape.
  //
  // Called by the popup's "Go to proposal & capture" button when the user
  // is sitting on a job page that has an already-submitted proposal. We
  // mark the tab in `_jumpCaptureTabs` so that when proposal.js sends
  // `PROPOSAL_ENRICHED` on auto-run, we route the data through
  // `saveStandaloneProposal` (POST /capture-standalone-proposal) instead
  // of the default `handleProposalEnriched` path (POST /capture-proposal-update),
  // which requires a pre-existing KB entry mapped via room_id.
  if (message.type === 'OPEN_PROPOSAL_FOR_CAPTURE' && message.url && message.tabId != null) {
    _jumpCaptureTabs.add(message.tabId);
    chrome.tabs.update(message.tabId, { url: message.url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        _jumpCaptureTabs.delete(message.tabId);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      console.log('[Cockpit BG] OPEN_PROPOSAL_FOR_CAPTURE → tab', message.tabId, '→', message.url);
      sendResponse({ ok: true });
    });
    return true;
  }

  // ── Save captured conversation (from messages.js via popup) ──────────────
  if (message.type === 'SAVE_CONVERSATION' && message.data) {
    saveConversation(message.data)
      .then(result => {
        sendResponse({ ok: true, result });
        notifyCockpit('CONVERSATION_SAVED', { title: result.title });
        chrome.storage.local.set({ last_captured: { ...message.data, _result: result } });

        // If a proposal URL was captured, open it silently so proposal.js
        // can enrich it and fill in competition + client data.
        const proposalUrl = message.data.proposal_url;
        if (proposalUrl && proposalUrl.includes('upwork.com') && !proposalUrl.includes('modal=')) {
          chrome.tabs.create({ url: proposalUrl, active: false }, (tab) => {
            _bgTabs.add(tab.id);
            // Store room_id → kb entry id so the enrich result can be linked back
            chrome.storage.local.set({
              [`proposal_tab_${tab.id}`]: {
                room_id: message.data.room_id,
                kb_id:   result.id,
              }
            });
            console.log('[Cockpit BG] Opened proposal tab', tab.id, 'for', proposalUrl);

            // Safety: if proposal.js never reports back within 60s, close the tab anyway
            setTimeout(() => {
              if (_bgTabs.has(tab.id)) {
                console.warn('[Cockpit BG] Proposal tab', tab.id, 'timed out — closing');
                _bgTabs.delete(tab.id);
                chrome.storage.local.remove(`proposal_tab_${tab.id}`);
                chrome.tabs.remove(tab.id).catch(() => {});
              }
            }, 60000);
          });
        } else if (proposalUrl) {
          console.warn('[Cockpit BG] Skipping bad proposal URL:', proposalUrl);
        }
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  // ── Standalone proposal capture (popup-initiated, no messages page) ──────
  if (message.type === 'SAVE_STANDALONE_PROPOSAL' && message.data) {
    saveStandaloneProposal(message.data, message.url)
      .then(result => {
        sendResponse({ ok: true, result });
        chrome.storage.local.set({ last_captured: { _result: result, scraped_at: new Date().toISOString() } });
        notifyCockpit('CONVERSATION_SAVED', { title: result.title });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── Proposal page enriched (from proposal.js) ────────────────────────────
  if (message.type === 'PROPOSAL_ENRICHED' && message.data) {
    const tabId = sender.tab && sender.tab.id;
    // Jump-capture path: user came in via the popup's "Go to proposal &
    // capture" button. Save as a fresh standalone proposal entry and notify
    // the dashboard so Outcomes refreshes — DO NOT close the tab (user is
    // looking at the proposal page).
    if (tabId != null && _jumpCaptureTabs.has(tabId)) {
      _jumpCaptureTabs.delete(tabId);
      saveStandaloneProposal(message.data, message.url || (sender.tab && sender.tab.url))
        .then(result => {
          console.log('[Cockpit BG] Jump-capture saved standalone proposal:', result.title || result.id);
          sendResponse({ ok: true, result });
          notifyCockpit('PROPOSAL_CAPTURED', { title: result.title });
          chrome.storage.local.set({ last_captured: { ...message.data, _result: result } });
        })
        .catch(err => {
          console.error('[Cockpit BG] Jump-capture save failed:', err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }
    handleProposalEnriched(tabId, message.data, message.url)
      .then(result => {
        sendResponse({ ok: true, result });
        // Close the background proposal tab when done
        if (tabId && _bgTabs.has(tabId)) {
          _bgTabs.delete(tabId);
          chrome.tabs.remove(tabId);
        }
      })
      .catch(err => {
        console.error('[Cockpit BG] Proposal enrich error:', err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  // ── Sync trigger from the dashboard (via bridge.js) ──────────────────────
  // Opens TWO background tabs: the proposals list (for "Viewed by client"
  // detection) and the messages inbox (for reply detection). Each tab's
  // content script asks us via ASK_AUTO_SYNC whether to scrape — we say yes
  // for tracked tabs only.
  if (message.type === 'SYNC_PROPOSAL_STATUSES') {
    console.log('[Cockpit BG] SYNC_PROPOSAL_STATUSES — opening proposals tab (sync v2: URL-marker + direct POST)');
    // Sync v2 redesign: open the proposals page as an ACTIVE tab (background
    // tabs are throttled and don't render virtualised rows — that's why we only
    // ever scraped ~7/30). The ?falconsync=1 marker is the trigger — it lives
    // in the URL, so it survives MV3 worker death (no in-memory tab tracking,
    // no ASK_AUTO_SYNC). proposal.js does the scrape, POSTs straight to the
    // backend, and shows an on-page banner. The worker's only job is opening
    // the tab. We still persist the tab id as a belt-and-suspenders fallback.
    const openedTabIds = [];
    // BOTH legs now use the reliable v2 pattern: ?falconsync=1 URL marker →
    // content script scrapes → direct POST to the backend → on-page banner.
    // No cross-tab relay (that was the unreliable part the messages leg used).
    //  • Proposals leg: viewed detection is a raw-HTML scan (no rendering
    //    needed) → can stay in the BACKGROUND (active:false).
    //  • Messages leg: scrapes the conversation list from the DOM, which needs
    //    the tab rendered → open ACTIVE so virtualised rows hydrate.
    chrome.tabs.create(
      { url: 'https://www.upwork.com/nx/proposals/?falconsync=1', active: false },
      (tab) => {
        if (tab && tab.id) { _persistSyncTab(tab.id); openedTabIds.push(tab.id); _scheduleTabCleanup(tab.id, 3); }
        console.log('[Cockpit BG] sync proposals tab opened (bg):', tab && tab.id);
        chrome.tabs.create(
          { url: 'https://www.upwork.com/ab/messages/rooms/?falconsync=1', active: false },
          (mtab) => {
            // Messages leg may walk up to 10 rooms (~12s budget each) — give it
            // a longer leash before the failsafe kills it.
            if (mtab && mtab.id) { _persistSyncTab(mtab.id); openedTabIds.push(mtab.id); _scheduleTabCleanup(mtab.id, 4); }
            console.log('[Cockpit BG] sync messages tab opened (bg):', mtab && mtab.id);
            sendResponse({ ok: true, tabIds: openedTabIds });
          }
        );
      }
    );
    return true; // async
  }

  // Content script asks: was THIS tab opened for the sync flow?
  // We respond with shouldSync=true once, then forget the tab so a manual
  // reload of the same tab doesn't accidentally re-trigger the scrape.
  if (message.type === 'ASK_AUTO_SYNC') {
    const tabId = sender.tab && sender.tab.id;
    // Durable check — survives an MV3 worker restart between tab-open and ask.
    _consumeSyncTab(tabId).then(shouldSync => {
      console.log('[Cockpit BG] ASK_AUTO_SYNC from tab', tabId, '→ shouldSync:', shouldSync);
      sendResponse({ shouldSync });
    });
    return true; // async response
  }

  // ── Messages-inbox status sync ───────────────────────────────────────────
  if (message.type === 'MESSAGES_STATUS_SYNC' && Array.isArray(message.rows)) {
    syncMessageStatuses(message.rows)
      .then(result => {
        sendResponse({ ok: true, result });
        notifyCockpit('PROPOSAL_STATUS_SYNCED', {
          scanned: result.scanned,
          updated: result.updated,
          newly_replied: result.newly_replied,
        });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Messages-list scraper signals it's done — close the tab AND notify the
  // dashboard so the sync UI updates even when 0 rows were scraped (the
  // promise form of chrome.tabs.remove was swallowing failures silently;
  // callback form surfaces lastError for diagnosis).
  if (message.type === 'MESSAGES_LIST_SCRAPE_DONE') {
    const tabId = sender.tab && sender.tab.id;
    console.log('[Cockpit BG] MESSAGES_LIST_SCRAPE_DONE for tab', tabId, 'result:', message.result);

    // v2: the content script POSTs directly to the backend, so the background
    // never saw the result — ALWAYS notify the dashboard here with the counts
    // from the message (this is what lights up the Outcomes activity dots).
    const r = message.result || {};
    notifyCockpit('PROPOSAL_STATUS_SYNCED', {
      scanned: r.scanned || 0,
      updated: r.updated || 0,
      newly_replied: r.newly_replied || 0,
      error: r.error || null,
    });

    if (tabId != null) {
      if (_syncTabs.has(tabId)) _syncTabs.delete(tabId);
      if (_bgTabs.has(tabId))   _bgTabs.delete(tabId);
      try {
        chrome.tabs.remove(tabId, () => {
          if (chrome.runtime.lastError) {
            console.warn('[Cockpit BG] chrome.tabs.remove (messages) failed:', chrome.runtime.lastError.message, 'tabId:', tabId);
          } else {
            console.log('[Cockpit BG] closed messages tab', tabId);
          }
        });
      } catch (e) {
        console.warn('[Cockpit BG] chrome.tabs.remove (messages) threw:', e && e.message);
      }
    } else {
      console.warn('[Cockpit BG] MESSAGES_LIST_SCRAPE_DONE had no sender.tab.id — cannot close tab');
    }
    return;
  }

  // ── Proposals-list status sync (DESIGN.md Phase 6) ───────────────────────
  if (message.type === 'PROPOSAL_STATUS_SYNC' && Array.isArray(message.rows)) {
    syncProposalStatuses(message.rows)
      .then(result => {
        sendResponse({ ok: true, result });
        notifyCockpit('PROPOSAL_STATUS_SYNCED', {
          scanned: result.scanned,
          updated: result.updated,
          newly_viewed: result.newly_viewed,
          // Client-side scrape debug (row titles, viewed-indicator count) so
          // the dashboard can show it WITHOUT the user opening DevTools.
          debug: message.debug || null,
        });
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  // Auto-sync foreground tab signals it's done — close it AND notify the
  // dashboard with the result so the button updates even when 0 rows were
  // scraped (otherwise the user is stuck staring at a "scraping…" spinner).
  if (message.type === 'PROPOSALS_LIST_SCRAPE_DONE') {
    const tabId = sender.tab && sender.tab.id;
    console.log('[Cockpit BG] PROPOSALS_LIST_SCRAPE_DONE for tab', tabId, 'result:', message.result);

    // v2: the content script POSTs directly to the backend (result carries the
    // counts), so ALWAYS notify the dashboard here — this is what lights up the
    // Outcomes activity dots.
    const r = message.result || {};
    const inner = r.result || r;  // direct-POST response may be nested under .result
    notifyCockpit('PROPOSAL_STATUS_SYNCED', {
      scanned: inner.scanned || 0,
      updated: inner.updated || 0,
      newly_viewed: inner.newly_viewed || 0,
      error: r.error || null,
      debug: r.debug || null,
    });

    // Close the tab whichever Set tracked it (sync-opened OR bg-enrich-opened).
    // Use the callback form so chrome.runtime.lastError surfaces — promise form
    // was silently swallowing failures.
    if (tabId != null) {
      if (_syncTabs.has(tabId)) _syncTabs.delete(tabId);
      if (_bgTabs.has(tabId))   _bgTabs.delete(tabId);
      try {
        chrome.tabs.remove(tabId, () => {
          if (chrome.runtime.lastError) {
            console.warn('[Cockpit BG] chrome.tabs.remove failed:', chrome.runtime.lastError.message, 'tabId:', tabId);
          } else {
            console.log('[Cockpit BG] closed tab', tabId);
          }
        });
      } catch (e) {
        console.warn('[Cockpit BG] chrome.tabs.remove threw:', e && e.message);
      }
    } else {
      console.warn('[Cockpit BG] PROPOSALS_LIST_SCRAPE_DONE had no sender.tab.id — cannot close tab');
    }
    return;
  }

  // ── Auto-captured proposal submission ────────────────────────────────────
  if (message.type === 'PROPOSAL_SUBMITTED' && message.data) {
    recordProposalSubmitted(message.data)
      .then(result => {
        sendResponse({ ok: true, result });
        notifyCockpit('PROPOSAL_SUBMITTED', { jobId: message.data.upwork_job_id });
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  // ── Status ping from popup ────────────────────────────────────────────────
  if (message.type === 'GET_STATUS') {
    sendResponse({ status: 'active' });
  }
});

async function syncProposalStatuses(rows) {
  console.log('[Cockpit BG] Syncing', rows.length, 'proposal-list rows');
  const response = await fetch(`${API_BASE}/proposal-status-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('API ' + response.status + ': ' + text);
  }
  const result = await response.json();
  console.log('[Cockpit BG] Sync result:', result);
  return result;
}

async function syncMessageStatuses(rows) {
  console.log('[Cockpit BG] Syncing', rows.length, 'message-inbox rows');
  const response = await fetch(`${API_BASE}/messages-status-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('API ' + response.status + ': ' + text);
  }
  const result = await response.json();
  console.log('[Cockpit BG] Messages sync result:', result);
  return result;
}

async function saveStandaloneProposal(data, url) {
  console.log('[Cockpit BG] Saving standalone proposal:', data.job_title || url);
  const response = await fetch(`${API_BASE}/capture-standalone-proposal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal: data, url }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error('API ' + response.status + ': ' + (JSON.parse(text)?.detail || text));
  }
  return response.json();
}

async function handleProposalEnriched(tabId, data, url) {
  // Look up the room_id associated with this background tab
  const key = `proposal_tab_${tabId}`;
  const stored = await new Promise(r => chrome.storage.local.get([key], r));
  const meta = stored[key];

  if (!meta || !meta.room_id) {
    console.warn('[Cockpit BG] No room_id mapped for tab', tabId);
    return { skipped: true };
  }

  console.log('[Cockpit BG] Updating KB entry for room', meta.room_id, 'with proposal data');

  const response = await fetch(`${API_BASE}/capture-proposal-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: meta.room_id, kb_id: meta.kb_id, proposal: data, url }),
  });

  // Clean up the mapping
  chrome.storage.local.remove(key);

  if (!response.ok) {
    const text = await response.text();
    throw new Error('Proposal update failed: ' + response.status + ' ' + text);
  }
  const result = await response.json();
  notifyCockpit('CONVERSATION_SAVED', { title: result.title });
  return result;
}

async function recordProposalSubmitted(data) {
  const { upwork_job_id, bid_amount, bid_currency, submitted_at, sent_text } = data;
  console.log('[Cockpit BG] Recording proposal submission for job:', upwork_job_id);

  // Look up the job by upwork_job_id directly — far cheaper than fetching all jobs.
  // The endpoint handles the ~ prefix transparently.
  const normId = (upwork_job_id || '').replace(/^~/, '');
  const jobResp = await fetch(`${API_BASE}/jobs/by-upwork-id/${normId}`);
  if (jobResp.status === 404) {
    throw new Error('Job not found in local DB: ~' + normId
      + ' (likely never captured by the Telegram listener — submit only works for jobs that came through @OffersHunterBot first)');
  }
  if (!jobResp.ok) {
    throw new Error('Job lookup failed: ' + jobResp.status);
  }
  const job = await jobResp.json();

  // Now record the submission with the bid + cover-letter data
  const response = await fetch(`${API_BASE}/proposal-submitted`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: job.id,
      bid_amount,
      bid_currency,
      submitted_at,
      sent_text: sent_text || null,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[Cockpit BG] Proposal submission error:', response.status, text);
    throw new Error('API returned ' + response.status + ': ' + text);
  }

  const result = await response.json();
  console.log('[Cockpit BG] Proposal submission recorded:', result);
  return result;
}

async function enrichJob(data) {
  console.log('[Cockpit BG] Enriching job:', data.job_id);

  const response = await fetch(`${API_BASE}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[Cockpit BG] API error:', response.status, text);
    throw new Error('API returned ' + response.status + ': ' + text);
  }

  const result = await response.json();
  console.log('[Cockpit BG] Enrichment successful:', result);
  await chrome.storage.local.set({ last_enriched: { ...data, _result: result } });
  return result;
}

async function saveConversation(data) {
  console.log('[Cockpit BG] Saving conversation:', data.room_id || data.url);
  const response = await fetch(`${API_BASE}/capture-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('[Cockpit BG] Capture API error:', response.status, text);
    throw new Error('API returned ' + response.status + ': ' + (JSON.parse(text)?.detail || text));
  }
  const result = await response.json();
  console.log('[Cockpit BG] Conversation saved:', result.title);
  return result;
}

// Send a message to all open Falcon Scout tabs (localhost:5180 + legacy ports)
function notifyCockpit(type, detail) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.url && (
        tab.url.startsWith('http://localhost:5173') ||
        tab.url.startsWith('http://127.0.0.1:5173') ||
        tab.url.startsWith('http://localhost:5174') ||
        tab.url.startsWith('http://127.0.0.1:5174') ||
        tab.url.startsWith('http://localhost:5180') ||
        tab.url.startsWith('http://127.0.0.1:5180')
      )) {
        chrome.tabs.sendMessage(tab.id, { type, ...detail }, () => {
          if (chrome.runtime.lastError) {} // tab may not have bridge.js loaded yet — ignore
        });
      }
    }
  });
}
