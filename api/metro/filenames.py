"""Names for every file Metro offers for download (METRO_TASK.md F4, item 5).

The first live download ("metro-email-finder-campaign-1.csv") overwrote an export of the same name in Oleh's own folder.
Every name now carries the campaign, what the file is, and the date AND time, so two downloads can never collide with each
other or with a file Oleh keeps: metro_<campaign>_<what>_<YYYY-MM-DD>_<HHMMSS>.<ext>   (the machine's local time, Kyiv).
"""
from __future__ import annotations

import re
from datetime import datetime


def slug(text: str | None, limit: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:limit].strip("-")
    return s or "campaign"


def download_name(campaign_name: str | None, what: str, ext: str = "csv", now: datetime | None = None) -> str:
    stamp = (now or datetime.now()).strftime("%Y-%m-%d_%H%M%S")
    return f"metro_{slug(campaign_name)}_{slug(what, 30)}_{stamp}.{ext.lstrip('.')}"


def content_disposition(name: str) -> str:
    return f'attachment; filename="{name}"'
