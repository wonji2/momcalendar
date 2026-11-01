-- 보안 잠금 (2026-09-28, 사장님 "스레드 글(Supabase DB 1만6천개 공개 사고) 보고 우린 보안 문제 없는지 보완")
--
-- 실측(2026-09-28 16:40, anon 키로 REST 직접 호출):
--   🔴 RLS 꺼진 표 12개가 anon 에게 SELECT·INSERT·UPDATE·DELETE 전부 열려 있었다 — seller_inpock(1,006행, 셀러 슬러그 자산)·hotdeals_archive·
--      gonggu_deleted_log·hotdeals_deleted_log·gonggu_*_backup_20260928 7개·_neb_backup_20260901. 원인: `create table … as select` 로 만든 백업표는
--      RLS 가 꺼진 채 생기고, 스키마 기본 권한(default acl)이 새 표마다 anon/authenticated 에 모든 권한을 준다.
--   🔴 admin_vendor_list / admin_vendor_gonggu / admin_vendor_upsert 에 is_app_admin() 검사가 없었다 — authenticated(스탭 계정 포함) 누구나 벤더 명단·메모를 읽고 고칠 수 있었다.
--   🔴 storage.objects 의 banners_admin_delete 정책이 조건 없이 authenticated 전부에게 삭제를 허용했다.
--   ✅ 정책 있는 표(gonggu·banners·hotdeals·events·visitors·visits·sellers·experiences·inquiries·bot_*)는 anon 이 읽기/삽입만, 쓰기는 is_app_admin/is_app_staff.
--   ✅ 가입 닫힘(disable_signup=true), auth 사용자 2명(사장님·스탭), 서비스 키·JWT 는 공개 레포·라이브·git 이력에 없음.
--
-- 하는 일
--   ① 정책이 하나도 없는 public 표 전부: RLS 켜고 anon/authenticated 권한 회수 (정책 없는 표는 원래 손님이 직접 읽을 일이 없다 — 전부 SECURITY DEFINER 함수·크론·CLI 로만 쓴다)
--   ② 앞으로 만드는 표·시퀀스·함수에 anon/authenticated 자동 권한을 주지 않는다 (default acl 회수) — 새 RPC 를 손님에게 열려면 **명시적으로 grant execute** 해야 한다
--   ③ 벤더 함수 3개에 is_app_admin() 검사 추가
--   ④ storage 삭제 정책을 banners 버킷 + 관리자만으로
--   ⑤ 손님 실행 필요 없는 감시 함수 실행권 회수
-- 적용: supabase db query --file supabase/sql/security_lockdown_66.sql --linked
-- 되돌리기(표 하나): grant select on public.<표> to anon;  + 정책 추가.  default acl 되돌리기: alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;

-- ① 정책 없는 표 전부 잠금
do $$
declare r record; n int := 0;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r','p')
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
    n := n + 1;
  end loop;
  raise notice '잠근 표 %개', n;
end $$;

-- ② 새 객체 기본 권한 회수 (CLI·SQL 편집기 = postgres 역할로 만드는 것)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;

-- ③ 벤더 함수 — 관리자 검사
create or replace function public.admin_vendor_list()
returns table(id bigint, name text, plan text, quota integer, used integer, remain integer, start_date date, end_date date, days_left integer, cafe_enabled boolean, active boolean, memo text)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  return query
  select v.id, v.name, v.plan, v.quota,
         coalesce(u.cnt, 0)::int as used,
         (v.quota - coalesce(u.cnt, 0))::int as remain,
         v.start_date, v.end_date,
         (v.end_date - (now() at time zone 'Asia/Seoul')::date)::int as days_left,
         v.cafe_enabled, v.active, v.memo
    from vendors v
    left join (
      select g.vendor_id, count(*) cnt
        from gonggu g join vendors vv on vv.id = g.vendor_id
       where g.created_at is not null
         and (g.created_at at time zone 'Asia/Seoul')::date between vv.start_date and vv.end_date
       group by g.vendor_id
    ) u on u.vendor_id = v.id
   order by v.active desc, v.end_date desc, v.name;
end $$;

create or replace function public.admin_vendor_gonggu(p_vendor bigint, p_limit integer default 200)
returns table(id bigint, name text, insta text, influencer text, open_date text, end_date text, major text, approved boolean, reg_day date)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  return query
  select g.id, g.name, g.insta, g.influencer, g.open_date, g.end_date, g.major, g.approved,
         (g.created_at at time zone 'Asia/Seoul')::date
    from gonggu g where g.vendor_id = p_vendor
   order by g.created_at desc nulls last, g.id desc limit coalesce(p_limit, 200);
