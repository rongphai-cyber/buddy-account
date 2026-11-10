@echo off
chcp 65001 >nul
REM Daily cloud backup + restore check (tools\cloud\backup.mjs) - started by the Windows scheduled task "WTS cloud backup"
REM set up / refresh the task: double-click the second launcher in E:\BuddyAccount (README section 8)
cd /d "%~dp0..\.."
if not exist "E:\WTS-Backup\cloud" mkdir "E:\WTS-Backup\cloud"
node tools\cloud\backup.mjs > "E:\WTS-Backup\cloud\last-run.log" 2>&1
