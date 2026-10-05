@echo off
setlocal
cd /d "%~dp0"
title CheburekWatch - Stop

echo.
echo Stopping CheburekWatch...

taskkill /FI "WINDOWTITLE eq CheburekWatch Server" /T /F >nul 2>nul

for /f "tokens=2" %%P in ('tasklist /FI "IMAGENAME eq node.exe" /FO LIST ^| findstr /I "PID:"') do (
  rem Do not blindly kill every Node process. The window-title taskkill above is the primary stop.
)

echo.
echo Done.
echo.
pause
