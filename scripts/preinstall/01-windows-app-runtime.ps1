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
