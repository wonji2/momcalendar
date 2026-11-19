-- 이웃셀러 카드결제를 다시 스룩 결제 링크로 (사장님 2026-11-19 「스룩으로 연동하자 그럼」)
--   까닭: 토스페이먼츠는 카드 3.4%+부가세(3.74%)에 가입비 22만·연관리비 11만, 스룩은 약 3.3%·이미 계약·보증보험 가입됨.
--   seller_plan_status · seller_plan_method 를 neighbor_plan_159.sql 의 원래 것으로 되돌린다(링크는 app_private_config plan_card_url_3/6).
--   토스 쪽(plan_payments · plan_card_* · Edge plan-pay · 크론 plan-pay-sweep/watch)은 지우지 않고 둔다 — 열쇠가 없어 아무 일도 안 한다.
--   다시 토스로 가려면 plan_tosspay_status_164.sql 과 plan_tosspay_fix_165.sql 의 seller_plan_method 를 다시 적용.
--   카드 결제 확인은 예전처럼 사장님이 스룩 주문을 보고 관리자 「결제 확인」. PC 가 꺼져도 돈다(서버·스룩).
--   만든 도구 scratchpad/_plan_srook_back_gen.cjs

create or replace function public.seller_plan_status(p_token text) returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
declare v_id bigint; s sellers%rowtype; r seller_plan_requests%rowtype; v_today date := public._plan_today();
        v_handle text; v_state text := 'none'; v_bank json := null; v_strikes int; v_manual boolean := false;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  select * into s from sellers where id = v_id;
  select * into r from seller_plan_requests where seller_id = v_id and status = 'pending' order by id desc limit 1;
  if found then
    v_state := 'pending';
    if r.method = 'bank' then
      select json_build_object(
        'name',   (select value from app_private_config where key = 'plan_bank_name'),
        'no',     (select value from app_private_config where key = 'plan_bank_no'),
        'holder', (select value from app_private_config where key = 'plan_bank_holder')) into v_bank;
    end if;
  else
    select * into r from seller_plan_requests
     where seller_id = v_id and status = 'paid' and end_date >= v_today order by end_date desc limit 1;
    if found and s.is_partner is true and s.active is true then v_state := 'active'; end if;
  end if;
  -- 신청 기록 없이 관리자가 손으로 켜 둔 이웃셀러도 이용 중으로 보여 준다(신청 버튼을 보여 주면 눌러도 already_active 만 돌아온다)
  if v_state = 'none' and s.is_partner is true and s.active is true and (s.end_date is null or s.end_date >= v_today)
     and (s.start_date is null or s.start_date <= v_today) then
    v_state := 'active'; v_manual := true;
  end if;
  v_strikes := public._plan_strikes(v_id);
  v_handle := replace(coalesce(nullif(s.seller_insta, ''), s.login_insta), '@', '');
  return json_build_object(
    'state', v_state,
    'prices', json_build_object('3', public._plan_price(3), '6', public._plan_price(6)),
    'slots_left', greatest(0, 12 - public._plan_slots_used()),
    'pay_first', v_strikes >= 2,                       -- true 면 입금 확인 뒤에 노출
    'blocked', v_strikes >= 4,
    'last_closed', (select json_build_object('status', c.status, 'at', c.closed_at) from seller_plan_requests c
                     where c.seller_id = v_id and c.status in ('expired', 'cancelled') and c.closed_at > now() - interval '7 days'
                     order by c.id desc limit 1),
    'months', r.months, 'amount', r.amount, 'method', r.method,
    'showing', coalesce(r.activated, false),
    'pay_due', r.pay_due, 'claimed', r.claimed_at is not null,
    'receipt_kind', r.receipt_kind,
    'end_date', case when v_manual then s.end_date when v_state = 'none' then null else r.end_date end,
    'dday', case when v_manual then s.end_date - v_today when v_state = 'none' or r.end_date is null then null else r.end_date - v_today end,
    'bank', v_bank,
    -- 카드결제(스룩페이 상품 링크) — 설정 표에 링크가 있을 때만 화면에 카드 칸이 나온다. 값은 계좌이체와 같다(여신전문금융업법 제19조)
    'card_url', case when v_state = 'pending' then (select nullif(value, '') from app_private_config where key = 'plan_card_url_' || r.months) end,
    'clicks', (select coalesce(sum(c.clicks), 0) from gonggu_click_stats c join gonggu g on g.id = c.id where g.insta = v_handle),
    'wishes', (select count(*) from wishes w join gonggu g on g.id = w.gonggu_id
                where g.insta = v_handle and w.created_at > now() - interval '30 days')
  );
end $$;

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
  if p_method = 'card' and not exists (select 1 from app_private_config where key = 'plan_card_url_' || r.months and coalesce(value, '') <> '') then
    return json_build_object('ok', false, 'msg', 'no_card');
  end if;
  update seller_plan_requests set method = p_method where id = r.id;
  return json_build_object('ok', true);
end $$;

revoke all on function public.seller_plan_status(text), public.seller_plan_method(text, text) from public;
grant execute on function public.seller_plan_status(text), public.seller_plan_method(text, text) to anon, authenticated;
-- 카드 열쇠(토스)가 없으면 카드 신청을 계좌이체로 바꾸던 트리거는 스룩 방식에선 맞지 않는다 → 뗀다
drop trigger if exists seller_plan_req_method_guard on public.seller_plan_requests;
