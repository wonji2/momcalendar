-- 세일 후보 자동 수집 크론 (2026-10-13 사장님 "인터넷에서 끌어서 모아봐, 앞으로 주기적으로")
--  · Edge Function sale-collect 를 매일 한국 00:20 / 00:25 (UTC 15:20 / 15:25) 두 번 나눠 부른다 (브랜드 24개를 2묶음, Edge CPU 제한 때문)
--  · 저장은 approved=false — 사이트·푸시에 안 나간다. 새 후보가 생기면 health_alerts(kind='세일후보') 에 한 줄.
--  · 승인: update public.sale_events set approved=true where id in (…);   거절: delete from public.sale_events where id in (…);
--  · 호출 형식은 open-push 잡(send-open-push)의 명령을 그대로 복제 — 비밀 헤더를 이 파일에 적지 않는다.
do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  if cmd is null then raise notice 'open-push 잡이 없어 sale-collect 를 만들지 못했다'; return; end if;
  if not exists (select 1 from cron.job where jobname = 'sale-collect-0') then
    perform cron.schedule('sale-collect-0', '20 15 * * *',
      replace(cmd, 'functions/v1/send-open-push', 'functions/v1/sale-collect?batch=0&of=2&n=3&days=21'));
  end if;
  if not exists (select 1 from cron.job where jobname = 'sale-collect-1') then
    perform cron.schedule('sale-collect-1', '25 15 * * *',
      replace(cmd, 'functions/v1/send-open-push', 'functions/v1/sale-collect?batch=1&of=2&n=3&days=21'));
  end if;
end $$;
select jobname, schedule, active, (command like '%sale-collect%') as targets_fn from cron.job where jobname like 'sale-collect%' order by 1;
