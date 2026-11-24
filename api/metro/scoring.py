"""Layer 1 (business fit) and layer 2 (deep) scores, and the shortlist (METRO_PLAN.md Phase 2, step 6).

Both layers are the sum of editable RULES over the stored, dated snapshots; nothing is guessed. A rule reads
one field by path (e.g. `website.signals.ga4`), applies a test, and adds points when the test is true. A field
that was never measured makes its rule "unknown": it adds nothing and is listed as not measured, so a score
always says how much of it rests on evidence (`coverage`).

Rule sets are separate for the two campaign types:
  agency - white-label partner agencies: do they sell the services we deliver, are they alive and growing?
  niche  - direct clients in one niche: is there a visible gap we can fix, and the means to pay?
Layer 1 rules read the website, PageSpeed, Ads Transparency and Business Profile snapshots. Layer 2 rules read
Ahrefs (niche campaigns only) and the LinkedIn company page. Rules are stored in Settings (`fit_rules`),
validated on save, and `DEFAULT_RULES` is what a fresh install uses.
"""
from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy.orm import Session

from .db import MetroCompany, MetroLead, MetroSetting, utcnow

OPS = ("true", "false", "lt", "lte", "gt", "gte", "eq", "contains_any", "len_gte", "len_lt")
LAYERS = (1, 2)
ROOTS = ("website", "pagespeed", "ads", "gbp", "ahrefs", "linkedin_company", "lead")


def _r(id, layer, label, path, op, value, points):
    return {"id": id, "layer": layer, "label": label, "path": path, "op": op, "value": value, "points": points}


DEFAULT_RULES = {
    "agency": [
        _r("site_up", 1, "The website answers", "website.ok", "true", None, 10),
        _r("sells_ppc", 1, "Names paid search / Google Ads / PPC on its site", "website.marketing_terms", "contains_any", ["ppc", "google_ads"], 25),
        _r("sells_seo", 1, "Names SEO on its site", "website.marketing_terms", "contains_any", ["seo"], 10),
        _r("sells_more", 1, "Names other marketing services (web, social, content)", "website.marketing_terms", "contains_any",
           ["web_design", "social_media", "content", "branding", "email_marketing", "ecommerce"], 10),
        _r("says_white_label", 1, "Mentions white label", "website.marketing_terms", "contains_any", ["white_label"], 10),
        _r("service_pages", 1, "Has three or more service pages", "website.service_pages", "gte", 3, 5),
        _r("blog_fresh", 1, "Posted on its blog in the last 180 days", "website.blog.days_since", "lte", 180, 10),
        _r("own_email", 1, "Shows a public email on its own domain", "website.emails_on_own_domain", "len_gte", 1, 5),
        _r("runs_ads", 1, "Runs Google ads itself (Ads Transparency)", "ads.running", "true", None, 15),
        _r("li_size", 2, "LinkedIn page shows a team of 6 or more", "linkedin_company.employees_on_linkedin", "gte", 6, 40),
        _r("li_active", 2, "Posts on its LinkedIn page", "linkedin_company.recent_posts", "len_gte", 1, 30),
        _r("li_followers", 2, "300 or more followers on LinkedIn", "linkedin_company.followers", "gte", 300, 30),
    ],
    "niche": [
        _r("site_up", 1, "The website answers", "website.ok", "true", None, 10),
        _r("real_business", 1, "Has three or more service pages", "website.service_pages", "gte", 3, 5),
        _r("runs_ads", 1, "Runs Google ads (Ads Transparency): there is a budget", "ads.running", "true", None, 20),
        _r("no_analytics", 1, "No GA4, Universal Analytics or Tag Manager visible in the page source", "website.tracking.none_visible", "true", None, 12),
        _r("no_tag_manager", 1, "No Tag Manager: tracking gap", "website.signals.tag_manager", "false", None, 5),
        _r("no_ads_tag", 1, "No Google Ads tag on the site", "website.signals.google_ads", "false", None, 8),
        _r("no_call_tracking", 1, "No call tracking", "website.signals.call_tracking", "false", None, 5),
        _r("slow_mobile", 1, "Mobile PageSpeed below 50", "pagespeed.score", "lt", 50, 15),
        _r("meh_mobile", 1, "Mobile PageSpeed 50-69", "pagespeed.score_mid", "true", None, 6),
        _r("no_booking", 1, "No online booking tool or booking call to action", "website.booking.any", "false", None, 5),
        _r("few_reviews", 1, "Fewer than 50 Google reviews", "gbp.review_count", "lt", 50, 6),
        _r("weak_rating", 1, "Google rating below 4.3", "gbp.rating", "lt", 4.3, 6),
        _r("blog_stale", 1, "No blog post for over a year", "website.blog.days_since", "gt", 365, 5),
        _r("dr_low", 2, "Ahrefs domain rating below 20", "ahrefs.dr", "lt", 20, 30),
        _r("traffic_small", 2, "Organic traffic under 500 a month", "ahrefs.organic_traffic", "lt", 500, 25),
        _r("few_keywords", 2, "Under 100 ranking keywords", "ahrefs.organic_keywords", "lt", 100, 15),
        _r("li_page", 2, "A LinkedIn company page with a team of 6 or more", "linkedin_company.employees_on_linkedin", "gte", 6, 30),
    ],
}


