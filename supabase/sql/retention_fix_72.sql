-- 🔴 보관 정리 결함 수정 (검증자 발견 2026-09-29 21:40)
--
-- 무엇이 잘못됐나: events_purge 는 `visited_at < now() - 90일` 로 잘랐다. 이 컷은 **날짜 한가운데**라
--   경계일이 반쪽만 지워지고, 다음 회차의 events_rollup 이 **남은 반쪽으로 영구 요약을 덮어썼다**.
--   실측: 2026-07-01 의 요약이 1951 → 301 (85% 손실). 이대로 두면 **모든 날짜가 90일 창을 지날 때마다**
--   그날 새벽 분량을 영구히 잃는다. "영구 보관" 이 거짓말이 된다.
--
-- 어떻게 고치나 (두 겹)
--   ① 컷을 **KST 날짜 경계**로 — 하루는 통째로 남거나 통째로 지워진다. 통째로 지워진 날은 raw 가 0행이라
--      롤업이 그 날짜 행을 아예 만들지 않는다 → 덮어쓸 일이 없다.
--   ② 그래도 혹시 모르니 롤업을 **줄어들지 않게** — on conflict 에서 greatest() 를 쓴다.
--      (건수는 지나간 날엔 늘기만 한다. 줄어들었다면 그건 지워진 것이지 고쳐야 할 값이 아니다)

-- ① events
create or replace function public.events_rollup(p_before date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cut date := coalesce(p_before, (now() at time zone 'Asia/Seoul')::date); v_n integer;
begin
  insert into events_daily(day, event_type, n)
  select (visited_at at time zone 'Asia/Seoul')::date d, event_type, count(*)
    from events where (visited_at at time zone 'Asia/Seoul')::date < v_cut
    group by 1, 2
  -- 🔴 줄어들지 않는다 — 지워진 날을 다시 세어 덮는 사고를 막는다(2026-09-29)
  on conflict (day, event_type) do update set n = greatest(events_daily.n, excluded.n);
  get diagnostics v_n = row_count; return v_n;
end $$;
revoke all on function public.events_rollup(date) from public, anon, authenticated;

create or replace function public.events_purge(p_keep_days integer default 90, p_max_id bigint default null, p_apply boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_cutday date; v_n bigint; v_roll bigint; v_del bigint := 0;
begin
  if p_max_id is null then return '🔴 p_max_id(내보내기 물높이) 없이는 아무것도 지우지 않는다'; end if;
  -- 🔴 KST 날짜 경계로 자른다 — 하루를 반만 지우면 그날 요약이 다음 롤업에 덮인다(2026-09-29 사고)
  v_cutday := (now() at time zone 'Asia/Seoul')::date - p_keep_days;
  select count(*) into v_n from events where (visited_at at time zone 'Asia/Seoul')::date < v_cutday and id <= p_max_id;
  select count(*) into v_roll from events_daily where day < v_cutday;
  if v_roll = 0 and v_n > 0 then return format('🔴 롤업 먼저: events_daily 에 %s 이전 자료가 없다', v_cutday); end if;
  if p_apply then
    delete from events where (visited_at at time zone 'Asia/Seoul')::date < v_cutday and id <= p_max_id;
    get diagnostics v_del = row_count;
    insert into health_alerts(kind, detail) values ('events_보관정리', format('%s(KST) 이전 %s행 삭제(내보낸 id %s 까지)', v_cutday, v_del, p_max_id));
  end if;
  return format('%s(KST) 이전·내보낸 id %s 까지 대상 %s행%s', v_cutday, p_max_id, v_n,
    case when p_apply then format(' → %s행 삭제됨', v_del) else ' (시험만 함 — 지우려면 p_apply=true)' end);
end $$;
revoke all on function public.events_purge(integer, bigint, boolean) from public, anon, authenticated;

-- ② visits·visitors 도 같은 결함이 있다 (180일째에 똑같이 터진다)
create or replace function public.visits_rollup(p_before date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cut date := coalesce(p_before, (now() at time zone 'Asia/Seoul')::date); v_n integer; v_m integer;
begin
  insert into visits_daily(day, n, uniq)
  select (visited_at at time zone 'Asia/Seoul')::date, count(*), count(distinct anonymous_id)
    from visits where (visited_at at time zone 'Asia/Seoul')::date < v_cut group by 1
  on conflict (day) do update set n = greatest(visits_daily.n, excluded.n), uniq = greatest(visits_daily.uniq, excluded.uniq);
  get diagnostics v_n = row_count;
  insert into visitors_daily(day, n)
  select (visited_at at time zone 'Asia/Seoul')::date, count(*)
    from visitors where (visited_at at time zone 'Asia/Seoul')::date < v_cut group by 1
  on conflict (day) do update set n = greatest(visitors_daily.n, excluded.n);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function public.visits_rollup(date) from public, anon, authenticated;

create or replace function public.visits_purge(p_keep_days integer default 180, p_max_visits_id bigint default null, p_max_visitors_id bigint default null, p_apply boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_cutday date; v_a bigint; v_b bigint; v_da bigint := 0; v_db bigint := 0; v_roll bigint;
begin
  if p_max_visits_id is null or p_max_visitors_id is null then return '🔴 내보내기 물높이 없이는 아무것도 지우지 않는다'; end if;
  v_cutday := (now() at time zone 'Asia/Seoul')::date - p_keep_days;
  select count(*) into v_a from visits where (visited_at at time zone 'Asia/Seoul')::date < v_cutday and id <= p_max_visits_id;
  select count(*) into v_b from visitors where (visited_at at time zone 'Asia/Seoul')::date < v_cutday and id <= p_max_visitors_id;
  select count(*) into v_roll from visits_daily where day < v_cutday;
  if v_roll = 0 and v_a > 0 then return format('🔴 요약 먼저: visits_daily 에 %s 이전 자료가 없다', v_cutday); end if;
  if p_apply then
    delete from visits where (visited_at at time zone 'Asia/Seoul')::date < v_cutday and id <= p_max_visits_id; get diagnostics v_da = row_count;
    delete from visitors where (visited_at at time zone 'Asia/Seoul')::date < v_cutday and id <= p_max_visitors_id; get diagnostics v_db = row_count;
    insert into health_alerts(kind, detail) values ('visits_보관정리', format('%s(KST) 이전 visits %s행·visitors %s행 삭제', v_cutday, v_da, v_db));
  end if;
  return format('%s(KST) 이전 대상 visits %s행 · visitors %s행%s', v_cutday, v_a, v_b,
    case when p_apply then format(' → %s·%s행 삭제됨', v_da, v_db) else ' (시험만 함)' end);
end $$;
revoke all on function public.visits_purge(integer, bigint, bigint, boolean) from public, anon, authenticated;

-- ③ 크론 롤업을 정리 작업(05:20)과 겹치지 않게 앞으로 옮긴다 — 같은 분에 둘이 돌던 것
select cron.unschedule(jobid) from cron.job where jobname in ('events-rollup', 'visits-rollup');
select cron.schedule('events-rollup', '10 19 * * *', $$select public.events_rollup()$$);   -- KST 04:10 (내보내기 04:40 전)
select cron.schedule('visits-rollup', '12 19 * * *', $$select public.visits_rollup()$$);    -- KST 04:12

select public.events_purge(90, (select max(id) from events), false) as events_시험;
select public.visits_purge(180, (select max(id) from visits), (select max(id) from visitors), false) as visits_시험;
