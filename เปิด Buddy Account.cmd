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
REM open the browser only when Buddy answers (the database may take longer than a fixed wait on the first start of the day)
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4100/api/v1/health -TimeoutSec 2 | Out-Null; break}catch{Start-Sleep -Seconds 1}}; Start-Process http://localhost:4100"
REM https addresses (tools\tunnel\README.md): buddy.worktruesolution.net = API for WTS-SOP, buddyapp.worktruesolution.net = whole program (Cloudflare Access)
REM only when .data\cloudflared\config.yml exists; close its window = stop
if exist ".data\cloudflared\config.yml" start "Buddy https" /min cloudflared tunnel --no-autoupdate --config ".data\cloudflared\config.yml" run
node tools\local-pg\pg.mjs run -- "apps\server\node_modules\.bin\tsx.CMD" apps\server\src\main.ts
pause
