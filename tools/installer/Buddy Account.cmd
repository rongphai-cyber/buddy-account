@echo off
chcp 65001 >nul
title Buddy Account
REM Start Buddy Account: database + app, then open the browser. Closing this window stops the app.
cd /d "%~dp0"
"%~dp0node\node.exe" "%~dp0app\launcher.mjs" start
if errorlevel 1 pause
