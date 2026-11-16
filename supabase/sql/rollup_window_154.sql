-- 새벽 집계(events-rollup 04:10 · visits-rollup 04:12)가 매일 표 전체(45일치, events 192MB)를 다시 세던 것을 최근 7일만 세게 (2026-11-17)
--   왜: 무료 Nano DB 에서 8~24초 걸려 그 사이 손님 요청(anon 3초 제한)이 500 — 레이더 「우회로 중 서버5xx」 11-16 04:12 건.
--   · 인자 없이 부르면(크론·db_retention) 오늘 앞 7일만. 그 앞 날짜는 이미 지난 회차가 세어 뒀고 greatest 라 줄지 않는다.
--   · 날짜를 주면(p_before) 예전처럼 그 날짜 앞 전부 — 크론이 7일 넘게 멈췄을 때 손으로 메우는 길: select events_rollup(current_date); select visits_rollup(current_date);
--   · 조건을 visited_at 범위로 써서 시각 인덱스(events_time_type_idx · visits_time_idx · visitors_visited_at_idx)를 탄다.
create or replace function public.events_rollup(p_before date default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_cut date := coalesce(p_before, (now() at time zone 'Asia/Seoul')::date); v_n integer;
  v_hi timestamptz := v_cut::timestamp at time zone 'Asia/Seoul';
  v_lo timestamptz := case when p_before is null then (v_cut - 7)::timestamp at time zone 'Asia/Seoul' else '-infinity'::timestamptz end;
begin
  insert into events_daily(day, event_type, n)
  select (visited_at at time zone 'Asia/Seoul')::date d, event_type, count(*)
    from events where visited_at >= v_lo and visited_at < v_hi
    group by 1, 2
  -- 🔴 줄어들지 않는다 — 지워진 날을 다시 세어 덮는 사고를 막는다(2026-09-29)
  on conflict (day, event_type) do update set n = greatest(events_daily.n, excluded.n);
  get diagnostics v_n = row_count; return v_n;
end $function$;

create or replace function public.visits_rollup(p_before date default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_cut date := coalesce(p_before, (now() at time zone 'Asia/Seoul')::date); v_n integer; v_m integer;
  v_hi timestamptz := v_cut::timestamp at time zone 'Asia/Seoul';
  v_lo timestamptz := case when p_before is null then (v_cut - 7)::timestamp at time zone 'Asia/Seoul' else '-infinity'::timestamptz end;
begin
  insert into visits_daily(day, n, uniq)
  select (visited_at at time zone 'Asia/Seoul')::date, count(*), count(distinct anonymous_id)
    from visits where visited_at >= v_lo and visited_at < v_hi group by 1
  on conflict (day) do update set n = greatest(visits_daily.n, excluded.n), uniq = greatest(visits_daily.uniq, excluded.uniq);
  get diagnostics v_n = row_count;
  insert into visitors_daily(day, n)
  select (visited_at at time zone 'Asia/Seoul')::date, count(*)
    from visitors where visited_at >= v_lo and visited_at < v_hi group by 1
  on conflict (day) do update set n = greatest(visitors_daily.n, excluded.n);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $function$;
