# momcal 운영자산 백업 → 비공개 레포 wonji2/momcal-ops (사장님 A안, 2026-08-12)
# 대상: scratchpad(도구·등록기록) + 슬래시커맨드 + 메모리 + CLAUDE/HANDOFF (로컬에만 있는 것들)
# 구 PC(FAMILY)·새 PC(안태인) 겸용 — 폴더 위치가 기계마다 달라 존재하는 첫 후보 경로를 쓴다 (2026-08-14)
$ErrorActionPreference = 'Continue'
$repo = "$env:USERPROFILE\momcal-ops"

# 🔴🔴 2026-10-02 — work-backup 이 겪은 사고를 **이 파일이 그대로 안고 있었다**(형제 코드의 같은 결함).
#   ①겹쳐 돌면 서로의 중간 상태를 커밋한다 ②`git status` 로 판단해 add 실패를 못 본다
#   ③push 결과를 안 본다 ④100MB 파일이면 push 가 통째로 거부된다 — 넷 다 아래에서 막는다.
# 동시 실행 잠금 — 세션종료 훅·예약작업·사람이 각각 부른다. 겹치면 비켜난다(어차피 같은 것을 담는다).
$lockFile = Join-Path $repo '.backup.lock'
if (Test-Path $repo) {
  if (Test-Path $lockFile) {
    $age = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($age.TotalMinutes -lt 20) { Write-Host ("OPS BACKUP SKIP: 다른 회차가 {0:N1}분 전부터 돌고 있다" -f $age.TotalMinutes); exit 0 }
    Write-Host "OPS BACKUP WARN: 20분 넘은 잠금을 걷어낸다(앞 회차가 죽은 듯)"
  }
  Set-Content -Path $lockFile -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Encoding UTF8
}
$global:__opslock = $lockFile
try {
$src  = @("$env:USERPROFILE\MOMCALENDAR", "$env:USERPROFILE\Desktop\MOMCALENDAR") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
# 메모리 폴더는 기계마다 프로젝트 경로명이 다르다 → MOMCALENDAR 이름이 든 폴더 중 MEMORY.md 가 가장 최근인 것
$mem  = Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory -Filter '*MOMCALENDAR*' -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'memory' } |
        Where-Object { Test-Path (Join-Path $_ 'MEMORY.md') } |
        Sort-Object { (Get-Item (Join-Path $_ 'MEMORY.md')).LastWriteTime } -Descending |
        Select-Object -First 1

