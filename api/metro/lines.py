"""One place for the one-line results Metro shows (F5, item 3, Oleh 25 Nov): a result line says only what happened.

A count of zero is never printed. "Enriched 20 - all 20 already had a website, nothing new found", not "0 domains found,
0 not found, 20 already had one". The front end has the same helper (frontend/src/metro/lib/resultLines.js) with the same
rules and a test that pins both.

    part(3, "new website")            -> "3 new websites"
    part(0, "new website")            -> None
    line("Hooks", part(5, "hook"), part(0, "check"))   -> "Hooks - 5 hooks"
"""
from __future__ import annotations


def plural(n: int, one: str, many: str | None = None) -> str:
    n = int(n or 0)
    return f"{n} {one if n == 1 else (many or one + 's')}"


def part(n, one: str, many: str | None = None, tail: str = "") -> str | None:
    """"3 leads" (+ tail), or None when the count is zero (so it is dropped from the line)."""
    n = int(n or 0)
    if n <= 0:
        return None
    return plural(n, one, many) + (f" {tail}" if tail else "")


def join(parts) -> str:
    return ", ".join(p for p in parts if p)


def line(head: str, *parts: str | None, sep: str = " - ") -> str:
    """head + sep + the parts that are not None/empty; the head alone when there is nothing to add."""
    tail = join(parts)
    return f"{head}{sep}{tail}" if tail else head


def enrich_line(*, done: int, total: int, found: int, had: int, missing: int, failed: int = 0, stopped: bool = False) -> str:
    """The end of an enrich run.
       "Enriched 20 - all 20 already had a website, nothing new found"
       "Enriched 20 - 3 new websites found, 2 still missing"
       "Enriched 5 of 50 (stopped) - nothing new found, 5 still missing"
    `found` = websites found by this run, `had` = companies that already had one, `missing` = still no website."""
    if done <= 0:
        head = "Enrich stopped before any company was done" if stopped else "Enrich finished with nothing to do"
        return line(head, part(failed, "failure"))
    head = f"Enriched {done}" + (f" of {total} (stopped)" if stopped else "")
    if found <= 0 and missing <= 0 and had > 0:
        site = (f"all {done} already had a website" if had >= done else f"{plural(had, 'company', 'companies')} already had a website")
        bits = [site, "nothing new found"]
    else:
        bits = [part(found, "new website", tail="found") or "nothing new found", f"{missing} still missing" if missing > 0 else None]
    return line(head, join(bits), part(failed, "failed", "failed"))


def not_started(reason: str | None, fallback: str = "Nothing was started") -> str:
    return reason or fallback
