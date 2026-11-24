-- 검색 페이지 빌드·색인 측정을 정시에 깨우기 (2026-11-25, 사장님 「색인 매일 점검해서 맞는 방향으로 디벨롭해」)
--   깃허브 schedule 은 몇 시간씩 늦는다 — 11-24 seo-daily 05:10 예약이 13:43 에 돌았고, seo-index-sample 예약 회차는 한 번도 안 돌았다.
--   → 정확한 pg_cron 이 정해진 시각에 workflow_dispatch 로 깨운다. 두 워크플로 모두 「오늘 이미 돈 회차가 있으면 건너뛴다」가 있어 겹쳐 돌아도 한 번만 일한다.
--     (seo-daily 는 수동 실행이 늘 빌드하므로, 깨우기는 예약 시각보다 조금 뒤에 걸고 skip 검사는 workflow_dispatch 에도 걸리게 inputs 로 표시한다 — 아래 body)
--   열쇠: Vault 'github_dispatch_token' (red_autofix_kick_150.sql 의 gh_dispatch 와 같은 열쇠). 🔴 2026-11-25 확인: Vault 에 이 열쇠가 **없다** → 지금은 'no_token' 만 돌려준다(아무 일도 안 함).
--         사장님이 깃허브 fine-grained 토큰(저장소 wonji2/momcalendar · Actions: Read and write 만)을 Vault 에 넣으면 그날부터 정시에 돈다:
--         select vault.create_secret('<토큰>', 'github_dispatch_token');   ← 값은 SQL 편집기에서 사장님이 직접. 채팅·코드에 적지 않는다
--   열쇠가 들어오기 전에는 각 워크플로의 「하루 세 번 예약 + 오늘 회차 있으면 건너뛰기」가 안전망이다.
create or replace function public.gh_dispatch_inputs(p_workflow text, p_inputs jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_tok text; v_id bigint;
begin
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1;
  if v_tok is null or v_tok = '' then
    -- 열쇠가 없으면 조용히 넘기지 않는다(규칙 0-LG) — 관리자 「고장 난 것」에 한 줄(하루 한 줄로 덮어씀)
    delete from public.health_alerts where kind = 'seo:정시깨우기';
    insert into public.health_alerts(kind, detail) values ('seo:정시깨우기', 'pg_cron 이 깃허브 ' || p_workflow || ' 를 정시에 깨우려 했지만 Vault 에 github_dispatch_token 이 없다. 깃허브 fine-grained 토큰(wonji2/momcalendar · Actions Read and write)을 SQL 편집기에서 vault.create_secret 으로 넣으면 풀린다. 그 전에는 워크플로의 하루 세 번 예약이 대신 돈다(supabase/sql/seo_kick_190.sql)');
    return 'no_token';
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/wonji2/momcalendar/actions/workflows/' || p_workflow || '/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_tok, 'Accept', 'application/vnd.github+json', 'User-Agent', 'momcal-pgcron', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', p_inputs),
    timeout_milliseconds := 15000) into v_id;
  return 'sent:' || v_id;
end $$;
revoke all on function public.gh_dispatch_inputs(text, jsonb) from public, anon, authenticated;

-- 05:20 KST(빌드) · 07:40 KST(색인 측정+장부). once=true 면 오늘 회차가 있을 때 건너뛴다
select cron.unschedule('seo-daily-kick') where exists (select 1 from cron.job where jobname = 'seo-daily-kick');
select cron.schedule('seo-daily-kick', '20 20 * * *', $c$select public.gh_dispatch_inputs('seo-daily.yml', '{"once":"true"}'::jsonb)$c$);
select cron.unschedule('seo-index-kick') where exists (select 1 from cron.job where jobname = 'seo-index-kick');
select cron.schedule('seo-index-kick', '40 22 * * *', $c$select public.gh_dispatch_inputs('seo-index-sample.yml', '{"once":"true"}'::jsonb)$c$);
select jobname, schedule from cron.job where jobname in ('seo-daily-kick','seo-index-kick');
