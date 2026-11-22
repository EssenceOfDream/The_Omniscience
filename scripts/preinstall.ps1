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

# --- 2. Install and locate Winget ---
$aliasDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"
$aliasExe = Join-Path $aliasDir "winget.exe"
if ($env:PATH -notlike "*$aliasDir*") {
    $env:PATH = "$aliasDir;$env:PATH"
}

function Get-WingetExecutable {
    $candidate = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($candidate -and $candidate.Source -and (Test-Path $candidate.Source)) {
        return $candidate.Source
    }

    if (Test-Path $aliasExe) {
        $item = Get-Item $aliasExe -Force -ErrorAction SilentlyContinue
        if ($item -and $item.LinkType -and $item.Target) {
            foreach ($target in $item.Target) {
                if ($target -and (Test-Path $target)) { return $target }
            }
        }
    }

    $appInstaller = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($appInstaller -and $appInstaller.InstallLocation) {
        $packageWinget = Join-Path $appInstaller.InstallLocation "winget.exe"
        if (Test-Path $packageWinget) { return $packageWinget }
    }

    return $null
}

function Test-WingetReady {
    $script:wingetExe = Get-WingetExecutable
    if (-not $script:wingetExe) { return $false }

    try {
        $ver = & $script:wingetExe --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $ver) { return $true }
    } catch {}

    return $false
}

function Confirm-Install($prompt) {
    while ($true) {
        $answer = (Read-Host $prompt).Trim()
        if (-not $answer -or $answer -match '^[Yy]$') { return $true }
        if ($answer -match '^[Nn]$') { return $false }
        Write-Host "Enter Y or n." -ForegroundColor Yellow
    }
}

function Confirm-WingetInstall($packageName, $packageId, $source) {
    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host "PACKAGE: $packageName" -ForegroundColor Cyan
    Write-Host "ID: $packageId"
    Write-Host "Source: $source"
    if (-not (Confirm-Install "Install this package? [Y/n]")) { return $false }

    Write-Host "Winget package details below include version and installer URL/file name and SHA256 when available." -ForegroundColor Gray
    & $script:wingetExe show --id $packageId --exact --source $source --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Could not retrieve package details. Verify the package ID and source before continuing." -ForegroundColor Yellow
    }

    return $true
}

$wingetReady = Test-WingetReady
if (-not $wingetReady) {
    $appInstaller = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers -ErrorAction SilentlyContinue
    if (-not $appInstaller) {
        Write-Host "Winget/App Installer is missing." -ForegroundColor Yellow
        if (Confirm-Install "Download and install App Installer? [Y/n]") {
            try {
                Write-Host "Downloading the official App Installer package..." -ForegroundColor Cyan
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/microsoft/winget-cli/releases/latest" -UseBasicParsing
            $bundle = $release.assets | Where-Object {
                $_.name -match '^Microsoft\.DesktopAppInstaller_.*\.msixbundle$'
            } | Sort-Object name -Descending | Select-Object -First 1

            if (-not $bundle) {
                throw "App Installer MSIX bundle was not found in the latest GitHub release."
            }

            $tempBundle = Join-Path $env:TEMP $bundle.name
            Invoke-WebRequest -Uri $bundle.browser_download_url -OutFile $tempBundle -UseBasicParsing

            if (-not (Test-Path $tempBundle)) {
                throw "App Installer download failed: $tempBundle"
            }

            $dependencyNames = @(
                "Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64.appx",
                "Microsoft.UI.Xaml.2.8_8.2501.31001.0_x64.Appx",
                "Microsoft.NET.Native.Framework.2.2_2.2.29512.0_x64__8wekyb3d8bbwe.Appx",
                "Microsoft.NET.Native.Runtime.2.2_2.2.28604.0_x64__8wekyb3d8bbwe.Appx"
            )

            $dependencies = foreach ($dependencyName in $dependencyNames) {
                $dependencyPath = Join-Path $bin $dependencyName
                if (Test-Path $dependencyPath) {
                    Add-AppxPackage -Path $dependencyPath -ErrorAction SilentlyContinue
                    $dependencyPath
                } else {
                    Write-Host "Dependency not found locally: $dependencyName" -ForegroundColor DarkYellow
                }
            }

            Add-AppxPackage -Path $tempBundle -DependencyPath $dependencies -ErrorAction Stop
            Remove-Item -LiteralPath $tempBundle -Force -ErrorAction SilentlyContinue

            Start-Sleep -Milliseconds 500
            $appInstaller = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers -ErrorAction SilentlyContinue
            $wingetReady = Test-WingetReady

            if ($appInstaller -and $wingetReady) {
                Write-Host "Winget/App Installer installed successfully." -ForegroundColor Green
            } elseif ($appInstaller) {
                Write-Host "Winget/App Installer was registered, but its command alias is not available in this session." -ForegroundColor Yellow
            } else {
                Write-Host "WARNING: App Installer package registration could not be verified." -ForegroundColor Yellow
            }
            } catch {
                Write-Host "WARNING: Winget/App Installer installation failed: $($_.Exception.Message)" -ForegroundColor Yellow
                $wingetReady = $false
            }
        } else {
            Write-Host "App Installer download skipped by user." -ForegroundColor Yellow
            $wingetReady = $false
        }
    } else {
        Write-Host "Winget/App Installer is present, but its command alias is unavailable in this session." -ForegroundColor Yellow
    }
}

