-- 사이트 전반 오류 감시 — 사장님 지시 2026-08-05
--   "니가 감시 관리 수정 할 수 있는 모든 방법을 총동원해서 오류 하루에 하나도 없게해"
-- 로그인만 보던 감시를 사이트 전체로 넓힌다. 사람이 제보하기 전에 시스템이 먼저 안다.

create table if not exists public.site_alerts(
  id       bigserial primary key,
  at       timestamptz default now(),
  kind     text,        -- login / data / link / ics / hotdeal / gonggu
  level    text,        -- warn / bad
  msg      text,
  n        int
);

create or replace function public.check_site_health(p_hours int default 3)
returns table(kind text, level text, msg text, n int)
language plpgsql security definer set search_path = public
as $$
declare since timestamptz; s int; d int; f int; miss int; rate numeric;
        nfall int; nfail int; nics int; nhd int; ngg int; today_kst date;
begin
  since := now() - make_interval(hours => p_hours);
  today_kst := (now() at time zone 'Asia/Seoul')::date;

  -- ① 로그인: 시작했는데 못 끝낸 사람
  select count(*) filter (where event_type='kakao_login_start'),
         count(*) filter (where event_type='kakao_login_done'),
         count(*) filter (where event_type='kakao_login_fail')
    into s, d, f
  from public.events where event_type like 'kakao_login%' and visited_at >= since;
  miss := greatest(s - d, 0);
  rate := case when s > 0 then round(d::numeric*100/s, 1) end;
  if miss > 0 then
    return query select 'login'::text, (case when miss>=3 then 'bad' else 'warn' end)::text,
      format('로그인 미완료 %s건 (시작 %s · 완료 %s · 성공률 %s%%)', miss, s, d, coalesce(rate::text,'-')), miss;
  end if;

  -- ② 데이터 로드 실패 (손님이 빈 화면을 봤다는 뜻)
  select count(*) into nfail from public.events
   where event_type='data_load_fail' and visited_at >= since;
  if nfail > 0 then
    return query select 'data'::text,'bad'::text,
      format('공구 목록을 못 불러온 사람 %s명 — 빈 화면을 봤다', nfail), nfail;
  end if;

  select count(*) into nfall from public.events
   where event_type='data_load_fallback' and visited_at >= since;
  if nfall > 0 then
    return query select 'data'::text,'warn'::text,
      format('통신 실패로 옛 목록을 대신 보여준 횟수 %s', nfall), nfall;
  end if;

  -- ③ 인앱에서 캘린더 내보내기가 막힌 횟수 (많으면 앱 설치 안내를 손볼 신호)
  select count(*) into nics from public.events
   where event_type='ics_blocked_inapp' and visited_at >= since;
  if nics >= 3 then
    return query select 'ics'::text,'warn'::text,
      format('인앱에서 캘린더 내보내기가 막힌 횟수 %s', nics), nics;
  end if;

  -- ④ 오늘 노출될 핫딜이 하나도 없나 (수집 파이프라인이 멎었다는 신호)
  select count(*) into nhd from public.hotdeals
   where (expires_at is null or expires_at > now());
  if nhd = 0 then
    return query select 'hotdeal'::text,'bad'::text,'노출 중인 핫딜이 0건 — 수집이 멎었을 수 있다'::text, 0;
  end if;

  -- ⑤ 오늘 진행 중인 공구가 비정상적으로 적나
  select count(*) into ngg from public.gonggu
   where approved = true
     and open_date <= to_char(today_kst,'YYYY-MM-DD')
     and end_date  >= to_char(today_kst,'YYYY-MM-DD');
  if ngg < 30 then
    return query select 'gonggu'::text,'bad'::text,
      format('오늘 진행 중인 공구가 %s건뿐 — 데이터에 문제가 있을 수 있다', ngg), ngg;
  end if;

  return;
end $$;

revoke all on function public.check_site_health(int) from public, anon;

-- 감시 결과를 표에 쌓는다(경보가 있을 때만)
create or replace function public.run_site_watch()
returns int
language plpgsql security definer set search_path = public
as $$
declare r record; c int := 0;
begin
  for r in select * from public.check_site_health(3) loop
    insert into public.site_alerts(kind, level, msg, n) values (r.kind, r.level, r.msg, r.n);
    c := c + 1;
  end loop;
  return c;
end $$;

revoke all on function public.run_site_watch() from public, anon;

alter table public.site_alerts enable row level security;
drop policy if exists site_alerts_admin on public.site_alerts;
create policy site_alerts_admin on public.site_alerts
  for select to authenticated using (public.is_app_admin());

-- 매시간 15분에 점검 (로그인 감시는 05분에 따로 돈다)
select cron.unschedule('site-health')
  where exists (select 1 from cron.job where jobname='site-health');
select cron.schedule('site-health','15 * * * *', $$select public.run_site_watch()$$);

-- 지금 상태 확인
select * from public.check_site_health(24);
