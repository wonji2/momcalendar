-- 이웃셀러 카드결제(토스페이먼츠) 검증 지적 반영 (2026-11-18, 검증자 A~H) — plan_tosspay_163 · 164 뒤에 적용
--   A·B 승인 응답이 끊기거나 모를 때 실패로 적지 않는다. 승인 전에 결제 열쇠(paymentKey)를 DB 에 남기고,
--       서버 크론 plan-pay-sweep(3분)이 Edge plan-pay?op=sweep 을 불러 토스에 다시 물어 확정·취소·실패를 끝낸다.
--   C   금액·주문 불일치는 cancel_needed 로 적고 취소 결과를 기록한다(plan_card_mismatch).
--   G   방법 바꾸기의 카드 조건을 스룩 링크 → 토스 공개 키로. 카드 확인 중엔 방법 바꾸기·「입금했어요」를 받지 않는다.
--   H   카드로 받은 신청을 관리자가 취소하면 환불이 필요하다는 것을 health_alerts 에 올린다.
--   만든 도구 scratchpad/_plan_fix165_gen.cjs · 비밀 헤더는 open-push 잡 명령에서 읽어 쓴다(이 파일에 적지 않는다).
--   PC 가 꺼져도 돈다(pg_cron + Edge).

drop function if exists public.plan_card_begin(text, text, int);
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

-- 승인은 됐는데 금액·주문번호가 우리 값과 다르다 → 확정하지 않고 취소 대상으로 적는다(취소 결과는 plan_card_canceled 가 적는다)
create or replace function public.plan_card_mismatch(p_order_id text) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  update plan_payments set status = 'cancel_needed', fail_code = 'MISMATCH', fail_msg = '승인 응답이 주문과 다름', updated_at = now()
   where order_id = p_order_id and status = 'confirming';
  return json_build_object('ok', found);
end $fn$;

-- 서버 크론이 이어서 끝낼 주문: 90초 넘게 확인 중이거나 취소가 남은 것
create or replace function public.plan_card_resolve_list() returns json
language sql security definer set search_path to 'public', 'pg_temp' as $fn$
  select coalesce(json_agg(json_build_object('order_id', order_id, 'payment_key', payment_key, 'amount', amount, 'status', status,
                                              'age_min', floor(extract(epoch from now() - updated_at) / 60)::int) order by id), '[]'::json)
    from (select * from plan_payments
           where (status = 'confirming' and updated_at < now() - interval '90 seconds') or status = 'cancel_needed'
           order by id limit 20) x
$fn$;

-- 감시: 서버가 스스로 못 끝낸 것만 사람에게 올린다(주문당 한 번)
create or replace function public.plan_pay_watch() returns int
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare n int := 0; p record;
begin
  for p in select order_id, status, fail_msg from plan_payments
            where status in ('cancel_needed', 'confirming') and updated_at < now() - interval '15 minutes' loop
    if not exists (select 1 from health_alerts where kind = '이웃셀러결제:' || p.order_id) then
      insert into health_alerts (kind, detail) values ('이웃셀러결제:' || p.order_id,
        case when p.status = 'cancel_needed' then '결제는 됐는데 이웃셀러 확정을 못 했고 자동 취소도 15분째 안 끝남 — 토스페이먼츠 상점관리자에서 이 주문을 확인·취소: '
             else '승인 요청 뒤 15분 넘게 결과를 못 받음 — 토스페이먼츠 상점관리자에서 이 주문 상태 확인: ' end || coalesce(p.fail_msg, ''));
      n := n + 1;
    end if;
  end loop;
  return n;
end $fn$;

