$ErrorActionPreference = "Stop"

$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if ($isElevated) {
    Write-Host "Running in an elevated shell; AppX commands remain optional." -ForegroundColor Yellow
} else {
    Write-Host "Running in the current Windows user context." -ForegroundColor Green
}

$projectRoot = Split-Path $PSScriptRoot -Parent
$bin = Join-Path $projectRoot "fragmenter\originals"
$preinstallDirectory = Join-Path $PSScriptRoot "preinstall"
$script:wingetExe = $null

. (Join-Path $preinstallDirectory "common.ps1")

$stages = @(
    "01-windows-app-runtime.ps1",
    "02-app-installer.ps1",
    "03-python.ps1",
    "04-build-tools.ps1",
    "05-build-settings.ps1",
    "06-windows-store.ps1",
    "07-optional-packages.ps1"
)

foreach ($stage in $stages) {
    $stagePath = Join-Path $preinstallDirectory $stage
    if (-not (Test-Path $stagePath)) {
        throw "Preinstall stage was not found: $stagePath"
    }

    Write-Host "Running preinstall stage: $stage" -ForegroundColor Cyan
    . $stagePath
}

Write-Host "Preinstall setup complete." -ForegroundColor Green
