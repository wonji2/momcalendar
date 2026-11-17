-- 이웃셀러 유료 패키지(3개월 29만 · 6개월 49만) 1단계: 신청 · 계좌이체 입금 · 관리자 확인 · 미입금 자동 취소
--   사장님 지시 2026-11-17 (기획서 scratchpad/designs/2026-11-17_이웃셀러_패키지.md)
--   · 「바로 시작」 → 승인 없이 그 자리에서 이웃셀러 노출(sellers.is_partner·active·start_date·end_date) · 입금 기한 = 다음 날 23:59 KST
--   · 기한까지 입금 확인이 없으면 크론이 신청을 끝내고 노출을 내린다. 다시 하려면 새로 신청
--   · 미입금으로 끝난 적이 2번 이상인 셀러는 그다음부터 입금 확인 뒤에 노출(하루씩 공짜 노출 되풀이 방지)
--   · 동시에 최대 12명 · 값은 부가세 포함 · 계좌이체와 카드 같은 값
--   🔴 계좌번호·예금주는 이 파일에 적지 않는다(공개 저장소). app_private_config 표에 관리자 권한으로 따로 넣는다:
--        insert into app_private_config(key,value) values ('plan_bank_name','…'),('plan_bank_no','…'),('plan_bank_holder','…')
--        on conflict (key) do update set value=excluded.value, updated_at=now();
--   손님(anon)이 직접 읽는 표는 없다. 전부 서버 함수(셀러 토큰 · 관리자 JWT)로만.
--   검토 반영(2026-11-17, 맥락 없는 검토자 2명): 신청 전 값 보관 후 그대로 복원(prev) · 못 내리면 숨기지 않고 알림 · 만료된 신청도 「입금 확인」으로 되살림
--     · 노출 전 대기는 자리에 안 셈 · 미입금 4번이면 신청 안 받음 · 미입금 횟수는 마지막 입금 뒤부터 · 「입금했어요」 알림 1번만 · 현금영수증 번호 14일/60일 뒤 지움
--     · 알고 두는 것: 미입금 체험도 partner_history 트리거에 한 줄 남는다 · 내린 뒤 화면에서 사라지기까지 최대 약 18분(크론 10분 + 캐시)
--   PC 가 꺼져도 도는가: ✅ 전부 서버(pg_cron neighbor-plan-tick 10분).
--   되돌리기: select cron.unschedule('neighbor-plan-tick'); drop function … ; drop table seller_plan_requests, app_private_config;

create table if not exists public.app_private_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_private_config enable row level security;
revoke all on public.app_private_config from anon, authenticated;

create table if not exists public.seller_plan_requests (
  id bigserial primary key,
  seller_id bigint not null references public.sellers(id),
  login_insta text not null,
  months int not null check (months in (3, 6)),
  amount int not null,
  method text not null default 'bank' check (method in ('bank', 'card')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'cancelled')),
  activated boolean not null default false,          -- 이 신청이 이웃셀러 노출을 켰는가(되돌릴 때 이 신청이 켠 것만 끈다)
  prev jsonb,                                        -- 노출을 켜기 직전의 sellers 값(is_partner·active·start_date·end_date) — 되돌릴 때 이 값으로
  start_date date,
  end_date date,
  pay_due timestamptz not null,
  receipt_kind text check (receipt_kind in ('income', 'expense', 'none')),
  receipt_no text,
  claimed_at timestamptz,                            -- 셀러가 「입금했어요」를 누른 시각
  paid_at timestamptz,                               -- 관리자가 입금을 확인한 시각
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists seller_plan_one_pending on public.seller_plan_requests (seller_id) where status = 'pending';
create index if not exists seller_plan_status_due on public.seller_plan_requests (status, pay_due);
alter table public.seller_plan_requests enable row level security;
revoke all on public.seller_plan_requests from anon, authenticated;

-- ── 안에서만 쓰는 것 ─────────────────────────────────────────────
create or replace function public._plan_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function public._plan_price(p_months int) returns int
language sql immutable as $$ select case p_months when 3 then 290000 when 6 then 490000 end $$;