def validate_rules(rules: dict) -> list[str]:
    errs = []
    if not isinstance(rules, dict):
        return ["rules must be an object with agency and niche lists"]
    for kind in ("agency", "niche"):
        lst = rules.get(kind)
        if lst is None:
            continue
        if not isinstance(lst, list):
            errs.append(f"{kind}: must be a list")
            continue
        ids = set()
        for i, r in enumerate(lst):
            where = f"{kind}[{i}]"
            if not isinstance(r, dict):
                errs.append(f"{where}: not an object")
                continue
            if not r.get("id") or r["id"] in ids:
                errs.append(f"{where}: needs a unique id")
            ids.add(r.get("id"))
            if r.get("layer") not in LAYERS:
                errs.append(f"{where}: layer must be 1 or 2")
            if r.get("op") not in OPS:
                errs.append(f"{where}: op must be one of {', '.join(OPS)}")
            path = str(r.get("path") or "")
            if path.split(".")[0] not in ROOTS:
                errs.append(f"{where}: path must start with one of {', '.join(ROOTS)}")
            pts = r.get("points")
            if not isinstance(pts, (int, float)) or isinstance(pts, bool) or not (-50 <= pts <= 50):
                errs.append(f"{where}: points must be a number from -50 to 50")
    return errs


def merge_rules(stored: dict | None) -> dict:
    out = {k: [dict(r) for r in v] for k, v in DEFAULT_RULES.items()}
    for kind in ("agency", "niche"):
        if stored and isinstance(stored.get(kind), list):
            out[kind] = stored[kind]
    return out


def rules_of(s: Session) -> dict:
    row = s.get(MetroSetting, "fit_rules")
    return merge_rules(json.loads(row.value_json) if row else None)


# ───────────────────────── evaluation ─────────────────────────

def _load(raw):
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def context(company: MetroCompany | None, lead: MetroLead | None = None) -> dict:
    """The stored snapshots a rule may read, with the derived fields the rules refer to. A snapshot that failed ({ok:false})
    is not evidence and reads as absent."""
    def good(raw):
        j = _load(raw)
        return j if isinstance(j, dict) and j.get("ok") else None

    ctx = {"website": good(company.website_scan_json) if company else None,
           "pagespeed": good(company.pagespeed_json) if company else None,
           "ads": good(company.ads_json) if company else None,
           "gbp": good(company.gbp_json) if company else None,
           "ahrefs": good(company.ahrefs_json) if company else None,
           "linkedin_company": good(company.linkedin_page_json) if company else None,
           "lead": {"persona_score": lead.persona_score} if lead else None}
    w = ctx["website"]
    if w is not None:
        b = w.get("booking") or {}
        b["any"] = bool(b.get("tool") or b.get("cta") or b.get("form"))
        w["booking"] = b
        sg = w.get("signals") or {}
        w["tracking"] = {"none_visible": not (sg.get("ga4") or sg.get("universal_analytics") or sg.get("tag_manager"))}
    ps = ctx["pagespeed"]
    if ps is not None and isinstance(ps.get("score"), (int, float)):
        ps["score_mid"] = 50 <= ps["score"] < 70
    return ctx


