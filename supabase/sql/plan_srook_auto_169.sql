-- 이웃셀러 카드결제(스룩 링크) 자동 확정 (사장님 2026-11-19 「스룩도 결제되면 니가 이웃셀러 바로 해주면 되자나」)
--   흐름: PC 의 스룩 주문 수집기(sns-automation/src/srook-ship-sync.js, 예약 momcal-srook-ship-sync 1시간)가
--         입점 상품(3개월·6개월) 주문을 plan_srook_ingest 로 올린다 → plan_srook_match 가 신청과 짝을 맞춰 _plan_confirm_core 로 확정.
--   짝 맞추는 순서(카드로 고른 신청 중, 그 주문보다 먼저 만든 것만):
--     ① 주문자 전화 끝 4자리 = 셀러 연락처 끝 4자리(한 명뿐일 때)
--     ② 주문자 이름 = 셀러 담당자 이름·활동명(한 명뿐일 때)
--     ③ 그 개월 상품에 「결제했어요」를 누른 신청이 하나뿐이고, 짝 없는 주문도 하나뿐일 때
--   못 맞추면 확정하지 않고 관리자 「고장 난 것」에 한 번 올린다(사람이 관리자 「결제 확인」). 맞춘 것도 한 줄 남긴다.
--   상품 코드는 app_private_config plan_srook_code_3 / plan_srook_code_6 (이 파일에 주문자 정보는 없다).
--   🔴 스룩은 공개 API 가 없어 주문 읽기는 PC 수집기에 묶여 있다 — PC 가 꺼져 있으면 확정이 늦어진다(셀러 노출은 신청 즉시 켜져 있고, 기한은 다음 날 23:59).
--   끄기: select cron.unschedule('plan-srook-match');

