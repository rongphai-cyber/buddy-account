@echo off
chcp 65001 >nul
REM Back up the 4 cloud databases now + test the restore (tools\cloud\backup.mjs, README section 8). Files: E:\WTS-Backup\cloud
cd /d "%~dp0"
node tools\cloud\backup.mjs
pause
