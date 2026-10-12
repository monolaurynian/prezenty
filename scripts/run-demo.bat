@echo off
REM Run from the repo root so server.js and .env resolve.
cd /d "%~dp0.."
echo Starting Prezenty in DEMO MODE...
echo.
set DEMO_MODE=true
set NODE_ENV=development
node server.js
