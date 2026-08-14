# 셀러 프로필(팔로워·게시물) 월 1회 재수집 리마인드 (사장님 지시 2026-08-14)
#
# 인스타 프로필 API 는 **로그인된 브라우저 탭에서만** 호출된다(curl 불가, 쿠키 필요).
# 그래서 완전 무인 자동화가 불가능하다 → 대신 "재수집이 밀렸다" 는 사실을 DB 에 남겨
# 세션 시작 때(/이어서) 반드시 눈에 띄게 한다.
#
# 시계열은 소급이 안 된다. 한 달을 건너뛰면 그 달 성장률은 영원히 못 만든다.
$ErrorActionPreference = 'Continue'
$SB = "$env:USERPROFILE\supabase-cli\supabase.exe"
if (-not (Test-Path $SB)) { exit 0 }

$src = @("$env:USERPROFILE\MOMCALENDAR", "$env:USERPROFILE\Desktop\MOMCALENDAR") |
       Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $src) { exit 0 }

$sql = Join-Path $env:TEMP 'profile_stale_check.sql'
@'
-- 30일 이상 갱신 안 된 활성 셀러 수를 세어, 밀렸으면 health_alerts 에 경보를 남긴다
with active as (
  select distinct lower(trim(insta)) insta
  from public.gonggu
  where approved and coalesce(insta,'') <> ''
    and open_date >= to_char((now() at time zone 'Asia/Seoul')::date - 60, 'YYYY-MM-DD')
),
stale as (
  select a.insta from active a
  left join public.seller_profile p on lower(p.insta) = a.insta
  where p.insta is null or p.checked_at < now() - interval '30 days'
)
insert into public.health_alerts(kind, detail)
select 'profile_stale',
       '셀러 프로필 재수집 필요: ' || count(*) || '명이 30일 넘게 갱신 안 됨. ' ||
       '인스타 로그인 탭에서 프로필 수집 루프를 돌릴 것(12초 간격). 시계열은 소급 불가.'
from stale
having count(*) >= 100;
select 'checked' ok;
'@ | Set-Content -Path $sql -Encoding UTF8

# supabase CLI 는 링크된 프로젝트 폴더에서만 동작한다(작업 디렉터리를 옮겨야 함)
Push-Location $src
try { & $SB db query --linked -f $sql 2>&1 | Out-Null } finally { Pop-Location }
Write-Output "profile staleness checked"
