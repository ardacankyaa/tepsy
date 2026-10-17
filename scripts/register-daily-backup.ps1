param([string]$At = '03:00')
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = (Get-Command py -ErrorAction Stop).Source
$script = Join-Path $projectRoot 'scripts\sqlite-backup.py'
Push-Location -LiteralPath $projectRoot
try {
  $runtimeJson = & node (Join-Path $PSScriptRoot 'runtime-config.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Invalid TEPSY runtime configuration.' }
  $database = ($runtimeJson | ConvertFrom-Json).databasePath
} finally { Pop-Location }
$destination = Join-Path $projectRoot '.tepsy\backups'
$taskName = 'TEPSY-Daily-Backup'

if (Get-ScheduledTask -TaskName 'RestoPOS-Daily-Backup' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'RestoPOS-Daily-Backup' -Confirm:$false -ErrorAction SilentlyContinue
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Write-Output 'An existing daily backup schedule is already configured.'
  exit 0
}

$arguments = '"{0}" --source "{1}" --dest-dir "{2}" --keep 30' -f $script, $database, $destination
$action = New-ScheduledTaskAction -Execute $python -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Description 'Daily verified SQLite backup for TEPSY' | Out-Null
Write-Output "Registered $taskName for $At"
