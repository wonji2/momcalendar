-- 로그인 감시 v56 (2026-09-02) — login_watch_55 를 대체한다.
--
-- 🔴 v55 가 만든 결함 (검증 지적)
--   ① dedupe 키에 **건수가 들어간 문구**를 써서, 트래픽이 조금만 움직여도 새 행이 됐다
--      (실데이터 재현: 하루 24회차 → 서로 다른 문구 8개 → health_alerts 에 같은 사고가 8줄)
--   ② 세션이 health_alerts 행을 지우면 login_alerts 행이 남아 exists 가 참이 되고,
--      그 뒤로는 UPDATE 만 돌아 **그날 남은 시간 동안 사람이 보는 곳에 경보가 두 번 다시 안 떴다.**
--      장애가 이어져도 아무도 모른다. 규칙 0-B("확인한 경보는 지운다")와 정면으로 부딪친다.
--
-- 🔑 바로잡는 방식
--   · login_alerts 는 **이력**이라 회차마다 남긴다(숫자 컬럼을 채워 추이를 본다)
--   · health_alerts 는 **할 일 목록**이라 미해결이 하나 있으면 더 안 쌓는다.
--     세션이 지우면 다음 회차에 **다시 뜬다** → 지웠는데 문제가 남아 있으면 반드시 재발견된다.
create or replace function public.check_login_health(p_hours int default 3)
returns table(miss int, rate numeric, msg text)
language plpgsql security definer set search_path = public
as $$
declare s int; d int; fh int; fg int; r numeric; t text; env text; since timestamptz; today date;
begin
  since := now() - make_interval(hours => p_hours);
  today := (now() at time zone 'Asia/Seoul')::date;

  select count(*) filter (where event_type='kakao_login_start'),
         count(*) filter (where event_type='kakao_login_done'),
         -- 확정실패 : 파이프가 있고 '추정' 이 어디에도 없는 것
         --   ⚠ scratchpad/login_health.sql 과 **같은 조건**이어야 한다. 어긋나면 사람과 서버가 다른 답을 낸다.
         count(*) filter (where event_type='kakao_login_fail'
                            and event_data like '%|%' and event_data not like '%|추정%'),
         count(*) filter (where event_type='kakao_login_fail'
                            and (event_data not like '%|%' or event_data like '%|추정%'))
    into s, d, fh, fg
  from public.events
  where event_type like 'kakao_login%' and visited_at >= since;

  r := case when s > 0 then round(d::numeric * 100 / s, 1) else null end;

  select string_agg(distinct coalesce(nullif(split_part(event_data,'|',1),''),'(구버전)'), ', ')
    into env
  from public.events
  where event_type='kakao_login_start' and visited_at >= since;

  if fh > 0 then
    t := format('최근 %s시간 로그인 확정실패 %s건 (시작 %s · 완료 %s · 추정 %s · 성공률 %s%%) 환경 [%s]',
                p_hours, fh, s, d, fg, coalesce(r::text,'-'), coalesce(env,'-'));

    -- 이력은 회차마다 남긴다 (숫자 컬럼을 채워 추이를 볼 수 있게)
    insert into public.login_alerts(day, start_cnt, done_cnt, fail_cnt, miss_cnt, rate, detail)
    values (today, s, d, fh + fg, fh, r, t);

    -- 사람이 보는 곳에는 **미해결이 없을 때만** 새로 올린다.
    --   세션이 지웠다 = 확인·시정했다는 뜻 → 그래도 문제가 남아 있으면 다음 회차에 다시 뜬다.
    if not exists (select 1 from public.health_alerts where kind = '로그인확정실패') then
      insert into public.health_alerts(kind, detail) values ('로그인확정실패', t);
    end if;

    return query select fh, r, t;
  end if;
end $$;
revoke all on function public.check_login_health(int) from public, anon, authenticated;
grant execute on function public.check_login_health(int) to service_role;

-- v54 가 남긴 day=NULL 행 정리 (dedupe·집계에서 계속 겉돈다)
update public.login_alerts set day = (at at time zone 'Asia/Seoul')::date where day is null;
