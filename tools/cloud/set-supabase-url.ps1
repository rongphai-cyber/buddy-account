# ใส่ที่อยู่ฐานข้อมูล Supabase ลงไฟล์ค่าตั้ง .data\cloud-s0.env ให้ (แทนการแก้ใน Notepad) — docs/20 S0 · tools/cloud/README.md
#   powershell -ExecutionPolicy Bypass -File tools\cloud\set-supabase-url.ps1
# รหัสผ่านพิมพ์แล้วไม่ขึ้นจอ · ไม่แสดงค่าที่บันทึก · ไฟล์อยู่ใน .data\ ซึ่งไม่เข้า git
# ใบรับรอง .data\supabase-ca.crt มี = ตรวจตัวตนเซิร์ฟเวอร์ (verify-full) · ไม่มี = sslmode=no-verify (ทดสอบเท่านั้น)
param(
  [string]$EnvFile = '',
  [string]$Uri = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $EnvFile) { $EnvFile = Join-Path $root '.data\cloud-s0.env' }
$ca = Join-Path $root '.data\supabase-ca.crt'

if (-not (Test-Path $EnvFile)) {
  New-Item -ItemType Directory -Force (Split-Path -Parent $EnvFile) | Out-Null
  Copy-Item (Join-Path $PSScriptRoot 'cloud-s0.env.example') $EnvFile
}

if (-not $Uri) {
  Write-Host ''
  Write-Host 'ขั้นที่ 1: ที่ Supabase กดปุ่ม Connect > Session pooler > คัดลอกบรรทัดที่ขึ้นต้นด้วย postgresql://postgres.'
  Write-Host '         แล้ววางที่นี่ (คลิกขวาในหน้าต่างนี้ = วาง) แล้วกด Enter'
  $Uri = Read-Host 'ที่อยู่'
}
$Uri = $Uri.Trim().Trim('"').Trim("'")
$q = $Uri.IndexOf('?')
if ($q -ge 0) { $Uri = $Uri.Substring(0, $q) }
if ($Uri -notmatch '^postgres(ql)?://[^:/@]+:.+@[^/@]+/postgres$') {
  Write-Host ''
  Write-Host 'X ที่อยู่ไม่ถูกแบบ: ต้องขึ้นต้นด้วย postgresql:// และลงท้ายด้วย /postgres — คัดลอกจาก Connect > Session pooler ใหม่ แล้วรันอีกครั้ง' -ForegroundColor Red
  exit 1
}

if ($Uri.Contains('[YOUR-PASSWORD]')) {
  Write-Host ''
  Write-Host 'ขั้นที่ 2: พิมพ์ (หรือวาง) รหัสผ่านฐานข้อมูลที่ตั้งตอนสร้างโปรเจกต์ — ตัวอักษรจะไม่ขึ้นจอ แล้วกด Enter'
  $sec = Read-Host 'รหัสผ่าน' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $pw) { Write-Host 'X ไม่ได้ใส่รหัสผ่าน — รันอีกครั้ง' -ForegroundColor Red; exit 1 }
  if ($pw -match '[@:/?#%\[\]\s"]') {
    Write-Host 'X รหัสผ่านมีอักขระพิเศษ (@ : / ? # % [ ] เว้นวรรค) — ที่ Supabase: Database > Settings > Reset password ตั้งใหม่เป็นตัวอักษร+ตัวเลข แล้วรันอีกครั้ง' -ForegroundColor Red
    exit 1
  }
  $Uri = $Uri.Replace('[YOUR-PASSWORD]', $pw)
  $pw = $null
}

if (Test-Path $ca) {
  $Uri = $Uri + '?sslmode=verify-full&sslrootcert=' + ($ca -replace '\\', '/')
  $sslNote = 'ตรวจตัวตนเซิร์ฟเวอร์ด้วยใบรับรอง .data\supabase-ca.crt'
} else {
  $Uri = $Uri + '?sslmode=no-verify'
  $sslNote = 'ไม่มีใบรับรอง .data\supabase-ca.crt — เข้ารหัสแต่ไม่ตรวจตัวตนเซิร์ฟเวอร์ (ทดสอบเท่านั้น)'
}

$enc = New-Object System.Text.UTF8Encoding $false
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($l in [System.IO.File]::ReadAllLines($EnvFile, $enc)) { $lines.Add($l) }
$done = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*SUPABASE_PROJECT_URL\s*=') { $lines[$i] = 'SUPABASE_PROJECT_URL=' + $Uri; $done = $true; break }
}
if (-not $done) { $lines.Add('SUPABASE_PROJECT_URL=' + $Uri) }
# แบบ 1 โปรเจกต์ต่อโปรแกรม ใช้พร้อมกันไม่ได้ — ปิดบรรทัดเหล่านั้นไว้ถ้ามี
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\s*(BUDDY|WTSPOS|WTSLIVING)_DATABASE_URL\s*=') { $lines[$i] = '#' + $lines[$i] }
}
[System.IO.File]::WriteAllLines($EnvFile, $lines, $enc)
$Uri = $null

Write-Host ''
Write-Host ('บันทึกแล้วที่ ' + $EnvFile + ' (ไม่แสดงค่า)') -ForegroundColor Green
Write-Host ('SSL: ' + $sslNote)
Write-Host ''
Write-Host 'ขั้นต่อไป รันคำสั่งนี้:'
Write-Host '  node tools\cloud\pg-check.mjs --i-created-this-test-project'