if ($wingetReady) {
    $wingetVer = & $script:wingetExe --version
    Write-Host "Winget is already installed and working; no installation offer is needed. Version: $wingetVer" -ForegroundColor Green
} else {
    Write-Host "Winget/App Installer is not available. Skipping optional package installation." -ForegroundColor Yellow
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
    if (Confirm-WingetInstall "Visual Studio Build Tools 2022" "Microsoft.VisualStudio.2022.BuildTools" "winget") {
        Write-Host "Attempting a passive Winget installation of Visual Studio Build Tools..." -ForegroundColor Cyan
        & $script:wingetExe install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010) {
            $hasVS = $true
        } else {
            Write-Host "WARNING: Visual Studio Build Tools installation was skipped or failed (exit code: $LASTEXITCODE)." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Visual Studio Build Tools installation skipped by user." -ForegroundColor Yellow
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

# --- 6. Install Microsoft Store from local packages ---
$storeBundle = Get-ChildItem -Path $bin -Filter "Microsoft.WindowsStore_*.msixbundle" -ErrorAction SilentlyContinue |
    Select-Object -First 1
$storeDependencies = @(Get-ChildItem -Path $bin -Filter "*.appx" -ErrorAction SilentlyContinue)
$storeApp = Get-AppxPackage -Name "Microsoft.WindowsStore" -ErrorAction SilentlyContinue

if (-not $storeBundle) {
    Write-Host "WARNING: Local Microsoft Store bundle was not found in $bin; skipping Store installation." -ForegroundColor Yellow
} else {
    if ($storeApp) {
        Write-Host "Microsoft Store is already installed (version $($storeApp.Version)); local reinstall/update is available." -ForegroundColor Yellow
        $storePrompt = "Reinstall/update this package from local files? [Y/n]"
    } else {
        Write-Host "Microsoft Store will be installed from these local files:" -ForegroundColor Cyan
        $storePrompt = "Install this package? [Y/n]"
    }

    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host "PACKAGE: Microsoft Store" -ForegroundColor Cyan
    Write-Host "ID: Microsoft.WindowsStore"
    Write-Host "Source: local files"
    Write-Host "  Store bundle: $($storeBundle.Name)"
    if ($storeDependencies.Count -gt 0) {
        Write-Host "  Dependencies:"
        foreach ($dependency in $storeDependencies) {
            Write-Host "    $($dependency.Name)"
        }
    } else {
        Write-Host "  No local AppX dependencies found." -ForegroundColor Yellow
    }

    if (Confirm-Install $storePrompt) {
        foreach ($dependency in $storeDependencies) {
            try {
                Add-AppxPackage -Path $dependency.FullName -ErrorAction Stop
            } catch {
                Write-Host "Dependency install notice for $($dependency.Name): $($_.Exception.Message)" -ForegroundColor DarkYellow
            }
        }

        try {
            Add-AppxPackage -Path $storeBundle.FullName -ForceUpdateFromAnyVersion -ErrorAction Stop
            Write-Host "Microsoft Store installed/updated from local files." -ForegroundColor Green
        } catch {
            Write-Host "WARNING: Local Microsoft Store installation failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Microsoft Store local installation skipped by user." -ForegroundColor Yellow
    }
}

# Optional Winget packages are not installation blockers.
if ($wingetReady) {
    $optionalPackages = @(
        @{ Id = "Microsoft.VisualStudioCode"; Name = "Visual Studio Code"; Source = "winget" },
        @{ Id = "Microsoft.WindowsTerminal"; Name = "Windows Terminal"; Source = "winget" },
        @{ Id = "Microsoft.PowerToys"; Name = "Microsoft PowerToys"; Source = "winget" },
        @{ Id = "voidtools.Everything"; Name = "Everything search"; Source = "winget" },
        @{ Id = "CrystalRich.LockHunter"; Name = "LockHunter"; Source = "winget" },
        @{ Id = "ShareX.ShareX"; Name = "ShareX"; Source = "winget" },
        @{ Id = "VideoLAN.VLC"; Name = "VLC media player"; Source = "winget" },
        @{ Id = "7zip.7zip"; Name = "7-Zip"; Source = "winget" }
    )

    foreach ($package in $optionalPackages) {
        if (Confirm-WingetInstall $package.Name $package.Id $package.Source) {
            Write-Host "Installing $($package.Name)..." -ForegroundColor Cyan
            & $script:wingetExe install --id $package.Id -e --source $package.Source --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -ne 0) {
                Write-Host "WARNING: $($package.Name) installation failed (exit code: $LASTEXITCODE)." -ForegroundColor Yellow
            }
        } else {
            Write-Host "$($package.Name) installation skipped by user." -ForegroundColor Yellow
        }
    }
}

Write-Host "Preinstall setup complete." -ForegroundColor Green