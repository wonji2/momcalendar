-- 토스 하루특가 매일 자동 수집 (사장님 지시 2026-08-06)
-- 하루특가는 그날 하루만 파는 상품이라 아침 일찍 받아야 한다.
-- 토스 호출 제한은 초당 10회로 넉넉해서 쿠팡처럼 조마조마할 일이 없다.
select cron.unschedule(jobid) from cron.job where jobname = 'toss-hotdeal';
select cron.schedule('toss-hotdeal', '5 22,2 * * *',   -- UTC 22:05, 02:05 = KST 07:05, 11:05
  format($f$select net.http_get(
    url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/toss-sync?mode=collect',
    headers := jsonb_build_object('x-cron-secret', %L),
    timeout_milliseconds := 120000);$f$,
    (select (regexp_match(command, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1]
       from cron.job where command like '%x-cron-secret%' limit 1)));

select jobname, schedule, active from cron.job where jobname like 'toss%';
