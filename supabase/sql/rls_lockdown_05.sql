-- ══════════════════════════════════════════════════════════
--  RLS 정리 5단계 — 남은 권한 회수 (defense in depth)
--  적용일: 2026-07-23
--
--  두 테이블은 RLS 정책이 하나도 없어 실제 접근은 이미 막혀 있었지만,
--  테이블 권한(GRANT)은 그대로 남아 있었다.
--  특히 TRUNCATE 는 RLS 의 통제를 받지 않으므로 권한 자체를 회수한다.
-- ══════════════════════════════════════════════════════════

-- 푸시 발송 기록 — send-open-push(service_role) 만 사용
revoke all on public.push_log from anon, authenticated;

-- 공구 백업 테이블 — 아무도 API 로 접근할 일이 없음
revoke all on public.gonggu_backup_clean from anon, authenticated;
