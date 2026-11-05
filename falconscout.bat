@echo off
title Falcon Scout - Launcher

REM The CLI bridge refuses to start without CLI_BRIDGE_TOKEN in .env (audit T3).
REM This creates one if it is missing and leaves an existing one alone.
if exist ".env" if exist ".venv\Scripts\python.exe" ".venv\Scripts\python.exe" tools\ensure_bridge_token.py

start "Falcon Scout - CLI Bridge" cmd /k "node cli-bridge.js"
start "Falcon Scout - Backend"  cmd /k ".\.venv\Scripts\uvicorn api.main:app --reload"
start "Falcon Scout - Listener" cmd /k ".\.venv\Scripts\python listener.py"
start "Falcon Scout - Frontend" /d "%~dp0frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5180
