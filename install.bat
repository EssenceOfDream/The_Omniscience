@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo  The Omniscience: Installation
echo ============================================
echo.

echo [1/5] Assembling large files from fragments...
call npm run sync

echo.
echo [2/5] Running preinstall setup. UAC will be requested...
call powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\preinstall.ps1"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Preinstall failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [3/5] Installing npm dependencies. scripts ignored...
call npm install --ignore-scripts
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [4/5] Compiling Bluetooth module for Electron...
call node "%~dp0scripts\postinstall.js"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Postinstall. native compilation failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [5/5] Configuring Windows taskbar and Omniscience autostart...
call npm run windows:setup
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Windows configuration failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo ============================================
echo  Installation completed successfully!
echo ============================================
pause