# -*- coding: utf-8 -*-
"""Import Metro's suppression list (METRO_PLAN.md Phase 0, step 7). DRY RUN by default.

  python tools/metro_import_suppression.py --file "Claude outputs/already_contacted_member_ids.csv"
  python tools/metro_import_suppression.py --proposals
  python tools/metro_import_suppression.py --file <csv> --proposals --apply

Only ever ADDS rows to metro_suppression; re-running adds nothing new; never deletes.
--file accepts any CSV with recognisable columns (member_id, profile URL, email, domain/website,
company), e.g. the IT Force client list once Artem sends it. Prints counts only, never the values
(they are lead data). Run from the project root inside .venv.
"""
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from sqlalchemy.orm import Session          # noqa: E402
from metro import suppression as sup        # noqa: E402
from metro.db import get_engine             # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", action="append", default=[], help="CSV to import (repeatable)")
    ap.add_argument("--reason", default=None, help="reason stored when the CSV has no src/reason column")
    ap.add_argument("--strength", choices=("hard", "soft"), default=None,
                    help="hard = never contact (default); soft = previously contacted. A file named already_contacted* is soft")
    ap.add_argument("--proposals", action="store_true", help="import Upwork clients from the proposals table")
    ap.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    args = ap.parse_args(argv)
    if not args.file and not args.proposals:
        ap.error("nothing to import: give --file and/or --proposals")

    dry = not args.apply
    with Session(get_engine()) as s:
        for f in args.file:
            p = Path(f)
            entries, cols = sup.entries_from_csv(p.read_text(encoding="utf-8-sig"),
                                                 default_reason=args.reason or f"listed in {p.name}")
            if not cols:
                print(f"{p.name}: no recognised column, skipped")
                continue
            strength = args.strength or ("soft" if p.name.lower().startswith("already_contacted") else "hard")
            res = sup.add_entries(s, entries, source=p.name, dry_run=dry, strength=strength)
            print(f"{p.name}: columns {cols}, {len(entries)} values -> {res.as_dict()}")
        if args.proposals:
            entries = sup.entries_from_proposals(s)
            res = sup.add_entries(s, entries, source="proposals", dry_run=dry)
            print(f"proposals: {len(entries)} values -> {res.as_dict()}")
        print(("DRY RUN, nothing written. Add --apply to write." if dry else "written.") + f" Now: {sup.stats(s)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
