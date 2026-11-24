"""Reading a lead CSV (METRO_PLAN.md Phase 1, steps 2 and 6): Linked Helper "Profiles downloaded"
exports (comma OR semicolon delimited, BOM, 100+ columns), Sales Navigator / Apollo / hand-made
lists. Column detection is a port of DevScout's `detectCols` (src/utils/scoring.js), with two
changes: an exact header match wins over a "contains" match (so `email` is never read from
`email_type`), and a person's own website (`website_1`) is never taken for the company's.

Pure functions, no database. A row becomes a plain dict (`normalize_row`); the import pipeline
that dedups and stores it is in leads.py.

Linked Helper status (step 6). The "Profiles downloaded" files carry NO status column; the
campaign state is in these fields: `invited_date_iso` (a connection request was sent) and
`connected_at_iso` / `connected_at` / `member_distance` DISTANCE_1 (it was accepted). If a file does
have an explicit status column (a campaign-result export), "Successful" means accepted.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone

from .suppression import normalize

csv.field_size_limit(2 ** 31 - 1)

# Companies that are not a company: two people with these "names" are not colleagues.
GENERIC_COMPANIES = {
    "self-employed", "self employed", "selfemployed", "freelance", "freelancer", "independent", "stealth",
    "stealth startup", "confidential", "private", "n/a", "na", "none", "-", "--", "unemployed", "retired",
    "student", "own business", "my own company", "company", "consultant", "linkedin", "google",
}

_COL_KEYS = {
    "url":      ("profileurl", "linkedinprofileurl", "linkedinprofile", "profile", "linkedinurl", "profilelink", "memberprofileurl", "personlinkedinurl", "personlinkedin", "linkedin"),
    "member_id": ("memberid", "linkedinmemberid", "liid"),
    "public_id": ("publicid",),
    "name":     ("fullname",),
    "first":    ("firstname",),
    "last":     ("lastname",),
    "headline": ("headline", "jobtitle", "title"),
    "location": ("locationname", "location", "geography", "geo", "region", "personcity", "memberlocation", "personlocation"),
    "distance": ("memberdistance", "distance", "degree"),
    "summary":  ("summary", "about", "bio"),
    "company":  ("currentcompany", "organization", "companyname", "company"),
    "position": ("currentcompanyposition", "position"),
    "org1":     ("organization1",),
    "org_title1": ("organizationtitle1",),
    "email":    ("email", "emailaddress", "email1", "workemail", "personalemail"),
    "email_type": ("emailtype",),
    "website":  ("companywebsite", "companydomain", "domain", "companyurl", "website"),
    "industry": ("companyindustry", "industry"),
    "job_seeker": ("badgesjobseeker",),
    "invited_iso": ("inviteddateiso",),
    "invited":  ("inviteddate",),
    "connected_iso": ("connectedatiso",),
    "connected": ("connectedat",),
    "status":   ("campaignstatus", "invitestatus", "connectionstatus", "linkedhelperstatus", "status", "result"),
}
# Only these may fall back to a "contains" match (odd headers like "Person Location (HQ)"); every
# other field needs an exact header, so e.g. `headline` never lands on `organization_title_1`.
_CONTAINS_OK = {"url", "location"}


def _key(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


def detect_cols(headers: list[str]) -> dict:
    """{field: header or None}. Exact match first (for every key in order), then "contains"."""
    keyed = [(h, _key(h)) for h in headers]
    out = {}
    for field, keys in _COL_KEYS.items():
        found = None
        for k in keys:
            found = next((h for h, kk in keyed if kk == k), None)
            if found:
                break
        if not found and field in _CONTAINS_OK:
            for k in keys:
                found = next((h for h, kk in keyed if k in kk and "company" not in kk and not kk.startswith("original")), None)
                if found:
                    break
        out[field] = found
    return out


def decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def read_csv(raw: bytes) -> tuple[list[dict], list[str], str]:
    """(rows as dicts, headers, delimiter). Linked Helper writes ';' in some locales and ',' in others."""
    text = decode(raw)
    first = text.split("\n", 1)[0]
    delim = ";" if first.count(";") > first.count(",") else ","
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delim)
    headers = [h.strip() for h in (reader.fieldnames or [])]
    rows = []
    for r in reader:
        row = {(k or "").strip(): (v or "").strip() for k, v in r.items() if k is not None}
        if any(row.values()):
            rows.append(row)
    return rows, headers, delim


def _parse_dt(iso: str | None, dotted: str | None = None) -> datetime | None:
    """Naive UTC, like the rest of the app. `iso` = 2026-03-10T15:55:48.424Z; `dotted` = 2026.03.24."""
    if iso:
        try:
            d = datetime.fromisoformat(iso.strip().replace("Z", "+00:00"))
            return d.astimezone(timezone.utc).replace(tzinfo=None) if d.tzinfo else d
        except ValueError:
            pass
    if dotted:
        for fmt in ("%Y.%m.%d", "%Y-%m-%d"):
            try:
                return datetime.strptime(dotted.strip()[:10], fmt)
            except ValueError:
                continue
    return None


_ACCEPTED_WORDS = ("successful", "success", "accepted", "connected")
_INVITED_WORDS = ("invited", "sent", "pending", "processing", "in progress", "waiting")


def company_key(name: str | None) -> str | None:
    """Normalized company name used to match companies across lists; None for generic names."""
    n = normalize("company", name or "")
    if not n or n in GENERIC_COMPANIES or len(n) < 2:
        return None
    n = re.sub(r"\s*[|•–—@].*$", "", n).strip()      # "Acme | Expert in X" -> "acme"
    n = re.sub(r"[^\w\s&+-]", "", n).strip()
    return n if n and n not in GENERIC_COMPANIES else None


def name_key(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").casefold()).strip()


def linkedhelper_status(row: dict, cols: dict) -> tuple[str, datetime | None, datetime | None]:
    """(invite_status, invited_at, connected_at) for one row. See the module docstring."""
    g = lambda f: row.get(cols[f], "") if cols.get(f) else ""
    invited_at = _parse_dt(g("invited_iso"))
    connected_at = _parse_dt(g("connected_iso"), g("connected"))
    explicit = g("status").strip().lower()
    if explicit:
        if any(w == explicit or w in explicit for w in _ACCEPTED_WORDS):
            return "connected", invited_at, connected_at
        if any(w in explicit for w in _INVITED_WORDS):
            return "invited", invited_at, None
    if connected_at or g("distance").strip().upper() == "DISTANCE_1":
        return "connected", invited_at, connected_at
    if invited_at:
        return "invited", invited_at, None
    return "none", None, None


def normalize_row(row: dict, cols: dict) -> dict:
    """One CSV row -> the lead fields Metro stores (before dedup)."""
    g = lambda f: (row.get(cols[f], "") if cols.get(f) else "").strip()
    name = g("name") or " ".join(x for x in (g("first"), g("last")) if x)
    member_id = normalize("member_id", re.sub(r"\.0+$", "", g("member_id"))) if g("member_id") else None
    profile_key = normalize("profile_url", g("url")) if g("url") else None
    if not profile_key and g("public_id"):
        profile_key = normalize("profile_url", "linkedin.com/in/" + g("public_id"))
    email = normalize("email", g("email")) if g("email") else None
    company = g("company") or g("org1")
    status, invited_at, connected_at = linkedhelper_status(row, cols)
    domain = normalize("domain", g("website")) if g("website") else None
    job_seeker = g("job_seeker").strip().lower() in ("true", "1", "yes")
    return {
        "full_name": name or None,
        "first_name": g("first") or (name.split(" ")[0] if name else None),
        "last_name": g("last") or None,
        "title": g("position") or g("org_title1") or g("headline") or None,
        "headline": g("headline") or None,
        "summary": g("summary") or None,
        "location": g("location") or None,
        "company_name": company or None,
        "company_key": company_key(company),
        "domain": domain,
        "member_id": member_id,
        "profile_key": profile_key,
        "profile_url": g("url") or None,
        "email": email,
        "email_type": g("email_type") or None,
        "invite_status": status,
        "invited_at": invited_at,
        "connected_at": connected_at,
        "job_seeker_badge": job_seeker,
        "name_company_key": (f"{name_key(name)}|{company_key(company)}" if name_key(name) and company_key(company) else None),
    }
