@echo off
chcp 65001 >nul
REM Stop Buddy Account PostgreSQL (close the app window first).
cd /d "%~dp0"
node tools\local-pg\pg.mjs stop
pause
