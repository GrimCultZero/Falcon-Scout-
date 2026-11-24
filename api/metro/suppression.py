"""Metro suppression list: people, companies and addresses Metro must never write to.

Sources (METRO_PLAN.md Phase 0, step 7):
  * a CSV of LinkedIn member ids already contacted (`Claude outputs/already_contacted_member_ids.csv`);
  * the existing IT Force client list (from Artem, when available), any CSV with recognisable
    columns (member id, profile URL, email, domain/website, company);
  * Upwork clients, from the `proposals` table (read only).

Rules: an import only ever ADDS. Re-importing the same data adds nothing (unique kind+value).
Nothing is deleted. Values are normalized so the same person/company matches however it is
written. Scope: a member id, profile URL or person is `person`; a domain or company is `company`
(a reply or client mark the whole company); an email is `address` (a bounce suppresses only it).

Upwork clients are anonymous on Upwork: `proposals` and `jobs` hold no client name, company or
domain (checked 2026-11-24 on the live DB: 507 proposals, no such column, no captured names).
So each proposal is recorded as an `upwork_job` entry (its Upwork job id, with title, country,
city and status in `note`) so the list is complete and auditable, and a DOMAIN is added only when
the client's own text (their reply, or the job posting) names one, for proposals that reached
replied / interviewing / hired. Common platform domains are never added.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import MetroSuppression, utcnow

SCOPE_BY_KIND = {
    "member_id": "person",
    "profile_url": "person",
    "email": "address",
    "domain": "company",
    "company": "company",
    "upwork_job": "company",
}

# Domains a client may name that never identify the client itself.
PLATFORM_DOMAINS = {
    "upwork.com", "google.com", "youtube.com", "facebook.com", "instagram.com", "linkedin.com",
    "twitter.com", "x.com", "tiktok.com", "shopify.com", "myshopify.com", "wordpress.com",
    "wordpress.org", "wix.com", "squarespace.com", "webflow.io", "webflow.com", "amazon.com",
    "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "loom.com", "calendly.com",
    "docs.google.com", "drive.google.com", "bit.ly", "github.com", "notion.so", "canva.com",
    "semrush.com", "ahrefs.com", "hubspot.com", "zoom.us", "dropbox.com", "figma.com",
    "itforce.ua", "apple.com", "microsoft.com", "godaddy.com", "bigcommerce.com", "wikipedia.org",
}

_DOMAIN_RE = re.compile(r"\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|co|ca|us|uk|"
                        r"de|au|nl|fr|es|it|ch|se|no|dk|fi|ie|nz|be|at|pl|ae|in|agency|store|shop|app|ai|biz|info|health|clinic))\b",
                        re.I)


def normalize(kind: str, value) -> str | None:
    """The canonical form of a value, or None when it is not a valid value of that kind."""
    if value is None:
        return None
    v = str(value).strip()
    if not v:
        return None
    if kind == "member_id":
        v = v.lstrip("'\"").rstrip("'\"")
        return v if v.isdigit() else None
    if kind == "email":
        v = v.lower()
        return v if re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", v) else None
    if kind == "profile_url":
        m = re.search(r"linkedin\.com/(in|sales/lead|sales/people)/([^/?#\s]+)", v, re.I)
        return f"linkedin.com/{m.group(1).lower()}/{m.group(2).lower()}" if m else None
    if kind == "domain":
        v = v.lower()
        v = re.sub(r"^[a-z]+://", "", v)
        v = v.split("/")[0].split("?")[0].split("#")[0].split(":")[0]
        v = re.sub(r"^www\.", "", v).strip(".")
        return v if re.fullmatch(r"([a-z0-9-]+\.)+[a-z]{2,}", v) else None
    if kind == "company":
        v = re.sub(r"\s+", " ", v).strip().casefold()
        v = re.sub(r"[,.]?\s+(inc|llc|ltd|limited|gmbh|corp|corporation|co)\.?$", "", v)
        return v or None
    if kind == "upwork_job":
        v = v.lstrip("~")
        return v if re.fullmatch(r"[0-9a-z]+", v, re.I) else None
    raise ValueError(f"unknown suppression kind: {kind}")


@dataclass
class ImportResult:
    added: int = 0
    already: int = 0
    invalid: int = 0
    by_kind: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"added": self.added, "already": self.already, "invalid": self.invalid, "by_kind": self.by_kind}


def add_entries(s: Session, entries: Iterable[dict], *, source: str, dry_run: bool = False) -> ImportResult:
    """Add {kind, value, reason?, note?} entries. Idempotent; never deletes; commits unless dry_run."""
    res = ImportResult()
    have = {(r.kind, r.value) for r in s.query(MetroSuppression.kind, MetroSuppression.value).all()}
    for e in entries:
        kind = e["kind"]
        value = normalize(kind, e.get("value"))
        if value is None:
            res.invalid += 1
            continue
        if (kind, value) in have:
            res.already += 1
            continue
        have.add((kind, value))
        res.added += 1
        res.by_kind[kind] = res.by_kind.get(kind, 0) + 1
        if not dry_run:
            s.add(MetroSuppression(kind=kind, value=value, scope=SCOPE_BY_KIND[kind],
                                   reason=(e.get("reason") or None), source=source,
                                   note=(e.get("note") or None), created_at=utcnow()))
    if dry_run:
        s.rollback()
    else:
        s.commit()
    return res


# Header names (lower-cased, spaces/underscores removed) mapped to a suppression kind.
_COLUMN_KINDS = {
    "memberid": "member_id", "linkedinmemberid": "member_id", "liid": "member_id",
    "profileurl": "profile_url", "linkedinurl": "profile_url", "linkedinprofile": "profile_url",
    "linkedinprofileurl": "profile_url", "profile": "profile_url", "personlinkedinurl": "profile_url",
    "email": "email", "emailaddress": "email", "workemail": "email",
    "domain": "domain", "website": "domain", "companydomain": "domain", "companywebsite": "domain", "url": "domain",
    "company": "company", "companyname": "company", "organization": "company", "client": "company", "clientname": "company",
}
_REASON_COLUMNS = ("src", "source", "reason", "status", "note")


def entries_from_csv(data: str, *, default_reason: str) -> tuple[list[dict], list[str]]:
    """Read a CSV; every recognised column on every row becomes an entry. Returns (entries, columns used)."""
    reader = csv.DictReader(io.StringIO(data.lstrip("﻿")))
    cols = {}
    for h in reader.fieldnames or []:
        key = re.sub(r"[\s_\-]", "", (h or "").lower())
        if key in _COLUMN_KINDS:
            cols[h] = _COLUMN_KINDS[key]
    reason_col = next((h for h in (reader.fieldnames or []) if (h or "").lower() in _REASON_COLUMNS), None)
    out = []
    for row in reader:
        reason = (row.get(reason_col) or "").strip() if reason_col else ""
        for h, kind in cols.items():
            if (row.get(h) or "").strip():
                out.append({"kind": kind, "value": row[h], "reason": reason or default_reason})
    return out, sorted(cols)


_ENGAGED = ("replied", "interviewing", "hired")


def entries_from_proposals(s: Session) -> list[dict]:
    """Upwork clients, read from proposals + jobs (read only; see the module docstring)."""
    rows = s.execute(text(
        "SELECT p.status, j.upwork_job_id, j.title, j.client_country, j.client_city, "
        "       p.client_reply_text, j.description_full, j.description_snippet "
        "FROM proposals p JOIN jobs j ON j.id = p.job_id")).fetchall()
    out = []
    for status, job_uid, title, country, city, reply, desc_full, desc in rows:
        where = ", ".join(x for x in (city, country) if x)
        note = f"{(title or '').strip()[:120]} | {where or 'location unknown'} | proposal {status}"
        out.append({"kind": "upwork_job", "value": job_uid, "reason": f"upwork client (proposal {status})", "note": note})
        if status in _ENGAGED:
            for blob, where_from in ((reply, "client reply"), (desc_full or desc, "job posting")):
                for d in sorted({m.group(1).lower() for m in _DOMAIN_RE.finditer(blob or "")}):
                    nd = normalize("domain", d)
                    if not nd or nd in PLATFORM_DOMAINS or any(nd.endswith("." + p) for p in PLATFORM_DOMAINS):
                        continue
                    out.append({"kind": "domain", "value": nd,
                                "reason": f"upwork client (proposal {status})",
                                "note": f"named in the {where_from}: {note}"})
    return out


def stats(s: Session) -> dict:
    rows = s.execute(text("SELECT kind, scope, COUNT(*) FROM metro_suppression GROUP BY kind, scope")).fetchall()
    total = sum(r[2] for r in rows)
    return {"total": total, "by_kind": {r[0]: r[2] for r in rows}}


def is_suppressed(s: Session, *, member_id=None, profile_url=None, email=None, domain=None, company=None) -> list[dict]:
    """Every suppression entry that matches any of the given identifiers (empty list = not suppressed)."""
    hits = []
    for kind, value in (("member_id", member_id), ("profile_url", profile_url), ("email", email),
                        ("domain", domain), ("company", company)):
        nv = normalize(kind, value) if value else None
        if not nv:
            continue
        for r in s.query(MetroSuppression).filter_by(kind=kind, value=nv).all():
            hits.append({"kind": r.kind, "value": r.value, "scope": r.scope, "reason": r.reason})
    if email and not domain:
        d = normalize("domain", str(email).split("@")[-1])
        if d:
            for r in s.query(MetroSuppression).filter_by(kind="domain", value=d).all():
                hits.append({"kind": r.kind, "value": r.value, "scope": r.scope, "reason": r.reason})
    return hits
