# ใส่กุญแจที่เก็บไฟล์ Cloudflare R2 ของแต่ละโปรแกรมลงไฟล์ค่าตั้ง (แทนการแก้ใน Notepad) — docs/20 ข้อ 9 · tools/cloud/README.md ข้อ 5
#   powershell -ExecutionPolicy Bypass -File tools\cloud\set-r2-keys.ps1                (ค่าเริ่มต้น .data\cloud-prod.env)
#   powershell -ExecutionPolicy Bypass -File tools\cloud\set-r2-keys.ps1 -EnvFile .data\cloud-s0.env
# 1 bucket + 1 กุญแจ ต่อโปรแกรม: wts-buddy-files · wts-pos-files · wts-living-files
# Secret Access Key พิมพ์แล้วไม่ขึ้นจอ · ไม่แสดงค่าที่บันทึก · ไฟล์อยู่ใน .data\ ซึ่งไม่เข้า git · กด Enter ว่าง = ข้ามโปรแกรมนั้น (ใส่ทีหลังได้)
param(
  [string]$EnvFile = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $EnvFile) { $EnvFile = Join-Path $root '.data\cloud-prod.env' }
if (-not [System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile = Join-Path $root $EnvFile }
if (-not (Test-Path $EnvFile)) { Write-Host ('X ไม่พบ ' + $EnvFile + ' — บันทึกที่อยู่ฐานข้อมูลด้วย set-supabase-url.ps1 ก่อน') -ForegroundColor Red; exit 1 }

$enc = New-Object System.Text.UTF8Encoding $false
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($l in [System.IO.File]::ReadAllLines($EnvFile, $enc)) { $lines.Add($l) }
function Set-Line([string]$key, [string]$value) {
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match ('^\s*#?\s*' + [regex]::Escape($key) + '\s*=')) { $lines[$i] = $key + '=' + $value; return }
  }
  $lines.Add($key + '=' + $value)
}
function Read-Secret([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Write-Host ''
Write-Host 'ขั้นที่ 1: Account ID ของ Cloudflare (32 ตัว — หน้า R2 Object Storage ด้านขวา หรือหน้าสร้าง API token) แล้วกด Enter'
$acct = (Read-Host 'Account ID').Trim()
if ($acct -notmatch '^[0-9a-f]{32}$') { Write-Host 'X Account ID ต้องเป็นตัวเลข/a-f 32 ตัว — รันอีกครั้ง' -ForegroundColor Red; exit 1 }
Set-Line 'R2_ACCOUNT_ID' $acct

$apps = @(
  @{ key = 'BUDDY'; name = 'Buddy Account'; bucket = 'wts-buddy-files' },
  @{ key = 'WTSPOS'; name = 'WTS-POS'; bucket = 'wts-pos-files' },
  @{ key = 'WTSLIVING'; name = 'WTS-Living'; bucket = 'wts-living-files' }
)
$saved = @()
foreach ($a in $apps) {
  Write-Host ''
  Write-Host ('ขั้นต่อไป: ' + $a.name + ' (bucket ' + $a.bucket + ') — วาง Access Key ID แล้วกด Enter (Enter ว่าง = ข้าม)')
  $id = (Read-Host 'Access Key ID').Trim()
  if (-not $id) { Write-Host '  ข้าม' -ForegroundColor Yellow; continue }
  if ($id -notmatch '^[0-9a-f]{32}$') { Write-Host '  X Access Key ID ต้องเป็นตัวเลข/a-f 32 ตัว — ข้ามโปรแกรมนี้ (รันใหม่ได้)' -ForegroundColor Red; continue }
  $secret = (Read-Secret '  Secret Access Key (ไม่ขึ้นจอ)').Trim()
  if ($secret -notmatch '^[0-9a-f]{64}$') { Write-Host '  X Secret Access Key ต้องเป็นตัวเลข/a-f 64 ตัว — ข้ามโปรแกรมนี้ (รันใหม่ได้)' -ForegroundColor Red; $secret = $null; continue }
  Set-Line ($a.key + '_R2_BUCKET') $a.bucket
  Set-Line ($a.key + '_R2_ACCESS_KEY_ID') $id
  Set-Line ($a.key + '_R2_SECRET_ACCESS_KEY') $secret
  $secret = $null
  $saved += $a.name
}
[System.IO.File]::WriteAllLines($EnvFile, $lines, $enc)

Write-Host ''
Write-Host ('บันทึกแล้วที่ ' + $EnvFile + ' (ไม่แสดงค่า) — ' + ($(if ($saved.Count) { $saved -join ', ' } else { 'ยังไม่มีโปรแกรมใด' }))) -ForegroundColor Green
Write-Host 'ขั้นต่อไป: แจ้ง Claude ว่า "บันทึกกุญแจ R2 แล้ว"'
