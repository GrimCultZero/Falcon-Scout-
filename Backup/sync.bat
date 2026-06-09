@echo off
REM ============================================================
REM  Falcon Scout - BACKUP / PUSH button
REM  Double-click to save EVERYTHING to GitHub right now:
REM  stages all changes, commits with a timestamp, pulls the
REM  latest (in case another account pushed), then pushes.
REM ============================================================
cd /d "%~dp0.."

echo.
echo === Falcon Scout backup -^> GitHub ===
echo Repo: %CD%
echo.

echo --- staging all changes ---
git add -A

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
echo === Done. ===
pause
