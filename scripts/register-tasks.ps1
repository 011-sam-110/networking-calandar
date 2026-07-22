<#
  Registers the Orbit scout with Windows Task Scheduler.

  By default this registers ONLY the daily run:
    - "Orbit Daily Discovery"  -> daily at 07:00

  Pass -IncludeCatchup to also register the logon-triggered catch-up:
    - "Orbit Boot Catch-up"    -> at logon (backfills days the laptop was off)

  Note: the daily run already backfills gaps on its own, because each scout run
  re-scans the whole upcoming horizon. The logon trigger only makes the catch-up
  happen sooner (at boot) rather than at the next 07:00.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/register-tasks.ps1
    powershell -ExecutionPolicy Bypass -File scripts/register-tasks.ps1 -IncludeCatchup

  Each run invokes Claude Code headless with a SCOPED tool allowlist (web search,
  read/write, and the two ingest commands only) and writes to the live Neon DB.
  Requires Node and the `claude` CLI on PATH. Re-running updates the tasks (-Force).

  To remove:  Unregister-ScheduledTask -TaskName "Orbit Daily Discovery" -Confirm:$false
#>
param([switch]$IncludeCatchup)

$ErrorActionPreference = 'Stop'

$daily   = Join-Path $PSScriptRoot 'run-daily.cmd'
$catchup = Join-Path $PSScriptRoot 'run-catchup.cmd'

if (-not (Test-Path $daily)) { throw "run-daily.cmd not found next to this script." }

$dailyAction  = New-ScheduledTaskAction -Execute $daily
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At 7am
Register-ScheduledTask -TaskName 'Orbit Daily Discovery' `
    -Action $dailyAction -Trigger $dailyTrigger `
    -Description 'Orbit: daily networking-event scout (Claude Code, scoped permissions) + digest' -Force | Out-Null
Write-Host 'Registered: "Orbit Daily Discovery" (daily 07:00)'

if ($IncludeCatchup) {
    if (-not (Test-Path $catchup)) { throw "run-catchup.cmd not found next to this script." }
    $catchAction  = New-ScheduledTaskAction -Execute $catchup
    $catchTrigger = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName 'Orbit Boot Catch-up' `
        -Action $catchAction -Trigger $catchTrigger `
        -Description 'Orbit: catch-up scout run at logon' -Force | Out-Null
    Write-Host 'Registered: "Orbit Boot Catch-up" (at logon)'
} else {
    Write-Host 'Skipped the logon catch-up task (pass -IncludeCatchup to add it).'
    Write-Host 'You can still run a catch-up by hand: scripts\run-catchup.cmd'
}

Write-Host 'Logs -> runner\out\cron.log'
