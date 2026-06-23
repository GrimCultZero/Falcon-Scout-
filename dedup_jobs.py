"""
dedup_jobs.py — Find and merge duplicate Job rows in the Falcon Scout SQLite DB.

Three categories are handled:

  A. Bot noise — Telegram system messages (bot-down/up announcements, link-expiry
     notices) that were inadvertently saved as jobs. Identified by: NULL
     upwork_job_id + title starting with '?'. All copies except the earliest are
     deleted; none have proposals or KB entries, so this is always safe.

  B. Junk / parser-artifact titles — Rows whose titles are obviously not real job
     postings (very short titles, section headers like 'Summary', fragment phrases
     like 'and description optimization'). Deleted when they have no Proposal,
     KBEntry, or rule_violation record attached; skipped otherwise.

  C. True listener duplicates — The same Upwork job captured twice under different
     numeric upwork_job_ids (the real ~HEX ID wasn't extracted, so both rows
     passed the UNIQUE constraint on upwork_job_id). Identified by: same normalized
     title + captured within --window hours (default 4h). The canonical row is
     selected by: has Proposal > is enriched > most fields populated > lowest id.
     All FK child records (proposals, kb_entries, rule_violations) are re-pointed
     to the canonical before deleting the duplicate.

USAGE:
  python dedup_jobs.py                    # dry-run: shows what WOULD happen
  python dedup_jobs.py --execute          # apply changes
  python dedup_jobs.py --execute --window 2   # tighten the time window to 2h
  python dedup_jobs.py --categories A,C  # skip category B

CAPTURE-SIDE NOTE (documented here, not yet implemented in the listener):
  Root cause of category-C duplicates: the Telegram parser sometimes generates a
  numeric fallback upwork_job_id when the real ~HEX ID can't be extracted from the
  message URL. Both rows clear the UNIQUE constraint because their IDs differ.
  A hardening pass in listener.py / save_job() could add a secondary check: before
  inserting, query for a row with the same normalized title captured within the
  last 12 hours, and skip the insert if found. That would catch most listener
  duplicates at capture time, without needing a periodic dedup pass.
"""

import argparse
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from sqlalchemy import text
from sqlalchemy.orm import Session

from db import Job, KBEntry, Proposal, init_db

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'upwork_jobs.db'}")
engine = init_db(DATABASE_URL)


# ── Artifact detection ────────────────────────────────────────────────────────

# Normalized (lower, stripped) titles that are never real job postings.
_JUNK_EXACT = {
    "not",
    "and description optimization",
    "tags and meta descriptions",
    "summary",
    "title:",
    "scope of work",
    "the dataset:",
    "what needs to be done:",
    "locl.ai",
    "*",
    "and product meta description",
}

# Titles that START WITH one of these (lower, stripped) are also junk.
_JUNK_PREFIXES = (
    "tags, meta descriptions",
    "local search, paid search ads",
    "job description:",
    "job opportunity:",
)

# Substrings that identify Telegram bot-status messages (no real job content).
# Matched against the title after stripping leading emoji/punctuation.
_BOT_NOISE_PHRASES = (
    "the bot is temporarily down",
    "the bot is back up",
    "reminder: if you",
    "the link is valid for 1 hour",
)


def _normalize(title: str) -> str:
    return (title or "").strip().lower()


def _is_bot_noise(job: Job) -> bool:
    """Telegram bot status messages stored as jobs — no real Upwork ID."""
    if job.upwork_job_id is not None:
        return False
    # Strip leading emoji / non-word chars before checking phrases
    stripped = re.sub(r"^[^\w]+\s*", "", _normalize(job.title))
    return any(phrase in stripped for phrase in _BOT_NOISE_PHRASES)


def _is_junk_title(job: Job) -> bool:
    """Parser artifact / non-job fragment titles."""
    norm = _normalize(job.title)
    if len(norm) < 4:
        return True
    if norm in _JUNK_EXACT:
        return True
    return any(norm.startswith(pfx) for pfx in _JUNK_PREFIXES)


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    try:
        s = re.sub(r"[+-]\d{2}:\d{2}$", "", str(value)).replace("Z", "")
        return datetime.fromisoformat(s)
    except Exception:
        return None


# ── Child-record helpers ──────────────────────────────────────────────────────

def _child_counts(session: Session, job_id: int) -> dict:
    return {
        "proposals": session.query(Proposal).filter_by(job_id=job_id).count(),
        "kb_entries": session.query(KBEntry).filter(KBEntry.job_id == job_id).count(),
        "rule_violations": (
            session.execute(
                text("SELECT COUNT(*) FROM rule_violations WHERE job_id = :jid"),
                {"jid": job_id},
            ).scalar()
            or 0
        ),
    }


