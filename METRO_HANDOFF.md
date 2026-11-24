# Metro - handoff log

Claude Code writes here at the end of EVERY Metro task. Oleh then sends "W" to the planning chat,
which reads the newest entry, checks it against METRO_PLAN.md and writes the next task.

## Rules for Claude Code
- Append a new entry at the BOTTOM. Never edit or delete earlier entries.
- Write it as the last step of the task, after tests, WORKLOG.md and the commit/push.
- Be exact and honest: what was NOT done, and anything you could not verify, matters most.
- No secrets, no lead data (names, emails, LinkedIn URLs) in this file.

## Entry template (copy it for each task)

### <YYYY-MM-DD HH:MM Kyiv> - Phase <N>, <task name> - <DONE | PARTIAL | BLOCKED>
- Model and effort used:
- Branch / commits: <branch>, <hash> <message> (one line each)
- Done: <numbered, matching the plan's step numbers>
- Not done / deferred, and why:
- Acceptance checks: <each check from METRO_PLAN.md: PASSED / FAILED / NOT RUN, with evidence>
- Tests: <suites run, counts passed/failed>
- Files changed: <paths>
- Decisions made on my own (need Oleh's OK):
- Questions for Oleh:
- What Oleh must do by hand before the next task (reload extension, restart, etc.):
- Suggested next task:

---
