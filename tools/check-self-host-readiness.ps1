# Read-only Windows readiness check for a self-hosted KK Sales Portal.
# Compatible with Windows PowerShell 5.1. No installs or configuration writes.
$ErrorActionPreference = 'Stop'

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$systemDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"

$pgServices = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue |
  Select-Object Name, Status, StartType)

$pgReady = $null
$pgRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
if (Test-Path -LiteralPath $pgRoot) {
  $bins = @(Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'bin\pg_isready.exe' } |
    Where-Object { Test-Path -LiteralPath $_ })
  if ($bins.Count -gt 0) {
    $pgReady = $bins[0]
  }
}
if (-not $pgReady) {
  $cmd = Get-Command pg_isready.exe -ErrorAction SilentlyContinue
  if ($cmd) { $pgReady = $cmd.Source }
}

$databaseReady = 'not_checked'
if ($pgReady) {
  # Only queries the localhost listener; does not authenticate or change data.
  & $pgReady -h 127.0.0.1 -p 5432 -t 2 | Out-Null
  $databaseReady = if ($LASTEXITCODE -eq 0) { 'accepting_connections' } else { 'not_ready_on_5432' }
}

$cloudflared = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$git = Get-Command git.exe -ErrorAction SilentlyContinue

$report = [ordered]@{
  purpose = 'KK self-hosted server readiness - read only'
  production_unchanged = $true
  generated_at = (Get-Date).ToString('o')
  windows = $os.Caption
  windows_version = $os.Version
  physical_memory_gib = [math]::Round($computer.TotalPhysicalMemory / 1GB, 2)
  system_disk_free_gib = if ($systemDisk) { [math]::Round($systemDisk.FreeSpace / 1GB, 2) } else { $null }
  postgres_service = @($pgServices | ForEach-Object {
    [ordered]@{ name = $_.Name; status = [string]$_.Status; start_type = [string]$_.StartType }
  })
  postgres_local_status = $databaseReady
  node_installed = [bool]$node
  cloudflared_installed = [bool]$cloudflared
  git_installed = [bool]$git
  next_step = 'Review this report; do not expose PostgreSQL port 5432 to the Internet.'
}
$report | ConvertTo-Json -Depth 5
