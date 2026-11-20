-- 이웃셀러 결제 → 사장님 카톡 알림 + 셀러 맘카페 닉네임 (사장님 2026-11-20
--   「맘카페도 회원가입 시켜야하니까 여기에 카페링크 넣고 회원가입 아이디나 닉넴 넣게해서 니가 연동시켜놔
--    글고 이웃셀러 유료결제 들어오면 나한테 카톡오게해」)
--
-- 흐름
--   ① seller_plan_requests 가 paid 가 되거나(입금 확인·스룩 자동 짝·카드 — 셋 다 _plan_confirm_core 를 지난다)
--      셀러가 「입금했어요」(claimed_at)를 누르면, 트리거가 owner_notify_queue 에 한 줄 넣는다(같은 신청·같은 일은 한 번).
--      트리거 안에서는 바깥 호출을 하지 않는다 — 카톡이 죽어도 결제는 그대로 끝난다(오류도 삼킨다).
--   ② 크론 owner-notify(1분)는 보낼 줄이 있을 때만 Edge owner-notify?op=send 를 부른다(할 일 없으면 호출 0).
--      Edge 가 사장님 카카오 토큰으로 「나에게 보내기」. 3번 실패하면 그 줄은 failed + health_alerts.
--   ③ 크론 owner-notify-keep(매주 월 04:17)이 토큰을 갱신해 둔다(리프레시 토큰 2달 — 결제가 뜸해도 안 죽게).
--   ④ 셀러는 화면 「카페」 줄에서 맘카페 닉네임을 적는다 → sellers.cafe_nick. 신청이 있는 셀러면 사장님께도 카톡.
--      카페 회원인지는 네이버가 로그인 없이 확인해 주지 않는다 → 「저장됨」까지만. 게시판 권한은 사장님이 준다.
--
-- 되돌리기
--   select cron.unschedule('owner-notify'); select cron.unschedule('owner-notify-keep');
--   drop trigger if exists plan_owner_notify on seller_plan_requests; drop function public._plan_owner_notify_trg();
--   drop function public.seller_cafe_get(text), public.seller_cafe_save(text, text), public._owner_notify_text(bigint, text);
--   drop table public.owner_notify_queue;  alter table sellers drop column cafe_nick;
--   admin_plan_list 는 neighbor_plan_159.sql 의 것을 다시 적용.

alter table public.sellers add column if not exists cafe_nick text;

create table if not exists public.owner_notify_queue (
  id bigserial primary key,
  kind text not null check (kind in ('paid', 'claim', 'cafe')),
  ref text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  tries int not null default 0,
  err text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (kind, ref)
);
alter table public.owner_notify_queue enable row level security;   -- 정책 없음 = service_role 만
revoke all on public.owner_notify_queue from anon, authenticated;
create index if not exists owner_notify_pending on public.owner_notify_queue (id) where status = 'pending';

-- 카톡 본문(200자 안). 셀러 이름·인스타·기간·금액·결제수단·카페 닉네임
create or replace function public._owner_notify_text(p_req bigint, p_kind text) returns text
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; s sellers%rowtype; v_nm text; v_head text; v_tail text;
begin
  select * into r from seller_plan_requests where id = p_req;
  select * into s from sellers where id = r.seller_id;
  v_nm := coalesce(nullif(trim(s.seller_influencer), ''), nullif(trim(s.name), ''), r.login_insta);
  v_head := case p_kind when 'paid' then '[맘캘린더] 이웃셀러 결제 완료' else '[맘캘린더] 이웃셀러 「입금했어요」 눌림' end;
  v_tail := case p_kind
    when 'paid' then '카페 [' || v_nm || '] 공구 일정 게시판 만들고 글쓰기 권한 주세요'
    else '입금 확인 필요 (관리자 > 이웃셀러)' end;
  return left(v_head || chr(10)
    || v_nm || ' @' || replace(coalesce(r.login_insta, ''), '@', '') || chr(10)
    || r.months || '개월 · ' || to_char(r.amount, 'FM999,999,999') || '원 · '
    || case r.method when 'card' then '스룩 결제' when 'bank' then '계좌이체' else coalesce(r.method, '') end || chr(10)
    || '카페 닉네임: ' || coalesce(nullif(trim(s.cafe_nick), ''), '아직 안 적음') || chr(10)
    || v_tail, 200);
end $fn$;