def _repoint_children(session: Session, from_id: int, to_id: int, execute: bool) -> dict:
    """Move FK child rows from from_id → to_id. Returns {table: count_moved}."""
    moved: dict[str, int] = {}

    props = session.query(Proposal).filter_by(job_id=from_id).all()
    if props:
        moved["proposals"] = len(props)
        if execute:
            for p in props:
                p.job_id = to_id

    kbs = session.query(KBEntry).filter(KBEntry.job_id == from_id).all()
    if kbs:
        moved["kb_entries"] = len(kbs)
        if execute:
            for k in kbs:
                k.job_id = to_id

    rv_count = (
        session.execute(
            text("SELECT COUNT(*) FROM rule_violations WHERE job_id = :jid"),
            {"jid": from_id},
        ).scalar()
        or 0
    )
    if rv_count:
        moved["rule_violations"] = rv_count
        if execute:
            session.execute(
                text("UPDATE rule_violations SET job_id = :to WHERE job_id = :frm"),
                {"to": to_id, "frm": from_id},
            )

    return moved


# ── Canonical selection ───────────────────────────────────────────────────────

def _completeness(job: Job) -> int:
    """Count how many enrichment fields are non-NULL."""
    return sum(
        1
        for f in (
            "description_snippet", "enriched_at", "experience_level", "duration",
            "proposals", "hire_rate", "client_rating_score", "client_company_size",
            "description_full", "preferred_qualifications", "ahrefs_summary",
            "website_summary", "last_analysis_json",
        )
        if getattr(job, f, None) is not None
    )


def _select_canonical(session: Session, group: list[Job]) -> Job:
    """Return the best job to keep: Proposal > enriched > complete > lowest id."""
    def rank(j: Job) -> tuple:
        has_p = session.query(Proposal).filter_by(job_id=j.id).count()
        return (
            -has_p,
            -int(j.enriched_at is not None),
            -int(j.upwork_job_id is not None),  # prefer rows with a real upwork_id
            -_completeness(j),
            j.id,
        )

    return min(group, key=rank)


# ── Formatting helpers ────────────────────────────────────────────────────────

def _safe(text: str, width: int = 68) -> str:
    return (text or "")[:width].encode("ascii", "replace").decode("ascii")


# ── Main logic ────────────────────────────────────────────────────────────────

