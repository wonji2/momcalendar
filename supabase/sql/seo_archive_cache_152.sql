-- 검색 페이지 데이터에 보관분(gonggu_archive) 이력을 되살린다 (사장님 2026-11-16 「안된것도 다해 최대한」)
--   seo_build() 는 gonggu 만 읽는다. 공구가 두 달 지나 gonggu_archive 로 옮겨지면 브랜드·제품·셀러·월별 페이지에서 그 이력이 빠졌다(6~10월 약 1만 8천 건).
--   그대로 합쳐 매일 집계하면 무료 DB 에서 시간이 두 배로 든다(매일 집계 90초, pg_cron 문장 제한 120초) → 보관분은 거의 안 바뀌므로
--   따로 집계해 seo_cache id=2 에 둔다. 매일 빌드(tools/seo/build.ps1)가 seo_dataset_archive() 를 읽어 브랜드·제품·셀러·분류·월별에 합친다(없으면 건너뜀).
--   · seo_archive_rows : 보관분 중 내보낼 행만 옮겨 둔 가벼운 표(차단 셀러·브랜드, 아직 gonggu 에 있는 행, 앞날 날짜 제외). 뷰로 두면 차단 함수가 집계 안에서 여러 번 불려 120초를 넘긴다(실측).
--   · seo_build_archive() : seo_build() 정의를 DB 안에서 그대로 베껴 읽는 표만 바꾼다(정규식의 한글이 밖으로 나갔다 들어오며 깨지지 않게).
--     🔴 seo_build() 를 고치면 아래 do 블록을 다시 돌려야 보관분 쪽도 같은 규칙이 된다.
--   · 갱신: pg_cron seo-refresh-archive 매주 일요일 03:50 KST. 실측 119초 → 크론 명령에서 문장 제한을 400초로 올린다(함수 속성 set 은 이미 시작된 문장에 안 먹는다).
--   한도: seo_cache 한 줄(약 2.6MB) + seo_archive_rows 약 3MB.
--   되돌리기: select cron.unschedule('seo-refresh-archive'); delete from seo_cache where id=2; (빌드는 없으면 합치지 않는다)
create table if not exists public.seo_archive_rows (
  id bigint primary key, name text, influencer text, insta text, open_date text, end_date text, major text, minor text, approved boolean not null default true
);
alter table public.seo_archive_rows enable row level security;
revoke all on public.seo_archive_rows from public, anon, authenticated;

do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname='seo_build' and p.pronamespace='public'::regnamespace;
  d := replace(d, 'public.gonggu', 'public.seo_archive_rows');
  d := replace(d, 'FUNCTION public.seo_build()', 'FUNCTION public.seo_build_archive()');
  if d not like '%seo_build_archive()%' or d like '%public.gonggu %' then raise exception 'replace failed'; end if;
  execute d;
end $$;
revoke execute on function public.seo_build_archive() from public, anon, authenticated;

create or replace function public.seo_refresh_archive() returns text
language plpgsql security definer set search_path to 'public' as $f$
declare n int;
begin
  delete from public.seo_archive_rows;
  insert into public.seo_archive_rows(id,name,influencer,insta,open_date,end_date,major,minor)
    select a.id, a.name, a.influencer, a.insta, a.open_date, a.end_date, a.major, a.minor
    from public.gonggu_archive a
    where a.approved = true
      and a.open_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      and a.open_date <= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
      and not exists (select 1 from public.gonggu g where g.id = a.id)
      and not public.seller_blocked(a.insta, a.influencer)
      and not public.brand_blocked(a.name);
  insert into public.seo_cache(id, data, updated_at)
  values (2, public.seo_build_archive(), now())
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  select jsonb_array_length(data->'brands') into n from public.seo_cache where id=2;
  return 'ok brands=' || coalesce(n,0);
end $f$;
revoke execute on function public.seo_refresh_archive() from public, anon, authenticated;

create or replace function public.seo_dataset_archive() returns jsonb
language sql stable security definer set search_path to 'public' as $f$
  select jsonb_set(data, '{cached_at}', to_jsonb(updated_at)) from public.seo_cache where id = 2;
$f$;
revoke execute on function public.seo_dataset_archive() from public, anon, authenticated;
grant execute on function public.seo_dataset_archive() to service_role;

-- 시각: 일요일 03:50 KST. 매시 33·34분(검색어·클릭 통계)·03:20(site-search-stats)·04:20(seo-refresh)·04:40(DB 내보내기)와 안 겹치는 자리(2026-11-16 확인)
select cron.schedule('seo-refresh-archive', '50 18 * * 6', $c$set statement_timeout='400s'; select public.seo_refresh_archive();$c$);
