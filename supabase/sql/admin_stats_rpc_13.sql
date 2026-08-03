-- ══════════════════════════════════════════════════════════
--  관리자 통계 RPC 2차 — 통계 전면 확장 (2026-07-25)
--  기존 admin_* 는 유지하고 추가만. 전부 SECURITY DEFINER + is_app_admin().
--  event_data 형식: category_click/status_tab/content_tab=평문,
--    search={q,n}(JSON), banner_click/promo_click=배너 식별자(평문)
-- ══════════════════════════════════════════════════════════

-- ── 인기 검색어 (검색량 순) ──
create or replace function public.admin_search_popular(p_days int default 30, p_limit int default 30)
returns table (q text, cnt bigint, zero_ratio numeric)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  with s as (
    select lower(btrim((regexp_match(event_data,'"q"[[:space:]]*:[[:space:]]*"([^"]*)"'))[1])) as qq,
           (event_data ~ '"n"[[:space:]]*:[[:space:]]*0[^0-9]') as zero
    from events
    where event_type='search' and visited_at>=since
      and event_data ~ '"q"[[:space:]]*:[[:space:]]*"[^"]'
  )
  select qq, count(*)::bigint, round(100.0*count(*) filter(where zero)/nullif(count(*),0),1)
  from s where qq<>'' group by qq order by count(*) desc
  limit greatest(1,least(p_limit,100));
end; $$;

-- ── 수요 갭: 결과 0건이 많은 검색어 (사람들이 찾는데 상품 없음 = 입점 기회) ──
create or replace function public.admin_search_gap(p_days int default 30, p_limit int default 30)
returns table (q text, zero_cnt bigint)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select lower(btrim((regexp_match(event_data,'"q"[[:space:]]*:[[:space:]]*"([^"]*)"'))[1])) as q,
         count(*)::bigint
  from events
  where event_type='search' and visited_at>=since
    and event_data ~ '"n"[[:space:]]*:[[:space:]]*0[^0-9]'
    and event_data ~ '"q"[[:space:]]*:[[:space:]]*"[^"]'
  group by 1 having lower(btrim((regexp_match(event_data,'"q"[[:space:]]*:[[:space:]]*"([^"]*)"'))[1]))<>''
  order by 2 desc limit greatest(1,least(p_limit,100));
end; $$;

-- ── 카테고리별 클릭 ──
create or replace function public.admin_category_clicks(p_days int default 30)
returns table (cat text, cnt bigint)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select event_data, count(*)::bigint from events
  where event_type='category_click' and visited_at>=since and coalesce(event_data,'')<>''
  group by 1 order by 2 desc;
end; $$;

-- ── 탭 사용 (상태탭 + 콘텐츠탭) ──
create or replace function public.admin_tab_usage(p_days int default 30)
returns table (tab_group text, tab text, cnt bigint)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select case when event_type='status_tab' then '공구 상태' else '콘텐츠' end,
         event_data, count(*)::bigint
  from events
  where event_type in ('status_tab','content_tab') and visited_at>=since and coalesce(event_data,'')<>''
  group by event_type, event_data order by 3 desc;
end; $$;

-- ── 광고 성과: 배너·기획전 클릭 ──
create or replace function public.admin_ad_perf(p_days int default 30)
returns table (ad_type text, banner_key text, title text, clicks bigint)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select case when e.event_type='banner_click' then '메인 배너' else '기획전' end,
         e.event_data,
         (select b.title from banners b where e.event_data ~ '^[0-9]+$' and b.id = e.event_data::bigint limit 1),
         count(*)::bigint
  from events e
  where e.event_type in ('banner_click','promo_click') and e.visited_at>=since
  group by e.event_type, e.event_data order by 4 desc;
end; $$;

-- ── 시간대별 방문 (KST 0~23시) ──
create or replace function public.admin_visit_hourly(p_days int default 30)
returns table (hour int, visits bigint)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select extract(hour from (visited_at at time zone 'Asia/Seoul'))::int, count(*)::bigint
  from visitors where visited_at>=since group by 1 order by 1;
end; $$;

-- ── 요일별 방문 (0=일 ~ 6=토, KST) ──
create or replace function public.admin_visit_weekday(p_days int default 30)
returns table (dow int, visits bigint)
language plpgsql stable security definer set search_path=public as $$
declare since timestamptz := now() - make_interval(days=>greatest(1,least(p_days,365)));
begin
  if not public.is_app_admin() then raise exception 'forbidden' using errcode='28000'; end if;
  return query
  select extract(dow from (visited_at at time zone 'Asia/Seoul'))::int, count(*)::bigint
  from visitors where visited_at>=since group by 1 order by 1;
end; $$;

-- ── 알림(푸시) 구독 요약 — 죽은 subscribers 대체 ──
create or replace function public.admin_push_subs()
returns json language plpgsql stable security definer set search_path=public as $$
declare tot bigint; act bigint; wk bigint;
begin
  if not public.is_app_admin() then return json_build_object('ok',false); end if;
  select count(*), count(*) filter(where fail_count<5),
         count(*) filter(where created_at>=now()-interval '7 days')
    into tot, act, wk from push_subs;
  return json_build_object('ok',true,'total',tot,'active',act,'recent7',wk);
end; $$;

-- ── 실행 권한 ──
revoke execute on function
  public.admin_search_popular(int,int), public.admin_search_gap(int,int),
  public.admin_category_clicks(int), public.admin_tab_usage(int),
  public.admin_ad_perf(int), public.admin_visit_hourly(int),
  public.admin_visit_weekday(int), public.admin_push_subs()
  from public, anon;
grant execute on function
  public.admin_search_popular(int,int), public.admin_search_gap(int,int),
  public.admin_category_clicks(int), public.admin_tab_usage(int),
  public.admin_ad_perf(int), public.admin_visit_hourly(int),
  public.admin_visit_weekday(int), public.admin_push_subs()
  to authenticated;
