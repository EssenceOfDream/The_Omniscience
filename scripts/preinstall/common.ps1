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
