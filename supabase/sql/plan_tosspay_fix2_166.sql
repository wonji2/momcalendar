-- 이웃셀러 카드결제(토스페이먼츠) 재검증 지적 반영 (2026-11-18, N1·N3) — plan_tosspay_fix_165 뒤에 적용
--   N1 결제 열쇠 하나는 주문 하나에만 쓴다: 다른 주문에 이미 적힌 열쇠로 승인을 시작하지 못한다(지난 결제를 새 주문에 끼워 넣기 방지).
--      Edge plan-pay 쪽도 조회한 결제의 주문번호가 다르면 건드리지 않게 고쳤다.
--   N3 카드 열쇠가 없으면 카드로 신청을 시작하지 못한다(화면은 늘 계좌이체로 시작하지만 서버에서도 막는다) → 트리거로.
--   PC 가 꺼져도 돈다(DB).

create unique index if not exists plan_payments_key_once on public.plan_payments (payment_key) where payment_key is not null;

create or replace function public.plan_card_begin(p_token text, p_order_id text, p_amount int, p_payment_key text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $fn$
declare v_id bigint; p plan_payments%rowtype; r seller_plan_requests%rowtype;
begin
  if p_payment_key is null or length(p_payment_key) = 0 or length(p_payment_key) > 200 then return json_build_object('ok', false, 'msg', 'bad'); end if;
  v_id := public._plan_seller_id(p_token);
  if v_id is null then return json_build_object('ok', false, 'msg', 'unauthorized'); end if;
  select * into p from plan_payments where order_id = p_order_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  select * into r from seller_plan_requests where id = p.request_id for update;
  if r.seller_id <> v_id then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if p.amount <> p_amount or r.amount <> p_amount then return json_build_object('ok', false, 'msg', 'amount'); end if;
  if p.status = 'done' then return json_build_object('ok', true, 'done', true); end if;
  -- 확인 중인 주문은 서버 크론이 이어서 끝낸다. 화면에서 또 부르면 기다리라고만 한다(승인 호출이 겹치지 않게)
  if p.status = 'confirming' then return json_build_object('ok', false, 'msg', 'in_progress'); end if;
  if p.status not in ('ready', 'failed') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  -- 이 결제 열쇠가 다른 주문에 이미 쓰였으면 거절한다
  if exists (select 1 from plan_payments where payment_key = p_payment_key and id <> p.id) then return json_build_object('ok', false, 'msg', 'bad'); end if;
  if r.status not in ('pending', 'expired') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  if exists (select 1 from plan_payments where request_id = r.id and id <> p.id and status in ('confirming', 'done', 'cancel_needed')) then
    return json_build_object('ok', false, 'msg', 'in_progress');
  end if;
  if r.status = 'expired' and (exists (select 1 from seller_plan_requests where seller_id = r.seller_id and status = 'pending')
     or exists (select 1 from seller_plan_requests where seller_id = r.seller_id and id <> r.id and status = 'paid' and end_date >= public._plan_today())) then
    return json_build_object('ok', false, 'msg', 'closed');
  end if;
  if not (r.status = 'pending' and r.activated) and public._plan_slots_used() >= 12 then return json_build_object('ok', false, 'msg', 'full'); end if;
  update plan_payments set status = 'confirming', payment_key = p_payment_key, fail_code = null, fail_msg = null, updated_at = now() where id = p.id;
  return json_build_object('ok', true);
end $fn$;
revoke all on function public.plan_card_begin(text, text, int, text) from public, anon, authenticated;
grant execute on function public.plan_card_begin(text, text, int, text) to service_role;

-- 실패로 닫힌 주문의 결제 열쇠는 비운다(같은 열쇠로 다시 시도할 수 있게, 그리고 한 열쇠 한 주문 규칙에 걸리지 않게)
create or replace function public._plan_pay_key_tidy() returns trigger language plpgsql as $fn$
begin
  if new.status = 'failed' then new.payment_key := null; end if;
  return new;
end $fn$;
drop trigger if exists plan_payments_key_tidy on public.plan_payments;
create trigger plan_payments_key_tidy before update on public.plan_payments for each row execute function public._plan_pay_key_tidy();

-- 카드 열쇠가 없는데 카드로 시작한 신청은 계좌이체로 바꿔 받는다(계좌 안내가 보이게)
create or replace function public._plan_req_method_guard() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if new.method = 'card' and not exists (select 1 from app_private_config where key = 'plan_toss_client_key' and coalesce(value, '') <> '') then
    new.method := 'bank';
  end if;
  return new;
end $fn$;
drop trigger if exists seller_plan_req_method_guard on public.seller_plan_requests;
create trigger seller_plan_req_method_guard before insert on public.seller_plan_requests for each row execute function public._plan_req_method_guard();
revoke all on function public._plan_pay_key_tidy(), public._plan_req_method_guard() from public, anon, authenticated;
