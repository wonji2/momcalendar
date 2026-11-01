-- ══════════════════════════════════════════════════════════
--  RLS 정리 6단계 — '로그인만 하면 관리자' 문제 차단
--  적용일: 2026-07-23
--
--  🔴 발견한 문제
--     Supabase Auth 의 공개 회원가입이 열려 있었고(즉시 토큰 발급),
--     한편 gonggu·sellers·banners·influencers·experiences·hotdeals 의
--     쓰기 정책이 roles={authenticated} + using(true) 였다.
--     → 누구나 아무 이메일로 가입하는 것만으로 관리자와 동일한 권한을 얻어
--       공구 전체 삭제·셀러 비밀번호 조회가 가능한 상태였다.
--
--  해결
--     '가입한 사람' 이 아니라 'app_admins 에 등록된 사람' 만 관리자로 인정한다.
--     스태프를 추가하려면 app_admins 에 그 계정의 user_id 를 넣으면 된다.
-- ══════════════════════════════════════════════════════════


-- ── 1) 관리자 명단 ──
create table if not exists public.app_admins (
  user_id    uuid primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

-- 사장님 계정 (dnjswltjs123@naver.com, 2026-06-01 생성)
insert into public.app_admins (user_id, note)
values ('5fe760b7-c418-494a-a148-ca0eabc8e8e8', '사장님 계정')
on conflict (user_id) do nothing;


-- ── 2) 관리자 판별 함수 ──
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

revoke execute on function public.is_app_admin() from public;
grant  execute on function public.is_app_admin() to anon, authenticated;


-- ── 3) 쓰기 정책을 관리자 한정으로 교체 ──
drop policy if exists banners_admin_all on public.banners;
create policy banners_admin_all on public.banners
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists influencers_admin_all on public.influencers;
create policy influencers_admin_all on public.influencers
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists exp_write on public.experiences;
create policy exp_write on public.experiences
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists hotdeals_admin_all on public.hotdeals;
create policy hotdeals_admin_all on public.hotdeals
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists gonggu_admin_all on public.gonggu;
create policy gonggu_admin_all on public.gonggu
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());


-- ── 4) sellers: 방문자용 읽기와 관리자용 접근을 분리 ──
--    기존 'public read active' 는 roles={public} 이라 가입만 하면
--    login_pw 까지 읽을 수 있었다(authenticated 는 컬럼 제한이 없으므로).
drop policy if exists "public read active" on public.sellers;
drop policy if exists "admin delete" on public.sellers;
drop policy if exists "admin insert" on public.sellers;
drop policy if exists "admin update" on public.sellers;

-- 방문자: 컬럼 권한으로 이미 표시용 8개만 읽을 수 있음
create policy sellers_anon_read on public.sellers
  for select to anon using (true);

create policy sellers_admin_all on public.sellers
  for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());


-- ── 5) 통계 열람도 관리자 한정 ──
drop policy if exists visitors_admin_read on public.visitors;
create policy visitors_admin_read on public.visitors
  for select to authenticated using (public.is_app_admin());

drop policy if exists visits_admin_read on public.visits;
create policy visits_admin_read on public.visits
  for select to authenticated using (public.is_app_admin());

drop policy if exists events_admin_read on public.events;
create policy events_admin_read on public.events
  for select to authenticated using (public.is_app_admin());


-- ── 6) 체험단·핫딜 읽기 정책에서 authenticated 를 떼어낸다 ──
--    (읽기 자체는 공개 정보라 anon 으로 충분. 관리자는 위 정책으로 읽는다)
drop policy if exists experiences_read on public.experiences;
drop policy if exists exp_read on public.experiences;
create policy experiences_anon_read on public.experiences
  for select to anon using (true);

drop policy if exists hotdeals_read on public.hotdeals;
create policy hotdeals_anon_read on public.hotdeals
  for select to anon using (true);
