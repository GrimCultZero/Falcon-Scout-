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

  // Locale-aware. Ahrefs renders "1,234" / "2.3K" (EN) but "1 234" / "2,3K" (UK) — the
  // comma means THOUSANDS in English and DECIMAL in Ukrainian, so it cannot be stripped
  // blindly. Spaces (incl. non-breaking / narrow) are always thousands separators.
  function parseNum(str) {
    if (str == null) return null;
    let s = String(str).trim().replace(/[\s  ]/g, '');
    s = s.replace(/К/g, 'K').replace(/М/g, 'M');   // Cyrillic К/М -> Latin K/M
    if (!s) return null;
    const suf = /([KM])$/i.exec(s);
    if (suf) {
      // Before a K/M suffix a comma is a decimal point ("2,3K" = 2.3K = 2300).
      const v = parseFloat(s.slice(0, -1).replace(/,/g, '.'));
      if (isNaN(v)) return null;
      return Math.round(v * (suf[1].toUpperCase() === 'K' ? 1000 : 1000000));
    }
    // No suffix -> a comma is a thousands separator ("1,234" = 1234).
    const n = parseFloat(s.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function scrape(text) {
    // DR — "DR\n0.7" / "Domain Rating\n0.7" / "Рейтинг домену\n0.7"
    const drM = text.match(/\bDR\b[^0-9]{0,6}([\d.,]+)/i)
              || text.match(/[Dd]omain\s+[Rr]ating[^0-9]{0,12}([\d.,]+)/i)
              || text.match(/Рейтинг\s+домену[^0-9]{0,12}([\d.,]+)/i);
    const dr = drM ? parseFloat(drM[1]) : null;

    // UR
    const urM = text.match(/\bUR\b[^0-9]{0,6}([\d.,]+)/i)
              || text.match(/[Uu][Rr][Ll]\s+[Rr]ating[^0-9]{0,12}([\d.,]+)/i)
              || text.match(/Рейтинг\s+URL[^0-9]{0,12}([\d.,]+)/i);
    const ur = urM ? parseFloat(urM[1]) : null;

    // Organic keywords — "Organic keywords\n1,234" / "Органічні ключові слова\n1 234"
    const okM = text.match(/[Oo]rganic\s+keywords?\s*[\r\n\s↑↓]{0,4}([\d.,   ]+[KКМM]?)/i)
              || text.match(/Органічні?\s+ключов\S*\s+слов\S*\s*[\r\n\s↑↓]{0,4}([\d.,   ]+[KКМM]?)/i);
    const organic_keywords = okM ? parseNum(okM[1]) : null;

    // Organic traffic — "Organic traffic\n↑\n2,300" / "Органічний трафік\n2 300"
    const otM = text.match(/[Oo]rganic\s+traffic\s*[\r\n\s↑↓]{0,8}([\d.,   ]+[KКМM]?)/i)
              || text.match(/Органічн\S*\s+трафік\s*[\r\n\s↑↓]{0,8}([\d.,   ]+[KКМM]?)/i);
    const organic_traffic = otM ? parseNum(otM[1]) : null;

    // Backlinks — "Backlinks\n123" / "Беклінки\n123"
    const blM = text.match(/[Bb]acklinks?\s*[\r\n\s↑↓]{0,6}([\d.,   ]+[KКМM]?)/i)
              || text.match(/Беклінк\S*\s*[\r\n\s↑↓]{0,6}([\d.,   ]+[KКМM]?)/i);
    const backlinks = blM ? parseNum(blM[1]) : null;

    // Ref. domains — "Ref. domains\n45" / "Реферальні домени\n45"
    const rdM = text.match(/[Rr]ef(?:erring)?\.\s*[Dd]omains?\s*[\r\n\s↑↓]{0,6}([\d.,   ]+[KКМM]?)/i)
              || text.match(/[Rr]eferring\s+[Dd]omains?\s*[\r\n\s↑↓]{0,6}([\d.,   ]+[KКМM]?)/i)
              || text.match(/Реферальн\S*\s+домен\S*\s*[\r\n\s↑↓]{0,6}([\d.,   ]+[KКМM]?)/i);
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
        (/\bDR\b/i.test(t) || /Рейтинг\s+домену/i.test(t)) &&
        (/[Oo]rganic\s+keywords?/i.test(t) || /[Oo]rganic\s+traffic/i.test(t) ||
         /Органічн\S*\s+(?:ключов\S*|трафік)/i.test(t))
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
