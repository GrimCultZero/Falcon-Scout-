"""
Generate sized icon files from the master Falcon Scout mark.

Source canvas is wider than the mark itself, so we:
  1. Find the bounding box of non-transparent pixels.
  2. Pad to a square (preserves aspect, no distortion).
  3. Resize to each target size with LANCZOS.

Outputs:
  - frontend/public/favicon.png            (32x32)
  - upwork-enricher/icon{16,32,48,128}.png
  - upwork-enricher/falcon-scout-mark.png  (256x256, for popup.html)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent
SRC = ROOT / "frontend" / "public" / "falcon-scout-mark.png"

OUTPUTS = [
    # Browser tab favicons — provide multiple sizes; the browser picks the best
    (ROOT / "frontend" / "public" / "favicon-16.png", 16),
    (ROOT / "frontend" / "public" / "favicon-32.png", 32),
    (ROOT / "frontend" / "public" / "favicon.png", 64),       # default <link>
    (ROOT / "frontend" / "public" / "favicon-128.png", 128),
    # Chrome extension toolbar (Chrome picks 16 for normal, 32 for HiDPI)
    (ROOT / "upwork-enricher" / "icon16.png", 16),
    (ROOT / "upwork-enricher" / "icon32.png", 32),
    (ROOT / "upwork-enricher" / "icon48.png", 48),
    (ROOT / "upwork-enricher" / "icon128.png", 128),
    # 256 PNG used by popup.html
    (ROOT / "upwork-enricher" / "falcon-scout-mark.png", 256),
]

def main():
    if not SRC.exists():
        raise SystemExit(f"Source not found: {SRC}")

    img = Image.open(SRC).convert("RGBA")
    print(f"Source: {SRC.name}  {img.size}")

    # 1. Crop to non-transparent bounding box
    bbox = img.getbbox()
    if bbox:
        cropped = img.crop(bbox)
        print(f"  Cropped to: {cropped.size}  (bbox={bbox})")
    else:
        cropped = img

    # 2. Pad to square (center the mark on a transparent square canvas)
    w, h = cropped.size
    side = max(w, h)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - w) // 2, (side - h) // 2), cropped)
    print(f"  Squared:    {square.size}")

    # 3. Resize to each target
    for out_path, size in OUTPUTS:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        resized = square.resize((size, size), Image.LANCZOS)
        resized.save(out_path, "PNG", optimize=True)
        print(f"  OK  {out_path.relative_to(ROOT)}  {size}x{size}  ({out_path.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
