@echo off
REM ============================================================
REM  Falcon Scout - GET LATEST button
REM  Double-click to pull the newest version from GitHub
REM  (e.g. after working from another account/machine).
REM  Run this BEFORE you start working on this machine.
REM ============================================================
cd /d "%~dp0.."

echo.
echo === Falcon Scout: pulling latest from GitHub ===
echo Repo: %CD%
echo.
git pull --rebase --autostash
echo.
echo === Done. ===
pause
