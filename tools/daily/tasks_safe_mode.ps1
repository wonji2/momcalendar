# 예약작업 안전 모드 일괄 적용 — 재부팅 뒤 「밀린 회차 70개 동시 실행」 재발 방지 (사장님 긴급 오더 2026-11-01)
#
# 사고: 2026-11-01 09:32 PC 재부팅 → StartWhenAvailable 예약작업 70여 개가 같은 초에 돌아 공용 임시 인덱스를
#       서로 지우고, 파일 1개짜리 커밋이 라이브로 나갔다(ops/admin/test.html 404). 메모리 alert-push-wiped-repo-2026-11-01.
#
# 하는 것 (우리 예약작업 = momcal-* · njob-* · work-backup-* · gijil-* · dad-* · blogauto-* · econ-* · smartstore-track · Tick · Learn · RefreshToken)
#   ① StartWhenAvailable = false  — 놓친 회차를 켜질 때 몰아서 돌리지 않는다(다음 정규 회차에 돈다)
#   ② MultipleInstances  = IgnoreNew — 같은 작업이 아직 돌고 있으면 새 회차는 버린다
#   ③ ExecutionTimeLimit — 제한이 없던 작업(PT72H 기본값)에 상한을 건다: 점검·가드류 10분, 수집·발행류 1시간(좀비 방지).
#      이미 제한이 걸려 있던 작업(20분·30분·2시간 …)은 그 값이 실측에 맞춰 둔 것이라 그대로 둔다.
#      ⚠ 손대지 않는 것: momcal-cafe-hotdeal · momcal-cafe-greeting(카페에 글을 올리는 발행기 — 사장님 2026-09-04 「풀지말고 냅둬」,
#         중간에 끊으면 글이 반쯤 올라간다) 의 시간 제한, momcal-hub-server(상시 서버, 제한 없음이 맞다).
#
#   실행  powershell -ExecutionPolicy Bypass -File tools\daily\tasks_safe_mode.ps1            ← 미리보기(바꾸지 않음)
#         powershell -ExecutionPolicy Bypass -File tools\daily\tasks_safe_mode.ps1 -Apply     ← 적용 + 되돌리기 TSV 저장
#         powershell -ExecutionPolicy Bypass -File tools\daily\tasks_safe_mode.ps1 -Report    ← 시간 제한에 걸려 죽은 작업(0x41306) 찾기
#         powershell -ExecutionPolicy Bypass -File tools\daily\tasks_safe_mode.ps1 -Rollback scratchpad\handoff-log\tasks_safe_mode_<날짜>.tsv
#   되돌리기 TSV: scratchpad/handoff-log/tasks_safe_mode_<yyyyMMdd_HHmmss>.tsv (이름·전 SWA·전 Multi·전 Limit·후 Limit)
#   적용 뒤엔 반드시  powershell -ExecutionPolicy Bypass -File tools\daily\tasks_backup.ps1  로 XML 백업을 새로 뜬다
#   (옛 XML 로 복원하면 StartWhenAvailable=true 가 되살아난다).
#   ⚠ 이 설정은 PC 안에만 있다 — PC 를 바꾸면 tasks_backup.ps1 -Restore 뒤 이 스크립트를 -Apply 로 한 번 더.

param(
  [switch]$Apply,
  [switch]$Report,
  [string]$Rollback = '',
  [string]$Filter = '^(momcal-|njob-|work-backup|gijil-|dad-|blogauto-|econ-|smartstore-track$|Tick$|Learn$|RefreshToken$)',
  [string]$ShortLimit = 'PT10M',   # 점검·가드류
  [string]$LongLimit  = 'PT1H'     # 수집·발행류(제한 없던 것만)
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # …\MOMCALENDAR
$logDir = Join-Path $root 'scratchpad\handoff-log'

# 시간 제한을 건드리지 않는 작업
$KeepLimit = @('momcal-cafe-hotdeal', 'momcal-cafe-greeting', 'momcal-hub-server')
# 제한이 없던 것 중 10분이면 충분한 점검·가드류 (나머지 제한 없던 것은 $LongLimit)
$ShortRe = '(guard|watch|check|audit|smoke|gap|clean|sweep|status|report|honeypot|soldout|openlist|plan|rivals|shapes|retention|^Tick$|^RefreshToken$|^blogauto-backup$)'

function Get-Targets {
  Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -match $Filter } | Sort-Object TaskName
}

function Desired-Limit([string]$name, [string]$cur) {
  if ($KeepLimit -contains $name) { return $cur }
  if ($cur -ne 'PT72H' -and $cur -ne 'PT0S' -and $cur) { return $cur }   # 이미 걸어 둔 제한은 그대로
  if ($name -match $ShortRe) { return $ShortLimit }
  return $LongLimit
}

if ($Report) {
  # 0x41306 (267014) = 시간 제한으로 강제 종료됨 · 0x41301 (267009) = 아직 실행 중
  $rows = foreach ($t in Get-Targets) {
    $i = $t | Get-ScheduledTaskInfo
    [pscustomobject]@{ Name=$t.TaskName; Limit=$t.Settings.ExecutionTimeLimit; LastRun=$i.LastRunTime; Result=('0x{0:X}' -f $i.LastTaskResult); State=$t.State }
  }
  $killed = @($rows | Where-Object { $_.Result -eq '0x41306' })
  Write-Output "우리 예약작업 $($rows.Count)개 · 시간 제한에 걸려 죽은 것 $($killed.Count)개"
  if ($killed.Count) { $killed | Format-Table -AutoSize | Out-String -Width 200 | Write-Output; Write-Output "→ 실제로 그만큼 걸리는 작업이면 제한을 늘린다: Set-ScheduledTask 또는 이 스크립트의 Desired-Limit" }
  $running = @($rows | Where-Object { $_.Result -eq '0x41301' })
  if ($running.Count) { Write-Output "지금 실행 중 $($running.Count)개: $(($running | ForEach-Object { $_.Name }) -join ', ')" }
  exit 0
}

