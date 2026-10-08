@echo off
setlocal EnableDelayedExpansion
title Falcon Scout - Setup
cd /d "%~dp0"

echo.
echo  ===========================================================
echo   Falcon Scout - setup
echo   Installs the Python venv, backend deps and frontend deps.
echo  ===========================================================
echo.

set "FAILED="

REM ---------------------------------------------------------------- Python ---
echo [1/6] Checking Python...
where python >nul 2>&1
if errorlevel 1 (
  echo       NOT FOUND. Install Python 3.11 or newer from https://www.python.org/downloads/
  echo       Tick "Add python.exe to PATH" in the installer.
  set "FAILED=1"
  goto :done
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
echo       Python !PYVER!
REM The backend must run from .venv, never a bare system Python: a bare
REM interpreter pulls in watchfiles-based reload, whose Windows subprocess model
REM resets stdout to cp1252 and crashes every print() containing an arrow or
REM emoji. See CLAUDE.md.

REM ------------------------------------------------------------------ venv ---
echo [2/6] Creating virtual environment (.venv)...
if exist ".venv\Scripts\python.exe" (
  echo       Already exists - reusing it.
) else (
  python -m venv .venv
  if errorlevel 1 (
    echo       FAILED to create .venv
    set "FAILED=1"
    goto :done
  )
  echo       Created.
)

REM ------------------------------------------------------- backend packages ---
echo [3/6] Installing backend packages (this takes a few minutes)...
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo       FAILED. Read the pip output above.
  set "FAILED=1"
  goto :done
)
echo       Backend packages installed.

REM ------------------------------------------------------------------ Node ---
echo [4/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo       NOT FOUND. Install the LTS build from https://nodejs.org/
  echo       Node runs the frontend AND the CLI bridge.
  set "FAILED=1"
  goto :done
)
for /f "tokens=*" %%v in ('node --version') do set "NODEVER=%%v"
echo       Node !NODEVER!

REM ------------------------------------------------------ frontend packages ---
echo [5/6] Installing frontend packages (this takes a few minutes)...
pushd frontend
call npm install
if errorlevel 1 (
  echo       FAILED. Read the npm output above.
  popd
  set "FAILED=1"
  goto :done
)
popd
echo       Frontend packages installed.

REM ------------------------------------------------------------------- env ---
echo [6/6] Checking configuration...
if exist ".env" (
  echo       .env found.
) else (
  copy ".env.template" ".env" >nul
  echo       .env created from the template - YOU MUST EDIT IT, see below.
)

if exist "upwork_jobs.db" (
  echo       upwork_jobs.db found.
) else (
  echo       upwork_jobs.db MISSING - copy it from the old machine. Without it
  echo       there is no knowledge base, no case studies and no history.
)

where claude >nul 2>&1
if errorlevel 1 (
  echo       Claude Code CLI not on PATH - only needed for CLI-bridge mode.
  echo       Install: npm install -g @anthropic-ai/claude-code
) else (
  echo       Claude Code CLI found.
)

:done
echo.
if defined FAILED (
  echo  ===========================================================
  echo   SETUP DID NOT COMPLETE - fix the error above and re-run.
  echo  ===========================================================
) else (
  echo  ===========================================================
  echo   SETUP COMPLETE
  echo  ===========================================================
  echo.
  echo   Still to do by hand - see INSTALL.md for detail:
  echo     1. Edit .env  ^(ANTHROPIC_API_KEY, TELEGRAM_API_ID, TELEGRAM_API_HASH^)
  echo     2. Copy from the old machine: upwork_jobs.db, *.session,
  echo        ai_provider.json, .upwork_token.json
  echo     3. Load the Chrome extension: chrome://extensions ^> Developer mode
  echo        ^> Load unpacked ^> select the upwork-enricher folder
  echo     4. Start everything with falconscout.bat
)
echo.
pause
endlocal