-- 토큰 → sellers.id (없으면 null)
create or replace function public._plan_seller_id(p_token text) returns bigint
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
declare v_login text; v_id bigint;
begin
  select t.login_insta into v_login from public._seller_from_token(p_token) t;
  if v_login is null then return null; end if;
  select s.id into v_id from sellers s
   where public.seller_id_norm(s.login_insta) = public.seller_id_norm(v_login)
   order by s.id limit 1;
  return v_id;
end $$;

-- 지금 차 있는 자리: 노출 중인 이웃셀러만. 노출 전 입금 대기는 세지 않는다(미입금 셀러가 신청만 되풀이해 자리를 막지 못하게).
-- 12명 검사는 노출을 켜는 순간마다 한다(바로 시작 · 관리자 입금 확인).
-- 미입금으로 끝난 횟수 — 마지막으로 입금이 확인된 뒤부터만 센다(한 번 낸 셀러의 옛 기록이 계속 따라다니지 않게)
create or replace function public._plan_strikes(p_seller bigint) returns int
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select count(*)::int from seller_plan_requests r
   where r.seller_id = p_seller and r.status = 'expired'
     and r.id > coalesce((select max(p.id) from seller_plan_requests p where p.seller_id = p_seller and p.status = 'paid'), 0)
$$;

create or replace function public._plan_slots_used() returns int
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select count(*)::int from sellers s
   where s.is_partner is true and s.active is true
     and (s.end_date is null or s.end_date >= public._plan_today())
$$;

-- 노출을 켠다(직전 값을 신청 줄에 적어 둔다). 자리가 없으면 false
create or replace function public._plan_show(p_id bigint, p_start date, p_end date) returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r seller_plan_requests%rowtype; s sellers%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('neighbor_plan'));
  select * into r from seller_plan_requests where id = p_id for update;
  select * into s from sellers where id = r.seller_id for update;
  if public._plan_slots_used() >= 12 then return false; end if;
  update seller_plan_requests
     set activated = true, start_date = p_start, end_date = p_end,
         prev = jsonb_build_object('is_partner', s.is_partner, 'active', s.active, 'start_date', s.start_date, 'end_date', s.end_date)
   where id = p_id;
  update sellers set is_partner = true, active = true, start_date = p_start, end_date = p_end where id = r.seller_id;
  return true;
end $$;

-- 이 신청이 켠 노출을 끄고 신청 전 값으로 되돌린다. 되돌렸으면(또는 켠 적이 없으면) true.
-- 그 사이 누가 sellers 의 기간을 손으로 고쳤으면 건드리지 않고 false — 부르는 쪽이 알린다.
create or replace function public._plan_revert(p_req seller_plan_requests) returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare n int;
begin
  if not p_req.activated then return true; end if;
  update sellers
     set is_partner = coalesce((p_req.prev->>'is_partner')::boolean, false),
         active     = coalesce((p_req.prev->>'active')::boolean, active),
         start_date = (p_req.prev->>'start_date')::date,
         end_date   = (p_req.prev->>'end_date')::date
   where id = p_req.seller_id and is_partner is true
     and start_date is not distinct from p_req.start_date and end_date is not distinct from p_req.end_date;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ── 셀러 ─────────────────────────────────────────────────────────
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
    'clicks', (select coalesce(sum(c.clicks), 0) from gonggu_click_stats c join gonggu g on g.id = c.id where g.insta = v_handle),
    'wishes', (select count(*) from wishes w join gonggu g on g.id = w.gonggu_id
                where g.insta = v_handle and w.created_at > now() - interval '30 days')
  );
end $$;

create or replace function public.seller_plan_start(p_token text, p_months int, p_method text default 'bank') returns json
language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp' as $$
declare v_id bigint; s sellers%rowtype; v_today date := public._plan_today(); v_end date; v_due timestamptz;
        v_strikes int; v_show boolean; v_amount int; v_req bigint;
