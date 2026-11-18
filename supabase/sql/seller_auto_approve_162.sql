-- 셀러 페이지(register.html) 등록분 자동 승인 (사장님 2026-11-18 「걍 자동승인으로 해」)
--   셀러 페이지 안내 「별도로 연락하지 않으셔도 48시간 이내 자동 승인돼요」를 실제로 받치는 장치.
--   seller_add_gonggu · seller_update_gonggu 가 넣는 행은 source='seller' · approved=false 로 들어온다 → 10분마다 올린다.
-- 올리지 않는 것: 보류 표(gonggu_hold)에 있는 행 · 차단 셀러(seller_block) · 이미 끝난 행(마감이 어제 이전).
--   상품명·차단 브랜드·내 공구 2주 창(0-M)·official 계정 등은 gonggu 표의 기존 트리거가 그대로 막는다(트리거가 되돌린 행은 계속 미승인).
-- 끄기: select cron.unschedule('seller-auto-approve');
-- PC 가 꺼져도 돈다(pg_cron).

create or replace function public.seller_auto_approve()
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare n int;
begin
  update gonggu g
     set approved = true
   where g.source = 'seller'
     and g.approved = false
     and coalesce(g.end_date, g.open_date) >= to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD')
     and not exists (select 1 from gonggu_hold h where h.id = g.id)
     and not seller_blocked(g.insta, g.influencer);
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.seller_auto_approve() from public, anon, authenticated;

select cron.unschedule('seller-auto-approve') where exists (select 1 from cron.job where jobname = 'seller-auto-approve');
select cron.schedule('seller-auto-approve', '3-59/10 * * * *',
  $c$ set statement_timeout = '20s'; select public.seller_auto_approve(); $c$);
