-- 링크프라이스 수집을 6시간마다로 (사장님 지시 2026-08-05)
-- 그쪽 목록이 30분마다 갈리므로 하루 1번이면 그 사이 상품을 놓친다.
-- 인증키가 없고 호출 제한도 관대해 사고 위험이 낮다.
select cron.unschedule('linkprice-hotdeal')
  where exists (select 1 from cron.job where jobname='linkprice-hotdeal');

select cron.schedule(
  'linkprice-hotdeal',
  '30 23,5,11,17 * * *',   -- UTC → KST 08:30 / 14:30 / 20:30 / 02:30
  format($f$
    select net.http_get(
      url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/linkprice-hotdeal',
      headers := jsonb_build_object('x-cron-secret', %L),
      timeout_milliseconds := 50000
    );
  $f$, (select (regexp_match(command, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1]
          from cron.job where command like '%x-cron-secret%' limit 1))
);
select jobname, schedule, active from cron.job order by jobid;
