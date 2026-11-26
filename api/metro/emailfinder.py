"""The email-finder round trip (METRO_PLAN.md Phase 2, step 8; Oleh's answer 24 Nov: Linked Helper first,
with its Data credits; Apollo only as a fallback).

  1. EXPORT   the shortlist's profile URLs as a CSV Linked Helper can import as a list (`profile_url`,
              names, company, and `metro_lead_id`, which comes back in the results so matching never depends on
              how a URL is spelled). Only usable leads without an email are exported: never a suppressed or
              previously contacted one.
  2. (outside Metro) Oleh imports that list in Linked Helper, runs its email finder (Data credits), exports.
  3. IMPORT   (an address we already hold is replaced only by one the provider calls verified; a verified one never)
              the results file (a Linked Helper export, or an Apollo CSV as the fallback). Matched by
              `metro_lead_id`, then member id, then profile URL. A found email is stored with its source and
              status `unverified`. Only when the provider itself says verified / valid is it `verified`; Oleh can
              mark any address by hand. An address on the suppression list is never stored on the lead.
  4. CHECK    (optional, free) syntax + a DNS look-up of the domain: `domain_ok` / `invalid`. It never
              promotes an address to `verified`: a domain that accepts mail says nothing about the mailbox.

Only `verified` addresses are ever eligible for email (Phase 4 enforces it; `emailable()` is the one test).
Metro calls no paid email service itself: no Apollo API key is used here.
"""
from __future__ import annotations

import csv
import io
import json
import re
import socket
import subprocess
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

from sqlalchemy.orm import Session

from . import csvimport as ci
from . import lhenrich, progress
from .db import MetroCompany, MetroLead, MetroSuppression, get_engine, utcnow
from .suppression import normalize

EXPORT_COLUMNS = ["profile_url", "first_name", "last_name", "company", "title", "metro_lead_id"]
VERIFIED_WORDS = {"verified", "valid", "deliverable", "safe", "ok"}
INVALID_WORDS = {"invalid", "undeliverable", "bounced", "risky_invalid", "bad"}
STATUSES = ("unverified", "domain_ok", "verified", "invalid")


def emailable(lead: MetroLead) -> bool:
    """The single test for "may this person be emailed": a verified address, on a usable lead.
    F4 ("Personal emails", 25 Nov): a PERSONAL address (gmail etc.) counts like any other once it is verified, but it is the
    sending address only because the lead has no business one: a business address always wins when one is found (it replaces
    the personal one on import, see `import_results` and `leads._fill_existing`). The address stays marked personal."""
    return bool(lead.email and lead.email_status == "verified" and lead.status == "new")


def email_kind(lead: MetroLead) -> str | None:
    """business | personal | None (no address). An address Linked Helper did not type counts as business."""
    if not lead.email:
        return None
    return "personal" if (lead.email_type or "") == "personal" else "business"


def exportable(lead: MetroLead, *, include_with_email: bool = False) -> bool:
    if lead.status != "new" or not lead.profile_url:
        return False
    return include_with_email or not lead.email


