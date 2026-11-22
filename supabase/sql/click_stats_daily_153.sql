-- 클릭 통계 집계를 가볍게: 끝난 날은 하루치씩 한 번만 접어 두고, 30분마다는 「오늘」만 다시 센다 (2026-11-16)
--   왜: refresh_gonggu_click_stats(21) 이 30분마다 21일치 card_click 을 정규식으로 통째로 다시 셌다(10~40초, 무료 DB CPU 를 다 씀).
--       그 시각(매시 04·34분)에 손님 찜 목록 호출(wish_list, anon 제한 3초)이 500 을 받았다 — error_radar 「우회로 중 서버5xx」 하루 7~8건이 전부 이 시각.
--   어떻게: gonggu_click_daily(날·공구·클릭)에 끝난 날(UTC)을 접어 둔다. 한 번에 최대 3일씩 접고, 21일이 다 접히기 전까지는 옛 방식(통째로 세기)으로 값을 낸다 → 숫자가 비는 순간이 없다.
--       다 접힌 뒤에는 「접어 둔 21일 + 오늘 0시(UTC) 이후」만 센다. 창이 「지난 21×24시간」에서 「지난 21일 + 오늘」로 조금 달라진다(TOP100 순위용이라 무방).
--   한도: gonggu_click_daily 는 22일치만 둔다(하루 수백 행).
--   되돌리기: supabase/sql 의 옛 정의(이 파일 위 주석의 통째 세기 블록만 남기면 된다) — 표 두 개는 남겨도 해가 없다.
create table if not exists public.gonggu_click_daily (day date not null, id bigint not null, clicks bigint not null, primary key (day, id));
create table if not exists public.gonggu_click_days_done (day date primary key, done_at timestamptz not null default now());
alter table public.gonggu_click_daily enable row level security;
alter table public.gonggu_click_days_done enable row level security;
revoke all on public.gonggu_click_daily, public.gonggu_click_days_done from public, anon, authenticated;

create or replace function public.refresh_gonggu_click_stats(p_days integer default 21)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer; d date; today date := (now() at time zone 'utc')::date; pending integer;
begin
  -- 1) 끝난 날 중 아직 안 접은 날을 최근 것부터 최대 3일 접는다
  for d in select g::date from generate_series(today - p_days, today - 1, interval '1 day') g
            where not exists (select 1 from gonggu_click_days_done x where x.day = g::date)
            order by g desc limit 3 loop
    delete from gonggu_click_daily where day = d;
    insert into gonggu_click_daily(day, id, clicks)
      select d, q.id_txt::bigint, count(*)
        from (select (regexp_match(e.event_data::text, '"id"[[:space:]]*:[[:space:]]*([0-9]+)'))[1] as id_txt
                from events e
               where e.event_type = 'card_click'
                 and e.visited_at >= (d::timestamp at time zone 'utc')
                 and e.visited_at <  ((d + 1)::timestamp at time zone 'utc')
                 and e.event_data is not null
                 and btrim(e.event_data::text) like '{%') q
       where q.id_txt is not null group by q.id_txt;
    insert into gonggu_click_days_done(day) values (d) on conflict (day) do nothing;
  end loop;
  delete from gonggu_click_daily where day < today - p_days - 1;
  delete from gonggu_click_days_done where day < today - p_days - 1;

  select count(*) into pending from generate_series(today - p_days, today - 1, interval '1 day') g
   where not exists (select 1 from gonggu_click_days_done x where x.day = g::date);

  if pending > 0 then
    -- 아직 다 못 접었다 → 옛 방식(통째로 세기)으로 값을 낸다
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
  else
    create temp table _cs on commit drop as
      select u.id, sum(u.clicks)::bigint as clicks from (
        select c.id, c.clicks from gonggu_click_daily c where c.day >= today - p_days
        union all
        select q.id_txt::bigint, count(*)::bigint
          from (select (regexp_match(e.event_data::text, '"id"[[:space:]]*:[[:space:]]*([0-9]+)'))[1] as id_txt
                  from events e
                 where e.event_type = 'card_click'
                   and e.visited_at >= (today::timestamp at time zone 'utc')
                   and e.event_data is not null
                   and btrim(e.event_data::text) like '{%') q
         where q.id_txt is not null group by q.id_txt
      ) u group by u.id;
  end if;
  -- 한 트랜잭션 안에서 갈아끼운다 → 읽는 쪽은 빈 표를 보는 순간이 없다
  delete from gonggu_click_stats where id not in (select id from _cs);
  insert into gonggu_click_stats (id, clicks, updated_at)
    select id, clicks, now() from _cs
    on conflict (id) do update set clicks = excluded.clicks, updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end $function$;
