@echo off
rem ============================================================================
rem  Falcon Scout - Stream Deck launcher. The Stream Deck profile points at THIS
rem  file: do not rename it, do not edit the profile.
rem
rem  Rewritten 2026-11-16. The old script asked one question, "is 5180 listening?",
rem  and if yes skipped EVERYTHING: a leftover Vite window with a dead backend
rem  opened a dead app and nothing was logged.
rem
rem  Now: backend :8000 and frontend :5180 are checked INDEPENDENTLY, only what is
rem  missing is started, a second copy of something already listening is never
rem  started, the CLI bridge :27184 is started only when ai_provider.json says
rem  "cli" (after tools\ensure_bridge_token.py), and the launcher logs to
rem     C:\Users\syzov\Scripts\falconscout-start.log   (appended, fresh over 200 KB)
rem  Nothing is ever killed. Port 27183 belongs to another project: never touched.
rem
rem  2026-11-17: each part's own output is now kept (append, a timestamped header per
rem  start) in  C:\Users\syzov\Scripts\falconscout-logs\{backend,bridge,frontend}.log
rem  because the Vite dev server was found gone minutes after a start, silently, and
rem  its minimized window's text was lost.
rem
rem  2026-11-19: backend and frontend now run under the SAME watchdogs the daily
rem  launcher (falconscout.bat) uses, instead of raw uvicorn / a bespoke restart
rem  loop around `npm run dev`:
rem    - backend:  .venv\Scripts\python.exe tools\launcher\backend_watchdog.py
rem      Sets WindowsSelectorEventLoopPolicy before starting uvicorn (fix for
rem      WinError 64 under the default ProactorEventLoop - see run_backend.py),
rem      and restarts ONLY that backend process if :8000 is listening but
rem      /health goes unanswered for 3 checks 10 s apart, or if it exits.
rem    - frontend: .venv\Scripts\python.exe tools\launcher\frontend_watchdog.py
rem      Builds (npm run build) only when frontend\src is newer than
rem      frontend\dist, serves the production build with `vite preview` on
rem      :5180 (same proxy settings as dev, including /generations), and
rem      restarts it the same way if the page stops answering or it exits.
rem      This REPLACES the old /frontend-loop restart-5-times-in-10-minutes
rem      logic below - the watchdog's own restart loop does that job now, and
rem      its restarts are logged to logs\frontend_watchdog.log in the repo
rem      (ROOT), in addition to this script's own %LOGDIR%\frontend.log.
rem  Both watchdog windows run forever (they ARE the long-lived process), same
rem  as the uvicorn / npm windows they replace - still started minimized via
rem  :launch, still logged to %LOGDIR%\{backend,frontend}.log.
rem
rem  Usage:   falconscout-streamdeck.cmd          start what is missing, wait, open Chrome
rem           falconscout-streamdeck.cmd /dry     print and log what it WOULD do, start nothing
rem  Test hooks: FALCON_NO_BROWSER=1 skips Chrome. With /dry only, FALCON_NETSTAT_FILE=<file>
rem  feeds the port checks from a fake netstat listing.
rem ============================================================================
setlocal EnableExtensions
set "ROOT=C:\Users\syzov\upwork-cockpit"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
rem "Oleh - Oleg" Chrome profile (syzovenko@gmail.com = Default) - never another profile.
set "PROFILE=Default"
set "URL=http://localhost:5180"
set "LOG=C:\Users\syzov\Scripts\falconscout-start.log"
set "LOGDIR=C:\Users\syzov\Scripts\falconscout-logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "DRY="
if /i "%~1"=="/dry" set "DRY=1"
set "TAG="
if defined DRY set "TAG= [DRY RUN]"
set "STARTED="

rem fresh log file when the old one is over 200 KB (the old one is kept once as .old)
if exist "%LOG%" for %%F in ("%LOG%") do if %%~zF GTR 204800 move /y "%LOG%" "%LOG%.old" >nul

cd /d "%ROOT%"
if errorlevel 1 (
  call :log "FAILED: cannot open %ROOT%"
  start "" notepad "%LOG%"
  exit /b 1
)
call :log "==== button pressed%TAG% ===="

rem ---- what is already running -------------------------------------------------
set "NEED_BRIDGE="
if exist "ai_provider.json" (
  findstr /r /c:"\"cli\"" "ai_provider.json" >nul 2>&1
  if not errorlevel 1 set "NEED_BRIDGE=1"
)
call :listening 8000 BACK
call :listening 5180 FRONT
call :listening 27184 BRIDGE
call :yn BACK_T %BACK%
call :yn FRONT_T %FRONT%
if defined NEED_BRIDGE (call :yn BRIDGE_T %BRIDGE%) else (set "BRIDGE_T=not needed, provider is not cli")
call :log "already running: backend %BACK_T%, frontend %FRONT_T%, bridge %BRIDGE_T%"

