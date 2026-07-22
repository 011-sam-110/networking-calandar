@echo off
REM Orbit - catch-up scout run at logon (backfills any days the laptop was off).
REM Runs CLAUDE CODE headless as the scout against the LIVE Neon database.
REM
REM Permissions are SCOPED (not --dangerously-skip-permissions): the unattended
REM run may only search the web, read/write files, and run the two ingest
REM commands. Anything else is denied rather than silently approved.
REM
REM Requires the `claude` CLI on PATH and signed in.
cd /d "%~dp0.."
if not exist "runner\out" mkdir "runner\out"
echo [%date% %time%] --- catch-up scout start --- >> "runner\out\cron.log"
claude -p "Act as Orbit's scout for a CATCH-UP run (the laptop may have been off for a few days). Follow runner/SCOUT.md against the LIVE database: run `npm run context:live`, web-search for new in-person networking events for Sam (skipping known ones), curate each as him, write runner/scout-events.json, then run `npm run ingest:live -- runner/scout-events.json --catchup`." --allowedTools "Read,Write,WebSearch,WebFetch,Bash(npm run context:live),Bash(npm run ingest:live:*)" >> "runner\out\cron.log" 2>&1
echo [%date% %time%] --- catch-up scout end (exit %errorlevel%) --- >> "runner\out\cron.log"
