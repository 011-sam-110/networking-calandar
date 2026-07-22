@echo off
REM Orbit - catch-up scout run at logon (backfills any days the laptop was off).
REM Runs CLAUDE CODE headless as the scout, then ingests with --catchup.
REM Requires the `claude` CLI on PATH and signed in.
cd /d "%~dp0.."
if not exist "runner\out" mkdir "runner\out"
claude -p "Act as Orbit's scout for a CATCH-UP run (the laptop may have been off for a few days). Follow runner/SCOUT.md: run `npm run context`, web-search for new in-person networking events for Sam (skipping known ones), curate each as him, write runner/scout-events.json, then run `npm run ingest -- runner/scout-events.json --catchup`." --dangerously-skip-permissions >> "runner\out\cron.log" 2>&1
