@echo off
REM ============================================================
REM SPOT R1.5.9 Launcher
REM
REM Behavior:
REM   1. If server already running on port 3100, just open the browser.
REM   2. Otherwise spawn server in a separate minimized window, wait
REM      for it to bind port 3100, then open browser, then exit.
REM
REM Why this design:
REM   - Spawning server in its own minimized window prevents the
REM     Windows console QuickEdit "click to pause" trap.
REM   - Port check prevents double-launch from spawning two servers
REM     when the user double-clicks the desktop shortcut.
REM   - Polling for port-bound (instead of fixed sleep) prevents
REM     the browser opening before the server is ready.
REM ============================================================

setlocal
title SPOT R1.5.9 Launcher
cd /d "%~dp0"

REM --- Sanity check ---
if not exist spot_server.js (
    echo [ERROR] spot_server.js not found in %CD%
    echo The install folder may have been moved or files were deleted.
    pause
    exit /b 1
)

REM --- Already running? ---
netstat -an 2>nul | findstr ":3100" | findstr "LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    echo SPOT server is already running on port 3100.
    echo Opening browser to existing instance...
    start "" http://localhost:3100
    timeout /t 2 /nobreak >nul
    exit /b 0
)

echo ============================================
echo   SPOT R1.5.9
echo   Starting server...
echo ============================================
echo.

REM --- Spawn server in its own MINIMIZED window ---
REM   - cmd /k keeps window open if node crashes (so user can read errors)
REM   - title prefix "SPOT R1.5.9 Server" makes it findable in taskbar
REM   - /min starts it minimized to prevent QuickEdit click-pause
start /min "SPOT R1.5.9 Server" cmd /k "title SPOT R1.5.9 Server && cd /d ""%~dp0"" && node spot_server.js"

REM --- Poll for server readiness (up to 15 seconds) ---
set /a TRIES=0
:WAIT_LOOP
set /a TRIES+=1
timeout /t 1 /nobreak >nul
netstat -an 2>nul | findstr ":3100" | findstr "LISTENING" >nul
if %ERRORLEVEL% EQU 0 goto SERVER_READY
if %TRIES% LSS 15 (
    echo Waiting for server... (%TRIES% / 15s)
    goto WAIT_LOOP
)

echo.
echo [WARN] Server did not bind port 3100 within 15 seconds.
echo Check the minimized "SPOT R1.5.9 Server" window in your taskbar
echo for error messages. Opening browser anyway...
goto OPEN_BROWSER

:SERVER_READY
echo Server ready in %TRIES%s.

:OPEN_BROWSER
echo Opening browser to http://localhost:3100 ...
start "" http://localhost:3100

echo.
echo ============================================
echo   SPOT is running.
echo ============================================
echo.
echo Server runs in a minimized window titled
echo "SPOT R1.5.9 Server" - find it in your taskbar.
echo.
echo To STOP SPOT:
echo   1. Click the "SPOT R1.5.9 Server" in your taskbar
echo   2. Press Ctrl+C, or close the window with X
echo.
echo Tab title in browser must read "SPOT R1.5.9".
echo This launcher window will close in 6 seconds...
timeout /t 6 /nobreak >nul
exit /b 0
