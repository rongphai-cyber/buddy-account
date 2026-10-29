@echo off
chcp 65001 >nul
REM Stop Buddy Account app and database
cd /d "%~dp0"
"%~dp0node\node.exe" "%~dp0app\launcher.mjs" stop
timeout /t 3 >nul
