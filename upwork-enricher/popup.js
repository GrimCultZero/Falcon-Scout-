// popup.js

// ── Open the dashboard's Outcomes tab ───────────────────────────────────────
// If a Falcon Scout dashboard tab already exists, focus it and switch its view
// to Outcomes via URL hash. Otherwise open a new tab. Used by all "Saved to
// Outcomes" click handlers in this popup.
const DASHBOARD_URLS = [
  'http://localhost:5180/*',
  'http://127.0.0.1:5180/*',
  'http://localhost:5174/*',
  'http://127.0.0.1:5174/*',
  'http://localhost:5173/*',
  'http://127.0.0.1:5173/*',
];
function openDashboardOutcomes() {
  const target = 'http://localhost:5180/#outcomes';
  chrome.tabs.query({ url: DASHBOARD_URLS }, (tabs) => {
    if (tabs && tabs.length > 0) {
      const t = tabs[0];
      // Update the hash on the existing tab + bring it to the front
      chrome.tabs.update(t.id, { url: target, active: true });
      if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: target });
    }
    window.close();
  });
}

// Replace plain text status with a clickable link that opens Outcomes.
// `result` is the backend response — we use it to distinguish KB-only updates
// from full Outcomes-row creation, so the wording matches what actually
// happened (the KB entry and the Proposals row have independent lifecycles).
function renderCaptureSuccess(title, isUpdate, result) {
  captureStatus.innerHTML = '';
  const prefix = document.createElement('span');
  const proposalCreated = !!(result && result._proposal_created);
  const matchedJob      = !!(result && result._matched_job_id);
  prefix.textContent = proposalCreated ? '✅ ' : (isUpdate ? '🔄 ' : '✅ ');
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'status-link';
  // Three real cases, in order of how the user will read them:
  //   1. New Outcomes row created → "Saved to Outcomes"
  //   2. Job matched, KB updated, Outcomes row already existed → "Updated in Outcomes"
  //   3. No matching job → KB-only update; tell the truth: "Updated in KB"
  let label;
  if (proposalCreated) {
    label = 'Saved to Outcomes: "';
  } else if (matchedJob && isUpdate) {
    label = 'Updated in Outcomes: "';
  } else if (matchedJob) {
    label = 'Saved to Outcomes: "';
  } else if (isUpdate) {
    label = 'Updated in KB (no matching job): "';
  } else {
    label = 'Saved to KB (no matching job): "';
  }
  link.textContent = label + (title || '') + '"';
  link.title = 'Open Outcomes in Falcon Scout';
  link.addEventListener('click', (e) => { e.preventDefault(); openDashboardOutcomes(); });
  captureStatus.appendChild(prefix);
  captureStatus.appendChild(link);
  captureStatus.className = 'capture-status ok';
}

// Make the "Last captured" title clickable too
function makeLastCapturedClickable() {
  if (!lastCapturedTitle) return;
  lastCapturedTitle.classList.add('status-link');
  lastCapturedTitle.title = 'Open Outcomes in Falcon Scout';
  lastCapturedTitle.addEventListener('click', openDashboardOutcomes);
}

const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const lastJobEl  = document.getElementById('last-job');
const lastJobId  = document.getElementById('last-job-id');
const lastJobTime= document.getElementById('last-job-time');
const enrichedData = document.getElementById('enriched-data');

const captureSection    = document.getElementById('capture-section');
const captureBtn        = document.getElementById('capture-btn');
const captureLabelText  = document.getElementById('capture-label-text');
const captureIcon       = document.getElementById('capture-icon');
const captureStatus     = document.getElementById('capture-status');
const lastCapturedEl    = document.getElementById('last-captured');
const lastCapturedTitle = document.getElementById('last-captured-title');
const lastCapturedTime  = document.getElementById('last-captured-time');
const debugPanelEl      = document.getElementById('debug-panel');
const debugContentEl    = document.getElementById('debug-content');
const debugCopyBtn      = document.getElementById('debug-copy-btn');

