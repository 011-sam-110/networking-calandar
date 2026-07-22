<#
  Registers the Orbit local runner with Windows Task Scheduler:
    - "Orbit Daily Discovery"  -> daily at 07:00
    - "Orbit Boot Catch-up"    -> at logon (covers days the laptop was off)

  Run from anywhere:
    powershell -ExecutionPolicy Bypass -File scripts/register-tasks.ps1

  Requires Node/npm on PATH. Re-running updates the tasks (-Force).
#>
$ErrorActionPreference = 'Stop'

$daily   = Join-Path $PSScriptRoot 'run-daily.cmd'
$catchup = Join-Path $PSScriptRoot 'run-catchup.cmd'

if (-not (Test-Path $daily) -or -not (Test-Path $catchup)) {
    throw "Runner .cmd scripts not found next to this script."
}

$dailyAction  = New-ScheduledTaskAction -Execute $daily
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At 7am
Register-ScheduledTask -TaskName 'Orbit Daily Discovery' `
    -Action $dailyAction -Trigger $dailyTrigger `
    -Description 'Orbit: daily networking-event discovery + digest email' -Force | Out-Null

$catchAction  = New-ScheduledTaskAction -Execute $catchup
$catchTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'Orbit Boot Catch-up' `
    -Action $catchAction -Trigger $catchTrigger `
    -Description 'Orbit: catch-up run at logon in case the laptop was off for a few days' -Force | Out-Null

Write-Host 'Registered:'
Write-Host '  - "Orbit Daily Discovery"  (daily 07:00)'
Write-Host '  - "Orbit Boot Catch-up"    (at logon)'
Write-Host 'Logs -> runner\out\cron.log. Manage in Task Scheduler, or:  Unregister-ScheduledTask -TaskName "Orbit Daily Discovery"'
