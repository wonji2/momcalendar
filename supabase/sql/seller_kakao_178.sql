-- 셀러 카카오 연결(카톡 「나에게 보내기」 알림) · 결제 안내 · 만료 7/3/1일 전 알림 · 셀러 자동 로그인 확인 (사장님 2026-11-23)
--   설계 scratchpad/designs/2026-11-23_셀러_카카오연결_자동로그인.md (금붕어 검토 2명 반영)
--   흐름: 셀러 화면 「카톡 연결」 → Edge owner-notify?op=seller_start(셀러 토큰) → seller_kakao_state('sk'+난수, 10분·1회) →
--         카카오 동의(리다이렉트 https://momcalendar.com/kktest.html — 이미 등록된 주소, 앱 웹뷰 안에 머문다) →
--         kktest.html 이 code·state·「이 브라우저의 셀러 토큰」을 Edge op=seller_callback 으로 → state 의 셀러와 토큰의 셀러가 같을 때만 저장
--         (남이 만든 연결 주소를 눌러도 남의 셀러에 내 카카오가 붙지 않게) → 셀러 페이지로 location.replace.
--         결제 확정 트리거 / 매일 10:05 KST 만료 크론 → seller_notify_queue → 크론 1분(보낼 줄 있을 때만) → owner-notify?op=seller_send.
--   리프레시 토큰은 service_role 전용 표(seller_kakao)에만. 화면·RPC 응답·로그에 안 나가고 db_export 백업에서도 뺀다.
--   결제를 막지 않는다(권장만) — 카카오가 일반 사용자 메시지 권한을 막아 둔 상태일 수 있다.
--   PC 가 꺼져도 도는가: 예(트리거·pg_cron·Edge).
-- 되돌리기
--   select cron.unschedule('seller-notify'); select cron.unschedule('seller-notify-expiry'); select cron.unschedule('seller-notify-keep');
--   drop trigger if exists plan_seller_notify on seller_plan_requests; drop function public._plan_seller_notify_trg();
--   drop function public.seller_me(text), public.seller_kakao_status(text), public.seller_kakao_disconnect(text), public.seller_notify_claim(int),
--     public._seller_notify_text(bigint, text), public._seller_notify_enqueue_paid(bigint), public._seller_notify_expiry(),
--     public._seller_kakao_begin(text, text), public._seller_kakao_take(text, text);
--   drop table public.seller_notify_queue, public.seller_kakao_state, public.seller_kakao;

create table if not exists public.seller_kakao (
  seller_id bigint primary key references public.sellers(id) on delete cascade,
  kakao_id text not null,
  refresh text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.seller_kakao enable row level security;   -- 정책 없음 = service_role 만
revoke all on public.seller_kakao from anon, authenticated;

create table if not exists public.seller_kakao_state (
  state text primary key,
  seller_id bigint not null references public.sellers(id) on delete cascade,
  back text not null,
  expires_at timestamptz not null
);
alter table public.seller_kakao_state enable row level security;
revoke all on public.seller_kakao_state from anon, authenticated;

create table if not exists public.seller_notify_queue (
  id bigserial primary key,
  seller_id bigint not null references public.sellers(id) on delete cascade,
  req_id bigint not null,
  kind text not null check (kind in ('paid', 'd7', 'd3', 'd1')),
  ref text not null,                       -- 신청id:end_date (기간이 바뀌면 다시 보낼 수 있게)
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  tries int not null default 0,
  err text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  unique (kind, ref)
);
alter table public.seller_notify_queue enable row level security;
revoke all on public.seller_notify_queue from anon, authenticated;
create index if not exists seller_notify_pending on public.seller_notify_queue (id) where status in ('pending', 'sending');

-- 카톡 본문(200자 안) — 셀러에게 보낸다. 기간은 셀러 화면과 같은 꼴(YYYY.MM.DD).
create or replace function public._seller_notify_text(p_req bigint, p_kind text) returns text
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; v_n int; v_dow text;
begin
  select * into r from seller_plan_requests where id = p_req;
  if not found or r.end_date is null then return null; end if;
  if p_kind = 'paid' then
    return left('[맘캘린더] 이웃셀러 결제 완료' || chr(10)
      || '기간 ' || to_char(r.start_date, 'YYYY.MM.DD') || ' ~ ' || to_char(r.end_date, 'YYYY.MM.DD') || ' (' || r.months || '개월)' || chr(10)
      || '셀러 로그인 momcalendar.com/register.html' || chr(10)
      || '맘캘린더 momcalendar.com' || chr(10)
      || '카페 cafe.naver.com/momcal' || chr(10)
      || '인스타 instagram.com/momcal_', 200);
  end if;
  v_n := case p_kind when 'd7' then 7 when 'd3' then 3 else 1 end;
  v_dow := (array['일','월','화','수','목','금','토'])[extract(dow from r.end_date)::int + 1];
  return left('[맘캘린더] 이웃셀러 기간 ' || (r.end_date - public._plan_today()) || '일 남음' || chr(10)
    || to_char(r.end_date, 'YYYY.MM.DD') || '(' || v_dow || ')까지 노출되고, 그 뒤엔 노출이 멈춰요' || chr(10)
    || '끝난 다음 날부터 셀러 페이지에서 다시 신청할 수 있어요(자리 한정)' || chr(10)
    || 'momcalendar.com/register.html', 200);
end $fn$;

-- 결제 안내 넣기 — 연결된 셀러만, 결제 확정 24시간 안일 때만(오래전 결제를 「결제 완료」로 다시 보내지 않게)
create or replace function public._seller_notify_enqueue_paid(p_req bigint) returns void
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; v_body text;
begin
  select * into r from seller_plan_requests where id = p_req;
  if not found or r.status <> 'paid' or r.end_date is null or r.end_date < public._plan_today() then return; end if;
  if r.paid_at is null or r.paid_at < now() - interval '24 hours' then return; end if;
  if not exists (select 1 from seller_kakao where seller_id = r.seller_id) then return; end if;
  v_body := public._seller_notify_text(p_req, 'paid');
  if v_body is null then return; end if;
  insert into seller_notify_queue (seller_id, req_id, kind, ref, body) values (r.seller_id, p_req, 'paid', p_req || ':' || r.end_date, v_body)
  on conflict (kind, ref) do nothing;
end $fn$;

create or replace function public._plan_seller_notify_trg() returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  begin
    if new.status = 'paid' and old.status is distinct from 'paid' then
      perform public._seller_notify_enqueue_paid(new.id);
    end if;
  exception when others then null;   -- 알림 때문에 결제가 실패하면 안 된다
  end;
  return new;
end $fn$;
drop trigger if exists plan_seller_notify on public.seller_plan_requests;
create trigger plan_seller_notify after update on public.seller_plan_requests
  for each row execute function public._plan_seller_notify_trg();

-- 만료 알림(따라잡기): 남은 날 ≤7·≤3·≤1 단계 중 가장 가까운 단계 하나만, 아직 안 넣었으면 넣는다(크론이 하루 빠져도 다음 날 나간다).
create or replace function public._seller_notify_expiry() returns int
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_today date := public._plan_today(); v_n int := 0; r record; v_kind text; v_left int; v_body text; v_ref text;
begin
  for r in
    select q.id, q.seller_id, q.end_date from seller_plan_requests q
      join seller_kakao k on k.seller_id = q.seller_id
     where q.status = 'paid' and q.end_date between v_today + 1 and v_today + 7
       and not exists (select 1 from seller_plan_requests z where z.seller_id = q.seller_id and z.id <> q.id and z.status = 'paid' and z.end_date > q.end_date)
  loop
    v_left := r.end_date - v_today;
    v_kind := case when v_left <= 1 then 'd1' when v_left <= 3 then 'd3' else 'd7' end;
    v_ref := r.id || ':' || r.end_date;
    -- 더 가까운 단계를 이미 넣었으면 앞 단계는 건너뛴다
    if v_kind = 'd7' and exists (select 1 from seller_notify_queue where ref = v_ref and kind in ('d3', 'd1')) then continue; end if;
    if v_kind = 'd3' and exists (select 1 from seller_notify_queue where ref = v_ref and kind = 'd1') then continue; end if;
    v_body := public._seller_notify_text(r.id, v_kind);
    if v_body is null then continue; end if;
    insert into seller_notify_queue (seller_id, req_id, kind, ref, body) values (r.seller_id, r.id, v_kind, v_ref, v_body)
    on conflict (kind, ref) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $fn$;

-- 선점(겹친 호출이 같은 카톡을 두 번 보내지 않게) — owner_notify_claim 과 같은 방식 + 보내기 직전 다시 확인
create or replace function public.seller_notify_claim(p_n int default 10) returns setof public.seller_notify_queue
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  update seller_notify_queue set status = 'pending', claimed_at = null where status = 'sending' and claimed_at < now() - interval '5 minutes';
  -- 보낼 수 없게 된 줄은 닫는다(크론이 영원히 깨지 않게): 연결 끊김 · 신청이 더는 결제 상태가 아님 · 기간이 바뀜 · 이미 끝남
  update seller_notify_queue q set status = 'failed', err = 'not_connected'
   where q.status = 'pending' and not exists (select 1 from seller_kakao k where k.seller_id = q.seller_id);
  update seller_notify_queue q set status = 'failed', err = 'stale'
   where q.status = 'pending' and not exists (
     select 1 from seller_plan_requests r where r.id = q.req_id and r.status = 'paid' and q.ref = r.id || ':' || r.end_date and r.end_date >= public._plan_today());
  return query
    update seller_notify_queue q set status = 'sending', claimed_at = now()
     where q.id in (select id from seller_notify_queue where status = 'pending' order by id limit greatest(1, least(p_n, 20)) for update skip locked)
    returning q.*;
end $fn$;

-- Edge 만: 셀러 토큰 → 연결 시작용 state('sk'+48자). 돌아올 주소는 셀러 페이지만(서버에 보관해 콜백은 이 값으로만 보낸다). 셀러당 10분에 5번.
create or replace function public._seller_kakao_begin(p_token text, p_back text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; v_state text;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  if p_back is null or p_back !~ '^https://momcalendar\.com/register(-plan-test)?\.html(\?demo=1)?$' then
    return json_build_object('ok', false, 'msg', 'bad_back');
  end if;
  delete from seller_kakao_state where expires_at < now() - interval '1 day';
  if (select count(*) from seller_kakao_state where seller_id = v_id and expires_at > now()) >= 5 then return json_build_object('ok', false, 'msg', 'too_many'); end if;
  v_state := 'sk' || encode(gen_random_bytes(24), 'hex');
  insert into seller_kakao_state (state, seller_id, back, expires_at) values (v_state, v_id, p_back, now() + interval '10 minutes');
  return json_build_object('ok', true, 'state', v_state);
end $fn$;

-- Edge 만: 콜백에서 state 를 한 번 쓰고(지움), 그 state 의 셀러와 이 브라우저 토큰의 셀러가 같은지 본다.
--   → {ok, seller_id, back} | {ok:false, why: nostate|expired|mismatch, back?}
create or replace function public._seller_kakao_take(p_state text, p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare r seller_kakao_state%rowtype; v_me bigint;
begin
  delete from seller_kakao_state where state = p_state returning * into r;
  if not found then return json_build_object('ok', false, 'why', 'nostate'); end if;
  if r.expires_at < now() then return json_build_object('ok', false, 'why', 'expired', 'back', r.back); end if;
  v_me := public._plan_seller_id(p_token);
  if v_me is null or v_me <> r.seller_id then return json_build_object('ok', false, 'why', 'mismatch', 'back', r.back); end if;
  return json_build_object('ok', true, 'seller_id', r.seller_id, 'back', r.back);
end $fn$;

-- 셀러 화면: 지금 로그인한 셀러(자동 로그인 확인용) — 토큰이 살아 있고 로그인이 막히지 않은 셀러만
create or replace function public.seller_me(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare t record; v_id bigint;
begin
  select * into t from public._seller_from_token(p_token) limit 1;
  if t.login_insta is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  v_id := public._plan_seller_id(p_token);
  if v_id is null or exists (select 1 from sellers where id = v_id and login_active is false) then
    return json_build_object('ok', false, 'msg', 'unauthorized');
  end if;
  return json_build_object('ok', true, 'login_insta', t.login_insta, 'seller_insta', t.seller_insta, 'seller_influencer', t.seller_influencer);
end $fn$;

-- 셀러 화면: 카톡 연결 상태(이용 중 기간도 같이 — 연결 안내 문구용)
create or replace function public.seller_kakao_status(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; v_at timestamptz;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select connected_at into v_at from seller_kakao where seller_id = v_id;
  return json_build_object('ok', true, 'connected', v_at is not null, 'connected_at', v_at);
end $fn$;

-- 셀러 화면: 연결 끊기
create or replace function public.seller_kakao_disconnect(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  delete from seller_kakao where seller_id = v_id;
  update seller_notify_queue set status = 'failed', err = 'disconnected' where seller_id = v_id and status = 'pending';
  return json_build_object('ok', true);
end $fn$;

revoke all on function public._seller_notify_text(bigint, text), public._seller_notify_enqueue_paid(bigint), public._plan_seller_notify_trg(),
  public._seller_notify_expiry(), public.seller_notify_claim(int), public._seller_kakao_begin(text, text), public._seller_kakao_take(text, text)
  from public, anon, authenticated;
grant execute on function public.seller_notify_claim(int), public._seller_notify_enqueue_paid(bigint), public._seller_kakao_begin(text, text),
  public._seller_kakao_take(text, text), public._seller_notify_expiry() to service_role;
revoke all on function public.seller_me(text), public.seller_kakao_status(text), public.seller_kakao_disconnect(text) from public;
grant execute on function public.seller_me(text), public.seller_kakao_status(text), public.seller_kakao_disconnect(text) to anon, authenticated;

-- 크론: 보낼 줄이 있을 때만 부른다 · 만료 알림 매일 10:05 KST(01:05 UTC) · 매주 토큰 갱신
do $$
declare cmd text; sec text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  sec := coalesce((regexp_match(cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1], (regexp_match(cmd, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]);
  if sec is null then raise exception 'cron secret not found'; end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname in ('seller-notify', 'seller-notify-expiry', 'seller-notify-keep');
  perform cron.schedule('seller-notify', '* * * * *',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=seller_send', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 30000) where exists (select 1 from public.seller_notify_queue where status = 'pending' or (status = 'sending' and claimed_at < now() - interval '5 minutes'))$f$, sec));
  perform cron.schedule('seller-notify-expiry', '5 1 * * *', $c$ set statement_timeout = '30s'; select public._seller_notify_expiry() where exists (select 1 from public.seller_kakao); $c$);
  perform cron.schedule('seller-notify-keep', '27 19 * * 0',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/owner-notify?op=seller_keep', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 60000) where exists (select 1 from public.seller_kakao)$f$, sec));
end $$;

select jobname, schedule, active from cron.job where jobname like 'seller-notify%' order by 1;