def export_csv(leads: list[MetroLead], *, include_with_email: bool = False) -> tuple[str, dict]:
    """The Linked Helper list (comma separated, UTF-8 with BOM so Excel and Linked Helper both read the names)."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(EXPORT_COLUMNS)
    n, skipped = 0, Counter()
    for l in leads:
        if not exportable(l, include_with_email=include_with_email):
            skipped["not usable" if l.status != "new" else "no profile URL" if not l.profile_url else "already has an email"] += 1
            continue
        w.writerow([l.profile_url, l.first_name or "", l.last_name or "", l.company_name or "", l.title or "", l.id])
        n += 1
    return "﻿" + buf.getvalue(), {"exported": n, "skipped": dict(skipped)}


def _status_from_provider(word: str | None) -> str:
    w = re.sub(r"[^a-z_]", "", (word or "").strip().lower().replace(" ", "_"))
    if w in VERIFIED_WORDS:
        return "verified"
    if w in INVALID_WORDS:
        return "invalid"
    return "unverified"


def _suppressed_address(s: Session, email: str) -> str | None:
    dom = normalize("domain", email.split("@")[-1])
    row = (s.query(MetroSuppression).filter(MetroSuppression.kind == "email", MetroSuppression.value == email).first()
           or (s.query(MetroSuppression).filter(MetroSuppression.kind == "domain", MetroSuppression.value == dom).first() if dom else None))
    return f"{row.kind} on the suppression list ({row.reason or 'no reason kept'})" if row else None


def import_results(s: Session, raw: bytes, *, campaign_id: int | None = None, source: str = "linkedhelper",
                   filename: str | None = None, dry_run: bool = True) -> dict:
    """Read a finder results file and attach the emails to leads. Dry run by default."""
    if source not in ("linkedhelper", "apollo"):
        raise ValueError("source must be linkedhelper or apollo")
    rows, headers, delim = ci.read_csv(raw)
    cols = ci.detect_cols(headers)
    if not cols.get("email") and not any(k.lower().startswith("organization_") for k in headers):
        raise ValueError("no email column in this file")
    if not any(cols.get(f) for f in ("metro_lead_id", "member_id", "url", "public_id")):
        raise ValueError("no way to match rows to leads (needs metro_lead_id, member id or a profile URL)")
    q = s.query(MetroLead)
    if campaign_id is not None:
        q = q.filter(MetroLead.campaign_id == campaign_id)
    leads = q.all()
    by_id = {l.id: l for l in leads}
    by_member = {l.member_id: l for l in leads if l.member_id}
    by_profile = {l.profile_key: l for l in leads if l.profile_key}
    res = Counter()
    enr_stats, unmapped, pending = Counter(), Counter(), set()
    domains = {c.domain: c for c in s.query(MetroCompany).filter(MetroCompany.domain.isnot(None)).all()}
    examples = []
    for row in rows:
        n = ci.normalize_row(row, cols)
        enr = lhenrich.row_enrichment(row, n, cols)
        lead = None
        if cols.get("metro_lead_id"):
            try:
                lead = by_id.get(int(str(row.get(cols["metro_lead_id"]) or "").strip()))
            except ValueError:
                lead = None
        lead = lead or (by_member.get(n["member_id"]) if n["member_id"] else None) or (by_profile.get(n["profile_key"]) if n["profile_key"] else None)
        if lead is None:
            res["no_matching_lead"] += 1
            continue
        res["matched"] += 1
        enr_stats["matched"] += 1
        for h in enr["unmapped"]:
            unmapped[h] += 1
        # F3: the company's domain / facts, the badges and person facts come with the row, whether or not it has an email.
        # (the lead's own stored email counts for the email-domain rule: a business address found earlier still gives its domain)
        comp = s.get(MetroCompany, lead.company_id) if lead.company_id else None
        if comp is not None:
            lhenrich.apply_company(s, comp, enr, domains=domains, pending=pending, stats=enr_stats, dry_run=dry_run,
                                   email=n["email"] or lead.email)
        lhenrich.apply_lead(lead, n, enr, stats=enr_stats, dry_run=dry_run)
        if n["email"]:
            enr_stats[f"email_{n['email_type'] or 'unknown'}"] += 1
        if not n["email"]:
            res["no_email_found"] += 1
            continue
        why = _suppressed_address(s, n["email"])
        if why:
            res["refused_suppressed"] += 1
            examples.append({"lead_id": lead.id, "why": why})
            continue
        status = _status_from_provider(row.get(cols["email_status"]) if cols.get("email_status") else None)
        if lead.email and lead.email == n["email"]:
            if status == "verified" and lead.email_status != "verified":
                res["upgraded"] += 1
                if not dry_run:
                    lead.email_status, lead.email_verified, lead.email_checked_at = "verified", True, utcnow()
            else:
                res["same_email"] += 1
            continue
        if lead.email and lead.email_type == "personal" and n["email_type"] == "business":
            res["replaced_personal"] += 1               # F4: a business address always wins, even over a verified personal one
            if not dry_run:
                lhenrich.stash_other_email(lead, lead.email)
                lead.email, lead.email_source, lead.email_type = n["email"], source, "business"
                lead.email_status, lead.email_verified = status, status == "verified"
                lead.email_checked_at = utcnow() if status != "unverified" else None
            continue
        if lead.email and lead.email_status == "verified":
            res["kept_verified_email"] += 1             # a verified address is never replaced by a finder's guess
            continue
        if lead.email and status != "verified":
            res["kept_existing_email"] += 1             # an unverified finder result does not replace an address we already hold
            continue
        res["stored"] += 1
        res[f"status_{status}"] += 1
        if not dry_run:
            lead.email, lead.email_source = n["email"], source
            lead.email_type = n["email_type"] or lead.email_type
            lead.email_status = status
            lead.email_verified = status == "verified"
            lead.email_checked_at = utcnow() if status != "unverified" else None
    if dry_run:
        s.rollback()
    else:
        s.commit()
    return {"dry_run": dry_run, "source": source, "filename": filename, "delimiter": delim, "rows_read": len(rows),
            "matched": res["matched"], "stored": res["stored"], "no_matching_lead": res["no_matching_lead"],
            "no_email_found": res["no_email_found"], "refused_suppressed": res["refused_suppressed"],
            "upgraded": res["upgraded"], "same_email": res["same_email"], "kept_verified_email": res["kept_verified_email"], "kept_existing_email": res["kept_existing_email"],
            "status": {k: res[f"status_{k}"] for k in ("unverified", "verified", "invalid")}, "refused": examples[:10],
            "replaced_personal": res["replaced_personal"], "enrichment": leadsmod_summary(enr_stats, unmapped)}


def leadsmod_summary(st: Counter, unmapped: Counter) -> dict:
    from .leads import enrichment_summary           # local import: leads.py does not import this module, but keep it cheap
    return enrichment_summary(st, unmapped)


# ───────────────────────── the free domain check ─────────────────────────

MxLookup = Callable[[str], bool | None]


def nslookup_mx(domain: str) -> bool | None:
    """True: the domain has a mail exchanger (or at least an address). False: it does not exist / takes no mail.
    None: could not tell (no answer, no tool). Uses the machine's own resolver through `nslookup`."""
    try:
        out = subprocess.run(["nslookup", "-type=MX", domain], capture_output=True, text=True, timeout=15,
                             encoding="utf-8", errors="replace").stdout
    except Exception:
        return None
    low = out.lower()
    if "mail exchanger" in low or "mx preference" in low:
        return True
    if "non-existent domain" in low or "nxdomain" in low:
        return False
    if "timed out" in low or "server failed" in low or "refused" in low:
        return None
    try:                                   # no MX record: mail falls back to the domain's address record
        socket.gethostbyname(domain)
        return True
    except socket.gaierror:
        return False
    except OSError:
        return None


