-- 라이브 실제 화면 검사를 PC 와 상관없이 (사장님 2026-10-27 「컴퓨터 전원과 상관없이 실시간 감시」)
--   깃허브 Actions(live-watch.yml, 10분마다)가 tools/daily/live_smoke.mjs --ci 를 돌려 결과를 이 표에 넣는다.
--   서버(pg_cron site-watch-guard, 10분마다)가 이 표만 보고 판정한다:
--     · 마지막 두 회차가 연달아 실패 → health_alerts 'watch:fail' (한 번 실패는 망 흔들림일 수 있어 두 번)
--     · 40분 넘게 결과가 안 옴(감시기 자체가 멈춤) → health_alerts 'watch:stale'
--     · 정상으로 돌아오면 두 줄을 지운다
--   관리자 화면(ops.html 맨 위 「손님 화면 실시간 검사」)은 site_watch_recent() 로 읽는다(관리자만).
--   한도: 하루 144행 × 약 300B ≈ 월 1.3MB, 14일만 보관(site-watch-prune) → 0.6MB 고정 (LONG_TERM_REGISTER 에 적음)

create table if not exists public.site_watch (
  id bigserial primary key,
  at timestamptz not null default now(),
  source text not null default 'ci',          -- ci(깃허브) · pc(이 PC 예약작업)
  ok_n int not null default 0,
  fail_n int not null default 0,
  fails text[] not null default '{}',
  run_url text
);
create index if not exists site_watch_at on public.site_watch (at desc);
alter table public.site_watch enable row level security;
revoke all on public.site_watch from anon, authenticated;

create or replace function public.site_watch_guard()
returns text language plpgsql security definer set search_path = public as $$
declare last2 record; n_fail int; last_at timestamptz; msg text;
begin
  select max(at) into last_at from site_watch where source = 'ci';
  if last_at is null or last_at < now() - interval '40 minutes' then
    msg := format('손님 화면 실시간 검사 결과가 %s 이후 안 들어옴 — 깃허브 Actions live-watch.yml 확인', coalesce(to_char(last_at at time zone 'Asia/Seoul','MM-DD HH24:MI'),'한 번도'));
    update health_alerts set detail = msg, created_at = now() where kind = 'watch:stale';
    if not found then insert into health_alerts(kind, detail) values ('watch:stale', msg); end if;
  else
    delete from health_alerts where kind = 'watch:stale';
  end if;

  select count(*) filter (where fail_n > 0) into n_fail
    from (select fail_n from site_watch where source = 'ci' order by at desc limit 2) t;
  if n_fail = 2 then
    select array_to_string(fails[1:3], ' / ') as f, fail_n into last2 from site_watch where source = 'ci' order by at desc limit 1;
    msg := format('🔴 손님 화면 검사 2회 연속 실패 %s건: %s', last2.fail_n, last2.f);
    update health_alerts set detail = msg, created_at = now() where kind = 'watch:fail';
    if not found then insert into health_alerts(kind, detail) values ('watch:fail', msg); end if;
    return msg;
  else
    delete from health_alerts where kind = 'watch:fail';
  end if;
  return 'ok';
end $$;
revoke all on function public.site_watch_guard() from anon, authenticated, public;

create or replace function public.site_watch_recent(p_limit int default 36)
returns table(at text, at_iso text, source text, ok_n int, fail_n int, fails text[], run_url text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  return query select to_char(w.at at time zone 'Asia/Seoul','MM-DD HH24:MI'), to_char(w.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'), w.source, w.ok_n, w.fail_n, w.fails, w.run_url
    from site_watch w order by w.at desc limit least(greatest(p_limit,1),200);
end $$;
revoke all on function public.site_watch_recent(int) from anon, public;
grant execute on function public.site_watch_recent(int) to authenticated;

select cron.schedule('site-watch-guard', '*/10 * * * *', $$select public.site_watch_guard()$$);
select cron.schedule('site-watch-prune', '50 4 * * *', $$delete from public.site_watch where at < now() - interval '14 days'$$);
