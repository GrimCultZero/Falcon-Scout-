# PDF Export — Developer Handoff

## Goal
Convert `gkit_preview.html` into a clean 8-page PDF with **real vector text** (not screenshots). One PDF page per slide.

---

## The HTML File

**File:** `gkit_preview.html`  
**Size:** ~5.5 MB (images are base64-embedded inside the HTML — no external image files needed)  
**Lines:** ~2,654  
**Font:** Inter, loaded from Google Fonts CDN (`@import url('https://fonts.googleapis.com/...')`)

### Slide Architecture

8 slides, all stacked in the DOM with `position: absolute`. JS toggles which one is visible:

```css
.slide {
  position: absolute;
  inset: 0;
  display: none;       /* hidden by default */
  overflow: hidden;
}
.slide.active {
  display: flex;       /* only one active at a time */
}
```

Slide IDs: `#s1` through `#s8`  
The stage (wrapper) uses viewport-relative sizing:

```css
.stage {
  width:  min(100vw, 177.8vh);   /* 16:9 ratio */
  height: min(56.25vw, 100vh);
}
```

At a 1600×900 viewport both resolve to exactly **1600×900px**.

### What's Inside Each Slide
- Dark navy/white card layouts with CSS Grid/Flexbox
- CSS custom properties (`--dark`, `--accent`, etc.)
- `clamp()` for responsive font sizes
- Base64-embedded photos (analytics screenshots, sneaker images, browser mockups)
- No external dependencies except Google Fonts

---

## The Problem: HTML → PDF

### Why standard tools fail

| Tool | Problem |
|------|---------|
| Browser Ctrl+P on `gkit_preview.html` | Only prints the active slide; others are `display:none` |
| Browser Ctrl+P on stacked `gkit_print.html` | Backgrounds break in print mode (`@media print` strips dark backgrounds) |
| `page.pdf()` on the interactive file | Chrome switches to print layout → `vw`/`vh` units collapse → stage loses its 1600×900 dimensions |
| Screenshot → image PDF | Text is rasterized; blurry at zoom, quality loss |
| WeasyPrint / wkhtmltopdf | No JS support; layout requires JS-resolved viewport units |

### Root Cause
The stage size relies on `min(100vw, 177.8vh)`. In **print mode**, Chrome recalculates the layout for a paper page — `vw`/`vh` no longer mean "the browser window." The stage collapses and the slide layout breaks.

---

## What We've Tried

1. **`gkit_print.html`** — a separate file with all 8 slides stacked, each `display: flex`, `break-after: page`. Works for Ctrl+P but backgrounds go white due to print media stripping.
2. **Puppeteer `page.screenshot()` per slide** → combined with `img2pdf` / `reportlab` / `pdfkit`. Screenshots are correct at 1600×900, but text is rasterized (not vector). PDF viewer zoom/display also caused apparent cropping.
3. **Puppeteer `page.pdf()` per slide** with CSS override to lock `vw`/`vh` to fixed px before calling `page.pdf()`. Most promising approach — not yet confirmed working.

### Most Promising Fix (untested to completion)

```js
// Before calling page.pdf(), inject this CSS:
await page.evaluate((w, h) => {
  const style = document.createElement('style');
  style.textContent = `
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body { width: ${w}px !important; height: ${h}px !important;
                 overflow: hidden !important; background: transparent !important; margin: 0 !important; }
    .stage  { width: ${w}px !important; height: ${h}px !important; }
    .slide  { width: ${w}px !important; height: ${h}px !important; overflow: hidden !important; }
    .controls, .btn-fs, .btn-edit, .edit-bar { display: none !important; }
  `;
  document.head.appendChild(style);
}, 1600, 900);

// Then per slide:
await page.pdf({
  path: `_slide_${i+1}.pdf`,
  width: '1600px',
  height: '900px',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
```

Then merge the 8 PDFs with `pypdf`.

---

## Current Scripts

| File | Purpose |
|------|---------|
| `make_pdf.bat` | One-click runner: installs deps, runs JS then Python |
| `make_pdf.js` | Puppeteer: activates each slide, generates `_slide_N.pdf` |
| `make_pdf.py` | pypdf: merges 8 PDFs → `GKit_CaseStudy_ITForce.pdf`, sets OpenAction /Fit |

---

## Likely Path Forward

1. Confirm the CSS override fully prevents layout collapse in print mode (check if dark backgrounds appear)
2. If backgrounds still strip — try `page.emulateMediaType('screen')` before `page.pdf()` so Chrome never switches to print mode at all
3. If fonts don't embed — add `await page.waitForTimeout(2000)` after navigation for Google Fonts CDN to load, or self-host Inter
4. Verify merged PDF opens correctly in Adobe (page size should be 1600×900 pt or 960×540 pt for standard presentation size)

---

## Environment
- Windows 11, Node.js installed, Python 3.14 installed
- Puppeteer installed locally (`node_modules/` in the same folder)
- `pypdf`, `img2pdf`, `Pillow` installed via pip
- File served from `file://` (no HTTP server needed for puppeteer)
