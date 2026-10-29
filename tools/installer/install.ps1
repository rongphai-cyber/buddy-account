# ติดตั้ง Buddy Account บน Windows (T7.4) — ติดตั้งเฉพาะผู้ใช้นี้ ไม่ต้องใช้สิทธิ์ผู้ดูแลเครื่อง
#   โปรแกรม: %LOCALAPPDATA%\Programs\BuddyAccount   ข้อมูล: %LOCALAPPDATA%\BuddyAccount (ไม่ถูกลบตอนอัปเดต/ถอนการติดตั้ง)
#   ใช้: powershell -ExecutionPolicy Bypass -File install.ps1 [-InstallDir <โฟลเดอร์>] [-NoShortcuts] [-NoRegistry] [-NoStart]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\BuddyAccount'),
  [switch]$NoShortcuts,
  [switch]$NoRegistry,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$ver = (Get-Content (Join-Path $src 'app\version.json') -Raw | ConvertFrom-Json).version
Write-Host "กำลังติดตั้ง Buddy Account $ver ไปที่ $InstallDir"

# อัปเดตทับรุ่นเดิม: ปิดโปรแกรมที่เปิดอยู่ก่อน
$oldNode = Join-Path $InstallDir 'node\node.exe'
if (Test-Path $oldNode) {
  Write-Host 'พบรุ่นเดิม — ปิดโปรแกรมก่อนอัปเดต'
  & $oldNode (Join-Path $InstallDir 'app\launcher.mjs') stop | Out-Host
}

New-Item -ItemType Directory -Force $InstallDir | Out-Null
# คัดลอกแบบเหมือนต้นฉบับ (ลบไฟล์รุ่นเก่าที่ไม่มีแล้ว) — ข้อมูลไม่อยู่ในโฟลเดอร์นี้
robocopy $src $InstallDir /MIR /NFL /NDL /NJH /NJS /NP /XF setup.cmd | Out-Null
if ($LASTEXITCODE -ge 8) { throw "คัดลอกไฟล์ไม่สำเร็จ (robocopy $LASTEXITCODE)" }

$start = Join-Path $InstallDir 'Buddy Account.cmd'
$stop = Join-Path $InstallDir 'Stop Buddy Account.cmd'
$icon = Join-Path $InstallDir 'app\buddy.ico'
if (-not $NoShortcuts) {
  $sh = New-Object -ComObject WScript.Shell
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Buddy Account'
  New-Item -ItemType Directory -Force $menu | Out-Null
  function Link($path, $target, $arguments, $desc, $style) {
    $l = $sh.CreateShortcut($path); $l.TargetPath = $target; $l.Arguments = $arguments; $l.WorkingDirectory = $InstallDir
    $l.Description = $desc; $l.WindowStyle = $style; if (Test-Path $icon) { $l.IconLocation = $icon }; $l.Save()
  }
  Link (Join-Path $menu 'Buddy Account.lnk') $start '' 'เปิดโปรแกรมบัญชี Buddy Account' 7
  Link (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Buddy Account.lnk') $start '' 'เปิดโปรแกรมบัญชี Buddy Account' 7
  Link (Join-Path $menu 'ปิด Buddy Account.lnk') $stop '' 'ปิดโปรแกรมและฐานข้อมูล' 7
  Link (Join-Path $menu 'โฟลเดอร์ข้อมูล Buddy Account.lnk') 'explorer.exe' "`"$(Join-Path $env:LOCALAPPDATA 'BuddyAccount')`"" 'ที่เก็บข้อมูลและบันทึกการทำงาน' 1
  Link (Join-Path $menu 'ถอนการติดตั้ง Buddy Account.lnk') 'powershell.exe' "-ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`"" 'ถอนการติดตั้ง (ข้อมูลยังเก็บไว้)' 1
}
if (-not $NoRegistry) {
  # แสดงใน "แอปและฟีเจอร์" ของ Windows (เฉพาะผู้ใช้นี้)
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BuddyAccount'
  New-Item -Force $k | Out-Null
  $size = [int]((Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
  $vals = @{ DisplayName = 'Buddy Account'; DisplayVersion = $ver; Publisher = 'Buddy Account'; InstallLocation = $InstallDir; DisplayIcon = $icon
    UninstallString = "powershell.exe -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`""; NoModify = 1; NoRepair = 1; EstimatedSize = $size }
  foreach ($n in $vals.Keys) { Set-ItemProperty $k -Name $n -Value $vals[$n] }
}
Write-Host "ติดตั้งเสร็จแล้ว — เปิดโปรแกรมจากไอคอน Buddy Account บนหน้าจอหรือเมนู Start"
if (-not $NoStart) { Start-Process -FilePath $start -WorkingDirectory $InstallDir -WindowStyle Minimized }
