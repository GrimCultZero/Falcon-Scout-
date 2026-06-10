"""
Upwork API client — OAuth2 (3-legged authorization-code) + GraphQL.

Why 3-legged: the probe proved this key rejects client-credentials
(`unauthorized_client`), so we use the browser-login flow. The key's registered
callback is http://localhost:8000/callback (this backend), so the flow is:

  1. User opens  GET /upwork/connect  → redirect to Upwork's authorize page.
  2. User logs in + approves → Upwork redirects to GET /callback?code=...
  3. /callback exchanges the code for access+refresh tokens, saved to
     .upwork_token.json at the repo root.
  4. All API calls use get_access_token(), which auto-refreshes when expired.

Read-only/public scopes only (job postings, client snapshots, work history).
Nothing here writes to Upwork.
"""

import os
import time
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / ".upwork_token.json"

API_KEY = (os.getenv("UPWORK_API_KEY") or "").strip()
API_SECRET = (os.getenv("UPWORK_API_SECRET") or "").strip()

AUTHORIZE_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize"
TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token"
GRAPHQL_URL = "https://api.upwork.com/graphql"
REDIRECT_URI = "http://localhost:8000/callback"

# Cloudflare fronts upwork.com and 403s the default python-httpx UA before the
# request reaches the OAuth/GraphQL handler. A browser-like UA gets us through.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


class UpworkError(Exception):
    pass


# ── Token storage ────────────────────────────────────────────────────────────

def _save_token(data: dict):
    """Persist token + computed absolute expiry. Stored at repo root (gitignore)."""
    expires_in = int(data.get("expires_in") or 0)
    record = {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        # 60s safety margin so we refresh slightly early.
        "expires_at": int(time.time()) + max(0, expires_in - 60),
        "raw": {k: v for k, v in data.items() if k != "access_token"},
    }
    TOKEN_FILE.write_text(json.dumps(record, indent=2), encoding="utf-8")
    return record


def _load_token() -> dict | None:
    if not TOKEN_FILE.exists():
        return None
    try:
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_connected() -> bool:
    t = _load_token()
    return bool(t and t.get("refresh_token"))


# ── OAuth flow ─────────────────────────────────────────────────────────────

def build_authorize_url() -> str:
    from urllib.parse import urlencode
    q = urlencode({
        "response_type": "code",
        "client_id": API_KEY,
        "redirect_uri": REDIRECT_URI,
    })
    return f"{AUTHORIZE_URL}?{q}"


def exchange_code(code: str) -> dict:
    """Trade the authorization code for access + refresh tokens."""
    with httpx.Client(timeout=30, headers=BROWSER_HEADERS) as client:
        r = client.post(TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": API_KEY,
            "client_secret": API_SECRET,
        })
    if r.status_code != 200:
        raise UpworkError(f"token exchange failed: HTTP {r.status_code} — {r.text[:300]}")
    return _save_token(r.json())


def _refresh(refresh_token: str) -> dict:
    with httpx.Client(timeout=30, headers=BROWSER_HEADERS) as client:
        r = client.post(TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": API_KEY,
            "client_secret": API_SECRET,
        })
    if r.status_code != 200:
        raise UpworkError(f"token refresh failed: HTTP {r.status_code} — {r.text[:300]}")
    return _save_token(r.json())


def get_access_token() -> str:
    t = _load_token()
    if not t:
        raise UpworkError("not connected — open /upwork/connect in a browser first")
    if int(time.time()) >= int(t.get("expires_at") or 0):
        if not t.get("refresh_token"):
            raise UpworkError("token expired and no refresh_token — reconnect via /upwork/connect")
        t = _refresh(t["refresh_token"])
    return t["access_token"]


# ── GraphQL ──────────────────────────────────────────────────────────────────

