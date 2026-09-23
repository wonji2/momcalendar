-- 오류 레이더 (2026-09-24, 사장님 "시키는 것만 하지 말고 니가 먼저 전략 짜")
--
-- 이번 주 사고 셋의 공통점: 신호는 있었는데 **읽는 사람이 없었다**.
--   · http500 은 pg_stat_statements 에 몇 주째 있었다        · 빈 화면(data_load_fail) 은 events 에 2주째 하루 4~11건 쌓였다
--   · profile_stale 경보는 health_alerts 에 12일 있었다(login_watch_57 머리말)
-- 그래서 감시기를 더 만들지 않고 **한 함수**로 모아 세션도·크론도 같은 것을 읽는다.
--   error_radar()      : 오류 종류별 1시간·24시간 건수 + 임계 + 🔴/✅  (세션 시작 때 select * from error_radar())
--   run_error_watch()  : 매시간 pg_cron 이 error_radar() 를 읽어 🔴 인 줄만 health_alerts 에 'radar:<kind>' 로 남긴다
--                        (v57 교훈: 24시간 지난 것은 지우고, 같은 kind 는 문구·시각을 갱신 — 첫 발생에 얼어붙지 않는다)
-- 사장님께 닿는 길: 윈도우 예약작업 momcal-error-guard(매시간) 가 error_radar() 를 읽어 오늘 카드 알림줄(alert.mjs 'errors')에 쓴다.
-- ROLLBACK: 맨 아래.

create or replace function public.error_radar()
returns table(kind text, h1 bigint, h24 bigint, 임계 text, 상태 text, 설명 text)
language sql stable security definer set search_path = public as $$
  with e as (
    select event_type, event_data, visited_at from events
     where visited_at > now() - interval '24 hours'
       and event_type in ('data_load_fail','data_load_retry_ok','net_fallback','kakao_login_fail','kakao_login_start','kakao_login_done','js_error')
       and coalesce(event_data,'') not like '%Claude/%'          -- 내 브라우저 검증 제외
  ),
  c as (
    select
      count(*) filter (where event_type='data_load_fail' and visited_at > now()-interval '1 hour') f1,
      count(*) filter (where event_type='data_load_fail') f24,
      count(*) filter (where event_type='data_load_retry_ok' and visited_at > now()-interval '1 hour') r1,
      count(*) filter (where event_type='data_load_retry_ok') r24,
      count(*) filter (where event_type='net_fallback' and visited_at > now()-interval '1 hour') n1,
      count(*) filter (where event_type='net_fallback') n24,
      count(*) filter (where event_type='net_fallback' and event_data like '%|http5%' and visited_at > now()-interval '1 hour') s1,
      count(*) filter (where event_type='net_fallback' and event_data like '%|http5%') s24,
      count(*) filter (where event_type='kakao_login_fail' and event_data like '%|%' and event_data not like '%|추정%' and visited_at > now()-interval '1 hour') k1,
      count(*) filter (where event_type='kakao_login_fail' and event_data like '%|%' and event_data not like '%|추정%') k24,
      count(*) filter (where event_type='kakao_login_start') ks24,
      count(*) filter (where event_type='kakao_login_done') kd24,
      count(*) filter (where event_type='js_error' and visited_at > now()-interval '1 hour') j1,
      count(*) filter (where event_type='js_error') j24
    from e
  ),
  st as (select round(extract(epoch from (now()-max(updated_at)))/60)::bigint stale_min from gonggu_click_stats),
  ha as (select count(*) n from health_alerts where created_at > now()-interval '24 hours' and kind not like 'radar:%')
  select * from (
    select '빈화면(data_load_fail)'::text, f1, f24, '1h≥3 또는 24h≥15'::text,
           case when f1>=3 or f24>=15 then '🔴' else '✅' end,
           '캐시 없는 기기가 두 길 다 실패해 목록을 못 본 것. 09-24 자동 재시도 배포 후엔 재시도로살림 쪽으로 옮겨가야 정상'::text from c
    union all
    select '재시도로살림(retry_ok)', r1, r24, '정보', '✅', '한 번 실패했다가 2·6초 뒤 재시도로 살아난 방문. 빈화면 대비 이 수가 커야 재시도가 일한다' from c
    union all
    select '우회로(net_fallback)', n1, n24, '1h≥5', case when n1>=5 then '🔴' else '✅' end,
           'supabase.co 실패 → api.momcalendar.com 성공. 손님은 정상 화면. 갑자기 늘면 supabase 쪽 장애' from c
    union all
    select '우회로 중 서버5xx', s1, s24, '24h≥1', case when s24>=1 then '🔴' else '✅' end,
           '우리 서버가 낸 5xx (statement timeout 등). 1건이라도 원인을 찾는다 — event_data 4번째 칸이 요청 경로' from c
    union all
    select '로그인 확정실패', k1, k24, '1h≥2 또는 24h 완료율<70%',
           case when k1>=2 or (ks24>=5 and kd24::numeric/ks24 < 0.7) then '🔴' else '✅' end,
           format('24h 시작 %s · 완료 %s. KOE320 은 성공 직후 옛 ?code 재진입(장애 아님)', ks24, kd24) from c
    union all
    select 'JS오류(js_error)', j1, j24, '1h≥5', case when j1>=5 then '🔴' else '✅' end,
           '🛟 v4 부터 기록(window.onerror). "Script error." 는 외부 스크립트 잡음 — 문구별로 세어 임계를 다시 잡는다' from c
    union all
    select '클릭통계 갱신 지연(분)', stale_min, stale_min, '≤30', case when stale_min>30 then '🔴' else '✅' end,
           'pg_cron 30 이 10분마다 채운다. 멈추면 500 은 안 나지만 TOP100 이 옛 숫자에 멈춘다' from st
    union all
    select '다른 감시기 경보(24h)', n, n, '정보', case when n>0 then '⚠' else '✅' end,
           'login-health·site-health·seo-health·data-health 등이 health_alerts 에 남긴 것. select * from health_alerts order by created_at desc' from ha
  ) t(kind, h1, h24, 임계, 상태, 설명);
$$;
revoke all on function public.error_radar() from public, anon, authenticated;

-- 매시간: 🔴 인 줄을 health_alerts 에 남긴다 (같은 kind 는 갱신, 24시간 지난 radar 경보는 정리)
create or replace function public.run_error_watch()
returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  delete from health_alerts where kind like 'radar:%' and created_at < now() - interval '24 hours';
  for r in select * from error_radar() where 상태 = '🔴' loop
    update health_alerts set detail = format('1h %s · 24h %s (임계 %s) — %s', r.h1, r.h24, r.임계, r.설명), created_at = now()
     where kind = 'radar:' || r.kind;
    if not found then
      insert into health_alerts(kind, detail) values ('radar:' || r.kind, format('1h %s · 24h %s (임계 %s) — %s', r.h1, r.h24, r.임계, r.설명));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.run_error_watch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'error-watch';
select cron.schedule('error-watch', '35 * * * *', $$select public.run_error_watch()$$);

select * from public.error_radar();

-- ROLLBACK
-- select cron.unschedule(jobid) from cron.job where jobname='error-watch';
-- drop function public.run_error_watch(); drop function public.error_radar();
-- delete from health_alerts where kind like 'radar:%';
