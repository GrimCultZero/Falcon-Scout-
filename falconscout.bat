@echo off
REM ============================================================
REM  Falcon Scout - launcher (daily use, no auto-reload)
REM
REM  Starts:  backend (:8000, NO --reload), frontend (:5180), and
REM           the CLI bridge ONLY when ai_provider.json says "cli".
REM  falconscout-dev.bat is the same with the backend reloading
REM  on every .py edit - for development, not for daily use
REM  (reload has hung or 500'd the backend mid-edit at least
REM  three times, audit 2026-10-29 F13).
REM
REM  There is no Telegram listener: the bot shut down on 2026-10-15,
REM  the API feed replaced it, and the listener was removed on
REM  2026-11-09.
REM
REM  The backend window runs tools\launcher\backend_watchdog.py, not uvicorn
REM  directly: it sets WindowsSelectorEventLoopPolicy via run_backend.py (fix
REM  for WinError 64 under ProactorEventLoop) and restarts the backend (only
REM  that one process) if :8000 is listening but /health goes unresponsive
REM  for 3 checks 10s apart.
REM
REM  The frontend window runs tools\launcher\frontend_watchdog.py, which builds
REM  (npm run build) only when frontend\src is newer than frontend\dist, then
REM  serves the production build with `vite preview` on :5180 (same proxy
REM  settings as dev, including /generations) and restarts it the same way the
REM  backend watchdog restarts the backend. falconscout-dev.bat still runs
REM  `npm run dev` instead - for editing the frontend, not for daily use.
REM
REM  If the provider is switched to CLI later, the backend starts
REM  the bridge itself on the first CLI call.
REM
REM  Test hooks:  FALCON_DRYRUN=1     print the launch lines, start nothing
REM               FALCON_NO_BROWSER=1  do not open the browser
REM ============================================================
setlocal
title Falcon Scout - Launcher
cd /d "%~dp0"

set "RELOAD="
set "RELOAD_FLAG="
set "FRONTEND_DIR=%~dp0."
set "FRONTEND_CMD=.\.venv\Scripts\python.exe tools\launcher\frontend_watchdog.py --port 5180"
set "FRONTEND_TITLE=Falcon Scout - Frontend"
if /i "%~1"=="dev" (
  set "RELOAD= --reload"
  set "RELOAD_FLAG= --reload"
  set "FRONTEND_DIR=%~dp0frontend"
  set "FRONTEND_CMD=npm run dev"
  set "FRONTEND_TITLE=Falcon Scout - Frontend - dev"
)

REM The CLI bridge refuses to start without CLI_BRIDGE_TOKEN in .env (audit T3).
REM This creates one if it is missing and leaves an existing one alone.
if exist ".env" if exist ".venv\Scripts\python.exe" ".venv\Scripts\python.exe" tools\ensure_bridge_token.py

REM Bridge only for the CLI provider. ai_provider.json is {"provider": "cli"} or
REM {"provider": "api"}; missing means API (the backend's own default).
set "START_BRIDGE="
if exist "ai_provider.json" (
  findstr /r /c:"\"cli\"" "ai_provider.json" >nul 2>&1
  if not errorlevel 1 set "START_BRIDGE=1"
)

if defined START_BRIDGE call :launch "Falcon Scout - CLI Bridge" "%~dp0." "node cli-bridge.js"
call :launch "Falcon Scout - Backend%RELOAD%" "%~dp0." ".\.venv\Scripts\python.exe tools\launcher\backend_watchdog.py --port 8000%RELOAD_FLAG%"
call :launch "%FRONTEND_TITLE%" "%FRONTEND_DIR%" "%FRONTEND_CMD%"

if defined FALCON_DRYRUN exit /b 0
timeout /t 3 /nobreak >nul
if not defined FALCON_NO_BROWSER start http://localhost:5180
exit /b 0

REM  :launch "<window title>" "<start folder>" "<command>"
:launch
if defined FALCON_DRYRUN (
  echo LAUNCH [%~1] in [%~2] : %~3
  goto :eof
)
start "%~1" /d "%~2" cmd /k "%~3"
goto :eof
