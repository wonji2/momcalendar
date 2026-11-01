# 오늘 원고가 제대로 만들어졌는지 확인하고, 안 됐으면 눈에 띄게 알린다.
# 왜: 원고를 쓰는 단계만 클로드 앱 안의 예약작업이라 (1) 앱이 꺼져 있으면 아예 안 뜨고
#     (2) 떠도 승인 창에서 멈추면 몇 시간씩 아무것도 안 나온다. 2026-09-30 에 둘 다 겪었다.
#     발행(윈도우 예약작업)은 멀쩡해도 올릴 원고가 없으면 하루가 통째로 빈다.
$ErrorActionPreference = 'SilentlyContinue'
$day = Get-Date -Format 'yyyy-MM-dd'
$draft = Join-Path $env:USERPROFILE "Desktop\블로그원고\$day"
$pub   = Join-Path $env:USERPROFILE "Desktop\블로그\$day"
$log   = Join-Path $PSScriptRoot 'logs\njob_draft_watchdog.log'
$alert = Join-Path $env:USERPROFILE 'Desktop\★오늘_원고가_비었어요.txt'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

$n = 0
if (Test-Path $draft) { $n = @(Get-ChildItem $draft -Filter '*.txt' | Where-Object { $_.Name -match '^\d\d_' }).Count }
$p = 0
if (Test-Path $pub) { $p = @(Get-ChildItem $pub -Directory).Count }
$need = 8

if ($n -ge $need) {
  Add-Content -Path $log -Value "$stamp 정상 — 원고 $n 편 / 발행폴더 $p 개" -Encoding utf8
  if (Test-Path $alert) { Remove-Item $alert -Force }
  exit 0
}

$msg = @"
[$stamp] 오늘($day) 원고가 $n 편뿐입니다 (기준 $need 편). 발행 폴더 $p 개.

무엇을 확인하나요
 1) 클로드 데스크톱 앱이 켜져 있나요? 앱 안의 예약작업(daily-celeb-drafts 03:30)은 앱이 켜져 있을 때만 발동하고
    놓친 회차는 건너뜁니다. 03:15 njob-claude-app-up 작업이 앱을 띄우게 해 뒀습니다.
 2) 그 작업 세션이 승인 창에서 멈춰 있지 않나요? 멈추면 몇 시간이 지나도 원고가 한 편도 안 나옵니다.
    앱에서 해당 세션을 열어 승인하거나 중지한 뒤 "지금 실행"을 누르세요.
 3) 급하면 손으로: 클로드에게 "오늘 원고 써서 발행해" 라고 하면 됩니다.

이 파일은 원고가 $need 편 이상이 되면 자동으로 지워집니다.
"@
Set-Content -Path $alert -Value $msg -Encoding utf8
Add-Content -Path $log -Value "$stamp 경고 — 원고 $n 편 / 발행폴더 $p 개 → 바탕화면에 알림 파일" -Encoding utf8
exit 1
