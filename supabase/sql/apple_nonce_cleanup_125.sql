-- 애플 로그인 1회용 nonce 표 비우기 (2026-10-27 · 규칙 0-L — 로그인마다 1행씩 쌓인다)
--   애플 identity token 은 10분이면 만료되므로 하루 지난 nonce 는 재생 방지에 쓸모가 없다. 매일 04:15 KST(19:15 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'apple-nonce-cleanup';
select cron.schedule('apple-nonce-cleanup', '15 19 * * *', $$delete from public.apple_nonce_used where used_at < now() - interval '1 day'$$);
select jobname, schedule from cron.job where jobname = 'apple-nonce-cleanup';
