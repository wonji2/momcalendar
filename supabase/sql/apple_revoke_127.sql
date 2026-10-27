-- 애플 회원 탈퇴 때 애플 토큰 철회 (2026-10-27 · App Review 5.1.1(v)) — 설계 scratchpad/designs/2026-10-27_애플탈퇴_토큰철회.md
--   apple_tokens: 로그인 때 apple-auth 가 authorizationCode 를 /auth/token 으로 바꿔 받은 refresh token (손님·anon 접근 없음)
--   apple_revoke_queue: 탈퇴 RPC 가 옮겨 두면 apple-auth {action:'flush'} 가 /auth/revoke — 실패는 하루 1번 다시(최대 10번, 넘으면 health_alerts)
--   member_delete_account: 126(앱 알림 토큰 삭제) 판에 애플 두 줄만 더했다
create table if not exists public.apple_tokens (
  kakao_id text primary key,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.apple_revoke_queue (
  id bigserial primary key,
  refresh_token text not null,
  queued_at timestamptz not null default now(),
  tries int not null default 0,
  last_error text,
  last_try_at timestamptz,
  done_at timestamptz
);
alter table public.apple_revoke_queue add column if not exists last_try_at timestamptz;
alter table public.apple_tokens enable row level security;
alter table public.apple_revoke_queue enable row level security;
revoke all on public.apple_tokens from anon, authenticated;
revoke all on public.apple_revoke_queue from anon, authenticated;
revoke all on sequence public.apple_revoke_queue_id_seq from anon, authenticated;

CREATE OR REPLACE FUNCTION public.member_delete_account(p_token text, p_wipe_device boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_kakao text; v_dev text; v_n int; v_w int := 0; v_q int := 0;
begin
  v_kakao := _member_from_token(p_token);
  if v_kakao is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select m.device_id into v_dev from members m where m.kakao_id = v_kakao;

  delete from attendance_winners where kakao_id = v_kakao;   -- 연락처가 들어있다. 반드시 먼저
  delete from attendance where kakao_id = v_kakao;
  delete from member_ics where kakao_id = v_kakao;
  delete from member_devices where kakao_id = v_kakao;
  delete from member_sessions where kakao_id = v_kakao;
  -- 애플 회원: 보관한 refresh token 을 철회 대기열로 옮긴다(apple-auth flush 가 애플 /auth/revoke 로 끊는다 — App Review 5.1.1(v))
  insert into apple_revoke_queue(refresh_token) select t.refresh_token from apple_tokens t where t.kakao_id = v_kakao;
  delete from apple_tokens where kakao_id = v_kakao;
  update inquiries set kakao_id = null, nickname = null, device_id = null where kakao_id = v_kakao;
  get diagnostics v_q = row_count;
  delete from members where kakao_id = v_kakao;
  get diagnostics v_n = row_count;

  if p_wipe_device and coalesce(v_dev,'') <> '' then
    delete from wishes where device_id = v_dev;
    get diagnostics v_w = row_count;
    delete from push_subs where device_id = v_dev;
    delete from push_fcm where device_id = v_dev;
    delete from push_ios where device_id = v_dev;
  end if;

  return json_build_object('ok', true, 'deleted', v_n, 'wishes_deleted', v_w, 'inquiries_anonymized', v_q);
end $function$;

-- 하루 1번(KST 04:25) 남은 철회 다시 — 비밀값은 기존 크론(cafe-feed)에서 읽는다(파일에 비밀을 적지 않는다)
select cron.unschedule('apple-revoke-flush') where exists (select 1 from cron.job where jobname = 'apple-revoke-flush');
select cron.schedule('apple-revoke-flush', '25 19 * * *',
  format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/apple-auth', headers := %L::jsonb, body := '{"action":"flush"}'::jsonb, timeout_milliseconds := 60000)$f$,
         json_build_object('Content-Type', 'application/json', 'x-cron-secret',
           (select (regexp_match(command, '"x-cron-secret":"([^"]+)"'))[1] from cron.job where jobname = 'cafe-feed'))::text));
