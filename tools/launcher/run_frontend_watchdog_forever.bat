@echo off
REM Task 5.3 (owner, 2026-11-23): frontend_watchdog.py died silently at least
REM twice (during Task 1, and at 00:07 on 2026-11-17) with no restart -- the
REM backend has backend_watchdog.py restarting ITS child if :8000 stops
REM answering, but nothing restarted the WATCHDOG PROCESS ITSELF if it died.
REM This wrapper is that outer layer, same spirit as backend_watchdog's child
REM restart: if frontend_watchdog.py exits for ANY reason (a crash it logged
REM via the new exception handler, or one that somehow still escaped it), this
REM loop logs the exit and starts a fresh one a few seconds later. Keeps the
REM Falcon Scout - Frontend window itself alive across a python-level death
REM the same way `cmd /k` already keeps it alive across a CHILD vite crash.
setlocal
cd /d "%~dp0..\.."
:loop
echo [%date% %time%] starting frontend_watchdog.py
.\.venv\Scripts\python.exe tools\launcher\frontend_watchdog.py --port 5180
echo [%date% %time%] frontend_watchdog.py exited with code %errorlevel% -- restarting in 3s
timeout /t 3 /nobreak >nul
goto loop
