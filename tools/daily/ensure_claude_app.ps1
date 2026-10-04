# 03:00 에 클로드 데스크톱 앱을 "다시" 띄운다 (껐다 켠다).
# 왜: 앱 안의 예약작업(daily-celeb-drafts 03:41)이 2026-10-01·10-02 이틀 연속 **앱이 켜져 있는데도** 안 떴다.
#     nextRunAt 만 매일 뒤로 밀렸고 lastRunAt 은 9/30 그대로. 같은 프로세스(pid 10976)가 며칠째 떠 있었다.
#     → 오래 떠 있는 인스턴스에서 스케줄러가 더 이상 발동하지 않는 것으로 보고, 매일 새 프로세스로 바꾼다.
# 주의: 앱을 닫으면 열려 있던 대화 세션도 닫힌다. 그래서 사람이 안 쓰는 새벽 3시에만 돈다.
$ErrorActionPreference = 'SilentlyContinue'
$log = Join-Path $PSScriptRoot 'logs\ensure_claude_app.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$AUMID = 'Claude_pzs8sxrjxfjjc!Claude'

function Get-ClaudeApp { Get-Process -Name claude | Where-Object { $_.Path -like '*\WindowsApps\Claude_*' } }

$before = Get-ClaudeApp
if ($before) {
  Add-Content -Path $log -Value "$stamp 켜져 있음 (pid $($before[0].Id)) → 껐다 켠다" -Encoding utf8
  foreach ($p in $before) { $p.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 12
  foreach ($p in (Get-ClaudeApp)) { Stop-Process -Id $p.Id -Force }
  Start-Sleep -Seconds 8
} else {
  Add-Content -Path $log -Value "$stamp 꺼져 있음 → 띄운다" -Encoding utf8
}

Start-Process 'explorer.exe' -ArgumentList "shell:AppsFolder\$AUMID"
Start-Sleep -Seconds 60
$after = Get-ClaudeApp
if ($after) {
  Add-Content -Path $log -Value "$stamp 새로 띄움 (pid $($after[0].Id))" -Encoding utf8
  exit 0
} else {
  Add-Content -Path $log -Value "$stamp 띄우기 실패 — Get-StartApps 로 AppID 확인 필요" -Encoding utf8
  exit 1
}
