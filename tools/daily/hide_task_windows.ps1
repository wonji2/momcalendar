# 예약작업이 검은 콘솔 창을 띄우지 않게 run_hidden.vbs 로 감싼다
#   사장님 지시: 2026-09-07 "10분에 하나씩 검은 창이 계속 뜬다" · 2026-09-28 "파란 PowerShell 창" · 2026-10-01 (또)
#   같은 지적이 세 번 나온 이유: **새 작업을 만들 때마다 래퍼를 빼먹어서**다.
#   그래서 사람 기억이 아니라 도구로 만든다 — 이 파일을 돌리면 안 감싸진 작업을 전부 찾아 감싼다.
#
#   점검만:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\daily\hide_task_windows.ps1
#   적용:    … hide_task_windows.ps1 -Apply
#   ⚠ 적용 전에 XML 백업을 뜬다(-Backup 경로, 기본 tools\daily\tasks\_hide_<날짜>).
param(
  [switch]$Apply,
  [string]$Pattern = 'momcal*',
  [string]$Backup = ''
)
$ErrorActionPreference = 'Stop'
$VBS = 'C:\Users\FAMILY\Desktop\MOMCALENDAR\tools\daily\run_hidden.vbs'
$WS  = 'C:\Windows\System32\wscript.exe'
if (-not (Test-Path $VBS)) { Write-Output "🔴 run_hidden.vbs 가 없다: $VBS"; exit 1 }
if (-not $Backup) { $Backup = "C:\Users\FAMILY\Desktop\MOMCALENDAR\tools\daily\tasks\_hide_$(Get-Date -f yyyy-MM-dd)" }

# 인자 문자열을 토큰으로 가른다 (따옴표 안의 공백은 유지). run_hidden.vbs 가 토큰마다 따옴표를 다시 씌운다.
function Split-Args([string]$s) {
  $out = @(); $cur = ''; $q = $false
  foreach ($ch in $s.ToCharArray()) {
    if ($ch -eq '"') { $q = -not $q; continue }
    if ($ch -eq ' ' -and -not $q) { if ($cur -ne '') { $out += $cur; $cur = '' }; continue }
    $cur += $ch
  }
  if ($cur -ne '') { $out += $cur }
  return $out
}
function Is-Hidden($a) {
  return ($a.Execute -match 'wscript') -or ($a.Arguments -match 'run_hidden|_hidden\.vbs') -or ($a.Arguments -match '-WindowStyle\s+Hidden')
}

$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like $Pattern }
$todo = @()
foreach ($t in $tasks) {
  foreach ($a in $t.Actions) {
    if ($a -isnot [Microsoft.Management.Infrastructure.CimInstance]) { continue }
    if (-not $a.Execute) { continue }
    if (Is-Hidden $a) { continue }
    $todo += [pscustomobject]@{ Task = $t; Name = $t.TaskName; Action = $a }
  }
}
if (-not $todo) { Write-Output "✅ 창을 띄우는 예약작업 없음 ($Pattern)"; exit 0 }

Write-Output "창을 띄우는 작업 $($todo.Count)개:"
foreach ($x in $todo) { Write-Output ("  {0,-26} {1} {2}" -f $x.Name, (Split-Path $x.Action.Execute -Leaf), $x.Action.Arguments) }
if (-not $Apply) { Write-Output "`n(점검만 했다. 실제로 감싸려면 -Apply)"; exit 0 }

New-Item -ItemType Directory -Force $Backup | Out-Null
$ok = 0; $fail = @()
foreach ($x in $todo) {
  $nm = $x.Name
  try {
    # 1) XML 백업 — 회차별 고유 폴더에 남긴다(덮어쓰지 않는다)
    $xml = & schtasks /query /tn $nm /xml ONE 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $xml) { throw 'XML 백업 실패' }
    $xml | Out-File -Encoding utf8 (Join-Path $Backup "$nm.xml")

    # 2) 액션을 wscript + run_hidden.vbs 로 바꾼다
    $exe = $x.Action.Execute.Trim('"')
    $argv = @($VBS, $exe) + (Split-Args $x.Action.Arguments)
    $newArgs = '//B ' + (($argv | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $p = @{ Execute = $WS; Argument = $newArgs }
    if ($x.Action.WorkingDirectory) { $p['WorkingDirectory'] = $x.Action.WorkingDirectory }
    $newAction = New-ScheduledTaskAction @p

    # 같은 작업에 액션이 여럿이면 그 하나만 갈아끼운다
    $acts = @()
    foreach ($a in (Get-ScheduledTask -TaskName $nm).Actions) {
      if ($a.Execute -eq $x.Action.Execute -and $a.Arguments -eq $x.Action.Arguments) { $acts += $newAction } else { $acts += $a }
    }
    Set-ScheduledTask -TaskName $nm -Action $acts | Out-Null
    $ok++
    Write-Output "  ✅ $nm"
  } catch {
    $fail += "$nm — $($_.Exception.Message)"
    Write-Output "  🔴 $nm — $($_.Exception.Message)"
  }
}
Write-Output "`n감쌈 $ok / $($todo.Count) · 백업 $Backup"
if ($fail) { Write-Output "🔴 실패:"; $fail | ForEach-Object { Write-Output "   $_" }; exit 1 }

# 3) 되읽어 확인 — 바꿨다고 믿지 않고 다시 묻는다
$left = @()
foreach ($t in (Get-ScheduledTask | Where-Object { $_.TaskName -like $Pattern })) {
  foreach ($a in $t.Actions) { if ($a.Execute -and -not (Is-Hidden $a)) { $left += $t.TaskName } }
}
if ($left) { Write-Output "🔴 아직 창을 띄우는 작업: $($left -join ', ')"; exit 1 }
Write-Output "✅ 되읽기 확인 — $Pattern 중 창을 띄우는 작업 0개"
