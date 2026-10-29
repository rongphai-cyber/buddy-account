@echo off
chcp 65001 >nul
REM Buddy Account: start Buddy PostgreSQL (port 5544, folder .data\pg) then the app at http://localhost:4100
REM Close this window = stop the app. Database keeps running; stop it with the second .cmd file.
cd /d "%~dp0"
if not exist "apps\web\dist\index.html" (
  pushd apps\web
  call "node_modules\.bin\vite.CMD" build
  popd
)
start "" cmd /c "timeout /t 8 >nul & start http://localhost:4100"
node tools\local-pg\pg.mjs run -- "apps\server\node_modules\.bin\tsx.CMD" apps\server\src\main.ts
pause
