@echo off
REM ============================================================
REM SPOT R1.5.9 - Windows Installer
REM
REM Creates desktop shortcut via cscript + make_shortcut.vbs.
REM cscript ships with every Windows since Win2000 - no PowerShell
REM ExecutionPolicy issues, no group-policy script blocking.
REM ============================================================

setlocal

cd /d "%~dp0"
set "INSTALL_DIR=%CD%"

echo.
echo  =====================================================
echo   SPOT R1.5.9 Installer
echo   Standard Printing Company
echo  =====================================================
echo.
echo Install folder: %INSTALL_DIR%
echo.

REM --- Step 1: Node.js check ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not on PATH.
    echo Download from https://nodejs.org/ ^(version 18 or newer^).
    echo After install, close this window and run install.bat again.
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version
echo.

REM --- Step 2: Install npm dependencies ---
echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check the output above.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

REM --- Step 3: Create .env from template if not present ---
if not exist .env (
    if exist .env.template (
        copy .env.template .env >nul
        echo [OK] Created .env from template.
        echo      You can either edit .env to set ANTHROPIC_API_KEY, OR
        echo      paste keys directly in SPOT under Advanced Controls ^> RFQ Parser.
    )
) else (
    echo [OK] .env already exists.
)
echo.

REM --- Step 4: Verify required files for shortcut ---
if not exist OPEN_SPOT.bat (
    echo [ERROR] OPEN_SPOT.bat not found. Cannot create shortcut without it.
    pause
    exit /b 1
)
if not exist make_shortcut.vbs (
    echo [ERROR] make_shortcut.vbs not found. Cannot create shortcut without it.
    pause
    exit /b 1
)
if not exist spot.ico (
    echo [WARN] spot.ico not found. Shortcut will be created with default icon.
)
echo.

REM --- Step 5: Create desktop shortcut via VBScript ---
echo Creating desktop shortcut via cscript + make_shortcut.vbs...
echo --------------------------------------------------------
cscript //nologo "%INSTALL_DIR%\make_shortcut.vbs" "%INSTALL_DIR%"
set VBS_RC=%ERRORLEVEL%
echo --------------------------------------------------------

if %VBS_RC% EQU 0 (
    echo [OK] Desktop shortcut created.
) else (
    echo.
    echo [ERROR] Shortcut creation failed - cscript exit code %VBS_RC%
    echo.
    echo Manual workaround:
    echo   1. Right-click OPEN_SPOT.bat in this folder
    echo   2. Send to ^> Desktop ^(create shortcut^)
    echo   3. Right-click the new shortcut, Properties, Change Icon
    echo   4. Browse to %INSTALL_DIR%\spot.ico, click OK
    echo.
)
echo.

echo  =====================================================
echo   Install complete.
echo  =====================================================
echo.
echo Folder layout:
echo   %INSTALL_DIR%\
echo     install.bat        ^<-- this file (re-runnable)
echo     OPEN_SPOT.bat      ^<-- launcher (target of desktop shortcut)
echo     make_shortcut.vbs  ^<-- desktop shortcut creator
echo     spot.ico           ^<-- desktop icon
echo     SPOT_R1.5.html     ^<-- the app
echo     spot_server.js     ^<-- Node server
echo     ^(plus all other source / docs / data files^)
echo.
echo To start SPOT:
echo   - Double-click the SPOT icon on your desktop, OR
echo   - Double-click OPEN_SPOT.bat in this folder
echo.
echo Tab title in browser must read "SPOT R1.5.9".
echo.
pause
