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
