"""One import for every CSV (METRO_TASK.md F4, item 4).

Oleh had two dialogs (lead list, email-finder results), each with a preview step; the lead one could not apply a file that
added no new leads, and both showed raw JSON. Now there is ONE `import_file`:

  * it reads the file and decides what it is (the email finder's results coming back through `metro_lead_id`, or a lead list /
    Linked Helper export / Sales Navigator list; both are matched to existing leads first, so updates always apply);
  * it runs the same code as before as a dry run, in memory, to see whether the file looks wrong;
  * it stops BEFORE writing only when it does: no recognised columns; no row matches this campaign and no row would be
    added; the very same file was already imported into this campaign (`force` overrides it, on a second click);
  * otherwise it writes straight away and returns a summary in plain words (`summary.headline`, `summary.lines`).

The numbers underneath are the same as before; only the way they are said changed. Nothing here sends anything.
"""
from __future__ import annotations

import hashlib

from sqlalchemy.orm import Session

from . import csvimport as ci
from . import emailfinder as ef
from . import leads as leadsmod
from . import progress
from .db import MetroCampaign, MetroImport, utcnow

AUTO_MX = True          # after an import that stored emails, check their domains in the background (free DNS; tests switch it off)


def kind_of(headers: list[str]) -> str:
    """"email-results": our exported list coming back from the finder (it carries `metro_lead_id`), or an Apollo-style file that
    judges its addresses (an email status column) without any Linked Helper invite columns. Everything else is a lead list."""
    cols = ci.detect_cols(headers)
    if cols.get("metro_lead_id"):
        return "email-results"
    if cols.get("email_status") and cols.get("email") and not (cols.get("invited_iso") or cols.get("distance") or cols.get("status")):
        return "email-results"
    return "leads"


def _source_for(headers: list[str]) -> str:
    return "apollo" if any("apollo" in (h or "").lower() for h in headers) else "linkedhelper"


def _kyiv(naive_utc) -> str:
    """"25 Nov 2026 21:38" in Kyiv time (the stored moment is naive UTC)."""
    from zoneinfo import ZoneInfo
    return naive_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("Europe/Kyiv")).strftime("%d %b %Y %H:%M")


def _n(v) -> int:
    return int(v or 0)


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _enrichment_lines(e: dict) -> list[str]:
    out: list[str] = []
    em = e.get("emails") or {}
    if _n(em.get("business")) or _n(em.get("personal")):
        out.append(f"Emails in the file: {_n(em.get('business'))} business, {_n(em.get('personal'))} personal"
                   + (" (a business address is used when a lead has one, a personal one only when it has no other)" if _n(em.get("personal")) else ""))
    d = e.get("domains_set") or {}
    if _n(d.get("linkedhelper")) or _n(d.get("email-domain")):
        out.append(f"Company websites set: {_n(d.get('linkedhelper'))} from Linked Helper, {_n(d.get('email-domain'))} from business email addresses")
    if _n(e.get("company_pages")):
        out.append(f"{_plural(_n(e['company_pages']), 'company LinkedIn page')} saved (for the LinkedIn website step)")
    if _n(e.get("domains_disagreeing")):
        out.append(f"{_plural(_n(e['domains_disagreeing']), 'company', 'companies')} already had a different website; the old one was kept (see its trail)")
    if _n(e.get("domains_rejected")):
        out.append(f"{_n(e['domains_rejected'])} websites in the file were not used (parked, social or free-mail addresses)")
    if _n(e.get("open_profiles")):
        out.append(f"{_plural(_n(e['open_profiles']), 'open profile')} (can get a free InMail)")
    un = e.get("unmapped_columns") or {}
    if un:
        names = ", ".join(list(un)[:8]) + (" ..." if len(un) > 8 else "")
        out.append(f"Columns kept with the lead but not used yet: {names}")
    return out


