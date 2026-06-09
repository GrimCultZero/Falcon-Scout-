@echo off
title Falcon Scout - Launcher

start "Falcon Scout - Backend"  cmd /k ".\.venv\Scripts\uvicorn api.main:app --reload"
start "Falcon Scout - Listener" cmd /k ".\.venv\Scripts\python listener.py"
start "Falcon Scout - Frontend" /d "%~dp0frontend" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5180
