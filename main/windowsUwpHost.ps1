param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('List', 'Launch')]
    [string]$Action,
    [string]$AppId
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if ($Action -eq 'List') {
    $apps = @(
        Get-StartApps |
            Where-Object { $_.AppID -match '^[^\\/:!]+_[^\\/:!]+![^\\/:!]+$' } |
            ForEach-Object { [PSCustomObject]@{ Name = $_.Name; AppID = $_.AppID } }
    )
    ConvertTo-Json -InputObject $apps -Compress
    exit 0
}

if ($AppId -notmatch '^[^\\/:!]+_[^\\/:!]+![^\\/:!]+$') {
    throw 'Invalid packaged application ID.'
}

$activationSource = @'
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
[ClassInterface(ClassInterfaceType.None)]
public class OmniApplicationActivationManager { }

[ComImport]
[Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IOmniApplicationActivationManager
{
    [PreserveSig]
    int ActivateApplication(
        [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments,
        uint options,
        out uint processId);
}

public static class OmniUwpActivation
{
    public static uint Launch(string appUserModelId)
    {
        var manager = (IOmniApplicationActivationManager)new OmniApplicationActivationManager();
        uint processId;
        int result = manager.ActivateApplication(appUserModelId, null, 0, out processId);
        Marshal.ThrowExceptionForHR(result);
        return processId;
    }
}
'@

Add-Type -TypeDefinition $activationSource -ErrorAction Stop
$processId = [OmniUwpActivation]::Launch($AppId)
ConvertTo-Json -InputObject @{ processId = $processId } -Compress
