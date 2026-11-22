-- 사이트 검색어 30일 집계표 (2026-09-28, 사장님 "넘버블럭스·미니두두·스트라이더 같이 사이트 안에서 검색량 많은 걸 블로그 키워드로 우선")
--   무엇을: events(event_type='search') 30일치를 검색어별로 세어 site_search_stats 에 둔다 — 하루 1번 새벽(pg_cron).
--   왜 표로 두나: 30일 검색 이벤트 22,000건을 정규식으로 훑는 질의는 손님 요청(anon 3초)에서 못 돈다.
--   누가 읽나: tools/daily/make-card.mjs(블로그 브랜드 순서·태그) · tools/daily/blog_kw_gap.mjs(파싱 목표) — 둘 다 이 PC 에서 CLI(관리자)로 읽는다.
--   ⚠ anon/authenticated 에 SELECT 를 주지 않는다 — 검색 횟수는 사장님이 파는 데이터 자산(2026-08-11 지시). RLS 켜고 정책 없음.
--   열: term(검색어 소문자) · c30(30일 검색 수) · c7(7일) · miss30(결과 0건이었던 검색 수 = 파싱 목표 신호) · last_at
--   적용: supabase db query --file supabase/sql/site_search_stats_65.sql --linked
create table if not exists public.site_search_stats (
  term       text primary key,
  c30        integer not null,
  c7         integer not null,
  miss30     integer not null,
  last_at    timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.site_search_stats enable row level security;   -- 정책 없음 = 관리자(CLI)만 읽는다
revoke all on public.site_search_stats from public, anon, authenticated;

create or replace function public.refresh_site_search_stats()
returns integer
language plpgsql security definer set search_path = public as $$
declare cnt integer;
begin
  create temp table _ss on commit drop as
    select q as term, count(*)::integer as c30,
           count(*) filter (where visited_at > now() - interval '7 days')::integer as c7,
           count(*) filter (where hit = 0)::integer as miss30,
           max(visited_at) as last_at
    from (
      select lower(trim(substring(event_data from '"q"\s*:\s*"([^"]+)"'))) as q,
             coalesce(nullif(substring(event_data from '"n"\s*:\s*(\d+)'),'')::int,0) as hit,
             visited_at
      from events
      where event_type='search' and visited_at > now() - interval '30 days'
    ) t
    where q is not null and length(q) between 2 and 20
    group by q
    having count(*) >= 2
    order by c30 desc, last_at desc
    limit 600;
  delete from site_search_stats;
  insert into site_search_stats (term, c30, c7, miss30, last_at, updated_at)
    select term, c30, c7, miss30, last_at, now() from _ss;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke all on function public.refresh_site_search_stats() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'site-search-stats';
-- 매일 03:20 KST (= 18:20 UTC). 검색 집계는 하루 단위면 충분하다.
select cron.schedule('site-search-stats', '20 18 * * *', $$select public.refresh_site_search_stats()$$);
select public.refresh_site_search_stats() as 채운_행수;
