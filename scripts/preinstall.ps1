# scripts/preinstall.ps1
$ErrorActionPreference = "Stop"

# Elevation is not required for all preinstall operations. Keeping the script
# in the current user context also allows Windows App aliases such as winget.exe.
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if ($isElevated) {
    Write-Host "Running in an elevated shell; AppX commands remain optional." -ForegroundColor Yellow
} else {
    Write-Host "Running in the current Windows user context." -ForegroundColor Green
}

# --- Define paths globally ---
$projectRoot = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $projectRoot "fragmenter/originals"

# --- 1. Install Windows App Runtime ---
$runtimeInstaller = Join-Path $bin "WindowsAppRuntimeInstall-1.8.12-x64.exe"
if (-not (Test-Path $runtimeInstaller)) {
    throw "Windows App Runtime installer was not found: $runtimeInstaller"
}

Write-Host "Installing Windows App Runtime 1.8..." -ForegroundColor Cyan
& $runtimeInstaller --quiet
if ($LASTEXITCODE -ne 0) {
    throw "Windows App Runtime installation failed with exit code $LASTEXITCODE."
}
Write-Host "Windows App Runtime 1.8 installed." -ForegroundColor Green

# --- 2. Locate Winget ---
$aliasDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$aliasExe = Join-Path $aliasDir "winget.exe"
if ($env:PATH -notlike "*$aliasDir*") {
    $env:PATH = "$aliasDir;$env:PATH"
}

function Test-WingetReady {
    $candidate = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($candidate) {
        try {
            $ver = & $candidate.Source --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver) { return $true }
        } catch {}
    }
    if (Test-Path $aliasExe) {
        try {
            $ver = & $aliasExe --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver) { return $true }
        } catch {}
    }
    return $false
}

$wingetReady = Test-WingetReady
if (-not $wingetReady) {
    $appInstaller = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -ErrorAction SilentlyContinue
    if ($appInstaller) {
        Write-Host "Winget/App Installer is present, but its command alias is unavailable in this session." -ForegroundColor Yellow
    } else {
        Write-Host "Winget/App Installer is not available. Skipping optional package installation." -ForegroundColor Yellow
    }
} else {
    $wingetVer = & (Get-Command winget.exe -CommandType Application).Source --version
    Write-Host "Winget is ready! Version: $wingetVer" -ForegroundColor Green
}

# --- 3. Locate Python ---
Write-Host "Locating Python for native module builds..." -ForegroundColor Cyan
$pythonPath = $null
foreach ($candidate in @(
    "C:\Program Files\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
)) {
    if ($candidate -and (Test-Path $candidate)) { $pythonPath = $candidate; break }
}

if (-not $pythonPath) {
    Write-Host "Python was not found. The installation will use any Python available to node-gyp." -ForegroundColor Yellow
} else {
    Write-Host "Using Python: $pythonPath" -ForegroundColor Green
}

# --- 4. Check Visual Studio Build Tools ---
Write-Host "Checking Visual Studio Build Tools..." -ForegroundColor Cyan
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVS = $false
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) { $hasVS = $true }
}

if (-not $hasVS -and $wingetReady) {
    Write-Host "Visual Studio Build Tools are missing; attempting a passive Winget installation..." -ForegroundColor Cyan
    $wingetExe = (Get-Command winget.exe -CommandType Application).Source
    & $wingetExe install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010) {
        $hasVS = $true
    } else {
        Write-Host "WARNING: Visual Studio Build Tools installation was skipped or failed (exit code: $LASTEXITCODE)." -ForegroundColor Yellow
    }
} elseif ($hasVS) {
    Write-Host "Visual Studio Build Tools already installed." -ForegroundColor Green
} else {
    Write-Host "Visual Studio Build Tools may be missing; node-gyp will report if native compilation is impossible." -ForegroundColor Yellow
}

# --- 5. Configure project build settings ---
Write-Host "Configuring native build settings..." -ForegroundColor Cyan
$npmrcPath = Join-Path $projectRoot ".npmrc"
if ($pythonPath) {
    Set-Content -Path $npmrcPath -Value "python=$pythonPath`r`nmsvs_version=2022`r`n" -Encoding ASCII
    Write-Host "Created $npmrcPath with Python path: $pythonPath" -ForegroundColor Green
} else {
    Remove-Item -LiteralPath $npmrcPath -Force -ErrorAction SilentlyContinue
    Write-Host "Removed stale project .npmrc; node-gyp will auto-detect the build environment." -ForegroundColor Yellow
}

# Optional Winget packages are not installation blockers.
if ($wingetReady) {
    $wingetExe = (Get-Command winget.exe -CommandType Application).Source
    $optionalPackages = @(
        @{ Id = "Microsoft.VisualStudioCode"; Name = "Visual Studio Code" },
        @{ Id = "Microsoft.WindowsTerminal"; Name = "Windows Terminal" },
        @{ Id = "Microsoft.PowerToys"; Name = "Microsoft PowerToys" },
        @{ Id = "voidtools.Everything"; Name = "Everything search" },
        @{ Id = "CrystalRich.LockHunter"; Name = "LockHunter" },
        @{ Id = "ShareX.ShareX"; Name = "ShareX" },
        @{ Id = "VideoLAN.VLC"; Name = "VLC media player" },
        @{ Id = "7zip.7zip"; Name = "7-Zip" }
    )

    foreach ($package in $optionalPackages) {
        Write-Host "Checking $($package.Name)..." -ForegroundColor DarkGray
        & $wingetExe install --id $package.Id -e --source winget --silent --accept-package-agreements --accept-source-agreements 2>$null
    }
}

Write-Host "Preinstall setup complete." -ForegroundColor Green