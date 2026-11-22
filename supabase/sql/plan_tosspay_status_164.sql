-- seller_plan_status: 카드 칸 표시를 스룩 링크 → 토스페이먼츠 공개 키 유무로 (plan_tosspay_163.sql 뒤에 적용)
--   만든 도구 scratchpad/_plan_status_patch.cjs (neighbor_plan_159.sql 의 함수를 그대로 떼어 카드 줄만 바꿈)

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
    -- 카드결제 = 토스페이먼츠 결제창(2026-11-18, 스룩 링크 폐기). 공개 키가 설정 표에 있을 때만 카드 칸이 나온다. 값은 계좌이체와 같다(여신전문금융업법 제19조)
    'card', v_state = 'pending' and exists (select 1 from app_private_config where key = 'plan_toss_client_key' and value <> ''),
    'card_url', null,
    'card_paid', exists (select 1 from plan_payments p where p.request_id = r.id and p.status = 'done'),
    'clicks', (select coalesce(sum(c.clicks), 0) from gonggu_click_stats c join gonggu g on g.id = c.id where g.insta = v_handle),
    'wishes', (select count(*) from wishes w join gonggu g on g.id = w.gonggu_id
                where g.insta = v_handle and w.created_at > now() - interval '30 days')
  );
end $$;

revoke all on function public.seller_plan_status(text) from public;
grant execute on function public.seller_plan_status(text) to anon, authenticated;