// Format a capture's scraped data for the debug panel. Compact, copy-friendly
// summary of what proposal.js found and what was sent to the backend.
function formatDebugInfo(scrapedData, backendResult, capturedAt) {
  const d = scrapedData || {};
  const r = backendResult || {};
  const lines = [];
  lines.push('Falcon Scout — capture debug');
  lines.push('captured: ' + (capturedAt || new Date().toISOString()));
  lines.push('url: ' + (d.url || '—'));
  lines.push('');
  lines.push('-- SCRAPED --');
  lines.push('job_title: ' + JSON.stringify(d.job_title || ''));
  lines.push('upwork_job_id: ' + (d.upwork_job_id || '—') +
    (d.upwork_job_id ? ` (${d.upwork_job_id.length} chars)` : ''));
  lines.push('cover_letter: ' + (d.cover_letter ? `${d.cover_letter.length} chars` : '—') +
    (d.cover_letter ? `\n  first: ${JSON.stringify(d.cover_letter.slice(0, 120))}` : ''));
  lines.push('job_description: ' + (d.job_description ? `${d.job_description.length} chars` : '—') +
    (d.job_description ? `\n  first: ${JSON.stringify(d.job_description.slice(0, 120))}` : ''));
  // Conversation-capture-only fields (only present when the popup ran on a
  // messages page). Surface them so the user can tell whether the sidebar
  // scraper or the thread scraper is what came back empty.
  if ('room_id' in d)         lines.push('room_id: ' + (d.room_id || '—'));
  if ('client_name' in d)     lines.push('client_name: ' + JSON.stringify(d.client_name || ''));
  if ('client_company' in d)  lines.push('client_company: ' + JSON.stringify(d.client_company || ''));
  if ('contract_status' in d) lines.push('contract_status: ' + JSON.stringify(d.contract_status || ''));
  if ('_sidebar_found' in d)        lines.push('_sidebar_found: ' + (d._sidebar_found ? 'yes' : 'no'));
  if ('_contract_status_via' in d)  lines.push('_contract_status_via: ' + (d._contract_status_via || 'none'));
  if ('activity_timeline' in d) lines.push('activity_timeline: ' + JSON.stringify(d.activity_timeline || ''));
  if ('job_url' in d)         lines.push('job_url: ' + (d.job_url || '—'));
  if ('proposal_url' in d)    lines.push('proposal_url: ' + (d.proposal_url || '—'));
  if ('raw_text' in d) {
    const rt = d.raw_text || '';
    lines.push('raw_text: ' + (rt ? `${rt.length} chars, ${rt.split('\n').length} lines` : '—'));
  }
  if (d.my_bid)         lines.push('bid: ' + d.my_bid + ' Connects');
  if (d.boost_connects) lines.push('boost_connects: ' + d.boost_connects + ' Connects');
  if (d.client_total_spent) lines.push('client_total_spent: ' + d.client_total_spent);
  if (d.client_rating)      lines.push('client_rating: ' + d.client_rating + ' (' + (d.client_reviews || '?') + ' reviews)');
  if (d.hire_rate != null)  lines.push('hire_rate: ' + d.hire_rate + '%');
  lines.push('');
  lines.push('-- BACKEND RESPONSE --');
  lines.push('kb_id: ' + (r.id || '—'));
  lines.push('title (after backend): ' + JSON.stringify(r.title || ''));
  lines.push('_updated: ' + !!r._updated);
  lines.push('_matched_job_id: ' + (r._matched_job_id == null ? 'null (no match in local DB)' : r._matched_job_id));

  // The two capture flows return DIFFERENT diagnostic shapes — pick the right
  // one so we don't print misleading "<MISSING — old code>" warnings for a
  // field the endpoint legitimately never returns.
  //   • /capture-conversation (messages page) → _detected_status,
  //     _proposal_status_after, _client_reply_chars
  //   • /capture-standalone-proposal (proposal page) → _proposal_created,
  //     _backfilled_fields, _job_state_after, _proposal
  const isConversationCapture =
    ('_detected_status' in (r || {})) || ('_client_reply_chars' in (r || {}));

  if (isConversationCapture) {
    lines.push('_detected_status: ' + (r._detected_status || 'none (no reply/outcome signal found)'));
    lines.push('_proposal_status_after: ' + (r._proposal_status_after || '— (no promotion)'));
    lines.push('_client_reply_chars: ' + (r._client_reply_chars == null ? '—' : r._client_reply_chars));
    if (r._matched_job_id == null) {
      lines.push('  ⚠ No Job matched → status NOT updated. Check the job title matches a row in the local DB.');
    }
  } else {
    lines.push('_proposal_created: ' + !!r._proposal_created);
    if (r._proposal && r._proposal.id) {
      lines.push('proposal_row.id: ' + r._proposal.id);
      lines.push('proposal_row.status: ' + r._proposal.status);
    }
    // Backfill diagnostics (set by /capture-standalone-proposal as of 2026-05-26).
    // If the key is missing entirely → backend is still running pre-fix code.
    // If the array is empty → matched Job's fields were already all populated.
    // If non-empty → those columns just got filled.
    if (Array.isArray(r._backfilled_fields)) {
      lines.push('_backfilled_fields: ' + (r._backfilled_fields.length
        ? r._backfilled_fields.join(', ')
        : '[] (Job already had all client data)'));
    } else if ('_backfilled_fields' in (r || {})) {
      lines.push('_backfilled_fields: ' + JSON.stringify(r._backfilled_fields));
    } else {
      lines.push('_backfilled_fields: <MISSING — backend has old code, restart uvicorn>');
    }
  }
  if (r._job_state_after) {
    const s = r._job_state_after;
    lines.push('_job_state_after:');
    lines.push('  client_total_spent_detail: ' + (s.client_total_spent_detail || '—'));
    lines.push('  hire_rate:                  ' + (s.hire_rate == null ? '—' : s.hire_rate + '%'));
    lines.push('  client_rating_score:        ' + (s.client_rating_score == null ? '—' : s.client_rating_score));
    lines.push('  client_review_count:        ' + (s.client_review_count == null ? '—' : s.client_review_count));
    lines.push('  payment_verified:           ' + (s.payment_verified == null ? '—' : s.payment_verified));
    lines.push('  enriched_at:                ' + (s.enriched_at || '—'));
  }
  return lines.join('\n');
}

