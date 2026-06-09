// Falcon Scout Enricher - Content Script v3
(function () {
  'use strict';

  function getJobId() {
    // Try current URL first (handles /jobs/~ID and /nx/s/job-details-viewer/~ID)
    let src = window.location.href;
    let match = src.match(/~([0-9a-f]{16,})/i);
    if (match) return match[1];

    // Try canonical URL in page head (SPA may update this before address bar)
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href) {
      match = canonical.href.match(/~([0-9a-f]{16,})/i);
      if (match) return match[1];
    }

    // Try og:url meta tag
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl && ogUrl.content) {
      match = ogUrl.content.match(/~([0-9a-f]{16,})/i);
      if (match) return match[1];
    }

    return null;
  }

  function extractData() {
    const data = {
      job_id: getJobId(),
      url: window.location.href,
      scraped_at: new Date().toISOString(),
      // Send page title for backend matching (bot stopped sending URLs)
      // document.title format: "Job Title | Upwork" - most reliable source
      page_title: document.title.split(' | ')[0].trim(),
    };

    const body = document.body.innerText;

    const connectsMatch = body.match(/Send a proposal for:\s*(\d+)\s*Connects/i);
    data.connects_required = connectsMatch ? parseInt(connectsMatch[1]) : null;

    const availMatch = body.match(/Available Connects:\s*(\d+)/i);
    data.available_connects = availMatch ? parseInt(availMatch[1]) : null;

    // Allow any whitespace (including multiple newlines) between label and value
    const proposalsMatch = body.match(/Proposals:\s*[\n\r\s]*([^\n\r]{2,40})/i);
    data.proposals = proposalsMatch ? proposalsMatch[1].trim().replace(/\s*[ⓘⓘℹ].*$/, '').trim() : null;

    const lastViewedMatch = body.match(/Last viewed by client:\s*\n?\s*([^\n]+)/i);
    data.last_viewed = lastViewedMatch ? lastViewedMatch[1].trim() : null;

    const interviewMatch = body.match(/Interviewing:\s*\n?\s*(\d+)/i);
    data.interviewing = interviewMatch ? parseInt(interviewMatch[1]) : 0;

    const invitesMatch = body.match(/Invites sent:\s*\n?\s*(\d+)/i);
    data.invites_sent = invitesMatch ? parseInt(invitesMatch[1]) : 0;

    const unansweredMatch = body.match(/Unanswered invites:\s*\n?\s*(\d+)/i);
    data.unanswered_invites = unansweredMatch ? parseInt(unansweredMatch[1]) : 0;

    // "Already hired: N" — Upwork only renders this row when N > 0. Capture both
    // count and a 0 fallback so the analyser can distinguish "client filled the
    // role" from "we don't know".
    const alreadyHiredMatch = body.match(/Already\s+hired:\s*\n?\s*(\d+)/i);
    data.client_already_hired = alreadyHiredMatch ? parseInt(alreadyHiredMatch[1]) : 0;

    // Matches "Payment verified" (new UI) and "Payment method verified" (old UI)
    data.payment_verified = /payment\s+(?:method\s+)?verified/i.test(body);
    data.phone_verified = /phone\s+(?:number\s+)?verified/i.test(body);

    const ratingMatch = body.match(/([\d.]+)\s+of\s+(\d+)\s+reviews?/i);
    if (ratingMatch) {
      data.client_rating_score = parseFloat(ratingMatch[1]);
      data.client_review_count = parseInt(ratingMatch[2]);
    }

    const hireRateMatch = body.match(/(\d+)%\s+hire rate/i);
    data.hire_rate = hireRateMatch ? parseInt(hireRateMatch[1]) : null;

    const jobsMatch = body.match(/(\d+)\s+jobs?\s+posted/i);
    data.client_jobs_posted = jobsMatch ? parseInt(jobsMatch[1]) : null;
    const openMatch = body.match(/(\d+)\s+open\s+jobs?/i);
    data.client_jobs_open = openMatch ? parseInt(openMatch[1]) : null;

    const spentMatch = body.match(/\$([\d,.]+[KkMm]?)\s+total spent/i);
    data.client_total_spent_detail = spentMatch ? '$' + spentMatch[1] + ' total spent' : null;

    // Accept both "9 hires, 2 active" (old) and "9 hires 2 active" (new, no comma)
    const hiresMatch = body.match(/(\d+)\s+hires?,?\s*(\d+)\s+active/i);
    if (hiresMatch) {
      data.client_hires = parseInt(hiresMatch[1]);
      data.client_active = parseInt(hiresMatch[2]);
    }

    const avgRateMatch = body.match(/\$([\d.]+)\s*\/hr\s+avg\s+hourly\s+rate\s+paid/i);
    data.client_avg_hourly_rate = avgRateMatch ? parseFloat(avgRateMatch[1]) : null;

    // Anchor to "avg hourly rate paid" to avoid matching hours in client history entries
    const hoursMatch = body.match(/avg\s+hourly\s+rate\s+paid\s*\n?([\d,]+(?:\.\d+)?)\s+hours?\b/i);
    data.client_hours_billed = hoursMatch ? Math.round(parseFloat(hoursMatch[1].replace(',', ''))) : null;

    const sizeMatch = body.match(/(Freelancer|Small company|Mid-size company|Large company|Enterprise)\s*\(([^)]+)\)/i);
    data.client_company_size = sizeMatch ? sizeMatch[0] : null;

    const industries = [
      'Media & Entertainment', 'Technology', 'Finance', 'Healthcare', 'Education',
      'Retail', 'Manufacturing', 'Legal', 'Real Estate', 'Marketing & Advertising',
      'Non-profit', 'Government', 'Transportation', 'Construction', 'Energy',
      'Food & Beverage', 'Travel & Hospitality', 'Fashion & Apparel', 'Sports',
    ];
    for (const ind of industries) {
      if (body.includes(ind)) { data.client_industry = ind; break; }
    }

    const memberMatch = body.match(/Member since\s+([A-Za-z]+\s+\d+,?\s*\d{4})/i);
    data.client_member_since = memberMatch ? memberMatch[1] : null;

    const locationMatch = body.match(/\n([A-Za-z\s]+)\n[\d:]+\s+[AP]M\n/);
    data.client_city = locationMatch ? locationMatch[1].trim() : null;

    // Reviews are scraped separately via scrapeAllReviews() in run() to support pagination

    // Experience level
    const expMatch = body.match(/(Entry Level|Intermediate|Expert)\s*\nI am willing/i);
    data.experience_level = expMatch ? expMatch[1] : null;

    // Hours per week
    const hpwMatch = body.match(/(Less than \d+ hrs\/week|\d+[\-–]\d+ hrs\/week|More than \d+ hrs\/week)/i);
    data.hours_per_week = hpwMatch ? hpwMatch[1] : null;

    // Contract duration
    const durationMatch = body.match(/(Less than 1 month|\d+ to \d+ months?|More than 6 months?)\s*\nDuration/i);
    data.duration = durationMatch ? durationMatch[1] : null;

    // Project type
    const projectTypeMatch = body.match(/Project Type:\s*([^\n]+)/i);
    data.project_type = projectTypeMatch ? projectTypeMatch[1].trim() : null;

    // Freelancer location preference (Worldwide / US only / etc.)
    // Priority: labelled preference > "Only freelancers located in X" sentence > bare keyword
    let geoStr = null;
    const geoLabelMatch = body.match(/(?:Talent\s+Preferences|Preferred\s+Location|Location\s+Preference)[^\n]*\n([^\n]{2,40})/i);
    const geoLocatedMatch = body.match(/Only freelancers located in (.+?)\s+may\s+apply/i);
    const geoKeywordMatch = body.match(/\b(Worldwide|US\s+only|United\s+States\s+only|North\s+America\s+only|Europe\s+only|UK\s+only)\b/i);
    if (geoLabelMatch) {
      geoStr = geoLabelMatch[1].trim();
    } else if (geoLocatedMatch) {
      // Normalise "the U.S." / "the United States" → "US only"
      let loc = geoLocatedMatch[1].trim().replace(/^the\s+/i, '').replace(/\.$/, '');
      loc = loc.replace(/^U\.S\.?$/i, 'United States').replace(/^UK\.?$/i, 'United Kingdom');
      geoStr = loc + ' only';
    } else if (geoKeywordMatch) {
      geoStr = geoKeywordMatch[1].trim();
    }
    data.geo_restriction = geoStr;

    // Bid range (shown in Activity section)
    const bidsMatch = body.match(/High\s*\n\$([\d.]+)\s*\nAverage\s*\n\$([\d.]+)\s*\nLow\s*\n\$([\d.]+)/i);
    if (bidsMatch) {
      data.bid_high    = parseFloat(bidsMatch[1]);
      data.bid_average = parseFloat(bidsMatch[2]);
      data.bid_low     = parseFloat(bidsMatch[3]);
    }

    const screeningMatch = body.match(/Additional questions([\s\S]*?)(?:Activity on this job|About the client)/i);
    if (screeningMatch) {
      const qLines = screeningMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 10 && !l.match(/^\d+$/));
      if (qLines.length) data.screening_questions = JSON.stringify(qLines);
    }

    // ── Full job description ──────────────────────────────────────────────
    // The Telegram bot's posting often truncates long descriptions ("...").
    // Pull the complete text directly from the Upwork page so the analyser
    // and generator can read the whole thing.
    //
    // Strategy (most reliable → least):
    //   A. DOM selectors that Upwork has used over recent releases
    //   B. Find a heading element with text "Overview"/"Description"/etc. and
    //      grab the following content-block's textContent (NOT innerText, so
    //      CSS line-clamp truncation doesn't bite us)
    //   C. Body-text regex with broader stop heading set
    //
    // Cleaning: strip a trailing "More"/"Less" toggle word that Upwork appends
    // to the collapsible block.
    function cleanDesc(s) {
      return (s || '').replace(/\s*(?:Less|More)\s*$/i, '').trim();
    }
    function isPlausibleDesc(s) {
      if (!s) return false;
      const t = s.trim();
      return t.length > 80 && t.length < 12000;
    }

    let descFull = null;

    // A. DOM selectors
    const descSelectors = [
      '[data-test="Description"]',
      '[data-test="JobDescription"]',
      '[data-test="job-description"]',
      '[data-cy="job-description"]',
      'section[data-test*="description" i]',
      'div[data-test*="description" i]',
      'section[class*="JobDescription"]',
      'div[class*="jobDescription"]',
      '.job-description',
      'section[aria-labelledby*="description" i]',
    ];
    for (const sel of descSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const txt = cleanDesc(el.textContent);
        if (isPlausibleDesc(txt)) { descFull = txt; break; }
      }
    }

    // B. Heading-based lookup — find a heading whose text matches one of these
    // labels, then take the next sibling element (or container) with substantial text.
    if (!descFull) {
      const HEADING_LABELS = ['overview', 'description', 'job description', 'project description', 'about the project'];
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], [class*="heading" i]');
      for (const h of headings) {
        const label = (h.textContent || '').trim().toLowerCase();
        if (!HEADING_LABELS.includes(label)) continue;

        // Walk siblings until we find one with substantial text
        let node = h.nextElementSibling;
        for (let i = 0; i < 4 && node; i++) {
          const t = cleanDesc(node.textContent);
          if (isPlausibleDesc(t)) { descFull = t; break; }
          node = node.nextElementSibling;
        }
        if (descFull) break;

        // Fallback: look at heading's parent's next sibling
        if (h.parentElement) {
          const sib = h.parentElement.nextElementSibling;
          if (sib) {
            const t = cleanDesc(sib.textContent);
            if (isPlausibleDesc(t)) { descFull = t; break; }
          }
        }
      }
    }

    // C. Body-text regex fallback. Use a broader set of section terminators
    // and don't insist on the heading sitting on its own line.
    if (!descFull) {
      const m = body.match(
        /\b(?:Overview|Description|Job\s+description|Project\s+description)\b[\s\n]+([\s\S]{80,8000}?)(?=\n\s*(?:Skills\s+(?:and|&)\s+experience|Mandatory\s+skills|Preferred\s+qualifications|Activity\s+on\s+this\s+job|About\s+the\s+client|Project\s+Type|Client\s+history|Hourly|Fixed-price|Estimated\s+time|Posted)\b)/i
      );
      if (m && isPlausibleDesc(m[1])) descFull = cleanDesc(m[1]);
    }

    if (descFull) {
      data.description_full = descFull;
    }
    // Debug breadcrumb so you can verify in the extension popup / console
    // whether the description was captured.
    try {
      console.log('[Falcon Scout] description_full length:', (data.description_full || '').length);
    } catch {}

    // ── Preferred qualifications ─────────────────────────────────────────
    // Upwork shows a "Preferred qualifications" block (e.g. "Location: India")
    // that's a SOFT filter — not a hard disqualifier. Capture so the analyser
    // can flag mismatches without skipping the job.
    //
    // Defensive scraping: the DOM walk often picked up the NEXT section
    // ("Activity on this job", "About the client", etc.) when there was no
    // actual preferred-qualifications content but the heading existed in a
    // tooltip / aria label / template. Three guards now:
    //   1. Walk stops if a sibling's text starts with another section's name
    //   2. Captured text is rejected outright if it CONTAINS markers of
    //      adjacent sections (Activity, Proposals stat tooltips, etc.)
    //   3. Regex fallback uses more permissive terminators (no required
    //      leading newline — Upwork sometimes concatenates section headers)
    let preferredQuals = null;

    // Phrases that indicate we've crossed into another section by mistake.
    // If any of these appear in what we captured, it's not preferred quals.
    // NOTE: no leading \b word-boundary anchors. Upwork's innerText often
    // concatenates section headers WITHOUT spaces (e.g. "...this jobInvites
    // sent:0Unanswered invites:0"), so a trailing \b after "job" never matches
    // because "job" is immediately followed by "I". Plain substring matches
    // are robust against that concatenation.
    const _ADJACENT_SECTION_MARKERS = [
      /Activity on this job/i,
      /About the client/i,
      /Client'?s? recent history/i,
      /Skills (?:and|&) expertise/i,
      /Additional questions/i,
      /Reflects the number of proposals/i,
      /Indicates when the client last reviewed/i,
      /Proposals:\s*\d/i,
      /Interviewing:\s*\d/i,
      /Invites sent:\s*\d/i,
      /Unanswered invites:\s*\d/i,
    ];
    const _looksLikeOtherSection = (text) => {
      if (!text) return false;
      return _ADJACENT_SECTION_MARKERS.some(re => re.test(text));
    };

    // A. DOM heading lookup
    const QUAL_LABELS = ['preferred qualifications', 'preferred qualification'];
    const allHeadings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"], [class*="heading" i], [class*="Heading" i]');
    for (const h of allHeadings) {
      const label = (h.textContent || '').trim().toLowerCase();
      if (!QUAL_LABELS.includes(label)) continue;
      // Walk next siblings looking for substantive text content. Stop if a
      // sibling looks like a different section — don't grab it by mistake.
      let node = h.nextElementSibling;
      for (let i = 0; i < 4 && node; i++) {
        const t = (node.textContent || '').trim();
        if (_looksLikeOtherSection(t)) break;   // boundary hit — abort walk
        if (t.length > 3 && t.length < 1500) { preferredQuals = t; break; }
        node = node.nextElementSibling;
      }
      if (!preferredQuals && h.parentElement) {
        const sib = h.parentElement.nextElementSibling;
        if (sib) {
          const t = (sib.textContent || '').trim();
          if (!_looksLikeOtherSection(t) && t.length > 3 && t.length < 1500) {
            preferredQuals = t;
          }
        }
      }
      if (preferredQuals) break;
    }

    // B. Body-text regex fallback — captures everything between the heading
    //    and the next section. Lookahead doesn't require a leading newline
    //    because Upwork's innerText sometimes runs section headers together
    //    without separators.
    if (!preferredQuals) {
      const m = body.match(/Preferred qualifications[\s\n]+([\s\S]{3,1500}?)(?=\s*(?:Activity on this job|About the client|Skills (?:and|&) experience|Client'?s? recent history|Additional questions|Project Type|$))/i);
      if (m) preferredQuals = m[1].trim();
    }

    // C. Final sanity check — if the captured content looks like another
    //    section's body, reject it. Better to have no preferred_qualifications
    //    than to show garbage in the analyser prompt + UI flag.
    if (preferredQuals && _looksLikeOtherSection(preferredQuals)) {
      try {
        console.warn('[Falcon Scout] preferred_qualifications captured looked like another section, discarding:',
          preferredQuals.slice(0, 120));
      } catch {}
      preferredQuals = null;
    }

    // ALWAYS set the field (even to '') so re-enrichment OVERWRITES any stale
    // value already in the DB. The backend only updates fields present in the
    // payload — if we omit this when there are no valid preferred quals, the
    // old garbage (e.g. a previously mis-scraped "Activity on this job…" blob)
    // would persist forever. Empty string is falsy, so the UI/analyser skip it.
    data.preferred_qualifications = preferredQuals
      ? preferredQuals.replace(/\s+/g, ' ').trim().slice(0, 1500)
      : '';
    try {
      console.log('[Falcon Scout] preferred_qualifications:',
        data.preferred_qualifications || '(none — cleared)');
    } catch {}

    return data;
  }

  // ── Parse reviews from a history section text blob ────────────────────────
  function parseHistoryFromText(histText) {
    const reviews = [];

    // NEW FORMAT (2025+): entries separated by date ranges
    const newFormatBlocks = histText.split(/\n(?=[A-Z][a-z]+ \d{4}\s*[-–])/);
    let parsedNew = false;
    for (const block of newFormatBlocks.slice(0, 20)) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      const review = {};

      const dateMatch = block.match(/([A-Za-z]+ \d{4})\s*[-–]\s*(Present|[A-Za-z]+ \d{4})/i);
      if (!dateMatch) continue;
      review.date_from = dateMatch[1];
      review.date_to = dateMatch[2];

      const titleLine = lines.find(l =>
        l.length > 3 &&
        !l.match(/^[A-Z][a-z]+ \d{4}/) &&
        !l.startsWith('Freelancer:') &&
        !l.startsWith('Billed:') &&
        !l.match(/^(Fixed-price|Hourly)/i)
      );
      if (titleLine) review.feedback = titleLine;

      const billedMatch = block.match(/Billed:\s*\$([\d,.]+)/i);
      if (billedMatch) review.billed = '$' + billedMatch[1];

      const hrsAtRate = block.match(/([\d,]+(?:\.\d+)?)\s+hours?\s*@\s*\$([\d.]+)/i);
      const rateOnlyMatch = block.match(/\$([\d.]+)\/hr/);
      if (hrsAtRate) {
        review.hours = Math.round(parseFloat(hrsAtRate[1].replace(',', '')));
        review.rate  = parseFloat(hrsAtRate[2]);
      } else if (rateOnlyMatch) {
        review.rate = parseFloat(rateOnlyMatch[1]);
      }

      if (review.date_from) { reviews.push(review); parsedNew = true; }
    }

    // OLD FORMAT: entries split by "Rating is X out of 5."
    if (!parsedNew) {
      const ratingValues = [...histText.matchAll(/Rating is ([\d.]+) out of 5\./g)].map(m => parseFloat(m[1]));
      const ratingBlocks = histText.split(/Rating is [\d.]+ out of 5\./g).slice(1);
      for (let ri = 0; ri < Math.min(ratingBlocks.length, 20); ri++) {
        const block = ratingBlocks[ri];
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        const review = {};

        const feedbackLine = lines.find(l =>
          l.length > 15 &&
          !l.startsWith('To freelancer:') &&
          !l.startsWith('Billed:') &&
          !l.startsWith('No feedback') &&
          !l.match(/^\$[\d,.]/) &&
          !l.match(/^\d+[\s,]/) &&
          !l.match(/^[A-Z][a-z]+ \d{4}/) &&
          !l.match(/^\d+\.\d+$/) &&
          l.match(/[a-z]{3,}/)
        );
        if (feedbackLine) review.feedback = feedbackLine;

        const dateMatch = block.match(/([A-Za-z]+ \d{4})\s*[-–]\s*([A-Za-z]+ \d{4})/);
        if (dateMatch) { review.date_from = dateMatch[1]; review.date_to = dateMatch[2]; }

        const hrsAtRate = block.match(/([\d,]+(?:\.\d+)?)\s+hours?\s*@\s*\$([\d.]+)/i);
        if (hrsAtRate) {
          review.hours = Math.round(parseFloat(hrsAtRate[1].replace(',', '')));
          review.rate  = parseFloat(hrsAtRate[2]);
        } else {
          const rateMatch = block.match(/\$([\d.]+)\/hr/);
          if (rateMatch) review.rate = parseFloat(rateMatch[1]);
          const hrsMatch = block.match(/(\d+)\s+hrs?/i);
          if (hrsMatch) review.hours = parseInt(hrsMatch[1]);
        }

        const billedMatch = block.match(/Billed:\s*\$([\d,.]+)/i);
        if (billedMatch) review.billed = '$' + billedMatch[1];

        if (ratingValues[ri] !== undefined) review.rating = ratingValues[ri];

        if (review.date_from || review.feedback) reviews.push(review);
      }
    }

    return reviews;
  }

  // ── Find the history section's pagination buttons ──────────────────────────
  // Looks for a consecutive run of number buttons: 1, 2, 3, … N
  // This sequence is unique to the client history paginator on the job page.
  function findHistoryPageButtons() {
    const buttons = [...document.querySelectorAll('button')];
    for (let i = 0; i < buttons.length - 1; i++) {
      const n = parseInt(buttons[i].textContent.trim());
      const next = parseInt(buttons[i + 1]?.textContent.trim());
      if (n === 1 && next === 2) {
        const seq = [buttons[i], buttons[i + 1]];
        let j = i + 2;
        while (j < buttons.length) {
          const k = parseInt(buttons[j].textContent.trim());
          if (k === seq.length + 1) { seq.push(buttons[j]); j++; }
          else break;
        }
        return seq; // [btn_1, btn_2, btn_3, btn_4, …]
      }
    }
    return [];
  }

  // ── Scrape all review pages by clicking through pagination ─────────────────
  async function scrapeAllReviews() {
    const allReviews = [];
    const seen = new Set();

    const addReviews = (pageReviews) => {
      for (const r of pageReviews) {
        const key = [r.date_from, r.date_to, r.billed, r.feedback].filter(Boolean).join('|');
        if (!seen.has(key)) { seen.add(key); allReviews.push(r); }
      }
    };

    // Page 1 — already rendered
    const body1 = document.body.innerText;
    const hist1 = body1.match(/Client'?s?\s+recent\s+history([\s\S]*)/i);
    if (!hist1) return [];
    addReviews(parseHistoryFromText(hist1[1]));

    // Check for pagination
    const pageButtons = findHistoryPageButtons();
    console.log('[Cockpit] History pages found:', pageButtons.length);
    if (pageButtons.length <= 1) return allReviews;

    // Click pages 2, 3, 4, … in order
    for (let p = 1; p < pageButtons.length; p++) {
      // Re-query to get fresh DOM reference (SPA may recreate buttons after each click)
      const freshBtns = findHistoryPageButtons();
      const btn = freshBtns[p];
      if (!btn) break;

      const prevText = document.body.innerText;
      btn.click();

      // Wait up to 3 s for content to change
      for (let t = 0; t < 15; t++) {
        await new Promise(r => setTimeout(r, 200));
        if (document.body.innerText !== prevText) break;
      }

      const newBody = document.body.innerText;
      if (newBody === prevText) { console.log('[Cockpit] Page', p + 1, 'did not load — stopping'); break; }

      const newHist = newBody.match(/Client'?s?\s+recent\s+history([\s\S]*)/i);
      if (!newHist) break;

      const pageReviews = parseHistoryFromText(newHist[1]);
      console.log('[Cockpit] Page', p + 1, '— reviews:', pageReviews.length);
      if (pageReviews.length === 0) break;
      addReviews(pageReviews);
    }

    return allReviews;
  }

  // Wait until the client sidebar has rendered (hire rate, Member since, Payment, etc.)
  // Falls back to maxWait if none of these ever appear.
  async function waitForClientSection(maxWait = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const t = document.body.innerText;
      if (t.includes('hire rate') || t.includes('Member since') ||
          t.includes('Payment verified') || t.includes('Payment method') ||
          t.includes('jobs posted')) return;
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Wait for the "Activity on this job" sidebar (Proposals, hire rate, last
  // viewed, interviewing). Upwork hydrates this AFTER document_idle, so without
  // waiting we frequently scrape before it exists → backend gets job_id but no
  // enrichment fields → the popup shows "Backend returned OK but no enrichment
  // fields". Wait up to 6s; fall through anyway if it never appears (some jobs
  // legitimately don't show it).
  async function waitForActivityPanel(maxMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const t = document.body.innerText || '';
      if (/Proposals:\s*[\n\r\s]*\S/i.test(t)) return true;
      if (/\d+%\s+hire rate/i.test(t)) return true;
      if (/Last viewed by client/i.test(t)) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  }

  async function run() {
    try {
      // Wait for BOTH panels in parallel — they hydrate independently.
      await Promise.all([waitForClientSection(), waitForActivityPanel()]);

      let data = extractData();

      if (!data.job_id) {
        console.log('[Cockpit] No job ID found, skipping.');
        return;
      }

      // If the activity panel still wasn't rendered (both proposals AND
      // hire_rate null), give it one more chance — Upwork is sometimes
      // staggered enough that a second re-extract picks it up.
      if (!data.proposals && data.hire_rate == null) {
        console.log('[Cockpit] Activity panel empty on first pass — waiting 1.5s and re-extracting…');
        await new Promise(r => setTimeout(r, 1500));
        data = extractData();
      }
      if (!data.proposals && data.hire_rate == null) {
        console.warn('[Cockpit] ⚠ Activity sidebar never appeared — proposals/hire_rate will be empty in DB. The page may have rendered behind a tab, or Upwork is throttling. Reload the job page and try the popup ↻ button.');
      }

      // Scrape all review pages (handles pagination automatically)
      try {
        const reviews = await scrapeAllReviews();
        if (reviews.length) {
          data.client_reviews = JSON.stringify(reviews);
          console.log('[Cockpit] Total reviews scraped:', reviews.length);
        }
      } catch (e) {
        console.log('[Cockpit] Review scraping error:', e);
      }

      console.log('[Cockpit] Extracted:', data);

      // Send to background with callback to confirm delivery
      chrome.runtime.sendMessage({ type: 'ENRICH_JOB', data }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Cockpit] ❌ Message error:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.ok) {
          console.log('[Cockpit] ✅ Sent to backend successfully');
        } else {
          console.error('[Cockpit] ❌ Backend error:', response && response.error);
        }
      });

    } catch (err) {
      console.error('[Cockpit] Error:', err);
    }
  }

  run();

  function isJobUrl(url) {
    return /upwork\.com\/jobs\/~/.test(url) ||
           /job-details-viewer/.test(url) ||
           /upwork\.com\/nx\/jobs\/[0-9a-f~]/.test(url);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isJobUrl(location.href)) {
        setTimeout(run, 1000);
      }
    }
  }).observe(document, { subtree: true, childList: true });

  window.addEventListener('popstate', () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isJobUrl(location.href)) {
        setTimeout(run, 1000);
      }
    }
  });

})();