def plain_summary(kind: str, r: dict, filename: str | None) -> dict:
    """The result in words a person reads: {"headline", "lines"}. No JSON, no keys. Zero counts are left out."""
    name = filename or "the file"
    lines: list[str] = []
    if kind == "email-results":
        head = f"{name}: {_plural(_n(r.get('rows_read')), 'row')} read, {_n(r.get('matched'))} matched to leads of this campaign"
        if _n(r.get("stored")):
            lines.append(f"{_plural(_n(r['stored']), 'email address', 'email addresses')} stored (marked unverified unless the file says verified)")
        if _n(r.get("replaced_personal")):
            lines.append(f"{_plural(_n(r['replaced_personal']), 'personal address', 'personal addresses')} replaced by a business one")
        if _n(r.get("upgraded")):
            lines.append(f"{_n(r['upgraded'])} addresses are now verified (the file says so)")
        if _n(r.get("same_email")):
            lines.append(f"{_n(r['same_email'])} addresses were already known")
        kept = _n(r.get("kept_existing_email")) + _n(r.get("kept_verified_email"))
        if kept:
            lines.append(f"{_plural(kept, 'lead')} kept the address they already had")
        if _n(r.get("no_email_found")):
            lines.append(f"{_n(r['no_email_found'])} matched rows had no email")
        if _n(r.get("no_matching_lead")):
            lines.append(f"{_n(r['no_matching_lead'])} rows matched no lead in this campaign (left out)")
        if _n(r.get("refused_suppressed")):
            lines.append(f"{_n(r['refused_suppressed'])} addresses were refused: on the suppression list")
        lines += _enrichment_lines(r.get("enrichment") or {})
        return {"headline": head + ".", "lines": lines}
    added = _n(r.get("added"))
    head = f"{name}: {_plural(_n(r.get('rows_read')), 'row')} read" + (" (Linked Helper export)" if r.get("is_linked_helper") else "")
    if added:
        pe = r.get("persona") or {}
        lines.append(f"{_plural(added, 'new lead')} added" + (f": {_n(pe.get('keep'))} look right, {_n(pe.get('review'))} to review, {_n(pe.get('junk'))} marked junk" if pe else ""))
    else:
        lines.append("No new leads")
    if _n(r.get("duplicate")):
        bits = []
        if _n(r.get("filled")):
            fields = ", ".join(f"{k} {v}" for k, v in sorted((r.get("filled_fields") or {}).items(), key=lambda kv: -kv[1])[:6])
            bits.append(f"{_n(r['filled'])} got missing details filled in" + (f" ({fields})" if fields else ""))
        if _n(r.get("updated")):
            bits.append(f"{_n(r['updated'])} moved forward in Linked Helper status or got an email")
        lines.append(f"{_plural(_n(r['duplicate']), 'row')} matched leads already in this campaign" + ((": " + "; ".join(bits)) if bits else ", nothing new in them"))
    inv = r.get("invite") or {}
    if added and (_n(inv.get("connected")) or _n(inv.get("invited"))):
        lines.append(f"Linked Helper status of the new leads: {_n(inv.get('connected'))} connected, {_n(inv.get('invited'))} invited, {_n(inv.get('none'))} not invited")
    if _n(r.get("with_email")):
        lines.append(f"{_n(r['with_email'])} of the new leads came with an email")
    if _n(r.get("in_other_campaign")):
        by = r.get("in_other_campaign_by") or {}
        lines.append(f"{_plural(_n(r['in_other_campaign']), 'row')} skipped: already in another campaign" + (f" ({', '.join(f'{k}: {v}' for k, v in by.items())})" if by else ""))
    if _n(r.get("company_in_other_campaign")):
        lines.append(f"{_plural(_n(r['company_in_other_campaign']), 'row')} skipped: the company is in another campaign")
    if _n(r.get("suppressed")):
        lines.append(f"{_n(r['suppressed'])} stored but marked suppressed (on the do-not-contact list, never written to)")
    if _n(r.get("previously_contacted")):
        lines.append(f"{_n(r['previously_contacted'])} stored as previously contacted (kept out of new invite lists)")
    if _n(r.get("duplicate_in_file")):
        lines.append(f"{_n(r['duplicate_in_file'])} rows repeated inside the file")
    if _n(r.get("invalid")):
        lines.append(f"{_n(r['invalid'])} rows had nothing to identify a person by (not stored)")
    if _n(r.get("same_name_other_profile")):
        lines.append(f"{_n(r['same_name_other_profile'])} rows share a name and company with another profile (kept, worth a look)")
    lines += _enrichment_lines(r.get("enrichment") or {})
    return {"headline": head + ".", "lines": lines}


def _stop(kind: str, reason: str, why: str, *, can_force: bool = False, **extra) -> dict:
    return {"stopped": True, "wrote": False, "kind": kind, "stop_kind": reason, "can_force": can_force,
            "summary": {"headline": "Nothing was imported.", "lines": [why]}, **extra}


