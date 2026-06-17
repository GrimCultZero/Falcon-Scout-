@echo off
title GKit PDF Generator
cd /d "%~dp0"
echo Generating GKit Case Study PDF...
echo.
node "%~dp0make_pdf.js"
echo.
pause
