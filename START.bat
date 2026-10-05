@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CheburekWatch - One Friend

set "PORT=3000"
set "HOST=127.0.0.1"

echo.
echo ============================================================
echo                     CHEBUREKWATCH
echo                    ONE FRIEND MODE
echo ============================================================
echo.

echo [1/4] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js is not installed.
  echo Install Node.js 20+ from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)
node --version

echo.
echo [2/4] Checking OpenSSH...
where ssh >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Windows OpenSSH Client is not installed.
  echo.
  echo Install it here:
  echo Settings ^> Apps ^> Optional Features ^> View features ^> OpenSSH Client
  echo.
  pause
  exit /b 1
)
ssh -V 2>&1

echo.
echo [3/4] Installing dependencies if needed...
if not exist "node_modules\express" (
  echo First launch: running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting CheburekWatch locally on 127.0.0.1:%PORT% ...
start "CheburekWatch Server" /min cmd /c "cd /d ""%~dp0"" && set HOST=%HOST%&& set PORT=%PORT%&& node server.js"

timeout /t 3 /nobreak >nul

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%PORT%/api/health -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo [ERROR] CheburekWatch did not start.
  echo.
  echo Try opening http://127.0.0.1:%PORT% manually.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo                    SERVER IS ONLINE
echo ============================================================
echo.
echo Local:  http://127.0.0.1:%PORT%
echo.
echo Now creating a public HTTPS link.
echo.
echo IMPORTANT: YOU DO NOT NEED TO ENTER A PASSWORD.
echo The tunnel uses localhost.run's free "nokey" mode.
echo.
echo When the link appears, send the HTTPS link to ONE friend.
echo Keep this window open while you are watching.
echo ============================================================
echo.

REM localhost.run documents this passwordless free command:
REM ssh -R 80:localhost:8080 nokey@localhost.run
REM BatchMode prevents any interactive password prompt.
ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -R 80:127.0.0.1:%PORT% nokey@localhost.run

set "TUNNEL_EXIT=%ERRORLEVEL%"
echo.
echo ============================================================
echo                    TUNNEL STOPPED
 echo ============================================================
echo.
echo Exit code: %TUNNEL_EXIT%
echo Your local CheburekWatch server may still be running.
echo Run STOP.bat when you are finished.
echo.
pause
exit /b %TUNNEL_EXIT%
