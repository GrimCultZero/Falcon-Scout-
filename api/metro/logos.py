"""Company logos (P3b, Minor fixes #2, 27 Nov 2026): a small thumbnail for the Leads rows, the lead panel and the shortlist.

Sources, cheapest first, and NEVER an extra LinkedIn visit just for a logo (Oleh):
  (a) the company's own website, which the enrich run reads anyway: <link rel="apple-touch-icon">, <meta property="og:image">,
      <link rel="icon">, then /favicon.ico (DevScout's /api/company-logo and extension/img-thumb.js do the same);
  (b) later: the LinkedIn company page when a deep reading visits it anyway, or a logo column in a Linked Helper export
      (`store_from_url` takes a URL from either; nothing calls LinkedIn from here).
The image is shrunk to at most 64 x 64 and kept only when the result is 20 KB or less, as a data: URL on the company
(`logo_data`, `logo_source`). No logo = the page shows the company's initials. Pure parsing is separate from fetching (tests).
"""
from __future__ import annotations

import base64
import html as _html
import io
import re
import threading
import time
from typing import Callable
from urllib.parse import urljoin, urlparse

from sqlalchemy.orm import Session

from .db import MetroCampaign, MetroCompany, MetroLead, get_engine

MAX_BYTES = 20 * 1024          # what is stored
MAX_DOWNLOAD = 600 * 1024      # what is read before shrinking
THUMB = 64
BytesFetcher = Callable[[str], tuple[int, str, bytes]]      # url -> (status, content type, body)

_LINK = re.compile(r"<link\b[^>]*>", re.I)
_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR = re.compile(r"""([a-zA-Z:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""")


def _attrs(tag: str) -> dict:
    return {k.lower(): _html.unescape(v.strip("\"'")) for k, v in _ATTR.findall(tag)}


def _size(sizes: str | None) -> int:
    m = re.search(r"(\d+)\s*x\s*(\d+)", sizes or "", re.I)
    return int(m.group(1)) if m else 0


def candidates(page_html: str, base_url: str) -> list[tuple[str, str]]:
    """[(source, absolute url)] in the order they are tried: apple-touch-icon (largest first), og:image, icon (largest first),
    /favicon.ico. Pure."""
    touch, icons, og = [], [], []
    for tag in _LINK.findall(page_html or ""):
        a = _attrs(tag)
        rel, href = (a.get("rel") or "").lower(), a.get("href")
        if not href or href.startswith("data:"):
            continue
        if "apple-touch-icon" in rel:
            touch.append((_size(a.get("sizes")), urljoin(base_url, href)))
        elif re.search(r"(^|\s)icon(\s|$)", rel) or rel == "shortcut icon":
            icons.append((_size(a.get("sizes")) + (5 if href.lower().endswith((".png", ".svg")) else 0), urljoin(base_url, href)))
    for tag in _META.findall(page_html or ""):
        a = _attrs(tag)
        if (a.get("property") or a.get("name") or "").lower() in ("og:image", "og:image:url", "twitter:image") and a.get("content"):
            og.append(urljoin(base_url, a["content"]))
    out = [("apple-touch-icon", u) for _s, u in sorted(touch, key=lambda x: -x[0])]
    out += [("og:image", u) for u in og[:1]]
    out += [("icon", u) for _s, u in sorted(icons, key=lambda x: -x[0])]
    out.append(("favicon.ico", urljoin(base_url, "/favicon.ico")))
    seen, uniq = set(), []
    for src, u in out:
        if u not in seen and urlparse(u).scheme in ("http", "https"):
            seen.add(u)
            uniq.append((src, u))
    return uniq


def thumbnail(data: bytes, ctype: str = "") -> str | None:
    """A data: URL of at most MAX_BYTES, or None. Raster images are shrunk to THUMB px; a small SVG is kept as it is."""
    if not data:
        return None
    if "svg" in (ctype or "").lower() or data.lstrip()[:5].lower() in (b"<svg ", b"<?xml"):
        if len(data) <= MAX_BYTES and b"<svg" in data[:2000].lower():
            return "data:image/svg+xml;base64," + base64.b64encode(data).decode("ascii")
        return None
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        im.load()
        if getattr(im, "n_frames", 1) > 1:
            im.seek(0)
        im = im.convert("RGBA")
        if im.width < 16 or im.height < 16:
            return None                         # a 1 px tracker or a broken icon
        im.thumbnail((THUMB, THUMB))
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        out = buf.getvalue()
        if len(out) > MAX_BYTES:
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="JPEG", quality=80)
            out, kind = buf.getvalue(), "jpeg"
        else:
            kind = "png"
        return f"data:image/{kind};base64," + base64.b64encode(out).decode("ascii") if len(out) <= MAX_BYTES else None
    except Exception:
        return None


def http_bytes_fetcher(timeout: float = 10.0) -> BytesFetcher:
    import httpx
    from .webscan import USER_AGENT, is_public_host

    def fetch(url: str) -> tuple[int, str, bytes]:
        if not is_public_host(urlparse(url).hostname or ""):
            return 0, "", b""
        try:
            with httpx.Client(follow_redirects=True, timeout=timeout, headers={"User-Agent": USER_AGENT}) as c:
                with c.stream("GET", url) as r:
                    if not is_public_host(r.url.host or ""):
                        return 0, "", b""
                    buf = b""
                    for chunk in r.iter_bytes():
                        buf += chunk
                        if len(buf) > MAX_DOWNLOAD:
                            return r.status_code, r.headers.get("content-type", ""), b""
                    return r.status_code, r.headers.get("content-type", ""), buf
        except Exception:
            return 0, "", b""
    return fetch


