-- 고장 자동 수리 깨우기 (2026-11-20, 사장님 「Pc예약상관없이」 · 「왜 실시간으로 안고치고 쌓아두냐」)
--   깃허브 Actions 의 schedule 은 15분으로 걸어도 실제로 6~9시간에 한 번 돈다(2026-11-20 실측: live-watch·bugfix-cloud·hotdeal-cloud 전부).
--   → 정확한 pg_cron 이 20분마다 깃허브 workflow_dispatch API 로 red-autofix-cloud.yml 을 깨운다.
--   열쇠: Vault 비밀값 'github_dispatch_token' (사장님이 만든 깃허브 fine-grained 토큰 · 저장소 wonji2/momcalendar · Actions: Read and write 만)
--   열쇠가 없으면 아무것도 안 한다(조용히 건너뜀). 열쇠 값은 어디에도 출력하지 않는다.
--   같은 함수에 다른 작업 이름을 주면 그 작업도 깨울 수 있다: select public.gh_dispatch('live-watch.yml');
create or replace function public.gh_dispatch(p_workflow text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_tok text; v_id bigint;
begin
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1;
  if v_tok is null or v_tok = '' then return 'no_token'; end if;
  select net.http_post(
    url := 'https://api.github.com/repos/wonji2/momcalendar/actions/workflows/' || p_workflow || '/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_tok, 'Accept', 'application/vnd.github+json', 'User-Agent', 'momcal-pgcron', 'Content-Type', 'application/json'),
    body := '{"ref":"main"}'::jsonb,
    timeout_milliseconds := 15000) into v_id;
  return 'sent:' || v_id;
end $$;
revoke all on function public.gh_dispatch(text) from public, anon, authenticated;

select cron.unschedule('red-autofix-kick') where exists (select 1 from cron.job where jobname = 'red-autofix-kick');
select cron.schedule('red-autofix-kick', '*/20 * * * *', $c$select public.gh_dispatch('red-autofix-cloud.yml')$c$);
select jobname, schedule from cron.job where jobname = 'red-autofix-kick';
