-- 보안 점검 2026-11-25(사이트·앱부): 낮음 정리 — 트리거 함수 실행권 회수(트리거 동작은 그대로) · search_path 고정
alter function public.hotdeal_auto_expire(integer) set search_path = public;
alter function public.hotdeal_purge_old(integer) set search_path = public;
revoke execute on function public.trg_brand_block_gonggu() from public, anon, authenticated;
revoke execute on function public.trg_brand_block_title() from public, anon, authenticated;
revoke execute on function public.trg_partner_history_del() from public, anon, authenticated;
revoke execute on function public.trg_partner_history() from public, anon, authenticated;
revoke execute on function public.hotdeals_fill_mall() from public, anon, authenticated;
revoke execute on function public.check_gonggu_name() from public, anon, authenticated;
-- 2차: 나머지 트리거 함수 전부 같은 회수 (do 블록)
