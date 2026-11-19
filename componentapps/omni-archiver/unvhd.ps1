param([string]$VhdPath, [string]$OutputDir, [string]$StatusFile)

$ErrorActionPreference = "Stop"
try { "boot" | Set-Content -Path "$StatusFile.boot" -Encoding ASCII -Force } catch {}

function Write-Status($data) {
  try {
    $json = $data | ConvertTo-Json -Compress -Depth 6
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($StatusFile, $json, $utf8NoBom)
  } catch {}
}
function Log($msg) {
  $line = "$(Get-Date -Format o) $msg"
  try { Write-Output $line } catch {}
  try { $line | Add-Content -Path "$StatusFile.log" -Encoding UTF8 } catch {}
}

$mounted = $false
$driveLetter = $null

try {
  Log "boot, mounting $VhdPath"

  $existingImage = Get-DiskImage -ImagePath $VhdPath -ErrorAction SilentlyContinue
  if ($existingImage -and $existingImage.Attached) {
    Log "VHD already attached. Dismounting first..."
    Write-Status @{ stage = "mount"; message = "Dismounting previously mounted VHD..."; progress = 0 }
    Dismount-DiskImage -ImagePath $VhdPath -ErrorAction Stop
    Start-Sleep -Milliseconds 500
  }

  Write-Status @{ stage = "mount"; message = "Mounting VHD..."; progress = 0 }

  Mount-DiskImage -ImagePath $VhdPath -NoDriveLetter -ErrorAction Stop
  $mounted = $true
  Start-Sleep -Milliseconds 700

  $disk = Get-DiskImage -ImagePath $VhdPath | Get-Disk
  $part = Get-Partition -DiskNumber $disk.Number | Select-Object -First 1
  if (-not $part) { throw "No partition found on VHD" }

  $freeLetters = (68..90 | ForEach-Object { [char]$_ }) | Where-Object {
    -not (Get-PSDrive -Name $_ -ErrorAction SilentlyContinue)
  }
  if (-not $freeLetters) { throw "No free drive letters available" }
  $driveLetter = $freeLetters[0]
  Log "Using drive letter $driveLetter"

  Set-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -NewDriveLetter $driveLetter -ErrorAction Stop
  Log "Assigned letter $driveLetter"

  for ($i = 0; $i -lt 20; $i++) {
    $vol = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
    if ($vol -and $vol.FileSystem) { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $vol -or -not $vol.FileSystem) { throw "Volume ${driveLetter}: not ready" }

  $root = "${driveLetter}:\"
  $excludeNames = @('System Volume Information', '$RECYCLE.BIN', 'RECYCLER')
  $items = @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue |
    Where-Object { $excludeNames -notcontains $_.Name })

  if ($items.Count -eq 0) {
    throw "VHD is empty (nothing to extract)"
  }

  Log "Found $($items.Count) items to copy"
  $totalItems = $items.Count
  $current = 0

  Write-Status @{ stage = "copy"; message = "Copying files..."; progress = 0 }

  foreach ($item in $items) {
    $current++
    $pct = [Math]::Round($current * 100 / $totalItems, 1)
    Write-Status @{ stage = "copy"; message = "Copying: $($item.Name)"; progress = $pct }

    $dest = Join-Path $OutputDir $item.Name
    Copy-Item -LiteralPath $item.FullName -Destination $dest -Recurse -Force -ErrorAction Stop
  }

  Write-Status @{ stage = "detach"; message = "Dismounting VHD..."; progress = 0 }
  Dismount-DiskImage -ImagePath $VhdPath -ErrorAction Stop
  $mounted = $false

  Write-Status @{ stage = "done"; message = "Done"; progress = 100 }
  exit 0
} catch {
  $err = $_.Exception.Message
  Log "ERROR: $err"
  Write-Status @{ stage = "error"; message = $err }
  if ($mounted) { try { Dismount-DiskImage -ImagePath $VhdPath -ErrorAction SilentlyContinue } catch {} }
  exit 1
}