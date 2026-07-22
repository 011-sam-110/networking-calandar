@echo off
REM Orbit - daily scout run (invoked by Task Scheduler).
REM Runs CLAUDE CODE headless as the scout: it web-searches for new events and
REM curates them as Sam, then ingests. No model API key is involved.
REM
REM Permissions are SCOPED (not --dangerously-skip-permissions): the unattended
REM run may only search the web, read/write files, and run the two ingest
REM commands. Anything else is denied rather than silently approved.
REM
REM The :live scripts target the deployed Neon database (see .env.scout), so
REM finds land on the live site. Requires the `claude` CLI on PATH and signed in.
cd /d "%~dp0.."
if not exist "runner\out" mkdir "runner\out"
echo [%date% %time%] --- daily scout start --- >> "runner\out\cron.log"
claude -p "Act as Orbit's scout. Follow the runbook in runner/SCOUT.md to do ONE run against the LIVE database: run `npm run context:live`, web-search for new in-person networking events for Sam (skipping ones already known), curate each as him, write runner/scout-events.json, then run `npm run ingest:live -- runner/scout-events.json`." --allowedTools "Read,Write,WebSearch,WebFetch,Bash(npm run context:live),Bash(npm run ingest:live:*)" >> "runner\out\cron.log" 2>&1
echo [%date% %time%] --- daily scout end (exit %errorlevel%) --- >> "runner\out\cron.log"
