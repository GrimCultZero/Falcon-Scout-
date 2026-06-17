/* ============================================================================
 * GKit Case Study — HTML → PDF  (vector text, 1:1 with the browser)
 * ----------------------------------------------------------------------------
 * Portable single-pass generator. Uses ABSOLUTE paths, so it runs correctly no
 * matter which folder you launch it from — it reuses the Puppeteer install and
 * reads the source HTML from their known locations in "Web Development addon".
 *
 * How it stays pixel-faithful to the browser:
 *   - emulateMediaType('screen')  → Chrome never enters print layout, so the
 *     stage's min(100vw,177.8vh) sizing and every clamp(...,Xvw,...) font size
 *     keep resolving against the real 1600x900 viewport (the root-cause fix).
 *   - The 8 absolute/overlapping slides are reflowed into a vertical stack of
 *     page-sized blocks → one page.pdf() call emits all 8 pages, vector text.
 *   - printBackground + print-color-adjust:exact keep the dark backgrounds.
 *
 * The source HTML is never modified on disk.
 * ==========================================================================*/
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

// ── Absolute locations (edit here if the project ever moves) ───────────────
const ADDON = 'C:\\Users\\syzov\\upwork-cockpit\\Web Development addon';
const SRC   = path.join(ADDON, 'gkit_preview.html');
const OUT   = path.join(ADDON, 'GKit_CaseStudy_ITForce.pdf');

// Resolve Puppeteer *as if* required from the addon folder, so its package
// "exports"/"main" mapping and nested deps resolve correctly no matter where
// this script is launched from.
const addonRequire = createRequire(path.join(ADDON, 'package.json'));
const puppeteer = addonRequire('puppeteer');
const { PDFDocument, PDFName, PDFArray } = addonRequire('pdf-lib');

// 16:9 stage, in CSS px. Rendered at 2560x1440 — NOT 1600x900 — on purpose:
// the slides use clamp(min, Xvw, max) font sizes that hit their max caps only
// at a wide viewport. At 1600px the fonts are proportionally too large and the
// bottom of content-heavy slides (2–6) overflows the 900px box and gets clipped
// by overflow:hidden. At 2560x1440 every slide fits with zero overflow, exactly
// as the deck looks in a full-width browser window. Aspect is identical (16:9),
// so it's still one slide per page; vector text stays crisp at any display size.
const W = 2560, H = 1440;

// Stamp the PDF so viewers OPEN it showing the whole slide (Fit Page) and show
// one slide at a time. Without this, Adobe opens a wide landscape page at Fit
// WIDTH — you see only the top of each slide and it looks "cut off". Operates
// on the rendered bytes; returns new bytes with the catalog entries set.
async function setOpenFitPage(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const first = pdf.getPage(0).ref;
  // Explicit destination: [ <page> /Fit ] → fit the whole page in the window
  const dest = PDFArray.withContext(pdf.context);
  dest.push(first);
  dest.push(PDFName.of('Fit'));
  const action = pdf.context.obj({ Type: 'Action', S: 'GoTo' });
  action.set(PDFName.of('D'), dest);
  pdf.catalog.set(PDFName.of('OpenAction'), action);
  pdf.catalog.set(PDFName.of('PageLayout'), PDFName.of('SinglePage'));
  return pdf.save();
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error('Source HTML not found:\n  ' + SRC); process.exit(1); }

  console.log('Launching headless Chrome…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

  console.log('Loading HTML…');
  await page.goto('file:///' + SRC.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

  // Wait for Inter (Google Fonts CDN) so glyph metrics match the screen render.
  await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
  await new Promise(r => setTimeout(r, 1200));

  const slideCount = await page.evaluate(() => document.querySelectorAll('.stage .slide').length);
  console.log(`Found ${slideCount} slides.`);

  // Keep SCREEN media during page.pdf() — the whole trick.
  await page.emulateMediaType('screen');

  // Reflow into a print-ready stack (all overrides injected last, !important).
  await page.evaluate((w, h) => {
    const style = document.createElement('style');
    style.textContent = `
      @page { size: ${w}px ${h}px; margin: 0; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body {
        width: ${w}px !important; height: auto !important;
        margin: 0 !important; padding: 0 !important;
        background: #0A0A0A !important; overflow: visible !important; display: block !important;
      }
      .controls, .btn-fs, .btn-edit, .edit-bar, #floatToolbar, #saveBtn { display: none !important; }
      .stage {
        position: static !important; width: ${w}px !important; height: auto !important;
        min-width: 0 !important; max-width: none !important;
        min-height: 0 !important; max-height: none !important;
      }
      .stage .slide {
        position: relative !important; inset: auto !important; display: flex !important;
        width: ${w}px !important; height: ${h}px !important; overflow: hidden !important;
        break-inside: avoid !important; page-break-inside: avoid !important;
        break-after: page !important; page-break-after: always !important;
      }
      .stage .slide:last-of-type { break-after: auto !important; page-break-after: auto !important; }
    `;
    document.head.appendChild(style);
  }, W, H);

  await new Promise(r => setTimeout(r, 400));

  console.log('Rendering PDF (single pass, vector text)…');
  const rawBytes = await page.pdf({
    width: `${W}px`, height: `${H}px`,
    printBackground: true, preferCSSPageSize: false,
    pageRanges: `1-${slideCount}`,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();

  console.log('Setting "open at Fit Page"…');
  const finalBytes = await setOpenFitPage(rawBytes);

  // Write to a temp file then swap into place — survives the target being open
  // in Adobe (Windows locks the file): falls back to *_NEW.pdf.
  const tmpPath = OUT + '.tmp';
  fs.writeFileSync(tmpPath, finalBytes);

  let saved = OUT;
  try {
    fs.renameSync(tmpPath, OUT);
  } catch (e) {
    saved = OUT.replace(/\.pdf$/i, '_NEW.pdf');
    fs.renameSync(tmpPath, saved);
    console.warn('\n⚠ The main PDF is open in another program (likely Adobe) — could not overwrite it.');
    console.warn('  Wrote ' + path.basename(saved) + ' instead. Close the viewer and run again to update the main file.');
  }

  const mb = (fs.statSync(saved).size / 1048576).toFixed(1);
  console.log('\n✓ Saved to:\n  ' + saved + '\n  (' + slideCount + ' pages, ' + mb + ' MB, vector text)');
})().catch(e => { console.error(e); process.exit(1); });
