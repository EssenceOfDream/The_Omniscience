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
