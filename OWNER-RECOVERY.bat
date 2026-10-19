@echo off
setlocal
cd /d "%~dp0"
node scripts\owner-recovery.cjs %*
echo.
pause
