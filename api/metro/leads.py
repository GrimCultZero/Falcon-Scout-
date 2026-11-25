"""Importing a lead CSV into a campaign (METRO_PLAN.md Phase 1, steps 2-4 and 6).

One pass over the file, per row, in this order (the first rule that applies decides):

  1. no identifier at all (member id, profile URL, email, name)        -> invalid, not stored
  2. the same person already appeared earlier in THIS file               -> duplicate_in_file
  3. the person is already in this campaign                              -> duplicate (status only moves
     forward none -> invited -> connected, a missing email is filled; nothing else changes)
  4. the person is already in ANOTHER campaign (any status)              -> in_other_campaign, skipped
  5. the person's company already has leads in another campaign          -> company_in_other_campaign, skipped
  6. the person / address / company is on the suppression list           -> stored, never deleted:
       HARD entry (never contact)                      -> status `suppressed`, never written to
       SOFT entry (previously contacted), plain CSV     -> status `previously_contacted`: kept out of every new
                                                           invite list, still enrichable / scoreable
       SOFT entry, row of our own Linked Helper export  -> keeps its invited / connected status and stays
         that is already invited or connected              usable (status new / junk); the soft hit is only noted
         in `prior_contact_reason` (re-contact timing is the Phase 6 cycle rule)
  7. otherwise                                                           -> stored; layer 0 persona score
     decides `new` or `junk`

"Same person" = member id, then profile URL, then email, then name + company (DevScout's order).
A campaign holds its leads and companies for as long as it is not `done`; a finished campaign's
leads are not re-imported either (re-contact is the Phase 6 cycle rule). Re-importing a file adds
nothing. A dry run does everything and writes nothing.

HARD RULE (METRO_PLAN.md): Metro never imports leads sourced from Upwork. `assert_not_upwork`
refuses such a source, and no code in this package reads `jobs` or `proposals` into `metro_leads`.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import csvimport as ci
from . import lhenrich
from . import persona as pe
from .db import MetroCampaign, MetroCompany, MetroImport, MetroLead, MetroSuppression, utcnow
from .suppression import normalize

INVITE_ORDER = {"none": 0, "invited": 1, "connected": 2}
MAX_ROWS = 20000


def assert_not_upwork(*labels) -> None:
    for x in labels:
        if x and re.search(r"upwork", str(x), re.I):
            raise ValueError("Metro never imports leads sourced from Upwork")


def default_list_source(filename: str | None) -> str:
    """A label for where a list came from. Linked Helper names its files `... from lh-<instance>-#<id> at ...`."""
    name = filename or ""
    m = re.search(r"lh-(.+?)-#(\d+)", name)
    if m:
        return f"Linked Helper {m.group(1).replace('-', ' ')} #{m.group(2)}"
    stem = re.sub(r"\.[A-Za-z0-9]+$", "", name).strip()
    return stem or "csv"


class _Suppression:
    """The whole suppression list in memory, so a 2,500-row import is not 12,500 queries."""

    def __init__(self, s: Session):
        self.by_kind: dict[str, dict[str, MetroSuppression]] = {}
        for r in s.query(MetroSuppression).all():
            self.by_kind.setdefault(r.kind, {})[r.value] = r

    def hit(self, **ids) -> tuple[str, str] | None:
        """(strength, why) of the strongest match: a hard entry beats a soft one. None = not on the list."""
        found = self._hits(**ids)
        if not found:
            return None
        hard = [h for h in found if h[0] == "hard"]
        return (hard or found)[0]

    def _hits(self, *, member_id=None, profile_key=None, email=None, company_name=None, domain=None) -> list[tuple[str, str]]:
        k = self.by_kind
        out: list[tuple[str, str]] = []

        def add(row, why):
            out.append((row.strength or "hard", why))
        if member_id and member_id in k.get("member_id", {}):
            r = k["member_id"][member_id]
            add(r, f"member id on the suppression list ({r.reason or 'no reason kept'})")
        if profile_key and profile_key in k.get("profile_url", {}):
            add(k["profile_url"][profile_key], "profile on the suppression list")
        if email:
            if email in k.get("email", {}):
                add(k["email"][email], "address on the suppression list")
            d = normalize("domain", email.split("@")[-1])
            if d and d in k.get("domain", {}):
                add(k["domain"][d], f"address at a suppressed domain ({d})")
        if domain and domain in k.get("domain", {}):
            add(k["domain"][domain], f"company domain on the suppression list ({domain})")
        c = normalize("company", company_name or "") if company_name else None
        if c and c in k.get("company", {}):
            add(k["company"][c], "company on the suppression list")
        return out


def _lead_keys(l) -> list[tuple[str, str]]:
    out = []
    if l.member_id:
        out.append(("member", l.member_id))
    if l.profile_key:
        out.append(("profile", l.profile_key))
    if l.email:
        out.append(("email", l.email))
    if l.name_company_key:
        out.append(("nc", l.name_company_key))
    return out


def _row_keys(n: dict) -> list[tuple[str, str]]:
    out = []
    if n["member_id"]:
        out.append(("member", n["member_id"]))
    if n["profile_key"]:
        out.append(("profile", n["profile_key"]))
    if n["email"]:
        out.append(("email", n["email"]))
    if n["name_company_key"]:
        out.append(("nc", n["name_company_key"]))
    return out


def _strong_differs(a_member, a_profile, b_member, b_profile) -> bool:
    """True when both records have the same kind of strong id and the values differ."""
    return bool((a_member and b_member and a_member != b_member) or (a_profile and b_profile and a_profile != b_profile))


def rules_of(s: Session) -> dict:
    from .db import MetroSetting
    row = s.get(MetroSetting, "persona_rules")
    return pe.merge_rules(json.loads(row.value_json) if row else None)


def _persona_for(n: dict, rules: dict, campaign: MetroCampaign) -> dict:
    return pe.score_lead(n, rules, campaign_type=campaign.type, region=campaign.region,
                         job_seeker_badge=bool(n.get("job_seeker_badge")))


def run_import(s: Session, campaign: MetroCampaign, raw: bytes, *, filename: str | None,
               list_source: str | None = None, dry_run: bool = True) -> dict:
    list_source = (list_source or "").strip() or default_list_source(filename)
    assert_not_upwork(filename, list_source)
    rows, headers, delim = ci.read_csv(raw)
    cols = ci.detect_cols(headers)
    if not any(cols.get(f) for f in ("url", "member_id", "email", "name", "first")):
        raise ValueError("no recognised column (profile URL, member id, email or name)")
    if len(rows) > MAX_ROWS:
        raise ValueError(f"too many rows ({len(rows)}; the limit is {MAX_ROWS})")
    is_lh = bool(cols.get("invited_iso") or cols.get("distance"))
    sha = hashlib.sha256(raw).hexdigest()
    rules = rules_of(s)
    sup = _Suppression(s)

    # What already exists (every campaign), by identity key.
    camps = {c.id: c for c in s.query(MetroCampaign).all()}
    known: dict[tuple[str, str], MetroLead] = {}
    held_companies: dict[int, set[int]] = {}        # company_id -> campaign ids that hold it
    for l in s.query(MetroLead).all():
        for k in _lead_keys(l):
            known.setdefault(k, l)
        if l.company_id:
            held_companies.setdefault(l.company_id, set()).add(l.campaign_id)
    companies = {c.name_key: c for c in s.query(MetroCompany).filter(MetroCompany.name_key.isnot(None)).all()}
    domains = {c.domain: c for c in s.query(MetroCompany).filter(MetroCompany.domain.isnot(None)).all()}

    res = Counter()
    other = Counter()
    filled_fields = Counter()
    enr_stats = Counter()                            # F3: what the enrichment columns gave (see lhenrich)
    unmapped = Counter()
    pending_domains: set[str] = set()
    seen: set[tuple[str, str]] = set()
    seen_nc: dict[str, list] = {}
    added_ids: list[MetroLead] = []
    now = utcnow()
    prior = s.query(MetroImport).filter_by(campaign_id=campaign.id, file_sha256=sha).count()

    imp = MetroImport(campaign_id=campaign.id, filename=filename, file_sha256=sha, list_source=list_source,
                      delimiter=delim, rows_read=len(rows), created_at=now)
    if not dry_run:
        s.add(imp)
        s.flush()

    for row in rows:
        n = ci.normalize_row(row, cols)
        enr = lhenrich.row_enrichment(row, n, cols)
        for h in enr["unmapped"]:
            unmapped[h] += 1
        keys = _row_keys(n)
        if not keys:
            res["invalid"] += 1
            continue
        dup_in_file = False
        for k in keys:
            if k not in seen:
                continue
            if k[0] == "nc" and all(_strong_differs(n["member_id"], n["profile_key"], m, pk) for m, pk in seen_nc.get(k[1], [])):
                res["same_name_other_profile"] += 1
                continue
            dup_in_file = True
            break
        if dup_in_file:
            res["duplicate_in_file"] += 1
            continue
        seen.update(keys)
        if n["name_company_key"]:
            seen_nc.setdefault(n["name_company_key"], []).append((n["member_id"], n["profile_key"]))

        existing = None
        for k in keys:
            hit = known.get(k)
            if hit is None:
                continue
            if k[0] == "nc" and _strong_differs(n["member_id"], n["profile_key"], hit.member_id, hit.profile_key):
                res["same_name_other_profile"] += 1
                continue
            existing = hit
            break
        if existing is not None:
            if existing.campaign_id == campaign.id:
                res["duplicate"] += 1
                filled = _fill_existing(s, existing, n, row, campaign=campaign, rules=rules, sup=sup,
                                        companies=companies, domains=domains, dry_run=dry_run, is_lh=is_lh,
                                        enr=enr, enr_stats=enr_stats, pending=pending_domains)
                enr_stats["matched"] += 1
                if filled:
                    res["filled"] += 1
                    for f in filled:
                        filled_fields[f] += 1
                    for k2 in _lead_keys(existing):
                        known.setdefault(k2, existing)
                if _update_existing(existing, n):
                    res["updated"] += 1
            else:
                res["in_other_campaign"] += 1
                c = camps.get(existing.campaign_id)
                other[c.name if c else f"campaign {existing.campaign_id}"] += 1
            continue

        company = None
        if n["company_key"]:
            company = companies.get(n["company_key"])
        if company is None and n["domain"]:
            company = domains.get(n["domain"])
        if company is not None and any(cid != campaign.id for cid in held_companies.get(company.id, ())):
            res["company_in_other_campaign"] += 1
            continue

        hit = sup.hit(member_id=n["member_id"], profile_key=n["profile_key"], email=n["email"],
                      company_name=n["company_name"], domain=n["domain"])
        strength, why = hit if hit else (None, None)
        # A soft hit on a row of our own Linked Helper campaign export that is already invited / connected
        # keeps its status and stays usable: it is only noted.
        prior_why = None
        if strength == "soft" and is_lh and n["invite_status"] in ("invited", "connected"):
            prior_why, why, strength = why, None, None
            res["kept_soft"] += 1
        elif strength == "soft":
            prior_why = why
        p = _persona_for(n, rules, campaign)

        if company is None and (n["company_key"] or n["domain"]) and not dry_run:
            company = MetroCompany(name=n["company_name"] or n["domain"], name_key=n["company_key"], domain=n["domain"],
                                   domain_source="csv" if n["domain"] else None)
            s.add(company)
            s.flush()
            if n["company_key"]:
                companies[n["company_key"]] = company
            if n["domain"]:
                domains[n["domain"]] = company

        if strength == "hard":
            status = "suppressed"
            res["suppressed"] += 1
        elif strength == "soft":
            status = "previously_contacted"
            res["previously_contacted"] += 1
        elif p["verdict"] == "junk":
            status = "junk"
            res["junk"] += 1
        else:
            status = "new"
        res["added"] += 1
        enr_stats["new_leads"] += 1
        if n["email"]:
            enr_stats[f"email_{n['email_type'] or 'unknown'}"] += 1
        if company is not None or n["company_key"] or n["domain"]:
            lhenrich.apply_company(s, company, enr, domains=domains, pending=pending_domains, stats=enr_stats,
                                   dry_run=dry_run, email=n["email"])
        res[f"invite_{n['invite_status']}"] += 1
        res[f"persona_{p['verdict']}"] += 1
        if n["email"]:
            res["with_email"] += 1
        if dry_run:
            lhenrich.apply_lead(MetroLead(raw_json=None), n, enr, stats=enr_stats, dry_run=True)
            continue

        lead = MetroLead(
            campaign_id=campaign.id, company_id=company.id if company else None,
            full_name=n["full_name"], first_name=n["first_name"], last_name=n["last_name"], title=n["title"],
            location=n["location"], profile_url=n["profile_url"], member_id=n["member_id"],
            email=n["email"], email_verified=False,
            email_source=("linkedhelper" if is_lh else "csv") if n["email"] else None,
            email_type=n["email_type"],
            persona_score=p["score"], persona_verdict=p["verdict"],
            score_notes_json=json.dumps({"persona": p}), status=status, current_cycle=1,
            source_file=filename, list_source=list_source, import_id=imp.id,
            company_name=n["company_name"], profile_key=n["profile_key"], name_company_key=n["name_company_key"],
            invite_status=n["invite_status"], invited_at=n["invited_at"], connected_at=n["connected_at"],
            suppressed_reason=why, prior_contact_reason=prior_why, persona_locked=False,
            raw_json=json.dumps({"mapped": {"headline": n["headline"], "summary": n["summary"],
                                            "job_seeker_badge": n["job_seeker_badge"]},
                                 "row": {k: v for k, v in row.items() if v}}, ensure_ascii=False),
        )
        s.add(lead)
        lhenrich.apply_lead(lead, n, enr, stats=enr_stats, dry_run=False)
        added_ids.append(lead)
        for k in keys:
            known.setdefault(k, lead)
        if company is not None:
            s.flush()
            held_companies.setdefault(company.id, set()).add(campaign.id)

    result = {
        "dry_run": dry_run, "filename": filename, "list_source": list_source, "delimiter": delim,
        "rows_read": len(rows), "is_linked_helper": is_lh, "same_file_imported_before": prior > 0,
        "columns": {k: v for k, v in cols.items() if v},
        "added": res["added"], "updated": res["updated"], "filled": res["filled"], "filled_fields": dict(filled_fields),
        "duplicate": res["duplicate"],
        "duplicate_in_file": res["duplicate_in_file"], "invalid": res["invalid"],
        "same_name_other_profile": res["same_name_other_profile"],
        "in_other_campaign": res["in_other_campaign"], "in_other_campaign_by": dict(other),
        "company_in_other_campaign": res["company_in_other_campaign"],
        "suppressed": res["suppressed"], "previously_contacted": res["previously_contacted"],
        "kept_despite_soft_hit": res["kept_soft"], "junk": res["junk"], "with_email": res["with_email"],
        "invite": {k: res[f"invite_{k}"] for k in ("none", "invited", "connected")},
        "persona": {k: res[f"persona_{k}"] for k in ("keep", "review", "junk")},
        "enrichment": enrichment_summary(enr_stats, unmapped),
    }
    if dry_run:
        s.rollback()
    else:
        imp.result_json = json.dumps(result, ensure_ascii=False)
        s.commit()
        result["import_id"] = imp.id
    return result


def enrichment_summary(st: Counter, unmapped: Counter) -> dict:
    """The F3 numbers, one dict, shared by both imports (the dry run shows it, the progress dock's result line says it)."""
    return {"matched": st["matched"], "emails": {"business": st["email_business"], "personal": st["email_personal"]},
            "domains_set": {"linkedhelper": st["domain_set_linkedhelper"], "email-domain": st["domain_set_email"]},
            "domains_disagreeing": st["domain_disagree"], "domains_rejected": st["domain_rejected"],
            "domains_taken_by_another_company": st["domain_taken"],
            "open_profiles": st["open_profile"], "company_facts_filled": st["company_facts"], "person_facts_filled": st["person_facts"],
            "unmapped_columns": dict(unmapped.most_common())}


def enrichment_line(e: dict) -> str:
    d = e["domains_set"]
    bits = [f"{d['linkedhelper']} domains from Linked Helper", f"{d['email-domain']} from business emails",
            f"{e['domains_disagreeing']} disagreeing", f"{e['open_profiles']} open profiles",
            f"{e['company_facts_filled']} company facts"]
    if e["unmapped_columns"]:
        bits.append(f"{len(e['unmapped_columns'])} unmapped columns")
    return ", ".join(bits)


def _update_existing(lead: MetroLead, n: dict) -> bool:
    """A repeat sighting of a person already in this campaign: only move forward. True when something changed."""
    changed = False
    if INVITE_ORDER[n["invite_status"]] > INVITE_ORDER.get(lead.invite_status or "none", 0):
        lead.invite_status = n["invite_status"]
        changed = True
    if n["invited_at"] and not lead.invited_at:
        lead.invited_at = n["invited_at"]
        changed = True
    if n["connected_at"] and not lead.connected_at:
        lead.connected_at = n["connected_at"]
        changed = True
    if n["email"] and not lead.email:
        lead.email = n["email"]
        lead.email_source = lead.email_source or "linkedhelper"
        changed = True
    return changed


_SALES_RE = re.compile(r"linkedin\.com/sales/(people|lead)/", re.I)


def _is_sales_url(u: str | None) -> bool:
    return bool(u and _SALES_RE.search(u))


def _fill_existing(s: Session, lead: MetroLead, n: dict, row: dict, *, campaign: MetroCampaign, rules: dict, sup,
                   companies: dict, domains: dict, dry_run: bool, is_lh: bool, enr: dict | None = None,
                   enr_stats: Counter | None = None, pending: set | None = None) -> list[str]:
    """F1 item 1: a repeat sighting of a person already in this campaign fills every EMPTY field from the new row.
    A value that is already there is never overwritten (status only moves forward: see `_update_existing`).
    Returns the names of the fields that were filled (empty list = nothing new). The lead's layer-0 verdict is
    computed again (unless a person decided it) and the new company / domain / email are checked against the
    suppression list, because a lead with no name could not be checked before."""
    filled: list[str] = []

    def fill(attr: str, value, label: str | None = None):
        if value in (None, "", False):
            return
        if getattr(lead, attr) in (None, ""):
            setattr(lead, attr, value)
            filled.append(label or attr)

    fill("full_name", n["full_name"], "name")
    fill("first_name", n["first_name"])
    fill("last_name", n["last_name"])
    fill("title", n["title"])
    fill("location", n["location"])
    fill("member_id", n["member_id"])
    fill("company_name", n["company_name"], "company")
    fill("name_company_key", n["name_company_key"])
    if n["email"] and not lead.email:
        lead.email, lead.email_source, lead.email_type = n["email"], ("linkedhelper" if is_lh else "csv"), n["email_type"]
        filled.append("email")
        if enr_stats is not None:
            enr_stats[f"email_{n['email_type'] or 'unknown'}"] += 1
    elif (n["email"] and lead.email and n["email"] != lead.email and lead.email_type == "personal" and n["email_type"] == "business"
          and lead.email_status != "verified"):
        lead.email, lead.email_source, lead.email_type = n["email"], ("linkedhelper" if is_lh else "csv"), "business"
        filled.append("email")                     # F3: a business address replaces an unverified personal one
        if enr_stats is not None:
            enr_stats["email_business"] += 1
    # Profile URL forms: the first one fills the empty slot; a second, different form is kept in the raw data.
    try:
        raw = json.loads(lead.raw_json) if lead.raw_json else {}
    except ValueError:
        raw = {}
    mapped = raw.setdefault("mapped", {})
    if n["profile_url"] and not lead.profile_url:
        lead.profile_url, lead.profile_key = n["profile_url"], n["profile_key"]
        filled.append("profile_url")
    elif n["profile_url"] and n["profile_key"] != lead.profile_key:
        alts = mapped.setdefault("other_profile_urls", [])
        if n["profile_url"] not in alts:
            alts.append(n["profile_url"])
            filled.append("profile_url_form")
        if _is_sales_url(n["profile_url"]) and not _is_sales_url(lead.profile_url):
            mapped.setdefault("sales_url", n["profile_url"])
    if _is_sales_url(lead.profile_url):
        mapped.setdefault("sales_url", lead.profile_url)
    for k in ("headline", "summary"):
        if n.get(k) and not mapped.get(k):
            mapped[k] = n[k]
            filled.append(k)
    if n.get("job_seeker_badge") and not mapped.get("job_seeker_badge"):
        mapped["job_seeker_badge"] = True
    old_row = raw.setdefault("row", {})
    for k, v in row.items():
        if v and k not in old_row:
            old_row[k] = v
    if filled:
        lead.raw_json = json.dumps(raw, ensure_ascii=False)

    # The company and its domain.
    if lead.company_id is None and (n["company_key"] or n["domain"]):
        company = companies.get(n["company_key"]) if n["company_key"] else None
        if company is None and n["domain"]:
            company = domains.get(n["domain"])
        if company is None and not dry_run:
            company = MetroCompany(name=n["company_name"] or n["domain"], name_key=n["company_key"], domain=n["domain"],
                                   domain_source="csv" if n["domain"] else None)
            s.add(company)
            s.flush()
            if n["company_key"]:
                companies[n["company_key"]] = company
            if n["domain"]:
                domains[n["domain"]] = company
        if company is not None:
            lead.company_id = company.id
            filled.append("company_link")

    if enr is not None and enr_stats is not None:
        _enrich_existing(s, lead, n, enr, enr_stats, pending if pending is not None else set(), domains, dry_run, filled)

    if not filled:
        return filled

    # Layer 0 again with what we know now, and the suppression check the empty row could not take.
    if lead.status in ("new", "junk"):
        hit = sup.hit(member_id=lead.member_id, profile_key=lead.profile_key, email=lead.email,
                      company_name=lead.company_name, domain=n["domain"])
        strength, why = hit if hit else (None, None)
        if strength == "hard":
            lead.status, lead.suppressed_reason = "suppressed", why
        elif strength == "soft" and not (is_lh and lead.invite_status in ("invited", "connected")):
            lead.prior_contact_reason = lead.prior_contact_reason or why
            if not lead.persona_locked and lead.invite_status in (None, "none"):
                lead.status = "previously_contacted"
        if lead.status in ("new", "junk") and not lead.persona_locked:
            _rescore_lead(lead, rules, campaign)
    return filled


def _enrich_existing(s, lead, n, enr, st, pending, domains, dry_run, filled) -> None:
    """F3 for a lead already stored: its company's domain and facts, its badges, person facts. (The company link itself,
    including creating a company the lead had none of, is the step just above.)"""
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    if company is not None or n["company_key"]:
        lhenrich.apply_company(s, company, enr, domains=domains, pending=pending, stats=st, dry_run=dry_run,
                               email=lead.email or n["email"])
    for c in lhenrich.apply_lead(lead, n, enr, stats=st, dry_run=dry_run):
        if c not in filled:
            filled.append(c)


def _rescore_lead(l: MetroLead, rules: dict, campaign: MetroCampaign) -> dict:
    extra = json.loads(l.raw_json or "{}").get("mapped", {})
    p = _persona_for({"title": l.title, "headline": extra.get("headline"), "summary": extra.get("summary"),
                      "company_name": l.company_name, "location": l.location,
                      "job_seeker_badge": extra.get("job_seeker_badge")}, rules, campaign)
    l.status = "junk" if p["verdict"] == "junk" else "new"
    l.persona_score, l.persona_verdict = p["score"], p["verdict"]
    l.score_notes_json = json.dumps({"persona": p})
    return p


def rescore_campaign(s: Session, campaign: MetroCampaign, lead_ids: list[int] | None = None) -> dict:
    """Run layer 0 again with the current rules. Locked leads (a person's own decision) and suppressed
    leads are not touched; only `new` and `junk` can change status."""
    rules = rules_of(s)
    changed = Counter()
    q = s.query(MetroLead).filter_by(campaign_id=campaign.id)
    if lead_ids is not None:
        q = q.filter(MetroLead.id.in_(lead_ids))
    for l in q.all():
        if l.persona_locked or l.status not in ("new", "junk"):
            continue
        before = (l.status, l.persona_verdict)
        p = _rescore_lead(l, rules, campaign)
        if before != (l.status, p["verdict"]):
            changed["changed"] += 1
        changed[p["verdict"]] += 1
    s.commit()
    return dict(changed)
