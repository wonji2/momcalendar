# momcal 운영자산 백업 → 비공개 레포 wonji2/momcal-ops (사장님 A안, 2026-08-12)
# 대상: scratchpad(도구·등록기록) + 슬래시커맨드 + 메모리 + CLAUDE/HANDOFF (로컬에만 있는 것들)
# 구 PC(FAMILY)·새 PC(안태인) 겸용 — 폴더 위치가 기계마다 달라 존재하는 첫 후보 경로를 쓴다 (2026-08-14)
$ErrorActionPreference = 'Continue'
$repo = "$env:USERPROFILE\momcal-ops"
$src  = @("$env:USERPROFILE\MOMCALENDAR", "$env:USERPROFILE\Desktop\MOMCALENDAR") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
# 메모리 폴더는 기계마다 프로젝트 경로명이 다르다 → MOMCALENDAR 이름이 든 폴더 중 MEMORY.md 가 가장 최근인 것
$mem  = Get-ChildItem "$env:USERPROFILE\.claude\projects" -Directory -Filter '*MOMCALENDAR*' -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'memory' } |
        Where-Object { Test-Path (Join-Path $_ 'MEMORY.md') } |
        Sort-Object { (Get-Item (Join-Path $_ 'MEMORY.md')).LastWriteTime } -Descending |
        Select-Object -First 1

# 백업 전에 네이버 SERP 일일 실측 → serp_log.tsv 가 같이 백업된다
& 'C:\Program Files\Git\bin\bash.exe' "$src\tools\daily\serp_check.sh"

if (-not (Test-Path "$repo\.git")) { git clone https://github.com/wonji2/momcal-ops.git $repo }
Set-Location $repo
git config user.name 'momcal-bot'
git config user.email 'noreply@momcalendar.com'

# 두 PC 가 같은 날 둘 다 push 하면 뒤쪽이 거부된다(2026-08-14 실측) → 복사 전에 원격을 먼저 합친다
git pull --no-rebase -X ours origin main 2>$null
if ($LASTEXITCODE -ne 0) { git merge --abort 2>$null }

robocopy "$src\scratchpad" "$repo\scratchpad" /MIR /NFL /NDL /NJH /NJS | Out-Null
robocopy "$src\.claude\commands" "$repo\claude-commands" /MIR /NFL /NDL /NJH /NJS | Out-Null
robocopy $mem "$repo\memory" /MIR /NFL /NDL /NJH /NJS | Out-Null
Copy-Item "$src\CLAUDE.md" "$repo\CLAUDE-MOMCALENDAR.md" -Force
Copy-Item "$src\HANDOFF.md" "$repo\HANDOFF.md" -Force
# 상위폴더 CLAUDE.md 2종 — 있는 기계(구 PC)에서만 미러 갱신, 없는 기계는 momcal-ops 안의 미러가 최신본
$parentClaude = "$env:USERPROFILE\Desktop\맘캘린더\CLAUDE.md"
$desktopClaude = "$env:USERPROFILE\Desktop\CLAUDE.md"
if (Test-Path $parentClaude) { Copy-Item $parentClaude "$repo\CLAUDE-parent.md" -Force }
if (Test-Path $desktopClaude) { Copy-Item $desktopClaude "$repo\CLAUDE-desktop.md" -Force }

Set-Location $repo
git add -A
$st = git status --porcelain
if ($st) {
  git commit -m ("backup " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
  git push
}