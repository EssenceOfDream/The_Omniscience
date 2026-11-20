# scripts/preinstall.ps1
$ErrorActionPreference = "Stop"

# --- 1. Elevation Check ---
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isElevated) {
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
    try {
        $elevatedProcess = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        exit $elevatedProcess.ExitCode
    } catch {
        Write-Error "Could not start the elevated preinstall script: $($_.Exception.Message)"
        exit 1
    }
}

Write-Host "Running with Administrator privileges." -ForegroundColor Green

# --- Define paths globally ---
$projectRoot = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $projectRoot "fragmenter/originals"

# --- 2. Locate or Install Winget ---
$aliasDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$aliasExe = Join-Path $aliasDir "winget.exe"
if ($env:PATH -notlike "*$aliasDir*") {
    $env:PATH = "$aliasDir;$env:PATH"
}

function Test-WingetReady {
    if (Test-Path $aliasExe) {
        try {
            $ver = & $aliasExe --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver) { return $true }
        } catch {}
    }
    return $false
}

if (-not (Test-WingetReady)) {
    Write-Host "Winget not ready. Installing from $bin..." -ForegroundColor Cyan
    $vclibs = Join-Path $bin "Microsoft.VCLibs.140.00_14.0.33519.0_x64.appx"
    $vclibsDesktop = Join-Path $bin "Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64.appx"
    $winAppRuntime = Join-Path $bin "Microsoft.WindowsAppRuntime.1.8_8000.616.304.0_x64.appx"
    $wingetBundle = Join-Path $bin "Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"

    if (!(Test-Path $wingetBundle)) {
        Write-Host "ERROR: Microsoft.DesktopAppInstaller bundle not found in $bin" -ForegroundColor Red
        exit 1
    }
    if (!(Test-Path $vclibs) -or !(Test-Path $vclibsDesktop) -or !(Test-Path $winAppRuntime)) {
        Write-Host "ERROR: Required Winget framework packages are missing from $bin." -ForegroundColor Red
        exit 1
    }

    Write-Host "Installing DesktopAppInstaller (Winget) and its local frameworks..." -ForegroundColor Gray
    Add-AppxPackage -Path $wingetBundle -DependencyPath @($vclibs, $vclibsDesktop, $winAppRuntime) -ForceApplicationShutdown -ErrorAction Stop

    $pkg = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller"
    if ($pkg) {
        $manifest = Join-Path $pkg.InstallLocation "AppxManifest.xml"
        if (Test-Path $manifest) {
            Add-AppxPackage -DisableDevelopmentMode -Register $manifest -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Waiting for winget.exe alias initialization..." -ForegroundColor Gray
    $retries = 10
    while (-not (Test-WingetReady) -and $retries -gt 0) {
        Start-Sleep -Seconds 1
        $retries--
    }
}

if (-not (Test-WingetReady)) {
    Write-Host "ERROR: Winget was installed, but winget.exe alias is not responding." -ForegroundColor Red
    Write-Host "Check Windows Settings -> Apps -> Advanced app settings -> App execution aliases -> App Installer." -ForegroundColor Yellow
    exit 1
}

$wingetVer = & $aliasExe --version
Write-Host "Winget is ready! Version: $wingetVer" -ForegroundColor Green

# --- 3. Install Python 3.12 ---
Write-Host "Installing Python 3.12 via Winget (this may take a few minutes)..." -ForegroundColor Cyan
& $aliasExe install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
    Write-Host "ERROR: Python 3.12 installation failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

# --- 4. Install Visual Studio Build Tools ---
Write-Host "Checking Visual Studio Build Tools..." -ForegroundColor Cyan
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVS = $false
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) { $hasVS = $true }
}

if (-not $hasVS) {
    Write-Host "Installing Visual Studio Build Tools (this may take 5-10 minutes)..." -ForegroundColor Cyan
    & $aliasExe install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) {
        Write-Host "ERROR: Visual Studio Build Tools installation failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Visual Studio Build Tools already installed." -ForegroundColor Green
}

# --- 5. Create .npmrc ---
Write-Host "Configuring .npmrc for node-gyp..." -ForegroundColor Cyan
$pythonPath = "C:\Program Files\Python312\python.exe"
if (!(Test-Path $pythonPath)) {
    $userPython = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
    if (Test-Path $userPython) { $pythonPath = $userPython }
}

