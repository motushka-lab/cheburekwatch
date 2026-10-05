@echo off
setlocal
cd /d "%~dp0"
title CheburekWatch - Check

echo.
echo ============================================================
echo                  CHEBUREKWATCH CHECK
 echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (echo [X] Node.js not found.) else (echo [OK] Node.js found: & node --version)

where ssh >nul 2>nul
if errorlevel 1 (echo [X] OpenSSH Client not found.) else (echo [OK] OpenSSH Client found.)

echo.
curl -I --max-time 5 http://127.0.0.1:3000/ >nul 2>nul
if errorlevel 1 (
  echo [X] CheburekWatch is NOT responding on http://127.0.0.1:3000
) else (
  echo [OK] CheburekWatch is responding on http://127.0.0.1:3000
)

echo.
pause
