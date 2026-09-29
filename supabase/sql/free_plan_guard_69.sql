-- 무료 플랜 지킴이 (사장님 결정 2026-09-29 "supabase 이제 무료 플랜으로")
-- 무료 한도: DB 500MB(넘으면 읽기 전용) · 전송 5GB/월 · 저장소 1GB. DB 크기는 서버가 스스로 재서 400MB 부터 health_alerts 에 남긴다.
-- 전송량은 서버 안에서 못 잰다 → Cloudflare 캐시(tools/daily/cf_api_proxy/worker.js)가 줄이고, 대시보드 Usage 를 사람이 본다.
create or replace function public.free_plan_guard()
returns text language plpgsql security definer set search_path = public as $$
declare v_db numeric; v_store numeric; v_msg text := '';
begin
  select round(pg_database_size(current_database())/1048576.0,1) into v_db;
  select round(coalesce(sum((metadata->>'size')::bigint),0)/1048576.0,1) into v_store from storage.objects;
  if v_db >= 400 then
    v_msg := format('DB %sMB / 무료 500MB — events·visits 정리(오프라인 내보내기 뒤 삭제) 필요', v_db);
    insert into health_alerts(kind, detail) values ('무료플랜_DB크기', v_msg);
  end if;
  if v_store >= 800 then
    insert into health_alerts(kind, detail) values ('무료플랜_저장소', format('저장소 %sMB / 무료 1GB', v_store));
  end if;
  return format('db %sMB, storage %sMB%s', v_db, v_store, case when v_msg <> '' then ' 🔴 '||v_msg else '' end);
end $$;
revoke all on function public.free_plan_guard() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'free-plan-guard';
select cron.schedule('free-plan-guard', '40 21 * * *', $$select public.free_plan_guard()$$);  -- 매일 KST 06:40
select public.free_plan_guard();
