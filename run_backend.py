"""
Backend entrypoint for Windows.

uvicorn's own CLI (``uvicorn api.main:app``) creates its event loop before
api/main.py is ever imported, so setting the event loop policy from inside
main.py has no effect on the loop uvicorn actually runs on. This script sets
the policy first, then starts uvicorn programmatically on that loop.

Why: WinError 64 ("The specified network name is no longer available") has
been observed from the backend's long-lived httpx connections (the API feed
loop, the Upwork calls) under asyncio's default Windows ProactorEventLoop.
ProactorEventLoop's IOCP-based socket handling has known issues surfacing
spurious errors on abrupt disconnects; SelectorEventLoop does not have this
class of bug. No code in this project uses asyncio subprocess APIs
(create_subprocess_exec/shell), which are the only things SelectorEventLoop
can't do on Windows, so this switch is safe here.

Usage: .venv\\Scripts\\python run_backend.py [--reload]
"""
import sys
import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if sys.platform == "win32":
        import asyncio
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    uvicorn.run("api.main:app", host="127.0.0.1", port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
