-- 카카오 로그인 실패 자동 감시 — 사장님 지시 2026-08-05
--   "카톡 로그인 1건이라도 오류나면 바로 최우선으로 달라붙어서 고쳐야지"
-- 사람이 제보해야 알 수 있던 구조를 바꾼다. 실패가 생기면 시스템이 먼저 안다.

create table if not exists public.login_alerts(
  id          bigserial primary key,
  at          timestamptz default now(),
  day         date,
  start_cnt   int,
  done_cnt    int,
  fail_cnt    int,
  miss_cnt    int,          -- 시작했는데 못 끝낸 수
  rate        numeric,      -- 성공률(%)
  detail      text,
  notified    boolean default false
);

-- 최근 N시간 로그인 상태를 보고, 미완료가 있으면 경보를 남긴다.
create or replace function public.check_login_health(p_hours int default 3)
returns table(miss int, rate numeric, msg text)
language plpgsql security definer set search_path = public
as $$
declare s int; d int; f int; m int; r numeric; t text; since timestamptz;
begin
  since := now() - make_interval(hours => p_hours);
  select count(*) filter (where event_type='kakao_login_start'),
         count(*) filter (where event_type='kakao_login_done'),
         count(*) filter (where event_type='kakao_login_fail')
    into s, d, f
  from public.events
  where event_type like 'kakao_login%' and visited_at >= since;

  m := greatest(s - d, 0);
  r := case when s > 0 then round(d::numeric * 100 / s, 1) else null end;

  -- 어떤 환경에서 시작했는지 (새 코드부터 inapp/web 이 찍힌다)
  select string_agg(distinct coalesce(nullif(event_data,''),'(구버전)'), ', ')
    into t
  from public.events
  where event_type='kakao_login_start' and visited_at >= since;

  if m > 0 then
    insert into public.login_alerts(day, start_cnt, done_cnt, fail_cnt, miss_cnt, rate, detail)
    values ((now() at time zone 'Asia/Seoul')::date, s, d, f, m, r,
            format('최근 %s시간: 시작 %s · 완료 %s · 미완료 %s · 성공률 %s%% · 환경 [%s]',
                   p_hours, s, d, m, coalesce(r::text,'-'), coalesce(t,'-')));
  end if;

  return query select m, r,
    case when m > 0
      then format('⚠️ 로그인 미완료 %s건 (성공률 %s%%)', m, coalesce(r::text,'-'))
      else '정상' end;
end $$;

revoke all on function public.check_login_health(int) from public, anon;

-- 관리자 화면에서 읽을 수 있게 (사장님만)
alter table public.login_alerts enable row level security;
drop policy if exists login_alerts_admin on public.login_alerts;
create policy login_alerts_admin on public.login_alerts
  for select to authenticated using (public.is_app_admin());

-- 매시간 정각에 점검
select cron.unschedule('login-health')
  where exists (select 1 from cron.job where jobname='login-health');
select cron.schedule('login-health', '5 * * * *', $$select public.check_login_health(3)$$);

-- 지금 한 번 돌려본다
select * from public.check_login_health(24);
