# 네이버 블로그(momcal) 발행 공백 감시 (2026-08-27 신설)
#
# 사고: 주간 예약발행 체제인데 8/24~27 나흘 글이 안 올라간 걸 아무도 몰랐다.
# 자동발행은 네이버가 API를 닫아 불가 → 대신 "발행이 끊겼다"는 사실을 health_alerts 에 남겨
# 세션 시작 때(/이어서) 눈에 띄게 한다. RSS(rss.blog.naver.com/momcal.xml)는 공개라 키가 필요 없다.
$ErrorActionPreference = 'Continue'
$SB = "$env:USERPROFILE\supabase-cli\supabase.exe"
if (-not (Test-Path $SB)) { exit 0 }
$src = @("$env:USERPROFILE\MOMCALENDAR", "$env:USERPROFILE\Desktop\MOMCALENDAR") |
       Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $src) { exit 0 }

try {
  # ⚠ DownloadString 은 UTF-8 RSS 를 CP949 로 잘못 디코딩해 XML 파싱이 깨진다 → 바이트로 받아 UTF-8 명시 디코딩
  $wc = New-Object System.Net.WebClient
  $raw = [System.Text.Encoding]::UTF8.GetString($wc.DownloadData('https://rss.blog.naver.com/momcal.xml'))
  [xml]$rss = $raw -replace '^﻿',''
  $latest = $rss.rss.channel.item | ForEach-Object { [datetime]::Parse($_.pubDate) } |
            Sort-Object -Descending | Select-Object -First 1
} catch { exit 0 }   # RSS 실패는 조용히 넘어간다 (다음 회차에 다시)
if (-not $latest) { exit 0 }

$gapDays = [int]((Get-Date) - $latest).TotalDays
if ($gapDays -lt 2) { exit 0 }

$latestStr = $latest.ToString('yyyy-MM-dd')
$sql = Join-Path $env:TEMP 'blog_gap_check.sql'
@"
-- 같은 경보가 이미 떠 있으면 또 넣지 않는다
insert into public.health_alerts(kind, detail)
select 'blog_gap',
       '네이버 블로그 발행 공백 ${gapDays}일 (마지막 글 ${latestStr}). week.html 에서 예약발행 세트를 다시 걸어야 한다. 사장님께 링크와 함께 리마인드 드릴 것: https://momcalendar.com/daily/week.html'
where not exists (select 1 from public.health_alerts where kind = 'blog_gap');
select 'checked' ok;
"@ | Set-Content -Path $sql -Encoding UTF8

Push-Location $src
& $SB db query --linked -f $sql | Out-Null
Pop-Location
