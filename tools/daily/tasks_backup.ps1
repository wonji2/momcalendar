# 예약작업 백업·복원 (규칙 0-Y — PC 를 바꾸거나 윈도우를 다시 깔아도 자동화가 살아나야 한다)
#
# 사장님 지시 2026-10-01 "되살려놓고" — CLAUDE.md 규칙 0-Y 가 이 파일을 가리키는데 사라져 있었다.
#   XML 은 tools/daily/tasks/ 에 남아 있었지만 **복원 수단이 절차서에만 있고 실물이 없었다.**
#
#   백업:  powershell -ExecutionPolicy Bypass -File tools\daily\tasks_backup.ps1
#   복원:  powershell -ExecutionPolicy Bypass -File tools\daily\tasks_backup.ps1 -Restore
#   확인:  powershell -ExecutionPolicy Bypass -File tools\daily\tasks_backup.ps1 -Check
#
# 담는 것: 이름이 momcal-* · gijil-* 인 윈도우 예약작업의 XML (tools/daily/tasks/<이름>.xml)
# ⚠ XML 에는 **실행 계정의 비밀번호가 들어가지 않는다** → 복원 시 현재 사용자로 등록된다(/ru 생략).
# ⚠ tools/daily/tasks/ 는 공개 레포에서 제외돼 있다(.gitignore). 백업은 momcal-ops 로 간다(ops_backup.ps1).

param(
  [switch]$Restore,
  [switch]$Check,
  # 🔴 2026-10-01: 처음엔 'momcal-|gijil-' 만 담았는데, tasks/ 에는 njob-*·work-backup-* XML 도 있어서
  #    -Check 가 그것들을 「등록은 없고 XML 만 있다」고 **거짓 경보**했다(실제로는 멀쩡히 등록돼 있었다).
  #    백업 안전망(work-backup-hourly·daily)까지 담는 게 맞으니 필터를 넓힌다.
  [string]$Filter = 'momcal-|gijil-|njob-|work-backup'
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # …\MOMCALENDAR
$dir = Join-Path $PSScriptRoot 'tasks'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

function Get-LiveTasks {
  $csv = schtasks /query /fo csv 2>$null | ConvertFrom-Csv
  $names = @()
  foreach ($r in $csv) {
    $n = $r.TaskName
    if (-not $n) { continue }
    $leaf = ($n -split '\\')[-1]
    if ($leaf -match $Filter) { $names += $leaf }
  }
  return ($names | Sort-Object -Unique)
}

if ($Check) {
  $live = Get-LiveTasks
  $files = Get-ChildItem (Join-Path $dir '*.xml') -ErrorAction SilentlyContinue
  $fileNames = @($files | ForEach-Object { $_.BaseName })
  Write-Output "등록된 작업 $($live.Count)개 · 백업 XML $($fileNames.Count)개"
  $missing = @($live | Where-Object { $fileNames -notcontains $_ })
  $stale = @($fileNames | Where-Object { $live -notcontains $_ })
  if ($missing.Count) { Write-Output "🔴 백업에 없는 작업 $($missing.Count)개 — 지금 백업하면 담긴다:"; $missing | ForEach-Object { Write-Output "    $_" } }
  else { Write-Output "✅ 등록된 작업 전부 백업에 있다" }
  if ($stale.Count) { Write-Output "⚠ 등록은 없고 XML 만 있는 것 $($stale.Count)개 (지운 작업의 잔재 — 복원하면 되살아난다):"; $stale | ForEach-Object { Write-Output "    $_" } }
  exit 0
}

if ($Restore) {
  $files = Get-ChildItem (Join-Path $dir '*.xml') -ErrorAction SilentlyContinue
  if (-not $files) { Write-Output "🔴 복원할 XML 이 없다: $dir"; exit 1 }
  $ok = 0; $fail = 0; $skip = 0
  foreach ($f in $files) {
    $name = $f.BaseName
    $exists = schtasks /query /tn $name 2>$null
    if ($?) { Write-Output "  건너뜀(이미 있다) $name"; $skip++; continue }
    schtasks /create /tn $name /xml $f.FullName /f 2>&1 | Out-Null
    if ($?) { Write-Output "  ✅ 복원 $name"; $ok++ } else { Write-Output "  🔴 실패 $name"; $fail++ }
  }
  Write-Output ""
  Write-Output "복원 $ok 개 · 이미 있어 건너뜀 $skip 개 · 실패 $fail 개"
  Write-Output "⚠ 실패한 것은 XML 의 실행 계정이 이 PC 에 없는 경우다 — schtasks /create /tn <이름> /xml <파일> /ru <계정> 으로 손으로 넣는다"
  exit 0
}

# ── 기본 동작: 백업
$live = Get-LiveTasks
if (-not $live) { Write-Output "🔴 이름이 '$Filter' 인 예약작업이 없다 — 필터를 확인할 것"; exit 1 }
$ok = 0; $fail = 0
foreach ($name in $live) {
  $out = Join-Path $dir "$name.xml"
  $xml = schtasks /query /tn $name /xml 2>$null
  if (-not $?) { Write-Output "  🔴 읽기 실패 $name"; $fail++; continue }
  # 🔴🔴 2026-10-01 복원 리허설에서 잡은 결함: `schtasks /query /xml` 은 선언에
  #    `encoding="UTF-16"` 을 박아 넣는다. 이걸 **utf8 로 저장하면 선언과 실제가 어긋나**
  #    복원 때 `(1,2):: 오류: 잘못된 문서 구문입니다` 로 거부당한다(66개 전부 복원 불가였다).
  #    → 반드시 Unicode(UTF-16LE + BOM) 로 쓴다. ANSI 로 쓰면 한글 설명이 깨진다.
  #    🔑 메모리 backup-is-not-restore — 리허설 전까지 이 백업은 백업이 아니었다.
  $xml | Out-File -Encoding Unicode $out
  $ok++
}
Write-Output "예약작업 XML 백업 $ok 개 (실패 $fail) → $dir"
Write-Output "  이 폴더는 공개 레포에서 제외돼 있다 → momcal-ops 로 백업된다 (tools\daily\ops_backup.ps1)"
Write-Output "  PC 를 바꾸면: powershell -ExecutionPolicy Bypass -File tools\daily\tasks_backup.ps1 -Restore"
