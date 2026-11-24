"""Metro's FastAPI router, mounted by api/main.py with one line. Every route is under /metro.

Phase 0 scope: health, settings (read), suppression stats and imports. Nothing here sends
anything to anyone.
"""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from . import suppression as sup
from .db import METRO_TABLES, SCHEMA_VERSION, get_engine, read_settings

router = APIRouter(prefix="/metro", tags=["metro"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@router.get("/health")
def metro_health():
    eng = get_engine()
    have = set(inspect(eng).get_table_names())
    missing = [t for t in METRO_TABLES if t not in have]
    with Session(eng) as s:
        counts = {t: s.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar() for t in METRO_TABLES if t in have}
        settings = read_settings(s)
    return {"ok": not missing, "schema_version": SCHEMA_VERSION, "tables": METRO_TABLES,
            "missing": missing, "counts": counts, "week_mode": settings.get("week_mode")}


@router.get("/settings")
def metro_settings():
    with Session(get_engine()) as s:
        return read_settings(s)


@router.get("/suppression/stats")
def suppression_stats():
    with Session(get_engine()) as s:
        return sup.stats(s)


@router.post("/suppression/import")
async def suppression_import(file: UploadFile = File(...), dry_run: bool = Query(True),
                             reason: str = Query("imported list")):
    """Import a CSV (member ids, profile URLs, emails, domains, companies). Dry run by default."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large")
    try:
        data = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "the file is not UTF-8 text")
    entries, cols = sup.entries_from_csv(data, default_reason=reason)
    if not cols:
        raise HTTPException(400, "no recognised column (member_id, profile URL, email, domain/website, company)")
    with Session(get_engine()) as s:
        res = sup.add_entries(s, entries, source=file.filename or "upload", dry_run=dry_run)
    return {"dry_run": dry_run, "columns": cols, **res.as_dict()}


@router.post("/suppression/import-proposals")
def suppression_import_proposals(dry_run: bool = Query(True)):
    """Upwork clients from the proposals table (read only). Dry run by default."""
    with Session(get_engine()) as s:
        entries = sup.entries_from_proposals(s)
        res = sup.add_entries(s, entries, source="proposals", dry_run=dry_run)
    return {"dry_run": dry_run, **res.as_dict()}


from .routes_p1 import p1 as _p1   # noqa: E402  Phase 1 routes (campaigns, import, leads, persona rules)
router.include_router(_p1)
