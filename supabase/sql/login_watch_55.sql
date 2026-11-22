-- 로그인 감시 v55 (2026-09-02) — login_watch_54 를 대체한다.
--
-- 🔴 왜 또 고치나 (검증 지적)
--   ① v54 가 login_alerts 에 detail 한 칸만 넣어 숫자 컬럼이 전부 NULL 이다 → 추이 분석 불가.
--      v31 처럼 day·start_cnt·done_cnt·fail_cnt·miss_cnt·rate 를 채운다.
--   ② 같은 사고로 매시간 새 행이 쌓인다(11:05·12:05·13:05 …) → **같은 날 같은 내용이면 갱신만** 한다.
--   ③ **아무도 login_alerts 를 안 읽는다** (admin.html·레포 전체에서 참조 0곳).
--      세션이 매번 보는 곳은 health_alerts 다 → 거기에도 넣는다. 그래야 사람이 본다.
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
         -- 확정실패 : 파이프가 있고 '추정' 이 **어디에도** 없는 것 (끝자리로 보면 |d= 때문에 틀린다)
         count(*) filter (where event_type='kakao_login_fail'
                            and event_data like '%|%' and event_data not like '%|추정%'),
         count(*) filter (where event_type='kakao_login_fail'
                            and (event_data not like '%|%' or event_data like '%|추정%'))
    into s, d, fh, fg
  from public.events
  where event_type like 'kakao_login%' and visited_at >= since;

  r := case when s > 0 then round(d::numeric * 100 / s, 1) else null end;

  -- 환경만 뽑는다 (기기표시 |d= 가 붙어도 목록이 안 늘어나게)
  select string_agg(distinct coalesce(nullif(split_part(event_data,'|',1),''),'(구버전)'), ', ')
    into env
  from public.events
  where event_type='kakao_login_start' and visited_at >= since;

  if fh > 0 then
    t := format('최근 %s시간 로그인 확정실패 %s건 (시작 %s · 완료 %s · 추정 %s · 성공률 %s%%) 환경 [%s]',
                p_hours, fh, s, d, fg, coalesce(r::text,'-'), coalesce(env,'-'));

    -- 같은 날 같은 내용이면 새로 쌓지 않고 갱신만 한다 (매시간 중복 방지)
    if exists (select 1 from public.login_alerts where day = today and detail = t) then
      update public.login_alerts set at = now() where day = today and detail = t;
    else
      insert into public.login_alerts(day, start_cnt, done_cnt, fail_cnt, miss_cnt, rate, detail)
      values (today, s, d, fh + fg, fh, r, t);
      -- 🔑 세션이 실제로 보는 곳은 health_alerts 다. 여기 없으면 아무도 모른다.
      insert into public.health_alerts(kind, detail) values ('로그인확정실패', t);
    end if;

    return query select fh, r, t;
  end if;
end $$;
revoke all on function public.check_login_health(int) from public, anon, authenticated;
grant execute on function public.check_login_health(int) to service_role;
