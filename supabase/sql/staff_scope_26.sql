-- ═══ 스태프 제한 권한 (2026-08-04) ═══
-- 사장님 지시: "스태프는 DB 삭제나 등록은 안 되고, 대분류·소분류·중복오탐 같은
--              간단 편집 및 인스타카드 기능만"
--
-- 설계
--  · app_staff 명단에 있는 로그인 사용자만 스태프.
--  · gonggu 의 UPDATE 를 컬럼 단위로 제한한다(major/minor/cat_manual/dup_ok 만).
--    RLS 정책만으로는 "어느 컬럼을" 을 막을 수 없어서 컬럼 GRANT 를 함께 쓴다.
--  · INSERT/DELETE 는 아예 주지 않는다.

create table if not exists public.app_staff (
  user_id uuid primary key,
  memo    text,
  added_at timestamptz default now()
);
comment on table public.app_staff is '스태프 명단. 분류 수정·중복 오탐 표시만 가능(등록·삭제 불가)';
alter table public.app_staff enable row level security;   -- 정책 없음 = service_role 만 접근

create or replace function public.is_app_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.app_staff s where s.user_id = auth.uid());
$$;

-- 중복 오탐 표시용 컬럼 (admin 은 지금 localStorage 로만 갖고 있어 기기가 바뀌면 날아간다)
alter table public.gonggu add column if not exists dup_ok boolean default false;
comment on column public.gonggu.dup_ok is '중복 아님이 확정된 건. admin/staff 중복검사에서 제외';

-- ── 권한 재정리 ──
-- authenticated 에 통째로 열려 있던 권한을 회수하고, 필요한 것만 다시 준다.
revoke all on public.gonggu from authenticated;
grant select on public.gonggu to authenticated;
grant insert, delete on public.gonggu to authenticated;             -- 관리자용(RLS 가 is_app_admin 으로 막음)
grant update (major, minor, cat_manual, dup_ok, name, influencer, insta, open_date, end_date, approved, color, pay_link, brand, item)
  on public.gonggu to authenticated;                                -- 관리자용 전체 컬럼

-- ⚠️ 스태프는 별도 롤이 아니라 같은 authenticated 다.
--    그래서 컬럼 GRANT 로는 관리자와 구분할 수 없다 → 스태프 수정은 RPC 로만 받는다.
--    (아래 함수는 major/minor/cat_manual/dup_ok 외에는 손대지 않는다)
create or replace function public.staff_set_category(
  p_id int, p_major text, p_minor text
) returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not (public.is_app_staff() or public.is_app_admin()) then
    raise exception '권한 없음';
  end if;
  update public.gonggu
     set major = nullif(btrim(p_major),''),
         minor = nullif(btrim(p_minor),''),
         cat_manual = true
   where id = p_id;
  return found;
end $$;

create or replace function public.staff_set_dup_ok(
  p_id int, p_ok boolean
) returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not (public.is_app_staff() or public.is_app_admin()) then
    raise exception '권한 없음';
  end if;
  update public.gonggu set dup_ok = coalesce(p_ok,false) where id = p_id;
  return found;
end $$;

revoke all on function public.staff_set_category(int,text,text) from public, anon;
revoke all on function public.staff_set_dup_ok(int,boolean)     from public, anon;
grant execute on function public.staff_set_category(int,text,text) to authenticated;
grant execute on function public.staff_set_dup_ok(int,boolean)     to authenticated;

-- 스태프가 목록을 읽을 수 있어야 한다. gonggu 는 approved=true 만 anon 공개이므로
-- 미승인 건까지 보려면 정책을 하나 더 둔다(읽기 전용).
drop policy if exists gonggu_staff_read on public.gonggu;
create policy gonggu_staff_read on public.gonggu for select to authenticated
  using (public.is_app_staff() or public.is_app_admin());

select 'app_staff' as t, count(*)::text as v from public.app_staff
union all select 'is_app_staff 함수', case when exists(select 1 from pg_proc where proname='is_app_staff') then 'OK' else 'NO' end
union all select 'dup_ok 컬럼', case when exists(select 1 from information_schema.columns where table_name='gonggu' and column_name='dup_ok') then 'OK' else 'NO' end;
