@echo off
REM Falcon Scout - DEVELOPMENT launcher: same as falconscout.bat, but the backend
REM reloads whenever a .py file changes. Use it while editing the backend; use
REM falconscout.bat for daily work.
call "%~dp0falconscout.bat" dev %*
