// Falcon Scout — Apply-page content script
// Scrapes the "Boost your proposal" bid competition table from
//   https://www.upwork.com/nx/proposals/job/~{id}/apply/
// Sends BOOST_BIDS to background.js → POST /jobs/{id}/boost-bids

(function () {
  'use strict';

  function jobIdFromUrl(url) {
    const m = url.match(/~([0-9a-f]{16,})/i);
    return m ? m[1] : null;
  }

  function extractBids(bodyText) {
    const bids = [];
    // Primary: "1st place   101 Connects   4 hours ago"
    const rowRe = /(\d+)(?:st|nd|rd|th)\s+place\s+([\d,]+)\s+[Cc]onnects\s+([^\n]+)/g;
    let m;
    while ((m = rowRe.exec(bodyText)) !== null) {
      bids.push({
        rank:     parseInt(m[1], 10),
        connects: parseInt(m[2].replace(/,/g, ''), 10),
        age:      m[3].trim(),
      });
    }
    if (bids.length) return bids;

    // Fallback: just "101 Connects" near ordinal rank labels (different table layout)
    const altRe = /(\d+)(?:st|nd|rd|th)[^\d]{0,30}([\d,]+)\s+[Cc]onnects/g;
    while ((m = altRe.exec(bodyText)) !== null) {
      bids.push({
        rank:     parseInt(m[1], 10),
        connects: parseInt(m[2].replace(/,/g, ''), 10),
        age:      '',
      });
    }
    return bids;
  }

  // Returns true when the bid competition section is present (even if empty),
  // or when actual bid rows appear.
  function detectBoostSection(text) {
    return /boost\s+your\s+proposal/i.test(text) ||
           (/\d+\s+[Cc]onnects/.test(text) && /(?:1st|2nd|3rd|4th)\s+place/i.test(text));
  }

  // The auction/bid table populates a beat AFTER the rest of the apply form.
  // We must NOT return as soon as any "N Connects" text appears — the balance
  // line "457 Connects available." renders immediately and would make us scrape
  // before the bid rows exist (the original bug: 0 bids detected on jobs that
  // clearly had bids). Wait specifically for the bid-row markers ("1st place",
  // "2nd place", …), then a short settle so all 4 rows are in.
  const BID_ROW_RE = /(?:1st|2nd|3rd|4th)\s+place/i;

  async function waitForBids(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const t = document.body ? document.body.innerText : '';
      if (BID_ROW_RE.test(t)) {
        // Rows appeared — give the table one more tick to fully populate.
        await new Promise(r => setTimeout(r, 900));
        return document.body ? document.body.innerText : t;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    // Timed out — no bid rows (job may genuinely have no competing bids).
    return document.body ? document.body.innerText : '';
  }

  async function run() {
    const startUrl = window.location.href;
    const jobId = jobIdFromUrl(startUrl);
    if (!jobId) return;

    // Wait for the bid rows specifically (see waitForBids) — 15s is plenty for
    // the auction table to load; on a no-bids job it times out and returns [].
    const bodyText = await waitForBids(15000);
    const finalUrl = window.location.href;

    // Detect redirects (SPA navigated away from apply page)
    const onApplyPage = /\/apply\b/i.test(finalUrl) || /\/apply\b/i.test(startUrl);

    console.log('[Falcon Apply] ~' + jobId, '| url:', finalUrl.slice(0, 80),
      '| onApplyPage:', onApplyPage, '| bodyLen:', bodyText.length,
      '| boostSection:', detectBoostSection(bodyText),
      '| bidRows:', BID_ROW_RE.test(bodyText));

    // Send diagnostic back to background regardless of bid result
    const bids = extractBids(bodyText);
    const hasBoostSection = detectBoostSection(bodyText);

    chrome.runtime.sendMessage({
      type: 'BOOST_BIDS',
      job_id: jobId,
      bids,
      scraped_at: new Date().toISOString(),
      _diag: {
        finalUrl: finalUrl.slice(0, 120),
        onApplyPage,
        hasBoostSection,
        bodyLen: bodyText.length,
        // First 300 chars of body for debugging the table format
        bodySnippet: bodyText.slice(0, 300).replace(/\s+/g, ' '),
      },
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Falcon Apply] send error:', chrome.runtime.lastError.message);
        return;
      }
      console.log('[Falcon Apply] result:', response,
        '| bids:', bids.length, '| boost section found:', hasBoostSection);
    });
  }

  run();
})();