def run_dedup(execute: bool, categories: set[str], window_hours: float) -> None:
    print(f"\n{'='*70}")
    print(f"  Falcon Scout job dedup — {'EXECUTE' if execute else 'DRY RUN'}")
    print(f"  Categories: {', '.join(sorted(categories))}  |  Window: {window_hours}h")
    print(f"{'='*70}\n")

    totals: dict[str, int] = defaultdict(int)

    with Session(engine) as session:
        all_jobs: list[Job] = session.query(Job).order_by(Job.id).all()

        # ── A: Bot noise ──────────────────────────────────────────────────
        if "A" in categories:
            print("CATEGORY A — Bot noise (Telegram system messages saved as jobs)\n")
            a_groups: dict[str, list[Job]] = defaultdict(list)
            for j in all_jobs:
                if _is_bot_noise(j):
                    a_groups[_normalize(j.title)].append(j)

            found = False
            for norm in sorted(a_groups):
                group = sorted(a_groups[norm], key=lambda j: j.id)
                if len(group) < 2:
                    continue
                found = True
                keep, delete = group[0], group[1:]
                totals["a_groups"] += 1
                totals["a_deleted"] += len(delete)
                print(f"  '{_safe(keep.title, 60)}'  ×{len(group)}")
                print(f"    keep Job#{keep.id}, delete {[d.id for d in delete]}")
                if execute:
                    for d in delete:
                        session.delete(d)
            if not found:
                print("  (none)\n")
            print()

        # ── B: Junk / parser-artifact titles ─────────────────────────────
        if "B" in categories:
            print("CATEGORY B — Junk / parser-artifact titles\n")
            b_groups: dict[str, list[Job]] = defaultdict(list)
            for j in all_jobs:
                if _is_junk_title(j) and not _is_bot_noise(j):
                    b_groups[_normalize(j.title)].append(j)

            found = False
            for norm in sorted(b_groups):
                group = sorted(b_groups[norm], key=lambda j: j.id)
                if len(group) < 2:
                    continue
                found = True
                totals["b_groups"] += 1

                delete_ok: list[Job] = []
                skip_kids: list[tuple[Job, dict]] = []
                for j in group[1:]:
                    counts = _child_counts(session, j.id)
                    (skip_kids if any(counts.values()) else delete_ok).append(
                        (j, counts) if any(counts.values()) else j
                    )

                totals["b_deleted"] += len(delete_ok)
                totals["b_skipped"] += len(skip_kids)

                print(f"  '{_safe(group[0].title, 50)}'  ×{len(group)}")
                if delete_ok:
                    print(f"    delete (no children): {[j.id for j in delete_ok]}")
                for j, ch in skip_kids:
                    non_zero = {k: v for k, v in ch.items() if v}
                    print(f"    SKIP Job#{j.id} — has children: {non_zero}")
                if execute:
                    for j in delete_ok:
                        session.delete(j)
                print()
            if not found:
                print("  (none)\n")
            print()

        # ── C: True listener duplicates ───────────────────────────────────
        if "C" in categories:
            print(f"CATEGORY C — Listener duplicates (same title within {window_hours}h)\n")
            c_groups: dict[str, list[Job]] = defaultdict(list)
            for j in all_jobs:
                if _is_bot_noise(j) or _is_junk_title(j):
                    continue
                norm = _normalize(j.title)
                if len(norm) > 10:
                    c_groups[norm].append(j)

            found = False
            for norm in sorted(c_groups):
                group = c_groups[norm]
                if len(group) < 2:
                    continue

                # Sub-group by time: members whose captured_at is within window_hours
                # of the FIRST member in the sub-group (earliest captured).
                by_time = sorted(
                    group,
                    key=lambda j: (_parse_dt(j.captured_at) or datetime.min),
                )
                sub_groups: list[list[Job]] = []
                current: list[Job] = [by_time[0]]
                for j in by_time[1:]:
                    dt0 = _parse_dt(current[0].captured_at)
                    dtj = _parse_dt(j.captured_at)
                    if dt0 and dtj and (dtj - dt0).total_seconds() <= window_hours * 3600:
                        current.append(j)
                    else:
                        if len(current) > 1:
                            sub_groups.append(current)
                        current = [j]
                if len(current) > 1:
                    sub_groups.append(current)

                for sub in sub_groups:
                    found = True
                    canonical = _select_canonical(session, sub)
                    redundant = [j for j in sub if j.id != canonical.id]
                    totals["c_groups"] += 1
                    totals["c_deleted"] += len(redundant)

                    dts = [_parse_dt(j.captured_at) for j in sub if _parse_dt(j.captured_at)]
                    span = f"{(max(dts)-min(dts)).total_seconds()/60:.0f}m apart" if len(dts) >= 2 else ""

                    print(f"  '{_safe(canonical.title, 64)}'  {span}")
                    c_uid = (canonical.upwork_job_id or "NULL")[:22]
                    c_enr = "enriched" if canonical.enriched_at else "unenriched"
                    print(f"    canonical Job#{canonical.id}  uid={c_uid}  {c_enr}")

                    for r in redundant:
                        moved = _repoint_children(session, r.id, canonical.id, execute=execute)
                        totals["c_repointed"] += sum(moved.values())
                        r_uid = (r.upwork_job_id or "NULL")[:22]
                        moved_str = " ".join(f"{k}:{v}" for k, v in moved.items()) or "none"
                        print(f"    delete   Job#{r.id}   uid={r_uid}  re-pointed={moved_str}")
                    print()

            if not found:
                print("  (none)\n")

        if execute:
            session.commit()
            print("[committed]\n")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"{'='*70}")
    print("  SUMMARY")
    print(f"{'='*70}")
    if "A" in categories:
        print(f"  A (bot noise)       {totals['a_groups']:3d} groups  {totals['a_deleted']:3d} deleted")
    if "B" in categories:
        print(
            f"  B (junk titles)     {totals['b_groups']:3d} groups  {totals['b_deleted']:3d} deleted"
            f"  {totals['b_skipped']:3d} skipped (have children)"
        )
    if "C" in categories:
        print(
            f"  C (listener dupes)  {totals['c_groups']:3d} groups  {totals['c_deleted']:3d} deleted"
            f"  {totals['c_repointed']:3d} child records re-pointed"
        )
    total = totals["a_deleted"] + totals["b_deleted"] + totals["c_deleted"]
    print(f"\n  TOTAL: {total} rows {'deleted' if execute else 'would be deleted'}.")
    if not execute:
        print("\n  -> Re-run with --execute to apply changes.")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Dedup duplicate Job rows in the Falcon Scout database.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See module docstring for full details.",
    )
    ap.add_argument(
        "--execute",
        action="store_true",
        help="Apply changes. Without this flag the script runs in dry-run mode.",
    )
    ap.add_argument(
        "--categories",
        default="A,B,C",
        help="Comma-separated subset: A (bot noise), B (junk titles), C (listener dupes). Default: A,B,C",
    )
    ap.add_argument(
        "--window",
        type=float,
        default=4.0,
        help="Hour window for category-C duplicate matching (default: 4.0).",
    )
    args = ap.parse_args()
    cats = {c.strip().upper() for c in args.categories.split(",")}
    run_dedup(execute=args.execute, categories=cats, window_hours=args.window)


if __name__ == "__main__":
    main()
