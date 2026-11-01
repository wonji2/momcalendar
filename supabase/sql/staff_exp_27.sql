-- 스태프에게 체험단(experiences) 권한 부여 — 사장님 지시 2026-08-04
-- 공구(gonggu)·핫딜(hotdeals)은 그대로 관리자 전용이다. 체험단만 연다.
-- 기존 정책 exp_write(is_app_admin() 만) 을 admin OR staff 로 넓힌다.

drop policy if exists exp_write on public.experiences;

create policy exp_write on public.experiences
  for all to authenticated
  using      (public.is_app_admin() or public.is_app_staff())
  with check (public.is_app_admin() or public.is_app_staff());

-- 확인용
-- select polname, pg_get_expr(polqual,polrelid) from pg_policy p
--   join pg_class c on c.oid=p.polrelid where c.relname='experiences';
