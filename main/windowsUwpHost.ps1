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
    $packagesByFamily = @{}
    foreach ($package in Get-AppxPackage) {
        if ($package.PackageFamilyName) {
            $packagesByFamily[[string]$package.PackageFamilyName] = $package
        }
    }

    $apps = @(
        Get-StartApps |
            Where-Object { $_.AppID -match '^[^\\/:!]+_[^\\/:!]+![^\\/:!]+$' } |
            ForEach-Object {
                $iconPath = $null
                $appUserModelId = [string]$_.AppID
                $separator = $appUserModelId.IndexOf('!')
                $packageFamily = $appUserModelId.Substring(0, $separator)
                $applicationId = $appUserModelId.Substring($separator + 1)
                $package = $packagesByFamily[$packageFamily]

                if ($package.InstallLocation) {
                    try {
                        $installRoot = [IO.Path]::GetFullPath(
                            [string]$package.InstallLocation
                        ).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
                        $manifestPath = Join-Path $installRoot 'AppxManifest.xml'
                        if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
                            $manifest = New-Object System.Xml.XmlDocument
                            $manifest.XmlResolver = $null
                            $manifest.Load($manifestPath)
                            $application = $manifest.SelectNodes(
                                "//*[local-name()='Application']"
                            ) | Where-Object { $_.GetAttribute('Id') -eq $applicationId } |
                                Select-Object -First 1
                            $visualElements = if ($application) {
                                $application.SelectSingleNode(
                                    "./*[local-name()='VisualElements']"
                                )
                            } else {
                                $null
                            }

                            if ($visualElements) {
                                foreach ($attribute in @(
                                    'Square44x44Logo',
                                    'Square71x71Logo',
                                    'Square150x150Logo',
                                    'Square310x310Logo',
                                    'Wide310x150Logo'
                                )) {
                                    $logo = $visualElements.GetAttribute($attribute)
                                    if (-not $logo -or $logo -match '^ms-resource:') { continue }

                                    $logoPath = Join-Path $installRoot $logo
                                    $candidatePaths = @($logoPath)
                                    $logoDirectory = Split-Path -Parent $logoPath
                                    $logoStem = [IO.Path]::GetFileNameWithoutExtension($logoPath)
                                    if (Test-Path -LiteralPath $logoDirectory -PathType Container) {
                                        $candidatePaths += @(
                                            Get-ChildItem -LiteralPath $logoDirectory -File `
                                                -Filter "$logoStem*" -ErrorAction SilentlyContinue |
                                                Sort-Object @{
                                                    Expression = {
                                                        if ($_.Name -match '(?i)\.targetsize-(44|48)(?:_|\.|-)') { 0 }
                                                        elseif ($_.Name -match '(?i)\.scale-100(?:_|\.|-)') { 1 }
                                                        else { 2 }
                                                    }
                                                }, Name |
                                                ForEach-Object { $_.FullName }
                                        )
                                    }

                                    foreach ($candidatePath in $candidatePaths) {
                                        $resolvedPath = [IO.Path]::GetFullPath($candidatePath)
                                        if ($resolvedPath.StartsWith(
                                            $installRoot,
                                            [StringComparison]::OrdinalIgnoreCase
                                        ) -and (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
                                            $iconPath = $resolvedPath
                                            break
                                        }
                                    }
                                    if ($iconPath) { break }
                                }
                            }
                        }
                    } catch {
                        $iconPath = $null
                    }
                }

                [PSCustomObject]@{
                    Name = $_.Name
                    AppID = $appUserModelId
                    IconPath = $iconPath
                }
            }
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
