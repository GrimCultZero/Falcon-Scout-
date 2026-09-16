# -*- coding: utf-8 -*-
"""Export the full Upwork application history to Excel for analysis.

One row per proposal, joined to the job it was sent for, plus the derived
measures that actually explain outcomes — above all TIME TO BID (how long after
the job was posted the proposal went out), which is the metric the raw tables
cannot answer without this join.

Competitive fields (proposal count, interviewing, bid range) are read from
proposals.job_snapshot_json FIRST. That snapshot is taken at send time; the
jobs row is live and gets re-enriched later, so it reports the competition as it
is now, not as it was when the bid was placed. Using the live row would quietly
overstate competition on older applications.

Run:  python tools/export_applications.py [output.xlsx]
"""
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "upwork_jobs.db"

# Outcome tiers. "viewed" means the client opened it; "replied" and beyond mean
# they engaged. Both matter, and they fail for different reasons, so they are
# counted separately everywhere rather than merged into one "response" number.
VIEWED_PLUS = {"viewed", "replied", "interviewing", "hired"}
REPLIED_PLUS = {"replied", "interviewing", "hired"}
PENDING = {"sent"}

STATUS_FILL = {
    "hired": "C6EFCE",
    "interviewing": "D9EAD3",
    "replied": "FFF2CC",
    "viewed": "DDEBF7",
    "invited": "E4DFEC",
    "ghosted": "F2F2F2",
    "sent": "FFFFFF",
}

HDR_FILL = PatternFill("solid", fgColor="1F3864")
HDR_FONT = Font(bold=True, color="FFFFFF", size=10)
TITLE_FONT = Font(bold=True, size=13, color="1F3864")
NOTE_FONT = Font(italic=True, size=9, color="808080")
THIN = Side(style="thin", color="BFBFBF")


def parse_dt(v):
    """Parse the timestamp shapes present in this DB, else None.

    posted_date arrives in two forms ('...T15:24:29+0000' and '2026-09-16
    15:19:48') because it comes from two different capture paths. Both are UTC,
    as are the DATETIME columns, so they are directly comparable.
    """
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    s = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", s)  # +0000 -> +00:00
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).replace(tzinfo=None)
    except Exception:
        return None


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(re.sub(r"[^\d.\-]", "", str(v)) or 0)
    except Exception:
        return None


def lag_bucket(h):
    if h is None:
        return "unknown"
    if h < 0:
        return "?? negative"
    if h < 1:
        return "A <1h"
    if h < 3:
        return "B 1-3h"
    if h < 6:
        return "C 3-6h"
    if h < 12:
        return "D 6-12h"
    if h < 24:
        return "E 12-24h"
    if h < 72:
        return "F 1-3d"
    return "G 3d+"


def words(t):
    return len((t or "").split())


def len_bucket(w):
    if not w:
        return "unknown"
    if w < 100:
        return "A <100w"
    if w < 150:
        return "B 100-150w"
    if w < 200:
        return "C 150-200w"
    if w < 300:
        return "D 200-300w"
    return "E 300w+"


COLUMNS = [
    # (header, width, key)
    ("Sent (UTC)",           18, "sent_at"),
    ("Posted (UTC)",         18, "posted_at"),
    ("Hours to bid",         12, "hours_to_bid"),
    ("Bid speed",            12, "lag_bucket"),
    ("Sent weekday",         13, "weekday"),
    ("Sent hour (UTC)",      14, "hour"),
    ("Status",               13, "status"),
    ("Status changed",       18, "status_updated_at"),
    ("Days to outcome",      15, "days_to_outcome"),
    ("Job title",            52, "title"),
    ("Category",             22, "category"),
    ("Project type",         13, "project_type"),
    ("Budget / rate",        18, "budget"),
    ("My bid",               12, "bid_amount"),
    ("Currency",              9, "bid_currency"),
    ("Connects spent",       14, "connects_required"),
    ("Proposals @ send",     16, "n_proposals"),
    ("Interviewing @ send",  18, "interviewing"),
    ("Bid low @ send",       14, "bid_low"),
    ("Bid avg @ send",       14, "bid_average"),
    ("Bid high @ send",      14, "bid_high"),
    ("Client country",       16, "client_country"),
    ("Client rating",        13, "client_rating_score"),
    ("Client reviews",       14, "client_review_count"),
    ("Client total spent",   18, "client_spend"),
    ("Client hires",         12, "client_hires"),
    ("Client jobs posted",   17, "client_jobs_posted"),
    ("Client hire rate %",   17, "hire_rate"),
    ("Payment verified",     16, "payment_verified"),
    ("Experience level",     16, "experience_level"),
    ("Duration",             16, "duration"),
    ("Hours/week",           14, "hours_per_week"),
    ("Geo restriction",      16, "geo_restriction"),
    ("Cover letter words",   17, "cover_words"),
    ("Cover length band",    17, "len_bucket"),
    ("Cover letter",         70, "sent_text"),
    ("Client reply",         50, "client_reply_text"),
    ("Contract value",       14, "contract_value"),
    ("Notes",                28, "notes"),
    ("Job description",      70, "description_full"),
    ("Job URL",              40, "url"),
    ("Proposal ID",          12, "id"),
]


