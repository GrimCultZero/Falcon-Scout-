---
description: Distill the recent essential conversation into project memory and sync to GitHub
argument-hint: [optional note about what mattered]
---
The owner is flagging the recent conversation as essential project memory. Capture it now.

Steps:
1. Distill the meaningful part of the recent exchange into a concise, dated entry (newest at the
   bottom of the file). If a note was passed ($ARGUMENTS), weave it in.
2. Append the entry to `WORKLOG.md` (session narrative) — or to `CASES.md` if it's a solved client
   scenario / finding.
3. Run: `git add -A && git commit -m "context: <short summary>" && git push`
4. Confirm in one line: what was captured and that it's pushed.

Rules: distill, never paste raw secrets. Keep it tight — what happened, why, and anything the next
iteration (possibly on a different account) must know. Append, never overwrite history.
