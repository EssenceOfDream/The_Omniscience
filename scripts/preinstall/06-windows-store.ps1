function Get-AppxPackageIdentity($packagePath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
    try {
        $manifestEntry = $archive.GetEntry("AppxManifest.xml")
        if (-not $manifestEntry) {
            throw "AppxManifest.xml was not found in $packagePath"
        }

        $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
        try {
            [xml]$manifest = $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }

        $identity = $manifest.Package.Identity
        if (-not $identity.Name -or -not $identity.Version) {
            throw "Package identity is missing in $packagePath"
        }

        return [pscustomobject]@{
            Name = $identity.Name
            Version = [version]$identity.Version
            Architecture = [string]$identity.ProcessorArchitecture
        }
    } finally {
        $archive.Dispose()
    }
}

function Test-AppxPackageInstalled($identity) {
    $installedPackages = Get-AppxPackage -Name $identity.Name -ErrorAction SilentlyContinue
    foreach ($installedPackage in $installedPackages) {
        if ([version]$installedPackage.Version -ge $identity.Version) {
            $installedArchitecture = [string]$installedPackage.Architecture
            if (-not $identity.Architecture -or
                -not $installedArchitecture -or
                $installedArchitecture -ieq $identity.Architecture) {
                return $true
            }
        }
    }

    return $false
}

$restoredDependencyNames = @(
    "Microsoft.NET.Native.Framework.1.7_1.7.27413.0_x64__8wekyb3d8bbwe.Appx",
    "Microsoft.NET.Native.Runtime.1.7.appx",
    "Microsoft.UI.Xaml.2.4_2.42007.9001.0_x64__8wekyb3d8bbwe.appx",
    "Microsoft.VCLibs.140.00_14.0.33519.0_x64.appx",
    "Microsoft.VCLibs.140.00_14.0.33519.0_x64__8wekyb3d8bbwe.Appx"
)

$storeBundle = Get-ChildItem -Path $bin -Filter "Microsoft.WindowsStore_*.msixbundle" -ErrorAction SilentlyContinue |
    Select-Object -First 1
$storeDependencies = @(Get-ChildItem -Path $bin -Filter "*.appx" -ErrorAction SilentlyContinue | Sort-Object Name)
$storeApp = Get-AppxPackage -Name "Microsoft.WindowsStore" -ErrorAction SilentlyContinue

if (-not $storeBundle) {
    Write-Host "WARNING: Local Microsoft Store bundle was not found in $bin; skipping Store installation." -ForegroundColor Yellow
} else {
    if ($storeApp) {
        Write-Host "Microsoft Store is already installed (version $($storeApp.Version)); local reinstall/update is available." -ForegroundColor Yellow
        $storePrompt = "Reinstall/update this package from local files? [Y/n]"
    } else {
        Write-Host "Microsoft Store will be installed from local files." -ForegroundColor Cyan
        $storePrompt = "Install this package? [Y/n]"
    }

    Write-Host "`n============================================================" -ForegroundColor Cyan
    Write-Host "PACKAGE: Microsoft Store" -ForegroundColor Cyan
    Write-Host "ID: Microsoft.WindowsStore"
    Write-Host "Source: local files"
    Write-Host "  Store bundle: $($storeBundle.Name)"
    Write-Host "  AppX dependencies:"
    foreach ($dependency in $storeDependencies) {
        Write-Host "    $($dependency.Name)"
    }

    if (Confirm-Install $storePrompt) {
        $missingRestoredDependencies = @(
            $restoredDependencyNames | Where-Object {
                -not (Test-Path (Join-Path $bin $_))
            }
        )
        if ($missingRestoredDependencies.Count -gt 0) {
            throw "Restored Store dependencies are missing from ${bin}: $($missingRestoredDependencies -join ', ')"
        }

        $failedRestoredDependencies = @()
        foreach ($dependency in $storeDependencies) {
            $identity = $null
            try {
                $identity = Get-AppxPackageIdentity $dependency.FullName
                if (Test-AppxPackageInstalled $identity) {
                    Write-Host "$($dependency.Name) is already installed at version $($identity.Version) or newer." -ForegroundColor Green
                    continue
                }

                Add-AppxPackage -Path $dependency.FullName -ErrorAction Stop
                Write-Host "Installed $($dependency.Name)." -ForegroundColor Green
            } catch {
                $isRestoredDependency = $restoredDependencyNames -contains $dependency.Name
                $isAlreadyInstalled = $false
                if ($identity) {
                    $isAlreadyInstalled = Test-AppxPackageInstalled $identity
                }

                if ($isAlreadyInstalled) {
                    Write-Host "$($dependency.Name) is already satisfied by an installed package." -ForegroundColor Green
                } elseif ($isRestoredDependency) {
                    $failedRestoredDependencies += "$($dependency.Name): $($_.Exception.Message)"
                    Write-Host "ERROR: Could not install restored dependency $($dependency.Name): $($_.Exception.Message)" -ForegroundColor Red
                } else {
                    Write-Host "Dependency install notice for $($dependency.Name): $($_.Exception.Message)" -ForegroundColor DarkYellow
                }
            }
        }

        if ($failedRestoredDependencies.Count -gt 0) {
            throw "One or more restored Store dependencies could not be installed: $($failedRestoredDependencies -join '; ')"
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
