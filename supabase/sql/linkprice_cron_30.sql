-- 링크프라이스 핫딜 자동수집 — 매일 08:30(KST) = 23:30(UTC)
-- 쿠팡(08:00, 08:20) 뒤에 돈다. 링크프라이스는 인증키가 없고 호출 제한이 관대해 사고 위험이 낮다.
-- 시크릿은 기존 크론 command 안의 값을 그대로 재사용한다(파일에 남기지 않음).

select cron.unschedule('linkprice-hotdeal')
  where exists (select 1 from cron.job where jobname='linkprice-hotdeal');

select cron.schedule(
  'linkprice-hotdeal',
  '30 23 * * *',
  format($f$
    select net.http_get(
      url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/linkprice-hotdeal',
      headers := jsonb_build_object('x-cron-secret', %L),
      timeout_milliseconds := 50000
    );
  $f$, (select (regexp_match(command, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1]
          from cron.job where command like '%x-cron-secret%' limit 1))
);

select jobid, jobname, schedule, active from cron.job order by jobid;
