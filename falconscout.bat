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
REM  The Telegram listener is NOT started any more: the bot shut
REM  down on 2026-10-15 and the API feed replaced it. listener.py
REM  and its files stay in the repo; run it by hand if ever needed
REM  (see INSTALL.md).
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
if /i "%~1"=="dev" set "RELOAD= --reload"

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
call :launch "Falcon Scout - Backend%RELOAD%" "%~dp0." ".\.venv\Scripts\uvicorn api.main:app --port 8000%RELOAD%"
call :launch "Falcon Scout - Frontend" "%~dp0frontend" "npm run dev"

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