def find_logo(domain: str, fetch_text: Callable[[str], tuple[int, str, str]], fetch_bytes: BytesFetcher, *,
              sleep: Callable[[float], None] = time.sleep, pace: float = 0.5, max_tries: int = 4) -> dict | None:
    """Read the home page, try the candidates in order, return {"data", "source", "url"} for the first usable one."""
    status, final, page = fetch_text(f"https://{domain}/")
    base = final or f"https://{domain}/"
    if not (status and 200 <= status < 400):
        page = ""
    for n, (src, url) in enumerate(candidates(page, base)[:max_tries]):
        if n:
            sleep(pace)
        st, ctype, body = fetch_bytes(url)
        if not (st and 200 <= st < 300 and body):
            continue
        if ctype and not ctype.lower().startswith("image") and "octet-stream" not in ctype.lower() and not url.lower().endswith(".ico"):
            continue
        data = thumbnail(body, ctype)
        if data:
            return {"data": data, "source": src, "url": url}
    return None


def store_logo(company: MetroCompany, found: dict | None) -> bool:
    if not found:
        return False
    company.logo_data, company.logo_source = found["data"], found["source"]
    return True


def store_from_url(company: MetroCompany, url: str, source: str, fetch_bytes: BytesFetcher | None = None) -> bool:
    """(b) / (c): a logo URL that a LinkedIn page reading or a Linked Helper export already carries (no extra visit is made here
    for LinkedIn: the URL is an image on LinkedIn's media host, read once)."""
    if company.logo_data or not url:
        return False
    st, ctype, body = (fetch_bytes or http_bytes_fetcher())(url)
    data = thumbnail(body, ctype) if st and 200 <= st < 300 else None
    return store_logo(company, {"data": data, "source": source, "url": url} if data else None)


# ───────────────────────── a backfill run (background, paced; companies already enriched before P3b) ─────────────────────────

class LogosRun:
    lock = threading.Lock()
    state: dict = {"running": False}
    stop_flag = threading.Event()


def missing(s: Session, campaign_id: int) -> list[int]:
    ids = {cid for (cid,) in s.query(MetroLead.company_id).filter(MetroLead.campaign_id == campaign_id, MetroLead.company_id.isnot(None)).all()}
    if not ids:
        return []
    return [c.id for c in s.query(MetroCompany).filter(MetroCompany.id.in_(ids), MetroCompany.domain.isnot(None),
                                                          MetroCompany.logo_data.is_(None)).order_by(MetroCompany.id).all()]


def start_logos_run(campaign_id: int, *, fetch_text=None, fetch_bytes=None, sleep=time.sleep, background: bool = True) -> dict:
    from . import lines as _l
    from . import progress
    from .webscan import http_fetcher
    with Session(get_engine()) as s:
        if s.get(MetroCampaign, campaign_id) is None:
            return {"started": False, "reason": "no such campaign"}
        ids = missing(s, campaign_id)
    if not ids:
        return {"started": False, "reason": "every company with a website already has a logo (or none has a website yet)"}
    with LogosRun.lock:
        if LogosRun.state.get("running"):
            return {"started": False, "reason": "a logo run is already going"}
        LogosRun.stop_flag.clear()
        rid = progress.start("logos", "Reading company logos", total=len(ids), campaign_id=campaign_id,
                             stop=LogosRun.stop_flag.set, by_click=True)
        LogosRun.state = {"running": True, "found": 0, "done": 0}
    fetch_text = fetch_text or http_fetcher(timeout=10.0)
    fetch_bytes = fetch_bytes or http_bytes_fetcher()

    def work():
        st = LogosRun.state
        try:
            for cid in ids:
                if LogosRun.stop_flag.is_set():
                    st["stopped"] = True
                    break
                with Session(get_engine()) as s:
                    c = s.get(MetroCompany, cid)
                    progress.update(rid, current=c.name if c else str(cid), step="website logo")
                    dom = c.domain if c else None
                s_found = find_logo(dom, fetch_text, fetch_bytes, sleep=sleep) if dom else None      # no session open across the fetch
                if s_found:
                    with Session(get_engine()) as s:
                        c = s.get(MetroCompany, cid)
                        if c is not None and store_logo(c, s_found):
                            st["found"] += 1
                        s.commit()
                st["done"] += 1
                progress.update(rid, done=st["done"])
                sleep(1.0)
        finally:
            st["running"] = False
            progress.finish(rid, _l.line(f"Logos for {_l.plural(st['done'], 'company', 'companies')}" + (" (stopped)" if st.get("stopped") else ""),
                                         _l.part(st["found"], "found", "found"),
                                         _l.part(st["done"] - st["found"], "without a usable logo (initials shown)",
                                                 "without a usable logo (initials shown)")),
                            "stopped" if st.get("stopped") else "done")

    if background:
        threading.Thread(target=work, name="metro-logos", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(ids), "progress_id": rid}
