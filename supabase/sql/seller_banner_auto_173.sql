-- 이웃셀러 배너 자동 연동 서버 크론 (사장님 2026-11-19 「오늘 공동구매하고 결제창 열려있는 거 자동으로 가져와서 배너 연동 … 계속」)
--  · seller-banner-auto        30분마다(:07·:37) → functions/v1/seller-banner-auto (오늘 공구 결제 링크 → 인포크 오늘 블록 → 인포크 맨 위 상품 순으로 골라 배너 1장)
--  · seller-banner-auto-watch  매시 :50 → 순수 SQL: 노출 중 이웃셀러가 있는데 심박(ops_status 'seller-banner-auto')이 3시간 넘게 안 바뀌면 health_alerts
--  · 비밀 헤더는 open-push 잡 명령에서 읽어 쓴다(이 파일에 적지 않는다). pg_net 기본 5초가 아니라 150초를 기다린다
--  · 옛 PC 예약작업 momcal-seller-banner(tools/daily/seller_banner.mjs, 하루 1번)는 이것으로 바뀐다 — 끈다
--  · 끄기: select cron.unschedule('seller-banner-auto'); select cron.unschedule('seller-banner-auto-watch');
--  PC 가 꺼져도 돈다(서버 함수 + pg_cron).
do $$
declare cmd text; sec text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  sec := coalesce((regexp_match(cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1], (regexp_match(cmd, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]);
  if sec is null then raise exception 'open-push 잡에서 비밀 헤더를 못 읽었다 — 크론을 만들지 않음'; end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'seller-banner-auto';
  perform cron.schedule('seller-banner-auto', '7,37 * * * *',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/seller-banner-auto', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 150000)$f$, sec));
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'seller-banner-auto-watch';
  perform cron.schedule('seller-banner-auto-watch', '50 * * * *', $h$
    insert into public.health_alerts(kind, detail)
    select '이웃셀러배너:멈춤', '🔴 이웃셀러 배너 자동 연동(seller-banner-auto)이 ' ||
           coalesce(round(extract(epoch from now() - (select updated_at from public.ops_status where id = 'seller-banner-auto')) / 3600)::text || '시간째', '한 번도') ||
           ' 안 돌았다 — cron.job_run_details 와 net._http_response 확인'
    where exists (select 1 from public.sellers s where s.is_partner and s.active
                    and (s.start_date is null or s.start_date <= (now() at time zone 'Asia/Seoul')::date)
                    and (s.end_date is null or s.end_date >= (now() at time zone 'Asia/Seoul')::date))
      and coalesce((select updated_at from public.ops_status where id = 'seller-banner-auto'), 'epoch'::timestamptz) < now() - interval '3 hours'
      and not exists (select 1 from public.health_alerts where kind = '이웃셀러배너:멈춤' and created_at > now() - interval '12 hours');
  $h$);
end $$;
select jobname, schedule, active from cron.job where jobname like 'seller-banner-auto%' order by 1;
