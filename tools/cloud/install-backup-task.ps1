# ตั้งงานตามเวลาของ Windows "WTS cloud backup" — สำรองข้อมูลคลาวด์ + ทดสอบกู้คืน ทุกวัน 12:30 (README ข้อ 8 · HANDOFF ข้อ 112)
# เครื่องปิดตอน 12:30 = ทำทันทีเมื่อเปิดเครื่อง/เข้าระบบครั้งถัดไป (StartWhenAvailable) · รันซ้ำ = แทนของเดิม
# ผลล่าสุด: E:\WTS-Backup\cloud\last-run.log · ประวัติทุกครั้ง: E:\WTS-Backup\cloud\ประวัติการสำรอง.txt
$ErrorActionPreference = 'Stop'
$task = 'WTS cloud backup'
$cmd = Join-Path $PSScriptRoot 'backup-task.cmd'
if (-not (Test-Path $cmd)) { Write-Host "ไม่พบ $cmd"; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'ไม่พบ node — ติดตั้ง Node.js ก่อน'; exit 1 }
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At '12:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'Buddy tools\cloudackup.mjs: backup 4 cloud databases + restore check' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $task
$i = Get-ScheduledTaskInfo -TaskName $task
Write-Host ''
Write-Host "✓ ตั้งงาน '$task' แล้ว — ทุกวัน 12:30 (สถานะ $($t.State) · ครั้งถัดไป $($i.NextRunTime))"
Write-Host '  ผลล่าสุด: E:\WTS-Backup\cloud\last-run.log'
Write-Host '  ยกเลิก: Task Scheduler > WTS cloud backup > Delete'
