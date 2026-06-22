// Falcon Scout — Ahrefs Site Explorer content script
// Opens on https://app.ahrefs.com/site-explorer/* or /v2-site-explorer/*
// Scrapes DR, organic keywords, organic traffic, backlinks, ref. domains.
// Sends AHREFS_DATA to background.js → POST /jobs/{id}/ahrefs

(function () {
  'use strict';

  function domainFromUrl() {
    const p = new URLSearchParams(window.location.search);
    return (p.get('url') || p.get('target') || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  function parseNum(str) {
    if (str == null) return null;
    const s = String(str).trim().replace(/,/g, '');
    if (/^\d+(\.\d+)?K$/i.test(s)) return Math.round(parseFloat(s) * 1000);
    if (/^\d+(\.\d+)?M$/i.test(s)) return Math.round(parseFloat(s) * 1000000);
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function scrape(text) {
    // DR — "DR\n0.7" or "Domain Rating\n0.7" or inline "DR 12"
    const drM = text.match(/\bDR\b[^0-9\n]{0,6}([\d.]+)/i)
              || text.match(/[Dd]omain\s+[Rr]ating[^0-9\n]{0,12}([\d.]+)/i);
    const dr = drM ? parseFloat(drM[1]) : null;

    // UR
    const urM = text.match(/\bUR\b[^0-9\n]{0,6}([\d.]+)/i)
              || text.match(/[Uu][Rr][Ll]\s+[Rr]ating[^0-9\n]{0,12}([\d.]+)/i);
    const ur = urM ? parseFloat(urM[1]) : null;

    // Organic keywords — appears as "Organic keywords\n1,234" or "Organic keywords 0"
    const okM = text.match(/[Oo]rganic\s+keywords?\s*[\r\n\s↑↓]{0,4}([\d,K]+)/i);
    const organic_keywords = okM ? parseNum(okM[1]) : null;

    // Organic traffic — "Organic traffic\n↑\n2,300" or "Organic traffic 0"
    const otM = text.match(/[Oo]rganic\s+traffic\s*[\r\n\s↑↓]{0,8}([\d,K]+)/i);
    const organic_traffic = otM ? parseNum(otM[1]) : null;

    // Backlinks count (first number after "Backlinks")
    const blM = text.match(/[Bb]acklinks?\s*[\r\n\s↑↓]{0,6}([\d,K]+)/i);
    const backlinks = blM ? parseNum(blM[1]) : null;

    // Ref. domains
    const rdM = text.match(/[Rr]ef(?:erring)?\.\s*[Dd]omains?\s*[\r\n\s↑↓]{0,6}([\d,K]+)/i)
              || text.match(/[Rr]eferring\s+[Dd]omains?\s*[\r\n\s↑↓]{0,6}([\d,K]+)/i);
    const ref_domains = rdM ? parseNum(rdM[1]) : null;

    return { dr, ur, organic_keywords, organic_traffic, backlinks, ref_domains };
  }

  function buildSummary(domain, d) {
    const parts = [];
    if (d.dr !== null)               parts.push(`DR ${d.dr}`);
    if (d.organic_keywords !== null) parts.push(`${d.organic_keywords.toLocaleString()} organic kws`);
    if (d.organic_traffic !== null)  parts.push(`~${d.organic_traffic.toLocaleString()} monthly visits`);
    if (d.ref_domains !== null)      parts.push(`${d.ref_domains} ref. domains`);

    const base = domain + (parts.length ? `: ${parts.join(' · ')}` : ': no data scraped');

    let tag = '';
    if (d.dr !== null && d.organic_traffic !== null) {
      if      (d.dr < 5  && d.organic_traffic <   50) tag = 'fresh domain, near-zero SEO presence';
      else if (d.dr < 15 && d.organic_traffic <  500) tag = 'early stage, low organic presence';
      else if (d.dr < 30 && d.organic_traffic < 5000) tag = 'growing site, moderate authority';
      else if (d.dr >= 30)                             tag = 'established authority, solid organic base';
    }

    return tag ? `${base} — ${tag}` : base;
  }

  // Wait until the overview panel has rendered with real metric labels.
  // Ahrefs is a SPA; metrics appear 3-8 s after the shell loads.
  async function waitForMetrics(maxMs) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const t = document.body ? document.body.innerText : '';
      if (
        t.length > 600 &&
        /\bDR\b/i.test(t) &&
        (/[Oo]rganic\s+keywords?/i.test(t) || /[Oo]rganic\s+traffic/i.test(t))
      ) return t;
      await new Promise(r => setTimeout(r, 900));
    }
    return document.body ? document.body.innerText : '';
  }

  async function run() {
    const domain = domainFromUrl();
    if (!domain) return;

    const bodyText = await waitForMetrics(30000);
    const raw = scrape(bodyText);
    const summary = buildSummary(domain, raw);

    console.log('[Falcon Ahrefs]', domain,
      '| DR:', raw.dr, '| kws:', raw.organic_keywords,
      '| traffic:', raw.organic_traffic, '| ref domains:', raw.ref_domains);
    console.log('[Falcon Ahrefs] summary:', summary);

    chrome.runtime.sendMessage({
      type: 'AHREFS_DATA',
      domain,
      summary,
      raw,
      scraped_at: new Date().toISOString(),
    });
  }

  run();
})();