if ($Rollback) {
  if (-not (Test-Path $Rollback)) { Write-Output "🔴 되돌리기 파일이 없다: $Rollback"; exit 1 }
  $n = 0
  foreach ($r in (Import-Csv $Rollback -Delimiter "`t")) {
    $t = Get-ScheduledTask -TaskName $r.Name -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output "  건너뜀(없다) $($r.Name)"; continue }
    $s = $t.Settings
    $s.StartWhenAvailable = [bool]::Parse($r.SWA_before)
    $s.MultipleInstances = $r.Multi_before
    $s.ExecutionTimeLimit = $r.Limit_before
    Set-ScheduledTask -TaskName $r.Name -Settings $s | Out-Null
    $n++
  }
  Write-Output "되돌림 $n 개 (파일 $Rollback)"
  exit 0
}

$targets = @(Get-Targets)
if (-not $targets.Count) { Write-Output "🔴 이름이 '$Filter' 인 예약작업이 없다"; exit 1 }

$plan = foreach ($t in $targets) {
  $s = $t.Settings
  $cur = $s.ExecutionTimeLimit
  $want = Desired-Limit $t.TaskName $cur
  [pscustomobject]@{
    Name         = $t.TaskName
    State        = $t.State
    SWA_before   = $s.StartWhenAvailable
    Multi_before = $s.MultipleInstances
    Limit_before = $cur
    Limit_after  = $want
    Change       = (($s.StartWhenAvailable -ne $false) -or ($s.MultipleInstances -ne 'IgnoreNew') -or ($cur -ne $want))
  }
}

$chg = @($plan | Where-Object { $_.Change })
Write-Output ("대상 {0}개 · 바꿀 것 {1}개 (StartWhenAvailable 켜진 것 {2} · 동시실행 IgnoreNew 아닌 것 {3} · 시간 제한 바꿀 것 {4})" -f `
  $plan.Count, $chg.Count, @($plan | Where-Object { $_.SWA_before }).Count, @($plan | Where-Object { $_.Multi_before -ne 'IgnoreNew' }).Count, @($plan | Where-Object { $_.Limit_before -ne $_.Limit_after }).Count)
$plan | Format-Table Name, State, SWA_before, Multi_before, Limit_before, Limit_after, Change -AutoSize | Out-String -Width 200 | Write-Output

if (-not $Apply) { Write-Output "미리보기만 했다. 적용하려면 -Apply"; exit 0 }

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }
$tsv = Join-Path $logDir ("tasks_safe_mode_{0}.tsv" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$plan | Select-Object Name, SWA_before, Multi_before, Limit_before, Limit_after | ConvertTo-Csv -NoTypeInformation -Delimiter "`t" | ForEach-Object { $_ -replace '"', '' } | Out-File -Encoding utf8 $tsv
Write-Output "되돌리기 TSV: $tsv"

$ok = 0; $fail = 0
foreach ($p in $chg) {
  try {
    $t = Get-ScheduledTask -TaskName $p.Name
    $s = $t.Settings
    $s.StartWhenAvailable = $false
    $s.MultipleInstances = 'IgnoreNew'
    $s.ExecutionTimeLimit = $p.Limit_after
    Set-ScheduledTask -TaskName $p.Name -Settings $s | Out-Null
    $ok++
  } catch {
    Write-Output "  🔴 실패 $($p.Name): $($_.Exception.Message)"; $fail++
  }
}

# 되읽어 확인 — 설정했다고 믿지 않는다
$after = @(Get-Targets)
$badSwa = @($after | Where-Object { $_.Settings.StartWhenAvailable })
$badMulti = @($after | Where-Object { $_.Settings.MultipleInstances -ne 'IgnoreNew' })
$noLimit = @($after | Where-Object { ($_.Settings.ExecutionTimeLimit -eq 'PT72H' -or $_.Settings.ExecutionTimeLimit -eq 'PT0S') -and ($KeepLimit -notcontains $_.TaskName) })
Write-Output ""
Write-Output "적용 $ok 개 · 실패 $fail 개"
Write-Output ("되읽기: StartWhenAvailable 켜진 것 {0} · IgnoreNew 아닌 것 {1} · 제한 없는 것(예외 제외) {2}" -f $badSwa.Count, $badMulti.Count, $noLimit.Count)
if ($badSwa.Count) { Write-Output ("  🔴 SWA 남음: " + (($badSwa | ForEach-Object { $_.TaskName }) -join ', ')) }
if ($noLimit.Count) { Write-Output ("  🔴 제한 없음: " + (($noLimit | ForEach-Object { $_.TaskName }) -join ', ')) }
$after | Group-Object { $_.Settings.ExecutionTimeLimit } | Sort-Object Name | ForEach-Object { "  제한 $($_.Name): $($_.Count)개" } | Write-Output
if ($badSwa.Count -or $badMulti.Count -or $noLimit.Count -or $fail) { exit 1 }
Write-Output "✅ 끝. 이제 tasks_backup.ps1 로 XML 백업을 새로 뜬다"
