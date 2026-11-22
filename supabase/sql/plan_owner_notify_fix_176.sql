-- owner-notify 보강 (2026-11-20 두 번째 검수 Codex 지적): 보낼 줄을 「선점」해서 겹친 호출이 같은 카톡을 두 번 보내지 않게.
--   상태 'sending' 추가. owner_notify_claim(n) 이 pending 을 skip locked 로 잡아 sending 으로 바꿔 돌려준다.
--   5분 넘게 sending 인 줄(함수가 중간에 죽은 경우)은 다음 선점 때 pending 으로 되돌린다(그때는 한 번 더 갈 수 있다 — 안 가는 것보다 낫다).
-- 되돌리기: drop function public.owner_notify_claim(int); 상태 체크를 175 판으로.
alter table public.owner_notify_queue add column if not exists claimed_at timestamptz;
alter table public.owner_notify_queue drop constraint if exists owner_notify_queue_status_check;
alter table public.owner_notify_queue add constraint owner_notify_queue_status_check check (status in ('pending', 'sending', 'sent', 'failed'));

create or replace function public.owner_notify_claim(p_n int default 10) returns setof public.owner_notify_queue
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  update owner_notify_queue set status = 'pending', claimed_at = null where status = 'sending' and claimed_at < now() - interval '5 minutes';
  return query
    update owner_notify_queue q set status = 'sending', claimed_at = now()
     where q.id in (select id from owner_notify_queue where status = 'pending' order by id limit greatest(1, least(p_n, 20)) for update skip locked)
    returning q.*;
end $fn$;
revoke all on function public.owner_notify_claim(int) from public, anon, authenticated;
grant execute on function public.owner_notify_claim(int) to service_role;

-- 크론: 선점이 풀릴 줄(5분 넘은 sending)도 깨운다
do $$
declare cmd text; sec text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  sec := coalesce((regexp_match(cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1], (regexp_match(cmd, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]);
  if sec is null then raise exception 'cron secret not found'; end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'owner-notify';
  perform cron.schedule('owner-notify', '* * * * *',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=send', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 30000) where exists (select 1 from public.owner_notify_queue where status = 'pending' or (status = 'sending' and claimed_at < now() - interval '5 minutes'))$f$, sec));
end $$;
select jobname, active from cron.job where jobname = 'owner-notify';

-- ② (verifier 지적) 닉네임 알림: 셀러당 하루 3번까지 · 되돌린 닉네임(A→B→A)도 다시 알린다
create or replace function public.seller_cafe_save(p_token text, p_nick text) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_id bigint; v_nick text; v_old text; v_nm text; v_insta text;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  v_nick := regexp_replace(trim(coalesce(p_nick, '')), '\s+', ' ', 'g');
  if char_length(v_nick) < 1 or char_length(v_nick) > 30 or v_nick ~ '[<>"''\\`]' or v_nick ~ '[[:cntrl:]]' or v_nick ~ '[​-‏ -‮⁠-⁯﻿]' then
    return json_build_object('ok', false, 'msg', 'bad_nick');
  end if;
  select cafe_nick, coalesce(nullif(trim(seller_influencer), ''), nullif(trim(name), ''), login_insta), replace(coalesce(login_insta, ''), '@', '')
    into v_old, v_nm, v_insta from sellers where id = v_id for update;
  update sellers set cafe_nick = v_nick where id = v_id;
  if v_nick is distinct from v_old
     and exists (select 1 from seller_plan_requests where seller_id = v_id and status in ('pending', 'paid'))
     and (select count(*) from owner_notify_queue where kind = 'cafe' and ref like v_id || ':%' and created_at > now() - interval '1 day') < 3 then
    begin
      insert into owner_notify_queue (kind, ref, body)
      values ('cafe', v_id || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
              left('[맘캘린더] 이웃셀러 카페 닉네임' || chr(10) || v_nm || ' @' || v_insta || chr(10) || '닉네임: ' || v_nick || chr(10)
                   || '카페 [' || v_nm || '] 공구 일정 게시판 글쓰기 권한 주세요', 200))
      on conflict (kind, ref) do nothing;
    exception when others then null;
    end;
  end if;
  return json_build_object('ok', true, 'nick', v_nick);
end $fn$;
revoke all on function public.seller_cafe_save(text, text) from public;
grant execute on function public.seller_cafe_save(text, text) to anon, authenticated;

-- ③ (verifier 지적) 카톡이 연결돼 있을 때만 크론이 부른다 — 연결 전 결제 알림은 pending 으로 남아 있다가 연결되면 나간다
do $$
declare cmd text; sec text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  sec := coalesce((regexp_match(cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1], (regexp_match(cmd, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]);
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'owner-notify';
  perform cron.schedule('owner-notify', '* * * * *',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=send', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 30000) where exists (select 1 from public.app_private_config where key = 'kakao_owner_refresh') and exists (select 1 from public.owner_notify_queue where status = 'pending' or (status = 'sending' and claimed_at < now() - interval '5 minutes'))$f$, sec));
end $$;
select jobname, active from cron.job where jobname like 'owner-notify%';