# ── 안전장치: /MIR 는 원본에서 사라진 파일을 백업에서도 지운다 ──
# 원본 파일수가 백업본보다 급감(30개 초과 감소 또는 70% 미만)이면 그 폴더 미러를 멈추고 경고만 남긴다.
# 의도된 대량 삭제라면 momcal-ops\ALLOW_SHRINK.txt 를 만들어 두고 실행하면 1회 통과된다.
function Count-Files([string]$p) {
  (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\\.git\\|\\node_modules\\' } | Measure-Object).Count
}
# $xf: 백업에서 뺄 파일 이름·패턴 (2026-10-05 추가 — 재생성 가능한 큰 파생물)
#   왜: scratchpad\_feed_sweep.json 이 77.9MB 까지 커져 push 에 GitHub 경고가 떴다.
#   100MB 를 넘으면 push 가 거부돼 **백업이 통째로 멈춘다**(2026-10-01 에 겪은 사고).
#   이 파일은 feed_sweep_to_harvest.mjs 가 scratchpad\ig_feed\*.jsonl 에서 다시 만들어내는 파생물이고
#   그 원본 28개(136MB)는 백업에 그대로 있다 → 빼도 잃는 것이 없다.
#   ⚠ /XF 는 「그 파일을 아예 보지 않는다」라 **대상에 이미 있는 것은 /MIR 가 지우지 않는다** →
#     한 번은 손으로 지우고 커밋해야 한다(.gitignore 에도 넣어 재유입을 막았다).
function Safe-Mirror([string]$s0, [string]$d0, [string]$label, [string[]]$xf = @()) {
  if (Test-Path $d0) {
    $s = Count-Files $s0; $d = Count-Files $d0
    $flag = "$repo\ALLOW_SHRINK.txt"
  # 20개 미만 폴더(claude-agents 1개·claude-commands 8개)는 위 비율 가드가 안 걸린다 →
  # 원본이 통째로 사라진 경우($s=0)는 크기와 무관하게 미러를 멈춘다 (2026-09-01 검증자 지적)
    if (($d -ge 20 -and (($d - $s) -gt 30 -or $s -lt [math]::Ceiling($d * 0.7))) -or ($d -ge 1 -and $s -eq 0)) {
      if (Test-Path $flag) { Remove-Item $flag -Force }
      else {
        $msg = "[{0}] 경고: {1} 원본 파일수 급감 (원본 {2} vs 백업 {3}) - 미러 중단. 의도된 삭제면 ALLOW_SHRINK.txt 생성 후 재실행" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $label, $s, $d
        Add-Content -Path "$repo\BACKUP_WARNING.txt" -Value $msg -Encoding UTF8
        Write-Warning $msg
        return
      }
    }
  }
  $rcArgs = @($s0, $d0, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS')
  if ($xf) { $rcArgs += '/XF'; $rcArgs += $xf }
  robocopy @rcArgs | Out-Null
}

# 네이버 SERP 일일 실측 → serp_log.tsv 가 같이 백업된다.
# 매시간 실행 체제(2026-08-14)에서도 SERP 는 하루 1회만 — 오늘 날짜 행이 이미 있으면 건너뛴다.
$serpLog = "$src\scratchpad\serp_log.tsv"
$today = Get-Date -Format 'yyyy-MM-dd'
if (-not (Test-Path $serpLog) -or -not (Select-String -Path $serpLog -Pattern "^$today" -Quiet)) {
  & 'C:\Program Files\Git\bin\bash.exe' "$src\tools\daily\serp_check.sh"
}

if (-not (Test-Path "$repo\.git")) { git clone https://github.com/wonji2/momcal-ops.git $repo }

# ── 2026-09-28 추가: 엔잡방장 블로그 자동화 자산 (사장님 "새 컴퓨터에서도 이어서" 지시) ──
function Mirror-Ex([string]$s0, [string]$d0, [string[]]$xd, [string[]]$xf) {
  if (-not (Test-Path $s0)) { return }
  $rc = @($s0, $d0, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS')
  if ($xd) { $rc += '/XD'; $rc += $xd }
  if ($xf) { $rc += '/XF'; $rc += $xf }
  robocopy @rc | Out-Null
}
# sns-automation 코드 (비밀키·브라우저 프로필·node_modules·daily 릴스·사진은 제외)
Mirror-Ex "$src\sns-automation" "$repo\sns-automation" @('node_modules','browser-profile*','daily','images') @('.env','*.png','*.jpg','*.mp4')
Mirror-Ex "$src\tools\daily\tasks" "$repo\tools-daily-tasks" @() @()
# 블로그원고(지침·도구·원고)와 발행 폴더(예약 기록 published-blog.json) — 사진·html 은 뺀다
$blogSrc = "$env:USERPROFILE\Desktop\블로그원고"
if (Test-Path $blogSrc) { Mirror-Ex $blogSrc "$repo\blog-drafts" @('사진','사진_*','발행용사진_*','16_블로그꾸미기') @('*.png','*.jpg','*.jpeg','*.html','naver_ad_keys.txt') }
$blogPub = "$env:USERPROFILE\Desktop\블로그"
if (Test-Path $blogPub) { Mirror-Ex $blogPub "$repo\blog-published" @() @('*.png','*.jpg','*.jpeg','*.html','*.xlsx') }
# 블로그 프로젝트 클로드 메모리 (프로젝트 폴더명이 scratch-workspaces 라 위 $mem 에 안 잡힌다)
$memBlog = Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory -Filter '*scratch-workspaces*' -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName 'memory' } | Where-Object { Test-Path (Join-Path $_ 'MEMORY.md') } |
  Sort-Object { (Get-Item (Join-Path $_ 'MEMORY.md')).LastWriteTime } -Descending | Select-Object -First 1
if ($memBlog) { Mirror-Ex $memBlog "$repo\memory-blog" @() @() }
$skill = "$env:USERPROFILE\.claude\scheduled-tasks"
if (Test-Path $skill) { Mirror-Ex $skill "$repo\claude-scheduled-tasks" @() @() }
Set-Location $repo
git config user.name 'momcal-bot'
git config user.email 'noreply@momcalendar.com'

# 두 PC 가 같은 날 둘 다 push 하면 뒤쪽이 거부된다(2026-08-14 실측) → 복사 전에 원격을 먼저 합친다
git pull --no-rebase -X ours origin main 2>$null
if ($LASTEXITCODE -ne 0) { git merge --abort 2>$null }

Safe-Mirror "$src\scratchpad" "$repo\scratchpad" 'scratchpad' @('_feed_sweep.json')
Safe-Mirror "$src\.claude\commands" "$repo\claude-commands" 'claude-commands'
Safe-Mirror "$src\.claude\agents" "$repo\claude-agents" 'claude-agents'
Safe-Mirror $mem "$repo\memory" 'memory'
Copy-Item "$src\CLAUDE.md" "$repo\CLAUDE-MOMCALENDAR.md" -Force
Copy-Item "$src\HANDOFF.md" "$repo\HANDOFF.md" -Force
# 상위폴더 CLAUDE.md 2종 — 있는 기계(구 PC)에서만 미러 갱신, 없는 기계는 momcal-ops 안의 미러가 최신본
$parentClaude = "$env:USERPROFILE\Desktop\맘캘린더\CLAUDE.md"
$desktopClaude = "$env:USERPROFILE\Desktop\CLAUDE.md"
if (Test-Path $parentClaude) { Copy-Item $parentClaude "$repo\CLAUDE-parent.md" -Force }
if (Test-Path $desktopClaude) { Copy-Item $desktopClaude "$repo\CLAUDE-desktop.md" -Force }

Set-Location $repo
# 긴 경로(서브에이전트 로그 등)가 있으면 git add -A 가 통째로 실패한다
git config core.longpaths true
git add -A --ignore-errors
if ($LASTEXITCODE -ne 0) { Write-Host "OPS BACKUP WARN: git add -A exit $LASTEXITCODE (--ignore-errors) - 담긴 것만 커밋한다" }

# 🔴 100MB 넘는 파일 하나가 push 를 통째로 거부시킨다(GitHub 한도). 커밋 직전에 인덱스에서 뺀다.
$tooBig = @()
foreach ($rel in (git diff --cached --name-only)) {
  $full = Join-Path $repo $rel
  if (Test-Path -LiteralPath $full) {
    try { if ((Get-Item -LiteralPath $full).Length -gt 99MB) { $tooBig += $rel } } catch { }
  }
}
foreach ($rel in $tooBig) {
  git rm --cached --quiet -- $rel
  $m = "OPS BACKUP WARN: 100MB 초과라 이번 백업에서 제외 - $rel"
  Write-Host $m
  Add-Content -Path "$repo\BACKUP_WARNING.txt" -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm') + " $m") -Encoding UTF8
}
if ($tooBig.Count) { git add -A --ignore-errors BACKUP_WARNING.txt }

# 🔴 `git status` 가 아니라 **스테이지된 것**을 본다 — status 로 보면 add 가 실패해도 commit 을 시도해
#   "no changes added to commit" 으로 조용히 끝난다(2026-10-01 에 백업이 하루 멈춘 그 경로다).
$st = git diff --cached --name-only
if ($st) {
  git commit -m ("backup " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
  git push
  if ($LASTEXITCODE -ne 0) {
    $m = "OPS BACKUP FAIL: push 거부됨 (exit $LASTEXITCODE) — 커밋은 로컬에만 있다. momcal-ops 에서 git push 를 직접 돌려 사유를 볼 것"
    Write-Host $m
    Add-Content -Path "$repo\BACKUP_WARNING.txt" -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm') + " $m") -Encoding UTF8
  }
}
# 커밋할 게 없어도 앞 회차가 밀지 못하고 남긴 커밋이 있으면 밀어준다
$ahead = (git rev-list --count '@{u}..HEAD' 2>$null)
if ($ahead -and [int]$ahead -gt 0) {
  Write-Host "OPS BACKUP: 밀리지 않은 커밋 $ahead 개 — 다시 push 한다"
  git push
  if ($LASTEXITCODE -ne 0) {
    $m = "OPS BACKUP FAIL: 밀린 커밋 $ahead 개를 push 하지 못했다 (exit $LASTEXITCODE)"
    Write-Host $m
    Add-Content -Path "$repo\BACKUP_WARNING.txt" -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm') + " $m") -Encoding UTF8
  }
}
} finally {
  # 어떤 경로로 끝나든 잠금을 푼다
  if ($global:__opslock -and (Test-Path $global:__opslock)) { Remove-Item $global:__opslock -Force -ErrorAction SilentlyContinue }
}