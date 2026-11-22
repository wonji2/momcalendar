-- ═══════════════════════════════════════════════════════════════
-- search_trending_42.sql (2026-08-31)
-- 검색창 드롭다운 "지금 뜨는 검색어" 용 RPC
--
-- 배경: events 는 경쟁사 방어로 anon 열람 차단(기록만 가능) 상태.
--       드롭다운에 보여줄 인기 검색어만 SECURITY DEFINER 로 좁게 연다.
-- 안전장치:
--   · 검색어(순위순) 만 반환 — 횟수·집계수치는 반환하지 않는다 (집계는 자산)
--   · 최근 3일 · 2회 이상 검색 · 결과(n)가 1건 이상 있던 검색어만 · 최대 10개
--   · 길이 2~20자만 (오타·문장 배제)
-- ═══════════════════════════════════════════════════════════════

create or replace function public.search_trending()
returns table(term text)
language sql
stable
security definer
set search_path = public
as $$
  select q as term
  from (
    select lower(trim(substring(event_data from '"q"\s*:\s*"([^"]+)"'))) as q,
           count(*) as c,
           max(visited_at) as mx,
           max(coalesce(nullif(substring(event_data from '"n"\s*:\s*(\d+)'),'')::int,0)) as n
    from events
    where event_type='search'
      and visited_at > now() - interval '3 days'
    group by 1
  ) t
  where q is not null and length(q) between 2 and 20 and c >= 2 and n > 0
  order by c desc, mx desc
  limit 10;
$$;

revoke all on function public.search_trending() from public;
grant execute on function public.search_trending() to anon, authenticated, service_role;
