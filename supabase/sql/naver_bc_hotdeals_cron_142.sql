-- 브랜드커넥트 할인 중 인기 상위 상품 하루 10건 → 우리 링크로 hotdeals (사장님 2026-11-10 「컴터랑 상관없이 돌아가게」)
-- 매일 10:20 KST = 01:20 UTC. 함수 supabase/functions/naver-bc-hotdeals · 시크릿 NAVER_BC_COOKIE(로그인 풀리면 health_alerts '브랜드커넥트로그인만료')
-- 크론 비밀값은 기존 크론 command 안의 값을 그대로 재사용한다(파일에 남기지 않음).
select cron.unschedule('naver-bc-hotdeals') where exists (select 1 from cron.job where jobname='naver-bc-hotdeals');
select cron.schedule(
  'naver-bc-hotdeals',
  '20 1 * * *',
  format($f$
    select net.http_get(
      url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/naver-bc-hotdeals',
      headers := jsonb_build_object('x-cron-secret', %L),
      timeout_milliseconds := 120000
    );
  $f$, (select (regexp_match(command, 'x-cron-secret["'']?\s*[,:]\s*["'']([^"'']+)'))[1]
          from cron.job where jobname='linkprice-hotdeal' limit 1))
);
select jobname, schedule, active, md5((regexp_match(command, 'x-cron-secret["'']?\s*[,:]\s*["'']([^"'']+)'))[1]) secret_md5 from cron.job where jobname in ('naver-bc-hotdeals','linkprice-hotdeal');
