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
        $versionOutput = & $script:wingetExe --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $versionOutput) { return $true }
    } catch {
        Write-Host "Winget executable could not be started: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    return $false
}

$wingetReady = Test-WingetReady
if (-not $wingetReady) {
    $appInstaller = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers -ErrorAction SilentlyContinue
    if (-not $appInstaller) {
        $bundleName = "Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"
        $bundlePath = Join-Path $bin $bundleName
        $dependencyNames = @(
            "Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64.appx",
            "Microsoft.UI.Xaml.2.8_8.2501.31001.0_x64__8wekyb3d8bbwe.Appx",
            "Microsoft.NET.Native.Framework.2.2_2.2.29512.0_x64__8wekyb3d8bbwe.Appx",
            "Microsoft.NET.Native.Runtime.2.2_2.2.28604.0_x64__8wekyb3d8bbwe.Appx"
        )
        $dependencies = @()
        $missingDependencies = @()

        foreach ($dependencyName in $dependencyNames) {
            $dependencyPath = Join-Path $bin $dependencyName
            if (Test-Path $dependencyPath) {
                $dependencies += $dependencyPath
            } else {
                $missingDependencies += $dependencyName
            }
        }

        if (-not (Test-Path $bundlePath)) {
            Write-Host "Local App Installer bundle was not found: $bundlePath" -ForegroundColor Yellow
        } elseif ($missingDependencies.Count -gt 0) {
            Write-Host "Local App Installer dependencies are missing: $($missingDependencies -join ', ')" -ForegroundColor Yellow
        } elseif (Confirm-Install "Install local App Installer package and Winget? [Y/n]") {
            try {
                Write-Host "Installing App Installer from local files..." -ForegroundColor Cyan
                Add-AppxPackage -Path $bundlePath -DependencyPath $dependencies -ErrorAction Stop

                Start-Sleep -Milliseconds 500
                $appInstaller = Get-AppxPackage -Name "Microsoft.DesktopAppInstaller" -AllUsers -ErrorAction SilentlyContinue
                $wingetReady = Test-WingetReady

                if ($appInstaller -and $wingetReady) {
                    Write-Host "Local App Installer package and Winget installed successfully." -ForegroundColor Green
                } elseif ($appInstaller) {
                    Write-Host "App Installer was registered, but its command alias is not available in this session." -ForegroundColor Yellow
                } else {
                    Write-Host "WARNING: App Installer package registration could not be verified." -ForegroundColor Yellow
                }
            } catch {
                Write-Host "WARNING: Local App Installer installation failed: $($_.Exception.Message)" -ForegroundColor Yellow
                $wingetReady = $false
            }
        } else {
            Write-Host "Local App Installer installation skipped by user." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Winget/App Installer is present, but its command alias is unavailable in this session." -ForegroundColor Yellow
    }
}

if ($wingetReady) {
    $wingetVersion = & $script:wingetExe --version
    Write-Host "Winget is installed and working. Version: $wingetVersion" -ForegroundColor Green
} else {
    Write-Host "Winget/App Installer is not available. Skipping optional Winget packages." -ForegroundColor Yellow
}