rem ---- start only what is missing ---------------------------------------------
if not defined NEED_BRIDGE goto bridge_done
if "%BRIDGE%"=="1" goto bridge_done
if exist ".env" if exist ".venv\Scripts\python.exe" call :ensure_token
call :launch "Falcon Scout - CLI Bridge" "%ROOT%" "node cli-bridge.js" "bridge.log"
set "STARTED=%STARTED% bridge"
:bridge_done

if "%BACK%"=="1" goto backend_done
call :launch "Falcon Scout - Backend" "%ROOT%" ".\.venv\Scripts\python.exe tools\launcher\backend_watchdog.py --port 8000" "backend.log"
set "STARTED=%STARTED% backend"
:backend_done

if "%FRONT%"=="1" goto frontend_done
call :launch "Falcon Scout - Frontend" "%ROOT%" ".\.venv\Scripts\python.exe tools\launcher\frontend_watchdog.py --port 5180" "frontend.log"
set "STARTED=%STARTED% frontend"
:frontend_done

if not defined STARTED (
  call :log "started: nothing, everything was already running"
) else (
  call :log "started:%STARTED%"
)

rem ---- wait up to 90 s for BOTH 8000 and 5180 ---------------------------------
set /a N=0
if defined DRY goto waited
:wait
call :listening 8000 BACK
call :listening 5180 FRONT
if "%BACK%%FRONT%"=="11" goto waited
if %N% GEQ 90 goto waited
set /a N+=1
ping -n 2 127.0.0.1 >nul
goto wait
:waited
if defined DRY (
  call :log "would wait up to 90 s for ports 8000 and 5180 to listen, not waiting"
  goto verdict
)
call :yn BACK_T %BACK%
call :yn FRONT_T %FRONT%
call :log "waited %N% s: backend %BACK_T%, frontend %FRONT_T%"

rem ---- verdict ----------------------------------------------------------------
:verdict
if defined DRY goto open
if not "%BACK%"=="1" (
  call :log "BACKEND DID NOT START - its output is in %LOGDIR%\backend.log"
  start "" notepad "%LOG%"
  exit /b 1
)
if not "%FRONT%"=="1" (
  call :log "FRONTEND DID NOT START - its output is in %LOGDIR%\frontend.log"
  start "" notepad "%LOG%"
  exit /b 1
)
set "HC="
for /f %%c in ('curl.exe -s -m 3 -o nul -w "%%{http_code}" http://127.0.0.1:8000/health 2^>nul') do set "HC=%%c"
if "%HC%"=="200" (call :log "backend answers /health: 200") else (call :log "WARNING: backend is listening but /health answered [%HC%] - it may still be starting")
call :log "RESULT: backend up, frontend up"

rem ---- open Chrome exactly as before -------------------------------------------
:open
if defined DRY (
  call :log "would open Chrome, profile %PROFILE%, at %URL%"
  exit /b 0
)
if defined FALCON_NO_BROWSER (
  call :log "FALCON_NO_BROWSER set: not opening Chrome"
  exit /b 0
)
call :log "opening Chrome, profile %PROFILE%"
start "" "%CHROME%" --profile-directory="%PROFILE%" "%URL%"
exit /b 0

rem ---------------------------------------------------------------------------
rem  :log "<text>"   append a timestamped line; also print it in a /dry run
:log
>>"%LOG%" echo %date% %time% %~1
if defined DRY echo %~1
goto :eof

rem  :yn <var> <0|1>   -> var = "up" or "down"
:yn
if "%~2"=="1" (set "%~1=up") else (set "%~1=down")
goto :eof

rem  :listening <port> <var>   -> var = 1 when something LISTENS on that port, else 0
:listening
set "%~2=0"
if defined DRY if defined FALCON_NETSTAT_FILE (
  findstr /R /C:":%~1 .*LISTENING" "%FALCON_NETSTAT_FILE%" >nul 2>&1 && set "%~2=1"
  goto :eof
)
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul && set "%~2=1"
goto :eof

rem  :launch "<window title>" "<start folder>" "<command>" "<log file name>"   (minimized window)
rem  The window's own output is appended to %LOGDIR%\<log file name>, with a timestamped header per start.
rem  Both watchdog commands (backend_watchdog.py, frontend_watchdog.py) run forever in this
rem  window and do their own restart-on-failure internally - nothing here restarts them.
:launch
if defined DRY (
  call :log "would start [%~1] in [%~2]: %~3  - output appended to %LOGDIR%\%~4"
  goto :eof
)
call :log "starting [%~1] in [%~2]: %~3  - output appended to %LOGDIR%\%~4"
start "%~1" /min /d "%~2" cmd /k "echo ===== %date% %time% %~1 start >> %LOGDIR%\%~4 & %~3 >> %LOGDIR%\%~4 2>&1"
goto :eof

:ensure_token
if defined DRY (
  call :log "would run tools\ensure_bridge_token.py"
  goto :eof
)
".venv\Scripts\python.exe" tools\ensure_bridge_token.py >nul 2>&1
call :log "ran tools\ensure_bridge_token.py, exit %errorlevel%"
goto :eof
