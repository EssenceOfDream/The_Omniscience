param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Install', 'ConfigureTaskbar', 'Restore')]
    [string]$Action,
    [switch]$ApplyNow
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Windows autostart configuration is only supported on Windows.'
}

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$runPath = 'Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'The_Omniscience'
$hostPath = Join-Path $projectRoot 'main\processHost.cjs'
$runCommand = '"' + $electronPath + '" "' + $hostPath + '"'

function Set-TaskbarTopAndVisible {
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

        # Bit 0 of byte 8 enables auto-hide; byte 12 selects the edge (0x01 is top).
        $settings[8] = [byte]($settings[8] -band 0xFE)
        $settings[12] = [byte]0x01
        $key.SetValue('Settings', $settings, [Microsoft.Win32.RegistryValueKind]::Binary)

        $verified = $key.GetValue('Settings')
        if ($verified -isnot [byte[]] -or ($verified[8] -band 0x01) -ne 0 -or $verified[12] -ne 0x01) {
            throw 'Windows taskbar registry settings did not verify.'
        }
    } finally {
        $key.Dispose()
    }
}

function Apply-TaskbarSettingsNow {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OmniTaskbarRuntime {
    private const uint ABM_GETSTATE = 0x00000004;
    private const uint ABM_SETSTATE = 0x0000000A;
    private const uint ABS_AUTOHIDE = 0x00000001;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("shell32.dll", EntryPoint = "SHAppBarMessage")]
    private static extern UIntPtr SHAppBarMessage(uint message, ref APPBARDATA data);

    private static IntPtr GetTaskbar() {
        IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
        if (taskbar == IntPtr.Zero)
            throw new InvalidOperationException("Windows taskbar was not found.");
        return taskbar;
    }

    private static APPBARDATA NewData(IntPtr taskbar) {
        return new APPBARDATA {
            cbSize = Marshal.SizeOf(typeof(APPBARDATA)),
            hWnd = taskbar
        };
    }

    public static bool TryDisableAutoHide() {
        IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
        if (taskbar == IntPtr.Zero) return false;
        APPBARDATA data = NewData(taskbar);
        uint state = (uint)SHAppBarMessage(ABM_GETSTATE, ref data).ToUInt64();
        if ((state & ABS_AUTOHIDE) == 0) return true;
        data.lParam = new IntPtr((long)(state & ~ABS_AUTOHIDE));
        SHAppBarMessage(ABM_SETSTATE, ref data);
        data = NewData(taskbar);
        state = (uint)SHAppBarMessage(ABM_GETSTATE, ref data).ToUInt64();
        return (state & ABS_AUTOHIDE) == 0;
    }

    public static bool IsAtTop(int top) {
        RECT rect;
        IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
        return taskbar != IntPtr.Zero && GetWindowRect(taskbar, out rect) && rect.Top == top;
    }

    public static int GetTaskbarProcessId() {
        IntPtr taskbar = GetTaskbar();
        uint processId;
        GetWindowThreadProcessId(taskbar, out processId);
        return checked((int)processId);
    }
}
'@

    if (-not [OmniTaskbarRuntime]::TryDisableAutoHide()) {
        throw 'Could not disable Windows taskbar auto-hide.'
    }

    $primaryTop = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Top
    if ([OmniTaskbarRuntime]::IsAtTop($primaryTop)) {
        Write-Output 'Windows taskbar is already at the top and auto-hide is disabled.'
        return
    }

    $taskbarProcessId = [OmniTaskbarRuntime]::GetTaskbarProcessId()
    $taskbarProcess = Get-Process -Id $taskbarProcessId -ErrorAction Stop
    if ($taskbarProcess.ProcessName -ne 'explorer') {
        throw 'The Windows taskbar is not owned by Explorer; refusing to restart another process.'
    }

    Write-Output 'Restarting Explorer to apply the top taskbar position.'
    Stop-Process -Id $taskbarProcessId -Force -ErrorAction Stop
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe')

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $autoHideDisabled = [OmniTaskbarRuntime]::TryDisableAutoHide()
        $taskbarAtTop = [OmniTaskbarRuntime]::IsAtTop($primaryTop)
        if ($autoHideDisabled -and $taskbarAtTop) {
            Write-Output 'Windows taskbar is at the top and auto-hide is disabled.'
            return
        }
    }
    throw 'Explorer restarted but did not apply the top taskbar settings.'
}

if ($Action -eq 'ConfigureTaskbar') {
    Set-TaskbarTopAndVisible
    if ($ApplyNow) {
        Apply-TaskbarSettingsNow
    }
    Write-Output 'Windows taskbar set to top with auto-hide disabled.'
    if (-not $ApplyNow) {
        Write-Output 'Explorer applies these settings at the next Windows sign-in.'
    }
    return
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
            $belongsToThisProject = $existing.IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
            if (-not $belongsToThisProject) {
                throw "An unrelated Windows startup entry named $runName already exists; it was not overwritten."
            }
            Write-Output 'Migrating the existing Omniscience startup entry to the current process-host format.'
        }

        Set-TaskbarTopAndVisible
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
