-- 내려둔 공구 id 목록 (2026-10-07) — 관리자 화면이 「대기중」에서 빼고 승인도 막는다
-- 사장님: "내가 관리자페이지에서 승인해야하는 칸에 셀러가 올린게 아니고 니가 파싱한게 들어올 수 있어? … 승인이 보통 한두건인데 오늘 몇백건이 떴었어"
-- 파싱 쪽이 중복·사장님상품·날짜오류로 내린 행(approved=false)이 전부 대기중 탭에 보였고, 일괄 승인에 쓸려 되살아났다.
-- gonggu_hold 는 service_role 만 읽을 수 있어(보안 기준선) 관리자 로그인(authenticated)용 RPC 를 하나 연다. id 만 준다.
-- ROLLBACK: drop function public.held_gonggu_ids();
create or replace function public.held_gonggu_ids()
returns table(id bigint)
language sql stable security definer set search_path = public as $$
  select id from public.gonggu_hold
$$;
revoke all on function public.held_gonggu_ids() from public, anon;
grant execute on function public.held_gonggu_ids() to authenticated;
