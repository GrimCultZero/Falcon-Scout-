// Falcon Scout - Proposal Page Scraper
// Runs on /ab/proposals/*, /nx/proposals/*, /nx/wm/workroom/*/proposal pages.
// Scrapes the full proposal: cover letter, client profile, competition, job description.
// Sends results back to background.js, which merges them into the existing KB entry
// (matched by room_id stored when the tab was opened).

(function () {
  'use strict';

  // Version stamp — bump alongside manifest. Lets us confirm at a glance which
  // build is actually running (the loaded extension has repeatedly lagged the
  // edited source). Visible in the proposals-tab console on load.
  const FALCON_PROPOSAL_JS_VERSION = '2.9';
  console.log('[Cockpit Proposal] proposal.js loaded — build', FALCON_PROPOSAL_JS_VERSION, '@', window.location.pathname);

  // ── Wait for the page to render ────────────────────────────────────────
  async function waitForContent(maxMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const body = document.body.innerText;
      // Heuristic: proposal page usually contains "Cover letter" or "Your proposal" or similar
      if (/cover\s+letter|your\s+proposal|client'?s?\s+history|payment\s+(method\s+)?verified|proposal\s+details|about\s+the\s+client/i.test(body)) {
        return;
      }
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // ── Click all "more" / "Show more" / "Read more" buttons to expand text ─
  async function expandAllShowMore() {
    let totalClicked = 0;
    // Repeat up to 5 times in case clicking one reveals another
    for (let pass = 0; pass < 5; pass++) {
      // Cast a wider net. Upwork's inline "more" link inside a job
      // description paragraph is often a <span> or <button> without
      // role="button", styled with cursor:pointer in CSS. Match many tag
      // types but require the element's OWN text (not descendants') to be
      // exactly one of the toggle phrases — that filters out a parent
      // element whose innerText happens to end with "...more" because of
      // a deeply nested toggle.
      const candidates = [...document.querySelectorAll(
        'button, a, span, div[role="button"], [class*="more" i], [aria-expanded]'
      )].filter(el => {
        // Use innerText (rendered text, ignores hidden) and trim
        const t = (el.innerText || '').trim().toLowerCase();
        if (!t || t.length > 35) return false;
        // Accept short, toggle-shaped phrases
        const looksLikeToggle = (
          t === 'more' || t === 'show more' || t === 'see more' ||
          t === 'read more' || t === 'view more' || t === '... more' ||
          t === '…more' || t === '… more' ||
          /^(show|see|view|read)\s+more\b/.test(t) ||
          /^more\s*(about|details|info)?$/.test(t) ||
          /^expand\b/.test(t)
        );
        if (!looksLikeToggle) return false;
        // Avoid clicking a wrapper whose text matches just because of a
        // single nested "more" child. Prefer leaves or short elements.
        const childTextLen = [...el.children].reduce((sum, c) => sum + (c.innerText || '').length, 0);
        const ownTextLen = (el.innerText || '').length - childTextLen;
        return el.children.length === 0 || ownTextLen <= 35;
      });
      if (!candidates.length) break;
      for (const btn of candidates) {
        try { btn.click(); totalClicked++; } catch (e) {}
        await new Promise(r => setTimeout(r, 300));
      }
    }
    // Also try clicking elements with aria-expanded="false" — covers any
    // toggle whose visible text isn't a clear match but is semantically
    // collapsed. CAREFUL: Upwork's page-wide nav, account menu, hamburger,
    // notifications drawer all have aria-expanded="false" too. Clicking them
    // pops the global navigation drawer (user-visible regression — appeared
    // as a leftside Upwork menu sticking around after every page load).
    // Filter rules:
    //   - Skip if any ancestor is nav/header/aside or has a navigation/banner/
    //     complementary role
    //   - Skip if the element's text or aria-label matches known nav verbs
    //     (Find work, Deliver work, Messages, Notifications, Help, Account,
    //     menu, profile, etc.)
    const NAV_TEXT_RE = /^(menu|find\s+work|deliver\s+work|manage\s+finances|messages|notifications|help|profile|account|chat\s+with|navigation|search)\b/i;
    function isInsideNav(el) {
      let cur = el.parentElement;
      for (let i = 0; i < 12 && cur; i++) {
        const tag = (cur.tagName || '').toLowerCase();
        const role = cur.getAttribute && cur.getAttribute('role');
        if (tag === 'nav' || tag === 'header' || tag === 'aside') return true;
        if (role === 'navigation' || role === 'banner' || role === 'complementary' || role === 'menubar') return true;
        cur = cur.parentElement;
      }
      return false;
    }
    const ariaToggles = [...document.querySelectorAll('[aria-expanded="false"]')]
      .filter(el => {
        const txt = (el.innerText || '').trim();
        if (txt.length === 0 || txt.length > 100) return false;
        if (NAV_TEXT_RE.test(txt)) return false;
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (aria && NAV_TEXT_RE.test(aria)) return false;
        if (isInsideNav(el)) return false;
        return true;
      });
    for (const el of ariaToggles.slice(0, 10)) {
      try { el.click(); totalClicked++; } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }
    console.log('[Cockpit Proposal] Expanded', totalClicked, '"more" toggles');
    if (totalClicked) await new Promise(r => setTimeout(r, 700));
  }

  // ── Clean up a captured cover letter — strip trailing junk that ends up
  // included when the regex terminator doesn't fire. Common offenders on the
  // /nx/proposals/{id} confirmation page: attached file rows, "Profile
  // highlights" section, "Edit proposal" / "Withdraw proposal" buttons.
  function cleanCoverLetter(text) {
    if (!text) return text;
    let t = text;
    // Cut at known trailing-section markers (whichever comes first)
    const cutMarkers = [
      /\nprofile\s+highlights\b/i,
      /\nthese\s+are\s+items\s+from/i,
      /\nedit\s+proposal\b/i,
      /\nwithdraw\s+proposal\b/i,
      /\nedit\s+any\s+detail\b/i,
      /\nattachments?\b/i,
      /\nanswers\s+to\s+(?:additional\s+)?questions/i,
      /\nview\s+job\s+posting\b/i,
      /\n\s*[A-Za-z0-9_\-\s]+\.pdf\s*\(\s*[\d.]+\s*[KMG]?B\s*\)/i, // PDF attachment row
      /\nportfolio\b/i,
    ];
    for (const re of cutMarkers) {
      const m = t.match(re);
      if (m && m.index < t.length) t = t.slice(0, m.index);
    }
    // Truncate AFTER the sign-off ("Artem" alone on a line). Anything that
    // follows is appended UI content, not part of the letter.
    const signOff = t.match(/\n\s*(artem|artyom)\s*\n/i);
    if (signOff) {
      t = t.slice(0, signOff.index + signOff[0].length).replace(/\s+$/, '');
    }
    return t.trim();
  }

  // ── Extract proposal data ──────────────────────────────────────────────
  function extractProposalData() {
    const body = document.body.innerText;
    const data = { url: window.location.href };

    // Cover letter — the "Cover letter" section text
    // Looking for: "Cover letter\n<text>\nAttachments" or similar boundary.
    // The terminator list catches most cases, and `cleanCoverLetter` mops up
    // anything that slipped through (Profile highlights, PDF rows, Edit
    // proposal / Withdraw proposal buttons, etc.).
    const coverMatch = body.match(/cover\s+letter\s*\n([\s\S]*?)(?=\n(?:attachments?|answers\s+to\s+(?:additional\s+)?questions|client'?s?|about\s+the\s+client|terms|bid\s+|your\s+rate|view\s+job\s+posting|profile\s+highlights|edit\s+proposal|withdraw\s+proposal|edit\s+any\s+detail|portfolio|these\s+are\s+items\s+from|$))/i);
    if (coverMatch) data.cover_letter = cleanCoverLetter(coverMatch[1]);

    // Upwork job ID (~XXX) for THIS proposal's job. The page contains many
    // `~ID` strings: notifications about OTHER invites, freelancer profiles,
    // agency IDs, etc. We can't just grab the first one we see — we need
    // the ID that belongs to the CURRENT proposal context.
    //
    // The most reliable anchors are the proposal-page's own action buttons:
    // "View job posting", "Edit proposal", "Withdraw proposal". These ONLY
    // ever point to the current proposal's job, never to notifications.
    {
      let foundId = null;
      // 1) Anchors whose visible text is one of the proposal action buttons
      //    — these guarantee context, not a notification badge link.
      const ACTION_TEXTS = new Set([
        'view job posting', 'view posting', 'view this job',
        'edit proposal', 'withdraw proposal', 'edit your bid',
      ]);
      const actionAnchors = [...document.querySelectorAll('a, button')]
        .filter(el => ACTION_TEXTS.has((el.innerText || '').trim().toLowerCase()));
      for (const el of actionAnchors) {
        const href = el.getAttribute('href') || el.getAttribute('data-href') || '';
        const m = href.match(/~([0-9a-f]{16,})/i);
        if (m) { foundId = m[1]; break; }
      }
      // 2) data-* attributes on container elements
      if (!foundId) {
        const dataEls = document.querySelectorAll(
          '[data-job-id], [data-jobid], [data-cipher-id], [data-job-uid]'
        );
        for (const el of dataEls) {
          const v = el.getAttribute('data-job-id') || el.getAttribute('data-jobid')
                  || el.getAttribute('data-cipher-id') || el.getAttribute('data-job-uid');
          const m = (v || '').match(/~?([0-9a-f]{16,})/i);
          if (m) { foundId = m[1]; break; }
        }
      }
      // 3) Job-link anchors generally — but skip anchors inside known
      //    notification / sidebar containers, which often link to OTHER
      //    jobs the user got invited to.
      if (!foundId) {
        const _NOISE_CONTAINER_SELECTORS = [
          '[class*="notification" i]',
          '[class*="Notification" i]',
          '[aria-label*="notification" i]',
          '[role="banner"]',
          '[class*="header" i]',
          '[class*="Header" i]',
          '[class*="navbar" i]',
        ];
        const noiseContainers = document.querySelectorAll(_NOISE_CONTAINER_SELECTORS.join(','));
        const isInsideNoise = (el) => {
          for (const noise of noiseContainers) {
            if (noise.contains(el)) return true;
          }
          return false;
        };
        const jobAnchors = document.querySelectorAll(
          'a[href*="/jobs/~"], a[href*="/nx/proposals/job/~"], a[href*="/proposals/job/~"]'
        );
        for (const a of jobAnchors) {
          if (isInsideNoise(a)) continue;
          const m = (a.getAttribute('href') || '').match(/~([0-9a-f]{16,})/i);
          if (m) { foundId = m[1]; break; }
        }
      }
      if (foundId) data.upwork_job_id = foundId;
      try {
        console.log('[Cockpit Proposal] upwork_job_id extraction →', foundId || '(none found)',
          foundId ? `(${foundId.length} chars, from action anchor / data-attr / non-noise job link)` : '');
      } catch {}
    }

    // Full job description — try multiple heading variants Upwork uses on
    // the proposal-details page, and fall back to a DOM-based search if the
    // text regex misses (Upwork's section headings sometimes don't appear in
    // innerText with the structure the regex expects).
    let jobDescription = '';
    // Added "Job details" — Upwork's invite-flow proposal-success page uses
    // that heading for the original posting block.
    const headingRe = /(?:^|\n)(?:job\s+description|about\s+the\s+job|description|project\s+(?:overview|description)|summary|overview|job\s+details)\s*\n([\s\S]{60,}?)(?=\n(?:skills\s+(?:and|&)\s+expertise|mandatory\s+skills|preferred\s+qualifications|category|posted|client'?s?\s+recent\s+history|about\s+the\s+client|activity\s+on\s+this\s+job|additional\s+questions|view\s+job\s+posting|edit\s+proposal|withdraw\s+proposal|skills\s+and\s+expertise|$))/i;
    const jobMatch = body.match(headingRe);
    if (jobMatch) jobDescription = jobMatch[1].trim();
    // DOM fallback: walk any heading element whose text matches the variants
    // above and read substantive text from its next sibling(s).
    if (!jobDescription) {
      const headings = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const h of headings) {
        const label = (h.innerText || '').trim().toLowerCase();
        if (!/^(job\s+description|about\s+the\s+job|description|project\s+(overview|description)|summary|overview|job\s+details)$/.test(label)) continue;
        let sib = h.nextElementSibling;
        let buf = '';
        for (let i = 0; i < 8 && sib; i++) {
          const t = (sib.innerText || '').trim();
          // Stop at the next heading-like section
          if (/^(skills|client|about|activity|preferred|mandatory|category|posted|additional|hiring|average)/i.test(t.split('\n')[0] || '')) break;
          if (t.length > 30) buf += (buf ? '\n\n' : '') + t;
          sib = sib.nextElementSibling;
        }
        if (buf.length > 80) { jobDescription = buf; break; }
      }
    }
    if (jobDescription) data.job_description = jobDescription;

    // Competition / activity
    const proposalsMatch = body.match(/proposals:\s*\n?\s*([^\n]{2,40})/i);
    if (proposalsMatch) data.proposals_count = proposalsMatch[1].trim();

    const interviewMatch = body.match(/interviewing:\s*\n?\s*(\d+)/i);
    if (interviewMatch) data.interviewing = parseInt(interviewMatch[1]);

    const invitesMatch = body.match(/invites\s+sent:\s*\n?\s*(\d+)/i);
    if (invitesMatch) data.invites_sent = parseInt(invitesMatch[1]);

    const unansweredMatch = body.match(/unanswered\s+invites:\s*\n?\s*(\d+)/i);
    if (unansweredMatch) data.unanswered_invites = parseInt(unansweredMatch[1]);

    const lastViewedMatch = body.match(/last\s+viewed\s+by\s+client:\s*\n?\s*([^\n]+)/i);
    if (lastViewedMatch) data.last_viewed = lastViewedMatch[1].trim();

    // Bid range
    const bidMatch = body.match(/high\s*\n\$([\d.,]+)\s*\navg(?:erage)?\s*\n\$([\d.,]+)\s*\nlow\s*\n\$([\d.,]+)/i);
    if (bidMatch) {
      data.bid_high = bidMatch[1];
      data.bid_avg  = bidMatch[2];
      data.bid_low  = bidMatch[3];
    }

    // ── Client profile (right sidebar) ────────────────────────────────
    data.payment_verified = /payment\s+(?:method\s+)?verified/i.test(body);
    data.phone_verified   = /phone\s+(?:number\s+)?verified/i.test(body);

    const ratingMatch = body.match(/([\d.]+)\s+of\s+(\d+)\s+reviews?/i);
    if (ratingMatch) {
      data.client_rating  = parseFloat(ratingMatch[1]);
      data.client_reviews = parseInt(ratingMatch[2]);
    }

    const hireRateMatch = body.match(/(\d+)%\s+hire\s+rate/i);
    if (hireRateMatch) data.hire_rate = parseInt(hireRateMatch[1]);

    const jobsMatch = body.match(/(\d+)\s+jobs?\s+posted/i);
    if (jobsMatch) data.client_jobs_posted = parseInt(jobsMatch[1]);

    const openMatch = body.match(/(\d+)\s+open\s+jobs?/i);
    if (openMatch) data.client_jobs_open = parseInt(openMatch[1]);

    const spentMatch = body.match(/\$([\d,.]+[KkMm]?)\s+total\s+spent/i);
    if (spentMatch) data.client_total_spent = '$' + spentMatch[1];

    const hiresMatch = body.match(/(\d+)\s+hires?,?\s*(\d+)\s+active/i);
    if (hiresMatch) {
      data.client_hires  = parseInt(hiresMatch[1]);
      data.client_active = parseInt(hiresMatch[2]);
    }

    const avgRateMatch = body.match(/\$([\d.]+)\s*\/hr\s+avg\s+hourly\s+rate\s+paid/i);
    if (avgRateMatch) data.client_avg_hourly_rate = parseFloat(avgRateMatch[1]);

    const hoursMatch = body.match(/avg\s+hourly\s+rate\s+paid\s*\n?([\d,]+(?:\.\d+)?)\s+hours?\b/i);
    if (hoursMatch) data.client_hours_billed = Math.round(parseFloat(hoursMatch[1].replace(',', '')));

    const memberMatch = body.match(/member\s+since\s+([A-Za-z]+\s+\d+,?\s*\d{4})/i);
    if (memberMatch) data.client_member_since = memberMatch[1];

    const sizeMatch = body.match(/(Freelancer|Small company|Mid-size company|Large company|Enterprise)\s*\(([^)]+)\)/i);
    if (sizeMatch) data.client_company_size = sizeMatch[0];

    const locationMatch = body.match(/\n([A-Za-z\s,]+)\n\d{1,2}:\d{2}\s+[AP]M\s+local\s+time/i);
    if (locationMatch) data.client_location = locationMatch[1].trim();

    // Connects boost bid only — "Your bid is set to N Connects"
    // We do NOT attempt to extract the dollar rate from the confirmation page
    // because the page contains too many dollar amounts (job rate, profile rate,
    // fees, etc.) and we can't reliably distinguish Artem's actual bid.
    // Dollar bids are captured at submit time from the application form (stash).
    // Connects bid — this IS the Upwork bid. Surface as both boost_connects
    // (metadata) and my_bid/bid_currency so the backend records it correctly.
    const connectsMatch = body.match(/your\s+bid\s+is\s+set\s+to\s+(\d+)\s+connects?/i);
    if (connectsMatch) {
      data.boost_connects  = parseInt(connectsMatch[1]);
      data.my_bid          = String(data.boost_connects);
      data.bid_currency    = 'Connects';
    }

    return data;
  }

  // ── Send result back to background, which will merge into the KB entry ─
  async function run() {
    try {
      await waitForContent();
      // Extra wait to let the sidebar fully render
      await new Promise(r => setTimeout(r, 1200));
      // Expand any truncated sections ("more" buttons on job description, etc.)
      await expandAllShowMore();

      const data = extractProposalData();
      console.log('[Cockpit Proposal] Extracted:', data);

      chrome.runtime.sendMessage(
        { type: 'PROPOSAL_ENRICHED', data, url: window.location.href },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Cockpit Proposal] Message error:', chrome.runtime.lastError.message);
            return;
          }
          console.log('[Cockpit Proposal] Sent to background:', response);
        }
      );
    } catch (err) {
      console.error('[Cockpit Proposal] Error:', err);
    }
  }

  // ── Listen for manual capture requests from the popup ───────────────────
  // (When the user opens the popup while on a /nx/proposals/* page directly,
  // not as a background tab opened by messages.js.)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CAPTURE_PROPOSAL_REQUEST') {
      (async () => {
        try {
          await waitForContent();
          await new Promise(r => setTimeout(r, 600));
          await expandAllShowMore();

          // Job title — the /nx/proposals/{id} confirmation page has h1 set to
          // "Proposal details", NOT the actual job title. The real title lives
          // on a job-link anchor, but Upwork also renders "View job posting" /
          // "Edit proposal" / etc. as anchors to /jobs/~ID, so the first
          // matching anchor is often UI chrome rather than the actual title.
          // We iterate through ALL job-pointing anchors and pick the first
          // one whose text passes the plausibility check.
          let jobTitle = '';
          const GENERIC_TITLE_RE = /^(proposal\s+details|cover\s+letter|your\s+(bid|proposal)|profile\s+highlights|edit\s+proposal|withdraw\s+proposal|view\s+job\s+posting|view\s+posting|see\s+(the\s+)?(job|posting)|back\s+to\s+(job|posting)|job\s+posting|posting|application|submitted|sent|client'?s?\s+job\s+posting|insights(?:\s+new)?|new|hiring\s+activity|job\s+details|client(?:'?s)?\s+history|skills\s+and\s+expertise|average\s+bid\s+amounts?|activity\s+on\s+this\s+job|freelancer(?:\s+plus(?:\s+new)?)?|plus(?:\s+new)?|premium|enterprise|business\s+plus|connects?|boost|boosted)$/i;
          const isPlausibleTitle = (s) => {
            if (!s) return false;
            const t = s.trim();
            if (t.length < 5 || t.length > 200) return false;
            // Reject obvious notification badges:
            // "New job: ...", strings ending with a clock time "12:53 PM",
            // anything that contains "New job:" inline.
            if (/^new\s+job\s*:/i.test(t)) return false;
            if (/\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(t)) return false;
            // Reject Upwork section/chart headings (insights panel, etc.)
            if (/^average\s+(applicant|bid|proposal)/i.test(t)) return false;
            if (/^(total|all)\s+proposals?$/i.test(t)) return false;
            if (/^hiring\s+(activity|rate|status)/i.test(t)) return false;
            if (/^client\s+(history|preferences)/i.test(t)) return false;
            return !GENERIC_TITLE_RE.test(t);
          };

          // Detect notification / header containers so we can skip elements
          // inside them (they show OTHER jobs the user got invited to, not
          // the current proposal's job).
          const _NOISE_CONTAINERS = document.querySelectorAll([
            '[class*="notification" i]',
            '[class*="Notification" i]',
            '[aria-label*="notification" i]',
            '[role="banner"]',
            '[class*="header" i]',
            '[class*="Header" i]',
            '[class*="navbar" i]',
          ].join(','));
          const _isInsideNoise = (el) => {
            for (const noise of _NOISE_CONTAINERS) {
              if (noise.contains(el)) return true;
            }
            return false;
          };

          // 1. PRIMARY: find the "Job details" / "Job description" heading,
          //    then take the next substantial text/heading element after it
          //    in document order. On Upwork's invite-flow proposal-success
          //    page the layout is:
          //      <h2>Job details</h2>
          //      <h?>Digital Marketing - Google Ads, …</h?>   ← the title
          //      Category / date row, then description.
          //    This is FAR more reliable than scanning random headings.
          const _JOB_SECTION_HEADING_RE = /^(job\s+details|job\s+description|about\s+the\s+job)$/i;
          const _allHeadings = document.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
          let _jobDetailsHeading = null;
          for (const h of _allHeadings) {
            if (_isInsideNoise(h)) continue;
            if (_JOB_SECTION_HEADING_RE.test((h.innerText || '').trim())) {
              _jobDetailsHeading = h;
              break;
            }
          }
          if (_jobDetailsHeading) {
            // Walk forward in document order looking at headings and other
            // substantial-text elements (p, div, span). The first one whose
            // text passes isPlausibleTitle is the job title.
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_ELEMENT,
              {
                acceptNode(el) {
                  if (!_jobDetailsHeading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
                    return NodeFilter.FILTER_SKIP;
                  }
                  return NodeFilter.FILTER_ACCEPT;
                },
              }
            );
            // Compare document position to start from the element after our heading
            const tagsToCheck = ['H1', 'H2', 'H3', 'H4', 'H5'];
            let checked = 0;
            for (const el of document.body.querySelectorAll('h1, h2, h3, h4, h5, p, div, span')) {
              const pos = _jobDetailsHeading.compareDocumentPosition(el);
              if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue; // before or equal
              if (_isInsideNoise(el)) continue;
              if (checked++ > 50) break; // safety cap on traversal
              const t = (el.innerText || '').trim();
              if (!t || t.length < 5) continue;
              // Skip the date/category row that's right under the title
              if (/posted\s+\w+\s+\d/i.test(t)) continue;
              if (/^(social\s+media\s+marketing|seo|design|writing|web\s+development)$/i.test(t)) continue;
              if (isPlausibleTitle(t)) {
                jobTitle = t.split('\n')[0].trim();  // take just the first line
                break;
              }
            }
          }
          // 2. Job-pointing anchors NOT inside notification containers
          if (!jobTitle) {
            const jobAnchors = document.querySelectorAll(
              'a[href*="/jobs/~"], a[href*="/proposals/job/~"], a[href*="/nx/proposals/job/~"]'
            );
            for (const a of jobAnchors) {
              if (_isInsideNoise(a)) continue;
              const t = (a.innerText || '').trim();
              if (isPlausibleTitle(t)) { jobTitle = t; break; }
            }
          }
          // 3. Any h1/h2/h3 whose text isn't generic page chrome and isn't
          //    inside a notification container
          if (!jobTitle) {
            for (const h of document.querySelectorAll('h1, h2, h3, [class*="job-title" i], [class*="JobTitle" i]')) {
              if (_isInsideNoise(h)) continue;
              const t = (h.innerText || '').trim();
              if (isPlausibleTitle(t)) { jobTitle = t; break; }
            }
          }
          // 4. Document title fallback
          if (!jobTitle) {
            const t = document.title.split(' | ')[0].split(' - ')[0].trim();
            if (isPlausibleTitle(t)) jobTitle = t;
          }
          // Diagnostic log so we can see what's being rejected when the title
          // still ends up empty / wrong on a real page
          if (!jobTitle) {
            const candidates = [
              ...Array.from(jobAnchors).slice(0, 5).map(a => `anchor: "${(a.innerText || '').trim().slice(0, 80)}"`),
              ...Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 5).map(h => `${h.tagName}: "${(h.innerText || '').trim().slice(0, 80)}"`),
              `document.title: "${document.title}"`,
            ];
            console.warn('[Cockpit Proposal] Could not find job title. Candidates:', candidates);
          }

          const data = extractProposalData();
          data.job_title = jobTitle;
          data.url       = window.location.href;
          console.log('[Cockpit Proposal] Manual capture data:', data);
          sendResponse({ ok: true, data });
        } catch (err) {
          console.error('[Cockpit Proposal] Manual capture error:', err);
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true; // async response
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AUTO-CAPTURE FLOW (Chunk 1 / DESIGN §13)
  //
  // Step 1: On the application form (/nx/proposals/job/~JOB_ID), hook the
  //   Submit button. When the user clicks it, stash a single global record
  //   { job_id, job_url, job_title, timestamp } under `falcon_last_submit`.
  //
  // Step 2: After submit, Upwork redirects to a confirmation page — either
  //   the proposals list (/nx/proposals/) or a specific submitted proposal
  //   (/nx/proposals/[numeric_id]). Both have proposal.js loaded. On load,
  //   we check the stash; if it's < 60s old, we treat this as the post-submit
  //   redirect, extract bid + cover letter from the page, and record to the
  //   backend.
  //
  // Why this design: the proposals list URL has no ~JOB_ID, and individual
  // submitted-proposal URLs use a numeric ID, not the Upwork job ID. So we
  // can't recover the source job from the URL alone — we have to carry it
  // forward in storage from the application form.
  // ──────────────────────────────────────────────────────────────────────────

  const _STASH_KEY = 'falcon_last_submit';
  const _STASH_TTL_MS = 60_000;

  function isApplicationFormUrl() {
    // /nx/proposals/job/~JOB_ID  — the actual form with the Submit button
    return /\/nx\/proposals\/job\/~[0-9a-f]{16,}/i.test(window.location.pathname);
  }

  function isPostSubmitUrl() {
    // Confirmation surfaces: bare list OR specific submitted proposal
    const p = window.location.pathname;
    return /^\/nx\/proposals\/?$/.test(p) || /^\/nx\/proposals\/\d+\/?$/.test(p);
  }

  function extractJobIdFromUrl(url) {
    const m = (url || '').match(/~([0-9a-f]{16,})/i);
    return m ? m[1] : null;
  }

  // ── Step 1: hook Submit button on the application form ────────────────────
  function setupSubmitListener() {
    if (window.__falconSubmitHooked) return;
    if (!isApplicationFormUrl()) return;

    document.addEventListener('click', (e) => {
      let el = e.target;
      let depth = 0;
      while (el && depth < 8) {
        const tag = el.tagName;
        const isClickable = tag === 'BUTTON' || el.getAttribute('role') === 'button' || tag === 'A';
        if (isClickable) {
          const text = (el.innerText || el.textContent || '').trim();
          // Match Upwork's submit-button text in all its variants:
          //   "Submit"
          //   "Send"
          //   "Submit a proposal" / "Submit proposal"
          //   "Send proposal"
          //   "Send for 17 Connects" / "Submit for 17 Connects" (boost flow — most common in 2026)
          //   "Submit a proposal for 17 Connects"
          // Excludes: "Save as draft", "Cancel", "Send message", etc.
          if (/^(submit|send)(\s+(?:a\s+)?proposal)?(\s+for\s+\d+\s+connects?)?\s*$/i.test(text)) {
            // The bid IS the Connects count from the submit button text.
            // "Submit for 17 Connects" → bid = 17 Connects.
            // This is the canonical Upwork bid — not the hourly rate.
            let bidAmount = null, bidCurrency = 'Connects';
            try {
              const connectsInButton = text.match(/for\s+(\d+)\s+connects?/i);
              if (connectsInButton) {
                bidAmount = connectsInButton[1];
              }
              // Fallback: scan page text for the boost bid amount
              if (!bidAmount) {
                const m = (document.body.innerText || '').match(/your\s+bid\s+is\s+set\s+to\s+(\d+)\s+connects?/i)
                       || (document.body.innerText || '').match(/boost.*?(\d+)\s+connects?/i);
                if (m) bidAmount = m[1];
              }
            } catch {}

            const stash = {
              job_id: extractJobIdFromUrl(window.location.href),
              job_url: window.location.href,
              job_title: (document.title || '').split(' | ')[0].trim(),
              timestamp: new Date().toISOString(),
              bid_amount: bidAmount,
              bid_currency: bidCurrency,
            };
            chrome.storage.local.set({ [_STASH_KEY]: stash }, () => {
              console.log('[Cockpit Proposal] Stashed submit:', stash);
            });
            break;
          }
        }
        el = el.parentElement;
        depth++;
      }
    }, true); // capture phase — fires before the page navigates

    window.__falconSubmitHooked = true;
    console.log('[Cockpit Proposal] Submit listener active on application form');
  }

  // ── Step 2: capture on post-submit redirect ───────────────────────────────
  async function handlePostSubmitCapture() {
    if (!isPostSubmitUrl()) return;

    const stored = await new Promise(r => chrome.storage.local.get([_STASH_KEY], r));
    const stash = stored[_STASH_KEY];
    if (!stash || !stash.timestamp) {
      console.log('[Cockpit Proposal] No submit stash, skipping');
      return;
    }

    const stashAge = Date.now() - new Date(stash.timestamp).getTime();
    if (stashAge > _STASH_TTL_MS) {
      console.log('[Cockpit Proposal] Submit stash too old, skipping');
      return;
    }
    if (!stash.job_id) {
      console.log('[Cockpit Proposal] Submit stash missing job_id, skipping');
      return;
    }

    // Wait for page render so DOM/text scraping works
    await waitForContent(8000);
    await new Promise(r => setTimeout(r, 600));

    // Prefer the bid captured from the form at submit time (stash.bid_amount).
    // Fall back to scraping the confirmation page only if the stash had nothing.
    let bidAmount   = stash.bid_amount   || null;
    let bidCurrency = stash.bid_currency || 'USD';
    if (!bidAmount) {
      const bidData = extractOwnBid();
      bidAmount   = bidData.amount   || null;
      bidCurrency = bidData.currency || 'USD';
    }
    if (!bidAmount) {
      console.log('[Cockpit Proposal] Bid not found in stash or page — recording without bid amount');
    }

    const coverLetter = extractOwnCoverLetter();

    const payload = {
      upwork_job_id: stash.job_id,
      bid_amount:    bidAmount,
      bid_currency:  bidCurrency,
      submitted_at:  stash.timestamp,
      sent_text:     coverLetter || null,
    };

    console.log('[Cockpit Proposal] Capturing submission:', payload);

    chrome.runtime.sendMessage({ type: 'PROPOSAL_SUBMITTED', data: payload }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Cockpit Proposal] Message error:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.ok) {
        console.log('[Cockpit Proposal] ✅ Recorded');
        chrome.storage.local.remove([_STASH_KEY]);
      } else {
        console.error('[Cockpit Proposal] Backend rejected:', response && response.error);
      }
    });
  }

  // Extract Artem's own bid. The standalone proposal page typically labels it
  // with "Your bid" / "Bid" / "You'll receive" / "Total amount" etc.
  // We try several patterns ordered from most specific to least.
  function extractOwnBid() {
    const body = document.body.innerText || '';
    // Order matters — most specific labels first
    const patterns = [
      /(?:Total\s+(?:bid|amount)|Your\s+bid|Bid\s+amount|You\s+will\s+receive|You'?ll\s+receive|Hourly\s+rate)[^$\n]{0,30}\$([\d,]+(?:\.\d+)?)\s*(USD|EUR|GBP|CAD|AUD|INR)?/i,
      /(?:^|\n)\s*Bid\s*\n?\$([\d,]+(?:\.\d+)?)\s*(USD|EUR|GBP|CAD|AUD|INR)?/im,
      /\$([\d,]+(?:\.\d+)?)\s*(USD|EUR|GBP|CAD|AUD|INR)\b/i,
    ];
    for (const pat of patterns) {
      const m = body.match(pat);
      if (m) {
        return {
          amount: m[1].replace(/,/g, ''),
          currency: (m[2] || 'USD').toUpperCase(),
        };
      }
    }
    return { amount: null, currency: null };
  }

  function extractOwnCoverLetter() {
    const body = document.body.innerText || '';
    // Cover letter is bracketed by a "Cover letter" heading and a following
    // heading like "Attachments" / "Answers" / "Bid" / "Job details"
    const m = body.match(/cover\s+letter\s*\n([\s\S]*?)(?=\n(?:attachments|answers\s+to\s+(?:additional\s+)?questions|bid|job\s+details|terms|client'?s?\s+recent|about\s+the\s+client|view\s+job\s+posting|$))/i);
    if (m && m[1]) {
      const text = m[1].trim();
      if (text.length > 40 && text.length < 8000) return text;
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PROPOSALS-LIST SCRAPE (DESIGN.md Phase 6 — viewed-status sync)
  //
  // Fires on the "Submitted proposals" page (/nx/proposals/ with no numeric
  // id). Walks rows by their "Initiated <date>" text marker (more robust
  // than class selectors — Upwork rotates class names often) and extracts:
  //   - upwork_job_id (from the job-link anchor's href)
  //   - job_title     (the link text)
  //   - initiated_at  (the "Initiated ..." date string)
  //   - viewed        (boolean — presence of "Viewed by client" text)
  //
  // Result is sent to the background worker, which POSTs the batch to the
  // local backend's /proposal-status-sync endpoint.
  // ──────────────────────────────────────────────────────────────────────────

  function isProposalsListUrl() {
    // /nx/proposals or /nx/proposals/ (no trailing numeric id, no /job/~)
    const p = window.location.pathname.replace(/\/+$/, '');
    return p === '/nx/proposals' || p === '/ab/proposals';
  }

  // Count currently-rendered submitted-proposal rows (one "Initiated <date>" per row).
  function _countInitiatedRows() {
    return ((document.body.innerText || '').match(/\binitiated\b/gi) || []).length;
  }

  // Find the element that actually scrolls. Upwork sometimes scrolls an inner
  // container rather than the window; sweeping the wrong one renders nothing.
  function _scrollTargets() {
    const targets = [document.scrollingElement || document.documentElement];
    for (const el of document.querySelectorAll('div, main, section')) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 400) {
        targets.push(el);
      }
    }
    return targets;
  }

  // Sweep an element top→bottom in steps so every lazy-load trigger fires. Works
  // in a HIDDEN/background tab because scrollTop is set synchronously (no rAF,
  // no IntersectionObserver-on-paint dependency).
  async function _sweep(el, stepWaitMs) {
    const max = el.scrollHeight;
    const step = Math.max(300, Math.floor((el.clientHeight || 600) * 0.8));
    for (let y = 0; y <= max + step; y += step) {
      try {
        if (el === document.scrollingElement || el === document.documentElement) {
          window.scrollTo(0, y);
        } else {
          el.scrollTop = y;
        }
      } catch {}
      await new Promise(r => setTimeout(r, stepWaitMs));
    }
  }

  async function waitForListContent(maxMs = 45000) {
    const start = Date.now();

    // Step 1: wait for the "Submitted proposals" header to exist at all.
    while (Date.now() - start < maxMs) {
      if (/submitted\s+proposals/i.test(document.body.innerText || '')) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Step 2: bring the Submitted section into view.
    for (const h of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
      if ((h.innerText || '').trim().toLowerCase().startsWith('submitted proposals')) {
        try { h.scrollIntoView({ behavior: 'instant', block: 'start' }); } catch { try { h.scrollIntoView(); } catch {} }
        break;
      }
    }
    await new Promise(r => setTimeout(r, 400));

    // Step 3: sweep top→bottom repeatedly until the rendered row count STOPS
    // growing (all lazy rows loaded) or the budget runs out. This is what makes
    // a BACKGROUND tab capture the full list instead of only the first viewport.
    let prevCount = -1;
    let stablePasses = 0;
    const targets = _scrollTargets();
    while (Date.now() - start < maxMs) {
      for (const el of targets) await _sweep(el, 250);
      // settle, then re-measure
      await new Promise(r => setTimeout(r, 500));
      const count = _countInitiatedRows();
      if (count > 0 && count === prevCount) {
        stablePasses++;
        if (stablePasses >= 2) {            // two consecutive equal counts = done
          // scroll back to top so the scrape sees a clean, fully-rendered DOM
          try { window.scrollTo(0, 0); } catch {}
          await new Promise(r => setTimeout(r, 300));
          return true;
        }
      } else {
        stablePasses = 0;
      }
      prevCount = count;
    }

    const ok = _countInitiatedRows() > 0;
    if (!ok) console.warn('[Cockpit Proposal] Timed out waiting for Submitted proposals rows to render');
    return ok;
  }

  // Scan the whole document for currently-rendered "viewed by client"
  // indicators and return their vertical centres. Called both before and
  // after the hover sweep.
  //
  // KEY: uses textContent (not innerText) so visibility:hidden elements
  // are found — Upwork renders the badge as visibility:hidden for non-viewed
  // rows and visibility:visible for viewed ones. innerText returns '' for
  // hidden elements; textContent always returns the text.
  // We then check computed style to confirm the matched element is actually
  // visible (not still hidden for a non-viewed row).
  function _collectViewedYs() {
    const ys = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('*')) {
      // aria-label / title — always set regardless of visibility
      const aria = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || '')) || '';
      const ariaHit = /viewed\s+by\s+client/i.test(aria);

      // textContent — picks up visibility:hidden text that innerText misses
      // Limit to leaf-ish nodes (< 80 chars own text) to avoid parent wrappers
      const tc = (el.textContent || '').trim();
      const tcHit = tc.length > 0 && tc.length < 80 && /viewed\s+by\s+client/i.test(tc);

      if (!ariaHit && !tcHit) continue;

      // Deduplicate by element identity
      if (seen.has(el)) continue;
      seen.add(el);

      // Must have layout (display:none has zero rect)
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue;

      // Must be truly visible — skip visibility:hidden and opacity:0
      try {
        const cs = window.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      } catch {}

      ys.push(r.top + window.scrollY + r.height / 2);  // absolute Y so scroll position doesn't matter
    }
    return ys;
  }

  // Pre-scan the full page HTML for job TITLES that appear before a
  // "viewed by client" indicator. Upwork's proposals list links titles to
  // numeric proposal IDs (/nx/proposals/123...), not job IDs (~HEX), so
  // scanning for hex IDs always returns empty. Titles are the only
  // reliable text that appears in both the HTML and our DB.
  //
  // Strategy: for each "viewed by client" occurrence in the HTML, look
  // backward up to 2000 chars and extract the last substantial text node
  // (the job title anchor text). Build a Set of lowercased title prefixes.
  //
  // Returns: { viewedTitles: Set<string>, phraseCount: number }
  function buildViewedTitleSetFromHtml() {
    const viewedTitles = new Set();
    let phraseCount = 0;
    try {
      const html = document.body.innerHTML || '';
      const HTML_VIEWED_RE = /viewed\s+by\s+client|client\s+(?:has\s+)?viewed|\bstatus[:\s"]*viewed\b/gi;
      phraseCount = (html.match(HTML_VIEWED_RE) || []).length;
      if (phraseCount === 0) {
        console.log('[Cockpit Proposal] HTML-scan: no "viewed" status phrase found in innerHTML — CSS pseudo-element or not loaded yet.');
        return { viewedTitles, phraseCount };
      }

      // Strip HTML tags to get plain text for title extraction
      const TEXT_RE = />([^<]{8,120})</g;
      // Skip these known non-title strings
      const SKIP_RE = /^(initiated|submitted|boosted|not boosted|boost outbid|general profile|viewed by client|learn more|yesterday|today|\d+\s+day|\d+\s+week|\d+\s+hour|\d+\s+min|ago|\d{1,2}\/\d{1,2}\/\d{2,4}|may\s+\d|jun\s+\d|jul\s+\d|aug\s+\d|sep\s+\d|oct\s+\d|nov\s+\d|dec\s+\d|jan\s+\d|feb\s+\d|mar\s+\d|apr\s+\d)/i;

      const viewedRegex = /viewed\s+by\s+client|client\s+(?:has\s+)?viewed|\bstatus[:\s"]*viewed\b/gi;
      let vm;
      while ((vm = viewedRegex.exec(html)) !== null) {
        // Look backward from this "Viewed by client" occurrence
        const lookback = html.slice(Math.max(0, vm.index - 2500), vm.index);
        // Find all substantial text nodes in the lookback window
        const textMatches = [...lookback.matchAll(TEXT_RE)];
        // Walk backward to find the last plausible job title
        for (let i = textMatches.length - 1; i >= 0; i--) {
          const raw = textMatches[i][1].trim();
          if (!raw || SKIP_RE.test(raw)) continue;
          // Decode common HTML entities
          const t = raw.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
          const key = t.toLowerCase().slice(0, 60).trim();
          if (key.length >= 8) {
            viewedTitles.add(key);
            break;
          }
        }
      }
      console.log(`[Cockpit Proposal] HTML title-scan: ${phraseCount} "viewed by client" phrase(s), matched titles:`, [...viewedTitles]);
    } catch (e) {
      console.warn('[Cockpit Proposal] buildViewedTitleSetFromHtml error:', e && e.message);
    }
    return { viewedTitles, phraseCount };
  }

  async function scrapeProposalsList() {
    const rows = [];

    // Layer 0 — HTML title-scan. Finds job titles near "viewed by client" text.
    // More reliable than scanning for hex IDs because Upwork links proposals
    // to numeric IDs (/nx/proposals/123...) not job IDs (~HEX).
    const { viewedTitles: viewedTitleSet, phraseCount: viewedPhraseCount } = buildViewedTitleSetFromHtml();

    // Strategy: anchor on "Initiated <date>" text labels (one per row in the
    // Submitted section), walk UP to a plausible row container, extract title +
    // viewed flag + optional ~<hex> ID. The backend's /proposal-status-sync
    // endpoint matches by upwork_job_id first, then falls back to job_title —
    // so even when Upwork's Nuxt SPA hides the ID from the DOM (rows are
    // click-target divs that route via in-memory state), the title is enough
    // to pair the scrape row with the local Proposal record.
    const DATE_RE = /(?:Initiated|Submitted)\s+(?:[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/;
    // The proposals page uses RELATIVE timestamps ("26 minutes ago", "yesterday")
    // not absolute dates, so the old absolute-date anchor matched almost nothing.
    // Anchor instead on the stable "Initiated" label Upwork prints once per
    // submitted proposal (it precedes the time, whatever its format).
    const INITIATED_RE = /\binitiated\b/i;
    const ID_RE = /~([0-9a-zA-Z]{16,})/;

    const all = document.querySelectorAll('div, span, p, td, li, button, article, section');
    const dateNodes = [];
    for (const el of all) {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 200) continue;
      if (INITIATED_RE.test(t) || DATE_RE.test(t)) dateNodes.push(el);
    }
    const tightDateNodes = dateNodes.filter(el =>
      !dateNodes.some(other => other !== el && el.contains(other))
    );

    // ── Structural fingerprint (self-diagnosis) ──────────────────────────────
    // If the scrape still looks wrong, this tells us the page's real structure
    // in ONE run (surfaced in the on-page banner) instead of guessing blind.
    const fingerprint = (() => {
      const cnt = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return -1; } };
      return {
        a_jobs: cnt('a[href*="/jobs/"]'),
        a_proposals: cnt('a[href*="/proposals/"]'),
        a_tilde: cnt('a[href*="~"]'),
        a_total: cnt('a[href]'),
        initiated_nodes: dateNodes.length,
        tight_initiated: tightDateNodes.length,
        viewed_phrase_in_html: /viewed\s+by\s+client/i.test(document.body.outerHTML || ''),
        viewed_phrase_count: (((document.body.outerHTML || '').match(/viewed\s+by\s+client/gi)) || []).length,
      };
    })();
    console.log('[Cockpit Proposal] structural fingerprint:', JSON.stringify(fingerprint));

    // ── "Viewed by client" detection — CONSERVATIVE (per-row only) ───────────
    // Hard lesson from the diagnostics: "viewed by client" appears in the page
    // HTML at most ONCE (viewed_phrase_count), yet the old "broad" layers
    // (walk-up-2-ancestors, geometric/synthetic-hover, HTML-scan proximity)
    // smeared that single hit across EVERY row → all 10 flagged, 8 wrongly
    // promoted in the DB. We now flag a row viewed ONLY when the phrase lives
    // inside THAT row's own container subtree (innerText or outerHTML). That's
    // the only signal that can't false-positive. Under-detecting (missing a
    // hover-gated indicator) is acceptable; corrupting the DB is not.
    let viewedYs = [];   // geometric layer disabled — kept as [] for debug shape

    const seenContainers = new Set();
    const seenTitles = new Set();

    for (const dateEl of tightDateNodes) {
      // Walk up to find the row container. Heuristic: the FIRST ancestor whose
      // innerText is big enough to contain a title + date + status (>= 80 chars)
      // but small enough to be one row (<= 2000 chars). We DON'T require an ID
      // anymore — the backend can match by title.
      let cur = dateEl;
      let rowContainer = null;
      for (let i = 0; i < 12 && cur; i++) {
        const len = (cur.innerText || '').length;
        if (len >= 80 && len <= 2000) {
          rowContainer = cur;
          break;
        }
        cur = cur.parentElement;
      }
      if (!rowContainer || seenContainers.has(rowContainer)) continue;
      seenContainers.add(rowContainer);

      const rowText = (rowContainer.innerText || '');
      const dateMatch = rowText.match(DATE_RE);
      const initiated_at = dateMatch ? dateMatch[0] : null;

      // "Viewed by client" detection — CONSERVATIVE, per-row only.
      //   Layer 1: visible text within this row's own container
      //   Layer 2: this row's own outerHTML (catches aria-label / title / alt)
      // No walk-up, no geometric, no page-wide proximity — those false-positive
      // every row when the phrase exists once on the page.
      // Regex covers all known Upwork phrasings:
      //   "Viewed by client" (classic)
      //   "Client viewed"
      //   status badge containing just "Viewed"
      const VIEWED_RE = /viewed\s+by\s+client|client\s+(?:has\s+)?viewed|\bstatus[:\s"]*viewed\b/i;
      let viewed = VIEWED_RE.test(rowText);
      if (!viewed) {
        const rowHtml = (rowContainer.outerHTML || '');
        if (VIEWED_RE.test(rowHtml) ||
            /aria-label="[^"]*viewed[^"]*"/i.test(rowHtml) ||
            /title="[^"]*viewed[^"]*"/i.test(rowHtml) ||
            /data-[a-z-]*status[^"]*"[^"]*viewed[^"]*"/i.test(rowHtml)) {
          viewed = true;
        }
      }

      // Job title: first plausible non-empty line that isn't the date or a
      // status label. Heuristic: first line ≥ 8 chars, not all numeric/dollars,
      // not starting with a known status/metadata prefix.
      const lines = rowText.split('\n').map(l => l.trim()).filter(Boolean);
      let job_title = '';
      for (const line of lines) {
        if (line.length < 8 || line.length > 200) continue;
        if (/^(initiated|submitted|viewed|received|status|posted)\b/i.test(line)) continue;
        if (/^[\d$.,\s]+$/.test(line)) continue;
        if (/^(about the client|hourly|fixed|connects|payment\s+verified|\$\d)/i.test(line)) continue;
        // Relative timestamps in ANY unit (the page uses these, not absolute
        // dates): "26 minutes ago", "2 hours ago", "yesterday", "just now".
        if (/\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i.test(line)) continue;
        if (/^(yesterday|today|just now|a (minute|moment|few seconds) ago)\b/i.test(line)) continue;
        // UI chrome / call-to-action buttons that aren't titles.
        if (/^(boost|withdraw|view proposal|view job|message|send a message|see more|show more|load more|archive|edit|reuse|details|hire)\b/i.test(line)) continue;
        if (/\b(boosted|not boosted|learn more)\b/i.test(line)) continue;
        if (/boost(ed)?\b.*\boutbid\b/i.test(line)) continue;
        if (/^general profile\b/i.test(line)) continue;
        job_title = line;
        break;
      }

      // Dedupe by title (in case the row matches more than once via different
      // date subnodes) — but only if we got one. Empty titles fall through.
      if (job_title && seenTitles.has(job_title.toLowerCase())) continue;
      if (job_title) seenTitles.add(job_title.toLowerCase());

      // Optional ID — hunt within the row container only. If we find it, great;
      // if not, the backend matches by title.
      const html = rowContainer.outerHTML || '';
      const idMatch = html.match(ID_RE);
      const upwork_job_id = idMatch ? idMatch[1] : null;

      // Layer 0 cross-check: title-scan matched viewed titles from the HTML.
      if (!viewed && job_title && viewedTitleSet.size > 0) {
        const titleKey = job_title.toLowerCase().slice(0, 60).trim();
        // Exact prefix match first
        if (viewedTitleSet.has(titleKey)) {
          viewed = true;
          console.log('[Cockpit Proposal] Layer 0 (title-scan exact) flagged viewed:', job_title);
        } else {
          // Fuzzy: any viewed-title that substantially overlaps this row's title
          for (const vt of viewedTitleSet) {
            if (vt.length >= 10 && (titleKey.includes(vt) || vt.includes(titleKey.slice(0, Math.min(titleKey.length, vt.length))))) {
              viewed = true;
              console.log('[Cockpit Proposal] Layer 0 (title-scan fuzzy) flagged viewed:', job_title, '~', vt);
              break;
            }
          }
        }
      }

      // Push only if we have SOMETHING to match on (title or id).
      if (!job_title && !upwork_job_id) continue;
      rows.push({ upwork_job_id, job_title, initiated_at, viewed });
    }

    // Diagnostic: per-row viewed flags so the user can verify what was scraped.
    // Compact one-line format so the Chrome console doesn't collapse the output.
    if (rows.length > 0) {
      const summary = rows.map(r => `${r.viewed ? '👁' : '·'} ${r.job_title || r.upwork_job_id || '?'}`).join(' | ');
      console.log(`[Cockpit Proposal] scraped ${rows.length} rows: ${summary}`);
      console.log(`[Cockpit Proposal] geometric "viewed by client" indicators found on page: ${viewedYs.length}`);
      const viewedRows = rows.filter(r => r.viewed);
      if (viewedRows.length > 0) {
        console.log(`[Cockpit Proposal] ${viewedRows.length} row(s) flagged as VIEWED:`, viewedRows.map(r => r.job_title || r.upwork_job_id).join(' | '));
      } else if (viewedYs.length === 0) {
        console.warn('[Cockpit Proposal] no "Viewed by client" text found ANYWHERE on the page. Likely hover-only (the eye/label renders only when you hover the row) — the scraper never hovers, so it can\'t see it. If so, the viewed status simply can\'t be captured headlessly; we\'d need a different signal.');
      } else {
        console.warn(`[Cockpit Proposal] found ${viewedYs.length} viewed-indicator(s) on the page but none aligned vertically with a scraped row — share the row HTML so we can adjust the geometric matching.`);
      }
    }

    // Diagnostic on 0 rows. Log as strings (not raw arrays/objects) so the
    // Chrome console renders them inline instead of collapsing into Array(N).
    if (rows.length === 0) {
      const body = document.body.innerText || '';
      const sample = body.slice(0, 800).replace(/\s+/g, ' ');
      const anyTildeHtml = (document.body.outerHTML || '').match(/~[0-9a-zA-Z]{16,}/g) || [];
      const uniqueIds = [...new Set(anyTildeHtml)];
      const anchorSelectors = ['a[href*="~"]', 'a[href*="proposals"]', 'a[href*="job"]', 'button[data-test]', '[role="link"]', '[data-test]'];
      const selectorCounts = anchorSelectors.map(s => s + '=' + document.querySelectorAll(s).length).join(', ');

      console.warn('[Cockpit Proposal] === 0 ROWS SCRAPED — DIAGNOSTIC ===');
      console.warn('date-label nodes:', dateNodes.length, '(tightest:', tightDateNodes.length + ')');
      console.warn('total ~hex IDs in body HTML:', anyTildeHtml.length, '(unique:', uniqueIds.length + ')');
      console.warn('first 8 unique ~IDs:', uniqueIds.slice(0, 8).join(' | '));
      console.warn('selector counts:', selectorCounts);
      console.warn('body sample:', sample);

      // For the first 3 tightest date nodes, log a walk trace so we can see
      // why no ancestor matched the ID regex.
      console.warn('--- WALK TRACES ---');
      for (let i = 0; i < Math.min(3, tightDateNodes.length); i++) {
        const dateEl = tightDateNodes[i];
        const dateText = (dateEl.innerText || '').trim().slice(0, 80);
        console.warn(`[date ${i+1}] text: "${dateText}"`);
        let cur = dateEl;
        for (let step = 0; step < 12 && cur; step++) {
          const len = (cur.innerText || '').length;
          const tag = cur.tagName ? cur.tagName.toLowerCase() : '?';
          const cls = (cur.className && typeof cur.className === 'string') ? cur.className.slice(0, 60) : '';
          const dataTest = cur.getAttribute && cur.getAttribute('data-test');
          const hasId = cur.outerHTML && ID_RE.test(cur.outerHTML);
          console.warn(`  [step ${step}] <${tag}${dataTest ? ' data-test="'+dataTest+'"' : ''}${cls ? ' class="'+cls+'"' : ''}> innerText.length=${len} hasIdInHTML=${hasId}`);
          if (hasId) break;
          cur = cur.parentElement;
        }
      }

      // Also try a structural fallback: find every element with [data-test]
      // attribute containing "proposal" or "row" — Nuxt-built UIs often label
      // rows like data-test="proposal-row" or similar.
      const rowCandidates = document.querySelectorAll('[data-test*="row" i], [data-test*="proposal" i], [data-test*="item" i]');
      console.warn('row-candidate selectors found:', rowCandidates.length);
      if (rowCandidates.length > 0 && rowCandidates.length < 100) {
        const sampleTests = [...rowCandidates].slice(0, 5).map(el => el.getAttribute('data-test')).join(' | ');
        console.warn('sample data-test attrs:', sampleTests);
      }
    }

    // Build a human-readable debug summary that travels back to the dashboard
    // so the user can see scrape results WITHOUT opening DevTools (the sync
    // tab closes itself too fast to F12).
    const viewedTitles = rows.filter(r => r.viewed).map(r => r.job_title || r.upwork_job_id || '?');
    // Raw text of the first 3 anchored row containers — so if titles are still
    // wrong, the banner shows the exact line structure and I can write a precise
    // selector without another blind guess.
    const rawSamples = [];
    for (let i = 0; i < Math.min(3, tightDateNodes.length); i++) {
      let cur = tightDateNodes[i], box = null;
      for (let s = 0; s < 12 && cur; s++) {
        const len = (cur.innerText || '').length;
        if (len >= 80 && len <= 2000) { box = cur; break; }
        cur = cur.parentElement;
      }
      const txt = box ? (box.innerText || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8).join(' ⏎ ') : '(no container)';
      rawSamples.push(txt.slice(0, 240));
    }
    const debug = {
      rowCount: rows.length,
      viewedIndicatorsOnPage: viewedYs.length,
      viewedRowCount: viewedTitles.length,
      viewedTitles,
      rowTitles: rows.map(r => `${r.viewed ? '👁 ' : ''}${r.job_title || r.upwork_job_id || '?'}`),
      fingerprint,
      rawSamples,
    };
    return { rows, debug };
  }

  async function syncProposalsList() {
    const ok = await waitForListContent();
    if (!ok) {
      console.warn('[Cockpit Proposal] List page did not render in time');
      return { ok: false, error: 'List page did not render', debug: { rowCount: 0, viewedIndicatorsOnPage: 0, viewedRowCount: 0, rowTitles: [], note: 'list did not render' } };
    }
    // Scrape inside a guard so a throw NEVER loses the debug — we still want
    // the dashboard panel to show what happened instead of "unavailable".
    let rows = [], debug = null;
    try {
      ({ rows, debug } = await scrapeProposalsList());
    } catch (err) {
      console.error('[Cockpit Proposal] scrapeProposalsList threw:', err);
      return {
        ok: false,
        error: 'scrape error: ' + (err && err.message || err),
        debug: { rowCount: 0, viewedIndicatorsOnPage: 0, viewedRowCount: 0, rowTitles: [], note: 'scrape threw: ' + (err && err.message || err) },
      };
    }
    console.log('[Cockpit Proposal] Scraped', rows.length, 'proposal rows from list');
    if (!rows.length) return { ok: true, scanned: 0, updated: 0, debug };
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'PROPOSAL_STATUS_SYNC', rows, debug },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Cockpit Proposal] Sync message error:', chrome.runtime.lastError.message);
            resolve({ ok: false, error: chrome.runtime.lastError.message, debug });
            return;
          }
          console.log('[Cockpit Proposal] Sync result:', response);
          resolve({ ...(response || {}), debug });
        }
      );
    });
  }

  // Listen for explicit sync requests (from popup / background-opened tab)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PROPOSALS_LIST_SCRAPE_REQUEST') {
      syncProposalsList().then(sendResponse).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async response
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  //  SYNC v2 — URL-marker trigger + DIRECT backend POST + on-page banner
  //
  //  The old design routed the scrape through the background worker, then to
  //  the dashboard via a cross-tab relay. Across 50+ iterations the result/
  //  debug never reached the dashboard — too many fragile hops (MV3 worker
  //  death mid-flight, background-tab render throttling, message relays).
  //
  //  v2 removes ALL of that. The background worker's only job is to open this
  //  tab ACTIVE with a `?falconsync=1` URL marker. Everything else happens
  //  right here, in the page, where we can SEE it:
  //    1. Detect the marker (it's in the URL, so it survives worker death).
  //    2. Scrape the (now fully-rendered, because the tab is active) list.
  //    3. fetch()-POST the rows STRAIGHT to the backend — no worker, no relay.
  //       (HTTPS upwork.com → http://127.0.0.1 is allowed: localhost is a
  //        "potentially trustworthy" origin, and the backend CORS-allows
  //        https://www.upwork.com.)
  //    4. Paint an on-page banner with the result so the user never needs F12
  //       or the dashboard to know what happened.
  // ════════════════════════════════════════════════════════════════════════
  const FALCON_API_BASE = 'http://127.0.0.1:8000';

  function falconSyncMarkerPresent() {
    // Primary: the URL marker placed by the background worker.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('falconsync') === '1') {
        // Stash in sessionStorage so an SPA route change that strips the query
        // (Upwork sometimes rewrites the URL) doesn't lose the trigger.
        try { sessionStorage.setItem('falcon_sync_requested', '1'); } catch (_) {}
        return true;
      }
    } catch (_) {}
    // Fallback: the stash from an earlier load in THIS tab.
    try { return sessionStorage.getItem('falcon_sync_requested') === '1'; } catch (_) { return false; }
  }

  async function falconSyncRequested() {
    // 1) URL marker / sessionStorage stash — the cheap, in-page check.
    if (falconSyncMarkerPresent()) return true;
    // 2) Durable fallback: ask the background worker whether THIS tab is in the
    //    persisted "opened for sync" set (chrome.storage.session). This covers
    //    the case where Upwork strips ?falconsync=1 on a server redirect before
    //    our content script first runs. Single round-trip, not a fragile relay.
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

  function clearFalconSyncMarker() {
    try { sessionStorage.removeItem('falcon_sync_requested'); } catch (_) {}
    // Strip ?falconsync=1 from the address bar so a manual refresh doesn't
    // silently re-trigger a sync.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('falconsync')) {
        url.searchParams.delete('falconsync');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (_) {}
  }

  async function postSyncDirect(rows) {
    // Hard timeout so a stuck connection can never leave the banner frozen on
    // "saving…" — if the backend doesn't answer in 15s we surface an error.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(`${FALCON_API_BASE}/proposal-status-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('backend did not respond within 15s (is the dashboard/backend running on :8000?)');
      throw new Error('could not reach backend on http://127.0.0.1:8000 — ' + (e && e.message || e));
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('API ' + resp.status + ': ' + text.slice(0, 300));
    }
    return resp.json();
  }

  function showSyncBanner({ phase, scraped, viewed, result, error, debug }) {
    let el = document.getElementById('falcon-sync-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'falcon-sync-banner';
      el.style.cssText = [
        'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
        'width:360px', 'max-width:90vw', 'padding:16px 18px',
        'background:#0b1f17', 'color:#d8ffe9',
        'border:2px solid #1fd672', 'border-radius:12px',
        'box-shadow:0 12px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(31,214,114,.25)',
        'font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif',
        'white-space:normal',
      ].join(';');
      document.body.appendChild(el);
    }
    const ok = phase === 'done' && !error;
    const headColor = error ? '#ff8a8a' : (ok ? '#1fd672' : '#ffd479');
    const title = error ? 'Falcon Sync — error'
      : phase === 'scraping' ? 'Falcon Sync — scraping…'
      : phase === 'posting' ? 'Falcon Sync — saving…'
      : 'Falcon Sync — done';

    const lines = [];
    if (typeof scraped === 'number') lines.push(`Scraped <b>${scraped}</b> proposal rows`);
    if (typeof viewed === 'number') lines.push(`Viewed-by-client: <b>${viewed}</b>`);
    if (result) {
      lines.push(`Matched &amp; promoted to “viewed”: <b>${result.updated ?? 0}</b>`);
      if (result.not_matched_count) lines.push(`Unmatched rows: ${result.not_matched_count}`);
    }
    if (error) lines.push(`<span style="color:#ff8a8a">${String(error).slice(0, 300)}</span>`);

    const esc = (s) => String(s).replace(/</g, '&lt;');
    let titlesHtml = '';
    if (debug && Array.isArray(debug.rowTitles) && debug.rowTitles.length) {
      const items = debug.rowTitles.slice(0, 40)
        .map(t => `<li style="margin:1px 0">${esc(t).slice(0, 90)}</li>`)
        .join('');
      titlesHtml = `<details style="margin-top:8px"><summary style="cursor:pointer;color:#9fe9c2">rows (${debug.rowTitles.length})</summary><ul style="margin:6px 0 0;padding-left:18px;max-height:220px;overflow:auto">${items}</ul></details>`;
    }
    // Diagnostic block — only worth showing when the scrape looks off (few rows
    // or everything flagged viewed). Lets me see the real page structure in one
    // run instead of guessing.
    let diagHtml = '';
    if (debug && (debug.fingerprint || debug.rawSamples)) {
      const fp = debug.fingerprint ? esc(JSON.stringify(debug.fingerprint)) : '';
      const samples = (debug.rawSamples || [])
        .map((s, i) => `<div style="margin:3px 0;color:#cbd5cf"><b>row ${i + 1}:</b> ${esc(s)}</div>`)
        .join('');
      diagHtml = `<details style="margin-top:8px"><summary style="cursor:pointer;color:#9fe9c2">diagnostics</summary>`
        + `<div style="margin:6px 0 0;font:11px/1.4 monospace;color:#9fb8ac;word-break:break-all">${fp}</div>`
        + `<div style="margin-top:6px;font-size:11px">${samples}</div></details>`;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="color:${headColor};font-size:14px">${title}</strong>
        <button id="falcon-sync-close" style="background:none;border:none;color:#7fae97;font-size:18px;cursor:pointer;line-height:1">×</button>
      </div>
      <div>${lines.map(l => `<div style="margin:2px 0">${l}</div>`).join('')}</div>
      ${titlesHtml}
      ${diagHtml}
      ${ok ? '<div style="margin-top:10px;color:#7fae97;font-size:12px">You can close this tab.</div>' : ''}
    `;
    const closeBtn = document.getElementById('falcon-sync-close');
    if (closeBtn) closeBtn.onclick = () => el.remove();
  }

  // Auto-fire when we landed on the list page with the ?falconsync=1 marker.
  (async () => {
    const isList = isProposalsListUrl();
    if (!isList) return;
    const requested = await falconSyncRequested();
    console.log('[Cockpit Proposal] Auto-sync check — isList:', isList, 'falconsync:', requested, 'path:', window.location.pathname + window.location.search);
    if (!requested) return;

    clearFalconSyncMarker();
    showSyncBanner({ phase: 'scraping' });

    let rows = [], debug = null;
    try {
      ({ rows, debug } = await scrapeProposalsList());
    } catch (err) {
      console.error('[Cockpit Proposal] scrape threw:', err);
      showSyncBanner({ phase: 'done', error: 'scrape failed: ' + (err && err.message || err) });
      return;
    }

    const scraped = rows.length;
    const viewed = (debug && debug.viewedRowCount) || rows.filter(r => r.viewed).length;
    console.log('[Cockpit Proposal] scraped', scraped, 'rows,', viewed, 'viewed');
    showSyncBanner({ phase: 'posting', scraped, viewed, debug });

    // Tell the background worker we're done so it CLOSES this tab and notifies
    // the dashboard (lights the Outcomes activity dots). Fire on every exit path.
    const _done = (result) => {
      try { chrome.runtime.sendMessage({ type: 'PROPOSALS_LIST_SCRAPE_DONE', result: result || {} }, () => void chrome.runtime.lastError); } catch (_) {}
    };

    if (!scraped) {
      showSyncBanner({ phase: 'done', scraped: 0, viewed: 0, debug, error: 'no rows scraped — is the “Submitted proposals” list visible?' });
      _done({ scanned: 0, error: 'no rows scraped' });
      return;
    }

    try {
      const result = await postSyncDirect(rows);
      console.log('[Cockpit Proposal] direct POST result:', result);
      showSyncBanner({ phase: 'done', scraped, viewed, result, debug });
      _done(result);
    } catch (err) {
      console.error('[Cockpit Proposal] direct POST failed:', err);
      showSyncBanner({ phase: 'done', scraped, viewed, debug, error: 'save failed: ' + (err && err.message || err) });
      _done({ scanned: scraped, error: 'save failed: ' + (err && err.message || err) });
    }
  })();

  // Only run the proposal-DETAIL scraper when we're actually on a detail page.
  // The list page (/nx/proposals/) is a different layout — the
  // PROPOSALS-LIST SCRAPE block above handles it separately.
  if (!isProposalsListUrl()) {
    run();
  }
  setupSubmitListener();
  handlePostSubmitCapture();

  // SPA re-renders: re-hook on URL changes
  let _lastUrl = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== _lastUrl) {
      _lastUrl = window.location.href;
      window.__falconSubmitHooked = false; // allow re-bind on the new view
      setTimeout(() => {
        setupSubmitListener();
        handlePostSubmitCapture();
      }, 600);
    }
  }).observe(document, { subtree: true, childList: true });

  console.log('[Cockpit Proposal] Scraper loaded on', window.location.href);
})();
