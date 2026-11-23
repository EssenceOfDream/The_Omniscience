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
            Write-Host "WARNING: Visual Studio Build Tools installation failed (exit code: $LASTEXITCODE)." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Visual Studio Build Tools installation skipped by user." -ForegroundColor Yellow
    }
} elseif ($hasVS) {
    Write-Host "Visual Studio Build Tools already installed." -ForegroundColor Green
} else {
    Write-Host "Visual Studio Build Tools may be missing; node-gyp will report if native compilation is impossible." -ForegroundColor Yellow
}
