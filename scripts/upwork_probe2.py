"""
Upwork API probe #2 — capability + filter discovery.

probe1 proved job search works and revealed schema queries we didn't expect
(vendorProposals, bidsForJob, roomList, clientsWorkHistory). Introspection lists
everything regardless of permission, so here we actually CALL the high-value
ones to see which the key is allowed to use — and we introspect the job-filter
input type to learn every available server-side filter.

Uses the saved token (.upwork_token.json). Run:
    .venv\\Scripts\\python.exe scripts\\upwork_probe2.py
"""
import sys, json
from pathlib import Path
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=True)
sys.path.insert(0, str(ROOT / "api"))

import upwork_api  # noqa: E402


def sect(t):
    print("\n" + "=" * 68 + "\n" + t + "\n" + "=" * 68)


def try_query(label, query):
    print(f"\n--- {label} ---")
    try:
        res = upwork_api.graphql(query)
    except Exception as e:
        print(f"  CALL FAILED: {e}")
        return None
    if res.get("errors"):
        print("  GraphQL errors (permission or shape):")
        print("  " + json.dumps(res["errors"], indent=2)[:900])
    if res.get("data"):
        print("  data:")
        print("  " + json.dumps(res["data"], indent=2)[:1200])
    return res


def main():
    sect("1. JOB FILTER INPUT TYPES (every server-side filter available)")
    intro = upwork_api.graphql("""
    query { __schema { types {
      name kind
      inputFields { name type { name kind ofType { name kind } } }
    } } }
    """)
    types = (((intro.get("data") or {}).get("__schema") or {}).get("types") or [])
    for t in types:
        n = (t.get("name") or "")
        if t.get("kind") == "INPUT_OBJECT" and "filter" in n.lower() and ("job" in n.lower() or "marketplace" in n.lower()):
            fields = t.get("inputFields") or []
            print(f"\n  {n}:")
            for f in fields:
                ft = f.get("type") or {}
                tn = ft.get("name") or (ft.get("ofType") or {}).get("name") or ft.get("kind")
                print(f"    - {f['name']}: {tn}")

    # Grab a real job id for the id-based capability tests.
    sect("2. CAPABILITY TESTS (can the key actually call these?)")
    search = upwork_api.graphql("""
    query { marketplaceJobPostingsSearch(
      marketPlaceJobFilter: { searchExpression_eq: "google ads" }
      searchType: USER_JOBS_SEARCH
      sortAttributes: [{ field: RECENCY }]
    ) { edges { node { id ciphertext } } } }
    """)
    jid = None
    try:
        jid = search["data"]["marketplaceJobPostingsSearch"]["edges"][0]["node"]["id"]
        print(f"  using sample job id: {jid}")
    except Exception:
        print("  (couldn't get a sample job id)")

    # vendorProposals — THE big one. If allowed → outcome sync via API.
    try_query("vendorProposals (your own proposals + statuses?)",
              "query { vendorProposals(pagination:{first:2}) { __typename } }")

    # bidsForJob — competitor intel.
    if jid:
        try_query("bidsForJob (top 4 competitor bids)",
                  f'query {{ bidsForJob(jobId:"{jid}") {{ __typename }} }}')
        try_query("clientsWorkHistory",
                  f'query {{ clientsWorkHistory(jobId:"{jid}") {{ __typename }} }}')

    # roomList — messages.
    try_query("roomList (messaging / reply detection?)",
              "query { roomList(pagination:{first:2}) { __typename } }")

    # user — confirms we have an authenticated user context.
    try_query("user (current authenticated user)",
              "query { user { id nid name } }")

    sect("DONE — paste this output back")


if __name__ == "__main__":
    main()
