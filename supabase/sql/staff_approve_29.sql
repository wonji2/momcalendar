-- 스탭 승인 화면용 RPC — 사장님이 직접 승인/해제할 수 있게 (사장님 선택 B안, 2026-08-05)
-- auth.users 는 브라우저에서 못 읽으므로 SECURITY DEFINER 함수로만 열어준다.
-- 모든 함수는 첫 줄에서 is_app_admin() 을 확인한다. 스태프 본인은 못 부른다.

-- ① 승인 대기 목록 = 가입은 했는데 스탭/관리자 명단에 없는 계정
create or replace function public.admin_staff_pending()
returns table(user_id uuid, login_id text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;
  return query
    select u.id,
           split_part(u.email, '@', 1),
           u.created_at
    from auth.users u
    where u.id not in (select s.user_id from public.app_staff s)
      and u.id not in (select a.user_id from public.app_admins a)
    order by u.created_at desc;
end $$;

-- ② 현재 스탭 목록
create or replace function public.admin_staff_list()
returns table(user_id uuid, login_id text, memo text, added_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception '관리자만 볼 수 있습니다';
  end if;
  return query
    select s.user_id,
           coalesce(split_part(u.email, '@', 1), '(계정 없음)'),
           s.memo,
           s.added_at
    from public.app_staff s
    left join auth.users u on u.id = s.user_id
    order by s.added_at desc;
end $$;

-- ③ 승인
create or replace function public.admin_staff_approve(p_user uuid, p_memo text default null)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception '관리자만 승인할 수 있습니다';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception '없는 계정입니다';
  end if;
  insert into public.app_staff(user_id, memo)
  values (p_user, nullif(trim(coalesce(p_memo,'')),''))
  on conflict (user_id) do update set memo = excluded.memo;
  return true;
end $$;

-- ④ 권한 해제
create or replace function public.admin_staff_revoke(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception '관리자만 해제할 수 있습니다';
  end if;
  delete from public.app_staff where user_id = p_user;
  return true;
end $$;

revoke all on function public.admin_staff_pending()            from public, anon;
revoke all on function public.admin_staff_list()               from public, anon;
revoke all on function public.admin_staff_approve(uuid, text)  from public, anon;
revoke all on function public.admin_staff_revoke(uuid)         from public, anon;

grant execute on function public.admin_staff_pending()           to authenticated;
grant execute on function public.admin_staff_list()              to authenticated;
grant execute on function public.admin_staff_approve(uuid, text) to authenticated;
grant execute on function public.admin_staff_revoke(uuid)        to authenticated;

-- 테스트용 더미 행 정리 (실제 계정이 아니다)
delete from public.app_staff where user_id = '00000000-0000-4000-8000-000000000001';
