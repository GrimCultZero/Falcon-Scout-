---
description: Distill the recent essential conversation into project memory and sync to GitHub
argument-hint: [optional note about what mattered]
---
The owner is flagging the LATEST TOPIC discussed as essential project memory. Capture it now.

Steps:
1. Identify the most recent topic/thread in the conversation and distill the essentials that are
   **useful to the project/app in general** — decisions, methods, findings, reusable patterns,
   gotchas. Skip one-off trivia, chit-chat, and abandoned dead-ends. Write a concise, dated entry
   (newest at the bottom). If a note was passed ($ARGUMENTS), weave it in.
2. Append the entry to `WORKLOG.md` (session narrative) — or to `CASES.md` if it's a solved client
   scenario / finding.
3. Run automatically, without asking:
   `git add -u && git add -- WORKLOG.md CASES.md DESIGN.md PROJECT_HANDOFF.md && git commit -m "context: <short summary>" && git push`
   Never `git add -A` or `git add .`: they would stage client data (`corrections/`, debug dumps).
   If this topic created a NEW file that belongs in the repo, stage it by name.
4. Confirm in one line: what was captured and that it's pushed.

Rules: distill, never paste raw secrets. Keep it tight — what happened, why, and anything the next
iteration (possibly on a different account) must know. Append, never overwrite history.
