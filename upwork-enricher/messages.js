// Falcon Scout - Conversation Capture Content Script
// Walks the DOM tree relative to the compose box rather than scanning the whole page.
(function () {
  'use strict';

  function getRoomId() {
    const m = window.location.href.match(/\/rooms\/(?:room[_~])?([A-Za-z0-9_~-]+)/i);
    return m ? m[1] : null;
  }

  // ── Find compose box ─────────────────────────────────────────────────────
  // Diagnostic confirms: one contenteditable DIV near bottom of viewport,
  // no placeholder attribute.  Walk through all contenteditables and pick
  // the one in the lower half of the viewport that is reasonably wide.
  function findComposeBox() {
    const editors = [...document.querySelectorAll('[contenteditable="true"]')];
    const bottom = editors.filter(el => {
      const r = el.getBoundingClientRect();
      return r.top > window.innerHeight * 0.5 && r.width > 200 && r.height < 400;
    });
    if (bottom.length) {
      bottom.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
      return bottom[0];
    }
    return editors[0] || null;
  }

  // ── Find thread container by walking UP from the compose box ─────────────
  // Strategy 1: find the first scrollable ANCESTOR (wraps compose + thread).
  // Strategy 2: at each ancestor level, also check the preceding SIBLING
  //             (thread may sit side-by-side with the compose footer).
  // This avoids scanning the whole DOM and avoids false positives from
  // left/right sidebars.
  function findThreadContainer(compose) {
    if (!compose) return null;

    const isScrollable = el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
             el.scrollHeight > el.clientHeight + 80 &&
             r.width > 250 && r.height > 150;
    };

    let el = compose.parentElement;
    while (el && el !== document.body) {
      // Check preceding siblings first (thread is often a sibling of the compose wrapper)
      let sib = el.previousElementSibling;
      while (sib) {
        if (isScrollable(sib)) {
          console.log('[Cockpit] Thread found as SIBLING:', sib.tagName,
            'h=', sib.scrollHeight, 'rect:', JSON.stringify(_rect(sib)));
          return sib;
        }
        sib = sib.previousElementSibling;
      }
      // Check ancestor itself
      if (isScrollable(el)) {
        console.log('[Cockpit] Thread found as ANCESTOR:', el.tagName,
          'h=', el.scrollHeight, 'rect:', JSON.stringify(_rect(el)));
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function _rect(el) {
    const r = el.getBoundingClientRect();
    return { t: Math.round(r.top), l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // ── Capture the header text that sits ABOVE the thread container ─────────
  // The thread was found as a sibling; the header is another sibling BEFORE it.
  // This is where "Paid Ads Auditor & Performance Analyst" lives.
  function captureHeaderText(thread) {
    if (!thread || !thread.parentElement) return '';
    let text = '';
    for (const child of thread.parentElement.children) {
      if (child === thread) break; // stop when we hit the thread itself
      const t = child.innerText ? child.innerText.trim() : '';
      if (t) text += t + '\n';
    }
    return text;
  }

  // Extract the job title line from the header text.
  // Header lines are typically: ClientName \n time \n JobTitle \n "View proposal"
  function extractJobTitleFromHeader(headerText) {
    if (!headerText) return '';
    const skip = /^(\d+:\d+|view |more |local time|activity|proposal submitted|contract|offer|unread|favorites|^pm\b|^am\b)/i;
    const lines = headerText.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 5 && l.length < 150 && !skip.test(l));
    // lines[0] = client/company name → skip it; lines[1] = job title chip
    return lines.length >= 2 ? lines[1] : '';
  }

  // ── Extract job title from header ────────────────────────────────────────
  function getJobTitle(compose, threadTop) {
    // Specific job page links always have ~ in the URL (e.g. /jobs/~01abc…).
    // Nav links like "Saved jobs" → /jobs/saved — no ~ — so we exclude them.
    const jobLink = document.querySelector(
      'a[href*="/jobs/~"], a[href*="/nx/jobs/~"], a[href*="/ab/jobs/~"]'
    );
    if (jobLink) {
      const t = jobLink.innerText.trim();
      if (t.length > 3 && t.length < 200) return t;
    }

    // Look for the job title chip in the conversation header area.
    // The header sits between the nav bar (≈50px) and the thread top.
    const headerBottom = threadTop || (compose
      ? compose.getBoundingClientRect().top * 0.25
      : window.innerHeight * 0.2);
    const colLeft = compose ? compose.getBoundingClientRect().left - 20 : 200;

    // UI button/nav text patterns to skip
    const UI_TEXT = /^(more|view|see|go|back|next|save|edit|delete|cancel|submit|send|upload|download|open|close|share|copy|settings|options|call options|proposal|profile|report|hire|invite|unread|favorites|messages|find work|deliver work|manage|search|inbox|alerts|local time|pm|am|\d)/i;

    const candidates = [...document.querySelectorAll('span,a,p,div,h1,h2,h3,h4,h5')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        const t = el.innerText.trim();
        return r.top > 50 &&
               r.bottom < headerBottom + 20 &&
               r.left > colLeft &&
               el.children.length < 3 &&      // allow minor nesting
               t.length > 8 &&
               t.length < 150 &&
               !UI_TEXT.test(t) &&
               !/^\d+:\d+/.test(t) &&          // time strings
               !/^[A-Z][a-z]+ \d+ [AP]M/.test(t);  // "8:46 PM local time"
      })
      .map(el => el.innerText.trim())
      .filter(Boolean);

    // Deduplicate while preserving order
    const seen = new Set();
    const unique = candidates.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });

    // First unique text = client name/company, second = job title chip
    if (unique.length >= 2) return unique[1];
    if (unique.length === 1) return unique[0];

    // URL param fallback (gives client name, not ideal but beats empty)
    const m = window.location.search.match(/[?&]pageTitle=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ── Scrape the right sidebar (client info, contract status) ─────────────
  // The sidebar is the right-hand panel: client name, company, contract link.
  //
  // Locating the sidebar by viewport x-position alone was unreliable — Upwork's
  // layout shifts with window width / DPI / whether the right pane is collapsed,
  // so a fixed 72% threshold sometimes missed everything. We now locate it by
  // ANCHOR TEXT first ("Search messages", "Meeting recaps", "Client profile",
  // "View contract", "View proposal") and walk up to a common container — and
  // only fall back to the geometric heuristic if no anchor was found.
  function findRightSidebar() {
    const ANCHOR_TEXTS = [
      /^search\s+messages$/i,
      /^meeting\s+recaps$/i,
      /^client\s+profile$/i,
      /^view\s+contract$/i,
      /^view\s+proposal$/i,
      /^view\s+offer$/i,
      /^activity\s+timeline$/i,
    ];
    const anchors = [];
    for (const el of document.querySelectorAll('a, button, span, h1, h2, h3, h4, div')) {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 60) continue;
      if (ANCHOR_TEXTS.some(re => re.test(t))) anchors.push(el);
    }
    if (!anchors.length) return null;
    // Find the LOWEST COMMON ANCESTOR of every matched anchor. The previous
    // approach (first ancestor containing ≥2 anchors) was wrong: it would
    // return a sub-section of the sidebar (e.g. the "Search messages"
    // accordion) and leave other signals like "View contract" *outside*
    // the returned container — making them invisible to scrapeClientSidebar.
    //
    // Build the ancestor chain of the first anchor, then for every other
    // anchor walk up until we find one of those ancestors; promote the LCA
    // to the highest ancestor reached. The final result contains all
    // anchors by construction.
    const firstChain = [];
    {
      let n = anchors[0];
      while (n && n !== document.body) { firstChain.push(n); n = n.parentElement; }
    }
    const firstIndex = new Map(firstChain.map((n, i) => [n, i]));
    let lcaIdx = 0;
    for (let i = 1; i < anchors.length; i++) {
      let n = anchors[i];
      while (n && !firstIndex.has(n)) n = n.parentElement;
      if (!n) continue;
      lcaIdx = Math.max(lcaIdx, firstIndex.get(n));
    }
    let lca = firstChain[lcaIdx];
    // Walk up once or twice more in case the LCA is unnaturally small — a
    // sidebar is at least ~150×200 in practice.
    for (let i = 0; i < 3 && lca; i++) {
      const r = lca.getBoundingClientRect();
      if (r.width > 150 && r.height > 200) return lca;
      lca = lca.parentElement;
    }
    return null;
  }

  function scrapeClientSidebar() {
    const info = {};
    const sidebar = findRightSidebar();
    // Geometric fallback edge: use sidebar's left edge if we found it, else
    // the old 72%-of-viewport heuristic. This keeps us working on layouts
    // where the sidebar anchors aren't visible yet.
    const rightEdge = sidebar
      ? sidebar.getBoundingClientRect().left - 5
      : window.innerWidth * 0.72;
    console.log('[Cockpit] Sidebar:',
      sidebar ? `found via anchor (left=${Math.round(rightEdge + 5)}, w=${Math.round(sidebar.getBoundingClientRect().width)})`
              : `not found — falling back to x>${Math.round(rightEdge)}`);

    // Restricting the search to the sidebar element (when found) is much more
    // reliable than viewport math.
    const sidebarRoot = sidebar || document;

    // ── Primary source: URL pageTitle param ────────────────────────────────
    // Every messages-room URL carries the canonical client identifier as
    //   ?pageTitle=<Client%20Name>,%20<Company%20Name>
    // This is set by Upwork itself, so it's the most reliable way to get the
    // client name + company. DOM scraping had two failure modes that this
    // sidesteps:
    //   • Picking up the freelancer's own name (e.g. "Artem Yatsuk") from a
    //     profile chip rendered elsewhere in the broader sidebar container
    //     after the LCA fix made it wider.
    //   • Picking up combined "Name, Company" as a single h-tag and then
    //     grabbing an unrelated heading as the company.
    // Sidebar scraping is now only a fallback for the (rare) case where
    // the URL was opened without a pageTitle.
    const ptm = window.location.search.match(/[?&]pageTitle=([^&]+)/);
    if (ptm) {
      const decoded = decodeURIComponent(ptm[1].replace(/\+/g, ' ')).trim();
      const commaIdx = decoded.indexOf(',');
      if (commaIdx > 0) {
        info.client_name    = decoded.slice(0, commaIdx).trim();
        info.client_company = decoded.slice(commaIdx + 1).trim();
      } else {
        info.client_name = decoded;
      }
    }

    // Lifecycle / activity-timeline / UI labels that are NOT a person's name.
    // Without this blacklist the sidebar fallback grabbed "Proposal submitted"
    // (the activity-timeline header) as the client name.
    const _NOT_A_NAME = /^(proposal submitted|contract (offer|offered|accepted|started|starts|paused|ended)|offer acceptance|awaiting offer|view (proposal|contract|offer|details)|activity timeline|search messages|meeting recaps|local time|hired|declined|unread|favorites|messages)\b/i;

    // The pageTitle path can occasionally yield junk too — reject it if so.
    if (info.client_name && _NOT_A_NAME.test(info.client_name)) {
      info.client_name = '';
      info.client_company = '';
    }

    // ── Fallback: scrape from sidebar (only if URL gave us nothing) ────────
    if (!info.client_name) {
      // Prefer the conversation-header recipient name (the prominent name at the
      // top of the message pane, e.g. "Trae Chamma") — more reliable than the
      // sidebar, which mixes in activity-timeline labels.
      const headerName = [...document.querySelectorAll('h1, h2, h3, [class*="name" i], [data-test*="name" i]')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          const t = (el.innerText || '').trim();
          return r.top > 50 && r.top < 160 && r.width > 0 &&
                 t.length > 2 && t.length < 60 &&
                 !_NOT_A_NAME.test(t) && !/^\d/.test(t) &&
                 t !== 'Artem Yatsuk';   // never the freelancer himself
        })
        .map(el => el.innerText.trim());
      if (headerName.length) info.client_name = headerName[0];
    }

    if (!info.client_name) {
      const candidates = [...sidebarRoot.querySelectorAll('strong, h1, h2, h3, h4, [class*="name"], [class*="Name"]')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (!sidebar && r.left <= rightEdge) return false;
          return r.top > 50 && r.top < window.innerHeight * 0.5 && r.width > 0;
        })
        .map(el => el.innerText.trim())
        .filter(t => t.length > 2 && t.length < 80 && !/^\d/.test(t) &&
                     !_NOT_A_NAME.test(t) && t !== 'Artem Yatsuk');

      if (candidates.length)     info.client_name    = candidates[0];
      if (candidates.length > 1) info.client_company = candidates[1];
    }

    // Contract status signals (see comments in original code for the rationale).
    const sidebarSignals = [];
    for (const el of sidebarRoot.querySelectorAll('a, button, span, div')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      // When scoped to the sidebar root the x-gate is unnecessary.
      if (!sidebar && rect.left <= rightEdge) continue;
      // Own-text only (no descendants) so we capture leaf labels, not whole
      // sidebar contents.
      const ownText = [...el.childNodes]
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join(' ')
        .trim();
      if (!ownText || ownText.length > 60) continue;
      const t = ownText.toLowerCase();
      // Strongest first
      if (/active\s+contract/.test(t))                  sidebarSignals.push('Active contract');
      else if (/view\s+contract/.test(t))               sidebarSignals.push('View contract');
      else if (/view\s+offer/.test(t))                  sidebarSignals.push('View offer');
      else if (/^contract\b/.test(t))                   sidebarSignals.push(ownText);
      else if (/^rate(?:\s+increase)?:/.test(t))        sidebarSignals.push(ownText);
      else if (/^limit:\s*\d+\s*hrs?\s*\/\s*week/.test(t)) sidebarSignals.push(ownText);
      else if (/^\$\d[\d,]*(?:\.\d+)?\s*\/\s*hr/.test(t))  sidebarSignals.push(ownText);
    }
    if (sidebarSignals.length) {
      // De-dup while preserving order; cap so we don't bloat the payload.
      info.contract_status = [...new Set(sidebarSignals)].slice(0, 6).join(' · ');
    }

    // ── Wide-net fallback for contract_status ───────────────────────────────
    // The own-text + sidebarRoot loop above misses cases where:
    //   • Upwork wraps "View contract" inside an element type we don't iterate
    //     (e.g. <p>, <label>, role-button), OR
    //   • the sidebar locator returned a container that excludes the contract
    //     link because the anchor-text heuristic didn't catch enough anchors.
    // So: do one more pass over the WHOLE page looking for any element whose
    // innerText (full subtree, trimmed) literally equals one of the strong
    // contract-state strings. This is safe because those strings (e.g. "View
    // contract") only render as visible UI on Upwork when a contract exists.
    if (!info.contract_status) {
      const WIDE_NET = [
        /^view\s+contract$/i,
        /^active\s+contract$/i,
        /^view\s+offer$/i,
        /^contract\s+started$/i,
      ];
      const hit = [...document.querySelectorAll('a, button, span, div, p, label, h1, h2, h3, h4, h5, h6')]
        .find(el => {
          const t = (el.innerText || '').trim();
          if (!t || t.length > 40) return false;
          // Element must be visible (some hidden labels exist for a11y)
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return WIDE_NET.some(re => re.test(t));
        });
      if (hit) {
        info.contract_status = hit.innerText.trim();
        info._contract_status_via = 'wide-net';
        console.log('[Cockpit] Contract status (wide-net):', info.contract_status);
      }
    } else {
      info._contract_status_via = 'sidebar';
    }
    // Surface where we found the sidebar (or didn't) so the debug panel can
    // show it — diagnoses "empty contract" reports without dev-tools console.
    info._sidebar_found = !!sidebar;

    // Job link in sidebar (often a chip at the top of the sidebar)
    const jobLinkEl = document.querySelector(
      'a[href*="/jobs/~"], a[href*="/nx/jobs/~"], a[href*="/ab/jobs/~"]'
    );
    if (jobLinkEl) {
      info.job_url = jobLinkEl.href;
      const jt = jobLinkEl.innerText.trim();
      if (jt.length > 3 && jt.length < 200) info.job_title_from_link = jt;
    }

    // (client_name / client_company are already parsed from the pageTitle URL
    // param at the top of this function — no duplicate pass needed here. The
    // previous second `const ptm = …` declaration here was a duplicate in the
    // same scope, which threw "Identifier 'ptm' has already been declared" and
    // prevented the entire messages.js content script from parsing/loading.)

    // Activity Timeline: "Proposal submitted Feb 20", "Contract offered Feb 23", etc.
    // These appear in the right sidebar regardless of scroll depth.
    const timelineEvents = [];
    const allText = document.body.innerText;
    const timelineMatch = allText.match(/Activity timeline([\s\S]*?)(?:Meeting recaps|Client profile|Search messages|$)/i);
    if (timelineMatch) {
      const lines = timelineMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
      let label = null;
      for (const line of lines) {
        // Lines alternate: event label, then date
        if (/^(Proposal submitted|Contract offered|Contract accepted|Contract started|Contract paused|Contract ended|Hired|Declined)/i.test(line)) {
          label = line;
        } else if (label && /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d/i.test(line)) {
          timelineEvents.push(`${label}: ${line}`);
          label = null;
        }
      }
    }
    if (timelineEvents.length) info.activity_timeline = timelineEvents.join(' | ');

    console.log('[Cockpit] Client sidebar:', JSON.stringify(info));
    return info;
  }

  // ── Wait for content ──────────────────────────────────────────────────────
  async function waitForContent(el, maxMs = 6000) {
    const root = el || document.body;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (root.innerText.split(/\s+/).length > 40) return;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Find every nested scrollable container under `root` ─────────────────
  function findAllScrollables(root) {
    const out = [];
    function walk(el) {
      if (!el || el.nodeType !== 1) return;
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 20) {
        out.push(el);
      }
      for (const c of el.children) walk(c);
    }
    walk(root);
    // Also check parent — sometimes the real scrollable is one level above
    if (root.parentElement) {
      const p = root.parentElement;
      const ps = getComputedStyle(p);
      if ((ps.overflowY === 'auto' || ps.overflowY === 'scroll') &&
          p.scrollHeight > p.clientHeight + 20) {
        out.push(p);
      }
    }
    return out;
  }

  // ── Scroll thread (and every nested scrollable) to top ───────────────────
  // Upwork renders only the visible window of messages and lazy-loads older
  // ones when the container scrolls to the top. The actual scrollable element
  // may not be the one we identified as the "thread container" — so scroll
  // EVERY nested scrollable we can find, and keep looping until none of their
  // scrollHeights grow further.
  async function scrollToStart(thread) {
    if (!thread) return;
    const candidates = findAllScrollables(thread);
    // Always include the thread itself as a candidate
    if (!candidates.includes(thread)) candidates.unshift(thread);
    console.log('[Cockpit] Scrollable candidates:', candidates.length,
      candidates.map(c => `${c.tagName}.${(c.className || '').split(' ')[0]}(h=${c.scrollHeight})`));

    let prevTotal = 0;
    let stable = 0;

    for (let i = 0; i < 15; i++) {
      // Re-discover scrollables each iteration in case new ones appear after content loads
      const all = findAllScrollables(thread);
      if (!all.includes(thread)) all.unshift(thread);

      // Scroll every one to the top
      all.forEach(el => { el.scrollTop = 0; });
      // Also scrollIntoView on the first child as a backup mechanism
      const firstChild = thread.firstElementChild;
      if (firstChild) try { firstChild.scrollIntoView({ block: 'start' }); } catch (e) {}

      await new Promise(r => setTimeout(r, 850));

      const total = all.reduce((sum, el) => sum + el.scrollHeight, 0);
      console.log('[Cockpit] Scroll iter', i + 1,
        '— scrollables:', all.length, 'totalH=', total,
        'thread.scrollTop=', thread.scrollTop);

      if (total === prevTotal) {
        stable++;
        if (stable >= 2) break;
      } else {
        stable = 0;
      }
      prevTotal = total;
    }

    // Final settle for virtual list to render newly loaded DOM nodes
    await new Promise(r => setTimeout(r, 800));
    console.log('[Cockpit] Scroll done, final innerText.len=', thread.innerText.length);
  }

  // ── Find the standalone proposal URL ─────────────────────────────────────
  // Target format: /nx/proposals/2024126331172077569 (19-digit proposal id).
  // The sidebar "View proposal" link points to a workroom modal URL, NOT this,
  // so we must scan the DOM and page HTML for the standalone /nx/proposals/ pattern.
  function findViewDetailsUrl() {
    // 1. Any <a> with a direct /nx/proposals/[id] or /ab/proposals/[id] href
    const directLink = [...document.querySelectorAll('a[href]')].find(a =>
      /\/(nx|ab)\/proposals\/\d{10,}/.test(a.href)
    );
    if (directLink) {
      console.log('[Cockpit] Direct proposal link:', directLink.href);
      return directLink.href;
    }

    // 2. Scan the full page HTML (React state / JSON blobs / etc.) for the path
    const html = document.documentElement.outerHTML;
    const pathMatch = html.match(/\/(nx|ab)\/proposals\/(\d{10,})/);
    if (pathMatch) {
      const url = `https://www.upwork.com${pathMatch[0]}`;
      console.log('[Cockpit] Proposal URL found in HTML:', url);
      return url;
    }

    // 3. Look for a raw proposalId field in JS state
    const idMatch = html.match(/["']proposal[_-]?id["']\s*:\s*["']?(\d{10,})/i);
    if (idMatch) {
      const url = `https://www.upwork.com/nx/proposals/${idMatch[1]}`;
      console.log('[Cockpit] Proposal URL built from id:', url);
      return url;
    }

    // 4. Fallback: "View details" link from the thread (proposal-submission view)
    const vd = [...document.querySelectorAll('a[href]')].find(a =>
      /^view\s+details$/i.test(a.innerText.trim())
    );
    if (vd && vd.href && !vd.href.includes('modal=')) {
      console.log('[Cockpit] View Details URL:', vd.href);
      return vd.href;
    }

    // 5. Last resort: derive from workroom URL — most workroom messages pages
    //    have a corresponding /proposal sibling page with proposal.js coverage
    const wm = window.location.href.match(/(https?:\/\/[^/]+\/(?:nx|ab)\/wm\/workroom\/\d+)/i);
    if (wm) {
      const url = wm[1] + '/proposal';
      console.log('[Cockpit] Derived workroom proposal URL:', url);
      return url;
    }

    console.log('[Cockpit] No proposal URL found');
    return null;
  }

  // ── Main capture ─────────────────────────────────────────────────────────
  async function captureConversation() {
    await new Promise(r => setTimeout(r, 400)); // let SPA settle

    const compose = findComposeBox();
    console.log('[Cockpit] Compose:', compose
      ? `${compose.tagName} top=${Math.round(compose.getBoundingClientRect().top)} left=${Math.round(compose.getBoundingClientRect().left)} w=${Math.round(compose.getBoundingClientRect().width)}`
      : 'NOT FOUND');

    const thread = findThreadContainer(compose);
    console.log('[Cockpit] Thread:', thread
      ? `${thread.tagName} scrollH=${thread.scrollHeight} innerText.len=${thread.innerText.length}`
      : 'NOT FOUND');

    await waitForContent(thread);
    await scrollToStart(thread);

    // Re-acquire after SPA re-render following scroll
    const c2 = findComposeBox();
    const t2 = findThreadContainer(c2) || thread;

    const rawText = t2 ? t2.innerText : document.body.innerText;
    console.log('[Cockpit] Captured text length:', rawText.length, 'lines:', rawText.split('\n').length);

    // Capture header siblings (contain the job title chip — NOT in thread.innerText)
    const headerText = captureHeaderText(t2 || thread);
    console.log('[Cockpit] Header text:', JSON.stringify(headerText.slice(0, 200)));

    // Primary: extract job title from header siblings
    let jobTitle = extractJobTitleFromHeader(headerText);
    console.log('[Cockpit] Title from header:', JSON.stringify(jobTitle));

    // Fallback: DOM traversal approach
    if (!jobTitle) {
      const threadTopPx = (t2 || thread)
        ? (t2 || thread).getBoundingClientRect().top
        : undefined;
      jobTitle = getJobTitle(c2 || compose, threadTopPx);
      console.log('[Cockpit] Title from DOM fallback:', JSON.stringify(jobTitle));
    }

    // Prepend header text so Claude also sees the job title chip
    const fullText = headerText
      ? headerText + '\n\n---\n\n' + rawText
      : rawText;

    const clientInfo = scrapeClientSidebar();

    // Find the proposal URL (standalone /nx/proposals/[id] or workroom /proposal sibling)
    const proposalUrl = findViewDetailsUrl();
    console.log('[Cockpit] >>> Proposal URL to open in background:', proposalUrl || '(none — proposal enrich will be skipped)');

    return {
      room_id:           getRoomId(),
      url:               window.location.href,
      scraped_at:        new Date().toISOString(),
      job_title:         jobTitle || clientInfo.job_title_from_link || '',
      client_name:       clientInfo.client_name || '',
      client_company:    clientInfo.client_company || '',
      contract_status:   clientInfo.contract_status || '',
      activity_timeline: clientInfo.activity_timeline || '',
      job_url:           clientInfo.job_url || '',
      proposal_url:      proposalUrl || '',
      raw_text:          fullText.slice(0, 14000),
      // Debug breadcrumbs — surfaced in the popup's debug panel so we can
      // diagnose "empty contract_status" issues without DevTools.
      _sidebar_found:           clientInfo._sidebar_found,
      _contract_status_via:     clientInfo._contract_status_via || 'none',
    };
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CAPTURE_CONVERSATION_REQUEST') {
      captureConversation()
        .then(d  => sendResponse({ ok: true,  data: d }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });

  console.log('[Cockpit] Conversation capture ready (ancestor-walk mode)');
})();