begin
  v_id := public._plan_seller_id(p_token);
  if v_id is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  v_amount := public._plan_price(p_months);
  if v_amount is null then return json_build_object('ok', false, 'msg', 'bad_months'); end if;
  if p_method not in ('bank', 'card') then return json_build_object('ok', false, 'msg', 'bad_method'); end if;

  perform pg_advisory_xact_lock(hashtext('neighbor_plan'));       -- 12번째 자리를 둘이 동시에 잡지 못하게
  select * into s from sellers where id = v_id for update;
  if exists (select 1 from seller_plan_requests where seller_id = v_id and status = 'pending') then
    return json_build_object('ok', true, 'msg', 'already_pending');
  end if;
  if s.is_partner is true and s.active is true and (s.end_date is null or s.end_date >= v_today) then
    return json_build_object('ok', false, 'msg', 'already_active');   -- 이용 중이거나 관리자가 손으로 켜 둔 이웃셀러
  end if;

  v_strikes := public._plan_strikes(v_id);
  if v_strikes >= 4 then return json_build_object('ok', false, 'msg', 'blocked'); end if;   -- 미입금 4번이면 신청을 받지 않는다(카톡 채널로)
  v_show := v_strikes < 2;                                        -- 미입금 2번부터는 입금 확인 뒤 노출
  if v_show and public._plan_slots_used() >= 12 then return json_build_object('ok', false, 'msg', 'full'); end if;
  v_end := (v_today + make_interval(months => p_months) - interval '1 day')::date;
  v_due := ((v_today + 2)::timestamp at time zone 'Asia/Seoul') - interval '1 second';   -- 다음 날 23:59:59 KST

  insert into seller_plan_requests (seller_id, login_insta, months, amount, method, pay_due)
  values (v_id, s.login_insta, p_months, v_amount, p_method, v_due) returning id into v_req;
  if v_show and not public._plan_show(v_req, v_today, v_end) then
    delete from seller_plan_requests where id = v_req;
    return json_build_object('ok', false, 'msg', 'full');
  end if;
  insert into health_alerts (kind, detail)
  values ('이웃셀러신청', format('@%s %s개월 %s원 · %s · 입금 기한 %s', s.login_insta,
          p_months, v_amount, case when v_show then '바로 노출' else '입금 확인 뒤 노출' end, to_char(v_due at time zone 'Asia/Seoul', 'MM-DD HH24:MI')));
  return json_build_object('ok', true, 'msg', 'started', 'showing', v_show);
end $$;

-- 「입금했어요」 + 현금영수증
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
  update seller_plan_requests
     set claimed_at = coalesce(claimed_at, now()), receipt_kind = p_receipt_kind,
         receipt_no = case when p_receipt_kind = 'none' then null else v_no end
   where id = r.id;
  if r.claimed_at is null then            -- 알림은 처음 누를 때 한 번만(누를 때마다 쌓이지 않게)
    insert into health_alerts (kind, detail)
    values ('이웃셀러입금', format('@%s 가 입금했다고 누름 · %s원 · 현금영수증 %s', r.login_insta, r.amount,
            case p_receipt_kind when 'income' then '소득공제' when 'expense' then '지출증빙' else '안 함' end));
  end if;
  return json_build_object('ok', true);
end $$;

-- ── 관리자 ───────────────────────────────────────────────────────
create or replace function public.admin_plan_list() returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  return json_build_object('ok', true, 'slots_used', public._plan_slots_used(), 'rows', coalesce((
    select json_agg(x order by x.id desc) from (
      select r.id, r.login_insta, s.name, r.months, r.amount, r.method, r.status, r.activated, r.start_date, r.end_date,
             r.pay_due, r.claimed_at, r.paid_at, r.receipt_kind, r.receipt_no, r.close_reason, r.created_at
        from seller_plan_requests r join sellers s on s.id = r.seller_id
       order by r.id desc limit 200) x), '[]'::json));
end $$;

