# Backup / Sync buttons

These are **one-click triggers** for syncing the whole project with GitHub.
They do NOT store copies of files here — the actual backup is the GitHub repo
(`https://github.com/GrimCultZero/Falcon-Scout-`), which already contains every
file in the project plus full history.

## The two buttons (double-click)

- **`sync.bat`** — "Save everything to GitHub now." Stages all changes, commits
  with a timestamp, pulls the latest, then pushes. Use it whenever you want a
  manual backup, or at the end of a work session.
- **`get-latest.bat`** — "Get the newest version." Pulls from GitHub. Run this
  **before** you start working, especially if the last session was on a
  different account/machine.

## How this works across Claude accounts / machines

GitHub is the **shared brain** — there is no live link between two Claude
instances. They coordinate *through* the repo:

1. Each account/machine has its own **clone** of the repo (these buttons travel
   inside it, so every clone has them).
2. Workflow on any machine: **get-latest** → work → **sync**.
3. Because it's a single owner (not two sessions editing the same second),
   pull-before / push-after keeps everything consistent with no conflicts.

To work from a **different GitHub/Claude account**, that environment just needs
clone + push access to the private repo (sign in as the repo owner, or be added
as a collaborator on GitHub → repo → Settings → Collaborators).

Note: Claude itself runs `git` directly (and auto-syncs per the protocol in
`/CLAUDE.md`). These buttons are the **manual override for you** — belt and
suspenders, usable even when the app and Claude aren't running.
