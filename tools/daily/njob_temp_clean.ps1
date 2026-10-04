# 캡처 찌꺼기 청소 — 2026-10-02 신설
# 사고: 10/2 오전 C 드라이브 여유가 0.3GB 까지 떨어져 원고 저장이 여러 번 실패했다.
#       범인은 %TEMP%\playwright_chromiumdev_profile-* 고아 폴더 8.3GB.
#       yt-capture·web-capture·ig-capture 가 돌 때마다 쌓이는데 아무도 치우지 않았다.
# 지금 쓰고 있는 프로필은 건드리지 않는다(실행 중인 chrome 의 --user-data-dir 를 읽어 제외).
$log = Join-Path $PSScriptRoot 'njob_temp_clean.log'
function Say($m) { $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Add-Content -Path $log -Value $line -Encoding utf8; Write-Output $line }

$before = (Get-PSDrive C).Free / 1GB
$cut = (Get-Date).AddHours(-6)

# 지금 켜져 있는 크롬이 쓰는 프로필 경로 (이건 절대 지우면 안 된다)
$live = @()
try {
  $live = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction Stop |
    ForEach-Object { if ($_.CommandLine -match 'user-data-dir="?([^" ]+)') { $Matches[1] } }
} catch {}

$freed = 0; $n = 0
foreach ($t in @($env:TEMP, 'E:\njob-temp')) {
  if (-not (Test-Path $t)) { continue }
  Get-ChildItem $t -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike 'claude*' -and $_.LastWriteTime -lt $cut -and $live -notcontains $_.FullName } |
    ForEach-Object {
      try {
        $sz = if ($_.PSIsContainer) { (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum } else { $_.Length }
        Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
        $freed += $sz; $n++
      } catch {}
    }
}

$after = (Get-PSDrive C).Free / 1GB
Say ("정리 {0}개 · {1:N0} MB 확보 · C 여유 {2:N2}GB → {3:N2}GB" -f $n, ($freed / 1MB), $before, $after)

# 여유가 적으면 바탕화면에 알린다 (원고·발행이 조용히 실패하는 것을 막는다)
$warn = Join-Path ([Environment]::GetFolderPath('Desktop')) '★디스크가_부족해요.txt'
if ($after -lt 5) {
  $msg = @"
C 드라이브 여유가 {0:N2}GB 밖에 없습니다 ({1}).

이대로면 원고 저장과 사진 캡처가 조용히 실패합니다.
지울 수 있는 것:
  · %TEMP% 안의 playwright_chromiumdev_profile-* 폴더 (캡처 찌꺼기, 지워도 됩니다)
  · 바탕화면\블로그, 바탕화면\블로그원고 의 지난 날짜 사진
    (발행이 끝난 날의 사진은 네이버에 올라가 있으니 지워도 됩니다.
     단 published-blog.json 과 원고 txt 는 매일 분석이 쓰므로 남겨두세요)
"@ -f $after, (Get-Date -Format 'yyyy-MM-dd HH:mm')
  Set-Content -Path $warn -Value $msg -Encoding utf8
  Say "경고 파일 남김: $warn"
} elseif (Test-Path $warn) {
  Remove-Item $warn -Force -ErrorAction SilentlyContinue
  Say '여유 회복 — 경고 파일 지움'
}
