$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$iconSource = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class OmniWindowsAppIcon
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellFileInfo
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string displayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string typeName;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint PrivateExtractIcons(
        string fileName, int iconIndex, int iconWidth, int iconHeight,
        IntPtr[] iconHandles, uint[] resourceIds, uint iconCount, uint flags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(
        string path, uint fileAttributes, ref ShellFileInfo fileInfo,
        uint fileInfoSize, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr iconHandle);

    private static string ToDataUrl(IntPtr iconHandle)
    {
        using (Icon icon = Icon.FromHandle(iconHandle))
        using (Bitmap bitmap = icon.ToBitmap())
        using (MemoryStream stream = new MemoryStream())
        {
            bitmap.Save(stream, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
        }
    }

    public static string ExtractDataUrl(string fileName, int iconIndex)
    {
        IntPtr[] handles = new IntPtr[1];
        uint[] resourceIds = new uint[1];
        uint extracted = PrivateExtractIcons(
            fileName, iconIndex, 48, 48, handles, resourceIds, 1, 0);
        if (extracted == 0 || handles[0] == IntPtr.Zero) return null;

        try
        {
            return ToDataUrl(handles[0]);
        }
        finally
        {
            DestroyIcon(handles[0]);
        }
    }

    public static string ExtractShellDataUrl(string fileName)
    {
        ShellFileInfo fileInfo = new ShellFileInfo();
        IntPtr result = SHGetFileInfo(
            fileName, 0, ref fileInfo,
            (uint)Marshal.SizeOf(typeof(ShellFileInfo)), 0x100);
        if (result == IntPtr.Zero || fileInfo.hIcon == IntPtr.Zero) return null;

        try
        {
            return ToDataUrl(fileInfo.hIcon);
        }
        finally
        {
            DestroyIcon(fileInfo.hIcon);
        }
    }
}
'@

$drawingAssembly = [Reflection.Assembly]::LoadWithPartialName('System.Drawing')
if (-not $drawingAssembly) { throw 'System.Drawing is unavailable.' }
Add-Type -TypeDefinition $iconSource -ReferencedAssemblies $drawingAssembly.Location -ErrorAction Stop
$shell = New-Object -ComObject WScript.Shell
$shell = New-Object -ComObject WScript.Shell
while ($line = [Console]::In.ReadLine()) {
    try {
        $inputObject = ConvertFrom-Json -InputObject $line
        $requests = $inputObject.requests
        if ($null -eq $requests) { $requests = @() }
        $results = @(
            foreach ($request in $requests) {
                $dataUrl = $null
                $failure = $null
                try {
                    $shortcutPath = [string]$request.path
                    $extension = [IO.Path]::GetExtension($shortcutPath).ToLowerInvariant()
                    $candidates = @()

                    if ($extension -eq '.lnk') {
                        $shortcut = $shell.CreateShortcut($shortcutPath)
                        $iconLocation = [string]$shortcut.IconLocation
                        if ($iconLocation -match '^(.*?)(?:,\s*(-?\d+))?$') {
                            $candidatePath = [Environment]::ExpandEnvironmentVariables($matches[1].Trim().Trim('"'))
                            $iconIndex = if ($matches[2]) { [int]$matches[2] } else { 0 }
                            if ($candidatePath) {
                                $candidates += @{ path = $candidatePath; index = $iconIndex }
                            }
                        }
                        if ($shortcut.TargetPath) {
                            $candidates += @{
                                path = [Environment]::ExpandEnvironmentVariables([string]$shortcut.TargetPath)
                                index = 0
                            }
                        }
                    } elseif ($extension -eq '.url') {
                        $content = [IO.File]::ReadAllText($shortcutPath)
                        $iconMatch = [regex]::Match($content, '(?im)^\s*IconFile\s*=\s*(.+?)\s*$')
                        if ($iconMatch.Success) {
                            $iconPath = [Environment]::ExpandEnvironmentVariables($iconMatch.Groups[1].Value.Trim().Trim('"'))
                            $indexMatch = [regex]::Match($content, '(?im)^\s*IconIndex\s*=\s*(-?\d+)\s*$')
                            $iconIndex = if ($indexMatch.Success) { [int]$indexMatch.Groups[1].Value } else { 0 }
                            if ($iconPath) {
                                if (-not [IO.Path]::IsPathRooted($iconPath)) {
                                    $iconPath = Join-Path (Split-Path -Parent $shortcutPath) $iconPath
                                }
                                $candidates += @{ path = $iconPath; index = $iconIndex }
                            }
                        }
                    }

                    $candidates += @{ path = $shortcutPath; index = 0 }
                    foreach ($candidate in $candidates) {
                        $candidatePath = [string]$candidate.path
                        if (-not (Test-Path -LiteralPath $candidatePath)) { continue }
                        $candidateExtension = [IO.Path]::GetExtension($candidatePath).ToLowerInvariant()

                        if ($candidateExtension -eq '.svg') {
                            $svg = [IO.File]::ReadAllText($candidatePath)
                            $dataUrl = 'data:image/svg+xml;base64,' + [Convert]::ToBase64String(
                                [Text.Encoding]::UTF8.GetBytes($svg))
                        } elseif ($candidateExtension -in @('.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp')) {
                            $bytes = [IO.File]::ReadAllBytes($candidatePath)
                            $mime = switch ($candidateExtension) {
                                '.bmp' { 'image/bmp' }
                                '.gif' { 'image/gif' }
                                '.jpeg' { 'image/jpeg' }
                                '.jpg' { 'image/jpeg' }
                                '.png' { 'image/png' }
                                '.webp' { 'image/webp' }
                            }
                            $dataUrl = "data:$mime;base64,$([Convert]::ToBase64String($bytes))"
                        } else {
                            $dataUrl = [OmniWindowsAppIcon]::ExtractDataUrl(
                                $candidatePath, [int]$candidate.index)
                            if (-not $dataUrl) {
                                $dataUrl = [OmniWindowsAppIcon]::ExtractShellDataUrl($candidatePath)
                            }
                        }
                        if ($dataUrl) { break }
                    }
                } catch {
                    $failure = $_.Exception.Message
                }

                [PSCustomObject]@{
                    id = [string]$request.id
                    dataUrl = $dataUrl
                    error = $failure
                }
            }
        )
        $response = [PSCustomObject]@{
            requestId = $inputObject.requestId
            success = $true
            entries = $results
        }
    } catch {
        $response = [PSCustomObject]@{
            requestId = $inputObject.requestId
            success = $false
            error = $_.Exception.Message
        }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $response -Compress -Depth 4))
}
