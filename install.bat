@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo  The Omniscience: Installation
echo ============================================
echo.

echo [1/6] Configuring the Windows taskbar...
call powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0main\manageWindowsAutostart.ps1" -Action ConfigureTaskbar
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Windows taskbar configuration failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [2/6] Assembling large files from fragments...
call npm run sync

echo.
echo [3/6] Running preinstall setup. UAC will be requested...
call powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\preinstall.ps1"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Preinstall failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [4/6] Installing npm dependencies. scripts ignored...
call npm install --ignore-scripts
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [5/6] Compiling Bluetooth module for Electron...
call node "%~dp0scripts\postinstall.js"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Postinstall. native compilation failed. Installation aborted.
    pause
    exit /b %errorlevel%
)

echo.
echo [6/6] Registering Omniscience autostart...
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