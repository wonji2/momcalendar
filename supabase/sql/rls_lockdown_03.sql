-- ══════════════════════════════════════════════════════════
--  RLS 정리 3단계 — gonggu / push_subs 공개 쓰기 권한 제거
--  적용일: 2026-07-23
--
--  ⚠ 선행조건 (둘 다 라이브 반영된 뒤에 실행할 것)
--     · register.html 이 seller_*_gonggu RPC 를 쓰도록 교체됨
--     · index.html 이 save-push-sub Edge Function 을 쓰도록 교체됨
-- ══════════════════════════════════════════════════════════


-- ── 공구 ──────────────────────────────────────────────
-- 삭제·수정: 셀러는 seller_delete_gonggu / seller_update_gonggu 로만 (본인 것만)
drop policy if exists allow_delete on public.gonggu;
drop policy if exists allow_update on public.gonggu;

-- 등록: 셀러는 seller_add_gonggu 로만
drop policy if exists gonggu_anon_insert_pending on public.gonggu;

-- 조회: 미승인 공구가 외부에 보이지 않게 한다.
--   방문자(index.html)  → gonggu_anon_read_approved (approved = true) 만
--   셀러 본인           → seller_list_gonggu (미승인 포함)
--   관리자              → gonggu_admin_all (authenticated)
drop policy if exists allow_select on public.gonggu;

revoke all on public.gonggu from anon;
grant select on public.gonggu to anon;


-- ── 푸시 구독 ─────────────────────────────────────────
-- 저장·해제는 save-push-sub Edge Function(service_role) 만 수행
drop policy if exists push_subs_insert on public.push_subs;
drop policy if exists push_subs_update on public.push_subs;
drop policy if exists push_subs_read   on public.push_subs;
revoke all on public.push_subs from anon, authenticated;


-- ── 발송 실패 기기 걸러내기 (send-open-push 가 호출) ──
create or replace function public.push_fail_bump(p_devices text[])
returns void
language sql
security definer
set search_path = public
as $$
  update push_subs
     set fail_count = coalesce(fail_count, 0) + 1
   where device_id = any(p_devices);
$$;

revoke execute on function public.push_fail_bump(text[]) from public, anon, authenticated;
grant  execute on function public.push_fail_bump(text[]) to service_role;
