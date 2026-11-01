-- 무료 플랜 지킴이 (사장님 결정 2026-09-29 "supabase 이제 무료 플랜으로")
-- 무료 한도: DB 500MB(넘으면 읽기 전용) · 전송 5GB/월 · 저장소 1GB. DB 크기는 서버가 스스로 재서 미리 알린다.
-- 전송량은 서버 안에서 못 잰다 → Cloudflare 캐시(tools/daily/cf_api_proxy/worker.js)가 줄이고, 대시보드 Usage 를 사람이 본다.
-- v2(2026-09-29 저녁): 크기만 보지 않고 **최근 7일 증가 속도로 며칠 남았는지** 계산해 60일 밑이면 알린다.
--   (실측: 9월 한 달에 events 366,225행 = 8월의 3.2배. "지금 217MB 니까 여유" 는 틀린 판단이었다)
create or replace function public.free_plan_guard()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_db numeric; v_store numeric; v_grow numeric; v_days integer; v_msg text := '';
begin
  select round(pg_database_size(current_database())/1048576.0,1) into v_db;
  select round(coalesce(sum((metadata->>'size')::bigint),0)/1048576.0,1) into v_store from storage.objects;

  -- 하루 증가량(MB) — 최근 7일에 쌓인 로그성 행 × 행당 바이트(인덱스 포함)
  select round((
      (select count(*) from events where visited_at > now()-interval '7 days') * (pg_total_relation_size('events')::numeric / greatest((select count(*) from events),1))
    + (select count(*) from visits where visited_at > now()-interval '7 days') * (pg_total_relation_size('visits')::numeric / greatest((select count(*) from visits),1))
    + (select count(*) from visitors where visited_at > now()-interval '7 days') * (pg_total_relation_size('visitors')::numeric / greatest((select count(*) from visitors),1))
    ) / 7 / 1048576.0, 2) into v_grow;
  v_days := case when v_grow > 0 then floor((500 - v_db) / v_grow)::integer else 9999 end;

  if v_db >= 400 or v_days < 60 then
    v_msg := format('DB %sMB / 무료 500MB · 하루 +%sMB · 이 속도면 %s일 남음 → node tools/daily/db_retention.mjs --yes (오래된 events 정리, 원본은 백업에 남음)', v_db, v_grow, v_days);
    insert into health_alerts(kind, detail) values ('무료플랜_DB크기', v_msg);
  end if;
  if v_store >= 800 then
    insert into health_alerts(kind, detail) values ('무료플랜_저장소', format('저장소 %sMB / 무료 1GB', v_store));
  end if;
  return format('db %sMB (하루 +%sMB · %s일 남음), storage %sMB%s', v_db, v_grow, v_days, v_store, case when v_msg <> '' then ' 🔴' else '' end);
end $$;
revoke all on function public.free_plan_guard() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'free-plan-guard';
select cron.schedule('free-plan-guard', '40 21 * * *', $$select public.free_plan_guard()$$);  -- 매일 KST 06:40

select public.free_plan_guard();
