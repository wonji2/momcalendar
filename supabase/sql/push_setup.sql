-- ══════════════════════════════════════════════════════════
--  찜 공구 오픈 알림 — DB 쪽 준비물
--  Supabase 대시보드 → SQL Editor 에서 ①→②→③ 순서로 실행
--
--  ⚠ <CRON_SECRET> 자리에는 Supabase 시크릿 PUSH_CRON_SECRET 과 같은 값을 넣는다.
--    그 값을 채운 상태로 이 파일을 GitHub 에 올리지 말 것.
--    (service_role 키는 더 이상 필요 없다 — Edge Function 이 자기 것을 직접 쓴다)
-- ══════════════════════════════════════════════════════════


-- ① 발송 실패(404·410) 기기의 fail_count 올리기
--    Edge Function 이 rpc/push_fail_bump 로 호출한다.
--    fail_count 가 5 이상이 되면 push_targets() 가 알아서 제외함.
create or replace function public.push_fail_bump(p_devices text[])
returns void
language sql
security definer
set search_path = public
as $$
  update push_subs
     set fail_count = coalesce(fail_count, 0) + 1
   where device_id = any(p_devices);
$$;

revoke execute on function public.push_fail_bump(text[]) from anon, authenticated;
grant  execute on function public.push_fail_bump(text[]) to service_role;


-- ② 확인용 — push_targets() 가 오늘 누구한테 뭘 보낼 예정인지
-- select * from push_targets();


-- ③ pg_cron 등록 — 한국 09:00 = UTC 00:00
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'open-push',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/send-open-push',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);


-- ── 운영 중 쓰는 것들 ──────────────────────────────────────
-- 등록된 잡 확인
--   select jobid, jobname, schedule, active from cron.job;
--
-- 실행 이력 (실패하면 status='failed')
--   select * from cron.job_run_details where jobname = 'open-push' order by start_time desc limit 20;
--
-- 스케줄 바꾸기 / 끄기
--   select cron.alter_job((select jobid from cron.job where jobname='open-push'), schedule := '0 0 * * *');
--   select cron.unschedule('open-push');
--
-- 오늘 실제로 나간 알림
--   select kind, count(*) from push_log
--    where created_at >= (now() at time zone 'Asia/Seoul')::date
--    group by kind;
--
-- 테스트로 보낸 기록 지우고 다시 쏘기 (같은 사람에게 재발송하려면 push_log 를 지워야 함)
--   delete from push_log
--    where device_id = '<DEVICE_ID>'
--      and created_at >= (now() at time zone 'Asia/Seoul')::date;


-- ══════════════════════════════════════════════════════════
--  Edge Function 수동 호출 (테스트용)
--    미리보기 :  .../send-open-push?dry=1
--    한 기기만 :  .../send-open-push?device=<mc_did>
--    자가진단  :  .../send-open-push?selftest=1
--  모두 x-cron-secret 헤더 필요
-- ══════════════════════════════════════════════════════════