def import_file(s: Session, campaign: MetroCampaign, raw: bytes, *, filename: str | None, list_source: str = "",
                force: bool = False) -> dict:
    """The one import. Returns {"stopped": False, "wrote": True, "kind", "summary": {"headline", "lines"}, "result": {...numbers}}
    or {"stopped": True, "wrote": False, "stop_kind", "can_force", "summary": {...}} (nothing written)."""
    try:
        _rows, headers, _delim = ci.read_csv(raw)
    except Exception as e:
        return _stop("leads", "unreadable", f"The file could not be read as a CSV ({type(e).__name__}).")
    kind = kind_of(headers)
    sha = hashlib.sha256(raw).hexdigest()
    name = filename or "the file"
    try:
        if kind == "email-results":
            dry = ef.import_results(s, raw, campaign_id=campaign.id, source=_source_for(headers), filename=filename, dry_run=True)
        else:
            dry = leadsmod.run_import(s, campaign, raw, filename=filename, list_source=list_source, dry_run=True)
    except ValueError as e:
        shown = ", ".join(h for h in headers[:8] if h) + (" ..." if len(headers) > 8 else "")
        return _stop(kind, "no_columns", f"{e}. The first columns of this file are: {shown or '(none)'}.")
    # 1. the file looks wrong: nothing in it matches this campaign and nothing would be added
    if kind == "email-results":
        nothing = _n(dry.get("matched")) == 0
    else:
        nothing = _n(dry.get("added")) == 0 and _n(dry.get("duplicate")) == 0
    if nothing:
        bits = []
        if kind == "leads":
            if _n(dry.get("in_other_campaign")) or _n(dry.get("company_in_other_campaign")):
                bits.append(f"{_n(dry.get('in_other_campaign')) + _n(dry.get('company_in_other_campaign'))} rows belong to another campaign")
            if _n(dry.get("duplicate_in_file")):
                bits.append(f"{_n(dry['duplicate_in_file'])} are repeats inside the file")
            if _n(dry.get("invalid")):
                bits.append(f"{_n(dry['invalid'])} have nothing to identify a person by")
        why = (f"None of the {_plural(_n(dry.get('rows_read')), 'row')} in {name} matches a lead of this campaign, and none would be added"
               + (f" ({'; '.join(bits)})" if bits else "") + ". Check that you picked the right campaign and file.")
        return _stop(kind, "no_match", why, rows_read=_n(dry.get("rows_read")))
    # 2. the very same file was imported into this campaign already
    prior = s.query(MetroImport).filter_by(campaign_id=campaign.id, file_sha256=sha).order_by(MetroImport.id.desc()).first()
    if prior is not None and not force:
        when = _kyiv(prior.created_at) if prior.created_at else "earlier"
        return _stop(kind, "same_file", f"This exact file ({name}) was already imported into this campaign on {when}. "
                     "Importing it again would change nothing new.", can_force=True, rows_read=_n(dry.get("rows_read")))
    # 3. write
    with progress.track("import", f"Importing {name}", campaign_id=campaign.id) as t:
        if kind == "email-results":
            r = ef.import_results(s, raw, campaign_id=campaign.id, source=_source_for(headers), filename=filename, dry_run=False)
            s.add(MetroImport(campaign_id=campaign.id, filename=filename, file_sha256=sha, list_source=list_source or _source_for(headers),
                              delimiter=r.get("delimiter"), rows_read=r.get("rows_read"), created_at=utcnow()))
            s.commit()
        else:
            r = leadsmod.run_import(s, campaign, raw, filename=filename, list_source=list_source, dry_run=False)
        summary = plain_summary(kind, r, filename)
        t["result"] = " ".join([summary["headline"], *summary["lines"][:3]])[:400]
    mx = None
    if AUTO_MX:
        stored = _n(r.get("stored")) if kind == "email-results" else _n(r.get("with_email")) + _n(r.get("filled"))
        if stored:
            try:
                mx = ef.start_mx_check(campaign.id, include_checked=False)
            except Exception:
                mx = None
    return {"stopped": False, "wrote": True, "kind": kind, "summary": summary, "result": r,
            "domain_check_started": bool(mx and mx.get("started"))}
