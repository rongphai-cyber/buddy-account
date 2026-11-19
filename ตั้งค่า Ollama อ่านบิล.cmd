@echo off
REM Buddy Account: let the cloud page https://app.worktruesolution.net use Ollama on this computer to read bills
REM saves OLLAMA_ORIGINS for this Windows user, restarts Ollama, then checks the connection
REM run with the word check after the file name to only check (no restart)
setlocal
set "ORIGIN=https://app.worktruesolution.net"
set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
set "MAXTRY=30"
if /i "%~1"=="check" (
  set "MAXTRY=1"
  goto check
)
if not exist "%OLLAMA_EXE%" (
  echo Ollama is not installed on this computer. Install it from https://ollama.com first.
  goto end
)
echo [1/3] Saving setting OLLAMA_ORIGINS=%ORIGIN%
setx OLLAMA_ORIGINS "%ORIGIN%" >nul
set "OLLAMA_ORIGINS=%ORIGIN%"
echo [2/3] Restarting Ollama ...
taskkill /F /IM "ollama app.exe" >nul 2>&1
taskkill /F /IM "ollama.exe" >nul 2>&1
ping -n 3 127.0.0.1 >nul
start "" "%OLLAMA_EXE%"
:check
echo [3/3] Checking connection ...
set /a TRY=0
:wait
set /a TRY+=1
set "CODE=000"
for /f %%c in ('curl -s -m 2 -o nul -w "%%{http_code}" -H "Origin: %ORIGIN%" http://127.0.0.1:11434/api/tags') do set "CODE=%%c"
if "%CODE%"=="200" goto ok
if %TRY% geq %MAXTRY% goto fail
ping -n 2 127.0.0.1 >nul
goto wait
:ok
curl -s -m 5 http://127.0.0.1:11434/api/tags | findstr /c:"typhoon-ocr1.5-3b" >nul
if errorlevel 1 (
  echo.
  echo Ollama is ready, but the bill reading model is missing.
  echo Open PowerShell and type:  ollama pull scb10x/typhoon-ocr1.5-3b
  goto end
)
echo.
echo ==================================================
echo  OK - Ollama on this computer is ready for Buddy.
echo  Go back to https://app.worktruesolution.net/settings/ai
echo  and press the check connection button again.
echo ==================================================
goto end
:fail
echo.
if "%CODE%"=="403" (
  echo FAILED - Ollama refused the Buddy page, code 403.
  echo Right-click the Ollama icon at the bottom right, choose Quit Ollama, then run this again.
) else (
  echo FAILED - Ollama did not answer, code %CODE%.
  echo Open Ollama from the Start menu, wait 10 seconds, then run this again.
)
:end
echo.
pause
