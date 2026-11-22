$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$source = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class OmniWindowsIconExtractor
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint PrivateExtractIcons(
        string fileName,
        int iconIndex,
        int iconWidth,
        int iconHeight,
        IntPtr[] iconHandles,
        uint[] resourceIds,
        uint iconCount,
        uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr iconHandle);

    public static string ExtractDataUrl(string fileName, int iconIndex)
    {
        IntPtr[] iconHandles = new IntPtr[1];
        uint[] resourceIds = new uint[1];
        uint extracted = PrivateExtractIcons(
            fileName, iconIndex, 48, 48, iconHandles, resourceIds, 1, 0);

        if (extracted == 0 || iconHandles[0] == IntPtr.Zero)
            throw new InvalidOperationException("No icon resource was found.");

        try
        {
            using (Icon icon = Icon.FromHandle(iconHandles[0]))
            using (Bitmap bitmap = icon.ToBitmap())
            using (MemoryStream stream = new MemoryStream())
            {
                bitmap.Save(stream, ImageFormat.Png);
                return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
            }
        }
        finally
        {
            DestroyIcon(iconHandles[0]);
        }
    }
}
'@

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Drawing.dll'
$requests = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = New-Object 'System.Collections.Generic.List[object]'

foreach ($request in $requests) {
    try {
        $dataUrl = [OmniWindowsIconExtractor]::ExtractDataUrl(
            [string]$request.path,
            [int]$request.iconIndex
        )
        $results.Add(@{ id = [string]$request.id; dataUrl = $dataUrl; error = $null })
    }
    catch {
        $results.Add(@{ id = [string]$request.id; dataUrl = $null; error = $_.Exception.Message })
    }
}

$json = ConvertTo-Json -InputObject @($results.ToArray()) -Compress -Depth 3
[Console]::Out.Write($json)
