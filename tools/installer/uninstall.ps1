# ถอนการติดตั้ง Buddy Account — ลบโปรแกรมและไอคอน แต่ "เก็บข้อมูลไว้" ที่ %LOCALAPPDATA%\BuddyAccount
#   ใช้: powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Quiet]
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = if ($env:BUDDY_HOME) { $env:BUDDY_HOME } else { Join-Path $env:LOCALAPPDATA 'BuddyAccount' }
if (-not $Quiet) {
  Add-Type -AssemblyName System.Windows.Forms
  $a = [System.Windows.Forms.MessageBox]::Show("ถอนการติดตั้ง Buddy Account?`n`nข้อมูลบัญชียังเก็บไว้ที่`n$data`n(ติดตั้งใหม่แล้วใช้ต่อได้ทันที — ถ้าไม่ต้องการแล้วค่อยลบโฟลเดอร์นี้เอง)", 'Buddy Account', 'OKCancel', 'Question')
  if ($a -ne 'OK') { exit 1 }
}
$node = Join-Path $dir 'node\node.exe'
if (Test-Path $node) { & $node (Join-Path $dir 'app\launcher.mjs') stop | Out-Host }
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Buddy Account'
Remove-Item -Recurse -Force $menu -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Buddy Account.lnk') -ErrorAction SilentlyContinue
Remove-Item -Force 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BuddyAccount' -ErrorAction SilentlyContinue
# ลบโฟลเดอร์โปรแกรมหลังสคริปต์นี้จบ (สคริปต์อยู่ในโฟลเดอร์นั้นเอง)
Start-Process -FilePath 'cmd.exe' -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dir`"" -WindowStyle Hidden
if (-not $Quiet) { [System.Windows.Forms.MessageBox]::Show("ถอนการติดตั้งแล้ว`nข้อมูลยังอยู่ที่ $data", 'Buddy Account') | Out-Null }
