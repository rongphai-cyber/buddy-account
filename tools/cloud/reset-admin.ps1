# ตั้งรหัสผ่านใหม่ให้ผู้ดูแลระบบของ Buddy บนคลาวด์ (ลืมรหัสผ่าน / มือถือยืนยันตัวตนหาย) — เจ้าของรันที่เครื่องสำนักงาน
#   powershell -ExecutionPolicy Bypass -File tools\cloud\reset-admin.ps1
# อ่านที่อยู่ฐานจาก .data\cloud-prod.env · รหัสผ่านพิมพ์แล้วไม่ขึ้นจอ ไม่อยู่ในประวัติคำสั่ง · ตั้งรหัสใหม่ + ปลดล็อก + (เลือกได้) ล้างยืนยันตัวตนสองขั้น
# ใช้กับเครื่องสำนักงาน (localhost:4100) ไม่ได้ — ที่นั่นใช้ pnpm --filter @buddy/server cli ตามเดิม
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envFile = Join-Path $root '.data\cloud-prod.env'
if (-not (Test-Path $envFile)) { Write-Host 'X ไม่พบ .data\cloud-prod.env' -ForegroundColor Red; exit 1 }
$line = Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*SUPABASE_PROJECT_URL\s*=' } | Select-Object -First 1
if (-not $line) { Write-Host 'X ไม่พบ SUPABASE_PROJECT_URL ใน .data\cloud-prod.env' -ForegroundColor Red; exit 1 }
$project = ($line -replace '^\s*SUPABASE_PROJECT_URL\s*=\s*', '').Trim()
$db = $project -replace '/postgres(\?|$)', '/buddy$1'

function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Write-Host ''
Write-Host 'ตั้งรหัสผ่านใหม่ให้ผู้ดูแลระบบของ Buddy บนคลาวด์'
$user = (Read-Host 'รหัสผู้ใช้ (Enter = admin)').Trim()
if (-not $user) { $user = 'admin' }
$pw = Read-Secret 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข — ไม่ขึ้นจอ)'
$pw2 = Read-Secret 'พิมพ์รหัสผ่านใหม่อีกครั้ง'
if ($pw -ne $pw2) { Write-Host 'X รหัสผ่านสองครั้งไม่ตรงกัน — รันใหม่' -ForegroundColor Red; exit 1 }
$pw2 = $null
$twofa = (Read-Host 'ล้างยืนยันตัวตนสองขั้นด้วยไหม (เฉพาะกรณีมือถือหาย/ไม่มีรหัสสำรอง) พิมพ์ y = ล้าง, Enter = ไม่ล้าง').Trim()

$env:DATABASE_URL = $db
$env:BUDDY_NEW_PASSWORD = $pw
$pw = $null
Push-Location (Join-Path $root 'apps\server')
try {
  & node node_modules/tsx/dist/cli.mjs src/cli.ts create-admin $user 'ผู้ดูแลระบบ' '-'
  if ($LASTEXITCODE -ne 0) { throw 'ตั้งรหัสผ่านไม่สำเร็จ (ดูข้อความด้านบน)' }
  & node node_modules/tsx/dist/cli.mjs src/cli.ts unlock $user | Out-Null
  if ($twofa -eq 'y' -or $twofa -eq 'Y') {
    & node node_modules/tsx/dist/cli.mjs src/cli.ts reset-2fa $user
    Write-Host 'ล้างยืนยันตัวตนสองขั้นแล้ว — เข้าระบบครั้งถัดไปจะให้ตั้งใหม่' -ForegroundColor Yellow
  }
  Write-Host ''
  Write-Host ('เสร็จ — เข้า https://wts-buddy.rongphai.workers.dev ด้วยรหัสผู้ใช้ ' + $user + ' และรหัสผ่านใหม่') -ForegroundColor Green
} catch {
  Write-Host ('X ' + $_) -ForegroundColor Red
  exit 1
} finally {
  Remove-Item Env:BUDDY_NEW_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}
