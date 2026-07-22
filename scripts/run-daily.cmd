@echo off
REM Orbit - daily scout run (invoked by Task Scheduler).
REM This runs CLAUDE CODE headless as the scout: it web-searches for new events
REM and curates them as Sam, then ingests. No model API key is involved.
REM Requires the `claude` CLI on PATH and signed in.
cd /d "%~dp0.."
if not exist "runner\out" mkdir "runner\out"
claude -p "Act as Orbit's scout. Follow the runbook in runner/SCOUT.md to do ONE run: run `npm run context`, web-search for new in-person networking events for Sam (skipping ones already known), curate each as him, write runner/scout-events.json, then run `npm run ingest -- runner/scout-events.json`." --dangerously-skip-permissions >> "runner\out\cron.log" 2>&1
