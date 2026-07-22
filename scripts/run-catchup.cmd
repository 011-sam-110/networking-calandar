@echo off
REM Orbit — catch-up run at logon (backfills any days the laptop was off).
cd /d "%~dp0.."
if not exist "runner\out" mkdir "runner\out"
call npm run runner:catchup >> "runner\out\cron.log" 2>&1
