-- 검색어 인기순(search_trending) 미리 세기 (2026-09-27) — click_stats_62 와 같은 처방
--
-- 사고: 우회로 기록(net_fallback|http500) 의 요청 경로가 v3 부터 남는다 → 09-24~27 서버 500 5건 중 4건이 /rest/v1/rpc/search_trending.
--       이 RPC 는 매 방문마다 events(54만 행)에서 3일치 search 를 정규식으로 집계한다. 평균 225ms 지만 최대 2.9초(pg_stat_statements 18,834회)
--       → 배치가 DB 를 쓰는 시간대엔 anon statement_timeout(3초)을 넘겨 500.
-- 고침: 10분마다 pg_cron 이 postgres 권한으로 집계해 search_trending_stats 에 넣고, RPC 는 그 표만 읽는다(수 ms).
--       RPC 시그니처(인자 없음 · returns table(term text)) 그대로 — 사이트 코드 변경 없음. 사이트 쪽은 어차피 10분 캐시라 신선도 손해 없음.
-- 되돌리기: 맨 아래 ROLLBACK.

create table if not exists public.search_trending_stats (
  rank       integer primary key,
  term       text not null,
  updated_at timestamptz not null default now()
);
alter table public.search_trending_stats enable row level security;   -- 정책 없음 = SECURITY DEFINER 함수로만 읽는다

create or replace function public.refresh_search_trending()
returns integer
language plpgsql security definer set search_path = public as $$
declare cnt integer;   -- ⚠ 이름을 n 으로 두면 안쪽 SELECT 의 열 n 과 겹쳐 42702 (첫 적용 때 실측)
begin
  create temp table _st on commit drop as
    select row_number() over (order by c desc, mx desc)::integer as rank, q as term
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
  delete from search_trending_stats where rank not in (select rank from _st);
  insert into search_trending_stats (rank, term, updated_at)
    select rank, term, now() from _st
    on conflict (rank) do update set term = excluded.term, updated_at = excluded.updated_at;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke all on function public.refresh_search_trending() from public, anon, authenticated;

create or replace function public.search_trending()
returns table(term text)
language sql stable security definer set search_path = public as $$
  select term from search_trending_stats order by rank limit 10;
$$;
grant execute on function public.search_trending() to anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'search-trending-stats';
select cron.schedule('search-trending-stats', '3,13,23,33,43,53 * * * *', $$select public.refresh_search_trending()$$);

select public.refresh_search_trending() as 첫집계_행수;
select rank, term, to_char(updated_at at time zone 'Asia/Seoul','HH24:MI') 갱신 from public.search_trending_stats order by rank;

-- ROLLBACK
-- select cron.unschedule(jobid) from cron.job where jobname='search-trending-stats';
-- create or replace function public.search_trending() returns table(term text) language sql stable security definer set search_path = public as $$
--   select q as term from (select lower(trim(substring(event_data from '"q"\s*:\s*"([^"]+)"'))) as q, count(*) as c, max(visited_at) as mx,
--     max(coalesce(nullif(substring(event_data from '"n"\s*:\s*(\d+)'),'')::int,0)) as n from events where event_type='search' and visited_at > now() - interval '3 days' group by 1) t
--   where q is not null and length(q) between 2 and 20 and c >= 2 and n > 0 order by c desc, mx desc limit 10; $$;
-- drop function public.refresh_search_trending(); drop table public.search_trending_stats;
