-- 11번가 가격 추적 크론 (2026-08-11)
-- 매일 한국 09:30 = UTC 00:30. 쿠팡(08시)·토스와 시간을 겹치지 않게 뒀다.
-- 시크릿은 파일에 쓰지 않고 기존 크론 명령에서 그대로 꺼내 쓴다(채팅·git 노출 없음).
select cron.schedule(
  'st11-track', '30 0 * * *',
  format($f$select net.http_get(
      url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/st11-track',
      headers := jsonb_build_object('x-cron-secret', %L),
      timeout_milliseconds := 30000);$f$,
    (select (regexp_match(command, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]
     from cron.job where jobname = 'coupang-hotdeal')
  )
);