create table if not exists public.srook_plan_orders (
  order_no text primary key,
  code text not null,
  months int not null,
  name text,
  phone4 text,
  ordered_at timestamptz,
  cancelled boolean not null default false,
  matched_request bigint references public.seller_plan_requests(id),
  matched_at timestamptz,
  matched_by text,
  alerted boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.srook_plan_orders enable row level security;
revoke all on public.srook_plan_orders from anon, authenticated;

insert into public.app_private_config (key, value) values ('plan_srook_code_3', 'SMO22778939'), ('plan_srook_code_6', 'SMO81187873')
on conflict (key) do nothing;

-- 수집기가 부른다: [{no, code, name, phone4, ordered}] + 취소된 주문번호 목록
create or replace function public.plan_srook_ingest(p_rows jsonb, p_cancelled jsonb default '[]'::jsonb) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare x jsonb; v_m int; n int := 0; c3 text; c6 text;
begin
  select value into c3 from app_private_config where key = 'plan_srook_code_3';
  select value into c6 from app_private_config where key = 'plan_srook_code_6';
  for x in select e from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e loop
    v_m := case x->>'code' when c3 then 3 when c6 then 6 end;
    if v_m is null or coalesce(x->>'no', '') !~ '^NMO[0-9]+-[0-9]+$' then continue; end if;
    insert into srook_plan_orders (order_no, code, months, name, phone4, ordered_at)
    values (x->>'no', x->>'code', v_m, nullif(left(x->>'name', 40), ''), nullif(left(x->>'phone4', 4), ''),
            case when coalesce(x->>'ordered', '') ~ '^\d{4}-\d\d-\d\d \d\d:\d\d' then ((x->>'ordered') || ':00+09')::timestamptz end)
    on conflict (order_no) do update set name = coalesce(excluded.name, srook_plan_orders.name), phone4 = coalesce(excluded.phone4, srook_plan_orders.phone4);
    n := n + 1;
  end loop;
  update srook_plan_orders set cancelled = true
   where cancelled = false and order_no in (select jsonb_array_elements_text(coalesce(p_cancelled, '[]'::jsonb)));
  -- 이미 확정한 주문이 취소되면 사람에게 알린다(자동으로 내리지는 않는다)
  insert into health_alerts (kind, detail)
  select '이웃셀러카드:취소', format('스룩 주문 %s 이 취소됐는데 이웃셀러 신청 %s 은 확정돼 있다 — 관리자에서 확인', o.order_no, o.matched_request)
    from srook_plan_orders o where o.cancelled and o.matched_request is not null and not o.alerted;
  update srook_plan_orders set alerted = true where cancelled and matched_request is not null and not alerted;
  return json_build_object('ok', true, 'n', n);
end $fn$;

create or replace function public.plan_srook_match() returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare o srook_plan_orders%rowtype; v_req bigint; v_by text; v json; n_ok int := 0; n_wait int := 0; n_cand int;
begin
  for o in select * from srook_plan_orders where matched_request is null and not cancelled and created_at > now() - interval '14 days' order by ordered_at nulls last, order_no loop
    v_req := null; v_by := null;
    -- 후보: 그 개월·카드로 고른 신청 중 아직 안 낸 것(입금 대기, 또는 기한이 지나 끝난 지 3일 안), 주문보다 먼저(10분 여유) 만든 것, 다른 주문과 짝지어지지 않은 것
    create temp table if not exists _cand (id bigint, seller_id bigint, claimed boolean) on commit drop;
    truncate _cand;
    insert into _cand
    select r.id, r.seller_id, r.claimed_at is not null from seller_plan_requests r
     where r.months = o.months and r.method = 'card'
       and (r.status = 'pending' or (r.status = 'expired' and r.closed_at > now() - interval '3 days'))
       and (o.ordered_at is null or r.created_at <= o.ordered_at + interval '10 minutes')
       and not exists (select 1 from srook_plan_orders p where p.matched_request = r.id);
    -- ① 전화 끝 4자리
    if o.phone4 ~ '^\d{4}$' then
      select count(*), min(c.id) into n_cand, v_req from _cand c join sellers s on s.id = c.seller_id
       where right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 4) = o.phone4;
      if n_cand = 1 then v_by := '전화 끝 4자리'; else v_req := null; end if;
    end if;
    -- ② 이름
    if v_req is null and coalesce(o.name, '') <> '' then
      select count(*), min(c.id) into n_cand, v_req from _cand c join sellers s on s.id = c.seller_id
       where o.name in (s.contact_name, s.name, s.seller_influencer);
      if n_cand = 1 then v_by := '이름'; else v_req := null; end if;
    end if;
    -- ③ 「결제했어요」를 누른 신청이 하나뿐이고 짝 없는 주문도 하나뿐
    if v_req is null then
      select count(*), min(c.id) into n_cand, v_req from _cand c where c.claimed;
      if n_cand = 1 and (select count(*) from srook_plan_orders p where p.matched_request is null and not p.cancelled and p.months = o.months and p.created_at > now() - interval '14 days') = 1
        then v_by := '결제했어요 1건'; else v_req := null; end if;
    end if;
    if v_req is null then
      n_wait := n_wait + 1;
      if not o.alerted and o.created_at < now() - interval '20 minutes' then      -- 「결제했어요」를 누를 시간을 20분 준 뒤에 알린다
        insert into health_alerts (kind, detail) values ('이웃셀러카드:짝못찾음',
          format('스룩 입점 %s개월 결제(주문 %s)가 들어왔는데 어느 셀러 신청인지 못 맞췄다 — 관리자 「이웃셀러 신청」에서 결제 확인', o.months, o.order_no));
        update srook_plan_orders set alerted = true where order_no = o.order_no;
      end if;
      continue;
    end if;
    v := public._plan_confirm_core(v_req);
    if (v->>'ok')::boolean then
      update srook_plan_orders set matched_request = v_req, matched_at = now(), matched_by = v_by where order_no = o.order_no;
      update seller_plan_requests set claimed_at = coalesce(claimed_at, now()), receipt_kind = 'none', receipt_no = null where id = v_req;
      insert into health_alerts (kind, detail)
      select '이웃셀러카드확정', format('@%s 이웃셀러 %s개월 카드 결제 확인(스룩 주문 %s · %s로 맞춤) → 자동 확정', r.login_insta, r.months, o.order_no, v_by)
        from seller_plan_requests r where r.id = v_req;
      n_ok := n_ok + 1;
    else
      n_wait := n_wait + 1;
      if not o.alerted then
        insert into health_alerts (kind, detail) values ('이웃셀러카드:확정실패',
          format('스룩 입점 결제(주문 %s)의 신청 %s 을 확정하지 못했다(%s) — 관리자에서 확인, 필요하면 스룩에서 환불', o.order_no, v_req, coalesce(v->>'msg', '')));
        update srook_plan_orders set alerted = true where order_no = o.order_no;
      end if;
    end if;
  end loop;
  return json_build_object('ok', true, 'confirmed', n_ok, 'waiting', n_wait);
end $fn$;

revoke all on function public.plan_srook_ingest(jsonb, jsonb), public.plan_srook_match() from public, anon, authenticated;

-- 「결제했어요」를 나중에 누른 경우도 잡게 10분마다(순수 SQL — 짝 없는 주문이 없으면 하는 일이 없다)
select cron.unschedule('plan-srook-match') where exists (select 1 from cron.job where jobname = 'plan-srook-match');
select cron.schedule('plan-srook-match', '5-59/10 * * * *', $c$ set statement_timeout = '20s'; select public.plan_srook_match() where exists (select 1 from public.srook_plan_orders where matched_request is null and not cancelled); $c$);
