-- 카드 클릭 수를 미리 세어 두는 표 (2026-09-23) — gonggu_click_counts() 의 3초 statement timeout 500 시정
--
-- 사고: 사이트가 매 방문마다 부르는 rpc/gonggu_click_counts 가 events(53만 행)에서 card_click 21일치를 정규식으로 세고 있었다.
--       평소 0.6~2초, 파싱·SEO 배치가 DB 를 쓰는 동안엔 anon 의 statement_timeout(3초)을 넘겨 **500** (57014).
--       우회로(net_fallback) 기록 16건 중 http500 5건이 이것이었을 가능성이 크다(v2 는 경로를 안 남겨 추정).
-- 고침: 10분마다 pg_cron 이 postgres 권한(시간제한 없음)으로 세어 gonggu_click_stats 에 넣고, RPC 는 그 표만 읽는다 (수 ms).
--       RPC 시그니처(p_days, p_limit)는 그대로 — 사이트 코드 변경 없음. p_days 는 이제 무시된다(집계는 항상 21일).
-- 되돌리기: 맨 아래 ROLLBACK 블록.

create table if not exists public.gonggu_click_stats (
  id         bigint primary key,
  clicks     bigint not null,
  updated_at timestamptz not null default now()
);
alter table public.gonggu_click_stats enable row level security;   -- 정책 없음 = SECURITY DEFINER 함수로만 읽는다

-- 집계 함수 (postgres 소유 · 시간제한 없음) — 원래 RPC 의 계산을 그대로 옮겼다
create or replace function public.refresh_gonggu_click_stats(p_days integer default 21)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  create temp table _cs on commit drop as
    with parsed as (
      select case
               when btrim(e.event_data::text) like '{%'
                    and (e.event_data::text) ~ '"id"[[:space:]]*:[[:space:]]*[0-9]+'
               then (regexp_match(e.event_data::text, '"id"[[:space:]]*:[[:space:]]*([0-9]+)'))[1]
               else null end as id_txt
        from events e
       where e.event_type = 'card_click'
         and e.visited_at >= now() - make_interval(days => p_days)
         and e.event_data is not null)
    select id_txt::bigint as id, count(*)::bigint as clicks
      from parsed where id_txt is not null group by id_txt;
  -- 한 트랜잭션 안에서 갈아끼운다 → 읽는 쪽은 빈 표를 보는 순간이 없다
  delete from gonggu_click_stats where id not in (select id from _cs);
  insert into gonggu_click_stats (id, clicks, updated_at)
    select id, clicks, now() from _cs
    on conflict (id) do update set clicks = excluded.clicks, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.refresh_gonggu_click_stats(integer) from public, anon, authenticated;

-- RPC: 같은 이름·같은 인자·같은 결과 모양. 이제 미리 센 표만 읽는다
create or replace function public.gonggu_click_counts(p_days integer default 21, p_limit integer default 400)
returns table(id bigint, clicks bigint)
language sql stable security definer set search_path = public as $$
  select id, clicks from gonggu_click_stats order by clicks desc, id desc limit p_limit;
$$;
grant execute on function public.gonggu_click_counts(integer, integer) to anon, authenticated;

-- 10분마다 갱신 (jobname 으로 중복 등록 방지)
select cron.unschedule(jobid) from cron.job where jobname = 'gonggu-click-stats';
select cron.schedule('gonggu-click-stats', '*/10 * * * *', $$select public.refresh_gonggu_click_stats(21)$$);

-- 첫 집계를 지금 채운다
select public.refresh_gonggu_click_stats(21) as 첫집계_행수;
select count(*) as 표행수, max(updated_at) as 갱신시각 from public.gonggu_click_stats;

-- ROLLBACK (원래대로: events 를 직접 세는 RPC)
-- select cron.unschedule(jobid) from cron.job where jobname='gonggu-click-stats';
-- create or replace function public.gonggu_click_counts(p_days integer default 21, p_limit integer default 400)
-- returns table(id bigint, clicks bigint) language sql stable security definer set search_path = public as $$
--   with parsed as (select case when btrim(e.event_data::text) like '{%' and (e.event_data::text) ~ '"id"[[:space:]]*:[[:space:]]*[0-9]+'
--     then (regexp_match(e.event_data::text, '"id"[[:space:]]*:[[:space:]]*([0-9]+)'))[1] else null end as id_txt
--     from events e where e.event_type='card_click' and e.visited_at >= now() - make_interval(days => p_days) and e.event_data is not null)
--   select id_txt::bigint as id, count(*) as clicks from parsed where id_txt is not null group by id_txt order by clicks desc limit p_limit; $$;
-- drop function public.refresh_gonggu_click_stats(integer); drop table public.gonggu_click_stats;