def check_emails(s: Session, leads: list[MetroLead], *, mx: MxLookup | None = None) -> dict:
    mx = mx or nslookup_mx
    res, cache = Counter(), {}
    for l in leads:
        if not l.email or l.email_status == "verified":
            continue
        if not normalize("email", l.email):
            l.email_status, l.email_checked_at = "invalid", utcnow()
            res["invalid"] += 1
            continue
        dom = l.email.split("@")[-1].lower()
        if dom not in cache:
            cache[dom] = mx(dom)
        v = cache[dom]
        if v is True:
            l.email_status, l.email_checked_at = "domain_ok", utcnow()
            res["domain_ok"] += 1
        elif v is False:
            l.email_status, l.email_checked_at = "invalid", utcnow()
            res["invalid"] += 1
        else:
            res["could_not_check"] += 1
    s.commit()
    return dict(res)


class MxRun:
    """One domain check at a time (the check is one DNS look-up per distinct domain, a few seconds at worst each)."""
    lock = threading.Lock()
    running = False
    stop_flag = threading.Event()


def start_mx_check(campaign_id: int, *, include_checked: bool = True, mx: MxLookup | None = None, background: bool = True,
                   workers: int = 8) -> dict:
    """F4 (item 10): the free "does this domain accept mail?" check over a campaign's addresses, as a progress run (a bar in the
    header strip, Stop, one result line) instead of a request that sits silent. `domain_ok` says the DOMAIN has a mail server;
    it says nothing about the mailbox, so it NEVER makes an address `verified`. A syntax error or a domain that does not exist
    is `invalid`. `include_checked=False` leaves addresses already judged (domain_ok / invalid) alone: the automatic run after
    an import uses it."""
    with MxRun.lock:
        if MxRun.running:
            return {"started": False, "reason": "a domain check is already running"}
        res = Counter()
        targets: dict[str, list[int]] = {}
        with Session(get_engine()) as s:
            for l in s.query(MetroLead).filter(MetroLead.campaign_id == campaign_id, MetroLead.email.isnot(None)).all():
                if l.email_status == "verified" or (not include_checked and l.email_status in ("domain_ok", "invalid")):
                    continue
                if not normalize("email", l.email):
                    l.email_status, l.email_checked_at = "invalid", utcnow()
                    res["invalid"] += 1
                    continue
                targets.setdefault(l.email.split("@")[-1].lower(), []).append(l.id)
            s.commit()
        if not targets:
            return {"started": False, "reason": "no addresses to check" if not res else f"{res['invalid']} address(es) were not valid; nothing else to check",
                    "invalid": res["invalid"]}
        MxRun.stop_flag.clear()
        MxRun.running = True
        rid = progress.start("mx-check", "Checking email domains", total=len(targets), campaign_id=campaign_id,
                             stop=MxRun.stop_flag.set)

    lookup = mx or nslookup_mx

    def work():
        verdict: dict[str, bool | None] = {}
        stopped = False
        done = 0
        try:
            with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
                futs = {}
                for dom in targets:
                    futs[ex.submit(lambda d=dom: lookup(d))] = dom
                for f in as_completed(futs):
                    dom = futs[f]
                    try:
                        verdict[dom] = f.result()
                    except Exception:
                        verdict[dom] = None
                    done += 1
                    progress.update(rid, done=done, current=dom, step="DNS look-up")
                    if MxRun.stop_flag.is_set():
                        stopped = True
                        for g in futs:
                            g.cancel()
                        break
            with Session(get_engine()) as s:
                for dom, ids in targets.items():
                    v = verdict.get(dom)
                    if dom not in verdict:
                        continue
                    for l in s.query(MetroLead).filter(MetroLead.id.in_(ids)).all():
                        if l.email_status == "verified":
                            continue
                        if v is True:
                            l.email_status, l.email_checked_at = "domain_ok", utcnow()
                            res["domain_ok"] += 1
                        elif v is False:
                            l.email_status, l.email_checked_at = "invalid", utcnow()
                            res["invalid"] += 1
                        else:
                            res["could_not_check"] += 1
                s.commit()
            n_ok = sum(1 for d, v in verdict.items() if v is True)
            n_bad = sum(1 for d, v in verdict.items() if v is False)
            n_unk = sum(1 for d, v in verdict.items() if v is None)
            from . import lines as _l
            head = (f"Checked {len(verdict)} of {len(targets)} domains (stopped)" if stopped else f"Checked {_l.plural(len(verdict), 'domain')}")
            if n_ok and not n_bad and not n_unk:
                body = "all accept mail"
            else:
                body = _l.join([_l.part(n_ok, "domain", tail="accept mail"), _l.part(n_bad, "domain", tail="do not exist or take no mail"),
                                _l.part(n_unk, "domain", tail="could not be checked")])
            line = _l.line(head, body) + ". Nothing is marked verified."
            progress.finish(rid, line, "stopped" if stopped else "done")
        except Exception as e:
            progress.finish(rid, f"Domain check failed: {type(e).__name__}: {str(e)[:120]}", "failed")
        finally:
            MxRun.running = False

    if background:
        threading.Thread(target=work, name="metro-mx-check", daemon=True).start()
    else:
        work()
    return {"started": True, "total": len(targets), "progress_id": rid, "addresses": sum(len(v) for v in targets.values())}


def mark_email(s: Session, lead: MetroLead, status: str) -> MetroLead:
    """Oleh's own call on an address (he checked it another way)."""
    if status not in STATUSES:
        raise ValueError("status must be one of " + ", ".join(STATUSES))
    if not lead.email:
        raise ValueError("this lead has no email")
    lead.email_status, lead.email_verified, lead.email_checked_at = status, status == "verified", utcnow()
    s.commit()
    return lead
