-- 손님용 뷰 분리 (2026-09-28, 사장님 "손님용 뷰로 분리해" — 보안 점검 잔여 ①)
--
-- 왜: banners 표에 광고 단가·광고주·메모(ad_price·ad_advertiser·ad_memo) 열이 있고 손님(anon)이 select=* 로 읽는다.
--     지금은 값이 비어 있지만 채우는 순간 손님에게 새는 구조다. gonggu 도 source·dup_ok·cat_manual·name_ns 같은 운영 열이 anon 에 열려 있다(vendor_id 는 사이트가 쓰므로 유지).
-- 어떻게:
--   ① 뷰 banners_public — 손님에게 보여도 되는 열만, active=true 만. postgres 소유(뷰는 소유자 권한으로 밑 표를 읽는다) → anon 에 select 만.
--      손님 페이지(index/test)의 rest/v1/banners → rest/v1/banners_public. 관리자(admin.html, authenticated)는 그대로 banners 표.
--   ② gonggu 는 열 단위 권한으로 — 손님 페이지·도구가 전부 select=열목록 이라(select=* 는 staff.html=authenticated 뿐) 표 이름을 안 바꿔도 된다.
--   ③ 🔴 banners 표의 anon select 회수는 **index.html 이 banners_public 으로 배포된 뒤** 따로 실행한다(아래 맨 끝, 주석 처리). 먼저 돌리면 라이브 배너가 사라진다.
-- 적용: supabase db query --file supabase/sql/customer_views_67.sql --linked
-- 확인: curl "…/rest/v1/banners_public?type=eq.main&active=eq.true&select=*" -H "apikey: <anon>" → 200, ad_* 열 없음

-- ① 손님용 배너 뷰
create or replace view public.banners_public
with (security_invoker = false) as
  select id, type, title, subtitle, cta, link, bg, img_url, sort_order, active, created_at,
         img_position, img_size, link_open_at, show_from, show_until, stage
  from public.banners
  where active = true;
alter view public.banners_public owner to postgres;
revoke all on public.banners_public from public, anon, authenticated;
grant select on public.banners_public to anon, authenticated;
comment on view public.banners_public is '손님용 배너(광고 단가·광고주·메모 제외, active 만). 사이트는 이걸 읽고 관리자는 banners 표를 쓴다 (2026-09-28)';

-- ② gonggu 운영 열을 손님 읽기에서 뺀다 (열 단위 권한: 정책 gonggu_anon_read_approved 는 그대로)
revoke select on public.gonggu from anon;
-- vendor_id 는 index.html 이 읽는다(입점 공급사 건 우선 노출) → 남긴다. 빼는 열: source·dup_ok·cat_manual·name_ns
grant select (id, name, influencer, insta, major, minor, open_date, end_date, color, pay_link, brand, item, caption, approved, created_at, vendor_id) on public.gonggu to anon;

-- 확인
select 'banners_public' as 뷰, count(*) as 행 from public.banners_public
union all
select 'gonggu anon 열: '||string_agg(column_name, ','), null from information_schema.role_column_grants where table_schema='public' and table_name='gonggu' and grantee='anon' and privilege_type='SELECT';

-- ③ 🔴 index.html 배포 확인 후에만 실행 (라이브 curl 로 index.html 이 banners_public 을 부르는지 본 다음)
-- revoke select on public.banners from anon;
-- drop policy if exists banners_anon_read_active on public.banners;
