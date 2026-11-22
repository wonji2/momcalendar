-- 이웃셀러 패키지 카드결제 = 토스페이먼츠 (사장님 2026-11-18 「토스페이먼츠 붙여 스룩말고」)
--   설계서 scratchpad/designs/2026-11-18_이웃셀러_토스페이먼츠.md · 서버 함수 supabase/functions/plan-pay
--   흐름: 셀러 「카드로 결제하기」 → seller_plan_card_order(주문번호·금액을 서버가 먼저 저장) → 토스 결제창 → 돌아오면
--         Edge plan-pay 가 plan_card_begin(금액·주인 대조) → 토스 승인 API → plan_card_finish(이웃셀러 확정)
--         확정을 못 하면 결제 취소 → plan_card_canceled
--   열쇠: 공개 키(클라이언트 키)는 app_private_config.plan_toss_client_key · 시크릿 키는 Supabase 시크릿 TOSSPAY_SECRET_KEY 에만.
--         이 파일·코드에 적지 않는다. 공개 키가 없으면 카드 칸이 화면에 안 나온다(계좌이체만).
--   스룩 링크(plan_card_url_3/6)는 더 안 쓴다. 상태 함수의 카드 줄은 이 파일을 적용한 뒤 scratchpad/_plan_status_patch.cjs 가 바꾼다.
--   PC 가 꺼져도 도는가: 서버(DB 함수 + Edge 함수)라 돈다. 관리자 손 확인 없이 결제 즉시 확정.
--   되돌리기: drop function seller_plan_card_order(text), plan_card_begin(text,text,int),
--             plan_card_finish(text,text,boolean,text,timestamptz,text,text,text), plan_card_canceled(text,boolean,text);
--             drop table plan_payments; neighbor_plan_159.sql 의 seller_plan_status · admin_plan_confirm 다시 적용.

