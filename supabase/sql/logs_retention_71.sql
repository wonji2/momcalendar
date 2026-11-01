-- 방문기록(visits·visitors) 보관 정책 — events 와 같은 구조 (2026-09-29, 무료 플랜 장기 운영)
--
-- 왜: events 만 정리하면 DB 는 계속 큰다. visits 27MB(+11MB/월) · visitors 10MB(+2.5MB/월) 가 남기 때문이다.
--     events 처럼 **날짜별 요약을 영구 보관하고 원본은 백업에 남긴 뒤** 오래된 raw 만 지운다.
-- 보관 기간이 events(60~90일)보다 긴 180일인 이유: 유입경로(referrer)·시간대 분석은 계절 비교가 필요하고,
--     visits 는 하루 1,650행뿐이라 180일이어도 30만 행(65MB)에 그친다.

create table if not exists public.visits_daily (
  day date primary key,
  n integer not null,          -- 방문 수
  uniq integer not null        -- 서로 다른 기기 수
);
create table if not exists public.visitors_daily (
  day date primary key,
  n integer not null
);
revoke all on table public.visits_daily, public.visitors_daily from public, anon, authenticated;

create or replace function public.visits_rollup(p_before date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cut date := coalesce(p_before, (now() at time zone 'Asia/Seoul')::date); v_n integer; v_m integer;
begin
  insert into visits_daily(day, n, uniq)
  select (visited_at at time zone 'Asia/Seoul')::date, count(*), count(distinct anonymous_id)
    from visits where (visited_at at time zone 'Asia/Seoul')::date < v_cut group by 1
  on conflict (day) do update set n = excluded.n, uniq = excluded.uniq;
  get diagnostics v_n = row_count;
  insert into visitors_daily(day, n)
  select (visited_at at time zone 'Asia/Seoul')::date, count(*)
    from visitors where (visited_at at time zone 'Asia/Seoul')::date < v_cut group by 1
  on conflict (day) do update set n = excluded.n;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function public.visits_rollup(date) from public, anon, authenticated;

-- 내보낸 id 까지만·요약이 있을 때만 지운다 (events_purge 와 같은 규칙)
create or replace function public.visits_purge(p_keep_days integer default 180, p_max_visits_id bigint default null, p_max_visitors_id bigint default null, p_apply boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_cut timestamptz; v_cutday date; v_a bigint; v_b bigint; v_da bigint := 0; v_db bigint := 0; v_roll bigint;
begin
  if p_max_visits_id is null or p_max_visitors_id is null then return '🔴 내보내기 물높이 없이는 아무것도 지우지 않는다'; end if;
  v_cut := now() - make_interval(days => p_keep_days);
  v_cutday := (v_cut at time zone 'Asia/Seoul')::date;
  select count(*) into v_a from visits where visited_at < v_cut and id <= p_max_visits_id;
  select count(*) into v_b from visitors where visited_at < v_cut and id <= p_max_visitors_id;
  select count(*) into v_roll from visits_daily where day < v_cutday;
  if v_roll = 0 and v_a > 0 then return format('🔴 요약 먼저: visits_daily 에 %s 이전 자료가 없다', v_cutday); end if;
  if p_apply then
    delete from visits where visited_at < v_cut and id <= p_max_visits_id; get diagnostics v_da = row_count;
    delete from visitors where visited_at < v_cut and id <= p_max_visitors_id; get diagnostics v_db = row_count;
    insert into health_alerts(kind, detail) values ('visits_보관정리', format('%s일 이전 visits %s행·visitors %s행 삭제', p_keep_days, v_da, v_db));
  end if;
  return format('%s일 이전 대상 visits %s행 · visitors %s행%s', p_keep_days, v_a, v_b,
    case when p_apply then format(' → %s·%s행 삭제됨', v_da, v_db) else ' (시험만 함)' end);
end $$;
revoke all on function public.visits_purge(integer, bigint, bigint, boolean) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'visits-rollup';
select cron.schedule('visits-rollup', '25 20 * * *', $$select public.visits_rollup()$$);  -- KST 05:25

select public.visits_rollup() as 요약행수;
select public.visits_purge(180, null, null, false) as 삭제시험;
