@echo off
chcp 65001 >nul
REM Run by BuddyAccount-Setup.exe (IExpress) from its temp folder: unzip the package, then run install.ps1
set "PKG=%TEMP%\BuddyAccountSetup"
if exist "%PKG%" rmdir /s /q "%PKG%"
mkdir "%PKG%"
REM tar (built into Windows 10+) is much faster than Expand-Archive; fall back if missing
tar -xf "%~dp0BuddyAccount.zip" -C "%PKG%" 2>nul
if errorlevel 1 powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~dp0BuddyAccount.zip' -DestinationPath '%PKG%' -Force"
if not exist "%PKG%\BuddyAccount\install.ps1" goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%PKG%\BuddyAccount\install.ps1"
if errorlevel 1 goto fail
rmdir /s /q "%PKG%"
exit /b 0
:fail
echo.
echo Setup failed. See the message above.
pause
exit /b 1
