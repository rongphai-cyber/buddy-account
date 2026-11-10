@echo off
chcp 65001 >nul
REM Create or refresh the Windows scheduled task "WTS cloud backup": every day 12:30 (runs later if the PC was off)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\cloud\install-backup-task.ps1"
pause
