Write-Host "Configuring native build settings..." -ForegroundColor Cyan
$npmrcPath = Join-Path $projectRoot ".npmrc"
if ($pythonPath) {
    Set-Content -Path $npmrcPath -Value "python=$pythonPath`r`nmsvs_version=2022`r`n" -Encoding ASCII
    Write-Host "Created $npmrcPath with Python path: $pythonPath" -ForegroundColor Green
} else {
    Remove-Item -LiteralPath $npmrcPath -Force -ErrorAction SilentlyContinue
    Write-Host "Removed stale project .npmrc; node-gyp will auto-detect the build environment." -ForegroundColor Yellow
}
