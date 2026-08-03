-- 쿠팡 핫딜 수집 매일 자동 실행 (한국시간 08:00 = UTC 23:00)
-- 시크릿은 기존 open-push 크론 명령에서 그대로 복사해 쓴다(값을 파일에 남기지 않음)
do $$
declare sec text; cmd text;
begin
  select (regexp_match(command,'"x-cron-secret"\s*:\s*"([^"]+)"'))[1]
    into sec from cron.job where jobname='open-push';
  if sec is null then raise exception 'cron secret not found'; end if;

  perform cron.unschedule('coupang-hotdeal')
    where exists (select 1 from cron.job where jobname='coupang-hotdeal');

  cmd := format(
    $f$select net.http_get(
         url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/coupang-hotdeal',
         headers := jsonb_build_object('x-cron-secret', %L),
         timeout_milliseconds := 120000);$f$, sec);

  perform cron.schedule('coupang-hotdeal', '0 23 * * *', cmd);
end $$;

-- 오래된 가격 이력 정리(180일)도 함께
select cron.unschedule('price-history-purge') where exists (select 1 from cron.job where jobname='price-history-purge');
select cron.schedule('price-history-purge', '30 23 * * 0',
  $$delete from price_history where day < (now() at time zone 'Asia/Seoul')::date - 180;$$);

select jobid, jobname, schedule, active from cron.job order by jobid;
