@echo off
REM Orbit — daily discovery run (invoked by Task Scheduler).
cd /d "%~dp0.."
if not exist "runner\out" mkdir "runner\out"
call npm run runner >> "runner\out\cron.log" 2>&1