create or replace function public._plan_owner_notify_trg() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  begin
    if new.status = 'paid' and old.status is distinct from 'paid' then
      insert into owner_notify_queue (kind, ref, body) values ('paid', new.id::text, public._owner_notify_text(new.id, 'paid'))
      on conflict (kind, ref) do nothing;
    end if;
    if new.claimed_at is not null and old.claimed_at is null and new.status = 'pending' then
      insert into owner_notify_queue (kind, ref, body) values ('claim', new.id::text, public._owner_notify_text(new.id, 'claim'))
      on conflict (kind, ref) do nothing;
    end if;
  exception when others then
    null;   -- 알림 때문에 결제가 실패하면 안 된다
  end;
  return new;
end $fn$;
drop trigger if exists plan_owner_notify on public.seller_plan_requests;
create trigger plan_owner_notify after update on public.seller_plan_requests
  for each row execute function public._plan_owner_notify_trg();

-- 셀러 화면: 맘카페 닉네임
create or replace function public.seller_cafe_get(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_id bigint; v_nick text;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select cafe_nick into v_nick from sellers where id = v_id;
  return json_build_object('ok', true, 'nick', coalesce(v_nick, ''), 'cafe_url', 'https://cafe.naver.com/momcal');
end $fn$;

create or replace function public.seller_cafe_save(p_token text, p_nick text) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_id bigint; v_nick text; v_old text; v_nm text; v_insta text;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  v_nick := regexp_replace(trim(coalesce(p_nick, '')), '\s+', ' ', 'g');
  if char_length(v_nick) < 1 or char_length(v_nick) > 30 or v_nick ~ '[<>"''\\`]' or v_nick ~ '[[:cntrl:]]' then
    return json_build_object('ok', false, 'msg', 'bad_nick');
  end if;
  select cafe_nick, coalesce(nullif(trim(seller_influencer), ''), nullif(trim(name), ''), login_insta), replace(coalesce(login_insta, ''), '@', '')
    into v_old, v_nm, v_insta from sellers where id = v_id for update;
  update sellers set cafe_nick = v_nick where id = v_id;
  -- 신청(대기·결제)이 있는 셀러만 사장님께 알린다. 같은 닉네임을 다시 저장하면 다시 안 보낸다.
  if v_nick is distinct from v_old and exists (select 1 from seller_plan_requests where seller_id = v_id and status in ('pending', 'paid')) then
    begin
      insert into owner_notify_queue (kind, ref, body)
      values ('cafe', v_id || ':' || md5(v_nick),
              left('[맘캘린더] 이웃셀러 카페 닉네임' || chr(10) || v_nm || ' @' || v_insta || chr(10) || '닉네임: ' || v_nick || chr(10)
                   || '카페 [' || v_nm || '] 공구 일정 게시판 글쓰기 권한 주세요', 200))
      on conflict (kind, ref) do nothing;
    exception when others then null;
    end;
  end if;
  return json_build_object('ok', true, 'nick', v_nick);
end $fn$;

revoke all on function public._owner_notify_text(bigint, text), public._plan_owner_notify_trg() from public, anon, authenticated;
revoke all on function public.seller_cafe_get(text), public.seller_cafe_save(text, text) from public;
grant execute on function public.seller_cafe_get(text), public.seller_cafe_save(text, text) to anon, authenticated;

-- 관리자 목록에 카페 닉네임을 더한다(나머지는 neighbor_plan_159.sql 그대로)
create or replace function public.admin_plan_list() returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  return json_build_object('ok', true, 'slots_used', public._plan_slots_used(), 'rows', coalesce((
    select json_agg(x order by x.id desc) from (
      select r.id, r.login_insta, s.name, r.months, r.amount, r.method, r.status, r.activated, r.start_date, r.end_date,
             r.pay_due, r.claimed_at, r.paid_at, r.receipt_kind, r.receipt_no, r.close_reason, r.created_at, s.cafe_nick
        from seller_plan_requests r join sellers s on s.id = r.seller_id
       order by r.id desc limit 200) x), '[]'::json));
end $$;

-- 크론: 보낼 줄이 있을 때만 부른다 · 매주 토큰 갱신. 비밀값은 기존 open-push 크론에서 읽는다(코드에 안 박는다)
do $$
declare cmd text; sec text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  sec := coalesce((regexp_match(cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1], (regexp_match(cmd, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]);
  if sec is null then raise exception 'cron secret not found'; end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname in ('owner-notify', 'owner-notify-keep');
  perform cron.schedule('owner-notify', '* * * * *',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=send', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 30000) where exists (select 1 from public.owner_notify_queue where status = 'pending')$f$, sec));
  perform cron.schedule('owner-notify-keep', '17 19 * * 0',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=keep', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 30000)$f$, sec));
end $$;

select jobname, schedule, active from cron.job where jobname like 'owner-notify%' order by 1;
