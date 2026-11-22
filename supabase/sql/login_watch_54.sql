-- 로그인 감시 v54 (2026-09-02) — login_watch_36 을 대체한다.
--
-- 🔴 왜 고치나 (검증에서 실측으로 드러난 것)
--   ① 판정이 **끝자리**(`not like '%|추정'`)였는데, 2026-09-02 부터 이벤트 끝에
--      기기표시 `|d=xxxxxxxx` 와 시도날짜 `|t=YYYY-MM-DD` 가 붙는다.
--      → 새 형식은 `|추정` 으로 끝나지 않아 **추정실패가 전부 확정실패로 잡힌다.**
--        고정 규칙 0("확정실패 1건이면 원인부터")이 가짜 경보로 헛돈다.
--   ② 경보 문구의 '환경' 목록이 `event_data` 원문이라 기기표시가 붙으면
--      `web|d=1a2b3c4d` 처럼 기기 수만큼 나열된다 → 환경만 뽑는다.
--   ③ `login_watch_36` 이 `login_alerts` INSERT 를 빠뜨려 2026-08-05 이후 한 줄도 안 쌓였다.
--      매시간 메시지를 만들고 버리고 있었다 → 다시 적재한다.
create or replace function public.check_login_health(p_hours int default 3)
returns table(miss int, rate numeric, msg text)
language plpgsql security definer set search_path = public
as $$
declare s int; d int; fh int; fg int; m int; r numeric; t text; since timestamptz;
begin
  since := now() - make_interval(hours => p_hours);
  select count(*) filter (where event_type='kakao_login_start'),
         count(*) filter (where event_type='kakao_login_done'),
         -- 확정실패 : 파이프가 있고 '추정' 이 **어디에도** 없는 것 (끝자리로 보면 안 된다)
         count(*) filter (where event_type='kakao_login_fail'
                            and event_data like '%|%' and event_data not like '%|추정%'),
         count(*) filter (where event_type='kakao_login_fail'
                            and (event_data not like '%|%' or event_data like '%|추정%'))
    into s, d, fh, fg
  from public.events
  where event_type like 'kakao_login%' and visited_at >= since;

  m := fh;
  r := case when s > 0 then round(d::numeric * 100 / s, 1) else null end;

  -- 환경만 뽑는다 (기기표시가 붙어도 목록이 안 늘어나게)
  select string_agg(distinct coalesce(nullif(split_part(event_data,'|',1),''),'(구버전)'), ', ')
    into t
  from public.events
  where event_type='kakao_login_start' and visited_at >= since;

  if fh > 0 then
    m := fh;
    t := format('최근 %s시간 로그인 확정실패 %s건 (시작 %s · 완료 %s · 추정 %s · 성공률 %s%%) 환경 [%s]',
                p_hours, fh, s, d, fg, coalesce(r::text,'-'), coalesce(t,'-'));
    -- 경보를 남긴다 — 만들고 버리면 감시가 아니다
    insert into public.login_alerts(detail) values (t);
    return query select m, r, t;
  end if;
end $$;
revoke all on function public.check_login_health(int) from public, anon, authenticated;
grant execute on function public.check_login_health(int) to service_role;
