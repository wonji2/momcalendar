-- 현금영수증 발급 결과 보관 (사장님 지시 2026-09-21 "사이트에도 결과 알 수 있게 연동")
--   홈택스에서 일괄발급한 뒤 「발급결과 조회」 화면을 복사해 관리자에 붙여넣으면 여기 쌓인다.
--   왜 보관하나: 승인번호가 남는 곳이 홈택스뿐이라, 나중에 "이 셀러 것 발급했나" 를 되짚을 방법이 없었다.
-- 🔒 사장님(app_admins)만 읽고 쓴다 — 거래처 사업자번호가 들어가므로 anon 에 열지 않는다.
--    vendor_todo 와 같은 방식(RLS 정책 없음 + SECURITY DEFINER RPC)으로 막는다.
create table if not exists public.cash_receipt (
  id           bigserial primary key,
  issued_at    timestamptz,          -- 홈택스 거래일시
  approval_no  text,                 -- 승인번호 (홈택스가 준 것)
  id_no        text,                 -- 발급수단번호 (받는 쪽 사업자번호 등)
  use_type     text,                 -- 지출증빙 / 소득공제
  deal_type    text,                 -- 승인거래 / 취소거래
  supply       bigint default 0,     -- 공급대가
  vat          bigint default 0,     -- 부가세 (원츠비는 간이과세자라 0)
  total        bigint default 0,     -- 총 거래금액
  memo         text,
  batch        text,                 -- 묶음 이름 (예: 2026-09-21 또또맘)
  created_at   timestamptz default now(),
  unique (approval_no)               -- 같은 승인번호를 두 번 넣지 않는다
);
alter table public.cash_receipt enable row level security;   -- 정책을 두지 않는다 = 아래 RPC 로만 닿는다

-- 읽기: 최근 것부터
create or replace function public.cash_receipt_read(p_limit int default 200)
returns setof public.cash_receipt
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not public.is_app_admin() then raise exception '이 자료를 볼 권한이 없습니다'; end if;
  return query select * from public.cash_receipt order by issued_at desc nulls last, id desc limit greatest(1, least(p_limit, 1000));
end $$;

-- 쓰기: 승인번호가 같으면 덮어쓴다(같은 화면을 두 번 붙여넣어도 안 늘어난다)
create or replace function public.cash_receipt_save(p_rows jsonb, p_batch text default null)
returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not public.is_app_admin() then raise exception '저장할 권한이 없습니다'; end if;
  insert into public.cash_receipt (issued_at, approval_no, id_no, use_type, deal_type, supply, vat, total, memo, batch)
  select nullif(v->>'issued_at','')::timestamptz, nullif(v->>'approval_no',''), nullif(v->>'id_no',''),
         nullif(v->>'use_type',''), nullif(v->>'deal_type',''),
         coalesce((v->>'supply')::bigint,0), coalesce((v->>'vat')::bigint,0), coalesce((v->>'total')::bigint,0),
         nullif(v->>'memo',''), p_batch
  from jsonb_array_elements(p_rows) v
  where nullif(v->>'approval_no','') is not null
  on conflict (approval_no) do update
    set issued_at=excluded.issued_at, id_no=excluded.id_no, use_type=excluded.use_type, deal_type=excluded.deal_type,
        supply=excluded.supply, vat=excluded.vat, total=excluded.total, memo=excluded.memo,
        batch=coalesce(excluded.batch, public.cash_receipt.batch);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cash_receipt_read(int)  from public;
revoke all on function public.cash_receipt_save(jsonb, text) from public;
grant execute on function public.cash_receipt_read(int)  to authenticated;
grant execute on function public.cash_receipt_save(jsonb, text) to authenticated;
