@echo off
setlocal
cd /d "%~dp0"
title TEPSY
set "npm_config_fund=false"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24+ is required. Install Node.js and try again.
  pause
  exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm is required. Repair the Node.js installation and try again.
  pause
  exit /b 1
)

echo Checking for updates and starting TEPSY. This can take a few minutes.
call npm.cmd run start:local -- %*
if errorlevel 1 (
  echo.
  echo TEPSY could not start. Please check the error above.
  pause
  exit /b 1
)

echo.
node scripts/local-addresses.cjs
echo.
echo Keep this computer on while other devices use TEPSY.
echo You can close this window; TEPSY will keep running.
echo To stop TEPSY, run: npm run stop:local
pause
exit /b 0