create table if not exists public.plan_payments (
  id bigserial primary key,
  request_id bigint not null references public.seller_plan_requests(id),
  order_id text not null unique,
  amount int not null,
  customer_key text not null,
  status text not null default 'ready' check (status in ('ready', 'confirming', 'done', 'failed', 'cancel_needed', 'canceled')),
  payment_key text,
  method text,
  approved_at timestamptz,
  receipt_url text,
  fail_code text,
  fail_msg text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_payments_request on public.plan_payments (request_id);
alter table public.plan_payments enable row level security;
revoke all on public.plan_payments from anon, authenticated;

-- 입금·결제 확정의 몸통(관리자 「입금 확인」과 카드 승인이 같이 쓴다). 내용은 neighbor_plan_159.sql 의 admin_plan_confirm 과 같다.
create or replace function public._plan_confirm_core(p_id bigint) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare r seller_plan_requests%rowtype; v_today date := public._plan_today(); v_end date;
begin
  select * into r from seller_plan_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if r.status not in ('pending', 'expired') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  if r.status = 'expired' and exists (select 1 from seller_plan_requests where seller_id = r.seller_id and status = 'pending') then
    return json_build_object('ok', false, 'msg', 'has_newer');
  end if;
  if r.status = 'expired' and exists (select 1 from seller_plan_requests where seller_id = r.seller_id and id <> r.id and status = 'paid' and end_date >= v_today) then
    return json_build_object('ok', false, 'msg', 'already_active');
  end if;
  if r.status = 'pending' and r.activated then
    update seller_plan_requests set status = 'paid', paid_at = now() where id = p_id;
    return json_build_object('ok', true);
  end if;
  v_end := (v_today + make_interval(months => r.months) - interval '1 day')::date;
  update seller_plan_requests set activated = false where id = p_id;
  if not public._plan_show(p_id, v_today, v_end) then return json_build_object('ok', false, 'msg', 'full'); end if;
  update seller_plan_requests set status = 'paid', paid_at = now(), closed_at = null, close_reason = null where id = p_id;
  return json_build_object('ok', true, 'revived', r.status = 'expired');
end $fn$;

create or replace function public.admin_plan_confirm(p_id bigint) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  return public._plan_confirm_core(p_id);
end $fn$;

-- 셀러: 카드 주문 만들기. 금액은 서버가 정하고 먼저 저장한다(토스 문서: 결제 요청 전에 orderId·amount 저장).
create or replace function public.seller_plan_card_order(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; r seller_plan_requests%rowtype; v_key text; v_order text; v_cust text; v_recent int;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select nullif(value, '') into v_key from app_private_config where key = 'plan_toss_client_key';
  if v_key is null then return json_build_object('ok', false, 'msg', 'no_card'); end if;
  select * into r from seller_plan_requests where seller_id = v_id and status = 'pending' order by id desc limit 1 for update;
  if not found then return json_build_object('ok', false, 'msg', 'no_pending'); end if;
  -- 계좌이체로 「입금했어요」를 누른 뒤엔 카드로 또 받지 않는다(이중 수납 방지)
  if r.claimed_at is not null then return json_build_object('ok', false, 'msg', 'claimed'); end if;
  if not r.activated and public._plan_slots_used() >= 12 then return json_build_object('ok', false, 'msg', 'full'); end if;
  if exists (select 1 from plan_payments where request_id = r.id and status in ('confirming', 'done', 'cancel_needed')) then
    return json_build_object('ok', false, 'msg', 'in_progress');
  end if;
  select count(*) into v_recent from plan_payments where request_id = r.id and created_at > now() - interval '1 hour';
  if v_recent >= 20 then return json_build_object('ok', false, 'msg', 'too_many'); end if;
  if r.method <> 'card' then update seller_plan_requests set method = 'card' where id = r.id; end if;
  v_order := 'mcplan-' || r.id || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_cust := gen_random_uuid()::text;
  insert into plan_payments (request_id, order_id, amount, customer_key) values (r.id, v_order, r.amount, v_cust);
  return json_build_object('ok', true, 'order_id', v_order, 'amount', r.amount,
                           'order_name', '맘캘린더 이웃셀러 ' || r.months || '개월',
                           'customer_key', v_cust, 'client_key', v_key);
end $fn$;

-- 아래 셋은 Edge 함수(plan-pay, service_role)만 부른다.
-- 승인 전 대조: 이 주문이 이 셀러 것인가 · 금액이 저장한 값과 같은가 · 확정할 수 있는 신청인가. 통과하면 confirming 으로 잠근다.
create or replace function public.plan_card_begin(p_token text, p_order_id text, p_amount int) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; p plan_payments%rowtype; r seller_plan_requests%rowtype;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select * into p from plan_payments where order_id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  select * into r from seller_plan_requests where id = p.request_id for update;
  if r.seller_id <> v_id then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if p.amount <> p_amount or r.amount <> p_amount then return json_build_object('ok', false, 'msg', 'amount'); end if;
  if p.status = 'done' then return json_build_object('ok', true, 'done', true); end if;
  if p.status = 'confirming' and p.updated_at > now() - interval '2 minutes' then return json_build_object('ok', false, 'msg', 'in_progress'); end if;
  if p.status not in ('ready', 'confirming', 'failed') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  if r.status not in ('pending', 'expired') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  if exists (select 1 from plan_payments where request_id = r.id and id <> p.id and status in ('confirming', 'done', 'cancel_needed')) then
    return json_build_object('ok', false, 'msg', 'in_progress');
  end if;
  if r.status = 'expired' and (exists (select 1 from seller_plan_requests where seller_id = r.seller_id and status = 'pending')
     or exists (select 1 from seller_plan_requests where seller_id = r.seller_id and id <> r.id and status = 'paid' and end_date >= public._plan_today())) then
    return json_build_object('ok', false, 'msg', 'closed');
  end if;
  if not (r.status = 'pending' and r.activated) and public._plan_slots_used() >= 12 then return json_build_object('ok', false, 'msg', 'full'); end if;
  update plan_payments set status = 'confirming', updated_at = now() where id = p.id;
  return json_build_object('ok', true);
end $fn$;

-- 승인 결과 적기. p_ok=true 면 이웃셀러를 확정한다. 확정을 못 하면 need_cancel=true (Edge 가 결제를 취소한다).
create or replace function public.plan_card_finish(p_order_id text, p_payment_key text, p_ok boolean, p_method text default null,
  p_approved_at timestamptz default null, p_receipt_url text default null, p_code text default null, p_msg text default null) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare p plan_payments%rowtype; v json;
begin
  select * into p from plan_payments where order_id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if p.status = 'done' then return json_build_object('ok', true, 'done', true); end if;
  if p.status <> 'confirming' then return json_build_object('ok', false, 'msg', 'closed'); end if;
  if not p_ok then
    update plan_payments set status = 'failed', payment_key = coalesce(left(p_payment_key, 200), payment_key),
           fail_code = left(p_code, 80), fail_msg = left(p_msg, 300), updated_at = now() where id = p.id;
    return json_build_object('ok', true);
  end if;
  v := public._plan_confirm_core(p.request_id);
  if (v->>'ok')::boolean is not true then
    update plan_payments set status = 'cancel_needed', payment_key = left(p_payment_key, 200), method = left(p_method, 40), approved_at = p_approved_at,
           receipt_url = left(p_receipt_url, 500), fail_code = 'activate', fail_msg = left(v->>'msg', 300), updated_at = now() where id = p.id;
    return json_build_object('ok', false, 'msg', coalesce(v->>'msg', 'closed'), 'need_cancel', true);
  end if;
  update plan_payments set status = 'done', payment_key = left(p_payment_key, 200), method = left(p_method, 40), approved_at = coalesce(p_approved_at, now()),
         receipt_url = left(p_receipt_url, 500), fail_code = null, fail_msg = null, updated_at = now() where id = p.id;
  update seller_plan_requests set method = 'card', claimed_at = coalesce(claimed_at, now()), receipt_kind = 'none', receipt_no = null where id = p.request_id;
  return json_build_object('ok', true);
end $fn$;

create or replace function public.plan_card_canceled(p_order_id text, p_ok boolean, p_msg text default null) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  update plan_payments set status = case when p_ok then 'canceled' else 'cancel_needed' end,
         fail_msg = left(coalesce(p_msg, fail_msg), 300), updated_at = now()
   where order_id = p_order_id and status = 'cancel_needed';
  return json_build_object('ok', true);
end $fn$;

revoke all on function public._plan_confirm_core(bigint), public.plan_card_begin(text, text, int),
  public.plan_card_finish(text, text, boolean, text, timestamptz, text, text, text), public.plan_card_canceled(text, boolean, text) from public, anon, authenticated;
grant execute on function public.plan_card_begin(text, text, int),
  public.plan_card_finish(text, text, boolean, text, timestamptz, text, text, text), public.plan_card_canceled(text, boolean, text) to service_role;
revoke all on function public.seller_plan_card_order(text), public.admin_plan_confirm(bigint) from public;
grant execute on function public.seller_plan_card_order(text) to anon, authenticated;
grant execute on function public.admin_plan_confirm(bigint) to authenticated;

-- 감시: 결제는 됐는데 확정·취소가 안 끝난 주문을 관리자 「고장 난 것」에 올린다(주문당 한 번). 10분마다, 서버에서.
create or replace function public.plan_pay_watch() returns int
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare n int := 0; p record;
begin
  for p in select order_id, status, fail_msg from plan_payments
            where (status = 'cancel_needed' and updated_at < now() - interval '5 minutes')
               or (status = 'confirming' and updated_at < now() - interval '10 minutes') loop
    if not exists (select 1 from health_alerts where kind = '이웃셀러결제:' || p.order_id) then
      insert into health_alerts (kind, detail) values ('이웃셀러결제:' || p.order_id,
        case when p.status = 'cancel_needed' then '결제는 됐는데 이웃셀러 확정을 못 했고 자동 취소도 안 끝남 — 토스페이먼츠 상점관리자에서 이 주문을 확인·취소: '
             else '승인 요청 뒤 10분 넘게 결과가 안 적힘 — 토스페이먼츠 상점관리자에서 이 주문 상태 확인: ' end || coalesce(p.fail_msg, ''));
      n := n + 1;
    end if;
  end loop;
  return n;
end $fn$;
revoke all on function public.plan_pay_watch() from public, anon, authenticated;
select cron.unschedule('plan-pay-watch') where exists (select 1 from cron.job where jobname = 'plan-pay-watch');
select cron.schedule('plan-pay-watch', '7-59/10 * * * *', $c$ set statement_timeout = '20s'; select public.plan_pay_watch(); $c$);