def load(conn):
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT p.*, j.title, j.url, j.category, j.keywords, j.description_full,
               j.posted_date, j.captured_at, j.project_type, j.experience_level,
               j.duration, j.hours_per_week, j.geo_restriction,
               j.hourly_rate_min, j.hourly_rate_max, j.fixed_budget,
               j.connects_required   AS j_connects,
               j.proposals           AS j_proposals,
               j.interviewing        AS j_interviewing,
               j.bid_low             AS j_bid_low,
               j.bid_average         AS j_bid_average,
               j.bid_high            AS j_bid_high,
               j.client_country, j.client_spend, j.client_hires,
               j.client_jobs_posted, j.hire_rate, j.payment_verified,
               j.client_rating_score, j.client_review_count
        FROM proposals p
        LEFT JOIN jobs j ON j.id = p.job_id
        ORDER BY p.sent_at DESC
    """).fetchall()

    out = []
    for r in rows:
        d = dict(r)
        # Prefer the send-time snapshot for anything competitive.
        snap = {}
        if d.get("job_snapshot_json"):
            try:
                snap = json.loads(d["job_snapshot_json"]) or {}
            except Exception:
                snap = {}

        def pick(snap_key, live_key):
            v = snap.get(snap_key)
            return v if v not in (None, "") else d.get(live_key)

        sent = parse_dt(d.get("sent_at"))
        posted = parse_dt(snap.get("posted_date") or d.get("posted_date"))
        changed = parse_dt(d.get("status_updated_at"))

        hours = None
        if sent and posted:
            hours = round((sent - posted).total_seconds() / 3600.0, 2)
        days_out = None
        if sent and changed and d.get("status") not in PENDING:
            days_out = round((changed - sent).total_seconds() / 86400.0, 2)

        budget = ""
        lo, hi = d.get("hourly_rate_min"), d.get("hourly_rate_max")
        if lo or hi:
            budget = f"${lo or '?'}-{hi or '?'}/hr"
        elif d.get("fixed_budget"):
            budget = f"${d['fixed_budget']} fixed"

        cover = d.get("sent_text") or ""
        w = words(cover)
        rec = {
            "id": d.get("id"),
            "sent_at": sent,
            "posted_at": posted,
            "hours_to_bid": hours,
            "lag_bucket": lag_bucket(hours),
            "weekday": sent.strftime("%a") if sent else "",
            "hour": sent.hour if sent else None,
            "status": d.get("status") or "",
            "status_updated_at": changed,
            "days_to_outcome": days_out,
            "title": d.get("title") or "",
            "category": d.get("category") or "",
            "project_type": pick("project_type", "project_type") or "",
            "budget": budget,
            "bid_amount": num(d.get("bid_amount")),
            "bid_currency": d.get("bid_currency") or "",
            "connects_required": pick("connects_required", "j_connects"),
            "n_proposals": pick("proposals", "j_proposals"),
            "interviewing": pick("interviewing", "j_interviewing"),
            "bid_low": num(pick("bid_low", "j_bid_low")),
            "bid_average": num(pick("bid_average", "j_bid_average")),
            "bid_high": num(pick("bid_high", "j_bid_high")),
            "client_country": pick("client_country", "client_country") or "",
            "client_rating_score": pick("client_rating_score", "client_rating_score"),
            "client_review_count": pick("client_review_count", "client_review_count"),
            "client_spend": pick("client_spend", "client_spend") or "",
            "client_hires": pick("client_hires", "client_hires"),
            "client_jobs_posted": pick("client_jobs_posted", "client_jobs_posted"),
            "hire_rate": pick("hire_rate", "hire_rate"),
            "payment_verified": pick("payment_verified", "payment_verified"),
            "experience_level": pick("experience_level", "experience_level") or "",
            "duration": pick("duration", "duration") or "",
            "hours_per_week": pick("hours_per_week", "hours_per_week") or "",
            "geo_restriction": d.get("geo_restriction") or "",
            "cover_words": w,
            "len_bucket": len_bucket(w),
            "sent_text": cover[:32000],
            "client_reply_text": (d.get("client_reply_text") or "")[:32000],
            "contract_value": d.get("contract_value") or "",
            "notes": (d.get("notes") or "")[:2000],
            "description_full": (d.get("description_full") or "")[:32000],
            "url": d.get("url") or "",
        }
        out.append(rec)
    return out


def style_header(ws, ncols, row=1):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HDR_FILL
        cell.font = HDR_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = 30


def sheet_applications(wb, recs):
    ws = wb.create_sheet("Applications")
    ws.append([h for h, _, _ in COLUMNS])
    style_header(ws, len(COLUMNS))
    for rec in recs:
        ws.append([rec.get(k) for _, _, k in COLUMNS])

    for i, (_, width, key) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    status_col = [k for _, _, k in COLUMNS].index("status") + 1
    for r in range(2, ws.max_row + 1):
        st = ws.cell(row=r, column=status_col).value
        fill = STATUS_FILL.get(st)
        if fill:
            ws.cell(row=r, column=status_col).fill = PatternFill("solid", fgColor=fill)
        for c in (1, 2, 8):
            ws.cell(row=r, column=c).number_format = "yyyy-mm-dd hh:mm"
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{ws.max_row}"
    return ws


def rate_table(ws, title, rows, first_header, start_row):
    """Write one analysis block: label, sent, viewed+, replied+, and rates."""
    ws.cell(row=start_row, column=1, value=title).font = TITLE_FONT
    hdr = [first_header, "Sent", "Viewed+", "Replied+", "Viewed %", "Replied %"]
    r = start_row + 1
    for i, h in enumerate(hdr, start=1):
        ws.cell(row=r, column=i, value=h)
    style_header(ws, len(hdr), row=r)
    for label, tot, vp, rp in rows:
        r += 1
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=tot)
        ws.cell(row=r, column=3, value=vp)
        ws.cell(row=r, column=4, value=rp)
        c5 = ws.cell(row=r, column=5, value=(vp / tot if tot else None))
        c6 = ws.cell(row=r, column=6, value=(rp / tot if tot else None))
        c5.number_format = "0.0%"
        c6.number_format = "0.0%"
        for c in range(1, 7):
            ws.cell(row=r, column=c).border = Border(bottom=THIN)
    return r + 2


def group_rates(recs, keyfn, min_n=1, sort_key=None):
    tot, vp, rp = Counter(), Counter(), Counter()
    for rec in recs:
        k = keyfn(rec)
        if k in (None, "", "unknown"):
            k = "(unknown)"
        tot[k] += 1
        if rec["status"] in VIEWED_PLUS:
            vp[k] += 1
        if rec["status"] in REPLIED_PLUS:
            rp[k] += 1
    keys = [k for k in tot if tot[k] >= min_n]
    keys.sort(key=sort_key or (lambda k: str(k)))
    return [(k, tot[k], vp[k], rp[k]) for k in keys]


def sheet_analysis(wb, recs):
    ws = wb.create_sheet("Analysis")
    ws.column_dimensions["A"].width = 30
    for col in "BCDEF":
        ws.column_dimensions[col].width = 13

    r = 1
    ws.cell(row=r, column=1, value="Upwork application analysis").font = Font(bold=True, size=16, color="1F3864")
    r += 1
    ws.cell(row=r, column=1,
            value="Viewed+ = client opened the proposal. Replied+ = client actually responded. "
                  "Read the two separately: they fail for different reasons.").font = NOTE_FONT
    r += 2

    total = len(recs)
    vp = sum(1 for x in recs if x["status"] in VIEWED_PLUS)
    rp = sum(1 for x in recs if x["status"] in REPLIED_PLUS)
    hired = sum(1 for x in recs if x["status"] == "hired")
    pend = sum(1 for x in recs if x["status"] in PENDING)
    conn_spent = sum(int(x["connects_required"] or 0) for x in recs)
    r = rate_table(ws, "Overall", [("All applications", total, vp, rp)], "Scope", r)
    ws.cell(row=r, column=1, value=f"Hired: {hired}    Still pending: {pend}    "
                                   f"Connects spent: {conn_spent}").font = NOTE_FONT
    r += 2

    r = rate_table(ws, "By month sent", group_rates(recs, lambda x: x["sent_at"].strftime("%Y-%m") if x["sent_at"] else None), "Month", r)
    r = rate_table(ws, "By bid speed (time from posting to your bid)", group_rates(recs, lambda x: x["lag_bucket"]), "Bid speed", r)
    r = rate_table(ws, "By cover letter length", group_rates(recs, lambda x: x["len_bucket"]), "Length", r)

    def prop_band(x):
        n = num(x["n_proposals"])
        if n is None:
            return None
        for hi, lab in ((5, "A 0-5"), (10, "B 6-10"), (15, "C 11-15"), (20, "D 16-20"), (50, "E 21-50")):
            if n <= hi:
                return lab
        return "F 50+"
    r = rate_table(ws, "By competition (other proposals at send time)", group_rates(recs, prop_band), "Proposals", r)

    def hire_band(x):
        h = num(x["hire_rate"])
        if h is None:
            return None
        for hi, lab in ((25, "A 0-25%"), (50, "B 26-50%"), (75, "C 51-75%")):
            if h <= hi:
                return lab
        return "D 76-100%"
    r = rate_table(ws, "By client hire rate", group_rates(recs, hire_band), "Hire rate", r)

    r = rate_table(ws, "By project type", group_rates(recs, lambda x: x["project_type"], min_n=3), "Type", r)
    r = rate_table(ws, "By weekday sent", group_rates(
        recs, lambda x: x["weekday"],
        sort_key=lambda k: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].index(k) if k in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] else 9), "Weekday", r)
    r = rate_table(ws, "By client country (5+ applications)", group_rates(recs, lambda x: x["client_country"], min_n=5), "Country", r)
    return ws


def sheet_quality(wb, recs, conn):
    ws = wb.create_sheet("Read this first")
    ws.column_dimensions["A"].width = 120
    lines = []
    last_viewed = conn.execute(
        "SELECT MAX(status_updated_at) FROM proposals WHERE status='viewed'").fetchone()[0]
    runs = conn.execute("SELECT COUNT(*), MAX(ts) FROM sync_runs").fetchone()

    lines.append(("Data quality — read before drawing conclusions", "title"))
    lines.append(("", "n"))
    lines.append(("The outcome columns are only as good as the tracking that produced them, and the "
                  "tracking was broken for part of this period. Three specific limits:", "n"))
    lines.append(("", "n"))
    lines.append((f"1. VIEW DETECTION STOPPED. No proposal has been marked 'viewed' since "
                  f"{(last_viewed or '?')[:10]}. The sync that detects views was writing nothing to the "
                  f"backend — fixed on 2026-09-16. Anything sent after that date is almost certainly "
                  f"under-counted: it may show 'ghosted' when the client did look.", "b"))
    lines.append(("", "n"))
    lines.append(("2. REPLY DETECTION WAS DEAD. The messages leg never opened its window at all "
                  "(a Chrome bounds error), so replies were only recorded when noticed by hand. "
                  "Fixed 2026-09-16. 'Replied' is therefore a floor, not a true count.", "b"))
    lines.append(("", "n"))
    lines.append(("3. VIEWS ARE STILL PARTIAL. The proposals scraper reads only page 1 of 7 "
                  "(10 of 67 live proposals). Older applications cannot be re-checked, so their "
                  "status is frozen at whatever was last observed.", "b"))
    lines.append(("", "n"))
    lines.append((f"   (sync_runs: {runs[0]} recorded runs, most recent {runs[1]})", "n"))
    lines.append(("", "n"))
    lines.append(("What this means for the analysis: treat GHOSTED as 'no response detected', not as "
                  "'no response happened'. The month-over-month trend is still meaningful for May-August, "
                  "because the same (imperfect) detection applied throughout. September is not comparable "
                  "to earlier months and should be judged again after a few weeks of working tracking.", "n"))
    lines.append(("", "n"))
    lines.append(("Definitions", "title"))
    lines.append(("Viewed+   = viewed, replied, interviewing or hired (client opened the proposal)", "n"))
    lines.append(("Replied+  = replied, interviewing or hired (client actually responded)", "n"))
    lines.append(("Hours to bid = your send time minus the job's posting time. Both are UTC.", "n"))
    lines.append(("Competition columns are taken from the snapshot stored AT SEND TIME, not from the "
                  "live job record, so they reflect what you were bidding into.", "n"))

    r = 1
    for text, kind in lines:
        c = ws.cell(row=r, column=1, value=text)
        if kind == "title":
            c.font = TITLE_FONT
        elif kind == "b":
            c.font = Font(size=10)
        else:
            c.font = Font(size=10, color="404040")
        c.alignment = Alignment(wrap_text=True, vertical="top")
        r += 1
    return ws


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"D:\ITForce\upwork-applications.xlsx")
    conn = sqlite3.connect(str(DB))
    recs = load(conn)

    wb = Workbook()
    wb.remove(wb.active)
    sheet_quality(wb, recs, conn)
    sheet_analysis(wb, recs)
    sheet_applications(wb, recs)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"wrote {out}  ({len(recs)} applications)")
    dated = sum(1 for x in recs if x["hours_to_bid"] is not None)
    print(f"  with a computable bid lag: {dated}/{len(recs)}")


if __name__ == "__main__":
    main()