_MISSING = object()


def lookup(ctx: dict, path: str):
    cur = ctx
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur and cur[part] is not None:
            cur = cur[part]
        else:
            return _MISSING
    return cur


def _test(op: str, val, arg) -> bool:
    if op == "true":
        return val is True
    if op == "false":
        return val is False
    try:
        if op == "lt":
            return float(val) < float(arg)
        if op == "lte":
            return float(val) <= float(arg)
        if op == "gt":
            return float(val) > float(arg)
        if op == "gte":
            return float(val) >= float(arg)
        if op == "eq":
            return val == arg
        if op == "contains_any":
            return isinstance(val, (list, tuple)) and any(a in val for a in (arg or []))
        if op == "len_gte":
            return len(val) >= int(arg or 1)
        if op == "len_lt":
            return len(val) < int(arg or 1)
    except (TypeError, ValueError):
        return False
    return False


def evaluate(rules: list[dict], ctx: dict, layer: int) -> dict:
    """Score one layer. `score` is clipped to 0-100; `coverage` is the share of the layer's rules that could be read."""
    matched, unknown, total, readable = [], [], 0, 0
    pts = 0.0
    for r in rules:
        if r.get("layer") != layer:
            continue
        total += 1
        v = lookup(ctx, r["path"])
        if v is _MISSING:
            unknown.append({"id": r["id"], "label": r["label"], "path": r["path"]})
            continue
        readable += 1
        if _test(r["op"], v, r.get("value")):
            pts += float(r["points"])
            matched.append({"id": r["id"], "label": r["label"], "points": r["points"], "path": r["path"], "value": v if not isinstance(v, (dict, list)) else None})
    return {"score": max(0.0, min(100.0, round(pts, 1))), "coverage": round(readable / total, 2) if total else 0.0,
            "matched": matched, "not_measured": unknown, "rules": total}


def score_lead(s: Session, lead: MetroLead, campaign_type: str, *, rules: dict | None = None, now: datetime | None = None) -> dict:
    """Layers 1 and 2 for one lead; stores fit_score / deep_score and the notes. Layer 2 stays None until something layer-2
    was measured (so an unmeasured lead is never penalised for it)."""
    rules = rules or rules_of(s)
    rs = rules.get(campaign_type) or []
    company = s.get(MetroCompany, lead.company_id) if lead.company_id else None
    ctx = context(company, lead)
    l1 = evaluate(rs, ctx, 1)
    l2 = evaluate(rs, ctx, 2)
    notes = json.loads(lead.score_notes_json or "{}")
    notes["fit"] = {**l1, "at": (now or utcnow()).strftime("%Y-%m-%dT%H:%M:%SZ")}
    notes["deep"] = {**l2, "at": notes["fit"]["at"]}
    lead.fit_score = l1["score"] if l1["coverage"] > 0 else None
    lead.deep_score = l2["score"] if l2["coverage"] > 0 else None
    lead.score_notes_json = json.dumps(notes, ensure_ascii=False)
    return {"fit": l1, "deep": l2}


def score_campaign(s: Session, campaign, *, rules: dict | None = None) -> dict:
    rules = rules or rules_of(s)
    n = 0
    for lead in s.query(MetroLead).filter(MetroLead.campaign_id == campaign.id, MetroLead.status.in_(("new", "junk"))).all():
        score_lead(s, lead, campaign.type, rules=rules)
        n += 1
    s.commit()
    return {"scored": n}


def shortlist_filter(lead: MetroLead, min_fit: float) -> bool:
    """The shortlist: usable (status new), persona not junk, layer 1 measured and at or above the threshold."""
    return (lead.status == "new" and lead.persona_verdict != "junk" and lead.fit_score is not None and lead.fit_score >= min_fit)
