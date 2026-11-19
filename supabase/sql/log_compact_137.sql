-- DB 용량 지키기 — 재발 방지 크론 (2026-11-19, 사장님 「다로 하는데」 = 무료 유지 + 기준 넘으면 Pro 전환 + 재발 방지 크론)
--   11-19 실측: DB 467MB → 351MB. 줄어든 곳 = 크론 실행 기록(7월부터 11만 행 42MB → 10MB) · events/visits/visitors 30일 지난 행 삭제 + 표 압축.
--   행을 지우기만 하면 파일 크기는 그대로다(지운 자리를 새 행이 채울 뿐) → 한도 계산(pg_database_size)이 안 줄어든다. 그래서 주 1회 새벽에 압축한다.
--   gonggu·gonggu_archive 는 건드리지 않는다. events·visits·visitors 삭제는 PC 도구 tools/daily/db_retention.mjs(백업 물높이 확인 뒤, 30일)가 한다.
--   크몽 판매 데이터는 DB 가 아니라 work-backup/db-export/events_*.jsonl 에서 뽑는다(tools/daily/data_product_export.mjs) — 이 크론과 무관.
-- ① 크론 실행 기록: 7일만 남긴다(매일 04:05 KST)
select cron.unschedule('cron-log-prune') where exists (select 1 from cron.job where jobname = 'cron-log-prune');
select cron.schedule('cron-log-prune', '5 19 * * *', $$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days'$$);
-- ② 로그 표 압축: 일요일 04:10~04:25 KST (표마다 20초 안팎 잠긴다 — 손님이 가장 적은 시각). 한 작업에 한 문장(VACUUM 은 묶음 안에서 못 돈다)
select cron.unschedule(jobname) from cron.job where jobname in ('log-compact-events','log-compact-visits','log-compact-visitors','log-compact-cronlog');
select cron.schedule('log-compact-events',   '10 19 * * 6', 'vacuum full public.events');
select cron.schedule('log-compact-visits',   '15 19 * * 6', 'vacuum full public.visits');
select cron.schedule('log-compact-visitors', '20 19 * * 6', 'vacuum full public.visitors');
select cron.schedule('log-compact-cronlog',  '25 19 * * 6', 'vacuum full cron.job_run_details');
