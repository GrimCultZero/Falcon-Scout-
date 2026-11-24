"""PageSpeed (METRO_PLAN.md Phase 2, step 3): Google's PageSpeed Insights API, mobile strategy.

Free to call without a key but rate limited; Oleh may put a key in Settings (`pagespeed_api_key`, never
logged, never returned by GET /metro/settings). A quota error is NOT stored as a snapshot: the previous
reading stays and the failure is reported. The score is Lighthouse's own performance score (0-100).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlencode

ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
JsonGetter = Callable[[str], tuple[int, dict]]


def http_json_getter(timeout: float = 90.0) -> JsonGetter:
    import httpx

    def get(url: str) -> tuple[int, dict]:
        try:
            r = httpx.get(url, timeout=timeout)
            try:
                return r.status_code, r.json()
            except Exception:
                return r.status_code, {}
        except Exception as e:
            return 0, {"error": {"message": type(e).__name__}}
    return get


def build_url(site_url: str, api_key: str | None = None) -> str:
    q = [("url", site_url), ("strategy", "mobile"), ("category", "performance")]
    if api_key:
        q.append(("key", api_key))
    return ENDPOINT + "?" + urlencode(q)


def parse(payload: dict, now: datetime | None = None) -> dict | None:
    """The snapshot from an API answer, or None when the answer has no Lighthouse result."""
    lh = (payload or {}).get("lighthouseResult") or {}
    perf = ((lh.get("categories") or {}).get("performance") or {}).get("score")
    if perf is None:
        return None
    audits = lh.get("audits") or {}

    def num(key):
        v = (audits.get(key) or {}).get("numericValue")
        return round(v, 3) if isinstance(v, (int, float)) else None

    field = (payload.get("loadingExperience") or {})
    return {"ok": True, "strategy": "mobile", "score": int(round(perf * 100)),
            "lcp_ms": num("largest-contentful-paint"), "fcp_ms": num("first-contentful-paint"),
            "tbt_ms": num("total-blocking-time"), "cls": num("cumulative-layout-shift"),
            "speed_index_ms": num("speed-index"), "field_category": field.get("overall_category"),
            "final_url": lh.get("finalUrl"), "fetched_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")}


def measure(site_url: str, get_json: JsonGetter, api_key: str | None = None, now: datetime | None = None) -> dict:
    status, payload = get_json(build_url(site_url, api_key))
    snap = parse(payload, now)
    if snap is not None:
        return snap
    msg = (((payload or {}).get("error") or {}).get("message") or "no result")[:200]
    return {"ok": False, "status": status, "error": ("quota or rate limit: " if status == 429 else "") + msg}
