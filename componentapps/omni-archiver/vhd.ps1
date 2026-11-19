param([string]$SpecFile, [string]$StatusFile)

$ErrorActionPreference = "Stop"

try { "boot" | Set-Content -Path "$StatusFile.boot" -Encoding ASCII -Force } catch {}
try { $PSVersionTable.PSVersion.ToString() | Set-Content -Path "$StatusFile.version" -Encoding ASCII -Force } catch {}

function Write-Status($data) {
  try {
    $json = $data | ConvertTo-Json -Compress -Depth 6
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($StatusFile, $json, $utf8NoBom)
  } catch {}
}

function Log($msg) {
  $line = "$(Get-Date -Format o) $msg"
  # Идёт в stdout → перехватывается `*>` на уровне вызова → попадает в elevated.log
  try { Write-Output $line } catch {}
  # Дублируем в отдельный файл — на случай если с stdout что-то пойдёт не так
  try { $line | Add-Content -Path "$StatusFile.log" -Encoding UTF8 } catch {}
}

$spec = $null
$mounted = $false
$driveLetter = $null

try {
  Log "boot, PSVersion=$($PSVersionTable.PSVersion)"
  $spec = Get-Content -Raw -Path $SpecFile | ConvertFrom-Json
  Log "spec loaded: vhd=$($spec.vhdPath), sizeMB=$($spec.vhdSizeMb), files=$($spec.files.Count)"

  Write-Status @{ stage = "mount"; message = "Mounting VHD..."; progress = 0 }

  # Свободная буква диска
  $freeLetter = $null
  foreach ($code in 90..68) {
    $ch = [char]$code
    if (-not (Test-Path "${ch}:\" -ErrorAction SilentlyContinue)) {
      $freeLetter = $ch
      break
    }
  }
  if (-not $freeLetter) { throw "No free drive letter" }
  $driveLetter = $freeLetter
  Log "using drive letter $driveLetter"

  Mount-DiskImage -ImagePath $spec.vhdPath -ErrorAction Stop
  $mounted = $true
  Log "VHD mounted"
  Start-Sleep -Milliseconds 700

  $disk = Get-DiskImage -ImagePath $spec.vhdPath | Get-Disk
  Log "disk number=$($disk.Number), size=$($disk.Size), partitionStyle=$($disk.PartitionStyle)"

  if ($disk.PartitionStyle -eq 'RAW') {
    Initialize-Disk -Number $disk.Number -PartitionStyle MBR -Confirm:$false
    Log "disk initialized (MBR)"
    Start-Sleep -Milliseconds 500
  } else {
    Log "disk already partitioned: $($disk.PartitionStyle)"
  }

  $existingPart = Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existingPart) {
    Set-Partition -DiskNumber $disk.Number -PartitionNumber $existingPart.PartitionNumber -NewDriveLetter $driveLetter -ErrorAction Stop
    Log "assigned letter $driveLetter to existing partition $($existingPart.PartitionNumber)"
  } else {
    $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -DriveLetter $driveLetter -ErrorAction Stop
    Log "created partition $($part.PartitionNumber), letter=$driveLetter"
  }
  Start-Sleep -Milliseconds 500

  $vol = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
  if (-not $vol -or -not $vol.FileSystem -or $vol.FileSystemLabel -ne 'VHDARCHIVE') {
    Format-Volume -DriveLetter $driveLetter -FileSystem NTFS -NewFileSystemLabel 'VHDARCHIVE' -Confirm:$false -Force -ErrorAction Stop | Out-Null
    Log "volume formatted NTFS"
  } else {
    Log "volume already formatted: $($vol.FileSystem)"
  }

  for ($i = 0; $i -lt 20; $i++) {
    $vol = Get-Volume -DriveLetter $driveLetter -ErrorAction SilentlyContinue
    if ($vol -and $vol.FileSystem) { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $vol -or -not $vol.FileSystem) { throw "Volume ${driveLetter}: not ready" }
  Log "volume ready: $($vol.FileSystem) size=$($vol.Size)"

  $root = "${driveLetter}:\"

  foreach ($d in $spec.directories) {
    $full = Join-Path $root $d
    if (-not (Test-Path -LiteralPath $full)) {
      New-Item -ItemType Directory -Path $full -Force | Out-Null
    }
  }
  Log "directories created: $($spec.directories.Count)"

  $totalBytes = [int64]$spec.totalBytes
  $copied = [int64]0
  $lastReport = [DateTime]::MinValue

  Write-Status @{ stage = "copy"; message = "Copying files..."; progress = 0; current = 0; total = $totalBytes }

  foreach ($f in $spec.files) {
    $dst = Join-Path $root $f.destRelative
    $dstParent = Split-Path -Parent $dst
    if ($dstParent -and -not (Test-Path -LiteralPath $dstParent)) {
      New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $f.source -Destination $dst -Force
    try {
      (Get-Item -LiteralPath $dst).LastWriteTime = (Get-Item -LiteralPath $f.source).LastWriteTime
    } catch {}
    $copied += [int64]$f.size

    $now = [DateTime]::Now
    if (($now - $lastReport).TotalMilliseconds -gt 200 -or $copied -ge $totalBytes) {
      $pct = if ($totalBytes -gt 0) { [Math]::Round($copied * 100 / $totalBytes, 1) } else { 100 }
      Write-Status @{ stage = "copy"; message = "Copying..."; progress = $pct; current = $copied; total = $totalBytes; file = $f.destRelative }
      $lastReport = $now
    }
  }
  Log "copied $($spec.files.Count) files, $copied bytes"

  Write-Status @{ stage = "detach"; message = "Dismounting VHD..."; progress = 0 }
  Dismount-DiskImage -ImagePath $spec.vhdPath -ErrorAction Stop
  $mounted = $false
  Log "VHD dismounted"

  Write-Status @{ stage = "done"; message = "VHD ready"; progress = 100 }
  Log "done"
  exit 0
} catch {
  $errMsg = $_.Exception.Message
  Log "ERROR: $errMsg"
  Log "STACK: $($_.ScriptStackTrace)"
  Write-Status @{ stage = "error"; message = $errMsg }
  if ($mounted -and $spec) {
    try { Dismount-DiskImage -ImagePath $spec.vhdPath -ErrorAction SilentlyContinue } catch {}
  }
  exit 1
}