function showDebugInfo(scrapedData, backendResult) {
  if (!debugPanelEl || !debugContentEl) return;
  debugPanelEl.style.display = 'block';
  debugContentEl.textContent = formatDebugInfo(scrapedData, backendResult, new Date().toISOString());
  // Persist to chrome.storage so reopening the popup shows the same debug
  chrome.storage.local.set({
    falcon_last_debug: {
      scraped: scrapedData,
      backend: backendResult,
      at: new Date().toISOString(),
    },
  });
}

if (debugCopyBtn) {
  debugCopyBtn.addEventListener('click', async () => {
    const text = debugContentEl ? debugContentEl.textContent : '';
    try {
      await navigator.clipboard.writeText(text);
      debugCopyBtn.textContent = '✓ Copied';
      debugCopyBtn.classList.add('copied');
      setTimeout(() => {
        debugCopyBtn.textContent = '📋 Copy';
        debugCopyBtn.classList.remove('copied');
      }, 1800);
    } catch (e) {
      debugCopyBtn.textContent = '✗ Failed';
      setTimeout(() => { debugCopyBtn.textContent = '📋 Copy'; }, 1800);
    }
  });
}

// On popup open, restore the previous debug info so the user can copy the
// last capture even if they reopened the popup later.
chrome.storage.local.get(['falcon_last_debug'], (r) => {
  if (r && r.falcon_last_debug) {
    const d = r.falcon_last_debug;
    if (debugPanelEl && debugContentEl) {
      debugPanelEl.style.display = 'block';
      debugContentEl.textContent = formatDebugInfo(d.scraped, d.backend, d.at);
    }
  }
});
const jobInfo           = document.getElementById('job-info');