end $$;

create or replace function public.admin_vendor_upsert(p_id bigint, p_name text, p_plan text, p_quota integer, p_start date, p_end date, p_cafe boolean, p_active boolean, p_memo text)
returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode = '28000'; end if;
  if p_id is null then
    insert into vendors(name, plan, quota, start_date, end_date, cafe_enabled, active, memo)
    values (p_name, coalesce(p_plan,'basic'), coalesce(p_quota,60), p_start, p_end,
            coalesce(p_cafe,true), coalesce(p_active,true), p_memo)
    returning id into v_id;
  else
    update vendors set name=p_name, plan=coalesce(p_plan,plan), quota=coalesce(p_quota,quota),
           start_date=p_start, end_date=p_end, cafe_enabled=coalesce(p_cafe,cafe_enabled),
           active=coalesce(p_active,active), memo=p_memo
     where id=p_id returning id into v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.admin_vendor_list() from anon, public;
revoke execute on function public.admin_vendor_gonggu(bigint, integer) from anon, public;
revoke execute on function public.admin_vendor_upsert(bigint, text, text, integer, date, date, boolean, boolean, text) from anon, public;

-- ④ storage 삭제 정책 — banners 버킷 + 관리자만
drop policy if exists banners_admin_delete on storage.objects;
create policy banners_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and public.is_app_admin());

-- ⑤ 손님·스탭이 부를 일 없는 함수 실행권 회수 (크론·CLI 는 postgres 라 무관)
revoke execute on function public.run_site_watch() from anon, authenticated, public;
revoke execute on function public.data_health_person_dup() from anon, public;

-- 확인
select c.relname as 표, c.relrowsecurity as rls,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as 정책수,
  coalesce((select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee='anon'), '') as anon권한
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and (not c.relrowsecurity or exists (select 1 from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=c.relname and g.grantee='anon' and g.privilege_type in ('UPDATE','DELETE','TRUNCATE')))
order by 1;

-- ⑥ 정책은 있지만 anon 에 쓰기 권한이 남아 있던 표 11개 — RLS 가 막고는 있었지만 2중 방어로 권한 자체를 회수 (2026-09-28 1차 적용 뒤 확인표에서 나옴)
--    bot_*·brand_block 은 anon 읽기만, inquiries 는 anon 삽입만(정책 inq_insert_anon) 필요하다.
do $$
declare t text;
begin
  foreach t in array array['bot_alias','bot_alias_deny','bot_interp','bot_phrase','brand_block','coupang_keywords','coupang_watch','inquiries','login_alerts','price_history','site_alerts'] loop
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from anon', t);
  end loop;
  execute 'revoke select on table public.coupang_keywords, public.coupang_watch, public.login_alerts, public.price_history, public.site_alerts from anon';
  execute 'grant insert on table public.inquiries to anon';
end $$;
select count(*) as anon_쓰기권_남은_표 from information_schema.role_table_grants g where g.table_schema='public' and g.grantee='anon' and g.privilege_type in ('UPDATE','DELETE','TRUNCATE');

-- ⑦ 검증 에이전트 잔여 지적 반영 (2026-09-28 21:10)
--   · inquiries: 손님 페이지는 전부 rpc submit_inquiry(SECURITY DEFINER, 하루 5건·길이 검사) 를 쓴다. anon 직접 INSERT 는 그 검사를 우회하고 status·admin_memo 까지 넣을 수 있었다 → anon 권한 전부 회수, 정책은 남겨도 권한이 없어 무력.
--   · authenticated 의 TRUNCATE·REFERENCES·TRIGGER 는 RLS 가 안 보는 권한이고 PostgREST 경로도 없다 → 전부 회수(관리자 SELECT/INSERT/UPDATE/DELETE 는 그대로).
revoke all on table public.inquiries from anon;
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') loop
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', r.relname);
  end loop;
end $$;
-- 검증 에이전트가 남긴 시험 행 제거
delete from public.inquiries where content like 'verifier test 2026-09-28 lockdown check%';
select (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name='inquiries') as inquiries_anon권한,
       (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')) as auth_잔여위험권한,
       (select count(*) from public.inquiries where content like 'verifier test%') as 시험행;