$npmrcPath = Join-Path $projectRoot ".npmrc"

$npmrc = @"
python=$pythonPath
msvs_version=2022
"@
Set-Content -Path $npmrcPath -Value $npmrc -Encoding ASCII
Write-Host "Created $npmrcPath with Python path: $pythonPath" -ForegroundColor Green

# --- 6. Install 7-max ---
Write-Host "Installing 7-max via Winget..." -ForegroundColor Cyan
& $aliasExe install --id IgorPavlov.7-max -e --source winget --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: 7-max installation failed or was skipped (exit code: $LASTEXITCODE)." -ForegroundColor Yellow
} else {
    Write-Host "7-max installed successfully." -ForegroundColor Green
}

# --- 7. Install useful Windows utilities ---
function Install-OptionalWingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name
    )

    Write-Host "Installing $Name via Winget..." -ForegroundColor Cyan
    & $aliasExe install --id $Id -e --source winget --silent --accept-package-agreements --accept-source-agreements
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0 -or $exitCode -eq 3010 -or $exitCode -eq -1978335189) {
        Write-Host "$Name is installed or already present." -ForegroundColor Green
    } else {
        Write-Host "WARNING: $Name installation failed (exit code: $exitCode)." -ForegroundColor Yellow
    }
}

$optionalPackages = @(
    @{ Id = "Microsoft.VisualStudioCode"; Name = "Visual Studio Code" },
    @{ Id = "Microsoft.WindowsTerminal"; Name = "Windows Terminal" },
    @{ Id = "Microsoft.PowerToys"; Name = "Microsoft PowerToys" },
    @{ Id = "voidtools.Everything"; Name = "Everything search" },
    @{ Id = "BotProductions.IconViewer"; Name = "IconViewer" },
    @{ Id = "CrystalRich.LockHunter"; Name = "LockHunter" },
    @{ Id = "ShareX.ShareX"; Name = "ShareX" },
    @{ Id = "VideoLAN.VLC"; Name = "VLC media player" },
    @{ Id = "File-New-Project.EarTrumpet"; Name = "EarTrumpet" },
    @{ Id = "7zip.7zip"; Name = "7-Zip" }
)

foreach ($package in $optionalPackages) {
    Install-OptionalWingetPackage -Id $package.Id -Name $package.Name
}

# --- 8. Install Microsoft Store from local offline packages ---
Write-Host "Installing Microsoft Store from local offline packages..." -ForegroundColor Cyan

if (-not (Test-Path $bin)) {
    Write-Host "ERROR: Directory '$bin' not found." -ForegroundColor Red
    exit 1
}

$storeBundle = Get-ChildItem -Path $bin -Filter "Microsoft.WindowsStore_*.msixbundle" | Select-Object -First 1

if (-not $storeBundle) {
    Write-Host "ERROR: Microsoft.WindowsStore msixbundle not found in $bin." -ForegroundColor Red
    exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Gray
$dependencies = Get-ChildItem -Path $bin -Filter "*.appx"
foreach ($dep in $dependencies) {
    Write-Host "  Installing: $($dep.Name)" -ForegroundColor DarkGray
    try {
        Add-AppxPackage -Path $dep.FullName -ErrorAction Stop
    } catch {
        Write-Host "    Warning: Failed to install $($dep.Name). It might already be installed. Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "Installing Microsoft Store bundle: $($storeBundle.Name)" -ForegroundColor Gray
try {
    Add-AppxPackage -Path $storeBundle.FullName -ErrorAction Stop
    Write-Host "Microsoft Store installed successfully from offline files!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to install Microsoft Store: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "You might need to check Windows Update or Group Policy settings." -ForegroundColor Yellow
}

# --- 9. Re-register Microsoft Store (Fixing ms-windows-store protocol) ---
Write-Host "Re-registering Microsoft Store to fix protocols (bypassing missing explorer.exe)..." -ForegroundColor Cyan
try {
    Get-AppXPackage *WindowsStore* -AllUsers | Foreach {Add-AppxPackage -DisableDevelopmentMode -Register "$($_.InstallLocation)\AppXManifest.xml" -ErrorAction Stop}
    Write-Host "Re-registration successful." -ForegroundColor Green
} catch {
    Write-Host "WARNING: Re-registration encountered an issue: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "The Store might still work via direct COM activation." -ForegroundColor Gray
}

Write-Host "Preinstall setup complete." -ForegroundColor Green