create or replace function public.seller_plan_method(p_token text, p_method text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
declare v_id bigint; r seller_plan_requests%rowtype;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  if p_method not in ('bank', 'card') then return json_build_object('ok', false, 'msg', 'bad_method'); end if;
  select * into r from seller_plan_requests where seller_id = v_id and status = 'pending' for update;
  if not found then return json_build_object('ok', false, 'msg', 'no_pending'); end if;
  if r.claimed_at is not null then return json_build_object('ok', false, 'msg', 'claimed'); end if;
  -- 카드 결제를 확인하는 중이면 방법을 못 바꾼다(카드로 냈는데 계좌이체로 또 내는 일 방지)
  if exists (select 1 from plan_payments p where p.request_id = r.id and p.status in ('confirming', 'done', 'cancel_needed')) then return json_build_object('ok', false, 'msg', 'in_progress'); end if;
  if p_method = 'card' and not exists (select 1 from app_private_config where key = 'plan_toss_client_key' and coalesce(value, '') <> '') then
    return json_build_object('ok', false, 'msg', 'no_card');
  end if;
  update seller_plan_requests set method = p_method where id = r.id;
  return json_build_object('ok', true);
end $$;

create or replace function public.seller_plan_claim(p_token text, p_receipt_kind text, p_receipt_no text default null) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
declare v_id bigint; v_no text; r seller_plan_requests%rowtype;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  if p_receipt_kind not in ('income', 'expense', 'none') then return json_build_object('ok', false, 'msg', 'bad_kind'); end if;
  v_no := regexp_replace(coalesce(p_receipt_no, ''), '[^0-9]', '', 'g');
  if p_receipt_kind = 'income' and length(v_no) not between 10 and 11 then return json_build_object('ok', false, 'msg', 'bad_no'); end if;
  if p_receipt_kind = 'expense' and length(v_no) <> 10 then return json_build_object('ok', false, 'msg', 'bad_no'); end if;
  select * into r from seller_plan_requests where seller_id = v_id and status = 'pending' for update;
  if not found then return json_build_object('ok', false, 'msg', 'no_pending'); end if;
  if exists (select 1 from plan_payments p where p.request_id = r.id and p.status in ('confirming', 'done', 'cancel_needed')) then return json_build_object('ok', false, 'msg', 'in_progress'); end if;   -- 카드 결제 확인 중엔 「입금했어요」를 받지 않는다
  if r.method = 'card' then p_receipt_kind := 'none'; end if;      -- 카드 결제는 카드 전표가 증빙이라 현금영수증을 받지 않는다
  update seller_plan_requests
     set claimed_at = coalesce(claimed_at, now()), receipt_kind = p_receipt_kind,
         receipt_no = case when p_receipt_kind = 'none' then null else v_no end
   where id = r.id;
  if r.claimed_at is null then            -- 알림은 처음 누를 때 한 번만(누를 때마다 쌓이지 않게)
    insert into health_alerts (kind, detail)
    values ('이웃셀러입금', case when r.method = 'card'
            then format('@%s 가 카드로 결제했다고 누름 · %s원 · 토스페이먼츠 상점관리자에서 결제 확인', r.login_insta, r.amount)
            else format('@%s 가 입금했다고 누름 · %s원 · 현금영수증 %s', r.login_insta, r.amount,
                 case p_receipt_kind when 'income' then '소득공제' when 'expense' then '지출증빙' else '안 함' end) end);
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_plan_cancel(p_id bigint, p_reason text default null) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r seller_plan_requests%rowtype; v_ok boolean;
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  select * into r from seller_plan_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if r.status not in ('pending', 'paid') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  v_ok := public._plan_revert(r);
  update seller_plan_requests set status = 'cancelled', closed_at = now(), close_reason = coalesce(p_reason, '관리자 취소') where id = p_id;
  -- 카드로 받은 신청이면 돈은 그대로다 — 환불은 토스페이먼츠 상점관리자에서 해야 한다는 것을 「고장 난 것」에 올린다
  if exists (select 1 from plan_payments p where p.request_id = p_id and p.status = 'done') then
    insert into health_alerts (kind, detail) select '이웃셀러환불:' || p.order_id, format('@%s 신청을 취소했다 · 카드 %s원은 아직 환불 전 — 토스페이먼츠 상점관리자에서 이 주문을 취소', r.login_insta, p.amount)
      from plan_payments p where p.request_id = p_id and p.status = 'done';
  end if;
  -- 노출을 못 내렸으면(누가 기간을 손으로 고쳤다) 숨기지 않고 알린다
  return json_build_object('ok', true, 'hidden', v_ok, 'msg', case when v_ok then null else 'still_showing' end);
end $$;

revoke all on function public.plan_card_begin(text, text, int, text), public.plan_card_mismatch(text), public.plan_card_resolve_list(), public.plan_pay_watch() from public, anon, authenticated;
grant execute on function public.plan_card_begin(text, text, int, text), public.plan_card_mismatch(text), public.plan_card_resolve_list() to service_role;
revoke all on function public.seller_plan_method(text, text), public.seller_plan_claim(text, text, text), public.admin_plan_cancel(bigint, text) from public;
grant execute on function public.seller_plan_method(text, text), public.seller_plan_claim(text, text, text) to anon, authenticated;
grant execute on function public.admin_plan_cancel(bigint, text) to authenticated;

do $do$
declare cmd text; sec text;
begin
  select command into cmd from cron.job where jobname = 'open-push';
  sec := coalesce((regexp_match(cmd, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1], (regexp_match(cmd, 'x-cron-secret''\s*,\s*''([^'']+)'))[1]);
  if sec is null then raise exception 'open-push 잡에서 비밀 헤더를 못 읽었다 — 크론을 만들지 않음'; end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'plan-pay-sweep';
  perform cron.schedule('plan-pay-sweep', '1-59/3 * * * *',
    format($f$select net.http_post(url := 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/plan-pay?op=sweep', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb, timeout_milliseconds := 60000) where exists (select 1 from public.plan_payments where status in ('confirming', 'cancel_needed'))$f$, sec));
end $do$;
