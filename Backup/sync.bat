@echo off
REM ============================================================
REM  Falcon Scout - BACKUP / PUSH button
REM  Double-click to save your work to GitHub right now:
REM  stages changes to files git already tracks plus the memory
REM  docs, commits with a timestamp, pulls the latest (in case
REM  another account pushed), then pushes.
REM
REM  It does NOT add new files on its own (no "git add -A"):
REM  that used to sweep client data such as corrections/ into
REM  GitHub (audit 2026-10-29, T4). New files are listed at the
REM  end; add the ones you want with: git add <file>
REM ============================================================
cd /d "%~dp0.."

echo.
echo === Falcon Scout backup -^> GitHub ===
echo Repo: %CD%
echo.

echo --- staging changes to tracked files + memory docs ---
git add -u
git add -- WORKLOG.md CASES.md DESIGN.md PROJECT_HANDOFF.md

git diff --cached --quiet
if errorlevel 1 (
  echo --- committing ---
  git commit -m "backup %DATE% %TIME%"
) else (
  echo No local changes to commit.
)

echo --- pulling latest (rebase, autostash) ---
git pull --rebase --autostash

echo --- pushing to GitHub ---
git push

echo.
echo --- new files NOT saved (add any you want with: git add ^<file^>) ---
git ls-files --others --exclude-standard

echo.
echo === Done. ===
pause
