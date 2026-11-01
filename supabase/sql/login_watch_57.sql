-- 로그인 감시 v57 (2026-09-02) — login_watch_56 을 대체한다.
--
-- 🔴 v56 이 남긴 결함 (검증 지적, 전부 실측으로 확인됨)
--   ① kind 게이트에 **시간 조건이 없어** 어제 안 지운 경보가 오늘 새 사고를 가린다.
--      실제로 health_alerts 에 profile_stale 이 12일째 남아 있다 — 가정이 아니라 현실이다.
--   ② 경보가 첫 발생 문구에 **얼어붙는다.** 4건이 40건이 돼도 화면엔 4건으로 보인다.
--   ③ created_at 도 첫 발생 시각이라 세션이 "어제 본 것" 으로 넘긴다.
create or replace function public.check_login_health(p_hours int default 3)
returns table(miss int, rate numeric, msg text)
language plpgsql security definer set search_path = public
as $$
declare s int; d int; fh int; fg int; r numeric; t text; env text;
        since timestamptz; today date; hid bigint;
begin
  since := now() - make_interval(hours => p_hours);
  today := (now() at time zone 'Asia/Seoul')::date;

  select count(*) filter (where event_type='kakao_login_start'),
         count(*) filter (where event_type='kakao_login_done'),
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

    -- 이력 (추이용) — 회차마다 남긴다
    insert into public.login_alerts(day, start_cnt, done_cnt, fail_cnt, miss_cnt, rate, detail)
    values (today, s, d, fh + fg, fh, r, t);

    -- 사람이 보는 곳: **오늘 것만** 본다. 어제 남은 경보가 오늘 사고를 가리면 안 된다.
    select id into hid from public.health_alerts
     where kind = '로그인확정실패'
       and (created_at at time zone 'Asia/Seoul')::date = today
     order by id desc limit 1;

    if hid is null then
      insert into public.health_alerts(kind, detail) values ('로그인확정실패', t);
    else
      -- 이미 있으면 **최신 숫자로 갱신**한다. 첫 문구에 얼어붙으면 4건이 40건이 돼도 모른다.
      update public.health_alerts set detail = t, created_at = now() where id = hid;
    end if;

    return query select fh, r, t;
  end if;
end $$;
revoke all on function public.check_login_health(int) from public, anon, authenticated;
grant execute on function public.check_login_health(int) to service_role;

-- 존재한 적 없는 장애를 기록한 행 정리 (그 원인 이벤트는 검증 흔적이라 이미 삭제됨)
delete from public.login_alerts where id = 7;
