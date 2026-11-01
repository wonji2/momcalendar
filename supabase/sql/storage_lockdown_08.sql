-- ══════════════════════════════════════════════════════════
--  RLS 정리 8단계 — 스토리지(banners 버킷) 접근 제한
--  적용일: 2026-07-23
--
--  🔴 문제: storage.objects 에 public_upload (roles={anon}, INSERT) 정책이 있어
--          공개 키만으로 누구나 banners 버킷에 파일을 올릴 수 있었다.
--          (용량·비용 남용, 사장님 도메인에 임의 파일 호스팅 위험)
--          쓰기 정책들도 '로그인한 사람' 이면 통과라 가입만 하면 배너 교체가 가능했다.
--
--  읽기는 그대로 공개 — 배너 이미지는 사이트에 노출되는 자료다.
-- ══════════════════════════════════════════════════════════

-- 아무나 업로드 차단
drop policy if exists public_upload on storage.objects;

-- 쓰기는 app_admins 에 등록된 관리자만 (admin.html 이 관리자 토큰으로 업로드)
drop policy if exists "admin upload banners"  on storage.objects;
drop policy if exists "banners admin insert"  on storage.objects;
drop policy if exists "banners admin update"  on storage.objects;
drop policy if exists "banners admin delete"  on storage.objects;

create policy banners_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'banners' and public.is_app_admin());

create policy banners_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'banners' and public.is_app_admin())
  with check (bucket_id = 'banners' and public.is_app_admin());

create policy banners_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'banners' and public.is_app_admin());