// ── Detect current tab type ───────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const url = (tab && tab.url) || '';
  const isMessagesPage = /upwork\.com\/(nx\/|ab\/)?(messages\/rooms|wm\/workroom\/\d+\/messages)/.test(url);
  const isProposalPage = /upwork\.com\/(nx\/|ab\/)?proposals\/\d{8,}/.test(url);

  if (isProposalPage) {
    // ── Proposal page UI ───────────────────────────────────────────────────
    jobInfo.style.display = 'none';
    captureSection.style.display = 'block';
    statusText.textContent = 'On proposal page — capture full proposal details';
    captureLabelText.textContent = 'Capture this Proposal';
    captureIcon.textContent = '📄';

    chrome.storage.local.get(['last_captured'], (r) => {
      if (r.last_captured && r.last_captured._result) {
        lastCapturedEl.style.display = 'block';
        lastCapturedTitle.textContent = r.last_captured._result.title || '—';
        const t = r.last_captured.scraped_at || r.last_captured._result.created_at;
        lastCapturedTime.textContent = t ? new Date(t).toLocaleString() : '';
        makeLastCapturedClickable();
      }
    });

    captureBtn.addEventListener('click', () => {
      captureBtn.disabled = true;
      captureIcon.textContent = '⏳';
      captureLabelText.textContent = 'Capturing…';
      captureStatus.textContent = '';
      captureStatus.className = 'capture-status';

      chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_PROPOSAL_REQUEST' }, (response) => {
        if (chrome.runtime.lastError) {
          captureBtn.disabled = false;
          captureIcon.textContent = '📄';
          captureLabelText.textContent = 'Capture this Proposal';
          captureStatus.textContent = '❌ Could not reach proposal script. Try reloading the page.';
          captureStatus.className = 'capture-status err';
          return;
        }
        if (!response || !response.ok) {
          captureBtn.disabled = false;
          captureIcon.textContent = '📄';
          captureLabelText.textContent = 'Capture this Proposal';
          captureStatus.textContent = '❌ ' + (response && response.error || 'Proposal scrape failed');
          captureStatus.className = 'capture-status err';
          return;
        }

        captureLabelText.textContent = 'Saving…';
        chrome.runtime.sendMessage({ type: 'SAVE_STANDALONE_PROPOSAL', data: response.data, url }, (saveRes) => {
          captureBtn.disabled = false;
          captureIcon.textContent = '📄';
          captureLabelText.textContent = 'Capture this Proposal';

          // Always show the debug panel (success or fail) so the user can
          // see what was scraped and copy diagnostics with one click.
          showDebugInfo(response.data, saveRes && saveRes.result);

          if (saveRes && saveRes.ok) {
            const isUpdate = saveRes.result && saveRes.result._updated;
            const title    = saveRes.result && saveRes.result.title || 'proposal';
            renderCaptureSuccess(title, isUpdate, saveRes.result);
            lastCapturedEl.style.display = 'block';
            lastCapturedTitle.textContent = title;
            makeLastCapturedClickable();
            lastCapturedTime.textContent = new Date().toLocaleString();
          } else {
            captureStatus.textContent = '❌ ' + (saveRes && saveRes.error || 'Save failed');
            captureStatus.className = 'capture-status err';
          }
        });
      });
    });

  } else if (isMessagesPage) {
    // ── Messaging page UI ──────────────────────────────────────────────────
    jobInfo.style.display = 'none';
    captureSection.style.display = 'block';
    statusText.textContent = 'On messaging page — ready to capture';

    // Show last captured if available
    chrome.storage.local.get(['last_captured'], (r) => {
      if (r.last_captured && r.last_captured._result) {
        lastCapturedEl.style.display = 'block';
        lastCapturedTitle.textContent = r.last_captured._result.title || '—';
        const t = r.last_captured.scraped_at || r.last_captured._result.created_at;
        lastCapturedTime.textContent = t ? new Date(t).toLocaleString() : '';
        makeLastCapturedClickable();
      }
    });

    // Capture button click
    captureBtn.addEventListener('click', () => {
      captureBtn.disabled = true;
      captureIcon.textContent = '⏳';
      captureLabelText.textContent = 'Capturing…';
      captureStatus.textContent = '';
      captureStatus.className = 'capture-status';

      // Ask content script to scrape the page
      chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_CONVERSATION_REQUEST' }, (response) => {
        if (chrome.runtime.lastError) {
          captureBtn.disabled = false;
          captureIcon.textContent = '📩';
          captureLabelText.textContent = 'Capture Conversation';
          captureStatus.textContent = '❌ Could not reach page script. Try reloading the Upwork tab.';
          captureStatus.className = 'capture-status err';
          return;
        }
        if (!response || !response.ok) {
          captureBtn.disabled = false;
          captureIcon.textContent = '📩';
          captureLabelText.textContent = 'Capture Conversation';
          captureStatus.textContent = '❌ ' + (response && response.error || 'Capture failed');
          captureStatus.className = 'capture-status err';
          return;
        }

        // Data captured — send to background to save via API
        captureLabelText.textContent = 'Saving…';
        chrome.runtime.sendMessage({ type: 'SAVE_CONVERSATION', data: response.data }, (saveRes) => {
          captureBtn.disabled = false;
          captureIcon.textContent = '📩';
          captureLabelText.textContent = 'Capture Conversation';

          showDebugInfo(response.data, saveRes && saveRes.result);

          if (saveRes && saveRes.ok) {
            const isUpdate = saveRes.result && saveRes.result._updated;
            const title    = saveRes.result && saveRes.result.title || 'conversation';
            renderCaptureSuccess(title, isUpdate, saveRes.result);
            // Update last-captured card
            lastCapturedEl.style.display = 'block';
            lastCapturedTitle.textContent = title;
            lastCapturedTime.textContent = new Date().toLocaleString();
            makeLastCapturedClickable();
          } else {
            captureStatus.textContent = '❌ ' + (saveRes && saveRes.error || 'Save failed');
            captureStatus.className = 'capture-status err';
          }
        });
      });
    });

  } else {
    // ── Job page UI (default) ──────────────────────────────────────────────
    captureSection.style.display = 'none';
    jobInfo.style.display = 'block';

    // If the user has already submitted a proposal for this job, Upwork
    // renders a "View Proposal" link near the top of the page. Detect it and
    // offer a one-click jump to the standalone /nx/proposals/{id} page, where
    // proposal.js can capture the cover letter + bid + competition stats.
    //
    // We run the detection via chrome.scripting.executeScript rather than
    // editing content.js: keeps this concern co-located with the popup UI
    // that consumes it, and avoids touching the enrichment hot path.
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Strategy: find any anchor whose visible text is "View Proposal"
        // (case-insensitive). Upwork's job-details-viewer page renders it
        // as a plain <a>; the /jobs/~id page renders it the same way.
        const anchors = [...document.querySelectorAll('a[href]')];
        const link = anchors.find(a => /^view\s+proposal$/i.test((a.innerText || '').trim()));
        if (!link) return null;
        // Resolve relative hrefs to absolute so chrome.tabs.update works
        // regardless of which Upwork path variant the page renders.
        return new URL(link.getAttribute('href'), location.origin).toString();
      },
    }, (results) => {
      if (chrome.runtime.lastError) return; // page may not yet be ready; bail silently
      const proposalUrl = results && results[0] && results[0].result;
      if (!proposalUrl) return;
      const jumpSection = document.getElementById('proposal-jump-section');
      const jumpBtn     = document.getElementById('proposal-jump-btn');
      const jumpStatus  = document.getElementById('proposal-jump-status');
      if (!jumpSection || !jumpBtn) return;
      jumpSection.style.display = 'block';
      jumpBtn.addEventListener('click', () => {
        jumpBtn.disabled = true;
        jumpStatus.textContent = 'Opening proposal page…';
        jumpStatus.className = 'capture-status';
        // Tell background to navigate THIS tab to the proposal URL AND mark
        // it as a sync tab so proposal.js auto-captures on load (same handshake
        // the inbox-sync flow uses — see ASK_AUTO_SYNC).
        chrome.runtime.sendMessage(
          { type: 'OPEN_PROPOSAL_FOR_CAPTURE', tabId: tab.id, url: proposalUrl },
          (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.ok) {
              jumpBtn.disabled = false;
              jumpStatus.textContent = '❌ ' + (resp && resp.error || chrome.runtime.lastError?.message || 'Could not navigate');
              jumpStatus.className = 'capture-status err';
              return;
            }
            jumpStatus.textContent = '✅ Navigating — capture will run automatically on load.';
            jumpStatus.className = 'capture-status ok';
            // Close popup so user sees the page navigation cleanly
            setTimeout(() => window.close(), 600);
          }
        );
      });
    });

    // Load last enriched job from storage
    chrome.storage.local.get(['last_enriched'], (result) => {
      if (result.last_enriched) {
        const d = result.last_enriched;
        lastJobEl.style.display = 'block';
        lastJobId.textContent = '~' + (d.job_id || '?');
        lastJobTime.textContent = d.scraped_at ? new Date(d.scraped_at).toLocaleString() : '';

        const fields = [
          ['Connects',    d.connects_required ? d.connects_required + ' connects' : null],
          ['Applicants',  d.proposals],
          ['Hire rate',   d.hire_rate != null ? d.hire_rate + '%' : null],
          ['Payment',     d.payment_verified ? '✓ Verified' : '✗ Not verified'],
          ['Jobs posted', d.client_jobs_posted],
          ['Total spent', d.client_total_spent_detail],
          ['Rating',      d.client_rating],
          ['Interviewing',d.interviewing],
        ];

        enrichedData.innerHTML = fields
          .filter(([, v]) => v != null)
          .map(([label, value]) => {
            const isGood = value && (value.toString().includes('✓') || value.toString().includes('Verified'));
            const isBad  = value && value.toString().includes('✗');
            return `<div class="field">
              <span class="field-label">${label}</span>
              <span class="field-value ${isGood ? 'good' : isBad ? 'bad' : ''}">${value}</span>
            </div>`;
          }).join('');
      }
    });
  }
});

// Listen for messages from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ENRICH_SUCCESS') {
    dot.className = 'dot';
    statusText.textContent = 'Enriched job ' + message.job_id;
  }
  if (message.type === 'ENRICH_ERROR') {
    dot.className = 'dot error';
    statusText.textContent = message.error;
  }
});