-- 입금 확인. 입금 대기뿐 아니라 「기한이 지나 끝난 신청」도 되살린다(셀러는 냈는데 확인이 늦은 경우).
create or replace function public.admin_plan_confirm(p_id bigint) returns json
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r seller_plan_requests%rowtype; v_today date := public._plan_today(); v_end date;
begin
  if not public.is_app_admin() then return json_build_object('ok', false, 'msg', 'forbidden'); end if;
  select * into r from seller_plan_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'msg', 'notfound'); end if;
  if r.status not in ('pending', 'expired') then return json_build_object('ok', false, 'msg', 'closed'); end if;
  if r.status = 'expired' and exists (select 1 from seller_plan_requests where seller_id = r.seller_id and status = 'pending') then
    return json_build_object('ok', false, 'msg', 'has_newer');     -- 그 셀러가 이미 새로 신청했다 → 새 신청을 확인한다
  end if;
  if r.status = 'pending' and r.activated then
    update seller_plan_requests set status = 'paid', paid_at = now() where id = p_id;
    return json_build_object('ok', true);
  end if;
  -- 노출이 꺼져 있는 신청(입금 확인 뒤 노출 · 만료돼 내려간 신청): 오늘부터 기간을 세어 켠다
  v_end := (v_today + make_interval(months => r.months) - interval '1 day')::date;
  update seller_plan_requests set activated = false where id = p_id;
  if not public._plan_show(p_id, v_today, v_end) then return json_build_object('ok', false, 'msg', 'full'); end if;
  update seller_plan_requests set status = 'paid', paid_at = now(), closed_at = null, close_reason = null where id = p_id;
  return json_build_object('ok', true, 'revived', r.status = 'expired');
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
  -- 노출을 못 내렸으면(누가 기간을 손으로 고쳤다) 숨기지 않고 알린다
  return json_build_object('ok', true, 'hidden', v_ok, 'msg', case when v_ok then null else 'still_showing' end);
end $$;

-- ── 크론: 입금 기한이 지난 신청을 끝내고 노출을 내린다 ───────────
create or replace function public.neighbor_plan_tick() returns int
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r seller_plan_requests%rowtype; n int := 0; v_ok boolean;
begin
  for r in select * from seller_plan_requests where status = 'pending' and pay_due < now() for update loop
   begin
    v_ok := public._plan_revert(r);
    update seller_plan_requests set status = 'expired', closed_at = now(), close_reason = '입금 기한 지남' where id = r.id;
    insert into health_alerts (kind, detail)
    values ('이웃셀러미입금', format('@%s %s개월 %s원 — 기한까지 입금 확인이 없어 신청을 끝냄%s%s', r.login_insta, r.months, r.amount,
            case when r.claimed_at is not null then ' · 셀러는 입금했다고 눌렀음(통장 확인 뒤 「입금 확인」을 누르면 되살아남)' else '' end,
            case when v_ok then '' else ' · 🔴 노출은 못 내림(기간이 손으로 바뀌어 있음)' end));
    n := n + 1;
   exception when others then      -- 한 건이 실패해도 나머지 신청은 처리한다
    insert into health_alerts (kind, detail) values ('이웃셀러미입금', format('🔴 신청 %s 만료 처리 실패: %s', r.id, sqlerrm));
   end;
  end loop;
  -- 현금영수증 번호는 오래 두지 않는다: 끝난 신청은 14일, 확정된 신청은 60일 뒤 지운다
  update seller_plan_requests set receipt_no = null
   where receipt_no is not null
     and ((status in ('expired', 'cancelled') and closed_at < now() - interval '14 days')
       or (status = 'paid' and paid_at < now() - interval '60 days'));
  insert into ops_status (id, payload, updated_at)
  values ('neighbor-plan-tick', jsonb_build_object('expired', n, 'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')), now())
  on conflict (id) do update set payload = excluded.payload, updated_at = now();
  return n;
end $$;

-- ── 권한: 기본 권한이 회수돼 있어 명시해야 열린다 ────────────────
revoke all on function public._plan_today(), public._plan_price(int), public._plan_seller_id(text), public._plan_slots_used(), public._plan_strikes(bigint),
  public._plan_show(bigint, date, date), public._plan_revert(seller_plan_requests), public.neighbor_plan_tick() from public, anon, authenticated;
revoke all on function public.seller_plan_status(text), public.seller_plan_start(text, int, text), public.seller_plan_claim(text, text, text),
  public.admin_plan_list(), public.admin_plan_confirm(bigint), public.admin_plan_cancel(bigint, text) from public;
grant execute on function public.seller_plan_status(text), public.seller_plan_start(text, int, text), public.seller_plan_claim(text, text, text) to anon, authenticated;
grant execute on function public.admin_plan_list(), public.admin_plan_confirm(bigint), public.admin_plan_cancel(bigint, text) to authenticated;

select cron.unschedule('neighbor-plan-tick') where exists (select 1 from cron.job where jobname = 'neighbor-plan-tick');
select cron.schedule('neighbor-plan-tick', '*/10 * * * *', $$select public.neighbor_plan_tick();$$);
