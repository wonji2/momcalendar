-- 로그인 감시: 확정실패와 추정실패를 갈라 본다 (사장님 승인 2026-08-06)
-- login_watch_31.sql 의 check_login_health 를 대체한다.
-- 판정 규칙을 정확히 한다 (2026-08-06)
--   확정실패 : '경로|환경|사유' 형태 (kkoLoginFailed 가 남긴 것) → 파이프가 있고 |추정 이 아님
--   추정실패 : '경로|환경|추정' (새 코드) 또는 파이프 없는 옛 기록 (checkLoginFail 이 남긴 것)
create or replace function public.check_login_health(p_hours int default 3)
returns table(miss int, rate numeric, msg text)
language plpgsql security definer set search_path = public
as $$
declare s int; d int; fh int; fg int; m int; r numeric; t text; since timestamptz;
begin
  since := now() - make_interval(hours => p_hours);
  select count(*) filter (where event_type='kakao_login_start'),
         count(*) filter (where event_type='kakao_login_done'),
         count(*) filter (where event_type='kakao_login_fail'
                            and event_data like '%|%' and event_data not like '%|추정'),
         count(*) filter (where event_type='kakao_login_fail'
                            and (event_data not like '%|%' or event_data like '%|추정'))
    into s, d, fh, fg
  from public.events
  where event_type like 'kakao_login%' and visited_at >= since;

  m := fh;
  r := case when s > 0 then round(d::numeric * 100 / s, 1) else null end;

  select string_agg(distinct coalesce(nullif(event_data,''),'(구버전)'), ', ')
    into t
  from public.events
  where event_type='kakao_login_start' and visited_at >= since;

  if fh > 0 then
    return query select m, r,
      format('최근 %s시간 로그인 확정실패 %s건 (시작 %s · 완료 %s · 추정 %s · 성공률 %s%%) 환경 [%s]',
             p_hours, fh, s, d, fg, coalesce(r::text,'-'), coalesce(t,'-'));
  end if;
end $$;
revoke all on function public.check_login_health(int) from public, anon, authenticated;
grant execute on function public.check_login_health(int) to service_role;

select coalesce((select msg from public.check_login_health(24)),'확정실패 0건 → 경보 없음(정상)') as 결과;
