# Installing Falcon Scout on another machine

Windows. Takes about 15 minutes, most of it waiting on `pip` and `npm`.

---

## 1. Run the installer

Unzip the archive somewhere without spaces or OneDrive sync in the path
(`C:\Users\<you>\upwork-cockpit` is what the original machine uses), then:

```
setup.bat
```

It checks Python and Node, builds `.venv`, installs the backend and frontend
packages, and creates `.env` from the template. It stops at the first real error
rather than carrying on half-installed.

**Prerequisites it will not install for you** (it tells you if either is missing):

| | Why | Where |
|---|---|---|
| **Python 3.11+** | backend, listener | <https://www.python.org/downloads/> — tick *Add python.exe to PATH* |
| **Node.js LTS** | frontend + CLI bridge | <https://nodejs.org/> |

---

## 2. Fill in `.env`

`setup.bat` copies `.env.template` to `.env`. Open it and set:

- **`ANTHROPIC_API_KEY`** — required. Without it every AI call fails with
  *"ANTHROPIC_API_KEY not set in .env"*. <https://console.anthropic.com/settings/keys>
- **`TELEGRAM_API_ID`** / **`TELEGRAM_API_HASH`** — only needed for the Telegram
  job feed. <https://my.telegram.org/apps>
- `UPWORK_API_KEY` / `UPWORK_API_SECRET` — optional, for the API job feed.

---

## 3. Copy the files git does not carry

These are deliberately gitignored — they hold credentials and client data, so
they are **not** in the repo or in the code archive. Copy them from the old
machine on a USB stick or an encrypted drive. Do not email them or put them in a
public cloud folder.

| File | What breaks without it |
|---|---|
| **`upwork_jobs.db`** | **Everything that matters.** The knowledge base, all 16 case studies, every sent proposal, outcomes, rule telemetry. The app starts but has no memory and writes letters with no case studies. |
| `upwork_listener.session` (`*.session`) | Telegram listener has to log in again — you can skip the file and re-authenticate instead |
| `ai_provider.json` | Falls back to API mode; recreate by toggling CLI/API in Settings |
| `.upwork_token.json` | Upwork API feed needs re-authorising |

`upwork_jobs.db` is the one that genuinely matters. Copy it into the project
root, next to `falconscout.bat`.

---

## 4. Load the Chrome extension

It cannot be installed automatically — Chrome requires this by hand:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `upwork-enricher` folder
4. Confirm it shows **Falcon Scout Enricher 5.11**

Re-do step 3 (the reload button) after any change to the extension's files.

---

## 5. Optional: CLI-bridge mode

The bridge routes Claude calls through a Claude Code subscription instead of the
API, so generating costs nothing per token. If you only use API mode, skip this.

```
npm install -g @anthropic-ai/claude-code
```

The bridge runs `claude` under an **isolated profile** so it always bills the
right account. That profile needs its own login — once, in a real terminal (not
inside a Claude Code window):

```powershell
$env:CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-artem"
claude
```

then `/login` inside it and approve in the browser. To check it afterwards:

```powershell
$env:CLAUDE_CONFIG_DIR = "$env:USERPROFILE\.claude-artem"
"reply with just: ok" | claude -p --model sonnet --strict-mcp-config --disable-slash-commands
```

If that prints `ok`, the bridge will work. A *"Not logged in"* error in the app
is this profile, not the bridge itself.

---

## 6. Start it

```
falconscout.bat
```

Opens four windows — CLI bridge, backend (`:8000`), Telegram listener, frontend
(`:5180`) — then the browser at <http://localhost:5180>.

To run pieces separately:

```
.\.venv\Scripts\uvicorn api.main:app --reload --port 8000   # backend only
cd frontend && npm run dev                                  # frontend only
python listener.py                                          # listener only
node cli-bridge.js                                          # bridge only
```

**Always start the backend from `.venv`**, never a bare system Python. A bare
interpreter uses watchfiles-based reload, whose Windows subprocess model resets
stdout to cp1252 and crashes any `print()` containing `→`, `✓` or an emoji —
and `api/main.py` is full of them.

---

## 7. Check it worked

- <http://localhost:5180> loads and lists jobs (jobs come from `upwork_jobs.db`)
- Open a job → **Analyse this job** returns a verdict (proves the API key or bridge)
- The port badge top-right shows the CLI bridge online if you set it up
- Tests, from the project root:

```
for %t in (tests\*.test.js) do node %t
.\.venv\Scripts\python tests\test_room_evidence.py
```

---

## Known port usage

| Port | Process |
|---|---|
| 8000 | FastAPI backend |
| 5180 | Vite frontend (pinned; it exits rather than hop ports) |
| 27184 | CLI bridge — **local change on the original machine**, the committed default is 27183 |

If the bridge shows offline, check `cli-bridge.js` and `frontend/src/App.jsx`
agree on the port number.
