param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Install', 'Restore')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'

$winlogonPath = 'Software\Microsoft\Windows NT\CurrentVersion\Winlogon'
$machinePolicyPath = 'Software\Microsoft\Windows\CurrentVersion\Policies\System'
$userRunPath = 'Software\Microsoft\Windows\CurrentVersion\Run'
$backupPath = Join-Path $env:ProgramData 'The_Omniscience\windows-shell-backup.json'
$projectRoot = Split-Path -Parent $PSScriptRoot
$hostPath = Join-Path $PSScriptRoot 'OmniShellHost.exe'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegistrySnapshot($key, $name) {
    if ($key.GetValueNames() -notcontains $name) {
        return @{ exists = $false; value = $null; kind = $null }
    }

    $kind = $key.GetValueKind($name)
    if ($kind -notin @(
        [Microsoft.Win32.RegistryValueKind]::String,
        [Microsoft.Win32.RegistryValueKind]::ExpandString
    )) {
        throw "Unsupported registry value kind for $name`: $kind"
    }

    return @{
        exists = $true
        value = [string]$key.GetValue(
            $name,
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )
        kind = $kind.ToString()
    }
}

function Set-RegistrySnapshot($key, $name, $snapshot) {
    if (-not $snapshot.exists) {
        if ($key.GetValueNames() -contains $name) {
            $key.DeleteValue($name, $false)
        }
        return
    }

    $kind = switch ([string]$snapshot.kind) {
        'String' { [Microsoft.Win32.RegistryValueKind]::String }
        'ExpandString' { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        default { throw "Unsupported registry value kind for $name`: $($snapshot.kind)" }
    }
    $key.SetValue($name, [string]$snapshot.value, $kind)
}

function Test-Snapshot($actual, $expected) {
    if ([bool]$actual.exists -ne [bool]$expected.exists) { return $false }
    if (-not $actual.exists) { return $true }
    return [string]::Equals([string]$actual.value, [string]$expected.value, [StringComparison]::Ordinal) `
        -and [string]::Equals([string]$actual.kind, [string]$expected.kind, [StringComparison]::Ordinal)
}

if ($env:OS -ne 'Windows_NT') {
    throw 'Windows shell registration is only supported on Windows.'
}
if (-not (Test-IsAdministrator)) {
    throw 'Run this command from an elevated PowerShell or Command Prompt (Run as administrator).'
}

$machineHive = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::LocalMachine,
    [Microsoft.Win32.RegistryView]::Default
)
$winlogonKey = $null
$machinePolicyKey = $null

try {
    $winlogonKey = $machineHive.OpenSubKey($winlogonPath, $true)
    if ($null -eq $winlogonKey) {
        throw "Could not open HKLM:\$winlogonPath for writing."
    }
    $machinePolicyKey = $machineHive.OpenSubKey($machinePolicyPath, $false)

    if ($Action -eq 'Install') {
        if (Test-Path -LiteralPath $backupPath) {
            throw "A shell backup already exists at $backupPath. Restore it before installing again."
        }
        $profilePath = [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
        $resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')
        $isInUserProfile = $resolvedProjectRoot.Equals(
            $profilePath,
            [StringComparison]::OrdinalIgnoreCase
        ) -or $resolvedProjectRoot.StartsWith(
            $profilePath + '\',
            [StringComparison]::OrdinalIgnoreCase
        )
        if ($isInUserProfile) {
            Write-Warning 'This project is in a user profile. The HKLM shell setting applies to every account, but other users may not be able to access these files.'
            $confirmation = Read-Host 'Continue with machine-wide registration anyway? (y/N)'
            if ($confirmation -notmatch '^(?i:y|yes)$') {
                throw 'Shell installation cancelled.'
            }
        }

        & (Join-Path $PSScriptRoot 'buildWindowsShellHost.ps1')
        if (-not (Test-Path -LiteralPath $hostPath)) {
            throw 'Could not build OmniShellHost.exe.'
        }
        $electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
        if (-not (Test-Path -LiteralPath $electronPath)) {
            throw "Electron was not found at $electronPath. Run npm install first."
        }

        $processHostPath = Join-Path $projectRoot 'main\processHost.cjs'
        $command = '"' + $hostPath + '" --executable "' + $electronPath + '" --app-path "' + $processHostPath + '"'
        $original = Get-RegistrySnapshot $winlogonKey 'Shell'
        $originalPolicyShell = if ($null -ne $machinePolicyKey) {
            Get-RegistrySnapshot $machinePolicyKey 'Shell'
        } else {
            @{ exists = $false; value = $null; kind = $null }
        }
        if ($originalPolicyShell.exists) {
            throw 'A machine-wide shell policy is configured; refusing to override it.'
        }
        $userRunKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($userRunPath, $true)
        $originalUserRun = if ($null -ne $userRunKey) {
            Get-RegistrySnapshot $userRunKey 'The_Omniscience'
        } else {
            @{ exists = $false; value = $null; kind = $null }
        }
        $currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $backup = @{
            schemaVersion = 4
            scope = 'machine'
            persistentShell = $true
            command = $command
            machineWinlogonShell = $original
            machinePolicyShell = $originalPolicyShell
            currentUserSid = $currentUserSid
            currentUserRun = $originalUserRun
        }
        $backupDirectory = Split-Path -Parent $backupPath
        [System.IO.Directory]::CreateDirectory($backupDirectory) | Out-Null
        $temporaryBackup = "$backupPath.$PID.tmp"
        $backupJson = ConvertTo-Json -InputObject $backup -Compress -Depth 5
        [System.IO.File]::WriteAllText(
            $temporaryBackup,
            $backupJson,
            [System.Text.UTF8Encoding]::new($false)
        )
        [System.IO.File]::Move($temporaryBackup, $backupPath)

        try {
            $winlogonKey.SetValue(
                'Shell',
                $command,
                [Microsoft.Win32.RegistryValueKind]::String
            )
            $actual = Get-RegistrySnapshot $winlogonKey 'Shell'
            if ($actual.value -cne $command -or $actual.kind -cne 'String') {
                throw 'Winlogon shell update did not verify.'
            }
            if ($null -ne $userRunKey) {
                $userRunKey.DeleteValue('The_Omniscience', $false)
            }
        } catch {
            $failure = $_
            try {
                Set-RegistrySnapshot $winlogonKey 'Shell' $original
                if ($null -ne $userRunKey) {
                    Set-RegistrySnapshot $userRunKey 'The_Omniscience' $originalUserRun
                }
                [System.IO.File]::Delete($backupPath)
            } catch {
                throw "Shell installation failed and rollback was incomplete: $($failure.Exception.Message); $($_.Exception.Message)"
            }
            throw $failure
        } finally {
            if ($null -ne $userRunKey) { $userRunKey.Dispose() }
        }

        Write-Output "Omniscience is registered as the machine-wide Windows shell."
        Write-Output 'Sign out and sign in again to activate it.'
        Write-Output "To restore the previous shell: npm run windows:legacy-shell:restore (run as administrator)."
    } else {
        if (-not (Test-Path -LiteralPath $backupPath)) {
            throw "No shell backup was found at $backupPath."
        }
        $backup = Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json
        if ($backup.schemaVersion -ne 4 -or [string]::IsNullOrWhiteSpace([string]$backup.command)) {
            throw 'The shell backup has an unsupported format.'
        }

        $current = Get-RegistrySnapshot $winlogonKey 'Shell'
        $shellIsManaged = $current.exists `
            -and $current.value -ceq [string]$backup.command `
            -and $current.kind -ceq 'String'
        $shellIsAlreadyRestored = Test-Snapshot $current $backup.machineWinlogonShell
        if (($backup.schemaVersion -ne 4) -or ($backup.scope -ne 'machine') `
            -or (-not $backup.machineWinlogonShell) -or (-not $backup.machinePolicyShell) `
            -or (-not $shellIsManaged -and -not $shellIsAlreadyRestored)) {
            throw 'The machine-wide shell has changed; refusing to overwrite it.'
        }
        $currentPolicyShell = if ($null -ne $machinePolicyKey) {
            Get-RegistrySnapshot $machinePolicyKey 'Shell'
        } else {
            @{ exists = $false; value = $null; kind = $null }
        }
        if (-not (Test-Snapshot $currentPolicyShell $backup.machinePolicyShell)) {
            throw 'The machine shell policy changed; refusing to overwrite it.'
        }

        if ($shellIsManaged) {
            Set-RegistrySnapshot $winlogonKey 'Shell' $backup.machineWinlogonShell
            if (-not (Test-Snapshot (Get-RegistrySnapshot $winlogonKey 'Shell') $backup.machineWinlogonShell)) {
                throw 'Restored Winlogon shell did not verify. The backup was kept.'
            }
        }
        if (($backup.currentUserSid -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) `
            -and $backup.currentUserRun.exists) {
            $userRunKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($userRunPath, $true)
            if ($null -eq $userRunKey) {
                $userRunKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($userRunPath)
            }
            try {
                $currentUserRun = Get-RegistrySnapshot $userRunKey 'The_Omniscience'
                if (-not $currentUserRun.exists) {
                    Set-RegistrySnapshot $userRunKey 'The_Omniscience' $backup.currentUserRun
                }
            } finally {
                if ($null -ne $userRunKey) { $userRunKey.Dispose() }
            }
        }
        Remove-Item -LiteralPath $backupPath -Force
        Write-Output 'The original Windows shell has been restored.'
        Write-Output 'Sign out and sign in again to apply the change.'
    }
} finally {
    if ($null -ne $winlogonKey) { $winlogonKey.Dispose() }
    if ($null -ne $machinePolicyKey) { $machinePolicyKey.Dispose() }
    $machineHive.Dispose()
}
