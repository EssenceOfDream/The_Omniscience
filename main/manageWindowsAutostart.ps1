param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Install', 'Restore')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Windows autostart configuration is only supported on Windows.'
}

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$runPath = 'Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'The_Omniscience'
$runCommand = '"' + $electronPath + '" "' + $projectRoot + '"'

function Set-TaskbarTopAndAutoHide {
    $settingsPath = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3'
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($settingsPath, $true)
    if ($null -eq $key) {
        throw "Windows taskbar settings were not found at HKCU:\$settingsPath"
    }

    try {
        $settings = $key.GetValue(
            'Settings',
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )
        if ($settings -isnot [byte[]] -or $settings.Length -le 12) {
            throw 'Windows taskbar settings have an unsupported format; no registry values were changed.'
        }

        $settings[8] = [byte]0x01
        # StuckRects3 byte 12 controls auto-hide; 0x03 keeps the taskbar visible.
        $settings[12] = [byte]0x03
        $key.SetValue('Settings', $settings, [Microsoft.Win32.RegistryValueKind]::Binary)

        $verified = $key.GetValue('Settings')
        if ($verified -isnot [byte[]] -or $verified[8] -ne 0x01 -or $verified[12] -ne 0x03) {
            throw 'Windows taskbar registry settings did not verify.'
        }
    } finally {
        $key.Dispose()
    }
}

$runKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($runPath, $true)
if ($null -eq $runKey -and $Action -eq 'Install') {
    $runKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($runPath)
}
if ($null -eq $runKey) {
    if ($Action -eq 'Restore') { return }
    throw "Could not open HKCU:\$runPath for writing."
}

try {
    if ($Action -eq 'Install') {
        if (-not (Test-Path -LiteralPath $electronPath)) {
            throw "Electron was not found at $electronPath. Install dependencies before configuring autostart."
        }

        $existing = if ($runKey.GetValueNames() -contains $runName) {
            [string]$runKey.GetValue($runName, $null,
                [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        } else {
            $null
        }
        if ($null -ne $existing -and $existing -cne $runCommand) {
            throw "An unrelated Windows startup entry named $runName already exists; it was not overwritten."
        }

        Set-TaskbarTopAndAutoHide
        $runKey.SetValue($runName, $runCommand, [Microsoft.Win32.RegistryValueKind]::String)
        if ([string]$runKey.GetValue($runName) -cne $runCommand) {
            throw 'Omniscience autostart registration did not verify.'
        }
        Write-Output 'Windows taskbar set to top with auto-hide disabled.'
        Write-Output 'Omniscience registered for this user; the taskbar change takes effect at the next Windows sign-in.'
    } else {
        if (-not ($runKey.GetValueNames() -contains $runName)) { return }
        $existing = [string]$runKey.GetValue($runName, $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($existing -cne $runCommand) {
            throw "The startup entry $runName no longer matches this installation; it was not removed."
        }
        $runKey.DeleteValue($runName, $false)
        Write-Output 'Omniscience was removed from this user startup. Taskbar settings remain unchanged.'
    }
} finally {
    $runKey.Dispose()
}
