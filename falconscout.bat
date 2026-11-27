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
REM  The frontend window runs tools\launcher\run_frontend_watchdog_forever.bat
REM  (Task 5.3, owner 2026-11-23), which restarts frontend_watchdog.py itself
REM  if IT ever exits (it died silently at least twice with nothing bringing
REM  it back). frontend_watchdog.py builds (npm run build) only when
REM  frontend\src is newer than frontend\dist, then serves the production
REM  build with `vite preview` on :5180 (same proxy settings as dev, including
REM  /generations) and restarts THAT child the same way the backend watchdog
REM  restarts the backend. falconscout-dev.bat still runs `npm run dev`
REM  instead - for editing the frontend, not for daily use.
REM
REM  If the provider is switched to CLI later, the backend starts
REM  the bridge itself on the first CLI call.
REM
REM  P3b (27 Nov 2026, Minor fixes #4a): starting this file while the app
REM  already runs must NEVER restart anything (on 27 Nov a second start
REM  restarted the backend and killed a hooks run at 3 of 8). It first asks
REM  :8000/health (or sees :8000 listening) and :5180; a part that is up is
REM  left alone, and when both are up it only opens the browser tab. Long
REM  runs also survive a restart now (Metro offers Resume in its strip).
REM
REM  Test hooks:  FALCON_DRYRUN=1     print the launch lines, start nothing
REM               FALCON_NO_BROWSER=1  do not open the browser
REM               FALCON_ASSUME_DOWN=1 / FALCON_ASSUME_UP=1  skip the probe
REM ============================================================
setlocal
title Falcon Scout - Launcher
cd /d "%~dp0"

set "RELOAD="
set "RELOAD_FLAG="
set "FRONTEND_DIR=%~dp0."
set "FRONTEND_CMD=tools\launcher\run_frontend_watchdog_forever.bat"
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

REM Is the app already running? (P3b #4a) A part that is up is never started again.
set "BACKEND_UP="
set "FRONTEND_UP="
if defined FALCON_ASSUME_UP set "BACKEND_UP=1"
if defined FALCON_ASSUME_UP set "FRONTEND_UP=1"
if not defined FALCON_ASSUME_UP if not defined FALCON_ASSUME_DOWN call :probe

if defined BACKEND_UP if defined FRONTEND_UP goto :already_running

if defined BACKEND_UP echo The backend is already running on :8000 - left alone, not restarted.
if defined FRONTEND_UP echo The frontend is already running on :5180 - left alone, not restarted.
if defined START_BRIDGE if not defined BACKEND_UP call :launch "Falcon Scout - CLI Bridge" "%~dp0." "node cli-bridge.js"
if not defined BACKEND_UP call :launch "Falcon Scout - Backend%RELOAD%" "%~dp0." ".\.venv\Scripts\python.exe tools\launcher\backend_watchdog.py --port 8000%RELOAD_FLAG%"
if not defined FRONTEND_UP call :launch "%FRONTEND_TITLE%" "%FRONTEND_DIR%" "%FRONTEND_CMD%"

if defined FALCON_DRYRUN exit /b 0
timeout /t 3 /nobreak >nul
if not defined FALCON_NO_BROWSER start http://localhost:5180
exit /b 0

REM  Already running: open the browser tab only, restart nothing.
:already_running
echo Falcon Scout is already running (:8000 and :5180): opening the browser tab only, nothing is restarted.
if defined FALCON_DRYRUN exit /b 0
if not defined FALCON_NO_BROWSER start http://localhost:5180
exit /b 0

REM  :probe - BACKEND_UP when :8000/health answers or :8000 is listening (a busy
REM  backend is still a running one); FRONTEND_UP when :5180 answers.
:probe
curl.exe -s -f -o nul -m 4 http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 set "BACKEND_UP=1"
if not defined BACKEND_UP netstat -ano -p tcp | findstr /r /c:":8000 .*LISTENING" >nul 2>&1
if not defined BACKEND_UP if not errorlevel 1 set "BACKEND_UP=1"
curl.exe -s -f -o nul -m 4 http://localhost:5180/ >nul 2>&1
if not errorlevel 1 set "FRONTEND_UP=1"
goto :eof

REM  :launch "<window title>" "<start folder>" "<command>"
:launch
if defined FALCON_DRYRUN (
  echo LAUNCH [%~1] in [%~2] : %~3
  goto :eof
)
start "%~1" /d "%~2" cmd /k "%~3"
goto :eof
