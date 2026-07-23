-- ══════════════════════════════════════════════════════════
--  RLS 정리 1단계 — 앱 동작을 바꾸지 않는 범위의 권한 축소
--  적용일: 2026-07-23
--
--  배경: 대부분의 테이블이 roles={public} + using(true) 정책을 갖고 있어
--        사이트에 공개된 publishable 키만으로 수정·삭제가 가능한 상태였다.
--        (Supabase 보안 어드바이저 rls_policy_always_true 25건)
--
--  원칙: 방문자(anon)에게는 화면에 필요한 최소 권한만.
--        쓰기는 로그인한 관리자(authenticated) 또는 service_role 만.
-- ══════════════════════════════════════════════════════════

-- ── 배너: 방문자는 활성 배너 읽기만 (admin.html 은 authenticated 로 관리) ──
drop policy if exists allow_all_banners on public.banners;
revoke all on public.banners from anon;
grant select on public.banners to anon;

-- ── 인플루언서: 방문자 접근 불가 (index.html 이 사용하지 않음) ──
drop policy if exists allow_all_influencers on public.influencers;
revoke all on public.influencers from anon;

-- ── 체험단: 방문자는 읽기만. 쓰기는 exp_write(authenticated) 가 담당 ──
drop policy if exists experiences_insert on public.experiences;
drop policy if exists experiences_delete on public.experiences;
revoke all on public.experiences from anon;
grant select on public.experiences to anon;

-- ── 핫딜: 방문자는 읽기만. 관리자 전용 쓰기 정책을 새로 만든다 ──
drop policy if exists hotdeals_insert on public.hotdeals;
drop policy if exists hotdeals_delete on public.hotdeals;
drop policy if exists hotdeals_admin_all on public.hotdeals;
create policy hotdeals_admin_all on public.hotdeals
  for all to authenticated using (true) with check (true);
revoke all on public.hotdeals from anon;
grant select on public.hotdeals to anon;

-- ── 통계 3종: 방문자는 기록만, 열람은 관리자만 (경쟁사 수집 차단) ──
drop policy if exists allow_select_visitors on public.visitors;
drop policy if exists read_visitors on public.visitors;
revoke all on public.visitors from anon;
grant insert on public.visitors to anon;

drop policy if exists visits_read on public.visits;
drop policy if exists visits_admin_read on public.visits;
create policy visits_admin_read on public.visits
  for select to authenticated using (true);
revoke all on public.visits from anon;
grant insert on public.visits to anon;

drop policy if exists read_events on public.events;
drop policy if exists events_admin_read on public.events;
create policy events_admin_read on public.events
  for select to authenticated using (true);
revoke all on public.events from anon;
grant insert on public.events to anon;

-- ── 공구: '승인됨' 상태로 가짜 공구를 등록하는 경로 차단 ──
--    셀러 등록(register.html)은 gonggu_anon_insert_pending(approved=false)로 계속 동작
--    staff/admin 등록은 gonggu_admin_all(authenticated)로 계속 동작
drop policy if exists allow_insert on public.gonggu;