def graphql(query: str, variables: dict | None = None) -> dict:
    token = get_access_token()
    headers = {
        **BROWSER_HEADERS,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    with httpx.Client(timeout=60) as client:
        r = client.post(GRAPHQL_URL, headers=headers, json=payload)
    try:
        body = r.json()
    except Exception:
        raise UpworkError(f"GraphQL non-JSON response: HTTP {r.status_code} — {r.text[:300]}")
    if r.status_code != 200:
        raise UpworkError(f"GraphQL HTTP {r.status_code}: {json.dumps(body)[:400]}")
    return body


# ── Discovery probes (used by GET /upwork/probe) ─────────────────────────────

_INTROSPECT = """
query Introspect {
  __schema {
    queryType {
      fields { name description args { name } type { name kind ofType { name kind } } }
    }
  }
}
"""

# Best-guess marketplace search; whichever shape the schema actually exposes is
# the one we keep for the feed. Returned errors tell us the right field names.
_SAMPLE_SEARCH = """
query SearchJobs {
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: { searchExpression_eq: "google ads" }
    searchType: USER_JOBS_SEARCH
    sortAttributes: [{ field: RECENCY }]
  ) {
    totalCount
    edges {
      node {
        id title description ciphertext createdDateTime
        amount { rawValue currency }
        client { totalSpent { rawValue } totalHires totalReviews verificationStatus location { country } }
      }
    }
  }
}
"""


# ── Marketplace job search → Job-row mapping ─────────────────────────────────

def _money(m) -> "float | None":
    """Parse a Money node {rawValue, currency} → float (None if missing/bad)."""
    if not m:
        return None
    try:
        return float(m.get("rawValue"))
    except (TypeError, ValueError):
        return None


# Fields confirmed present on MarketplaceJobPostingSearchResult (probe2). We map
# these onto the jobs table; API-sourced jobs land already enriched.
_SEARCH_QUERY = """
query Search($expr: String, $n: Int!, $after: String!) {
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: { searchExpression_eq: $expr, pagination_eq: { first: $n, after: $after } }
    searchType: USER_JOBS_SEARCH
    sortAttributes: [{ field: RECENCY }]
  ) {
    totalCount
    edges {
      node {
        id title description ciphertext createdDateTime publishedDateTime
        amount { rawValue currency }
        hourlyBudgetMin { rawValue }
        hourlyBudgetMax { rawValue }
        durationLabel engagement experienceLevel category subcategory
        totalApplicants
        preferredFreelancerLocation preferredFreelancerLocationMandatory
        applied
        skills { prettyName }
        client {
          totalSpent { rawValue } totalHires totalPostedJobs totalReviews
          totalFeedback verificationStatus
          location { country }
        }
        job {
          activityStat {
            jobActivity {
              lastClientActivity invitesSent totalInvitedToInterview
              totalHired totalUnansweredInvites
            }
          }
        }
      }
    }
  }
}
"""


def _map_node(n: dict) -> dict:
    """Map one search result node → a Job-row dict (None values dropped)."""
    cipher = (n.get("ciphertext") or "").strip()
    upwork_job_id = cipher.lstrip("~") or (n.get("id") or None)
    desc = n.get("description") or ""
    client = n.get("client") or {}
    loc = client.get("location") or {}

    hmin = _money(n.get("hourlyBudgetMin"))
    hmax = _money(n.get("hourlyBudgetMax"))
    if hmin == 0:
        hmin = None
    if hmax == 0:
        hmax = None
    fixed = _money(n.get("amount"))
    spent = _money(client.get("totalSpent"))

    pref_loc = n.get("preferredFreelancerLocation")
    pref_mand = bool(n.get("preferredFreelancerLocationMandatory"))

    # Client quality — rating + hire rate are computable straight from the
    # search node (totalFeedback / totalHires / totalPostedJobs).
    reviews = client.get("totalReviews")
    feedback = client.get("totalFeedback")
    rating = (round(float(feedback), 2)
              if feedback is not None and (feedback > 0 or (reviews or 0) > 0)
              else None)
    posted = client.get("totalPostedJobs")
    hires = client.get("totalHires")
    hire_rate = (round(100.0 * hires / posted)
                 if posted and hires is not None else None)

    # Per-job activity (invites / interviewing / already-hired) — same block
    # the extension scrapes from the job page, but straight from the API.
    ja = (((n.get("job") or {}).get("activityStat") or {}).get("jobActivity") or {})

    skills = ", ".join(
        s.get("prettyName") for s in (n.get("skills") or [])
        if isinstance(s, dict) and s.get("prettyName")
    ) or None

    row = {
        "upwork_job_id": upwork_job_id,
        "title": n.get("title"),
        "url": f"https://www.upwork.com/jobs/{cipher}" if cipher else None,
        "description_snippet": desc[:500] or None,
        "description_full": desc or None,
        # raw_message is NOT NULL in the schema — guarantee something non-empty.
        "raw_message": desc or n.get("title") or "[Upwork API job]",
        "hourly_rate_min": hmin,
        "hourly_rate_max": hmax,
        # fixed_budget only when there's no hourly range (otherwise it's an hourly job)
        "fixed_budget": (f"${fixed:,.0f}" if (fixed and not hmin and not hmax) else None),
        "client_country": loc.get("country"),
        "category": n.get("category"),
        "posted_date": n.get("publishedDateTime") or n.get("createdDateTime"),
        "experience_level": n.get("experienceLevel"),
        "duration": n.get("durationLabel"),
        "project_type": n.get("engagement"),
        "proposals": (str(n["totalApplicants"]) if n.get("totalApplicants") is not None else None),
        # mandatory preferred location ≈ a hard geo restriction; soft one → preferred_qualifications
        "geo_restriction": (pref_loc if (pref_mand and pref_loc) else None),
        "preferred_qualifications": (f"Location: {pref_loc}" if (pref_loc and not pref_mand) else None),
        "client_total_spent_detail": (f"${spent:,.0f} total spent" if spent is not None else None),
        # Also populate client_spend (what JobList renders in the row) so API
        # jobs show client spend like bot jobs do.
        "client_spend": (f"${spent:,.0f}" if spent is not None else None),
        "client_hires": hires,
        "client_review_count": reviews,
        "client_rating_score": rating,
        "client_jobs_posted": posted,
        "hire_rate": hire_rate,
        "keywords": skills,
        "interviewing": ja.get("totalInvitedToInterview"),
        "invites_sent": ja.get("invitesSent"),
        "unanswered_invites": ja.get("totalUnansweredInvites"),
        # Per-job hires — the analyser's "ALREADY HIRED" hard-disqualifier signal.
        "client_already_hired": ja.get("totalHired"),
        "payment_verified": (client.get("verificationStatus") == "VERIFIED")
                            if client.get("verificationStatus") is not None else None,
        "source": "api",
        # NOTE: we deliberately do NOT stamp enriched_at. "Enriched" means the
        # Chrome extension scraped the FULL job+client detail (hire rate, avg
        # rate, client reviews, screening questions, connects, etc.). API jobs
        # carry only partial structured data, so they are NOT "enriched" — the
        # badge would lie. Artem can still run the extension Enrich on an API
        # job to get the full detail, which sets enriched_at then.
    }
    return {k: v for k, v in row.items() if v is not None}


def search_jobs(search_expression: str = "google ads", first: int = 50, after: str = "0"):
    """Run a marketplace search; return (mapped_rows, total_count).
    `after` is the page cursor — "0" is the first page (the upstream encodes
    paging as '{after};{first}', so a null after breaks it with a 500)."""
    data = graphql(_SEARCH_QUERY, {"expr": search_expression, "n": int(first), "after": str(after)})
    if data.get("errors"):
        raise UpworkError(f"search GraphQL errors: {json.dumps(data['errors'])[:400]}")
    block = (data.get("data") or {}).get("marketplaceJobPostingsSearch") or {}
    edges = block.get("edges") or []
    rows = []
    for e in edges:
        node = (e or {}).get("node")
        if not node:
            continue
        mapped = _map_node(node)
        if mapped.get("upwork_job_id"):
            rows.append(mapped)
    return rows, block.get("totalCount")


# ── Feed config + filtering ──────────────────────────────────────────────────
# The API search expression is loose OR-ish full-text (proved by probe: "ppc"
# and "google ads" return the same top jobs; multi-term broadens to noise). So
# we mirror the bot: per-keyword searches for breadth, then a HARD post-filter
# for precision (keyword-in-text + stop words + rate floors + country exclude).
# Config lives in feed_config.json at repo root; seeded from Artem's bot.

FEED_CONFIG_FILE = ROOT / "feed_config.json"

DEFAULT_FEED_CONFIG = {
    # Keywords — one API search each, results merged + deduped. (From the bot.)
    "keywords": [
        "google ads", "google ads audit", "google ads management", "ppc",
        "ppc audit", "paid search", "performance max", "pmax", "google shopping",
        "shopping campaigns", "account audit", "campaign audit",
        "seo audit", "seo strategy", "local seo", "technical seo",
    ],
    # Stop words — drop a job if its title/description contains any. (From the bot.)
    "stop_words": [
        "facebook", "linkedin", "tiktok", "tik tok", "amazon", "bing",
        "chatbot", "writer", "writers", "editor", "consultant", "coordinator",
        "cold caller", "ui designer", "app design", "website translation",
        "backend developer", "front-end developer", "full stack",
        "mobile app developer", "software development", "blockchain developer",
        "hubspot", "jira", "supabase", "react", "power apps", "microsoft",
        "automation specialist", "ai agent engineer", "security expert",
        "administrator", "uscreen", "openclaw",
    ],
    # Keep a job only if at least one keyword appears in title/description.
    # Tightens the API's loose full-text match. Set false to keep everything
    # the API returned (looser, more volume).
    "require_keyword_in_text": True,
    # Rate floors. A job with an hourly ceiling below min_hourly, or a fixed
    # budget below min_fixed, is dropped. Jobs with NO stated rate are KEPT
    # (many good postings omit budget; the analyser handles rate).
    "min_hourly": 25,
    "min_fixed": 100,
    # Country names to exclude (case-insensitive substring match on country).
    "exclude_countries": [],
    # Keep only payment-verified clients when true.
    "payment_verified_only": False,
    # Per-keyword page size and an overall cap to bound API calls per fetch.
    "per_keyword_limit": 20,
    # Background auto-fetch cadence in minutes (0 = off / manual only). The
    # backend loop pulls + filters on this interval so the API feed stays
    # current like the bot, even with the dashboard closed. 3 min ≈ "live"
    # (new jobs surface within ~3 min of posting) without risking rate limits.
    "auto_fetch_minutes": 3,
}


def load_feed_config() -> dict:
    cfg = dict(DEFAULT_FEED_CONFIG)
    if FEED_CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(FEED_CONFIG_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg


def save_feed_config(cfg: dict) -> dict:
    merged = dict(DEFAULT_FEED_CONFIG)
    merged.update({k: v for k, v in (cfg or {}).items() if k in DEFAULT_FEED_CONFIG})
    FEED_CONFIG_FILE.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    return merged


def _row_passes(row: dict, cfg: dict) -> "str | None":
    """Return a drop-reason string if the row should be filtered out, else None."""
    title = (row.get("title") or "").lower()
    desc = (row.get("description_full") or "").lower()
    blob = title + " " + desc

    stops = [s.lower() for s in (cfg.get("stop_words") or [])]
    for s in stops:
        if s and s in blob:
            return f"stopword:{s}"

    if cfg.get("require_keyword_in_text"):
        kws = [k.lower() for k in (cfg.get("keywords") or [])]
        if kws and not any(k in blob for k in kws):
            return "no-keyword-in-text"

    min_h = cfg.get("min_hourly") or 0
    hmax = row.get("hourly_rate_max") or row.get("hourly_rate_min")
    if min_h and hmax is not None and hmax < min_h:
        return f"hourly<{min_h}"

    min_f = cfg.get("min_fixed") or 0
    fixed = row.get("fixed_budget")
    if min_f and fixed:
        try:
            fval = float(str(fixed).lstrip("$").replace(",", ""))
            if fval < min_f:
                return f"fixed<{min_f}"
        except ValueError:
            pass

    excl = [c.lower() for c in (cfg.get("exclude_countries") or [])]
    country = (row.get("client_country") or "").lower()
    if excl and country and any(c in country for c in excl):
        return f"country:{country}"

    if cfg.get("payment_verified_only") and row.get("payment_verified") is not True:
        return "unverified-payment"

    return None


def fetch_and_filter(cfg: dict | None = None):
    """Run per-keyword searches, merge+dedup, then post-filter. Returns
    (kept_rows, stats) where stats explains what was fetched and dropped."""
    cfg = cfg or load_feed_config()
    per_kw = int(cfg.get("per_keyword_limit") or 20)
    keywords = cfg.get("keywords") or ["google ads"]

    seen = {}
    fetched = 0
    for kw in keywords:
        try:
            rows, _ = search_jobs(kw, per_kw)
        except Exception as e:
            print(f"[feed] keyword {kw!r} search failed: {e}")
            continue
        for r in rows:
            fetched += 1
            uid = r.get("upwork_job_id")
            if uid and uid not in seen:
                seen[uid] = r

    kept, drops = [], {}
    for r in seen.values():
        reason = _row_passes(r, cfg)
        if reason:
            drops[reason] = drops.get(reason, 0) + 1
        else:
            kept.append(r)

    stats = {
        "keywords": len(keywords),
        "fetched_raw": fetched,
        "unique": len(seen),
        "kept": len(kept),
        "dropped": len(seen) - len(kept),
        "drop_reasons": drops,
    }
    return kept, stats


def probe() -> dict:
    """Return a discovery report: root query fields + a sample search result."""
    out = {"root_queries": None, "sample_search": None, "errors": []}
    try:
        intro = graphql(_INTROSPECT)
        fields = (((intro.get("data") or {}).get("__schema") or {})
                  .get("queryType") or {}).get("fields") or []
        out["root_queries"] = [
            {"name": f["name"],
             "args": [a["name"] for a in (f.get("args") or [])],
             "description": (f.get("description") or "")[:160]}
            for f in fields
        ]
        if intro.get("errors"):
            out["errors"].append({"introspection": intro["errors"]})
    except Exception as e:
        out["errors"].append({"introspection": str(e)})

    try:
        search = graphql(_SAMPLE_SEARCH)
        out["sample_search"] = search
    except Exception as e:
        out["errors"].append({"sample_search": str(e)})

    return out
