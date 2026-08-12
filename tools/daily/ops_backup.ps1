# momcal 운영자산 백업 → 비공개 레포 wonji2/momcal-ops (사장님 A안, 2026-08-12)
# 대상: scratchpad(도구·등록기록) + 슬래시커맨드 + 메모리 + CLAUDE/HANDOFF (로컬에만 있는 것들)
$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\FAMILY\momcal-ops'
$src  = 'C:\Users\FAMILY\Desktop\맘캘린더\사이트\MOMCALENDAR'
$mem  = 'C:\Users\FAMILY\.claude\projects\C--Users-FAMILY-Desktop----------MOMCALENDAR\memory'

# 백업 전에 네이버 SERP 일일 실측 → serp_log.tsv 가 같이 백업된다
& 'C:\Program Files\Git\bin\bash.exe' "$src\tools\daily\serp_check.sh"

if (-not (Test-Path "$repo\.git")) { git clone https://github.com/wonji2/momcal-ops.git $repo }
Set-Location $repo
git config user.name 'momcal-bot'
git config user.email 'noreply@momcalendar.com'

robocopy "$src\scratchpad" "$repo\scratchpad" /MIR /NFL /NDL /NJH /NJS | Out-Null
robocopy "$src\.claude\commands" "$repo\claude-commands" /MIR /NFL /NDL /NJH /NJS | Out-Null
robocopy $mem "$repo\memory" /MIR /NFL /NDL /NJH /NJS | Out-Null
Copy-Item "$src\CLAUDE.md" "$repo\CLAUDE-MOMCALENDAR.md" -Force
Copy-Item "$src\HANDOFF.md" "$repo\HANDOFF.md" -Force
Copy-Item 'C:\Users\FAMILY\Desktop\맘캘린더\CLAUDE.md' "$repo\CLAUDE-parent.md" -Force
Copy-Item 'C:\Users\FAMILY\Desktop\CLAUDE.md' "$repo\CLAUDE-desktop.md" -Force

Set-Location $repo
git add -A
$st = git status --porcelain
if ($st) {
  git commit -m ("backup " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
  git push
}