"""
Upwork API probe — Phase 1 discovery.

Goal: with zero guessing, find out exactly what Artem's public read-only key
can do. We authenticate (client-credentials / 2-legged first), then use GraphQL
INTROSPECTION to list every root Query field and its arguments — that's the
self-documenting truth of what's available, instead of relying on prior
knowledge of Upwork's schema. Then we attempt a sample marketplace job search
and dump the raw shape so we can design the feed mapping from real responses.

Run:  python scripts/upwork_probe.py
Needs in .env:
    UPWORK_API_KEY=...        (the client key — visible on the dev keys page)
    UPWORK_API_SECRET=...     (the secret — reveal + copy from the dev keys page)

Nothing here writes to the DB or changes any state. Pure read/discovery.
"""

import os
import sys
import json
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Windows consoles default to cp1252 and choke on the ✓/✗/• glyphs below.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=True)

API_KEY = (os.getenv("UPWORK_API_KEY") or "").strip()
API_SECRET = (os.getenv("UPWORK_API_SECRET") or "").strip()

# Endpoints (Upwork OAuth2 + GraphQL). If auth fails on all variants we print
# the responses so we can adjust these without guessing blind.
TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token"
GRAPHQL_URL = "https://api.upwork.com/graphql"

# Cloudflare in front of upwork.com blocks the default python-httpx User-Agent
# with a 403 before the request ever reaches the OAuth/GraphQL handler. A
# browser-like UA + Accept headers get us past the edge.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _section(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def get_token_client_credentials():
    """2-legged OAuth — no browser, no callback. Right for public data scopes."""
    attempts = [
        # (label, kwargs for httpx.post)
        ("form body grant_type=client_credentials", dict(
            data={
                "grant_type": "client_credentials",
                "client_id": API_KEY,
                "client_secret": API_SECRET,
            },
        )),
        ("HTTP Basic auth + grant_type=client_credentials", dict(
            data={"grant_type": "client_credentials"},
            auth=(API_KEY, API_SECRET),
        )),
    ]
    with httpx.Client(timeout=30, headers=BROWSER_HEADERS) as client:
        for label, kwargs in attempts:
            try:
                r = client.post(TOKEN_URL, **kwargs)
            except Exception as e:
                print(f"  [{label}] request error: {e}")
                continue
            print(f"  [{label}] HTTP {r.status_code}")
            if r.status_code == 200:
                tok = r.json().get("access_token")
                if tok:
                    print(f"  ✓ got access_token ({len(tok)} chars) via: {label}")
                    return tok
            else:
                # Show the error body so we know WHY (bad creds vs wrong grant
                # vs client_credentials not allowed for this key).
                print(f"    body: {r.text[:400]}")
    return None


def gql(token, query, variables=None):
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
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"_raw": r.text[:1000]}


INTROSPECT_QUERY = """
query Introspect {
  __schema {
    queryType {
      fields {
        name
        description
        args { name }
        type { name kind ofType { name kind } }
      }
    }
  }
}
"""


def probe_root_queries(token):
    _section("ROOT QUERY FIELDS (what your key can actually ask for)")
    status, data = gql(token, INTROSPECT_QUERY)
    if status != 200:
        print(f"  introspection HTTP {status}")
        print("  " + json.dumps(data, indent=2)[:1500])
        return []
    if "errors" in data:
        print("  introspection returned errors (may be disabled on this key):")
        print("  " + json.dumps(data["errors"], indent=2)[:1500])
        return []
    fields = (((data.get("data") or {}).get("__schema") or {}).get("queryType") or {}).get("fields") or []
    if not fields:
        print("  no root fields returned — introspection likely disabled.")
        return []
    names = []
    for f in fields:
        args = ", ".join(a["name"] for a in (f.get("args") or []))
        t = f.get("type") or {}
        tname = t.get("name") or (t.get("ofType") or {}).get("name") or t.get("kind")
        names.append(f["name"])
        print(f"  • {f['name']}({args}) -> {tname}")
        if f.get("description"):
            print(f"      {f['description'][:120]}")
    print(f"\n  ({len(names)} root query fields total)")
    return names


# Best-guess marketplace job-search query. We try a couple of likely shapes;
# whichever the schema actually exposes (per introspection) is the one to keep.
SAMPLE_SEARCHES = [
    ("marketplaceJobPostingsSearch", """
query SearchJobs {
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: { searchExpression_eq: "google ads" }
    searchType: USER_JOBS_SEARCH
    sortAttributes: [{ field: RECENCY }]
  ) {
    totalCount
    edges {
      node {
        id
        title
        description
        ciphertext
        createdDateTime
        job { contractTerms { contractType } }
        amount { rawValue currency }
        hourlyBudgetMin { rawValue }
        hourlyBudgetMax { rawValue }
        client {
          totalSpent { rawValue }
          totalHires
          totalReviews
          verificationStatus
          location { country }
        }
      }
    }
  }
}
"""),
]


def probe_job_search(token, available):
    _section("SAMPLE JOB SEARCH (raw shape — for field mapping)")
    for field, query in SAMPLE_SEARCHES:
        if available and field not in available:
            print(f"  skipping '{field}' — not in this key's root query fields.")
            continue
        print(f"  trying '{field}' ...")
        status, data = gql(token, query)
        print(f"  HTTP {status}")
        if "errors" in (data or {}):
            print("  GraphQL errors (tells us which fields/args are wrong or gated):")
            print("  " + json.dumps(data["errors"], indent=2)[:2000])
        node = None
        try:
            edges = data["data"][field]["edges"]
            print(f"  totalCount: {data['data'][field].get('totalCount')}")
            node = edges[0]["node"] if edges else None
        except Exception:
            pass
        if node:
            print("  ── first job node (real field shape) ──")
            print("  " + json.dumps(node, indent=2)[:2500])
        elif "data" in (data or {}):
            print("  raw data block:")
            print("  " + json.dumps(data.get("data"), indent=2)[:1500])


def main():
    _section("UPWORK API PROBE")
    if not API_KEY or not API_SECRET:
        print("  ✗ Missing credentials. Add to .env:")
        print("      UPWORK_API_KEY=...")
        print("      UPWORK_API_SECRET=...")
        sys.exit(1)
    print(f"  key: {API_KEY[:6]}…{API_KEY[-4:]}  (secret present: {bool(API_SECRET)})")

    _section("AUTH — client credentials (2-legged, no browser)")
    token = get_token_client_credentials()
    if not token:
        print("\n  ✗ Could not get a token via client-credentials.")
        print("    Likely meaning: this key requires the 3-legged authorization-code")
        print("    flow (browser login → callback at http://localhost:8000/callback).")
        print("    Share the error bodies above and we'll wire the 3-legged flow next.")
        sys.exit(1)

    available = probe_root_queries(token)
    probe_job_search(token, available)

    _section("DONE")
    print("  Next: paste this output back. We'll map the real fields to the")
    print("  jobs table and design the API feed + filter panel from it.")


if __name__ == "__main__":
    main()
