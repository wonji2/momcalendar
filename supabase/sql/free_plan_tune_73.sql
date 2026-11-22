-- 무료 플랜 마무리 손질 (검증자 지적 2026-09-29 23:10)
--
-- ① visitors.visited_at 인덱스 — 이 표에 인덱스가 pkey 뿐이라 관리자 화면 질의가 매번 전수훑기+정렬을 했다.
--    실측: 그 질의 하나가 **DB 전체 CPU 의 61%**(하루 1,686회 × 647ms). 지금은 shared_buffers 224MB 가
--    표를 통째로 물고 있어 안 느껴지지만, 무료 Nano(0.5GB)로 내려가면 그 전제가 깨진다. 인덱스 약 3MB.
create index if not exists visitors_visited_at_idx on public.visitors (visited_at);
analyze public.visitors;

-- ② 지킴이가 "며칠 남음" 대신 **평형점**을 말하게 한다.
--    보관 정리가 도는 한 DB 는 500MB 로 달리는 게 아니라 어느 크기에서 **평평해진다**. 그런데 전 판은
--    삭제를 계산에 안 넣어 "94일 남음" 으로 읽혔다(틀린 그림). 이제 지금 트래픽이 그대로일 때 도달할
--    크기를 계산해 400MB 를 넘으면 알린다 — 그게 진짜 신호다. 레버는 events 보관일(기본 90 → 60).
create or replace function public.free_plan_guard()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_db numeric; v_store numeric;
  v_ev_day numeric; v_vi_day numeric; v_vo_day numeric;
  v_ev_b numeric; v_vi_b numeric; v_vo_b numeric;
  v_logs_now numeric; v_rest numeric; v_eq numeric; v_msg text := '';
  c_ev_keep constant int := 90; c_vi_keep constant int := 180;
begin
  select round(pg_database_size(current_database())/1048576.0,1) into v_db;
  select round(coalesce(sum((metadata->>'size')::bigint),0)/1048576.0,1) into v_store from storage.objects;

  -- 하루 행수(최근 7일) 와 행당 바이트(인덱스 포함)
  select count(*)/7.0 into v_ev_day from events where visited_at > now()-interval '7 days';
  select count(*)/7.0 into v_vi_day from visits where visited_at > now()-interval '7 days';
  select count(*)/7.0 into v_vo_day from visitors where visited_at > now()-interval '7 days';
  select pg_total_relation_size('events')::numeric / greatest((select count(*) from events),1) into v_ev_b;
  select pg_total_relation_size('visits')::numeric / greatest((select count(*) from visits),1) into v_vi_b;
  select pg_total_relation_size('visitors')::numeric / greatest((select count(*) from visitors),1) into v_vo_b;

  v_logs_now := (pg_total_relation_size('events') + pg_total_relation_size('visits') + pg_total_relation_size('visitors')) / 1048576.0;
  v_rest := v_db - v_logs_now;   -- 로그가 아닌 것(공구·설정 전부) — 이건 보관 정리 대상이 아니라 계속 큰다
  v_eq := round(v_rest + (c_ev_keep * v_ev_day * v_ev_b + c_vi_keep * v_vi_day * v_vi_b + c_vi_keep * v_vo_day * v_vo_b) / 1048576.0);

  if v_db >= 400 or v_eq >= 400 then
    v_msg := format('평형점 %sMB (지금 %sMB · 한도 500MB). 400MB 를 넘으면 events 보관을 줄인다 → node tools/daily/db_retention.mjs --yes --days 60', v_eq, v_db);
    insert into health_alerts(kind, detail) values ('무료플랜_DB크기', v_msg);
  end if;
  if v_store >= 800 then
    insert into health_alerts(kind, detail) values ('무료플랜_저장소', format('저장소 %sMB / 무료 1GB', v_store));
  end if;
  return format('db %sMB · 평형점 %sMB/500 (events %s행/일·%s일 보관) · storage %sMB%s',
    v_db, v_eq, round(v_ev_day), c_ev_keep, v_store, case when v_msg <> '' then ' 🔴' else '' end);
end $$;
revoke all on function public.free_plan_guard() from public, anon, authenticated;

select public.free_plan_guard() as 지킴이;
