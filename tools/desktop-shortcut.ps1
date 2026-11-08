# Creates the SAKUSURA desktop shortcut once per PC (called from start-studio.cmd).
# A marker in %LOCALAPPDATA% remembers it, so a shortcut the user deleted is not recreated.
# -Force recreates it anyway (npm run shortcut).
param([switch]$Force)
$ErrorActionPreference = 'Stop'
try {
  $root = Split-Path -Parent $PSScriptRoot
  $markerDir = Join-Path $env:LOCALAPPDATA 'SAKUSURA'
  $marker = Join-Path $markerDir 'desktop-shortcut.txt'
  # Re-run when the folder was moved, so the shortcut points to the new place.
  if (-not $Force -and (Test-Path $marker) -and ((Get-Content $marker -Raw -Encoding UTF8).Trim() -eq $root)) { exit 0 }

  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'SAKUSURA.lnk'
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $shortcut.TargetPath = Join-Path $root 'start-studio.cmd'
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = (Join-Path $root 'public\sakusura.ico') + ',0'
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Start SAKUSURA slide studio'
  $shortcut.Save()

  New-Item -ItemType Directory -Force $markerDir | Out-Null
  [IO.File]::WriteAllText($marker, $root, [Text.UTF8Encoding]::new($false))
  Write-Host "Desktop shortcut created: $lnk"
} catch {
  # The studio must still start even if the shortcut cannot be made.
  Write-Host "Could not create the desktop shortcut: $($_.Exception.Message)"
}
