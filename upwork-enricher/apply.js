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

  function extractBids() {
    const body = document.body ? document.body.innerText : '';
    const bids = [];
    // Matches lines like: "1st place   101 Connects   4 hours ago"
    const rowRe = /(\d+)(?:st|nd|rd|th)\s+place\s+([\d,]+)\s+[Cc]onnects\s+([^\n]+)/g;
    let m;
    while ((m = rowRe.exec(body)) !== null) {
      bids.push({
        rank:     parseInt(m[1], 10),
        connects: parseInt(m[2].replace(/,/g, ''), 10),
        age:      m[3].trim(),
      });
    }
    return bids;
  }

  async function waitForBidTable(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const t = document.body ? document.body.innerText : '';
      if (/\d+\s+[Cc]onnects/.test(t) && /(?:1st|2nd|3rd|4th)\s+place/i.test(t)) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async function run() {
    const jobId = jobIdFromUrl(window.location.href);
    if (!jobId) return;

    const ready = await waitForBidTable(12000);
    if (!ready) {
      console.log('[Falcon Apply] Bid table did not appear within 12s');
      return;
    }

    const bids = extractBids();
    if (!bids.length) {
      console.log('[Falcon Apply] No bids found on apply page');
      return;
    }

    console.log('[Falcon Apply] Captured', bids.length, 'bids for ~' + jobId, bids);

    chrome.runtime.sendMessage(
      { type: 'BOOST_BIDS', job_id: jobId, bids, scraped_at: new Date().toISOString() },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Falcon Apply] BOOST_BIDS error:', chrome.runtime.lastError.message);
          return;
        }
        console.log('[Falcon Apply] BOOST_BIDS saved:', response);
      }
    );
  }

  run();
})();
