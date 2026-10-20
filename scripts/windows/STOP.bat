@echo off
setlocal
cd /d "%~dp0..\.."
title CheburekWatch - Stop

echo.
echo Stopping CheburekWatch...

taskkill /FI "WINDOWTITLE eq CheburekWatch Server" /T /F >nul 2>nul


echo.
echo Done.
echo.
pause
